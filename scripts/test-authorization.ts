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
import bcrypt from "bcryptjs";

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const prisma = new PrismaClient();

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

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header on login response");
  return setCookie.split(";")[0];
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return extractCookie(res);
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

async function setupFixtures() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const userA = await prisma.user.create({
    data: { email: "test-authz-a@example.com", passwordHash, name: "Test User A" },
  });
  const userB = await prisma.user.create({
    data: { email: "test-authz-b@example.com", passwordHash, name: "Test User B" },
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
  await prisma.user.deleteMany({ where: { id: { in: [f.userA.id, f.userB.id] } } });
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

    const meetingEdit = await asB(`/api/meetings/${f.meeting.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hijacked by B" }),
    });
    check("PUT /api/meetings/:id (edit another user's meeting) -> 403", meetingEdit.status === 403, `got ${meetingEdit.status}`);

    const meetingCancel = await asB(`/api/meetings/${f.meeting.id}/cancel`, { method: "POST" });
    check("POST /api/meetings/:id/cancel (another user's meeting) -> 403", meetingCancel.status === 403, `got ${meetingCancel.status}`);

    const meetingReschedule = await asB(`/api/meetings/${f.meeting.id}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: new Date(Date.now() + 999_000).toISOString(),
        endTime: new Date(Date.now() + 999_999).toISOString(),
      }),
    });
    check("POST /api/meetings/:id/reschedule (another user's meeting) -> 403", meetingReschedule.status === 403, `got ${meetingReschedule.status}`);

    const meetingDelete = await asB(`/api/meetings/${f.meeting.id}`, { method: "DELETE" });
    check("DELETE /api/meetings/:id (another user's meeting) -> 403", meetingDelete.status === 403, `got ${meetingDelete.status}`);

    const taskEdit = await asB(`/api/tasks/${f.task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    check("PATCH /api/tasks/:id (another user's task) -> 403", taskEdit.status === 403, `got ${taskEdit.status}`);

    const taskDelete = await asB(`/api/tasks/${f.task.id}`, { method: "DELETE" });
    check("DELETE /api/tasks/:id (another user's task) -> 403", taskDelete.status === 403, `got ${taskDelete.status}`);

    const groupEdit = await asB(`/api/groups/${f.group.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hijacked group" }),
    });
    check("PUT /api/groups/:id (another user's group) -> 403", groupEdit.status === 403, `got ${groupEdit.status}`);

    const groupDelete = await asB(`/api/groups/${f.group.id}`, { method: "DELETE" });
    check("DELETE /api/groups/:id (another user's group) -> 403", groupDelete.status === 403, `got ${groupDelete.status}`);

    const projectEdit = await asB(`/api/projects/${f.project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hijacked project" }),
    });
    check("PUT /api/projects/:id (another user's project) -> 403", projectEdit.status === 403, `got ${projectEdit.status}`);

    const projectDelete = await asB(`/api/projects/${f.project.id}`, { method: "DELETE" });
    check("DELETE /api/projects/:id (another user's project) -> 403", projectDelete.status === 403, `got ${projectDelete.status}`);

    // Negative control: fully unauthenticated (no cookie at all) must get 401, not 403 —
    // proves the 403s above are specifically an *authorization* check, not just
    // this endpoint always failing.
    const noAuth = await fetch(`${BASE}/api/meetings/${f.meeting.id}`, { method: "DELETE" });
    check("DELETE /api/meetings/:id with no session -> 401 (not 403)", noAuth.status === 401, `got ${noAuth.status}`);

    // Positive control: the *actual* owner (User A) can still edit their own
    // meeting — proves assertOwner isn't just denying everyone.
    const ownerEdit = await asA(`/api/meetings/${f.meeting.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited by rightful owner" }),
    });
    check("PUT /api/meetings/:id as the actual organizer -> 200", ownerEdit.status === 200, `got ${ownerEdit.status}`);

    // Verify the DB was in fact left untouched by every rejected attempt.
    const meetingAfter = await prisma.meeting.findUnique({ where: { id: f.meeting.id } });
    check(
      "Meeting title in DB reflects only A's edit, none of B's rejected attempts",
      meetingAfter?.title === "Edited by rightful owner"
    );
    const taskAfter = await prisma.task.findUnique({ where: { id: f.task.id } });
    check("Task status in DB unchanged by B's rejected PATCH", taskAfter?.status === "NOT_STARTED");
    const groupAfter = await prisma.contactGroup.findUnique({ where: { id: f.group.id } });
    check("Group name in DB unchanged by B's rejected PUT", groupAfter?.name === "A's private group");
    const projectAfter = await prisma.project.findUnique({ where: { id: f.project.id } });
    check("Project name in DB unchanged by B's rejected PUT", projectAfter?.name === "A's private project");

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
