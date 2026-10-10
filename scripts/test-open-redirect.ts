/**
 * Test: the `?next=` open-redirect guard on the login page (ข้อ 23).
 *
 * Pure function tests for src/lib/safe-next-path.ts — no database or server
 * needed. A same-site absolute path is kept; anything that could navigate
 * off-site (absolute URLs, protocol-relative "//", the "/\" variant browsers
 * normalise to "//") falls back to /dashboard.
 *
 * Run with:
 *   npx tsx scripts/test-open-redirect.ts
 *
 * Exits 0 if every assertion passes, 1 otherwise.
 */
import { safeNextPath } from "@/lib/safe-next-path";

let failures = 0;
let passed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const allowed = ["/dashboard", "/meetings/42", "/meetings/42?tab=notes", "/groups/a/b", "/", "/?x=1"];
for (const value of allowed) {
  const got = safeNextPath(value);
  check(`keeps same-site path ${JSON.stringify(value)}`, got === value, `got ${JSON.stringify(got)}`);
}

const blocked = [
  undefined,
  null,
  "",
  "next",
  "//evil.example",
  "//evil.example/path",
  "/\\evil.example",
  "/\\/evil.example",
  "https://evil.example",
  "http://evil.example/x",
  "javascript:alert(1)",
  "///evil.example",
];
for (const value of blocked) {
  const got = safeNextPath(value as string | undefined | null);
  check(`rejects off-site/relative ${JSON.stringify(value)} -> /dashboard`, got === "/dashboard", `got ${JSON.stringify(got)}`);
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
