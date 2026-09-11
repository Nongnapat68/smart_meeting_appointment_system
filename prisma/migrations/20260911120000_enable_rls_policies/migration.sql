-- Row Level Security (RLS) for all 20 application tables in public.
--
-- This is a defense-in-depth layer for any *future* direct supabase-js /
-- PostgREST access — it does not change today's behavior. Every mutating
-- route already enforces authorization at the app layer via assertOwner()
-- (src/lib/api-helpers.ts), and Prisma connects as the "postgres" role,
-- which has BYPASSRLS on Supabase, so `npm run build` / `npm run
-- test:authz` must keep passing unchanged after this migration. This file
-- was authored and applied by hand (see scripts/test-rls.ts for the
-- supabase-js verification) rather than `prisma migrate dev`, because the
-- shadow database `migrate dev` spins up has no `auth` schema and cannot
-- replay the earlier 20260910142937_supabase_auth_uuid_migration, which
-- references auth.users. It is recorded as already-applied via
-- `prisma migrate resolve --applied` so `prisma migrate status` / history
-- stays accurate.
--
-- Every policy is scoped `TO authenticated` only — `anon` gets nothing,
-- matching src/proxy.ts already requiring a logged-in session on every
-- page/route.

-- ============================================================
-- Step A: helper functions
-- ============================================================
-- SECURITY DEFINER + search_path = '' so:
--   (a) checking role/participation never recurses back through the RLS
--       policies of the tables these functions read (User /
--       MeetingParticipant / Person), and
--   (b) an empty search_path blocks search_path hijacking (every
--       identifier below is schema-qualified on purpose).
-- Both take no caller-supplied identity — they always resolve against
-- auth.uid() for whoever is calling — so they can't be used to probe
-- another user's admin status or meeting membership.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."User" u
    WHERE u.id = auth.uid() AND u.role = 'ADMIN'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True if the currently authenticated user (auth.uid()) has role = ADMIN in public."User". SECURITY DEFINER + search_path = '''' to avoid RLS recursion on public."User" and to block search_path hijacking.';

CREATE OR REPLACE FUNCTION public.is_meeting_participant(p_meeting_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."MeetingParticipant" mp
    JOIN public."Person" p ON p.id = mp."personId"
    WHERE mp."meetingId" = p_meeting_id
      AND p."userId" = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_meeting_participant(text) IS
  'True if the currently authenticated user (auth.uid()), via their Person row, is a MeetingParticipant of the given meeting.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which would
-- make these callable by `anon` too — lock that down explicitly.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_meeting_participant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_meeting_participant(text) TO authenticated;

-- ============================================================
-- Step B + C: per table — GRANT, then policies, then ENABLE RLS last.
-- ============================================================

-- ---------------------------------------------------------------
-- User — select: everyone logged in · insert: admin only ·
-- update: self or admin · delete: admin only
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."User" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."User"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_admin_only" ON public."User"
  FOR INSERT TO authenticated
  WITH CHECK ( (select public.is_admin()) );

CREATE POLICY "update_self_or_admin" ON public."User"
  FOR UPDATE TO authenticated
  USING ( id = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( id = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_admin_only" ON public."User"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Person — select/insert: everyone logged in ·
-- update: unlinked (userId null) is open to all, linked only to its
-- owner or admin · delete: admin only
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Person" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Person"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."Person"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_unlinked_or_owner_or_admin" ON public."Person"
  FOR UPDATE TO authenticated
  USING ( "userId" IS NULL OR "userId" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "userId" IS NULL OR "userId" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_admin_only" ON public."Person"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."Person" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- ContactGroup — select/insert: everyone logged in ·
-- update/delete: creator or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ContactGroup" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."ContactGroup"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."ContactGroup"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_creator_or_admin" ON public."ContactGroup"
  FOR UPDATE TO authenticated
  USING ( "createdById" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "createdById" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_creator_or_admin" ON public."ContactGroup"
  FOR DELETE TO authenticated
  USING ( "createdById" = (select auth.uid()) OR (select public.is_admin()) );

ALTER TABLE public."ContactGroup" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- ContactGroupMember — select: everyone logged in ·
-- insert/delete: the owning group's creator or admin · no UPDATE (no route)
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON TABLE public."ContactGroupMember" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."ContactGroupMember"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_group_creator_or_admin" ON public."ContactGroupMember"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."ContactGroup" g
      WHERE g.id = "groupId" AND g."createdById" = (select auth.uid())
    )
  );

CREATE POLICY "delete_group_creator_or_admin" ON public."ContactGroupMember"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."ContactGroup" g
      WHERE g.id = "groupId" AND g."createdById" = (select auth.uid())
    )
  );

ALTER TABLE public."ContactGroupMember" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Project — select/insert: everyone logged in · update/delete: manager or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Project" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Project"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."Project"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_manager_or_admin" ON public."Project"
  FOR UPDATE TO authenticated
  USING ( "managerId" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "managerId" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_manager_or_admin" ON public."Project"
  FOR DELETE TO authenticated
  USING ( "managerId" = (select auth.uid()) OR (select public.is_admin()) );

ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- ProjectMember — select: everyone logged in ·
-- insert/delete: the owning project's manager or admin · no UPDATE (no route)
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON TABLE public."ProjectMember" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."ProjectMember"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_project_manager_or_admin" ON public."ProjectMember"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Project" pr
      WHERE pr.id = "projectId" AND pr."managerId" = (select auth.uid())
    )
  );

CREATE POLICY "delete_project_manager_or_admin" ON public."ProjectMember"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Project" pr
      WHERE pr.id = "projectId" AND pr."managerId" = (select auth.uid())
    )
  );

ALTER TABLE public."ProjectMember" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Meeting — select/insert: everyone logged in · update/delete: organizer or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Meeting" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Meeting"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."Meeting"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_organizer_or_admin" ON public."Meeting"
  FOR UPDATE TO authenticated
  USING ( "organizerId" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "organizerId" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_organizer_or_admin" ON public."Meeting"
  FOR DELETE TO authenticated
  USING ( "organizerId" = (select auth.uid()) OR (select public.is_admin()) );

ALTER TABLE public."Meeting" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- MeetingParticipant — select: everyone logged in ·
-- insert/delete: the meeting's organizer or admin · no UPDATE (no route)
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON TABLE public."MeetingParticipant" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."MeetingParticipant"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_meeting_organizer_or_admin" ON public."MeetingParticipant"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Meeting" m
      WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid())
    )
  );

CREATE POLICY "delete_meeting_organizer_or_admin" ON public."MeetingParticipant"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Meeting" m
      WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid())
    )
  );

ALTER TABLE public."MeetingParticipant" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- MeetingNote — select: everyone logged in ·
-- insert/update/delete: the meeting's organizer, a participant, or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."MeetingNote" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."MeetingNote"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."MeetingNote"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "update_organizer_or_participant_or_admin" ON public."MeetingNote"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "delete_organizer_or_participant_or_admin" ON public."MeetingNote"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

ALTER TABLE public."MeetingNote" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Decision — same shape as MeetingNote
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Decision" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Decision"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."Decision"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "update_organizer_or_participant_or_admin" ON public."Decision"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "delete_organizer_or_participant_or_admin" ON public."Decision"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

ALTER TABLE public."Decision" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- RelatedResource — same shape as MeetingNote
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."RelatedResource" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."RelatedResource"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_organizer_or_participant_or_admin" ON public."RelatedResource"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "update_organizer_or_participant_or_admin" ON public."RelatedResource"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

CREATE POLICY "delete_organizer_or_participant_or_admin" ON public."RelatedResource"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
    OR (select public.is_meeting_participant("meetingId"))
  );

ALTER TABLE public."RelatedResource" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- OnlineMeetingResource — select/insert: everyone logged in ·
-- update/delete: unclaimed (createdById null) is open to all, claimed only
-- to its creator or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."OnlineMeetingResource" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."OnlineMeetingResource"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."OnlineMeetingResource"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_unclaimed_or_creator_or_admin" ON public."OnlineMeetingResource"
  FOR UPDATE TO authenticated
  USING ( "createdById" IS NULL OR "createdById" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "createdById" IS NULL OR "createdById" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_unclaimed_or_creator_or_admin" ON public."OnlineMeetingResource"
  FOR DELETE TO authenticated
  USING ( "createdById" IS NULL OR "createdById" = (select auth.uid()) OR (select public.is_admin()) );

ALTER TABLE public."OnlineMeetingResource" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Task — select/insert: everyone logged in ·
-- update: assignee, creator, or admin · delete: creator only (not
-- assignee) or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Task" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Task"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_all_authenticated" ON public."Task"
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_assignee_or_creator_or_admin" ON public."Task"
  FOR UPDATE TO authenticated
  USING ( "assigneeId" = (select auth.uid()) OR "createdById" = (select auth.uid()) OR (select public.is_admin()) )
  WITH CHECK ( "assigneeId" = (select auth.uid()) OR "createdById" = (select auth.uid()) OR (select public.is_admin()) );

CREATE POLICY "delete_creator_only_or_admin" ON public."Task"
  FOR DELETE TO authenticated
  USING ( "createdById" = (select auth.uid()) OR (select public.is_admin()) );

ALTER TABLE public."Task" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- TaskComment — select: everyone logged in ·
-- insert: the task's assignee, creator, or admin ·
-- update/delete: no route exists yet — closed to admin only
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."TaskComment" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."TaskComment"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_task_assignee_or_creator_or_admin" ON public."TaskComment"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "taskId" AND (t."assigneeId" = (select auth.uid()) OR t."createdById" = (select auth.uid()))
    )
  );

CREATE POLICY "update_admin_only" ON public."TaskComment"
  FOR UPDATE TO authenticated
  USING ( (select public.is_admin()) )
  WITH CHECK ( (select public.is_admin()) );

CREATE POLICY "delete_admin_only" ON public."TaskComment"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."TaskComment" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- TaskAttachment — same shape as TaskComment
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."TaskAttachment" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."TaskAttachment"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_task_assignee_or_creator_or_admin" ON public."TaskAttachment"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "taskId" AND (t."assigneeId" = (select auth.uid()) OR t."createdById" = (select auth.uid()))
    )
  );

CREATE POLICY "update_admin_only" ON public."TaskAttachment"
  FOR UPDATE TO authenticated
  USING ( (select public.is_admin()) )
  WITH CHECK ( (select public.is_admin()) );

CREATE POLICY "delete_admin_only" ON public."TaskAttachment"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."TaskAttachment" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Reminder — select: everyone logged in ·
-- insert/update/delete: the meeting's organizer or admin
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Reminder" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."Reminder"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_meeting_organizer_or_admin" ON public."Reminder"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  );

CREATE POLICY "update_meeting_organizer_or_admin" ON public."Reminder"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  );

CREATE POLICY "delete_meeting_organizer_or_admin" ON public."Reminder"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  );

ALTER TABLE public."Reminder" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Notification — personal data: owner-only, no admin bypass on
-- select/update (deliberately narrower than assertOwner()'s usual
-- always-admin-bypass pattern, since there is no route/UI today that
-- needs an admin to read or mark-read someone else's notifications) ·
-- insert: admin/server only (no UI creates these directly — every real
-- insert happens server-side via Prisma, which bypasses RLS anyway) ·
-- delete: admin only
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Notification" TO authenticated;

CREATE POLICY "select_owner_only" ON public."Notification"
  FOR SELECT TO authenticated
  USING ( "userId" = (select auth.uid()) );

CREATE POLICY "insert_admin_only" ON public."Notification"
  FOR INSERT TO authenticated
  WITH CHECK ( (select public.is_admin()) );

CREATE POLICY "update_owner_only" ON public."Notification"
  FOR UPDATE TO authenticated
  USING ( "userId" = (select auth.uid()) )
  WITH CHECK ( "userId" = (select auth.uid()) );

CREATE POLICY "delete_admin_only" ON public."Notification"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- AISummary — select: everyone logged in ·
-- insert/update: the meeting's organizer only (unlike note/decision/
-- resource, participants are NOT included) or admin · delete: admin only
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AISummary" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."AISummary"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_meeting_organizer_only_or_admin" ON public."AISummary"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  );

CREATE POLICY "update_meeting_organizer_only_or_admin" ON public."AISummary"
  FOR UPDATE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  )
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "meetingId" AND m."organizerId" = (select auth.uid()))
  );

CREATE POLICY "delete_admin_only" ON public."AISummary"
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

ALTER TABLE public."AISummary" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- PasswordResetOtp — deny-all. No GRANT to authenticated/anon and no
-- policies of any kind: RLS with zero policies default-denies every row
-- for every non-bypassing role. Used exclusively server-side via Prisma
-- (which always bypasses RLS as the "postgres" role), so this table
-- should never be reachable through supabase-js/PostgREST at all.
-- ---------------------------------------------------------------
ALTER TABLE public."PasswordResetOtp" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- _MeetingGroups (implicit M:N join table for Meeting.groups /
-- ContactGroup.meetings — "A" = ContactGroup.id, "B" = Meeting.id) —
-- select: everyone logged in · insert/delete: the meeting's organizer or
-- admin · no UPDATE (join rows are add/remove only, no route)
-- ---------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON TABLE public."_MeetingGroups" TO authenticated;

CREATE POLICY "select_all_authenticated" ON public."_MeetingGroups"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "insert_meeting_organizer_or_admin" ON public."_MeetingGroups"
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "B" AND m."organizerId" = (select auth.uid()))
  );

CREATE POLICY "delete_meeting_organizer_or_admin" ON public."_MeetingGroups"
  FOR DELETE TO authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (SELECT 1 FROM public."Meeting" m WHERE m.id = "B" AND m."organizerId" = (select auth.uid()))
  );

ALTER TABLE public."_MeetingGroups" ENABLE ROW LEVEL SECURITY;
