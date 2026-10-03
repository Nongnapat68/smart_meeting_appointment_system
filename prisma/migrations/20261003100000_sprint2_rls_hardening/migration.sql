-- Sprint 2 (FR-11 / FR-12) permission hardening, found while testing the
-- acceptance criteria against the live RLS policies:
--
-- 1. Attribution could be forged. The INSERT policies on MeetingNote,
--    Decision, RelatedResource, TaskComment and Task only checked *whether*
--    the caller may add a row, never that the author column is the caller:
--    a meeting participant could post a note/decision/resource "by" the
--    organizer, a task's assignee could comment "as" the creator, and anyone
--    could create a task claiming someone else as its creator. Each INSERT
--    policy now also requires its author column = auth.uid().
--
-- 2. A task's assignee could promote itself to creator. The Task UPDATE
--    policy lets the assignee edit the row, including "createdById", and the
--    DELETE policy trusts "createdById" (creator or admin only) — so an
--    assignee could set itself as creator and then delete the task, which
--    the delete rule is meant to forbid. A trigger now rejects any change to
--    "createdById" by a signed-in non-admin. (auth.uid() is NULL for the
--    server's own Prisma connection, which never changes createdById.)
--
-- 3. RelatedResource.url accepted any scheme, e.g. "javascript:...", which
--    the meeting page renders as a clickable link. A CHECK constraint now
--    requires http:// or https:// (all existing rows already comply).
--
-- Everything else in the original policies (20260911120000_enable_rls_policies)
-- is unchanged; each policy is dropped and recreated with the extra condition.

-- ---- 1. author column must be the caller --------------------------------

DROP POLICY IF EXISTS "insert_organizer_or_participant_or_admin" ON public."MeetingNote";
CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."MeetingNote"
  FOR INSERT TO authenticated
  WITH CHECK (
    "authorId" = (select auth.uid())
    AND (
      (select public.is_admin())
      OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
      OR (select public.is_meeting_participant("meetingId"))
    )
  );

DROP POLICY IF EXISTS "insert_organizer_or_participant_or_admin" ON public."Decision";
CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."Decision"
  FOR INSERT TO authenticated
  WITH CHECK (
    "decidedById" = (select auth.uid())
    AND (
      (select public.is_admin())
      OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
      OR (select public.is_meeting_participant("meetingId"))
    )
  );

DROP POLICY IF EXISTS "insert_organizer_or_participant_or_admin" ON public."RelatedResource";
CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."RelatedResource"
  FOR INSERT TO authenticated
  WITH CHECK (
    "addedById" = (select auth.uid())
    AND (
      (select public.is_admin())
      OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
      OR (select public.is_meeting_participant("meetingId"))
    )
  );

DROP POLICY IF EXISTS "insert_task_assignee_or_creator_or_admin" ON public."TaskComment";
CREATE POLICY "insert_task_assignee_or_creator_or_admin" ON public."TaskComment"
  FOR INSERT TO authenticated
  WITH CHECK (
    "authorId" = (select auth.uid())
    AND (
      (select public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public."Task" t
        WHERE t.id = "taskId" AND (t."assigneeId" = (select auth.uid()) OR t."createdById" = (select auth.uid()))
      )
    )
  );

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."Task";
CREATE POLICY "insert_own_as_creator" ON public."Task"
  FOR INSERT TO authenticated
  WITH CHECK ( "createdById" = (select auth.uid()) );

-- ---- 2. createdById is fixed once set (except by an admin) ---------------

CREATE OR REPLACE FUNCTION public.prevent_task_creator_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW."createdById" IS DISTINCT FROM OLD."createdById"
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'ไม่สามารถเปลี่ยนผู้สร้างงานได้' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_task_creator_change() IS
  'FR-12: blocks a signed-in non-admin from changing Task."createdById" — otherwise an assignee (allowed to UPDATE the row) could make itself the creator and gain the creator-or-admin DELETE right. Fired by trg_prevent_task_creator_change.';

DROP TRIGGER IF EXISTS trg_prevent_task_creator_change ON public."Task";
CREATE TRIGGER trg_prevent_task_creator_change
BEFORE UPDATE OF "createdById" ON public."Task"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_task_creator_change();

-- ---- 3. resource links must be http(s) -----------------------------------

ALTER TABLE public."RelatedResource"
  ADD CONSTRAINT "RelatedResource_url_http_check" CHECK (url ~* '^https?://');
