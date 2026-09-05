import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { formatDateTime } from "@/lib/format";
import { meetingStatusBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { PersonActions } from "./PersonActions";

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      groupMemberships: { include: { group: true } },
    },
  });
  if (!person) notFound();

  const meetingHistory = await prisma.meetingParticipant.findMany({
    where: { personId: id },
    include: { meeting: true },
    orderBy: { meeting: { startTime: "desc" } },
    take: 10,
  });

  return (
    <main className="p-container-margin pb-24 max-w-7xl mx-auto flex flex-col gap-6">
      <div className="flex items-center text-on-surface-variant gap-2 text-sm">
        <Link href="/people" className="hover:text-primary transition-colors">
          ผู้คน
        </Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface font-medium">รายละเอียดผู้ติดต่อ</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-card-padding flex flex-col items-center text-center">
            <Avatar name={person.name} src={person.avatarUrl} size={112} className="mb-4" />
            <h2 className="font-headline-lg text-headline-lg text-on-surface mb-1">{person.name}</h2>
            <p className="font-body-lg text-body-lg text-on-surface-variant mb-1">{person.title ?? "-"}</p>
            <p className="font-label-md text-label-md text-outline mb-6">แผนก: {person.department ?? "-"}</p>
            <div className="flex flex-col w-full gap-3">
              <Link
                href={`/meetings/new?personId=${person.id}`}
                className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-lg">event</span>
                นัดประชุม
              </Link>
              <PersonActions person={person} />
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-card-padding">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4">ข้อมูลติดต่อ</h3>
            <div className="flex flex-col gap-4">
              <InfoRow icon="mail" label="อีเมล">
                <a className="font-body-md text-body-md text-primary hover:underline" href={`mailto:${person.email}`}>
                  {person.email}
                </a>
              </InfoRow>
              <InfoRow icon="smartphone" label="เบอร์โทรศัพท์">
                {person.phone ?? "-"}
              </InfoRow>
              <InfoRow icon="badge" label="ประเภท">
                {person.type === "INTERNAL" ? "ผู้ใช้งานในระบบ" : "บุคคลภายนอก"}
              </InfoRow>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-card-padding">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-4 flex items-center justify-between">
              กลุ่มที่สังกัด
              <Link href="/groups" className="text-sm font-normal text-primary hover:underline">
                ดูทั้งหมด
              </Link>
            </h3>
            <div className="flex flex-wrap gap-2">
              {person.groupMemberships.length === 0 && (
                <p className="text-on-surface-variant font-body-md text-body-md">ยังไม่ได้อยู่ในกลุ่มใด</p>
              )}
              {person.groupMemberships.map((m) => (
                <Link
                  key={m.id}
                  href={`/groups/${m.groupId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md border border-primary/20"
                >
                  <span className="material-symbols-outlined text-[16px]">{m.group.icon}</span>
                  {m.group.name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-surface-container-lowest rounded-xl ambient-shadow overflow-hidden flex flex-col h-full">
            <div className="p-card-padding border-b border-outline-variant/30">
              <h3 className="font-headline-md text-headline-md text-on-surface">ประวัติการประชุมร่วมกัน</h3>
              <p className="font-label-md text-label-md text-outline mt-1">
                รายการนัดหมายล่าสุด {meetingHistory.length} รายการ
              </p>
            </div>
            {meetingHistory.length === 0 ? (
              <p className="p-card-padding text-on-surface-variant font-body-md text-body-md">ยังไม่มีประวัติการประชุมร่วมกัน</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant/30">
                      <th className="font-label-md text-label-md px-6 py-4">หัวข้อการประชุม</th>
                      <th className="font-label-md text-label-md px-6 py-4">วันที่ &amp; เวลา</th>
                      <th className="font-label-md text-label-md px-6 py-4">บทบาท</th>
                      <th className="font-label-md text-label-md px-6 py-4 text-right">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {meetingHistory.map((mp) => {
                      const badge = meetingStatusBadge(mp.meeting.status);
                      return (
                        <tr key={mp.id} className="hover:bg-surface-container-lowest transition-colors group">
                          <td className="px-6 py-4">
                            <Link href={`/meetings/${mp.meetingId}`} className="font-medium text-on-surface group-hover:text-primary transition-colors">
                              {mp.meeting.title}
                            </Link>
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant whitespace-nowrap">
                            {formatDateTime(mp.meeting.startTime)}
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant whitespace-nowrap">
                            {mp.role === "ORGANIZER" ? "ผู้จัด (Organizer)" : "ผู้เข้าร่วม"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <StatusBadge {...badge} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function InfoRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant shrink-0">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="overflow-hidden">
        <p className="font-label-md text-label-md text-outline">{label}</p>
        <div className="font-body-md text-body-md text-on-surface truncate">{children}</div>
      </div>
    </div>
  );
}
