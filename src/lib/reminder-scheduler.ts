import { processDueReminders } from "@/lib/reminder-processor";

const INTERVAL_MS = 30_000;

/**
 * Starts a background loop that delivers due reminders every 30 seconds.
 * Started once per Node server instance via `instrumentation.ts`. Safe to run
 * alongside the internal cron route because reminder rows are pessimistically
 * claimed before delivery, so the scheduler can never double-send.
 */
export function startReminderScheduler(): void {
  const run = async () => {
    try {
      const result = await processDueReminders();
      if (result.processed > 0) {
        console.log(
          `[reminder-scheduler] processed=${result.processed} sent=${result.sent} failed=${result.failed}`
        );
      }
    } catch (err) {
      console.error("[reminder-scheduler] error:", err);
    }
  };

  void run();
  const interval = setInterval(run, INTERVAL_MS);
  interval.unref?.();
}