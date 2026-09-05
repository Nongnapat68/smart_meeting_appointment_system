# Smart Meeting — Enterprise Suite

ระบบบริหารจัดการนัดหมายและการประชุมสำหรับองค์กร แปลงจาก UI mockup (Google Stitch) ให้เป็นระบบที่ทำงานได้จริงครบวงจร: auth, ฐานข้อมูลจริง, CRUD ทุกโมดูล, และ AI (Claude) สำหรับสรุปก่อนประชุม + จัดตารางงาน

หน้าจอ mockup เดิม (static HTML/Tailwind จาก Stitch) ถูกเก็บไว้ที่ `design-reference/` เป็นข้อมูลอ้างอิงด้านดีไซน์เท่านั้น ไม่ได้ใช้รันจริงอีกต่อไป — ดู `design-reference/_2/DESIGN.md` สำหรับ design system ต้นฉบับ และ `AUDIT.md` สำหรับสรุปการตรวจสอบ mockup ก่อนเริ่มพัฒนา

## Stack ที่เลือกใช้ และเหตุผล

| เรื่อง | ตัวเลือก | เหตุผล |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript** | โฟลเดอร์ mockup เดิมตั้งชื่อตรงกับ route อยู่แล้ว (meetings, people, projects ฯลฯ) ทำให้ map เข้า App Router ได้ตรงๆ, มี API Routes ในตัวไม่ต้องแยก backend คนละโปรเจกต์, TypeScript end-to-end |
| ฐานข้อมูล / ORM | **Prisma 6 + SQLite** (dev) | เริ่มใช้งานได้ทันทีไม่ต้องติดตั้งเซิร์ฟเวอร์ DB, schema ออกแบบให้ portable — สลับไป PostgreSQL ตอน production ได้แค่เปลี่ยน `provider`/`DATABASE_URL` ใน `prisma/schema.prisma` |
| Auth | **Custom JWT session (httpOnly cookie) + bcryptjs** | ไม่ใช้ NextAuth.js เพราะ ณ ตอนพัฒนา Next.js 16 ใหม่มาก ความเข้ากันได้ของ NextAuth ยังไม่ชัดเจน — เขียนเอง (sign/verify ด้วย `jose`, hash ด้วย `bcryptjs`) ทำให้ควบคุมพฤติกรรมได้เต็มที่และพึ่งพา dependency น้อยกว่า |
| AI | **Anthropic SDK (`@anthropic-ai/sdk`), model `claude-opus-5`** | เรียกจาก server (Route Handler) เท่านั้น ไม่มี API key หลุดไปฝั่ง client |
| Validation | **Zod** | ใช้ schema เดียวกันกับแนวคิดฝั่ง client และ server |
| ไฟล์แนบ/รูปโปรไฟล์ | Local filesystem (`public/uploads/`) | ง่ายสุดสำหรับ dev/demo — โครงสร้างโค้ด (`src/app/api/**/route.ts` ที่เขียนไฟล์) แยกจุดเดียวพอที่จะสลับไปใช้ S3-compatible storage ภายหลังได้ไม่ยาก |
| อีเมล / OTP | Mock (log ลง console) ผ่าน `src/lib/email.ts` | dev ไม่ต้องตั้งค่า SMTP; ใส่ `SMTP_*` ใน `.env` แล้วแก้ `sendEmail()` จุดเดียวเพื่อต่อผู้ให้บริการอีเมลจริง |

## เริ่มต้นใช้งาน (Development)

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. ตั้งค่า environment variables

```bash
cp .env.example .env
```

แก้ไข `.env`:
- `AUTH_SECRET` — สร้างค่าใหม่ด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `ANTHROPIC_API_KEY` — ใส่ API key จาก https://console.anthropic.com/ (จำเป็นสำหรับฟีเจอร์ AI เท่านั้น หน้าอื่นๆ ทำงานได้ปกติแม้ไม่ใส่)
- `DATABASE_URL` — ค่าเริ่มต้น `file:./dev.db` ใช้ SQLite ได้เลย ไม่ต้องแก้

### 3. สร้างฐานข้อมูลและ seed ข้อมูลตัวอย่าง

```bash
npm run db:migrate    # สร้างตาราง (ครั้งแรก) จาก prisma/schema.prisma
npm run db:seed       # ใส่ข้อมูลตัวอย่างครบทุก entity
```

### 4. รันเซิร์ฟเวอร์

```bash
npm run dev
```

เปิด http://localhost:3000 — ระบบจะพาไปหน้า `/login` อัตโนมัติ

### บัญชีทดสอบ (จาก seed script)

| อีเมล | รหัสผ่าน | บทบาท |
|---|---|---|
| somchai@smartmeeting.dev | `Passw0rd!` | ADMIN — Senior Product Manager |
| siriporn@smartmeeting.dev | `Passw0rd!` | ผู้อำนวยการฝ่ายการตลาด |
| wichai@smartmeeting.dev | `Passw0rd!` | Lead Designer |
| narin@smartmeeting.dev | `Passw0rd!` | Sr. Graphic Designer |
| kittichai@smartmeeting.dev | `Passw0rd!` | IT Support |

ข้อมูลตัวอย่างครอบคลุม: ผู้ใช้ + ผู้ติดต่อ (internal/external), กลุ่มผู้ติดต่อ, โปรเจกต์, การประชุม (ทุกสถานะ: pending/active/completed/cancelled/postponed), งาน (ทุกสถานะ รวมงานเกินกำหนด), reminder (ทุกสถานะ รวม failed พร้อมเหตุผล), การแจ้งเตือน, และ AI summary ตัวอย่าง 1 รายการ

### คำสั่งอื่นๆ ที่มีประโยชน์

```bash
npm run db:studio     # เปิด Prisma Studio ดู/แก้ข้อมูลในฐานข้อมูลผ่าน UI
npm run db:push       # sync schema กับ DB โดยไม่สร้าง migration file (ใช้ตอน prototype เร็วๆ)
npm run lint          # ตรวจ ESLint
npm run build          # build สำหรับ production
npm run test:authz    # integration test: ยืนยันว่า user A แก้ไข/ลบข้อมูลของ user B ผ่าน API ไม่ได้ (ดูหัวข้อ Authorization model ด้านล่าง)
```

## โครงสร้างโปรเจกต์

```
prisma/
  schema.prisma       # 13 entity หลัก (User, Person, ContactGroup, Project, Meeting, Task, Reminder, ...)
  seed.ts             # seed script
src/
  proxy.ts            # auth guard (เทียบเท่า middleware — Next.js 16 เปลี่ยนชื่อเป็น proxy.ts)
  lib/                # prisma client, auth, ai (Claude), email (mock), validations (zod), format helpers
  components/
    layout/           # Sidebar, TopBar ที่ใช้ร่วมกันทุกหน้า
    ui/               # StatusBadge, Modal/ConfirmDialog, Toast, Avatar, ฯลฯ
    meetings/         # MeetingForm ใช้ร่วมกันทั้งสร้าง/แก้ไขนัดหมาย
  app/
    login/, forgot-password/, logout/    # หน้า public (ไม่ต้อง login)
    (app)/                                # route group ที่มี Sidebar+TopBar และบังคับ login
      dashboard/, meetings/, people/, groups/, projects/, tasks/, reminders/, settings/, ai-assistant/
    api/                                  # REST API ทุกโมดูล (route.ts ตาม Next.js Route Handlers)
```

## สถาปัตยกรรม Auth

- Login ตรวจสอบ email/password (bcrypt) แล้วออก JWT (เซ็นด้วย `AUTH_SECRET`) เก็บใน httpOnly cookie (`sm_session`)
- `src/proxy.ts` (Next.js 16's Proxy — เดิมเรียก middleware) ตรวจทุก request: ถ้าไม่มี session ที่ valid และเข้าหน้าที่ไม่ใช่ `/login`, `/forgot-password`, หรือ `/api/auth/*` จะ redirect ไป `/login` (หรือตอบ 401 สำหรับ `/api/*`)
- Forgot password เป็น flow 3 ขั้นจริง: ขอ OTP (เก็บ hash ของ OTP ใน DB, หมดอายุ 10 นาที) → ยืนยัน OTP → ตั้งรหัสผ่านใหม่ — อีเมล OTP จะถูก log ออกทาง console ของเซิร์ฟเวอร์ใน dev (ดูใน terminal ที่รัน `npm run dev`)

## Authorization model (who can do what)

Every route under `src/app/api/**` (except `api/auth/*`) calls `requireUser()` itself — it independently re-reads and re-verifies the session JWT from the cookie on every request. This does **not** depend on `src/proxy.ts` having already checked it; a route hit directly would reject an invalid/missing session on its own.

Beyond authentication, mutating endpoints on ownable resources also enforce **authorization** via `assertOwner()` (`src/lib/api-helpers.ts`), so a logged-in user can't edit/delete another user's resource just by knowing its id:

| Resource | Who may mutate it |
|---|---|
| Meeting (edit/cancel/reschedule/delete, AI summary generate/edit) | the meeting's organizer, or an ADMIN |
| Task (edit/delete, add comment/attachment) | the task's assignee or creator, or an ADMIN (delete: creator or ADMIN only) |
| Contact Group (edit/delete, add/remove member) | the group's creator, or an ADMIN |
| Project (edit/delete) | the project's manager, or an ADMIN |
| Reminder (retry/cancel) | the organizer of the reminder's meeting, or an ADMIN |
| Person / contact directory | edit: anyone, unless the contact is linked to *another* user's own account (then that user or an ADMIN only); delete: ADMIN only |
| `/api/users/me/*` (profile, password, avatar) | always operates on the caller's own session — there's no user-id parameter to substitute, so this is safe by construction |

A rejected request gets `403` (authenticated but not authorized) — distinct from `401` (not logged in at all). List/detail `GET` endpoints (meetings, tasks, projects, groups, people) are intentionally **not** ownership-restricted: this is a shared internal workspace tool (matching the original mockups, where e.g. the meetings list and project detail pages show everyone's data), not a multi-tenant app with per-user data isolation.

**Verify it yourself:** `npm run test:authz` spins up a temporary instance of the app, creates two real users (A and B) with real fixtures owned by A, logs in as both, and asserts over real HTTP that B gets `403` on every mutating endpoint against A's resources (plus a `401` control with no session, and a `200` control for A editing their own meeting) — then checks the database directly to confirm none of B's rejected calls actually changed anything. It cleans up its fixtures and shuts its server down when done.

## AI Features

1. **AI Pre-meeting Summary** (`/ai-assistant`, หรือกดจากหน้ารายละเอียดประชุม) — เรียก Claude (`claude-opus-5`) โดยส่ง context จริงจากฐานข้อมูล: หัวข้อ/วาระ/เวลา/ผู้เข้าร่วมของประชุม, งาน (tasks) ที่เกี่ยวข้องกับโปรเจกต์เดียวกัน, และประชุมก่อนหน้าของโปรเจกต์เดียวกัน ผลลัพธ์แก้ไขได้และบันทึกกลับเข้า DB
2. **AI Auto-schedule** (ปุ่ม "สร้างตารางการทำงานอัตโนมัติ" ในหน้า "งานของฉัน") — ส่งรายการงานค้างของผู้ใช้ปัจจุบันทั้งหมดให้ Claude วิเคราะห์และแนะนำลำดับการทำงาน

ทั้งสองจุดจะแสดง error message ที่ชัดเจนถ้ายังไม่ได้ตั้งค่า `ANTHROPIC_API_KEY`

## ข้อจำกัด / การลดสโคปที่ทราบอยู่แล้ว (Known simplifications)

เอกสารนี้บอกตรงๆ ว่าอะไรยังไม่สมบูรณ์ 100% เทียบกับระบบ production จริง เพื่อไม่ให้เข้าใจผิดว่าเป็นบั๊ก:

- **ไฟล์อัปโหลด** (รูปโปรไฟล์, ไฟล์แนบงาน) เก็บใน `public/uploads/` โดยตรง ไม่มีการตรวจสิทธิ์ก่อนเข้าถึงไฟล์ (ใครมีลิงก์ก็เปิดได้) — เหมาะกับ dev/demo เท่านั้น ก่อนขึ้น production ควรย้ายไป object storage (S3/GCS) พร้อม signed URL
- **ค้นหาแบบ case-insensitive**: SQLite ไม่รองรับ `mode: "insensitive"` ของ Prisma (รองรับเฉพาะ Postgres/MongoDB) ทำให้การค้นหาในหน้า People/Meetings เป็น case-sensitive ใน dev — จะกลับมาใช้ได้ปกติทันทีเมื่อสลับไป PostgreSQL
- **Reminder ไม่มี background job ส่งจริงตามเวลา**: ระบบสร้าง Reminder record พร้อมเวลาที่ควรส่ง (30 นาทีก่อนประชุม) แต่ไม่มี cron/queue ที่ trigger การส่งอัตโนมัติ — ต้องกดปุ่ม "ลองใหม่" ในหน้า Reminders เพื่อสั่งส่งจริง (เรียก mock email service) ผู้ใช้งานจริงควรต่อกับ cron job หรือ background worker
- **Global search ที่ TopBar เป็นแค่ placeholder** (disabled) — การค้นหาจริงทำที่ช่องค้นหาในแต่ละหน้า (Meetings, People) ซึ่งเรียก API filter จริง
- **ไม่มี mobile bottom navigation** — Sidebar ซ่อนบนจอเล็ก แต่ยังไม่ได้ทำ mobile nav ทดแทน (mockup เดิมมีในบางหน้าเท่านั้น ไม่ตรงกันเอง)
- **Notification center**: มี entity และ unread count จริง (ใช้แสดง badge ที่กระดิ่ง) แต่ไม่มีหน้า inbox แยก — ตามพฤติกรรมเดิมของ mockup ที่กระดิ่งลิงก์ไปหน้า Reminders โดยตรง
- **Risk/Issue ในหน้า project ไม่ได้เป็น entity แยก** — mockup มีการ์ด "ปัญหาและความเสี่ยง" แต่ไม่ได้อยู่ใน scope entity หลักตาม AUDIT.md จึงยังไม่ implement เป็น CRUD เต็มรูปแบบ

## Deploy สู่ Production (สรุปสั้นๆ)

1. เปลี่ยน `datasource provider` ใน `prisma/schema.prisma` จาก `sqlite` เป็น `postgresql` และตั้ง `DATABASE_URL` ให้ชี้ไปยัง Postgres จริง แล้วรัน `npx prisma migrate deploy`
2. ตั้งค่า `AUTH_SECRET`, `ANTHROPIC_API_KEY`, และ `SMTP_*` เป็นค่าจริงบน hosting platform
3. ต่อ SMTP จริงใน `src/lib/email.ts` (ปัจจุบัน mock เป็น console.log)
4. ย้ายการอัปโหลดไฟล์จาก `public/uploads/` ไป object storage จริง
