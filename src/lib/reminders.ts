import type { Prisma, Reminder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ApiError } from "@/lib/api-helpers";

// Sending a reminder and recording the outcome — shared by
// POST /api/reminders/process-due and POST /api/reminders/[id]/retry, which
// keep only their own auth checks.
//
// The recorded status is decided by what sendEmail() reports, not by whether
// it threw: SENT only when every email was actually delivered, SIMULATED when
// the app has no email transport and only logged them (today that's always —
// see src/lib/email.ts). Recording SENT for a logged-only email would be a
// false record in the database.

export const reminderWithRecipients = {
  meeting: { include: { participants: { include: { person: true } } } },
} satisfies Prisma.ReminderInclude;

export type ReminderWithRecipients = Prisma.ReminderGetPayload<{ include: typeof reminderWithRecipients }>;

export const SEND_FAILURE_REASON = "ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบการตั้งค่า SMTP";

/**
 * Emails every participant and returns the status to record. SENT needs at
 * least one email actually delivered and none merely simulated — a meeting
 * with no participants delivered nothing, so it isn't SENT either.
 * Throws if sendEmail throws (callers record FAILED).
 */
async function deliver(reminder: ReminderWithRecipients): Promise<"SENT" | "SIMULATED"> {
  const outcomes = [];
  for (const p of reminder.meeting.participants) {
    outcomes.push(
      await sendEmail({
        to: p.person.email,
        subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
        text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${reminder.meeting.startTime.toLocaleString("th-TH")}`,
      })
    );
  }
  return outcomes.length > 0 && outcomes.every((o) => o === "delivered") ? "SENT" : "SIMULATED";
}

// sentAt is only ever set for a real delivery.
function outcomeData(status: "SENT" | "SIMULATED") {
  return { status, sentAt: status === "SENT" ? new Date() : null, failureReason: null };
}

export type ProcessDueResult = {
  id: string;
  meetingTitle: string;
  status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED";
};

/**
 * BR-13: processes every Reminder whose scheduledAt has passed and is still
 * PENDING (the due set comes from the process_due_reminders() SQL function),
 * emails its participants, and moves it out of PENDING so a second call never
 * processes it again. Each row is moved with `updateMany({ where: { id,
 * status: "PENDING" } })`, which only succeeds while it is still PENDING at
 * the moment of the write.
 *
 * The same run also sweeps up the PENDING reminders process_due_reminders()
 * deliberately does *not* return (20261003130100 — cancelled/finished meetings
 * and meetings that already started): the SQL function only selects, so
 * without this they would sit PENDING forever and keep showing up as pending
 * on /reminders. They are reported as SKIPPED like the in-loop skips.
 */
export async function processDueReminders(): Promise<ProcessDueResult[]> {
  const dueIds = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM process_due_reminders();`;
  const dueReminders = dueIds.length
    ? await prisma.reminder.findMany({
        where: { id: { in: dueIds.map((r) => r.id) } },
        include: reminderWithRecipients,
      })
    : [];

  const results: ProcessDueResult[] = [];
  for (const reminder of dueReminders) {
    try {
      const status = await deliver(reminder);
      const updated = await prisma.reminder.updateMany({
        where: { id: reminder.id, status: "PENDING" },
        data: outcomeData(status),
      });
      results.push({
        id: reminder.id,
        meetingTitle: reminder.meeting.title,
        status: updated.count > 0 ? status : "SKIPPED",
      });
    } catch (err) {
      console.error("process-due reminder failed", reminder.id, err);
      await prisma.reminder.updateMany({
        where: { id: reminder.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: SEND_FAILURE_REASON },
      });
      results.push({ id: reminder.id, meetingTitle: reminder.meeting.title, status: "FAILED" });
    }
  }
  results.push(...(await sweepUnsendableReminders()));
  return results;
}

/**
 * Cancels the PENDING reminders whose meeting can no longer be reminded about
 * (cancelled, completed, already started, or already ended) and returns them
 * as SKIPPED. The meeting test is repeated here rather than trusting the caller's
 * read, and the UPDATE only touches rows that are still PENDING — a reminder
 * sent between the SELECT and the UPDATE keeps its SENT status.
 *
 * POSTPONED is not swept: a postponed meeting moved its start (and its pending
 * reminders with it), so its reminders are still legitimately due.
 */
async function sweepUnsendableReminders(): Promise<ProcessDueResult[]> {
  const rows = await prisma.$queryRaw<{ id: string; title: string }[]>`
    SELECT r.id, m.title
    FROM public."Reminder" r
    JOIN public."Meeting" m ON m.id = r."meetingId"
    WHERE r.status = 'PENDING'
      AND (m.status IN ('CANCELLED', 'COMPLETED') OR m."startTime" <= now() OR m."endTime" <= now())
    ORDER BY r."scheduledAt" ASC`;
  if (rows.length === 0) return [];

  await prisma.reminder.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  return rows.map((r) => ({ id: r.id, meetingTitle: r.title, status: "SKIPPED" }));
}

/**
 * Re-sends a FAILED reminder. Anything else is a 409: re-sending SENT or
 * SIMULATED would duplicate it (BR-13), CANCELLED must stay cancelled
 * (BR-14), and PENDING belongs to process-due.
 *
 * Race-safe like process-due: before sending, the retry is claimed with a
 * conditional update on (status = FAILED, retryCount = the value just read).
 * Two overlapping retries read the same retryCount, so only one claim can
 * match — the other gets 409 and sends nothing.
 */
export async function retryFailedReminder(
  reminder: ReminderWithRecipients
): Promise<{ ok: boolean; reminder: Reminder }> {
  if (reminder.status !== "FAILED") {
    throw new ApiError(409, "ส่งใหม่ได้เฉพาะการแจ้งเตือนที่ส่งไม่สำเร็จ (FAILED) เท่านั้น");
  }

  const claimed = await prisma.reminder.updateMany({
    where: { id: reminder.id, status: "FAILED", retryCount: reminder.retryCount },
    data: { retryCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "การแจ้งเตือนนี้ถูกส่งใหม่หรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชแล้วลองอีกครั้ง");
  }

  let ok = true;
  try {
    const status = await deliver(reminder);
    await prisma.reminder.updateMany({ where: { id: reminder.id, status: "FAILED" }, data: outcomeData(status) });
  } catch {
    ok = false;
    await prisma.reminder.updateMany({
      where: { id: reminder.id, status: "FAILED" },
      data: { failureReason: SEND_FAILURE_REASON },
    });
  }

  return { ok, reminder: await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } }) };
}
