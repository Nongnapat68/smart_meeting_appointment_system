"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { meetingStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatTimeRange } from "@/lib/format";
import type { Meeting, MeetingParticipant, Person } from "@prisma/client";

type MeetingRow = Meeting & {
  organizer: { name: string; avatarUrl: string | null } | null;
  project: { name: string } | null;
  participants: (MeetingParticipant & { person: Person })[];
};

const PAGE_SIZE = 10;

export default function MeetingsPage() {
  const [data, setData] = useState<{ items: MeetingRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const res = await api.get<{ items: MeetingRow[]; total: number }>(`/api/meetings?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [q, status, type, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => setPage(1), [q, status, type]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <main className="p-container-margin w-full max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-container-margin">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">การประชุมทั้งหมด</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">จัดการและติดตามนัดหมายของคุณ</p>
        </div>
        <Link
          href="/meetings/new"
          className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md shadow-sm hover:opacity-90 transition-colors flex items-center justify-center gap-2 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined">add</span>
          สร้างการประชุมใหม่
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-stack-gap mb-container-margin bg-surface-container-lowest p-card-padding rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-surface-container-low">
        <div className="col-span-1 md:col-span-2 relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาตามหัวข้อ..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-outline-variant bg-surface focus:border-primary focus:ring-1 focus:ring-primary text-body-md font-body-md outline-none transition-all"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface text-body-md font-body-md outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        >
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอดำเนินการ</option>
          <option value="ACTIVE">ยืนยันแล้ว</option>
          <option value="COMPLETED">เสร็จสิ้น</option>
          <option value="CANCELLED">ยกเลิก</option>
          <option value="POSTPONED">เลื่อน</option>
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg border border-outline-variant bg-surface text-body-md font-body-md outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        >
          <option value="">ทุกประเภท</option>
          <option value="SINGLE">ครั้งเดียว</option>
          <option value="PROJECT">โครงการ</option>
        </select>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-surface-container-low overflow-hidden">
        {loading && <FullPageSpinner />}
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {!loading && !error && data && data.items.length === 0 && (
          <EmptyState icon="event_busy" title="ไม่พบการประชุม" description="ลองปรับตัวกรอง หรือสร้างการประชุมใหม่" />
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low/50 border-b border-outline-variant">
                  <th className="py-4 px-6 font-label-md text-label-md text-on-surface-variant font-semibold w-1/3">หัวข้อ</th>
                  <th className="py-4 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">วันที่/เวลา</th>
                  <th className="py-4 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">ประเภท</th>
                  <th className="py-4 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">สถานะ</th>
                  <th className="py-4 px-6 font-label-md text-label-md text-on-surface-variant font-semibold">ผู้จัด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50">
                {data.items.map((m) => {
                  const badge = meetingStatusBadge(m.status);
                  const isCancelled = m.status === "CANCELLED";
                  return (
                    <tr key={m.id} className={`hover:bg-surface-container-low/30 transition-colors group ${isCancelled ? "opacity-75" : ""}`}>
                      <td className="py-4 px-6">
                        <Link href={`/meetings/${m.id}`} className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary shrink-0">
                            <span className="material-symbols-outlined">
                              {m.type === "PROJECT" ? "repeat" : "event"}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className={`font-body-md text-body-md font-medium text-on-background group-hover:text-primary transition-colors truncate ${isCancelled ? "line-through decoration-outline" : ""}`}>
                              {m.title}
                            </p>
                            <p className="font-label-md text-label-md text-on-surface-variant mt-0.5 truncate">
                              {m.location || (m.project ? m.project.name : "-")}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <p className="font-body-md text-body-md text-on-background">{formatDate(m.startTime)}</p>
                        <p className="font-label-md text-label-md text-on-surface-variant mt-0.5">
                          {formatTimeRange(m.startTime, m.endTime)}
                        </p>
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-md text-label-md border border-outline-variant/50">
                          {m.type === "PROJECT" ? "โครงการ" : "ครั้งเดียว"}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <StatusBadge {...badge} />
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <Avatar name={m.organizer?.name ?? "?"} src={m.organizer?.avatarUrl} size={24} />
                          <span className="font-body-md text-body-md text-on-surface-variant">{m.organizer?.name ?? "-"}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="px-6 py-4 border-t border-outline-variant bg-surface flex items-center justify-between flex-wrap gap-2">
            <p className="font-label-md text-label-md text-on-surface-variant">
              แสดง {(page - 1) * PAGE_SIZE + 1} ถึง {Math.min(page * PAGE_SIZE, data.total)} จาก {data.total} รายการ
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded-md text-outline hover:text-primary hover:bg-surface-container-low transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <span className="font-label-md text-label-md text-on-surface-variant px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded-md text-outline hover:text-primary hover:bg-surface-container-low transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
