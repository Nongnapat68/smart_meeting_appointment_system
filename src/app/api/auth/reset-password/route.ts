import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyOtpForEmail } from "@/lib/auth";
import { resetPasswordSchema } from "@/lib/validations";
import { ApiError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(resetPasswordSchema, await request.json());
  const result = await verifyOtpForEmail(body.email, body.otp);

  if (!result.valid || !result.userId || !result.otpRecordId) {
    throw new ApiError(400, "รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว");
  }

  const passwordHash = await hashPassword(body.password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: result.userId }, data: { passwordHash } }),
    prisma.passwordResetOtp.update({
      where: { id: result.otpRecordId },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
});
