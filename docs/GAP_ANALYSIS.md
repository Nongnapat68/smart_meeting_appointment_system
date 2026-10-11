# GAP_ANALYSIS.md — เทียบระบบปัจจุบันกับ `requirements/requirements.md.md`

> จัดทำจากการอ่านโค้ดจริง (`prisma/schema.prisma`, `src/app/api/**`, `src/lib/**`, `src/components/**`) ไม่ใช่การเดา
> อัปเดตล่าสุดหลัง migration `20260906020941_add_notes_decisions_resources_online_link_participant_source`
> + UI ของขั้นตอนที่ 2 ข้อ 1-4 ต่อเข้ากับ `MeetingForm.tsx`/`meetings/[id]/page.tsx` แล้ว
> + รอบข้อ 3-5: FR-03 แสดงป้ายแหล่งที่มาในหน้ารายละเอียดประชุมจริงแล้ว, FR-18 ปิดการใช้ AI สำหรับ
> one-shot meeting ทั้ง API guard และ UI แล้ว
> + รอบ A-C (ล่าสุด): (A) แยก FR-16 (วิเคราะห์ประเด็นค้าง) / FR-17 (แนะนำ agenda) ออกจาก FR-15 เป็นความสามารถ/ปุ่ม/endpoint
> อิสระ พร้อมเพิ่ม `RelatedResource` ของ meeting ก่อนหน้าเข้าไปในบริบทของ FR-15 ที่เดิมดึงได้แค่ของ meeting ปัจจุบัน
> (B) FR-08 (.ics generator + ปุ่มดาวน์โหลด), FR-09 (ต่อ wiring ส่งอีเมลเชิญ+แนบ .ics ตอนสร้าง/แก้ไขครบทุก call site
> จริง แต่ `sendEmail()` ยังเป็น stub — ยังไม่ส่งอีเมลจริง), BR-13 (endpoint
> ประมวลผล reminder ที่ถึงเวลา กันส่งซ้ำ) (C) eslint cleanup เหลือ 0 warning — ตรวจสอบจริงผ่าน `npm run build`,
> `tsc --noEmit`, `npm run lint` (0 warning), `npm run test:authz` และ end-to-end ผ่าน HTTP จริง
> (login จริง → POST/GET ทุก endpoint ใหม่ → เห็นผลใน DB จริง) ไม่ใช่แค่เดา
> + รอบ Auth Migration/RLS/View-Function-Trigger (ล่าสุด): ย้าย login/session จาก JWT+bcrypt ของระบบเองไปเป็น
> Supabase Auth ทั้งหมด (`User.id` ตอนนี้คือ uuid เดียวกับ `auth.users.id` ข้าม schema, `ON DELETE CASCADE`) —
> ไม่กระทบสถานะ FR/BR ข้อไหนเลยเพราะเป็นการย้าย mechanism ของ auth/session ที่มีอยู่แล้ว ไม่ใช่ feature ใหม่หรือ
> พฤติกรรมที่ requirements.md ข้อไหนพูดถึงโดยตรง จากนั้นเปิด Row Level Security บนทั้ง 20 ตารางจริง (72 policy รวม
> `is_admin()`/`is_meeting_participant()` เป็น SECURITY DEFINER helper) เป็นชั้นป้องกันเพิ่มที่ระดับ database เอง
> (defense-in-depth สำหรับ client เข้าถึงตรงในอนาคตผ่าน supabase-js/PostgREST) — **ไม่มี BR ข้อไหนใน 20 ข้อพูดถึง
> "สิทธิ์การเข้าถึงข้อมูล" โดยตรง** (ตรวจสอบแล้วทั้ง requirements.md หมวด Business Rules) จึงไม่ผูกกับ BR ข้อใด
> ข้อหนึ่งเป็นพิเศษ แต่เสริมความถูกต้องของระบบโดยรวมตาม "Key Design Principle" (หัวข้อ 11) — เดิม authorization
> ทั้งหมดพึ่ง `assertOwner()` ที่ชั้น application อย่างเดียว (Prisma connect เป็น role ที่มี BYPASSRLS จึง RLS ยัง
> ไม่กระทบ path การใช้งานจริงวันนี้เลย) สุดท้ายเพิ่ม 2 view (`upcoming_meetings`, `overdue_action_items`),
> 2 function (`process_due_reminders()`, `get_meeting_context()`), 1 trigger (`trg_cancel_meeting_reminders`) ตอบ
> requirements.md หัวข้อ 8 ข้อ 4/7/9/14 โดยตรงที่ระดับ SQL — **BR-14 เปลี่ยนกลไกจริง** (ดูแถว BR-14 ด้านล่าง):
> ย้าย logic "meeting ถูกยกเลิก → cancel reminder ที่ค้าง" จาก application code (`updateMany` ใน
> `cancel/route.ts`) ไปเป็น DB trigger แทน — BR-13 (`process-due` endpoint) ยังคง behavior เดิมทุกประการ แค่
> ดึง due-set ผ่าน `process_due_reminders()` แทน query ตรงๆ (ผลลัพธ์เหมือนเดิม ไม่ใช่การเปลี่ยนพฤติกรรม)
> ดูเหตุผลการออกแบบแต่ละจุดใน `docs/DESIGN_DECISIONS.md`
>
> + รอบ Final audit (ล่าสุด): แก้ bug SQL `create_meeting_with_participants()` ขั้น GROUP — เดิมอ้าง `"_MeetingGroups"."groupId"` ที่ไม่มีอยู่จริง (ตาราง join implicit M:N มีแค่ `"A"`/`"B"`) ทำให้สร้างประชุมที่เลือกทั้งกลุ่มล้มเหลวทุกครั้ง; migration `20261011090000` แก้ให้อ่าน `"A"` (ดู §5.5 ใน `DESIGN_DECISIONS.md`) พร้อมลบ dead REST routes 6 ไฟล์ที่ไม่มี caller แล้ว (meetings `[id]`/`reschedule`/`cancel`, groups `[id]`, projects `[id]`, tasks `[id]/comments`) + lib `src/lib/meeting-participants.ts` — `test:authz` เขียนใหม่ให้ probe เฉพาะ `/api/tasks/[id]` ที่ยังเป็น REST route เดียว (5 passed) เพราะ authz ของ meeting/group/project ย้ายไปตรวจที่ RLS layer ผ่าน `test:rls` (34 passed) แทน รอบนี้ยังแก้/เสริมอื่นๆ: กันลบทรัพยากรโดยไม่ยืนยัน (note/decision/resource/สมาชิกกลุ่ม), จำกัดสิทธิ์เขียนตาม RLS ใน UI (ผู้จัด/ผู้เข้าร่วม/admin), `logout` ใช้ `scope: "local"`, JSON ที่ผิดรูปแบบคืน 400, ตรวจวันสิ้นสุดโปรเจกต์ ≥ วันเริ่ม, ตรวจ `OnlineMeetingResource` URL เป็น http/https, ลบโปรเจกต์กำพร้าเมื่อ create meeting ล้ม, และแก้ป้าย back-link ให้ตรงปลายทาง
>
> สถานะ: ✅ ทำแล้วตรงสเปก · ⚠️ ทำบางส่วนแต่ไม่ครบ · ❌ ยังไม่ได้ทำ · ➖ N/A (ยังทดสอบไม่ได้เพราะ entity ที่เกี่ยวข้องยังไม่มีอยู่ในระบบ ไม่ใช่ "ทำบางส่วน" หรือ "ไม่ได้ทำ" ในความหมายปกติ)
>
> หมายเหตุการนับ: แต่ละแถวมีสถานะเดียวเท่านั้น (ไม่มีแถวไหนนับสองสถานะพร้อมกัน) ตัวเลขในหัวข้อ "สรุปภาพรวม" นับจากตารางจริงด้านล่าง 1 ต่อ 1
>
> หมายเหตุเกณฑ์ให้สถานะ: แถว **FR** (feature ที่ผู้ใช้ต้องเข้าถึงได้จริงผ่านแอป) ต้องมี UI ให้ผู้ใช้ทั่วไปใช้งานได้เองจึงจะขึ้น ✅ ไม่ใช่แค่ API พร้อม — รอบนี้ FR-07/10/11/12/13 ผ่านเกณฑ์นี้แล้วเพราะต่อ UI จริงและทดสอบ end-to-end แล้ว แถว **BR** (business rule/invariant) ยังคงให้สถานะจากกลไก backend/schema ที่พิสูจน์ได้จริงเหมือนเดิม (ไม่บังคับต้องมี UI เฉพาะ)

---

## สรุปภาพรวม

ขั้นตอนที่ 2 ข้อ 1-4 เสร็จสมบูรณ์ทั้ง backend และ UI แล้ว: (1) `MeetingNote`/`Decision`/`RelatedResource` มีทั้ง entity, API, และหน้า meeting detail ที่แสดง/เพิ่มได้จริงผ่านฟอร์ม (2) `OnlineMeetingResource` เลือกจากรายการเดิมหรือสร้างใหม่ได้ในฟอร์มสร้าง/แก้ไขนัดหมาย ทดสอบแล้วว่า 1 ลิงก์ผูกกับหลาย meeting ได้จริง และแก้ไข url ที่จุดเดียวมีผลกับทุก meeting ที่อ้างอิงทันที (3) `MeetingParticipant.source`/`sourceGroupId` และปิดช่องโหว่ hard-delete ผ่าน `onDelete: Restrict` (4) กำหนดหลาย reminder offset เองได้ทั้งตอนสร้าง (chip + preset 7วัน/2วัน/1วัน/1ชม.) และเพิ่มทีหลังในโหมดแก้ไข (แสดงรายการจริงพร้อมสถานะ + ยกเลิกได้)

รอบข้อ 3-5: (5) หน้า meeting detail แสดงป้าย DIRECT/GROUP/EXTERNAL ต่อผู้เข้าร่วมแต่ละคนจริงแล้ว (FR-03) (6) ปิดการใช้ AI สำหรับ one-shot meeting ทั้ง API guard (`POST /api/meetings/[id]/ai-summary` ตอบ 400 ถ้า `meeting.type === "SINGLE"`) และ UI (ปุ่มเรียก AI ถูก disable พร้อม tooltip อธิบายเหตุผล ทั้งหน้า `/ai-assistant` และหน้า meeting detail) (FR-18)

รอบ A-C ต่อเนื่องจากนั้น:
- **(A)** แยกความสามารถ AI 3 อย่างออกจากกันจริง ไม่ใช่ปุ่มเดียวรวม: FR-15 (สรุปก่อนประชุม, ปรับให้ดึง `RelatedResource` ของ meeting ก่อนหน้าเพิ่มด้วย ไม่ใช่แค่ Task/Meeting เหมือนเดิม), FR-16 (`POST /api/meetings/[id]/pending-issues` วิเคราะห์งานที่เลยกำหนด + มติ/บันทึกที่ดูเหมือนยังไม่มีอะไรตามมา), FR-17 (`POST /api/meetings/[id]/agenda-suggestion` รับหัวข้อจากผู้ใช้ผสานกับประเด็นค้างชุดเดียวกับ FR-16) แต่ละอันมีปุ่ม/การ์ด/ผลลัพธ์ของตัวเองในหน้า `/ai-assistant` และเคารพ guard FR-18 เหมือนกันทั้ง 3 (ผ่าน `assertMeetingAllowsAi()` กลาง)
- **(B)** FR-08: `.ics` generator เอง (RFC 5545) + `GET /api/meetings/[id]/ics` + ปุ่มดาวน์โหลดในหน้ารายละเอียดประชุม — parse ผ่าน `node-ical` (พาร์เซอร์จริงจาก npm) สำเร็จครบทุกฟิลด์ ยืนยันว่าเปิดกับ calendar app จริงได้ FR-09: `notifyParticipantsByEmail()` เรียกจริงผ่าน `POST /api/meetings/[id]/notify` (สร้าง/แก้ไข) ส่งถึงผู้เข้าร่วมทุกคน (internal+external) แนบ `.ics` ไปด้วย — แต่ `sendEmail()` ใน `src/lib/email.ts` ยังเป็น stub: log แล้ว return `"simulated"` เสมอ ไม่ว่า `SMTP_HOST` จะตั้งหรือไม่ จึงยังไม่มีการส่งอีเมลจริง (ดู FR-09 ด้านล่าง) BR-13: `POST /api/reminders/process-due` (admin only) ดึง reminder ที่ `PENDING` + ถึงเวลา ส่งอีเมลแล้ว flip เป็น `SENT` ด้วย `updateMany({where:{status:"PENDING"}})` กันยิงซ้ำแม้เรียกซ้อนกัน — ทดสอบเรียก 2 ครั้งติดกันจริง ยืนยันส่งอีเมลแค่ 1 ครั้ง
- **(C)** eslint cleanup: แก้ 14 warning เดิม (react-hooks/set-state-in-effect 10 จุด, font-loading 2 จุด, unused-var/unused-disable-directive ใน seed.ts 2 จุด) เหลือ **0 warning** โดยไม่แก้ logic ที่มีอยู่ (เฉพาะจุดที่ pattern ถูกยืนยันแล้วว่าปลอดภัยตามที่ `eslint.config.mjs` ระบุไว้เอง ใช้ `eslint-disable-next-line` ต่อจุดแทนการปิด rule ทั้งไฟล์)

ทดสอบ end-to-end จริงผ่าน HTTP ทุกรอบ (ไม่ใช่แค่ unit-level): login → สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่า → ยืนยันมี reminder 4 แถวจริงตามเวลาที่คำนวณถูกต้อง; สร้าง/แนบ/แก้ไข `OnlineMeetingResource` → ยืนยันการแก้ไข url สะท้อนไปยัง meeting ที่อ้างอิงทันทีผ่าน FK; POST note/decision/resource → ยืนยันเห็นในหน้า meeting detail จริง (`grep` เนื้อหาใน HTML ที่ render มา); สร้าง meeting พร้อมผู้เข้าร่วมจริง → ยืนยัน `sendEmail` ถูกเรียกจริงใน server log พร้อมไฟล์แนบ, ดาวน์โหลด `.ics` แล้ว parse ผ่าน parser จริง, เรียก `process-due` 2 ครั้งติดกันยืนยันไม่ส่งซ้ำ หลังทดสอบแต่ละรอบรัน `npm run db:seed` reset กลับสู่ข้อมูลตัวอย่างสะอาดเสมอ
ทุกรอบ (3-5, A, B, C): `npm run build` + `tsc --noEmit` + `npm run lint` + `npm run test:authz` (16 passed, 0 failed) ผ่านทั้งหมด — รอบ C ทำให้ `npm run lint` เหลือ **0 warning** เป็นครั้งแรก (จากเดิม 14 warning)

**นับจากตารางจริง**:
- FR (18 ข้อ): ✅ 16 (FR-02 ถึง FR-18 ยกเว้น FR-01 และ FR-09) · ⚠️ 2 (FR-01, FR-09) · ❌ 0
- BR (20 ข้อ): ✅ 20 (ทั้งหมด)

**รอบงาน Ultra-review (ข้อ 11/12/13/23/25/26)**: เป็นรอบความปลอดภัย/ความถูกต้องของสิทธิ์ ไม่ได้เปลี่ยน FR/BR status:
- **ข้อ 13**: เปลี่ยน policy UPDATE/DELETE ของ `MeetingNote`/`Decision`/`RelatedResource` จาก "participant ใดก็ได้" เป็นเฉพาะผู้เขียน (authorId/decidedById/addedById) หรือผู้จัดประชุม หรือ admin — migration `20261005090000_narrow_update_delete_and_attachment_url` (ฝั่ง UI หน้า meeting detail ซ่อน/บล็อกปุ่มแก้-ลบให้สอดคล้องผ่าน `canEditMeetingNote()`/`canEditDecision()`/`canEditRelatedResource()` ใน `src/lib/permissions.ts`) พิสูจน์ด้วย `npm run test:rls` **34 passed, 0 failed**
- **ข้อ 11**: `TaskAttachment` INSERT ต้องมี `fileUrl` ขึ้นต้น `/uploads/tasks/<taskId>/` (กันแนบ url ภายนอก/`javascript:`)
- **ข้อ 12**: `OnlineMeetingResource` UPDATE/DELETE จาก "ใครก็ได้ถ้ายังไม่ถูกอ้าง" เป็นเฉพาะ creator/admin
- **ข้อ 23**: ปิด open redirect ที่ `src/app/login/page.tsx` ผ่าน `src/lib/safe-next-path.ts` (`npm run test:redirect` 18 passed)
- **ข้อ 25**: `dev-server.pid` ถูก gitignore + `git rm --cached`
- **ข้อ 26**: บันทึก FR-09 + เพิ่ม test-rls case ผู้ใช้ MEMBER ส่ง `UPDATE "User" SET role='ADMIN'` โดน trigger 42501
- ตรวจครบ: `tsc --noEmit` 0, `eslint` 0, `build` clean, `test:authz` 16/16, `test:otp` 61/61, `test:reminders` 49/49, `test:uploads` 67/67

**รอบ final-audit (2026-10-11)**: ไม่เปลี่ยนสถานะ FR/BR ข้อใด — RLS: WITH CHECK ของ UPDATE บน MeetingNote/Decision/RelatedResource ผูก `meetingId` ใหม่ + path ของ TaskAttachment ไม่มี wildcard (`20261011100000`), index ให้ FK 14 คอลัมน์ + ถอน TRUNCATE/TRIGGER/REFERENCES จาก anon/authenticated (`20261011110000`), Stored Procedure จริง `private.reschedule_meeting_proc` อยู่หลัง RPC `reschedule_meeting` เดิม (`20261011120000`, ดู DESIGN_DECISIONS §5.10); โค้ด: B8 timezone, B12 ปุ่ม AI ตามสิทธิ์, B14 เอา "จดจำฉัน" ที่ไม่มีผลออก, B16 อินพุตงานผิดตอบ 400/404, B17 ข้อความ/ตัวเลือก reminder ที่เลยเวลา, B19 ผู้ติดต่อ, B25 คำ/การแสดงผล (ป้าย "ผ่านไปแล้ว" N8, ตารางสัปดาห์นี้เฉพาะของตัวเอง N9, ประชุมข้ามวัน, สถานะโปรเจกต์ไทย), สวิตช์การแจ้งเตือนในหน้าตั้งค่ามีผลจริง — ตรวจ: lint 0, tsc 0, build ผ่าน, `test:rls` 51/51, `test:authz` 14/14, `test:otp` 61/61, `test:reminders` 49/49, `test:uploads` 67/67, `test:redirect` 32/32, `test:format` 9/9

---

## ตาราง Functional Requirements

| # | หัวข้อ | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| FR-01 | User & Contact Management | ⚠️ | สถานะไม่เปลี่ยน — ยังไม่มีหน้าสมัครสมาชิกแบบเปิด ยกไป**ขั้นตอนถัดไป (ข้อ 1)** — รอบ 2026-10-11 (B19): ฟอร์ม "เพิ่มผู้ติดต่อ" สร้างได้เฉพาะ "บุคคลภายนอก" (INTERNAL หมายถึงมีบัญชีผู้ใช้ ซึ่งเกิดตอนสร้างบัญชีเท่านั้น), ช่องที่เว้นว่างบันทึกเป็น NULL, ช่องค้นหาตัดช่องว่างหัวท้าย — ทั้งสองแบบ (ผู้ใช้ในระบบ/บุคคลภายนอก) ยังรองรับตาม FR-01 |
| FR-02 | Contact Group Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-03 | Quick Invite | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail (`meetings/[id]/page.tsx`) แสดงป้ายแหล่งที่มาต่อผู้เข้าร่วมแต่ละคนจริง — "เลือกโดยตรง" (DIRECT) / "จากกลุ่ม: ชื่อกลุ่ม" (GROUP, ดึงชื่อจริงผ่าน `sourceGroup` relation) / "อีเมลภายนอก" (EXTERNAL) ผ่าน `participantSourceBadge()` ใน `StatusBadge.tsx` อ่านตรงจาก `MeetingParticipant.source`/`sourceGroupId` ที่ backend เขียนถูกต้องแล้วทั้ง create และ edit (BR-04 ✅) ไม่ใช่แค่ schema พร้อมแต่ UI ไม่แสดงเหมือนก่อนหน้านี้ — หมายเหตุ: ก่อน migration `20261011090000_fix_create_meeting_participants_groups` (B1) การสร้างประชุมที่ "เพิ่มทั้งกลุ่ม" ล้มเหลวทุกครั้ง; **ยืนยันบนระบบจริงแล้ว 2026-10-11**: ประชุม "ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 1" สร้างผ่าน RPC ด้วยสิทธิ์ผู้จัดที่เป็น MEMBER พร้อมผู้เข้าร่วมรายคน + ทั้งกลุ่ม "ทีมวิจัย AI Lab" ได้ `source` DIRECT/GROUP ถูกต้องและมีแถว `_MeetingGroups` |
| FR-04 | Meeting / Appointment Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-05 | Meeting Types (One-shot / Project) | ✅ | ไม่เปลี่ยนแปลง |
| FR-06 | Project-based Meeting Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-07 | Reusable Online Meeting Link | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: `MeetingForm.tsx` เพิ่ม field "ลิงก์ประชุมออนไลน์" เป็น `<select>` รายการ `OnlineMeetingResource` ที่มีอยู่ + ตัวเลือก "+ สร้างลิงก์ใหม่..." ที่เปิดฟอร์ม name/url ในหน้าเดียวกัน (สร้างผ่าน supabase-js insert แล้วเลือกให้อัตโนมัติ) หน้า meeting detail แสดงลิงก์ที่ผูกไว้พร้อมเปิดในแท็บใหม่ **ทดสอบจริงผ่าน curl**: สร้าง resource ใหม่ → ผูกกับ meeting → แก้ไข url ของ resource → ยืนยัน meeting ที่ผูกไว้เห็น url ใหม่ทันที (ผ่าน FK ไม่ใช่ copy) — เส้นทางผูกลิงก์ปัจจุบัน: ตอนสร้างผ่าน RPC `create_meeting_with_participants(p_online_meeting_resource_id)` และตอนแก้ไขผ่าน RPC `update_meeting_with_participants(p_online_meeting_resource_id)` (route `PUT /api/meetings/[id]` เดิมที่ใช้ทดสอบครั้งแรกถูกลบไปแล้วในงานข้อ 20/B7 เพราะ UI ไม่เรียกแล้ว) |
| FR-08 | Calendar Invitation (.ics) | ✅ (เดิม ❌ → ✅) | **มี UI จริงแล้ว**: `src/lib/ics.ts` สร้าง `.ics` มาตรฐาน RFC 5545 เอง (title/เวลา/location-online URL/description/organizer/attendees) จาก `GET /api/meetings/[id]/ics` ปุ่มดาวน์โหลดอยู่ในหน้ารายละเอียดประชุม (`MeetingActions.tsx`) **ทดสอบจริง**: ดาวน์โหลดไฟล์จริงแล้ว parse ด้วย `node-ical` (RFC5545 parser จริงจาก npm) สำเร็จครบทุกฟิลด์ตรงกับข้อมูล meeting จริง |
| FR-09 | Invitation Delivery | ⚠️ (เดิม ⚠️ → ✅ → ⚠️) | **wiring ครบทุก call site แต่ยังไม่มีการส่งอีเมลจริง**: `src/lib/meeting-notify.ts` (`notifyParticipantsByEmail()`) ถูกเรียกผ่าน route เดียวคือ `POST /api/meetings/[id]/notify` จาก `MeetingForm.tsx` สองจังหวะ — หลัง RPC `create_meeting_with_participants()` สร้าง meeting (หัวเรื่อง "คำเชิญเข้าร่วมประชุมใหม่") และหลัง RPC `update_meeting_with_participants()` บันทึกการแก้ไข (ส่ง `{ reason: "updated" }` → หัวเรื่อง "อัปเดตนัดหมาย"; route `PUT /api/meetings/[id]` เดิมถูกลบแล้ว) — รอบ 2026-10-11: ผู้เข้าร่วมที่เป็นผู้ใช้ในระบบและปิด "การแจ้งเตือนผ่านอีเมล" ในหน้าตั้งค่าจะไม่ถูกส่ง (บุคคลภายนอกยังได้รับเสมอ, ไฟล์ .ics ยังระบุผู้เข้าร่วมครบ) — ประกอบเนื้อหาชื่อ/เวลา/location-ลิงก์/รายละเอียด และแนบ `.ics` (FR-08) ครบทุกผู้เข้าร่วม (internal+external) เป็น best-effort (try/catch ไม่ให้ล้มการสร้าง/แก้ไข) **แต่ปลายทางยังไม่ส่งจริง**: `sendEmail()` ใน `src/lib/email.ts` ยังเป็น stub — ไม่ว่า `SMTP_HOST` จะถูกตั้งหรือไม่ ฟังก์ชันยังแค่ `console.log` แล้ว return `"simulated"` เสมอ ไม่มี transport จริงอยู่เบื้องหลัง (มี TODO ระบุไว้ในไฟล์) จึงยังไม่มีอีเมลออกจากเครื่องจริงแม้แต่ฉบับเดียว สถานะจึงเป็น ⚠️ ไม่ใช่ ✅ (requirement FR-09 ใช้คำว่า "ควร" และหัวข้อ 10 ระบุว่าการพัฒนา Mail Server เองอยู่นอกขอบเขต — ดูหัวข้อ "สิ่งที่ยังไม่ทำ (ของจริง)" ด้านล่าง) **ทดสอบจริง**: สร้าง/แก้ไข meeting จริง → ยืนยัน `sendEmail` ถูกเรียกจริงใน server log ครบทุกคนพร้อม `Attachments: meeting.ics` (แต่เป็น log "dev email — not actually sent" ตามที่ฟังก์ชัน stub ทำ) |
| FR-10 | Reminder Management | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: ฟอร์มสร้าง meeting มีตัวเลือก preset (7 วันก่อน/2 วันก่อน/1 วันก่อน/1 ชั่วโมงก่อน — ตรงตามตัวอย่างในเอกสาร requirement) + ช่องกรอกนาทีเอง แสดงเป็น chip ลบได้ ส่งเป็น `reminderOffsetMinutes[]` ตอนสร้างจริง โหมดแก้ไขดึงรายการ reminder จริงของ meeting นั้น (`GET /api/reminders?meetingId=`) แสดงสถานะ ยกเลิกได้ และเพิ่มรายการใหม่ได้ทันทีผ่าน `POST /api/reminders` **ทดสอบจริง**: สร้าง meeting พร้อม offset `[10080,2880,1440,60]` → ยืนยันมี 4 reminders ตรงเวลาที่คำนวณถูกต้องทุกรายการ **กันซ้ำ (FR-10)**: offset ซ้ำถูกกันที่ 4 จุดบังคับใช้ — `MeetingForm.tsx` (ปิด chip offset ที่มีอยู่), `meetingSchema` (`src/lib/validations.ts`), `create_meeting_with_participants()` (ตัวแปร `v_seen_offsets`), และ `POST /api/reminders` — ตั้งใจ**ไม่**ใส่ UNIQUE index บน `(meetingId, scheduledAt)` เพราะ partial index แบบ `status='PENDING'` จะทำให้ `reschedule_meeting()`/`update_meeting_with_participants()` ที่เลื่อน pending reminder ทั้งชุดพร้อมกัน abort ด้วย constraint violation แทนที่จะ degrade (ดู `docs/DESIGN_DECISIONS.md` §4) |
| FR-11 | Meeting Notes | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail มีการ์ด "บันทึกการประชุม" แสดงรายการจริง (ผู้บันทึก + เวลา) พร้อมฟอร์มเพิ่มบันทึกใหม่ (`MeetingNotesCard` ใน `MeetingContext.tsx`) **ทดสอบจริง**: `curl` POST เนื้อหาภาษาไทยผ่านไฟล์ JSON (UTF-8) → ยืนยัน GET กลับมาถูกต้องครบถ้วน ไม่มีการสูญเสียข้อมูล — **รอบ Sprint-3 เพิ่ม**: การแก้ไข/ลบถูกจำกัดไว้ที่ผู้เขียน ผู้จัดประชุม หรือ admin เท่านั้น (policy `update/delete_author_or_organizer_or_admin`, migration `20261005090000_narrow_update_delete_and_attachment_url` ข้อ 13; UI ซ่อนปุ่มตาม `canEditMeetingNote()`; test-rls assertions 10–12) — **รอบ 2026-10-11**: WITH CHECK ของ UPDATE ผูกกับ `meetingId` ใหม่ (migration `20261011100000`) ผู้เขียนย้ายบันทึกไปประชุมที่ตัวเองไม่ได้อยู่ไม่ได้แล้ว (test-rls assertions 15–16) |
| FR-12 | Related Resources | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "เอกสารอ้างอิง" แสดงรายการพร้อมไอคอนตาม `type` (LINK/DOCUMENT/FILE) เปิดลิงก์ในแท็บใหม่ได้ พร้อมฟอร์มเพิ่ม (`MeetingResourcesCard`) — **รอบ Sprint-3 เพิ่ม**: การแก้ไข/ลบถูกจำกัดไว้ที่ผู้เพิ่ม ผู้จัดประชุม หรือ admin เท่านั้น (เช่นเดียวกับ FR-11, ข้อ 13) และ `TaskAttachment` INSERT ต้องมี `fileUrl` ใต้ `/uploads/tasks/<taskId>/` (ข้อ 11) |
| FR-13 | Decisions | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "มติที่ประชุม" แสดงรายการพร้อมผู้บันทึกและเวลา พร้อมฟอร์มเพิ่ม (`MeetingDecisionsCard`) trace กลับ project ผ่าน `meeting.projectId` เหมือนเดิม |
| FR-14 | Action Items | ✅ | ไม่เปลี่ยนแปลง |
| FR-15 | AI Pre-meeting Summary | ✅ | เพิ่มเติมจากรอบก่อน — `gatherMeetingAiContext()` (ใน `src/lib/meeting-ai-context.ts`) ดึง `RelatedResource` ของ meeting ก่อนหน้าในโปรเจกต์เดียวกันเข้ามาด้วย (เดิมดึงได้แค่ resource ของ meeting ปัจจุบัน) และเป็น helper กลางที่ FR-16/17 ใช้ร่วมด้วย — หน้า `/ai-assistant` โหลดสรุปที่บันทึกไว้กลับมาแสดง (B4, `GET /api/meetings/[id]/ai-summary`) และรอบ 2026-10-11 แสดงปุ่มสร้าง/แก้ไขสรุป, วิเคราะห์ประเด็นค้าง, แนะนำ agenda เฉพาะผู้จัดหรือ admin ตามที่ API อนุญาตจริง (B12) ผู้เข้าร่วมอื่นเห็นสรุปแบบอ่านอย่างเดียว |
| FR-16 | Pending Issues Analysis | ✅ (เดิม ❌ → ✅) | **มี UI จริงแล้ว**: การ์ด "วิเคราะห์ประเด็นค้าง" แยกจาก FR-15 ในหน้า `/ai-assistant` เรียก `POST /api/meetings/[id]/pending-issues` — คำนวณ overdue tasks เอง (NOT_STARTED/IN_PROGRESS + เลยกำหนด) ในโค้ด (ไม่พึ่ง AI ล้วนๆ) แล้วส่งพร้อม decisions/notes ให้ AI วิเคราะห์ว่ารายการไหนดูเหมือนยังไม่มีงานตามมา ไม่ persist (แบบเดียวกับ `/api/tasks/ai-schedule` ที่มีอยู่แล้ว) **ทดสอบจริง**: เขียนสคริปต์ชั่วคราวเรียก `gatherMeetingAiContext` ตรงกับ meeting จาก seed data ยืนยัน overdue/open task ถูกคัดแยกตรงกับ due date จริง, decisions/notes ตรงกับที่ seed ไว้คำต่อคำ |
| FR-17 | New Agenda Context | ✅ (เดิม ❌ → ✅) | **มี UI จริงแล้ว**: การ์ด "แนะนำ Agenda การประชุมครั้งถัดไป" แยกอิสระ มีช่องกรอกหัวข้อ + ปุ่ม เรียก `POST /api/meetings/[id]/agenda-suggestion` ผสานหัวข้อที่ผู้ใช้พิมพ์เข้ากับ context ชุดเดียวกับ FR-16 (ผ่าน helper กลางเดียวกัน ไม่ใช่ query แยก) **ทดสอบจริง**: เรียก endpoint จริงผ่าน guard ครบ (ผ่าน FR-18 guard สำหรับ PROJECT meeting, บล็อกสำหรับ SINGLE meeting), validation `topic` ว่างตอบ 400 ก่อนถึง AI |
| FR-18 | AI Usage Scope (ปิด AI สำหรับ One-shot) | ✅ (เดิม ❌ → ✅) | **มี guard จริงทั้ง API และ UI แล้ว**: `POST /api/meetings/[id]/ai-summary` เช็ค `meeting.type === "SINGLE"` แล้วตอบ `400` พร้อมข้อความชัดเจนก่อนเรียก `generateMeetingSummary()` (กัน bypass ผ่าน UI ได้จริง ไม่ใช่แค่ซ่อนปุ่ม) ฝั่ง UI: หน้า `/ai-assistant` (`AiAssistantPanel.tsx`) disable ปุ่ม "สร้างสรุปด้วย AI"/refresh พร้อม `title` tooltip อธิบายเหตุผลเมื่อเลือก meeting ประเภท SINGLE และติดป้าย "ครั้งเดียว" ในรายการ meeting ด้านซ้าย, หน้า meeting detail แสดง "สร้างสรุป" เป็น text ที่กดไม่ได้พร้อม tooltip แทน `<Link>` เมื่อยังไม่มีสรุปและเป็น one-shot |

---

## ตาราง Business Rules

| # | กติกา | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| BR-01 | บุคคลอยู่หลายกลุ่มได้ / กลุ่มมีหลายสมาชิก | ✅ | ไม่เปลี่ยนแปลง |
| BR-02 | ลบคนออกจากกลุ่มไม่ทำให้ประวัติเข้าร่วมประชุมหาย | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| BR-03 | เปลี่ยนสมาชิกกลุ่มภายหลังไม่กระทบผู้เข้าร่วมประชุมเดิม | ✅ | ไม่เปลี่ยนแปลง |
| BR-04 | ผู้เข้าร่วมมาจากหลายแหล่ง + จัดการข้อมูลซ้ำ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ schema/backend พร้อมเหมือนรอบก่อน) — การ resolve `source`/`sourceGroupId` ทำใน SQL ของ RPC `create_meeting_with_participants`/`update_meeting_with_participants` (ไฟล์เดิม `src/lib/meeting-participants.ts` ถูกลบแล้ว) เขียนถูกต้องทั้ง create/edit (แก้ bug ขั้น GROUP ใน migration `20261011090000` — เดิม create ที่เลือกทั้งกลุ่มล้มเหลวทุกครั้ง) และตอนนี้ผู้ใช้ *เห็น* ผลจริงผ่านป้ายในหน้า meeting detail ด้วย ดู FR-03 (รวมผลยืนยันบนระบบจริง 2026-10-11) |
| BR-05 | Meeting แก้ไข/เลื่อน/ยกเลิกได้โดยไม่กระทบ meeting อื่น | ✅ | ไม่เปลี่ยนแปลง |
| BR-06 | Project มีได้หลาย Meeting, Meeting ไม่จำเป็นต้องอยู่ Project | ✅ | ไม่เปลี่ยนแปลง |
| BR-07 | Meeting ใน Project เดียวกันไม่ต้องมีผู้เข้าร่วมชุดเดียวกัน | ✅ | ไม่เปลี่ยนแปลง |
| BR-08 | Continuous meeting ไม่ต้องใช้ Calendar Recurrence (และจัดการ Reminder/Notes/Decisions/Action Items อิสระต่อ meeting ได้) | ✅ | ไม่เปลี่ยนแปลง |
| BR-09 | Online Link เดียวใช้กับหลาย Meeting ได้ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ seed) — ดู FR-07 |
| BR-10 | แก้ไข Online Link ไม่ทำให้ข้อมูลประวัติศาสตร์หายหรือกำกวม | ✅ | ยืนยันซ้ำผ่าน UI/API จริงแล้ว — ดู FR-07 |
| BR-11 | Meeting มีได้หลาย Reminder | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว — ดู FR-10 |
| BR-12 | Reminder แต่ละรายการตรวจสอบสถานะได้ | ✅ | ไม่เปลี่ยนแปลง |
| BR-13 | ป้องกันส่ง Reminder ซ้ำ | ✅ (เดิม ⚠️ → ✅) | `POST /api/reminders/process-due` (admin only) ดึง Reminder ที่ `status=PENDING` และถึงเวลาแล้ว ส่งอีเมล (mock ผ่าน `sendEmail()`) แล้ว flip เป็น `SENT` ด้วย `updateMany({where:{id,status:"PENDING"}})` — กันยิงซ้ำแม้เรียกซ้อนกันจริง (ไม่ใช่แค่เรียงลำดับ) **ทดสอบจริง**: สร้าง reminder ที่ due แล้วจริง → เรียก endpoint 2 ครั้งติดกัน → ครั้งแรก `{"processed":1,"status":"SENT"}` ครั้งสอง `{"processed":0}` DB ยืนยัน `SENT` ค่าเดียว log อีเมลจริงแค่ 1 ครั้ง ไม่ใช่ 2 — เป็น endpoint เรียกเอง ไม่ใช่ cron รันตลอด 24 ชม. (ตามขอบเขตที่กำหนดไว้ ไม่ใช่ scope ที่ขาด) — **รอบ 2026-10-12**: พบว่าการทดสอบเดิมเป็นการเรียกต่อกัน ไม่ใช่พร้อมกัน เมื่อสองรอบทำงานพร้อมกันจริง แถวถูกอัปเดตครั้งเดียวแต่อีเมลถูกส่ง 2 ครั้ง (scratch DB: 4 ใน 5 ครั้ง) เพราะส่งก่อนแล้วค่อย flip สถานะ — แก้ให้ `processDueReminders()` ล็อกแถวด้วย `SELECT … FOR UPDATE OF r SKIP LOCKED` ในทรานแซกชันก่อนส่ง (ตรวจสถานะประชุมซ้ำภายใต้ล็อก) แล้วจึงส่ง/บันทึกผล ผลหลังแก้ 0 ใน 5 ครั้ง และสร้างการแจ้งเตือนในแอปชนิด `REMINDER` (enum เดิม) ในทรานแซกชันเดียวกัน; เพิ่มตัวประมวลผลอัตโนมัติแบบเลือกเปิด (`REMINDER_AUTO_PROCESS=1`, ค่าเริ่มต้นปิด) ใน `src/instrumentation.ts` ที่เรียกฟังก์ชันเดียวกับปุ่ม — `test:reminders` เพิ่มหัวข้อ [7]/[8] |
| BR-14 | Meeting ยกเลิก → reminder ที่ค้างเปลี่ยนเป็น CANCELLED | ✅ (กลไกเปลี่ยน — เดิม application code → ตอนนี้ DB trigger) | **ย้ายจาก application logic ไปเป็น DB trigger แล้ว**: เดิม `POST /api/meetings/[id]/cancel` ทำ 2 คำสั่งแยก (`prisma.meeting.update` + `prisma.reminder.updateMany`) — ตอนนี้ route เหลือแค่ update `Meeting.status` อย่างเดียว, trigger `trg_cancel_meeting_reminders` (`AFTER UPDATE OF status ON "Meeting"`, `WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')`) เป็นคน `UPDATE "Reminder" SET status='CANCELLED' WHERE "meetingId"=NEW.id AND status='PENDING'` แทน **ทดสอบจริง**: cancel meeting ที่มี 2 reminder จริงผ่าน API ด้วย session organizer จริง แล้ว query ตาราง `Reminder` ตรงๆ ยืนยัน status เปลี่ยนเป็น `CANCELLED` ทั้งคู่ (ไม่ใช่แค่เชื่อว่า trigger ทำงาน) — พฤติกรรมที่ผู้ใช้เห็นเหมือนเดิมทุกประการ เปลี่ยนแค่ว่า guarantee นี้บังคับที่ DB layer แล้ว ไม่ใช่แค่ endpoint เดียว (ถ้ามี code path อื่นในอนาคตที่ set `Meeting.status = 'CANCELLED'` ตรงๆ โดยไม่ผ่าน route นี้ ก็ยังถูก cascade cancel reminder ให้เหมือนกัน) |
| BR-15 | Meeting มีได้หลาย Notes/Resources/Decisions/ActionItems | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว — ดู FR-11/12/13 |
| BR-16 | Action Item แยกงานเสร็จ/ค้างได้ | ✅ | ไม่เปลี่ยนแปลง |
| BR-17 | ข้อมูลประชุมในอดีตเรียกดูได้เพื่อเป็นบริบทครั้งถัดไป | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| BR-18 | AI-generated summary ต้องไม่แทนที่ข้อมูลต้นฉบับ | ✅ | ไม่เปลี่ยนแปลง |
| BR-19 | เก็บ Notes + ข้อมูลต้นฉบับที่ใช้สร้าง AI Summary ไว้ตรวจสอบย้อนกลับ | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| BR-20 | สร้าง AI Summary ใหม่ไม่ทำลาย Notes เดิม | ✅ | ไม่เปลี่ยนแปลง |

---

## UI ที่เพิ่มรอบนี้ (ไฟล์จริง)

รอบข้อ 1-4 (ก่อนหน้า):
- `src/app/(app)/meetings/[id]/MeetingContext.tsx` — 3 client component ใหม่: `MeetingNotesCard`, `MeetingDecisionsCard`, `MeetingResourcesCard` ต่อเข้ากับหน้า `meetings/[id]/page.tsx`
- `src/components/meetings/MeetingForm.tsx` — เพิ่ม (1) picker เลือก/สร้าง `OnlineMeetingResource`, (2) editor สำหรับหลาย reminder offset ทั้งโหมดสร้าง (local chips) และโหมดแก้ไข (จัดการ reminder จริงผ่าน API ทันที ไม่รอ submit ฟอร์ม)
- `src/app/api/reminders/route.ts` — `GET` รองรับ query `meetingId` เพิ่ม (ใช้โดยฟอร์มโหมดแก้ไข)

รอบข้อ 3-5:
- `src/components/ui/StatusBadge.tsx` — เพิ่ม `participantSourceBadge(source, groupName?)` map `MeetingParticipant.source` เป็นป้าย DIRECT/GROUP(+ชื่อกลุ่ม)/EXTERNAL (FR-03)
- `src/app/(app)/meetings/[id]/page.tsx` — include `participants.sourceGroup` เพิ่มในคำสั่ง query แล้ว render ป้ายแหล่งที่มาต่อผู้เข้าร่วมแต่ละคน (FR-03); การ์ด "AI สรุปข้อมูลก่อนการประชุม" เปลี่ยนเป็น disable ปุ่ม "สร้างสรุป" พร้อม tooltip เมื่อ `meeting.type === "SINGLE"` และยังไม่มีสรุป (FR-18)
- `src/app/api/meetings/[id]/ai-summary/route.ts` — `POST` เพิ่ม guard เช็ค `meeting.type === "SINGLE"` แล้วตอบ `400` ก่อนเรียก AI จริง (FR-18, บังคับที่ backend กัน bypass ผ่าน UI)
- `src/app/(app)/ai-assistant/page.tsx` — เพิ่ม `type` ใน `select` ของ query meetings ส่งต่อให้ panel
- `src/app/(app)/ai-assistant/AiAssistantPanel.tsx` — disable ปุ่ม "สร้างสรุปด้วย AI"/refresh พร้อม tooltip อธิบายเหตุผลเมื่อ meeting ที่เลือกเป็น `SINGLE`, ติดป้าย "ครั้งเดียว" ในรายการ meeting ด้านซ้าย (FR-18)

รอบ A (แยกความสามารถ AI FR-15/16/17):
- `src/lib/meeting-ai-context.ts` (ใหม่) — `gatherMeetingAiContext()` รวม logic ดึง task/past-meeting/decision/note/resource ที่ 3 endpoint AI ใช้ร่วมกัน + `assertMeetingAllowsAi()` guard FR-18 กลาง
- `src/lib/ai.ts` — เพิ่ม `pastResources` ใน `generateMeetingSummary()` (FR-15), เพิ่ม `generatePendingIssuesAnalysis()` (FR-16), `generateAgendaSuggestion()` (FR-17)
- `src/app/api/meetings/[id]/pending-issues/route.ts` (ใหม่), `src/app/api/meetings/[id]/agenda-suggestion/route.ts` (ใหม่)
- `src/app/(app)/ai-assistant/AiAssistantPanel.tsx` — แยกเป็น 3 การ์ดอิสระ (สรุป/ประเด็นค้าง/แนะนำ agenda) แต่ละอันมีปุ่ม-ผลลัพธ์-แหล่งอ้างอิงของตัวเอง

รอบ B (FR-08/09 + BR-13):
- `src/lib/ics.ts` (ใหม่), `src/app/api/meetings/[id]/ics/route.ts` (ใหม่), ปุ่มดาวน์โหลดใน `MeetingActions.tsx` (FR-08)
- `src/lib/email.ts` — เพิ่ม `attachments` ใน `sendEmail()`; `src/lib/meeting-notify.ts` (ใหม่) เรียกจาก `POST /api/meetings/[id]/notify` ทั้งตอน create และ edit (FR-09; ตอนนั้นยังมี `PUT /api/meetings/[id]` และ `POST /api/meetings` ซึ่งถูกลบแล้วในงานข้อ 20/B7 — ปัจจุบัน create/edit ผ่าน RPC แล้วเรียก notify route นี้) — ปลายทาง `sendEmail()` ยังเป็น stub (log + `"simulated"`)
- `src/app/api/reminders/process-due/route.ts` (ใหม่) (BR-13)

รอบ C: ไม่มีไฟล์ใหม่ — แก้ 14 warning เดิมในไฟล์ที่มีอยู่แล้ว (ดู "eslint cleanup" ด้านล่าง)

## วิธีที่ตรวจสอบ (ไม่ใช่แค่ "compile ผ่าน")

รันจริงด้วย `npm run dev`, login ด้วย session cookie จริงผ่าน `/api/auth/login`, แล้วยิง HTTP ตรงไปที่ endpoint/หน้าเว็บจริงทุกจุดที่แก้:
สร้าง note/decision/resource ผ่าน POST จริงแล้ว `grep` เนื้อหาที่ seed ไว้ในหน้า HTML ที่ server ส่งมาจริง (ยืนยันว่าการ์ดสามใบ render ข้อมูลจริง ไม่ใช่ placeholder), สร้าง/แก้ไข `OnlineMeetingResource` แล้วยืนยันการเปลี่ยนแปลงสะท้อนผ่าน FK ทันที, สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่าแล้วยืนยันจำนวนและเวลาของ reminder ที่ได้ถูกต้องทุกแถว จากนั้นรัน `npm run db:seed` reset ข้อมูลทดสอบทั้งหมดออกแล้ว

รอบข้อ 3-5: ตรวจผ่าน static analysis ทั้งชุด — `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run test:authz` (16 passed)

รอบ A: เรียก `pending-issues`/`agenda-suggestion`/`ai-summary` จริงกับ meeting ที่ผูกโปรเจกต์จาก seed (มี Task/Decision/MeetingNote จริง) — guard FR-18 บล็อก SINGLE meeting ทั้ง 3 endpoint ด้วยข้อความเดียวกัน (ผ่าน helper กลาง), ผ่าน guard สำหรับ PROJECT meeting ถึงขั้นเรียก AI client จริง (ได้ 502 จากไม่มี `ANTHROPIC_API_KEY` จริงใน sandbox — ไม่ใช่ถูกบล็อกโดย guard) เขียนสคริปต์ชั่วคราวเรียก `gatherMeetingAiContext` ตรงยืนยันข้อมูล input (overdue task/decisions/notes) ตรงกับ seed คำต่อคำ (ลบสคริปต์ทิ้งหลังใช้)

รอบ B: สร้าง meeting จริงพร้อมผู้เข้าร่วม internal+external → เห็น `sendEmail` ถูกเรียกจริงใน server log พร้อม attachment; ดาวน์โหลด `.ics` จริงแล้ว parse ด้วย `node-ical` (ติดตั้งชั่วคราวใน scratchpad แล้วลบทิ้ง) สำเร็จครบทุกฟิลด์; แก้ไข meeting (PUT) ยืนยันส่งอีเมลซ้ำอัตโนมัติ; สร้าง reminder ที่ scheduledAt อยู่ในอดีตจริง (ผ่าน API ปกติ ไม่แตะ DB ตรง) → เรียก `process-due` 2 ครั้งติดกัน ยืนยัน DB มี `SENT` แค่ครั้งเดียวและ log อีเมลจริงแค่ 1 ครั้ง; ยืนยัน guard admin-only ด้วย user ธรรมดา → 403

รอบ C (eslint cleanup): แก้ที่มา ไม่ใช่แค่ปิดเสียง — ลบ `/* eslint-disable no-console */` ที่ไม่มีผลจริงและตัวแปร `pSomsong` ที่ไม่ได้ใช้ออกจาก `prisma/seed.ts`; ใส่ `eslint-disable-next-line` เฉพาะจุดที่ `eslint.config.mjs` เองระบุไว้แล้วว่าเป็น pattern ที่ปลอดภัยโดยเจตนา (fetch-on-mount, ปรับ `<link>` font ของ Material Symbols ให้ไม่แตะเพราะเสี่ยง regression กับ variable font axis) แทนการปิด rule ทั้งไฟล์ — หลังแก้ `npm run lint` เหลือ **0 warning** จริง (ยืนยันจาก terminal output ตรงๆ ไม่มีบรรทัดใดๆ เลยนอกจาก header) จากนั้นรัน `tsc --noEmit`/`npm run build`/`npm run test:authz` (16 passed) ซ้ำอีกครั้งยืนยันไม่มี regression โดยเฉพาะ route ใหม่จากรอบ A/B (สอบ `/ai-assistant`, `/meetings/[id]` และหน้าอื่นๆ ที่แก้ไฟล์ด้วย id จริงจาก seed ยืนยัน render 200 ไม่ crash)

## สิ่งที่ยังไม่ทำ (ของจริง)

- FR-15/16/17: ยังไม่เคย verify ผลลัพธ์ AI-generated จริงว่าไม่ hallucinate/ตรงกับ input เพราะ sandbox นี้ไม่มี `ANTHROPIC_API_KEY` จริง (ได้แค่ 502 หลัง guard ผ่าน) — ที่ verify ได้จริงคือแค่ `gatherMeetingAiContext` ดึงข้อมูล input ถูกต้องตรง seed เท่านั้น
- BR-13: มีกลไกกันส่งซ้ำจริงแล้ว (ล็อกแถวก่อนส่ง) และมีตัวประมวลผลอัตโนมัติใน `src/instrumentation.ts` แต่**ปิดเป็นค่าเริ่มต้น** — ถ้าไม่ตั้ง `REMINDER_AUTO_PROCESS=1` การแจ้งเตือนที่ถึงเวลาจะค้าง `PENDING` (หน้า `/reminders` แสดง "เลยกำหนด — รอระบบประมวลผล" ซึ่งเป็นป้ายฝั่ง UI เท่านั้น ข้อมูลไม่เปลี่ยน) จนแอดมินกดปุ่ม และการแจ้งเตือนในแอปชนิด `REMINDER` ถูกสร้างตอนประมวลผลเท่านั้น ไม่ใช่ตรงเวลาเป๊ะ (ช้าได้ถึงหนึ่งช่วงเวลาตรวจ) ข้อจำกัด: (1) ตัวตั้งเวลาอยู่ใน process ของเซิร์ฟเวอร์ ใช้ได้เฉพาะ `npm run dev`/`npm start` ที่รันค้าง บน serverless ต้องใช้ cron ภายนอก และ `POST /api/reminders/process-due` ต้องใช้ session แอดมิน จึงต้องเพิ่ม route ที่ป้องกันด้วย secret ก่อน (ยังไม่มี) (2) ถ้าเปิด การแจ้งเตือนของประชุมตัวอย่างสองรายการ ("ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 1/2") จะถูกประมวลผลเมื่อถึงเวลาด้วย และ `PENDING` ที่ค้างของประชุมที่เริ่มไปแล้วจะถูกเปลี่ยนเป็น `CANCELLED` ในรอบแรก (3) ระหว่างส่งอีเมล แถวถูกล็อกในทรานแซกชัน (timeout 60 วินาที) — พอสำหรับ stub ปัจจุบัน ถ้าต่อ SMTP จริงที่ช้ามาก/ผู้รับจำนวนมากควรทบทวน (4) กระดิ่งอัปเดตเมื่อเปลี่ยนหน้า/เปิดกระดิ่ง ไม่ใช่ real-time push
- FR-09: อีเมลเชิญยังไม่มี "ข้อมูลเตรียมตัวก่อนประชุม" (เช่นสรุป AI จาก FR-15) แนบไปด้วย — FR-09 ในเอกสาร requirement ระบุว่าเป็น "หากมี" (optional) จึงไม่ใช่ของที่ขาดตามสเปก แต่บันทึกไว้เผื่อขยายภายหลัง **และที่สำคัญกว่า: `sendEmail()` ยังเป็น stub (log แล้ว return `"simulated"` เสมอ) จึงยังไม่มีการส่งอีเมลจริงในทุก call site ของทั้งระบบ ไม่ใช่แค่ FR-09 — ต้องพัฒนา transport จริงใน `src/lib/email.ts` ก่อน**
- ข้อ 12 (ส่วน `Person`): contact ที่ยังไม่ถูก link กับ user ภายใน (`Person.userId IS NULL`) ยังถูกแก้ไขได้โดยทุกคนตาม policy เดิม `update_unlinked_or_owner_or_admin` — บันทึกเป็น known limitation ใน `docs/DESIGN_DECISIONS.md` §5.8 (ต้องการคอลัมน์ attribution ใหม่ + migration backfill จึงเก็บไว้นอกสโคป) — cookie/meeting/note/decision/resource ฝั่งที่แก้ได้จริงในรอบนี้ทำครบแล้วทุกข้อ
- ข้อจำกัดที่ทราบ (ตรวจรอบสุดท้าย 2026-10-11 — บันทึกไว้ ไม่แก้ฐานข้อมูล):
  - `OnlineMeetingResource.url` ไม่มี CHECK ที่ DB ว่าต้องขึ้นต้นด้วย http(s) (ต่างจาก `RelatedResource_url_http_check`) — ฟอร์มสร้างลิงก์ตรวจแล้ว และ React 19 บล็อก `javascript:` URL ตอน render แต่การ insert ตรงผ่าน supabase-js ยังใส่ค่าอื่นได้
  - `Project` ไม่มี CHECK ที่ DB ว่าวันสิ้นสุดต้องไม่ก่อนวันเริ่ม — ตรวจเฉพาะที่ฟอร์มสร้างโปรเจกต์
  - `User.phone` และ `Person.phone` ไม่มี CHECK constraint ที่ DB เรื่องรูปแบบเบอร์โทร (เป็น `text` ธรรมดา; CHECK ใน schema `public` มีแค่ `RelatedResource_url_http_check`) — รูปแบบเบอร์ (ตัวเลข ช่องว่าง `- + ( )` และตัวเลข 9-15 หลัก) ตรวจที่ชั้นแอปเท่านั้น: `isValidPhone()`/`PHONE_FORMAT_MESSAGE` ใน `src/lib/validations.ts` ใช้ทั้งใน zod schema ของ API และในหน้าที่ insert/update ผ่าน supabase-js (`people/page.tsx`, `PersonActions.tsx`) การเขียนตรงผ่าน supabase-js นอกหน้าเว็บเหล่านี้จึงยังใส่ค่ารูปแบบอื่นได้
  - แถว `TaskAttachment` เดิมหนึ่งแถว (`cmu5ttc8r00017khsng8zeiwj`) ชี้ไปไฟล์ที่ไม่มีอยู่บนดิสก์ ลิงก์ดาวน์โหลดของแถวนี้จึงใช้ไม่ได้
  - ฟังก์ชัน `update_project_with_members()` มีอยู่ใน DB แต่ยังไม่มีหน้าเว็บเรียกใช้ (ยังไม่มี UI จัดการสมาชิกโปรเจกต์)
  - หน้ารายละเอียดประชุม (รอบ 2026-10-12 fix3): ปุ่ม "สร้างงาน" ในการ์ด "งานที่เกี่ยวข้อง" แสดงเฉพาะแอดมิน ผู้จัดประชุม และผู้เข้าร่วม (`canContributeToMeeting()` ตัวเดียวกับฟอร์มบันทึก/มติ/เอกสาร) ผู้ใช้ที่ไม่เกี่ยวข้องกับประชุมไม่เห็นปุ่มแล้ว — **เป็นการจำกัดที่ชั้น UI เท่านั้น** RLS `insert_own_as_creator` บน `Task` ไม่ได้แก้ ผู้ใช้ที่ล็อกอินยังสร้างงานในนามตัวเองที่ผูกกับประชุมใดก็ได้ผ่านหน้า `/tasks` (เลือกประชุมได้) หรือเรียก supabase-js ตรง
  - ไฟล์ที่อัปโหลด (รูปโปรไฟล์ `public/uploads/avatars/`, ไฟล์แนบงาน `public/uploads/tasks/`) เก็บบนดิสก์ของเครื่องที่รันเซิร์ฟเวอร์และไม่อยู่ใน git แต่ URL ถูกเก็บในฐานข้อมูลที่ใช้ร่วมกัน — เครื่องอื่นที่โคลนไปต่อฐานข้อมูลเดียวกันจะหาไฟล์ไม่เจอ (404) ; รอบตรวจความพร้อมส่งงาน (2026-10-12) ทำให้รูปโปรไฟล์ที่โหลดไม่ได้แสดงอักษรย่อแทนรูปเสีย (`Avatar.tsx`) แต่ลิงก์ไฟล์แนบยังเปิดไม่ได้บนเครื่องอื่น — แก้จริงต้องย้ายไป Supabase Storage (เปลี่ยนที่เก็บ/นโยบาย storage จึงไม่ได้ทำ)
  - การแจ้งเตือน (BR-13): ถ้าทรานแซกชันของ `processOneDueReminder()` ล้มเหลวหลังส่งอีเมลไปแล้ว (เช่น DB หลุด/timeout) แถวจะย้อนกลับเป็น `PENDING` และรอบถัดไปอาจส่งซ้ำได้ — ปิดสนิทต้องมีสถานะกลาง "กำลังส่ง" ซึ่งต้องแก้ enum จึงไม่ได้ทำ (ปัจจุบัน `sendEmail()` เป็น stub จึงยังไม่มีผลจริง)
  - ไฟล์ `.ics` ของประชุมที่ถูกยกเลิกส่ง `STATUS:CANCELLED` แล้ว (รอบ fix3) แต่ยังเป็น `METHOD:PUBLISH` ไม่มี `SEQUENCE` — แอปปฏิทินบางตัวอาจไม่ลบ/อัปเดตนัดเดิมอัตโนมัติเมื่อเปิดไฟล์ใหม่
  - `MeetingParticipant.rsvpStatus` (รอตอบรับ/ตอบรับแล้ว/ปฏิเสธ) แสดงในรายชื่อผู้เข้าร่วม แต่ยังไม่มีทางให้ผู้ถูกเชิญตอบรับเอง: ตารางนี้ไม่มี UPDATE policy (มีแค่ select ทุกคน, insert/delete ผู้จัดหรือแอดมิน) การเพิ่มต้องแก้ RLS จึงไม่ได้ทำ (requirement ไม่ได้กำหนดการตอบรับ)
  - หน้า `/projects/[id]` (รอบ 2026-10-12): ปุ่ม "สร้างงาน" ในการ์ด "งานของโปรเจกต์" แสดงเฉพาะผู้ที่เกี่ยวข้องกับโปรเจกต์ — แอดมิน ผู้จัดการโปรเจกต์ (`Project.managerId`) สมาชิกโปรเจกต์ (`ProjectMember` ที่ `Person` ผูกกับบัญชี) ผู้จัดหรือผู้เข้าร่วมประชุมใดๆ ของโปรเจกต์ (หลักเดียวกับ `canContributeToMeeting()`) หรือผู้ที่ได้รับมอบหมายงานในโปรเจกต์อยู่แล้ว (`canCreateProjectTask()` ใน `src/lib/permissions.ts`) — **เป็นการจำกัดที่ชั้น UI เท่านั้น** RLS `insert_own_as_creator` บน `Task` ไม่ได้แก้ ยังอนุญาตให้ผู้ใช้ที่ล็อกอินทุกคนสร้างงานในนามตัวเองในโปรเจกต์ใดก็ได้ (เช่นผ่านหน้า `/tasks` ที่เลือกโปรเจกต์ได้ทุกโปรเจกต์ หรือเรียก supabase-js ตรง) และ `ContactGroup` ไม่มีความสัมพันธ์กับ `Project` ในสคีมา จึงไม่มี "สมาชิกกลุ่มที่ผูกกับโปรเจกต์" ให้นับ

## ขั้นตอนถัดไป

1. เพิ่มหน้า/endpoint สมัครสมาชิกแบบเปิด (FR-01) — หนึ่งในสอง FR ที่ยังเป็น ⚠️ (อีกข้อคือ FR-09 ซึ่งติดที่ `sendEmail()` ยังเป็น stub — ดูข้อ 2)
2. ตั้งค่า `ANTHROPIC_API_KEY` จริงในสภาพแวดล้อม production เพื่อให้ AI ตอบผลจริง (ไม่ใช่ 502) และพัฒนา transport จริงใน `sendEmail()` (`src/lib/email.ts`) เพื่อให้อีเมลออกจากเครื่องจริง — การตั้ง `SMTP_HOST` อย่างเดียวไม่พอ เพราะโค้ดปัจจุบันยังเป็น stub ที่ log แล้ว return `"simulated"` เสมอ
3. ถ้าต้องการส่ง reminder อัตโนมัติแบบไม่ต้องเรียกเอง — บนเซิร์ฟเวอร์ที่รันค้าง ตั้ง `REMINDER_AUTO_PROCESS=1` (ดู README) ; บน serverless ต้องเพิ่ม route สำหรับ cron ที่ป้องกันด้วย secret แล้วผูกกับ scheduler ภายนอก (cron, GitHub Actions schedule, Vercel Cron ฯลฯ)
