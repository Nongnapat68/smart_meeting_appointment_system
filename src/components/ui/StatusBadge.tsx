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

export function meetingStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return { label: "ยืนยันแล้ว", variant: "success" as const };
    case "PENDING":
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

export function reminderStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return { label: "รอส่ง", variant: "warning" as const };
    case "SENT":
      return { label: "ส่งแล้ว", variant: "success" as const };
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
      return { label: "Active", variant: "success" as const };
    case "PENDING":
      return { label: "Pending", variant: "warning" as const };
    case "DELAYED":
      return { label: "Delayed", variant: "error" as const };
    case "COMPLETED":
      return { label: "Completed", variant: "success" as const };
    default:
      return { label: status, variant: "neutral" as const };
  }
}

export function personStatusBadge(status: string) {
  return status === "ACTIVE"
    ? { label: "ใช้งาน", variant: "success" as const }
    : { label: "ไม่ใช้งาน", variant: "neutral" as const };
}
