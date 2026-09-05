const THAI_LOCALE = "th-TH";

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(THAI_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(THAI_LOCALE, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)} • ${formatTime(date)}`;
}

export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

export function dayShortLabel(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(THAI_LOCALE, { weekday: "short" });
}

export function dayNumber(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getDate();
}

export function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
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
  const d = typeof date === "string" ? new Date(date) : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
