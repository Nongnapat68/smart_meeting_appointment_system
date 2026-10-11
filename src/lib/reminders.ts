import type { Prisma, Reminder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ApiError } from "@/lib/api-helpers";
import { formatDateTime } from "@/lib/format";

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
  meeting: {
    include: {
      organizer: { select: { id: true, inAppNotifications: true } },
      participants: {
        include: { person: { include: { user: { select: { emailNotifications: true, inAppNotifications: true } } } } },
      },
    },
  },
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
  // A participant whose linked account turned "การแจ้งเตือนผ่านอีเมล" off in
  // Settings is skipped; external contacts (no account) always get the email.
  const recipients = reminder.meeting.participants.filter((p) => p.person.user?.emailNotifications !== false);
  for (const p of recipients) {
    outcomes.push(
      await sendEmail({
        to: p.person.email,
        subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
        text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${formatDateTime(reminder.meeting.startTime)}`,
      })
    );
  }
  return outcomes.length > 0 && outcomes.every((o) => o === "delivered") ? "SENT" : "SIMULATED";
}

// sentAt is only ever set for a real delivery.
function outcomeData(status: "SENT" | "SIMULATED") {
  return { status, sentAt: status === "SENT" ? new Date() : null, failureReason: null };
}

/**
 * In-app REMINDER notifications for a reminder that has just left PENDING:
 * one per internal account among the participants, plus the organizer, unless
 * that account turned "การแจ้งเตือนในแอป" off in Settings. External contacts
 * have no account and only get the email. Created once, when the reminder is
 * first processed (whatever the email outcome) — a later retry of a FAILED
 * email doesn't add another.
 */
function reminderNotifications(reminder: ReminderWithRecipients): Prisma.NotificationCreateManyInput[] {
  const { meeting } = reminder;
  const userIds = new Set<string>();
  for (const p of meeting.participants) {
    if (p.person.userId && p.person.user?.inAppNotifications !== false) userIds.add(p.person.userId);
  }
  if (meeting.organizer && meeting.organizer.inAppNotifications !== false) userIds.add(meeting.organizer.id);
  return [...userIds].map((userId) => ({
    userId,
    type: "REMINDER" as const,
    title: "แจ้งเตือนการประชุม",
    body: `"${meeting.title}" จะเริ่มเวลา ${formatDateTime(meeting.startTime)}`,
    relatedId: meeting.id,
  }));
}

/**
 * Claims one due reminder, sends it and records the outcome — all inside one
 * transaction that holds a row lock on the Reminder. `FOR UPDATE SKIP LOCKED`
 * means a second processor running at the same moment (the admin button and
 * the auto-processor, or two server instances) skips a row the first one is
 * working on instead of emailing it again, and once the first commits the row
 * is no longer PENDING. The meeting is re-checked under the lock, so a
 * reminder whose meeting was cancelled or started after the due set was read
 * is not sent (the sweep below cancels it).
 *
 * The lock is transaction-scoped, so it is safe behind the transaction-mode
 * pooler (same as the advisory lock in src/lib/otp.ts). The email is sent while
 * the lock is held — that is the point — so the timeout leaves room for it.
 */
async function processOneDueReminder(reminder: ReminderWithRecipients): Promise<ProcessDueResult["status"]> {
  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        SELECT r.id
        FROM public."Reminder" r
        JOIN public."Meeting" m ON m.id = r."meetingId"
        WHERE r.id = ${reminder.id}
          AND r.status = 'PENDING'
          AND m.status NOT IN ('CANCELLED', 'COMPLETED')
          AND m."startTime" > now()
          AND m."endTime" > now()
        FOR UPDATE OF r SKIP LOCKED`;
      if (claimed.length === 0) return "SKIPPED";

      let status: "SENT" | "SIMULATED" | "FAILED";
      try {
        status = await deliver(reminder);
        await tx.reminder.update({ where: { id: reminder.id }, data: outcomeData(status) });
      } catch (err) {
        console.error("process-due reminder failed", reminder.id, err);
        status = "FAILED";
        await tx.reminder.update({
          where: { id: reminder.id },
          data: { status: "FAILED", failureReason: SEND_FAILURE_REASON },
        });
      }
      const notifications = reminderNotifications(reminder);
      if (notifications.length) await tx.notification.createMany({ data: notifications });
      return status;
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
}

export type ProcessDueResult = {
  id: string;
  meetingTitle: string;
  status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED";
};

/**
 * BR-13: processes every Reminder whose scheduledAt has passed and is still
 * PENDING (the due set comes from the process_due_reminders() SQL function),
 * emails its participants, creates the in-app REMINDER notifications, and
 * moves it out of PENDING so a second call never processes it again. Each row
 * is claimed under a row lock before anything is sent (processOneDueReminder),
 * so two runs at the same moment send it once — the other reports SKIPPED.
 * This used to send first and then flip the row with a conditional update:
 * the row ended up updated once, but both overlapping runs had already
 * emailed it.
 *
 * Shared by POST /api/reminders/process-due (the admin button) and the
 * optional auto-processor started from src/instrumentation.ts.
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
    results.push({ id: reminder.id, meetingTitle: reminder.meeting.title, status: await processOneDueReminder(reminder) });
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
