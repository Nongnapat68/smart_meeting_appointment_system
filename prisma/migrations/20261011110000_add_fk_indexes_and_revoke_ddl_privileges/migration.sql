-- Final-audit round, Phase 2 (2026-10-11) -- two independent hardening pieces.
--
-- (1) Indexes for the 14 foreign-key columns found (by the git-audit script
--     below) to have no supporting index: pg_constraint FKs on public schema
--     compared against pg_index leading-column prefixes. Each CREATE INDEX uses
--     Prisma's default @@index name (<Model>_<column>_idx) so the schema stays
--     in sync with the @@index([column]) entries added to prisma/schema.prisma.
--     FKs already covered by a primary key (e.g. User.id, _MeetingGroups."A"
--     via its (A,B) PK, MeetingParticipant.meetingId via its unique (meetingId,
--     personId)) are intentionally not duplicated.
--
-- (2) Revoke the table-level TRUNCATE / TRIGGER / REFERENCES privileges that
--     the Supabase bootstrap granted to anon and authenticated, and stop
--     revoking them from being undone for future tables created by postgres
--     (the role that runs every migration and the dashboard SQL editor). These
--     three privileges are not RLS-gated and are never needed by the API roles:
--     PostgREST/supabase-js only uses SELECT/INSERT/UPDATE/DELETE (untouched),
--     triggers are managed by the table owner, and REFERENCES is only used for
--     DDL (FK creation). SELECT/INSERT/UPDATE/DELETE are deliberately left
--     exactly as-is. Known residual caveat (recorded in DESIGN_DECISIONS s5.9):
--     objects created by the platform's own role "supabase_admin" are covered
--     by that role's default privileges, which we do not modify; the project
--     only ever creates objects as postgres, so it is not hit in practice.

-- ---- 1. FK indexes ----------------------------------------------------------

CREATE INDEX IF NOT EXISTS "ContactGroup_createdById_idx" ON "ContactGroup"("createdById");
CREATE INDEX IF NOT EXISTS "Decision_decidedById_idx" ON "Decision"("decidedById");
CREATE INDEX IF NOT EXISTS "Meeting_organizerId_idx" ON "Meeting"("organizerId");
CREATE INDEX IF NOT EXISTS "Meeting_organizerPersonId_idx" ON "Meeting"("organizerPersonId");
CREATE INDEX IF NOT EXISTS "Meeting_projectId_idx" ON "Meeting"("projectId");
CREATE INDEX IF NOT EXISTS "MeetingNote_authorId_idx" ON "MeetingNote"("authorId");
CREATE INDEX IF NOT EXISTS "OnlineMeetingResource_createdById_idx" ON "OnlineMeetingResource"("createdById");
CREATE INDEX IF NOT EXISTS "Project_managerId_idx" ON "Project"("managerId");
CREATE INDEX IF NOT EXISTS "RelatedResource_addedById_idx" ON "RelatedResource"("addedById");
CREATE INDEX IF NOT EXISTS "Task_assigneePersonId_idx" ON "Task"("assigneePersonId");
CREATE INDEX IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX IF NOT EXISTS "Task_meetingId_idx" ON "Task"("meetingId");
CREATE INDEX IF NOT EXISTS "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX IF NOT EXISTS "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- ---- 2. Revoke non-RLS table-level DDL privileges --------------------------

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;