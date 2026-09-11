-- =============================================================================
-- QUERIES.sql — คำตอบ 15 ข้อ ในหัวข้อ 8 "Expected Database Queries / Operations"
-- ของ requirements/requirements.md.md
-- =============================================================================
-- Dialect: PostgreSQL (Supabase). ใช้ NOW() ตรงๆ — ไม่มีการแปลง unix-epoch
-- แบบไฟล์เวอร์ชันก่อนหน้า (ซึ่งเขียนไว้ตอน dev database ยังเป็น SQLite ที่
-- Prisma เก็บ DateTime เป็น unix-epoch มิลลิวินาที) เพราะ dev database ปัจจุบัน
-- คือ Supabase Postgres จริงแล้ว ไม่ต้องแปลงอะไรอีก
--
-- ข้อ 4, 7, 9, 14 เรียกผ่าน View/Function ที่สร้างไว้แล้วโดยตรง
-- (upcoming_meetings, process_due_reminders(), overdue_action_items,
-- get_meeting_context()) ตามที่ระบุไว้ — ไม่เขียน SELECT ซ้ำ logic เดิม
--
-- ค่าที่ hardcode ไว้ในแต่ละ query (ชื่อคน/กลุ่ม/โปรเจกต์/มีตติ้ง) อ้างอิงข้อมูลจริงที่มีอยู่ใน
-- Supabase ตอนนี้ (seed จาก prisma/seed.ts บวกการเปลี่ยนสถานะจริงที่เกิดขึ้นระหว่างพัฒนา
-- เช่น meeting หนึ่งถูก cancel ไปแล้วผ่าน trigger test ก่อนหน้านี้ในเซสชันนี้) เพื่อให้ query
-- กลับผลลัพธ์ที่ตรวจสอบได้ทันทีโดยไม่ต้องรู้ cuid ภายใน
--
-- รันจริงทุกข้อกับฐานข้อมูล Supabase Postgres จริง (ไม่ใช่จำลองแบบ dev SQLite เดิม)
-- ผ่าน Prisma's $queryRawUnsafe ซึ่งส่ง SQL text ตรงไปยัง Postgres จริงและคืนแถวจริง
-- กลับมา — ไม่มี psql หรือเบราว์เซอร์เข้า Supabase SQL editor ในสภาพแวดล้อมนี้ แต่กลไก
-- การส่ง/รับเป็น SQL ดิบไปยัง Postgres เดียวกันทุกประการ ดูผลลัพธ์จริงทั้ง 15 ข้อในหมวด
-- "VERIFIED OUTPUT" ท้ายไฟล์ — คัดลอกมาจาก raw output จริง ไม่ได้พิมพ์เอง
--
-- ข้อ 7 (process_due_reminders): ฐานข้อมูลจริง ณ ตอนรันไม่มี Reminder ที่
-- status = PENDING เหลืออยู่เลย (2 รายการสุดท้ายถูก trigger เปลี่ยนเป็น
-- CANCELLED ไปแล้วตอนทดสอบ trg_cancel_meeting_reminders ก่อนหน้านี้ในเซสชัน
-- เดียวกัน) เพื่อพิสูจน์ฟังก์ชันด้วยข้อมูลจริงที่ไม่ว่างเปล่า จึง INSERT reminder
-- ทดสอบ 1 แถว (status PENDING, scheduledAt ในอดีต) บน meeting จริงชั่วคราว
-- รัน query แล้ว DELETE แถวนั้นทิ้งทันที — ฐานข้อมูลหลังรันสคริปต์นี้จึงไม่ต่างจาก
-- ก่อนรันแม้แต่แถวเดียว (verified ด้วย SELECT count(*) ก่อน/หลัง)
-- =============================================================================


-- =============================================================================
-- ข้อ 1: แสดงสมาชิกทั้งหมดในกลุ่มที่กำหนด
-- =============================================================================
SELECT
    p.name,
    p.email,
    p.title,
    cgm.role,
    cgm."joinedAt"
FROM "ContactGroupMember" cgm
JOIN "Person" p ON p.id = cgm."personId"
JOIN "ContactGroup" cg ON cg.id = cgm."groupId"
WHERE cg.name = 'ทีมวิจัย AI Lab'          -- <<< เปลี่ยนชื่อกลุ่มตรงนี้เพื่อดูกลุ่มอื่น
ORDER BY cgm.role DESC, p.name;


-- =============================================================================
-- ข้อ 2: แสดงทุกกลุ่มที่บุคคลหนึ่งเป็นสมาชิก
-- =============================================================================
SELECT
    cg.name AS group_name,
    cg.description,
    cgm.role
FROM "ContactGroupMember" cgm
JOIN "ContactGroup" cg ON cg.id = cgm."groupId"
JOIN "Person" p ON p.id = cgm."personId"
WHERE p.name = 'สมชาย ใจดี'              -- <<< เปลี่ยนชื่อบุคคลตรงนี้
ORDER BY cg.name;


-- =============================================================================
-- ข้อ 3: แสดงผู้เข้าร่วมของ Meeting (พร้อมแหล่งที่มา — BR-04)
-- =============================================================================
SELECT
    p.name,
    p.email,
    mp.role,
    mp."rsvpStatus",
    mp.source,
    cg.name AS source_group
FROM "MeetingParticipant" mp
JOIN "Person" p ON p.id = mp."personId"
JOIN "Meeting" m ON m.id = mp."meetingId"
LEFT JOIN "ContactGroup" cg ON cg.id = mp."sourceGroupId"
WHERE m.title = 'ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ'   -- <<< เปลี่ยนชื่อ meeting ตรงนี้
ORDER BY mp.role DESC, p.name;


-- =============================================================================
-- ข้อ 4: แสดง Meeting ที่กำลังจะเกิดขึ้น — ผ่าน view upcoming_meetings โดยตรง
-- (docs/deliverables/schema.sql §6 — status NOT IN ('CANCELLED','COMPLETED')
-- AND startTime > NOW(), join ชื่อ organizer + project เข้ามาให้แล้ว)
-- =============================================================================
SELECT * FROM upcoming_meetings;


-- =============================================================================
-- ข้อ 5: แสดง Meeting ทั้งหมดของ Project ที่กำหนด
-- =============================================================================
SELECT
    m.title,
    m.status,
    m."startTime"
FROM "Meeting" m
JOIN "Project" pr ON pr.id = m."projectId"
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'   -- <<< เปลี่ยนชื่อ project ตรงนี้
ORDER BY m."startTime";


-- =============================================================================
-- ข้อ 6: แสดง Meeting History ตามลำดับเวลา (การประชุมที่ผ่านมาแล้ว เรียงล่าสุดก่อน)
-- =============================================================================
SELECT
    title,
    status,
    "startTime"
FROM "Meeting"
WHERE "startTime" <= NOW()
ORDER BY "startTime" DESC;


-- =============================================================================
-- ข้อ 7: แสดง Reminder ที่ถึงเวลาต้องส่ง — ผ่าน function process_due_reminders()
-- โดยตรง (docs/deliverables/schema.sql §7 — status = 'PENDING' AND
-- scheduledAt <= NOW(), เรียกใช้จริงใน
-- src/app/api/reminders/process-due/route.ts แทน query ตรงๆ ที่เคยมี)
-- =============================================================================
SELECT * FROM process_due_reminders();


-- =============================================================================
-- ข้อ 8: แสดง Reminder ที่ส่งไม่สำเร็จ
-- =============================================================================
SELECT
    r.id,
    m.title,
    r."failureReason",
    r."retryCount",
    r."scheduledAt"
FROM "Reminder" r
JOIN "Meeting" m ON m.id = r."meetingId"
WHERE r.status = 'FAILED'
ORDER BY r."scheduledAt";


-- =============================================================================
-- ข้อ 9: แสดง Action Items ที่ยังไม่เสร็จ — ผ่าน view overdue_action_items
-- โดยตรง (docs/deliverables/schema.sql §6 — status <> 'COMPLETED' AND
-- dueDate < NOW(), join ชื่อ assignee เข้ามาให้แล้ว)
-- =============================================================================
SELECT * FROM overdue_action_items;


-- =============================================================================
-- ข้อ 10: แสดง Action Items ของบุคคลที่กำหนด
-- =============================================================================
SELECT
    t.title,
    t.status,
    t.priority,
    t."dueDate"
FROM "Task" t
JOIN "Person" p ON p.id = t."assigneePersonId"
WHERE p.name = 'สมชาย ใจดี'              -- <<< เปลี่ยนชื่อบุคคลตรงนี้
ORDER BY t."dueDate";


-- =============================================================================
-- ข้อ 11: แสดง Decisions จาก Meeting ก่อนหน้า (meeting ที่ COMPLETED แล้ว)
-- =============================================================================
SELECT
    m.title AS meeting,
    d.content,
    d."decidedAt",
    u.name AS "decidedBy"
FROM "Decision" d
JOIN "Meeting" m ON m.id = d."meetingId"
LEFT JOIN "User" u ON u.id = d."decidedById"
WHERE m.status = 'COMPLETED'
ORDER BY d."decidedAt" DESC;


-- =============================================================================
-- ข้อ 12: แสดง Online Meeting Link ที่ถูกใช้กับหลาย Meeting (BR-09)
-- =============================================================================
SELECT
    o.name,
    o.url,
    COUNT(m.id) AS used_by_meetings
FROM "OnlineMeetingResource" o
JOIN "Meeting" m ON m."onlineMeetingResourceId" = o.id
GROUP BY o.id
HAVING COUNT(m.id) > 1;


-- =============================================================================
-- ข้อ 13: แสดง Meeting Notes ที่เกี่ยวข้องกับ Project
-- =============================================================================
SELECT
    n.content,
    n."createdAt",
    u.name AS author,
    m.title AS meeting
FROM "MeetingNote" n
JOIN "Meeting" m ON m.id = n."meetingId"
JOIN "Project" pr ON pr.id = m."projectId"
LEFT JOIN "User" u ON u.id = n."authorId"
WHERE pr.name = 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'   -- <<< เปลี่ยนชื่อ project ตรงนี้
ORDER BY n."createdAt";


-- =============================================================================
-- ข้อ 14: รวบรวมข้อมูลที่จำเป็นสำหรับสร้าง Pre-meeting Summary (FR-15) —
-- ผ่าน function get_meeting_context(meeting_id) โดยตรง
-- (docs/deliverables/schema.sql §7 — ตรรกะเดียวกับ gatherMeetingAiContext()
-- ใน src/lib/meeting-ai-context.ts: related/overdue tasks + past
-- decisions/notes/resources จาก meeting ก่อนหน้าใน project เดียวกัน, คืนเป็น
-- JSON เดียว)
-- =============================================================================
SELECT get_meeting_context('<meeting id จริง — ดูตัวอย่างจริงใน VERIFIED OUTPUT ด้านล่าง>');


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
FROM "MeetingParticipant" mp
JOIN "Meeting" m ON m.id = mp."meetingId"
JOIN "Person" p ON p.id = mp."personId"
LEFT JOIN "ContactGroup" cg ON cg.id = mp."sourceGroupId"
WHERE mp."meetingId" IN (
    SELECT "meetingId" FROM "MeetingParticipant" WHERE source = 'DIRECT'
    INTERSECT
    SELECT "meetingId" FROM "MeetingParticipant" WHERE source = 'GROUP'
)
ORDER BY m.title, mp.source, p.name;


-- =============================================================================
-- ✅ VERIFIED OUTPUT — รันจริงทุกข้อกับ Supabase Postgres จริง (โปรเจกต์เดียวกับที่
-- แอปใช้งานอยู่ตอนนี้ ไม่ใช่ dev database แยกต่างหาก) เมื่อ 2026-09-11 ผ่าน
-- Prisma $queryRawUnsafe (ส่ง SQL text ตรงไปยัง Postgres จริง — ไม่มี psql/
-- Supabase SQL editor ในสภาพแวดล้อมนี้ แต่คือ SQL ดิบไปยัง Postgres เดียวกัน)
-- คัดลอกจาก raw JSON output จริงที่ได้กลับมา ไม่ใช่ query ที่เขียนแล้วไม่เคยรัน
-- =============================================================================
--
-- ข้อ 1 (สมาชิกกลุ่ม 'ทีมวิจัย AI Lab'): 3 แถว
--   นรินทร์ ชัยเจริญ (MEMBER), สมหญิง รักการงาน (MEMBER), ศิริพร ใจดี (LEADER)
--
-- ข้อ 2 (กลุ่มของ 'สมชาย ใจดี'): 4 แถว
--   กลุ่มผู้บริหารคณะ (MEMBER), กลุ่มอาจารย์สาขาวิชาวิศวกรรมซอฟต์แวร์ (LEADER),
--   คณะกรรมการบริหารหลักสูตร (LEADER), ทีมโครงงานนักศึกษา A (LEADER)
--
-- ข้อ 3 (ผู้เข้าร่วม 'ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ'): 4 แถว
--   นรินทร์ ชัยเจริญ (ATTENDEE/GROUP←ทีมวิจัย AI Lab), วิชิต พงษ์สวัสดิ์ (ATTENDEE/EXTERNAL),
--   สมหญิง รักการงาน (ATTENDEE/GROUP←ทีมวิจัย AI Lab), ศิริพร ใจดี (ORGANIZER/DIRECT)
--
-- ข้อ 4 (SELECT * FROM upcoming_meetings): 4 แถว — เรียงเวลา:
--   ประชุมทีมพัฒนาระบบ AI Lab ประจำสัปดาห์ (2026-09-11, ACTIVE, organizer: สมชาย ใจดี),
--   ประชุมหารือความร่วมมือวิจัยกับสถาบันพันธมิตร (2026-09-14, PENDING, organizer: ศิริพร ใจดี),
--   วางแผน Sprint การออกแบบเว็บไซต์สาขาวิชา (2026-09-16, POSTPONED, organizer: วิชัย พงษ์สวัสดิ์),
--   ประชุมทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) ประจำไตรมาส (2026-09-19, PENDING, organizer: ศิริพร ใจดี)
--   [ยืนยันว่า filter ทำงานถูกต้อง: "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ" ซึ่งถูก
--    cancel ไปแล้วจริง (ผ่าน trigger test ก่อนหน้าในเซสชันนี้) ไม่ปรากฏในผลลัพธ์ — status = CANCELLED]
--
-- ข้อ 5 (meeting ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 1 แถว
--   "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)" (COMPLETED, 2026-08-11)
--
-- ข้อ 6 (meeting history ที่ผ่านมาแล้ว เรียงล่าสุดก่อน): 2 แถว
--   Emergency Server Patch Review (2026-09-08, CANCELLED),
--   ประชุมเริ่มต้นโครงการวิจัย (Kickoff) (2026-08-11, COMPLETED)
--
-- ข้อ 7 (SELECT * FROM process_due_reminders()): 1 แถว — ฐานข้อมูลจริงไม่มี
--   PENDING reminder เหลืออยู่เลย ณ ตอนรัน (2 รายการสุดท้ายถูก trigger เปลี่ยนเป็น
--   CANCELLED ไปแล้วก่อนหน้านี้ในเซสชัน) จึง INSERT reminder ทดสอบชั่วคราว 1 แถว
--   (status PENDING, scheduledAt = 1 ชั่วโมงก่อน NOW()) บน "ประชุมทีมพัฒนาระบบ AI
--   Lab ประจำสัปดาห์" ก่อนรัน — ฟังก์ชันคืนแถวนั้นถูกต้อง แล้ว DELETE ทิ้งทันทีหลัง
--   capture ผลลัพธ์ (ฐานข้อมูลไม่มีร่องรอยเหลือ — ตรวจแล้วด้วย SELECT count(*))
--
-- ข้อ 8 (reminder ที่ส่งไม่สำเร็จ): 1 แถว
--   Emergency Server Patch Review — "ไม่สามารถเชื่อมต่อผู้ให้บริการอีเมลได้ (SMTP timeout)", retryCount=2
--
-- ข้อ 9 (SELECT * FROM overdue_action_items): 3 แถว (เรียงตาม dueDate)
--   สรุปงบประมาณไตรมาส 4 (IN_PROGRESS, assignee: สมชาย ใจดี),
--   ตรวจสอบและยืนยันชุดข้อมูลทดสอบชุดที่ 2 (NOT_STARTED, assignee: ศิริพร ใจดี),
--   สรุปรายชื่อผู้เชี่ยวชาญสำหรับเชิญ Peer Review (NOT_STARTED, assignee: ศิริพร ใจดี)
--
-- ข้อ 10 (action items ของ 'สมชาย ใจดี'): 3 แถว
--   สรุปงบประมาณไตรมาส 4 (IN_PROGRESS), เตรียมเอกสารประกอบการขอทุนวิจัยเพิ่มเติม (IN_PROGRESS),
--   สัมภาษณ์ผู้สมัครทุนผู้ช่วยวิจัย (Research Assistant) (IN_PROGRESS)
--
-- ข้อ 11 (decisions จาก meeting ที่ COMPLETED แล้ว): 2 แถว (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)")
--   "อนุมัติงบประมาณระยะที่ 1 ของโครงการวิจัยที่ 250,000 บาท",
--   "เลือกใช้แพลตฟอร์ม Cloud เดิม (AWS) สำหรับจัดเก็บข้อมูลวิจัย แทนการเปลี่ยนผู้ให้บริการ" — ทั้งคู่โดย สมชาย ใจดี
--
-- ข้อ 12 (online link ที่ใช้กับหลาย meeting): 1 แถว
--   "Google Meet — ความร่วมมือกับสถาบันพันธมิตร" ใช้กับ 2 meetings
--   ["Zoom Room B — ทีมวิจัย AI Lab" ใช้แค่ 1 meeting ในข้อมูลปัจจุบัน จึงไม่เข้าเงื่อนไข HAVING > 1 — ถูกต้อง]
--
-- ข้อ 13 (meeting notes ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 2 แถว
--   (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)", โดย สมชาย ใจดี)
--   "ทีมเห็นตรงกันว่าจะเริ่มเก็บข้อมูลชุดแรก...", "วิชัยรับผิดชอบเตรียมแผนการเก็บและเตรียมข้อมูล..."
--
-- ข้อ 14 (SELECT get_meeting_context('cmtvn06oa0027uwl416vfk1b0') — meeting
--   "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ", อยู่ใน project
--   'โครงการทุนวิจัย AI Lab ปี 2569'): คืน JSON เดียว —
--   relatedTasks: 3 รายการ (ทุก Task ของ project นี้), overdueTasks: 2 ใน 3 รายการนั้น
--   ที่ยังไม่เสร็จและเลยกำหนดแล้ว (subset ถูกต้องตรงกับ FR-16),
--   pastMeetings/pastDecisions/pastNotes/pastResources: ว่างทั้งหมด ([]) — ถูกต้อง
--   ตามข้อมูลจริง เพราะ project นี้มีแค่ meeting เดียว ไม่มี meeting ก่อนหน้าให้ดึงบริบทมา
--   (ตัวอย่างที่มี pastMeetings จริงต้องมี project ที่มีอย่างน้อย 2 meeting ซึ่งข้อมูล seed
--   ปัจจุบันยังไม่มีกรณีนั้น — ดู DESIGN_DECISIONS.md/GAP_ANALYSIS.md ถ้าต้องการเพิ่ม)
--
-- ข้อ 15 (ผู้เข้าร่วมที่มาจาก Group ปนกับ Direct ในมีตติ้งเดียวกัน): 7 แถว จาก 2 meetings
--   "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ": ศิริพร ใจดี (DIRECT),
--   นรินทร์ ชัยเจริญ + สมหญิง รักการงาน (GROUP←ทีมวิจัย AI Lab), วิชิต พงษ์สวัสดิ์ (EXTERNAL,
--   ไม่เข้าเงื่อนไข filter หลักแต่ติดมาเพราะ meeting นี้เข้าเงื่อนไข IN แล้วจึงแสดงผู้เข้าร่วม
--   ทุกคนของ meeting นั้น รวมคนที่มาจาก EXTERNAL ด้วย ตามที่ query เขียนไว้)
--   "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)": สมชาย ใจดี (DIRECT), กิตติชัย นามดี +
--   วิชัย พงษ์สวัสดิ์ (GROUP←ทีมโครงงานนักศึกษา A)
-- =============================================================================
