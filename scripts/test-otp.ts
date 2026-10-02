/**
 * Test: password-reset OTP hardening (src/lib/otp.ts, generateOtp in
 * src/lib/email.ts, and the forgot-password / verify-otp / reset-password
 * route handlers).
 *
 * Covers:
 *   1. generateOtp() uses a CSPRNG (not Math.random), always 6 digits, and
 *      its output is statistically uniform / non-repeating.
 *   2. Request rate limit: at most OTP_MAX_REQUESTS_PER_WINDOW codes per user
 *      per OTP_REQUEST_WINDOW_MS — including under a burst of parallel calls —
 *      while the response stays identical (no account enumeration).
 *   3. Wrong-guess limit: after OTP_MAX_FAILED_ATTEMPTS wrong guesses the code
 *      is dead (even the correct code is rejected) across both verify-otp and
 *      reset-password, also under parallel guessing.
 *   4. A normal user who types the right code (even after a few typos) can
 *      still verify and reset their password.
 *   5. Daily cap: at most OTP_MAX_REQUESTS_PER_DAY codes per user per
 *      OTP_DAILY_WINDOW_MS, on top of the short window.
 *   6. The forgot-password page shows a neutral "wait before requesting
 *      again" hint that doesn't depend on the server's answer.
 *
 * The route handlers are called directly (real Prisma queries, real SQL) but
 * against a THROWAWAY database only — it creates and deletes User rows, which
 * on the real Supabase DB are tied to auth.users. So it refuses to run unless
 * OTP_TEST_DATABASE_URL is given and points at localhost, e.g.:
 *
 *   OTP_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/otptest npm run test:otp
 *
 * That database must already have the schema in prisma/schema.prisma
 * (including the 20261002130000_password_reset_otp_attempt_limits migration).
 * The Supabase Admin API call in reset-password is answered by a stubbed
 * fetch — no request leaves the machine. Exits 0 if every assertion passes.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

const TEST_DB = process.env.OTP_TEST_DATABASE_URL;
if (!TEST_DB || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(TEST_DB)) {
  console.error("Refusing to run: set OTP_TEST_DATABASE_URL to a local throwaway Postgres (localhost / 127.0.0.1).");
  process.exit(1);
}
// Must be set before Prisma / the route modules are imported (they're loaded
// dynamically below). Existing keys win over .env, so these also stop the
// real SMTP/Supabase values in .env from being picked up.
process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;
process.env.SMTP_HOST = ""; // dev-log transport → OTP text lands in console.log
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test.invalid";
process.env.SUPABASE_SECRET_KEY = "test-secret";

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

// --- capture outgoing OTP emails from the dev-log transport -----------------
const sentOtps: { to: string; otp: string }[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  const otp = text.match(/รหัสยืนยันของคุณคือ: (\d{6})/)?.[1];
  const to = text.match(/To:\s+(\S+)/)?.[1];
  if (otp && to) {
    sentOtps.push({ to, otp });
    return; // keep the report readable
  }
  realLog(...args);
};
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).startsWith("[forgot-password] OTP request limit")) return;
  realWarn(...args);
};

// --- stub the Supabase Admin API (password update in reset-password) --------
const realFetch = globalThis.fetch;
let supabasePasswordUpdates = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://supabase.test.invalid/auth/v1/admin/users/")) {
    supabasePasswordUpdates++;
    const id = url.split("/").pop();
    return new Response(JSON.stringify({ id, aud: "authenticated", email: "x@test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { generateOtp } = await import("@/lib/email");
  const otpLib = await import("@/lib/otp");
  const forgot = await import("@/app/api/auth/forgot-password/route");
  const verify = await import("@/app/api/auth/verify-otp/route");
  const reset = await import("@/app/api/auth/reset-password/route");
  const {
    OTP_MAX_FAILED_ATTEMPTS,
    OTP_MAX_REQUESTS_PER_WINDOW,
    OTP_REQUEST_WINDOW_MS,
    OTP_MAX_REQUESTS_PER_DAY,
    OTP_DAILY_WINDOW_MS,
    OTP_INVALID_MESSAGE,
  } = otpLib;

  const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
    handler(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const requestOtp = (email: string) => post(forgot.POST, { email });
  const verifyOtp = (email: string, otp: string) => post(verify.POST, { email, otp });
  const resetPassword = (email: string, otp: string) =>
    post(reset.POST, { email, otp, password: "NewPassw0rd", confirmPassword: "NewPassw0rd" });
  const lastOtpFor = (email: string) => [...sentOtps].reverse().find((s) => s.to === email)?.otp;
  const emailsTo = (email: string) => sentOtps.filter((s) => s.to === email).length;
  const wrongOf = (otp: string) => String((Number(otp) + 1) % 1_000_000).padStart(6, "0");

  const createdUserIds: string[] = [];
  async function makeUser(tag: string) {
    const id = randomUUID();
    const email = `otp-${tag}-${id.slice(0, 8)}@test.local`;
    await prisma.user.create({ data: { id, email, name: `OTP test ${tag}` } });
    createdUserIds.push(id);
    return { id, email };
  }
  // Inserts already-issued codes with a given age, to simulate earlier requests.
  const seedCodes = (userId: string, ages: number[]) =>
    prisma.passwordResetOtp.createMany({
      data: ages.map((ageMs) => ({
        userId,
        otpHash: "seeded",
        createdAt: new Date(Date.now() - ageMs),
        expiresAt: new Date(Date.now() - ageMs + 10 * 60_000),
      })),
    });
  const HOUR = 60 * 60_000;
  const latestRecord = (userId: string) =>
    prisma.passwordResetOtp.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

  try {
    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[1] OTP generation (crypto.randomInt)");
    check("generateOtp source no longer references Math.random", !generateOtp.toString().includes("Math.random"));

    const realRandom = Math.random;
    Math.random = () => 0.5; // the old implementation would now return "550000" every time
    const underStub = new Set(Array.from({ length: 50 }, () => generateOtp()));
    Math.random = () => {
      throw new Error("Math.random called");
    };
    let threw = false;
    try {
      generateOtp();
    } catch {
      threw = true;
    }
    Math.random = realRandom;
    check("output is unaffected by Math.random (stubbed constant → still varies)", underStub.size > 45, `distinct=${underStub.size}/50`);
    check("generateOtp never calls Math.random", !threw);

    const N = 200_000;
    const samples = Array.from({ length: N }, () => generateOtp());
    check("every code is exactly 6 digits", samples.every((s) => /^\d{6}$/.test(s)));
    const nums = samples.map(Number);
    check("full range used (leading-zero codes appear)", samples.some((s) => s.startsWith("0")));
    const lo = nums.reduce((m, n) => Math.min(m, n), Infinity);
    const hi = nums.reduce((m, n) => Math.max(m, n), -Infinity);
    check("min/max span the range", lo < 1000 && hi > 999_000, `min=${lo} max=${hi}`);

    // Birthday bound: expected duplicates ≈ N²/(2·10⁶) ≈ 20,000 for N=200k.
    const distinct = new Set(samples).size;
    const expectedDistinct = 1_000_000 * (1 - Math.exp(-N / 1_000_000));
    check(
      "number of distinct codes matches a uniform 10⁶ space (±1%)",
      Math.abs(distinct - expectedDistinct) / expectedDistinct < 0.01,
      `distinct=${distinct} expected≈${Math.round(expectedDistinct)}`
    );
    let consecutiveRepeats = 0;
    for (let i = 1; i < N; i++) if (samples[i] === samples[i - 1]) consecutiveRepeats++;
    check("no back-to-back repeats beyond chance (expected ≈0.2)", consecutiveRepeats <= 3, `repeats=${consecutiveRepeats}`);

    // Chi-square per digit position, df=9: p=0.001 critical value is 27.88.
    for (let pos = 0; pos < 6; pos++) {
      const counts = new Array(10).fill(0);
      for (const s of samples) counts[Number(s[pos])]++;
      const exp = N / 10;
      const chi2 = counts.reduce((acc, c) => acc + (c - exp) ** 2 / exp, 0);
      check(`digit position ${pos + 1} is uniform (χ²=${chi2.toFixed(1)} < 27.88)`, chi2 < 27.88);
    }
    // Serial correlation between consecutive codes should be ~0 (|r| < 0.01 at N=200k).
    const mean = nums.reduce((a, b) => a + b, 0) / N;
    let numr = 0;
    let den = 0;
    for (let i = 0; i < N; i++) {
      den += (nums[i] - mean) ** 2;
      if (i > 0) numr += (nums[i] - mean) * (nums[i - 1] - mean);
    }
    const r = numr / den;
    check(`no serial correlation between consecutive codes (r=${r.toFixed(4)})`, Math.abs(r) < 0.01);

    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n[2] Request rate limit (${OTP_MAX_REQUESTS_PER_WINDOW} per ${OTP_REQUEST_WINDOW_MS / 60000} min per user)`);
    const a = await makeUser("ratelimit");
    const responses: { status: number; body: string }[] = [];
    for (let i = 0; i < OTP_MAX_REQUESTS_PER_WINDOW + 2; i++) {
      const res = await requestOtp(a.email);
      responses.push({ status: res.status, body: await res.text() });
    }
    check(`first ${OTP_MAX_REQUESTS_PER_WINDOW} requests each send an email`, emailsTo(a.email) === OTP_MAX_REQUESTS_PER_WINDOW, `emails=${emailsTo(a.email)}`);
    check(
      `requests #${OTP_MAX_REQUESTS_PER_WINDOW + 1} and #${OTP_MAX_REQUESTS_PER_WINDOW + 2} are blocked (no new code row)`,
      (await prisma.passwordResetOtp.count({ where: { userId: a.id } })) === OTP_MAX_REQUESTS_PER_WINDOW
    );
    check(
      "blocked requests still get the identical 200 {ok:true} response",
      responses.every((r) => r.status === 200 && r.body === '{"ok":true}'),
      JSON.stringify(responses)
    );
    const ghost = await requestOtp(`nobody-${randomUUID()}@test.local`);
    check("unknown email gets the same 200 {ok:true} (no enumeration)", ghost.status === 200 && (await ghost.text()) === '{"ok":true}');

    const b = await makeUser("other");
    await requestOtp(b.email);
    check("another user is not affected by user A's limit", emailsTo(b.email) === 1);

    // Slide the window: age A's codes past the window → allowed again.
    await prisma.passwordResetOtp.updateMany({
      where: { userId: a.id },
      data: { createdAt: new Date(Date.now() - OTP_REQUEST_WINDOW_MS - 60_000) },
    });
    const before = emailsTo(a.email);
    await requestOtp(a.email);
    check("once the window has passed, a new request is allowed again", emailsTo(a.email) === before + 1);

    const burst = await makeUser("burst");
    const burstRes = await Promise.all(Array.from({ length: 15 }, () => requestOtp(burst.email)));
    const burstRows = await prisma.passwordResetOtp.count({ where: { userId: burst.id } });
    check(
      `15 parallel requests still issue exactly ${OTP_MAX_REQUESTS_PER_WINDOW} codes (advisory lock)`,
      burstRows === OTP_MAX_REQUESTS_PER_WINDOW && emailsTo(burst.email) === OTP_MAX_REQUESTS_PER_WINDOW,
      `rows=${burstRows} emails=${emailsTo(burst.email)}`
    );
    check("…and all 15 got 200", burstRes.every((r) => r.status === 200));

    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n[2b] Daily cap (${OTP_MAX_REQUESTS_PER_DAY} per ${OTP_DAILY_WINDOW_MS / HOUR} h per user)`);
    // 9 earlier requests spread over the last 9 hours: none inside the
    // 15-minute window, so only the daily cap can block.
    const d1 = await makeUser("daily");
    await seedCodes(d1.id, Array.from({ length: OTP_MAX_REQUESTS_PER_DAY - 1 }, (_, i) => (i + 1) * HOUR));
    const d1First = await requestOtp(d1.email);
    check(`request #${OTP_MAX_REQUESTS_PER_DAY} of the day is allowed (email sent)`, emailsTo(d1.email) === 1 && d1First.status === 200);
    const d1Second = await requestOtp(d1.email);
    const d1SecondBody = await d1Second.text();
    check(
      `request #${OTP_MAX_REQUESTS_PER_DAY + 1} is blocked by the daily cap even though the 15-min window has room`,
      emailsTo(d1.email) === 1 &&
        (await prisma.passwordResetOtp.count({ where: { userId: d1.id } })) === OTP_MAX_REQUESTS_PER_DAY
    );
    check("daily-capped request still gets the identical 200 {ok:true}", d1Second.status === 200 && d1SecondBody === '{"ok":true}');
    await prisma.passwordResetOtp.updateMany({
      where: { userId: d1.id, createdAt: { lt: new Date(Date.now() - 8.5 * HOUR) } },
      data: { createdAt: new Date(Date.now() - OTP_DAILY_WINDOW_MS - 60_000) },
    });
    await requestOtp(d1.email);
    check("once the oldest request ages past 24 h, one more request is allowed", emailsTo(d1.email) === 2);
    await requestOtp(d1.email);
    check("…and the cap applies again right after", emailsTo(d1.email) === 2);

    const d2 = await makeUser("daily-old");
    await seedCodes(d2.id, Array.from({ length: 20 }, (_, i) => OTP_DAILY_WINDOW_MS + (i + 1) * HOUR));
    await requestOtp(d2.email);
    check("requests older than 24 h don't count toward the daily cap", emailsTo(d2.email) === 1);

    const d3 = await makeUser("daily-burst");
    await seedCodes(d3.id, Array.from({ length: OTP_MAX_REQUESTS_PER_DAY - 2 }, (_, i) => (i + 1) * HOUR));
    await Promise.all(Array.from({ length: 10 }, () => requestOtp(d3.email)));
    check(
      `10 parallel requests with ${OTP_MAX_REQUESTS_PER_DAY - 2} already today issue exactly 2 (daily cap beats the 3-per-15-min allowance)`,
      emailsTo(d3.email) === 2 &&
        (await prisma.passwordResetOtp.count({ where: { userId: d3.id } })) === OTP_MAX_REQUESTS_PER_DAY,
      `emails=${emailsTo(d3.email)}`
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n[3] Wrong-guess limit (${OTP_MAX_FAILED_ATTEMPTS} per issued code)`);
    const c = await makeUser("lockout");
    await requestOtp(c.email);
    const cOtp = lastOtpFor(c.email)!;
    let allWrong400 = true;
    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i++) {
      const res = await verifyOtp(c.email, wrongOf(cOtp));
      const body = await res.json();
      if (res.status !== 400 || body.error !== OTP_INVALID_MESSAGE) allWrong400 = false;
    }
    check(`${OTP_MAX_FAILED_ATTEMPTS} wrong guesses each get 400 with the generic message`, allWrong400);
    check(`attempts column = ${OTP_MAX_FAILED_ATTEMPTS}`, (await latestRecord(c.id))?.attempts === OTP_MAX_FAILED_ATTEMPTS);
    const lockedVerify = await verifyOtp(c.email, cOtp);
    check("the CORRECT code is now rejected by verify-otp (400)", lockedVerify.status === 400);
    const lockedBody = await lockedVerify.json();
    check("locked-out response is the same generic message (no oracle)", lockedBody.error === OTP_INVALID_MESSAGE);
    const lockedReset = await resetPassword(c.email, cOtp);
    check("the correct code is also rejected by reset-password (400)", lockedReset.status === 400);
    check("attempts stay capped (no counting past the limit)", (await latestRecord(c.id))?.attempts === OTP_MAX_FAILED_ATTEMPTS);

    await requestOtp(c.email);
    const cOtp2 = lastOtpFor(c.email)!;
    check("after requesting a new code, the new code verifies (200)", (await verifyOtp(c.email, cOtp2)).status === 200);

    // Guesses on both endpoints share one budget.
    const d = await makeUser("mixed");
    await requestOtp(d.email);
    const dOtp = lastOtpFor(d.email)!;
    for (let i = 0; i < 3; i++) await verifyOtp(d.email, wrongOf(dOtp));
    for (let i = 0; i < 2; i++) await resetPassword(d.email, wrongOf(dOtp));
    check("3 wrong on verify-otp + 2 wrong on reset-password → locked", (await verifyOtp(d.email, dOtp)).status === 400);
    check("no password update was attempted for a locked code", supabasePasswordUpdates === 0);

    // Parallel guessing can't exceed the budget.
    const e = await makeUser("parallel");
    await requestOtp(e.email);
    const eOtp = lastOtpFor(e.email)!;
    const parallel = await Promise.all(Array.from({ length: 30 }, () => verifyOtp(e.email, wrongOf(eOtp))));
    check("30 parallel wrong guesses all rejected", parallel.every((r) => r.status === 400));
    check(
      `…and only ${OTP_MAX_FAILED_ATTEMPTS} were counted (atomic claim)`,
      (await latestRecord(e.id))?.attempts === OTP_MAX_FAILED_ATTEMPTS,
      `attempts=${(await latestRecord(e.id))?.attempts}`
    );
    check("…so the correct code is rejected afterwards", (await verifyOtp(e.email, eOtp)).status === 400);

    // A locked newest code must not fall back to an older, still-valid one.
    const f = await makeUser("fallback");
    await requestOtp(f.email);
    const fOld = lastOtpFor(f.email)!;
    await requestOtp(f.email);
    const fNew = lastOtpFor(f.email)!;
    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i++) await verifyOtp(f.email, wrongOf(fNew));
    check(
      "older unexpired code does not work once the newest is locked",
      fOld === fNew || (await verifyOtp(f.email, fOld)).status === 400
    );

    // Expired code.
    const g = await makeUser("expired");
    await requestOtp(g.email);
    const gOtp = lastOtpFor(g.email)!;
    await prisma.passwordResetOtp.updateMany({ where: { userId: g.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    check("expired code is rejected even when correct", (await verifyOtp(g.email, gOtp)).status === 400);
    check("checking an expired code does not consume an attempt", (await latestRecord(g.id))?.attempts === 0);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[4] Normal users are not affected");
    const h = await makeUser("happy");
    await requestOtp(h.email);
    const hOtp = lastOtpFor(h.email)!;
    check("correct code on first try → verify-otp 200", (await verifyOtp(h.email, hOtp)).status === 200);
    check("a successful verify leaves attempts at 0", (await latestRecord(h.id))?.attempts === 0);
    const hReset = await resetPassword(h.email, hOtp);
    check("reset-password with the same code → 200", hReset.status === 200, `status=${hReset.status} ${await hReset.clone().text()}`);
    check("password update was sent to Supabase Admin API", supabasePasswordUpdates === 1);
    check("code is marked used", (await latestRecord(h.id))?.usedAt !== null);
    check("a used code cannot be replayed", (await resetPassword(h.email, hOtp)).status === 400);

    const t = await makeUser("typos");
    await requestOtp(t.email);
    const tOtp = lastOtpFor(t.email)!;
    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS - 1; i++) await verifyOtp(t.email, wrongOf(tOtp));
    check(`${OTP_MAX_FAILED_ATTEMPTS - 1} typos then the correct code → verify-otp 200`, (await verifyOtp(t.email, tOtp)).status === 200);
    check(
      `attempts = ${OTP_MAX_FAILED_ATTEMPTS - 1} (only wrong guesses count)`,
      (await latestRecord(t.id))?.attempts === OTP_MAX_FAILED_ATTEMPTS - 1
    );
    check("…and reset-password with that code still succeeds (200)", (await resetPassword(t.email, tOtp)).status === 200);

    const u = await makeUser("resend");
    await requestOtp(u.email);
    await requestOtp(u.email); // user pressed "resend" once
    const uOtp = lastOtpFor(u.email)!;
    check("after one resend, the newest code works", (await verifyOtp(u.email, uOtp)).status === 200);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[5] Forgot-password page: neutral resend hint");
    const page = readFileSync("src/app/forgot-password/page.tsx", "utf8");
    const HINT = "หากไม่ได้รับอีเมล กรุณารอสักครู่ก่อนขอรหัสใหม่";
    check("hint text is present", page.includes(HINT));
    const beforeHint = page.slice(Math.max(0, page.indexOf(HINT) - 200), page.indexOf(HINT));
    check("hint is shown only from the second request on (requestCount > 1)", /\{requestCount > 1 && \(/.test(beforeHint));
    const bumps =
      page.match(/await api\.post\("\/api\/auth\/forgot-password", \{ email \}\);\s*setRequestCount\(\(n\) => n \+ 1\);/g) ?? [];
    check("both the first request and 'resend' count, after the call resolves", bumps.length === 2, `found=${bumps.length}`);
    check(
      "the page never reads the forgot-password response body (nothing to leak)",
      !/=\s*await api\.post\("\/api\/auth\/forgot-password"/.test(page)
    );
    check("hint mentions neither the account nor the limit (no enumeration)", !/ไม่พบ|ไม่มีบัญชี|เกิน|limit/i.test(HINT));
    // The hint can only be neutral because the server's answer is: over the
    // short limit, over the daily cap, and unknown email all look the same.
    const answers = await Promise.all([
      requestOtp(d1.email), // daily-capped
      requestOtp(h.email), // ordinary user well under both limits
      requestOtp(`nobody-${randomUUID()}@test.local`),
    ]);
    const texts = await Promise.all(answers.map((x) => x.text()));
    check(
      "capped, normal and unknown-email requests return byte-identical 200 bodies",
      answers.every((x) => x.status === 200) && texts.every((t) => t === '{"ok":true}'),
      JSON.stringify(texts)
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); // cascades to PasswordResetOtp
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
