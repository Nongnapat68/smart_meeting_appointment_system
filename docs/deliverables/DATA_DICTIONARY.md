# Data Dictionary — Smart Meeting & Appointment Management System

> Rewritten from the **live Supabase Postgres database** (not from
> `prisma/schema.prisma` this time — cross-checked against it, but every
> type/nullable/default/FK claim below was verified with
> `information_schema.columns` + `pg_constraint` against the real project).
> Supersedes the previous version of this file, which was written for the
> SQLite dev database used before the project migrated to Supabase — that
> database no longer exists; this one reflects what's actually running.
>
> Covers all 20 real tables (19 + the implicit join table `_MeetingGroups`)
> — see `ER_DIAGRAM.md` for the relationship diagram and `schema.sql` for
> the full runnable DDL (including all 72 Row Level Security policies,
> which this document doesn't repeat in full — each table below just notes
> who can do what).
>
> **Type column below is the real native Postgres type** — enums are
> genuine `CREATE TYPE ... AS ENUM` types the database itself enforces
> (invalid values are rejected at the SQL level, not just by Zod in
> `src/lib/validations.ts`), not `TEXT` with app-level-only validation the
> way SQLite had to fall back to.
>
> **`id` is `TEXT` (Prisma `cuid()`, generated client-side) on every table
> except `"User".id`, which is `UUID`.** `"User".id` is not a
> Prisma-generated id at all — it's the same uuid Supabase Auth already
> generated for that person in `auth.users` (a table in the separate
> `auth` schema, owned by Supabase, not this application), supplied
> explicitly on insert. `"User".id` has a cross-schema foreign key —
> `"User".id → auth.users.id ON DELETE CASCADE` — so deleting a Supabase
> Auth account cascades into deleting the matching `"User"` row (and
> everything that cascades from *that*). Every column elsewhere that
> references a user (`organizerId`, `assigneeId`, `createdById`,
> `managerId`, `authorId`, `decidedById`, `addedById`, `userId`, etc.) is
> `UUID` to match.

---

## สารบัญ Entity

Auth/Users: [User](#user), [PasswordResetOtp](#passwordresetotp)
People/Contacts: [Person](#person)
Groups: [ContactGroup](#contactgroup), [ContactGroupMember](#contactgroupmember)
Projects: [Project](#project), [ProjectMember](#projectmember)
Meetings: [Meeting](#meeting), [MeetingParticipant](#meetingparticipant)
Meeting context: [MeetingNote](#meetingnote), [Decision](#decision), [RelatedResource](#relatedresource)
Online link: [OnlineMeetingResource](#onlinemeetingresource)
Tasks: [Task](#task), [TaskComment](#taskcomment), [TaskAttachment](#taskattachment)
Reminders: [Reminder](#reminder)
Notifications: [Notification](#notification)
AI: [AISummary](#aisummary)
Join table: [_MeetingGroups](#_meetinggroups-implicit-m-n-join-table)
Database objects added on top of tables: [Views](#views-2), [Functions](#functions-2), [Trigger](#trigger-1)

---

## User

ผู้ใช้งานที่ login เข้าระบบได้ (บุคลากรของคณะเทคโนโลยีสารสนเทศและการสื่อสาร เช่น อาจารย์/เจ้าหน้าที่) — ทุกคนมี `Person` คู่กันแบบ 1-1 (optional) เพื่อให้ถูกเชิญประชุมได้เหมือนผู้ติดต่อทั่วไป

**Auth is Supabase Auth, not this table.** Login/session/password verification all happen in `auth.users` (Supabase-managed); this `"User"` row is application profile data keyed to the same id. There is **no `passwordHash` column** — that field existed only in the pre-migration SQLite version, back when this app rolled its own bcrypt auth. It was dropped when the project moved to Supabase Auth (see `prisma/migrations/20260910142937_supabase_auth_uuid_migration` and `.../20260911...` auth-related migrations) and does not exist in the live database.

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | **UUID** | ❌ | — | PK, **FK → `auth.users.id`** (cross-schema, `ON DELETE CASCADE`) | เดียวกับ id ที่ Supabase Auth สร้างให้ผู้ใช้คนนี้ ไม่ใช่ cuid — ระบบไม่ generate เอง |
| `email` | TEXT | ❌ | — | **UK** | อีเมล (ใช้แสดงผล — การ login จริงตรวจสอบผ่าน Supabase Auth ไม่ใช่คอลัมน์นี้) |
| `name` | TEXT | ❌ | — | | ชื่อ-นามสกุล |
| `avatarUrl` | TEXT | ✅ | `null` | | URL รูปโปรไฟล์ |
| `phone` | TEXT | ✅ | `null` | | เบอร์โทรศัพท์ |
| `title` | TEXT | ✅ | `null` | | ตำแหน่งงาน |
| `department` | TEXT | ✅ | `null` | | แผนก |
| `role` | `"UserRole"` (enum) | ❌ | `'MEMBER'` | | ค่าที่เป็นไปได้: `ADMIN`, `MEMBER` — ADMIN ผ่าน authorization check ทุกจุดได้ (ดู `assertOwner`, และ `is_admin()` ที่ชั้น RLS) |
| `emailNotifications` | BOOLEAN | ❌ | `true` | | เปิด/ปิดแจ้งเตือนทางอีเมล |
| `inAppNotifications` | BOOLEAN | ❌ | `true` | | เปิด/ปิดแจ้งเตือนในแอป |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | วันที่สร้างบัญชี |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto (`@updatedAt`, set by Prisma client) | | อัปเดตอัตโนมัติทุกครั้งที่แก้ record |

**FK ขาออก**: `id` → `auth.users.id`
**FK ขาเข้า (ตารางอื่นอ้างถึง User)**: `Person.userId`, `PasswordResetOtp.userId`, `Meeting.organizerId`, `ContactGroup.createdById`, `Project.managerId`, `Task.assigneeId`/`createdById`, `TaskComment.authorId`, `Notification.userId`, `MeetingNote.authorId`, `Decision.decidedById`, `RelatedResource.addedById`, `OnlineMeetingResource.createdById`
**RLS (`schema.sql` §5)**: select — everyone logged in · insert — admin only · update — self or admin · delete — admin only

---

## PasswordResetOtp

OTP สำหรับ flow "ลืมรหัสผ่าน" — 1 ผู้ใช้มีได้หลายรายการ (ขอใหม่ทุกครั้งที่ request)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `userId` | **UUID** | ❌ | — | **FK** → `User.id`, `onDelete: Cascade`, indexed | เจ้าของ OTP นี้ |
| `otpHash` | TEXT | ❌ | — | | hash ของรหัส OTP 6 หลัก ไม่เก็บ plaintext |
| `expiresAt` | TIMESTAMP(3) | ❌ | — | | เวลาหมดอายุ |
| `usedAt` | TIMESTAMP(3) | ✅ | `null` | | เวลาที่ถูกใช้ไปแล้ว (ป้องกันใช้ซ้ำ) |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**RLS**: deny-all — no policies of any kind on this table (zero policies = every row blocked for every non-bypassing role). Server-only, via Prisma (which always bypasses RLS).

---

## Person

**ผู้ติดต่อ** — คนละ entity กับ `User`: อาจเป็นบุคลากรภายในของคณะ (ผูกกับ `User` ผ่าน `userId`) หรือบุคคลภายนอกที่ไม่ได้มีบัญชี login ก็ได้ (FR-01)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `name` | TEXT | ❌ | — | | ชื่อผู้ติดต่อ |
| `email` | TEXT | ❌ | — | **UK** | ป้องกันสร้างผู้ติดต่อซ้ำด้วยอีเมลเดียวกัน |
| `phone` | TEXT | ✅ | `null` | | |
| `avatarUrl` | TEXT | ✅ | `null` | | |
| `title` | TEXT | ✅ | `null` | | ตำแหน่ง |
| `department` | TEXT | ✅ | `null` | | แผนก |
| `type` | `"PersonType"` (enum) | ❌ | `'EXTERNAL'` | indexed | ค่าที่เป็นไปได้: `INTERNAL` (ผูกกับ User ที่ login ได้), `EXTERNAL` (ไม่มีบัญชี) |
| `status` | `"PersonStatus"` (enum) | ❌ | `'ACTIVE'` | indexed | ค่าที่เป็นไปได้: `ACTIVE`, `INACTIVE` — ใช้แทน hard delete เมื่อมีประวัติเข้าประชุมอยู่ (BR-02) |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |
| `userId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull`, **UK** | มีค่าเมื่อเป็น INTERNAL person เท่านั้น |

**FK ขาเข้า**: `ContactGroupMember.personId`, `ProjectMember.personId`, `MeetingParticipant.personId` (Restrict — ดูหมายเหตุด้านล่าง), `Task.assigneePersonId`, `Meeting.organizerPersonId`

**หมายเหตุ BR-02**: `MeetingParticipant.personId` ใช้ `onDelete: Restrict` แทน `Cascade`/`SetNull` โดยตั้งใจ — หาก person เคยเข้าร่วมประชุมมาแล้ว การลบทิ้งจริง (hard delete) จะถูก DB ปฏิเสธ ต้องเปลี่ยน `status` เป็น `INACTIVE` แทน เพื่อไม่ให้ประวัติการประชุมหายไป

---

## ContactGroup

กลุ่มผู้ติดต่อที่สร้างไว้ใช้ซ้ำ (เช่น ทีมโครงการ, คณะกรรมการ) — FR-02

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `name` | TEXT | ❌ | — | | ชื่อกลุ่ม |
| `description` | TEXT | ✅ | `null` | | |
| `icon` | TEXT | ❌ | `'group'` | | ชื่อ Material Symbol ที่ใช้แสดงไอคอนกลุ่ม |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |
| `createdById` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างกลุ่ม |

**FK ขาเข้า**: `ContactGroupMember.groupId`, `MeetingParticipant.sourceGroupId`, ตาราง join `_MeetingGroups`

---

## ContactGroupMember

Join entity ระหว่าง `ContactGroup` ↔ `Person` (many-to-many ที่มีคอลัมน์เสริม role/joinedAt) — BR-01

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `groupId` | TEXT | ❌ | — | **FK** → `ContactGroup.id`, `onDelete: Cascade` | ลบกลุ่ม → ลบ membership ทั้งหมดในกลุ่มนั้น |
| `personId` | TEXT | ❌ | — | **FK** → `Person.id`, `onDelete: Cascade`, indexed | ลบ person → ลบ membership (แต่ไม่กระทบ `MeetingParticipant` ที่บันทึกไปแล้ว — BR-02/BR-03) |
| `role` | `"GroupRole"` (enum) | ❌ | `'MEMBER'` | | ค่าที่เป็นไปได้: `LEADER` (หัวหน้ากลุ่ม), `MEMBER` |
| `joinedAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**Constraint พิเศษ**: unique index บน `(groupId, personId)` — 1 คนเป็นสมาชิกกลุ่มเดียวกันซ้ำไม่ได้ (แต่อยู่หลายกลุ่มต่างกันได้ตาม BR-01)

---

## Project

โครงการที่ผูกการประชุมหลายครั้งเข้าด้วยกัน — FR-06

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `name` | TEXT | ❌ | — | | ชื่อโครงการ |
| `description` | TEXT | ✅ | `null` | | |
| `status` | `"ProjectStatus"` (enum) | ❌ | `'ACTIVE'` | | ค่าที่เป็นไปได้: `ACTIVE`, `PENDING`, `DELAYED`, `COMPLETED` |
| `startDate` | TIMESTAMP(3) | ✅ | `null` | | |
| `endDate` | TIMESTAMP(3) | ✅ | `null` | | |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |
| `managerId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้จัดการโครงการ — มีสิทธิ์แก้ไข/ลบโครงการ (`assertOwner`) |

**FK ขาเข้า**: `ProjectMember.projectId`, `Meeting.projectId`, `Task.projectId`

---

## ProjectMember

Join entity ระหว่าง `Project` ↔ `Person` (many-to-many)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `projectId` | TEXT | ❌ | — | **FK** → `Project.id`, `onDelete: Cascade` | |
| `personId` | TEXT | ❌ | — | **FK** → `Person.id`, `onDelete: Cascade`, indexed | |
| `joinedAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**Constraint พิเศษ**: unique index บน `(projectId, personId)`

---

## OnlineMeetingResource

ลิงก์ประชุมออนไลน์ที่นำกลับมาใช้ซ้ำได้กับหลาย meeting — FR-07/BR-09/BR-10

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `name` | TEXT | ❌ | — | indexed | ชื่อที่จำง่าย เช่น "Zoom Room B — ทีมวิจัย AI Lab" |
| `url` | TEXT | ❌ | — | | URL ห้องประชุม (เช่น Teams/Zoom/Google Meet ที่สร้างไว้นอกระบบ) |
| `createdById` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างลิงก์นี้ — มีสิทธิ์แก้ไข/ลบ |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | แก้ไขที่นี่จุดเดียว มีผลกับทุก meeting ที่อ้างอิงทันที (BR-10) |

**FK ขาเข้า**: `Meeting.onlineMeetingResourceId` (หลาย meeting อ้างอิงลิงก์เดียวกันได้ — BR-09)

---

## Meeting

**ตารางศูนย์กลาง** ของระบบ — นัดหมาย/การประชุมแต่ละครั้ง — FR-04/FR-05/FR-06

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `title` | TEXT | ❌ | — | | หัวข้อการประชุม |
| `description` | TEXT | ✅ | `null` | | agenda ตอนนัดหมาย (คนละส่วนกับ `MeetingNote` ที่เป็นบันทึกหลังประชุม หลายรายการ) |
| `type` | `"MeetingType"` (enum) | ❌ | `'SINGLE'` | | ค่าที่เป็นไปได้: `SINGLE` (ครั้งเดียว), `PROJECT` (ต่อเนื่องภายใต้โครงการ) — FR-05 |
| `status` | `"MeetingStatus"` (enum) | ❌ | `'PENDING'` | indexed | ค่าที่เป็นไปได้: `PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `POSTPONED` (ไม่มีค่า `SCHEDULED` — ระวังอย่าเขียน query เทียบกับ `'SCHEDULED'`, ใช้ `NOT IN ('CANCELLED','COMPLETED')` แทนสำหรับความหมาย "ยังไม่เกิดขึ้นจริง") |
| `startTime` | TIMESTAMP(3) | ❌ | — | indexed | เวลาเริ่ม |
| `endTime` | TIMESTAMP(3) | ❌ | — | | เวลาสิ้นสุด |
| `location` | TEXT | ✅ | `null` | | ชื่อห้องประชุมจริง หรือลิงก์แบบ text ที่พิมพ์เอง (ไม่ผ่าน `OnlineMeetingResource`) |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |
| `organizerId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้จัดประชุม (บัญชีที่ login) |
| `organizerPersonId` | TEXT | ✅ | `null` | **FK** → `Person.id`, `onDelete: SetNull` | ผู้จัดประชุมในฐานะ contact record |
| `projectId` | TEXT | ✅ | `null` | **FK** → `Project.id`, `onDelete: SetNull` | `null` ได้ตาม BR-06 (meeting ไม่จำเป็นต้องอยู่ project) |
| `onlineMeetingResourceId` | TEXT | ✅ | `null` | **FK** → `OnlineMeetingResource.id`, `onDelete: SetNull`, indexed | ลิงก์ประชุมออนไลน์แบบใช้ซ้ำได้ (FR-07) |

**FK ขาเข้า**: `MeetingParticipant.meetingId`, `Reminder.meetingId`, `MeetingNote.meetingId`, `Decision.meetingId`, `RelatedResource.meetingId`, `Task.meetingId`, `AISummary.meetingId`, ตาราง join `_MeetingGroups`

**ทริกเกอร์บนตารางนี้**: `trg_cancel_meeting_reminders` — ดู [Trigger](#trigger-1) ด้านล่าง

---

## MeetingParticipant

ผู้เข้าร่วมของแต่ละ meeting พร้อมแหล่งที่มา (BR-04) — join entity ระหว่าง `Meeting` ↔ `Person`

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade` | |
| `personId` | TEXT | ❌ | — | **FK** → `Person.id`, `onDelete: Restrict`, indexed | **Restrict ไม่ใช่ Cascade** — ดูหมายเหตุ BR-02 ที่ตาราง `Person` |
| `role` | `"ParticipantRole"` (enum) | ❌ | `'ATTENDEE'` | | ค่าที่เป็นไปได้: `ORGANIZER`, `ATTENDEE` |
| `rsvpStatus` | `"RsvpStatus"` (enum) | ❌ | `'PENDING'` | | ค่าที่เป็นไปได้: `PENDING`, `ACCEPTED`, `DECLINED` |
| `source` | `"ParticipantSource"` (enum) | ❌ | `'DIRECT'` | | ค่าที่เป็นไปได้: `DIRECT` (เลือกทีละคน), `GROUP` (มาจากกลุ่ม), `EXTERNAL` (พิมพ์อีเมลนอกระบบ) — BR-04, resolve ครั้งเดียวตอนสร้าง ไม่คำนวณซ้ำภายหลัง (สอดคล้อง BR-03) |
| `sourceGroupId` | TEXT | ✅ | `null` | **FK** → `ContactGroup.id`, `onDelete: SetNull`, indexed | มีค่าเมื่อ `source = GROUP` เท่านั้น — เก็บไว้แม้กลุ่มถูกลบภายหลัง |

**Constraint พิเศษ**: unique index บน `(meetingId, personId)` — 1 คนเข้าร่วม meeting เดียวกันซ้ำไม่ได้ แม้จะถูกเลือกมาจากหลายแหล่งพร้อมกัน (BR-04's "จัดการข้อมูลซ้ำ")

---

## MeetingNote

บันทึกการประชุม — หลายรายการต่อ 1 meeting, แต่ละรายการ attribute ผู้บันทึกและเวลา — FR-11/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `content` | TEXT | ❌ | — | | เนื้อหาบันทึก |
| `authorId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้บันทึก |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |

---

## Decision

มติ/สิ่งที่ตัดสินใจจากการประชุม — ย้อนกลับไปดู project ผ่าน `meeting.projectId` (ไม่มี `projectId` ของตัวเอง โดยตั้งใจ กันไม่ให้ decision ชี้ไป project คนละอันกับ meeting ต้นทาง) — FR-13/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `content` | TEXT | ❌ | — | เนื้อหามติ |
| `decidedById` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้บันทึกมติ |
| `decidedAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | เวลาตัดสินใจ |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | เวลาบันทึกเข้าระบบ (แยกจาก `decidedAt` เผื่อบันทึกย้อนหลัง) |

---

## RelatedResource

ข้อมูลประกอบการประชุม (URL/เอกสาร/ไฟล์) — หลายรายการต่อ 1 meeting — FR-12/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `title` | TEXT | ❌ | — | | ชื่อ resource |
| `url` | TEXT | ❌ | — | | ลิงก์ไปยังไฟล์/เอกสาร |
| `type` | `"ResourceType"` (enum) | ❌ | `'LINK'` | | ค่าที่เป็นไปได้: `LINK`, `DOCUMENT`, `FILE` |
| `addedById` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้เพิ่ม |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

---

## Task

งาน/action item — อาจเกิดจากการประชุม หรือสร้างอิสระก็ได้ — FR-14

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `title` | TEXT | ❌ | — | | |
| `description` | TEXT | ✅ | `null` | | |
| `status` | `"TaskStatus"` (enum) | ❌ | `'NOT_STARTED'` | indexed | ค่าที่เป็นไปได้: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` — BR-16 (แยกเสร็จ/ค้างได้; ไม่มีค่า `DONE` — "เสร็จแล้ว" คือ `COMPLETED`) |
| `priority` | `"TaskPriority"` (enum) | ❌ | `'MEDIUM'` | | ค่าที่เป็นไปได้: `LOW`, `MEDIUM`, `HIGH` |
| `dueDate` | TIMESTAMP(3) | ✅ | `null` | indexed | กำหนดส่ง |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |
| `updatedAt` | TIMESTAMP(3) | ❌ | auto | | |
| `completedAt` | TIMESTAMP(3) | ✅ | `null` | | เวลาที่ทำเสร็จจริง |
| `assigneeId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull`, indexed | ผู้รับผิดชอบ (บัญชี login) |
| `assigneePersonId` | TEXT | ✅ | `null` | **FK** → `Person.id`, `onDelete: SetNull` | ผู้รับผิดชอบในฐานะ contact (รองรับ external assignee) |
| `createdById` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างงาน |
| `projectId` | TEXT | ✅ | `null` | **FK** → `Project.id`, `onDelete: SetNull` | |
| `meetingId` | TEXT | ✅ | `null` | **FK** → `Meeting.id`, `onDelete: SetNull` | การประชุมต้นทาง (FR-14: "การประชุมต้นทาง") |

**FK ขาเข้า**: `TaskComment.taskId`, `TaskAttachment.taskId`

---

## TaskComment

ความคิดเห็นในงาน

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `taskId` | TEXT | ❌ | — | **FK** → `Task.id`, `onDelete: Cascade`, indexed | |
| `authorId` | **UUID** | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | |
| `content` | TEXT | ❌ | — | | |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

---

## TaskAttachment

ไฟล์แนบของงาน

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `taskId` | TEXT | ❌ | — | **FK** → `Task.id`, `onDelete: Cascade`, indexed | |
| `fileName` | TEXT | ❌ | — | | ชื่อไฟล์ต้นฉบับ |
| `fileUrl` | TEXT | ❌ | — | | path ที่เก็บไฟล์จริง (`/uploads/tasks/{taskId}/...`) |
| `fileSize` | INTEGER | ❌ | — | | ขนาดไฟล์ (bytes) จำกัดสูงสุด 10MB ที่ชั้น API |
| `mimeType` | TEXT | ❌ | — | | |
| `uploadedAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

---

## Reminder

การแจ้งเตือนก่อนประชุม — 1 meeting มีได้หลายรายการ (BR-11) — FR-10

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | ลบ meeting → ลบ reminder ที่ผูกอยู่ทั้งหมด |
| `scheduledAt` | TIMESTAMP(3) | ❌ | — | | เวลาที่ควรส่ง (คำนวณจาก `meeting.startTime - offset` ตอนสร้าง) |
| `status` | `"ReminderStatus"` (enum) | ❌ | `'PENDING'` | indexed | ค่าที่เป็นไปได้: `PENDING`, `SENT`, `FAILED`, `CANCELLED` — ครบตามที่ FR-10 กำหนด |
| `failureReason` | TEXT | ✅ | `null` | | ข้อความ error เมื่อส่งไม่สำเร็จ |
| `sentAt` | TIMESTAMP(3) | ✅ | `null` | | เวลาที่ส่งจริง |
| `retryCount` | INTEGER | ❌ | `0` | | จำนวนครั้งที่เคย retry |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**หมายเหตุ BR-14 (อัปเดต)**: เดิม endpoint `/api/meetings/[id]/cancel` เป็นคน update reminder ที่ยังไม่ส่งของ meeting ที่ถูกยกเลิกให้เป็น `CANCELLED` เอง (application-level logic) — ตอนนี้ย้ายมาเป็น **DB trigger** แล้ว: `trg_cancel_meeting_reminders` บน `Meeting` (ดู [Trigger](#trigger-1)) ทำหน้าที่นี้แทนโดยอัตโนมัติทุกครั้งที่ `Meeting.status` เปลี่ยนเป็น `CANCELLED` ไม่ว่าจะแก้ผ่านช่องทางไหนก็ตาม (ไม่ใช่แค่ผ่าน endpoint นั้น) route เหลือแค่ update `Meeting.status` อย่างเดียว

---

## Notification

การแจ้งเตือนในแอป (in-app)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `userId` | **UUID** | ❌ | — | **FK** → `User.id`, `onDelete: Cascade` | |
| `type` | `"NotificationType"` (enum) | ❌ | — | | ค่าที่เป็นไปได้: `MEETING_INVITE`, `MEETING_UPDATED`, `MEETING_CANCELLED`, `TASK_ASSIGNED`, `AI_SUMMARY_READY`, `REMINDER` |
| `title` | TEXT | ❌ | — | | |
| `body` | TEXT | ✅ | `null` | | |
| `isRead` | BOOLEAN | ❌ | `false` | | |
| `relatedId` | TEXT | ✅ | `null` | | id ของ meeting/task ที่เกี่ยวข้อง ตีความตาม `type` (ไม่ใช่ FK บังคับ เพราะชี้ไปได้หลายตาราง) |
| `createdAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**Index พิเศษ**: `(userId, isRead)` — ใช้ query "แจ้งเตือนที่ยังไม่อ่านของ user นี้" ให้เร็ว (นี่คือ 1 ใน 4 index ที่ถูกลบแล้วสร้างกลับตอน migrate `userId` เป็น uuid)

---

## AISummary

สรุปก่อนประชุมที่ AI ช่วยสร้าง — 1 meeting มีได้สูงสุด 1 summary — FR-15, BR-18/19/20

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | TEXT (cuid) | ❌ | — | PK | |
| `meetingId` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, **UK** | unique constraint ทำให้เป็น 1-1 กับ Meeting จริงๆ |
| `content` | TEXT | ❌ | — | | เนื้อหาสรุปที่ AI สร้าง (แก้ไขได้ ผ่าน `isEdited`) |
| `sources` | TEXT | ✅ | `null` | | JSON-encoded array ของ `{label, refType, refId}` — ตรวจสอบย้อนกลับได้ว่าใช้ข้อมูลอะไรสร้างสรุป (BR-19) |
| `model` | TEXT | ❌ | — | | ชื่อโมเดล AI ที่ใช้สร้าง (เช่น `claude-opus-5`) |
| `isEdited` | BOOLEAN | ❌ | `false` | | ผู้ใช้แก้ไขเนื้อหาสรุปแล้วหรือยัง |
| `generatedAt` | TIMESTAMP(3) | ❌ | `CURRENT_TIMESTAMP` | | |

**หมายเหตุ BR-18/20**: การสร้าง/regenerate summary ใหม่ **ไม่ลบ** `MeetingNote`/`Decision`/`RelatedResource` ต้นฉบับ เพราะเป็นคนละตารางกันโดยสิ้นเชิง (`AISummary` แค่ FK ไปหา `Meeting` เท่านั้น ไม่ได้เก็บ copy ของ notes ไว้)

---

## `_MeetingGroups` (implicit M-N join table)

ตาราง join ที่ Prisma สร้างอัตโนมัติจาก `ContactGroup.meetings ↔ Meeting.groups` (แถวใน `Meeting` model:
`groups ContactGroup[] @relation("MeetingGroups")`) — ใช้เมื่อ "เพิ่มทั้งกลุ่ม" เป็นผู้เข้าร่วม ไม่มีคอลัมน์เสริมใดๆ
(ต่างจาก `ContactGroupMember`/`ProjectMember` ที่มี role/joinedAt) จึงไม่มี Prisma model ของตัวเอง

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `A` | TEXT | ❌ | — | **FK** → `ContactGroup.id`, `onDelete: Cascade` | ชื่อคอลัมน์ตายตัวจาก Prisma (เรียงตามชื่อ model ตามตัวอักษร) |
| `B` | TEXT | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |

**Constraint พิเศษ**: PK คอมโพสิตบน `(A, B)` — กลุ่มเดียวกันถูกเพิ่มเข้า meeting เดียวกันซ้ำไม่ได้

---

## Enum ทั้งหมดในระบบ (สรุปรวม — 15 ตัว, native Postgres `CREATE TYPE ... AS ENUM`)

| Enum | ค่าที่เป็นไปได้ | ใช้ในคอลัมน์ |
|---|---|---|
| `UserRole` | `ADMIN`, `MEMBER` | `User.role` |
| `PersonType` | `INTERNAL`, `EXTERNAL` | `Person.type` |
| `PersonStatus` | `ACTIVE`, `INACTIVE` | `Person.status` |
| `GroupRole` | `LEADER`, `MEMBER` | `ContactGroupMember.role` |
| `ProjectStatus` | `ACTIVE`, `PENDING`, `DELAYED`, `COMPLETED` | `Project.status` |
| `MeetingType` | `SINGLE`, `PROJECT` | `Meeting.type` |
| `MeetingStatus` | `PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `POSTPONED` | `Meeting.status` |
| `ParticipantRole` | `ORGANIZER`, `ATTENDEE` | `MeetingParticipant.role` |
| `RsvpStatus` | `PENDING`, `ACCEPTED`, `DECLINED` | `MeetingParticipant.rsvpStatus` |
| `ParticipantSource` | `DIRECT`, `GROUP`, `EXTERNAL` | `MeetingParticipant.source` |
| `ResourceType` | `LINK`, `DOCUMENT`, `FILE` | `RelatedResource.type` |
| `TaskStatus` | `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` | `Task.status` |
| `TaskPriority` | `LOW`, `MEDIUM`, `HIGH` | `Task.priority` |
| `ReminderStatus` | `PENDING`, `SENT`, `FAILED`, `CANCELLED` | `Reminder.status` |
| `NotificationType` | `MEETING_INVITE`, `MEETING_UPDATED`, `MEETING_CANCELLED`, `TASK_ASSIGNED`, `AI_SUMMARY_READY`, `REMINDER` | `Notification.type` |

Verified live via `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid ... GROUP BY t.typname` — exactly these 15 rows, exact same value lists as above.

---

## Views (2)

เพิ่มเข้ามาเพื่อตอบ requirements.md §8 (Expected Database Queries / Operations) ข้อ 4 และ 9 โดยตรง — เป็น database object เพิ่มเติมบนตารางข้างต้น ไม่ใช่ตารางใหม่ ดู DDL เต็มใน `schema.sql` §6

| View | ตอบข้อ | คอลัมน์ที่คืน | Logic |
|---|---|---|---|
| `upcoming_meetings` | §8.4 "แสดง Meeting ที่กำลังจะเกิดขึ้น" | `id, title, description, type, status, startTime, endTime, location, organizerId, organizerName, projectId, projectName` | `Meeting` join `User` (organizer) + `Project`, กรอง `status NOT IN ('CANCELLED','COMPLETED')` และ `startTime > now()`, เรียง `startTime ASC` |
| `overdue_action_items` | §8.9 "แสดง Action Items ที่ยังไม่เสร็จ" (ที่เลยกำหนดแล้ว) | `id, title, description, status, priority, dueDate, assigneeId, assigneeName, projectId, meetingId` | `Task` join `User`/`Person` (assignee, coalesced เพราะ assignee เป็นได้ทั้งสองแบบ), กรอง `status <> 'COMPLETED'` และ `dueDate < now()`, เรียง `dueDate ASC` |

ทั้งสอง view ใช้ `WITH (security_invoker = true)` — query ผ่าน view จะยังโดน RLS ของตารางต้นทาง (`Meeting`/`Task`/`User`/`Project`/`Person`) บังคับตามสิทธิ์ผู้เรียกจริง ไม่ใช่สิทธิ์ของคนสร้าง view

---

## Functions (4)

| Function | ตอบข้อ | Return type | Security | Logic |
|---|---|---|---|---|
| `process_due_reminders()` | §8.7 "แสดง Reminder ที่ถึงเวลาต้องส่ง" / FR-10 / BR-13 | `SETOF "Reminder"` | INVOKER | `Reminder` ที่ `status = 'PENDING' AND scheduledAt <= now()`, เรียง `scheduledAt ASC`. Read-only — ไม่ mark `SENT` เอง (นั่นยังทำใน TypeScript หลังส่งอีเมลสำเร็จจริง เพราะ Postgres ส่งอีเมลเองไม่ได้) เรียกใช้จาก `src/app/api/reminders/process-due/route.ts` แทน query ตรงๆ ที่เคยมี |
| `get_meeting_context(p_meeting_id text)` | §8.14 "รวบรวมข้อมูลที่จำเป็นสำหรับสร้าง Pre-meeting Summary" / FR-15/16/17 | `json` | INVOKER | ตรรกะเดียวกับ `gatherMeetingAiContext()` ใน `src/lib/meeting-ai-context.ts`: `relatedTasks` (task ของ project เดียวกัน หรือของ meeting เองถ้าไม่มี project), `overdueTasks` (subset ที่ยังไม่เสร็จและเลยกำหนด — FR-16), `pastMeetings` (สูงสุด 5 meeting ก่อนหน้าใน project เดียวกัน), `pastDecisions`/`pastNotes`/`pastResources` (จาก past meetings เหล่านั้น) รวมเป็น JSON เดียว — เป็น query สาธิตแยกต่างหาก ไม่ได้แทนที่หรือถูกเรียกจาก `gatherMeetingAiContext()` ที่โค้ด TypeScript ยังใช้อยู่ |
| `create_meeting_with_participants(p_organizer_id uuid, p_title text, p_start_time timestamp, p_end_time timestamp, p_description text, p_type text, p_status text, p_location text, p_project_id text, p_online_meeting_resource_id text, p_participant_person_ids text[], p_group_ids text[], p_external_emails text[], p_reminder_offset_minutes int[])` | Hybrid migration รอบ Meeting (แทน `POST /api/meetings` เดิม) | `"Meeting"` | **DEFINER** | สร้าง `Meeting` + `MeetingParticipant` (DIRECT/GROUP/EXTERNAL ตามลำดับความสำคัญเดียวกับ `resolveParticipants()` เดิม) + `Reminder` ต่อ offset ที่ขอ + `Notification` ต่อผู้ใช้ภายในที่ถูกเชิญทุกคน (ยกเว้นผู้จัดเอง) ในฟังก์ชันเดียว (rollback อัตโนมัติถ้าล้มเหลวจุดใดจุดหนึ่ง) เป็น `SECURITY DEFINER` เพราะต้อง insert `Notification` ให้ผู้ใช้อื่นซึ่ง MEMBER ธรรมดาไม่มีสิทธิ์ insert ตรงๆ ตาม RLS (`insert_admin_only`) — ปลอดภัยเพราะเช็ค `auth.uid() = p_organizer_id หรือ is_admin()` เป็นจุดแรกสุดก่อนแตะตารางใดๆ ดู `docs/DESIGN_DECISIONS.md` §5.5 |
| `update_project_with_members(p_project_id text, p_name text, p_description text, p_status text, p_start_date timestamp, p_end_date timestamp, p_member_person_ids text[])` | Hybrid migration รอบ Projects (โครงสร้างพร้อมใช้แทนขั้นตอน replace-member ของ `PUT /api/projects/[id]` เดิม) | `"Project"` | INVOKER | Full-replace (ไม่ใช่ partial PATCH): update field ที่แก้ไขได้ของ `Project` ทั้งหมดก่อน แล้วลบ `ProjectMember` เดิมทั้งหมดของ project นั้นแล้ว insert ชุดใหม่จาก `p_member_person_ids` ในฟังก์ชันเดียว (rollback อัตโนมัติถ้า personId ปลอมชนกับ FK `ProjectMember_personId_fkey`) เป็น `SECURITY INVOKER` เพราะ `update_manager_or_admin` policy ของ `Project` เองบล็อกผู้เรียกที่ไม่ใช่ manager/admin ได้อยู่แล้วตั้งแต่ UPDATE แรก ไม่ต้องข้าม RLS ของใคร — **ยังไม่มี route/UI ใดเรียกใช้จริงในตอนนี้** (`projects/page.tsx` มีแค่ list+create, `projects/[id]/page.tsx` เป็น read-only Server Component ที่ยังอ่านผ่าน Prisma โดยตรง) สร้างไว้เป็น infrastructure รอ hybrid-migration รอบแก้ไขโปรเจกต์ในอนาคต ดู `docs/DESIGN_DECISIONS.md` §5.6 |

`process_due_reminders()`/`get_meeting_context()` เป็น `SECURITY INVOKER` เพราะแค่ query ข้อมูล ไม่ต้องข้าม RLS ของใคร รันในสิทธิ์ผู้เรียกตามปกติ — เช่นเดียวกับ `update_project_with_members()` (RLS ของ `Project` เองบล็อกให้อยู่แล้ว) ส่วน `create_meeting_with_participants()` เป็น `DEFINER` แบบเดียวกับ `is_admin()`/`is_meeting_participant()` ที่ RLS policies พึ่งพา เพราะต้อง insert แถวที่ผู้เรียกเองไม่มีสิทธิ์ insert ตรงๆ (ดูเหตุผลแยกแต่ละตัวในคอลัมน์ Logic ด้านบน)

---

## Trigger (1)

| Trigger | บนตาราง | Event | Function | Logic |
|---|---|---|---|---|
| `trg_cancel_meeting_reminders` | `Meeting` | `AFTER UPDATE OF status`, `WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')` | `cancel_meeting_reminders()` | BR-14: เมื่อ `Meeting.status` เปลี่ยนเป็น `CANCELLED` จากค่าอื่น (ครั้งแรกเท่านั้น — ไม่ยิงซ้ำถ้า update อื่นๆ ตามมาโดย status ยังเป็น `CANCELLED` เหมือนเดิม) ให้ `UPDATE "Reminder" SET status = 'CANCELLED' WHERE "meetingId" = NEW.id AND status = 'PENDING'` — เติมช่องว่าง trigger ที่ระบบไม่เคยมีมาก่อน (0 ตัว) และย้าย logic นี้ออกจาก `src/app/api/meetings/[id]/cancel/route.ts` ซึ่งเดิมทำเป็น 2 คำสั่งแยก (update meeting + updateMany reminder) — ตอนนี้ route เหลือแค่ update `Meeting.status` อย่างเดียว |

Function เป็น `SECURITY INVOKER` (default) — ไม่จำเป็นต้องข้าม RLS เพราะทุก mutation ของแอปวันนี้วิ่งผ่าน Prisma ซึ่ง connect เป็น role ที่มี `BYPASSRLS` อยู่แล้ว
