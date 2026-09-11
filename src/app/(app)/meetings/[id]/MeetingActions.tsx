"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/Feedback";
import { toDatetimeLocalValue } from "@/lib/format";
import type { MeetingWithStringDates } from "./types";

export function MeetingActions({ meeting }: { meeting: MeetingWithStringDates }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [showReschedule, setShowReschedule] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const isCancelled = meeting.status === "CANCELLED";
  const isLink = meeting.location?.startsWith("http");

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.post(`/api/meetings/${meeting.id}/cancel`);
      showToast("ยกเลิกการประชุมแล้ว", "success");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ", "error");
    } finally {
      setCancelling(false);
      setShowCancel(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 self-stretch lg:self-auto border-t lg:border-t-0 border-outline-variant/30 pt-4 lg:pt-0 w-full lg:w-auto justify-end flex-wrap">
        {/* FR-08: downloads a real .ics built server-side from this meeting's
            current data — available regardless of status, so a cancelled
            meeting's invite can still be removed from a calendar app. */}
        <a
          href={`/api/meetings/${meeting.id}/ics`}
          title="ดาวน์โหลดไฟล์ปฏิทิน (.ics)"
          className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          <span className="hidden sm:inline">.ics</span>
        </a>
        {!isCancelled && (
          <>
            <Link
              href={`/meetings/${meeting.id}/edit`}
              className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="hidden sm:inline">แก้ไข</span>
            </Link>
            <button
              onClick={() => setShowReschedule(true)}
              className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">schedule</span>
              <span className="hidden sm:inline">เลื่อนเวลา</span>
            </button>
            <button
              onClick={() => setShowCancel(true)}
              className="px-4 py-2 rounded-lg bg-error-container text-on-error-container hover:bg-error hover:text-on-error transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
              <span className="hidden sm:inline">ยกเลิก</span>
            </button>
            {meeting.location && (
              <a
                href={isLink ? meeting.location! : undefined}
                target={isLink ? "_blank" : undefined}
                rel={isLink ? "noreferrer" : undefined}
                className={`px-5 py-2.5 rounded-lg bg-primary text-on-primary hover:opacity-90 transition-all font-body-md font-medium shadow-[0_2px_8px_rgba(53,37,205,0.3)] flex items-center gap-2 ml-2 ${!isLink ? "cursor-default opacity-70" : ""}`}
              >
                <span className="material-symbols-outlined text-[18px]">login</span>
                เข้าร่วม
              </a>
            )}
          </>
        )}
      </div>

      <RescheduleModal
        meeting={meeting}
        open={showReschedule}
        onClose={() => setShowReschedule(false)}
        onDone={() => {
          setShowReschedule(false);
          showToast("เลื่อนเวลาการประชุมสำเร็จ", "success");
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={showCancel}
        title="ยกเลิกการประชุมนี้?"
        description={`คุณต้องการยกเลิกการประชุม "${meeting.title}" ใช่หรือไม่ ผู้เข้าร่วมทั้งหมดจะเห็นสถานะการยกเลิก`}
        confirmLabel="ยกเลิกการประชุม"
        icon="cancel"
        destructive
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
    </>
  );
}

function RescheduleModal({
  meeting,
  open,
  onClose,
  onDone,
}: {
  meeting: MeetingWithStringDates;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [startTime, setStartTime] = useState(toDatetimeLocalValue(meeting.startTime));
  const [endTime, setEndTime] = useState(toDatetimeLocalValue(meeting.endTime));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post(`/api/meetings/${meeting.id}/reschedule`, {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เลื่อนเวลาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md">
      <h2 className="font-headline-md text-headline-md text-on-surface">เลื่อนเวลาการประชุม</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">เวลาเริ่มใหม่</label>
          <input
            type="datetime-local"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">เวลาสิ้นสุดใหม่</label>
          <input
            type="datetime-local"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
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
            {loading ? "กำลังบันทึก..." : "ยืนยันเลื่อนเวลา"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
