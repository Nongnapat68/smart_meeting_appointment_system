import { NextResponse } from "next/server";
import { processDueReminders } from "@/lib/reminders";
import { ApiError, isAdmin, requireUser, withApiErrors } from "@/lib/api-helpers";

/**
 * BR-13: processes every Reminder whose scheduledAt has passed and is still
 * PENDING — see processDueReminders() in src/lib/reminders.ts for the
 * send/anti-duplicate logic. Each one ends up SENT (email actually
 * delivered), SIMULATED (no email transport configured, so it was only
 * logged — the case today), or FAILED. An admin triggers it on demand from
 * /reminders; the same processDueReminders() also runs on a timer when the
 * opt-in auto-processor is enabled (REMINDER_AUTO_PROCESS=1, see
 * src/instrumentation.ts).
 *
 * The due set itself comes from the process_due_reminders() SQL function
 * (prisma/migrations/20260911140000_process_due_reminders_function) rather
 * than a direct Prisma query. Sending email stays in TypeScript since
 * Postgres can't do that itself.
 */
export const POST = withApiErrors(async () => {
  const user = await requireUser();
  if (!isAdmin(user)) {
    throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่ประมวลผลการแจ้งเตือนที่ถึงเวลาได้");
  }

  const results = await processDueReminders();
  return NextResponse.json({ processed: results.length, results });
});
