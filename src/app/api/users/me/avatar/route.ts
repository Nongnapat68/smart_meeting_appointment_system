import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";
import { checkAvatarUpload } from "@/lib/upload-validation";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกรูปภาพ");
  if (file.size > MAX_FILE_SIZE) throw new ApiError(400, "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 5MB)");

  // Extension + declared MIME + magic bytes must all say "image" — the
  // declared MIME alone used to decide this, and the client controls it.
  const buffer = Buffer.from(await file.arrayBuffer());
  const checked = checkAvatarUpload(file, buffer);
  if (!checked.ok) throw new ApiError(400, checked.message);

  const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
  await mkdir(uploadDir, { recursive: true });

  const storedName = `${user.id}-${randomUUID()}.${checked.ext}`;
  await writeFile(path.join(uploadDir, storedName), buffer);

  const avatarUrl = `/uploads/avatars/${storedName}`;
  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });
  await prisma.person.updateMany({ where: { userId: user.id }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
});
