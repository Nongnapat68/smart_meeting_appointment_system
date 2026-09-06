import { z } from "zod";

// Kept as a plain regex (rather than `z.string().email()`) so this file isn't
// coupled to a specific Zod minor version's email-validator implementation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = () => z.string().trim().min(1, "กรุณากรอกอีเมล").regex(EMAIL_RE, "รูปแบบอีเมลไม่ถูกต้อง");
const nonEmpty = (msg: string) => z.string().trim().min(1, msg);

// --- Auth -------------------------------------------------------------

export const loginSchema = z.object({
  email: email(),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: email(),
});

export const verifyOtpSchema = z.object({
  email: email(),
  otp: z.string().length(6, "รหัส OTP ต้องมี 6 หลัก"),
});

const strongPassword = z
  .string()
  .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
  .regex(/^[A-Za-z0-9]+$/, "รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ A-Z, a-z และตัวเลข 0-9 เท่านั้น");

export const signUpSchema = z
  .object({
    name: nonEmpty("กรุณากรอกชื่อ-นามสกุล").max(120, "ชื่อยาวเกินไป"),
    email: email(),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = z
  .object({
    email: email(),
    otp: z.string().length(6),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    newPassword: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export const updateProfileSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อ"),
  phone: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  emailNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
});

// --- People / Contacts --------------------------------------------------

export const personSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อ"),
  email: email(),
  phone: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  type: z.enum(["INTERNAL", "EXTERNAL"]).default("EXTERNAL"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export const updatePersonSchema = personSchema.partial();

// --- Contact Groups -------------------------------------------------------

export const groupSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อกลุ่ม"),
  description: z.string().trim().optional().nullable(),
  icon: z.string().trim().optional(),
});

export const addGroupMemberSchema = z.object({
  personId: nonEmpty("ต้องระบุผู้ติดต่อ"),
  role: z.enum(["LEADER", "MEMBER"]).default("MEMBER"),
});

// --- Projects -------------------------------------------------------------

export const projectSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อโปรเจกต์"),
  description: z.string().trim().optional().nullable(),
  status: z.enum(["ACTIVE", "PENDING", "DELAYED", "COMPLETED"]).default("ACTIVE"),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  memberIds: z.array(z.string()).optional().default([]),
});

export const updateProjectSchema = projectSchema.partial();

// --- Meetings ---------------------------------------------------------

export const meetingSchema = z
  .object({
    title: nonEmpty("กรุณากรอกหัวข้อการประชุม"),
    description: z.string().trim().optional().nullable(),
    type: z.enum(["SINGLE", "PROJECT"]).default("SINGLE"),
    status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "CANCELLED", "POSTPONED"]).default("PENDING"),
    startTime: nonEmpty("กรุณาระบุเวลาเริ่ม"),
    endTime: nonEmpty("กรุณาระบุเวลาสิ้นสุด"),
    location: z.string().trim().optional().nullable(),
    projectId: z.string().trim().optional().nullable(),
    onlineMeetingResourceId: z.string().trim().optional().nullable(),
    participantPersonIds: z.array(z.string()).optional().default([]),
    groupIds: z.array(z.string()).optional().default([]),
    externalEmails: z.array(email()).optional().default([]),
    // FR-10/BR-11: minutes-before-start for each reminder to create. Defaults
    // to the single "30 minutes before" reminder the app always created
    // before this was configurable, so existing callers keep working unchanged.
    reminderOffsetMinutes: z.array(z.number().int().positive()).optional().default([30]),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม",
    path: ["endTime"],
  });

export const updateMeetingSchema = z.object({
  title: nonEmpty("กรุณากรอกหัวข้อการประชุม").optional(),
  description: z.string().trim().optional().nullable(),
  type: z.enum(["SINGLE", "PROJECT"]).optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "CANCELLED", "POSTPONED"]).optional(),
  startTime: z.string().trim().optional(),
  endTime: z.string().trim().optional(),
  location: z.string().trim().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  onlineMeetingResourceId: z.string().trim().optional().nullable(),
  participantPersonIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
  externalEmails: z.array(email()).optional(),
});

export const rescheduleMeetingSchema = z.object({
  startTime: nonEmpty("กรุณาระบุเวลาเริ่มใหม่"),
  endTime: nonEmpty("กรุณาระบุเวลาสิ้นสุดใหม่"),
});

// --- Reusable Online Meeting Link (FR-07) --------------------------------

export const onlineMeetingResourceSchema = z.object({
  name: nonEmpty("กรุณาตั้งชื่อลิงก์ประชุม"),
  url: nonEmpty("กรุณากรอก URL"),
});

export const updateOnlineMeetingResourceSchema = onlineMeetingResourceSchema.partial();

// --- Meeting context: Notes / Decisions / Related Resources (FR-11/12/13) --

export const meetingNoteSchema = z.object({
  content: nonEmpty("กรุณากรอกเนื้อหาบันทึก"),
});

export const decisionSchema = z.object({
  content: nonEmpty("กรุณากรอกมติที่ประชุม"),
});

export const relatedResourceSchema = z.object({
  title: nonEmpty("กรุณากรอกชื่อเอกสาร/ลิงก์"),
  url: nonEmpty("กรุณากรอก URL"),
  type: z.enum(["LINK", "DOCUMENT", "FILE"]).default("LINK"),
});

// --- Tasks --------------------------------------------------------------

export const taskSchema = z.object({
  title: nonEmpty("กรุณากรอกชื่องาน"),
  description: z.string().trim().optional().nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).default("NOT_STARTED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueDate: z.string().trim().optional().nullable(),
  assigneePersonId: z.string().trim().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  meetingId: z.string().trim().optional().nullable(),
});

export const updateTaskSchema = taskSchema.partial();

export const taskCommentSchema = z.object({
  content: nonEmpty("กรุณากรอกข้อความ"),
});

// --- Reminders --------------------------------------------------------

export const reminderQuerySchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"]).optional(),
});

// Add one more reminder to an already-created meeting (FR-10/BR-11) — the
// initial batch is created inline via meetingSchema.reminderOffsetMinutes.
export const createReminderSchema = z.object({
  meetingId: nonEmpty("ต้องระบุการประชุม"),
  offsetMinutes: z.number().int().positive("ต้องเป็นจำนวนนาทีก่อนเริ่มประชุมที่มากกว่า 0"),
});
