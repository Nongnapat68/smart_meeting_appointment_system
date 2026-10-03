import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { issuePasswordResetOtp } from "@/lib/otp";
import { forgotPasswordSchema } from "@/lib/validations";
import { parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(forgotPasswordSchema, await request.json());

  const user = await prisma.user.findUnique({ where: { email: body.email } });

  // Always respond the same way whether or not the email exists, so this
  // endpoint can't be used to enumerate registered accounts. That includes
  // the rate limit: answering 429 only for registered emails would leak
  // exactly that, so an over-limit request is dropped silently instead.
  if (user) {
    const otp = await issuePasswordResetOtp(user.id);
    if (otp) {
      await sendEmail({
        to: user.email,
        subject: "รหัสยืนยัน (OTP) สำหรับรีเซ็ตรหัสผ่าน — Smart Meeting",
        text: `รหัสยืนยันของคุณคือ: ${otp}\nรหัสนี้จะหมดอายุใน 10 นาที`,
      });
    } else {
      console.warn(`[forgot-password] OTP request limit reached for user ${user.id}; no email sent`);
    }
  }

  return NextResponse.json({ ok: true });
});
