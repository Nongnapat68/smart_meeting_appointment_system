import { NextResponse } from "next/server";
import { verifyOtpForEmail } from "@/lib/auth";
import { verifyOtpSchema } from "@/lib/validations";
import { ApiError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(verifyOtpSchema, await request.json());
  const result = await verifyOtpForEmail(body.email, body.otp);

  if (!result.valid) {
    throw new ApiError(400, "รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว");
  }

  return NextResponse.json({ ok: true });
});
