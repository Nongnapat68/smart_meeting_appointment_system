# AUDIT.md — Smart Meeting Appointment System

การสำรวจโค้ด static ทั้งหมด (18 หน้าจอ, ไฟล์ `code.html` ในแต่ละโฟลเดอร์) เทียบกับ `_2/DESIGN.md`
เป้าหมาย: สรุปหน้าที่ของแต่ละหน้า, UI ที่ยังไม่มี logic จริง, โมเดลข้อมูลที่ต้องมี, และความสัมพันธ์ระหว่างโมเดล
เพื่อใช้เป็นฐานสำหรับการออกแบบสถาปัตยกรรมและ backend ในขั้นถัดไป

---

## 1. รายชื่อหน้าจอทั้งหมดและหน้าที่

| โฟลเดอร์ | หน้าที่ | ต้อง Login? |
|---|---|---|
| `login` | เข้าสู่ระบบด้วยอีเมล/รหัสผ่าน, checkbox จดจำฉัน, ลิงก์ไปลืมรหัสผ่าน | ❌ (public) |
| `forgot_password` | รีเซ็ตรหัสผ่านแบบ 3 ขั้น: กรอกอีเมล → ยืนยัน OTP 6 หลัก → ตั้งรหัสผ่านใหม่ → สำเร็จ | ❌ (public) |
| `logout` | Modal ยืนยันการออกจากระบบ | ✅ |
| `_` (dashboard) | ภาพรวม: stat cards (จำนวนประชุม/งานรอดำเนินการ/แจ้งเตือนใหม่), ตารางประชุมสัปดาห์นี้, activity feed | ✅ |
| `meetings` | รายการประชุมทั้งหมด, ค้นหา/กรองสถานะ+ประเภท, ตาราง, pagination | ✅ |
| `meeting_detail` | รายละเอียดประชุม 1 รายการ: หัวข้อ, เวลา, สถานที่/ลิงก์, สถานะ, ปุ่ม แก้ไข/เลื่อน/ยกเลิก/เข้าร่วม | ✅ |
| `form` | สร้าง/แก้ไขนัดหมาย: รายละเอียดทั่วไป, ประเภท+สถานะ, เวลา+สถานที่, เลือกผู้เข้าร่วม (บุคคล/กลุ่ม/อีเมลภายนอก) | ✅ |
| `ai_ai_summary` | Panel AI สรุปข้อมูลก่อนประชุม (ฝังอยู่ข้าง form สร้างประชุม), มี source links, ปุ่ม refresh, editable textarea | ✅ |
| `people` | รายชื่อผู้ติดต่อทั้งหมด, stat cards (ทั้งหมด/ใช้งาน/ภายนอก), ตาราง+checkbox เลือกหลายรายการ, filter, pagination | ✅ |
| `person_detail` | โปรไฟล์ผู้ติดต่อ: รูป, ตำแหน่ง, ข้อมูลติดต่อ, กลุ่มที่สังกัด, ประวัติการประชุมร่วมกัน | ✅ |
| `contact_groups` | รายการกลุ่มผู้ติดต่อ แบบ card (bento), จำนวนสมาชิก, ปุ่มเพิ่มสมาชิก/แก้ไขกลุ่ม | ✅ |
| `group_detail` | รายละเอียดกลุ่ม: stat (จำนวนสมาชิก/วันที่สร้าง/ประชุมที่ผ่านมา), ตารางสมาชิก+บทบาท(หัวหน้ากลุ่ม/สมาชิก), ลบสมาชิก, ลบกลุ่ม (danger zone) | ✅ |
| `projects` | รายการโปรเจกต์แบบ bento grid, การ์ด featured (progress ring), stat จำนวนประชุม/ผู้เกี่ยวข้อง | ✅ |
| `project_detail` | รายละเอียดโปรเจกต์: progress bar, stat งาน (ทั้งหมด/เสร็จ/รอ/ล่าช้า), timeline ประชุมของโปรเจกต์, งานที่ต้องทำ, ปัญหา/ความเสี่ยง | ✅ |
| `my_action_items` | งานที่ได้รับมอบหมาย: filter tab (ทั้งหมด/ยังไม่เริ่ม/กำลังทำ/เสร็จ), การ์ด "งานเกินกำหนด", AI insight panel + ปุ่ม "สร้างตารางการทำงานอัตโนมัติ", checklist งาน | ✅ |
| `task_detail` | รายละเอียดงาน: คำอธิบาย, comment thread (เพิ่มความเห็น), ข้อมูลสรุป (ผู้รับผิดชอบ/กำหนดส่ง/ความสำคัญ), ประชุมที่เกี่ยวข้อง, ไฟล์แนบ | ✅ |
| `reminders` | จัดการการแจ้งเตือน: stat (ทั้งหมด/รอส่ง/ส่งแล้ว/ไม่สำเร็จ), ตาราง reminder ต่อ meeting, ปุ่มลองใหม่/ดูสาเหตุ/ยกเลิก/ดูรายละเอียด | ✅ |
| `settings` | โปรไฟล์ผู้ใช้ (แก้ไขข้อมูล+รูป), เปลี่ยนรหัสผ่าน, toggle การแจ้งเตือน (email/in-app), ปุ่มออกจากระบบ/บันทึก | ✅ |

Sidebar/topbar ซ้ำกันแทบทุกหน้า (นำทาง, ปุ่ม "นัดหมายใหม่", ค้นหา, notification bell, avatar) — ควรแยกเป็น shared layout component เดียว

---

## 2. UI ที่เป็นแค่ mockup (ไม่มี logic จริง) เทียบกับพฤติกรรมที่ควรทำงานได้จริง

ทุกหน้าเป็น static HTML — ปุ่มเกือบทั้งหมดใช้ `onclick="window.location.href=...'"` เพื่อสลับหน้าเฉยๆ, ข้อมูลทั้งหมด hardcode ในมาร์กอัป, ไม่มีการเรียก API ใดๆ ยกเว้น `forgot_password/code.html` ที่มี client-side JS จำลอง flow (setTimeout countdown, accept OTP ใดๆ 6 หลัก, validate password pattern ด้วย regex) แต่ไม่มีการเรียก backend จริง

รายละเอียดจุดที่ต้องแปลงเป็นของจริง แยกตามหน้า:

- **login**: form submit ไป `_/code.html` ตรงๆ (ไม่ตรวจ credential) → ต้องเรียก `/api/auth/login`, ตั้ง session/JWT, แสดง error เมื่อ credential ผิด, "จดจำการเข้าสู่ระบบ" ต้องมีผลจริงต่ออายุ session/refresh token
- **forgot_password**: OTP ใดๆ ก็ผ่าน, ไม่ได้ส่งอีเมลจริง, ไม่เชื่อมกับ user จริง → ต้องเรียก `/api/auth/forgot-password` (ส่ง OTP จริงไปอีเมล), `/api/auth/verify-otp`, `/api/auth/reset-password`, มี expiry/rate-limit ของ OTP จริง
- **logout**: ปุ่ม "ออกจากระบบ" แค่ redirect ไป login → ต้องเรียก `/api/auth/logout` เพื่อ invalidate session/token จริง
- **dashboard (`_`)**: ตัวเลข stat, รายการประชุมสัปดาห์นี้, activity feed ทั้งหมด hardcode → ต้องดึงจาก aggregate query จริงตาม user ที่ login, real-time หรืออย่างน้อย fetch ทุกครั้งที่โหลดหน้า
- **meetings**: ตาราง 4 แถวคงที่, search/filter (สถานะ, ประเภท) เป็นแค่ `<select>` ที่ไม่ผูก logic, pagination เป็นปุ่มเปล่า → ต้อง query จริงพร้อม filter/pagination ฝั่ง server, ปุ่ม "more_vert" ต้องมีเมนู edit/cancel/duplicate จริง
- **meeting_detail**: ข้อมูลทั้งหมด hardcode, ปุ่มแก้ไข/เลื่อน/ยกเลิก/เข้าร่วม ไม่มีการ action จริง (เลื่อน/ยกเลิกไม่มี onclick เลย) → ต้องดึงข้อมูล meeting ตาม id จริง, ปุ่ม "เลื่อนเวลา"/"ยกเลิก" ต้องเปิด modal + เรียก API update, ปุ่ม "เข้าร่วม" ต้องลิงก์ไปยัง location/video link จริงของ meeting นั้น
- **form (create/edit meeting)**: ทุก field ไม่ผูกกับ state, "บันทึกการนัดหมาย" redirect ตรงไป meeting_detail โดยไม่ส่งข้อมูลอะไรเลย, participant search/add/remove เป็น mockup, participant tab switch (บุคคล/กลุ่ม/อีเมลภายนอก) เป็นแค่ CSS class toggle → ต้อง validate + POST ข้อมูลจริงไป `/api/meetings`, participant picker ต้อง autocomplete จาก People/Groups จริง + รองรับอีเมลภายนอกที่ไม่มีในระบบ, แก้ไขนัดหมายต้อง prefill ข้อมูลเดิม (PUT ไม่ใช่ POST เสมอ)
- **ai_ai_summary**: เนื้อหาสรุป hardcode เป็นข้อความไทยคงที่, ปุ่ม refresh ไม่มี onclick, source links เป็น `href="#"` → ต้องเรียก Claude API จริงโดยส่ง context (meeting + agenda + ประวัติที่เกี่ยวข้อง), ปุ่ม refresh ต้อง regenerate, source links ต้องลิงก์ไปยัง note/task จริงที่ AI อ้างอิง, ต้องมี loading state ระหว่างเรียก AI
- **people**: ตาราง 3 แถวคงที่ (อ้างว่ามี 1,248 รายการ), checkbox เลือกหลายแถวไม่มี bulk action ต่อท้าย, ปุ่ม "เพิ่มผู้ติดต่อ"/"ตัวกรอง" ไม่มี onclick → ต้อง CRUD จริง, เพิ่มผู้ติดต่อต้องเปิดฟอร์ม/modal, filter ต้อง query จริง, bulk actions (ลบ/เพิ่มเข้ากลุ่ม) สำหรับ checkbox ที่เลือก
- **person_detail**: ข้อมูล hardcode ทั้งหมด, ปุ่ม "นัดประชุม"/"ส่งข้อความ" — นัดประชุมลิงก์ไปหน้า form เฉยๆไม่ prefill ผู้เข้าร่วม, "ส่งข้อความ" ไม่มี logic เลย → ต้องดึง person จริงตาม id, ปุ่มนัดประชุมต้อง prefill participant, "ส่งข้อความ" ต้องตัดออกหรือเชื่อม notification/email จริง
- **contact_groups**: การ์ด 3 กลุ่มคงที่, ปุ่ม "สร้างกลุ่มใหม่"/"เพิ่มสมาชิก"/"แก้ไขกลุ่ม"/"more_vert" ไม่มี onclick จริง (แค่ card คลิกไป group_detail) → ต้อง CRUD กลุ่มจริง พร้อม modal สร้าง/แก้ไข, เพิ่ม/ลบสมาชิกจริง
- **group_detail**: สมาชิก 2 แถวคงที่ (อ้างว่ามี 12), ปุ่มลบสมาชิกไม่มี logic (แค่ `event.stopPropagation()`), ปุ่ม "ลบกลุ่ม" กด redirect ตรงไป contact_groups โดยไม่ยืนยัน/ไม่ลบจริง, pagination ปุ่มเปล่า → ต้อง fetch สมาชิกจริง, ลบสมาชิกต้องมี confirm + DELETE API, ลบกลุ่มต้องมี confirm modal + DELETE API จริง (cascade หรือ block ถ้ามี meeting ผูกอยู่)
- **projects**: การ์ด 4 โปรเจกต์คงที่, ปุ่ม "สร้างโปรเจกต์" ไม่มี onclick, progress ring/สถิติ hardcode → ต้อง CRUD โปรเจกต์จริง, progress ต้องคำนวณจาก task จริง (completed/total)
- **project_detail**: ทุกอย่าง hardcode รวม progress bar 65%, timeline ประชุม, task, risk → ต้องดึงข้อมูลจริงตาม project id, task checkbox ต้อง toggle สถานะจริง, "ดูรายละเอียดและวิธีแก้ไข" (risk) ไม่มี target จริง — ต้องตัดสินใจว่าจะมี Risk entity หรือไม่ (ไม่อยู่ใน scope หลัก อาจเก็บเป็น field ธรรมดาใน MVP)
- **my_action_items**: filter tab (ทั้งหมด/ยังไม่เริ่ม/กำลังทำ/เสร็จ) ไม่มี onclick, checkbox "mark complete" เป็นแค่ CSS peer-checked ไม่มีการบันทึกสถานะจริง, ปุ่ม "สร้างตารางการทำงานอัตโนมัติ" ไม่มี onclick เลย → ต้อง query ตาม filter จริง, checkbox ต้องเรียก PATCH อัปเดตสถานะ task, ปุ่ม AI schedule ต้องเรียก Claude API เพื่อจัดลำดับ/แนะนำ due date จาก task list จริงของ user
- **task_detail**: ข้อมูลงาน, comment, ไฟล์แนบทั้งหมด hardcode, ปุ่ม "แก้ไขงาน"/"บันทึกเสร็จสิ้น" ไม่มี logic จริงต่อ backend (ปุ่มหลัง redirect เฉยๆ), ปุ่ม "ส่งข้อความ" (comment) ไม่มี onclick, ปุ่ม attach_file ไม่มี logic → ต้องดึง task จริง, mark complete ต้อง PATCH สถานะจริง, comment ต้อง POST ไปสร้าง record จริงพร้อมแสดงผลทันที (optimistic หรือ refetch), ไฟล์แนบต้องอัปโหลดจริง (multipart) และเก็บ metadata ในฐานข้อมูล + ไฟล์ storage
- **reminders**: stat และตาราง 4 แถวคงที่, ปุ่ม "ลองใหม่"/"สาเหตุ"/"ยกเลิกการแจ้งเตือน"/"ดูรายละเอียด" ไม่มี onclick จริงเลย, "รีเฟรช" ไม่มี logic → ต้อง query reminder จริงตาม meeting/participant, "ลองใหม่" ต้อง trigger ส่งซ้ำจริง (mock email/notification service), เก็บ failure reason จริงเวลา retry ไม่สำเร็จ
- **settings**: ทุก input มีค่า hardcode (`value="..."`), ปุ่ม "เปลี่ยนรูปโปรไฟล์"/"บันทึกการเปลี่ยนแปลง" ไม่มี logic จริง (ปุ่มบันทึก redirect ไป dashboard เฉยๆ), toggle notification ไม่มี state persist → ต้องดึงข้อมูล user ปัจจุบันจริง, บันทึกโปรไฟล์ผ่าน PATCH `/api/users/me`, อัปโหลดรูปจริง, เปลี่ยนรหัสผ่านต้อง verify current password ก่อน, toggle ต้อง persist ต่อ user

**สรุปภาพรวม**: ทุกฟีเจอร์ CRUD ทั้ง 7 โมดูล (Meetings, People, Groups, Projects, Tasks, Reminders, Settings) เป็น UI เปล่าล้วนๆ — ไม่มี state management, ไม่มี fetch ใดๆ ในทุกหน้า (ยกเว้น DOM manipulation ล้วนๆ ใน `forgot_password` และ tab-switch ใน `form`/`meetings`) ต้องสร้างใหม่ทั้งหมด

---

## 3. โมเดลข้อมูล (Entities) ที่ต้องมี

อนุมานจากข้อมูลตัวอย่างที่ปรากฏในทุกหน้า:

### User
- id, email, password_hash, name, avatar_url, phone, title (ตำแหน่ง), department (แผนก), role (admin/user), created_at
- (settings: ชื่อ-นามสกุล, อีเมล, เบอร์โทร, ตำแหน่ง, แผนก, รูปโปรไฟล์)
- notification preferences: email_notifications (bool), in_app_notifications (bool)

### PasswordResetToken (สำหรับ forgot password OTP)
- id, user_id/email, otp_code (hashed), expires_at, used_at

### Meeting
- id, title, description/agenda, type (single/project-linked — "ครั้งเดียว"/"โครงการ"), status (pending/active/completed/cancelled/postponed), start_time, end_time, location (ห้องประชุม หรือ ลิงก์ Zoom/Meet), organizer_id (User), project_id (nullable FK → Project), created_at, updated_at
- ความสัมพันธ์: participants (many-to-many กับ Person ผ่าน MeetingParticipant, เก็บ role: organizer/attendee, response status: accepted/pending)

### MeetingParticipant (join table)
- meeting_id, person_id, role, rsvp_status

### Person / Contact
- id, name, email, phone, avatar_url, title (ตำแหน่ง), department, type (internal user ที่ผูกกับ User record / external contact ไม่มี login), status (active/inactive), user_id (nullable — ถ้าเป็น internal user ที่มี login)

### ContactGroup
- id, name, description, icon/color (ตามการ์ดที่มี icon ต่างกัน work/gavel/campaign), created_at, created_by

### ContactGroupMember (join table, many-to-many Person ↔ ContactGroup)
- group_id, person_id, role_in_group (หัวหน้ากลุ่ม/สมาชิก), joined_at

### Project
- id, name, description, status (active/pending/delayed/completed), start_date, end_date, manager_id (Person/User), progress_percent (คำนวณจาก task หรือเก็บ manual)

### ProjectMember (join table many-to-many Project ↔ Person)

### Task / ActionItem
- id, title, description, status (not_started/in_progress/completed, มี overdue คำนวณจาก due_date), priority (low/medium/high), assignee_id (Person/User), due_date, project_id (nullable FK), meeting_id (nullable FK — งานที่เกิดจากการประชุมไหน), created_at, completed_at

### TaskComment
- id, task_id, author_id, content, created_at

### TaskAttachment
- id, task_id, file_name, file_url, file_size, mime_type, uploaded_by, uploaded_at

### Reminder
- id, meeting_id, recipient scope (all participants หรือ per-person), scheduled_at, status (pending/sent/failed/cancelled), failure_reason (nullable), sent_at, retry_count

### Notification (in-app)
- id, user_id, type (meeting_invite/task_assigned/ai_summary_ready/reminder ฯลฯ), title, body, is_read, related_entity (meeting_id/task_id nullable), created_at

### AISummary
- id, meeting_id, content (markdown/text), sources (JSON: อ้างอิงถึง notes/tasks ที่เกี่ยวข้อง), generated_at, generated_by (AI model version), is_edited (ถ้า user แก้ไขเนื้อหาที่ AI สร้าง)

---

## 4. ความสัมพันธ์ระหว่าง Entity (สรุป ER)

```
User 1---N Meeting (organizer)
User 1---1 Person (internal user เชื่อมกับ record ผู้ติดต่อของตัวเอง, nullable)
Person N---N Meeting (ผ่าน MeetingParticipant)
Person N---N ContactGroup (ผ่าน ContactGroupMember)
Person N---N Project (ผ่าน ProjectMember, รวม manager)
Project 1---N Meeting (โปรเจกต์มีได้หลายประชุม, meeting.project_id nullable)
Project 1---N Task
Meeting 1---N Task (งานที่เกิดจากการประชุมนั้น, task.meeting_id nullable)
Meeting 1---1 AISummary (ต่อการประชุม, nullable จนกว่าจะ generate)
Meeting 1---N Reminder
Task 1---N TaskComment
Task 1---N TaskAttachment
Task N---1 Person (assignee)
User 1---N Notification
Group ลบไม่ได้ถ้ายังมี Meeting ผูกอยู่ (business rule ที่ต้องตัดสินใจ) — DESIGN.md ระบุ danger zone แต่ไม่ได้ระบุ cascade behavior ชัดเจน
```

**หมายเหตุสำคัญ**: Person กับ User เป็นคนละ entity — User คือคนที่ login เข้าระบบได้ (บุคลากรของคณะเทคโนโลยีสารสนเทศและการสื่อสาร เช่น อาจารย์/เจ้าหน้าที่), Person คือ "ผู้ติดต่อ" ที่อาจเป็น internal (ผูกกับ User) หรือ external (ไม่มี login, ผูกด้วยอีเมลอย่างเดียว) ตามที่เห็นในหน้า `people` ที่แยกคอลัมน์ "ผู้ใช้งานในระบบ" vs "บุคคลภายนอก"

---

## 5. Design System ที่ต้องรักษาไว้ (จาก `_2/DESIGN.md`)

- ฟอนต์: Manrope (headline/display), Be Vietnam Pro (body, รองรับไทย), Inter (label)
- สี: primary indigo `#3525cd`, secondary green (active/success), tertiary amber (pending), error red (cancelled/failed)
- Border radius: default 8px, lg 12px (card), full (pill สำหรับ badge)
- Layout: sidebar 260px คงที่, container margin 24px, ระบบ 12-column grid, "Bento grid" style สำหรับ dashboard/projects/groups
- Elevation: ambient shadow (blur 15px, opacity 5%, offset-y 4px) สำหรับ card, เงาเข้มขึ้นสำหรับ modal/dropdown
- ทุก icon ใช้ Material Symbols Outlined (Google Fonts CDN) — คงไว้เหมือนเดิม ไม่เปลี่ยนไป icon library อื่น
- Component ที่ต้องรักษา class/สไตล์เดิมเป๊ะเมื่อแปลงเป็น component จริง: status badge (active=เขียว, pending=เหลือง, failed/cancelled=แดง), sidebar nav item active state (bg indigo อ่อน + ตัวอักษร indigo เข้ม), data table (หัวตารางเทาอ่อนตัวหนา, เส้นคั่นแถวบาง)

**ข้อสังเกต**: sidebar ในแต่ละหน้าไม่ตรงกันเป๊ะ (บางหน้าใช้ "corporate_fare" icon, บางหน้าใช้ "meeting_room", บางหน้าใช้ initials "SM", ปุ่ม AI บางที่ใช้ icon "sparkles" (แสดงผลจริงเป็น arrow_back_ios_new เพราะพิมพ์ผิดใน Stitch), บาง sidebar เป็นภาษาอังกฤษ (person_detail ใช้ "Home/People/Groups" แทนที่จะเป็นภาษาไทย) — ต้อง normalize เป็น shared layout เดียวตอนสร้างจริง และแก้ icon "sparkles" ให้ถูกต้อง (ควรเป็น `auto_awesome` ตามที่ใช้ใน ai_ai_summary content จริง ไม่ใช่ `arrow_back_ios_new`)

---

## สรุป

ระบบทั้งหมดเป็น **UI prototype 100%** — ไม่มี backend, ไม่มี state, ไม่มี API call ใดๆ ปุ่มทุกปุ่มอย่างมากที่สุดคือ `window.location.href` ไปหน้าอื่น หรือ toggle CSS class ล้วนๆ
มี 13 entity หลักที่ต้องออกแบบ schema, 18 หน้าจอที่ต้องเชื่อม CRUD API ครบทุกฟีเจอร์ และ 2 จุดที่ต้องเชื่อม Claude API จริง (AI pre-meeting summary, AI auto-scheduling ของ action items)
