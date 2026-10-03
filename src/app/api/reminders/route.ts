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

  // Built from the enum itself so a new status can't be left out of the counts.
  const counts = Object.fromEntries(Object.values(ReminderStatus).map((s) => [s, 0])) as Record<ReminderStatus, number>;
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

  // BR-14: a cancelled meeting gets no new reminders. Meeting.status is only
  // one of the ways in here - the create RPC takes p_status straight from the
  // caller, so a meeting can be *created* already cancelled, and the cancel
  // route updates status on its own row.
  if (meeting.status === "CANCELLED") {
    throw new ApiError(400, "ไม่สามารถเพิ่มการแจ้งเตือนให้การประชุมที่ถูกยกเลิกแล้วได้");
  }

  const scheduledAt = new Date(meeting.startTime.getTime() - body.offsetMinutes * 60 * 1000);

  // N7: an offset longer than the time still left before the meeting puts
  // scheduledAt in the past. process-due would then pick it up on the very
  // next run and email "your meeting starts soon" after it already started.
  // reschedule_meeting() already refuses this same situation by cancelling
  // the reminder instead of moving it, so the two paths now agree: reject at
  // creation instead of silently creating a reminder that fires instantly.
  if (scheduledAt.getTime() <= Date.now()) {
    throw new ApiError(
      400,
      "เวลาแจ้งเตือนต้องอยู่ก่อนเวลาเริ่มประชุมและยังไม่ผ่านไปแล้ว กรุณาลดระยะเวลาแจ้งเตือนลง"
    );
  }

  const reminder = await prisma.reminder.create({
    data: {
      meetingId: body.meetingId,
      scheduledAt,
    },
  });

  return NextResponse.json({ reminder }, { status: 201 });
});
