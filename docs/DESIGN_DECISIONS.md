# DESIGN_DECISIONS.md — เหตุผลของการออกแบบ schema ในขั้นตอนที่ 2 (ข้อ 1-4)

> อ้างอิงจาก `docs/GAP_ANALYSIS.md` หัวข้อ "สรุปสิ่งที่ต้องทำในขั้นตอนที่ 2 เป็นต้นไป" ข้อ 1-4
> Migration: `prisma/migrations/20260906020941_add_notes_decisions_resources_online_link_participant_source`

---

## 1. Meeting Notes / Decisions / Related Resources — 3 entity แยก ไม่รวมเป็นอันเดียว

**ทางเลือกที่พิจารณา**: (ก) ตาราง `MeetingLog` เดียวที่มี `type` enum (NOTE/DECISION/RESOURCE) กับ (ข) 3 ตารางแยก (`MeetingNote`, `Decision`, `RelatedResource`)

**ตัดสินใจ**: แยก 3 ตาราง

**เหตุผล**: แต่ละอย่างมี field เฉพาะที่ไม่เหมือนกัน (`RelatedResource` ต้องมี `url`+`type` document/link/file, `Decision` ต้องมี `decidedAt` ที่มีความหมายต่างจาก `createdAt`) การรวมเป็นตารางเดียวจะทำให้ field ส่วนใหญ่เป็น nullable ปนกันและ query แต่ละประเภทต้องกรอง `type` เพิ่มทุกครั้ง ในขณะที่ 3 ตารางแยกยัง JOIN กลับ `Meeting` ได้ตรงไปตรงมาเหมือนกัน ไม่มี query ไหนซับซ้อนขึ้นจริง

**Decision ไม่มี `projectId` ของตัวเอง**: จงใจไม่ใส่ FK ตรงไป `Project` — trace ผ่าน `meeting.projectId` เท่านั้น เพื่อไม่ให้เกิดกรณี decision ชี้ไป project คนละอันกับ meeting ต้นทางของมันเอง (data ไม่ inconsistent ได้เพราะ schema ไม่เปิดช่องให้ทำผิดตั้งแต่แรก)

---

## 2. Reusable Online Meeting Link — entity แยก + `Meeting.onlineMeetingResourceId` แทนที่ `location`

**ทางเลือกที่พิจารณา**: (ก) เปลี่ยน `location` ให้เป็น FK ไปเลย (บังคับทุก meeting ออนไลน์ต้องมี resource) กับ (ข) เพิ่ม field ใหม่ `onlineMeetingResourceId` แยกจาก `location` เดิม โดยทั้งคู่ nullable

**ตัดสินใจ**: (ข) — เพิ่มแยก ไม่แทนที่

**เหตุผล**: `location` ยังจำเป็นสำหรับห้องประชุมจริง (physical room) ซึ่งไม่ใช่ concept เดียวกับ "ลิงก์ออนไลน์ที่ reuse ได้" การบังคับรวมเป็น field เดียวจะทำให้ต้องมี logic แยกแยะว่า string นั้นคือ URL หรือชื่อห้อง (fragile) ส่วนการปล่อยให้ทั้งคู่ nullable พร้อมกันทำให้ migration ไม่ทำลายข้อมูลเดิม (`location` เดิมทุกแถวยังอยู่ครบ) และ UI จะค่อยๆ ย้าย meeting ออนไลน์ไปใช้ `onlineMeetingResourceId` ทีละอันได้โดยไม่ต้อง backfill พร้อมกันทั้งหมด

**onDelete: SetNull** (ไม่ใช่ Restrict/Cascade): ลบลิงก์ที่ยังมี meeting อ้างอิงอยู่ไม่ควรถูกบล็อกแบบเดียวกับ BR-02 (ไม่ใช่ "ประวัติการเข้าร่วมประชุม" ที่ห้ามหาย) — meeting ที่เหลือแค่ไม่มีลิงก์อีกต่อไป ผู้จัดต้องเพิ่มใหม่ ซึ่งเป็นพฤติกรรมที่ยอมรับได้และไม่ทำให้ meeting หรือประวัติอื่นเสียหาย

---

## 3. Participant source tracking (BR-04) และการป้องกัน hard-delete ทำลายประวัติ (BR-02)

### 3a. `MeetingParticipant.source` / `sourceGroupId`

เพิ่ม enum `ParticipantSource { DIRECT, GROUP, EXTERNAL }` และ `sourceGroupId` nullable FK ไป `ContactGroup` (`onDelete: SetNull` — กลุ่มต้นทางถูกลบภายหลังไม่ควรทำให้แถว participant ที่มีอยู่แล้วหายไปด้วย มันแค่ไม่รู้ว่ามาจากกลุ่มไหนอีกต่อไป) resolve ค่านี้ครั้งเดียวตอนสร้าง meeting ใน `resolveParticipants()` (`src/app/api/meetings/route.ts`) ตามหลัก snapshot เดียวกับที่ BR-03 ยืนยันไปแล้วว่าถูกต้อง — ไม่มีการ query สดกลับไปยัง group ภายหลัง

ลำดับความสำคัญเมื่อคนคนเดียวมาจากหลายแหล่งพร้อมกัน: **DIRECT ชนะเสมอ** (เพราะเป็นการเลือกที่จงใจที่สุด) ถ้าไม่ใช่ DIRECT แล้วมาจากหลายกลุ่ม จะใช้กลุ่มแรกที่เจอ (schema เก็บได้แค่ 1 `sourceGroupId` ต่อแถว ไม่ใช่ array — ตัดสินใจไม่ให้ participant ยึดติดกับหลายกลุ่มพร้อมกัน เพราะ "มาจากกลุ่มไหน" ในบริบทนี้ใช้ตอบคำถามเชิงรายงานเป็นหลัก ไม่ใช่ business rule ที่ต้อง exact)

### 3b. BR-02 — เลือก `onDelete: Restrict` + soft-guard ที่ API แทนการทำ personId nullable + snapshot fields

**ทางเลือกที่พิจารณา** (ตามที่ระบุไว้ใน `GAP_ANALYSIS.md` เดิม):
- (ก) เปลี่ยน `MeetingParticipant.personId` เป็น nullable, `onDelete: SetNull`, เพิ่ม `personNameSnapshot`/`personEmailSnapshot` เพื่อให้แถวประวัติยังอยู่ได้แม้ Person ต้นทางถูกลบจริง
- (ข) เปลี่ยน `onDelete: Cascade` → `Restrict` บน `MeetingParticipant.person` แล้วบังคับให้ `DELETE /api/people/[id]` ปฏิเสธการลบ (409) เมื่อ person นั้นมีประวัติเข้าร่วมประชุมอยู่ — ให้ผู้ใช้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" (`status: INACTIVE`, มีอยู่แล้วในฟอร์มแก้ไข) แทน

**ตัดสินใจ**: (ข)

**เหตุผล**:
1. **Ripple น้อยกว่ามาก** — (ก) ทำให้ `person` เป็น optional ทุกที่ที่ `include: { participants: { include: { person: true } } }` ถูกใช้ (`meetings/[id]/page.tsx`, `MeetingForm.tsx`, `ai-summary/route.ts`, `reminders/[id]/retry/route.ts`) ต้องแก้ nullable-check ทุกจุดที่อ่าน `p.person.name`/`.email`/`.avatarUrl` เพิ่มความเสี่ยง regression โดยไม่ได้แก้ปัญหาที่ต่างจาก (ข)
2. **การรับประกันที่แน่นกว่า** — (ข) ปฏิเสธการ hard-delete ที่ DB level ด้วย FK constraint จริง (`ON DELETE RESTRICT`) ไม่ใช่แค่ระดับ application logic เพียงอย่างเดียว ต่อให้มี code path อื่นในอนาคตที่เรียก `prisma.person.delete()` ตรงๆ โดยไม่ผ่าน endpoint นี้ ก็ยังถูกบล็อกอยู่ดี
3. **ไม่มีข้อมูลซ้ำซ้อนที่ต้อง sync** — (ก) ต้องเขียน `personNameSnapshot`/`personEmailSnapshot` ทุกครั้งที่สร้าง participant และไม่มีประโยชน์เพิ่มถ้า Person ไม่เคยถูกลบเลย (กรณีทั่วไป) ส่วน (ข) ไม่ต้องเก็บข้อมูลซ้ำเลย ประวัติสมบูรณ์ 100% เพราะ Person ต้นฉบับไม่เคยถูกลบจริง
4. **ปุ่ม "ลบ" ในหน้า Person ยังมีความหมายตรงตัว** — ไม่ใช่การแปลงให้ "ลบ" กลายเป็น "ปิดใช้งาน" แบบเงียบๆ (ซึ่งจะขัดกับข้อความยืนยัน "การกระทำนี้ไม่สามารถย้อนกลับได้" ที่มีอยู่แล้วใน UI) — คนที่ไม่เคยมีประวัติเข้าร่วมประชุมยังลบจริงได้ตามปกติ มีแค่คนที่มีประวัติแล้วเท่านั้นที่ต้องเปลี่ยนสถานะแทน ซึ่งระบบมีฟีเจอร์นี้อยู่แล้ว (`PUT /api/people/[id]`, `status: INACTIVE`)

**ผลคือ**: BR-02 กลายเป็น ✅ เต็มรูปแบบ ไม่ใช่ "ลดความเสี่ยง" เฉยๆ — hard-delete ที่จะทำลายประวัติทำไม่ได้อีกต่อไปทั้งจาก UI ปกติและจาก DB constraint

---

## 4. Multi-reminder flow (FR-10, BR-11)

Schema ของ `Reminder` ไม่ต้องแก้ (`meetingId` ไม่เคย unique มาตั้งแต่แรก รองรับหลายแถวต่อ meeting อยู่แล้ว) ช่องว่างทั้งหมดอยู่ที่ flow การสร้าง:

- `POST /api/meetings` เดิม hardcode `reminders: { create: [{ scheduledAt: startTime - 30min }] }` เพียงรายการเดียวเสมอ
- แก้เป็นรับ `reminderOffsetMinutes: number[]` (default `[30]` เพื่อไม่ให้ caller เดิมที่ไม่ส่ง field นี้เห็นพฤติกรรมเปลี่ยน) แล้วสร้าง reminder หนึ่งแถวต่อค่าที่ส่งมา
- เพิ่ม `POST /api/reminders` ใหม่ (`{ meetingId, offsetMinutes }`) สำหรับเพิ่ม reminder รายการที่ 2, 3, ... ให้ meeting ที่สร้างไปแล้ว โดยไม่ต้องแก้ meeting ทั้งตัว

**ยังไม่ทำในรอบนี้**: การเพิ่ม input หลายช่องใน `MeetingForm.tsx` ให้ผู้ใช้กรอก offset ได้เองตอนสร้างนัดหมาย (ตอนนี้ยังส่ง `[30]` เป็นค่าเดียวเสมอจากฟอร์ม) — API พร้อมรับหลายค่าแล้ว แต่ UI ฝั่งสร้าง meeting ยังไม่มีช่องให้กรอกเพิ่ม เป็นงานที่เหลือสำหรับรอบถัดไป

---

## อัปเดต: UI ของข้อ 1-4 ต่อครบแล้ว (รอบถัดไปหลังบันทึกนี้)

ทั้ง 3 จุดที่เคยค้างไว้ด้านบนถูกปิดแล้ว:

- หน้า meeting detail มี `MeetingNotesCard`/`MeetingDecisionsCard`/`MeetingResourcesCard` (`src/app/(app)/meetings/[id]/MeetingContext.tsx`) แสดงรายการจริง + ฟอร์มเพิ่ม ต่อกับ API เดิมที่มีอยู่แล้ว
- `MeetingForm.tsx` มี picker เลือก/สร้าง `OnlineMeetingResource` (เลือกจากรายการเดิม หรือสร้างใหม่แบบ inline แล้วใช้ทันที)
- `MeetingForm.tsx` มี editor สำหรับหลาย reminder offset: โหมดสร้างใช้ chip + preset ตามตัวอย่างในเอกสาร (7 วัน/2 วัน/1 วัน/1 ชม. ก่อน) ส่งเป็น `reminderOffsetMinutes[]`; โหมดแก้ไขดึงรายการ reminder จริงของ meeting ผ่าน `GET /api/reminders?meetingId=` (query param ใหม่) มาแสดงพร้อมยกเลิก/เพิ่มได้ทันทีโดยไม่ต้องรอ submit ฟอร์ม

ตรวจสอบ end-to-end จริงผ่าน HTTP (login จริง + POST/PUT/GET ทุก endpoint ที่แก้) ไม่ใช่แค่ build ผ่าน — รายละเอียดผลตรวจอยู่ใน `docs/GAP_ANALYSIS.md` หัวข้อ "วิธีที่ตรวจสอบ"

## สิ่งที่ยังไม่ทำจริงๆ (นอกเหนือ scope ข้อ 1-4)

- FR-03: `MeetingForm.tsx` ยังไม่แสดงป้ายบอกแหล่งที่มา (DIRECT/GROUP/EXTERNAL) ของผู้เข้าร่วมแต่ละคนให้ผู้ใช้เห็น (ข้อมูลมีอยู่แล้วใน `MeetingParticipant.source` แค่ยังไม่โชว์ใน UI)
- BR-13: ยังไม่มี scheduler/cron ที่ยิง reminder จริงตามเวลาที่ตั้งไว้ — เป็นงาน delivery infrastructure แยกต่างหาก ไม่ใช่ schema หรือ UI

---

## 5. Auth Migration / RLS / View-Function-Trigger (รอบล่าสุด)

> Migration: `20260910142937_supabase_auth_uuid_migration`, `20260911120000_enable_rls_policies`,
> `20260911130000_upcoming_meetings_overdue_action_items_views`,
> `20260911140000_process_due_reminders_function`, `20260911150000_get_meeting_context_function`,
> `20260911160000_cancel_meeting_reminders_trigger` — ดูสถานะ FR/BR ที่ได้รับผลกระทบใน `docs/GAP_ANALYSIS.md`
> หัวข้อบนสุด (ไม่กระทบ FR/BR ข้อไหนเลย ยกเว้น BR-14 ที่กลไกเปลี่ยนแต่ status ยัง ✅ เหมือนเดิม)

### 5.1 Profile-table pattern (`public.User` ↔ `auth.users`) — ทำไมไม่ใช้ auto-insert trigger

**ทางเลือกที่พิจารณา**: (ก) trigger แบบที่ Supabase แนะนำทั่วไป — `on_auth_user_created` ที่ยิง `INSERT INTO public."User"` อัตโนมัติทุกครั้งที่มี row ใหม่ใน `auth.users` กับ (ข) ไม่มี trigger เลย — ให้ application code เป็นคน `INSERT` `public."User"` เองตรงๆ ทันทีหลังเรียก `auth.admin.createUser()` สำเร็จ

**ตัดสินใจ**: (ข)

**เหตุผล**: ระบบนี้ไม่มี self-signup เลย (FR-01 ยัง ⚠️ ด้วยเหตุผลนี้ตรงๆ) — ทุกจุดที่สร้าง user จริง (`prisma/seed.ts`, `scripts/test-authorization.ts`) เรียก `supabaseAdmin.auth.admin.createUser()` แล้วตามด้วย `prisma.user.create({ data: { id: authUserId, email, name, role, ... } })` ทันที เพื่อกรอกข้อมูลโปรไฟล์ (`name`, `role`, `department`, `title` ฯลฯ) ที่ `auth.admin.createUser()` ไม่รู้จักและไม่มีทางรู้ (ไม่ได้อยู่ใน request ของมัน) ถ้ามี trigger insert `public."User"` อัตโนมัติคู่ขนานไปด้วย จะชนกับ `INSERT` ที่ app code ทำเองทันที (primary key ซ้ำ) เว้นแต่จะเปลี่ยน app code ให้ `UPDATE` แทน `INSERT` — เพิ่มความซับซ้อนของ 2 ระบบที่ต้อง sync กันโดยไม่ได้ประโยชน์อะไรเพิ่ม เพราะ flow การสร้าง user ของระบบนี้ไม่เคยเป็นเคสที่ trigger pattern ถูกออกแบบมาแก้ (self-signup ที่ profile ไม่มีข้อมูลบังคับอะไรนอกจาก id/email) แต่เป็นเคสที่ admin/สคริปต์เป็นคนกรอกข้อมูลโปรไฟล์ครบตั้งแต่ตอนสร้างเสมอ

**ผลคือ**: `public."User"` ทุก row สร้างโดย application code เท่านั้น ไม่มี race condition ระหว่าง trigger กับ app code ให้ต้องกังวล และถ้าวันหนึ่งเปิด self-signup จริง (แก้ FR-01) ก็แค่เพิ่ม route ใหม่ที่ทำ 2 ขั้นตอนเดียวกันนี้ (createUser แล้ว insert profile) ไม่ต้องรื้อ pattern ที่มีอยู่

### 5.2 Notification ไม่มี admin-bypass บน select/update (ต่างจาก `assertOwner()` pattern ปกติของตารางอื่น)

**ทางเลือกที่พิจารณา**: (ก) ใช้ pattern เดียวกับทุกตารางอื่นที่มีเจ้าของ — owner-or-admin ทั้ง SELECT/UPDATE (แบบที่ RLS ของ `User`/`Project`/`Task` ฯลฯ ใช้ ซึ่งแปลตรงมาจาก `assertOwner()` checks ที่มีอยู่แล้วในแอป — "translated 1:1 from the assertOwner() checks already live in each route" ตามที่บันทึกไว้ใน commit ของ `20260911120000_enable_rls_policies`) กับ (ข) owner-only ล้วนๆ ไม่มี admin bypass เลยสำหรับทั้ง SELECT และ UPDATE

**ตัดสินใจ**: (ข)

**เหตุผล**: `assertOwner()` มี admin-bypass ทุกจุดเพราะมี use case จริงรองรับ — admin ต้องแก้ไข/ลบข้อมูลแทนเจ้าของได้จริงในสถานการณ์จริง (เช่น ผู้ดูแลระบบช่วยแก้ไข meeting ให้ผู้ใช้ที่ลาออกไปแล้ว) แต่ `Notification` ไม่มี route หรือหน้า UI ไหนในระบบเลยที่ต้องให้ admin อ่านหรือ mark-read การแจ้งเตือนแทนคนอื่น (ตรวจแล้ว: ไม่มี `src/app/api/notifications/**` เลยสักไฟล์ — ทุกจุดที่สร้าง `Notification` ทำผ่าน Prisma ตรงๆ ในโค้ด server เช่น `PATCH /api/tasks/[id]` สร้าง `TASK_ASSIGNED` notification โดยตรง ไม่มี endpoint ให้ list/mark-read ข้ามผู้ใช้เลยแม้แต่จุดเดียว) การใส่ admin-bypass ไว้ล่วงหน้าโดยไม่มี use case จริงรองรับจะเป็นการเปิดช่องให้ admin อ่านเนื้อหาที่อาจละเอียดอ่อนของคนอื่น (เช่นข้อความแจ้งเตือนงานที่มอบหมาย) โดยไม่มีเหตุผลทางธุรกิจรองรับเลย ขัดกับหลัก least privilege ตรงๆ — INSERT ยังคงเป็น admin-only เหมือนเดิม (ไม่ใช่ `insert_all_authenticated` แบบตารางอื่น) เพราะทุก insert จริงวันนี้วิ่งผ่าน Prisma (bypass RLS อยู่แล้ว) การตั้งเป็น admin-only ไว้ก็แค่ปิดไม่ให้ authenticated ทั่วไป insert แจ้งเตือนปลอมยัดใส่ user อื่นผ่าน PostgREST ตรงๆ ได้ในอนาคต ถ้าวันหนึ่งมี route จริงที่ต้องให้ admin จัดการ notification ของคนอื่น (เช่นหน้า admin ดู notification log) ค่อยเพิ่ม policy ตอนนั้นตาม use case จริง ไม่ใช่เปิดสิทธิ์ไว้ล่วงหน้าแบบเดา

### 5.3 ทำไม `is_admin()`/`is_meeting_participant()` เป็น `SECURITY DEFINER` แต่ `process_due_reminders()`/`get_meeting_context()` เป็น `SECURITY INVOKER`

**ทางเลือกที่พิจารณา**: ให้ทั้ง 4 ฟังก์ชันเป็น `SECURITY DEFINER` เหมือนกันหมด (เขียน pattern เดียวจำง่าย ไม่ต้องคิดแยกแต่ละตัว) กับ เลือก security mode ตามหน้าที่จริงของแต่ละฟังก์ชัน

**ตัดสินใจ**: เลือกตามหน้าที่จริง — `DEFINER` 2 ตัว (`is_admin`, `is_meeting_participant`), `INVOKER` 2 ตัว (`process_due_reminders`, `get_meeting_context`)

**เหตุผล**: `is_admin()`/`is_meeting_participant()` ถูกเรียก**จากข้างใน `CREATE POLICY` ของตารางอื่น** (เช่น policy ของ `MeetingNote`/`Decision`/`RelatedResource`/`Reminder` เรียก `is_meeting_participant("meetingId")`, เกือบทุกตารางเรียก `is_admin()`) — ถ้าเป็น `SECURITY INVOKER` ธรรมดา การเช็ค "ผู้ใช้นี้เป็น ADMIN ไหม" ข้างในฟังก์ชันต้อง `SELECT` จาก `public."User"` ซึ่งตัว `public."User"` เองก็มี RLS ของตัวเองเปิดอยู่ (`select_all_authenticated` วันนี้ทุกคนอ่านได้ก็จริง แต่ถ้าวันหนึ่ง policy นั้นถูกทำให้แคบลง การเรียก `SELECT` ซ้อนแบบนี้จะพังทันทีหรือได้ผลลัพธ์ผิด) `SECURITY DEFINER` ทำให้ query ภายในฟังก์ชันรันด้วยสิทธิ์เจ้าของฟังก์ชัน (ข้าม RLS ของ `User`/`MeetingParticipant`/`Person` ที่มันอ่าน) ซึ่งจำเป็นเพื่อให้ policy อื่นเรียกใช้ได้โดยไม่ recursion กลับเข้า RLS ของตัวเอง — คู่กับ `SET search_path = ''` เพื่อบล็อก search_path hijacking (ทุก identifier ในฟังก์ชัน schema-qualify ไว้แล้ว)

`process_due_reminders()`/`get_meeting_context()` ไม่เคยถูกเรียกจากข้างใน policy อื่นเลย — เป็นฟังก์ชันที่ route/ผู้ใช้เรียก**ตรงๆ**เพื่ออ่านข้อมูล ไม่มีเหตุผลให้ข้าม RLS ของใครทั้งสิ้น ถ้าตั้งเป็น `SECURITY DEFINER` โดยไม่จำเป็นจะกลายเป็นการเปิดช่องให้ authenticated ทุกคนเห็นข้อมูลเกินกว่าที่ RLS ของ `Reminder`/`Meeting`/`Task` ตั้งใจจะกรองไว้ — แม้วันนี้ `select_all_authenticated` ของตารางเหล่านี้จะ "ทุกคนอ่านได้" เหมือนกันอยู่แล้วก็ตาม แต่การตั้งเป็น `SECURITY INVOKER` ไว้ตั้งแต่แรกทำให้ถ้าวันหนึ่ง SELECT policy ของ `Reminder`/`Task` ถูกทำให้แคบลง (เช่น จำกัดเฉพาะผู้เข้าร่วม/ผู้จัด) ฟังก์ชันทั้งสองนี้จะเคารพ policy ใหม่นั้นโดยอัตโนมัติทันที ไม่ต้องมีใครจำได้ว่าต้องกลับมาแก้โค้ดฟังก์ชันเพิ่ม (ต่างจาก `DEFINER` ที่จะ "ค้าง" สิทธิ์แบบเก่าไว้เงียบๆ จนกว่าจะมีคนสังเกตเห็น)

### 5.4 ทำไม `Task.delete` ไม่รวม assignee (ต่างจาก `update` ที่รวม)

**ทางเลือกที่พิจารณา** (ทั้งคู่เป็น `assertOwner()` check ที่มีอยู่จริงในแอปมาตั้งแต่ก่อนงาน RLS รอบนี้แล้ว — RLS แค่ "translate 1:1" มันมาเป็น policy เท่านั้น บันทึกไว้ตรงนี้เพราะเป็น design เดิมที่ไม่เคยถูกอธิบาย "ทำไม" ไว้ที่ไหนมาก่อน): (ก) ให้ assignee ลบ task ของตัวเองได้เหมือนที่แก้ไขได้ (สมมาตรกับ update) กับ (ข) จำกัด delete ไว้แค่ creator (หรือ admin) เท่านั้น ตัด assignee ออกจาก delete

**ตัดสินใจ**: (ข) — ตรงกับที่ `src/app/api/tasks/[id]/route.ts` บังคับไว้จริงวันนี้ (`PATCH`: `existing.assigneeId === user.id || existing.createdById === user.id`; `DELETE`: `existing.createdById === user.id` เท่านั้น ไม่เช็ค `assigneeId` เลย)

**เหตุผล**: assignee คือคน "รับผิดชอบงาน" ไม่ใช่เจ้าของงาน — สิ่งที่ assignee ควรทำได้คือปรับ `status`/เพิ่ม comment/แนบไฟล์ความคืบหน้า (ตรงกับที่ `UPDATE` อนุญาต) แต่การลบ task ทั้งแถวเป็นการตัดสินใจระดับ "งานนี้ไม่ควรมีอยู่ในระบบอีกต่อไป" ซึ่งควรเป็นสิทธิ์ของคนที่สร้าง/มอบหมายงาน (creator) เท่านั้น — ถ้าให้ assignee ลบได้ด้วยจะเปิดความเสี่ยงที่ assignee ลบ task ทิ้งเพื่อหนีงานที่ไม่อยากรับผิดชอบ โดยที่ creator ไม่รู้ตัวเลยและไม่มีทางตรวจสอบย้อนหลังได้ (เป็น hard delete ไม่เก็บ log) ต่างจาก `UPDATE` ที่ต่อให้ assignee แก้ไข field ต่างๆ ตัว task ก็ยังอยู่ครบให้ creator เห็นและตรวจสอบย้อนหลังได้เสมอ ความไม่สมมาตรระหว่าง update/delete นี้จึงสะท้อนความแตกต่างจริงระหว่าง "จัดการงานของตัวเองที่ได้รับมอบหมาย" (assignee ทำได้เต็มที่) กับ "ตัดสินใจว่างานนี้ควรมีอยู่ในระบบหรือไม่" (สงวนไว้ให้ creator/admin เท่านั้น ตรงกับที่ผู้สร้างงานควรเป็นคนตัดสินใจว่างานที่ตัวเองมอบหมายไปยังจำเป็นอยู่ไหม)

### 5.5 ทำไม `create_meeting_with_participants()` เป็น `SECURITY DEFINER` — ต่างจาก `is_admin()`/`is_meeting_participant()` (ถูกเรียกจาก policy) และต่างจาก `process_due_reminders()`/`get_meeting_context()` (อ่านอย่างเดียว)

> Migration: `20260911170000_create_meeting_with_participants_function` — hybrid migration รอบที่ 1 (Meeting resource); เอกสารอ้างอิงเพิ่มเติม: `docs/GAP_ANALYSIS.md` (Transaction ที่หายไป)

**บริบท**: รอบนี้เริ่ม hybrid migration — ให้ frontend เรียก Supabase ตรง (ผ่าน `supabase-js`/PostgREST) แทน Next.js API + Prisma สำหรับบางจุด โดยเลือก "สร้างการประชุม" เป็นต้นแบบ เพราะเดิม `POST /api/meetings` ทำ 4 การเขียนติดกัน (insert `Meeting` → insert `MeetingParticipant` ทุกคน → insert `Reminder` ตาม offset → insert `Notification` ให้ผู้เข้าร่วมภายในทุกคน) โดยไม่มี transaction ครอบเลย (Prisma เขียนแต่ละ operation แยก request ไปที่ DB) — ถ้า request ที่ 3 ล้มเหลว จะเหลือ `Meeting`+`MeetingParticipant` ค้างอยู่แบบไม่มี `Reminder`/`Notification` คู่กัน ย้ายมาเป็น Postgres function เดียวแก้ปัญหานี้ตรงจุด เพราะ function body ทั้งหมดรันอยู่ใน transaction เดียวของ statement ที่เรียกมันโดยธรรมชาติของ Postgres (ไม่ต้องเขียน `BEGIN`/`COMMIT` เอง — ผิดพลาดจุดไหน rollback ทั้งฟังก์ชันอัตโนมัติ)

**ทางเลือกที่พิจารณา**: (ก) `SECURITY INVOKER` เหมือน `process_due_reminders()`/`get_meeting_context()` (ฟังก์ชันอ่านอย่างเดียว 2 ตัวก่อนหน้า) กับ (ข) `SECURITY DEFINER` เหมือน `is_admin()`/`is_meeting_participant()`

**ตัดสินใจ**: (ข) — `SECURITY DEFINER`

**เหตุผล**: ขั้นตอนที่ 7 ในฟังก์ชัน (insert `Notification` ให้ผู้เข้าร่วมภายในทุกคนที่ถูกเชิญ) ชนกับ policy `insert_admin_only` ของตาราง `Notification` (ดู §5.2 — insert เป็น admin-only ล้วนๆ ไม่มี "organizer/participant" bypass เหมือนตารางอื่น) ตรงๆ: ผู้ใช้ role MEMBER ที่เป็นผู้จัดประชุม (organizer) ไม่ใช่ admin จึงไม่มีสิทธิ์ insert `Notification` ให้คนอื่นเลยถ้าเป็น `SECURITY INVOKER` — ทั้งที่ "แจ้งเตือนผู้เข้าร่วมว่ามีคนเชิญประชุม" เป็นพฤติกรรมที่ต้องใช้งานได้กับผู้จัดประชุมทุกคน ไม่ใช่เฉพาะ admin นี่ต่างจาก `is_admin()`/`is_meeting_participant()` ที่เป็น DEFINER เพราะถูกเรียก**จากข้างใน policy ของตารางอื่น** (ป้องกัน recursion) และต่างจาก `process_due_reminders()`/`get_meeting_context()` ที่เป็น INVOKER เพราะเป็นฟังก์ชันอ่านอย่างเดียวไม่มีเหตุผลให้ข้าม RLS ของใคร — ฟังก์ชันนี้เป็นกรณีที่สาม: ฟังก์ชันที่**เขียน**ข้ามขอบเขตของ RLS ของผู้ใช้คนอื่นจริงๆ (เขียนแทนคนอื่น ไม่ใช่แค่อ่าน) ด้วยเหตุผลทางธุรกิจที่ชัดเจน (ผู้จัดประชุมต้องแจ้งเตือนผู้เข้าร่วมได้)

**การป้องกันไม่ให้ SECURITY DEFINER เปิดช่องโหว่ยกระดับสิทธิ์**: เพราะฟังก์ชันนี้ bypass RLS ของ `Notification` (และโดยอ้อม ของ `Meeting`/`MeetingParticipant`/`Person`/`Reminder`/`_MeetingGroups` ทุกตารางที่มันเขียน) จึงต้องเช็ค authorization **ด้วยตัวเองก่อนอื่นใดในบรรทัดแรกของ function body** แทนที่จะพึ่ง RLS ทำหน้าที่นั้นแทน (ต่างจากฟังก์ชัน INVOKER ที่ RLS ยังทำงานป้องกันอยู่เสมอ): พารามิเตอร์ `p_organizer_id` (uuid ที่จะกลายเป็น `Meeting.organizerId`) ต้องตรงกับ `auth.uid()` ของผู้เรียกจริง หรือผู้เรียกต้องเป็น `is_admin()` เท่านั้น — ถ้าไม่ตรงและไม่ใช่ admin ฟังก์ชัน `RAISE EXCEPTION` ทันทีก่อนแม้แต่จะ `INSERT INTO "Meeting"` แถวแรก ถ้าไม่มีเช็คนี้ MEMBER คนไหนก็จะสั่งสร้างประชุม "ในนาม" user อื่น พร้อมยัด `Notification`/`MeetingParticipant` ปลอมให้คนอื่นได้ทั้งระบบผ่านฟังก์ชันเดียว — ตรงกับสิ่งที่ SECURITY DEFINER เสี่ยงเปิดช่องไว้ถ้าไม่ระวัง (Postgres docs เตือนเรื่องนี้ตรงๆ) พิสูจน์ด้วย `npx tsx` เรียก RPC จริงด้วย session ของ MEMBER (siriporn) ทั้ง (1) กรณีปกติ organizerId = ตัวเอง → สำเร็จ ได้ participant/reminder/notification ครบ (2) กรณีเดียวกันแต่เรียก `.from("Notification").insert()` ตรงๆ (ไม่ผ่านฟังก์ชัน) → RLS ยัง block เหมือนเดิม (พิสูจน์ว่า DEFINER ไม่ได้เปิดช่องกว้างเกินตัวฟังก์ชันเอง) และ (3) ลองส่ง `p_organizer_id` เป็น id ของ admin คนอื่น → ถูก `RAISE EXCEPTION` ปฏิเสธ ทั้ง 3 เคสผ่าน

**`SET search_path = ''`**: เหมือนทุกฟังก์ชันก่อนหน้าในไฟล์นี้ — ทุก identifier ที่อ้างตารางใน function body schema-qualify ด้วย `public.` ไว้หมด (built-in อย่าง `now()`/`gen_random_uuid()`/`unnest()`/`split_part()`/`array_position()` ไม่ต้อง qualify เพราะ `pg_catalog` อยู่ใน search path เสมอไม่ว่าตั้งค่าอย่างไร)

### 5.6 ทำไม `update_project_with_members()` เป็น `SECURITY INVOKER` — ต่างจาก `create_meeting_with_participants()` (§5.5)

> Migration: `20260912090000_update_project_with_members_function` — hybrid migration รอบ Projects resource

**บริบท**: เช่นเดียวกับ `create_meeting_with_participants()`, `PUT /api/projects/[id]` เดิมทำ 3 การเขียนที่ต้อง atomic กัน (update `Project` → deleteMany `ProjectMember` เดิมทั้งหมด → create `ProjectMember` ใหม่ตาม `memberIds` ที่ส่งมา) — ย้ายมาเป็น Postgres function เดียวด้วยเหตุผลเดียวกัน: function body รันอยู่ใน transaction เดียวของ statement ที่เรียกมันเสมอ ผิดพลาดจุดไหน (เช่น `personId` ปลอมชน `ProjectMember_personId_fkey`) rollback ทั้งก้อนอัตโนมัติ ฟังก์ชันนี้ยังไม่ถูกเรียกจากหน้าไหนจริงในรอบนี้ (`projects/page.tsx` มีแค่ list+create, `projects/[id]/page.tsx` เป็น read-only Server Component) — เพิ่มไว้เป็นโครงสร้างพื้นฐานที่ verify แล้ว รอรอบ hybrid migration ของหน้าแก้ไขโปรเจกต์ในอนาคต เหมือนที่ฟังก์ชันอ่านอย่างเดียวบางตัวก่อนหน้าถูกเพิ่มไว้ก่อนมี caller จริงเช่นกัน

**ทางเลือกที่พิจารณา**: (ก) `SECURITY INVOKER` เหมือน `process_due_reminders()`/`get_meeting_context()` กับ (ข) `SECURITY DEFINER` เหมือน `create_meeting_with_participants()`

**ตัดสินใจ**: (ก) — `SECURITY INVOKER`

**เหตุผล**: `create_meeting_with_participants()` ต้องเป็น DEFINER เพราะขั้นตอนหนึ่งในนั้น (insert `Notification` แทนผู้เข้าร่วมคนอื่น) เป็นสิ่งที่ผู้เรียก (organizer ที่เป็น MEMBER ธรรมดา) **ไม่มีสิทธิ์ทำเองตรงๆ** อยู่แล้วถ้าไม่ผ่านฟังก์ชัน (ชน policy `insert_admin_only` ของ `Notification`) — ฟังก์ชันจึงต้อง bypass RLS ของตารางนั้นแทนผู้เรียก และต้องเช็ค authorization เองก่อนบรรทัดแรกเพื่อไม่ให้กลายเป็นช่องโหว่ (ดู §5.5) `update_project_with_members()` ไม่มีสถานการณ์แบบนั้นเลย: ทุกคำสั่งในฟังก์ชัน (update `Project`, delete/insert `ProjectMember`) เป็นสิ่งที่ manager ตัวจริงของโปรเจกต์นั้น (หรือ admin) มีสิทธิ์ทำเองอยู่แล้วทีละคำสั่งผ่าน RLS ปกติอยู่แล้ว — `update_manager_or_admin` บนตาราง `Project` (`"managerId" = auth.uid() OR is_admin()`) และ `insert_project_manager_or_admin`/`delete_project_manager_or_admin` บนตาราง `ProjectMember` (เช็คผ่าน parent project's `managerId` เดียวกัน) ครอบคลุมทุกคำสั่งในฟังก์ชันนี้พอดีอยู่แล้ว ไม่มีคำสั่งไหนต้องข้าม RLS ของใคร ดังนั้นปล่อยให้ RLS เป็นคนคุมสิทธิ์ตามปกติ (INVOKER) ปลอดภัยกว่าและง่ายกว่า: ถ้า caller ไม่ใช่ manager/admin ของโปรเจกต์นั้น คำสั่ง `UPDATE "Project"` บรรทัดแรกจะโดน RLS กรองแบบเงียบๆ (0 แถว ไม่ error) ทันที — ฟังก์ชันเช็คด้วย `IF NOT FOUND THEN RAISE EXCEPTION` แค่เพื่อแปลงเป็น error ที่อ่านออกให้ผู้เรียก ไม่ใช่เพื่อทำหน้าที่ authorization เอง (RLS ทำไปแล้วตั้งแต่บรรทัดนั้น) และเพราะไม่ได้ bypass อะไร จึงไม่มีความเสี่ยงที่ caller จะส่งพารามิเตอร์ปลอม (เช่น "แสร้งว่าตัวเองเป็น manager") มาหลอกฟังก์ชันได้แบบที่ SECURITY DEFINER ต้องระวัง — ไม่มีพารามิเตอร์ "manager check" ให้ปลอมตั้งแต่แรก เพราะ auth.uid() ที่ RLS ใช้เช็ค ผูกกับ session จริงของผู้เรียกเสมอ ปลอมไม่ได้จาก client

พิสูจน์ด้วย `npx tsx` เรียก RPC จริงด้วย session จริง: (1) MEMBER ที่ไม่ใช่ manager ของโปรเจกต์เป้าหมายเรียกฟังก์ชัน → ถูก RLS บล็อกตั้งแต่ `UPDATE "Project"` (0 แถว) ฟังก์ชัน raise exception, `ProjectMember` เดิมไม่ถูกแตะเลย (ไม่ถึงบรรทัด DELETE ด้วยซ้ำ) (2) manager ตัวจริง/admin เรียกฟังก์ชันแก้ทั้ง field และ member list → สำเร็จ ครบตามที่ส่งไป (3) ส่ง `personId` ปลอมปนอยู่ใน `p_member_person_ids` → FK violation (23503) กลางฟังก์ชัน แล้ว `ProjectMember` ชุดเดิมยังอยู่ครบ (ไม่ใช่ถูกลบไปแล้วค้างว่างเปล่า) พิสูจน์ rollback อัตโนมัติจริง

**`SET search_path = ''`**: เหมือนทุกฟังก์ชันก่อนหน้าในไฟล์นี้ — ทุก identifier ที่อ้างตารางใน function body schema-qualify ด้วย `public.` ไว้หมด

### 5.7 ทำไม `update_meeting_with_participants()` เป็น `SECURITY INVOKER` — ต่างจาก `create_meeting_with_participants()` (§5.5) แม้จะทำงานคล้ายกันมาก, และ NULL vs `{}` ต่างกันอย่างไรในพารามิเตอร์ participant 3 ตัว

> Migration: `20260912100000_update_meeting_with_participants_function` — hybrid migration รอบแก้ไขการประชุม (Meeting resource, edit round)

**บริบท**: `PUT /api/meetings/[id]` เดิมทำ 2 การเขียนที่ต้อง atomic กัน (update `Meeting` fields → ถ้ามี `groupIds`/participant-related ส่งมา ก็ยัง `groups: { set: [...] }` และ/หรือ `participants: { deleteMany: {}, create: [...] }` ต่อ) เหมือน `create_meeting_with_participants()`/`update_project_with_members()` ก่อนหน้า ย้ายมาเป็น Postgres function เดียวด้วยเหตุผลเดียวกัน: function body รันในทรานแซกชันเดียวของ statement ที่เรียกมันเสมอ ผิดพลาดจุดไหน (เช่น query กลุ่ม/external email ล้มเหลวกลางทาง) rollback ทั้งก้อนอัตโนมัติ — ต่าง update `Meeting` fields ที่คอมมิตไปแล้วแบบลอยๆ ไม่มี participant คู่กันเหมือนที่เคยเสี่ยงตอน multi-request ของ Prisma

**ความซับซ้อนเพิ่มจาก create/update_project ก่อนหน้า**: field ธรรมดา (title/description/type/status/location/startTime/endTime/projectId/onlineMeetingResourceId) เป็น partial update ปกติ (caller จริงตอนนี้ - `MeetingForm.tsx` - ส่งครบทุก field เสมอในทุกครั้งที่ save อยู่แล้ว จึงไม่มีเคส "ไม่ส่ง field ธรรมดามาเลยแล้วต้องคงค่าเดิมไว้" ที่ต้องรองรับจริง) แต่พารามิเตอร์ participant-related ทั้ง 3 ตัว (`p_participant_person_ids`/`p_group_ids`/`p_external_emails`) ต้องแยกแยะ "ไม่ได้ส่งมาเลย" ออกจาก "ส่งมาเป็น array ว่าง" ให้ได้ตรงกับ handler เดิมเป๊ะ — เดิม `shouldResolveParticipants` เช็คด้วย `!== undefined` (ไม่ใช่ `!= null`) เพราะ TypeScript object spread จะไม่มี key นั้นเลยถ้า client ไม่ส่งมาในตัว JSON แปลว่า Prisma ไม่แตะ `participants`/`groups` เดิมเลย ต่างจากส่ง `[]` มาตรงๆ ซึ่งหมายถึง "ลบทั้งหมด" ชัดเจน ฝั่ง SQL แก้ปัญหานี้ได้ตรงๆ เพราะ Postgres array แยก `NULL` (ไม่มีค่า) ออกจาก `ARRAY[]::text[]` (มีค่า แต่ว่างเปล่า) ได้เป็นธรรมชาติอยู่แล้ว — ให้พารามิเตอร์ทั้ง 3 ตัว `DEFAULT NULL` แล้วเช็ค `IS NOT NULL` แทน `!== undefined` ได้ตรงความหมายเดียวกันทุกประการ ไม่ว่า caller จะ "ไม่ส่ง key นั้นมาเลย" (PostgREST ใช้ default ของฟังก์ชัน = `NULL`) หรือ "ส่ง `null` มาตรงๆ" (มีความหมายเดียวกับไม่ส่ง — ทั้งคู่แปลว่า "อย่าแตะ") ก็ได้ผลเหมือนกันโดยไม่ขัดแย้งกันเอง ส่วน `p_group_ids` เป็นกรณีพิเศษที่ควบคุม 2 เรื่องพร้อมกัน (เหมือน handler เดิม): `groups: { set }` ของ `_MeetingGroups` (เช็คแค่ `groupIds !== undefined` เดี่ยวๆ) และเป็นหนึ่งใน 3 ตัวที่ gate การ resolve participant ใหม่ทั้งชุดด้วย

**ทางเลือกที่พิจารณา**: (ก) `SECURITY INVOKER` เหมือน `update_project_with_members()` (§5.6) กับ (ข) `SECURITY DEFINER` เหมือน `create_meeting_with_participants()` (§5.5)

**ตัดสินใจ**: (ก) — `SECURITY INVOKER`

**เหตุผล**: แม้ฟังก์ชันนี้จะก็อปโครงสร้าง DIRECT/GROUP/EXTERNAL resolution มาจาก `create_meeting_with_participants()` เกือบทั้งหมด แต่ **ไม่มีขั้นตอน insert `Notification`** เลย — นี่คือขั้นตอนเดียวใน `create_meeting_with_participants()` ที่บังคับให้ต้องเป็น DEFINER (ชนกับ `insert_admin_only` policy ของ `Notification`, ดู §5.5) เพราะการแก้ไขนัดหมายที่มีอยู่แล้วไม่เคยส่ง notification ใหม่ทาง DB เลยแม้แต่ตอนยังเป็น Prisma (การแจ้งเตือนตอนแก้ไขทำผ่านอีเมลแยกต่างหาก คือ `POST /api/meetings/[id]/notify`, เป็น TypeScript/best-effort เหมือนเดิมทุกประการ ไม่เกี่ยวกับฟังก์ชันนี้) ทุกคำสั่งเขียนจริงที่เหลือ (`UPDATE "Meeting"`, insert/delete บน `_MeetingGroups`, insert/delete บน `MeetingParticipant`) เป็นสิ่งที่ organizer ตัวจริง (หรือ admin) มีสิทธิ์ทำเองอยู่แล้วทีละคำสั่งผ่าน RLS ปกติอยู่แล้ว — `update_organizer_or_admin` บน `Meeting`, `insert_meeting_organizer_or_admin`/`delete_meeting_organizer_or_admin` บนทั้ง `MeetingParticipant` และ `_MeetingGroups` (เช็คผ่าน `Meeting.organizerId` เดียวกัน) ครอบคลุมทุกคำสั่งพอดี — เหตุผลเดียวกับ `update_project_with_members()` เป๊ะ (§5.6) จึงเลือก INVOKER เหมือนกัน

**ต่างจาก §5.6 ตรงที่มีเช็คสิทธิ์เอง (explicit) อยู่บรรทัดแรกของ function body ด้วย ไม่ได้พึ่ง RLS ทำหน้าที่นั้นเงียบๆ อย่างเดียว**: `update_project_with_members()` ปล่อยให้ `UPDATE "Project"` โดน RLS กรอง 0 แถวเงียบๆ แล้วค่อยจับด้วย `IF NOT FOUND` ทีหลัง แต่ฟังก์ชันนี้ทำเช็คตรงๆ ก่อนแม้แต่จะแตะตารางใดๆ (`v_organizer_id IS DISTINCT FROM auth.uid() AND NOT is_admin() → RAISE EXCEPTION`) ด้วยเหตุผลด้าน UX ล้วนๆ ไม่ใช่ความปลอดภัย: อยากได้ error message เดียวกับ `assertOwner()` เดิมเป๊ะ ("เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่แก้ไขการประชุมนี้ได้") แทนที่จะปล่อยให้เป็น error ทั่วไปจาก "0 แถว" — เช็คนี้เช็คกับ **`organizerId` เดิมของ meeting ที่มีอยู่แล้วในตาราง** (query แยกก่อน) ไม่ใช่กับพารามิเตอร์ `p_organizer_id` แบบ `create_meeting_with_participants()` เพราะ update ไม่มีทางเปลี่ยนตัวผู้จัดประชุมได้เลย (ไม่มี field นั้นให้แก้ในฟอร์มแก้ไข) — RLS ยังทำงานเป็นชั้นป้องกันจริงอยู่ข้างหลังเหมือนเดิม เช็คนี้เป็นแค่ชั้นให้ error message อ่านง่ายซ้อนไว้ ไม่ใช่ตัวเดียวที่กันสิทธิ์

**Edge case ที่ INVOKER เปิดขึ้นมาแต่ DEFINER ของ create ไม่มี (บันทึกไว้ตรงๆ ไม่ใช่ปัญหาที่ปิดบัง)**: ขั้นตอน EXTERNAL email ใช้ `INSERT ... ON CONFLICT (email) DO UPDATE` บน `Person` — ฝั่ง INSERT ผ่านได้เสมอ (`insert_all_authenticated`, `WITH CHECK (true)`) แต่ฝั่ง `DO UPDATE` ต้องผ่าน `update_unlinked_or_owner_or_admin` (`"userId" IS NULL OR "userId" = auth.uid() OR is_admin()`) ด้วย — คนภายนอกจริง (`userId IS NULL`) ผ่านเสมอ แต่ถ้าใครพิมพ์อีเมลของเพื่อนร่วมงาน**ภายใน**ที่มี `userId` ผูกอยู่แล้ว (ไม่ใช่ตัวเอง ไม่ใช่ admin) ลงในช่อง external email โดยไม่ตั้งใจ แถวนั้นจะมองไม่เห็นฝั่ง UPDATE ภายใต้ RLS ของผู้เรียก ทำให้ Postgres ขึ้น unique-violation-style error แทนที่จะแนบคนนั้นเข้าประชุมเงียบๆ แบบที่ DEFINER ของ `create_meeting_with_participants()` ทำได้ (เพราะ bypass RLS ของ `Person` ไปเลย) — ไม่ได้แก้ปัญหานี้ในรอบนี้เพราะทางแก้มีแค่ 2 ทาง: (1) เปลี่ยนกลับไปเป็น DEFINER ทั้งฟังก์ชัน (เสียเหตุผลหลักที่เลือก INVOKER ไปเลย) หรือ (2) เพิ่ม `SELECT` เช็คอีเมลชนกับ Person ภายในก่อน insert (เพิ่ม complexity ที่ scope งานนี้ไม่ได้ขอ) — เป็น edge case ของ input ที่ผิดปกติ (พิมพ์อีเมลคนในองค์กรผิดที่) ไม่ใช่ช่องโหว่ด้านสิทธิ์ จึงเลือกบันทึกไว้ตรงๆ แทนที่จะแอบแก้เกินสโคป

**`SET search_path = ''`**: เหมือนทุกฟังก์ชันก่อนหน้าในไฟล์นี้ — ทุก identifier ที่อ้างตารางใน function body schema-qualify ด้วย `public.` ไว้หมด
