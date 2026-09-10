import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that don't require a logged-in session.
const PUBLIC_PATHS = ["/login", "/forgot-password"];
const PUBLIC_API_PREFIXES = ["/api/auth/"];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Built up alongside the Supabase client below: setAll() re-creates this
  // with the refreshed auth cookies attached, so it must exist before the
  // client does and be returned (not a fresh NextResponse.next()) at the end.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() (not getSession()) is what actually revalidates the token,
  // refreshing it if it's expiring — the refreshed cookies are written back
  // via setAll above. Always call this, even on public paths, so a session
  // doesn't go stale just because someone lingers on /login.
  const { data } = await supabase.auth.getClaims();
  const authenticated = !!data?.claims;

  if (isPublicPath(pathname)) {
    return response;
  }

  if (!authenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อนใช้งาน" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and image optimization files.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
