"use client";

import { useEffect, useState } from "react";
import type { Task } from "@prisma/client";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { TASK_PRIORITY_OPTIONS } from "@/lib/tasks";
import { formatDate } from "@/lib/format";

type Option = { id: string; label: string };

export type TaskFormInitial = Pick<
  Task,
  "id" | "title" | "description" | "priority" | "assigneePersonId" | "projectId" | "meetingId"
> & { dueDate: Date | string | null };

/**
 * FR-12 AC2: create a task (title, assignee, due date, priority, linked
 * project and/or meeting) — or edit one when `task` is given. Goes through
 * POST /api/tasks and PATCH /api/tasks/[id]: those routes resolve the
 * assignee's login account and send the TASK_ASSIGNED notification, which
 * a browser can't insert itself (Notification INSERT is admin-only in RLS).
 */
export function TaskFormModal({
  open,
  onClose,
  onSaved,
  task,
  defaultProjectId,
  defaultMeetingId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
  task?: TaskFormInitial;
  defaultProjectId?: string | null;
  defaultMeetingId?: string | null;
}) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneePersonId, setAssigneePersonId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [projectId, setProjectId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [people, setPeople] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [meetings, setMeetings] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the fields every time the modal opens (create: defaults, edit: the task).
  useEffect(() => {
    if (!open) return;
    // Syncing form state to the prop on open — deemed safe by design (see eslint.config.mjs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setAssigneePersonId(task?.assigneePersonId ?? "");
    setDueDate(task?.dueDate ? String(task.dueDate).slice(0, 10) : "");
    setPriority(task?.priority ?? "MEDIUM");
    setProjectId(task ? (task.projectId ?? "") : (defaultProjectId ?? ""));
    setMeetingId(task ? (task.meetingId ?? "") : (defaultMeetingId ?? ""));
    setError(null);
  }, [open, task, defaultProjectId, defaultMeetingId]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("Person").select("id,name,email,type").eq("status", "ACTIVE").order("name"),
      supabase.from("Project").select("id,name").order("name"),
      supabase.from("Meeting").select("id,title,startTime").neq("status", "CANCELLED").order("startTime", { ascending: false }).limit(50),
    ]).then(([p, pj, m]) => {
      setPeople((p.data ?? []).map((x) => ({ id: x.id, label: `${x.name}${x.type === "EXTERNAL" ? " (ภายนอก)" : ""} — ${x.email}` })));
      setProjects((pj.data ?? []).map((x) => ({ id: x.id, label: x.name })));
      setMeetings((m.data ?? []).map((x) => ({ id: x.id, label: `${x.title} (${formatDate(x.startTime)})` })));
      if (p.error || pj.error || m.error) setError("โหลดรายชื่อผู้รับผิดชอบ/โปรเจกต์/การประชุมไม่ครบ กรุณาลองเปิดใหม่อีกครั้ง");
    });
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("กรุณากรอกชื่องาน");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      dueDate: dueDate || null,
      assigneePersonId: assigneePersonId || null,
      projectId: projectId || null,
      meetingId: meetingId || null,
    };
    try {
      const res = task
        ? await api.patch<{ task: Task }>(`/api/tasks/${task.id}`, body)
        : await api.post<{ task: Task }>("/api/tasks", body);
      showToast(task ? "บันทึกการแก้ไขงานแล้ว" : "สร้างงานสำเร็จ", "success");
      onSaved(res.task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกงานไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm";

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-[560px]">
      <h2 className="font-headline-md text-headline-md text-on-surface">{task ? "แก้ไขงาน" : "สร้างงานใหม่"}</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="ชื่องาน *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="เช่น สรุปใบเสนอราคา" autoFocus />
        </Field>
        <Field label="รายละเอียด">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </Field>
        <Field label="ผู้รับผิดชอบ">
          <select value={assigneePersonId} onChange={(e) => setAssigneePersonId(e.target.value)} className={inputCls}>
            <option value="">— ยังไม่มอบหมาย —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="กำหนดส่ง">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="ระดับความสำคัญ">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
              {TASK_PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="โปรเจกต์">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
            <option value="">— ไม่ผูกกับโปรเจกต์ —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="การประชุม">
          <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={inputCls}>
            <option value="">— ไม่ผูกกับการประชุม —</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="text-error text-sm" role="alert">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-outline-variant font-label-md text-label-md">
            ยกเลิก
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 disabled:opacity-60">
            {saving ? "กำลังบันทึก..." : task ? "บันทึกการแก้ไข" : "สร้างงาน"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-on-surface-variant mb-1 font-label-md">{label}</span>
      {children}
    </label>
  );
}
