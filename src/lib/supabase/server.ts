import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase server client bound to the current request's cookies —
 * for use in Server Components, Route Handlers, and Server Actions.
 *
 * Must be created fresh for every request (never cached/reused across
 * requests — see @supabase/ssr's own guidance). Uses the publishable key,
 * same as the browser client; RLS (not the key) is what limits access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, which can't write cookies —
            // safe to ignore as long as proxy.ts is refreshing the session
            // (it is), per @supabase/ssr's documented pattern.
          }
        },
      },
    }
  );
}
