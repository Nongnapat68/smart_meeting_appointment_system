import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dayNumber, dayShortLabel, formatTimeRange, relativeTime } from "@/lib/format";
import { meetingStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import type { Prisma } from "@prisma/client";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const userPerson = await prisma.person.findUnique({ where: { userId: user.id } });

  const userMeetingFilter: Prisma.MeetingWhereInput = {
    OR: [
      { organizerId: user.id },
      ...(userPerson ? [{ participants: { some: { personId: userPerson.id } } }] : []),
    ],
  };

  const [totalMeetings, pendingTasks, unreadNotifications, weeklyMeetings, person] =
    await Promise.all([
      prisma.meeting.count({ where: userMeetingFilter }),
      prisma.task.count({
        where: { assigneeId: user.id, status: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
      }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
      prisma.meeting.findMany({
        where: {
          AND: [
            userMeetingFilter,
            { startTime: { gte: now, lte: weekAhead } },
            { status: { not: "CANCELLED" } },
          ],
        },
        orderBy: { startTime: "asc" },
        take: 5,
      }),
      prisma.person.findUnique({ where: { userId: user.id } }),
    ]);

  const meetingsLastWeek = await prisma.meeting.count({
    where: {
      AND: [
        userMeetingFilter,
        {
          createdAt: {
            gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
            lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      ],
    },
  });
  const meetingsThisWeek = await prisma.meeting.count({
    where: {
      AND: [
        userMeetingFilter,
        { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  const trendPct =
    meetingsLastWeek > 0
      ? Math.round(((meetingsThisWeek - meetingsLastWeek) / meetingsLastWeek) * 100)
      : meetingsThisWeek > 0
        ? 100
        : 0;

  const [recentMeetings, recentSummaries, recentCompletedTasks] = await Promise.all([
    prisma.meeting.findMany({
      where: userMeetingFilter,
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.aISummary.findMany({
      where: { meeting: userMeetingFilter },
      orderBy: { generatedAt: "desc" },
      take: 3,
      include: { meeting: { select: { title: true } } },
    }),
    prisma.task.findMany({
      where: { status: "COMPLETED", completedAt: { not: null }, assigneeId: user.id },
      orderBy: { completedAt: "desc" },
      take: 3,
      include: { assignee: { select: { name: true } } },
    }),
  ]);

  type ActivityItem = { at: Date; node: React.ReactNode };
  const activity: ActivityItem[] = [
    ...recentMeetings.map((m) => ({
      at: m.createdAt,
      node: (
        <p className="font-body-md text-body-md text-on-background">
          สร้างการประชุม <span className="font-semibold">&quot;{m.title}&quot;</span>
        </p>
      ),
    })),
    ...recentSummaries.map((s) => ({
      at: s.generatedAt,
      node: (
        <div>
          <p className="font-body-md text-body-md text-on-background">
            <span className="font-semibold">ระบบ AI</span> สรุปข้อมูลก่อนประชุม &quot;{s.meeting.title}&quot; เสร็จสิ้น
          </p>
          <Link
            href={`/ai-assistant?meetingId=${s.meetingId}`}
            className="mt-2 inline-flex items-center gap-2 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30 hover:bg-surface-container-highest transition-colors"
          >
            <span className="material-symbols-outlined text-primary text-[18px]">description</span>
            <span className="font-body-md text-body-md text-primary">ดูรายงานสรุป</span>
          </Link>
        </div>
      ),
    })),
    ...recentCompletedTasks.map((t) => ({
      at: t.completedAt as Date,
      node: (
        <p className="font-body-md text-body-md text-on-background">
          <span className="font-semibold">{t.assignee?.name ?? "สมาชิก"}</span> ทำงาน &quot;{t.title}&quot; เสร็จสิ้น
        </p>
      ),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5);

  return (
    <div className="p-container-margin max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
        <div>
          <h2 className="font-display-lg text-display-lg text-on-background">ภาพรวมแดชบอร์ด</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            ยินดีต้อนรับกลับมา, {user.name}
          </p>
        </div>
        <Link
          href="/meetings/new"
          className="hidden md:flex items-center gap-2 bg-primary text-on-primary px-5 py-2.5 rounded-lg font-body-md text-body-md font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          <span className="material-symbols-outlined">add</span>
          สร้างการประชุม
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          icon="calendar_month"
          label="การประชุมทั้งหมด"
          value={totalMeetings}
          trend={trendPct !== 0 ? `${trendPct > 0 ? "+" : ""}${trendPct}% จากสัปดาห์ที่แล้ว` : undefined}
          color="primary"
        />
        <StatCard
          icon="pending_actions"
          label="งานที่รอดำเนินการ (ของฉัน)"
          value={pendingTasks}
          trend="ดูรายละเอียดที่งานของฉัน"
          color="tertiary"
        />
        <StatCard
          icon="mark_email_unread"
          label="การแจ้งเตือนใหม่"
          value={unreadNotifications}
          trend="อัปเดตล่าสุด"
          color="error"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/50 flex flex-col">
            <div className="p-card-padding border-b border-outline-variant/50 flex justify-between items-center bg-surface-bright rounded-t-xl">
              <h3 className="font-headline-md text-headline-md text-on-background">ตารางสัปดาห์นี้</h3>
              <Link href="/meetings" className="text-primary font-label-md text-label-md hover:underline">
                ดูทั้งหมด
              </Link>
            </div>
            <div className="p-card-padding flex flex-col gap-4">
              {weeklyMeetings.length === 0 && (
                <p className="text-on-surface-variant font-body-md text-body-md text-center py-6">
                  ไม่มีนัดหมายในสัปดาห์นี้
                </p>
              )}
              {weeklyMeetings.map((m) => {
                const badge = meetingStatusBadge(m.status);
                return (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className="flex gap-4 p-4 rounded-lg border border-outline-variant/30 hover:border-primary/30 hover:bg-primary-fixed/5 transition-all group"
                  >
                    <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-outline-variant/30 pr-4">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase">
                        {dayShortLabel(m.startTime)}
                      </span>
                      <span className="font-headline-lg text-headline-lg text-primary font-bold">
                        {dayNumber(m.startTime)}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                      <h4 className="font-body-lg text-body-lg font-semibold text-on-background group-hover:text-primary transition-colors truncate">
                        {m.title}
                      </h4>
                      <div className="flex items-center gap-3 mt-1 font-label-md text-label-md text-on-surface-variant flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">schedule</span>
                          {formatTimeRange(m.startTime, m.endTime)}
                        </span>
                        {m.location && (
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[16px]">videocam</span>
                            {m.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center">
                      <StatusBadge {...badge} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/50 flex flex-col h-full">
          <div className="p-card-padding border-b border-outline-variant/50 bg-surface-bright rounded-t-xl">
            <h3 className="font-headline-md text-headline-md text-on-background">กิจกรรมล่าสุด</h3>
          </div>
          <div className="p-card-padding flex-1 overflow-y-auto">
            {activity.length === 0 ? (
              <p className="text-on-surface-variant font-body-md text-body-md text-center py-6">
                ยังไม่มีกิจกรรม
              </p>
            ) : (
              <div className="relative border-l-2 border-outline-variant/30 ml-3 flex flex-col gap-6 pb-4">
                {activity.map((item, idx) => (
                  <div key={idx} className="relative pl-6">
                    <div
                      className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full ring-4 ring-surface-container-lowest ${
                        idx === 0 ? "bg-primary" : "bg-surface-variant border-2 border-outline"
                      }`}
                    />
                    {item.node}
                    <p className="font-label-md text-label-md text-on-surface-variant mt-1">
                      {relativeTime(item.at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {!person && (
        <p className="mt-6 text-label-md font-label-md text-on-surface-variant">
          หมายเหตุ: บัญชีของคุณยังไม่ได้ผูกกับรายชื่อผู้ติดต่อ (Person) — ไปที่{" "}
          <Link href="/settings" className="text-primary hover:underline">
            ตั้งค่า
          </Link>{" "}
          เพื่อให้ผู้อื่นเชิญคุณเข้าประชุมได้
        </p>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
  color,
}: {
  icon: string;
  label: string;
  value: number;
  trend?: string;
  color: "primary" | "tertiary" | "error";
}) {
  const colorClasses = {
    primary: "bg-primary/10 text-primary",
    tertiary: "bg-tertiary/10 text-tertiary",
    error: "bg-error-container text-on-error-container",
  }[color];

  return (
    <div className="bg-surface-container-lowest p-card-padding rounded-xl shadow-sm border border-outline-variant/50 hover:shadow-md transition-shadow relative overflow-hidden">
      <div className="flex items-center gap-4 mb-4 relative z-10">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses}`}>
          <span className="material-symbols-outlined icon-fill text-[28px]">{icon}</span>
        </div>
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">{label}</p>
          <h3 className="font-headline-lg text-headline-lg text-on-background">{value}</h3>
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1 text-on-surface-variant relative z-10">
          <span className="font-label-md text-label-md">{trend}</span>
        </div>
      )}
    </div>
  );
}
