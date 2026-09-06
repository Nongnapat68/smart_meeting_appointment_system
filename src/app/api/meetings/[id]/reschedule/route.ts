import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rescheduleMeetingSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(rescheduleMeetingSchema, await request.json());

  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(user, existing.organizerId === user.id, "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่เลื่อนเวลาการประชุมนี้ได้");

  const startTime = new Date(body.startTime);
  const endTime = new Date(body.endTime);
  if (endTime <= startTime) throw new ApiError(400, "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");

  const meeting = await prisma.$transaction(async (tx) => {
    const pendingReminders = await tx.reminder.findMany({
      where: { meetingId: id, status: "PENDING" },
      select: { id: true, offsetMinutes: true },
    });
    const updatedMeeting = await tx.meeting.update({
      where: { id },
      data: { startTime, endTime, status: "POSTPONED" },
    });
    await Promise.all(
      pendingReminders.map((reminder) =>
        tx.reminder.update({
          where: { id: reminder.id },
          data: { scheduledAt: new Date(startTime.getTime() - reminder.offsetMinutes * 60 * 1000) },
        })
      )
    );
    return updatedMeeting;
  });

  return NextResponse.json({ meeting });
});
