import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateMeetingSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { notifyMeetingParticipants } from "@/lib/meeting-notify";

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

  const { participantPersonIds, groupIds, startTime, endTime, projectId, onlineMeetingResourceId, ...rest } = body;

  const meeting = await prisma.meeting.update({
    where: { id },
    data: {
      ...rest,
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(projectId !== undefined ? { project: projectId ? { connect: { id: projectId } } : { disconnect: true } } : {}),
      ...(onlineMeetingResourceId !== undefined
        ? { onlineMeetingResource: onlineMeetingResourceId ? { connect: { id: onlineMeetingResourceId } } : { disconnect: true } }
        : {}),
      ...(groupIds ? { groups: { set: groupIds.map((gid) => ({ id: gid })) } } : {}),
      ...(participantPersonIds
        ? {
            participants: {
              deleteMany: {},
              create: participantPersonIds.map((personId) => ({ personId })),
            },
          }
        : {}),
    },
    include: { participants: { include: { person: true } } },
  });

  await notifyMeetingParticipants({
    meetingId: meeting.id,
    type: "MEETING_UPDATED",
    title: "มีการแก้ไขการประชุม",
    emailPrefix: "การประชุมถูกแก้ไข",
    excludeUserId: user.id,
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
