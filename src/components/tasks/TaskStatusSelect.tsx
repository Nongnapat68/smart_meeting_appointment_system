"use client";

import { useState } from "react";
import type { TaskStatus } from "@prisma/client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { TASK_EDIT_RULE, TASK_STATUS_OPTIONS, updateTaskStatus } from "@/lib/tasks";

const STATUS_STYLE: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-surface-variant text-on-surface-variant border-outline-variant",
  IN_PROGRESS: "bg-tertiary-fixed/30 text-on-tertiary-fixed-variant border-tertiary-fixed-dim/50",
  COMPLETED: "bg-secondary-container/40 text-on-secondary-container border-secondary/30",
};

/**
 * FR-12 AC3: change a task's status to any of the three states (not just
 * done/not done) from wherever a task is listed. Saved through RLS; on
 * failure the previous status is restored and the reason is toasted.
 * Rendered disabled (with the rule as tooltip) for users who may not edit.
 */
export function TaskStatusSelect({
  taskId,
  status,
  canEdit,
  onChanged,
  size = "md",
}: {
  taskId: string;
  status: TaskStatus;
  canEdit: boolean;
  onChanged?: (status: TaskStatus) => void;
  size?: "sm" | "md";
}) {
  const { showToast } = useToast();
  const [value, setValue] = useState<TaskStatus>(status);
  const [saving, setSaving] = useState(false);

  async function change(next: TaskStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      await updateTaskStatus(createClient(), taskId, next);
      showToast(`เปลี่ยนสถานะเป็น "${TASK_STATUS_OPTIONS.find((o) => o.value === next)?.label}" แล้ว`, "success");
      onChanged?.(next);
    } catch (err) {
      setValue(previous);
      showToast(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={value}
      disabled={!canEdit || saving}
      onChange={(e) => change(e.target.value as TaskStatus)}
      onClick={(e) => e.stopPropagation()}
      title={canEdit ? "เปลี่ยนสถานะงาน" : `เปลี่ยนสถานะได้${TASK_EDIT_RULE}`}
      aria-label="สถานะงาน"
      className={`rounded-full border font-label-md ${size === "sm" ? "text-[11px] px-2 py-0.5" : "text-label-md px-3 py-1"} ${STATUS_STYLE[value]} disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer`}
    >
      {TASK_STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
