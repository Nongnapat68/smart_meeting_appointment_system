import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { formatDateTime } from "@/lib/format";
import { meetingStatusBadge, StatusBadge, taskStatusBadge } from "@/components/ui/StatusBadge";
import { MeetingActions } from "./MeetingActions";

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      organizer: { select: { id: true, name: true, avatarUrl: true } },
      project: { select: { id: true, name: true } },
      participants: { include: { person: true } },
      tasks: true,
      aiSummary: true,
    },
  });
  if (!meeting) notFound();

  const badge = meetingStatusBadge(meeting.status);
  const isLink = meeting.location?.startsWith("http");

  return (
    <main className="md:ml-0 p-container-margin md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/meetings" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-body-md text-sm">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          กลับไปที่ปฏิทิน
        </Link>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-[0_4px_15px_rgba(0,0,0,0.05)] mb-container-margin border border-outline-variant/30">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge {...badge} />
              {meeting.project && (
                <Link
                  href={`/projects/${meeting.project.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-md text-xs border border-outline-variant/50 hover:bg-surface-container-high"
                >
                  <span className="material-symbols-outlined text-[14px]">folder</span>
                  {meeting.project.name}
                </Link>
              )}
            </div>
            <h1 className="font-display-lg text-display-lg text-on-surface">{meeting.title}</h1>
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 text-on-surface-variant font-body-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[18px]">event</span>
                </div>
                <div>
                  <p className="text-xs text-outline">วันที่และเวลา</p>
                  <p className="font-medium text-on-surface">
                    {formatDateTime(meeting.startTime)} - {new Date(meeting.endTime).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              {meeting.location && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[18px]">videocam</span>
                  </div>
                  <div>
                    <p className="text-xs text-outline">สถานที่ / ลิงก์</p>
                    {isLink ? (
                      <a className="font-medium text-primary hover:underline flex items-center gap-1" href={meeting.location} target="_blank" rel="noreferrer">
                        {meeting.location}
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      </a>
                    ) : (
                      <p className="font-medium text-on-surface">{meeting.location}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <MeetingActions meeting={meeting} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {meeting.description && (
            <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
              <h3 className="font-headline-md text-headline-md text-on-surface mb-3">รายละเอียด / วาระ</h3>
              <p className="font-body-md text-body-md text-on-surface-variant whitespace-pre-line">{meeting.description}</p>
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-headline-md text-headline-md text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary icon-fill">auto_awesome</span>
                AI สรุปข้อมูลก่อนการประชุม
              </h3>
              <Link href={`/ai-assistant?meetingId=${meeting.id}`} className="text-primary font-label-md text-label-md hover:underline">
                {meeting.aiSummary ? "ดู / แก้ไข" : "สร้างสรุป"}
              </Link>
            </div>
            {meeting.aiSummary ? (
              <p className="font-body-md text-body-md text-on-surface-variant whitespace-pre-line line-clamp-6">
                {meeting.aiSummary.content}
              </p>
            ) : (
              <p className="font-body-md text-body-md text-on-surface-variant">
                ยังไม่มีสรุปสำหรับการประชุมนี้ — ไปที่หน้าตัวช่วย AI เพื่อสร้างสรุปก่อนการประชุม
              </p>
            )}
          </div>

          {meeting.tasks.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
              <h3 className="font-headline-md text-headline-md text-on-surface mb-3">งานที่เกี่ยวข้อง</h3>
              <div className="divide-y divide-outline-variant/20">
                {meeting.tasks.map((t) => {
                  const tbadge = taskStatusBadge(t.status);
                  return (
                    <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between py-3 hover:text-primary transition-colors">
                      <span className="font-body-md text-body-md">{t.title}</span>
                      <StatusBadge {...tbadge} />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4">ผู้เข้าร่วม ({meeting.participants.length})</h3>
            <div className="space-y-3">
              {meeting.participants.map((p) => (
                <Link key={p.id} href={`/people/${p.personId}`} className="flex items-center gap-3 hover:bg-surface-container-low rounded-lg p-1 -m-1 transition-colors">
                  <Avatar name={p.person.name} src={p.person.avatarUrl} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="font-body-md text-body-md text-on-surface truncate">{p.person.name}</p>
                    <p className="font-label-md text-label-md text-on-surface-variant truncate">
                      {p.role === "ORGANIZER" ? "ผู้จัด" : "ผู้เข้าร่วม"}
                      {" • "}
                      {p.rsvpStatus === "ACCEPTED" ? "ตอบรับแล้ว" : p.rsvpStatus === "DECLINED" ? "ปฏิเสธ" : "รอตอบรับ"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
