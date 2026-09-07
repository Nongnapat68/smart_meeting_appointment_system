"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
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
      const res = await api.get<{ task: TaskDetail }>(`/api/tasks/${params.id}`);
      setTask(res.task);
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
      await api.patch(`/api/tasks/${task.id}`, { status: "COMPLETED" });
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
      await api.post(`/api/tasks/${task.id}/comments`, { content: comment });
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
