import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { AiAssistantPanel } from "./AiAssistantPanel";

export default async function AiAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ meetingId?: string }>;
}) {
  const { meetingId } = await searchParams;
  const user = await getCurrentUser();

  const userPerson = user ? await prisma.person.findUnique({ where: { userId: user.id } }) : null;

  const meetings = await prisma.meeting.findMany({
    where: {
      AND: [
        { status: { not: "CANCELLED" } },
        user
          ? {
              OR: [
                { organizerId: user.id },
                ...(userPerson ? [{ participants: { some: { personId: userPerson.id } } }] : []),
              ],
            }
          : {},
      ],
    },
    orderBy: { startTime: "desc" },
    take: 30,
    select: { id: true, title: true, startTime: true, status: true },
  });

  return (
    <div className="p-container-margin max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="font-display-lg text-display-lg text-on-surface mb-2 flex items-center gap-3">
          <span className="material-symbols-outlined icon-fill text-primary text-[32px]">auto_awesome</span>
          ตัวช่วย AI
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          เลือกการประชุมเพื่อสร้างสรุปข้อมูลก่อนการประชุมด้วย AI
        </p>
      </div>
      <AiAssistantPanel meetings={meetings} initialMeetingId={meetingId} />
    </div>
  );
}
