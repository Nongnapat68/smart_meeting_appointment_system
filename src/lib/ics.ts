/**
 * FR-08: Calendar Invitation (.ics) — a minimal RFC 5545 iCalendar file
 * builder. No external library: the format is small enough (one VEVENT,
 * fixed set of fields) that a dependency would add more weight than it
 * saves, and every real calendar app (Google/Outlook/Apple) reads this
 * exact shape.
 */

export interface IcsAttendee {
  name: string;
  email: string;
}

export interface IcsMeetingInput {
  /** Meeting id — becomes part of UID, so the same meeting always produces the same UID across downloads (lets a calendar app update rather than duplicate). */
  uid: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  /** Physical room, or an online meeting URL — whichever the meeting actually uses. */
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  attendees: IcsAttendee[];
}

function formatIcsDate(d: Date): string {
  // UTC "basic" format per RFC 5545: YYYYMMDDTHHMMSSZ
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// RFC 5545 §3.3.11: backslash, semicolon, comma and newline must be escaped
// in TEXT values (SUMMARY/DESCRIPTION/LOCATION/CN etc).
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 §3.1: content lines longer than 75 octets must be folded —
// continued on the next line with a single leading space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function generateIcs(input: IcsMeetingInput): string {
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Meeting Enterprise Suite//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@smart-meeting-appointment-system`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(input.startTime)}`,
    `DTEND:${formatIcsDate(input.endTime)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    input.description ? `DESCRIPTION:${escapeIcsText(input.description)}` : null,
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : null,
    input.organizerEmail
      ? `ORGANIZER;CN=${escapeIcsText(input.organizerName ?? input.organizerEmail)}:mailto:${input.organizerEmail}`
      : null,
    ...input.attendees.map(
      (a) => `ATTENDEE;CN=${escapeIcsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`
    ),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return (
    lines
      .filter((l): l is string => l !== null)
      .map(foldLine)
      .join("\r\n") + "\r\n"
  );
}
