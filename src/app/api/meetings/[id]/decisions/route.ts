import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decisionSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

// FR-13: Decisions — recorded per-meeting, traced back to a project only via
// the meeting's own projectId (see schema.prisma comment on the Decision model).

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id: meetingId } = await params;

  const decisions = await prisma.decision.findMany({
    where: { meetingId },
    include: { decidedBy: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { decidedAt: "desc" },
  });

  return NextResponse.json({ items: decisions });
});

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: meetingId } = await params;
  const body = parseBody(decisionSchema, await request.json());

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
    "เฉพาะผู้จัดประชุม ผู้เข้าร่วม หรือผู้ดูแลระบบเท่านั้นที่บันทึกมติของการประชุมนี้ได้"
  );

  const decision = await prisma.decision.create({
    data: { meetingId, content: body.content, decidedById: user.id },
    include: { decidedBy: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return NextResponse.json({ decision }, { status: 201 });
});
