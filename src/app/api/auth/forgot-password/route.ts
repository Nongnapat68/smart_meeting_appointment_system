import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { generateOtp, sendEmail } from "@/lib/email";
import { forgotPasswordSchema } from "@/lib/validations";
import { parseBody, withApiErrors } from "@/lib/api-helpers";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes (independent of the UI's 60s resend-cooldown)

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(forgotPasswordSchema, await request.json());

  const user = await prisma.user.findUnique({ where: { email: body.email } });

  // Always respond the same way whether or not the email exists, so this
  // endpoint can't be used to enumerate registered accounts.
  if (user) {
    const otp = generateOtp();
    const otpHash = await hashPassword(otp);
    await prisma.passwordResetOtp.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await sendEmail({
      to: user.email,
      subject: "รหัสยืนยัน (OTP) สำหรับรีเซ็ตรหัสผ่าน — Smart Meeting",
      text: `รหัสยืนยันของคุณคือ: ${otp}\nรหัสนี้จะหมดอายุใน 10 นาที`,
    });
  }

  return NextResponse.json({ ok: true });
});
