import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";
import {
  AVATAR_MAX_BYTES,
  AVATAR_TOO_LARGE_MESSAGE,
  checkAvatarRequestSize,
  checkAvatarUpload,
} from "@/lib/upload-validation";

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();

  // Refuse an oversized upload from its Content-Length before reading the body.
  const sizeCheck = checkAvatarRequestSize(request.headers.get("content-length"));
  if (!sizeCheck.ok) throw new ApiError(413, sizeCheck.message);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // A body cut short (e.g. past the proxy's buffer) can't be parsed —
    // answer with the size rule instead of a generic 500.
    throw new ApiError(400, `อ่านไฟล์ที่อัปโหลดไม่สำเร็จ — ${AVATAR_TOO_LARGE_MESSAGE}`);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกรูปภาพ");
  if (file.size > AVATAR_MAX_BYTES) throw new ApiError(400, AVATAR_TOO_LARGE_MESSAGE);

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
