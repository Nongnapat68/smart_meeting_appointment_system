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
-- รันจริงทุกข้อกับฐานข้อมูล Supabase Postgres จริงเมื่อ 2026-10-11 (ดูผลจริง
-- ในหมวด "VERIFIED OUTPUT" ท้ายไฟล์ — คัดลอกจาก raw output จริง ไม่ได้พิมพ์เอง)
-- ผ่าน node + node-postgres ที่ส่ง SQL text ตรงไปยัง Postgres จริง (กลไกเดียวกับ
-- Prisma $queryRawUnsafe / Supabase SQL editor — SQL ดิบไปยัง Postgres เดียวกัน)
--
-- ⚠️ ข้อมูล live ณ 2026-10-11 (รอบ final-audit): seed ถูก re-seed เมื่อ 2026-09-12 และ meeting
-- จาก seed ผ่านพ้นไปหมดแล้ว — รอบนี้จึงเพิ่มประชุมตัวอย่างในอนาคต 2 รายการ (ชื่อขึ้นต้น
-- "ตัวอย่าง: ", 20 และ 27 ต.ค. 2569) ผ่าน RPC จริง ให้ view/function ในข้อ 4 และ 14 มีข้อมูล
-- ให้เห็น และข้อ 15 มีตัวอย่างการเชิญทั้งกลุ่มบนระบบจริง — ดูรายละเอียดใน VERIFIED OUTPUT
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
SELECT get_meeting_context('57c4a831-5e03-4ebf-84bb-59b38c5f03b7');   -- <<< id ของประชุมตัวอย่าง "ครั้งที่ 2" — เปลี่ยนเป็น meeting อื่นได้


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
-- ✅ VERIFIED OUTPUT — รันจริงทุกข้อกับ Supabase Postgres จริง (โปรเจกต์เดียวกับ
-- ที่แอปใช้งานอยู่ตอนนี้) เมื่อ 2026-10-11 (รอบ final-audit หลัง apply migration
-- ครบ 32 ตัวและเพิ่มประชุมตัวอย่าง 2 รายการแล้ว) ผ่าน node-postgres ใน transaction
-- READ ONLY — ค่า timestamp/date ถูกอ่านเป็นข้อความดิบของ Postgres (เท่ากับ ::text)
-- ไม่ให้ไดรเวอร์แปลงเป็นเวลาท้องถิ่นของเครื่อง (ค่าทั้งหมดเป็นเวลา UTC ตามที่เก็บ)
-- คัดลอกจาก raw output จริง ไม่ใช่ query ที่เขียนแล้วไม่เคยรัน
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
-- ข้อ 4 (SELECT * FROM upcoming_meetings): 2 แถว
--   "ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 1" (PENDING,
--   startTime 2026-10-20 03:00:00 UTC = 10:00 น. เวลาไทย, organizer ศิริพร ใจดี,
--   project โครงการทุนวิจัย AI Lab ปี 2569) และ "... ครั้งที่ 2" (PENDING,
--   2026-10-27 03:00:00 UTC) — ประชุมตัวอย่าง 2 รายการนี้สร้างเมื่อ 2026-10-11 ผ่าน RPC
--   create_meeting_with_participants ด้วยสิทธิ์ผู้จัดที่เป็น MEMBER เพื่อให้ view นี้มีข้อมูล
--   อนาคตให้แสดง (ก่อนหน้านั้น live ไม่มี meeting ในอนาคตเลย view จึงคืน 0 แถว)
--
-- ข้อ 5 (meeting ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 1 แถว
--   "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)" (COMPLETED, 2026-08-13 10:12:54.33)
--
-- ข้อ 6 (meeting history ที่ผ่านมาแล้ว เรียงล่าสุดก่อน): 17 แถว — ล่าสุดคือ
--   "ประชุม Progress Review ครั้งที่ 1" (PENDING, 2026-10-03 08:00:00) และ "ประชุม Kickoff
--   โครงการระบบลงทะเบียนกิจกรรม" (PENDING, 2026-10-03 04:00:00) ตามด้วยข้อมูลจาก seed:
--   ประชุมทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) ประจำไตรมาส (PENDING, 2026-09-21),
--   วางแผน Sprint การออกแบบเว็บไซต์สาขาวิชา (POSTPONED, 2026-09-18), ประชุมหารือความร่วมมือ
--   วิจัยกับสถาบันพันธมิตร (PENDING, 2026-09-16), ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณา
--   งบประมาณ (ACTIVE, 2026-09-14), ประชุมทีมพัฒนาระบบ AI Lab ประจำสัปดาห์ (ACTIVE, 2026-09-13),
--   Emergency Server Patch Review (CANCELLED, 2026-09-10), ประชุมเริ่มต้นโครงการวิจัย (Kickoff)
--   (COMPLETED, 2026-08-13) — ที่เหลือเป็นข้อมูลจากการใช้งานจริงระหว่างพัฒนา (1211, test2,
--   เทสระบบ/เทสระบบ2/เทสระบบ3, test11, การเงิน, test) เก็บไว้ตามจริง; ประชุมตัวอย่าง 2 รายการ
--   ไม่อยู่ในข้อนี้เพราะยังไม่ถึงเวลา (อยู่ในข้อ 4) — หน้าเว็บแสดง meeting PENDING ที่ผ่านไปแล้ว
--   ด้วยป้าย "ผ่านไปแล้ว" (เฉพาะการแสดงผล ค่า status ใน DB คงเดิมตามที่เห็นในผลนี้)
--
-- ข้อ 7 (SELECT * FROM process_due_reminders()): 0 แถว
--   [ฟังก์ชันคืนเฉพาะ reminder ที่ `status='PENDING' AND "scheduledAt" <= now()` ของ meeting
--    ที่ยังไม่ยกเลิก/ไม่จบ และยังไม่เริ่ม — reminder PENDING ของประชุมตัวอย่างทั้ง 5 รายการยัง
--    ไม่ถึงเวลา (รายการแรกถึงเวลา 2026-10-13 03:00:00 UTC = 10:00 น. ของวันที่ 13 ต.ค.,
--    "7 วันก่อน" ประชุมครั้งที่ 1) และ PENDING ที่เหลือผูกกับ meeting ในอดีตทั้งหมด จึงยังไม่มี
--    แถวใดเข้าเงื่อนไข ณ วันรัน — หลัง 2026-10-13 10:00 น. รายการนั้นจะเริ่มปรากฏในข้อนี้;
--    พฤติกรรมครบทุกกรณีพิสูจน์ด้วย `scripts/test-reminders.ts` (49 passed / 0 failed บน
--    ฐานข้อมูล scratch ที่ apply migration ครบ)]
--
-- ข้อ 8 (reminder ที่ส่งไม่สำเร็จ): 0 แถว
--   [ไม่มี reminder status = FAILED ใน live ขณะรัน]
--
-- ข้อ 9 (SELECT * FROM overdue_action_items): 3 แถว (เรียงตาม dueDate)
--   ทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) กับสถาบันพันธมิตร (NOT_STARTED, assignee: วิชัย พงษ์สวัสดิ์,
--   due 2026-09-18), สัมภาษณ์ผู้สมัครทุนผู้ช่วยวิจัย (Research Assistant) (NOT_STARTED,
--   assignee: สมชาย ใจดี, due 2026-09-20 10:12:54.33), ออกแบบ ER Diagram (NOT_STARTED,
--   assigneeId NULL, due **2026-10-02** 00:00:00 — Task.dueDate เป็น "วันที่" ที่เก็บเป็นเที่ยงคืน
--   UTC; รอบก่อนบันทึกไว้เป็น 2026-10-01 เพราะไดรเวอร์แปลงเป็นเวลาท้องถิ่นก่อนพิมพ์ ซึ่งผิด)
--
-- ข้อ 10 (action items ของ 'สมชาย ใจดี'): 3 แถว
--   สรุปงบประมาณไตรมาส 4 (COMPLETED, HIGH), เตรียมเอกสารประกอบการขอทุนวิจัยเพิ่มเติม
--   (COMPLETED, HIGH), สัมภาษณ์ผู้สมัครทุนผู้ช่วยวิจัย (Research Assistant) (NOT_STARTED, MEDIUM)
--
-- ข้อ 11 (decisions จาก meeting ที่ COMPLETED แล้ว): 2 แถว (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)")
--   "อนุมัติงบประมาณระยะที่ 1 ของโครงการวิจัยที่ 250,000 บาท",
--   "เลือกใช้แพลตฟอร์ม Cloud เดิม (AWS) สำหรับจัดเก็บข้อมูลวิจัย แทนการเปลี่ยนผู้ให้บริการ" — ทั้งคู่โดย สมชาย ใจดี
--
-- ข้อ 12 (online link ที่ใช้กับหลาย meeting): 2 แถว
--   "Zoom Room B — ทีมวิจัย AI Lab" ใช้กับ 2 meetings, "Google Meet — ความร่วมมือกับสถาบันพันธมิตร" ใช้กับ 2 meetings
--
-- ข้อ 13 (meeting notes ของ project 'งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม'): 2 แถว
--   (ทั้งคู่จาก "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)", โดย สมชาย ใจดี)
--   "ทีมเห็นตรงกันว่าจะเริ่มเก็บข้อมูลชุดแรก...", "วิชัยรับผิดชอบเตรียมแผนการเก็บและเตรียมข้อมูล..."
--
-- ข้อ 14 (SELECT get_meeting_context('57c4a831-5e03-4ebf-84bb-59b38c5f03b7') — ประชุมตัวอย่าง
--   "ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 2" ใน project
--   'โครงการทุนวิจัย AI Lab ปี 2569'): คืน JSON เดียว —
--   relatedTasks: 3 รายการ (Task ของ project นี้ ทั้ง 3 COMPLETED), overdueTasks: [],
--   pastMeetings: 2 รายการ ("ตัวอย่าง: ... ครั้งที่ 1" 2026-10-20 และ "ประชุมความคืบหน้างานวิจัย
--   AI Lab และพิจารณางบประมาณ" 2026-09-14 — meeting ก่อนหน้าใน project เดียวกัน),
--   pastResources: 2 รายการ ("แนวทางการเขียนรายงานวิจัยประจำไตรมาส", "Dashboard ความคืบหน้า
--   การเก็บข้อมูลวิจัย Real-time" — จาก meeting 2026-09-14), pastDecisions: [], pastNotes: []
--   (meeting ก่อนหน้าทั้งสองไม่มีมติ/บันทึก) — นี่คือบริบทสะสมที่ FR-15 ใช้สร้างสรุปก่อนประชุม
--
-- ข้อ 15 (ผู้เข้าร่วมที่มาจาก Group ปนกับ Direct ในมีตติ้งเดียวกัน): 13 แถว จาก 4 meetings
--   "การเงิน": ศิริพร ใจดี (DIRECT), สมชาย ใจดี (GROUP←กลุ่มผู้บริหารคณะ)
--   "ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 1": วิชัย พงษ์สวัสดิ์ (DIRECT),
--   นรินทร์ ชัยเจริญ + ศิริพร ใจดี + สมหญิง รักการงาน (GROUP←ทีมวิจัย AI Lab) — สร้างผ่านเส้นทาง
--   "เพิ่มทั้งกลุ่ม" ของ RPC ที่ migration 20261011090000 (B1) แก้ไว้ ยืนยันว่าใช้ได้บนระบบจริง
--   "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ": ศิริพร ใจดี (DIRECT),
--   นรินทร์ ชัยเจริญ + สมหญิง รักการงาน (GROUP←ทีมวิจัย AI Lab), วิชิต พงษ์สวัสดิ์ (EXTERNAL,
--   ติดมาเพราะ meeting นี้เข้าเงื่อนไข IN แล้ว query แสดงผู้เข้าร่วมทุกคนของ meeting นั้น)
--   "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)": สมชาย ใจดี (DIRECT), กิตติชัย นามดี + วิชัย พงษ์สวัสดิ์
--   (GROUP←ทีมโครงงานนักศึกษา A)
-- =============================================================================
