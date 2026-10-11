/**
 * Integration test: proves that a logged-in user cannot mutate another
 * user's resources via the API (IDOR / cross-user authorization check).
 *
 * This runs against a real, temporary instance of the app (spawns `next dev`
 * on a dedicated port) and makes real HTTP requests with two separate
 * logged-in sessions — it is not a mock. Run with:
 *
 *   npm run test:authz
 *
 * Exits 0 if every assertion passes, 1 otherwise (with a printed report).
 */
import { spawn, execSync, type ChildProcess } from "child_process";
import { PrismaClient } from "@prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const prisma = new PrismaClient();
const supabaseAdmin = createAdminClient();

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

// Supabase's cookie-based session can split across *multiple* Set-Cookie
// headers (e.g. a chunked "sb-<ref>-auth-token.0" / ".1" pair, or separate
// access/refresh cookies) — a single Response.headers.get("set-cookie") only
// ever returns one combined string and silently drops the rest (a Fetch API
// limitation), so this uses getSetCookie() to capture every one of them.
function extractCookies(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    throw new Error("No Set-Cookie header(s) on login response");
  }
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return extractCookies(res);
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Dev server did not become ready in time");
}

function startServer(): ChildProcess {
  // Single command string (rather than shell:true + an args array) avoids
  // Node's arg-escaping deprecation warning while still resolving the local
  // `next` binary via npx on both POSIX and Windows shells.
  const child = spawn(`npx next dev -p ${PORT}`, {
    cwd: process.cwd(),
    shell: true,
    stdio: "pipe",
  });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (d) => process.stderr.write(`[next dev] ${d}`));
  return child;
}

function stopServer(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // already gone
    }
  } else {
    child.kill("SIGKILL");
  }
}

const PASSWORD = "TestPassw0rd!";

/** Creates a real Supabase Auth user (same as step A of the auth migration)
 * and returns its uuid, for use as the matching public.User.id. */
async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create Supabase Auth user ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function setupFixtures() {
  const userAId = await createAuthUser("test-authz-a@example.com");
  const userBId = await createAuthUser("test-authz-b@example.com");

  const userA = await prisma.user.create({
    data: { id: userAId, email: "test-authz-a@example.com", name: "Test User A" },
  });
  const userB = await prisma.user.create({
    data: { id: userBId, email: "test-authz-b@example.com", name: "Test User B" },
  });
  const personA = await prisma.person.create({
    data: { userId: userA.id, name: userA.name, email: userA.email, type: "INTERNAL" },
  });

  const meeting = await prisma.meeting.create({
    data: {
      title: "A's private planning meeting",
      type: "SINGLE",
      status: "PENDING",
      startTime: new Date(Date.now() + 3600_000),
      endTime: new Date(Date.now() + 7200_000),
      organizerId: userA.id,
      organizerPersonId: personA.id,
      participants: { create: [{ personId: personA.id, role: "ORGANIZER" }] },
      reminders: { create: [{ scheduledAt: new Date(Date.now() + 1800_000) }] },
    },
  });

  const task = await prisma.task.create({
    data: {
      title: "A's private task",
      status: "NOT_STARTED",
      priority: "MEDIUM",
      assigneeId: userA.id,
      createdById: userA.id,
    },
  });

  const group = await prisma.contactGroup.create({
    data: { name: "A's private group", createdById: userA.id },
  });

  const project = await prisma.project.create({
    data: { name: "A's private project", managerId: userA.id },
  });

  return { userA, userB, personA, meeting, task, group, project };
}

async function cleanupFixtures(f: Awaited<ReturnType<typeof setupFixtures>>) {
  await prisma.reminder.deleteMany({ where: { meetingId: f.meeting.id } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: f.meeting.id } });
  await prisma.meeting.deleteMany({ where: { id: f.meeting.id } });
  await prisma.task.deleteMany({ where: { id: f.task.id } });
  await prisma.contactGroup.deleteMany({ where: { id: f.group.id } });
  await prisma.project.deleteMany({ where: { id: f.project.id } });
  await prisma.person.deleteMany({ where: { id: f.personA.id } });
  // Deleting from Supabase Auth cascades to public.User via User_id_fkey
  // (ON DELETE CASCADE) — no separate prisma.user.deleteMany() needed, and
  // this is also what actually removes the test accounts from auth.users
  // (skipping it would leak throwaway test users the same way the
  // connection-test@example.com one leaked before the migration).
  await supabaseAdmin.auth.admin.deleteUser(f.userA.id);
  await supabaseAdmin.auth.admin.deleteUser(f.userB.id);
}

async function main() {
  console.log(`Starting temporary server on port ${PORT}...`);
  const server = startServer();

  try {
    await waitForServer();
    console.log("Server ready. Seeding cross-user test fixtures...\n");

    const f = await setupFixtures();

    const cookieA = await login(f.userA.email, PASSWORD);
    const cookieB = await login(f.userB.email, PASSWORD);

    const asB = (path: string, init: RequestInit = {}) =>
      fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, Cookie: cookieB } });
    const asA = (path: string, init: RequestInit = {}) =>
      fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, Cookie: cookieA } });

    console.log("User B attempting to mutate User A's resources (all must be rejected with 403):");

    // Only /api/tasks/:id still has a REST route: task CRUD stayed REST. The
    // meetings / groups / projects write routes were deleted once the hybrid
    // migration moved every caller to supabase-js + RPC, so their cross-user
    // authorization is now enforced (and asserted) at the RLS layer by
    // scripts/test-rls.ts, not here. This suite keeps a real API-layer IDOR
    // probe for the one write endpoint that remained.
    const taskEdit = await asB(`/api/tasks/${f.task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    check("PATCH /api/tasks/:id (another user's task) -> 403", taskEdit.status === 403, `got ${taskEdit.status}`);

    const taskDelete = await asB(`/api/tasks/${f.task.id}`, { method: "DELETE" });
    check("DELETE /api/tasks/:id (another user's task) -> 403", taskDelete.status === 403, `got ${taskDelete.status}`);

    // Negative control: fully unauthenticated (no cookie at all) must get 401, not 403 —
    // proves the 403s above are specifically an *authorization* check, not just
    // this endpoint always failing.
    const noAuth = await fetch(`${BASE}/api/tasks/${f.task.id}`, { method: "DELETE" });
    check("DELETE /api/tasks/:id with no session -> 401 (not 403)", noAuth.status === 401, `got ${noAuth.status}`);

    // Positive control: the *actual* owner (User A) can still edit their own
    // task — proves assertOwner isn't just denying everyone.
    const ownerEdit = await asA(`/api/tasks/${f.task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    check("PATCH /api/tasks/:id as the actual owner -> 200", ownerEdit.status === 200, `got ${ownerEdit.status}`);

    // Task input validation (ข้อ 3.4): a bad due date and a dangling meetingId
    // were both a 500 (invalid Date / P2003) before — they must now be a clean
    // 400, and a blank reference must be treated as "no reference" (201).
    console.log("\nPOST /api/tasks input validation (must not 500):");
    const createdTaskIds: string[] = [];

    const badDate = await asA("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "task with a bad date", dueDate: "not-a-date" }),
    });
    check("POST /api/tasks dueDate='not-a-date' -> 400", badDate.status === 400, `got ${badDate.status}`);

    const badRef = await asA("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "task with a dangling meeting", meetingId: "does-not-exist-id" }),
    });
    check("POST /api/tasks meetingId ที่ไม่มีจริง -> 400 (ไม่ใช่ 500)", badRef.status === 400, `got ${badRef.status}`);

    const blankRef = await asA("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "task with blank refs", meetingId: "   ", projectId: "" }),
    });
    check("POST /api/tasks meetingId/projectId ช่องว่าง -> 201", blankRef.status === 201, `got ${blankRef.status}`);
    if (blankRef.status === 201) {
      const created = await blankRef.json();
      createdTaskIds.push(created.task.id);
      check(
        "ช่องว่างถูกเก็บเป็น null (ไม่ใช่สตริงว่าง)",
        created.task.meetingId === null && created.task.projectId === null,
        `meetingId=${JSON.stringify(created.task.meetingId)} projectId=${JSON.stringify(created.task.projectId)}`
      );
    }

    const goodRef = await asA("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "task linked to a real meeting", meetingId: f.meeting.id }),
    });
    check("POST /api/tasks meetingId ที่มีจริง -> 201", goodRef.status === 201, `got ${goodRef.status}`);
    if (goodRef.status === 201) {
      const created = await goodRef.json();
      createdTaskIds.push(created.task.id);
    }
    if (createdTaskIds.length) await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });

    // Verify the DB was in fact left untouched by every rejected attempt — the
    // status is User A's "IN_PROGRESS", never User B's "COMPLETED".
    const taskAfter = await prisma.task.findUnique({ where: { id: f.task.id } });
    check(
      "Task status in DB reflects only A's edit, none of B's rejected attempts",
      taskAfter?.status === "IN_PROGRESS"
    );

    console.log("\nCleaning up test fixtures...");
    await cleanupFixtures(f);
  } finally {
    stopServer(server);
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
