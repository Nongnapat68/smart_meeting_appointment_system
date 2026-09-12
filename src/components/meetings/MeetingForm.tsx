"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { ErrorBanner } from "@/components/ui/Feedback";
import { toDatetimeLocalValue, formatDateTime } from "@/lib/format";
import { reminderStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import type { ContactGroup, Meeting, MeetingParticipant, OnlineMeetingResource, Person, Reminder } from "@prisma/client";

// FR-10 example offsets straight from the requirements doc (7d/2d/1d/1h before).
const REMINDER_PRESETS = [
  { label: "7 วันก่อน", minutes: 7 * 24 * 60 },
  { label: "2 วันก่อน", minutes: 2 * 24 * 60 },
  { label: "1 วันก่อน", minutes: 24 * 60 },
  { label: "1 ชั่วโมงก่อน", minutes: 60 },
  { label: "30 นาทีก่อน", minutes: 30 },
];

function offsetLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} วันก่อน`;
  if (minutes % 60 === 0) return `${minutes / 60} ชั่วโมงก่อน`;
  return `${minutes} นาทีก่อน`;
}

export interface MeetingFormInitial {
  meeting: Meeting & {
    participants: (MeetingParticipant & { person: Person })[];
    groups: ContactGroup[];
  };
}

interface SelectedGroup {
  id: string;
  name: string;
  // Only `id` (totalParticipantCount's dedup Set) and `name` (the member
  // chip's truncated name list) are actually read from this array anywhere
  // in this file — not the full Person the old /api/groups/:id response
  // nested, so the query below only pulls these two columns.
  members: { id: string; name: string }[];
}

export function MeetingForm({
  initial,
  prefillPersonId,
  prefillGroupId,
}: {
  initial?: MeetingFormInitial;
  prefillPersonId?: string;
  prefillGroupId?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const isEdit = Boolean(initial);

  const [title, setTitle] = useState(initial?.meeting.title ?? "");
  const [description, setDescription] = useState(initial?.meeting.description ?? "");
  const [type, setType] = useState<"SINGLE" | "PROJECT">(initial?.meeting.type ?? "SINGLE");
  const [status, setStatus] = useState<Meeting["status"]>(initial?.meeting.status ?? "PENDING");
  const [startTime, setStartTime] = useState(
    initial ? toDatetimeLocalValue(initial.meeting.startTime) : ""
  );
  const [endTime, setEndTime] = useState(initial ? toDatetimeLocalValue(initial.meeting.endTime) : "");
  const [location, setLocation] = useState(initial?.meeting.location ?? "");
  const [projectId, setProjectId] = useState(initial?.meeting.projectId ?? "");
  // Hybrid migration (Projects resource) — only `id`/`name` are ever read
  // from this list (see the <option> below), confirmed against the actual
  // JSX before narrowing the select, not guessed the way Groups' member
  // count was almost dropped incorrectly in that round.
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  // FR-07/BR-09: reusable Online Meeting Resource — pick an existing one or
  // create a new one inline, instead of retyping the URL into `location`.
  const [onlineResources, setOnlineResources] = useState<OnlineMeetingResource[]>([]);
  const [onlineMeetingResourceId, setOnlineMeetingResourceId] = useState(
    initial?.meeting.onlineMeetingResourceId ?? ""
  );
  const [showNewResourceForm, setShowNewResourceForm] = useState(false);
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceUrl, setNewResourceUrl] = useState("");
  const [creatingResource, setCreatingResource] = useState(false);

  // FR-10/BR-11: multiple reminder offsets. Create mode builds the list
  // locally and sends it with the meeting; edit mode manages real reminders
  // live via /api/reminders since the meeting already exists.
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([30]);
  const [newOffsetInput, setNewOffsetInput] = useState("");
  const [existingReminders, setExistingReminders] = useState<Reminder[]>([]);
  const [addingReminder, setAddingReminder] = useState(false);

  // BR-04: only participants that were picked directly (or joined as a raw
  // external email, which becomes a real Person the same way) live in this
  // list — anyone invited via a whole group lives in `selectedGroups` below
  // instead, so their MeetingParticipant.source stays GROUP on save instead
  // of being silently flattened back into DIRECT.
  const [selectedPeople, setSelectedPeople] = useState<Person[]>(
    initial?.meeting.participants.filter((p) => p.source !== "GROUP").map((p) => p.person) ?? []
  );
  const [selectedGroups, setSelectedGroups] = useState<SelectedGroup[]>([]);
  // PostgREST's embedded-count syntax (`members:ContactGroupMember(count)`)
  // comes back as `[{ count: N }]`, not Prisma's `_count: { members: N }` —
  // same shape groups/page.tsx's GroupRow uses.
  const [groups, setGroups] = useState<(ContactGroup & { members: { count: number }[] })[]>([]);
  const [personQuery, setPersonQuery] = useState("");
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const [externalEmail, setExternalEmail] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Hybrid migration (Projects resource) — GET list -> supabase-js direct
    // select, narrowed to id+name only (see the projects state above).
    createClient()
      .from("Project")
      .select("id, name")
      .order("createdAt", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setProjects((data ?? []) as { id: string; name: string }[]);
      });
    // Hybrid migration (Groups resource, mirrors the People round) — same
    // count-embed query as groups/page.tsx's load(), still needed here for
    // the "(N คน)" count shown next to each group in the picker below
    // (verified against the actual JSX, not dropped despite the plan's
    // note to skip it).
    createClient()
      .from("ContactGroup")
      .select("*, members:ContactGroupMember(count)")
      .order("createdAt", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setGroups((data ?? []) as (ContactGroup & { members: { count: number }[] })[]);
      });
    api
      .get<{ items: OnlineMeetingResource[] }>("/api/online-resources")
      .then((r) => setOnlineResources(r.items))
      .catch(() => {});
  }, []);

  // Edit mode: reminders already exist on the meeting, so load and manage
  // them live instead of bundling offsets into the save payload.
  const loadReminders = async () => {
    if (!initial) return;
    try {
      const res = await api.get<{ items: Reminder[] }>(`/api/reminders?meetingId=${initial.meeting.id}`);
      setExistingReminders(res.items);
    } catch {
      // non-critical — reminder list just stays empty
    }
  };
  useEffect(() => {
    // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReminders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.meeting.id]);

  // Prefill from query params (e.g. "นัดประชุม" from a person or group detail page).
  useEffect(() => {
    if (prefillPersonId) {
      (async () => {
        try {
          const { data: p } = await createClient()
            .from("Person")
            .select("*")
            .eq("id", prefillPersonId)
            .maybeSingle<Person>();
          if (!p) return;
          setSelectedPeople((prev) => (prev.some((sp) => sp.id === p.id) ? prev : [...prev, p]));
        } catch {
          // best-effort prefill — ignore
        }
      })();
    }
    if (prefillGroupId) {
      addGroupById(prefillGroupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPersonId, prefillGroupId]);

  // Edit mode: reconstruct the group chips from the meeting's existing
  // _MeetingGroups links (whichever whole groups were invited) so re-saving
  // without touching them keeps sending their ids — otherwise the first save
  // after this fix would silently drop every previously-invited group.
  useEffect(() => {
    initial?.meeting.groups.forEach((g) => addGroupById(g.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!personQuery) {
      // Clearing stale results synchronously when the query empties out —
      // deemed safe by design (see eslint.config.mjs).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersonResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        // Same 3-field OR search GET /api/people used to do (name/email/
        // department "contains") — see people/page.tsx's load() for the
        // same pattern.
        const pattern = `%${personQuery}%`;
        const { data: items, error } = await createClient()
          .from("Person")
          .select("*")
          .or(`name.ilike."${pattern}",email.ilike."${pattern}",department.ilike."${pattern}"`)
          .limit(8);
        if (error) throw error;
        setPersonResults((items ?? []).filter((p: Person) => !selectedPeople.some((sp) => sp.id === p.id)));
      } catch {
        // ignore
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personQuery]);

  function addPerson(p: Person) {
    setSelectedPeople((prev) => [...prev, p]);
    setPersonQuery("");
    setPersonResults([]);
  }

  function removePerson(id: string) {
    setSelectedPeople((prev) => prev.filter((p) => p.id !== id));
  }

  // BR-04: keeps the group itself selected (sent as `groupIds` on submit so
  // _MeetingGroups + MeetingParticipant.source=GROUP are written correctly)
  // instead of the old behavior which fetched the members once and threw the
  // groupId away, leaving every member indistinguishable from a direct pick.
  async function addGroupById(groupId: string) {
    if (!groupId || selectedGroups.some((g) => g.id === groupId)) return;
    try {
      // Hybrid migration — same nested members:ContactGroupMember(...)
      // embed groups/[id]/page.tsx's load() uses, but pulling only id+name
      // off Person (all this picker actually reads via SelectedGroup.members
      // above), not the full nested person:Person(*) that page needs for
      // its member table.
      const { data: group, error } = await createClient()
        .from("ContactGroup")
        .select("name, members:ContactGroupMember(person:Person(id, name))")
        .eq("id", groupId)
        .maybeSingle<{ name: string; members: { person: { id: string; name: string } }[] }>();
      if (error) throw new Error(error.message);
      if (!group) throw new Error("ไม่พบกลุ่มนี้");
      const members = group.members.map((m) => m.person);
      setSelectedGroups((prev) =>
        prev.some((g) => g.id === groupId) ? prev : [...prev, { id: groupId, name: group.name, members }]
      );
    } catch {
      showToast("โหลดข้อมูลกลุ่มไม่สำเร็จ", "error");
    }
  }

  function removeGroup(groupId: string) {
    setSelectedGroups((prev) => prev.filter((g) => g.id !== groupId));
  }

  // Total distinct people being invited — direct picks plus everyone in each
  // selected group, deduped (a person can be in more than one selected group,
  // or picked directly as well as belong to one).
  const totalParticipantCount = new Set([
    ...selectedPeople.map((p) => p.id),
    ...selectedGroups.flatMap((g) => g.members.map((m) => m.id)),
  ]).size;

  const [externalEmails, setExternalEmails] = useState<string[]>([]);
  function addExternalEmail() {
    const email = externalEmail.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("รูปแบบอีเมลไม่ถูกต้อง", "error");
      return;
    }
    setExternalEmails((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setExternalEmail("");
  }

  async function createOnlineResource() {
    if (!newResourceName.trim() || !newResourceUrl.trim()) return;
    setCreatingResource(true);
    try {
      const res = await api.post<{ resource: OnlineMeetingResource }>("/api/online-resources", {
        name: newResourceName,
        url: newResourceUrl,
      });
      setOnlineResources((prev) => [...prev, res.resource]);
      setOnlineMeetingResourceId(res.resource.id);
      setShowNewResourceForm(false);
      setNewResourceName("");
      setNewResourceUrl("");
      showToast("สร้างลิงก์ประชุมสำเร็จ", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "สร้างลิงก์ไม่สำเร็จ", "error");
    } finally {
      setCreatingResource(false);
    }
  }

  function addReminderOffset(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    setReminderOffsets((prev) => (prev.includes(minutes) ? prev : [...prev, minutes].sort((a, b) => a - b)));
    setNewOffsetInput("");
  }

  function removeReminderOffset(minutes: number) {
    setReminderOffsets((prev) => prev.filter((m) => m !== minutes));
  }

  async function addExistingMeetingReminder(minutes: number) {
    if (!initial || !Number.isFinite(minutes) || minutes <= 0) return;
    setAddingReminder(true);
    try {
      await api.post("/api/reminders", { meetingId: initial.meeting.id, offsetMinutes: minutes });
      setNewOffsetInput("");
      await loadReminders();
      showToast("เพิ่มการแจ้งเตือนสำเร็จ", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "เพิ่มการแจ้งเตือนไม่สำเร็จ", "error");
    } finally {
      setAddingReminder(false);
    }
  }

  async function cancelExistingReminder(id: string) {
    try {
      await api.post(`/api/reminders/${id}/cancel`);
      await loadReminders();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ", "error");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();
      const participantPersonIds = selectedPeople.map((p) => p.id);
      const groupIds = selectedGroups.map((g) => g.id);

      if (isEdit && initial) {
        const payload = {
          title,
          description,
          type,
          status,
          startTime: startIso,
          endTime: endIso,
          location,
          projectId: projectId || null,
          onlineMeetingResourceId: onlineMeetingResourceId || null,
          participantPersonIds,
          groupIds,
          externalEmails,
        };
        await api.put(`/api/meetings/${initial.meeting.id}`, payload);
        showToast("บันทึกการเปลี่ยนแปลงสำเร็จ", "success");
        router.push(`/meetings/${initial.meeting.id}`);
      } else {
        // Hybrid migration round 1 (Meeting resource): create goes straight
        // through create_meeting_with_participants() instead of
        // POST /api/meetings (removed) — see
        // prisma/migrations/20260911170000_create_meeting_with_participants_function
        // and docs/DESIGN_DECISIONS.md §5.5. p_organizer_id must be this
        // browser's own signed-in user — the function itself re-checks that
        // server-side (auth.uid()) before writing anything, so getUser()
        // here is just what the RPC call needs, not the security boundary.
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

        const { data: meeting, error: rpcError } = await supabase.rpc("create_meeting_with_participants", {
          p_organizer_id: authData.user.id,
          p_title: title,
          p_start_time: startIso,
          p_end_time: endIso,
          p_description: description || null,
          p_type: type,
          p_status: status,
          p_location: location || null,
          p_project_id: projectId || null,
          p_online_meeting_resource_id: onlineMeetingResourceId || null,
          p_participant_person_ids: participantPersonIds,
          p_group_ids: groupIds,
          p_external_emails: externalEmails,
          p_reminder_offset_minutes: reminderOffsets,
        });
        // supabase-js errors don't throw — translate to the same
        // thrown-Error shape apiFetch() used to produce, so the catch
        // block below (and its `error` toast) keeps working unchanged.
        if (rpcError) throw new Error(rpcError.message);

        showToast("สร้างการนัดหมายสำเร็จ", "success");

        // FR-09: separate, best-effort email step (POST /api/meetings/[id]/notify,
        // step C of this migration) — a delivery hiccup here must not undo
        // or block the meeting the RPC above already committed, so its
        // failure only shows a secondary toast instead of reaching the
        // outer catch (which would wrongly imply the whole save failed).
        try {
          await api.post(`/api/meetings/${meeting.id}/notify`);
        } catch (notifyErr) {
          console.error("notify failed for meeting", meeting.id, notifyErr);
          showToast(
            notifyErr instanceof Error ? notifyErr.message : "ส่งอีเมลแจ้งเตือนผู้เข้าร่วมไม่สำเร็จ",
            "error"
          );
        }

        router.push(`/meetings/${meeting.id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-8 px-container-margin max-w-5xl mx-auto pb-16">
      <div className="mb-8">
        <h2 className="font-display-lg text-display-lg text-on-surface mb-2">
          {isEdit ? "แก้ไขการนัดหมาย" : "สร้างการนัดหมาย"}
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">ระบุรายละเอียดการประชุมและเลือกผู้เข้าร่วม</p>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorBanner message={error} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-container-margin">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4 pb-2 border-b border-outline-variant">
              รายละเอียดทั่วไป
            </h3>
            <div className="space-y-4">
              <FieldLabel label="หัวข้อการประชุม">
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ระบุหัวข้อการประชุม..."
                  className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </FieldLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldLabel label="ประเภทการประชุม">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as "SINGLE" | "PROJECT")}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <option value="SINGLE">การประชุมเดี่ยว (Single)</option>
                    <option value="PROJECT">เชื่อมโยงกับโปรเจกต์ (Project)</option>
                  </select>
                </FieldLabel>
                <FieldLabel label="สถานะ">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Meeting["status"])}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <option value="PENDING">รอยืนยัน (Pending)</option>
                    <option value="ACTIVE">ยืนยันแล้ว (Active)</option>
                    {isEdit && <option value="COMPLETED">เสร็จสิ้น (Completed)</option>}
                  </select>
                </FieldLabel>
              </div>
              {type === "PROJECT" && (
                <FieldLabel label="โปรเจกต์">
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <option value="">-- เลือกโปรเจกต์ --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              )}
              <FieldLabel label="รายละเอียด">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="เพิ่มรายละเอียด, วาระการประชุม หรือหมายเหตุ..."
                  className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest resize-none"
                />
              </FieldLabel>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4 pb-2 border-b border-outline-variant">
              เวลาและสถานที่
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldLabel label="เริ่ม">
                  <input
                    type="datetime-local"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  />
                </FieldLabel>
                <FieldLabel label="สิ้นสุด">
                  <input
                    type="datetime-local"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  />
                </FieldLabel>
              </div>
              <FieldLabel label="สถานที่ (ห้องประชุมจริง)">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
                    location_on
                  </span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="ระบุห้องประชุม (ถ้ามี)"
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  />
                </div>
              </FieldLabel>

              <FieldLabel label="ลิงก์ประชุมออนไลน์ (ใช้ซ้ำได้กับหลายนัดหมาย)">
                <div className="space-y-2">
                  <select
                    value={showNewResourceForm ? "__new__" : onlineMeetingResourceId}
                    onChange={(e) => {
                      if (e.target.value === "__new__") {
                        setShowNewResourceForm(true);
                      } else {
                        setShowNewResourceForm(false);
                        setOnlineMeetingResourceId(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <option value="">-- ไม่ใช้ลิงก์ที่บันทึกไว้ --</option>
                    {onlineResources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                    <option value="__new__">+ สร้างลิงก์ใหม่...</option>
                  </select>

                  {!showNewResourceForm && onlineMeetingResourceId && (
                    <p className="text-xs text-on-surface-variant truncate">
                      {onlineResources.find((r) => r.id === onlineMeetingResourceId)?.url}
                    </p>
                  )}

                  {showNewResourceForm && (
                    <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
                      <input
                        value={newResourceName}
                        onChange={(e) => setNewResourceName(e.target.value)}
                        placeholder="ชื่อลิงก์ เช่น Zoom Room B"
                        className="w-full px-3 py-1.5 rounded-lg border border-outline-variant bg-surface text-sm"
                      />
                      <input
                        value={newResourceUrl}
                        onChange={(e) => setNewResourceUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-1.5 rounded-lg border border-outline-variant bg-surface text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewResourceForm(false);
                            setNewResourceName("");
                            setNewResourceUrl("");
                          }}
                          className="px-3 py-1.5 rounded-lg border border-outline-variant text-xs font-label-md"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={createOnlineResource}
                          disabled={creatingResource || !newResourceName.trim() || !newResourceUrl.trim()}
                          className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-md disabled:opacity-60"
                        >
                          {creatingResource ? "กำลังสร้าง..." : "สร้างและใช้ลิงก์นี้"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </FieldLabel>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4 pb-2 border-b border-outline-variant">
              การแจ้งเตือน (Reminders)
            </h3>
            {!isEdit ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {reminderOffsets.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary-container text-on-primary-container text-sm"
                    >
                      {offsetLabel(m)}
                      <button
                        type="button"
                        onClick={() => removeReminderOffset(m)}
                        className="hover:text-error"
                        aria-label="ลบ"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </span>
                  ))}
                  {reminderOffsets.length === 0 && (
                    <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีการแจ้งเตือน — เพิ่มด้านล่าง</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_PRESETS.filter((p) => !reminderOffsets.includes(p.minutes)).map((p) => (
                    <button
                      key={p.minutes}
                      type="button"
                      onClick={() => addReminderOffset(p.minutes)}
                      className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-label-md text-on-surface-variant hover:bg-surface-container-low"
                    >
                      + {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    value={newOffsetInput}
                    onChange={(e) => setNewOffsetInput(e.target.value)}
                    placeholder="กำหนดเอง (นาที)"
                    className="w-40 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => addReminderOffset(parseInt(newOffsetInput, 10))}
                    disabled={!newOffsetInput.trim()}
                    className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  {existingReminders.length === 0 && (
                    <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีการแจ้งเตือน</p>
                  )}
                  {existingReminders.map((r) => {
                    const badge = reminderStatusBadge(r.status);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-surface-container-low"
                      >
                        <span className="text-sm text-on-surface">{formatDateTime(r.scheduledAt)}</span>
                        <div className="flex items-center gap-2">
                          <StatusBadge {...badge} />
                          {r.status === "PENDING" && (
                            <button
                              type="button"
                              onClick={() => cancelExistingReminder(r.id)}
                              className="text-on-surface-variant hover:text-error"
                              title="ยกเลิกการแจ้งเตือน"
                            >
                              <span className="material-symbols-outlined text-[16px]">cancel</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_PRESETS.map((p) => (
                    <button
                      key={p.minutes}
                      type="button"
                      disabled={addingReminder}
                      onClick={() => addExistingMeetingReminder(p.minutes)}
                      className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-label-md text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
                    >
                      + {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    value={newOffsetInput}
                    onChange={(e) => setNewOffsetInput(e.target.value)}
                    placeholder="กำหนดเอง (นาที)"
                    className="w-40 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm"
                  />
                  <button
                    type="button"
                    disabled={addingReminder || !newOffsetInput.trim()}
                    onClick={() => addExistingMeetingReminder(parseInt(newOffsetInput, 10))}
                    className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant sticky top-24">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-outline-variant">
              <h3 className="font-headline-md text-headline-md text-on-surface">ผู้เข้าร่วม</h3>
              <span className="bg-primary-container text-on-primary-container font-label-md text-label-md px-2 py-1 rounded-full">
                {totalParticipantCount} คน
              </span>
            </div>

            <div className="mb-4">
              <label className="block font-label-md text-label-md text-on-surface-variant mb-2">ค้นหาบุคคล</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
                  search
                </span>
                <input
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ..."
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                />
              </div>
              {personResults.length > 0 && (
                <div className="mt-2 border border-outline-variant rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {personResults.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => addPerson(p)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-surface-container-low text-left"
                    >
                      <Avatar name={p.name} src={p.avatarUrl} size={24} />
                      <span className="font-body-md text-body-md truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block font-label-md text-label-md text-on-surface-variant mb-2">เพิ่มทั้งกลุ่ม</label>
              <select
                onChange={(e) => {
                  addGroupById(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
              >
                <option value="" disabled>
                  -- เลือกกลุ่มเพื่อเพิ่มสมาชิกทั้งหมด --
                </option>
                {groups
                  .filter((g) => !selectedGroups.some((sg) => sg.id === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.members[0]?.count ?? 0})
                    </option>
                  ))}
              </select>
              {selectedGroups.length > 0 && (
                <div className="mt-2 space-y-2">
                  {selectedGroups.map((g) => (
                    <div key={g.id} className="p-2.5 rounded-lg bg-primary-container/20 border border-primary/20">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1.5 min-w-0">
                          <span className="material-symbols-outlined text-[16px] shrink-0">group</span>
                          <span className="truncate">
                            {g.name} ({g.members.length} คน)
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeGroup(g.id)}
                          className="text-on-surface-variant hover:text-error shrink-0"
                          aria-label={`นำกลุ่ม ${g.name} ออก`}
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                      {g.members.length > 0 && (
                        <p className="text-xs text-on-surface-variant truncate mt-1">
                          {g.members.map((m) => m.name).join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block font-label-md text-label-md text-on-surface-variant mb-2">อีเมลภายนอก</label>
              <div className="flex gap-2">
                <input
                  value={externalEmail}
                  onChange={(e) => setExternalEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExternalEmail();
                    }
                  }}
                  placeholder="name@example.com"
                  type="email"
                  className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm"
                />
                <button
                  type="button"
                  onClick={addExternalEmail}
                  className="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-on-surface-variant hover:bg-surface-container"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
              {externalEmails.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {externalEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-container text-xs text-on-surface"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => setExternalEmails((prev) => prev.filter((e) => e !== email))}
                        className="text-on-surface-variant hover:text-error"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
              {selectedPeople.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-low transition-colors group">
                  <Avatar name={p.name} src={p.avatarUrl} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="font-body-md text-body-md font-medium text-on-surface truncate">{p.name}</p>
                    <p className="font-label-md text-label-md text-on-surface-variant truncate">{p.department ?? p.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePerson(p.id)}
                    className="text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 pt-6 border-t border-outline-variant flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-container-low transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-sm hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-60"
          >
            {loading ? "กำลังบันทึก..." : "บันทึกการนัดหมาย"}
            <span className="material-symbols-outlined text-[18px]">check</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-label-md text-label-md text-on-surface-variant mb-1">{label}</label>
      {children}
    </div>
  );
}
