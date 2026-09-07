import { sendEmail } from "@/lib/email";
import { generateIcs } from "@/lib/ics";

export interface MeetingForNotify {
  id: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  onlineMeetingResource: { url: string } | null;
  organizerPerson: { name: string; email: string } | null;
  participants: { person: { name: string; email: string } }[];
}

/**
 * FR-09: emails every participant — internal and external alike, since
 * email is the one channel both have — with the meeting's real .ics
 * attached, generated fresh from current meeting data (not a stored copy).
 * Goes through sendEmail() same as every other email in the app, which
 * logs instead of actually sending unless SMTP_* is configured (see
 * src/lib/email.ts) — there is no separate "real" path to wire up here.
 */
export async function notifyParticipantsByEmail(
  meeting: MeetingForNotify,
  subjectPrefix: string
): Promise<void> {
  if (meeting.participants.length === 0) return;

  const location = meeting.onlineMeetingResource?.url ?? meeting.location ?? null;

  const ics = generateIcs({
    uid: meeting.id,
    title: meeting.title,
    description: meeting.description,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    location,
    organizerName: meeting.organizerPerson?.name ?? null,
    organizerEmail: meeting.organizerPerson?.email ?? null,
    attendees: meeting.participants.map((p) => ({ name: p.person.name, email: p.person.email })),
  });

  const text = [
    `${subjectPrefix}: "${meeting.title}"`,
    `เวลา: ${meeting.startTime.toLocaleString("th-TH")} - ${meeting.endTime.toLocaleString("th-TH")}`,
    location ? `สถานที่/ลิงก์: ${location}` : null,
    meeting.description ? `\nรายละเอียด:\n${meeting.description}` : null,
    "\nไฟล์ปฏิทิน (.ics) แนบมาพร้อมนี้ — เปิดเพื่อเพิ่มลงปฏิทินของคุณ",
  ]
    .filter((l) => l !== null)
    .join("\n");

  await Promise.all(
    meeting.participants.map((p) =>
      sendEmail({
        to: p.person.email,
        subject: `${subjectPrefix}: ${meeting.title}`,
        text,
        attachments: [{ filename: "meeting.ics", content: ics, contentType: "text/calendar" }],
      })
    )
  );
}
