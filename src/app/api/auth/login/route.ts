import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, setSessionCookie, verifyPassword } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import { ApiError, jsonError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(loginSchema, await request.json());

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) {
    throw new ApiError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

  const { token, maxAge } = await createSessionToken(user.id, user.email, body.remember);
  await setSessionCookie(token, maxAge);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    },
  });
});

export function GET() {
  return jsonError(405, "Method not allowed");
}
