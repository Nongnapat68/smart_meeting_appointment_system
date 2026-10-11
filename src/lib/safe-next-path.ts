/**
 * ข้อ 23 — open-redirect guard for the `?next=` login parameter.
 *
 * Only a same-site absolute path is allowed: it must start with "/" and must
 * not start with "//" or "/\" — browsers treat both of those as
 * protocol-relative URLs (i.e. an off-site destination). When a value is
 * percent-encoded, the browser decodes it before navigation, so "%09" can
 * become an ASCII tab that browsers strip, turning "/\t/evil.example" back
 * into the protocol-relative "//evil.example". To close that loop the check
 * runs on BOTH the raw value and its percent-decoded form: any control/delete
 * character (code < 0x20, 0x7F) or backslash anywhere rejects the value, and
 * after decoding it is re-parsed with `new URL` against a throwaway origin to
 * confirm the origin is unchanged. Anything else falls back to the dashboard.
 *
 * This is client-side navigation hardening (the value only ever reaches
 * `router.push`); it is not a server-side security boundary.
 */
const BANNED = /[\u0000-\u001f\u007f\\]/;

function decodeSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function isSafePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (BANNED.test(path)) return false;
  const decoded = decodeSafe(path);
  if (decoded === null) return false;
  if (BANNED.test(decoded)) return false;
  try {
    const url = new URL(decoded, "http://dummy.invalid");
    if (url.origin !== "http://dummy.invalid") return false;
  } catch {
    return false;
  }
  return true;
}

export function safeNextPath(next: string | undefined | null): string {
  if (next && isSafePath(next)) {
    return next;
  }
  return "/dashboard";
}