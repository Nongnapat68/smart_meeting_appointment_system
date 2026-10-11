import { processDueReminders, type ProcessDueResult } from "@/lib/reminders";

// Optional in-process scheduler for BR-13: runs the same processDueReminders()
// as the admin button on /reminders (POST /api/reminders/process-due) every
// REMINDER_AUTO_PROCESS_INTERVAL_SECONDS while the Node server is up. Started
// from src/instrumentation.ts only when REMINDER_AUTO_PROCESS=1 — off by
// default, so no reminder is processed unless someone opts in.
//
// This only works on a long-running server (`npm run dev` / `npm start`). On
// serverless hosting there is no process between requests to keep a timer
// alive — that needs an external cron, and POST /api/reminders/process-due
// currently requires an admin session, so a cron-secret route would be needed.

export const REMINDER_AUTO_PROCESS_DEFAULT_SECONDS = 60;
export const REMINDER_AUTO_PROCESS_MIN_SECONDS = 15;

/** Interval in seconds from the env value: default 60, never below 15. */
export function reminderAutoProcessIntervalSeconds(raw: string | undefined): number {
  const n = Number(raw?.trim());
  if (!raw?.trim() || !Number.isFinite(n)) return REMINDER_AUTO_PROCESS_DEFAULT_SECONDS;
  return Math.max(REMINDER_AUTO_PROCESS_MIN_SECONDS, Math.floor(n));
}

export type AutoTickOutcome = "ran" | "skipped" | "failed";

/**
 * One tick of the scheduler. A tick that starts while the previous one is
 * still running is skipped rather than overlapping it. Any error is caught and
 * logged — a failed run must never take the server down; the next tick simply
 * tries again (anything left PENDING is still due).
 */
export function createReminderAutoTick(
  run: () => Promise<ProcessDueResult[]> = processDueReminders
): () => Promise<AutoTickOutcome> {
  let running = false;
  return async () => {
    if (running) return "skipped";
    running = true;
    try {
      const results = await run();
      if (results.length > 0) {
        const count = (s: ProcessDueResult["status"]) => results.filter((r) => r.status === s).length;
        console.log(
          `[reminders:auto] processed ${results.length} — SENT ${count("SENT")}, SIMULATED ${count("SIMULATED")}, FAILED ${count("FAILED")}, SKIPPED ${count("SKIPPED")}`
        );
      }
      return "ran";
    } catch (err) {
      console.error("[reminders:auto] run failed", err);
      return "failed";
    } finally {
      running = false;
    }
  };
}

type AutoProcessorState = { timer: ReturnType<typeof setInterval>; intervalSeconds: number };

// Kept on globalThis so a dev-server hot reload that re-runs this module does
// not start a second timer next to the first.
const globalForReminders = globalThis as typeof globalThis & { __reminderAutoProcessor?: AutoProcessorState };

/** Starts the timer once per process; returns false if one is already running. */
export function startReminderAutoProcessor(intervalSeconds: number): boolean {
  if (globalForReminders.__reminderAutoProcessor) return false;
  const tick = createReminderAutoTick();
  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  // Don't keep a process alive just for this timer.
  timer.unref?.();
  globalForReminders.__reminderAutoProcessor = { timer, intervalSeconds };
  console.log(`[reminders:auto] enabled — checking due reminders every ${intervalSeconds}s`);
  void tick();
  return true;
}

export function stopReminderAutoProcessor(): void {
  const state = globalForReminders.__reminderAutoProcessor;
  if (!state) return;
  clearInterval(state.timer);
  delete globalForReminders.__reminderAutoProcessor;
}

export function reminderAutoProcessorRunning(): boolean {
  return Boolean(globalForReminders.__reminderAutoProcessor);
}
