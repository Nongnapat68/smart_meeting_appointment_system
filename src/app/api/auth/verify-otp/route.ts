import { NextResponse } from "next/server";
import { OTP_INVALID_MESSAGE, verifyOtpForEmail } from "@/lib/otp";
import { verifyOtpSchema } from "@/lib/validations";
import { ApiError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(verifyOtpSchema, await request.json());
  const result = await verifyOtpForEmail(body.email, body.otp);

  if (!result.valid) {
    throw new ApiError(400, OTP_INVALID_MESSAGE);
  }

  return NextResponse.json({ ok: true });
});
