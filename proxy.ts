import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";

/**
 * Auth gate (docs/release-architecture.md section 3.1).
 *
 * - Refreshes the Supabase session cookies on every matched request and
 *   copies the refreshed cookies (plus the Cache-Control headers Supabase
 *   asks for) onto every response, including redirects.
 * - Unauthenticated requests to protected paths go to /login?next=...
 * - Authenticated requests to /, /login and /signup go to /dashboard (or to a
 *   validated ?next), but only after the auth server confirmed the session.
 */

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/update-password",
  "/auth/callback",
]);

const AUTH_ENTRY_PATHS = new Set(["/", "/login", "/signup"]);

// Another project shares this repo (static pages under public/ plus
// app/api/castmirror); those routes were public before the proxy existed.
const OTHER_APP_EXACT = new Set(["/castmirror", "/CastMirror", "/raidcard"]);

function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/invite/")) return true;
  if (OTHER_APP_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/castmirror/")) return true;
  return false;
}

const COPIED_HEADERS = ["cache-control", "expires", "pragma"];

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // Verifies the JWT (locally with asymmetric keys, otherwise via the auth
  // server) and refreshes the session when it is about to expire.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;

  const { pathname, search, searchParams } = request.nextUrl;

  function redirectTo(path: string) {
    const response = NextResponse.redirect(new URL(path, request.url));
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    for (const header of COPIED_HEADERS) {
      const value = supabaseResponse.headers.get(header);
      if (value) response.headers.set(header, value);
    }
    return response;
  }

  if (!userId && !isPublicPath(pathname)) {
    const next = sanitizeNextPath(`${pathname}${search}`, "");
    return redirectTo(
      next ? `/login?next=${encodeURIComponent(next)}` : "/login"
    );
  }

  if (userId && AUTH_ENTRY_PATHS.has(pathname)) {
    // A locally verified JWT is not proof that the auth server still accepts
    // the session: the browser client's own `getUser()` may just have failed
    // (auth server unreachable, user deleted or banned) and sent the user
    // here. Bouncing them straight back to /dashboard on the strength of the
    // cookie alone would loop until the access token expired, so confirm
    // with the auth server first and render the public page when it cannot
    // vouch for the session. When it answers `session_not_found`, auth-js
    // clears the cookies through `setAll`, so the response below carries the
    // clearing Set-Cookie headers as well.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return supabaseResponse;
    }
    return redirectTo(sanitizeNextPath(searchParams.get("next")));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
