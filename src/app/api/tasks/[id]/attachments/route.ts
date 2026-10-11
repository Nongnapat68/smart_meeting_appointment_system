import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  checkAttachmentRequestSize,
  checkAttachmentUpload,
} from "@/lib/upload-validation";
import { removeTaskUploads, taskUploadDir } from "@/lib/task-uploads";

type Params = { params: Promise<{ id: string }> };

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

  // Refuse an oversized upload from its Content-Length before reading the body.
  const sizeCheck = checkAttachmentRequestSize(request.headers.get("content-length"));
  if (!sizeCheck.ok) throw new ApiError(413, sizeCheck.message);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // A body cut short (e.g. past the proxy's buffer) can't be parsed —
    // answer with the size rule instead of a generic 500.
    throw new ApiError(400, `อ่านไฟล์ที่อัปโหลดไม่สำเร็จ — ${ATTACHMENT_TOO_LARGE_MESSAGE}`);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาแนบไฟล์");
  if (file.size > ATTACHMENT_MAX_BYTES) throw new ApiError(400, ATTACHMENT_TOO_LARGE_MESSAGE);

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

// The task page deletes the Task row through supabase-js (RLS
// delete_creator_only_or_admin) and then calls this to remove the files left
// on disk. It only cleans up after a task that no longer exists, so it can
// never remove the attachments of a live task.
export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id: taskId } = await params;
  if (!taskUploadDir(taskId)) throw new ApiError(400, "รหัสงานไม่ถูกต้อง");

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (task) throw new ApiError(409, "งานนี้ยังไม่ถูกลบ จึงลบไฟล์แนบออกจากเครื่องไม่ได้");

  await removeTaskUploads(taskId);
  return NextResponse.json({ ok: true });
});
