import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";
import { notifyMeetingParticipants } from "@/lib/meeting-notify";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(user, existing.organizerId === user.id, "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ยกเลิกการประชุมนี้ได้");

  const meeting = await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });

  await prisma.reminder.updateMany({
    where: { meetingId: id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  await notifyMeetingParticipants({
    meetingId: id,
    type: "MEETING_CANCELLED",
    title: "การประชุมถูกยกเลิก",
    emailPrefix: "แจ้งยกเลิกการประชุม",
    excludeUserId: user.id,
  });

  return NextResponse.json({ meeting });
});
