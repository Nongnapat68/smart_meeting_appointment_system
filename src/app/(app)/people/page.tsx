"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { personStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import type { Person, ContactGroupMember, ContactGroup } from "@prisma/client";

type PersonRow = Person & { groupMemberships: (ContactGroupMember & { group: ContactGroup })[] };

interface PeopleResponse {
  items: PersonRow[];
  total: number;
  stats: { totalAll: number; totalActive: number; totalExternal: number };
}

export default function PeoplePage() {
  const { showToast } = useToast();
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("pageSize", "50");
      const res = await api.get<PeopleResponse>(`/api/people?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-container-margin max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">ผู้คน (Contacts)</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            จัดการรายชื่อผู้ติดต่อทั้งภายในและภายนอกสถาบัน
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          เพิ่มผู้ติดต่อ
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatTile label="ทั้งหมด" value={data.stats.totalAll} icon="group" color="text-primary" />
          <StatTile label="ใช้งานอยู่" value={data.stats.totalActive} icon="verified" color="text-secondary" />
          <StatTile label="บุคคลภายนอก" value={data.stats.totalExternal} icon="domain" color="text-on-surface-variant" />
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl ambient-shadow border border-outline-variant/30 overflow-hidden">
        <div className="p-4 border-b border-outline-variant/30">
          <div className="relative max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
              search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ, อีเมล, แผนก..."
              className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-full font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>
        </div>

        {loading && <FullPageSpinner />}
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {!loading && !error && data && data.items.length === 0 && (
          <EmptyState icon="person_off" title="ไม่พบผู้ติดต่อ" description="ลองค้นหาด้วยคำอื่น หรือเพิ่มผู้ติดต่อใหม่" />
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-bright border-b border-outline-variant/50">
                  <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">ชื่อ</th>
                  <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider hidden md:table-cell">
                    อีเมล
                  </th>
                  <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">ประเภท</th>
                  <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                    กลุ่มที่สังกัด
                  </th>
                  <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30 font-body-md text-body-md">
                {data.items.map((p) => {
                  const badge = personStatusBadge(p.status);
                  return (
                    <tr key={p.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="p-4">
                        <Link href={`/people/${p.id}`} className="flex items-center gap-3">
                          <Avatar name={p.name} src={p.avatarUrl} size={32} />
                          <div>
                            <div className="font-medium text-on-background">{p.name}</div>
                            <div className="text-xs text-on-surface-variant md:hidden">{p.email}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="p-4 text-on-surface-variant hidden md:table-cell">{p.email}</td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-surface-container-high text-on-surface">
                          {p.type === "INTERNAL" ? "ผู้ใช้งานในระบบ" : "บุคคลภายนอก"}
                        </span>
                      </td>
                      <td className="p-4 text-on-surface-variant">
                        {p.groupMemberships.length > 0
                          ? p.groupMemberships.map((m) => m.group.name).join(", ")
                          : "-"}
                      </td>
                      <td className="p-4">
                        <StatusBadge {...badge} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="p-4 border-t border-outline-variant/30 text-body-md text-on-surface-variant bg-surface-bright">
            แสดง {data.items.length} จาก {data.total} รายการ
          </div>
        )}
      </div>

      <AddPersonModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => {
          setShowAddModal(false);
          showToast("เพิ่มผู้ติดต่อสำเร็จ", "success");
          load();
        }}
      />
    </div>
  );
}

function StatTile({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className="bg-surface-container-lowest p-card-padding rounded-xl ambient-shadow border border-outline-variant/30 flex items-center justify-between">
      <div>
        <p className="font-label-md text-on-surface-variant mb-1">{label}</p>
        <p className={`font-headline-md text-headline-md ${color === "text-on-surface-variant" ? "text-on-background" : color}`}>
          {value.toLocaleString("th-TH")}
        </p>
      </div>
      <div className={`w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center ${color}`}>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
    </div>
  );
}

function AddPersonModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState<"INTERNAL" | "EXTERNAL">("EXTERNAL");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/people", { name, email, phone, title, department, type });
      setName("");
      setEmail("");
      setPhone("");
      setTitle("");
      setDepartment("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มผู้ติดต่อไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
      <h2 className="font-headline-md text-headline-md text-on-surface">เพิ่มผู้ติดต่อใหม่</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="ชื่อ-นามสกุล" value={name} onChange={setName} required />
        <Field label="อีเมล" value={email} onChange={setEmail} type="email" required />
        <div className="grid grid-cols-2 gap-4">
          <Field label="เบอร์โทรศัพท์" value={phone} onChange={setPhone} />
          <Field label="ตำแหน่ง" value={title} onChange={setTitle} />
        </div>
        <Field label="แผนก" value={department} onChange={setDepartment} />
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">ประเภท</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "INTERNAL" | "EXTERNAL")}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md"
          >
            <option value="EXTERNAL">บุคคลภายนอก</option>
            <option value="INTERNAL">ผู้ใช้งานในระบบ (ยังไม่มีบัญชี)</option>
          </select>
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
            {loading ? "กำลังบันทึก..." : "เพิ่มผู้ติดต่อ"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="font-label-md text-label-md text-on-surface-variant block">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md focus:ring-2 focus:ring-primary focus:border-primary"
      />
    </div>
  );
}
