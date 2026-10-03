const THAI_LOCALE = "th-TH";
const THAI_TIMEZONE = "Asia/Bangkok";

// Every timestamp column is Prisma's TIMESTAMP(3) (no time zone) holding a UTC
// wall-clock value. Prisma hands those back as real UTC Dates, but PostgREST
// (supabase-js) serializes them as e.g. "2026-09-18T13:15:00" with no offset,
// which `new Date()` would read as *local* time — 7 hours off in Bangkok.
// So a date-time string with no Z/±hh:mm is treated as UTC here; strings that
// already carry an offset (API JSON, toISOString()) and Date objects pass
// through untouched. Only for values read from the DB — not for the local
// "YYYY-MM-DDTHH:mm" strings a datetime input produces.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseDbTimestamp(value: Date | string): Date {
  if (typeof value !== "string") return value;
  return new Date(NAIVE_DATETIME.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

/**
 * Task.dueDate is a *date*, not an instant, but it's stored in the same
 * TIMESTAMP (no time zone) column as everything else, so the app writes
 * midnight UTC for it (`dueDate: "2026-10-05"` -> `2026-10-05T00:00:00`).
 *
 * Comparing that value against `now()` directly makes a task due on the 5th
 * look overdue from 07:00 on the 5th (midnight UTC + 7h) instead of at the end
 * of the 5th. So overdue-ness is decided by *calendar date*, read in
 * Asia/Bangkok on both sides: the stored value's own UTC date is the intended
 * due date, and the current date comes from Bangkok local time.
 *
 * Returns false for a null/empty due date (no deadline, never overdue).
 */
export function isPastDue(dueDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const due = parseDbTimestamp(dueDate);
  if (Number.isNaN(due.getTime())) return false;

  // Left: the due date as written (UTC calendar date).
  const dueDay = due.toISOString().slice(0, 10);
  // Right: today in Bangkok, so a task due today stays not-overdue until
  // Bangkok's calendar day actually rolls over.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: THAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return dueDay < today;
}

/**
 * BR: a meeting is "past" once its endTime is behind us - used instead of a
 * bare timestamp comparison so the same timezone rule applies as above.
 */
export function isPast(endTime: Date | string, now: Date = new Date()): boolean {
  return parseDbTimestamp(endTime).getTime() < now.getTime();
}

export function formatDate(date: Date | string): string {
  const d = parseDbTimestamp(date);
  return d.toLocaleDateString(THAI_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(date: Date | string): string {
  const d = parseDbTimestamp(date);
  return d.toLocaleTimeString(THAI_LOCALE, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)} • ${formatTime(date)}`;
}

export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

export function dayShortLabel(date: Date | string): string {
  const d = parseDbTimestamp(date);
  return d.toLocaleDateString(THAI_LOCALE, { weekday: "short" });
}

export function dayNumber(date: Date | string): number {
  const d = parseDbTimestamp(date);
  return d.getDate();
}

export function relativeTime(date: Date | string): string {
  const d = parseDbTimestamp(date);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชั่วโมงที่แล้ว`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "เมื่อวาน";
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;
  return formatDate(d);
}

export function toDatetimeLocalValue(date: Date | string): string {
  const d = parseDbTimestamp(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
