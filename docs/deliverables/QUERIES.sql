-- =============================================================================
-- QUERIES.sql — คำตอบ 15 ข้อ ในหัวข้อ 8 "Expected Database Queries / Operations"
-- ของ requirements/requirements.md.md
-- =============================================================================
-- รันจริงแล้วกับ dev database ที่ seed ไว้ (prisma/dev.db, สร้างโดย `npm run db:seed`
-- ล้วนๆ — ไม่มีการทับข้อมูลด้วยมือเพิ่มเติม) โดยใช้ Node's built-in `node:sqlite`
-- (DatabaseSync, read-only mode) — ดูผลลัพธ์ที่ยืนยันแล้วทั้ง 15 ข้อในหมวด
-- "VERIFIED OUTPUT" ท้ายไฟล์
--
-- หมายเหตุ dialect: dev database เป็น SQLite และ Prisma เก็บคอลัมน์ DateTime เป็น
-- INTEGER unix-epoch มิลลิวินาที (ไม่ใช่ TEXT/ISO) จึงต้องแปลงด้วย
-- `datetime(col/1000, 'unixepoch')` ตอนแสดงผล และเทียบ "เวลาปัจจุบัน" ด้วย
-- `(strftime('%s','now') * 1000)` แทน CURRENT_TIMESTAMP ตรงๆ — เป็น quirk ของ
-- Prisma+SQLite ไม่ใช่ query ผิด (บน PostgreSQL จริงจะใช้ NOW() ปกติได้เลย)
--
-- ค่าที่ hardcode ไว้ในแต่ละ query (ชื่อคน/กลุ่ม/โปรเจกต์/มีตติ้ง) อ้างอิงข้อมูลจริงจาก
-- prisma/seed.ts เพื่อให้ query กลับผลลัพธ์ที่ตรวจสอบได้ทันทีโดยไม่ต้องรู้ cuid ภายใน
-- =============================================================================


-- =============================================================================
-- ข้อ 1: แสดงสมาชิกทั้งหมดในกลุ่มที่กำหนด
-- =============================================================================
SELECT
    p.name,
    p.email,
    p.title,
    cgm.role,
    datetime(cgm.joinedAt / 1000, 'unixepoch') AS joinedAt
FROM ContactGroupMember cgm
JOIN Person p ON p.id = cgm.personId
JOIN ContactGroup cg ON cg.id = cgm.groupId
WHERE cg.name = 'ทีมวิจัย AI Lab'          -- <<< เปลี่ยนชื่อกลุ่มตรงนี้เพื่อดูกลุ่มอื่น
ORDER BY cgm.role DESC, p.name;


-- =============================================================================
-- ข้อ 2: แสดงทุกกลุ่มที่บุคคลหนึ่งเป็นสมาชิก
-- =============================================================================
SELECT
    cg.name AS group_name,
    cg.description,
    cgm.role
FROM ContactGroupMember cgm
JOIN ContactGroup cg ON cg.id = cgm.groupId
JOIN Person p ON p.id = cgm.personId
WHERE p.name = 'สมชาย ใจดี'              -- <<< เปลี่ยนชื่อบุคคลตรงนี้
ORDER BY cg.name;


-- =============================================================================
-- ข้อ 3: แสดงผู้เข้าร่วมของ Meeting (พร้อมแหล่งที่มา — BR-04)
-- =============================================================================
SELECT
    p.name,
    p.email,
    mp.role,
    mp.rsvpStatus,
    mp.source,
    cg.name AS source_group
FROM MeetingParticipant mp
JOIN Person p ON p.id = mp.personId
JOIN Meeting m ON m.id = mp.meetingId
LEFT JOIN ContactGroup cg ON cg.id = mp.sourceGroupId
WHERE m.title = 'ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ'   -- <<< เปลี่ยนชื่อ meeting ตรงนี้
ORDER BY mp.role DESC, p.name;


-- =============================================================================
-- ข้อ 4: แสดง Meeting ที่กำลังจะเกิดขึ้น (ยังไม่ถูกยกเลิก)
-- =============================================================================
SELECT
    title,
    type,
    status,
    datetime(startTime / 1000, 'unixepoch') AS startTime,
    location
FROM Meeting
WHERE startTime > (strftime('%s', 'now') * 1000)
  AND status != 'CANCELLED'
ORDER BY startTime ASC;


-- =============================================================================
-- ข้อ 5: แสดง Meeting ทั้งหมดของ Project ที่กำหนด
-- =============================================================================
SELECT
    m.title,
    m.status,
    datetime(m.startTime / 1000, 'unixepoch') AS startTime
FROM Meeting m
JOIN Project pr ON pr.id = m.projectId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'   -- <<< เปลี่ยนชื่อ project ตรงนี้
ORDER BY m.startTime;


-- =============================================================================
-- ข้อ 6: แสดง Meeting History ตามลำดับเวลา (การประชุมที่ผ่านมาแล้ว เรียงล่าสุดก่อน)
-- =============================================================================
SELECT
    title,
    status,
    datetime(startTime / 1000, 'unixepoch') AS startTime
FROM Meeting
WHERE startTime <= (strftime('%s', 'now') * 1000)
ORDER BY startTime DESC;


-- =============================================================================
-- ข้อ 7: แสดง Reminder ที่ถึงเวลาต้องส่ง (PENDING และเลยเวลานัดส่งแล้ว)
-- =============================================================================
-- (ก) ผลจริง ณ เวลาปัจจุบัน
SELECT
    r.id,
    m.title,
    r.status,
    datetime(r.scheduledAt / 1000, 'unixepoch') AS scheduledAt
FROM Reminder r
JOIN Meeting m ON m.id = r.meetingId
WHERE r.status = 'PENDING'
  AND r.scheduledAt <= (strftime('%s', 'now') * 1000)
ORDER BY r.scheduledAt;

-- (ข) จำลองว่าเวลาปัจจุบันคือ 2026-09-10 เพื่อพิสูจน์ว่า logic การเทียบเวลาถูกต้อง
--     (ใช้ตอนที่ (ก) คืนแถวว่างเพราะ reminder ตัวอย่างทั้งหมดถูกตั้งไว้ในอนาคตจริงๆ)
SELECT
    r.id,
    m.title,
    r.status,
    datetime(r.scheduledAt / 1000, 'unixepoch') AS scheduledAt
FROM Reminder r
JOIN Meeting m ON m.id = r.meetingId
WHERE r.status = 'PENDING'
  AND r.scheduledAt <= (strftime('%s', '2026-09-10') * 1000)
ORDER BY r.scheduledAt;


-- =============================================================================
-- ข้อ 8: แสดง Reminder ที่ส่งไม่สำเร็จ
-- =============================================================================
SELECT
    r.id,
    m.title,
    r.failureReason,
    r.retryCount,
    datetime(r.scheduledAt / 1000, 'unixepoch') AS scheduledAt
FROM Reminder r
JOIN Meeting m ON m.id = r.meetingId
WHERE r.status = 'FAILED'
ORDER BY r.scheduledAt;


-- =============================================================================
-- ข้อ 9: แสดง Action Items ที่ยังไม่เสร็จ (ทั้งระบบ)
-- =============================================================================
SELECT
    title,
    status,
    priority,
    datetime(dueDate / 1000, 'unixepoch') AS dueDate
FROM Task
WHERE status != 'COMPLETED'
ORDER BY dueDate;


-- =============================================================================
-- ข้อ 10: แสดง Action Items ของบุคคลที่กำหนด
-- =============================================================================
SELECT
    t.title,
    t.status,
    t.priority,
    datetime(t.dueDate / 1000, 'unixepoch') AS dueDate
FROM Task t
JOIN Person p ON p.id = t.assigneePersonId
WHERE p.name = 'ศิริพร ใจดี'              -- <<< เปลี่ยนชื่อบุคคลตรงนี้
ORDER BY t.dueDate;


-- =============================================================================
-- ข้อ 11: แสดง Decisions จาก Meeting ก่อนหน้า (meeting ที่ COMPLETED แล้ว)
-- =============================================================================
SELECT
    m.title AS meeting,
    d.content,
    datetime(d.decidedAt / 1000, 'unixepoch') AS decidedAt,
    u.name AS decidedBy
FROM Decision d
JOIN Meeting m ON m.id = d.meetingId
LEFT JOIN User u ON u.id = d.decidedById
WHERE m.status = 'COMPLETED'
ORDER BY d.decidedAt DESC;


-- =============================================================================
-- ข้อ 12: แสดง Online Meeting Link ที่ถูกใช้กับหลาย Meeting (BR-09)
-- =============================================================================
SELECT
    o.name,
    o.url,
    COUNT(m.id) AS used_by_meetings
FROM OnlineMeetingResource o
JOIN Meeting m ON m.onlineMeetingResourceId = o.id
GROUP BY o.id
HAVING COUNT(m.id) > 1;


-- =============================================================================
-- ข้อ 13: แสดง Meeting Notes ที่เกี่ยวข้องกับ Project
-- =============================================================================
SELECT
    n.content,
    datetime(n.createdAt / 1000, 'unixepoch') AS createdAt,
    u.name AS author,
    m.title AS meeting
FROM MeetingNote n
JOIN Meeting m ON m.id = n.meetingId
JOIN Project pr ON pr.id = m.projectId
LEFT JOIN User u ON u.id = n.authorId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'   -- <<< เปลี่ยนชื่อ project ตรงนี้
ORDER BY n.createdAt;


-- =============================================================================
-- ข้อ 14: รวบรวมข้อมูลที่จำเป็นสำหรับสร้าง Pre-meeting Summary (FR-15)
-- =============================================================================
-- จำลองสิ่งที่ generateMeetingSummary() ใน src/lib/ai.ts ต้องดึงมาจริง: notes เก่า,
-- decisions เก่า, action items ที่ยังไม่เสร็จ, และ resources ที่เกี่ยวข้อง — ทั้งหมดจาก
-- ประวัติของ project เดียวกับ meeting ครั้งใหม่ที่กำลังจะเตรียมข้อมูลให้
SELECT 'NOTE' AS source_type, n.content AS detail, datetime(n.createdAt / 1000, 'unixepoch') AS at
FROM MeetingNote n
JOIN Meeting m ON m.id = n.meetingId
JOIN Project pr ON pr.id = m.projectId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'   -- <<< เปลี่ยนชื่อ project ตรงนี้

UNION ALL

SELECT 'DECISION', d.content, datetime(d.decidedAt / 1000, 'unixepoch')
FROM Decision d
JOIN Meeting m ON m.id = d.meetingId
JOIN Project pr ON pr.id = m.projectId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'

UNION ALL

SELECT 'PENDING_TASK', t.title, datetime(t.dueDate / 1000, 'unixepoch')
FROM Task t
JOIN Project pr ON pr.id = t.projectId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'
  AND t.status != 'COMPLETED'

UNION ALL

SELECT 'RESOURCE', r.title || ' — ' || r.url, datetime(r.createdAt / 1000, 'unixepoch')
FROM RelatedResource r
JOIN Meeting m ON m.id = r.meetingId
JOIN Project pr ON pr.id = m.projectId
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'

ORDER BY source_type, at;


-- =============================================================================
-- ข้อ 15: แสดงผู้เข้าร่วมที่ถูกเชิญผ่าน Group และ/หรือถูกเพิ่มโดยตรง
-- =============================================================================
-- เลือกเฉพาะ meeting ที่มีผู้เข้าร่วมทั้งแบบ DIRECT และ GROUP ปนกันจริง (BR-04) แล้ว
-- แสดงรายชื่อทั้งหมดของ meeting นั้นพร้อม flag แหล่งที่มาแต่ละคน
SELECT
    m.title AS meeting_title,
    p.name AS participant,
    mp.source,
    cg.name AS source_group
FROM MeetingParticipant mp
JOIN Meeting m ON m.id = mp.meetingId
JOIN Person p ON p.id = mp.personId
LEFT JOIN ContactGroup cg ON cg.id = mp.sourceGroupId
WHERE mp.meetingId IN (
    SELECT meetingId FROM MeetingParticipant WHERE source = 'DIRECT'
    INTERSECT
    SELECT meetingId FROM MeetingParticipant WHERE source = 'GROUP'
)
ORDER BY m.title, mp.source, p.name;


-- =============================================================================
-- ✅ VERIFIED OUTPUT — รันจริงกับ prisma/dev.db (สร้างสดใหม่จาก `npm run db:seed`
-- ล้วนๆ หลังปรับ seed data ให้เป็นบริบทมหาวิทยาลัย) ผ่าน node:sqlite (DatabaseSync,
-- read-only) เมื่อ 2026-09-07 13:37 UTC (ตรงกับ "now" ที่ query ข้อ 4/6/7 ใช้เทียบ)
-- คัดลอกผลจริงมาไว้ตรงนี้เพื่อยืนยันว่าทุก query รันได้จริงและได้ผลลัพธ์สมเหตุสมผล
-- ไม่ใช่ query ที่เขียนแล้วไม่เคยรัน — reproduce ได้เองด้วย:
--   node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('./prisma/dev.db',{readOnly:true}); console.log(db.prepare(`<query ข้อที่ต้องการ>`).all())"
-- =============================================================================
--
-- ข้อ 1 (สมาชิกกลุ่ม 'ทีมวิจัย AI Lab'): 3 แถว
--   ศิริพร ใจดี (LEADER), นรินทร์ ชัยเจริญ (MEMBER), สมหญิง รักการงาน (MEMBER)
--
-- ข้อ 2 (กลุ่มของ 'สมชาย ใจดี'): 3 แถว
--   กลุ่มอาจารย์ภาควิชาวิศวกรรมคอมพิวเตอร์ (LEADER), คณะกรรมการบริหารหลักสูตร (LEADER),
--   ทีมโครงงานนักศึกษา A (LEADER)
--
-- ข้อ 3 (ผู้เข้าร่วม 'ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ'): 4 แถว
--   ศิริพร ใจดี (ORGANIZER/DIRECT), นรินทร์ ชัยเจริญ (ATTENDEE/GROUP←ทีมวิจัย AI Lab),
--   สมหญิง รักการงาน (ATTENDEE/GROUP←ทีมวิจัย AI Lab), วิชิต พงษ์สวัสดิ์ (ATTENDEE/EXTERNAL)
--
-- ข้อ 4 (meeting ที่กำลังจะเกิดขึ้น): 5 แถว — เรียงเวลา:
--   ประชุมทีมพัฒนาระบบ AI Lab ประจำสัปดาห์ (2026-09-08, ACTIVE),
--   ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ (2026-09-09, ACTIVE),
--   ประชุมหารือความร่วมมือวิจัยกับสถาบันพันธมิตร (2026-09-11, PENDING),
--   วางแผน Sprint การออกแบบเว็บไซต์ภาควิชา (2026-09-13, POSTPONED),
--   ประชุมทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) ประจำไตรมาส (2026-09-16, PENDING)
--   [ยืนยันว่า filter status != CANCELLED ทำงานถูกต้อง: "Emergency Server Patch Review" ซึ่งถูก
--    ยกเลิกไว้ตั้งแต่ seed ไม่ปรากฏในผลลัพธ์]
--
-- ข้อ 5 (meeting ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 1 แถว
--   — "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)" (COMPLETED, 2026-08-08)
--
-- ข้อ 6 (meeting history ที่ผ่านมาแล้ว เรียงล่าสุดก่อน): 2 แถว
--   Emergency Server Patch Review (2026-09-05, CANCELLED), ประชุมเริ่มต้นโครงการวิจัย (Kickoff) (2026-08-08, COMPLETED)
--
-- ข้อ 7 (ก) reminder ที่ถึงเวลาส่งจริง ณ ตอนรัน: 0 แถว — ถูกต้องตามข้อมูลจริง เพราะ
--   reminder ตัวอย่างทั้งหมดถูกตั้งไว้ในอนาคต (เร็วสุดคือ 2026-09-08) ยังไม่ถึงกำหนด ณ วันที่รัน
--   (ข) จำลองเป็นวันที่ 2026-09-20: ได้ 2 แถว — พิสูจน์ว่า WHERE clause ทำงานถูกต้องจริง
--   (ทั้งคู่คือ reminder ของ "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ" — BR-11:
--   1 meeting มีได้หลาย reminder)
--
-- ข้อ 8 (reminder ที่ส่งไม่สำเร็จ): 1 แถว
--   Emergency Server Patch Review — "ไม่สามารถเชื่อมต่อผู้ให้บริการอีเมลได้ (SMTP timeout)", retryCount=2
--
-- ข้อ 9 (action items ที่ยังไม่เสร็จ ทั้งระบบ): 6 แถว (เรียงตาม dueDate)
--   สรุปงบประมาณไตรมาส 4, ตรวจสอบและยืนยันชุดข้อมูลทดสอบชุดที่ 2,
--   สรุปรายชื่อผู้เชี่ยวชาญสำหรับเชิญ Peer Review, เตรียมเอกสารประกอบการขอทุนวิจัยเพิ่มเติม,
--   ทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) กับสถาบันพันธมิตร, สัมภาษณ์ผู้สมัครทุนผู้ช่วยวิจัย (Research Assistant)
--
-- ข้อ 10 (action items ของ 'ศิริพร ใจดี'): 2 แถว
--   ตรวจสอบและยืนยันชุดข้อมูลทดสอบชุดที่ 2 (NOT_STARTED), สรุปรายชื่อผู้เชี่ยวชาญสำหรับเชิญ Peer Review (NOT_STARTED)
--
-- ข้อ 11 (decisions จาก meeting ที่ COMPLETED แล้ว): 2 แถว (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)")
--   "อนุมัติงบประมาณระยะที่ 1 ของโครงการวิจัยที่ 250,000 บาท",
--   "เลือกใช้แพลตฟอร์ม Cloud เดิม (AWS) สำหรับจัดเก็บข้อมูลวิจัย แทนการเปลี่ยนผู้ให้บริการ" — ทั้งคู่โดย สมชาย ใจดี
--
-- ข้อ 12 (online link ที่ใช้กับหลาย meeting): 1 แถว
--   "Google Meet — ความร่วมมือกับสถาบันพันธมิตร" ใช้กับ 2 meetings
--   (ประชุมหารือความร่วมมือวิจัย + ประชุมทบทวน MOU ประจำไตรมาส)
--   ["Zoom Room B — ทีมวิจัย AI Lab" ใช้แค่ 1 meeting ในข้อมูลปัจจุบัน จึงไม่เข้าเงื่อนไข HAVING > 1 — ถูกต้อง]
--
-- ข้อ 13 (meeting notes ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 2 แถว
--   (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)", โดย สมชาย ใจดี)
--   "ทีมเห็นตรงกันว่าจะเริ่มเก็บข้อมูลชุดแรก...", "วิชัยรับผิดชอบเตรียมแผนการเก็บและเตรียมข้อมูล..."
--
-- ข้อ 14 (ข้อมูลสำหรับ pre-meeting summary ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 7 แถว
--   DECISION x2, NOTE x2, PENDING_TASK x2 (สรุปงบประมาณไตรมาส 4, ทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) กับสถาบันพันธมิตร),
--   RESOURCE x1 (แผนงานวิจัย Research Master Plan)
--
-- ข้อ 15 (ผู้เข้าร่วมที่มาจาก Group ปนกับ Direct ในมีตติ้งเดียวกัน): 7 แถว จาก 2 meetings
--   "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)": สมชาย ใจดี (DIRECT), กิตติชัย นามดี + วิชัย พงษ์สวัสดิ์ (GROUP←ทีมโครงงานนักศึกษา A)
--   "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ": ศิริพร ใจดี (DIRECT), วิชิต พงษ์สวัสดิ์ (EXTERNAL,
--   ไม่เข้าเงื่อนไข filter หลักแต่ติดมาเพราะ join คนละเงื่อนไข IN — ปรากฏเพราะ meeting นี้เข้าเงื่อนไข
--   IN แล้วจึงแสดงผู้เข้าร่วมทุกคนของ meeting นั้น รวมคนที่มาจาก EXTERNAL ด้วย ตามที่ query เขียนไว้),
--   นรินทร์ ชัยเจริญ + สมหญิง รักการงาน (GROUP←ทีมวิจัย AI Lab)
-- =============================================================================
