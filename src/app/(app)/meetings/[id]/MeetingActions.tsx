"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/Feedback";
import { DateTimeField } from "@/components/meetings/DateTimeField";
import { toDatetimeLocalValue } from "@/lib/format";
import type { MeetingWithStringDates } from "./types";

export function MeetingActions({ meeting, canManage }: { meeting: MeetingWithStringDates; canManage: boolean }) {
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
      // Hybrid migration round 1 (Meeting resource), step D: cancel never
      // sent email/notification even before this (see the old POST
      // /api/meetings/[id]/cancel, kept in place but no longer called from
      // here — test:authz still exercises it directly), so it's a pure
      // single-table write — straight through supabase-js, no notify call
      // needed. The old route's assertOwner(organizer-or-admin) 403 is now
      // the "update_organizer_or_admin" RLS policy on Meeting; unlike a REST
      // 403, a blocked UPDATE just matches 0 rows silently, so .select()
      // + checking for a null result is what surfaces that as an error here.
      const supabase = createClient();
      const { data, error } = await supabase
        .from("Meeting")
        .update({ status: "CANCELLED" })
        .eq("id", meeting.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ยกเลิกการประชุมนี้ได้");
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
            {/* N12: edit / reschedule / cancel are all writes on the Meeting
                row, so they follow "update_organizer_or_admin" — organizer or
                admin only (canManage, see src/lib/permissions.ts). Read-only
                actions (.ics download, "เข้าร่วม") stay available to everyone,
                since select_all_authenticated lets any signed-in user open the
                meeting in the first place. */}
            {canManage && (
              <>
                <Link
                  href={`/meetings/${meeting.id}/edit`}
                  className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                  <span className="hidden sm:inline">แก้ไข</span>
                </Link>
                <button
                  onClick={() => setShowReschedule(true)}
                  className="px-4 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container transition-colors font-body-md font-medium shadow-sm flex items-center gap-2"
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
              </>
            )}
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

      {/* Mounted only while open, so every open starts from the meeting's
          current times (after router.refresh()) instead of the times it had
          when this component first rendered. */}
      {canManage && showReschedule && (
        <RescheduleModal
          meeting={meeting}
          onClose={() => setShowReschedule(false)}
          onDone={() => {
            setShowReschedule(false);
            showToast("เลื่อนเวลาการประชุมสำเร็จ", "success");
            router.refresh();
          }}
        />
      )}

      {canManage && (
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
      )}
    </>
  );
}

function RescheduleModal({
  meeting,
  onClose,
  onDone,
}: {
  meeting: MeetingWithStringDates;
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
      // Same checks as MeetingForm.tsx's handleSubmit (the RPC repeats them).
      if (!startTime || !endTime) throw new Error("กรุณากำหนดเวลาเริ่มและเวลาสิ้นสุด");
      if (new Date(startTime) < new Date()) throw new Error("เวลาเริ่มต้องไม่เป็นอดีต (ย้อนหลัง)");
      if (new Date(endTime) <= new Date(startTime)) throw new Error("เวลาสิ้นสุดต้องมาหลังเวลาเริ่ม");

      // One atomic RPC moves the meeting and shifts every PENDING reminder by
      // the same delta, so each keeps its original offset (e.g. "1 day
      // before") — see prisma/migrations/20261002100000_reschedule_meeting_function.
      const { error: rpcError } = await createClient().rpc("reschedule_meeting", {
        p_meeting_id: meeting.id,
        p_start_time: new Date(startTime).toISOString(),
        p_end_time: new Date(endTime).toISOString(),
      });
      if (rpcError) throw new Error(rpcError.message);

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เลื่อนเวลาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md">
      <h2 className="font-headline-md text-headline-md text-on-surface">เลื่อนเวลาการประชุม</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
{/* Same pair of pickers as MeetingForm.tsx's "เวลาและสถานที่" section. */}
        <DateTimeField label="เวลาเริ่มใหม่" value={startTime} onChange={setStartTime} />
        <DateTimeField
          label="เวลาสิ้นสุดใหม่"
          value={endTime}
          onChange={setEndTime}
          minDateKey={startTime.slice(0, 10)}
        />
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
