-- Function #3 (requirements.md §8 item 7 / FR-10 / BR-13): process_due_reminders().
--
-- SECURITY INVOKER (not DEFINER like is_admin()/is_meeting_participant() in
-- 20260911120000_enable_rls_policies) — this just reads Reminder, it never
-- needs to cross another user's RLS. SET search_path = '' regardless, same
-- defense-in-depth as every other function in this project.
--
-- Schema note: the task brief calls the column "sendAt" — the actual column
-- on Reminder is "scheduledAt" (see prisma/schema.prisma). Used here.
--
-- src/app/api/reminders/process-due/route.ts is updated in this same commit
-- to call this function instead of querying Reminder directly for the due
-- set; the actual email send (and the meeting/participants lookup needed
-- for it) stays in TypeScript, since Postgres can't send email itself.

CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS SETOF public."Reminder"
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
STABLE
AS $$
  SELECT *
  FROM public."Reminder"
  WHERE status = 'PENDING'
    AND "scheduledAt" <= now()
  ORDER BY "scheduledAt" ASC;
$$;

COMMENT ON FUNCTION public.process_due_reminders() IS
  'requirements.md §8.7 / FR-10 / BR-13 — every Reminder still PENDING whose scheduledAt has passed. Read-only; does not mark rows SENT (that still happens in src/app/api/reminders/process-due/route.ts after the email send succeeds).';

REVOKE ALL ON FUNCTION public.process_due_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO authenticated;
