import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

const reminder = await prisma.reminder.findUnique({ where: { id }, include: { meeting: true } });
  if (!reminder) throw new ApiError(404, "ไม่พบการแจ้งเตือนนี้");
  assertOwner(
    user,
    reminder.meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ยกเลิกการแจ้งเตือนนี้ได้"
  );
  // After the ownership check: cancelling the meeting already cancels its
  // reminders through the 20260911160000 trigger, so a PENDING row still sitting
  // here belongs to a cancelled meeting and there is nothing left to cancel.
  if (reminder.meeting.status === "CANCELLED") {
    throw new ApiError(409, "การแจ้งเตือนนี้ถูกยกเลิกไปแล้วพร้อมการประชุม");
  }

  const updated = await prisma.reminder.update({ where: { id }, data: { status: "CANCELLED" } });
  return NextResponse.json({ reminder: updated });
});
