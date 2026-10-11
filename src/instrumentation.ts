// Runs once when a Next.js server instance starts (see
// node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
//
// The only job here is the optional reminder auto-processor
// (src/lib/reminder-auto-processor.ts): off unless REMINDER_AUTO_PROCESS=1,
// Node runtime only (it uses Prisma and timers). Nothing here may throw — a
// failure to start it is logged and the server starts as usual.
export async function register() {
  // Checked before the import so a server with it off never loads the module.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.REMINDER_AUTO_PROCESS?.trim() === "1") {
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
