"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { reminderStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateTime } from "@/lib/format";
import type { Meeting, MeetingParticipant, Person, Reminder, ReminderStatus } from "@prisma/client";

type ReminderRow = Reminder & {
  meeting: Meeting & { participants: (MeetingParticipant & { person: Person })[] };
};

export default function RemindersPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ReminderRow[]>([]);
  const [counts, setCounts] = useState<Record<ReminderStatus, number>>({
    PENDING: 0,
    SENT: 0,
    FAILED: 0,
    CANCELLED: 0,
  });
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<ReminderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : "";
      const res = await api.get<{ items: ReminderRow[]; counts: Record<ReminderStatus, number> }>(
        `/api/reminders${params}`
      );
      setItems(res.items);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(id: string) {
    setBusyId(id);
    try {
      await api.post(`/api/reminders/${id}/retry`);
      showToast("ส่งการแจ้งเตือนใหม่สำเร็จ", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ส่งไม่สำเร็จ", "error");
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await api.post(`/api/reminders/${id}/cancel`);
      showToast("ยกเลิกการแจ้งเตือนแล้ว", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ", "error");
    } finally {
      setBusyId(null);
      load();
    }
  }

  const total = counts.PENDING + counts.SENT + counts.FAILED + counts.CANCELLED;

  return (
    <div className="max-w-7xl mx-auto p-container-margin space-y-container-margin">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface">จัดการการแจ้งเตือน (Reminders)</h2>
          <p className="text-on-surface-variant mt-1">ตรวจสอบสถานะการส่งการแจ้งเตือนการประชุมทั้งหมด</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-stack-gap">
        <StatCard label="ทั้งหมด" value={total} icon="mark_email_read" onClick={() => setStatusFilter("")} active={!statusFilter} />
        <StatCard label="รอส่ง" value={counts.PENDING} icon="schedule" onClick={() => setStatusFilter("PENDING")} active={statusFilter === "PENDING"} />
        <StatCard label="ส่งแล้ว" value={counts.SENT} icon="check_circle" onClick={() => setStatusFilter("SENT")} active={statusFilter === "SENT"} />
        <StatCard
          label="ส่งไม่สำเร็จ"
          value={counts.FAILED}
          icon="error"
          onClick={() => setStatusFilter("FAILED")}
          active={statusFilter === "FAILED"}
          danger
        />
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        {loading && <FullPageSpinner />}
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState icon="notifications_off" title="ไม่มีการแจ้งเตือน" description="ยังไม่มีรายการในหมวดนี้" />
        )}
        {!loading && !error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="py-3 px-4 font-label-md text-label-md text-on-surface-variant">การประชุม</th>
                  <th className="py-3 px-4 font-label-md text-label-md text-on-surface-variant">เวลาที่แจ้งเตือน</th>
                  <th className="py-3 px-4 font-label-md text-label-md text-on-surface-variant">ผู้รับ</th>
                  <th className="py-3 px-4 font-label-md text-label-md text-on-surface-variant">สถานะ</th>
                  <th className="py-3 px-4 font-label-md text-label-md text-on-surface-variant text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {items.map((r) => {
                  const badge = reminderStatusBadge(r.status);
                  return (
                    <tr key={r.id} className={`hover:bg-surface-bright transition-colors ${r.status === "FAILED" ? "bg-error-container/10" : ""} ${r.status === "CANCELLED" ? "opacity-60" : ""}`}>
                      <td className="py-4 px-4">
                        <Link href={`/meetings/${r.meetingId}`} className="font-body-md text-body-md font-medium text-on-surface hover:text-primary">
                          {r.meeting.title}
                        </Link>
                        {r.meeting.location && (
                          <div className="text-xs text-on-surface-variant mt-0.5">{r.meeting.location}</div>
                        )}
                      </td>
                      <td className="py-4 px-4 text-on-surface-variant text-sm">{formatDateTime(r.scheduledAt)}</td>
                      <td className="py-4 px-4 text-sm text-on-surface-variant">{r.meeting.participants.length} คน</td>
                      <td className="py-4 px-4">
                        <StatusBadge {...badge} />
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.status === "FAILED" && (
                            <>
                              <button
                                onClick={() => setReasonModal(r)}
                                className="text-xs px-2 py-1 border border-outline rounded text-on-surface hover:bg-surface-container-low transition-colors font-label-md"
                              >
                                สาเหตุ
                              </button>
                              <button
                                onClick={() => retry(r.id)}
                                disabled={busyId === r.id}
                                className="text-xs px-2 py-1 bg-primary text-on-primary rounded hover:opacity-90 transition-colors font-label-md flex items-center gap-1 disabled:opacity-60"
                              >
                                <span className="material-symbols-outlined text-[14px]">replay</span> ลองใหม่
                              </button>
                            </>
                          )}
                          {r.status === "PENDING" && (
                            <button
                              onClick={() => cancel(r.id)}
                              disabled={busyId === r.id}
                              className="text-on-surface-variant hover:text-error transition-colors disabled:opacity-50"
                              title="ยกเลิกการแจ้งเตือน"
                            >
                              <span className="material-symbols-outlined text-[18px]">cancel</span>
                            </button>
                          )}
                          {r.status === "SENT" && (
                            <button
                              onClick={() => setReasonModal(r)}
                              className="text-on-surface-variant hover:text-primary transition-colors"
                              title="ดูรายละเอียด"
                            >
                              <span className="material-symbols-outlined text-[18px]">visibility</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reasonModal && (
        <ReasonModal reminder={reasonModal} onClose={() => setReasonModal(null)} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  onClick,
  active,
  danger,
}: {
  label: string;
  value: number;
  icon: string;
  onClick: () => void;
  active: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-card-padding rounded-xl border shadow-sm flex flex-col justify-between h-28 transition-all ${
        danger ? "bg-error-container border-error/20" : "bg-surface-container-lowest border-outline-variant"
      } ${active ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className={`font-label-md text-label-md ${danger ? "text-on-error-container" : "text-on-surface-variant"}`}>{label}</span>
        <span className={`material-symbols-outlined text-[20px] ${danger ? "text-error" : "text-primary"}`}>{icon}</span>
      </div>
      <span className={`font-display-lg text-display-lg ${danger ? "text-on-error-container" : "text-on-surface"}`}>{value}</span>
    </button>
  );
}

function ReasonModal({ reminder, onClose }: { reminder: ReminderRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-on-background/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-xl shadow-lg w-full max-w-md p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-headline-md text-headline-md text-on-surface">{reminder.meeting.title}</h3>
        <div className="space-y-2 font-body-md text-body-md text-on-surface-variant">
          <p>เวลาที่กำหนดส่ง: {formatDateTime(reminder.scheduledAt)}</p>
          {reminder.sentAt && <p>ส่งเมื่อ: {formatDateTime(reminder.sentAt)}</p>}
          <p>จำนวนครั้งที่ลองส่ง: {reminder.retryCount}</p>
          {reminder.failureReason && (
            <p className="text-error">สาเหตุที่ล้มเหลว: {reminder.failureReason}</p>
          )}
        </div>
        <button onClick={onClose} className="mt-2 px-4 py-2 rounded-lg border border-outline-variant font-label-md self-end">
          ปิด
        </button>
      </div>
    </div>
  );
}
