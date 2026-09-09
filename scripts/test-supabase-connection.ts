/**
 * One-off connectivity check for Supabase Auth, run before starting the real
 * Auth migration. Verifies:
 *   1. The secret key can drive the Admin API (createUser + listUsers/getUserById).
 *   2. The publishable key can construct a working client (getSession, no login).
 *
 * Does NOT delete the test user it creates — that's left for the actual
 * migration step B to clean up. Safe to delete this script afterwards.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !publishableKey || !secretKey) {
    console.error("Missing one of NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY in .env");
    process.exit(1);
  }

  console.log("=== 1. Admin API test (secret key) ===");
  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const testEmail = "connection-test@example.com";
  const testPassword = `Test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { data: createData, error: createError } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createError) {
    console.error("createUser FAILED:", createError.message);
    process.exit(1);
  }

  const createdUser = createData.user;
  console.log("createUser OK:");
  console.log("  id:   ", createdUser?.id);
  console.log("  email:", createdUser?.email);

  const { data: fetchedData, error: fetchError } = await admin.auth.admin.getUserById(createdUser!.id);
  if (fetchError || !fetchedData.user) {
    console.error("getUserById FAILED:", fetchError?.message);
    process.exit(1);
  }
  console.log("getUserById OK — confirmed round-trip through Supabase Auth:");
  console.log("  id:   ", fetchedData.user.id);
  console.log("  email:", fetchedData.user.email);
  console.log("  created_at:", fetchedData.user.created_at);

  console.log("\n=== 2. Publishable key client construction test ===");
  const anon = createClient(url, publishableKey);
  const { data: sessionData, error: sessionError } = await anon.auth.getSession();
  if (sessionError) {
    console.error("getSession FAILED:", sessionError.message);
    process.exit(1);
  }
  console.log("getSession OK (no error) — session:", sessionData.session === null ? "null (expected, not logged in)" : "unexpected non-null session");

  console.log("\n=== RESULT ===");
  console.log("Supabase Auth connection: OK (admin + publishable client both working)");
  console.log("Test user LEFT IN PLACE (not deleted) — id:", createdUser?.id, "email:", createdUser?.email);
  console.log("Remember to delete this user in migration step B.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
