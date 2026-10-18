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
- **คำเชิญ** — สร้างไฟล์ `.ics` มาตรฐาน (RFC 5545) ดาวน์โหลดได้จากหน้ารายละเอียดประชุม และเตรียมอีเมลเชิญพร้อมไฟล์แนบให้ผู้เข้าร่วมทุกคน (ปัจจุบันการส่งอีเมลเป็น stub — ดู "ข้อจำกัดที่ยังอยู่")
- **การแจ้งเตือนก่อนประชุม** — ตั้งได้หลายรายการต่อ 1 นัดหมาย (เช่น 7 วัน/2 วัน/1 วัน/1 ชั่วโมงก่อน) พร้อมกันการส่งซ้ำ
- **Meeting Notes / Decisions / Related Resources** — บันทึกสรุปการประชุม มติ และเอกสารประกอบ หลายรายการต่อ 1 นัดหมาย เรียกดูย้อนหลังได้
- **Action Items** — งานที่เกิดจากการประชุม ติดตามสถานะเสร็จ/ค้างได้ พร้อมความเห็นและไฟล์แนบ
- **AI ช่วยเตรียมประชุม** (เฉพาะการประชุมที่ผูกโปรเจกต์) — สรุปก่อนประชุมจากบริบทเดิม, วิเคราะห์ประเด็นค้าง, แนะนำ agenda จากหัวข้อใหม่ (ถ้าไม่ตั้ง `ANTHROPIC_API_KEY` จะใช้โหมดเทมเพลตที่ประกอบข้อความจากข้อมูลจริงในระบบ ไม่ได้เรียก AI)

ดูสถานะความครบถ้วนเทียบกับ requirements แบบละเอียดทุกข้อที่ [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md)

---

## ติดตั้ง/รัน

```bash
git clone https://github.com/Nongnapat68/smart_meeting_appointment_system.git
cd smart_meeting_appointment_system
npm ci                 # ติดตั้งตาม package-lock.json ทุกตัว (npm install ก็ได้ แต่อาจแก้ package-lock.json)
npx prisma generate    # npm ci เรียกให้อัตโนมัติแล้ว (postinstall) — รันซ้ำได้ถ้าเจอ "@prisma/client did not initialize yet"
```

### 1. ตั้งค่า environment variables

คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าจริง:

```bash
cp .env.example .env
```

| ตัวแปร | มาจากไหน |
|---|---|
| `DATABASE_URL` | Supabase Dashboard → ปุ่ม **Connect** (เดิม Project Settings → Database → Connection string) → **Transaction pooler** (port 6543) — ใช้ตอนรันแอปจริง |
| `DIRECT_URL` | เหมือนกันแต่เลือก **Direct connection** หรือ **Session pooler** (port 5432) — ใช้เฉพาะตอนรัน `prisma migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → **Project URL** *(ใหม่ — สำหรับ Supabase Auth)* |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Project Settings → API → **Publishable key** (เดิมเรียก `anon` key) — ปลอดภัยที่จะ expose ให้ browser *(ใหม่)* |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Project Settings → API → **Secret key** — สิทธิ์เต็ม ใช้ฝั่ง server เท่านั้น **ห้าม** ใส่ prefix `NEXT_PUBLIC_` เด็ดขาด *(ใหม่)* |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) — ไม่บังคับ: ถ้าไม่ตั้ง ฟีเจอร์ AI ของการประชุม (สรุปก่อนประชุม/วิเคราะห์ประเด็นค้าง/แนะนำ agenda) ใช้โหมดเทมเพลตแทน ยกเว้นปุ่มจัดลำดับงานด้วย AI ในหน้า `/tasks` ที่ต้องมีคีย์ ส่วนอื่นของระบบใช้งานได้ปกติ |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | ไม่ต้องตั้ง — `sendEmail()` (`src/lib/email.ts`) ยังเป็น stub: ทุกอีเมล (OTP/คำเชิญ/แจ้งเตือน) ถูก log ออกทาง server console เสมอ แม้ตั้ง `SMTP_HOST` ก็ไม่ส่งจริง (โค้ดอ่านแค่ `SMTP_HOST`; อีกสี่ตัวเตรียมไว้สำหรับ transport จริงในอนาคต) |
| `REMINDER_AUTO_PROCESS` / `REMINDER_AUTO_PROCESS_INTERVAL_SECONDS` | ไม่บังคับ — **ค่าเริ่มต้นเปิด** (`0` = ปิด) ดูหัวข้อ "ประมวลผลการแจ้งเตือนอัตโนมัติ" ด้านล่าง |

#### ประมวลผลการแจ้งเตือนอัตโนมัติ (เปิดเป็นค่าเริ่มต้น)

เมื่อรัน `npm run dev` / `npm start` เซิร์ฟเวอร์ Node จะเริ่มตัวประมวลผลการแจ้งเตือนเองหนึ่งตัวต่อโปรเซส (`src/instrumentation.ts` → `src/lib/reminder-auto-processor.ts`) และพิมพ์หนึ่งบรรทัดใน console ว่า
`[reminders:auto] enabled — checking due reminders every 60s (REMINDER_AUTO_PROCESS=0 turns it off)`
ทุกช่วงเวลาจะเรียก `processDueReminders()` ชุดเดียวกับปุ่ม "ประมวลผล reminder ที่ถึงเวลา" บนหน้า `/reminders`: ส่งอีเมล (ปัจจุบันเป็นโหมดจำลอง) และเปลี่ยนสถานะเป็น `SIMULATED`/`SENT`/`FAILED` ซึ่งทำให้ฐานข้อมูลสร้างการแจ้งเตือนในกระดิ่งชนิด `REMINDER` ให้ผู้จัดและผู้เข้าร่วมที่มีบัญชี

```bash
REMINDER_AUTO_PROCESS="0"                    # ปิด (ค่าอื่นหรือไม่ตั้ง = เปิด)
REMINDER_AUTO_PROCESS_INTERVAL_SECONDS="60"  # ตรวจทุกกี่วินาที (ค่าเริ่มต้น 60, ต่ำสุด 15)
```

ตัวประมวลผลไม่เริ่มเองเมื่อ: `REMINDER_AUTO_PROCESS=0`, ระหว่าง `next build`, `NODE_ENV=test`, ไม่มี `DATABASE_URL`, หรือ edge runtime (`src/lib/reminder-auto-config.ts`) — `npm run test:authz` เปิดเซิร์ฟเวอร์ทดสอบพร้อม `REMINDER_AUTO_PROCESS=0` ให้เอง

ข้อจำกัดและคำเตือน:
- รันสองเซิร์ฟเวอร์บนฐานข้อมูลเดียวกันได้: แต่ละการเตือนถูก "จอง" ด้วย row lock (`FOR UPDATE SKIP LOCKED`) ก่อนส่ง และการแจ้งเตือนในกระดิ่งมีคีย์กันซ้ำ จึงไม่ส่งซ้ำและไม่ขึ้นซ้ำ
- ทำงานได้เฉพาะเซิร์ฟเวอร์ที่รันค้างตลอด — บน serverless (เช่น Vercel) ให้ตั้ง `REMINDER_AUTO_PROCESS=0` แล้วให้ผู้ดูแลระบบกดปุ่มประมวลผลในหน้า `/reminders` แทน (ดูหัวข้อ "การ deploy และข้อจำกัดที่ทราบ") ถ้าจะใช้ cron ภายนอก ต้องเพิ่ม route ที่ป้องกันด้วย secret ก่อน เพราะ `POST /api/reminders/process-due` ต้องล็อกอินเป็นแอดมิน (ยังไม่มีในระบบ)
- **การแจ้งเตือนทุกรายการในฐานข้อมูลที่เชื่อมอยู่จะถูกประมวลผลเมื่อถึงเวลา รวมถึงของประชุมตัวอย่าง ("ตัวอย่าง: ประชุมติดตามความคืบหน้าโครงการทุนวิจัย AI Lab ครั้งที่ 1/2")** และรายการที่ค้าง `PENDING` ของประชุมที่จบไปแล้วจะถูกเปลี่ยนเป็น `CANCELLED` ในรอบแรก (เหมือนการกดปุ่ม)

#### การแจ้งเตือนในระบบ (กระดิ่ง)

ทุกเหตุการณ์ที่ระบบ "แจ้งใครสักคน" มีรายการในกระดิ่งและหน้า `/notifications` สำหรับผู้ที่มีบัญชี: ได้รับคำเชิญ, ถูกนำออกจากประชุม, เลื่อนประชุม (เวลาเดิม → ใหม่), แก้ชื่อ/สถานที่/ลิงก์ประชุมออนไลน์, ยกเลิกประชุม, การเตือนก่อนประชุม (ทุกสถานะ), ได้รับมอบหมายงาน/งานถูกโอน, สถานะงานเปลี่ยน, ความเห็นใหม่ในงาน, บันทึกการประชุม/มติใหม่ และสรุปประชุมโดย AI
- แถวการแจ้งเตือนเขียนโดย trigger ในฐานข้อมูล (`prisma/migrations/20261012090000_in_app_notifications_for_all_events`) จึงเกิดเหมือนกันไม่ว่าการกระทำมาจากหน้าเว็บ (supabase-js/RPC) หรือเซิร์ฟเวอร์ ผู้ลงมือไม่ได้รับของตัวเอง ผู้ที่ปิด "การแจ้งเตือนในระบบ" ใน Settings ไม่ได้รับ
- บุคคลภายนอกที่ไม่มีบัญชีได้เฉพาะอีเมล (ปัจจุบันเป็น stub)
- กระดิ่งตรวจจำนวนที่ยังไม่อ่านทุก 30 วินาที (ขึ้น toast "มีการแจ้งเตือนใหม่") แสดง 10 รายการล่าสุด และมีลิงก์ "ดูการแจ้งเตือนทั้งหมด" ไปหน้า `/notifications` (กรองยังไม่อ่าน, ทำเครื่องหมายอ่านทีละรายการหรือทั้งหมด)
- รายละเอียดเหตุการณ์ → ผู้รับ → ข้อความ อยู่ที่ `docs/DESIGN_DECISIONS.md` §5.14

### 2. Generate Prisma Client

```bash
npx prisma generate
```

`package.json` มี `postinstall: prisma generate` จึงสร้าง client ให้ทุกครั้งที่ `npm ci`/`npm install` (ทดสอบโคลนใหม่แล้วพบว่า
postinstall ของ `@prisma/client` เองไม่ได้สร้างให้) ถ้ายังเจอ `@prisma/client did not initialize yet` ให้รันคำสั่งนี้ซ้ำ

### 3. สร้างฐานข้อมูล

> **ถ้าใช้ฐานข้อมูล Supabase ของทีมที่มีอยู่แล้ว (ได้ `.env` จากเจ้าของโปรเจกต์)**: ข้ามขั้น 3 และ 4 ไปขั้น 5 ได้เลย — migration ถูก apply ครบแล้ว และ**ห้ามรัน `db:seed`** เพราะจะลบข้อมูลทุกตารางของทุกคน
> ขั้น 3–4 ใช้เฉพาะเมื่อสร้างโปรเจกต์ Supabase ใหม่ที่ว่างเปล่าของตัวเอง

```bash
npx prisma migrate deploy
```

ใช้ `migrate deploy` (ไม่ใช่ `prisma migrate dev`) เสมอ เพราะ migration history ของโปรเจกต์นี้มีบาง migration ที่ถูก apply
ด้วยมือจริงกับฐานข้อมูล production (ผ่าน `prisma db execute` แล้ว `prisma migrate resolve --applied` — ดู comment ในไฟล์
`prisma/migrations/*/migration.sql` แต่ละไฟล์) ซึ่งต้องอาศัย schema `auth` ที่ Supabase Auth สร้างไว้ให้อยู่แล้วในทุกโปรเจกต์จริง —
`migrate dev` จะพยายามสร้าง shadow database ที่ไม่มี schema `auth` นี้มาเทียบ diff แล้วพัง ส่วน `migrate deploy` แค่ไล่ apply
ทุก migration ที่ยังไม่เคยรันตามลำดับไฟล์ตรงๆ กับฐานข้อมูลจริง (ปลอดภัยสำหรับฐานข้อมูล Supabase โปรเจกต์ใหม่ที่ว่างเปล่า)

migration ล่าสุด `20261012090000_in_app_notifications_for_all_events` (trigger การแจ้งเตือน 9 ตัว + ฟังก์ชันใน schema `private`) ถูกรวมอยู่ใน `migrate deploy` ด้วย ไม่ต้องทำอะไรเพิ่ม
(ฐานข้อมูลของทีม apply แล้วเมื่อ 12 ต.ค. 2569) ถ้าต้องถอยกลับ ใช้ `prisma/rollbacks/20261012090000_in_app_notifications_for_all_events.down.sql` ในทรานแซกชันเดียว
แล้วลบแถวของ migration นี้ออกจาก `_prisma_migrations` (ทั้งหมดอธิบายในหัวไฟล์)

### 4. ใส่ข้อมูลตัวอย่าง

```bash
SEED_DEMO_PASSWORD='<รหัสผ่านที่ต้องการ>' SEED_RESET_ALL=yes npm run db:seed                          # bash / Git Bash
$env:SEED_DEMO_PASSWORD='<รหัสผ่านที่ต้องการ>'; $env:SEED_RESET_ALL="yes"; npm run db:seed             # PowerShell
```

**คำเตือน: สคริปต์นี้ลบข้อมูลทุกแถวของทุกตาราง (ไม่ใช่แค่ข้อมูลตัวอย่าง) แล้วสร้างผู้ใช้ตัวอย่าง 5 คนใน Supabase Auth +
ข้อมูลผู้ติดต่อ/กลุ่ม/โปรเจกต์/นัดหมาย/งาน ตัวอย่างใหม่** — ใช้กับฐานข้อมูลใหม่ของตัวเองเท่านั้น ห้ามรันกับฐานข้อมูลที่ใช้ร่วมกัน
ถ้าไม่ตั้ง `SEED_RESET_ALL=yes` สคริปต์จะปฏิเสธและไม่แตะฐานข้อมูล
`SEED_DEMO_PASSWORD` คือรหัสผ่านที่บัญชีตัวอย่างทั้ง 5 บัญชีจะได้ ถ้าไม่ตั้ง สคริปต์จะหยุดและไม่แตะฐานข้อมูลเช่นกัน
(ไม่มีรหัสผ่านใดเขียนไว้ใน repo)

### 5. รัน

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) แล้ว login ด้วยบัญชีทดสอบด้านล่าง (ขั้นตอนนี้สำหรับรันบนเครื่องตัวเอง —
การขึ้นโฮสต์จริงดูหัวข้อถัดไป)

---

## การ deploy และข้อจำกัดที่ทราบ

ตั้งค่าที่ใช้กับ Vercel (โฮสต์ serverless อื่นก็คล้ายกัน):

- Framework Preset: Next.js; Build Command: `npm run build` (ค่าเริ่มต้น); Install Command: ค่าเริ่มต้น (`postinstall` รัน `prisma generate` ให้เอง)
- Node.js 20.9 ขึ้นไป (แนะนำ 24.x)
- บนโฮสต์ไม่มีไฟล์ `.env` — ใส่ค่าทุกตัวในหน้าตั้งค่า Environment Variables ของโฮสต์แทน

Environment variables (ชื่อเท่านั้น — ค่าจริงดูที่มาในตารางหัวข้อ "1. ตั้งค่า environment variables"):

- **ต้องมีตอน build**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ค่า `NEXT_PUBLIC_*` ถูกฝังลงโค้ดฝั่ง browser ตอน build)
- **ต้องมีตอนรัน**: `DATABASE_URL` (Transaction pooler พอร์ต 6543 ต่อท้าย `?pgbouncer=true&connection_limit=1`), `DIRECT_URL`,
  `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` และ **`REMINDER_AUTO_PROCESS=0`**
  (บน serverless ไม่มีโปรเซสค้างให้ตัวจับเวลาทำงาน)
- **ไม่จำเป็น**: `ANTHROPIC_API_KEY`, `REMINDER_AUTO_PROCESS_INTERVAL_SECONDS`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
- **ห้ามตั้งบนโฮสต์**: `SEED_RESET_ALL`, `SEED_DEMO_PASSWORD`, `OTP_TEST_DATABASE_URL`, `REMINDER_TEST_DATABASE_URL`, `NOTIFICATION_TEST_DATABASE_URL`

ข้อจำกัดที่ทราบ:

- **อัปโหลดรูปโปรไฟล์และไฟล์แนบของงานใช้ไม่ได้บนโฮสต์ที่ดิสก์เขียนไม่ได้** (เช่น Vercel) — ไฟล์ถูกเก็บใน `public/uploads`
  ของเซิร์ฟเวอร์เอง เมื่อเขียนไม่ได้ระบบตอบ "ฟีเจอร์อัปโหลดไฟล์ยังไม่รองรับบนเซิร์ฟเวอร์นี้" (503) และไม่บันทึกอะไรลงฐานข้อมูล
  รูปโปรไฟล์ที่ไม่มีไฟล์จะแสดงเป็นอักษรย่อแทน
- **ระบบอีเมลเป็นโหมดจำลอง จึงรีเซ็ตรหัสผ่านทางอีเมลไม่ได้** — รหัส OTP ไม่ถูกส่งไปกล่องจดหมายจริง (หน้าลืมรหัสผ่านแจ้งไว้แล้ว)
  ผู้ดูแลระบบต้องตั้งรหัสใหม่ให้ใน Supabase Dashboard → Authentication → Users
- **การเตือนก่อนประชุมไม่ประมวลผลอัตโนมัติบน serverless** — ผู้ดูแลระบบต้องกดปุ่ม "ประมวลผล reminder ที่ถึงเวลา" ในหน้า `/reminders`
  (เมนู "การแจ้งเตือน") เพื่อเปลี่ยนสถานะและสร้างการแจ้งเตือนในกระดิ่ง
- **ไม่มีหน้าสมัครสมาชิก** — สร้างบัญชีที่ Supabase Dashboard → Authentication → Users → Add user (เลือก Auto Confirm)
  แล้วเพิ่มแถว `"User"` (`id` = uuid ของผู้ใช้ใน Auth, `email`, `name`, `role` = `ADMIN`/`MEMBER`, `updatedAt`) และแถว `"Person"`
  (`id`, `name`, `email` เดียวกัน, `type` = `INTERNAL`, `status` = `ACTIVE`, `userId` = uuid เดียวกัน, `updatedAt`) ใน SQL Editor
  — ถ้าไม่มีแถว `"User"` ผู้ใช้จะล็อกอินผ่าน Supabase ได้แต่แอปจะถือว่ายังไม่ได้เข้าสู่ระบบ
- **AI** — ถ้าไม่ตั้ง `ANTHROPIC_API_KEY` ฟีเจอร์ AI ของการประชุมใช้โหมดเทมเพลต (ป้าย "สร้างโดยระบบ") ไม่ได้เรียก AI
  ส่วนปุ่มจัดลำดับงานด้วย AI ในหน้า `/tasks` ใช้ไม่ได้
- โฮสต์ serverless จำกัดขนาด request (Vercel ประมาณ 4.5MB) ไฟล์ที่ใหญ่กว่านั้นจะถูกปฏิเสธก่อนถึงแอป

---

## ทดสอบ (test:*)

ตรวจโค้ด: `npm run lint` และ `npm run typecheck` (สร้าง type ของ route ด้วย `next typegen` ก่อน `tsc` — `npx tsc` เปล่าๆ ในโคลนใหม่จะหา `LayoutProps` ไม่เจอ) ; `npm run build` ตรวจ type ให้ด้วย

ชุดทดสอบเป็นสคริปต์ `tsx` ใน `scripts/` แต่ละชุดพิมพ์ผล ✅/❌ และจบด้วย exit 0 เมื่อผ่านทั้งหมด:

- `npm run test:uploads`, `npm run test:format`, `npm run test:redirect` — pure function ไม่ต้องใช้ฐานข้อมูลหรือเซิร์ฟเวอร์
- `npm run test:rls`, `npm run test:authz` — ใช้ `.env` และ**ต่อฐานข้อมูลจริง** (`test:rls` ต้องตั้ง `SEED_DEMO_PASSWORD` เป็นรหัสผ่านของบัญชีตัวอย่างด้วย): สร้าง fixture ชั่วคราวแล้วลบเอง (`test:authz` เปิด `next dev` ชั่วคราวที่พอร์ต 3199) — รันเมื่อจำเป็นเท่านั้น
- `npm run test:otp`, `npm run test:reminders`, `npm run test:notifications` — ต้องใช้ Postgres ทิ้งได้ในเครื่อง (localhost เท่านั้น สคริปต์ปฏิเสธที่อยู่อื่น) ผ่านตัวแปร `OTP_TEST_DATABASE_URL` / `REMINDER_TEST_DATABASE_URL` / `NOTIFICATION_TEST_DATABASE_URL` เช่น
  `REMINDER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/otptest npm run test:reminders`
  (`test:reminders` และ `test:notifications` ต้องการฐานที่ apply ทุก migration พร้อม stand-in ของ schema `auth`; `test:otp` ใช้ฐานจาก `prisma db push` — รายละเอียดในหัวไฟล์ของแต่ละสคริปต์)

---

## ข้อจำกัดที่ยังอยู่

- **อีเมลยังไม่ส่งจริง** — `sendEmail()` เป็น stub ที่ log ข้อความไว้ใน server console การเตือนที่ประมวลผลแล้วจึงมีสถานะ `SIMULATED` (จำลองการส่ง) ไม่ใช่ `SENT` และรีเซ็ตรหัสผ่านทางอีเมล (OTP) ไม่ได้จริง
- **AI** — ไม่มี `ANTHROPIC_API_KEY` จะใช้โหมดเทมเพลต (ป้าย "สร้างโดยระบบ") ; ปุ่มจัดลำดับงานด้วย AI ในหน้า `/tasks` ต้องมีคีย์ (ไม่มีโหมดเทมเพลต)
- **การแจ้งเตือนที่ถึงเวลา** ถูกประมวลผลเองโดยเซิร์ฟเวอร์ที่รันค้าง (ปิดด้วย `REMINDER_AUTO_PROCESS=0`) — บน serverless ให้ผู้ดูแลระบบกดปุ่มประมวลผลในหน้า `/reminders` (ยังไม่มี route สำหรับ cron)
- **อัปโหลดไฟล์** — เก็บในดิสก์ของเซิร์ฟเวอร์ (`public/uploads`) จึงใช้ไม่ได้บนโฮสต์ที่ดิสก์เขียนไม่ได้
- **ยังไม่มีสมัครสมาชิกแบบเปิด** (FR-01) — บัญชีถูกสร้างโดย `db:seed` หรือสร้างเองใน Supabase Authentication แล้วเพิ่มแถว `"User"`/`"Person"` (ดูหัวข้อ "การ deploy และข้อจำกัดที่ทราบ")
- รายการข้อจำกัดเต็ม (รวมเรื่องที่ต้องแก้ RLS/DB) อยู่ที่ [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) หัวข้อ "สิ่งที่ยังไม่ทำ (ของจริง)"

---

## บัญชีทดสอบ (หลัง `npm run db:seed`)

ทุกบัญชีใช้รหัสผ่านเดียวกัน คือค่า `SEED_DEMO_PASSWORD` ที่ตั้งตอนรัน `db:seed` (ไม่ได้เขียนไว้ใน repo — ขอจากผู้ดูแลโปรเจกต์)

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
  — รอบ fix4 (12 ต.ค. 2569) เพิ่ม trigger การแจ้งเตือน 9 ตัวและฟังก์ชันช่วยใน schema `private` 13 ตัว
  (หัวข้อ "การแจ้งเตือนในระบบ" ด้านบน และ `docs/DESIGN_DECISIONS.md` §5.14)

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
