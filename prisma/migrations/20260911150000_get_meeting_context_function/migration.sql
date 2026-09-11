-- Function #4 (requirements.md §8 item 14 / FR-15/16/17): get_meeting_context(text).
--
-- Same logic as src/lib/meeting-ai-context.ts gatherMeetingAiContext() (plus
-- splitOverdueTasks' overdue predicate folded in as "overdueTasks"), reimp-
-- lemented in SQL to demonstrate the capability at the database layer per
-- deliverable #9. The TypeScript function is left exactly as-is and keeps
-- being what the AI routes (ai-summary, pending-issues, agenda-suggestion)
-- actually call — this is an additive, standalone SQL query.
--
-- SECURITY INVOKER, SET search_path = '' — read-only, no need to cross RLS.

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
    SELECT id, title, status, priority, "dueDate"
    FROM related_tasks
    WHERE status IN ('NOT_STARTED', 'IN_PROGRESS') AND "dueDate" IS NOT NULL AND "dueDate" < now()
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
  'requirements.md §8.14 / FR-15/16/17 — same context src/lib/meeting-ai-context.ts gatherMeetingAiContext() gathers for AI pre-meeting prep (related/overdue tasks, and past decisions/notes/resources from earlier meetings in the same project), as one JSON blob. Standalone demonstration query; the TypeScript AI routes keep using gatherMeetingAiContext() directly.';

REVOKE ALL ON FUNCTION public.get_meeting_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meeting_context(text) TO authenticated;
