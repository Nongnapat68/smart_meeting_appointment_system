import { isPast } from "@/lib/format";

const VARIANTS = {
  success: "bg-secondary-container/30 text-on-secondary-container",
  warning: "bg-tertiary-container/20 text-tertiary-container",
  error: "bg-error-container/50 text-error",
  neutral: "bg-surface-container text-on-surface-variant",
  primary: "bg-primary-container/20 text-primary",
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

export function StatusBadge({
  label,
  variant,
  className = "",
}: {
  label: string;
  variant: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-md text-label-md ${VARIANTS[variant]} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

// --- Domain-specific mappers so call sites don't repeat this switch logic ---

// N8: pass endTime and a PENDING meeting whose end is already behind us reads
// "ผ่านไปแล้ว" instead of "รอดำเนินการ". Display only — Meeting.status in the
// DB is left exactly as the organizer set it.
export function meetingStatusBadge(status: string, endTime?: Date | string) {
  switch (status) {
    case "ACTIVE":
      return { label: "ยืนยันแล้ว", variant: "success" as const };
    case "PENDING":
      if (endTime && isPast(endTime)) return { label: "ผ่านไปแล้ว", variant: "neutral" as const };
      return { label: "รอดำเนินการ", variant: "warning" as const };
    case "COMPLETED":
      return { label: "เสร็จสิ้น", variant: "success" as const };
    case "CANCELLED":
      return { label: "ยกเลิก", variant: "error" as const };
    case "POSTPONED":
      return { label: "เลื่อน", variant: "warning" as const };
    default:
      return { label: status, variant: "neutral" as const };
  }
}

export function taskStatusBadge(status: string) {
  switch (status) {
    case "NOT_STARTED":
      return { label: "ยังไม่เริ่ม", variant: "neutral" as const };
    case "IN_PROGRESS":
      return { label: "กำลังดำเนินการ", variant: "warning" as const };
    case "COMPLETED":
      return { label: "เสร็จสิ้น", variant: "success" as const };
    default:
      return { label: status, variant: "neutral" as const };
  }
}

// Pass scheduledAt and a PENDING reminder whose time has already come reads
// "เลยกำหนด — รอระบบประมวลผล": nothing processes it until the admin button on
// /reminders is pressed or the auto-processor's next run (on unless
// REMINDER_AUTO_PROCESS=0).
// Display only — the row stays PENDING, same as N8 above.
export function reminderStatusBadge(status: string, scheduledAt?: Date | string) {
  switch (status) {
    case "PENDING":
      if (scheduledAt && isPast(scheduledAt)) return { label: "เลยกำหนด — รอระบบประมวลผล", variant: "error" as const };
      return { label: "รอส่ง", variant: "warning" as const };
    case "SENT":
      return { label: "ส่งแล้ว", variant: "success" as const };
    case "SIMULATED":
      return { label: "จำลองการส่ง (ไม่ได้ส่งจริง)", variant: "primary" as const };
    case "FAILED":
      return { label: "ส่งไม่สำเร็จ", variant: "error" as const };
    case "CANCELLED":
      return { label: "ยกเลิกแล้ว", variant: "neutral" as const };
    default:
      return { label: status, variant: "neutral" as const };
  }
}

export function projectStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return { label: "กำลังดำเนินการ", variant: "success" as const };
    case "PENDING":
      return { label: "รอเริ่ม", variant: "warning" as const };
    case "DELAYED":
      return { label: "ล่าช้า", variant: "error" as const };
    case "COMPLETED":
      return { label: "เสร็จสิ้น", variant: "success" as const };
    default:
      return { label: status, variant: "neutral" as const };
  }
}

export function personStatusBadge(status: string) {
  return status === "ACTIVE"
    ? { label: "ใช้งาน", variant: "success" as const }
    : { label: "ไม่ใช้งานแล้ว", variant: "neutral" as const };
}

// FR-03/BR-04: labels how each MeetingParticipant ended up on the invite —
// straight from `source`/`sourceGroupId`, not re-derived or guessed.
export function participantSourceBadge(source: string, groupName?: string | null) {
  switch (source) {
    case "DIRECT":
      return { label: "เลือกโดยตรง", variant: "primary" as const };
    case "GROUP":
      return { label: groupName ? `จากกลุ่ม: ${groupName}` : "จากกลุ่ม", variant: "neutral" as const };
    case "EXTERNAL":
      return { label: "อีเมลภายนอก", variant: "warning" as const };
    default:
      return { label: source, variant: "neutral" as const };
  }
}
