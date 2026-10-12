import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateTaskSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { removeTaskUploads } from "@/lib/task-uploads";
import { withNotificationActor } from "@/lib/notification-actor";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      project: true,
      meeting: true,
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      assigneePerson: true,
      createdBy: { select: { name: true } },
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { uploadedAt: "desc" } },
    },
  });
  if (!task) throw new ApiError(404, "ไม่พบงานนี้");

  return NextResponse.json({ task });
});

export const PATCH = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(updateTaskSchema, await request.json());

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบงานนี้");
  assertOwner(
    user,
    existing.assigneeId === user.id || existing.createdById === user.id,
    "เฉพาะผู้รับผิดชอบ ผู้สร้างงาน หรือผู้ดูแลระบบเท่านั้นที่แก้ไขงานนี้ได้"
  );

  let assigneeId: string | null | undefined = undefined;
  if (body.assigneePersonId !== undefined) {
    const assigneePerson = body.assigneePersonId
      ? await prisma.person.findUnique({ where: { id: body.assigneePersonId }, select: { userId: true } })
      : null;
    assigneeId = assigneePerson?.userId ?? null;
  }

  const wasCompleted = existing.status === "COMPLETED";
  const willBeCompleted = body.status === "COMPLETED";

  // Reassignment and status-change notifications (new assignee, previous
  // assignee, creator, meeting organizer - never this user) come from the
  // trg_notify_task_changed trigger (20261012090000); the actor setting tells
  // it who "this user" is, since a Prisma connection carries no JWT.
  const task = await withNotificationActor(user.id, (tx) =>
    tx.task.update({
      where: { id },
      data: {
        ...body,
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(willBeCompleted && !wasCompleted ? { completedAt: new Date() } : {}),
        ...(!willBeCompleted && body.status && body.status !== "COMPLETED" ? { completedAt: null } : {}),
      },
    })
  );

  return NextResponse.json({ task });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบงานนี้");
  assertOwner(
    user,
    existing.createdById === user.id,
    "เฉพาะผู้สร้างงานหรือผู้ดูแลระบบเท่านั้นที่ลบงานนี้ได้"
  );

  await prisma.task.delete({ where: { id } });
  await removeTaskUploads(id);
  return NextResponse.json({ ok: true });
});
