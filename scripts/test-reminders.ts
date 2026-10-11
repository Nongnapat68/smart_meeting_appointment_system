/**
 * Test: reminders are never recorded as SENT unless an email was actually
 * delivered (ReminderStatus SIMULATED), retry only accepts FAILED, and the
 * existing SQL (process_due_reminders(), the BR-14 cancel trigger,
 * reschedule_meeting()) still behaves with the new enum value. Also: two
 * processors running at once (admin button + auto-processor) email a reminder
 * once and create one in-app REMINDER notification per account, and the
 * auto-processor started from src/instrumentation.ts is off unless
 * REMINDER_AUTO_PROCESS=1.
 *
 * Calls src/lib/reminders.ts (what POST /api/reminders/process-due and
 * POST /api/reminders/[id]/retry run after their auth checks) with real
 * Prisma queries and the real SQL functions — but against a THROWAWAY
 * database only: it creates auth.users / User / Meeting rows. It refuses to
 * run unless REMINDER_TEST_DATABASE_URL points at localhost, e.g.:
 *
 *   REMINDER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/otptest npm run test:reminders
 *
 * That database must have every migration in prisma/migrations applied (on
 * plain Postgres that needs stand-ins for Supabase's auth schema, auth.uid()
 * and the anon/authenticated roles) and timezone UTC like Supabase.
 * Exits 0 if every assertion passes.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

const TEST_DB = process.env.REMINDER_TEST_DATABASE_URL;
if (!TEST_DB || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(TEST_DB)) {
  console.error("Refusing to run: set REMINDER_TEST_DATABASE_URL to a local throwaway Postgres (localhost / 127.0.0.1).");
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

// Capture what sendEmail logs (it has no real transport). An email to a
// "@explode.test" address makes the log call throw, to drive the FAILED path.
const emailsTo: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  const to = text.match(/To:\s+(\S+)/)?.[1] ?? text.match(/^\[email\] would send to (\S+):/)?.[1];
  if (to) {
    if (to.endsWith("@explode.test")) throw new Error("simulated transport crash");
    emailsTo.push(to);
    return;
  }
  realLog(...args);
};
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0]).startsWith("process-due reminder failed")) return;
  realError(...args);
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { sendEmail } = await import("@/lib/email");
  const { processDueReminders, retryFailedReminder, reminderWithRecipients, SEND_FAILURE_REASON } = await import("@/lib/reminders");
  const { ApiError, withApiErrors } = await import("@/lib/api-helpers");
  const { reminderStatusBadge } = await import("@/components/ui/StatusBadge");
  const { reminderQuerySchema } = await import("@/lib/validations");
  const { ReminderStatus } = await import("@prisma/client");

  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const personIds: string[] = [];
  const meetingIds: string[] = [];
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  async function makeUser(name: string, role: "ADMIN" | "MEMBER" = "MEMBER") {
    const id = randomUUID();
    const email = `rem-${name}-${tag}@test.local`;
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`;
    await prisma.user.create({ data: { id, email, name, role } });
    userIds.push(id);
    return id;
  }
  async function makeMeeting(organizerId: string, recipients: string[], startInMs = 2 * HOUR) {
    const meeting = await prisma.meeting.create({
      data: {
        title: `rem-test ${tag}`,
        startTime: new Date(Date.now() + startInMs),
        endTime: new Date(Date.now() + startInMs + HOUR),
        organizerId,
      },
    });
    meetingIds.push(meeting.id);
    for (const email of recipients) {
      const person = await prisma.person.create({ data: { name: email, email } });
      personIds.push(person.id);
      await prisma.meetingParticipant.create({ data: { meetingId: meeting.id, personId: person.id } });
    }
    return meeting;
  }
  const addr = (n: string) => `${n}-${tag}@test.local`;
  const makeReminder = (meetingId: string, scheduledInMs: number, status: (typeof ReminderStatus)[keyof typeof ReminderStatus], extra = {}) =>
    prisma.reminder.create({ data: { meetingId, scheduledAt: new Date(Date.now() + scheduledInMs), status, ...extra } });
  const load = (id: string) => prisma.reminder.findUniqueOrThrow({ where: { id }, include: reminderWithRecipients });
  const sent = (email: string) => emailsTo.filter((e) => e === email).length;
  async function expect409(fn: () => Promise<unknown>) {
    try {
      await fn();
      return "no error";
    } catch (err) {
      return err instanceof ApiError && err.status === 409 ? "409" : String(err);
    }
  }

  try {
    const organizer = await makeUser("organizer");
    const stranger = await makeUser("stranger");

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[1] sendEmail reports what it actually did");
    process.env.SMTP_HOST = "";
    check('no SMTP_HOST → "simulated"', (await sendEmail({ to: addr("probe1"), subject: "s", text: "t" })) === "simulated");
    process.env.SMTP_HOST = "smtp.example.invalid";
    check('SMTP_HOST set (transport still a TODO) → still "simulated"', (await sendEmail({ to: addr("probe2"), subject: "s", text: "t" })) === "simulated");
    process.env.SMTP_HOST = "";

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[2] process-due records SIMULATED, never SENT");
    const m = await makeMeeting(organizer, [addr("alice"), addr("bob")]);
    const due = await makeReminder(m.id, -5 * MIN, "PENDING");
    const future = await makeReminder(m.id, HOUR, "PENDING");
    const dueFailed = await makeReminder(m.id, -5 * MIN, "FAILED", { failureReason: "x" });
    const dueCancelled = await makeReminder(m.id, -5 * MIN, "CANCELLED");
    const dueSimulated = await makeReminder(m.id, -5 * MIN, "SIMULATED");
    const dueSent = await makeReminder(m.id, -5 * MIN, "SENT", { sentAt: new Date() });
    const empty = await makeMeeting(organizer, []);
    const dueNoRecipients = await makeReminder(empty.id, -5 * MIN, "PENDING");
    const boom = await makeMeeting(organizer, [`x-${tag}@explode.test`]);
    const dueCrash = await makeReminder(boom.id, -5 * MIN, "PENDING");

    const run1 = await processDueReminders();
    const mine = (id: string) => run1.find((r) => r.id === id);
    check("due PENDING reminder is reported SIMULATED", mine(due.id)?.status === "SIMULATED", JSON.stringify(mine(due.id)));
    const dueAfter = await load(due.id);
    check("…stored as SIMULATED (not SENT)", dueAfter.status === "SIMULATED", dueAfter.status);
    check("…with sentAt null (no false delivery time)", dueAfter.sentAt === null);
    check("…and failureReason null", dueAfter.failureReason === null);
    check("each participant got exactly one (logged) email", sent(addr("alice")) === 1 && sent(addr("bob")) === 1);
    check("nothing anywhere was recorded SENT by this run", !run1.some((r) => r.status === "SENT"));
    check("not-yet-due PENDING reminder untouched", (await load(future.id)).status === "PENDING" && !mine(future.id));
    check(
      "due FAILED / CANCELLED / SIMULATED / SENT rows are not picked up",
      [dueFailed, dueCancelled, dueSimulated, dueSent].every((r) => !mine(r.id))
    );
    check("meeting with no participants → SIMULATED (nothing was delivered)", (await load(dueNoRecipients.id)).status === "SIMULATED");
    const crashed = await load(dueCrash.id);
    check("send that throws → FAILED with reason", crashed.status === "FAILED" && crashed.failureReason === SEND_FAILURE_REASON);

    const run2 = await processDueReminders();
    check("second run doesn't reprocess anything from the first", ![due, dueNoRecipients, dueCrash].some((r) => run2.find((x) => x.id === r.id)));
    check("…and sends no more emails", sent(addr("alice")) === 1 && sent(addr("bob")) === 1);

    // Two overlapping runs: each reminder still ends in exactly one row update.
    const m2 = await makeMeeting(organizer, [addr("carol")]);
    const dueRace = await makeReminder(m2.id, -MIN, "PENDING");
    const [ra, rb] = await Promise.all([processDueReminders(), processDueReminders()]);
    const outcomes = [ra, rb].map((r) => r.find((x) => x.id === dueRace.id)?.status ?? "absent");
    check(
      "two overlapping runs: one SIMULATED, the other SKIPPED/absent",
      outcomes.filter((o) => o === "SIMULATED").length === 1,
      JSON.stringify(outcomes)
    );
    // The row being updated once was never the whole story: both runs used to
    // email before flipping it. The claim now happens under a row lock first.
    check("…and the participant got the email once, not twice", sent(addr("carol")) === 1, `emails=${sent(addr("carol"))}`);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[3] retry accepts FAILED only");
    const mr = await makeMeeting(organizer, [addr("dave")]);
    const failed = await makeReminder(mr.id, -HOUR, "FAILED", { failureReason: "old reason", retryCount: 2 });
    const res = await retryFailedReminder(await load(failed.id));
    check("FAILED → retry ok", res.ok);
    check("…becomes SIMULATED (not SENT)", res.reminder.status === "SIMULATED", res.reminder.status);
    check("…sentAt null, failureReason cleared", res.reminder.sentAt === null && res.reminder.failureReason === null);
    check("…retryCount incremented once (2 → 3)", res.reminder.retryCount === 3, String(res.reminder.retryCount));
    check("…one email to the participant", sent(addr("dave")) === 1);

    for (const status of ["SENT", "SIMULATED", "CANCELLED", "PENDING"] as const) {
      const r = await makeReminder(mr.id, -HOUR, status, status === "SENT" ? { sentAt: new Date() } : {});
      const before = await load(r.id);
      const daveBefore = sent(addr("dave"));
      const outcome = await expect409(() => retryFailedReminder(before));
      const after = await load(r.id);
      check(
        `${status} → 409, row unchanged, no email`,
        outcome === "409" &&
          after.status === before.status &&
          after.retryCount === before.retryCount &&
          String(after.sentAt) === String(before.sentAt) &&
          sent(addr("dave")) === daveBefore,
        outcome
      );
    }

    const handler = withApiErrors(async () => {
      await retryFailedReminder(await load(dueSent.id));
      return new Response("unreachable");
    });
    const httpRes = await handler();
    const httpBody = await httpRes.json();
    check("through the route wrapper it is an HTTP 409 with a message", httpRes.status === 409 && typeof httpBody.error === "string", JSON.stringify(httpBody));

    // Race: two retries of the same FAILED reminder at once.
    const mrace = await makeMeeting(organizer, [addr("erin")]);
    const racer = await makeReminder(mrace.id, -HOUR, "FAILED", { failureReason: "x" });
    const snapshot = await load(racer.id);
    const settled = await Promise.allSettled([retryFailedReminder(snapshot), retryFailedReminder(snapshot)]);
    const oks = settled.filter((s) => s.status === "fulfilled").length;
    const conflicts = settled.filter((s) => s.status === "rejected" && s.reason instanceof ApiError && s.reason.status === 409).length;
    check("two concurrent retries: exactly one runs, the other gets 409", oks === 1 && conflicts === 1, `ok=${oks} 409=${conflicts}`);
    check("…so the email goes out once, not twice", sent(addr("erin")) === 1, `emails=${sent(addr("erin"))}`);
    check("…and retryCount went up by exactly 1", (await load(racer.id)).retryCount === 1);

    // A stale copy (already retried since it was read) is rejected.
    const staleBase = await makeReminder(mrace.id, -HOUR, "FAILED", { failureReason: "x" });
    const stale = await load(staleBase.id);
    await prisma.reminder.update({ where: { id: staleBase.id }, data: { retryCount: { increment: 1 } } });
    check("stale reminder (retryCount moved on) → 409", (await expect409(() => retryFailedReminder(stale))) === "409");

    // Retry whose send throws stays FAILED.
    const mb = await makeMeeting(organizer, [`y-${tag}@explode.test`]);
    const failing = await makeReminder(mb.id, -HOUR, "FAILED", { failureReason: "old" });
    const bad = await retryFailedReminder(await load(failing.id));
    check(
      "retry whose send throws → ok=false, still FAILED, reason set, retryCount+1",
      !bad.ok && bad.reminder.status === "FAILED" && bad.reminder.failureReason === SEND_FAILURE_REASON && bad.reminder.retryCount === 1
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[4] Existing SQL still correct with the new enum value");
    const ms = await makeMeeting(organizer, [addr("frank")]);
    const sPending = await makeReminder(ms.id, -MIN, "PENDING");
    const sSim = await makeReminder(ms.id, -MIN, "SIMULATED");
    const sSent = await makeReminder(ms.id, -MIN, "SENT", { sentAt: new Date() });
    const sFailed = await makeReminder(ms.id, -MIN, "FAILED");
    const sFuture = await makeReminder(ms.id, HOUR, "PENDING");
    const fnIds = (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM process_due_reminders()`).map((r) => r.id);
    check("process_due_reminders() returns the due PENDING row", fnIds.includes(sPending.id));
    check(
      "…and not SIMULATED / SENT / FAILED / future rows",
      ![sSim, sSent, sFailed, sFuture].some((r) => fnIds.includes(r.id))
    );
    await prisma.reminder.update({ where: { id: sPending.id }, data: { status: "CANCELLED" } }); // keep later runs clean

    // BR-14 trigger.
    const mc = await makeMeeting(organizer, [addr("gina")], 3 * HOUR);
    const cPending = await makeReminder(mc.id, HOUR, "PENDING");
    const cSim = await makeReminder(mc.id, -HOUR, "SIMULATED");
    const cSent = await makeReminder(mc.id, -HOUR, "SENT", { sentAt: new Date() });
    const cFailed = await makeReminder(mc.id, -HOUR, "FAILED");
    await prisma.meeting.update({ where: { id: mc.id }, data: { status: "CANCELLED" } });
    check("cancel trigger: PENDING → CANCELLED", (await load(cPending.id)).status === "CANCELLED");
    check(
      "cancel trigger: SIMULATED / SENT / FAILED left as they were",
      (await load(cSim.id)).status === "SIMULATED" && (await load(cSent.id)).status === "SENT" && (await load(cFailed.id)).status === "FAILED"
    );

    // reschedule_meeting() as the organizer (auth.uid() from the JWT claim).
    const mm = await makeMeeting(organizer, [addr("hank")], 24 * HOUR);
    const rFar = await makeReminder(mm.id, 23 * HOUR, "PENDING"); // 1 h before start
    const rNear = await makeReminder(mm.id, 2 * HOUR, "PENDING"); // 22 h before start → lands in the past
    const rSim = await makeReminder(mm.id, -HOUR, "SIMULATED");
    const rSent = await makeReminder(mm.id, -HOUR, "SENT", { sentAt: new Date() });
    const before = await Promise.all([rFar, rNear, rSim, rSent].map((r) => load(r.id)));
    const newStart = new Date(Date.now() + 6 * HOUR); // meeting moves 18 h earlier
    const ts = (d: Date) => d.toISOString().replace("Z", "");
    const asUser = (uid: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${uid}, true)`;
        await tx.$queryRaw`SELECT id FROM reschedule_meeting(${mm.id}, ${ts(newStart)}::timestamp, ${ts(new Date(newStart.getTime() + HOUR))}::timestamp)`;
      });
    let strangerBlocked = false;
    try {
      await asUser(stranger);
    } catch {
      strangerBlocked = true;
    }
    check("reschedule_meeting() still rejects a non-organizer", strangerBlocked);
    await asUser(organizer);
    const after = await Promise.all([rFar, rNear, rSim, rSent].map((r) => load(r.id)));
    const shift = after[0].scheduledAt.getTime() - before[0].scheduledAt.getTime();
    check("PENDING reminder shifted by the meeting's delta (−18 h), still PENDING", Math.abs(shift + 18 * HOUR) < 1000 && after[0].status === "PENDING", `shift=${shift / HOUR}h`);
    check("PENDING reminder pushed into the past → CANCELLED", after[1].status === "CANCELLED");
    check(
      "SIMULATED and SENT reminders not moved and not re-labelled",
      after[2].status === "SIMULATED" &&
        after[3].status === "SENT" &&
        after[2].scheduledAt.getTime() === before[2].scheduledAt.getTime() &&
        after[3].scheduledAt.getTime() === before[3].scheduledAt.getTime()
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[5] Display, validation and seed");
    check("enum (generated client) has SIMULATED", Object.values(ReminderStatus).includes("SIMULATED" as never));
    const badge = reminderStatusBadge("SIMULATED");
    check("SIMULATED badge doesn't say 'ส่งแล้ว' and isn't the success colour", !badge.label.startsWith("ส่งแล้ว") && badge.variant !== "success", JSON.stringify(badge));
    check("SENT badge unchanged", JSON.stringify(reminderStatusBadge("SENT")) === JSON.stringify({ label: "ส่งแล้ว", variant: "success" }));
    const overdueIso = new Date(Date.now() - 5 * MIN).toISOString();
    const overdueDb = overdueIso.replace("Z", ""); // supabase-js returns timestamp(3) without a zone
    const upcomingIso = new Date(Date.now() + HOUR).toISOString();
    check(
      "PENDING past its time reads 'เลยกำหนด — รอระบบประมวลผล' (ISO and zone-less DB value)",
      [overdueIso, overdueDb].every((t) => reminderStatusBadge("PENDING", t).label === "เลยกำหนด — รอระบบประมวลผล")
    );
    check("PENDING not yet due still reads 'รอส่ง'", reminderStatusBadge("PENDING", upcomingIso).label === "รอส่ง" && reminderStatusBadge("PENDING").label === "รอส่ง");
    check("overdue label only for PENDING (SIMULATED/CANCELLED unchanged)", reminderStatusBadge("SIMULATED", overdueIso).label === badge.label && reminderStatusBadge("CANCELLED", overdueIso).label === "ยกเลิกแล้ว");
    check("reminderQuerySchema accepts SIMULATED", reminderQuerySchema.safeParse({ status: "SIMULATED" }).success);
    const seed = readFileSync("prisma/seed.ts", "utf8");
    check("seed.ts no longer creates SENT reminders", !/status:\s*"SENT"/.test(seed));
    check("seed.ts creates a SIMULATED reminder", /status:\s*"SIMULATED"/.test(seed));
    const page = readFileSync("src/app/(app)/reminders/page.tsx", "utf8");
    check("reminders page has a SIMULATED stat card + filter", page.includes('setStatusFilter("SIMULATED")') && page.includes("counts.SIMULATED"));

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[6] FR-10: a repeated reminder offset never creates a duplicate");
    // The create form's preset filtering is only a client nicety: the frontend
    // calls create_meeting_with_participants() directly through supabase-js, so
    // the guard that actually holds is the one inside the RPC. Two requested
    // offsets that are equal mean two rows for the same instant (Reminder
    // stores scheduledAt, not the offset), so the meeting would be announced
    // twice. Proving the RPC keeps one row per distinct offset.
    const tsRpc = (d: Date) => d.toISOString().replace("Z", "");
    async function createViaRpc(offsets: number[]) {
      const start = new Date(Date.now() + 24 * HOUR);
      const end = new Date(start.getTime() + HOUR);
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${organizer}, true)`;
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.create_meeting_with_participants(
            ${organizer}::uuid, ${`rpc dedup ${tag}`}, ${tsRpc(start)}::timestamp, ${tsRpc(end)}::timestamp,
            NULL, 'SINGLE', 'PENDING', NULL, NULL, NULL, '{}', '{}', '{}', ${offsets}::int[]
          )`;
      });
      return rows[0].id;
    }

    const dupMeetingId = await createViaRpc([30, 30, 15, 15, 30]);
    meetingIds.push(dupMeetingId);
    const dupReminders = await prisma.reminder.findMany({ where: { meetingId: dupMeetingId } });
    check("offsets [30,30,15,15,30] → exactly 2 reminders", dupReminders.length === 2, `rows=${dupReminders.length}`);
    check(
      "…at 2 distinct instants (15 and 30 min before the start)",
      new Set(dupReminders.map((r) => r.scheduledAt.getTime())).size === 2
    );
    const allSameMeetingId = await createViaRpc([60, 60, 60, 60]);
    meetingIds.push(allSameMeetingId);
    check(
      "offsets [60,60,60,60] → exactly 1 reminder",
      (await prisma.reminder.count({ where: { meetingId: allSameMeetingId } })) === 1
    );
    const pendingGroups = await prisma.reminder.groupBy({
      by: ["scheduledAt"],
      where: { meetingId: dupMeetingId, status: "PENDING" },
      _count: true,
    });
    check("no two PENDING reminders of a meeting share a scheduledAt", pendingGroups.every((g) => g._count === 1));

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n[7] In-app REMINDER notification at reminder time + concurrent processors");
    const { createReminderAutoTick, reminderAutoProcessIntervalSeconds, reminderAutoProcessorRunning, stopReminderAutoProcessor } =
      await import("@/lib/reminder-auto-processor");
    const { register } = await import("@/instrumentation");
    const notifOrganizer = await makeUser("norg");
    const linkedOn = await makeUser("linked-on");
    const linkedOff = await makeUser("linked-off");
    await prisma.user.update({ where: { id: linkedOff }, data: { inAppNotifications: false } });
    const mn = await makeMeeting(notifOrganizer, [addr("ext-only")]);
    for (const [uid, name] of [[linkedOn, "linked-on"], [linkedOff, "linked-off"], [notifOrganizer, "norg"]] as const) {
      const person = await prisma.person.create({ data: { name, email: addr(`p-${name}`), userId: uid } });
      personIds.push(person.id);
      await prisma.meetingParticipant.create({ data: { meetingId: mn.id, personId: person.id } });
    }
    const notifs = (uid: string) => prisma.notification.findMany({ where: { userId: uid, relatedId: mn.id } });
    check("no REMINDER notification exists before the reminder is due", (await notifs(linkedOn)).length === 0);
    const dueN = await makeReminder(mn.id, -MIN, "PENDING");
    const futureN = await makeReminder(mn.id, 30 * MIN, "PENDING");
    // Admin button (processDueReminders) and the auto-processor tick at the same moment.
    const autoTick = createReminderAutoTick();
    const [buttonRun, autoOutcome] = await Promise.all([processDueReminders(), autoTick()]);
    check("auto tick ran alongside the button run", autoOutcome === "ran", autoOutcome);
    check("due reminder → SIMULATED, stored once", (await load(dueN.id)).status === "SIMULATED");
    const onRows = await notifs(linkedOn);
    check(
      "participant with an account gets exactly one REMINDER notification (button + auto at once)",
      onRows.length === 1 && onRows[0].type === "REMINDER" && onRows[0].isRead === false,
      JSON.stringify(onRows.map((n) => n.type))
    );
    check("…its title/body name the meeting and link to it", onRows[0]?.title === "แจ้งเตือนการประชุม" && !!onRows[0]?.body?.includes(mn.title) && onRows[0]?.relatedId === mn.id);
    check("organizer gets one too (also deduplicated when listed as a participant)", (await notifs(notifOrganizer)).length === 1);
    check("account with in-app notifications off gets none", (await notifs(linkedOff)).length === 0);
    check("each email recipient got the email once", [addr("ext-only"), addr("p-linked-on"), addr("p-linked-off"), addr("p-norg")].every((e) => sent(e) === 1));
    check("not-yet-due reminder: still PENDING, no notification for it", (await load(futureN.id)).status === "PENDING" && buttonRun.every((r) => r.id !== futureN.id));
    await processDueReminders();
    check("a later run adds no second notification", (await notifs(linkedOn)).length === 1);

    // A failed email still leaves the in-app notification (created once).
    const mf = await makeMeeting(notifOrganizer, [`z-${tag}@explode.test`]);
    const dueF = await makeReminder(mf.id, -MIN, "PENDING");
    await processDueReminders();
    const fRow = await load(dueF.id);
    const orgF = await prisma.notification.count({ where: { userId: notifOrganizer, relatedId: mf.id } });
    check("email that throws → FAILED, organizer still notified in-app once", fRow.status === "FAILED" && orgF === 1, `${fRow.status} n=${orgF}`);
    await retryFailedReminder(await load(dueF.id));
    check("retrying the FAILED email does not add another notification", (await prisma.notification.count({ where: { userId: notifOrganizer, relatedId: mf.id } })) === 1);

    console.log("\n[8] Auto-processor: opt-in, interval, no overlap, errors contained");
    check("interval default 60s when unset", reminderAutoProcessIntervalSeconds(undefined) === 60 && reminderAutoProcessIntervalSeconds("") === 60);
    check("interval garbage → 60s", reminderAutoProcessIntervalSeconds("abc") === 60);
    check("interval 120 → 120s", reminderAutoProcessIntervalSeconds("120") === 120);
    check("interval below 15 is raised to 15 (5, 0, -3)", ["5", "0", "-3"].every((v) => reminderAutoProcessIntervalSeconds(v) === 15));
    let release: () => void = () => {};
    let calls = 0;
    const slowTick = createReminderAutoTick(() => {
      calls++;
      return new Promise((resolve) => (release = () => resolve([])));
    });
    const first = slowTick();
    const second = await slowTick();
    release();
    check("a tick that starts while the previous one runs is skipped", second === "skipped" && (await first) === "ran" && calls === 1);
    const third = slowTick();
    release();
    check("…and the next tick after it finishes runs again", (await third) === "ran" && calls === 2);
    const realErr = console.error;
    const errLogs: string[] = [];
    console.error = (...a: unknown[]) => void errLogs.push(a.map(String).join(" "));
    const failing2 = await createReminderAutoTick(async () => {
      throw new Error("db down");
    })();
    console.error = realErr;
    check("an error inside a run is caught and logged, not thrown", failing2 === "failed" && errLogs.some((l) => l.includes("[reminders:auto] run failed")));

    const savedRuntime = process.env.NEXT_RUNTIME;
    const savedFlag = process.env.REMINDER_AUTO_PROCESS;
    const savedInterval = process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS;
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.REMINDER_AUTO_PROCESS;
    await register();
    check("REMINDER_AUTO_PROCESS unset → register() starts nothing (off by default)", !reminderAutoProcessorRunning());
    process.env.REMINDER_AUTO_PROCESS = "true";
    await register();
    check("REMINDER_AUTO_PROCESS=true (not \"1\") → still off", !reminderAutoProcessorRunning());
    process.env.REMINDER_AUTO_PROCESS = "1";
    process.env.NEXT_RUNTIME = "edge";
    await register();
    check("REMINDER_AUTO_PROCESS=1 on the edge runtime → off (Node only)", !reminderAutoProcessorRunning());
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS = "15";
    const ma = await makeMeeting(notifOrganizer, [addr("auto")]);
    const dueA = await makeReminder(ma.id, -MIN, "PENDING");
    await register();
    await register(); // as a hot reload would — must not add a second timer
    check("REMINDER_AUTO_PROCESS=1 → register() starts the auto-processor", reminderAutoProcessorRunning());
    let autoStatus = "";
    for (let i = 0; i < 40 && autoStatus !== "SIMULATED"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      autoStatus = (await load(dueA.id)).status;
    }
    check("…its first tick processes a due reminder without anyone pressing the button", autoStatus === "SIMULATED", autoStatus);
    check("…the email went out once even though register() ran twice", sent(addr("auto")) === 1, `emails=${sent(addr("auto"))}`);
    check("…and the organizer got one in-app REMINDER", (await prisma.notification.count({ where: { userId: notifOrganizer, relatedId: ma.id, type: "REMINDER" } })) === 1);
    stopReminderAutoProcessor();
    check("stop clears the timer", !reminderAutoProcessorRunning());
    process.env.NEXT_RUNTIME = savedRuntime;
    if (savedFlag === undefined) delete process.env.REMINDER_AUTO_PROCESS;
    else process.env.REMINDER_AUTO_PROCESS = savedFlag;
    if (savedInterval === undefined) delete process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS;
    else process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS = savedInterval;
  } finally {
    (await import("@/lib/reminder-auto-processor")).stopReminderAutoProcessor();
    await prisma.reminder.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
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
