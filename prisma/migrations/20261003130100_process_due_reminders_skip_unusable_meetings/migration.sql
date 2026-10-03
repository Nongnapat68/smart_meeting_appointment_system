-- N2/N3: process_due_reminders() returned every PENDING reminder whose
-- scheduledAt had passed, with no look at the meeting it belonged to. Two
-- kinds of reminder therefore reached the mailer:
--
--   * a reminder for a CANCELLED meeting - the 20260911160000 trigger marks
--     reminders CANCELLED when the meeting is cancelled, but only for rows
--     that exist at that moment; anything re-created or re-armed afterwards
--     (an edit through update_meeting_with_participants, a POST /api/reminders
--     call) was PENDING again and got emailed a "starting soon" notice for a
--     meeting that is not happening;
--   * a reminder for a meeting that already started or finished - the
--     scheduledAt simply passed while nobody ran the job, so the first run
--     after the fact announced a meeting that was already under way.
--
-- src/lib/reminders.ts already re-checked the meeting before sending (that
-- guard stays - it also closes the window between this query and the send, and
-- it is what marks the row CANCELLED). This closes the same hole at the
-- source, so the SQL function itself - a documented deliverable, callable by
-- anything with EXECUTE - no longer hands out reminders that can only be
-- thrown away.
--
-- POSTPONED is deliberately *not* excluded: postponing a meeting moves its
-- start, and reminders that moved with it (20261002100000 reschedule_meeting)
-- are legitimately still due.
--
-- The function keeps its shape - RETURNS SETOF public."Reminder", SECURITY
-- INVOKER, SET search_path = '', STABLE - so process_due_reminders() in
-- src/lib/reminders.ts (SELECT id FROM process_due_reminders()) is unaffected.
-- Only the returned set narrows, by four extra predicates.
--
-- Because this function is STABLE it cannot write, so the rows it now withholds
-- are not cancelled here. src/lib/reminders.ts does that in the same run
-- (sweepUnsendableReminders) right after the due set is processed, so they end
-- up CANCELLED rather than PENDING forever.

CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS SETOF public."Reminder"
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
STABLE
AS $$
  SELECT r.*
  FROM public."Reminder" r
  JOIN public."Meeting" m ON m.id = r."meetingId"
  WHERE r.status = 'PENDING'
    AND r."scheduledAt" <= now()
    AND m.status <> 'CANCELLED'
    AND m.status <> 'COMPLETED'
    AND m."startTime" > now()
    AND m."endTime" > now()
  ORDER BY r."scheduledAt" ASC;
$$;

COMMENT ON FUNCTION public.process_due_reminders() IS
  'requirements.md §8.7 / FR-10 / BR-13 — every Reminder still PENDING whose scheduledAt has passed, excluding reminders whose meeting is CANCELLED or COMPLETED or whose start/end time has already gone by (those rows are left PENDING for src/lib/reminders.ts processDueReminders() to cancel, so the cancellation is recorded rather than the row being silently ignored). Read-only; does not mark rows SENT (that still happens in src/app/api/reminders/process-due/route.ts after the email send succeeds). See 20260911140000 and 20261003130100.';

-- Zero-argument functions must be named *without* an argument list in
-- GRANT/REVOKE: "ON FUNCTION f()" is a parse error (there is no one-argument
-- overload to disambiguate), so the "()" spelling used for every other function
-- in this schema only works where there is at least one argument. The two
-- earlier migrations that got this wrong — 20260911120000 for is_admin() and
-- 20260911140000 for process_due_reminders() — are already recorded as applied
-- on this database, so their REVOKE/GRANT statements never took effect and both
-- functions were still executable by PUBLIC. Repeating the correct form here
-- makes a fresh deploy land in the same state this database is being put into.
REVOKE ALL ON FUNCTION public.is_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_due_reminders FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_reminders TO authenticated;