import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

export interface ReminderProcessResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Finds all due, still-PENDING reminders and delivers them (email to every
 * participant). Also writes an in-app `Notification` (type: REMINDER) to every
 * participant who has a linked login account, so the bell badge reflects
 * reminders without requiring SMTP.
 *
 * Rows are claimed pessimistically (PENDING -> PROCESSING) before delivery so
 * concurrent invocations (the internal cron route and the local scheduler)
 * can never send the same reminder twice.
 */
export async function processDueReminders(): Promise<ReminderProcessResult> {
  const due = await prisma.reminder.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date() } },
    include: { meeting: { include: { participants: { include: { person: true } } } } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const claimed = await prisma.reminder.updateMany({
      where: { id: reminder.id, status: "PENDING" },
      data: { status: "PROCESSING", failureReason: null },
    });
    if (!claimed.count) continue;

    const internalUserIds = reminder.meeting.participants
      .map((p) => p.person.userId)
      .filter((u): u is string => Boolean(u));

    try {
      await Promise.all(
        reminder.meeting.participants.map((participant) =>
          sendEmail({
            to: participant.person.email,
            subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
            text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${reminder.meeting.startTime.toLocaleString("th-TH")}`,
          })
        )
      );

      if (internalUserIds.length) {
        await prisma.notification.createMany({
          data: internalUserIds.map((userId) => ({
            userId,
            type: "REMINDER",
            title: "ใกล้ถึงเวลาการประชุม",
            body: reminder.meeting.title,
            relatedId: reminder.meetingId,
          })),
        });
      }

      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: "SENT", sentAt: new Date(), failureReason: null, retryCount: { increment: 1 } },
      });
      sent++;
    } catch {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "FAILED",
          failureReason: "ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบการตั้งค่า SMTP",
          retryCount: { increment: 1 },
        },
      });
      failed++;
    }
  }

  return { processed: due.length, sent, failed };
}