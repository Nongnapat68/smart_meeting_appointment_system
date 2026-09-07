import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateIcs } from "@/lib/ics";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/** FR-08: downloads a .ics calendar invite for the meeting, built from its
 * real data (title/time/location/description/organizer/attendees) — no
 * separate stored copy, so it always reflects the meeting as it is right now. */
export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      organizerPerson: { select: { name: true, email: true } },
      onlineMeetingResource: { select: { url: true } },
      participants: { include: { person: { select: { name: true, email: true } } } },
    },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");

  const location = meeting.onlineMeetingResource?.url ?? meeting.location ?? null;

  const ics = generateIcs({
    uid: meeting.id,
    title: meeting.title,
    description: meeting.description,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    location,
    organizerName: meeting.organizerPerson?.name ?? null,
    organizerEmail: meeting.organizerPerson?.email ?? null,
    attendees: meeting.participants.map((p) => ({ name: p.person.name, email: p.person.email })),
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="meeting-${meeting.id}.ics"`,
    },
  });
});
