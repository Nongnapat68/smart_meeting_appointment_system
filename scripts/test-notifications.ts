/**
 * Test: in-app notifications written by the database triggers of
 * prisma/migrations/20261012090000_in_app_notifications_for_all_events.
 *
 * Covers: the migration's objects and its rollback (applied and undone inside
 * one transaction that is then rolled back); recipients for every event
 * (invite, add/remove participant, reschedule, edit of title/location/online
 * link, cancel, due reminder in every status, task assign/reassign/status,
 * task comment, meeting note/decision); the actor is never notified (JWT for
 * supabase-js/RPC calls, smartmeeting.actor_id for server routes); external
 * contacts and accounts with in-app notifications off get nothing; repeats,
 * retries and two processors running at once create one row per event and
 * account; a notification that cannot be written never fails the action
 * that caused it; RLS still keeps Notification INSERT admin-only; the
 * previous app version's own TASK_ASSIGNED / REMINDER rows are not doubled;
 * and when the reminder auto-processor starts.
 *
 * Browser calls are simulated the way PostgREST runs them: inside a
 * transaction with SET LOCAL ROLE authenticated and request.jwt.claims, so
 * RLS and auth.uid() behave as for the signed-in user.
 *
 * THROWAWAY database only - it creates users, meetings and tasks. Refuses to
 * run unless NOTIFICATION_TEST_DATABASE_URL points at localhost, e.g.:
 *
 *   NOTIFICATION_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/fx4 npm run test:notifications
 *
 * That database needs every migration in prisma/migrations applied (on plain
 * Postgres: stand-ins for Supabase's auth schema, auth.uid() - reading
 * request.jwt.claims like Supabase does - and the anon/authenticated roles)
 * and timezone UTC like Supabase. Exits 0 if every assertion passes.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import type { Prisma as PrismaTypes } from "@prisma/client";

type Tx = PrismaTypes.TransactionClient;

const TEST_DB = process.env.NOTIFICATION_TEST_DATABASE_URL;
if (!TEST_DB || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(TEST_DB)) {
  console.error("Refusing to run: set NOTIFICATION_TEST_DATABASE_URL to a local throwaway Postgres (localhost / 127.0.0.1).");
  process.exit(1);
}
process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;
process.env.SMTP_HOST = "";

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

// sendEmail has no transport and only logs; swallow those lines. An email to
// "@explode.test" makes the log call throw, to drive the FAILED path.
const realLog = console.log;
console.log = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  const to = text.match(/To:\s+(\S+)/)?.[1] ?? text.match(/^\[email\] would send to (\S+):/)?.[1];
  if (to) {
    if (to.endsWith("@explode.test")) throw new Error("simulated transport crash");
    return;
  }
  realLog(...args);
};
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0]).startsWith("process-due reminder failed")) return;
  realError(...args);
};

const MIGRATION = "prisma/migrations/20261012090000_in_app_notifications_for_all_events/migration.sql";
const ROLLBACK = "prisma/rollbacks/20261012090000_in_app_notifications_for_all_events.down.sql";

/** Splits a SQL file into statements: top-level ';' outside quotes, dollar quotes and comments. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      cur += "\n";
    } else if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      cur += sql.slice(i, end + dollar[0].length);
      i = end + dollar[0].length;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (sql[i] === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
    } else {
      cur += sql[i++];
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { processDueReminders } = await import("@/lib/reminders");
  const { withNotificationActor } = await import("@/lib/notification-actor");
  const { createReminderAutoTick } = await import("@/lib/reminder-auto-processor");
  const { reminderAutoProcessDecision } = await import("@/lib/reminder-auto-config");

  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const personIds: string[] = [];
  const meetingIds: string[] = [];
  const taskIds: string[] = [];
  const groupIds: string[] = [];
  const resourceIds: string[] = [];
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const ts = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  async function makeUser(name: string, opts: { role?: "ADMIN" | "MEMBER"; inApp?: boolean } = {}) {
    const id = randomUUID();
    const email = `ntf-${name}-${tag}@test.local`;
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`;
    await prisma.user.create({ data: { id, email, name: `ntf-${name}`, role: opts.role ?? "MEMBER", inAppNotifications: opts.inApp ?? true } });
    const person = await prisma.person.create({ data: { name: `ntf-${name}`, email, userId: id, type: "INTERNAL" } });
    userIds.push(id);
    personIds.push(person.id);
    return { id, personId: person.id, email };
  }
  async function makeExternal(name: string) {
    const person = await prisma.person.create({ data: { name, email: `ntf-${name}-${tag}@outside.test` } });
    personIds.push(person.id);
    return person;
  }
  /** Runs fn the way PostgREST runs a signed-in request: role authenticated + JWT claims, one transaction. */
  function asUser<T>(uid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
        await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
        return fn(tx);
      },
      { timeout: 30_000 }
    );
  }
  const rows = (where: { userId?: string; relatedId?: string; type?: string }) =>
    prisma.notification.findMany({ where: where as never, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const count = async (where: { userId?: string; relatedId?: string; type?: string }) => (await rows(where)).length;
  async function createMeetingRpc(org: string, title: string, o: { start?: number; persons?: string[]; groups?: string[]; emails?: string[]; offsets?: number[]; location?: string | null } = {}) {
    const start = o.start ?? 3 * HOUR;
    const r = await asUser(org, (tx) => tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public.create_meeting_with_participants(
        ${org}::uuid, ${title}, ${ts(start)}::timestamp, ${ts(start + HOUR)}::timestamp, NULL, 'SINGLE', 'PENDING',
        ${o.location ?? null}, NULL, NULL, ${o.persons ?? []}::text[], ${o.groups ?? []}::text[], ${o.emails ?? []}::text[], ${o.offsets ?? [30]}::int[])`);
    meetingIds.push(r[0].id);
    return r[0].id;
  }
  function updateMeetingRpc(actor: string, id: string, f: { title: string; start: string; end: string; location: string | null; resource: string | null; persons: string[]; groups: string[]; emails: string[] }) {
    return asUser(actor, (tx) => tx.$queryRaw`
      SELECT id FROM public.update_meeting_with_participants(
        ${id}, ${f.title}, ${f.start}::timestamp, ${f.end}::timestamp, NULL, 'SINGLE', 'PENDING', ${f.location}, NULL,
        ${f.resource}, ${f.persons}::text[], ${f.groups}::text[], ${f.emails}::text[])`);
  }

  try {
    const org = await makeUser("org");
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const off = await makeUser("off", { inApp: false });
    const admin = await makeUser("admin", { role: "ADMIN" });

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[1] Migration objects");
    const enumVals = await prisma.$queryRaw<{ v: string }[]>`SELECT enumlabel v FROM pg_enum WHERE enumtypid = 'public."NotificationType"'::regtype`;
    check("NotificationType has the 4 new values", ["MEETING_REMOVED", "MEETING_NOTE", "TASK_UPDATED", "TASK_COMMENT"].every((v) => enumVals.some((x) => x.v === v)));
    const trig = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_notify_%' OR tgname = 'trg_merge_legacy_notification'`;
    check("9 notification triggers exist", trig[0].n === 9, String(trig[0].n));
    const secdef = await prisma.$queryRaw<{ n: number; bad: number }[]>`
      SELECT count(*)::int n, count(*) FILTER (WHERE NOT (coalesce(p.proconfig, '{}') @> ARRAY['search_path=""'])) ::int bad
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname = 'private' AND (p.proname LIKE 'notify%' OR p.proname = 'merge_legacy_notification')`;
    check("trigger functions + notify() are pinned to search_path ''", secdef[0].n === 9 && secdef[0].bad === 0, JSON.stringify(secdef[0]));
    const insPol = await prisma.$queryRaw<{ q: string }[]>`SELECT with_check q FROM pg_policies WHERE tablename = 'Notification' AND cmd = 'INSERT'`;
    check("Notification INSERT policy is still admin-only (only one, is_admin())", insPol.length === 1 && insPol[0].q.includes("is_admin"), JSON.stringify(insPol));
    const body = await prisma.$queryRaw<{ s: string }[]>`SELECT prosrc s FROM pg_proc WHERE proname = 'create_meeting_with_participants'`;
    check("create_meeting_with_participants() no longer inserts Notification itself", !/INSERT INTO public\."Notification"/.test(body[0].s));

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[2] Invite on create (RPC) — accounts only, not the organizer, no duplicate");
    const m1 = await createMeetingRpc(org.id, `ntf-meeting-1 ${tag}`, {
      persons: [org.personId, a.personId, b.personId, off.personId],
      emails: [`guest-${tag}@outside.test`],
      location: "ห้อง 101",
    });
    const guest = await prisma.person.findUniqueOrThrow({ where: { email: `guest-${tag}@outside.test` } });
    personIds.push(guest.id);
    const invA = await rows({ userId: a.id, relatedId: m1, type: "MEETING_INVITE" });
    check("participant a gets exactly one MEETING_INVITE", invA.length === 1, String(invA.length));
    check("…title/body: Thai text, meeting title, Bangkok time, location", invA[0]?.title === "คำเชิญเข้าร่วมประชุมใหม่" && !!invA[0]?.body?.includes(`ntf-meeting-1 ${tag}`) && /\d+ \S+\. 25\d\d • \d\d:\d\d/.test(invA[0]?.body ?? "") && !!invA[0]?.body?.includes("ห้อง 101"), invA[0]?.body ?? "");
    check("…unread, linked to the meeting, with a dedupe key", invA[0]?.isRead === false && invA[0]?.relatedId === m1 && !!invA[0]?.dedupeKey?.startsWith("meeting_invite:"));
    check("participant b gets one too", (await count({ userId: b.id, relatedId: m1, type: "MEETING_INVITE" })) === 1);
    check("organizer (the actor, also listed as a participant) gets none", (await count({ userId: org.id, relatedId: m1 })) === 0);
    check("account with in-app notifications off gets none", (await count({ userId: off.id, relatedId: m1 })) === 0);
    check("all notifications for the meeting = exactly the 2 invites (external contact has no row)", (await count({ relatedId: m1 })) === 2);
    const m1Start = (await prisma.meeting.findUniqueOrThrow({ where: { id: m1 } })).startTime;
    const bkk = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(m1Start);
    const { formatDateTime } = await import("@/lib/format");
    check("time is Asia/Bangkok and reads exactly like the app's formatDateTime()", !!invA[0]?.body?.includes(formatDateTime(m1Start)) && formatDateTime(m1Start).endsWith(bkk), `${invA[0]?.body} vs ${formatDateTime(m1Start)}`);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[3] Reschedule (reschedule_meeting RPC → stored procedure)");
    const before = await prisma.meeting.findUniqueOrThrow({ where: { id: m1 } });
    await asUser(org.id, (tx) => tx.$queryRaw`SELECT id FROM public.reschedule_meeting(${m1}, ${ts(5 * HOUR)}::timestamp, ${ts(6 * HOUR)}::timestamp)`);
    const resA = await rows({ userId: a.id, relatedId: m1, type: "MEETING_UPDATED" });
    const oldText = await prisma.$queryRaw<{ s: string }[]>`SELECT private.notification_range_text(${before.startTime}::timestamp, ${before.endTime}::timestamp) s`;
    check("a gets one 'เลื่อนการประชุม'", resA.length === 1 && resA[0].title === "เลื่อนการประชุม", JSON.stringify(resA.map((r) => r.title)));
    check("…body shows old time → new time", !!resA[0]?.body?.includes(oldText[0].s) && !!resA[0]?.body?.includes("→"), resA[0]?.body ?? "");
    check("b gets one, organizer (actor) none", (await count({ userId: b.id, relatedId: m1, type: "MEETING_UPDATED" })) === 1 && (await count({ userId: org.id, relatedId: m1 })) === 0);
    const remCountBefore = await count({ relatedId: m1, type: "REMINDER" });
    await asUser(org.id, (tx) => tx.$queryRaw`SELECT id FROM public.reschedule_meeting(${m1}, ${ts(10 * MIN)}::timestamp, ${ts(70 * MIN)}::timestamp)`);
    const shifted = await prisma.reminder.findMany({ where: { meetingId: m1 } });
    check("moving it so its 30-min reminder lands in the past cancels that reminder…", shifted.length === 1 && shifted[0].status === "CANCELLED", JSON.stringify(shifted.map((r) => r.status)));
    check("…without a REMINDER notification (the reschedule notice covers it)", (await count({ relatedId: m1, type: "REMINDER" })) === remCountBefore);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[4] Edit (update_meeting_with_participants RPC): location, online link, add/remove people");
    const zoom = await prisma.onlineMeetingResource.create({ data: { name: `ntf-zoom-${tag}`, url: "https://zoom.us/j/1", createdById: org.id } });
    resourceIds.push(zoom.id);
    const cur = await prisma.meeting.findUniqueOrThrow({ where: { id: m1 } });
    const startS = cur.startTime.toISOString();
    const endS = cur.endTime.toISOString();
    await updateMeetingRpc(org.id, m1, { title: cur.title, start: startS, end: endS, location: "ห้อง 202", resource: zoom.id, persons: [org.personId, a.personId, c.personId, off.personId], groups: [], emails: [`guest-${tag}@outside.test`] });
    const edA = (await rows({ userId: a.id, relatedId: m1, type: "MEETING_UPDATED" })).at(-1);
    check("a gets 'แก้ไขรายละเอียดการประชุม'", edA?.title === "แก้ไขรายละเอียดการประชุม", edA?.title);
    check("…listing location old → new and the online link", !!edA?.body?.includes("สถานที่ ห้อง 101 → ห้อง 202") && !!edA?.body?.includes(`ลิงก์ประชุมออนไลน์ ไม่มี → ntf-zoom-${tag}`), edA?.body ?? "");
    check("added participant c gets MEETING_INVITE", (await count({ userId: c.id, relatedId: m1, type: "MEETING_INVITE" })) === 1);
    const remB = await rows({ userId: b.id, relatedId: m1, type: "MEETING_REMOVED" });
    check("removed participant b gets MEETING_REMOVED", remB.length === 1 && remB[0].title === "คุณถูกนำออกจากการประชุม");
    check("a (still invited) gets no second invite", (await count({ userId: a.id, relatedId: m1, type: "MEETING_INVITE" })) === 1);
    check("organizer still gets nothing", (await count({ userId: org.id, relatedId: m1 })) === 0);
    const total1 = await count({ relatedId: m1 });
    await updateMeetingRpc(org.id, m1, { title: cur.title, start: startS, end: endS, location: "ห้อง 202", resource: zoom.id, persons: [org.personId, a.personId, c.personId, off.personId], groups: [], emails: [`guest-${tag}@outside.test`] });
    check("saving the same values again adds nothing (no change = no event)", (await count({ relatedId: m1 })) === total1);
    await updateMeetingRpc(org.id, m1, { title: `${cur.title} (แก้)`, start: startS, end: endS, location: "ห้อง 202", resource: zoom.id, persons: [org.personId, a.personId, c.personId, off.personId], groups: [], emails: [] });
    const ttl = (await rows({ userId: a.id, relatedId: m1, type: "MEETING_UPDATED" })).at(-1);
    check("title change → 'ชื่อ \"old\" → \"new\"'", !!ttl?.body?.includes(`ชื่อ "${cur.title}" → "${cur.title} (แก้)"`), ttl?.body ?? "");

    // Group re-label: d stays invited but now through another group → no removal / re-invite
    const d = await makeUser("d");
    const g1 = await prisma.contactGroup.create({ data: { name: `ntf-g1-${tag}`, createdById: org.id } });
    const g2 = await prisma.contactGroup.create({ data: { name: `ntf-g2-${tag}`, createdById: org.id } });
    groupIds.push(g1.id, g2.id);
    await prisma.contactGroupMember.createMany({ data: [{ groupId: g1.id, personId: d.personId }, { groupId: g2.id, personId: d.personId }] });
    const m2 = await createMeetingRpc(org.id, `ntf-meeting-2 ${tag}`, { groups: [g1.id] });
    check("group member d is invited once at creation", (await count({ userId: d.id, relatedId: m2, type: "MEETING_INVITE" })) === 1);
    const m2row = await prisma.meeting.findUniqueOrThrow({ where: { id: m2 } });
    await updateMeetingRpc(org.id, m2, { title: m2row.title, start: m2row.startTime.toISOString(), end: m2row.endTime.toISOString(), location: null, resource: null, persons: [], groups: [g2.id], emails: [] });
    const relabel = await prisma.meetingParticipant.findFirst({ where: { meetingId: m2, personId: d.personId } });
    check("switching the group re-creates d's row (source group g2)…", relabel?.sourceGroupId === g2.id);
    check("…but d gets no MEETING_REMOVED and no second invite", (await count({ userId: d.id, relatedId: m2, type: "MEETING_REMOVED" })) === 0 && (await count({ userId: d.id, relatedId: m2, type: "MEETING_INVITE" })) === 1);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[5] Cancel (browser UPDATE through RLS) + BR-14 cascade");
    const m3 = await createMeetingRpc(org.id, `ntf-meeting-3 ${tag}`, { persons: [a.personId, c.personId], offsets: [30, 60] });
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET status = 'CANCELLED' WHERE id = ${m3}`);
    const canA = await rows({ userId: a.id, relatedId: m3, type: "MEETING_CANCELLED" });
    check("a gets one 'การประชุมถูกยกเลิก' with the original time", canA.length === 1 && canA[0].title === "การประชุมถูกยกเลิก" && !!canA[0].body?.includes("เดิมกำหนด"));
    check("c gets one, organizer (actor) none", (await count({ userId: c.id, relatedId: m3, type: "MEETING_CANCELLED" })) === 1 && (await count({ userId: org.id, relatedId: m3 })) === 0);
    const r3 = await prisma.reminder.findMany({ where: { meetingId: m3 } });
    check("BR-14 trigger still cancels the PENDING reminders…", r3.length === 2 && r3.every((r) => r.status === "CANCELLED"));
    check("…and that adds no REMINDER notification", (await count({ relatedId: m3, type: "REMINDER" })) === 0);
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET status = 'CANCELLED' WHERE id = ${m3}`);
    check("cancelling again (no status change) adds nothing", (await count({ relatedId: m3 })) === 4, String(await count({ relatedId: m3 })));
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET location = 'ย้ายห้อง' WHERE id = ${m3}`);
    check("editing a cancelled meeting notifies nobody", (await count({ relatedId: m3 })) === 4);
    const m4 = await createMeetingRpc(org.id, `ntf-meeting-4 ${tag}`, { persons: [a.personId] });
    await asUser(admin.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET status = 'CANCELLED' WHERE id = ${m4}`);
    check("admin cancels someone else's meeting → the organizer is told too", (await count({ userId: org.id, relatedId: m4, type: "MEETING_CANCELLED" })) === 1 && (await count({ userId: admin.id, relatedId: m4 })) === 0);
    const past = await prisma.meeting.create({ data: { title: `ntf-past ${tag}`, startTime: new Date(Date.now() - 3 * HOUR), endTime: new Date(Date.now() - 2 * HOUR), organizerId: org.id } });
    meetingIds.push(past.id);
    await prisma.meetingParticipant.create({ data: { meetingId: past.id, personId: a.personId } });
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET status = 'CANCELLED' WHERE id = ${past.id}`);
    check("adding someone to / cancelling a meeting that already ended notifies nobody", (await count({ relatedId: past.id })) === 0);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[6] Due reminders — every status leaving PENDING notifies organizer + every participant account");
    async function reminderMeeting(name: string, startMs: number, endMs: number, extra: string[] = []) {
      const m = await prisma.meeting.create({ data: { title: `ntf-${name} ${tag}`, startTime: new Date(Date.now() + startMs), endTime: new Date(Date.now() + endMs), organizerId: org.id } });
      meetingIds.push(m.id);
      for (const p of [org.personId, a.personId, off.personId, ...extra]) await prisma.meetingParticipant.create({ data: { meetingId: m.id, personId: p } });
      return m;
    }
    const due = (meetingId: string, msFromNow = -MIN) => prisma.reminder.create({ data: { meetingId, scheduledAt: new Date(Date.now() + msFromNow), status: "PENDING" } });
    const ext = await makeExternal("rem-guest");

    const mS = await reminderMeeting("rem-simulated", 2 * HOUR, 3 * HOUR, [ext.id]);
    const rS = await due(mS.id);
    await processDueReminders();
    check("processor → SIMULATED", (await prisma.reminder.findUniqueOrThrow({ where: { id: rS.id } })).status === "SIMULATED");
    const remA = await rows({ userId: a.id, relatedId: mS.id, type: "REMINDER" });
    check("participant a: one 'แจ้งเตือนการประชุม' naming the meeting and its time", remA.length === 1 && remA[0].title === "แจ้งเตือนการประชุม" && !!remA[0].body?.includes(mS.title) && !!remA[0].body?.includes("จะเริ่มเวลา"));
    check("organizer gets one too (here the organizer IS a recipient)", (await count({ userId: org.id, relatedId: mS.id, type: "REMINDER" })) === 1);
    check("in-app off: none; external contact: no row at all", (await count({ userId: off.id, relatedId: mS.id })) === 0 && (await count({ relatedId: mS.id, type: "REMINDER" })) === 2);

    const mF = await reminderMeeting("rem-failed", 2 * HOUR, 3 * HOUR);
    const exploding = await prisma.person.create({ data: { name: "boom", email: `boom-${tag}@explode.test` } });
    personIds.push(exploding.id);
    await prisma.meetingParticipant.create({ data: { meetingId: mF.id, personId: exploding.id } });
    const rF = await due(mF.id);
    await processDueReminders();
    const fA = await rows({ userId: a.id, relatedId: mF.id, type: "REMINDER" });
    check("email throws → FAILED, a and organizer still notified, text says the email failed", (await prisma.reminder.findUniqueOrThrow({ where: { id: rF.id } })).status === "FAILED" && fA.length === 1 && !!fA[0].body?.includes("ส่งอีเมลแจ้งเตือนไม่สำเร็จ") && (await count({ userId: org.id, relatedId: mF.id, type: "REMINDER" })) === 1);

    const mSent = await reminderMeeting("rem-sent", 2 * HOUR, 3 * HOUR);
    const rSent = await due(mSent.id);
    await prisma.reminder.update({ where: { id: rSent.id }, data: { status: "SENT", sentAt: new Date() } }); // what a real SMTP delivery records
    check("SENT → organizer + a notified once each", (await count({ userId: a.id, relatedId: mSent.id, type: "REMINDER" })) === 1 && (await count({ userId: org.id, relatedId: mSent.id, type: "REMINDER" })) === 1);

    const mLate = await reminderMeeting("rem-started", -10 * MIN, 50 * MIN);
    const rLate = await due(mLate.id, -40 * MIN);
    await processDueReminders();
    const lateA = await rows({ userId: a.id, relatedId: mLate.id, type: "REMINDER" });
    check("meeting already in progress: sweep → CANCELLED, a told 'การประชุมเริ่มแล้ว'", (await prisma.reminder.findUniqueOrThrow({ where: { id: rLate.id } })).status === "CANCELLED" && lateA.length === 1 && lateA[0].title === "การประชุมเริ่มแล้ว", JSON.stringify(lateA.map((r) => r.title)));
    check("…organizer too", (await count({ userId: org.id, relatedId: mLate.id, type: "REMINDER" })) === 1);

    const mManual = await reminderMeeting("rem-manual", 2 * HOUR, 3 * HOUR);
    const rManual = await due(mManual.id);
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Reminder" SET status = 'CANCELLED' WHERE id = ${rManual.id}`);
    check("organizer cancels a due reminder (/reminders, RLS) → a told 'ยกเลิกการแจ้งเตือนการประชุม', organizer (actor) not", (await rows({ userId: a.id, relatedId: mManual.id, type: "REMINDER" }))[0]?.title === "ยกเลิกการแจ้งเตือนการประชุม" && (await count({ userId: org.id, relatedId: mManual.id })) === 0);

    const mEnded = await reminderMeeting("rem-ended", -2 * HOUR, -HOUR);
    await due(mEnded.id, -3 * HOUR);
    await processDueReminders();
    check("meeting already over: swept to CANCELLED without any notification", (await count({ relatedId: mEnded.id, type: "REMINDER" })) === 0);

    const mFuture = await reminderMeeting("rem-notdue", 5 * HOUR, 6 * HOUR);
    const rFuture = await due(mFuture.id, 2 * HOUR);
    await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Reminder" SET status = 'CANCELLED' WHERE id = ${rFuture.id}`);
    check("cancelling a reminder that is not due yet notifies nobody", (await count({ relatedId: mFuture.id, type: "REMINDER" })) === 0);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[7] Two processors at once (button + auto tick + a second server)");
    const mC = await reminderMeeting("rem-concurrent", 2 * HOUR, 3 * HOUR, [b.personId]);
    const dueC = await Promise.all([due(mC.id), due(mC.id, -2 * MIN), due(mC.id, -3 * MIN)]);
    const { PrismaClient } = await import("@prisma/client");
    const server2 = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    // "server 2" claims the same rows with the exact claim + update the app uses
    const server2Run = async () => {
      for (const r of dueC) {
        await server2.$transaction(async (tx) => {
          const got = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public."Reminder" WHERE id = ${r.id} AND status = 'PENDING' FOR UPDATE SKIP LOCKED`;
          if (got.length) await tx.reminder.update({ where: { id: r.id }, data: { status: "SIMULATED" } });
        });
      }
    };
    await Promise.all([processDueReminders(), createReminderAutoTick()(), server2Run(), processDueReminders()]);
    await server2.$disconnect();
    const perUser = async (uid: string) => count({ userId: uid, relatedId: mC.id, type: "REMINDER" });
    check("3 due reminders all left PENDING exactly once", (await prisma.reminder.count({ where: { id: { in: dueC.map((r) => r.id) }, status: "PENDING" } })) === 0);
    check("each account got exactly one row per reminder (3 each, not 6-12)", (await perUser(a.id)) === 3 && (await perUser(b.id)) === 3 && (await perUser(org.id)) === 3, `${await perUser(a.id)}/${await perUser(b.id)}/${await perUser(org.id)}`);
    const keys = await prisma.notification.groupBy({ by: ["userId", "dedupeKey"], where: { relatedId: mC.id }, _count: true });
    check("no (account, reminder) pair appears twice", keys.every((k) => k._count === 1));
    // Two transactions writing the same key at the same moment
    const raceKey = `race:${tag}`;
    await Promise.all([0, 1].map(() =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT private.notify(${a.id}::uuid, 'REMINDER', 'race', 'race', ${mC.id}, ${raceKey})`;
        await tx.$executeRaw`SELECT pg_sleep(0.3)`;
      })
    ));
    check("same event written by two concurrent transactions → one row", (await prisma.notification.count({ where: { userId: a.id, dedupeKey: raceKey } })) === 1);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[8] Tasks: assign, reassign, status, comment");
    const mT = await createMeetingRpc(c.id, `ntf-task-meeting ${tag}`, { persons: [a.personId] }); // organizer c
    const t1 = await withNotificationActor(org.id, (tx) => tx.task.create({ data: { title: `ntf-task-1 ${tag}`, createdById: org.id, assigneePersonId: a.personId, assigneeId: a.id, meetingId: mT, dueDate: new Date("2026-12-31T00:00:00Z") } }));
    taskIds.push(t1.id);
    const asg = await rows({ userId: a.id, relatedId: t1.id });
    check("server route (actor = creator) → assignee a gets one TASK_ASSIGNED, creator none", asg.length === 1 && asg[0].type === "TASK_ASSIGNED" && asg[0].title === "คุณได้รับมอบหมายงานใหม่" && (await count({ userId: org.id, relatedId: t1.id })) === 0);
    check("…body names the task and the due date (Thai, Buddhist year)", !!asg[0]?.body?.includes(`ntf-task-1 ${tag}`) && !!asg[0]?.body?.includes("31 ธ.ค. 2569"), asg[0]?.body ?? "");
    const t2id = randomUUID();
    await asUser(org.id, (tx) => tx.$executeRaw`INSERT INTO public."Task" (id, title, "createdById", "assigneeId", "assigneePersonId", "updatedAt") VALUES (${t2id}, ${`ntf-task-2 ${tag}`}, ${org.id}::uuid, ${b.id}::uuid, ${b.personId}, now())`);
    taskIds.push(t2id);
    check("task inserted straight from the browser (RLS) → assignee b notified once", (await count({ userId: b.id, relatedId: t2id, type: "TASK_ASSIGNED" })) === 1);
    const t3 = await withNotificationActor(org.id, (tx) => tx.task.create({ data: { title: `ntf-task-self ${tag}`, createdById: org.id, assigneeId: org.id, assigneePersonId: org.personId } }));
    taskIds.push(t3.id);
    check("assigning a task to yourself notifies nobody", (await count({ relatedId: t3.id })) === 0);

    await asUser(a.id, (tx) => tx.$executeRaw`UPDATE public."Task" SET status = 'IN_PROGRESS', "updatedAt" = now() WHERE id = ${t1.id}`);
    const st = await rows({ userId: org.id, relatedId: t1.id, type: "TASK_UPDATED" });
    check("assignee a changes status (browser) → creator gets 'สถานะงานเปลี่ยน' old → new, by a", st.length === 1 && st[0].title === "สถานะงานเปลี่ยน" && !!st[0].body?.includes("ยังไม่เริ่ม → กำลังดำเนินการ") && !!st[0].body?.includes("ntf-a"), st[0]?.body ?? "");
    check("…the linked meeting's organizer c too; a (actor) gets none", (await count({ userId: c.id, relatedId: t1.id, type: "TASK_UPDATED" })) === 1 && (await count({ userId: a.id, relatedId: t1.id, type: "TASK_UPDATED" })) === 0);
    await asUser(a.id, (tx) => tx.$executeRaw`UPDATE public."Task" SET status = 'IN_PROGRESS', "updatedAt" = now() WHERE id = ${t1.id}`);
    check("same status again → nothing new", (await count({ userId: org.id, relatedId: t1.id, type: "TASK_UPDATED" })) === 1);

    await withNotificationActor(org.id, (tx) => tx.task.update({ where: { id: t1.id }, data: { assigneeId: b.id, assigneePersonId: b.personId } }));
    check("reassign a → b (server route): b gets TASK_ASSIGNED", (await count({ userId: b.id, relatedId: t1.id, type: "TASK_ASSIGNED" })) === 1);
    const unas = await rows({ userId: a.id, relatedId: t1.id, type: "TASK_UPDATED" });
    check("…a gets 'งานถูกมอบหมายให้ผู้อื่นแล้ว'; organizer of the change none", unas.length === 1 && unas[0].title === "งานถูกมอบหมายให้ผู้อื่นแล้ว" && (await count({ userId: org.id, relatedId: t1.id, type: "TASK_ASSIGNED" })) === 0);

    await asUser(b.id, (tx) => tx.$executeRaw`INSERT INTO public."TaskComment" (id, "taskId", "authorId", content) VALUES (${randomUUID()}, ${t1.id}, ${b.id}::uuid, 'อัปเดตความคืบหน้าแล้ว')`);
    const cm = await rows({ userId: org.id, relatedId: t1.id, type: "TASK_COMMENT" });
    check("assignee b comments (browser) → creator gets 'ความคิดเห็นใหม่ในงาน' with author + text", cm.length === 1 && cm[0].title === "ความคิดเห็นใหม่ในงาน" && !!cm[0].body?.includes("ntf-b") && !!cm[0].body?.includes("อัปเดตความคืบหน้าแล้ว"));
    check("…author b gets none", (await count({ userId: b.id, relatedId: t1.id, type: "TASK_COMMENT" })) === 0);
    await asUser(org.id, (tx) => tx.$executeRaw`INSERT INTO public."TaskComment" (id, "taskId", "authorId", content) VALUES (${randomUUID()}, ${t1.id}, ${org.id}::uuid, ${"x".repeat(120)})`);
    const cmB = await rows({ userId: b.id, relatedId: t1.id, type: "TASK_COMMENT" });
    check("creator comments → assignee b notified; long text cut to 80 chars + …", cmB.length === 1 && cmB[0].body!.includes("x".repeat(80) + "…") && !cmB[0].body!.includes("x".repeat(81)));

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[9] Meeting notes and decisions");
    await asUser(a.id, (tx) => tx.$executeRaw`INSERT INTO public."MeetingNote" (id, "meetingId", content, "authorId", "updatedAt") VALUES (${randomUUID()}, ${m1}, 'สรุปประเด็นที่ 1', ${a.id}::uuid, now())`);
    const nOrg = await rows({ userId: org.id, relatedId: m1, type: "MEETING_NOTE" });
    check("participant a adds a note → organizer gets 'บันทึกการประชุมใหม่' with the text", nOrg.length === 1 && nOrg[0].title === "บันทึกการประชุมใหม่" && !!nOrg[0].body?.includes("สรุปประเด็นที่ 1"));
    check("…other participant c too; author a and in-app-off none", (await count({ userId: c.id, relatedId: m1, type: "MEETING_NOTE" })) === 1 && (await count({ userId: a.id, relatedId: m1, type: "MEETING_NOTE" })) === 0 && (await count({ userId: off.id, relatedId: m1 })) === 0);
    await asUser(org.id, (tx) => tx.$executeRaw`INSERT INTO public."Decision" (id, "meetingId", content, "decidedById") VALUES (${randomUUID()}, ${m1}, 'อนุมัติงบ', ${org.id}::uuid)`);
    check("organizer records a decision → a and c get 'มติที่ประชุมใหม่', organizer none", (await rows({ userId: a.id, relatedId: m1, type: "MEETING_NOTE" }))[0]?.title === "มติที่ประชุมใหม่" && (await count({ userId: c.id, relatedId: m1, type: "MEETING_NOTE" })) === 2 && (await count({ userId: org.id, relatedId: m1, type: "MEETING_NOTE" })) === 1);
    await prisma.meetingNote.create({ data: { meetingId: m3, content: "หลังยกเลิก", authorId: org.id } });
    check("a note on a cancelled meeting notifies nobody", (await count({ relatedId: m3, type: "MEETING_NOTE" })) === 0);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[10] Fail-soft: notifications cannot be written → the action still succeeds");
    await prisma.$executeRawUnsafe(`ALTER TABLE public."Notification" ADD CONSTRAINT zz_ntf_test_block CHECK (false) NOT VALID`);
    try {
      const nBefore = await prisma.notification.count();
      const mx = await createMeetingRpc(org.id, `ntf-failsoft ${tag}`, { persons: [a.personId, b.personId] });
      check("create meeting still works (meeting + participants saved)", (await prisma.meetingParticipant.count({ where: { meetingId: mx } })) === 2);
      await asUser(org.id, (tx) => tx.$queryRaw`SELECT id FROM public.reschedule_meeting(${mx}, ${ts(8 * HOUR)}::timestamp, ${ts(9 * HOUR)}::timestamp)`);
      check("reschedule still works", (await prisma.meeting.findUniqueOrThrow({ where: { id: mx } })).status === "POSTPONED");
      await asUser(org.id, (tx) => tx.$executeRaw`UPDATE public."Meeting" SET status = 'CANCELLED' WHERE id = ${mx}`);
      check("cancel still works", (await prisma.meeting.findUniqueOrThrow({ where: { id: mx } })).status === "CANCELLED");
      const tx1 = await withNotificationActor(org.id, (tx) => tx.task.create({ data: { title: `ntf-failsoft-task ${tag}`, createdById: org.id, assigneeId: a.id, assigneePersonId: a.personId } }));
      taskIds.push(tx1.id);
      check("task create still works", !!tx1.id);
      const mR = await reminderMeeting("rem-failsoft", 2 * HOUR, 3 * HOUR);
      const rR = await due(mR.id);
      await processDueReminders();
      check("reminder processing still records SIMULATED", (await prisma.reminder.findUniqueOrThrow({ where: { id: rR.id } })).status === "SIMULATED");
      check("…and no notification row was written by any of it", (await prisma.notification.count()) === nBefore);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE public."Notification" DROP CONSTRAINT zz_ntf_test_block`);
    }

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[11] Security");
    let blocked = "";
    try {
      await asUser(a.id, (tx) => tx.$executeRaw`INSERT INTO public."Notification" (id, "userId", type, title) VALUES (${randomUUID()}, ${b.id}::uuid, 'REMINDER', 'forged')`);
    } catch (e) {
      blocked = String(e);
    }
    check("a member cannot insert a notification for someone else (RLS)", /row-level security|42501/.test(blocked), blocked.slice(0, 120));
    let priv = "";
    try {
      await asUser(a.id, (tx) => tx.$queryRaw`SELECT private.notify(${b.id}::uuid, 'REMINDER', 'x', 'x', NULL, 'x')`);
    } catch (e) {
      priv = String(e);
    }
    check("a member cannot call private.notify() (no access to schema private)", /permission denied/.test(priv), priv.slice(0, 120));
    const seen = await asUser(a.id, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM public."Notification" WHERE "userId" <> ${a.id}::uuid`);
    check("a member still sees only their own notifications", seen[0].n === 0);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('smartmeeting.actor_id', 'not-a-uuid', true)`;
      const r = await tx.$queryRaw<{ v: string | null }[]>`SELECT private.notification_actor()::text v`;
      check("a malformed server actor value is ignored (NULL), not an error", r[0].v === null);
    });

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[12] Previous app version writing its own rows is not doubled");
    const mL = await reminderMeeting("rem-legacy", 2 * HOUR, 3 * HOUR);
    const rL = await due(mL.id);
    await prisma.$transaction(async (tx) => {
      // old processOneDueReminder(): update + createMany in one transaction
      await tx.reminder.update({ where: { id: rL.id }, data: { status: "SIMULATED" } });
      await tx.notification.createMany({ data: [org.id, a.id].map((userId) => ({ userId, type: "REMINDER" as const, title: "แจ้งเตือนการประชุม", body: "legacy", relatedId: mL.id })) });
    });
    check("old process-due: still one REMINDER per account (old row kept)", (await count({ userId: a.id, relatedId: mL.id, type: "REMINDER" })) === 1 && (await rows({ userId: a.id, relatedId: mL.id, type: "REMINDER" }))[0].body === "legacy" && (await count({ userId: org.id, relatedId: mL.id, type: "REMINDER" })) === 1);
    const tL = await prisma.task.create({ data: { title: `ntf-legacy-task ${tag}`, createdById: org.id, assigneeId: a.id, assigneePersonId: a.personId } });
    taskIds.push(tL.id);
    const legacyRow = await prisma.notification.create({ data: { userId: a.id, type: "TASK_ASSIGNED", title: "คุณได้รับมอบหมายงานใหม่", body: tL.title, relatedId: tL.id } });
    check("old POST /api/tasks: create() still returns its row, and there is one TASK_ASSIGNED", !!legacyRow.id && (await count({ userId: a.id, relatedId: tL.id, type: "TASK_ASSIGNED" })) === 1);
    await prisma.notification.create({ data: { userId: b.id, type: "TASK_ASSIGNED", title: "คุณได้รับมอบหมายงานใหม่", body: tL.title, relatedId: tL.id } });
    await prisma.task.update({ where: { id: tL.id }, data: { assigneeId: b.id, assigneePersonId: b.personId } });
    check("old PATCH (writes its row before the update): one TASK_ASSIGNED for the new assignee", (await count({ userId: b.id, relatedId: tL.id, type: "TASK_ASSIGNED" })) === 1);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[13] Reminder auto-processor: on by default, and when it must not start");
    const base = { NEXT_RUNTIME: "nodejs", DATABASE_URL: "postgresql://x" };
    check("nothing set → starts (default on)", reminderAutoProcessDecision(base).start === true);
    check("REMINDER_AUTO_PROCESS=1 → starts", reminderAutoProcessDecision({ ...base, REMINDER_AUTO_PROCESS: "1" }).start === true);
    check("REMINDER_AUTO_PROCESS=0 / false / off → off", ["0", " 0 ", "false", "OFF"].every((v) => !reminderAutoProcessDecision({ ...base, REMINDER_AUTO_PROCESS: v }).start));
    check("next build (NEXT_PHASE=phase-production-build) → off", !reminderAutoProcessDecision({ ...base, NEXT_PHASE: "phase-production-build" }).start);
    check("test run (NODE_ENV=test) → off", !reminderAutoProcessDecision({ ...base, NODE_ENV: "test" }).start);
    check("no DATABASE_URL → off", !reminderAutoProcessDecision({ NEXT_RUNTIME: "nodejs" }).start);
    check("edge runtime → off", !reminderAutoProcessDecision({ ...base, NEXT_RUNTIME: "edge" }).start);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[14] Rollback SQL undoes the migration, and the migration applies again (all inside one rolled-back transaction)");
    const objects = (tx: Tx) => tx.$queryRaw<{ x: string }[]>`
      SELECT 'fn ' || n.nspname || '.' || p.proname || ' ' || md5(replace(pg_get_functiondef(p.oid), chr(13), '')) x FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private')
      UNION ALL SELECT 'trg ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT 'enum ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'NotificationType'
      UNION ALL SELECT 'col ' || column_name FROM information_schema.columns WHERE table_name = 'Notification'
      UNION ALL SELECT 'idx ' || indexname FROM pg_indexes WHERE tablename = 'Notification'
      ORDER BY 1`;
    const MARK = "__rolled_back_on_purpose__";
    try {
      await prisma.$transaction(
        async (tx) => {
          const migrated = (await objects(tx)).map((r) => r.x);
          for (const s of splitSql(readFileSync(ROLLBACK, "utf8").replaceAll("\r\n", "\n"))) await tx.$executeRawUnsafe(s);
          const after = (await objects(tx)).map((r) => r.x);
          check("after rollback: no notification triggers, no private notify functions", !after.some((x) => /trg_notify_|trg_merge_legacy|private\.notif|private\.meeting_recipient|private\.merge_legacy/.test(x)));
          check("after rollback: enum back to its 6 values, no dedupeKey column/index", after.includes("enum MEETING_INVITE,MEETING_UPDATED,MEETING_CANCELLED,TASK_ASSIGNED,AI_SUMMARY_READY,REMINDER") && !after.some((x) => x.includes("dedupeKey")));
          const src = await tx.$queryRaw<{ s: string }[]>`SELECT prosrc s FROM pg_proc WHERE proname = 'create_meeting_with_participants'`;
          check("after rollback: create_meeting_with_participants() writes its own invites again", /INSERT INTO public\."Notification"/.test(src[0].s));
          for (const s of splitSql(readFileSync(MIGRATION, "utf8").replaceAll("\r\n", "\n"))) await tx.$executeRawUnsafe(s);
          const again = (await objects(tx)).map((r) => r.x);
          check("re-applying the migration gives back exactly the same objects", JSON.stringify(again) === JSON.stringify(migrated), again.filter((x) => !migrated.includes(x)).join(" | "));
          throw new Error(MARK);
        },
        { timeout: 60_000 }
      );
    } catch (e) {
      if (!String(e).includes(MARK)) check("rollback/re-apply ran without error", false, String(e).slice(0, 300));
    }
  } finally {
    await prisma.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.meetingNote.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.decision.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    await prisma.onlineMeetingResource.deleteMany({ where: { id: { in: resourceIds } } });
    await prisma.contactGroup.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$executeRaw`DELETE FROM auth.users WHERE email LIKE ${`%-${tag}@test.local`}`;
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
