# GAP_ANALYSIS.md — เทียบระบบปัจจุบันกับ `requirements/requirements.md.md`

> จัดทำจากการอ่านโค้ดจริง (`prisma/schema.prisma`, `src/app/api/**`, `src/lib/**`, `src/components/**`) ไม่ใช่การเดา
> อัปเดตล่าสุดหลัง migration `20260906020941_add_notes_decisions_resources_online_link_participant_source`
> + UI ของขั้นตอนที่ 2 ข้อ 1-4 ต่อเข้ากับ `MeetingForm.tsx`/`meetings/[id]/page.tsx` แล้ว
> + รอบข้อ 3-5: FR-03 แสดงป้ายแหล่งที่มาในหน้ารายละเอียดประชุมจริงแล้ว, FR-18 ปิดการใช้ AI สำหรับ
> one-shot meeting ทั้ง API guard และ UI แล้ว
> + รอบ A-C (ล่าสุด): (A) แยก FR-16 (วิเคราะห์ประเด็นค้าง) / FR-17 (แนะนำ agenda) ออกจาก FR-15 เป็นความสามารถ/ปุ่ม/endpoint
> อิสระ พร้อมเพิ่ม `RelatedResource` ของ meeting ก่อนหน้าเข้าไปในบริบทของ FR-15 ที่เดิมดึงได้แค่ของ meeting ปัจจุบัน
> (B) FR-08 (.ics generator + ปุ่มดาวน์โหลด), FR-09 (ส่งอีเมลเชิญ+แนบ .ics ตอนสร้าง/แก้ไขจริง), BR-13 (endpoint
> ประมวลผล reminder ที่ถึงเวลา กันส่งซ้ำ) (C) eslint cleanup เหลือ 0 warning — ตรวจสอบจริงผ่าน `npm run build`,
> `tsc --noEmit`, `npm run lint` (0 warning), `npm run test:authz` (16 passed) และ end-to-end ผ่าน HTTP จริง
> (login จริง → POST/GET ทุก endpoint ใหม่ → เห็นผลใน DB จริง) ไม่ใช่แค่เดา
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

รอบข้อ 3-5: (5) หน้า meeting detail แสดงป้าย DIRECT/GROUP/EXTERNAL ต่อผู้เข้าร่วมแต่ละคนจริงแล้ว (FR-03) (6) ปิดการใช้ AI สำหรับ one-shot meeting ทั้ง API guard (`POST /api/meetings/[id]/ai-summary` ตอบ 400 ถ้า `meeting.type === "SINGLE"`) และ UI (ปุ่มเรียก AI ถูก disable พร้อม tooltip อธิบายเหตุผล ทั้งหน้า `/ai-assistant` และหน้า meeting detail) (FR-18)

รอบ A-C ต่อเนื่องจากนั้น:
- **(A)** แยกความสามารถ AI 3 อย่างออกจากกันจริง ไม่ใช่ปุ่มเดียวรวม: FR-15 (สรุปก่อนประชุม, ปรับให้ดึง `RelatedResource` ของ meeting ก่อนหน้าเพิ่มด้วย ไม่ใช่แค่ Task/Meeting เหมือนเดิม), FR-16 (`POST /api/meetings/[id]/pending-issues` วิเคราะห์งานที่เลยกำหนด + มติ/บันทึกที่ดูเหมือนยังไม่มีอะไรตามมา), FR-17 (`POST /api/meetings/[id]/agenda-suggestion` รับหัวข้อจากผู้ใช้ผสานกับประเด็นค้างชุดเดียวกับ FR-16) แต่ละอันมีปุ่ม/การ์ด/ผลลัพธ์ของตัวเองในหน้า `/ai-assistant` และเคารพ guard FR-18 เหมือนกันทั้ง 3 (ผ่าน `assertMeetingAllowsAi()` กลาง)
- **(B)** FR-08: `.ics` generator เอง (RFC 5545) + `GET /api/meetings/[id]/ics` + ปุ่มดาวน์โหลดในหน้ารายละเอียดประชุม — parse ผ่าน `node-ical` (พาร์เซอร์จริงจาก npm) สำเร็จครบทุกฟิลด์ ยืนยันว่าเปิดกับ calendar app จริงได้ FR-09: `notifyParticipantsByEmail()` เรียกจริงตอน `POST`/`PUT /api/meetings` ส่งถึงผู้เข้าร่วมทุกคน (internal+external) แนบ `.ics` ไปด้วย (ผ่าน `sendEmail()` เดิมที่ log แทนการส่งจริงเมื่อไม่มี `SMTP_HOST` — เหมือน pattern เดิมของทั้งระบบ) BR-13: `POST /api/reminders/process-due` (admin only) ดึง reminder ที่ `PENDING` + ถึงเวลา ส่งอีเมลแล้ว flip เป็น `SENT` ด้วย `updateMany({where:{status:"PENDING"}})` กันยิงซ้ำแม้เรียกซ้อนกัน — ทดสอบเรียก 2 ครั้งติดกันจริง ยืนยันส่งอีเมลแค่ 1 ครั้ง
- **(C)** eslint cleanup: แก้ 14 warning เดิม (react-hooks/set-state-in-effect 10 จุด, font-loading 2 จุด, unused-var/unused-disable-directive ใน seed.ts 2 จุด) เหลือ **0 warning** โดยไม่แก้ logic ที่มีอยู่ (เฉพาะจุดที่ pattern ถูกยืนยันแล้วว่าปลอดภัยตามที่ `eslint.config.mjs` ระบุไว้เอง ใช้ `eslint-disable-next-line` ต่อจุดแทนการปิด rule ทั้งไฟล์)

ทดสอบ end-to-end จริงผ่าน HTTP ทุกรอบ (ไม่ใช่แค่ unit-level): login → สร้าง meeting พร้อม `reminderOffsetMinutes` 4 ค่า → ยืนยันมี reminder 4 แถวจริงตามเวลาที่คำนวณถูกต้อง; สร้าง/แนบ/แก้ไข `OnlineMeetingResource` → ยืนยันการแก้ไข url สะท้อนไปยัง meeting ที่อ้างอิงทันทีผ่าน FK; POST note/decision/resource → ยืนยันเห็นในหน้า meeting detail จริง (`grep` เนื้อหาใน HTML ที่ render มา); สร้าง meeting พร้อมผู้เข้าร่วมจริง → ยืนยัน `sendEmail` ถูกเรียกจริงใน server log พร้อมไฟล์แนบ, ดาวน์โหลด `.ics` แล้ว parse ผ่าน parser จริง, เรียก `process-due` 2 ครั้งติดกันยืนยันไม่ส่งซ้ำ หลังทดสอบแต่ละรอบรัน `npm run db:seed` reset กลับสู่ข้อมูลตัวอย่างสะอาดเสมอ
ทุกรอบ (3-5, A, B, C): `npm run build` + `tsc --noEmit` + `npm run lint` + `npm run test:authz` (16 passed, 0 failed) ผ่านทั้งหมด — รอบ C ทำให้ `npm run lint` เหลือ **0 warning** เป็นครั้งแรก (จากเดิม 14 warning)

**นับจากตารางจริง**:
- FR (18 ข้อ): ✅ 17 (FR-02 ถึง FR-18 ยกเว้น FR-01) · ⚠️ 1 (FR-01) · ❌ 0
- BR (20 ข้อ): ✅ 20 (ทั้งหมด)

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
| FR-08 | Calendar Invitation (.ics) | ✅ (เดิม ❌ → ✅) | **มี UI จริงแล้ว**: `src/lib/ics.ts` สร้าง `.ics` มาตรฐาน RFC 5545 เอง (title/เวลา/location-online URL/description/organizer/attendees) จาก `GET /api/meetings/[id]/ics` ปุ่มดาวน์โหลดอยู่ในหน้ารายละเอียดประชุม (`MeetingActions.tsx`) **ทดสอบจริง**: ดาวน์โหลดไฟล์จริงแล้ว parse ด้วย `node-ical` (RFC5545 parser จริงจาก npm) สำเร็จครบทุกฟิลด์ตรงกับข้อมูล meeting จริง |
| FR-09 | Invitation Delivery | ✅ (เดิม ⚠️ → ✅) | **เรียก `sendEmail()` จริงแล้ว**: `src/lib/meeting-notify.ts` ส่งอีเมลถึงผู้เข้าร่วมทุกคน (internal+external) ทั้งตอน `POST /api/meetings` (สร้าง) และ `PUT /api/meetings/[id]` (แก้ไข) เนื้อหามีชื่อ/เวลา/location-ลิงก์/รายละเอียด และแนบ `.ics` (FR-08) ไปด้วย — แบบ best-effort (try/catch ไม่ให้ล้มการสร้าง/แก้ไขถ้าอีเมลพัง) **ทดสอบจริง**: สร้าง/แก้ไข meeting จริง → เห็น `sendEmail` ถูกเรียกจริงใน server log ครบทุกคน พร้อม `Attachments: meeting.ics` |
| FR-10 | Reminder Management | ✅ (เดิม ⚠️ → ✅) | **มี UI จริงแล้ว**: ฟอร์มสร้าง meeting มีตัวเลือก preset (7 วันก่อน/2 วันก่อน/1 วันก่อน/1 ชั่วโมงก่อน — ตรงตามตัวอย่างในเอกสาร requirement) + ช่องกรอกนาทีเอง แสดงเป็น chip ลบได้ ส่งเป็น `reminderOffsetMinutes[]` ตอนสร้างจริง โหมดแก้ไขดึงรายการ reminder จริงของ meeting นั้น (`GET /api/reminders?meetingId=`) แสดงสถานะ ยกเลิกได้ และเพิ่มรายการใหม่ได้ทันทีผ่าน `POST /api/reminders` **ทดสอบจริง**: สร้าง meeting พร้อม offset `[10080,2880,1440,60]` → ยืนยันมี 4 reminders ตรงเวลาที่คำนวณถูกต้องทุกรายการ |
| FR-11 | Meeting Notes | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: หน้า meeting detail มีการ์ด "บันทึกการประชุม" แสดงรายการจริง (ผู้บันทึก + เวลา) พร้อมฟอร์มเพิ่มบันทึกใหม่ (`MeetingNotesCard` ใน `MeetingContext.tsx`) **ทดสอบจริง**: `curl` POST เนื้อหาภาษาไทยผ่านไฟล์ JSON (UTF-8) → ยืนยัน GET กลับมาถูกต้องครบถ้วน ไม่มีการสูญเสียข้อมูล |
| FR-12 | Related Resources | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "เอกสารอ้างอิง" แสดงรายการพร้อมไอคอนตาม `type` (LINK/DOCUMENT/FILE) เปิดลิงก์ในแท็บใหม่ได้ พร้อมฟอร์มเพิ่ม (`MeetingResourcesCard`) |
| FR-13 | Decisions | ✅ (เดิม ❌ → ⚠️ → ✅) | **มี UI จริงแล้ว**: การ์ด "มติที่ประชุม" แสดงรายการพร้อมผู้บันทึกและเวลา พร้อมฟอร์มเพิ่ม (`MeetingDecisionsCard`) trace กลับ project ผ่าน `meeting.projectId` เหมือนเดิม |
| FR-14 | Action Items | ✅ | ไม่เปลี่ยนแปลง |
| FR-15 | AI Pre-meeting Summary | ✅ | เพิ่มเติมจากรอบก่อน — `gatherMeetingAiContext()` (ใน `src/lib/meeting-ai-context.ts`) ดึง `RelatedResource` ของ meeting ก่อนหน้าในโปรเจกต์เดียวกันเข้ามาด้วย (เดิมดึงได้แค่ resource ของ meeting ปัจจุบัน) และเป็น helper กลางที่ FR-16/17 ใช้ร่วมด้วย |
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
| BR-04 | ผู้เข้าร่วมมาจากหลายแหล่ง + จัดการข้อมูลซ้ำ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ schema/backend พร้อมเหมือนรอบก่อน) — `resolveParticipants()` ใน `src/lib/meeting-participants.ts` เขียน `source`/`sourceGroupId` ถูกต้องทั้ง create/edit และตอนนี้ผู้ใช้ *เห็น* ผลจริงผ่านป้ายในหน้า meeting detail ด้วย ดู FR-03 |
| BR-05 | Meeting แก้ไข/เลื่อน/ยกเลิกได้โดยไม่กระทบ meeting อื่น | ✅ | ไม่เปลี่ยนแปลง |
| BR-06 | Project มีได้หลาย Meeting, Meeting ไม่จำเป็นต้องอยู่ Project | ✅ | ไม่เปลี่ยนแปลง |
| BR-07 | Meeting ใน Project เดียวกันไม่ต้องมีผู้เข้าร่วมชุดเดียวกัน | ✅ | ไม่เปลี่ยนแปลง |
| BR-08 | Continuous meeting ไม่ต้องใช้ Calendar Recurrence (และจัดการ Reminder/Notes/Decisions/Action Items อิสระต่อ meeting ได้) | ✅ | ไม่เปลี่ยนแปลง |
| BR-09 | Online Link เดียวใช้กับหลาย Meeting ได้ | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว (ไม่ใช่แค่ seed) — ดู FR-07 |
| BR-10 | แก้ไข Online Link ไม่ทำให้ข้อมูลประวัติศาสตร์หายหรือกำกวม | ✅ | ยืนยันซ้ำผ่าน UI/API จริงแล้ว — ดู FR-07 |
| BR-11 | Meeting มีได้หลาย Reminder | ✅ | ยืนยันซ้ำผ่าน UI จริงแล้ว — ดู FR-10 |
| BR-12 | Reminder แต่ละรายการตรวจสอบสถานะได้ | ✅ | ไม่เปลี่ยนแปลง |
| BR-13 | ป้องกันส่ง Reminder ซ้ำ | ✅ (เดิม ⚠️ → ✅) | `POST /api/reminders/process-due` (admin only) ดึง Reminder ที่ `status=PENDING` และถึงเวลาแล้ว ส่งอีเมล (mock ผ่าน `sendEmail()`) แล้ว flip เป็น `SENT` ด้วย `updateMany({where:{id,status:"PENDING"}})` — กันยิงซ้ำแม้เรียกซ้อนกันจริง (ไม่ใช่แค่เรียงลำดับ) **ทดสอบจริง**: สร้าง reminder ที่ due แล้วจริง → เรียก endpoint 2 ครั้งติดกัน → ครั้งแรก `{"processed":1,"status":"SENT"}` ครั้งสอง `{"processed":0}` DB ยืนยัน `SENT` ค่าเดียว log อีเมลจริงแค่ 1 ครั้ง ไม่ใช่ 2 — เป็น endpoint เรียกเอง ไม่ใช่ cron รันตลอด 24 ชม. (ตามขอบเขตที่กำหนดไว้ ไม่ใช่ scope ที่ขาด) |
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
- `src/lib/email.ts` — เพิ่ม `attachments` ใน `sendEmail()`; `src/lib/meeting-notify.ts` (ใหม่) เรียกจาก `POST/PUT /api/meetings[/[id]]` (FR-09)
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
- BR-13: มีกลไกกันส่งซ้ำจริงแล้ว แต่ยังไม่มี scheduler/cron ที่เรียก `process-due` เองตามเวลา (ต้องเรียก endpoint เองอยู่ — เป็นขอบเขตที่ตั้งใจไว้ ไม่ใช่ของที่ลืมทำ ดู BR-13 ในตารางด้านบน)
- FR-09: อีเมลเชิญยังไม่มี "ข้อมูลเตรียมตัวก่อนประชุม" (เช่นสรุป AI จาก FR-15) แนบไปด้วย — FR-09 ในเอกสาร requirement ระบุว่าเป็น "หากมี" (optional) จึงไม่ใช่ของที่ขาดตามสเปก แต่บันทึกไว้เผื่อขยายภายหลัง

## ขั้นตอนถัดไป

1. เพิ่มหน้า/endpoint สมัครสมาชิกแบบเปิด (FR-01) — FR เดียวที่เหลือ
2. ตั้งค่า `ANTHROPIC_API_KEY`/`SMTP_HOST` จริงในสภาพแวดล้อม production เพื่อให้ AI ตอบผลจริง (ไม่ใช่ 502) และอีเมลถูกส่งจริง (ไม่ใช่ log)
3. ถ้าต้องการส่ง reminder อัตโนมัติแบบไม่ต้องเรียกเอง — ผูก `POST /api/reminders/process-due` เข้ากับ scheduler ภายนอก (cron, GitHub Actions schedule, Vercel Cron ฯลฯ)
