import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ApiError, isAdmin, requireUser, withApiErrors } from "@/lib/api-helpers";

/**
 * BR-13: processes every Reminder whose scheduledAt has passed and is still
 * PENDING, sends its email (mocked via sendEmail — see src/lib/email.ts),
 * and flips it to SENT so a second call never re-sends it. Not a 24/7 cron —
 * callable on demand (an ops script, a scheduled task, a manual admin
 * trigger), which is enough for "prevent duplicate reminder delivery"
 * without standing infrastructure.
 *
 * Anti-duplicate mechanism: each reminder is flipped with `updateMany({
 * where: { id, status: "PENDING" } })`, which only succeeds while it's still
 * PENDING at the moment of the write — so even two overlapping calls can
 * each send at most one email per reminder, not just two sequential calls.
 *
 * The due set itself comes from the process_due_reminders() SQL function
 * (prisma/migrations/20260911140000_process_due_reminders_function) rather
 * than a direct Prisma query — same "status = PENDING AND scheduledAt <=
 * now()" filter, just expressed once in SQL. Sending email stays here in
 * TypeScript since Postgres can't do that itself.
 */
export const POST = withApiErrors(async () => {
  const user = await requireUser();
  if (!isAdmin(user)) {
    throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่ประมวลผลการแจ้งเตือนที่ถึงเวลาได้");
  }

  const dueIds = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM process_due_reminders();`;
  const dueReminders = dueIds.length
    ? await prisma.reminder.findMany({
        where: { id: { in: dueIds.map((r) => r.id) } },
        include: { meeting: { include: { participants: { include: { person: true } } } } },
      })
    : [];

  const results: { id: string; meetingTitle: string; status: "SENT" | "FAILED" | "SKIPPED" }[] = [];

  for (const reminder of dueReminders) {
    try {
      for (const p of reminder.meeting.participants) {
        await sendEmail({
          to: p.person.email,
          subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
          text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${reminder.meeting.startTime.toLocaleString("th-TH")}`,
        });
      }

      const updated = await prisma.reminder.updateMany({
        where: { id: reminder.id, status: "PENDING" },
        data: { status: "SENT", sentAt: new Date() },
      });
      results.push({
        id: reminder.id,
        meetingTitle: reminder.meeting.title,
        // count === 0 means another concurrent call already flipped this
        // reminder between the findMany above and this write.
        status: updated.count > 0 ? "SENT" : "SKIPPED",
      });
    } catch (err) {
      console.error("process-due reminder failed", reminder.id, err);
      await prisma.reminder.updateMany({
        where: { id: reminder.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบการตั้งค่า SMTP" },
      });
      results.push({ id: reminder.id, meetingTitle: reminder.meeting.title, status: "FAILED" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
