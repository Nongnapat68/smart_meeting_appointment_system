import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime } from "@/lib/format";
import { projectStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { TaskQuickToggle } from "./TaskQuickToggle";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      manager: { select: { name: true } },
      members: { include: { person: true } },
      meetings: { orderBy: { startTime: "asc" } },
      tasks: { orderBy: { dueDate: "asc" } },
    },
  });
  if (!project) notFound();

  const now = new Date();
  const taskTotal = project.tasks.length;
  const taskCompleted = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const taskOverdue = project.tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate < now).length;
  const taskPending = taskTotal - taskCompleted - taskOverdue;
  const progress = taskTotal > 0 ? Math.round((taskCompleted / taskTotal) * 100) : 0;
  const badge = projectStatusBadge(project.status);

  return (
    <main className="p-container-margin max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-on-surface-variant font-body-md text-body-md">
        <Link href="/projects" className="hover:text-primary transition-colors">
          โปรเจกต์ทั้งหมด
        </Link>
        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        <span className="text-on-background font-medium">{project.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-card-padding shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <StatusBadge {...badge} />
            </div>
            <h1 className="font-headline-lg text-headline-lg font-bold text-on-background mb-2">{project.name}</h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl leading-relaxed mb-6">
              {project.description ?? "ยังไม่มีคำอธิบายโปรเจกต์"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 pt-4 border-t border-outline-variant/30">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-outline">calendar_today</span>
              <div>
                <p className="font-label-md text-label-md text-outline">ระยะเวลา</p>
                <p className="font-body-md text-body-md font-medium text-on-background">
                  {project.startDate ? formatDate(project.startDate) : "-"} - {project.endDate ? formatDate(project.endDate) : "-"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-outline">account_circle</span>
              <div>
                <p className="font-label-md text-label-md text-outline">Project Manager</p>
                <p className="font-body-md text-body-md font-medium text-on-background">{project.manager?.name ?? "-"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className="font-body-md text-body-md text-on-surface-variant">
                {project.members.length} สมาชิกในทีม
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-container-lowest rounded-xl p-card-padding shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col justify-between">
          <div>
            <h2 className="font-headline-md text-headline-md font-semibold text-on-background mb-4">ความคืบหน้าภาพรวม</h2>
            <div className="mb-2 flex justify-between items-end">
              <span className="font-display-lg text-display-lg font-bold text-primary">{progress}%</span>
              <span className="font-body-md text-body-md text-on-surface-variant mb-1">ตรงตามแผนงาน</span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2.5 mb-6">
              <div className="bg-primary h-2.5 rounded-full" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <MiniStat label="งานทั้งหมด" value={taskTotal} />
            <MiniStat label="เสร็จสิ้นแล้ว" value={taskCompleted} valueClass="text-secondary" />
            <MiniStat label="รอดำเนินการ" value={taskPending} valueClass="text-tertiary" />
            <MiniStat label="ล่าช้า" value={taskOverdue} valueClass="text-error" highlight />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-outline-variant/30">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline-md text-headline-md font-semibold text-on-background flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">event_note</span>
                ตารางการประชุมโปรเจกต์
              </h3>
              <Link href="/meetings" className="text-primary font-label-md text-label-md hover:underline">
                ดูทั้งหมด
              </Link>
            </div>
            {project.meetings.length === 0 ? (
              <p className="text-on-surface-variant font-body-md text-body-md">ยังไม่มีการประชุมของโปรเจกต์นี้</p>
            ) : (
              <div className="relative pl-6 border-l-2 border-surface-container-high space-y-6">
                {project.meetings.map((m) => (
                  <div key={m.id} className="relative">
                    <div className="absolute -left-[29px] top-1 w-3 h-3 bg-primary rounded-full border-4 border-surface-container-lowest" />
                    <div className="flex justify-between items-start mb-1">
                      <Link href={`/meetings/${m.id}`} className="font-body-lg text-body-lg font-semibold text-on-background hover:text-primary transition-colors">
                        {m.title}
                      </Link>
                      <span className="font-label-md text-label-md text-outline whitespace-nowrap ml-2">
                        {formatDateTime(m.startTime)}
                      </span>
                    </div>
                    {m.description && (
                      <p className="font-body-md text-body-md text-on-surface-variant">{m.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-card-padding shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-outline-variant/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-md text-headline-md font-semibold text-on-background flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary-fixed-dim">checklist</span>
                งานของโปรเจกต์
              </h3>
              <Link href="/tasks" className="text-primary font-label-md text-label-md hover:underline">
                ดูทั้งหมด
              </Link>
            </div>
            {project.tasks.length === 0 ? (
              <p className="text-on-surface-variant font-body-md text-body-md">ยังไม่มีงานในโปรเจกต์นี้</p>
            ) : (
              <div className="space-y-3">
                {project.tasks.slice(0, 8).map((t) => (
                  <TaskQuickToggle key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function MiniStat({
  label,
  value,
  valueClass = "text-on-background",
  highlight = false,
}: {
  label: string;
  value: number;
  valueClass?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? "bg-error-container/20 border-error-container/50" : "bg-surface border-outline-variant/20"}`}>
      <p className={`font-label-md text-label-md mb-1 ${highlight ? "text-error" : "text-outline"}`}>{label}</p>
      <p className={`font-headline-md text-headline-md font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
