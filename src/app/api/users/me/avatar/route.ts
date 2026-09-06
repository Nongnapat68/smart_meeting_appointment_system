import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกรูปภาพ");
  if (file.size === 0) throw new ApiError(400, "ไฟล์รูปภาพว่างเปล่า");
  if (file.size > MAX_FILE_SIZE) throw new ApiError(400, "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 5MB)");
  if (!ALLOWED_TYPES.has(file.type)) throw new ApiError(400, "รองรับเฉพาะไฟล์รูปภาพ (PNG, JPEG, WEBP, GIF)");

  const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
  await mkdir(uploadDir, { recursive: true });

  const ext = file.type.split("/")[1];
  const storedName = `${user.id}-${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, storedName), buffer);

  const avatarUrl = `/uploads/avatars/${storedName}`;
  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });
  await prisma.person.updateMany({ where: { userId: user.id }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
});
