"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import type { ContactGroup } from "@prisma/client";

type GroupRow = ContactGroup & { _count: { members: number } };

const ICON_CHOICES = ["group", "work", "gavel", "campaign", "hub", "diversity_3"];

export default function GroupsPage() {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: GroupRow[] }>("/api/groups");
      setGroups(res.items);
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
    <div className="p-container-margin max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">กลุ่มผู้ติดต่อ</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">จัดการกลุ่มและสมาชิกสำหรับการนัดหมาย</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center justify-center gap-2 bg-primary text-on-primary font-body-md py-2 px-4 rounded-lg shadow-sm hover:opacity-90 transition-colors"
        >
          <span className="material-symbols-outlined">group_add</span>
          สร้างกลุ่มใหม่
        </button>
      </div>

      {loading && <FullPageSpinner />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && groups && groups.length === 0 && (
        <EmptyState icon="group_off" title="ยังไม่มีกลุ่ม" description="สร้างกลุ่มแรกของคุณเพื่อเริ่มจัดกลุ่มผู้ติดต่อ" />
      )}
      {!loading && !error && groups && groups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/30 shadow-[0_4px_15px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.08)] transition-all duration-300 flex flex-col group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -z-0" />
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="w-12 h-12 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined icon-fill">{g.icon}</span>
                </div>
              </div>
              <div className="mb-6 relative z-10">
                <h3 className="font-headline-md text-headline-md text-on-background mb-1">{g.name}</h3>
                <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">person</span>
                  {g._count.members} สมาชิก
                </p>
              </div>
              {g.description && (
                <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">{g.description}</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <CreateGroupModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          showToast("สร้างกลุ่มสำเร็จ", "success");
          load();
        }}
      />
    </div>
  );
}

function CreateGroupModal({
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
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/groups", { name, description, icon });
      setName("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างกลุ่มไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md">
      <h2 className="font-headline-md text-headline-md text-on-surface">สร้างกลุ่มใหม่</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">ชื่อกลุ่ม</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">คำอธิบาย</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest resize-none"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">ไอคอน</label>
          <div className="flex gap-2 flex-wrap">
            {ICON_CHOICES.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(ic)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
                  icon === ic ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface-variant"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{ic}</span>
              </button>
            ))}
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
            {loading ? "กำลังสร้าง..." : "สร้างกลุ่ม"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
