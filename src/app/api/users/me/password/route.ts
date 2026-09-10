import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { changePasswordSchema } from "@/lib/validations";
import { ApiError, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(changePasswordSchema, await request.json());

  const supabase = await createClient();

  // Verify the current password the same way login does: a real sign-in
  // attempt. Also re-establishes a fresh session for `user`, which the
  // updateUser() call below then needs to be authenticated as them.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: body.currentPassword,
  });
  if (signInError) throw new ApiError(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");

  const { error: updateError } = await supabase.auth.updateUser({ password: body.newPassword });
  if (updateError) throw new ApiError(400, updateError.message);

  return NextResponse.json({ ok: true });
});
