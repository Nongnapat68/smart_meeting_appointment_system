"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@prisma/client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/Feedback";

export function PersonActions({ person }: { person: Person }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      // delete_admin_only RLS policy replaces assertOwner(user, false, ...)
      // (this was already admin-only regardless of who the record belongs
      // to) — a blocked DELETE just matches 0 rows silently, so .select()
      // + checking for null is what turns that into a thrown error here.
      // MeetingParticipant.personId is onDelete: Restrict (BR-02), so a
      // person with meeting history still fails at the DB level (Postgres
      // 23503, foreign_key_violation) — translated to the same friendly
      // message the old app-level pre-check used to show.
      const supabase = createClient();
      const { data, error } = await supabase.from("Person").delete().eq("id", person.id).select().maybeSingle();
      if (error) {
        throw new Error(
          error.code === "23503"
            ? 'ไม่สามารถลบผู้ติดต่อนี้ได้เพราะมีประวัติเข้าร่วมประชุมอยู่ — เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน เพื่อไม่ให้ประวัติการประชุมหายไป'
            : error.message
        );
      }
      if (!data) throw new Error("เฉพาะผู้ดูแลระบบเท่านั้นที่ลบผู้ติดต่อได้ หรือไม่พบผู้ติดต่อนี้");

      showToast("ลบผู้ติดต่อสำเร็จ", "success");
      router.push("/people");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบไม่สำเร็จ", "error");
      setDeleting(false);
      setShowDelete(false);
    }
  }

  return (
    <>
      <div className="flex gap-2 w-full">
        <button
          onClick={() => setShowEdit(true)}
          className="flex-1 bg-surface-container-lowest text-on-surface border border-outline-variant font-label-md text-label-md py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-lg">edit</span>
          แก้ไข
        </button>
        <button
          onClick={() => setShowDelete(true)}
          className="flex-1 bg-surface-container-lowest text-error border border-error/30 font-label-md text-label-md py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:bg-error-container/30 transition-colors"
        >
          <span className="material-symbols-outlined text-lg">delete</span>
          ลบ
        </button>
      </div>

      <EditPersonModal
        person={person}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={() => {
          setShowEdit(false);
          showToast("บันทึกการเปลี่ยนแปลงสำเร็จ", "success");
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={showDelete}
        title="ลบผู้ติดต่อนี้?"
        description={`คุณต้องการลบ "${person.name}" ออกจากระบบใช่หรือไม่ การกระทำนี้ไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบผู้ติดต่อ"
        icon="delete_forever"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
    </>
  );
}

function EditPersonModal({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [title, setTitle] = useState(person.title ?? "");
  const [department, setDepartment] = useState(person.department ?? "");
  const [status, setStatus] = useState(person.status);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // update_unlinked_or_owner_or_admin RLS policy replaces assertOwner()'s
      // "!existing.userId || existing.userId === user.id" check — same 0-row
      // silent-block subtlety as handleDelete above.
      const supabase = createClient();
      const { data, error: dbError } = await supabase
        .from("Person")
        .update({ name, phone, title, department, status, updatedAt: new Date().toISOString() })
        .eq("id", person.id)
        .select()
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error("คุณไม่มีสิทธิ์แก้ไขข้อมูลผู้ติดต่อของผู้ใช้รายอื่น หรือไม่พบผู้ติดต่อนี้");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
      <h2 className="font-headline-md text-headline-md text-on-surface">แก้ไขผู้ติดต่อ</h2>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">ชื่อ-นามสกุล</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="font-label-md text-label-md text-on-surface-variant block">เบอร์โทรศัพท์</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
            />
          </div>
          <div className="space-y-1">
            <label className="font-label-md text-label-md text-on-surface-variant block">ตำแหน่ง</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">แผนก</label>
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          />
        </div>
        <div className="space-y-1">
          <label className="font-label-md text-label-md text-on-surface-variant block">สถานะ</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
            className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
          >
            <option value="ACTIVE">ใช้งาน</option>
            <option value="INACTIVE">ไม่ใช้งาน</option>
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
            {loading ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
