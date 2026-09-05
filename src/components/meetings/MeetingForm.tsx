"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { ErrorBanner } from "@/components/ui/Feedback";
import { toDatetimeLocalValue } from "@/lib/format";
import type { ContactGroup, Meeting, MeetingParticipant, Person, Project } from "@prisma/client";

export interface MeetingFormInitial {
  meeting: Meeting & { participants: (MeetingParticipant & { person: Person })[] };
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
  const [projects, setProjects] = useState<Project[]>([]);

  const [selectedPeople, setSelectedPeople] = useState<Person[]>(
    initial?.meeting.participants.map((p) => p.person) ?? []
  );
  const [groups, setGroups] = useState<(ContactGroup & { _count: { members: number } })[]>([]);
  const [personQuery, setPersonQuery] = useState("");
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const [externalEmail, setExternalEmail] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<{ items: Project[] }>("/api/projects").then((r) => setProjects(r.items)).catch(() => {});
    api
      .get<{ items: (ContactGroup & { _count: { members: number } })[] }>("/api/groups")
      .then((r) => setGroups(r.items))
      .catch(() => {});
  }, []);

  // Prefill from query params (e.g. "นัดประชุม" from a person or group detail page).
  useEffect(() => {
    if (prefillPersonId) {
      api
        .get<{ person: Person }>(`/api/people/${prefillPersonId}`)
        .then((r) => setSelectedPeople((prev) => (prev.some((p) => p.id === r.person.id) ? prev : [...prev, r.person])))
        .catch(() => {});
    }
    if (prefillGroupId) {
      api
        .get<{ group: { members: { person: Person }[] } }>(`/api/groups/${prefillGroupId}`)
        .then((r) => {
          const members = r.group.members.map((m) => m.person);
          setSelectedPeople((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            return [...prev, ...members.filter((m) => !ids.has(m.id))];
          });
        })
        .catch(() => {});
    }
  }, [prefillPersonId, prefillGroupId]);

  useEffect(() => {
    if (!personQuery) {
      setPersonResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Person[] }>(`/api/people?q=${encodeURIComponent(personQuery)}&pageSize=8`);
        setPersonResults(res.items.filter((p) => !selectedPeople.some((sp) => sp.id === p.id)));
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

  async function addGroup(groupId: string) {
    if (!groupId) return;
    try {
      const res = await api.get<{ group: { members: { person: Person }[] } }>(`/api/groups/${groupId}`);
      const members = res.group.members.map((m) => m.person);
      setSelectedPeople((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...members.filter((m) => !ids.has(m.id))];
      });
    } catch {
      showToast("โหลดสมาชิกกลุ่มไม่สำเร็จ", "error");
    }
  }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = {
        title,
        description,
        type,
        status,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        location,
        projectId: projectId || null,
        participantPersonIds: selectedPeople.map((p) => p.id),
        groupIds: [] as string[],
        externalEmails,
      };

      if (isEdit && initial) {
        await api.put(`/api/meetings/${initial.meeting.id}`, payload);
        showToast("บันทึกการเปลี่ยนแปลงสำเร็จ", "success");
        router.push(`/meetings/${initial.meeting.id}`);
      } else {
        const res = await api.post<{ meeting: Meeting }>("/api/meetings", payload);
        showToast("สร้างการนัดหมายสำเร็จ", "success");
        router.push(`/meetings/${res.meeting.id}`);
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
              <FieldLabel label="สถานที่ / ลิงก์การประชุม">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
                    location_on
                  </span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="ระบุห้องประชุม หรือลิงก์ (เช่น Zoom, Meet)"
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  />
                </div>
              </FieldLabel>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant sticky top-24">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-outline-variant">
              <h3 className="font-headline-md text-headline-md text-on-surface">ผู้เข้าร่วม</h3>
              <span className="bg-primary-container text-on-primary-container font-label-md text-label-md px-2 py-1 rounded-full">
                {selectedPeople.length} คน
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
                  addGroup(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                className="w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
              >
                <option value="" disabled>
                  -- เลือกกลุ่มเพื่อเพิ่มสมาชิกทั้งหมด --
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g._count.members})
                  </option>
                ))}
              </select>
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
