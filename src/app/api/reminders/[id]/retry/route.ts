import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reminderWithRecipients, retryFailedReminder } from "@/lib/reminders";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

// Only a FAILED reminder can be retried (409 otherwise) — see
// retryFailedReminder() in src/lib/reminders.ts.
export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

const reminder = await prisma.reminder.findUnique({
    where: { id },
    include: reminderWithRecipients,
  });
  if (!reminder) throw new ApiError(404, "ไม่พบการแจ้งเตือนนี้");
  assertOwner(
    user,
    reminder.meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ส่งการแจ้งเตือนนี้ใหม่ได้"
  );
  // Ownership is settled first: without it the 409 below would tell any signed-in
  // user the meeting's status for a reminder they cannot touch. Resending into a
  // cancelled/finished meeting would announce "starting soon" for something that
  // is not happening (or already happened).
  if (reminder.meeting.status === "CANCELLED" || reminder.meeting.status === "COMPLETED") {
    throw new ApiError(409, "ไม่สามารถส่งซ้ำการแจ้งเตือนของประชุมที่ยกเลิกไปหรือสิ้นสุดไปแล้ว");
  }

  const result = await retryFailedReminder(reminder);
  return NextResponse.json({ reminder: result.reminder }, { status: result.ok ? 200 : 502 });
});
