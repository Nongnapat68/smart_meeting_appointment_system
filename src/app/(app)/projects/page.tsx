"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { projectStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import type { Project } from "@prisma/client";

// PostgREST's embedded-count syntax (`members:ProjectMember(count)`) comes
// back as a one-element array (`[{ count: N }]`), not Prisma's nested
// `_count: { members: N }` shape — same pattern as Groups' GroupRow.
// `progress` isn't a DB column either way (see load() below).
type ProjectRow = Project & {
  progress: number;
  _count: { meetings: number; tasks: number };
  members: { count: number }[];
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
      // Hybrid migration (Projects resource, mirrors People/Groups) — GET
      // list -> supabase-js direct select, no new RPC needed (this is a
      // read). `progress` isn't a DB column — the old route computed it
      // from two separate prisma.task.count() calls PER project (an N+1
      // pattern); tasks:Task(status) pulls just the status column here
      // instead, so it's computed the same way below but in this one round
      // trip covering every project, not N extra queries.
      const { data: items, error: dbError } = await createClient()
        .from("Project")
        .select(
          `*,
          manager:User(id,name,avatarUrl),
          members:ProjectMember(count),
          meetings:Meeting(count),
          tasks:Task(status)`
        )
        .order("createdAt", { ascending: false });
      if (dbError) throw new Error(dbError.message);

      const rows = (items ?? []).map((p) => {
        const taskTotal = p.tasks.length;
        const taskCompleted = p.tasks.filter((t: { status: string }) => t.status === "COMPLETED").length;
        return {
          ...p,
          progress: taskTotal > 0 ? Math.round((taskCompleted / taskTotal) * 100) : 0,
          _count: { meetings: p.meetings[0]?.count ?? 0, tasks: taskTotal },
        };
      });
      setProjects(rows as ProjectRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
                  <span className="font-label-md text-label-md text-on-surface-variant">{p.members[0]?.count ?? 0} ผู้เกี่ยวข้อง</span>
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
      // Hybrid migration (Projects resource) — POST create -> direct
      // .insert(). Confirmed from this very form's submit payload (no
      // memberIds field anywhere on it) that project creation never seeds
      // ProjectMember rows, so this is a genuine single-table write with
      // no need for update_project_with_members()'s atomic multi-table
      // replace — that RPC exists for the *edit* member-replace case only
      // (see prisma/migrations/20260912090000_update_project_with_members_function).
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      // Project.id and updatedAt have no DB default (Prisma's
      // @default(cuid()) / @updatedAt are client-side-only, same as every
      // other direct insert in this migration) — both supplied explicitly.
      // status is left out to fall back on the DB's own DEFAULT 'ACTIVE',
      // same value the zod schema defaulted to server-side, since this
      // form never offers a status choice.
      const { error: dbError } = await supabase.from("Project").insert({
        id: crypto.randomUUID(),
        name,
        description: description || null,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        managerId: authData.user.id,
        updatedAt: new Date().toISOString(),
      });
      if (dbError) throw new Error(dbError.message);
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
