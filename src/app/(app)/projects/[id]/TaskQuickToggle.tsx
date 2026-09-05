"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Task } from "@prisma/client";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

export function TaskQuickToggle({ task }: { task: Task }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [checked, setChecked] = useState(task.status === "COMPLETED");
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !checked;
    setChecked(next);
    setLoading(true);
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: next ? "COMPLETED" : "NOT_STARTED" });
      router.refresh();
    } catch (err) {
      setChecked(!next);
      showToast(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ", "error");
    } finally {
      setLoading(false);
    }
  }

  const isUrgent = !checked && task.priority === "HIGH";

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-surface-container-low rounded-lg transition-colors border border-transparent hover:border-outline-variant/20 group">
      <input
        type="checkbox"
        checked={checked}
        disabled={loading}
        onChange={toggle}
        className="mt-1 w-4 h-4 rounded border-outline text-primary focus:ring-primary"
      />
      <div className="flex-1 min-w-0">
        <Link
          href={`/tasks/${task.id}`}
          className={`font-body-md text-body-md font-medium text-on-background hover:text-primary transition-colors ${checked ? "line-through text-on-surface-variant" : ""}`}
        >
          {task.title}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          {isUrgent && <span className="font-label-md text-label-md text-error bg-error-container/30 px-2 py-0.5 rounded text-[11px]">ด่วน</span>}
          {task.dueDate && (
            <span className="font-label-md text-label-md text-outline flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
