import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for use in Client Components ("use client") —
 * the browser counterpart to createClient() in ./server.ts. Uses the same
 * publishable key; RLS (not the key) is what limits access. Unlike the
 * server client, this one doesn't need to be created fresh per request —
 * @supabase/ssr manages the session via browser cookies itself — but every
 * call site here still calls this factory rather than sharing one module-
 * level instance, matching @supabase/ssr's own documented pattern.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
