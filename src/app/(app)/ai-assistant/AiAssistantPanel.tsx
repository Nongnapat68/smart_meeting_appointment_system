"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Feedback";
import { formatDateTime } from "@/lib/format";
import type { AISummary, MeetingStatus } from "@prisma/client";

interface MeetingOption {
  id: string;
  title: string;
  startTime: Date;
  status: MeetingStatus;
}

interface AiSource {
  label: string;
  refType: string;
  refId: string;
}

export function AiAssistantPanel({
  meetings,
  initialMeetingId,
}: {
  meetings: MeetingOption[];
  initialMeetingId?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialMeetingId ?? meetings[0]?.id
  );
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    api
      .get<{ summary: AISummary | null }>(`/api/meetings/${selectedId}/ai-summary`)
      .then((res) => {
        setSummary(res.summary);
        setContent(res.summary?.content ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  function selectMeeting(id: string) {
    setSelectedId(id);
    router.replace(`/ai-assistant?meetingId=${id}`, { scroll: false });
  }

  async function generate() {
    if (!selectedId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await api.post<{ summary: AISummary }>(`/api/meetings/${selectedId}/ai-summary`);
      setSummary(res.summary);
      setContent(res.summary.content);
      showToast("สร้างสรุปด้วย AI สำเร็จ", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถสร้างสรุปด้วย AI ได้");
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdit() {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.patch(`/api/meetings/${selectedId}/ai-summary`, { content });
      showToast("บันทึกการแก้ไขสำเร็จ", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  const sources: AiSource[] = summary?.sources ? JSON.parse(summary.sources) : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden flex flex-col max-h-[70vh]">
        <div className="p-4 border-b border-outline-variant bg-surface-bright">
          <h3 className="font-headline-md text-headline-md text-on-surface">เลือกการประชุม</h3>
        </div>
        <div className="overflow-y-auto flex-1">
          {meetings.length === 0 && (
            <p className="p-4 text-on-surface-variant font-body-md text-body-md">ยังไม่มีการประชุม</p>
          )}
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => selectMeeting(m.id)}
              className={`w-full text-left p-4 border-b border-outline-variant/30 transition-colors hover:bg-surface-container-low ${
                selectedId === m.id ? "bg-primary-container/10 border-l-4 border-l-primary" : ""
              }`}
            >
              <p className="font-body-md text-body-md font-medium text-on-surface truncate">{m.title}</p>
              <p className="font-label-md text-label-md text-on-surface-variant mt-1">{formatDateTime(m.startTime)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!selectedId ? (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-12 text-center text-on-surface-variant">
            เลือกการประชุมทางด้านซ้ายเพื่อเริ่มต้น
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden flex flex-col border border-outline-variant bg-surface-container-lowest/95">
            <div className="bg-primary-container/5 px-card-padding py-4 border-b border-outline-variant flex items-start justify-between">
              <div className="flex gap-3">
                <span className="material-symbols-outlined icon-fill text-primary mt-1">auto_awesome</span>
                <div>
                  <h3 className="font-headline-md text-headline-md text-primary">AI สรุปข้อมูลก่อนการประชุม</h3>
                  <p className="font-label-md text-label-md text-on-surface-variant mt-1">
                    รวบรวมจากบันทึกที่ผ่านมาและงานที่เกี่ยวข้อง
                  </p>
                </div>
              </div>
              <button
                onClick={generate}
                disabled={generating}
                title="สร้าง/รีเฟรชสรุปใหม่"
                className="text-on-surface-variant hover:text-primary transition-colors p-1 disabled:opacity-50"
              >
                {generating ? <Spinner /> : <span className="material-symbols-outlined text-sm">refresh</span>}
              </button>
            </div>

            <div className="flex-1 p-card-padding">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner className="w-8 h-8" />
                </div>
              ) : error ? (
                <p className="text-error font-body-md text-body-md">{error}</p>
              ) : summary ? (
                <>
                  <div className="bg-surface-container-lowest border border-outline-variant rounded-lg focus-within:ring-2 focus-within:ring-primary/50 focus-within:border-primary transition-all">
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="w-full h-full min-h-[300px] p-4 bg-transparent border-none resize-none focus:ring-0 font-body-md text-body-md text-on-surface leading-relaxed"
                      spellCheck={false}
                    />
                  </div>
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={saveEdit}
                      disabled={saving || content === summary.content}
                      className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-50"
                    >
                      {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                    </button>
                  </div>
                  {sources.length > 0 && (
                    <div className="mt-4">
                      <p className="font-label-md text-label-md text-on-surface-variant mb-2">แหล่งที่มาอ้างอิง:</p>
                      <div className="flex flex-wrap gap-2">
                        {sources.map((s, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container border border-outline-variant text-xs text-on-surface"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {s.refType === "task" ? "task_alt" : "event"}
                            </span>
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="font-body-md text-body-md text-on-surface-variant mb-4">
                    ยังไม่มีสรุปสำหรับการประชุมนี้
                  </p>
                  <button
                    onClick={generate}
                    disabled={generating}
                    className="px-5 py-2.5 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {generating ? <Spinner /> : <span className="material-symbols-outlined text-[18px]">auto_awesome</span>}
                    {generating ? "กำลังสร้างสรุป..." : "สร้างสรุปด้วย AI"}
                  </button>
                </div>
              )}
            </div>

            <div className="p-3 bg-surface-container-low border-t border-outline-variant flex items-center justify-center gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span className="font-label-md text-label-md">สร้างโดย AI — โปรดตรวจสอบความถูกต้องก่อนใช้งาน</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
