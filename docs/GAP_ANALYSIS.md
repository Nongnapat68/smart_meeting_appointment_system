# GAP_ANALYSIS.md — เทียบระบบปัจจุบันกับ `requirements/requirements.md.md`

> จัดทำจากการอ่านโค้ดจริง (`prisma/schema.prisma`, `src/app/api/**`, `src/lib/**`, `src/components/**`) ไม่ใช่การเดา
> อัปเดตล่าสุดหลัง migration `20260906020941_add_notes_decisions_resources_online_link_participant_source`
> + UI ของขั้นตอนที่ 2 ข้อ 1-4 ต่อเข้ากับ `MeetingForm.tsx`/`meetings/[id]/page.tsx` แล้ว — ตรวจสอบจริงผ่าน `npm run build`,
> `tsc --noEmit`, และ end-to-end ผ่าน HTTP จริง (login จริง → POST/GET ทุก endpoint ใหม่ → เห็นผลใน DB จริง) ไม่ใช่แค่เดา
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

ทดสอบ end-to-end จริงผ่าน HTTP (ไม่ใช่แค่ unit-level): login → สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่า → ยืนยันมี reminder 4 แถวจริงตามเวลาที่คำนวณถูกต้อง; สร้าง/แนบ/แก้ไข `OnlineMeetingResource` → ยืนยันการแก้ไข url สะท้อนไปยัง meeting ที่อ้างอิงทันทีผ่าน FK; POST note/decision/resource → ยืนยันเห็นในหน้า meeting detail จริง (`grep` เนื้อหาใน HTML ที่ render มา) หลังทดสอบ รัน `npm run db:seed` reset กลับสู่ข้อมูลตัวอย่างสะอาดแล้ว

**นับจากตารางจริง**:
- FR (18 ข้อ): ✅ 11 (FR-02, 04, 05, 06, 07, 10, 11, 12, 13, 14, 15) · ⚠️ 3 (FR-01, 03, 09) · ❌ 4 (FR-08, 16, 17, 18)
- BR (20 ข้อ): ✅ 19 (BR-01 ถึง BR-12, BR-14 ถึง BR-20) · ⚠️ 1 (BR-13)

---

## ตาราง Functional Requirements

| # | หัวข้อ | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| FR-01 | User & Contact Management | ⚠️ | ไม่เปลี่ยนแปลง — ยังไม่มีหน้าสมัครสมาชิกแบบเปิด ยกไป**ขั้นตอนถัดไป (ข้อ 5)** |
| FR-02 | Contact Group Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-03 | Quick Invite | ⚠️ | ไม่เปลี่ยนแปลง — `source`/`sourceGroupId` มีจริงใน backend (BR-04 ✅) แต่ `MeetingForm.tsx` ยังไม่แสดงป้ายบอกแหล่งที่มาให้ผู้ใช้เห็นตอนเลือกคน (ไม่ได้อยู่ใน scope 3 ข้อที่ขอรอบนี้) |
| FR-04 | Meeting / Appointment Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-05 | Meeting Types (One-shot / Project) | ✅ | ไม่เปลี่ยนแปลง |
| FR-06 | Project-based Meeting Management | ✅ | ไม่เปลี่ยนแปลง |
| FR-07 | Reusable Online Meeting Link | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: `MeetingForm.tsx` เพิ่ม field "ลิงก์ประชุมออนไลน์" เป็น `<select>` รายการ `OnlineMeetingResource` ที่มีอยู่ + ตัวเลือก "+ สร้างลิงก์ใหม่..." ที่เปิดฟอร์ม name/url ในหน้าเดียวกัน (POST `/api/online-resources` แล้วเลือกให้อัตโนมัติ) หน้า meeting detail แสดงลิงก์ที่ผูกไว้พร้อมเปิดในแท็บใหม่ **ทดสอบจริงผ่าน curl**: สร้าง resource ใหม่ → ผูกกับ meeting ผ่าน PUT → แก้ไข url ของ resource → ยืนยัน meeting ที่ผูกไว้เห็น url ใหม่ทันที (ผ่าน FK ไม่ใช่ copy) |
| FR-08 | Calendar Invitation (.ics) | ❌ | ไม่เปลี่ยนแปลง — ยกไป**ขั้นตอนถัดไป (ข้อ 7)** |
| FR-09 | Invitation Delivery | ⚠️ | ไม่เปลี่ยนแปลง — ยังไม่มีจุดเรียก `sendEmail()` ตอนสร้าง meeting |
| FR-10 | Reminder Management | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: ฟอร์มสร้าง meeting มีตัวเลือก preset (7 วันก่อน/2 วันก่อน/1 วันก่อน/1 ชั่วโมงก่อน — ตรงตามตัวอย่างในเอกสาร requirement) + ช่องกรอกนาทีเอง แสดงเป็น chip ลบได้ ส่งเป็น `reminderOffsetMinutes[]` ตอนสร้างจริง โหมดแก้ไขดึงรายการ reminder จริงของ meeting นั้น (`GET /api/reminders?meetingId=`) แสดงสถานะ ยกเลิกได้ และเพิ่มรายการใหม่ได้ทันทีผ่าน `POST /api/reminders` **ทดสอบจริง**: สร้าง meeting พร้อม offset `[10080,2880,1440,60]` → ยืนยันมี 4 reminders ตรงเวลาที่คำนวณถูกต้องทุกรายการ |
| FR-11 | Meeting Notes | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail มีการ์ด "บันทึกการประชุม" แสดงรายการจริง (ผู้บันทึก + เวลา) พร้อมฟอร์มเพิ่มบันทึกใหม่ (`MeetingNotesCard` ใน `MeetingContext.tsx`) **ทดสอบจริง**: `curl` POST เนื้อหาภาษาไทยผ่านไฟล์ JSON (UTF-8) → ยืนยัน GET กลับมาถูกต้องครบถ้วน ไม่มีการสูญเสียข้อมูล |
| FR-12 | Related Resources | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "เอกสารอ้างอิง" แสดงรายการพร้อมไอคอนตาม `type` (LINK/DOCUMENT/FILE) เปิดลิงก์ในแท็บใหม่ได้ พร้อมฟอร์มเพิ่ม (`MeetingResourcesCard`) |
| FR-13 | Decisions | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "มติที่ประชุม" แสดงรายการพร้อมผู้บันทึกและเวลา พร้อมฟอร์มเพิ่ม (`MeetingDecisionsCard`) trace กลับ project ผ่าน `meeting.projectId` เหมือนเดิม |
| FR-14 | Action Items | ✅ | ไม่เปลี่ยนแปลง |
| FR-15 | AI Pre-meeting Summary | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| FR-16 | Pending Issues Analysis | ❌ | ไม่เปลี่ยนแปลง — ยกไปรอบ AI-feature ถัดไป |
| FR-17 | New Agenda Context | ❌ | ไม่เปลี่ยนแปลง — ยกไปรอบ AI-feature ถัดไป |
| FR-18 | AI Usage Scope (ปิด AI สำหรับ One-shot) | ❌ | ไม่เปลี่ยนแปลง — ยกไป**ขั้นตอนถัดไป (ข้อ 5)** (เดิมเรียกข้อ 5 ในรอบก่อน ตอนนี้เรียงลำดับใหม่เป็นข้อ 5 ของรอบถัดไปเช่นกัน — ดูท้ายไฟล์) |

---

## ตาราง Business Rules

| # | กติกา | สถานะ | หลักฐาน / สิ่งที่ขาด |
|---|---|---|---|
| BR-01 | บุคคลอยู่หลายกลุ่มได้ / กลุ่มมีหลายสมาชิก | ✅ | ไม่เปลี่ยนแปลง |
| BR-02 | ลบคนออกจากกลุ่มไม่ทำให้ประวัติเข้าร่วมประชุมหาย | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
| BR-03 | เปลี่ยนสมาชิกกลุ่มภายหลังไม่กระทบผู้เข้าร่วมประชุมเดิม | ✅ | ไม่เปลี่ยนแปลง |
| BR-04 | ผู้เข้าร่วมมาจากหลายแหล่ง + จัดการข้อมูลซ้ำ | ✅ | ไม่เปลี่ยนแปลงจากรอบก่อน |
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

- `src/app/(app)/meetings/[id]/MeetingContext.tsx` — 3 client component ใหม่: `MeetingNotesCard`, `MeetingDecisionsCard`, `MeetingResourcesCard` ต่อเข้ากับหน้า `meetings/[id]/page.tsx`
- `src/components/meetings/MeetingForm.tsx` — เพิ่ม (1) picker เลือก/สร้าง `OnlineMeetingResource`, (2) editor สำหรับหลาย reminder offset ทั้งโหมดสร้าง (local chips) และโหมดแก้ไข (จัดการ reminder จริงผ่าน API ทันที ไม่รอ submit ฟอร์ม)
- `src/app/api/reminders/route.ts` — `GET` รองรับ query `meetingId` เพิ่ม (ใช้โดยฟอร์มโหมดแก้ไข)

## วิธีที่ตรวจสอบ (ไม่ใช่แค่ "compile ผ่าน")

รันจริงด้วย `npm run dev`, login ด้วย session cookie จริงผ่าน `/api/auth/login`, แล้วยิง HTTP ตรงไปที่ endpoint/หน้าเว็บจริงทุกจุดที่แก้:
สร้าง note/decision/resource ผ่าน POST จริงแล้ว `grep` เนื้อหาที่ seed ไว้ในหน้า HTML ที่ server ส่งมาจริง (ยืนยันว่าการ์ดสามใบ render ข้อมูลจริง ไม่ใช่ placeholder), สร้าง/แก้ไข `OnlineMeetingResource` แล้วยืนยันการเปลี่ยนแปลงสะท้อนผ่าน FK ทันที, สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่าแล้วยืนยันจำนวนและเวลาของ reminder ที่ได้ถูกต้องทุกแถว จากนั้นรัน `npm run db:seed` reset ข้อมูลทดสอบทั้งหมดออกแล้ว

## สิ่งที่ยังไม่ทำ (ของจริง)

- FR-03: `MeetingForm.tsx` ยังไม่แสดงป้ายบอกแหล่งที่มา (DIRECT/GROUP/EXTERNAL) ให้ผู้ใช้เห็นตอนเลือกผู้เข้าร่วม (ข้อมูลมีอยู่แล้ว แค่ยังไม่โชว์ใน UI) — ไม่ได้อยู่ใน scope ที่ขอรอบนี้
- BR-13: ยังไม่มี scheduler/cron ที่ยิง reminder จริงตามเวลา (เป็นงานฝั่ง delivery infrastructure แยกจาก schema/UI ทั้งหมด)

## ขั้นตอนถัดไป (ข้อ 5-7 ตามแผนเดิม)

1. เพิ่ม field ป้องกัน AI ถูกเรียกกับ one-shot meeting ทั้ง UI filter และ API guard (FR-18)
2. เพิ่มหน้า/endpoint สมัครสมาชิกแบบเปิด (FR-01)
3. เพิ่ม `.ics` generator + ผูกกับปุ่มดาวน์โหลด + แนบกับอีเมล (FR-08, FR-09)
