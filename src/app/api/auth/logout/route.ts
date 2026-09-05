import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
