# SmartMeeting

ระบบจัดการนัดหมาย การประชุม ผู้ติดต่อ งาน และการแจ้งเตือน พัฒนาด้วย Next.js และ Prisma

## เริ่มใช้งานในเครื่อง

1. ติดตั้ง Node.js 20 ขึ้นไป และรัน `npm ci`
2. สร้างไฟล์ `.env` จาก `.env.example` แล้วกำหนด `AUTH_SECRET` เป็นค่าสุ่มที่ยาวและเก็บเป็นความลับ
3. สร้างฐานข้อมูลและ Prisma client ด้วย `npm run db:generate` และ `npm run db:push`
4. เพิ่มข้อมูลตัวอย่างด้วย `npm run db:seed`
5. รัน `npm run dev` แล้วเปิด `http://localhost:3000`

## การตั้งค่าสำหรับใช้งานจริง

- ใช้ PostgreSQL สำหรับ production และสร้าง Prisma migrations ให้ตรงกับ PostgreSQL ก่อน deploy ห้ามใช้ SQLite เป็นฐานข้อมูลร่วมใน production
- ตั้งค่า `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` ผ่าน secret manager ของผู้ให้บริการ ห้าม commit ไฟล์ `.env`
- ตั้งค่า SMTP ครบทุกตัว (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) เพื่อให้ OTP และอีเมลแจ้งเตือนส่งจริง
- ใช้ `npm run db:generate` และ `prisma migrate deploy` ในขั้นตอน deploy แทน `prisma migrate dev`
- ตั้ง scheduler เรียก `POST /api/internal/reminders/send-due` ทุก 5 นาที พร้อม header `Authorization: Bearer <CRON_SECRET>`
- สำรองฐานข้อมูลและทดสอบการกู้คืนตามนโยบายของผู้ให้บริการฐานข้อมูล
