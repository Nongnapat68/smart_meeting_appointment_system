-- Final-audit round, Phase 1 (2026-10-11) -- tightens 4 RLS policies WITHOUT
-- adding tables/columns/enums/triggers or changing the total policy count (72).
--
-- (1) MeetingNote / Decision / RelatedResource UPDATE: the USING rule is kept
--     unchanged (admin OR organizer of the row's meeting OR the row's author).
--     The WITH CHECK is replaced by the same condition set the INSERT policy
--     already uses (20261003100000_sprint2_rls_hardening), but bound to the
--     NEW meetingId: an admin, OR the organizer of the NEW meeting, OR (the
--     attribution column is still the caller AND the caller participates in
--     the NEW meeting). This stops an author/attendee from moving a row from a
--     meeting they belong to into one they do not, e.g. to smuggle content or
--     attribution into a meeting a read-only user could not otherwise edit.
--     Accepted trade-off (recorded in DESIGN_DECISIONS s5.8): inside their own
--     meeting the organizer may still set the attribution column to someone
--     else - no extra trigger, matching the INSERT behaviour.
--
-- (2) TaskAttachment INSERT: prefix matching used LIKE '/uploads/tasks/'
--     || taskId || '/%', whose % and _ wildcards could be injected through
--     taskId. It is replaced by a literal starts_with check plus "no '..' path
--     segment" guards. The only writer (POST /api/tasks/[id]/attachments)
--     always stores '<uuid>-<sanitized-name>.<checked-ext>' under
--     /uploads/tasks/<taskId>/, where every character outside [A-Za-z0-9_-]
--     (including '.') in the sanitized name is replaced with '_' (see
--     src/app/api/tasks/[id]/attachments/route.ts and test:uploads), so no
--     legitimate path can ever contain a '..' segment; therefore rejecting
--     '/../' anywhere and a trailing '/..' is safe for real uploads.

-- ---- 1. UPDATE WITH CHECK bound to the NEW meetingId -----------------------

DROP POLICY IF EXISTS "update_author_or_organizer_or_admin" ON public."MeetingNote";
CREATE POLICY "update_author_or_organizer_or_admin" ON public."MeetingNote"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "authorId" = (select auth.uid())
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR ("authorId" = (select auth.uid()) AND (select public.is_meeting_participant("meetingId")))
  );

DROP POLICY IF EXISTS "update_author_or_organizer_or_admin" ON public."Decision";
CREATE POLICY "update_author_or_organizer_or_admin" ON public."Decision"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "decidedById" = (select auth.uid())
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR ("decidedById" = (select auth.uid()) AND (select public.is_meeting_participant("meetingId")))
  );

DROP POLICY IF EXISTS "update_author_or_organizer_or_admin" ON public."RelatedResource";
CREATE POLICY "update_author_or_organizer_or_admin" ON public."RelatedResource"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "addedById" = (select auth.uid())
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR ("addedById" = (select auth.uid()) AND (select public.is_meeting_participant("meetingId")))
  );

-- ---- 2. TaskAttachment INSERT path must be a real sub-folder of the task ----

DROP POLICY IF EXISTS "insert_task_assignee_or_creator_or_admin" ON public."TaskAttachment";
CREATE POLICY "insert_task_assignee_or_creator_or_admin" ON public."TaskAttachment"
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (select public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public."Task" t
        WHERE t.id = "taskId" AND (t."assigneeId" = (select auth.uid()) OR t."createdById" = (select auth.uid()))
      )
    )
    AND starts_with("fileUrl", '/uploads/tasks/' || "taskId" || '/')
    AND "fileUrl" NOT LIKE '%/../%'
    AND "fileUrl" NOT LIKE '%/..'
  );