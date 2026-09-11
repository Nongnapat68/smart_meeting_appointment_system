-- View #1/#2 (requirements.md §8 items 4 and 9): upcoming_meetings and
-- overdue_action_items. Pure additions — no existing table, column, or
-- application logic is touched.
--
-- Schema note / deviation from the task brief: MeetingStatus has no
-- 'SCHEDULED' value (it's PENDING | ACTIVE | COMPLETED | CANCELLED |
-- POSTPONED — see prisma/schema.prisma) and TaskStatus has no 'DONE' value
-- (NOT_STARTED | IN_PROGRESS | COMPLETED). "upcoming_meetings" below uses
-- status NOT IN ('CANCELLED', 'COMPLETED') instead of status = 'SCHEDULED',
-- matching the existing "not cancelled" upcoming-meetings query already in
-- src/app/(app)/dashboard/page.tsx (just without dashboard's 7-day cap).
-- "overdue_action_items" uses status <> 'COMPLETED' instead of <> 'DONE'.
--
-- WITH (security_invoker = true) on both views: without it, a view runs
-- with the privileges/RLS context of its owner instead of the querying
-- role, silently bypassing the RLS policies on Meeting/User/Project/Task/
-- Person from prisma/migrations/20260911120000_enable_rls_policies (see
-- Supabase's views-bypass-RLS-by-default guidance). Both source tables'
-- SELECT policies are already "everyone logged in", so this view exposes
-- nothing a signed-in user couldn't already query directly.

CREATE OR REPLACE VIEW public.upcoming_meetings
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.title,
  m.description,
  m.type,
  m.status,
  m."startTime",
  m."endTime",
  m.location,
  m."organizerId",
  u.name AS "organizerName",
  m."projectId",
  p.name AS "projectName"
FROM public."Meeting" m
LEFT JOIN public."User" u ON u.id = m."organizerId"
LEFT JOIN public."Project" p ON p.id = m."projectId"
WHERE m.status NOT IN ('CANCELLED', 'COMPLETED')
  AND m."startTime" > now()
ORDER BY m."startTime" ASC;

COMMENT ON VIEW public.upcoming_meetings IS
  'requirements.md §8.4 — meetings not yet started and not cancelled/completed, soonest first, with organizer and project name joined in.';

REVOKE ALL ON public.upcoming_meetings FROM PUBLIC;
GRANT SELECT ON public.upcoming_meetings TO authenticated;

CREATE OR REPLACE VIEW public.overdue_action_items
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.title,
  t.description,
  t.status,
  t.priority,
  t."dueDate",
  t."assigneeId",
  -- Task can be assigned to a User (assigneeId) or, for external contacts
  -- with no login, a Person (assigneePersonId) — see prisma/schema.prisma
  -- Task model. Coalescing both keeps externally-assigned overdue items
  -- visible instead of showing a blank assignee name for them.
  COALESCE(u.name, per.name) AS "assigneeName",
  t."projectId",
  t."meetingId"
FROM public."Task" t
LEFT JOIN public."User" u ON u.id = t."assigneeId"
LEFT JOIN public."Person" per ON per.id = t."assigneePersonId"
WHERE t.status <> 'COMPLETED'
  AND t."dueDate" < now()
ORDER BY t."dueDate" ASC;

COMMENT ON VIEW public.overdue_action_items IS
  'requirements.md §8.9 — action items not yet done whose due date has passed, soonest-overdue first, with assignee name joined in.';

REVOKE ALL ON public.overdue_action_items FROM PUBLIC;
GRANT SELECT ON public.overdue_action_items TO authenticated;
