import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";
import { checkAttachmentUpload } from "@/lib/upload-validation";

type Params = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — plenty for the task-attachment use case here

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiError(404, "ไม่พบงานนี้");
  assertOwner(
    user,
    task.assigneeId === user.id || task.createdById === user.id,
    "เฉพาะผู้รับผิดชอบ ผู้สร้างงาน หรือผู้ดูแลระบบเท่านั้นที่แนบไฟล์ในงานนี้ได้"
  );

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาแนบไฟล์");
  if (file.size > MAX_FILE_SIZE) throw new ApiError(400, "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)");

  // Type check before anything touches disk — see src/lib/upload-validation.ts.
  const buffer = Buffer.from(await file.arrayBuffer());
  const checked = checkAttachmentUpload(file, buffer);
  if (!checked.ok) throw new ApiError(400, checked.message);

  const uploadDir = path.join(process.cwd(), "public", "uploads", "tasks", taskId);
  await mkdir(uploadDir, { recursive: true });

  // Stored under the validated extension (lower-cased) as the only dot in the
  // name, so "evil.html.png" can't become a double extension and the static
  // server's Content-Type always follows the checked type.
  const baseName = file.name.slice(0, file.name.lastIndexOf(".")).replace(/[^a-zA-Z0-9\-_ก-๙]/g, "_");
  const storedName = `${randomUUID()}-${baseName}.${checked.ext}`;
  await writeFile(path.join(uploadDir, storedName), buffer);

  const attachment = await prisma.taskAttachment.create({
    data: {
      taskId,
      fileName: file.name,
      fileUrl: `/uploads/tasks/${taskId}/${storedName}`,
      fileSize: file.size,
      mimeType: checked.mime,
    },
  });

  return NextResponse.json({ attachment }, { status: 201 });
});
