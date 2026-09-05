import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateProjectSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      manager: { select: { id: true, name: true, avatarUrl: true } },
      members: { include: { person: true } },
      meetings: { orderBy: { startTime: "asc" } },
      tasks: { orderBy: { dueDate: "asc" }, include: { assigneePerson: true, assignee: true } },
    },
  });
  if (!project) throw new ApiError(404, "ไม่พบโปรเจกต์นี้");

  const taskTotal = project.tasks.length;
  const taskCompleted = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const taskPending = project.tasks.filter((t) => t.status !== "COMPLETED" && (!t.dueDate || t.dueDate >= new Date())).length;
  const taskOverdue = project.tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate < new Date()).length;
  const progress = taskTotal > 0 ? Math.round((taskCompleted / taskTotal) * 100) : 0;

  return NextResponse.json({
    project,
    stats: { taskTotal, taskCompleted, taskPending, taskOverdue, progress },
  });
});

export const PUT = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(updateProjectSchema, await request.json());
  const { memberIds, startDate, endDate, ...rest } = body;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบโปรเจกต์นี้");
  assertOwner(user, existing.managerId === user.id, "เฉพาะผู้จัดการโปรเจกต์หรือผู้ดูแลระบบเท่านั้นที่แก้ไขโปรเจกต์นี้ได้");

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...rest,
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...(memberIds
        ? {
            members: {
              deleteMany: {},
              create: memberIds.map((personId) => ({ personId })),
            },
          }
        : {}),
    },
    include: { members: { include: { person: true } } },
  });

  return NextResponse.json({ project });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบโปรเจกต์นี้");
  assertOwner(user, existing.managerId === user.id, "เฉพาะผู้จัดการโปรเจกต์หรือผู้ดูแลระบบเท่านั้นที่ลบโปรเจกต์นี้ได้");

  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
