"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { relativeTime } from "@/lib/format";
import type { ResourceType } from "@prisma/client";
import type { NoteWithAuthor, DecisionWithUser, ResourceWithUser } from "./types";

// FR-11/12/13: Notes, Decisions and Related Resources — each its own entity,
// each supporting multiple rows per meeting, individually attributed.
//
// Hybrid migration (MeetingNote/Decision/RelatedResource round) — POST is
// the only thing here (no GET: initial rows arrive as
// initialNotes/initialDecisions/initialResources props, read by the parent
// page's own nested select back in Meeting round 1 — see ./types.ts). The
// old GET /api/meetings/[id]/{notes,decisions,resources} routes still exist
// but nothing here calls them anymore.

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
      if (dbError) throw new Error(dbError.message);

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
            <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">{n.content}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              {n.author?.name ?? "ไม่ทราบผู้บันทึก"} • {relativeTime(n.createdAt)}
            </p>
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
      if (dbError) throw new Error(dbError.message);

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
          <div key={d.id} className="p-3 rounded-lg bg-surface-container-low">
            <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">{d.content}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              {d.decidedBy?.name ?? "ไม่ทราบผู้บันทึก"} • {relativeTime(d.decidedAt)}
            </p>
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
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
          url,
          type,
        })
        .select("*, addedBy:User(name)")
        .single();
      if (dbError) throw new Error(dbError.message);

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
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-outline-variant/50"
          >
            <span className="material-symbols-outlined text-[20px] text-secondary">{RESOURCE_TYPE_ICON[r.type]}</span>
            <div className="flex-1 min-w-0">
              <p className="font-label-md text-label-md text-on-surface truncate">{r.title}</p>
              <p className="text-[11px] text-outline truncate">
                {RESOURCE_TYPE_LABEL[r.type]} • {r.addedBy?.name ?? "ไม่ทราบผู้เพิ่ม"}
              </p>
            </div>
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">open_in_new</span>
          </a>
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
