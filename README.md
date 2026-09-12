# Smart Meeting Appointment System

ระบบจัดการนัดหมาย/การประชุม (รวมถึงการประชุมที่ต่อเนื่องภายใต้โครงการ) สำหรับสาขาวิชาวิศวกรรมซอฟต์แวร์
คณะเทคโนโลยีสารสนเทศและการสื่อสาร — เน้นการออกแบบและจัดการข้อมูลของกระบวนการประชุมที่มีความต่อเนื่อง
(People → Groups → Projects → Meetings → Participants → Reminders → Notes → Decisions → Action Items →
Meeting ครั้งถัดไป) ไม่ใช่แค่ระบบส่งอีเมลนัดประชุม — ดูรายละเอียดทั้งหมดที่ [`requirements/requirements.md.md`](requirements/requirements.md.md)

**Tech stack**: [Next.js 16](https://nextjs.org/) (App Router) + React 19 + TypeScript ·
[Prisma ORM 6](https://www.prisma.io/) · [Supabase](https://supabase.com/) Postgres + Auth + Row Level Security ·
Tailwind CSS 4 · [Anthropic API](https://docs.anthropic.com/) (Claude) สำหรับฟีเจอร์ AI · Zod (validation)

---

## ฟีเจอร์หลัก

- **บุคคล/กลุ่มผู้ติดต่อ** — จัดการทั้งผู้ใช้งานในระบบและบุคคลภายนอกที่ไม่มีบัญชี, จัดกลุ่มเพื่อเลือกผู้เข้าร่วมประชุมได้รวดเร็ว
- **นัดหมาย/การประชุม** — ทั้งแบบครั้งเดียว (One-shot) และแบบต่อเนื่องภายใต้โครงการ (Project-based), เลือกผู้เข้าร่วมได้ทั้งทีละคน/ทั้งกลุ่ม/อีเมลภายนอก
- **ลิงก์ประชุมออนไลน์แบบใช้ซ้ำได้** — บันทึกลิงก์ (Teams/Zoom/Google Meet ฯลฯ) ไว้ใช้กับหลายนัดหมาย แก้ไข URL ที่จุดเดียวมีผลกับทุกนัดหมายที่อ้างอิง
- **คำเชิญ** — สร้างไฟล์ `.ics` มาตรฐาน (RFC 5545) และส่งอีเมลเชิญพร้อมไฟล์แนบให้ผู้เข้าร่วมทุกคน
- **การแจ้งเตือนก่อนประชุม** — ตั้งได้หลายรายการต่อ 1 นัดหมาย (เช่น 7 วัน/2 วัน/1 วัน/1 ชั่วโมงก่อน) พร้อมกันการส่งซ้ำ
- **Meeting Notes / Decisions / Related Resources** — บันทึกสรุปการประชุม มติ และเอกสารประกอบ หลายรายการต่อ 1 นัดหมาย เรียกดูย้อนหลังได้
- **Action Items** — งานที่เกิดจากการประชุม ติดตามสถานะเสร็จ/ค้างได้ พร้อมความเห็นและไฟล์แนบ
- **AI ช่วยเตรียมประชุม** (เฉพาะการประชุมที่ผูกโปรเจกต์) — สรุปก่อนประชุมจากบริบทเดิม, วิเคราะห์ประเด็นค้าง, แนะนำ agenda จากหัวข้อใหม่

ดูสถานะความครบถ้วนเทียบกับ requirements แบบละเอียดทุกข้อที่ [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md)

---

## ติดตั้ง/รัน

```bash
git clone https://github.com/Nongnapat68/smart_meeting_appointment_system.git
cd smart_meeting_appointment_system
npm install
```

### 1. ตั้งค่า environment variables

คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าจริง:

```bash
cp .env.example .env
```

| ตัวแปร | มาจากไหน |
|---|---|
| `DATABASE_URL` | Supabase Dashboard → Project Settings → Database → Connection string → **Transaction pooler** (port 6543) — ใช้ตอนรันแอปจริง |
| `DIRECT_URL` | เหมือนกันแต่เลือก **Direct connection** (port 5432) — ใช้เฉพาะตอนรัน `prisma migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → **Project URL** *(ใหม่ — สำหรับ Supabase Auth)* |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Project Settings → API → **Publishable key** (เดิมเรียก `anon` key) — ปลอดภัยที่จะ expose ให้ browser *(ใหม่)* |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Project Settings → API → **Secret key** — สิทธิ์เต็ม ใช้ฝั่ง server เท่านั้น **ห้าม** ใส่ prefix `NEXT_PUBLIC_` เด็ดขาด *(ใหม่)* |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) — จำเป็นสำหรับฟีเจอร์ AI (สรุปก่อนประชุม/วิเคราะห์ประเด็นค้าง/แนะนำ agenda) เท่านั้น ส่วนอื่นของระบบใช้งานได้ปกติแม้ไม่ตั้งค่า |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | ไม่บังคับสำหรับ dev — ถ้าไม่ตั้งค่า อีเมล OTP/คำเชิญ/แจ้งเตือนจะ log ออกทาง server console แทนการส่งจริง (ดู `src/lib/email.ts`) |

### 2. Generate Prisma Client

```bash
npx prisma generate
```

`npm install` มี postinstall hook ของ `@prisma/client` ที่ควร generate ให้อัตโนมัติอยู่แล้ว แต่ทดสอบจริงพบว่าบางครั้ง
client ที่ postinstall สร้างไว้ยัง initialize ไม่สมบูรณ์ (รันแล้วเจอ `@prisma/client did not initialize yet`) — รันคำสั่งนี้ตรงๆ
อีกรอบเพื่อความชัวร์ก่อนไปขั้นต่อไปเสมอ

### 3. สร้างฐานข้อมูล

```bash
npx prisma migrate deploy
```

ใช้ `migrate deploy` (ไม่ใช่ `prisma migrate dev`) เสมอ เพราะ migration history ของโปรเจกต์นี้มีบาง migration ที่ถูก apply
ด้วยมือจริงกับฐานข้อมูล production (ผ่าน `prisma db execute` แล้ว `prisma migrate resolve --applied` — ดู comment ในไฟล์
`prisma/migrations/*/migration.sql` แต่ละไฟล์) ซึ่งต้องอาศัย schema `auth` ที่ Supabase Auth สร้างไว้ให้อยู่แล้วในทุกโปรเจกต์จริง —
`migrate dev` จะพยายามสร้าง shadow database ที่ไม่มี schema `auth` นี้มาเทียบ diff แล้วพัง ส่วน `migrate deploy` แค่ไล่ apply
ทุก migration ที่ยังไม่เคยรันตามลำดับไฟล์ตรงๆ กับฐานข้อมูลจริง (ปลอดภัยสำหรับฐานข้อมูล Supabase โปรเจกต์ใหม่ที่ว่างเปล่า)

### 4. ใส่ข้อมูลตัวอย่าง

```bash
npm run db:seed
```

สร้างผู้ใช้ตัวอย่าง 5 คนใน Supabase Auth จริง + ข้อมูลผู้ติดต่อ/กลุ่ม/โปรเจกต์/นัดหมาย/งาน ตัวอย่าง (รันซ้ำได้ปลอดภัย — ลบข้อมูล
ตัวอย่างเดิมแล้วสร้างใหม่ทุกครั้ง ไม่กระทบข้อมูลจริงอื่นที่ไม่ใช่ 5 บัญชีนี้)

### 5. รัน

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) แล้ว login ด้วยบัญชีทดสอบด้านล่าง

---

## บัญชีทดสอบ (หลัง `npm run db:seed`)

รหัสผ่านเดียวกันทุกบัญชี: **`Passw0rd!`**

| อีเมล | ชื่อ | Role | ตำแหน่ง |
|---|---|---|---|
| `somchai@smartmeeting.dev` | สมชาย ใจดี | **ADMIN** | หัวหน้าสาขาวิชาวิศวกรรมซอฟต์แวร์ |
| `siriporn@smartmeeting.dev` | ศิริพร ใจดี | MEMBER | รองคณบดีฝ่ายวิจัย |
| `wichai@smartmeeting.dev` | วิชัย พงษ์สวัสดิ์ | MEMBER | อาจารย์ประจำสาขาวิชา |
| `narin@smartmeeting.dev` | นรินทร์ ชัยเจริญ | MEMBER | ผู้ช่วยวิจัย (Research Assistant) |
| `kittichai@smartmeeting.dev` | กิตติชัย นามดี | MEMBER | เจ้าหน้าที่สนับสนุนระบบสารสนเทศ |

---

## สถาปัตยกรรม (สรุปสั้น)

- **Auth**: ใช้ [Supabase Auth](https://supabase.com/docs/guides/auth) ทั้งหมด — ไม่มีระบบ JWT/bcrypt เขียนเอง `User.id`
  ในฐานข้อมูลคือ uuid เดียวกับ `auth.users.id` (FK ข้าม schema, `ON DELETE CASCADE`)
- **Row Level Security**: เปิดครบทั้ง 20 ตารางจริงในระบบ (72 policy) เป็นชั้นป้องกันเพิ่มที่ระดับ database — application layer
  (`assertOwner()` ในทุก route ที่ยังเป็น Prisma) ยังคงเป็นชั้นตรวจสอบสิทธิ์หลักสำหรับ route ที่ยังไม่ย้าย
- **Hybrid migration**: บาง resource (Meetings/People/Groups/Projects/Tasks/Reminders/OnlineMeetingResource/Meeting
  Notes-Decisions-Resources) ย้ายจาก Next.js API + Prisma ไปเรียก Supabase ตรงผ่าน `supabase-js`/PostgREST จาก
  browser แล้ว — RLS (ไม่ใช่ `assertOwner()`) เป็นชั้นตรวจสอบสิทธิ์หลักของจุดที่ย้ายแล้ว route/API เดิมบางเส้นทางยังอยู่ในโค้ด
  (ไม่ได้ลบ) แต่ไม่มี frontend เรียกแล้ว — ดูรายละเอียดที่ `docs/DESIGN_DECISIONS.md`
- **Database objects เพิ่มเติม**: 2 Views (`upcoming_meetings`, `overdue_action_items`), 5 Functions
  (`process_due_reminders()`, `get_meeting_context()`, `create_meeting_with_participants()`,
  `update_project_with_members()`, `update_meeting_with_participants()` — สามตัวหลังเป็น RPC เขียนข้อมูลแบบ atomic
  สำหรับ hybrid migration ไม่ใช่แค่ query อ่านอย่างเดียวแบบสองตัวแรก), 1 Trigger (`trg_cancel_meeting_reminders`)

ดูเหตุผลการออกแบบแต่ละจุดแบบละเอียด (ทางเลือกที่พิจารณา/ตัดสินใจ/เหตุผล) ที่ [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)

---

## เอกสารเพิ่มเติม

| ไฟล์ | เนื้อหา |
|---|---|
| [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) | เทียบระบบปัจจุบันกับ requirements ทุกข้อ (FR/BR) พร้อมหลักฐาน |
| [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md) | เหตุผลการออกแบบ schema/ระบบในแต่ละจุด |
| [`docs/deliverables/ER_DIAGRAM.md`](docs/deliverables/ER_DIAGRAM.md) | ER diagram ของฐานข้อมูล |
| [`docs/deliverables/DATA_DICTIONARY.md`](docs/deliverables/DATA_DICTIONARY.md) | รายละเอียดทุกตาราง/คอลัมน์/enum/View/Function/Trigger |
| [`docs/deliverables/schema.sql`](docs/deliverables/schema.sql) | DDL เต็มของฐานข้อมูล (ตาราง/enum/RLS/View/Function/Trigger) |
| [`docs/deliverables/QUERIES.sql`](docs/deliverables/QUERIES.sql) | SQL query ตัวอย่างที่แสดงความสามารถของระบบ |
