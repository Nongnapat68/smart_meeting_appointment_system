/**
 * Integration test: proves the RLS policies from
 * prisma/migrations/20260911120000_enable_rls_policies actually work when
 * queried the way a real client would — via supabase-js/PostgREST, signed
 * in as a real user. This is deliberately NOT Prisma: Prisma always
 * connects as the "postgres" role, which has BYPASSRLS on Supabase, so it
 * would never see RLS block anything. Prisma is used here only to set up
 * and tear down fixture rows (as the trusted, RLS-bypassing writer a
 * server-side script legitimately is), never to make the assertions.
 *
 * Signs in with two real seeded accounts:
 *   - somchai@smartmeeting.dev  (role ADMIN)
 *   - siriporn@smartmeeting.dev (role MEMBER)
 * both with password "Passw0rd!" (see prisma/seed.ts DEMO_PASSWORD).
 *
 * Run with:
 *   npx tsx scripts/test-rls.ts
 *
 * Exits 0 if every assertion passes, 1 otherwise (with a printed report).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PASSWORD = "Passw0rd!";

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

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function setupFixtures() {
  const somchai = await prisma.user.findUniqueOrThrow({ where: { email: "somchai@smartmeeting.dev" } });
  const siriporn = await prisma.user.findUniqueOrThrow({ where: { email: "siriporn@smartmeeting.dev" } });
  if (somchai.role !== "ADMIN") throw new Error("Fixture assumption broken: somchai is not ADMIN");
  if (siriporn.role !== "MEMBER") throw new Error("Fixture assumption broken: siriporn is not MEMBER");

  // Organized by somchai, NOT siriporn — the target for the cross-user
  // update tests (#2 must block siriporn, #3 must allow somchai).
  const meeting = await prisma.meeting.create({
    data: {
      title: "[test-rls] somchai's meeting",
      type: "SINGLE",
      status: "PENDING",
      startTime: new Date(Date.now() + 3600_000),
      endTime: new Date(Date.now() + 7200_000),
      organizerId: somchai.id,
    },
  });

  const notifSomchai = await prisma.notification.create({
    data: { userId: somchai.id, type: "REMINDER", title: "[test-rls] somchai's notification" },
  });
  const notifSiriporn = await prisma.notification.create({
    data: { userId: siriporn.id, type: "REMINDER", title: "[test-rls] siriporn's notification" },
  });

  return { somchai, siriporn, meeting, notifSomchai, notifSiriporn };
}

async function cleanupFixtures(f: Awaited<ReturnType<typeof setupFixtures>>) {
  await prisma.notification.deleteMany({ where: { id: { in: [f.notifSomchai.id, f.notifSiriporn.id] } } });
  await prisma.meeting.deleteMany({ where: { id: f.meeting.id } });
}

async function main() {
  console.log("Signing in as somchai (ADMIN) and siriporn (MEMBER)...");
  const [asSomchai, asSiriporn] = await Promise.all([
    signIn("somchai@smartmeeting.dev"),
    signIn("siriporn@smartmeeting.dev"),
  ]);

  console.log("Seeding RLS test fixtures via Prisma (bypasses RLS, as any trusted server write does)...\n");
  const f = await setupFixtures();

  try {
    // 1. siriporn can read all meetings (org-wide read), including one she
    // didn't organize.
    const { data: meetings, error: meetingsErr } = await asSiriporn
      .from("Meeting")
      .select("id")
      .eq("id", f.meeting.id);
    check(
      "1. siriporn reads Meeting org-wide (sees somchai's meeting)",
      !meetingsErr && (meetings?.length ?? 0) === 1,
      meetingsErr ? meetingsErr.message : `got ${meetings?.length} rows`
    );

    // 2. siriporn is not the organizer of f.meeting -> RLS must silently
    // filter the row out of the UPDATE (0 rows affected, no error), not
    // fail some other way.
    const { data: blockedUpdate, error: blockedErr } = await asSiriporn
      .from("Meeting")
      .update({ title: "[test-rls] HIJACKED by siriporn" })
      .eq("id", f.meeting.id)
      .select("id");
    const meetingAfterBlock = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meeting.id } });
    check(
      "2. siriporn editing somchai's meeting is blocked by RLS (0 rows, no error)",
      !blockedErr && (blockedUpdate?.length ?? 0) === 0 && meetingAfterBlock.title === f.meeting.title,
      blockedErr ? blockedErr.message : `returned ${blockedUpdate?.length} rows, title now "${meetingAfterBlock.title}"`
    );

    // 3. somchai is ADMIN -> can edit the same meeting despite not being a
    // participant either (admin bypass).
    const newTitle = "[test-rls] edited by admin somchai";
    const { data: adminUpdate, error: adminErr } = await asSomchai
      .from("Meeting")
      .update({ title: newTitle })
      .eq("id", f.meeting.id)
      .select("id, title");
    check(
      "3. somchai (admin) editing the same meeting succeeds",
      !adminErr && adminUpdate?.length === 1 && adminUpdate[0].title === newTitle,
      adminErr ? adminErr.message : `got ${JSON.stringify(adminUpdate)}`
    );

    // 4. siriporn can read her own Notification, but reading somchai's by
    // id returns 0 rows (not an error) — RLS filters silently.
    const { data: ownNotif, error: ownNotifErr } = await asSiriporn
      .from("Notification")
      .select("id")
      .eq("id", f.notifSiriporn.id);
    check(
      "4a. siriporn reads her own Notification",
      !ownNotifErr && ownNotif?.length === 1,
      ownNotifErr ? ownNotifErr.message : `got ${ownNotif?.length} rows`
    );
    const { data: othersNotif, error: othersNotifErr } = await asSiriporn
      .from("Notification")
      .select("id")
      .eq("id", f.notifSomchai.id);
    check(
      "4b. siriporn reading somchai's Notification gets 0 rows (not an error)",
      !othersNotifErr && (othersNotif?.length ?? -1) === 0,
      othersNotifErr ? othersNotifErr.message : `got ${othersNotif?.length} rows`
    );

    // 5. PasswordResetOtp is deny-all for both roles — 0 rows or an error,
    // never real data, for admin and member alike.
    const { data: otpAsSiriporn, error: otpSiriErr } = await asSiriporn.from("PasswordResetOtp").select("*");
    check(
      "5a. siriporn reading PasswordResetOtp gets 0 rows or an error",
      !!otpSiriErr || (otpAsSiriporn?.length ?? 0) === 0,
      `error=${otpSiriErr?.message ?? "none"} rows=${otpAsSiriporn?.length}`
    );
    const { data: otpAsSomchai, error: otpAdminErr } = await asSomchai.from("PasswordResetOtp").select("*");
    check(
      "5b. somchai (admin) reading PasswordResetOtp gets 0 rows or an error",
      !!otpAdminErr || (otpAsSomchai?.length ?? 0) === 0,
      `error=${otpAdminErr?.message ?? "none"} rows=${otpAsSomchai?.length}`
    );
  } finally {
    console.log("\nCleaning up test fixtures...");
    await cleanupFixtures(f);
    await asSomchai.auth.signOut();
    await asSiriporn.auth.signOut();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
