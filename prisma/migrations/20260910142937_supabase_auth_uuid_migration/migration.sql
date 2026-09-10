-- Migrate public.User (and every FK that points at it) from cuid ids to the
-- uuids provisioned in Supabase Auth (auth.users), and link the two via a
-- cross-schema FK. This migration was authored and applied by hand via
-- scripts/.tmp-migration/migrate-schema.ts (in two transactional phases,
-- verified in between) rather than `prisma migrate dev`, because it carries
-- data (a real id mapping for 5 existing users) alongside the DDL. This file
-- exists so `prisma migrate status` / history stays accurate; it is recorded
-- as already-applied via `prisma migrate resolve --applied`.
--
-- Source of truth for the mapping: scripts/.tmp-migration/migration-id-map.json
--   cmtu2oe6p0000uwusqt2mcu3f -> 02e47074-37ed-447f-bc1d-faa1288ea628 (somchai@smartmeeting.dev)
--   cmtu2oeh70003uwuskz9ibjgh -> 4c6540cb-70bd-4bbc-bb68-4589620144b6 (wichai@smartmeeting.dev)
--   cmtu2oeh60002uwusc4mckdgq -> 39676f2c-39a5-48f4-893c-66a630486b87 (narin@smartmeeting.dev)
--   cmtu2oeh70004uwusuz5rcnok -> c17443d6-956b-4b4f-8ba2-9223132e3eb4 (siriporn@smartmeeting.dev)
--   cmtu2oeh60001uwuse6b2tu0p -> be5e2278-3235-4a07-87aa-b74ecd87b889 (kittichai@smartmeeting.dev)
--
-- Each of these 5 users was already created in Supabase Auth (auth.users)
-- with the matching uuid as its id, before this migration ran (see
-- scripts/.tmp-migration/create-auth-users.ts).

-- ============================================================
-- Phase 1: add parallel uuid columns and backfill from the mapping.
-- ============================================================

ALTER TABLE "User" ADD COLUMN "id_new" UUID;
ALTER TABLE "ContactGroup" ADD COLUMN "createdById_new" UUID;
ALTER TABLE "Decision" ADD COLUMN "decidedById_new" UUID;
ALTER TABLE "Meeting" ADD COLUMN "organizerId_new" UUID;
ALTER TABLE "MeetingNote" ADD COLUMN "authorId_new" UUID;
ALTER TABLE "Notification" ADD COLUMN "userId_new" UUID;
ALTER TABLE "OnlineMeetingResource" ADD COLUMN "createdById_new" UUID;
ALTER TABLE "PasswordResetOtp" ADD COLUMN "userId_new" UUID;
ALTER TABLE "Person" ADD COLUMN "userId_new" UUID;
ALTER TABLE "Project" ADD COLUMN "managerId_new" UUID;
ALTER TABLE "RelatedResource" ADD COLUMN "addedById_new" UUID;
ALTER TABLE "Task" ADD COLUMN "assigneeId_new" UUID;
ALTER TABLE "Task" ADD COLUMN "createdById_new" UUID;
ALTER TABLE "TaskComment" ADD COLUMN "authorId_new" UUID;

UPDATE "User" u SET "id_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE u.id = m.old_id;

UPDATE "ContactGroup" t SET "createdById_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."createdById" = m.old_id;

UPDATE "Decision" t SET "decidedById_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."decidedById" = m.old_id;

UPDATE "Meeting" t SET "organizerId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."organizerId" = m.old_id;

UPDATE "MeetingNote" t SET "authorId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."authorId" = m.old_id;

UPDATE "Notification" t SET "userId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."userId" = m.old_id;

UPDATE "OnlineMeetingResource" t SET "createdById_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."createdById" = m.old_id;

UPDATE "PasswordResetOtp" t SET "userId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."userId" = m.old_id;

UPDATE "Person" t SET "userId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."userId" = m.old_id;

UPDATE "Project" t SET "managerId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."managerId" = m.old_id;

UPDATE "RelatedResource" t SET "addedById_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."addedById" = m.old_id;

UPDATE "Task" t SET "assigneeId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."assigneeId" = m.old_id;

UPDATE "Task" t SET "createdById_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."createdById" = m.old_id;

UPDATE "TaskComment" t SET "authorId_new" = m.new_id FROM (VALUES
  ('cmtu2oe6p0000uwusqt2mcu3f', '02e47074-37ed-447f-bc1d-faa1288ea628'::uuid),
  ('cmtu2oeh70003uwuskz9ibjgh', '4c6540cb-70bd-4bbc-bb68-4589620144b6'::uuid),
  ('cmtu2oeh60002uwusc4mckdgq', '39676f2c-39a5-48f4-893c-66a630486b87'::uuid),
  ('cmtu2oeh70004uwusuz5rcnok', 'c17443d6-956b-4b4f-8ba2-9223132e3eb4'::uuid),
  ('cmtu2oeh60001uwuse6b2tu0p', 'be5e2278-3235-4a07-87aa-b74ecd87b889'::uuid)
) AS m(old_id, new_id) WHERE t."authorId" = m.old_id;

-- Verified before phase 2: zero NULL "id_new" on "User" and zero rows where
-- an old FK column was non-null but its "*_new" companion stayed NULL.

-- ============================================================
-- Phase 2: drop old cuid columns/FKs, promote the uuid columns, re-link.
-- ============================================================

ALTER TABLE "ContactGroup" DROP CONSTRAINT "ContactGroup_createdById_fkey";
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_decidedById_fkey";
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_organizerId_fkey";
ALTER TABLE "MeetingNote" DROP CONSTRAINT "MeetingNote_authorId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
ALTER TABLE "OnlineMeetingResource" DROP CONSTRAINT "OnlineMeetingResource_createdById_fkey";
ALTER TABLE "PasswordResetOtp" DROP CONSTRAINT "PasswordResetOtp_userId_fkey";
ALTER TABLE "Person" DROP CONSTRAINT "Person_userId_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_managerId_fkey";
ALTER TABLE "RelatedResource" DROP CONSTRAINT "RelatedResource_addedById_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_authorId_fkey";

ALTER TABLE "ContactGroup" DROP COLUMN "createdById";
ALTER TABLE "Decision" DROP COLUMN "decidedById";
ALTER TABLE "Meeting" DROP COLUMN "organizerId";
ALTER TABLE "MeetingNote" DROP COLUMN "authorId";
ALTER TABLE "Notification" DROP COLUMN "userId";
ALTER TABLE "OnlineMeetingResource" DROP COLUMN "createdById";
ALTER TABLE "PasswordResetOtp" DROP COLUMN "userId";
ALTER TABLE "Person" DROP COLUMN "userId";
ALTER TABLE "Project" DROP COLUMN "managerId";
ALTER TABLE "RelatedResource" DROP COLUMN "addedById";
ALTER TABLE "Task" DROP COLUMN "assigneeId";
ALTER TABLE "Task" DROP COLUMN "createdById";
ALTER TABLE "TaskComment" DROP COLUMN "authorId";

ALTER TABLE "ContactGroup" RENAME COLUMN "createdById_new" TO "createdById";
ALTER TABLE "Decision" RENAME COLUMN "decidedById_new" TO "decidedById";
ALTER TABLE "Meeting" RENAME COLUMN "organizerId_new" TO "organizerId";
ALTER TABLE "MeetingNote" RENAME COLUMN "authorId_new" TO "authorId";
ALTER TABLE "Notification" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "OnlineMeetingResource" RENAME COLUMN "createdById_new" TO "createdById";
ALTER TABLE "PasswordResetOtp" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "Person" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "Project" RENAME COLUMN "managerId_new" TO "managerId";
ALTER TABLE "RelatedResource" RENAME COLUMN "addedById_new" TO "addedById";
ALTER TABLE "Task" RENAME COLUMN "assigneeId_new" TO "assigneeId";
ALTER TABLE "Task" RENAME COLUMN "createdById_new" TO "createdById";
ALTER TABLE "TaskComment" RENAME COLUMN "authorId_new" TO "authorId";

ALTER TABLE "User" DROP COLUMN "id";
ALTER TABLE "User" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "User" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- Profile-table pattern: public."User".id is the same uuid as auth.users.id.
-- Deliberately no `on_auth_user_created` auto-provisioning trigger — every
-- public."User" row is still created explicitly by application code right
-- after supabase.auth.admin.createUser() (see prisma/seed.ts and
-- scripts/test-authorization.ts), so an auto-insert trigger would collide
-- with that explicit insert. ON DELETE CASCADE: deleting the auth.users row
-- is the source-of-truth deletion; the profile row should not outlive it.
ALTER TABLE "User" ADD CONSTRAINT "User_id_fkey" FOREIGN KEY ("id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "OnlineMeetingResource" ADD CONSTRAINT "OnlineMeetingResource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "PasswordResetOtp" ADD CONSTRAINT "PasswordResetOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "RelatedResource" ADD CONSTRAINT "RelatedResource_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");
CREATE INDEX "PasswordResetOtp_userId_idx" ON "PasswordResetOtp"("userId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- The old JWT/bcrypt login system's password column is gone — Supabase Auth
-- (auth.users.encrypted_password, seeded from this column's bcrypt hashes in
-- step A) is now the only place a password is stored.
ALTER TABLE "User" DROP COLUMN "passwordHash";
