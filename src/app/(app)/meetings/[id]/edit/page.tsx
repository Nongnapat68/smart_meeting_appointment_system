import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MeetingForm } from "@/components/meetings/MeetingForm";

export default async function EditMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { participants: { include: { person: true } }, groups: true },
  });
  if (!meeting) notFound();

  return <MeetingForm initial={{ meeting }} />;
}
