"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";

/** "สร้างงาน" for server-rendered pages (project / meeting detail): opens the form, refreshes the page on save. */
export function CreateTaskButton({
  defaultProjectId,
  defaultMeetingId,
  label = "สร้างงาน",
}: {
  defaultProjectId?: string | null;
  defaultMeetingId?: string | null;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 transition-colors inline-flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[18px]">add_task</span>
        {label}
      </button>
      <TaskFormModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => router.refresh()}
        defaultProjectId={defaultProjectId}
        defaultMeetingId={defaultMeetingId}
      />
    </>
  );
}
