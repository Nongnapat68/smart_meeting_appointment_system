import { reminderAutoProcessDecision } from "@/lib/reminder-auto-config";

// Runs once when a Next.js server instance starts (see
// node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
//
// The only job here is the reminder auto-processor
// (src/lib/reminder-auto-processor.ts): on by default, off with
// REMINDER_AUTO_PROCESS=0 and never during `next build`, a test run, on the
// edge runtime or without DATABASE_URL (src/lib/reminder-auto-config.ts).
// Nothing here may throw — a failure to start it is logged and the server
// starts as usual.
export async function register() {
  // The literal NEXT_RUNTIME check lets Next drop the import from the edge
  // bundle; the decision comes before the import so a server with it off
  // never loads the module.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!reminderAutoProcessDecision().start) return;
    try {
      const auto = await import("@/lib/reminder-auto-processor");
      auto.startReminderAutoProcessor(
        auto.reminderAutoProcessIntervalSeconds(process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS)
      );
    } catch (err) {
      console.error("[reminders:auto] could not start", err);
    }
  }
}
