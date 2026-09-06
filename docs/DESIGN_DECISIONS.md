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
