import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { relatedResourceSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

// FR-12: Related Resources — multiple reference URLs/documents per meeting.

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id: meetingId } = await params;

  const resources = await prisma.relatedResource.findMany({
    where: { meetingId },
    include: { addedBy: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ items: resources });
});

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: meetingId } = await params;
  const body = parseBody(relatedResourceSchema, await request.json());

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
    "เฉพาะผู้จัดประชุม ผู้เข้าร่วม หรือผู้ดูแลระบบเท่านั้นที่เพิ่มเอกสารอ้างอิงของการประชุมนี้ได้"
  );

  const resource = await prisma.relatedResource.create({
    data: { meetingId, title: body.title, url: body.url, type: body.type, addedById: user.id },
    include: { addedBy: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return NextResponse.json({ resource }, { status: 201 });
});
