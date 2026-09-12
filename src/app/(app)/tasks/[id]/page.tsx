"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { formatDate, relativeTime } from "@/lib/format";
import { taskStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import type { Task, TaskAttachment, TaskComment, User, Project, Meeting, Person } from "@prisma/client";

type TaskDetail = Task & {
  project: Project | null;
  meeting: Meeting | null;
  assignee: Pick<User, "id" | "name" | "avatarUrl"> | null;
  assigneePerson: Person | null;
  createdBy: { name: string } | null;
  comments: (TaskComment & { author: User | null })[];
  attachments: TaskAttachment[];
};

const PRIORITY_LABEL: Record<string, string> = { LOW: "ต่ำ", MEDIUM: "ปานกลาง", HIGH: "สูง (High Priority)" };

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Hybrid migration (Tasks resource) — GET detail -> supabase-js
      // nested select, matching the old include{} shape field-for-field:
      // project/meeting/assigneePerson stay full rows (old code used
      // `true`, not a `select`), assignee/createdBy stay narrowed to just
      // what TaskDetail declares (old code used `select: {...}`).
      // assignee/createdBy both point at User via two different FKs
      // (assigneeId/createdById), so PostgREST needs the !fkey hint to
      // pick one — confirmed live: the same embed without it fails with
      // PGRST201 "more than one relationship was found". comments/
      // attachments keep the old orderBy directions via referencedTable
      // (comments createdAt asc, attachments uploadedAt desc).
      const { data: task, error: dbError } = await createClient()
        .from("Task")
        .select(
          `*,
          project:Project(*),
          meeting:Meeting(*),
          assignee:User!Task_assigneeId_fkey(id,name,avatarUrl),
          assigneePerson:Person(*),
          createdBy:User!Task_createdById_fkey(name),
          comments:TaskComment(*, author:User(*)),
          attachments:TaskAttachment(*)`
        )
        .eq("id", params.id)
        .order("createdAt", { referencedTable: "comments", ascending: true })
        .order("uploadedAt", { referencedTable: "attachments", ascending: false })
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!task) throw new Error("ไม่พบงานนี้");
      setTask(task as TaskDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function markComplete() {
    if (!task) return;
    try {
      // update_assignee_or_creator_or_admin RLS policy replaces
      // assertOwner() — same 0-row silent-block subtlety as every other
      // resource in this migration, so .select().maybeSingle() + null-
      // check turns it into a thrown error. This button only renders when
      // task.status !== "COMPLETED" (see JSX below), so it's always a
      // fresh transition into COMPLETED — completedAt is set unconditionally
      // (mirrors the old PATCH route's own logic; dropping it would
      // silently break dashboard/page.tsx's "recently completed" feed,
      // which reads Task.completedAt directly via Prisma). updatedAt has
      // no DB default (Prisma's @updatedAt is client-side-only) so it's
      // set by hand too.
      const { data, error: dbError } = await createClient()
        .from("Task")
        .update({ status: "COMPLETED", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .eq("id", task.id)
        .select()
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error("เฉพาะผู้รับผิดชอบ ผู้สร้างงาน หรือผู้ดูแลระบบเท่านั้นที่แก้ไขงานนี้ได้ หรือไม่พบงานนี้");
      showToast("บันทึกงานเสร็จสิ้นแล้ว", "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ", "error");
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !comment.trim()) return;
    setPosting(true);
    try {
      // insert_task_assignee_or_creator_or_admin RLS policy replaces
      // assertOwner() here. Unlike UPDATE/DELETE's silent 0-row filtering,
      // a blocked INSERT's WITH CHECK actually raises a real Postgres
      // error (42501, "new row violates row-level security policy") —
      // confirmed against the same policy shape in the Groups round's
      // ContactGroupMember insert — so a caller who isn't this task's
      // assignee/creator/admin gets a clear thrown error straight from
      // dbError, not a silent no-op. Not selecting the inserted row back:
      // this component always calls load() right after anyway (the old
      // code did too, ignoring the POST response's `comment` payload
      // entirely), so fetching it here would be pure over-fetch.
      // TaskComment.id has no DB default (Prisma's @default(cuid()) is
      // client-side-only, same as every other direct insert in this
      // migration) so it's supplied explicitly; createdAt has a real DB
      // default (CURRENT_TIMESTAMP) so it's left out.
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      const { error: dbError } = await supabase.from("TaskComment").insert({
        id: crypto.randomUUID(),
        taskId: task.id,
        authorId: authData.user.id,
        content: comment,
      });
      if (dbError) throw new Error(dbError.message);
      setComment("");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ส่งความคิดเห็นไม่สำเร็จ", "error");
    } finally {
      setPosting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !task) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post(`/api/tasks/${task.id}/attachments`, formData);
      showToast("แนบไฟล์สำเร็จ", "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "แนบไฟล์ไม่สำเร็จ", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) return <FullPageSpinner />;
  if (error || !task)
    return (
      <div className="p-container-margin">
        <ErrorBanner message={error ?? "ไม่พบงานนี้"} />
      </div>
    );

  const badge = taskStatusBadge(task.status);

  return (
    <div className="p-container-margin max-w-5xl mx-auto space-y-6">
      <nav className="flex text-sm text-on-surface-variant mb-2">
        <Link href="/tasks" className="hover:text-primary transition-colors font-label-md text-label-md">
          งานของฉัน
        </Link>
        <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
        <span className="font-label-md text-label-md text-on-surface">รายละเอียดงาน</span>
      </nav>

      <div className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow border border-outline-variant/30 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex flex-col gap-3 flex-1">
          <StatusBadge {...badge} />
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{task.title}</h1>
        </div>
        <div className="flex items-center gap-3 mt-4 md:mt-0">
          {task.status !== "COMPLETED" && (
            <button
              onClick={markComplete}
              className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors flex items-center gap-2 ambient-shadow"
            >
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              บันทึกเสร็จสิ้น
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow border border-outline-variant/30">
            <h2 className="font-headline-md text-headline-md text-on-surface mb-4">รายละเอียดงาน</h2>
            <p className="font-body-lg text-body-lg text-on-surface-variant whitespace-pre-line">
              {task.description || "ไม่มีรายละเอียดเพิ่มเติม"}
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow border border-outline-variant/30">
            <h2 className="font-headline-md text-headline-md text-on-surface mb-6">ความคืบหน้า &amp; ความคิดเห็น</h2>
            <div className="space-y-6 mb-6">
              {task.comments.length === 0 && (
                <p className="text-on-surface-variant font-body-md text-body-md">ยังไม่มีความคิดเห็น</p>
              )}
              {task.comments.map((c) => (
                <div key={c.id} className="flex gap-4">
                  <Avatar name={c.author?.name ?? "?"} src={c.author?.avatarUrl} size={40} />
                  <div className="flex-1 bg-surface-container-low rounded-xl rounded-tl-none p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-label-md text-label-md font-semibold text-on-surface">{c.author?.name ?? "ผู้ใช้"}</span>
                      <span className="text-xs text-outline">{relativeTime(c.createdAt)}</span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={submitComment} className="flex gap-4 items-start">
              <div className="flex-1 relative">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="เพิ่มความคิดเห็นหรืออัปเดตความคืบหน้า..."
                  className="w-full p-3 border border-outline-variant rounded-xl bg-surface focus:ring-2 focus:ring-primary focus:border-primary text-sm resize-none"
                />
                <div className="flex justify-end items-center mt-2">
                  <button
                    type="submit"
                    disabled={posting || !comment.trim()}
                    className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-60"
                  >
                    {posting ? "กำลังส่ง..." : "ส่งข้อความ"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-5 ambient-shadow border border-outline-variant/30">
            <h3 className="font-label-md text-label-md font-semibold text-outline uppercase tracking-wider mb-4">ข้อมูลสรุป</h3>
            <div className="space-y-4">
              <div>
                <span className="text-xs text-outline mb-1 block">ผู้รับผิดชอบ</span>
                <p className="font-body-md text-body-md font-medium text-on-surface">
                  {task.assigneePerson?.name ?? task.assignee?.name ?? "ยังไม่ได้มอบหมาย"}
                </p>
              </div>
              <hr className="border-outline-variant/50" />
              <div>
                <span className="text-xs text-outline mb-1 block">กำหนดส่ง</span>
                <p className="font-body-md text-body-md font-medium text-on-surface">
                  {task.dueDate ? formatDate(task.dueDate) : "ไม่ได้กำหนด"}
                </p>
              </div>
              <hr className="border-outline-variant/50" />
              <div>
                <span className="text-xs text-outline mb-1 block">ระดับความสำคัญ</span>
                <p className="font-body-md text-body-md font-medium text-on-surface">{PRIORITY_LABEL[task.priority]}</p>
              </div>
            </div>
          </div>

          {task.meeting && (
            <div className="bg-surface-container-lowest rounded-xl p-5 ambient-shadow border border-outline-variant/30">
              <h3 className="font-label-md text-label-md font-semibold text-outline uppercase tracking-wider mb-4">การประชุมที่เกี่ยวข้อง</h3>
              <Link href={`/meetings/${task.meeting.id}`} className="block p-4 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-colors">
                <h4 className="font-label-md text-label-md font-semibold text-on-surface">{task.meeting.title}</h4>
              </Link>
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl p-5 ambient-shadow border border-outline-variant/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-label-md text-label-md font-semibold text-outline uppercase tracking-wider">
                ไฟล์แนบ ({task.attachments.length})
              </h3>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-primary hover:bg-primary-container/10 p-1 rounded transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">{uploading ? "hourglass_empty" : "add"}</span>
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            </div>
            <div className="space-y-2">
              {task.attachments.length === 0 && (
                <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีไฟล์แนบ</p>
              )}
              {task.attachments.map((a) => (
                <a
                  key={a.id}
                  href={a.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50"
                >
                  <span className="material-symbols-outlined text-[24px] text-secondary">description</span>
                  <div className="flex-1 overflow-hidden">
                    <p className="font-label-md text-label-md text-on-surface truncate">{a.fileName}</p>
                    <p className="text-[10px] text-outline">{(a.fileSize / 1024).toFixed(0)} KB</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
