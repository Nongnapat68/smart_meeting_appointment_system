-- N5: Task."dueDate" is a *date*, not an instant, but it lives in the same
-- TIMESTAMP(3) (no time zone) column as every other timestamp in this schema,
-- so the app writes it as midnight UTC ("2026-10-05" -> 2026-10-05T00:00:00).
--
-- Two places compared it against now() directly, which made a task due on the
-- 5th look overdue from 07:00 on the 5th (midnight UTC is 07:00 in Bangkok):
--
--   - public.overdue_action_items (view, 20260911130000)
--   - public.get_meeting_context()'s overdue_tasks (20260911150000)
--
-- Both are fixed here by comparing *calendar dates* instead of instants: the
-- stored value's own date is the intended due date, and "today" is taken in
-- Asia/Bangkok so a task due today stops being overdue only when the Bangkok
-- day actually rolls over. This mirrors src/lib/format.ts isPastDue(), which
-- the TypeScript side of the same bug now uses (tasks/page.tsx,
-- projects/[id]/page.tsx, splitOverdueTasks in meeting-ai-context.ts).
--
-- Pure redefinition - no schema change, no new object. The view keeps
-- security_invoker = true and both objects keep their existing grants.

-- View: overdue_action_items. Kept security_invoker = true exactly as before,
-- so it still inherits RLS from Task/User/Person instead of running with the
-- owner's privileges and bypassing it.
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
  -- with no login, a Person (assigneePersonId) - see prisma/schema.prisma
  -- Task model. Coalescing both keeps externally-assigned overdue items
  -- visible instead of showing a blank assignee name for them.
  COALESCE(u.name, per.name) AS "assigneeName",
  t."projectId",
  t."meetingId"
FROM public."Task" t
LEFT JOIN public."User" u ON u.id = t."assigneeId"
LEFT JOIN public."Person" per ON per.id = t."assigneePersonId"
WHERE t.status <> 'COMPLETED'
  -- N5: date compare, not instant compare. ::date on the stored midnight-UTC
  -- value recovers the due date as written; the Bangkok-side now() is what
  -- makes "due today" stay not-overdue until Bangkok midnight.
  AND t."dueDate"::date < (now() AT TIME ZONE 'Asia/Bangkok')::date
ORDER BY t."dueDate" ASC;

COMMENT ON VIEW public.overdue_action_items IS
  'requirements.md A8.9 - action items not yet done whose due date (a date, compared on the Bangkok calendar) has passed, soonest-overdue first, with assignee name joined in.';

REVOKE ALL ON public.overdue_action_items FROM PUBLIC;
GRANT SELECT ON public.overdue_action_items TO authenticated;

-- get_meeting_context(): one-line fix inside its overdue_tasks CTE. The body is
-- otherwise copied verbatim from
-- 20260911150000_get_meeting_context_function, including SECURITY INVOKER and
-- SET search_path = ''. Only the predicate below changes, so the JSON shape
-- every AI route already parses is untouched.
CREATE OR REPLACE FUNCTION public.get_meeting_context(p_meeting_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_meeting public."Meeting"%ROWTYPE;
  v_result json;
BEGIN
  SELECT * INTO v_meeting FROM public."Meeting" WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH related_tasks AS (
    -- Mirrors gatherMeetingAiContext: project-linked meetings pull every
    -- task on the project (ordered by dueDate, capped 20); one-shot
    -- meetings fall back to just their own tasks.
    SELECT id, title, status, priority, "dueDate"
    FROM public."Task"
    WHERE (v_meeting."projectId" IS NOT NULL AND "projectId" = v_meeting."projectId")
       OR (v_meeting."projectId" IS NULL AND "meetingId" = v_meeting.id)
    ORDER BY CASE WHEN v_meeting."projectId" IS NOT NULL THEN "dueDate" END ASC NULLS LAST
    LIMIT 20
  ),
  overdue_tasks AS (
    -- FR-16 (splitOverdueTasks in meeting-ai-context.ts): open tasks whose
    -- due date has passed.
    --
    -- N5: dueDate is a date stored at midnight UTC, so comparing it to now()
    -- as an instant counted anything due today as overdue from 07:00. Compare
    -- calendar dates, with "today" taken in Bangkok - same rule as
    -- src/lib/format.ts isPastDue() and the view above.
    SELECT id, title, status, priority, "dueDate"
    FROM related_tasks
    WHERE status IN ('NOT_STARTED', 'IN_PROGRESS')
      AND "dueDate" IS NOT NULL
      AND "dueDate"::date < (now() AT TIME ZONE 'Asia/Bangkok')::date
  ),
  past_meetings AS (
    SELECT id, title, "startTime"
    FROM public."Meeting"
    WHERE v_meeting."projectId" IS NOT NULL
      AND "projectId" = v_meeting."projectId"
      AND id <> v_meeting.id
      AND "startTime" < v_meeting."startTime"
    ORDER BY "startTime" DESC
    LIMIT 5
  ),
  past_decisions AS (
    SELECT d.id, d.content, m.title AS "meetingTitle", d."decidedAt"
    FROM public."Decision" d
    JOIN public."Meeting" m ON m.id = d."meetingId"
    WHERE d."meetingId" IN (SELECT id FROM past_meetings)
    ORDER BY d."decidedAt" DESC
    LIMIT 10
  ),
  past_notes AS (
    SELECT n.id, n.content, m.title AS "meetingTitle", n."createdAt"
    FROM public."MeetingNote" n
    JOIN public."Meeting" m ON m.id = n."meetingId"
    WHERE n."meetingId" IN (SELECT id FROM past_meetings)
    ORDER BY n."createdAt" DESC
    LIMIT 10
  ),
  past_resources AS (
    SELECT r.id, r.title, r.url, m.title AS "meetingTitle", r."createdAt"
    FROM public."RelatedResource" r
    JOIN public."Meeting" m ON m.id = r."meetingId"
    WHERE r."meetingId" IN (SELECT id FROM past_meetings)
    ORDER BY r."createdAt" DESC
    LIMIT 10
  )
  SELECT json_build_object(
    'meetingId', v_meeting.id,
    'meetingTitle', v_meeting.title,
    'relatedTasks', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."dueDate" ASC NULLS LAST) FROM related_tasks t), '[]'::json),
    'overdueTasks', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."dueDate" ASC) FROM overdue_tasks t), '[]'::json),
    'pastMeetings', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."startTime" DESC) FROM past_meetings t), '[]'::json),
    'pastDecisions', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."decidedAt" DESC) FROM past_decisions t), '[]'::json),
    'pastNotes', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."createdAt" DESC) FROM past_notes t), '[]'::json),
    'pastResources', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t."createdAt" DESC) FROM past_resources t), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_meeting_context(text) IS
  'requirements.md A8.14 / FR-13 (FR-15/16/17) - context for the AI features: related/overdue tasks, and past decisions/notes/resources from up to 5 earlier meetings in the same project, as one JSON blob. Called by the AI routes through src/lib/meeting-ai-context.ts gatherMeetingAiContext(). overdue_tasks compares dueDate on the Bangkok calendar (see 20261003120000).';

REVOKE ALL ON FUNCTION public.get_meeting_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meeting_context(text) TO authenticated;