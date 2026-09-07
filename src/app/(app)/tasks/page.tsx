"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner, Spinner } from "@/components/ui/Feedback";
import { formatDate } from "@/lib/format";
import type { Task, TaskStatus } from "@prisma/client";

type TaskRow = Task & {
  project: { id: string; name: string } | null;
  meeting: { id: string; title: string } | null;
};

type FilterTab = "ALL" | TaskStatus;

const TAB_LABELS: Record<FilterTab, string> = {
  ALL: "ทั้งหมด",
  NOT_STARTED: "ยังไม่เริ่ม",
  IN_PROGRESS: "กำลังดำเนินการ",
  COMPLETED: "เสร็จสิ้น",
};

export default function TasksPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<FilterTab>("ALL");
  const [items, setItems] = useState<TaskRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<TaskStatus, number>>({
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSchedule, setAiSchedule] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tab !== "ALL") params.set("status", tab);
      const res = await api.get<{ items: TaskRow[]; statusCounts: Record<TaskStatus, number> }>(
        `/api/tasks?${params.toString()}`
      );
      setItems(res.items);
      setStatusCounts(res.statusCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function toggleComplete(task: TaskRow) {
    const nextStatus = task.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    setItems((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: nextStatus });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ", "error");
      load();
    }
  }

  async function runAiSchedule() {
    setAiLoading(true);
    setAiSchedule(null);
    try {
      const res = await api.post<{ schedule: string }>("/api/tasks/ai-schedule");
      setAiSchedule(res.schedule);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "สร้างตารางไม่สำเร็จ", "error");
    } finally {
      setAiLoading(false);
    }
  }

  const now = new Date();
  const overdueTasks = items.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < now);
  const otherTasks = items.filter((t) => !overdueTasks.includes(t));
  const total = statusCounts.NOT_STARTED + statusCounts.IN_PROGRESS + statusCounts.COMPLETED;

  return (
    <div className="p-container-margin max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-surface mb-2">งานของฉัน (Action Items)</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant">จัดการและติดตามงานที่ได้รับมอบหมายจากการประชุม</p>
        </div>
        <div className="flex bg-surface-container-lowest rounded-lg p-1 ambient-shadow border border-outline-variant/30 flex-wrap">
          {(["ALL", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md font-label-md text-label-md transition-all ${
                tab === t ? "bg-primary/10 text-primary font-semibold" : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              {TAB_LABELS[t]} ({t === "ALL" ? total : statusCounts[t]})
            </button>
          ))}
        </div>
      </div>

      {loading && <FullPageSpinner />}
      {error && <ErrorBanner message={error} />}

      {!loading && !error && (
        <div className="grid grid-cols-12 gap-6 pb-12">
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            {overdueTasks.length > 0 && (
              <div className="bg-error-container/20 rounded-xl p-card-padding border border-error/20 ambient-shadow">
                <div className="flex items-center gap-3 mb-4 text-error">
                  <span className="material-symbols-outlined icon-fill">error</span>
                  <h3 className="font-headline-md text-headline-md">งานที่เกินกำหนด ({overdueTasks.length})</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {overdueTasks.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="bg-surface-container-lowest p-4 rounded-lg border border-error/10 hover:border-error/30 transition-colors shadow-sm block"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-1 bg-error/10 text-error rounded text-[10px] font-bold tracking-wide uppercase">
                          Overdue
                        </span>
                        {t.dueDate && (
                          <span className="text-error font-label-md text-label-md flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                            {formatDate(t.dueDate)}
                          </span>
                        )}
                      </div>
                      <h4 className="font-body-lg text-body-lg font-semibold text-on-surface mb-1">{t.title}</h4>
                      {t.meeting && <p className="font-body-md text-body-md text-on-surface-variant line-clamp-1">จาก: {t.meeting.title}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl p-card-padding relative overflow-hidden ambient-shadow bg-surface-container-lowest border border-outline-variant/30">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-primary icon-fill">auto_awesome</span>
                <h3 className="font-headline-md text-headline-md text-on-surface">AI ผู้ช่วย</h3>
              </div>
              {aiSchedule ? (
                <p className="font-body-md text-body-md text-on-surface-variant mb-4 leading-relaxed whitespace-pre-line">
                  {aiSchedule}
                </p>
              ) : (
                <p className="font-body-md text-body-md text-on-surface-variant mb-4 leading-relaxed">
                  ให้ AI ช่วยวิเคราะห์งานที่ค้างอยู่ของคุณ แล้วแนะนำลำดับการทำงานที่เหมาะสม
                </p>
              )}
              <button
                onClick={runAiSchedule}
                disabled={aiLoading}
                className="w-full py-2 border border-outline-variant rounded-lg text-on-surface hover:bg-surface-container-low transition-colors font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {aiLoading ? <Spinner /> : <span className="material-symbols-outlined text-[16px]">auto_awesome</span>}
                {aiLoading ? "กำลังวิเคราะห์..." : "สร้างตารางการทำงานอัตโนมัติ"}
              </button>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 ambient-shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-outline-variant/30 bg-surface-bright">
                <h3 className="font-headline-md text-headline-md text-on-surface">งานที่ต้องดำเนินการ</h3>
              </div>
              {otherTasks.length === 0 && overdueTasks.length === 0 ? (
                <EmptyState icon="task_alt" title="ไม่มีงานในหมวดนี้" description="ลองเลือกตัวกรองอื่น" />
              ) : (
                <div className="divide-y divide-outline-variant/20">
                  {otherTasks.map((t) => (
                    <div key={t.id} className="p-6 hover:bg-surface-container-lowest transition-colors group relative">
                      <div className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          checked={t.status === "COMPLETED"}
                          onChange={() => toggleComplete(t)}
                          className="mt-1 w-5 h-5 rounded border-2 border-outline text-primary focus:ring-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1 gap-2">
                            <Link
                              href={`/tasks/${t.id}`}
                              className={`font-body-lg text-body-lg font-semibold text-on-surface group-hover:text-primary transition-colors ${t.status === "COMPLETED" ? "line-through text-on-surface-variant" : ""}`}
                            >
                              {t.title}
                            </Link>
                            <StatusPill status={t.status} />
                          </div>
                          {t.description && (
                            <p className="font-body-md text-body-md text-on-surface-variant mb-3 line-clamp-2">{t.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-label-md text-label-md text-on-surface-variant">
                            {t.dueDate && (
                              <span className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">event</span>
                                กำหนดส่ง: {formatDate(t.dueDate)}
                              </span>
                            )}
                            {t.project && (
                              <span className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                                โปรเจกต์: {t.project.name}
                              </span>
                            )}
                            {t.meeting && (
                              <span className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">groups</span>
                                จาก: {t.meeting.title}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const config = {
    NOT_STARTED: { label: "Not Started", icon: "hourglass_empty", cls: "bg-surface-variant text-on-surface-variant" },
    IN_PROGRESS: { label: "In Progress", icon: "progress_activity", cls: "bg-tertiary-fixed/30 text-on-tertiary-fixed-variant" },
    COMPLETED: { label: "Completed", icon: "check_circle", cls: "bg-secondary-container/40 text-on-secondary-container" },
  }[status];

  return (
    <span className={`px-3 py-1 rounded-full font-label-md text-label-md flex items-center gap-1 whitespace-nowrap ${config.cls}`}>
      <span className="material-symbols-outlined text-[14px]">{config.icon}</span>
      {config.label}
    </span>
  );
}
