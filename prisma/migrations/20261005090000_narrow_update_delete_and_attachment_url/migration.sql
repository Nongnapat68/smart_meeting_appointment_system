-- Sprint 3 RLS narrowing (Ultra-review ข้อ 13, ข้อ 11, ข้อ 12) — found while
-- re-auditing who can mutate a meeting's contributions after the Sprint-2
-- INSERT-attribution work (20261003100000_sprint2_rls_hardening).
--
-- Everything below is idempotent: every policy is DROP IF EXISTS'd under both
-- its old and its new name before being (re)created, so re-applying this file
-- is a no-op. It changes only the USING / WITH CHECK expressions of existing
-- policies — no new table, column, enum or type, and the total policy count
-- (72) is unchanged.
--
-- Live-data check run before applying (read-only, 2026-10-05):
--   MeetingNote      3 rows, 0 with NULL authorId
--   Decision         3 rows, 0 with NULL decidedById
--   RelatedResource  4 rows, 0 with NULL addedById
--   OnlineMeetingResource 2 rows, 0 with NULL createdById
--   TaskAttachment   1 row, fileUrl matches '/uploads/tasks/<taskId>/%'
-- so no existing row is locked out by any change here.
--
-- ---------------------------------------------------------------------------
-- ข้อ 13 — MeetingNote / Decision / RelatedResource UPDATE and DELETE were
-- open to ANY participant of the meeting (is_meeting_participant), so one
-- attendee could rewrite or delete another attendee's note, decision or
-- resource. The INSERT policy already pins the attribution column to the
-- caller; these now make the same attribution govern edits and deletes:
-- allowed only for an admin, the meeting's organizer, or the row's own author
-- (authorId / decidedById / addedById). No RPC or SECURITY DEFINER function
-- writes any of these three tables, so nothing else depends on the old rule.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "update_organizer_or_participant_or_admin" ON public."MeetingNote";
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
    OR "authorId" = (select auth.uid())
  );

DROP POLICY IF EXISTS "delete_organizer_or_participant_or_admin" ON public."MeetingNote";
DROP POLICY IF EXISTS "delete_author_or_organizer_or_admin" ON public."MeetingNote";
CREATE POLICY "delete_author_or_organizer_or_admin" ON public."MeetingNote"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "authorId" = (select auth.uid())
  );

DROP POLICY IF EXISTS "update_organizer_or_participant_or_admin" ON public."Decision";
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
    OR "decidedById" = (select auth.uid())
  );

DROP POLICY IF EXISTS "delete_organizer_or_participant_or_admin" ON public."Decision";
DROP POLICY IF EXISTS "delete_author_or_organizer_or_admin" ON public."Decision";
CREATE POLICY "delete_author_or_organizer_or_admin" ON public."Decision"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "decidedById" = (select auth.uid())
  );

DROP POLICY IF EXISTS "update_organizer_or_participant_or_admin" ON public."RelatedResource";
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
    OR "addedById" = (select auth.uid())
  );

DROP POLICY IF EXISTS "delete_organizer_or_participant_or_admin" ON public."RelatedResource";
DROP POLICY IF EXISTS "delete_author_or_organizer_or_admin" ON public."RelatedResource";
CREATE POLICY "delete_author_or_organizer_or_admin" ON public."RelatedResource"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR "addedById" = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- ข้อ 11 — TaskAttachment INSERT accepted any fileUrl, so a task's
-- assignee/creator could post an attachment pointing anywhere (e.g. a
-- javascript: or off-site URL) that the task page then renders. The only
-- path that creates attachments is POST /api/tasks/[id]/attachments, which
-- always writes '/uploads/tasks/<taskId>/<uuid>-<name>.<ext>' (via Prisma, so
-- it bypasses this policy and is unaffected). The check below only pins the
-- INSERT policy's fileUrl to that same prefix; the live row already complies.
-- (This policy keeps its original name, so the single DROP is enough.)
-- ---------------------------------------------------------------------------

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
    AND "fileUrl" LIKE '/uploads/tasks/' || "taskId" || '/%'
  );

-- ---------------------------------------------------------------------------
-- ข้อ 12 — OnlineMeetingResource UPDATE/DELETE treated an unclaimed row
-- (createdById IS NULL) as editable/deletable by anyone. Only its creator (or
-- an admin) may change it now; a truly unclaimed row is reachable only by an
-- admin. The app never creates unclaimed rows (MeetingForm.tsx always sends
-- createdById = the caller) and there are 0 such rows live, so normal use is
-- unaffected. Person is NOT changed: it has no creator column to enforce
-- this rule against (only the owner column userId, which the existing
-- "update_unlinked_or_owner_or_admin" policy already uses), so the
-- "anyone may edit an unlinked contact" gap is recorded as a known
-- limitation in docs/DESIGN_DECISIONS.md instead.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "update_unclaimed_or_creator_or_admin" ON public."OnlineMeetingResource";
DROP POLICY IF EXISTS "update_creator_or_admin" ON public."OnlineMeetingResource";
CREATE POLICY "update_creator_or_admin" ON public."OnlineMeetingResource"
  FOR UPDATE TO authenticated
  USING ( "createdById" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "createdById" = (select auth.uid()) OR (select public.is_admin()) );

DROP POLICY IF EXISTS "delete_unclaimed_or_creator_or_admin" ON public."OnlineMeetingResource";
DROP POLICY IF EXISTS "delete_creator_or_admin" ON public."OnlineMeetingResource";
CREATE POLICY "delete_creator_or_admin" ON public."OnlineMeetingResource"
  FOR DELETE TO authenticated
  USING ( "createdById" = (select auth.uid()) OR (select public.is_admin()) );
