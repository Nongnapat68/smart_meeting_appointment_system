import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/format";
import type { NotificationType } from "@prisma/client";

interface MeetingNotifyInput {
  meetingId: string;
  type: NotificationType;
  /** In-app notification title. */
  title: string;
  /** Short in-app body — defaults to the meeting title. */
  body?: string;
  /** Header of the email (prefixed with the meeting title). */
  emailPrefix: string;
  /** Optional — the acting user, who is excluded from their own in-app/email. */
  excludeUserId?: string;
}

/**
 * Notifies EVERYONE on a meeting's participant list — internal users via an
 * in-app Notification row (bell badge + dropdown) and all participants via
 * email. Used on create/update/cancel/reschedule so each action reaches the
 * whole attendee list, not just the organizer.
 *
 * Emails are fired in the background so a slow SMTP never blocks the request;
 * in-app writes are awaited since they are local DB inserts. Notifications are
 * still delivered by the reminder scheduler regardless, so this is additive.
 */
export async function notifyMeetingParticipants(input: MeetingNotifyInput): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: input.meetingId },
    include: { participants: { include: { person: true } } },
  });
  if (!meeting) return;

  const internalUserIds = meeting.participants
    .map((p) => p.person.userId)
    .filter((u): u is string => Boolean(u) && u !== input.excludeUserId);

  if (internalUserIds.length) {
    await prisma.notification.createMany({
      data: internalUserIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? meeting.title,
        relatedId: meeting.id,
      })),
    });
  }

  const when = `${formatDateTime(meeting.startTime)} - ${formatDateTime(meeting.endTime)}`;
  const details = [meeting.title, when, meeting.location && `สถานที่: ${meeting.location}`]
    .filter(Boolean)
    .join("\n");

  void Promise.all(
    meeting.participants
      .filter((p) => p.person.userId !== input.excludeUserId)
      .map((participant) =>
        sendEmail({
          to: participant.person.email,
          subject: `${input.emailPrefix}: ${meeting.title}`,
          text: details,
        }).catch((err) => console.error(`[meeting-notify] email to ${participant.person.email} failed:`, err))
      )
  );
}