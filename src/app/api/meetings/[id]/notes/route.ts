import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingNoteSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

// FR-11: Meeting Notes — a meeting can accumulate many notes over time,
// each individually attributed and timestamped (unlike the old single
// Meeting.description field which mixed agenda and post-meeting notes).

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id: meetingId } = await params;

  const notes = await prisma.meetingNote.findMany({
    where: { meetingId },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ items: notes });
});

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: meetingId } = await params;
  const body = parseBody(meetingNoteSchema, await request.json());

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: { select: { personId: true } } },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");

  const organizerPerson = await prisma.person.findUnique({ where: { userId: user.id }, select: { id: true } });
  const isParticipant = organizerPerson ? meeting.participants.some((p) => p.personId === organizerPerson.id) : false;
  assertOwner(
    user,
    meeting.organizerId === user.id || isParticipant,
    "เฉพาะผู้จัดประชุม ผู้เข้าร่วม หรือผู้ดูแลระบบเท่านั้นที่เพิ่มบันทึกการประชุมนี้ได้"
  );

  const note = await prisma.meetingNote.create({
    data: { meetingId, content: body.content, authorId: user.id },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return NextResponse.json({ note }, { status: 201 });
});
