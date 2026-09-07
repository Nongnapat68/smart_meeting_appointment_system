import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateMeetingSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { resolveParticipants } from "@/lib/meeting-participants";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      organizer: { select: { id: true, name: true, avatarUrl: true } },
      project: { select: { id: true, name: true } },
      participants: { include: { person: true } },
      groups: true,
      tasks: true,
      aiSummary: true,
      onlineMeetingResource: true,
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      decisions: { include: { decidedBy: { select: { name: true } } }, orderBy: { decidedAt: "desc" } },
      resources: { include: { addedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");

  return NextResponse.json({ meeting });
});

export const PUT = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(updateMeetingSchema, await request.json());

  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(user, existing.organizerId === user.id, "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่แก้ไขการประชุมนี้ได้");

  if (body.startTime && body.endTime && new Date(body.endTime) <= new Date(body.startTime)) {
    throw new ApiError(400, "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");
  }

  const { participantPersonIds, groupIds, externalEmails, startTime, endTime, ...rest } = body;

  // MeetingForm always sends all three participant-related fields together
  // on every save, so re-resolve (and fully replace) the invite list whenever
  // any of them is present — same GROUP/DIRECT/EXTERNAL attribution logic as
  // POST /api/meetings (BR-04), instead of the old behavior here which just
  // recreated MeetingParticipant rows straight from participantPersonIds and
  // silently dropped every group invite back to plain DIRECT.
  const shouldResolveParticipants =
    participantPersonIds !== undefined || groupIds !== undefined || externalEmails !== undefined;
  const resolvedParticipants = shouldResolveParticipants
    ? await resolveParticipants(participantPersonIds ?? [], groupIds ?? [], externalEmails ?? [])
    : null;

  const meeting = await prisma.meeting.update({
    where: { id },
    data: {
      ...rest,
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(groupIds !== undefined ? { groups: { set: groupIds.map((gid) => ({ id: gid })) } } : {}),
      ...(resolvedParticipants
        ? {
            participants: {
              deleteMany: {},
              create: resolvedParticipants.map((rp) => ({
                personId: rp.personId,
                // The organizer keeps their ORGANIZER role/DIRECT source even
                // if they also happen to be a member of a selected group.
                role: rp.personId === existing.organizerPersonId ? "ORGANIZER" : "ATTENDEE",
                source: rp.personId === existing.organizerPersonId ? "DIRECT" : rp.source,
                sourceGroupId: rp.personId === existing.organizerPersonId ? null : rp.sourceGroupId,
              })),
            },
          }
        : {}),
    },
    include: { participants: { include: { person: true } }, groups: true },
  });

  return NextResponse.json({ meeting });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(user, existing.organizerId === user.id, "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ลบการประชุมนี้ได้");

  await prisma.meeting.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
