-- INSERT may not forge attribution ( Sprint 2 follow-up to
-- 20261003100000_sprint2_rls_hardening, which fixed the same class of hole
-- for MeetingNote / Decision / RelatedResource / TaskComment / Task).
--
-- What is still open: five tables kept their original
-- "insert_all_authenticated ... WITH CHECK (true)" policy, which only
-- answers "may this caller add a row at all?" and never "whose row is it?".
-- Every one of them carries an attribution column, so a logged-in MEMBER can
-- currently create rows attributed to somebody else:
--
--   "ContactGroup"."createdById"        -> make another user the creator of a
--                                           group they never asked for
--   "Project"."managerId"               -> make another user the manager of a
--                                           project (and that user then owns
--                                           its edit/delete rights)
--   "Meeting"."organizerId"            -> create a meeting *as* another user;
--                                           they are then shown as the
--                                           organizer and receive the
--                                           MEETING_INVITE notifications
--   "OnlineMeetingResource"."createdById" -> claim/create a shared resource on
--                                           someone else's behalf
--   "Person"."userId"                   -> link a contact row to ANOTHER
--                                           account, i.e. bind an identity
--                                           this caller does not own
--
-- Person has no author column, so its rule is expressed differently: a
-- caller may create an external contact (userId NULL, which is what every
-- real insert does) or link a row to their OWN account, but never to someone
-- else's. Both "Person" inserts inside create_meeting_with_participants() /
-- update_meeting_with_participants() use userId NULL, so they keep working:
-- the first is SECURITY DEFINER (bypasses RLS outright) and the second is
-- INVOKER and only ever inserts EXTERNAL rows.
--
-- Nothing in the app relies on the permissive form -- every direct
-- supabase-js insert already sends the caller's own id
-- (groups/page.tsx, projects/page.tsx, MeetingForm.tsx's inline project +
-- online-resource creates, people/page.tsx). Meetings are created through
-- create_meeting_with_participants(), which is SECURITY DEFINER and does its
-- own auth.uid() == p_organizer_id check, so the "admin creates on behalf
-- of someone" capability is untouched by tightening the policy.
--
-- UPDATE/DELETE policies and every other table are unchanged: the matching
-- WITH CHECK clauses on ContactGroup / Project / Meeting /
-- OnlineMeetingResource already refuse to hand a row to another account, and
-- "Person"."update_unlinked_or_owner_or_admin" evaluates WITH CHECK against
-- the NEW row, so it already rejects re-pointing userId at a third party.
-- Regression tests for all of this live in scripts/test-rls.ts (assertions 6-8).

-- ---- creator / manager / organizer must be the caller -------------------

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."ContactGroup";
CREATE POLICY "insert_own_as_creator" ON public."ContactGroup"
  FOR INSERT TO authenticated
  WITH CHECK ( "createdById" = (select auth.uid()) );

COMMENT ON POLICY "insert_own_as_creator" ON public."ContactGroup" IS
  'A group can only be created as yourself. Stops a MEMBER from inserting a group with somebody else''s createdById, which the update_creator_or_admin / delete_creator_or_admin policies would then treat as theirs.';

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."Project";
CREATE POLICY "insert_own_as_manager" ON public."Project"
  FOR INSERT TO authenticated
  WITH CHECK ( "managerId" = (select auth.uid()) );

COMMENT ON POLICY "insert_own_as_manager" ON public."Project" IS
  'A project can only be created as yourself - managerId drives update_manager_or_admin and delete_manager_or_admin.';

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."Meeting";
CREATE POLICY "insert_own_as_organizer" ON public."Meeting"
  FOR INSERT TO authenticated
  WITH CHECK ( "organizerId" = (select auth.uid()) );

COMMENT ON POLICY "insert_own_as_organizer" ON public."Meeting" IS
  'A direct Meeting insert must name the caller as organizer. The real create path is create_meeting_with_participants() (SECURITY DEFINER, which authorizes p_organizer_id itself and is not subject to this policy); this only covers raw PostgREST inserts.';

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."OnlineMeetingResource";
CREATE POLICY "insert_own_as_creator_or_unclaimed" ON public."OnlineMeetingResource"
  FOR INSERT TO authenticated
  WITH CHECK ( "createdById" IS NULL OR "createdById" = (select auth.uid()) );

COMMENT ON POLICY "insert_own_as_creator_or_unclaimed" ON public."OnlineMeetingResource" IS
  'Mirrors update_unclaimed_or_creator_or_admin: an unclaimed (createdById NULL) shared resource may be added by anyone, but a claimed one must be claimed by the caller.';

-- ---- Person: external contact, or a link to your own account only --------

DROP POLICY IF EXISTS "insert_all_authenticated" ON public."Person";
CREATE POLICY "insert_external_or_self_link" ON public."Person"
  FOR INSERT TO authenticated
  WITH CHECK ( "userId" IS NULL OR "userId" = (select auth.uid()) );

COMMENT ON POLICY "insert_external_or_self_link" ON public."Person" IS
  'Contact rows are created with userId NULL (an external contact with no login) or with the caller''s own id. Binding a Person to a third party''s account would let anyone forge an identity link, since "userId" is what is_meeting_participant() and the Task/Project/Meeting joins resolve through.';