"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { projectStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import type { Project } from "@prisma/client";

type ProjectRow = Project & {
  progress: number;
  _count: { meetings: number; tasks: number };
  members: { personId: string }[];
};

export default function ProjectsPage() {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: ProjectRow[] }>("/api/projects");
      setProjects(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-container-margin max-w-7xl mx-auto">
      <div className="mb-8 flex justify-between items-end flex-wrap gap-4">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background mb-2">โปรเจกต์ทั้งหมด</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">จัดการและติดตามสถานะโปรเจกต์ของทีมคุณ</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md font-medium flex items-center gap-2 shadow-sm hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          สร้างโปรเจกต์
        </button>
      </div>

      {loading && <FullPageSpinner />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && projects && projects.length === 0 && (
        <EmptyState icon="assignment" title="ยังไม่มีโปรเจกต์" description="สร้างโปรเจกต์แรกเพื่อเริ่มจัดการงานและการประชุม" />
      )}
      {!loading && !error && projects && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => {
            const badge = projectStatusBadge(p.status);
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] p-6 flex flex-col border border-transparent hover:border-outline-variant transition-colors group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant group-hover:bg-primary-container/10 group-hover:text-primary transition-colors">
                    <span className="material-symbols-outlined">folder</span>
                  </div>
                  <StatusBadge {...badge} />
                </div>
                <h3 className="font-headline-md text-headline-md mb-2 text-on-background group-hover:text-primary transition-colors">
                  {p.name}
                </h3>
                <p className="font-body-md text-body-md text-on-surface-variant mb-6 flex-1 line-clamp-2">
                  {p.description ?? ""}
                </p>
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-label-md text-label-md text-on-surface-variant">ความคืบหน้า</span>
                    <span className="font-label-md text-label-md font-semibold text-primary">{p.progress}%</span>
                  </div>
                  <div className="w-full bg-surface-container-high rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full" style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-outline-variant/50">
                  <span className="font-label-md text-label-md text-on-surface-variant">{p.members.length} ผู้เกี่ยวข้อง</span>
                  <div className="flex items-center gap-1 text-on-surface-variant">
                    <span className="material-symbols-outlined text-sm">calendar_month</span>
                    <span className="font-label-md text-label-md">{p._count.meetings} การประชุม</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          showToast("สร้างโปรเจกต์สำเร็จ", "success");
          load();
        }}
      />
    </div>
  );
}

function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/projects", { name, description, startDate, endDate });
      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างโปรเจกต์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
      <h2 className="font-headline-md text-headline-md text-on-surface">สร้างโปรเจกต์ใหม่</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">ชื่อโปรเจกต์</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">รายละเอียด</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="font-label-md text-label-md text-on-surface-variant block">วันที่เริ่ม</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
            />
          </div>
          <div className="space-y-1">
            <label className="font-label-md text-label-md text-on-surface-variant block">วันที่สิ้นสุด</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-outline-variant font-label-md">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md disabled:opacity-60"
          >
            {loading ? "กำลังสร้าง..." : "สร้างโปรเจกต์"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
