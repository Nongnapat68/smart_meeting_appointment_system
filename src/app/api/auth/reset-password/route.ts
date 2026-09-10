import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOtpForEmail } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetPasswordSchema } from "@/lib/validations";
import { ApiError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(resetPasswordSchema, await request.json());
  const result = await verifyOtpForEmail(body.email, body.otp);

  if (!result.valid || !result.userId || !result.otpRecordId) {
    throw new ApiError(400, "รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(result.userId, {
    password: body.password,
  });
  if (error) {
    throw new ApiError(400, "ไม่สามารถตั้งรหัสผ่านใหม่ได้ กรุณาลองใหม่อีกครั้ง");
  }

  // Only mark the OTP used once the password change actually took — one
  // that failed to apply must stay usable for the user to retry.
  await prisma.passwordResetOtp.update({
    where: { id: result.otpRecordId },
    data: { usedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
