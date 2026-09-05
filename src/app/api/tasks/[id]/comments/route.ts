import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { taskCommentSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: taskId } = await params;
  const body = parseBody(taskCommentSchema, await request.json());

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiError(404, "ไม่พบงานนี้");
  assertOwner(
    user,
    task.assigneeId === user.id || task.createdById === user.id,
    "เฉพาะผู้รับผิดชอบ ผู้สร้างงาน หรือผู้ดูแลระบบเท่านั้นที่แสดงความคิดเห็นในงานนี้ได้"
  );

  const comment = await prisma.taskComment.create({
    data: { taskId, authorId: user.id, content: body.content },
    include: { author: true },
  });

  return NextResponse.json({ comment }, { status: 201 });
});
