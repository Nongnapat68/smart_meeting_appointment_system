import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskStatus } from "@prisma/client";
import { dbWriteErrorMessage } from "@/lib/db-errors";

// FR-12 shared task helpers for client components: the status options every
// page offers, and the one status write they all use.

export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "NOT_STARTED", label: "ยังไม่เริ่ม" },
  { value: "IN_PROGRESS", label: "กำลังดำเนินการ" },
  { value: "COMPLETED", label: "เสร็จสิ้น" },
];

export const TASK_PRIORITY_OPTIONS = [
  { value: "LOW", label: "ต่ำ" },
  { value: "MEDIUM", label: "ปานกลาง" },
  { value: "HIGH", label: "สูง" },
] as const;

export const TASK_EDIT_RULE = "เฉพาะผู้รับผิดชอบ ผู้สร้างงาน หรือผู้ดูแลระบบเท่านั้น";
export const TASK_DELETE_RULE = "เฉพาะผู้สร้างงานหรือผู้ดูแลระบบเท่านั้น";

/** Who may edit / change status / comment on a task — mirrors the Task and TaskComment RLS policies. */
export function canEditTask(
  task: { assigneeId: string | null; createdById: string | null },
  user: { id: string; role: string } | null
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || task.assigneeId === user.id || task.createdById === user.id;
}

/** Who may delete a task — mirrors the delete_creator_only_or_admin RLS policy. */
export function canDeleteTask(task: { createdById: string | null }, user: { id: string; role: string } | null): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || task.createdById === user.id;
}

/**
 * Sets a task's status straight through RLS (update_assignee_or_creator_or_admin).
 * completedAt is set on entering COMPLETED and cleared otherwise — the
 * dashboard's "recently completed" feed reads it; updatedAt has no DB
 * default (Prisma's @updatedAt is client-side only), so it's set by hand.
 * A blocked UPDATE matches 0 rows silently, hence the null check.
 */
export async function updateTaskStatus(supabase: SupabaseClient, taskId: string, status: TaskStatus) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("Task")
    .update({ status, completedAt: status === "COMPLETED" ? now : null, updatedAt: now })
    .eq("id", taskId)
    .select()
    .maybeSingle();
  if (error) throw new Error(dbWriteErrorMessage(error, "เปลี่ยนสถานะงาน", TASK_EDIT_RULE));
  if (!data) throw new Error(`คุณไม่มีสิทธิ์เปลี่ยนสถานะงานนี้ — ${TASK_EDIT_RULE} (หรือไม่พบงานนี้)`);
  return data;
}
