"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";
import type { ContactGroup, ContactGroupMember, Meeting, Person } from "@prisma/client";

type GroupDetail = ContactGroup & {
  members: (ContactGroupMember & { person: Person })[];
  meetings: Meeting[];
};

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showDeleteGroup, setShowDeleteGroup] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ group: GroupDetail }>(`/api/groups/${params.id}`);
      setGroup(res.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function removeMember(personId: string) {
    setRemovingId(personId);
    try {
      await api.delete(`/api/groups/${params.id}/members/${personId}`);
      showToast("ลบสมาชิกออกจากกลุ่มแล้ว", "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบสมาชิกไม่สำเร็จ", "error");
    } finally {
      setRemovingId(null);
    }
  }

  async function deleteGroup() {
    setDeleting(true);
    try {
      await api.delete(`/api/groups/${params.id}`);
      showToast("ลบกลุ่มสำเร็จ", "success");
      router.push("/groups");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบกลุ่มไม่สำเร็จ", "error");
      setDeleting(false);
      setShowDeleteGroup(false);
    }
  }

  if (loading) return <FullPageSpinner />;
  if (error || !group) return <div className="p-container-margin"><ErrorBanner message={error ?? "ไม่พบกลุ่มนี้"} /></div>;

  return (
    <main className="p-container-margin max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center text-sm font-label-md text-on-surface-variant mb-1">
            <Link href="/groups" className="hover:text-primary transition-colors">
              กลุ่ม
            </Link>
            <span className="material-symbols-outlined text-[16px] mx-1">chevron_right</span>
            <span className="text-on-surface">รายละเอียดกลุ่ม</span>
          </div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface mt-2">{group.name}</h2>
          {group.description && (
            <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-2xl">{group.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowAddMember(true)}
            className="flex items-center gap-2 bg-surface text-primary border border-outline-variant font-label-md text-label-md py-2.5 px-4 rounded-lg shadow-sm hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            เพิ่มสมาชิก
          </button>
          <Link
            href={`/meetings/new?groupId=${group.id}`}
            className="flex items-center gap-2 bg-primary text-on-primary font-label-md text-label-md py-2.5 px-4 rounded-lg shadow-sm hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            นัดประชุมกลุ่มนี้
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon="groups" label="จำนวนสมาชิก" value={`${group.members.length} คน`} />
        <StatCard icon="calendar_today" label="วันที่สร้างกลุ่ม" value={formatDate(group.createdAt)} />
        <StatCard icon="forum" label="การประชุมที่ผ่านมา" value={`${group.meetings.length} ครั้ง`} />
      </div>

      <div className="bg-surface-container-lowest rounded-xl ambient-shadow border border-surface-container-high overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-container-high flex justify-between items-center">
          <h3 className="font-headline-md text-[18px] text-on-surface">รายชื่อสมาชิก ({group.members.length})</h3>
        </div>
        {group.members.length === 0 ? (
          <EmptyState icon="person_off" title="ยังไม่มีสมาชิก" description="เพิ่มสมาชิกคนแรกของกลุ่มนี้" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-surface-container-high">
                  <th className="py-3 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">สมาชิก</th>
                  <th className="py-3 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">ตำแหน่ง</th>
                  <th className="py-3 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">สถานะในกลุ่ม</th>
                  <th className="py-3 px-6 font-label-md text-label-md text-on-surface-variant font-semibold text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="font-body-md text-body-md divide-y divide-surface-container-high">
                {group.members.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-container-lowest transition-colors">
                    <td className="py-4 px-6">
                      <Link href={`/people/${m.personId}`} className="flex items-center gap-3">
                        <Avatar name={m.person.name} src={m.person.avatarUrl} size={40} />
                        <div>
                          <p className="font-medium text-on-surface">{m.person.name}</p>
                          <p className="text-on-surface-variant text-xs">{m.person.email}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="py-4 px-6 text-on-surface-variant">{m.person.title ?? "-"}</td>
                    <td className="py-4 px-6">
                      {m.role === "LEADER" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-fixed text-on-primary-fixed-variant border border-primary-fixed-dim">
                          หัวหน้ากลุ่ม
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">สมาชิก</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => removeMember(m.personId)}
                        disabled={removingId === m.personId}
                        className="text-outline hover:text-error transition-colors p-2 rounded-full hover:bg-error-container disabled:opacity-50"
                        title="ลบสมาชิก"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pt-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-error-container/30 p-5 rounded-xl border border-error-container">
          <div>
            <h4 className="font-headline-md text-[16px] text-on-error-container">ลบกลุ่มนี้</h4>
            <p className="font-body-md text-sm text-on-surface-variant mt-1">
              การลบกลุ่มจะไม่สามารถกู้คืนข้อมูลกลุ่มและสมาชิกในกลุ่มได้
            </p>
          </div>
          <button
            onClick={() => setShowDeleteGroup(true)}
            className="flex items-center gap-2 bg-error text-on-error font-label-md text-label-md py-2.5 px-5 rounded-lg shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            ลบกลุ่ม
          </button>
        </div>
      </div>

      <AddMemberModal
        groupId={group.id}
        existingPersonIds={group.members.map((m) => m.personId)}
        open={showAddMember}
        onClose={() => setShowAddMember(false)}
        onAdded={() => {
          setShowAddMember(false);
          showToast("เพิ่มสมาชิกสำเร็จ", "success");
          load();
        }}
      />

      <ConfirmDialog
        open={showDeleteGroup}
        title="ลบกลุ่มนี้?"
        description={`คุณต้องการลบกลุ่ม "${group.name}" ใช่หรือไม่ การกระทำนี้ไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบกลุ่ม"
        icon="delete_forever"
        destructive
        loading={deleting}
        onConfirm={deleteGroup}
        onCancel={() => setShowDeleteGroup(false)}
      />
    </main>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-5 ambient-shadow border border-surface-container-high">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed">
          <span className="material-symbols-outlined text-[24px]">{icon}</span>
        </div>
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">{label}</p>
          <p className="font-headline-md text-headline-md text-on-surface">{value}</p>
        </div>
      </div>
    </div>
  );
}

function AddMemberModal({
  groupId,
  existingPersonIds,
  open,
  onClose,
  onAdded,
}: {
  groupId: string;
  existingPersonIds: string[];
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Person[] }>(`/api/people?q=${encodeURIComponent(q)}&pageSize=20`);
        setResults(res.items.filter((p) => !existingPersonIds.includes(p.id)));
      } catch {
        // ignore search errors, keep previous results
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  async function addPerson(personId: string) {
    setAddingId(personId);
    setError(null);
    try {
      await api.post(`/api/groups/${groupId}/members`, { personId, role: "MEMBER" });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มสมาชิกไม่สำเร็จ");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md">
      <h2 className="font-headline-md text-headline-md text-on-surface">เพิ่มสมาชิกเข้ากลุ่ม</h2>
      {error && <ErrorBanner message={error} />}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
          search
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อผู้ติดต่อ..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
        />
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {results.length === 0 && <p className="text-on-surface-variant text-body-md py-4 text-center">ไม่พบผู้ติดต่อ</p>}
        {results.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-low">
            <Avatar name={p.name} src={p.avatarUrl} size={32} />
            <div className="flex-1 min-w-0">
              <p className="font-body-md text-body-md font-medium text-on-surface truncate">{p.name}</p>
              <p className="font-label-md text-label-md text-on-surface-variant truncate">{p.email}</p>
            </div>
            <button
              onClick={() => addPerson(p.id)}
              disabled={addingId === p.id}
              className="text-primary hover:bg-primary/10 p-2 rounded-full transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">add_circle</span>
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
