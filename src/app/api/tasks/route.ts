import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { taskSchema } from "@/lib/validations";
import { isAdmin, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { TaskStatus, type Prisma } from "@prisma/client";

export const GET = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const scope = searchParams.get("scope") ?? "mine";

  const canViewAll = isAdmin(user) && scope === "all";

  const where: Prisma.TaskWhereInput = {
    ...(canViewAll ? {} : { assigneeId: user.id }),
    ...(status && status in TaskStatus ? { status: status as TaskStatus } : {}),
  };

  const [items, counts] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        meeting: { select: { id: true, title: true } },
        assignee: { select: { name: true } },
        assigneePerson: { select: { name: true } },
      },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: canViewAll ? {} : { assigneeId: user.id },
      _count: true,
    }),
  ]);

  const now = new Date();
  const overdue = items.filter((t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate < now);

  const statusCounts = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 } as Record<TaskStatus, number>;
  counts.forEach((c) => {
    statusCounts[c.status] = c._count;
  });

  return NextResponse.json({
    items,
    total: items.length,
    statusCounts,
    overdueCount: overdue.length,
  });
});

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(taskSchema, await request.json());

  // A task's `assigneeId` (User) drives "my action items"; `assigneePersonId`
  // is who it's *for* in the contact directory (which may be an external
  // contact with no login). When the assigned person has a linked account,
  // both point at the same person.
  const assigneePerson = body.assigneePersonId
    ? await prisma.person.findUnique({ where: { id: body.assigneePersonId } })
    : null;

  const task = await prisma.task.create({
    data: {
      ...body,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      createdById: user.id,
      assigneeId: assigneePerson?.userId ?? null,
    },
  });

  if (assigneePerson?.userId && assigneePerson.userId !== user.id) {
    await prisma.notification.create({
      data: {
        userId: assigneePerson.userId,
        type: "TASK_ASSIGNED",
        title: "คุณได้รับมอบหมายงานใหม่",
        body: task.title,
        relatedId: task.id,
      },
    });
  }

  return NextResponse.json({ task }, { status: 201 });
});
