import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateTaskSchedule } from "@/lib/ai";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async () => {
  const user = await requireUser();

  const tasks = await prisma.task.findMany({
    where: { assigneeId: user.id, status: { not: "COMPLETED" } },
    include: { project: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });

  if (tasks.length === 0) {
    throw new ApiError(400, "ไม่มีงานที่ต้องจัดตารางในขณะนี้");
  }

  let schedule: string;
  try {
    schedule = await generateTaskSchedule(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
        status: t.status,
        projectName: t.project?.name ?? null,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "ไม่สามารถสร้างตารางงานด้วย AI ได้";
    throw new ApiError(502, message);
  }

  return NextResponse.json({ schedule });
});
