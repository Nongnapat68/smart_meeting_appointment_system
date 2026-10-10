"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { relativeTime } from "@/lib/format";
import { dbWriteErrorMessage, isHttpUrl } from "@/lib/db-errors";
import type { ResourceType } from "@prisma/client";
import type { NoteWithAuthor, DecisionWithUser, ResourceWithUser } from "./types";

// FR-11/12/13: Notes, Decisions and Related Resources — each its own entity,
// each supporting multiple rows per meeting, individually attributed.
//
// Hybrid migration (MeetingNote/Decision/RelatedResource round) — POST is
// the only thing here (no GET: initial rows arrive as
// initialNotes/initialDecisions/initialResources props, read by the parent
// page's own nested select back in Meeting round 1 — see ./types.ts). The
// old GET /api/meetings/[id]/{notes,decisions,resources} routes were removed
// in ข้อ 20 (nothing called them anymore); all writes here go through
// supabase-js + RLS.

// FR-11 AC3/AC4: who RLS lets add notes / decisions / resources — shown in
// the toast when a save is rejected, instead of the raw English RLS error.
const MEETING_CONTRIBUTOR_RULE = "เฉพาะผู้จัดประชุม ผู้เข้าร่วมประชุมนี้ หรือผู้ดูแลระบบเท่านั้น";

// FR-11/12/13 AC "แก้ไข/ลบ": the UPDATE and DELETE policies
// (update_/delete_organizer_or_participant_or_admin) use the identical rule to
// the INSERT one above, so they share its wording.
const MEETING_CONTRIBUTOR_RULE_ACTION =
  "เฉพาะผู้จัดประชุม ผู้เข้าร่วมประชุมนี้ หรือผู้ดูแลระบบเท่านั้นที่แก้ไขหรือลบรายการนี้ได้";

const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  LINK: "ลิงก์",
  DOCUMENT: "เอกสาร",
  FILE: "ไฟล์",
};

const RESOURCE_TYPE_ICON: Record<ResourceType, string> = {
  LINK: "link",
  DOCUMENT: "description",
  FILE: "attach_file",
};

export function MeetingNotesCard({
  meetingId,
  initialNotes,
}: {
  meetingId: string;
  initialNotes: NoteWithAuthor[];
}) {
  const { showToast } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !draft.trim()) return;
    setSaving(true);
    try {
      // update_organizer_or_participant_or_admin RLS policy — same rule as the
      // insert policy below. A blocked UPDATE matches 0 rows *silently* (no
      // thrown error, unlike a blocked INSERT's WITH CHECK violation), so
      // .select() + a null check is what surfaces it here. updatedAt is set
      // explicitly for the same client-side-only-default reason as on insert.
      const { data, error: dbError } = await createClient()
        .from("MeetingNote")
        .update({ content: draft.trim(), updatedAt: new Date().toISOString() })
        .eq("id", editingId)
        .select("*, author:User(name)")
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setNotes((prev) => prev.map((n) => (n.id === editingId ? (data as NoteWithAuthor) : n)));
      setEditingId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "แก้ไขบันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      // delete_organizer_or_participant_or_admin — same silent 0-row block and
      // the same .select() + null-check remedy as saveEdit above.
      const { data, error: dbError } = await createClient()
        .from("MeetingNote")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setNotes((prev) => prev.filter((n) => n.id !== id));
      showToast("ลบบันทึกการประชุมแล้ว", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบบันทึกไม่สำเร็จ", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      // insert_organizer_or_participant_or_admin RLS policy replaces
      // assertOwner() here. Same as TaskComment's insert: a blocked INSERT's
      // WITH CHECK raises a real Postgres error (42501), not a silent
      // no-op, so a plain throw on dbError is enough — no null-check dance
      // like UPDATE/DELETE need. MeetingNote.id has no DB default (Prisma's
      // @default(cuid()) is client-side-only) so it's supplied explicitly;
      // updatedAt has no DB default either (Prisma's @updatedAt is
      // client-side-only) so it goes stale/violates NOT NULL forever if
      // nothing sets it once Prisma is out of the write path; createdAt has
      // a real DB default (CURRENT_TIMESTAMP) so it's left out. author's
      // select shape matches the parent page's own notes:MeetingNote(*,
      // author:User(name)) embed exactly — this component only ever reads
      // author?.name, and NoteWithAuthor (./types.ts) declares nothing more.
      const { data, error: dbError } = await supabase
        .from("MeetingNote")
        .insert({
          id: crypto.randomUUID(),
          meetingId,
          authorId: authData.user.id,
          content,
          updatedAt: new Date().toISOString(),
        })
        .select("*, author:User(name)")
        .single();
      if (dbError) throw new Error(dbWriteErrorMessage(dbError, "เพิ่มบันทึกการประชุม", MEETING_CONTRIBUTOR_RULE));

      setNotes((prev) => [data as NoteWithAuthor, ...prev]);
      setContent("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "เพิ่มบันทึกไม่สำเร็จ", "error");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
      <h3 className="font-headline-md text-headline-md text-on-surface mb-3">บันทึกการประชุม ({notes.length})</h3>
      <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
        {notes.length === 0 && <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีบันทึกการประชุม</p>}
        {notes.map((n) => (
          <div key={n.id} className="p-3 rounded-lg bg-surface-container-low">
            {editingId === n.id ? (
              <form onSubmit={saveEdit} className="flex flex-col gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-xs font-label-md disabled:opacity-60"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-md disabled:opacity-60"
                  >
                    {saving ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">{n.content}</p>
                <div className="flex items-start justify-between gap-2 mt-1">
                  <p className="text-xs text-on-surface-variant">
                    {n.author?.name ?? "ไม่ทราบผู้บันทึก"} • {relativeTime(n.createdAt)}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(n.id);
                        setDraft(n.content);
                      }}
                      title="แก้ไขบันทึก"
                      className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button
                      onClick={() => remove(n.id)}
                      disabled={deletingId === n.id}
                      title="ลบบันทึก"
                      className="p-1 rounded-full text-on-surface-variant hover:bg-error-container hover:text-error transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 items-end">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="เพิ่มบันทึกการประชุม เช่น สรุปประเด็น, สิ่งที่ต้องติดตามต่อ..."
          className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm resize-none"
        />
        <button
          type="submit"
          disabled={posting || !content.trim()}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-60"
        >
          {posting ? "กำลังบันทึก..." : "เพิ่ม"}
        </button>
      </form>
    </div>
  );
}

export function MeetingDecisionsCard({
  meetingId,
  initialDecisions,
}: {
  meetingId: string;
  initialDecisions: DecisionWithUser[];
}) {
  const { showToast } = useToast();
  const [decisions, setDecisions] = useState(initialDecisions);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !draft.trim()) return;
    setSaving(true);
    try {
      // Same update_organizer_or_participant_or_admin policy and the same
      // silent-0-row remedy as MeetingNotesCard.saveEdit. Decision has no
      // updatedAt column — decidedAt is the decision's own timestamp and is not
      // meant to move when the wording is corrected — so nothing else is sent.
      const { data, error: dbError } = await createClient()
        .from("Decision")
        .update({ content: draft.trim() })
        .eq("id", editingId)
        .select("*, decidedBy:User(name)")
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setDecisions((prev) => prev.map((d) => (d.id === editingId ? (data as DecisionWithUser) : d)));
      setEditingId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "แก้ไขมติไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      // delete_organizer_or_participant_or_admin — same remedy as above.
      const { data, error: dbError } = await createClient()
        .from("Decision")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setDecisions((prev) => prev.filter((d) => d.id !== id));
      showToast("ลบมติที่ประชุมแล้ว", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบมติไม่สำเร็จ", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      // Same insert_organizer_or_participant_or_admin RLS policy shape as
      // MeetingNote above — plain throw on dbError, no null-check needed.
      // Decision.id has no DB default (client-side-only cuid()) so it's
      // supplied explicitly; decidedAt/createdAt both have real DB defaults
      // (CURRENT_TIMESTAMP) so neither is set here. decidedBy's select
      // shape matches the parent page's decisions:Decision(*,
      // decidedBy:User(name)) embed — DecisionWithUser (./types.ts)
      // declares nothing more than decidedBy.name.
      const { data, error: dbError } = await supabase
        .from("Decision")
        .insert({
          id: crypto.randomUUID(),
          meetingId,
          decidedById: authData.user.id,
          content,
        })
        .select("*, decidedBy:User(name)")
        .single();
      if (dbError) throw new Error(dbWriteErrorMessage(dbError, "บันทึกมติที่ประชุม", MEETING_CONTRIBUTOR_RULE));

      setDecisions((prev) => [data as DecisionWithUser, ...prev]);
      setContent("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "บันทึกมติไม่สำเร็จ", "error");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
      <h3 className="font-headline-md text-headline-md text-on-surface mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-[20px]">gavel</span>
        มติที่ประชุม ({decisions.length})
      </h3>
      <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
        {decisions.length === 0 && <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีมติที่บันทึกไว้</p>}
{decisions.map((d) => (
          <div key={d.id} className="p-3 rounded-lg bg-surface-container-low border-l-4 border-primary">
            {editingId === d.id ? (
              <form onSubmit={saveEdit} className="flex flex-col gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-xs font-label-md disabled:opacity-60"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-md disabled:opacity-60"
                  >
                    {saving ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">{d.content}</p>
                <div className="flex items-start justify-between gap-2 mt-1">
                  <p className="text-xs text-on-surface-variant">
                    ตัดสินใจโดย {d.decidedBy?.name ?? "ไม่ทราบ"} • {relativeTime(d.decidedAt)}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(d.id);
                        setDraft(d.content);
                      }}
                      title="แก้ไขมติที่ประชุม"
                      className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button
                      onClick={() => remove(d.id)}
                      disabled={deletingId === d.id}
                      title="ลบมติที่ประชุม"
                      className="p-1 rounded-full text-on-surface-variant hover:bg-error-container hover:text-error transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 items-end">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="บันทึกมติ/สิ่งที่ตัดสินใจในที่ประชุม..."
          className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm resize-none"
        />
        <button
          type="submit"
          disabled={posting || !content.trim()}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-60"
        >
          {posting ? "กำลังบันทึก..." : "เพิ่ม"}
        </button>
      </form>
    </div>
  );
}

export function MeetingResourcesCard({
  meetingId,
  initialResources,
}: {
  meetingId: string;
  initialResources: ResourceWithUser[];
}) {
  const { showToast } = useToast();
  const [resources, setResources] = useState(initialResources);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ResourceType>("LINK");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", url: "", type: "LINK" as ResourceType });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    if (!draft.title.trim() || !draft.url.trim()) {
      showToast("กรุณากรอกชื่อและ URL", "error");
      return;
    }
    if (!isHttpUrl(draft.url)) {
      showToast("URL ต้องขึ้นต้นด้วย http:// หรือ https://", "error");
      return;
    }
    setSaving(true);
    try {
      // Same update_organizer_or_participant_or_admin policy and the same
      // silent-0-row remedy as MeetingNotesCard.saveEdit. RelatedResource has
      // no updatedAt column, so only the three editable fields are sent.
      const { data, error: dbError } = await createClient()
        .from("RelatedResource")
        .update({ title: draft.title.trim(), url: draft.url.trim(), type: draft.type })
        .eq("id", editingId)
        .select("*, addedBy:User(name)")
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setResources((prev) => prev.map((r) => (r.id === editingId ? (data as ResourceWithUser) : r)));
      setEditingId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "แก้ไขเอกสารอ้างอิงไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      // delete_organizer_or_participant_or_admin — same remedy as above.
      const { data, error: dbError } = await createClient()
        .from("RelatedResource")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle();
      if (dbError) throw new Error(dbError.message);
      if (!data) throw new Error(MEETING_CONTRIBUTOR_RULE_ACTION);

      setResources((prev) => prev.filter((r) => r.id !== id));
      showToast("ลบเอกสารอ้างอิงแล้ว", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ลบเอกสารอ้างอิงไม่สำเร็จ", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    if (!isHttpUrl(url)) {
      showToast("URL ต้องขึ้นต้นด้วย http:// หรือ https://", "error");
      return;
    }
    setPosting(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      // Same insert_organizer_or_participant_or_admin RLS policy shape as
      // MeetingNote/Decision above — plain throw on dbError, no null-check
      // needed. RelatedResource.id has no DB default (client-side-only
      // cuid()) so it's supplied explicitly; type is sent explicitly too
      // even though the column has a DB default ('LINK'), matching the old
      // route's own `data: {..., type: body.type, ...}` (the UI always has
      // a real selected value, never omits it); createdAt has a real DB
      // default (CURRENT_TIMESTAMP) so it's left out. addedBy's select
      // shape matches the parent page's resources:RelatedResource(*,
      // addedBy:User(name)) embed — ResourceWithUser (./types.ts) declares
      // nothing more than addedBy.name.
      const { data, error: dbError } = await supabase
        .from("RelatedResource")
        .insert({
          id: crypto.randomUUID(),
          meetingId,
          addedById: authData.user.id,
          title,
          url: url.trim(),
          type,
        })
        .select("*, addedBy:User(name)")
        .single();
      if (dbError) throw new Error(dbWriteErrorMessage(dbError, "เพิ่มเอกสารอ้างอิง", MEETING_CONTRIBUTOR_RULE));

      setResources((prev) => [data as ResourceWithUser, ...prev]);
      setTitle("");
      setUrl("");
      setType("LINK");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "เพิ่มเอกสารอ้างอิงไม่สำเร็จ", "error");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
      <h3 className="font-headline-md text-headline-md text-on-surface mb-3">เอกสารอ้างอิง ({resources.length})</h3>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {resources.length === 0 && <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีเอกสารอ้างอิง</p>}
        {resources.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-1 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50 px-1"
          >
            {editingId === r.id ? (
              <form onSubmit={saveEdit} className="flex-1 flex flex-col gap-2 p-2">
                <div className="flex gap-2">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="ชื่อเอกสาร/ลิงก์"
                    autoFocus
                    className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
                  />
                  <select
                    value={draft.type}
                    onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as ResourceType }))}
                    className="px-2 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
                  >
                    <option value="LINK">ลิงก์</option>
                    <option value="DOCUMENT">เอกสาร</option>
                    <option value="FILE">ไฟล์</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    value={draft.url}
                    onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={saving}
                    className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant text-xs font-label-md disabled:opacity-60"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !draft.title.trim() || !draft.url.trim()}
                    className="px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-label-md disabled:opacity-60"
                  >
                    {saving ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center gap-3 p-2 min-w-0"
                >
                  <span className="material-symbols-outlined text-[20px] text-secondary shrink-0">
                    {RESOURCE_TYPE_ICON[r.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-label-md text-label-md text-on-surface truncate">{r.title}</p>
                    <p className="text-[11px] text-outline truncate">
                      {RESOURCE_TYPE_LABEL[r.type]} • {r.addedBy?.name ?? "ไม่ทราบผู้เพิ่ม"}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-[14px] text-on-surface-variant shrink-0">
                    open_in_new
                  </span>
                </a>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(r.id);
                      setDraft({ title: r.title, url: r.url, type: r.type });
                    }}
                    title="แก้ไขเอกสารอ้างอิง"
                    className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    disabled={deletingId === r.id}
                    title="ลบเอกสารอ้างอิง"
                    className="p-1 rounded-full text-on-surface-variant hover:bg-error-container hover:text-error transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ชื่อเอกสาร/ลิงก์"
            className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ResourceType)}
            className="px-2 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
          >
            <option value="LINK">ลิงก์</option>
            <option value="DOCUMENT">เอกสาร</option>
            <option value="FILE">ไฟล์</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm"
          />
          <button
            type="submit"
            disabled={posting || !title.trim() || !url.trim()}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            {posting ? "กำลังเพิ่ม..." : "เพิ่ม"}
          </button>
        </div>
      </form>
    </div>
  );
}
