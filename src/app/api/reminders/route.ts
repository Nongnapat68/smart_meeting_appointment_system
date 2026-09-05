import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withApiErrors } from "@/lib/api-helpers";
import { ReminderStatus, type Prisma } from "@prisma/client";

export const GET = withApiErrors(async (request: Request) => {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where: Prisma.ReminderWhereInput =
    status && status in ReminderStatus ? { status: status as ReminderStatus } : {};

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
