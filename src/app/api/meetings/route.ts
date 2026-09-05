import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingSchema } from "@/lib/validations";
import { parseBody, parsePagination, requireUser, withApiErrors } from "@/lib/api-helpers";
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

async function resolveParticipantPersonIds(
  personIds: string[],
  groupIds: string[],
  externalEmails: string[]
): Promise<string[]> {
  const ids = new Set(personIds);

  if (groupIds.length) {
    const memberships = await prisma.contactGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { personId: true },
    });
    memberships.forEach((m) => ids.add(m.personId));
  }

  for (const email of externalEmails) {
    const person = await prisma.person.upsert({
      where: { email },
      update: {},
      create: { name: email.split("@")[0], email, type: "EXTERNAL" },
    });
    ids.add(person.id);
  }

  return Array.from(ids);
}

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(meetingSchema, await request.json());

  const participantIds = await resolveParticipantPersonIds(
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
      organizerId: user.id,
      organizerPersonId: organizerPerson?.id,
      groups: body.groupIds.length ? { connect: body.groupIds.map((id) => ({ id })) } : undefined,
      participants: {
        create: participantIds.map((personId) => ({
          personId,
          role: personId === organizerPerson?.id ? "ORGANIZER" : "ATTENDEE",
        })),
      },
      reminders: {
        create: [{ scheduledAt: new Date(new Date(body.startTime).getTime() - 30 * 60 * 1000) }],
      },
    },
    include: { participants: { include: { person: true } } },
  });

  // Notify internal users who were invited.
  const invitedPersons = await prisma.person.findMany({
    where: { id: { in: participantIds }, userId: { not: null } },
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

  return NextResponse.json({ meeting }, { status: 201 });
});
