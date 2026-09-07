import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectSchema } from "@/lib/validations";
import { parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const GET = withApiErrors(async () => {
  const user = await requireUser();
  const userPerson = await prisma.person.findUnique({ where: { userId: user.id } });

  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { managerId: user.id },
        ...(userPerson ? [{ members: { some: { personId: userPerson.id } } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      manager: { select: { name: true } },
      members: { include: { person: true } },
      _count: { select: { meetings: true, tasks: true } },
    },
  });

  const withProgress = await Promise.all(
    projects.map(async (p) => {
      const [total, completed] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id } }),
        prisma.task.count({ where: { projectId: p.id, status: "COMPLETED" } }),
      ]);
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { ...p, progress, taskTotal: total, taskCompleted: completed };
    })
  );

  return NextResponse.json({ items: withProgress });
});

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(projectSchema, await request.json());
  const { memberIds, ...data } = body;

  const project = await prisma.project.create({
    data: {
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      managerId: user.id,
      members: {
        create: memberIds.map((personId) => ({ personId })),
      },
    },
    include: { members: { include: { person: true } } },
  });

  return NextResponse.json({ project }, { status: 201 });
});
