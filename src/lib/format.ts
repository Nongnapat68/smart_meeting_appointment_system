const THAI_LOCALE = "th-TH";

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
