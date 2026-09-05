import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validations";
import { ApiError, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(changePasswordSchema, await request.json());

  const valid = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!valid) throw new ApiError(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");

  const passwordHash = await hashPassword(body.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
});
