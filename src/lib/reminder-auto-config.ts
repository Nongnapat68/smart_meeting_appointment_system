// Whether this process should run the reminder auto-processor
// (src/lib/reminder-auto-processor.ts). Kept apart from that module, with no
// imports, so src/instrumentation.ts can decide before loading Prisma.
//
// On by default. Off when:
//   - REMINDER_AUTO_PROCESS is "0" (also "false" / "off" / "no")
//   - not the Node.js runtime (the edge runtime has no Prisma / timers)
//   - `next build` (NEXT_PHASE=phase-production-build): building must never
//     touch the database
//   - NODE_ENV=test: a test run must never process the shared database
//   - DATABASE_URL is not set: nothing to process

const OFF_VALUES = new Set(["0", "false", "off", "no"]);

export type ReminderAutoDecision = { start: true } | { start: false; reason: string };

export function reminderAutoProcessDecision(env: Record<string, string | undefined> = process.env): ReminderAutoDecision {
  if (env.NEXT_RUNTIME !== "nodejs") return { start: false, reason: "not the Node.js runtime" };
  if (env.NEXT_PHASE === "phase-production-build") return { start: false, reason: "next build" };
  if (env.NODE_ENV === "test") return { start: false, reason: "NODE_ENV=test" };
  if (OFF_VALUES.has(env.REMINDER_AUTO_PROCESS?.trim().toLowerCase() ?? "")) {
    return { start: false, reason: "REMINDER_AUTO_PROCESS=0" };
  }
  if (!env.DATABASE_URL?.trim()) return { start: false, reason: "DATABASE_URL not set" };
  return { start: true };
}
