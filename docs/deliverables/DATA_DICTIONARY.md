# Data Dictionary — Smart Meeting & Appointment Management System

> สร้างจาก `prisma/schema.prisma` (สถานะปัจจุบันจริง หลัง migration
> `20260906020941_add_notes_decisions_resources_online_link_participant_source`) ครบทั้ง 19 model
> + 1 implicit join table (`_MeetingGroups`) = 20 ตารางจริง — ดูความสัมพันธ์ระหว่างตารางใน `ER_DIAGRAM.md`
>
> **หมายเหตุ type**: dev database เป็น SQLite (`prisma/dev.db`) คอลัมน์ที่ Prisma ประกาศเป็น
> `String`/`Int`/`Boolean`/`DateTime` ถูกเก็บจริงเป็น `TEXT`/`INTEGER`/`BOOLEAN`/`DATETIME` ใน SQLite
> (ดู `schema.sql` สำหรับ DDL จริง) คอลัมน์ประเภท enum ของ Prisma ถูกเก็บเป็น `TEXT` ธรรมดาใน SQLite
> (ไม่มี native enum type) โดยมี validation ที่ชั้น Prisma Client + Zod (`src/lib/validations.ts`)
> คอยบังคับค่าที่รับได้แทน — คอลัมน์ "ค่าที่เป็นไปได้" ด้านล่างระบุ enum values ไว้ให้ครบ

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

---

## User

ผู้ใช้งานที่ login เข้าระบบได้ (สมาชิกภายในองค์กร) — ทุกคนมี `Person` คู่กันแบบ 1-1 (optional) เพื่อให้ถูกเชิญประชุมได้เหมือนผู้ติดต่อทั่วไป

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | รหัสผู้ใช้ |
| `email` | String | ❌ | — | **UK** | อีเมล ใช้ login |
| `passwordHash` | String | ❌ | — | | bcrypt hash ของรหัสผ่าน ไม่เก็บ plaintext |
| `name` | String | ❌ | — | | ชื่อ-นามสกุล |
| `avatarUrl` | String | ✅ | `null` | | URL รูปโปรไฟล์ |
| `phone` | String | ✅ | `null` | | เบอร์โทรศัพท์ |
| `title` | String | ✅ | `null` | | ตำแหน่งงาน |
| `department` | String | ✅ | `null` | | แผนก |
| `role` | String (enum `UserRole`) | ❌ | `MEMBER` | | ค่าที่เป็นไปได้: `ADMIN`, `MEMBER` — ADMIN ผ่าน authorization check ทุกจุดได้ (ดู `assertOwner`) |
| `emailNotifications` | Boolean | ❌ | `true` | | เปิด/ปิดแจ้งเตือนทางอีเมล |
| `inAppNotifications` | Boolean | ❌ | `true` | | เปิด/ปิดแจ้งเตือนในแอป |
| `createdAt` | DateTime | ❌ | `now()` | | วันที่สร้างบัญชี |
| `updatedAt` | DateTime | ❌ | auto (`@updatedAt`) | | อัปเดตอัตโนมัติทุกครั้งที่แก้ record |

**FK ขาออก**: ไม่มี (User เป็น root entity)
**FK ขาเข้า (ตารางอื่นอ้างถึง User)**: `Person.userId`, `PasswordResetOtp.userId`, `Meeting.organizerId`, `ContactGroup.createdById`, `Project.managerId`, `Task.assigneeId`/`createdById`, `TaskComment.authorId`, `Notification.userId`, `MeetingNote.authorId`, `Decision.decidedById`, `RelatedResource.addedById`, `OnlineMeetingResource.createdById`

---

## PasswordResetOtp

OTP สำหรับ flow "ลืมรหัสผ่าน" — 1 ผู้ใช้มีได้หลายรายการ (ขอใหม่ทุกครั้งที่ request)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `userId` | String | ❌ | — | **FK** → `User.id`, `onDelete: Cascade`, indexed | เจ้าของ OTP นี้ |
| `otpHash` | String | ❌ | — | | hash ของรหัส OTP 6 หลัก ไม่เก็บ plaintext |
| `expiresAt` | DateTime | ❌ | — | | เวลาหมดอายุ |
| `usedAt` | DateTime | ✅ | `null` | | เวลาที่ถูกใช้ไปแล้ว (ป้องกันใช้ซ้ำ) |
| `createdAt` | DateTime | ❌ | `now()` | | |

---

## Person

**ผู้ติดต่อ** — คนละ entity กับ `User`: อาจเป็นพนักงานภายใน (ผูกกับ `User` ผ่าน `userId`) หรือบุคคลภายนอกที่ไม่มีบัญชี login ก็ได้ (FR-01)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `name` | String | ❌ | — | | ชื่อผู้ติดต่อ |
| `email` | String | ❌ | — | **UK** | ป้องกันสร้างผู้ติดต่อซ้ำด้วยอีเมลเดียวกัน |
| `phone` | String | ✅ | `null` | | |
| `avatarUrl` | String | ✅ | `null` | | |
| `title` | String | ✅ | `null` | | ตำแหน่ง |
| `department` | String | ✅ | `null` | | แผนก |
| `type` | String (enum `PersonType`) | ❌ | `EXTERNAL` | indexed | ค่าที่เป็นไปได้: `INTERNAL` (ผูกกับ User ที่ login ได้), `EXTERNAL` (ไม่มีบัญชี) |
| `status` | String (enum `PersonStatus`) | ❌ | `ACTIVE` | indexed | ค่าที่เป็นไปได้: `ACTIVE`, `INACTIVE` — ใช้แทน hard delete เมื่อมีประวัติเข้าประชุมอยู่ (BR-02) |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |
| `userId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull`, **UK** | มีค่าเมื่อเป็น INTERNAL person เท่านั้น |

**FK ขาเข้า**: `ContactGroupMember.personId`, `ProjectMember.personId`, `MeetingParticipant.personId` (Restrict — ดูหมายเหตุด้านล่าง), `Task.assigneePersonId`, `Meeting.organizerPersonId`

**หมายเหตุ BR-02**: `MeetingParticipant.personId` ใช้ `onDelete: Restrict` แทน `Cascade`/`SetNull` โดยตั้งใจ — หาก person เคยเข้าร่วมประชุมมาแล้ว การลบทิ้งจริง (hard delete) จะถูก DB ปฏิเสธ ต้องเปลี่ยน `status` เป็น `INACTIVE` แทน เพื่อไม่ให้ประวัติการประชุมหายไป

---

## ContactGroup

กลุ่มผู้ติดต่อที่สร้างไว้ใช้ซ้ำ (เช่น ทีมโครงการ, คณะกรรมการ) — FR-02

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `name` | String | ❌ | — | | ชื่อกลุ่ม |
| `description` | String | ✅ | `null` | | |
| `icon` | String | ❌ | `'group'` | | ชื่อ Material Symbol ที่ใช้แสดงไอคอนกลุ่ม |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |
| `createdById` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างกลุ่ม |

**FK ขาเข้า**: `ContactGroupMember.groupId`, `MeetingParticipant.sourceGroupId`, ตาราง join `_MeetingGroups`

---

## ContactGroupMember

Join entity ระหว่าง `ContactGroup` ↔ `Person` (many-to-many ที่มีคอลัมน์เสริม role/joinedAt) — BR-01

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `groupId` | String | ❌ | — | **FK** → `ContactGroup.id`, `onDelete: Cascade` | ลบกลุ่ม → ลบ membership ทั้งหมดในกลุ่มนั้น |
| `personId` | String | ❌ | — | **FK** → `Person.id`, `onDelete: Cascade`, indexed | ลบ person → ลบ membership (แต่ไม่กระทบ `MeetingParticipant` ที่บันทึกไปแล้ว — BR-02/BR-03) |
| `role` | String (enum `GroupRole`) | ❌ | `MEMBER` | | ค่าที่เป็นไปได้: `LEADER` (หัวหน้ากลุ่ม), `MEMBER` |
| `joinedAt` | DateTime | ❌ | `now()` | | |

**Constraint พิเศษ**: `@@unique([groupId, personId])` — 1 คนเป็นสมาชิกกลุ่มเดียวกันซ้ำไม่ได้ (แต่อยู่หลายกลุ่มต่างกันได้ตาม BR-01)

---

## Project

โครงการที่ผูกการประชุมหลายครั้งเข้าด้วยกัน — FR-06

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `name` | String | ❌ | — | | ชื่อโครงการ |
| `description` | String | ✅ | `null` | | |
| `status` | String (enum `ProjectStatus`) | ❌ | `ACTIVE` | | ค่าที่เป็นไปได้: `ACTIVE`, `PENDING`, `DELAYED`, `COMPLETED` |
| `startDate` | DateTime | ✅ | `null` | | |
| `endDate` | DateTime | ✅ | `null` | | |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |
| `managerId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้จัดการโครงการ — มีสิทธิ์แก้ไข/ลบโครงการ (`assertOwner`) |

**FK ขาเข้า**: `ProjectMember.projectId`, `Meeting.projectId`, `Task.projectId`

---

## ProjectMember

Join entity ระหว่าง `Project` ↔ `Person` (many-to-many)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `projectId` | String | ❌ | — | **FK** → `Project.id`, `onDelete: Cascade` | |
| `personId` | String | ❌ | — | **FK** → `Person.id`, `onDelete: Cascade`, indexed | |
| `joinedAt` | DateTime | ❌ | `now()` | | |

**Constraint พิเศษ**: `@@unique([projectId, personId])`

---

## OnlineMeetingResource

ลิงก์ประชุมออนไลน์ที่นำกลับมาใช้ซ้ำได้กับหลาย meeting — FR-07/BR-09/BR-10

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `name` | String | ❌ | — | indexed | ชื่อที่จำง่าย เช่น "Zoom Room B — ทีมการตลาด" |
| `url` | String | ❌ | — | | URL ห้องประชุม (เช่น Teams/Zoom/Google Meet ที่สร้างไว้นอกระบบ) |
| `createdById` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างลิงก์นี้ — มีสิทธิ์แก้ไข/ลบ |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | แก้ไขที่นี่จุดเดียว มีผลกับทุก meeting ที่อ้างอิงทันที (BR-10) |

**FK ขาเข้า**: `Meeting.onlineMeetingResourceId` (หลาย meeting อ้างอิงลิงก์เดียวกันได้ — BR-09)

---

## Meeting

**ตารางศูนย์กลาง** ของระบบ — นัดหมาย/การประชุมแต่ละครั้ง — FR-04/FR-05/FR-06

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `title` | String | ❌ | — | | หัวข้อการประชุม |
| `description` | String | ✅ | `null` | | agenda ตอนนัดหมาย (คนละส่วนกับ `MeetingNote` ที่เป็นบันทึกหลังประชุม หลายรายการ) |
| `type` | String (enum `MeetingType`) | ❌ | `SINGLE` | | ค่าที่เป็นไปได้: `SINGLE` (ครั้งเดียว), `PROJECT` (ต่อเนื่องภายใต้โครงการ) — FR-05 |
| `status` | String (enum `MeetingStatus`) | ❌ | `PENDING` | indexed | ค่าที่เป็นไปได้: `PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `POSTPONED` |
| `startTime` | DateTime | ❌ | — | indexed | เวลาเริ่ม |
| `endTime` | DateTime | ❌ | — | | เวลาสิ้นสุด |
| `location` | String | ✅ | `null` | | ชื่อห้องประชุมจริง หรือลิงก์แบบ text ที่พิมพ์เอง (ไม่ผ่าน `OnlineMeetingResource`) |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |
| `organizerId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้จัดประชุม (บัญชีที่ login) |
| `organizerPersonId` | String | ✅ | `null` | **FK** → `Person.id`, `onDelete: SetNull` | ผู้จัดประชุมในฐานะ contact record |
| `projectId` | String | ✅ | `null` | **FK** → `Project.id`, `onDelete: SetNull` | `null` ได้ตาม BR-06 (meeting ไม่จำเป็นต้องอยู่ project) |
| `onlineMeetingResourceId` | String | ✅ | `null` | **FK** → `OnlineMeetingResource.id`, `onDelete: SetNull`, indexed | ลิงก์ประชุมออนไลน์แบบใช้ซ้ำได้ (FR-07) |

**FK ขาเข้า**: `MeetingParticipant.meetingId`, `Reminder.meetingId`, `MeetingNote.meetingId`, `Decision.meetingId`, `RelatedResource.meetingId`, `Task.meetingId`, `AISummary.meetingId`, ตาราง join `_MeetingGroups`

---

## MeetingParticipant

ผู้เข้าร่วมของแต่ละ meeting พร้อมแหล่งที่มา (BR-04) — join entity ระหว่าง `Meeting` ↔ `Person`

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade` | |
| `personId` | String | ❌ | — | **FK** → `Person.id`, `onDelete: Restrict`, indexed | **Restrict ไม่ใช่ Cascade** — ดูหมายเหตุ BR-02 ที่ตาราง `Person` |
| `role` | String (enum `ParticipantRole`) | ❌ | `ATTENDEE` | | ค่าที่เป็นไปได้: `ORGANIZER`, `ATTENDEE` |
| `rsvpStatus` | String (enum `RsvpStatus`) | ❌ | `PENDING` | | ค่าที่เป็นไปได้: `PENDING`, `ACCEPTED`, `DECLINED` |
| `source` | String (enum `ParticipantSource`) | ❌ | `DIRECT` | | ค่าที่เป็นไปได้: `DIRECT` (เลือกทีละคน), `GROUP` (มาจากกลุ่ม), `EXTERNAL` (พิมพ์อีเมลนอกระบบ) — BR-04, resolve ครั้งเดียวตอนสร้าง ไม่คำนวณซ้ำภายหลัง (สอดคล้อง BR-03) |
| `sourceGroupId` | String | ✅ | `null` | **FK** → `ContactGroup.id`, `onDelete: SetNull`, indexed | มีค่าเมื่อ `source = GROUP` เท่านั้น — เก็บไว้แม้กลุ่มถูกลบภายหลัง |

**Constraint พิเศษ**: `@@unique([meetingId, personId])` — 1 คนเข้าร่วม meeting เดียวกันซ้ำไม่ได้ แม้จะถูกเลือกมาจากหลายแหล่งพร้อมกัน (BR-04's "จัดการข้อมูลซ้ำ")

---

## MeetingNote

บันทึกการประชุม — หลายรายการต่อ 1 meeting, แต่ละรายการ attribute ผู้บันทึกและเวลา — FR-11/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `content` | String | ❌ | — | | เนื้อหาบันทึก |
| `authorId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้บันทึก |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |

---

## Decision

มติ/สิ่งที่ตัดสินใจจากการประชุม — ย้อนกลับไปดู project ผ่าน `meeting.projectId` (ไม่มี `projectId` ของตัวเอง โดยตั้งใจ กันไม่ให้ decision ชี้ไป project คนละอันกับ meeting ต้นทาง) — FR-13/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `content` | String | ❌ | — | เนื้อหามติ |
| `decidedById` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้บันทึกมติ |
| `decidedAt` | DateTime | ❌ | `now()` | | เวลาตัดสินใจ |
| `createdAt` | DateTime | ❌ | `now()` | | เวลาบันทึกเข้าระบบ (แยกจาก `decidedAt` เผื่อบันทึกย้อนหลัง) |

---

## RelatedResource

ข้อมูลประกอบการประชุม (URL/เอกสาร/ไฟล์) — หลายรายการต่อ 1 meeting — FR-12/BR-15

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |
| `title` | String | ❌ | — | | ชื่อ resource |
| `url` | String | ❌ | — | | ลิงก์ไปยังไฟล์/เอกสาร |
| `type` | String (enum `ResourceType`) | ❌ | `LINK` | | ค่าที่เป็นไปได้: `LINK`, `DOCUMENT`, `FILE` |
| `addedById` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้เพิ่ม |
| `createdAt` | DateTime | ❌ | `now()` | | |

---

## Task

งาน/action item — อาจเกิดจากการประชุม หรือสร้างอิสระก็ได้ — FR-14

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `title` | String | ❌ | — | | |
| `description` | String | ✅ | `null` | | |
| `status` | String (enum `TaskStatus`) | ❌ | `NOT_STARTED` | indexed | ค่าที่เป็นไปได้: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` — BR-16 (แยกเสร็จ/ค้างได้) |
| `priority` | String (enum `TaskPriority`) | ❌ | `MEDIUM` | | ค่าที่เป็นไปได้: `LOW`, `MEDIUM`, `HIGH` |
| `dueDate` | DateTime | ✅ | `null` | indexed | กำหนดส่ง |
| `createdAt` | DateTime | ❌ | `now()` | | |
| `updatedAt` | DateTime | ❌ | auto | | |
| `completedAt` | DateTime | ✅ | `null` | | เวลาที่ทำเสร็จจริง |
| `assigneeId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull`, indexed | ผู้รับผิดชอบ (บัญชี login) |
| `assigneePersonId` | String | ✅ | `null` | **FK** → `Person.id`, `onDelete: SetNull` | ผู้รับผิดชอบในฐานะ contact (รองรับ external assignee) |
| `createdById` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | ผู้สร้างงาน |
| `projectId` | String | ✅ | `null` | **FK** → `Project.id`, `onDelete: SetNull` | |
| `meetingId` | String | ✅ | `null` | **FK** → `Meeting.id`, `onDelete: SetNull` | การประชุมต้นทาง (FR-14: "การประชุมต้นทาง") |

**FK ขาเข้า**: `TaskComment.taskId`, `TaskAttachment.taskId`

---

## TaskComment

ความคิดเห็นในงาน

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `taskId` | String | ❌ | — | **FK** → `Task.id`, `onDelete: Cascade`, indexed | |
| `authorId` | String | ✅ | `null` | **FK** → `User.id`, `onDelete: SetNull` | |
| `content` | String | ❌ | — | | |
| `createdAt` | DateTime | ❌ | `now()` | | |

---

## TaskAttachment

ไฟล์แนบของงาน

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `taskId` | String | ❌ | — | **FK** → `Task.id`, `onDelete: Cascade`, indexed | |
| `fileName` | String | ❌ | — | | ชื่อไฟล์ต้นฉบับ |
| `fileUrl` | String | ❌ | — | | path ที่เก็บไฟล์จริง (`/uploads/tasks/{taskId}/...`) |
| `fileSize` | Int | ❌ | — | | ขนาดไฟล์ (bytes) จำกัดสูงสุด 10MB ที่ชั้น API |
| `mimeType` | String | ❌ | — | | |
| `uploadedAt` | DateTime | ❌ | `now()` | | |

---

## Reminder

การแจ้งเตือนก่อนประชุม — 1 meeting มีได้หลายรายการ (BR-11) — FR-10

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | ลบ meeting → ลบ reminder ที่ผูกอยู่ทั้งหมด |
| `scheduledAt` | DateTime | ❌ | — | | เวลาที่ควรส่ง (คำนวณจาก `meeting.startTime - offset` ตอนสร้าง) |
| `status` | String (enum `ReminderStatus`) | ❌ | `PENDING` | indexed | ค่าที่เป็นไปได้: `PENDING`, `SENT`, `FAILED`, `CANCELLED` — ครบตามที่ FR-10 กำหนด |
| `failureReason` | String | ✅ | `null` | | ข้อความ error เมื่อส่งไม่สำเร็จ |
| `sentAt` | DateTime | ✅ | `null` | | เวลาที่ส่งจริง |
| `retryCount` | Int | ❌ | `0` | | จำนวนครั้งที่เคย retry |
| `createdAt` | DateTime | ❌ | `now()` | | |

**หมายเหตุ BR-14**: เมื่อ meeting ถูกยกเลิก (`status = CANCELLED`) endpoint `/api/meetings/[id]/cancel` จะ update reminder ที่ยังไม่ส่งของ meeting นั้นเป็น `CANCELLED` — เป็น application-level logic ไม่ใช่ DB constraint

---

## Notification

การแจ้งเตือนในแอป (in-app)

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `userId` | String | ❌ | — | **FK** → `User.id`, `onDelete: Cascade` | |
| `type` | String (enum `NotificationType`) | ❌ | — | | ค่าที่เป็นไปได้: `MEETING_INVITE`, `MEETING_UPDATED`, `MEETING_CANCELLED`, `TASK_ASSIGNED`, `AI_SUMMARY_READY`, `REMINDER` |
| `title` | String | ❌ | — | | |
| `body` | String | ✅ | `null` | | |
| `isRead` | Boolean | ❌ | `false` | | |
| `relatedId` | String | ✅ | `null` | | id ของ meeting/task ที่เกี่ยวข้อง ตีความตาม `type` (ไม่ใช่ FK บังคับ เพราะชี้ไปได้หลายตาราง) |
| `createdAt` | DateTime | ❌ | `now()` | | |

**Index พิเศษ**: `@@index([userId, isRead])` — ใช้ query "แจ้งเตือนที่ยังไม่อ่านของ user นี้" ให้เร็ว

---

## AISummary

สรุปก่อนประชุมที่ AI ช่วยสร้าง — 1 meeting มีได้สูงสุด 1 summary — FR-15, BR-18/19/20

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `id` | String (cuid) | ❌ | `cuid()` | PK | |
| `meetingId` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, **UK** | unique constraint ทำให้เป็น 1-1 กับ Meeting จริงๆ |
| `content` | String | ❌ | — | | เนื้อหาสรุปที่ AI สร้าง (แก้ไขได้ ผ่าน `isEdited`) |
| `sources` | String | ✅ | `null` | | JSON-encoded array ของ `{label, refType, refId}` — ตรวจสอบย้อนกลับได้ว่าใช้ข้อมูลอะไรสร้างสรุป (BR-19) |
| `model` | String | ❌ | — | | ชื่อโมเดล AI ที่ใช้สร้าง (เช่น `claude-opus-5`) |
| `isEdited` | Boolean | ❌ | `false` | | ผู้ใช้แก้ไขเนื้อหาสรุปแล้วหรือยัง |
| `generatedAt` | DateTime | ❌ | `now()` | | |

**หมายเหตุ BR-18/20**: การสร้าง/regenerate summary ใหม่ **ไม่ลบ** `MeetingNote`/`Decision`/`RelatedResource` ต้นฉบับ เพราะเป็นคนละตารางกันโดยสิ้นเชิง (`AISummary` แค่ FK ไปหา `Meeting` เท่านั้น ไม่ได้เก็บ copy ของ notes ไว้)

---

## `_MeetingGroups` (implicit M-N join table)

ตาราง join ที่ Prisma สร้างอัตโนมัติจาก `ContactGroup.meetings ↔ Meeting.groups` (แถวใน `Meeting` model:
`groups ContactGroup[] @relation("MeetingGroups")`) — ใช้เมื่อ "เพิ่มทั้งกลุ่ม" เป็นผู้เข้าร่วม ไม่มีคอลัมน์เสริมใดๆ
(ต่างจาก `ContactGroupMember`/`ProjectMember` ที่มี role/joinedAt) จึงไม่มี Prisma model ของตัวเอง

| คอลัมน์ | Type | Nullable | Default | Constraint | คำอธิบาย |
|---|---|---|---|---|---|
| `A` | String | ❌ | — | **FK** → `ContactGroup.id`, `onDelete: Cascade` | ชื่อคอลัมน์ตายตัวจาก Prisma (เรียงตามชื่อ model ตามตัวอักษร) |
| `B` | String | ❌ | — | **FK** → `Meeting.id`, `onDelete: Cascade`, indexed | |

**Constraint พิเศษ**: `@@unique([A, B])` — กลุ่มเดียวกันถูกเพิ่มเข้า meeting เดียวกันซ้ำไม่ได้

---

## Enum ทั้งหมดในระบบ (สรุปรวม)

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
