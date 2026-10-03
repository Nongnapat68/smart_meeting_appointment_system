-- Task comments can be deleted by their own author (so a typo can be removed
-- and the comment posted again — there is deliberately no edit).
--
-- Who may delete is the same rule as who may post (TaskComment INSERT,
-- 20261003100000_sprint2_rls_hardening): the author must still be the task's
-- assignee or creator, or be an admin. So an author who has since been
-- unassigned from the task can no longer delete what they wrote there, the
-- same way they can no longer post. Admins keep the delete right they already
-- had under the old "delete_admin_only" policy.
--
-- UPDATE stays admin-only (no edit feature).

DROP POLICY IF EXISTS "delete_admin_only" ON public."TaskComment";

CREATE POLICY "delete_own_if_task_editor_or_admin" ON public."TaskComment"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR (
      "authorId" = (select auth.uid())
      AND EXISTS (
        SELECT 1 FROM public."Task" t
        WHERE t.id = "taskId" AND (t."assigneeId" = (select auth.uid()) OR t."createdById" = (select auth.uid()))
      )
    )
  );
