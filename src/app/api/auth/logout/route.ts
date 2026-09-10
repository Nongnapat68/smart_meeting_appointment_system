import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
});
