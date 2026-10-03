"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { dbWriteErrorMessage } from "@/lib/db-errors";

const PROJECT_DELETE_RULE = "เฉพาะผู้จัดการโปรเจกต์หรือผู้ดูแลระบบเท่านั้น";

/**
 * Deletes a project created by mistake. Only an empty project can go: the DB
 * refuses (FK RESTRICT, SQLSTATE 23503) while any meeting or task still
 * points at it — see migration 20261003110100_project_delete_only_when_empty.
 * The counts come from the server render, so a non-empty project gets an
 * explanation instead of a confirm; the 23503 branch covers a meeting/task
 * linked after the page was loaded.
 */
export function ProjectDeleteButton({
  projectId,
  projectName,
  meetingCount,
  taskCount,
}: {
  projectId: string;
  projectName: string;
  meetingCount: number;
  taskCount: number;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isEmpty = meetingCount === 0 && taskCount === 0;

  async function deleteProject() {
    setDeleting(true);
    try {
      // RLS delete_manager_or_admin: a blocked DELETE matches 0 rows silently.
      const { data, error } = await createClient().from("Project").delete().eq("id", projectId).select("id");
      if (error?.code === "23503") {
        throw new Error("ลบไม่ได้ เพราะยังมีการประชุมหรืองานผูกอยู่กับโปรเจกต์นี้ กรุณารีเฟรชหน้าแล้วตรวจสอบอีกครั้ง");
      }
      if (error) throw new Error(dbWriteErrorMessage(error, "ลบโปรเจกต์", PROJECT_DELETE_RULE));
      if (!data || data.length === 0) throw new Error(`คุณไม่มีสิทธิ์ลบโปรเจกต์นี้ — ${PROJECT_DELETE_RULE}`);
      showToast("ลบโปรเจกต์แล้ว", "success");
      router.push("/projects");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบโปรเจกต์ไม่สำเร็จ", "error");
      setDeleting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 border border-error/40 text-error rounded-lg font-label-md text-label-md hover:bg-error-container/30 transition-colors inline-flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[18px]">delete</span>
        ลบโปรเจกต์
      </button>

      {isEmpty ? (
        <ConfirmDialog
          open={open}
          title="ลบโปรเจกต์นี้?"
          description={`โปรเจกต์ "${projectName}" และรายชื่อสมาชิกของโปรเจกต์จะถูกลบถาวร ไม่สามารถย้อนกลับได้`}
          confirmLabel="ลบโปรเจกต์"
          destructive
          icon="delete_forever"
          loading={deleting}
          onConfirm={deleteProject}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <Modal open={open} onClose={() => setOpen(false)} maxWidth="max-w-md">
          <h2 className="font-headline-md text-headline-md text-on-surface">ลบโปรเจกต์นี้ไม่ได้</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            ลบได้เฉพาะโปรเจกต์ที่ยังไม่มีการประชุมหรืองานผูกอยู่ เพื่อไม่ให้ประวัติการประชุม บันทึก มติ และงานของโปรเจกต์สูญหาย
          </p>
          <ul className="list-disc pl-6 font-body-md text-body-md text-on-surface">
            {meetingCount > 0 && <li>การประชุม {meetingCount} รายการ</li>}
            {taskCount > 0 && <li>งาน {taskCount} รายการ</li>}
          </ul>
          <p className="font-body-md text-body-md text-on-surface-variant">
            หากโปรเจกต์นี้สร้างผิดจริง ให้ย้ายออกก่อน: งาน — แก้ไขงานแล้วเลือก &quot;ไม่ผูกกับโปรเจกต์&quot; หรือลบงาน
            ส่วนการประชุมที่ยังไม่เริ่ม — แก้ไขการประชุมให้เป็นประเภท &quot;ครั้งเดียว&quot; การประชุมที่ผ่านไปแล้ว (รวมที่ยกเลิกแล้ว)
            ถือเป็นประวัติของโปรเจกต์ จึงทำให้ลบโปรเจกต์ไม่ได้
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded-lg border border-outline-variant font-label-md text-label-md"
            >
              ปิด
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
