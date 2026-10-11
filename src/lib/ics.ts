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
  /** A cancelled meeting is exported with STATUS:CANCELLED so a calendar app shows it as cancelled. */
  cancelled?: boolean;
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

// RFC 5545 §3.2: a parameter value containing ":", ";" or "," must be
// quoted (backslash escapes are for TEXT values only); DQUOTE can't appear in it.
function quoteParam(value: string): string {
  return `"${value.replace(/"/g, "'").replace(/\r?\n/g, " ")}"`;
}

// RFC 5545 §3.1: content lines longer than 75 octets must be folded —
// continued on the next line with a single leading space. Counted in UTF-8
// octets, not characters: a Thai character is 3 octets, so a 75-character
// Thai title used to produce a 225-octet line. Never splits a character.
const encoder = new TextEncoder();
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // continuation lines carry one leading space, so they hold 74 octets
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : " " + p)).join("\r\n");
}

export function generateIcs(input: IcsMeetingInput): string {
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Meeting & Appointment System//TH",
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
      ? `ORGANIZER;CN=${quoteParam(input.organizerName ?? input.organizerEmail)}:mailto:${input.organizerEmail}`
      : null,
    ...input.attendees.map(
      (a) => `ATTENDEE;CN=${quoteParam(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`
    ),
    input.cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
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
