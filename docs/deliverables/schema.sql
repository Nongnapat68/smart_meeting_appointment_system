-- =============================================================================
-- schema.sql — Smart Meeting & Appointment Management System
-- =============================================================================
-- รวมและจัดกลุ่ม DDL จาก 2 ไฟล์ migration ของ Prisma ให้เป็นไฟล์เดียวที่อ่านง่าย
-- สำหรับส่งอาจารย์ (ไม่ใช่ raw output ของ Prisma):
--   - prisma/migrations/20260905114946_init/migration.sql
--   - prisma/migrations/20260906020941_add_notes_decisions_resources_online_link_participant_source/migration.sql
--
-- ไฟล์นี้แสดง "สถานะปัจจุบันจริง" ของทุกตาราง (ไม่ใช่ diff แบบ ALTER TABLE ที่ Prisma
-- ใช้ตอน migrate) เรียงตามลำดับที่รันแล้วไม่ชน FK constraint (parent ก่อน child เสมอ)
-- จัดกลุ่มตามโดเมนเดียวกับ prisma/schema.prisma
--
-- Dialect: SQLite (dev database จริงที่ `prisma/dev.db`, กำหนดด้วย DATABASE_URL="file:./dev.db")
-- ตรวจสอบแล้วว่ารันได้จริงแบบ end-to-end จากไฟล์เปล่าด้วย `node:sqlite` (ดูท้ายไฟล์)
--
-- หมายเหตุสำหรับ production (ตามคอมเมนต์ต้นไฟล์ schema.prisma): ถ้าย้ายไป PostgreSQL
-- ให้แทนที่ TEXT → VARCHAR/TEXT ปกติ, DATETIME → TIMESTAMPTZ, BOOLEAN คงเดิม (Postgres มี native
-- boolean), INTEGER คงเดิม — โครงสร้างตาราง/FK/index ทั้งหมดเหมือนกันทุกจุด ไม่ต้องออกแบบใหม่
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- 1. AUTH / USERS
-- =============================================================================

-- ผู้ใช้งานที่ login เข้าระบบได้ (สมาชิกภายในองค์กร)
CREATE TABLE "User" (
    "id"                 TEXT     NOT NULL PRIMARY KEY,
    "email"              TEXT     NOT NULL,                       -- ใช้ login, ต้องไม่ซ้ำ
    "passwordHash"       TEXT     NOT NULL,                       -- bcrypt hash เท่านั้น ห้ามเก็บ plaintext
    "name"               TEXT     NOT NULL,
    "avatarUrl"          TEXT,
    "phone"              TEXT,
    "title"              TEXT,                                    -- ตำแหน่งงาน
    "department"         TEXT,
    "role"               TEXT     NOT NULL DEFAULT 'MEMBER',       -- enum: ADMIN | MEMBER
    "emailNotifications" BOOLEAN  NOT NULL DEFAULT true,
    "inAppNotifications" BOOLEAN  NOT NULL DEFAULT true,
    "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- OTP สำหรับ flow "ลืมรหัสผ่าน" — 1 user มีได้หลายรายการ (ขอใหม่ทุกครั้ง)
CREATE TABLE "PasswordResetOtp" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "userId"    TEXT     NOT NULL,
    "otpHash"   TEXT     NOT NULL,                                 -- hash ของ OTP 6 หลัก ไม่เก็บ plaintext
    "expiresAt" DATETIME NOT NULL,
    "usedAt"    DATETIME,                                          -- ป้องกันใช้ OTP ซ้ำ
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetOtp_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PasswordResetOtp_userId_idx" ON "PasswordResetOtp"("userId");

-- =============================================================================
-- 2. PEOPLE / CONTACTS (FR-01)
-- =============================================================================

-- ผู้ติดต่อที่อาจถูกเชิญเข้าร่วมประชุม — คนละ entity กับ User: อาจเป็นพนักงานภายใน
-- (ผูกกับ User ผ่าน userId) หรือบุคคลภายนอกที่ไม่มีบัญชี login ก็ได้
CREATE TABLE "Person" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "name"       TEXT     NOT NULL,
    "email"      TEXT     NOT NULL,                                -- unique กันสร้างผู้ติดต่อซ้ำ
    "phone"      TEXT,
    "avatarUrl"  TEXT,
    "title"      TEXT,
    "department" TEXT,
    "type"       TEXT     NOT NULL DEFAULT 'EXTERNAL',              -- enum: INTERNAL | EXTERNAL
    "status"     TEXT     NOT NULL DEFAULT 'ACTIVE',                -- enum: ACTIVE | INACTIVE (แทน hard delete — BR-02)
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  DATETIME NOT NULL,
    "userId"     TEXT,                                              -- มีค่าเมื่อเป็น INTERNAL เท่านั้น
    CONSTRAINT "Person_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");
CREATE INDEX "Person_type_idx" ON "Person"("type");
CREATE INDEX "Person_status_idx" ON "Person"("status");

-- =============================================================================
-- 3. CONTACT GROUPS (FR-02, BR-01)
-- =============================================================================

-- กลุ่มผู้ติดต่อที่สร้างไว้ใช้ซ้ำ เช่น ทีมโครงการ, คณะกรรมการ, ทีมวิจัย
CREATE TABLE "ContactGroup" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "name"        TEXT     NOT NULL,
    "description" TEXT,
    "icon"        TEXT     NOT NULL DEFAULT 'group',                -- ชื่อ Material Symbol
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "ContactGroup_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Join entity ContactGroup <-> Person (many-to-many ที่มีคอลัมน์เสริม role/joinedAt)
-- บุคคลหนึ่งอยู่ได้หลายกลุ่ม, กลุ่มหนึ่งมีได้หลายสมาชิก (BR-01)
CREATE TABLE "ContactGroupMember" (
    "id"       TEXT     NOT NULL PRIMARY KEY,
    "groupId"  TEXT     NOT NULL,
    "personId" TEXT     NOT NULL,
    "role"     TEXT     NOT NULL DEFAULT 'MEMBER',                  -- enum: LEADER | MEMBER
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactGroupMember_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "ContactGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactGroupMember_personId_fkey"
        FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ContactGroupMember_personId_idx" ON "ContactGroupMember"("personId");
-- 1 คนเป็นสมาชิกกลุ่มเดียวกันซ้ำไม่ได้
CREATE UNIQUE INDEX "ContactGroupMember_groupId_personId_key" ON "ContactGroupMember"("groupId", "personId");

-- =============================================================================
-- 4. PROJECTS (FR-06, BR-06, BR-07)
-- =============================================================================

-- โครงการที่ผูกการประชุมหลายครั้งเข้าด้วยกัน
CREATE TABLE "Project" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "name"        TEXT     NOT NULL,
    "description" TEXT,
    "status"      TEXT     NOT NULL DEFAULT 'ACTIVE',               -- enum: ACTIVE|PENDING|DELAYED|COMPLETED
    "startDate"   DATETIME,
    "endDate"     DATETIME,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    "managerId"   TEXT,                                             -- ผู้จัดการโครงการ มีสิทธิ์แก้ไข/ลบ
    CONSTRAINT "Project_managerId_fkey"
        FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Join entity Project <-> Person (many-to-many)
-- ผู้เข้าร่วมของ meeting ใน project เดียวกันไม่จำเป็นต้องเป็นชุดเดียวกับสมาชิก project (BR-07)
CREATE TABLE "ProjectMember" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "projectId" TEXT     NOT NULL,
    "personId"  TEXT     NOT NULL,
    "joinedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMember_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_personId_fkey"
        FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProjectMember_personId_idx" ON "ProjectMember"("personId");
CREATE UNIQUE INDEX "ProjectMember_projectId_personId_key" ON "ProjectMember"("projectId", "personId");

-- =============================================================================
-- 5. REUSABLE ONLINE MEETING LINK (FR-07, BR-09, BR-10)
-- =============================================================================

-- ลิงก์ประชุมออนไลน์ (เช่น Teams/Zoom/Google Meet ที่สร้างไว้นอกระบบ) ที่นำมาใช้ซ้ำ
-- กับหลาย meeting ได้ — แก้ไข name/url ที่นี่จุดเดียว มีผลกับทุก meeting ที่อ้างอิงทันที
-- ผ่าน FK (ไม่มี meeting ไหน copy url ของตัวเองแยกไว้)
CREATE TABLE "OnlineMeetingResource" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "name"        TEXT     NOT NULL,
    "url"         TEXT     NOT NULL,
    "createdById" TEXT,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "OnlineMeetingResource_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "OnlineMeetingResource_name_idx" ON "OnlineMeetingResource"("name");

-- =============================================================================
-- 6. MEETINGS (FR-04, FR-05, FR-06, BR-05, BR-06, BR-08)
-- =============================================================================

-- ตารางศูนย์กลางของระบบ — นัดหมาย/การประชุมแต่ละครั้ง จัดการแยกจากกันได้เสมอ (BR-05, BR-08)
CREATE TABLE "Meeting" (
    "id"                      TEXT     NOT NULL PRIMARY KEY,
    "title"                   TEXT     NOT NULL,
    "description"             TEXT,                                 -- agenda ตอนนัด (คนละส่วนกับ MeetingNote)
    "type"                    TEXT     NOT NULL DEFAULT 'SINGLE',    -- enum: SINGLE | PROJECT (FR-05)
    "status"                  TEXT     NOT NULL DEFAULT 'PENDING',   -- enum: PENDING|ACTIVE|COMPLETED|CANCELLED|POSTPONED
    "startTime"               DATETIME NOT NULL,
    "endTime"                 DATETIME NOT NULL,
    "location"                TEXT,                                 -- ห้องจริง หรือ raw text link
    "createdAt"               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               DATETIME NOT NULL,
    "organizerId"             TEXT,                                 -- ผู้จัด (User)
    "organizerPersonId"       TEXT,                                 -- ผู้จัด (Person/contact)
    "projectId"               TEXT,                                 -- NULL ได้ตาม BR-06
    "onlineMeetingResourceId" TEXT,                                 -- NULL ได้ — ใช้ location แทนก็ได้
    CONSTRAINT "Meeting_organizerId_fkey"
        FOREIGN KEY ("organizerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Meeting_organizerPersonId_fkey"
        FOREIGN KEY ("organizerPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Meeting_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Meeting_onlineMeetingResourceId_fkey"
        FOREIGN KEY ("onlineMeetingResourceId") REFERENCES "OnlineMeetingResource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");
CREATE INDEX "Meeting_startTime_idx" ON "Meeting"("startTime");
CREATE INDEX "Meeting_onlineMeetingResourceId_idx" ON "Meeting"("onlineMeetingResourceId");

-- ผู้เข้าร่วมของแต่ละ meeting พร้อมแหล่งที่มา — join entity Meeting <-> Person
CREATE TABLE "MeetingParticipant" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "meetingId"     TEXT NOT NULL,
    "personId"      TEXT NOT NULL,
    "role"          TEXT NOT NULL DEFAULT 'ATTENDEE',                -- enum: ORGANIZER | ATTENDEE
    "rsvpStatus"    TEXT NOT NULL DEFAULT 'PENDING',                 -- enum: PENDING|ACCEPTED|DECLINED
    "source"        TEXT NOT NULL DEFAULT 'DIRECT',                  -- enum: DIRECT|GROUP|EXTERNAL (BR-04)
    "sourceGroupId" TEXT,                                            -- กลุ่มต้นทางถ้า source = GROUP
    CONSTRAINT "MeetingParticipant_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- RESTRICT ไม่ใช่ CASCADE โดยตั้งใจ: ห้าม hard-delete Person ที่เคยเข้าประชุมมาแล้ว
    -- เพื่อไม่ให้ประวัติการเข้าร่วมประชุมหายไปเงียบๆ (BR-02) — ดู DELETE /api/people/[id]
    CONSTRAINT "MeetingParticipant_personId_fkey"
        FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingParticipant_sourceGroupId_fkey"
        FOREIGN KEY ("sourceGroupId") REFERENCES "ContactGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MeetingParticipant_personId_idx" ON "MeetingParticipant"("personId");
CREATE INDEX "MeetingParticipant_sourceGroupId_idx" ON "MeetingParticipant"("sourceGroupId");
-- 1 คนเข้าร่วม meeting เดียวกันซ้ำไม่ได้ แม้ถูกเลือกจากหลายแหล่งพร้อมกัน (BR-04)
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_personId_key" ON "MeetingParticipant"("meetingId", "personId");

-- Many-to-many "เชิญทั้งกลุ่ม": ContactGroup <-> Meeting — ไม่มีคอลัมน์เสริม จึงเป็น
-- implicit join table ล้วนๆ (ต่างจาก ContactGroupMember ที่มี role/joinedAt)
-- ชื่อคอลัมน์ A/B และชื่อตารางเป็นรูปแบบมาตรฐานที่ Prisma ตั้งให้อัตโนมัติ
CREATE TABLE "_MeetingGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_MeetingGroups_A_fkey"
        FOREIGN KEY ("A") REFERENCES "ContactGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_MeetingGroups_B_fkey"
        FOREIGN KEY ("B") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "_MeetingGroups_AB_unique" ON "_MeetingGroups"("A", "B");
CREATE INDEX "_MeetingGroups_B_index" ON "_MeetingGroups"("B");

-- =============================================================================
-- 7. MEETING CONTEXT: NOTES / DECISIONS / RELATED RESOURCES (FR-11/12/13, BR-15)
-- =============================================================================
-- แต่ละ entity แยกจากกัน หลายแถวต่อ 1 meeting ได้ แทนที่ Meeting.description แบบเดิม
-- ที่เก็บได้ค่าเดียว — ทำให้ meeting สะสมบันทึก/มติ/เอกสารได้เรื่อยๆ ตลอดอายุโครงการ

CREATE TABLE "MeetingNote" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "meetingId" TEXT     NOT NULL,
    "content"   TEXT     NOT NULL,
    "authorId"  TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingNote_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingNote_authorId_fkey"
        FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MeetingNote_meetingId_idx" ON "MeetingNote"("meetingId");

-- Decision ไม่มี projectId ของตัวเอง โดยตั้งใจ — ย้อนกลับไป project ผ่าน meeting.projectId
-- เท่านั้น กัน decision ชี้ไป project คนละอันกับ meeting ต้นทาง (FR-13)
CREATE TABLE "Decision" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "meetingId"   TEXT     NOT NULL,
    "content"     TEXT     NOT NULL,
    "decidedById" TEXT,
    "decidedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Decision_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Decision_decidedById_fkey"
        FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Decision_meetingId_idx" ON "Decision"("meetingId");

CREATE TABLE "RelatedResource" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "meetingId" TEXT     NOT NULL,
    "title"     TEXT     NOT NULL,
    "url"       TEXT     NOT NULL,
    "type"      TEXT     NOT NULL DEFAULT 'LINK',                    -- enum: LINK | DOCUMENT | FILE
    "addedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RelatedResource_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RelatedResource_addedById_fkey"
        FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "RelatedResource_meetingId_idx" ON "RelatedResource"("meetingId");

-- =============================================================================
-- 8. TASKS / ACTION ITEMS (FR-14, BR-16)
-- =============================================================================

CREATE TABLE "Task" (
    "id"               TEXT     NOT NULL PRIMARY KEY,
    "title"            TEXT     NOT NULL,
    "description"      TEXT,
    "status"           TEXT     NOT NULL DEFAULT 'NOT_STARTED',      -- enum: NOT_STARTED|IN_PROGRESS|COMPLETED (BR-16)
    "priority"         TEXT     NOT NULL DEFAULT 'MEDIUM',           -- enum: LOW | MEDIUM | HIGH
    "dueDate"          DATETIME,
    "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        DATETIME NOT NULL,
    "completedAt"      DATETIME,
    "assigneeId"       TEXT,                                         -- ผู้รับผิดชอบ (User, บัญชี login)
    "assigneePersonId" TEXT,                                         -- ผู้รับผิดชอบ (Person, รองรับ external)
    "createdById"      TEXT,
    "projectId"        TEXT,
    "meetingId"        TEXT,                                         -- การประชุมต้นทาง (FR-14)
    CONSTRAINT "Task_assigneeId_fkey"
        FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneePersonId_fkey"
        FOREIGN KEY ("assigneePersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

CREATE TABLE "TaskComment" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "taskId"    TEXT     NOT NULL,
    "authorId"  TEXT,
    "content"   TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskComment_authorId_fkey"
        FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

CREATE TABLE "TaskAttachment" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "taskId"     TEXT     NOT NULL,
    "fileName"   TEXT     NOT NULL,
    "fileUrl"    TEXT     NOT NULL,
    "fileSize"   INTEGER  NOT NULL,                                  -- bytes, จำกัด 10MB ที่ชั้น API
    "mimeType"   TEXT     NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttachment_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- =============================================================================
-- 9. REMINDERS (FR-10, BR-11, BR-12, BR-13, BR-14)
-- =============================================================================

-- 1 meeting มีได้หลาย reminder (BR-11), แต่ละรายการตรวจสอบสถานะได้ (BR-12)
CREATE TABLE "Reminder" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "meetingId"     TEXT     NOT NULL,
    "scheduledAt"   DATETIME NOT NULL,                               -- meeting.startTime - offset ตอนสร้าง
    "status"        TEXT     NOT NULL DEFAULT 'PENDING',              -- enum: PENDING|SENT|FAILED|CANCELLED
    "failureReason" TEXT,
    "sentAt"        DATETIME,
    "retryCount"    INTEGER  NOT NULL DEFAULT 0,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Reminder_status_idx" ON "Reminder"("status");
CREATE INDEX "Reminder_meetingId_idx" ON "Reminder"("meetingId");

-- =============================================================================
-- 10. NOTIFICATIONS (in-app)
-- =============================================================================

CREATE TABLE "Notification" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "userId"    TEXT     NOT NULL,
    "type"      TEXT     NOT NULL,                                   -- enum NotificationType (6 ค่า ดู DATA_DICTIONARY.md)
    "title"     TEXT     NOT NULL,
    "body"      TEXT,
    "isRead"    BOOLEAN  NOT NULL DEFAULT false,
    "relatedId" TEXT,                                                -- meetingId/taskId ตีความตาม type
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- ใช้ query "แจ้งเตือนที่ยังไม่อ่านของ user นี้" ให้เร็ว
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- =============================================================================
-- 11. AI SUMMARIES (FR-15, BR-18, BR-19, BR-20)
-- =============================================================================

-- unique บน meetingId ทำให้เป็น 1-1 กับ Meeting จริงๆ (สร้างใหม่ = update ทับของเดิม
-- ไม่ใช่ insert แถวใหม่) — ไม่ลบ MeetingNote/Decision/RelatedResource ต้นฉบับเพราะเป็น
-- คนละตารางกันโดยสิ้นเชิง (BR-18, BR-20)
CREATE TABLE "AISummary" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "meetingId"   TEXT     NOT NULL,
    "content"     TEXT     NOT NULL,
    "sources"     TEXT,                                              -- JSON array ของ {label, refType, refId} (BR-19)
    "model"       TEXT     NOT NULL,
    "isEdited"    BOOLEAN  NOT NULL DEFAULT false,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AISummary_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AISummary_meetingId_key" ON "AISummary"("meetingId");

-- =============================================================================
-- จบ schema — 19 ตารางจริง + 1 implicit join table (_MeetingGroups) = 20 ตาราง
-- ตรวจสอบแล้วจริงด้วย node:sqlite (DatabaseSync) รันไฟล์นี้กับ SQLite ว่างๆ:
--   SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
--   ได้ผลลัพธ์ 20 แถวพอดี ไม่มี error จาก FK constraint ระหว่างรัน (ลำดับ CREATE TABLE
--   ในไฟล์นี้เรียง parent ก่อน child ทุกจุดแล้ว)
-- =============================================================================
