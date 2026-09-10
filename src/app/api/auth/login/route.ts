import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations";
import { ApiError, jsonError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(loginSchema, await request.json());

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (error || !data.user) {
    throw new ApiError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

  const user = await prisma.user.findUnique({ where: { id: data.user.id } });
  if (!user) {
    throw new ApiError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

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
