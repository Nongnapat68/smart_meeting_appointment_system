import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async () => {
  const supabase = await createClient();
  // scope: "local" signs out only this browser session (clears this device's
  // cookies). The default ("global") also revokes every refresh token for the
  // account on all other devices — too aggressive for a plain logout.
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
});
