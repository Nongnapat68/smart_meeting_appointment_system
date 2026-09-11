import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePagination, requireUser, withApiErrors } from "@/lib/api-helpers";
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

// POST (create) moved off this route — hybrid migration round 1 (Meeting
// resource): the frontend now calls supabase.rpc("create_meeting_with_
// participants", ...) directly (see src/components/meetings/MeetingForm.tsx
// and prisma/migrations/20260911170000_create_meeting_with_participants_function),
// followed by POST /api/meetings/[id]/notify for the email side (FR-09).
// GET (list) stays on Prisma/this route for now — only Meeting's create path
// moves this round; list/single-fetch/update/cancel/reschedule migrate in
// later rounds of this same pattern.
