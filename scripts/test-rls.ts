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

function nowIso() {
  return new Date().toISOString();
}

/**
 * Trusted-side existence check for one row, read with Prisma (which bypasses
 * RLS on purpose — the assertions are about whether a rejected INSERT left
 * anything behind, not about whether Prisma can see it). Kept as a switch so
 * the test stays fully typed instead of interpolating a table name into raw
 * SQL.
 */
async function countById(table: string, id: string): Promise<number> {
  switch (table) {
    case "ContactGroup":
      return prisma.contactGroup.count({ where: { id } });
    case "Project":
      return prisma.project.count({ where: { id } });
    case "Meeting":
      return prisma.meeting.count({ where: { id } });
    case "OnlineMeetingResource":
      return prisma.onlineMeetingResource.count({ where: { id } });
    case "Person":
      return prisma.person.count({ where: { id } });
    default:
      throw new Error(`countById: unhandled table ${table}`);
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

  const siriPerson = await prisma.person.findFirstOrThrow({ where: { userId: siriporn.id } });

  // A participant of somchai's meeting who is neither its organizer nor the
  // author of the contributions below — proves participants lost the blanket
  // edit/delete rights they had before migration 20261005090000 (ข้อ 13).
  await prisma.meetingParticipant.create({
    data: { meetingId: meeting.id, personId: siriPerson.id, role: "ATTENDEE" },
  });

  const noteBySomchai = await prisma.meetingNote.create({
    data: { meetingId: meeting.id, content: "[test-rls] note by somchai", authorId: somchai.id },
  });
  const noteBySiriporn = await prisma.meetingNote.create({
    data: { meetingId: meeting.id, content: "[test-rls] note by siriporn", authorId: siriporn.id },
  });
  const decisionBySomchai = await prisma.decision.create({
    data: { meetingId: meeting.id, content: "[test-rls] decision by somchai", decidedById: somchai.id },
  });
  const resourceBySomchai = await prisma.relatedResource.create({
    data: {
      meetingId: meeting.id,
      title: "[test-rls] resource by somchai",
      url: "https://example.com/resource",
      addedById: somchai.id,
    },
  });

  // A meeting organized by siriporn with a note authored by her: somchai is
  // ADMIN but is neither organizer nor author there, isolating the admin-only
  // branch of the narrowed policies (ข้อ 13).
  const siriMeeting = await prisma.meeting.create({
    data: {
      title: "[test-rls] siriporn's meeting",
      type: "SINGLE",
      status: "PENDING",
      startTime: new Date(Date.now() + 3600_000),
      endTime: new Date(Date.now() + 7200_000),
      organizerId: siriporn.id,
    },
  });
  const noteInSiriMeeting = await prisma.meetingNote.create({
    data: { meetingId: siriMeeting.id, content: "[test-rls] note in siriporn's meeting", authorId: siriporn.id },
  });

  // Online rooms (ข้อ 12): one owned by somchai, one unclaimed (createdById
  // NULL) — the unclaimed one must now be admin-only instead of first-come.
  const roomBySomchai = await prisma.onlineMeetingResource.create({
    data: { name: "[test-rls] room by somchai", url: "https://meet.example.com/somchai", createdById: somchai.id },
  });
  const roomUnclaimed = await prisma.onlineMeetingResource.create({
    data: { name: "[test-rls] room unclaimed", url: "https://meet.example.com/unclaimed", createdById: null },
  });

  // Task + attachment for the fileUrl WITH CHECK (ข้อ 11). siriporn is the
  // task creator, so the attribution half of the policy passes and only the
  // URL half decides.
  const project = await prisma.project.create({
    data: { name: "[test-rls] attachment project", updatedAt: new Date() },
  });
  const task = await prisma.task.create({
    data: { title: "[test-rls] attachment task", projectId: project.id, createdById: siriporn.id, assigneeId: siriporn.id },
  });
  await prisma.taskAttachment.create({
    data: {
      taskId: task.id,
      fileName: "existing.txt",
      fileUrl: `/uploads/tasks/${task.id}/existing.txt`,
      fileSize: 8,
      mimeType: "text/plain",
    },
  });

  return {
    somchai,
    siriporn,
    meeting,
    notifSomchai,
    notifSiriporn,
    noteBySomchai,
    noteBySiriporn,
    decisionBySomchai,
    resourceBySomchai,
    noteInSiriMeeting,
    roomBySomchai,
    roomUnclaimed,
    task,
  };
}

async function cleanupFixtures(f: Awaited<ReturnType<typeof setupFixtures>>) {
  // Assertion 7 creates real rows through supabase-js; assertion 6's rejected
  // inserts should leave nothing, but delete by the [test-rls] prefix anyway
  // so a policy regression can never leak fixtures into the seeded data.
  // Order matters: Meeting.projectId / Task.projectId are ON DELETE RESTRICT.
  await prisma.notification.deleteMany({ where: { id: { in: [f.notifSomchai.id, f.notifSiriporn.id] } } });
  await prisma.meeting.deleteMany({ where: { title: { startsWith: "[test-rls]" } } });
  await prisma.contactGroupMember.deleteMany({ where: { group: { name: { startsWith: "[test-rls]" } } } });
  await prisma.contactGroup.deleteMany({ where: { name: { startsWith: "[test-rls]" } } });
  await prisma.projectMember.deleteMany({ where: { project: { name: { startsWith: "[test-rls]" } } } });
  await prisma.task.deleteMany({ where: { project: { name: { startsWith: "[test-rls]" } } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: "[test-rls]" } } });
  await prisma.onlineMeetingResource.deleteMany({ where: { name: { startsWith: "[test-rls]" } } });
  await prisma.person.deleteMany({ where: { name: { startsWith: "[test-rls]" } } });
  await prisma.person.deleteMany({ where: { email: { startsWith: "forged-" } } });
  await prisma.person.deleteMany({ where: { email: { startsWith: "own-" } } });
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
    console.log("   raw:", JSON.stringify({ data: meetings, error: meetingsErr }));
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
    console.log(
      "   raw:",
      JSON.stringify({ data: blockedUpdate, error: blockedErr, dbTitleAfter: meetingAfterBlock.title })
    );
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
    console.log("   raw:", JSON.stringify({ data: adminUpdate, error: adminErr }));
    check(
      "3. somchai (admin) editing the same meeting succeeds",
      !adminErr && adminUpdate?.length === 1 && adminUpdate[0].title === newTitle,
      adminErr ? adminErr.message : `got ${JSON.stringify(adminUpdate)}`
    );

    // 4. siriporn can read her own Notification, but reading somchai's by
    // id returns 0 rows (not an error) — RLS filters silently.
    const { data: ownNotif, error: ownNotifErr } = await asSiriporn
      .from("Notification")
      .select("id, userId, title")
      .eq("userId", f.siriporn.id);
    console.log("   raw:", JSON.stringify({ data: ownNotif, error: ownNotifErr }));
    check(
      "4a. siriporn reads her own Notification",
      !ownNotifErr && (ownNotif?.length ?? 0) >= 1,
      ownNotifErr ? ownNotifErr.message : `got ${ownNotif?.length} rows`
    );
    const { data: othersNotif, error: othersNotifErr } = await asSiriporn
      .from("Notification")
      .select("id, userId, title")
      .eq("userId", f.somchai.id);
    console.log("   raw:", JSON.stringify({ data: othersNotif, error: othersNotifErr }));
    check(
      "4b. siriporn reading somchai's Notification gets 0 rows (not an error)",
      !othersNotifErr && (othersNotif?.length ?? -1) === 0,
      othersNotifErr ? othersNotifErr.message : `got ${othersNotif?.length} rows`
    );

    // 5. PasswordResetOtp is deny-all for both roles — 0 rows or an error,
    // never real data, for admin and member alike.
    const { data: otpAsSiriporn, error: otpSiriErr } = await asSiriporn.from("PasswordResetOtp").select("*");
    console.log("   raw:", JSON.stringify({ data: otpAsSiriporn, error: otpSiriErr }));
    check(
      "5a. siriporn reading PasswordResetOtp gets 0 rows or an error",
      !!otpSiriErr || (otpAsSiriporn?.length ?? 0) === 0,
      `error=${otpSiriErr?.message ?? "none"} rows=${otpAsSiriporn?.length}`
    );
    const { data: otpAsSomchai, error: otpAdminErr } = await asSomchai.from("PasswordResetOtp").select("*");
    console.log("   raw:", JSON.stringify({ data: otpAsSomchai, error: otpAdminErr }));
    check(
      "5b. somchai (admin) reading PasswordResetOtp gets 0 rows or an error",
      !!otpAdminErr || (otpAsSomchai?.length ?? 0) === 0,
      `error=${otpAdminErr?.message ?? "none"} rows=${otpAsSomchai?.length}`
    );

    // 6. INSERT may not forge attribution — prisma/migrations/
    // 20261003140000_insert_attribution_owner_only. An INSERT that violates
    // WITH CHECK comes back as an error (42501, unlike the silent 0-row
    // filter an UPDATE gets), and must leave nothing behind. Each case is
    // run as siriporn, a plain MEMBER.
    //
    // Forged cases: every table names somchai in its attribution column.
    const forged: { table: string; row: Record<string, unknown> }[] = [
      {
        table: "ContactGroup",
        row: { id: crypto.randomUUID(), name: "[test-rls] forged group", createdById: f.somchai.id, updatedAt: nowIso() },
      },
      {
        table: "Project",
        row: { id: crypto.randomUUID(), name: "[test-rls] forged project", managerId: f.somchai.id, updatedAt: nowIso() },
      },
      {
        table: "Meeting",
        row: {
          id: crypto.randomUUID(),
          title: "[test-rls] forged meeting",
          type: "SINGLE",
          status: "PENDING",
          startTime: new Date(Date.now() + 3600_000).toISOString(),
          endTime: new Date(Date.now() + 7200_000).toISOString(),
          organizerId: f.somchai.id,
        },
      },
      {
        table: "OnlineMeetingResource",
        row: { id: crypto.randomUUID(), name: "[test-rls] forged room", url: "https://example.com/x", createdById: f.somchai.id, updatedAt: nowIso() },
      },
      {
        table: "Person",
        row: { id: crypto.randomUUID(), name: "[test-rls] forged contact", email: `forged-${Date.now()}@example.com`, type: "EXTERNAL", status: "ACTIVE", userId: f.somchai.id, updatedAt: nowIso() },
      },
    ];

    for (const { table, row } of forged) {
      const { data, error } = await asSiriporn.from(table).insert(row).select("id");
      const rows = await countById(table, (row as { id: string }).id);
      console.log(`   raw [${table} forged]:`, JSON.stringify({ data, error: error?.message ?? null, rowsInTable: rows }));
      check(
        `6. siriporn cannot INSERT ${table} with somebody else's attribution column`,
        !!error && rows === 0,
        error
          ? `insert unexpectedly SUCCEEDED (${rows} rows in table)`
          : `insert returned no error, ${rows} rows in table`
      );
    }

    // 7. The same inserts with the caller's OWN attribution still work — the
    // policies tightened above, they must not have closed the real create
    // paths (groups/page.tsx, projects/page.tsx, MeetingForm.tsx,
    // people/page.tsx all send authData.user.id).
    const own: { table: string; row: Record<string, unknown> }[] = [
      {
        table: "ContactGroup",
        row: { id: crypto.randomUUID(), name: "[test-rls] own group", createdById: f.siriporn.id, updatedAt: nowIso() },
      },
      {
        table: "Project",
        row: { id: crypto.randomUUID(), name: "[test-rls] own project", managerId: f.siriporn.id, updatedAt: nowIso() },
      },
      {
        table: "OnlineMeetingResource",
        row: { id: crypto.randomUUID(), name: "[test-rls] own room", url: "https://example.com/own", createdById: f.siriporn.id, updatedAt: nowIso() },
      },
      {
        // External contact with no login: userId omitted, exactly what the
        // people form sends.
        table: "Person",
        row: { id: crypto.randomUUID(), name: "[test-rls] own external contact", email: `own-${Date.now()}@example.com`, type: "EXTERNAL", status: "ACTIVE", updatedAt: nowIso() },
      },
    ];

    for (const { table, row } of own) {
      const { data, error } = await asSiriporn.from(table).insert(row).select("id");
      console.log(`   raw [${table} own]:`, JSON.stringify({ data, error: error?.message ?? null }));
      check(
        `7. siriporn can still INSERT ${table} as herself`,
        !error && (data?.length ?? 0) === 1,
        error ? error.message : `no error but ${data?.length ?? 0} rows returned`
      );
    }

    // 8. ...and the ownership rights she just earned follow her, while
    // somchai (the forged "creator" from assertion 6) has none of them.
    const ownGroupId = own.find((o) => o.table === "ContactGroup")!.row.id as string;
    const { data: siriEdit, error: siriEditErr } = await asSiriporn
      .from("ContactGroup")
      .update({ name: "[test-rls] own group, renamed by its creator" })
      .eq("id", ownGroupId)
      .select("id");
    check(
      "8a. siriporn can edit the group she created herself",
      !siriEditErr && siriEdit?.length === 1,
      siriEditErr?.message ?? `got ${siriEdit?.length} rows`
    );
    const { data: somchaiEdit, error: somchaiEditErr } = await asSomchai
      .from("ContactGroup")
      .update({ name: "[test-rls] admin edits a group" })
      .eq("id", ownGroupId)
      .select("id");
    check(
      "8b. somchai (admin) can still edit any group",
      !somchaiEditErr && somchaiEdit?.length === 1,
      somchaiEditErr?.message ?? `got ${somchaiEdit?.length} rows`
    );

    // 9. A MEMBER may not promote themselves to ADMIN through their own User
    // row. The "update_self_or_admin" policy permits the write (id =
    // auth.uid()), so this is guarded by the BEFORE UPDATE OF role trigger
    // from 20261002090000_prevent_user_role_self_escalation, which raises
    // 42501 (an error back through PostgREST, unlike the silent 0-row filter
    // a blocked UPDATE gets) and must leave the stored role unchanged.
    const { data: escalated, error: escalateErr } = await asSiriporn
      .from("User")
      .update({ role: "ADMIN" })
      .eq("id", f.siriporn.id)
      .select("id, role");
    const siripornAfter = await prisma.user.findUniqueOrThrow({ where: { id: f.siriporn.id } });
    console.log("   raw:", JSON.stringify({ data: escalated, error: escalateErr, roleAfter: siripornAfter.role }));
    check(
      "9. siriporn (MEMBER) cannot promote herself to ADMIN via User UPDATE",
      !!escalateErr && siripornAfter.role === "MEMBER",
      escalateErr
        ? `UPDATE unexpectedly succeeded; role in DB is now ${siripornAfter.role}`
        : "UPDATE returned no error"
    );

    // 10. ข้อ 13 — a participant who is neither the author nor the organizer
    // may no longer edit/delete a note. A blocked UPDATE/DELETE matches 0 rows
    // *silently* (no error), so .select() + length is the observable.
    const { data: siriEditNote, error: siriEditNoteErr } = await asSiriporn
      .from("MeetingNote")
      .update({ content: "[test-rls] note hijacked by siriporn" })
      .eq("id", f.noteBySomchai.id)
      .select("id");
    const noteAfterHijack = await prisma.meetingNote.findUniqueOrThrow({ where: { id: f.noteBySomchai.id } });
    check(
      "10a. participant siriporn cannot edit another author's note (0 rows)",
      !siriEditNoteErr && (siriEditNote?.length ?? 0) === 0 && noteAfterHijack.content === "[test-rls] note by somchai",
      siriEditNoteErr?.message ?? `rows=${siriEditNote?.length} content="${noteAfterHijack.content}"`
    );

    const { data: siriDelNote, error: siriDelNoteErr } = await asSiriporn
      .from("MeetingNote")
      .delete()
      .eq("id", f.noteBySomchai.id)
      .select("id");
    const noteStillThere = await prisma.meetingNote.count({ where: { id: f.noteBySomchai.id } });
    check(
      "10b. participant siriporn cannot delete another author's note (0 rows, still there)",
      !siriDelNoteErr && (siriDelNote?.length ?? 0) === 0 && noteStillThere === 1,
      siriDelNoteErr?.message ?? `rows=${siriDelNote?.length} remaining=${noteStillThere}`
    );

    const { data: authorEdit, error: authorEditErr } = await asSiriporn
      .from("MeetingNote")
      .update({ content: "[test-rls] note by siriporn (edited by author)" })
      .eq("id", f.noteBySiriporn.id)
      .select("id");
    check(
      "10c. author siriporn can edit her own note (1 row)",
      !authorEditErr && authorEdit?.length === 1,
      authorEditErr?.message ?? `rows=${authorEdit?.length}`
    );

    const { data: orgEdit, error: orgEditErr } = await asSomchai
      .from("MeetingNote")
      .update({ content: "[test-rls] note by siriporn (edited by organizer)" })
      .eq("id", f.noteBySiriporn.id)
      .select("id");
    check(
      "10d. organizer somchai can edit a participant's note (1 row)",
      !orgEditErr && orgEdit?.length === 1,
      orgEditErr?.message ?? `rows=${orgEdit?.length}`
    );

    const { data: adminEdit, error: adminEditErr } = await asSomchai
      .from("MeetingNote")
      .update({ content: "[test-rls] note edited via admin-only branch" })
      .eq("id", f.noteInSiriMeeting.id)
      .select("id");
    check(
      "10e. admin somchai can edit a note in a meeting he does not organize (1 row)",
      !adminEditErr && adminEdit?.length === 1,
      adminEditErr?.message ?? `rows=${adminEdit?.length}`
    );

    // 11. ข้อ 13 for Decision — same rule on decidedById.
    const { data: siriEditDecision, error: siriEditDecisionErr } = await asSiriporn
      .from("Decision")
      .update({ content: "[test-rls] decision hijacked" })
      .eq("id", f.decisionBySomchai.id)
      .select("id");
    check(
      "11a. participant siriporn cannot edit another author's decision (0 rows)",
      !siriEditDecisionErr && (siriEditDecision?.length ?? 0) === 0,
      siriEditDecisionErr?.message ?? `rows=${siriEditDecision?.length}`
    );
    const { data: orgEditDecision, error: orgEditDecisionErr } = await asSomchai
      .from("Decision")
      .update({ content: "[test-rls] decision (edited by organizer)" })
      .eq("id", f.decisionBySomchai.id)
      .select("id");
    check(
      "11b. organizer somchai can edit the decision (1 row)",
      !orgEditDecisionErr && orgEditDecision?.length === 1,
      orgEditDecisionErr?.message ?? `rows=${orgEditDecision?.length}`
    );
    const { data: siriDelDecision, error: siriDelDecisionErr } = await asSiriporn
      .from("Decision")
      .delete()
      .eq("id", f.decisionBySomchai.id)
      .select("id");
    const decisionStillThere = await prisma.decision.count({ where: { id: f.decisionBySomchai.id } });
    check(
      "11c. participant siriporn cannot delete another author's decision (still there)",
      !siriDelDecisionErr && (siriDelDecision?.length ?? 0) === 0 && decisionStillThere === 1,
      siriDelDecisionErr?.message ?? `rows=${siriDelDecision?.length} remaining=${decisionStillThere}`
    );

    // 12. ข้อ 13 for RelatedResource — same rule on addedById.
    const { data: siriEditResource, error: siriEditResourceErr } = await asSiriporn
      .from("RelatedResource")
      .update({ title: "[test-rls] resource hijacked" })
      .eq("id", f.resourceBySomchai.id)
      .select("id");
    check(
      "12a. participant siriporn cannot edit another author's resource (0 rows)",
      !siriEditResourceErr && (siriEditResource?.length ?? 0) === 0,
      siriEditResourceErr?.message ?? `rows=${siriEditResource?.length}`
    );
    const { data: orgEditResource, error: orgEditResourceErr } = await asSomchai
      .from("RelatedResource")
      .update({ title: "[test-rls] resource (edited by organizer)" })
      .eq("id", f.resourceBySomchai.id)
      .select("id");
    check(
      "12b. organizer somchai can edit the resource (1 row)",
      !orgEditResourceErr && orgEditResource?.length === 1,
      orgEditResourceErr?.message ?? `rows=${orgEditResource?.length}`
    );

    // 13. ข้อ 12 — a non-creator may no longer edit an OnlineMeetingResource,
    // and an unclaimed room (createdById NULL) is now admin-only.
    const { data: siriEditRoom, error: siriEditRoomErr } = await asSiriporn
      .from("OnlineMeetingResource")
      .update({ name: "[test-rls] room hijacked" })
      .eq("id", f.roomBySomchai.id)
      .select("id");
    check(
      "13a. siriporn cannot edit a room she did not create (0 rows)",
      !siriEditRoomErr && (siriEditRoom?.length ?? 0) === 0,
      siriEditRoomErr?.message ?? `rows=${siriEditRoom?.length}`
    );
    const { data: siriEditRoomUnclaimed, error: siriEditRoomUnclaimedErr } = await asSiriporn
      .from("OnlineMeetingResource")
      .update({ name: "[test-rls] unclaimed room hijacked" })
      .eq("id", f.roomUnclaimed.id)
      .select("id");
    check(
      "13b. siriporn cannot edit an unclaimed room (admin-only now) (0 rows)",
      !siriEditRoomUnclaimedErr && (siriEditRoomUnclaimed?.length ?? 0) === 0,
      siriEditRoomUnclaimedErr?.message ?? `rows=${siriEditRoomUnclaimed?.length}`
    );
    const { data: creatorEditRoom, error: creatorEditRoomErr } = await asSomchai
      .from("OnlineMeetingResource")
      .update({ name: "[test-rls] room edited by its creator" })
      .eq("id", f.roomBySomchai.id)
      .select("id");
    check(
      "13c. creator somchai can edit his own room (1 row)",
      !creatorEditRoomErr && creatorEditRoom?.length === 1,
      creatorEditRoomErr?.message ?? `rows=${creatorEditRoom?.length}`
    );

    // 14. ข้อ 11 — TaskAttachment INSERT must point fileUrl at the task's own
    // upload prefix; a foreign URL is rejected by WITH CHECK (a real error,
    // unlike the silent 0-row filter of a blocked UPDATE).
    const badAttachment = await asSiriporn
      .from("TaskAttachment")
      .insert({
        id: crypto.randomUUID(),
        taskId: f.task.id,
        fileName: "evil.txt",
        fileUrl: "https://evil.example/evil.txt",
        fileSize: 4,
        mimeType: "text/plain",
      })
      .select("id");
    const evilRows = badAttachment.error
      ? 0
      : await prisma.taskAttachment.count({ where: { taskId: f.task.id, fileName: "evil.txt" } });
    check(
      "14a. siriporn cannot insert a TaskAttachment with an off-site fileUrl",
      !!badAttachment.error && evilRows === 0,
      badAttachment.error ? `insert unexpectedly succeeded (${evilRows} rows)` : "insert returned no error"
    );
    const goodAttachment = await asSiriporn
      .from("TaskAttachment")
      .insert({
        id: crypto.randomUUID(),
        taskId: f.task.id,
        fileName: "valid.txt",
        fileUrl: `/uploads/tasks/${f.task.id}/valid.txt`,
        fileSize: 5,
        mimeType: "text/plain",
      })
      .select("id");
    check(
      "14b. siriporn can insert a TaskAttachment with the correct upload prefix",
      !goodAttachment.error && goodAttachment.data?.length === 1,
      goodAttachment.error?.message ?? `rows=${goodAttachment.data?.length}`
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
