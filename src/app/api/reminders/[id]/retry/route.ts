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

  const result = await retryFailedReminder(reminder);
  return NextResponse.json({ reminder: result.reminder }, { status: result.ok ? 200 : 502 });
});
