-- =============================================================================
-- schema.sql — Smart Meeting & Appointment Management System
-- =============================================================================
-- Dialect: PostgreSQL 17 (Supabase-hosted). Exported directly from the live
-- project database via introspection (pg_dump itself requires Docker, which
-- this machine doesn't have — `supabase db dump --db-url ... --dry-run`
-- confirms it would just shell out to `pg_dump --schema-only
-- --quote-all-identifier`; every statement below was instead reconstructed
-- from pg_catalog/information_schema on the live database — same source of
-- truth pg_dump itself reads from — via `information_schema.columns`,
-- `pg_constraint` + `pg_get_constraintdef()`, `pg_indexes`, `pg_policies`,
-- `pg_get_viewdef()`, `pg_get_functiondef()` and `pg_get_triggerdef()`) and
-- cross-checked against the migration files that originally created each
-- object (`prisma/migrations/20260910142937_supabase_auth_uuid_migration`,
-- `20260911120000_enable_rls_policies`, `20260911130000_...views`,
-- `20260911140000_...process_due_reminders_function`,
-- `20260911150000_...get_meeting_context_function`,
-- `20260911160000_...cancel_meeting_reminders_trigger`).
--
-- This supersedes the previous version of this file, which was the SQLite
-- dev-database dialect from before the project migrated to Supabase
-- Postgres (see git history) — every SQLite-specific detail (TEXT/DATETIME
-- storage classes, `PRAGMA foreign_keys`, unix-epoch timestamps) is gone;
-- everything below is native Postgres as it actually exists right now.
--
-- Scope confirmed against the live database at export time:
--   - 20 application tables (19 + the implicit M:N join table
--     `_MeetingGroups`) — excludes Prisma's own `_prisma_migrations`
--     bookkeeping table, which isn't an application table.
--   - 15 enum types (native Postgres CREATE TYPE ... AS ENUM, not the
--     TEXT-with-app-level-validation SQLite fell back to).
--   - All FKs, including the one cross-schema FK — `"User".id` →
--     `auth.users.id` (Supabase Auth's own table) ON DELETE CASCADE —
--     added by 20260910142937_supabase_auth_uuid_migration.
--   - 4 indexes that migration also had to re-create after converting their
--     column to `uuid` (the ALTER COLUMN TYPE drops and re-adds the
--     column under the hood, which drops any index on it): "Person_userId_key",
--     "PasswordResetOtp_userId_idx", "Task_assigneeId_idx",
--     "Notification_userId_isRead_idx".
--   - 72 Row Level Security policies across every table (verified live via
--     `SELECT count(*) FROM pg_policies WHERE schemaname='public'` = 72),
--     plus the 2 SECURITY DEFINER helper functions they depend on
--     (`is_admin()`, `is_meeting_participant(text)`).
--   - 2 views (`upcoming_meetings`, `overdue_action_items`), 2 SECURITY
--     INVOKER functions (`process_due_reminders()`, `get_meeting_context
--     (text)`), and 1 trigger (`trg_cancel_meeting_reminders` on `Meeting`)
--     added for requirements.md §8 items 4/7/9/14 and BR-14.
--
-- Deliberately out of scope / excluded: Supabase's own platform-managed
-- `rls_auto_enable()` event-trigger function, which exists on this project
-- but was never authored by this codebase (it auto-enables RLS on any new
-- table created in `public` — a project-level Supabase setting, not
-- application DDL).
--
-- Column-order note: a handful of columns (`"User".id`, every
-- `*.organizerId`/`assigneeId`/`createdById`/`managerId`/`authorId`/
-- `decidedById`/`addedById`/`userId` that points at `"User".id`) appear
-- LAST in their table instead of in the position `prisma/schema.prisma`
-- declares them, because 20260910142937_supabase_auth_uuid_migration
-- converted them from `text` (cuid) to `uuid` via add-new-column +
-- backfill + drop-old + rename, which gives the column a new ordinal
-- position at the end of the row. This is the table's real physical
-- column order today, not a transcription artifact — kept as-is rather
-- than reordered for cosmetic match with schema.prisma.
--
-- Run order below (matches how it was actually verified end-to-end against
-- an empty schema — see the "VERIFIED" block at the end of this file):
--   1. CREATE TYPE (enums)
--   2. CREATE TABLE (columns + inline PRIMARY KEY only, no FK yet)
--   3. CREATE INDEX (everything except the indexes PRIMARY KEY creates implicitly)
--   4. ALTER TABLE ... ADD CONSTRAINT (every FK, added after all tables exist)
--   5. RLS: 2 helper functions, then GRANT + CREATE POLICY + ENABLE RLS per table
--   6. Views, Functions, Trigger (requirements.md §8 items 4/7/9/14, BR-14)
-- =============================================================================


-- =============================================================================
-- 1. ENUM TYPES (15)
-- =============================================================================

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "PersonType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "GroupRole" AS ENUM ('LEADER', 'MEMBER');
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PENDING', 'DELAYED', 'COMPLETED');
CREATE TYPE "MeetingType" AS ENUM ('SINGLE', 'PROJECT');
CREATE TYPE "MeetingStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED');
CREATE TYPE "ParticipantRole" AS ENUM ('ORGANIZER', 'ATTENDEE');
CREATE TYPE "RsvpStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
CREATE TYPE "ParticipantSource" AS ENUM ('DIRECT', 'GROUP', 'EXTERNAL');
CREATE TYPE "ResourceType" AS ENUM ('LINK', 'DOCUMENT', 'FILE');
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');
CREATE TYPE "NotificationType" AS ENUM ('MEETING_INVITE', 'MEETING_UPDATED', 'MEETING_CANCELLED', 'TASK_ASSIGNED', 'AI_SUMMARY_READY', 'REMINDER');


-- =============================================================================
-- 2. TABLES (20) — columns + inline PRIMARY KEY only; FKs added in section 4
-- =============================================================================

-- Auth/Users (FR-01). "User".id carries no DEFAULT — it's always the same
-- uuid Supabase Auth already generated for that person in auth.users (see
-- the cross-schema FK in section 4), supplied explicitly on insert.
CREATE TABLE "User" (
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "department" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER'::"UserRole",
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "inAppNotifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "id" UUID NOT NULL,
    PRIMARY KEY (id)
);

-- OTP for the "forgot password" flow — one user can have many rows (a fresh
-- OTP is requested every time).
CREATE TABLE "PasswordResetOtp" (
    "id" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    PRIMARY KEY (id)
);

-- People/Contacts (FR-01) — a Person may or may not be linked to a User
-- (userId), so external contacts with no login can still be invited.
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "title" TEXT,
    "department" TEXT,
    "type" "PersonType" NOT NULL DEFAULT 'EXTERNAL'::"PersonType",
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE'::"PersonStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,
    PRIMARY KEY (id)
);

-- Contact Groups (FR-02, BR-01) — reusable groups such as project teams,
-- committees, research teams.
CREATE TABLE "ContactGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'group'::text,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    PRIMARY KEY (id)
);

-- Join entity ContactGroup <-> Person (M:N with extra columns role/joinedAt)
-- — a person can be in many groups, a group can have many members (BR-01).
CREATE TABLE "ContactGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER'::"GroupRole",
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Projects (FR-06, BR-06, BR-07) — ties many meetings together.
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE'::"ProjectStatus",
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "managerId" UUID,
    PRIMARY KEY (id)
);

-- Join entity Project <-> Person (M:N) — a meeting's participants in the
-- same project don't need to be the same set as the project's members (BR-07).
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Reusable Online Meeting Link (FR-07, BR-09, BR-10) — one link can be
-- reused across many meetings; editing name/url here updates every meeting
-- that references it, since none of them copy the URL for themselves.
CREATE TABLE "OnlineMeetingResource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    PRIMARY KEY (id)
);

-- Meetings (FR-04/05/06, BR-05/06/08) — the system's central table. Every
-- meeting is managed as its own independent row (BR-05/08).
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "MeetingType" NOT NULL DEFAULT 'SINGLE'::"MeetingType",
    "status" "MeetingStatus" NOT NULL DEFAULT 'PENDING'::"MeetingStatus",
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizerPersonId" TEXT,
    "projectId" TEXT,
    "onlineMeetingResourceId" TEXT,
    "organizerId" UUID,
    PRIMARY KEY (id)
);

-- Each meeting's participants, with where they came from — join entity
-- Meeting <-> Person (BR-04).
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'ATTENDEE'::"ParticipantRole",
    "rsvpStatus" "RsvpStatus" NOT NULL DEFAULT 'PENDING'::"RsvpStatus",
    "source" "ParticipantSource" NOT NULL DEFAULT 'DIRECT'::"ParticipantSource",
    "sourceGroupId" TEXT,
    PRIMARY KEY (id)
);

-- Many-to-many "invite the whole group": ContactGroup <-> Meeting. No extra
-- columns, so it's a plain Prisma implicit join table (unlike
-- ContactGroupMember, which carries role/joinedAt). Column names "A"/"B"
-- are Prisma's standard auto-generated convention.
CREATE TABLE "_MeetingGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    PRIMARY KEY ("A", "B")
);

-- Meeting context: Notes/Decisions/RelatedResource (FR-11/12/13, BR-15) —
-- each is its own multi-row-per-meeting entity, replacing the old
-- single-value Meeting.description.

CREATE TABLE "MeetingNote" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" UUID,
    PRIMARY KEY (id)
);

-- Decision has no projectId of its own, deliberately — it traces back to a
-- project only via meeting.projectId, so a decision can never point at a
-- different project than its own meeting (FR-13).
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    PRIMARY KEY (id)
);

CREATE TABLE "RelatedResource" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL DEFAULT 'LINK'::"ResourceType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" UUID,
    PRIMARY KEY (id)
);

-- Tasks / Action Items (FR-14, BR-16).
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED'::"TaskStatus",
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM'::"TaskPriority",
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "assigneePersonId" TEXT,
    "projectId" TEXT,
    "meetingId" TEXT,
    "assigneeId" UUID,
    "createdById" UUID,
    PRIMARY KEY (id)
);

CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" UUID,
    PRIMARY KEY (id)
);

CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- Reminders (FR-10, BR-11/12/13/14) — one meeting can have many reminders
-- (BR-11), each individually trackable (BR-12).
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING'::"ReminderStatus",
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

-- In-app Notifications.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    PRIMARY KEY (id)
);

-- AI Summaries (FR-15, BR-18/19/20) — unique meetingId makes this genuinely
-- 1-1 with Meeting; a new summary UPDATEs this row rather than inserting a
-- new one, and never touches MeetingNote/Decision/RelatedResource, which
-- are entirely separate tables (BR-18/20).
CREATE TABLE "AISummary" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" TEXT,
    "model" TEXT NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);


-- =============================================================================
-- 3. INDEXES — everything except the unique indexes PRIMARY KEY already
--    created implicitly in section 2. The 4 marked "(re-added by the uuid
--    migration)" were dropped and recreated by
--    20260910142937_supabase_auth_uuid_migration when their column was
--    converted text -> uuid.
-- =============================================================================

CREATE UNIQUE INDEX "AISummary_meetingId_key" ON "AISummary" ("meetingId");
CREATE UNIQUE INDEX "ContactGroupMember_groupId_personId_key" ON "ContactGroupMember" ("groupId", "personId");
CREATE INDEX "ContactGroupMember_personId_idx" ON "ContactGroupMember" ("personId");
CREATE INDEX "Decision_meetingId_idx" ON "Decision" ("meetingId");
CREATE INDEX "Meeting_onlineMeetingResourceId_idx" ON "Meeting" ("onlineMeetingResourceId");
CREATE INDEX "Meeting_startTime_idx" ON "Meeting" ("startTime");
CREATE INDEX "Meeting_status_idx" ON "Meeting" (status);
CREATE INDEX "MeetingNote_meetingId_idx" ON "MeetingNote" ("meetingId");
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_personId_key" ON "MeetingParticipant" ("meetingId", "personId");
CREATE INDEX "MeetingParticipant_personId_idx" ON "MeetingParticipant" ("personId");
CREATE INDEX "MeetingParticipant_sourceGroupId_idx" ON "MeetingParticipant" ("sourceGroupId");
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification" ("userId", "isRead"); -- (re-added by the uuid migration)
CREATE INDEX "OnlineMeetingResource_name_idx" ON "OnlineMeetingResource" (name);
CREATE INDEX "PasswordResetOtp_userId_idx" ON "PasswordResetOtp" ("userId"); -- (re-added by the uuid migration)
CREATE UNIQUE INDEX "Person_email_key" ON "Person" (email);
CREATE INDEX "Person_status_idx" ON "Person" (status);
CREATE INDEX "Person_type_idx" ON "Person" (type);
CREATE UNIQUE INDEX "Person_userId_key" ON "Person" ("userId"); -- (re-added by the uuid migration)
CREATE INDEX "ProjectMember_personId_idx" ON "ProjectMember" ("personId");
CREATE UNIQUE INDEX "ProjectMember_projectId_personId_key" ON "ProjectMember" ("projectId", "personId");
CREATE INDEX "RelatedResource_meetingId_idx" ON "RelatedResource" ("meetingId");
CREATE INDEX "Reminder_meetingId_idx" ON "Reminder" ("meetingId");
CREATE INDEX "Reminder_status_idx" ON "Reminder" (status);
CREATE INDEX "Task_assigneeId_idx" ON "Task" ("assigneeId"); -- (re-added by the uuid migration)
CREATE INDEX "Task_dueDate_idx" ON "Task" ("dueDate");
CREATE INDEX "Task_status_idx" ON "Task" (status);
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment" ("taskId");
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment" ("taskId");
CREATE UNIQUE INDEX "User_email_key" ON "User" (email);
CREATE INDEX "_MeetingGroups_B_index" ON "_MeetingGroups" ("B");


-- =============================================================================
-- 4. FOREIGN KEYS — added after every table exists. Includes the one
--    cross-schema FK: "User".id -> auth.users.id (Supabase Auth's own
--    table, not part of this application's schema).
-- =============================================================================

ALTER TABLE "User" ADD CONSTRAINT "User_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "PasswordResetOtp" ADD CONSTRAINT "PasswordResetOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "ContactGroupMember" ADD CONSTRAINT "ContactGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ContactGroup"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "ContactGroupMember" ADD CONSTRAINT "ContactGroupMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "OnlineMeetingResource" ADD CONSTRAINT "OnlineMeetingResource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerPersonId_fkey" FOREIGN KEY ("organizerPersonId") REFERENCES "Person"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_onlineMeetingResourceId_fkey" FOREIGN KEY ("onlineMeetingResourceId") REFERENCES "OnlineMeetingResource"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_sourceGroupId_fkey" FOREIGN KEY ("sourceGroupId") REFERENCES "ContactGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "_MeetingGroups" ADD CONSTRAINT "_MeetingGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "ContactGroup"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "_MeetingGroups" ADD CONSTRAINT "_MeetingGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "RelatedResource" ADD CONSTRAINT "RelatedResource_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "RelatedResource" ADD CONSTRAINT "RelatedResource_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneePersonId_fkey" FOREIGN KEY ("assigneePersonId") REFERENCES "Person"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "AISummary" ADD CONSTRAINT "AISummary_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- =============================================================================
-- 5. ROW LEVEL SECURITY — 2 SECURITY DEFINER helper functions + 72 policies
--    across all 20 tables. Verbatim from
--    prisma/migrations/20260911120000_enable_rls_policies/migration.sql
--    (already applied to and verified against the live database — see
--    scripts/test-rls.ts and that migration's own header for the full
--    design rationale). Reproduced here in full, not summarized, so this
--    file alone is enough to rebuild the database from nothing.
-- =============================================================================

-- ------------------------------------------------------------------
-- Step A: helper functions
-- ------------------------------------------------------------------
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

-- ------------------------------------------------------------------
-- Step B + C: per table — GRANT, then policies, then ENABLE RLS last.
-- Every policy is scoped `TO authenticated` only — `anon` gets nothing,
-- matching src/proxy.ts already requiring a logged-in session on every
-- page/route.
-- ------------------------------------------------------------------

-- User — select: everyone logged in · insert: admin only ·
-- update: self or admin · delete: admin only
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

-- Person — select/insert: everyone logged in ·
-- update: unlinked (userId null) is open to all, linked only to its
-- owner or admin · delete: admin only
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

-- ContactGroup — select/insert: everyone logged in ·
-- update/delete: creator or admin
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

-- ContactGroupMember — select: everyone logged in ·
-- insert/delete: the owning group's creator or admin · no UPDATE (no route)
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

-- Project — select/insert: everyone logged in · update/delete: manager or admin
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

-- ProjectMember — select: everyone logged in ·
-- insert/delete: the owning project's manager or admin · no UPDATE (no route)
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

-- Meeting — select/insert: everyone logged in · update/delete: organizer or admin
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

-- MeetingParticipant — select: everyone logged in ·
-- insert/delete: the meeting's organizer or admin · no UPDATE (no route)
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

-- MeetingNote — select: everyone logged in ·
-- insert/update/delete: the meeting's organizer, a participant, or admin
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

-- Decision — same shape as MeetingNote
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

-- RelatedResource — same shape as MeetingNote
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

-- OnlineMeetingResource — select/insert: everyone logged in ·
-- update/delete: unclaimed (createdById null) is open to all, claimed only
-- to its creator or admin
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

-- Task — select/insert: everyone logged in ·
-- update: assignee, creator, or admin · delete: creator only (not
-- assignee) or admin
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

-- TaskComment — select: everyone logged in ·
-- insert: the task's assignee, creator, or admin ·
-- update/delete: no route exists yet — closed to admin only
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

-- TaskAttachment — same shape as TaskComment
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

-- Reminder — select: everyone logged in ·
-- insert/update/delete: the meeting's organizer or admin
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

-- Notification — personal data: owner-only, no admin bypass on
-- select/update (deliberately narrower than assertOwner()'s usual
-- always-admin-bypass pattern, since there is no route/UI today that
-- needs an admin to read or mark-read someone else's notifications) ·
-- insert: admin/server only (no UI creates these directly — every real
-- insert happens server-side via Prisma, which bypasses RLS anyway) ·
-- delete: admin only
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

-- AISummary — select: everyone logged in ·
-- insert/update: the meeting's organizer only (unlike note/decision/
-- resource, participants are NOT included) or admin · delete: admin only
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

-- PasswordResetOtp — deny-all. No GRANT to authenticated/anon and no
-- policies of any kind: RLS with zero policies default-denies every row
-- for every non-bypassing role. Used exclusively server-side via Prisma
-- (which always bypasses RLS as the "postgres" role), so this table
-- should never be reachable through supabase-js/PostgREST at all.
ALTER TABLE public."PasswordResetOtp" ENABLE ROW LEVEL SECURITY;

-- _MeetingGroups (implicit M:N join table for Meeting.groups /
-- ContactGroup.meetings — "A" = ContactGroup.id, "B" = Meeting.id) —
-- select: everyone logged in · insert/delete: the meeting's organizer or
-- admin · no UPDATE (join rows are add/remove only, no route)
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


-- =============================================================================
-- 6. VIEWS (2) — requirements.md §8 items 4 and 9. Verbatim from
--    prisma/migrations/20260911130000_upcoming_meetings_overdue_action_items_views
-- =============================================================================

-- WITH (security_invoker = true): without it a view runs with the
-- privileges/RLS context of its owner instead of the querying role,
-- silently bypassing RLS. Both source tables' SELECT policies are already
-- "everyone logged in", so this view exposes nothing a signed-in user
-- couldn't already query directly.
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


-- =============================================================================
-- 7. FUNCTIONS (2) — requirements.md §8 items 7 and 14. SECURITY INVOKER
--    (not DEFINER like the RLS helpers above) — these only read data, they
--    never need to cross another user's RLS. Verbatim from
--    prisma/migrations/20260911140000_process_due_reminders_function and
--    20260911150000_get_meeting_context_function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS SETOF public."Reminder"
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
STABLE
AS $$
  SELECT *
  FROM public."Reminder"
  WHERE status = 'PENDING'
    AND "scheduledAt" <= now()
  ORDER BY "scheduledAt" ASC;
$$;

COMMENT ON FUNCTION public.process_due_reminders() IS
  'requirements.md §8.7 / FR-10 / BR-13 — every Reminder still PENDING whose scheduledAt has passed. Read-only; does not mark rows SENT (that still happens in src/app/api/reminders/process-due/route.ts after the email send succeeds).';

REVOKE ALL ON FUNCTION public.process_due_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO authenticated;

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


-- =============================================================================
-- 8. TRIGGER (1) — BR-14: fills the "0 triggers" gap that existed until
--    this was added. Verbatim from
--    prisma/migrations/20260911160000_cancel_meeting_reminders_trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_meeting_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
    UPDATE public."Reminder"
    SET status = 'CANCELLED'
    WHERE "meetingId" = NEW.id
      AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cancel_meeting_reminders() IS
  'BR-14: when Meeting.status transitions to CANCELLED, auto-cancels every still-PENDING Reminder for that meeting. Fired by trg_cancel_meeting_reminders. Replaces the updateMany() previously in src/app/api/meetings/[id]/cancel/route.ts.';

DROP TRIGGER IF EXISTS trg_cancel_meeting_reminders ON public."Meeting";
CREATE TRIGGER trg_cancel_meeting_reminders
AFTER UPDATE OF status ON public."Meeting"
FOR EACH ROW
WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
EXECUTE FUNCTION public.cancel_meeting_reminders();


-- =============================================================================
-- ✅ VERIFIED — no local Postgres/Docker is available in this environment to
-- spin up a truly separate empty database (`supabase db dump`/pg_dump also
-- confirmed this — see the top of this file), so this file's every
-- `public.` qualifier (schema-qualified statements: CREATE POLICY ... ON
-- public."X", CREATE VIEW public.x, functions, the cross-schema FK's own
-- schema stays untouched since it's auth.users, not public) was mechanically
-- replaced with a throwaway schema name and the whole file was run against
-- that fresh, empty schema in the SAME live Supabase database — real
-- Postgres 17, real `auth.users`/`auth.uid()`, zero stubbing — via
-- `prisma db execute`. Result: all 20 tables, 15 enums, 72 RLS policies, 5
-- functions, 1 trigger and 2 views were created with zero errors, then
-- `DROP SCHEMA ... CASCADE` removed every trace of it — confirmed after
-- with a query showing the schema no longer exists. Raw counts from that
-- run are in this deliverable's accompanying report.
-- See docs/deliverables/DATA_DICTIONARY.md and ER_DIAGRAM.md for narrative
-- documentation of every table/enum/relationship, and QUERIES.sql for the
-- 15 requirements.md §8 queries run against the real `public` schema this
-- file describes.
-- =============================================================================
