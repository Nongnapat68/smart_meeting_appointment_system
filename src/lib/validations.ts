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
  .regex(/[0-9]/, "รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว")
  .regex(/[A-Z]/, "รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว");

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

// Spelled out rather than personSchema.partial() — same Zod 4 trap as
// updateTaskSchema below: .partial() keeps .default(), so a PUT that only
// sent `phone` came back with type "EXTERNAL" / status "ACTIVE" filled in,
// turning an internal contact external and reactivating an inactive one.
export const updatePersonSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อ").optional(),
  email: email().optional(),
  phone: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  type: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// --- Contact Groups -------------------------------------------------------

export const groupSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อกลุ่ม"),
  description: z.string().trim().optional().nullable(),
  icon: z.string().trim().optional(),
});

// Explicit rather than groupSchema.partial(): groupSchema has no defaults
// today, but .partial() would silently start filling one in on every edit
// the moment one is added (the bug updateTaskSchema/updatePersonSchema had).
export const updateGroupSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อกลุ่ม").optional(),
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

// Spelled out rather than projectSchema.partial() — same Zod 4 trap as
// updateTaskSchema below. Here it was destructive: a PUT that only renamed a
// project came back with status "ACTIVE" and memberIds [] filled in, and
// PUT /api/projects/[id] treats any memberIds array as "replace the member
// list" — so a rename reset the status and deleted every member.
export const updateProjectSchema = z.object({
  name: nonEmpty("กรุณากรอกชื่อโปรเจกต์").optional(),
  description: z.string().trim().optional().nullable(),
  status: z.enum(["ACTIVE", "PENDING", "DELAYED", "COMPLETED"]).optional(),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
});

// --- Reminder offsets (FR-10/BR-11) -------------------------------------

// Upper bound for "remind me N minutes before the meeting". The largest
// preset in MeetingForm is 7 days; 30 days leaves room for a custom
// "2 weeks / 1 month before" while rejecting values like 99999999 that put
// scheduledAt centuries in the past (already "due", so process-due would send
// it at once). create_meeting_with_participants() enforces the same bound in
// SQL (migration 20261003090000_reminder_offset_bounds) — keep them in sync.
export const REMINDER_OFFSET_MAX_MINUTES = 30 * 24 * 60;

const REMINDER_OFFSET_INT_MESSAGE = "จำนวนนาทีต้องเป็นจำนวนเต็ม";

export const reminderOffsetMinutes = z
  .number(REMINDER_OFFSET_INT_MESSAGE)
  .int(REMINDER_OFFSET_INT_MESSAGE)
  .min(1, "จำนวนนาทีต้องมากกว่า 0")
  .max(REMINDER_OFFSET_MAX_MINUTES, `แจ้งเตือนล่วงหน้าได้ไม่เกิน ${REMINDER_OFFSET_MAX_MINUTES} นาที (30 วัน)`);

/**
 * Client-side check for the custom-minutes input in MeetingForm: the parsed
 * value, or the message to show. Strict on the raw text so "1.5" or "10abc"
 * aren't silently truncated by parseInt into something the user didn't type.
 */
export function parseReminderOffsetInput(raw: string): { minutes: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "กรุณากรอกจำนวนนาที" };
  if (!/^[+-]?\d+$/.test(text)) return { error: REMINDER_OFFSET_INT_MESSAGE };
  const result = reminderOffsetMinutes.safeParse(Number(text));
  if (!result.success) return { error: result.error.issues[0].message };
  return { minutes: result.data };
}

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
    reminderOffsetMinutes: z.array(reminderOffsetMinutes).optional().default([30]),
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

// Spelled out rather than taskSchema.partial(): in Zod 4 .partial() keeps each
// field's .default(), so a PATCH that only sent `title` came back with
// status "NOT_STARTED" / priority "MEDIUM" filled in and silently reset them.
export const updateTaskSchema = z.object({
  title: nonEmpty("กรุณากรอกชื่องาน").optional(),
  description: z.string().trim().optional().nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueDate: z.string().trim().optional().nullable(),
  assigneePersonId: z.string().trim().optional().nullable(),
  projectId: z.string().trim().optional().nullable(),
  meetingId: z.string().trim().optional().nullable(),
});

export const taskCommentSchema = z.object({
  content: nonEmpty("กรุณากรอกข้อความ"),
});

// --- Reminders --------------------------------------------------------

export const reminderQuerySchema = z.object({
  status: z.enum(["PENDING", "SENT", "SIMULATED", "FAILED", "CANCELLED"]).optional(),
});

// Add one more reminder to an already-created meeting (FR-10/BR-11) — the
// initial batch is created inline via meetingSchema.reminderOffsetMinutes.
export const createReminderSchema = z.object({
  meetingId: nonEmpty("ต้องระบุการประชุม"),
  offsetMinutes: reminderOffsetMinutes,
});
