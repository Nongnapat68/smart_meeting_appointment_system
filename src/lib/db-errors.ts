// Turns a supabase-js write error into a Thai message a toast can show as-is.
// Raw PostgREST messages ("new row violates row-level security policy for
// table ...") are English and technical; the codes below are what RLS, CHECK
// constraints and a failed fetch actually produce.

type DbError = { code?: string; message: string };

export function dbWriteErrorMessage(error: DbError, action: string, whoMayDoIt: string): string {
  // warn, not error: an RLS denial is an expected outcome, and console.error
  // would light up the Next.js dev "issues" badge as if the app had crashed.
  console.warn(`${action} failed`, error);
  if (error.code === "42501") return `คุณไม่มีสิทธิ์${action} — ${whoMayDoIt}`;
  if (error.code === "23514") return `${action}ไม่สำเร็จ ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ`;
  if (/failed to fetch|network/i.test(error.message)) return `${action}ไม่สำเร็จ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง`;
  return `${action}ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`;
}

/** True for http:// or https:// URLs — same rule as RelatedResource_url_http_check in the DB. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
