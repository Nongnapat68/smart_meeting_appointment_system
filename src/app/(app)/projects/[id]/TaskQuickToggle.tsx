"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Task } from "@prisma/client";
import { formatDate } from "@/lib/format";
import { TaskStatusSelect } from "@/components/tasks/TaskStatusSelect";

/**
 * One task row on the project page. FR-12 AC3: status is changed with the
 * same three-state control as /tasks (it used to be a done/not-done
 * checkbox, so "in progress" was unreachable). canEdit is computed on the
 * server from the same rule as RLS; the page re-renders after a change so
 * the progress numbers above stay in step.
 */
export function TaskQuickToggle({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const router = useRouter();
  const done = task.status === "COMPLETED";
  const isUrgent = !done && task.priority === "HIGH";

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-surface-container-low rounded-lg transition-colors border border-transparent hover:border-outline-variant/20 group">
      <div className="flex-1 min-w-0">
        <Link
          href={`/tasks/${task.id}`}
className={`font-body-md text-body-md font-medium text-on-background hover:text-primary transition-colors ${done ? "text-on-surface-variant line-through" : ""}`}
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
      <TaskStatusSelect key={`${task.id}-${task.status}`} taskId={task.id} status={task.status} canEdit={canEdit} onChanged={() => router.refresh()} size="sm" />
    </div>
  );
}
