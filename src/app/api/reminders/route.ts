import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createReminderSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { ReminderStatus, type Prisma } from "@prisma/client";

export const GET = withApiErrors(async (request: Request) => {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const meetingId = searchParams.get("meetingId");

  const where: Prisma.ReminderWhereInput = {
    ...(status && status in ReminderStatus ? { status: status as ReminderStatus } : {}),
    ...(meetingId ? { meetingId } : {}),
  };

  const [items, statusCounts] = await Promise.all([
    prisma.reminder.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      include: {
        meeting: {
          include: { participants: { include: { person: true } } },
        },
      },
      take: 100,
    }),
    prisma.reminder.groupBy({ by: ["status"], _count: true }),
  ]);

  const counts = { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 } as Record<ReminderStatus, number>;
  statusCounts.forEach((c) => {
    counts[c.status] = c._count;
  });

  return NextResponse.json({ items, counts, total: items.length });
});

// FR-10/BR-11: add another reminder to a meeting that already exists — the
// initial batch is created inline by POST /api/meetings (reminderOffsetMinutes).
export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(createReminderSchema, await request.json());

  const meeting = await prisma.meeting.findUnique({ where: { id: body.meetingId } });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(
    user,
    meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่เพิ่มการแจ้งเตือนของการประชุมนี้ได้"
  );

  const reminder = await prisma.reminder.create({
    data: {
      meetingId: body.meetingId,
      scheduledAt: new Date(meeting.startTime.getTime() - body.offsetMinutes * 60 * 1000),
    },
  });

  return NextResponse.json({ reminder }, { status: 201 });
});
