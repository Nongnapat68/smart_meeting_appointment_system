-- Adds ReminderStatus 'SIMULATED': a due reminder that was processed but
-- whose emails were only logged, because the app has no email transport
-- (sendEmail() in src/lib/email.ts returns "simulated"). Until now those were
-- recorded as SENT with a sentAt, a false "delivered" record.
--
-- Step 1 of 2. Postgres refuses to use an enum value in the same transaction
-- that added it ("unsafe use of new value"), so the backfill of existing rows
-- is a separate migration (20261002140100_backfill_simulated_reminders) that
-- runs after this one has committed.
--
-- No existing SQL needs to change: process_due_reminders(), the BR-14
-- cancel trigger and reschedule_meeting() only ever read or write rows with
-- status = 'PENDING', so SIMULATED is left alone like SENT/FAILED/CANCELLED.

-- AlterEnum
ALTER TYPE "ReminderStatus" ADD VALUE 'SIMULATED' AFTER 'SENT';

COMMENT ON FUNCTION public.process_due_reminders() IS
  'requirements.md §8.7 / FR-10 / BR-13 — every Reminder still PENDING whose scheduledAt has passed. Read-only; does not change status (src/lib/reminders.ts moves each row to SENT, SIMULATED or FAILED after attempting the send).';
