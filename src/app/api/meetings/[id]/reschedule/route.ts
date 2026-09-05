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

  const meeting = await prisma.meeting.update({
    where: { id },
    data: { startTime, endTime, status: "POSTPONED" },
  });

  // Keep the reminder in sync with the new time.
  await prisma.reminder.updateMany({
    where: { meetingId: id, status: "PENDING" },
    data: { scheduledAt: new Date(startTime.getTime() - 30 * 60 * 1000) },
  });

  return NextResponse.json({ meeting });
});
