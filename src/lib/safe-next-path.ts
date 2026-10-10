/**
 * ข้อ 23 — open-redirect guard for the `?next=` login parameter.
 *
 * Only a same-site absolute path is allowed: it must start with "/" and must
 * not start with "//" or "/\" — browsers treat both of those as
 * protocol-relative URLs (i.e. an off-site destination), so passing them
 * through would let `?next=//evil.example` bounce a freshly-logged-in user to
 * an attacker-controlled site. Anything else falls back to the dashboard.
 *
 * This is client-side navigation hardening (the value only ever reaches
 * `router.push`); it is not a server-side security boundary.
 */
export function safeNextPath(next: string | undefined | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    return next;
  }
  return "/dashboard";
}
