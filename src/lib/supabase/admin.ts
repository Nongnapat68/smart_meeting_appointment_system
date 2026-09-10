import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using SUPABASE_SECRET_KEY — full Admin API
 * access (create/delete users, update passwords by id, etc). Never import
 * this from client-side code or expose the secret key to the browser.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
