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

interface ResolvedParticipant {
  personId: string;
  source: "DIRECT" | "GROUP" | "EXTERNAL";
  sourceGroupId: string | null;
}

/**
 * Resolves the three participant sources (direct picks, group members, raw
 * external emails) into a deduped list — while still remembering *how* each
 * person got onto the invite (BR-04), unlike the old version which only kept
 * a flat `Set<personId>` and threw that information away.
 *
 * Precedence when the same person appears via more than one source: DIRECT
 * wins over GROUP/EXTERNAL, since an explicit pick is the most specific
 * signal of intent; first-matching group wins if they're in more than one
 * selected group (a participant has exactly one sourceGroupId in this schema).
 */
async function resolveParticipants(
  personIds: string[],
  groupIds: string[],
  externalEmails: string[]
): Promise<ResolvedParticipant[]> {
  const resolved = new Map<string, ResolvedParticipant>();

  personIds.forEach((personId) => {
    resolved.set(personId, { personId, source: "DIRECT", sourceGroupId: null });
  });

  if (groupIds.length) {
    const memberships = await prisma.contactGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { personId: true, groupId: true },
    });
    memberships.forEach((m) => {
      if (!resolved.has(m.personId)) {
        resolved.set(m.personId, { personId: m.personId, source: "GROUP", sourceGroupId: m.groupId });
      }
    });
  }

  for (const email of externalEmails) {
    const person = await prisma.person.upsert({
      where: { email },
      update: {},
      create: { name: email.split("@")[0], email, type: "EXTERNAL" },
    });
    if (!resolved.has(person.id)) {
      resolved.set(person.id, { personId: person.id, source: "EXTERNAL", sourceGroupId: null });
    }
  }

  return Array.from(resolved.values());
}

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
          role: rp.personId === organizerPerson?.id ? "ORGANIZER" : "ATTENDEE",
          source: rp.personId === organizerPerson?.id ? "DIRECT" : rp.source,
          sourceGroupId: rp.sourceGroupId,
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
    include: { participants: { include: { person: true } } },
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

  return NextResponse.json({ meeting }, { status: 201 });
});
