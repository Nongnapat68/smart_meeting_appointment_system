import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingSchema } from "@/lib/validations";
import { parseBody, parsePagination, requireUser, withApiErrors } from "@/lib/api-helpers";
import { resolveParticipants } from "@/lib/meeting-participants";
import { notifyParticipantsByEmail } from "@/lib/meeting-notify";
import { MeetingStatus, MeetingType, type Prisma } from "@prisma/client";

export const GET = withApiErrors(async (request: Request) => {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status");
  const type = searchParams.get("type");

  const where: Prisma.MeetingWhereInput = {
    ...(q ? { title: { contains: q } } : {}),
    ...(status && status in MeetingStatus ? { status: status as MeetingStatus } : {}),
    ...(type && type in MeetingType ? { type: type as MeetingType } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: { startTime: "desc" },
      skip,
      take,
      include: {
        organizer: { select: { name: true, avatarUrl: true } },
        project: { select: { name: true } },
        participants: { include: { person: true } },
      },
    }),
    prisma.meeting.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
});

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(meetingSchema, await request.json());

  const resolvedParticipants = await resolveParticipants(
    body.participantPersonIds,
    body.groupIds,
    body.externalEmails
  );

  const organizerPerson = await prisma.person.findUnique({ where: { userId: user.id } });

  const meeting = await prisma.meeting.create({
    data: {
      title: body.title,
      description: body.description,
      type: body.type,
      status: body.status,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      location: body.location,
      projectId: body.projectId || null,
      onlineMeetingResourceId: body.onlineMeetingResourceId || null,
      organizerId: user.id,
      organizerPersonId: organizerPerson?.id,
      groups: body.groupIds.length ? { connect: body.groupIds.map((id) => ({ id })) } : undefined,
      participants: {
        create: resolvedParticipants.map((rp) => ({
          personId: rp.personId,
          // The organizer keeps their ORGANIZER role/DIRECT source even if they
          // also happen to be a member of a selected group — and sourceGroupId
          // is cleared alongside it, so a forced-DIRECT row never carries a
          // stale group reference (source/sourceGroupId must stay consistent;
          // same override PUT /api/meetings/[id] already applies).
          role: rp.personId === organizerPerson?.id ? "ORGANIZER" : "ATTENDEE",
          source: rp.personId === organizerPerson?.id ? "DIRECT" : rp.source,
          sourceGroupId: rp.personId === organizerPerson?.id ? null : rp.sourceGroupId,
        })),
      },
      // FR-10/BR-11: one reminder per requested offset instead of a single
      // hardcoded "30 minutes before" row.
      reminders: {
        create: body.reminderOffsetMinutes.map((mins) => ({
          scheduledAt: new Date(new Date(body.startTime).getTime() - mins * 60 * 1000),
        })),
      },
    },
    include: {
      participants: { include: { person: true } },
      organizerPerson: { select: { name: true, email: true } },
      onlineMeetingResource: { select: { url: true } },
    },
  });

  // Notify internal users who were invited.
  const invitedPersons = await prisma.person.findMany({
    where: { id: { in: resolvedParticipants.map((rp) => rp.personId) }, userId: { not: null } },
    select: { userId: true },
  });
  if (invitedPersons.length) {
    await prisma.notification.createMany({
      data: invitedPersons
        .filter((p) => p.userId && p.userId !== user.id)
        .map((p) => ({
          userId: p.userId as string,
          type: "MEETING_INVITE",
          title: "คำเชิญเข้าร่วมประชุมใหม่",
          body: meeting.title,
          relatedId: meeting.id,
        })),
    });
  }

  // FR-09: email every participant (internal + external alike) with the
  // meeting's .ics attached — best-effort, so a delivery hiccup doesn't fail
  // meeting creation itself.
  try {
    await notifyParticipantsByEmail(meeting, "คำเชิญเข้าร่วมประชุมใหม่");
  } catch (err) {
    console.error("notifyParticipantsByEmail failed for meeting", meeting.id, err);
  }

  return NextResponse.json({ meeting }, { status: 201 });
});
