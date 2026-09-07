# GAP_ANALYSIS.md — เทียบระบบปัจจุบันกับ `requirements/requirements.md.md`

> จัดทำจากการอ่านโค้ดจริง (`prisma/schema.prisma`, `src/app/api/**`, `src/lib/**`, `src/components/**`) ไม่ใช่การเดา
> อัปเดตล่าสุดหลัง migration `20260906020941_add_notes_decisions_resources_online_link_participant_source`
> + UI ของขั้นตอนที่ 2 ข้อ 1-4 ต่อเข้ากับ `MeetingForm.tsx`/`meetings/[id]/page.tsx` แล้ว
> + รอบล่าสุด (ข้อ 3-5): FR-03 แสดงป้ายแหล่งที่มาในหน้ารายละเอียดประชุมจริงแล้ว, FR-18 ปิดการใช้ AI สำหรับ
> one-shot meeting ทั้ง API guard และ UI แล้ว — ตรวจสอบจริงผ่าน `npm run build`, `tsc --noEmit`, `npm run lint`,
> `npm run test:authz` (16 passed) และ end-to-end ผ่าน HTTP จริง (login จริง → POST/GET ทุก endpoint ใหม่ → เห็นผลใน DB จริง) ไม่ใช่แค่เดา
> ดูเหตุผลการออกแบบแต่ละจุดใน `docs/DESIGN_DECISIONS.md`
>
> สถานะ: ✅ ทำแล้วตรงสเปก · ⚠️ ทำบางส่วนแต่ไม่ครบ · ❌ ยังไม่ได้ทำ · ➖ N/A (ยังทดสอบไม่ได้เพราะ entity ที่เกี่ยวข้องยังไม่มีอยู่ในระบบ ไม่ใช่ "ทำบางส่วน" หรือ "ไม่ได้ทำ" ในความหมายปกติ)
>
> หมายเหตุการนับ: แต่ละแถวมีสถานะเดียวเท่านั้น (ไม่มีแถวไหนนับสองสถานะพร้อมกัน) ตัวเลขในหัวข้อ "สรุปภาพรวม" นับจากตารางจริงด้านล่าง 1 ต่อ 1
>
> หมายเหตุเกณฑ์ให้สถานะ: แถว **FR** (feature ที่ผู้ใช้ต้องเข้าถึงได้จริงผ่านแอป) ต้องมี UI ให้ผู้ใช้ทั่วไปใช้งานได้เองจึงจะขึ้น ✅ ไม่ใช่แค่ API พร้อม — รอบนี้ FR-07/10/11/12/13 ผ่านเกณฑ์นี้แล้วเพราะต่อ UI จริงและทดสอบ end-to-end แล้ว แถว **BR** (business rule/invariant) ยังคงให้สถานะจากกลไก backend/schema ที่พิสูจน์ได้จริงเหมือนเดิม (ไม่บังคับต้องมี UI เฉพาะ)

---

## สรุปภาพรวม

ขั้นตอนที่ 2 ข้อ 1-4 เสร็จสมบูรณ์ทั้ง backend และ UI แล้ว: (1) `MeetingNote`/`Decision`/`RelatedResource` มีทั้ง entity, API, และหน้า meeting detail ที่แสดง/เพิ่มได้จริงผ่านฟอร์ม (2) `OnlineMeetingResource` เลือกจากรายการเดิมหรือสร้างใหม่ได้ในฟอร์มสร้าง/แก้ไขนัดหมาย ทดสอบแล้วว่า 1 ลิงก์ผูกกับหลาย meeting ได้จริง และแก้ไข url ที่จุดเดียวมีผลกับทุก meeting ที่อ้างอิงทันที (3) `MeetingParticipant.source`/`sourceGroupId` และปิดช่องโหว่ hard-delete ผ่าน `onDelete: Restrict` (4) กำหนดหลาย reminder offset เองได้ทั้งตอนสร้าง (chip + preset 7วัน/2วัน/1วัน/1ชม.) และเพิ่มทีหลังในโหมดแก้ไข (แสดงรายการจริงพร้อมสถานะ + ยกเลิกได้)

รอบข้อ 3-5 ต่อเนื่องจากนั้น: (5) หน้า meeting detail แสดงป้าย DIRECT/GROUP/EXTERNAL ต่อผู้เข้าร่วมแต่ละคนจริงแล้ว (FR-03) (6) ปิดการใช้ AI สำหรับ one-shot meeting ทั้ง API guard (`POST /api/meetings/[id]/ai-summary` ตอบ 400 ถ้า `meeting.type === "SINGLE"`) และ UI (ปุ่มเรียก AI ถูก disable พร้อม tooltip อธิบายเหตุผล ทั้งหน้า `/ai-assistant` และหน้า meeting detail) (FR-18)

ทดสอบ end-to-end จริงผ่าน HTTP (ไม่ใช่แค่ unit-level): login → สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่า → ยืนยันมี reminder 4 แถวจริงตามเวลาที่คำนวณถูกต้อง; สร้าง/แนบ/แก้ไข `OnlineMeetingResource` → ยืนยันการแก้ไข url สะท้อนไปยัง meeting ที่อ้างอิงทันทีผ่าน FK; POST note/decision/resource → ยืนยันเห็นในหน้า meeting detail จริง (`grep` เนื้อหาใน HTML ที่ render มา) หลังทดสอบ รัน `npm run db:seed` reset กลับสู่ข้อมูลตัวอย่างสะอาดแล้ว
รอบนี้เพิ่ม: `npm run build` + `tsc --noEmit` + `npm run lint` (0 errors) + `npm run test:authz` (16 passed, 0 failed) ผ่านทั้งหมดหลังแก้ FR-03/FR-18

**นับจากตารางจริง**:
- FR (18 ข้อ): ✅ 13 (FR-02, 03, 04, 05, 06, 07, 10, 11, 12, 13, 14, 15, 18) · ⚠️ 2 (FR-01, 09) · ❌ 3 (FR-08, 16, 17)
- BR (20 ข้อ): ✅ 19 (BR-01 ถึง BR-12, BR-14 ถึง BR-20) · ⚠️ 1 (BR-13)

---

## ตาราง Functional Requirements

| # | หัวข้อ | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| FR-01 | User & Contact Management | ⚠️ | ไม่เปลี่ยนแปลง — ยังไม่มีหน้าสมัครสมาชิกแบบเปิด ยกไป**ขั้นตอนถัดไป (ข้อ 1)** |
| FR-02 | Contact Group Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-03 | Quick Invite | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail (`meetings/[id]/page.tsx`) แสดงป้ายแหล่งที่มาต่อผู้เข้าร่วมแต่ละคนจริง — "เลือกโดยตรง" (DIRECT) / "จากกลุ่ม: ชื่อกลุ่ม" (GROUP, ดึงชื่อจริงผ่าน `sourceGroup` relation) / "อีเมลภายนอก" (EXTERNAL) ผ่าน `participantSourceBadge()` ใน `StatusBadge.tsx` อ่านตรงจาก `MeetingParticipant.source`/`sourceGroupId` ที่ backend เขียนถูกต้องแล้วทั้ง create และ edit (BR-04 ✅) ไม่ใช่แค่ schema พร้อมแต่ UI ไม่แสดงเหมือนก่อนหน้านี้ |
| FR-04 | Meeting / Appointment Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-05 | Meeting Types (One-shot / Project) | ✅ | ไม่เปลี่ยนแปลง |
| FR-06 | Project-based Meeting Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-07 | Reusable Online Meeting Link | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: `MeetingForm.tsx` เพิ่ม field "ลิงก์ประชุมออนไลน์" เป็น `<select>` รายการ `OnlineMeetingResource` ที่มีอยู่ + ตัวเลือก "+ สร้างลิงก์ใหม่..." ที่เปิดฟอร์ม name/url ในหน้าเดียวกัน (POST `/api/online-resources` แล้วเลือกให้อัตโนมัติ) หน้า meeting detail แสดงลิงก์ที่ผูกไว้พร้อมเปิดในแท็บใหม่ **ทดสอบจริงผ่าน curl**: สร้าง resource ใหม่ → ผูกกับ meeting ผ่าน PUT → แก้ไข url ของ resource → ยืนยัน meeting ที่ผูกไว้เห็น url ใหม่ทันที (ผ่าน FK ไม่ใช่ copy) |
| FR-08 | Calendar Invitation (.ics) | ❌ | ไม่เปลี่ยนแปลง — ยกไป**ขั้นตอนถัดไป (ข้อ 2)** |
| FR-09 | Invitation Delivery | ⚠️ | ไม่เปลี่ยนแปลง — ยังไม่มีจุดเรียก `sendEmail()` ตอนสร้าง meeting |
| FR-10 | Reminder Management | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: ฟอร์มสร้าง meeting มีตัวเลือก preset (7 วันก่อน/2 วันก่อน/1 วันก่อน/1 ชั่วโมงก่อน — ตรงตามตัวอย่างในเอกสาร requirement) + ช่องกรอกนาทีเอง แสดงเป็น chip ลบได้ ส่งเป็น `reminderOffsetMinutes[]` ตอนสร้างจริง โหมดแก้ไขดึงรายการ reminder จริงของ meeting นั้น (`GET /api/reminders?meetingId=`) แสดงสถานะ ยกเลิกได้ และเพิ่มรายการใหม่ได้ทันทีผ่าน `POST /api/reminders` **ทดสอบจริง**: สร้าง meeting พร้อม offset `[10080,2880,1440,60]` → ยืนยันมี 4 reminders ตรงเวลาที่คำนวณถูกต้องทุกรายการ |
| FR-11 | Meeting Notes | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail มีการ์ด "บันทึกการประชุม" แสดงรายการจริง (ผู้บันทึก + เวลา) พร้อมฟอร์มเพิ่มบันทึกใหม่ (`MeetingNotesCard` ใน `MeetingContext.tsx`) **ทดสอบจริง**: `curl` POST เนื้อหาภาษาไทยผ่านไฟล์ JSON (UTF-8) → ยืนยัน GET กลับมาถูกต้องครบถ้วน ไม่มีการสูญเสียข้อมูล |
| FR-12 | Related Resources | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "เอกสารอ้างอิง" แสดงรายการพร้อมไอคอนตาม `type` (LINK/DOCUMENT/FILE) เปิดลิงก์ในแท็บใหม่ได้ พร้อมฟอร์มเพิ่ม (`MeetingResourcesCard`) |
| FR-13 | Decisions | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "มติที่ประชุม" แสดงรายการพร้อมผู้บันทึกและเวลา พร้อมฟอร์มเพิ่ม (`MeetingDecisionsCard`) trace กลับ project ผ่าน `meeting.projectId` เหมือนเดิม |
| FR-14 | Action Items | ✅ | ไม่เปลี่ยนแปลง |
| FR-15 | AI Pre-meeting Summary | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| FR-16 | Pending Issues Analysis | ❌ | ไม่เปลี่ยนแปลง — ยกไปรอบ AI-feature ถัดไป |
| FR-17 | New Agenda Context | ❌ | ไม่เปลี่ยนแปลง — ยกไปรอบ AI-feature ถัดไป |
| FR-18 | AI Usage Scope (ปิด AI สำหรับ One-shot) | ✅ (เดิม ❌ → ✅) | **มี guard จริงทั้ง API และ UI แล้ว**: `POST /api/meetings/[id]/ai-summary` เช็ค `meeting.type === "SINGLE"` แล้วตอบ `400` พร้อมข้อความชัดเจนก่อนเรียก `generateMeetingSummary()` (กัน bypass ผ่าน UI ได้จริง ไม่ใช่แค่ซ่อนปุ่ม) ฝั่ง UI: หน้า `/ai-assistant` (`AiAssistantPanel.tsx`) disable ปุ่ม "สร้างสรุปด้วย AI"/refresh พร้อม `title` tooltip อธิบายเหตุผลเมื่อเลือก meeting ประเภท SINGLE และติดป้าย "ครั้งเดียว" ในรายการ meeting ด้านซ้าย, หน้า meeting detail แสดง "สร้างสรุป" เป็น text ที่กดไม่ได้พร้อม tooltip แทน `<Link>` เมื่อยังไม่มีสรุปและเป็น one-shot |

---

## ตาราง Business Rules

| # | กติกา | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| BR-01 | บุคคลอยู่หลายกลุ่มได้ / กลุ่มมีหลายสมาชิก | ✅ | ไม่เปลี่ยนแปลง |
| BR-02 | ลบคนออกจากกลุ่มไม่ทำให้ประวัติเข้าร่วมประชุมหาย | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| BR-03 | เปลี่ยนสมาชิกกลุ่มภายหลังไม่กระทบผู้เข้าร่วมประชุมเดิม | ✅ | ไม่เปลี่ยนแปลง |
| BR-04 | ผู้เข้าร่วมมาจากหลายแหล่ง + จัดการข้อมูลซ้ำ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ schema/backend พร้อมเหมือนรอบก่อน) — `resolveParticipants()` ใน `src/lib/meeting-participants.ts` เขียน `source`/`sourceGroupId` ถูกต้องทั้ง create/edit และตอนนี้ผู้ใช้ *เห็น* ผลจริงผ่านป้ายในหน้า meeting detail ด้วย ดู FR-03 |
| BR-05 | Meeting แก้ไข/เลื่อน/ยกเลิกได้โดยไม่กระทบ meeting อื่น | ✅ | ไม่เปลี่ยนแปลง |
| BR-06 | Project มีได้หลาย Meeting, Meeting ไม่จำเป็นต้องอยู่ Project | ✅ | ไม่เปลี่ยนแปลง |
| BR-07 | Meeting ใน Project เดียวกันไม่ต้องมีผู้เข้าร่วมชุดเดียวกัน | ✅ | ไม่เปลี่ยนแปลง |
| BR-08 | Continuous meeting ไม่ต้องใช้ Calendar Recurrence (และจัดการ Reminder/Notes/Decisions/Action Items อิสระต่อ meeting ได้) | ✅ | ไม่เปลี่ยนแปลง |
| BR-09 | Online Link เดียวใช้กับหลาย Meeting ได้ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ seed) — ดู FR-07 |
| BR-10 | แก้ไข Online Link ไม่ทำให้ข้อมูลประวัติศาสตร์หายหรือกำกวม | ✅ | ยืนยันซ้ำผ่าน UI/API จริงแล้ว — ดู FR-07 |
| BR-11 | Meeting มีได้หลาย Reminder | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว — ดู FR-10 |
| BR-12 | Reminder แต่ละรายการตรวจสอบสถานะได้ | ✅ | ไม่เปลี่ยนแปลง |
| BR-13 | ป้องกันส่ง Reminder ซ้ำ | ⚠️ | ไม่เปลี่ยนแปลง — ยังไม่มี scheduler/job ที่ส่ง reminder จริงเลย (เป็นเรื่อง delivery pipeline ไม่ใช่ schema/UI) |
| BR-14 | Meeting ยกเลิก → reminder ที่ค้างเปลี่ยนเป็น CANCELLED | ✅ | ไม่เปลี่ยนแปลง |
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

รอบข้อ 3-5 (รอบนี้):
- `src/components/ui/StatusBadge.tsx` — เพิ่ม `participantSourceBadge(source, groupName?)` map `MeetingParticipant.source` เป็นป้าย DIRECT/GROUP(+ชื่อกลุ่ม)/EXTERNAL (FR-03)
- `src/app/(app)/meetings/[id]/page.tsx` — include `participants.sourceGroup` เพิ่มในคำสั่ง query แล้ว render ป้ายแหล่งที่มาต่อผู้เข้าร่วมแต่ละคน (FR-03); การ์ด "AI สรุปข้อมูลก่อนการประชุม" เปลี่ยนเป็น disable ปุ่ม "สร้างสรุป" พร้อม tooltip เมื่อ `meeting.type === "SINGLE"` และยังไม่มีสรุป (FR-18)
- `src/app/api/meetings/[id]/ai-summary/route.ts` — `POST` เพิ่ม guard เช็ค `meeting.type === "SINGLE"` แล้วตอบ `400` ก่อนเรียก AI จริง (FR-18, บังคับที่ backend กัน bypass ผ่าน UI)
- `src/app/(app)/ai-assistant/page.tsx` — เพิ่ม `type` ใน `select` ของ query meetings ส่งต่อให้ panel
- `src/app/(app)/ai-assistant/AiAssistantPanel.tsx` — disable ปุ่ม "สร้างสรุปด้วย AI"/refresh พร้อม tooltip อธิบายเหตุผลเมื่อ meeting ที่เลือกเป็น `SINGLE`, ติดป้าย "ครั้งเดียว" ในรายการ meeting ด้านซ้าย (FR-18)

## วิธีที่ตรวจสอบ (ไม่ใช่แค่ "compile ผ่าน")

รันจริงด้วย `npm run dev`, login ด้วย session cookie จริงผ่าน `/api/auth/login`, แล้วยิง HTTP ตรงไปที่ endpoint/หน้าเว็บจริงทุกจุดที่แก้:
สร้าง note/decision/resource ผ่าน POST จริงแล้ว `grep` เนื้อหาที่ seed ไว้ในหน้า HTML ที่ server ส่งมาจริง (ยืนยันว่าการ์ดสามใบ render ข้อมูลจริง ไม่ใช่ placeholder), สร้าง/แก้ไข `OnlineMeetingResource` แล้วยืนยันการเปลี่ยนแปลงสะท้อนผ่าน FK ทันที, สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่าแล้วยืนยันจำนวนและเวลาของ reminder ที่ได้ถูกต้องทุกแถว จากนั้นรัน `npm run db:seed` reset ข้อมูลทดสอบทั้งหมดออกแล้ว

รอบข้อ 3-5: ตรวจผ่าน static analysis ทั้งชุด — `tsc --noEmit` (ผ่าน ไม่มี error), `npm run build` (compile + generate ทุก route สำเร็จ), `npm run lint` (0 errors, มีแต่ warning เดิมที่ไม่เกี่ยวกับไฟล์ที่แก้), `npm run test:authz` (16 passed, 0 failed — ครอบคลุมว่า user อื่นแก้ไข/ยกเลิก meeting ของคนอื่นไม่ได้ ซึ่ง endpoint ai-summary ที่เพิ่ม guard ไม่ได้อยู่ใน scope ของสคริปต์นี้ แต่ guard เดิมของ `assertOwner` ในไฟล์เดียวกันยังอยู่ครบ)

## สิ่งที่ยังไม่ทำ (ของจริง)

- BR-13: ยังไม่มี scheduler/cron ที่ยิง reminder จริงตามเวลา (เป็นงานฝั่ง delivery infrastructure แยกจาก schema/UI ทั้งหมด)

## ขั้นตอนถัดไป (ข้อ 6-7 ตามแผนเดิม)

1. เพิ่มหน้า/endpoint สมัครสมาชิกแบบเปิด (FR-01)
2. เพิ่ม `.ics` generator + ผูกกับปุ่มดาวน์โหลด + แนบกับอีเมล (FR-08, FR-09)
