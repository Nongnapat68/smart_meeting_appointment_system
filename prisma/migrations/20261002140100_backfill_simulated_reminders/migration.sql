-- Step 2 of 2 (see 20261002140000_reminder_status_simulated): every Reminder
-- recorded as SENT so far was never actually delivered. sendEmail() has never
-- had a real transport (both of its branches only log), so each of those rows
-- is really a simulated send. Re-label them SIMULATED and clear sentAt, which
-- falsely claimed a delivery time.
--
-- Separate migration from the enum change on purpose: the new enum value can
-- only be used once the transaction that added it has committed.

UPDATE "Reminder"
SET status = 'SIMULATED',
    "sentAt" = NULL
WHERE status = 'SENT';
