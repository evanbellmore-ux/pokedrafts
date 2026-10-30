import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";
import { contentSecurityPolicy } from "@/app/lib/content-security-policy";
import { SIGNED_IN_SECTIONS, isInSection } from "@/app/lib/site";

/**
 * Auth gate (docs/release-architecture.md section 3.1).
 *
 * - Refreshes the Supabase session cookies on every matched request and
 *   copies the refreshed cookies (plus the Cache-Control headers Supabase
 *   asks for) onto every response, including redirects.
 * - Unauthenticated requests anywhere in a signed-in section go to
 *   /login?next=... Any other path that is not public passes through, so a
 *   URL with no page renders app/not-found.tsx with a 404.
 * - Authenticated requests to /, /login and /signup go to /dashboard (or to a
 *   validated ?next), but only after the auth server confirmed the session.
 * - Every page it lets through carries the Content-Security-Policy, with a
 *   fresh nonce per request (app/lib/content-security-policy.ts).
 */

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/update-password",
  "/auth/callback",
  "/watch",
  "/privacy",
  "/terms",
]);

const AUTH_ENTRY_PATHS = new Set(["/", "/login", "/signup"]);

// Another project shares this repo (static pages under public/ plus
// app/api/castmirror); those routes were public before the proxy existed.
const OTHER_APP_EXACT = new Set(["/castmirror", "/CastMirror", "/castmirror/guild-execution", "/raidcard"]);

function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/invite/")) return true;
  // Public leagues: the Watch list and each league's watch page.
  if (pathname.startsWith("/watch/")) return true;
  if (OTHER_APP_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/castmirror/")) return true;
  return false;
}

/**
 * Paths that are not public and send a signed-out visitor to /login whether
 * or not a page matches them: the signed-in sections, plus the other
 * project's /castmirror area, which keeps the earlier rule that anything not
 * listed above needs a session.
 */
function needsSession(pathname: string) {
  if (SIGNED_IN_SECTIONS.some((section) => isInSection(pathname, section))) return true;
  return isInSection(pathname, "/castmirror");
}

/** The other project's pages, API and static files keep no PokeDrafts CSP. */
function isOtherAppPath(pathname: string) {
  if (OTHER_APP_EXACT.has(pathname)) return true;
  if (isInSection(pathname, "/castmirror") || pathname.startsWith("/api/castmirror/")) return true;
  return pathname === "/castmirror.html" || pathname === "/raidcard.html";
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

  const { pathname, search, searchParams } = request.nextUrl;

  // Set on the request before any NextResponse.next({ request }) copies its
  // headers: Next reads the nonce from this header while rendering.
  const policy = isOtherAppPath(pathname)
    ? null
    : contentSecurityPolicy({
        nonce: Buffer.from(crypto.randomUUID()).toString("base64"),
        supabaseUrl,
        development: process.env.NODE_ENV === "development",
        https: request.nextUrl.protocol === "https:",
      });
  if (policy) request.headers.set("content-security-policy", policy);

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

  /** Lets the request through to the page, under the policy. */
  function render() {
    if (policy) supabaseResponse.headers.set("content-security-policy", policy);
    return supabaseResponse;
  }

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

  if (!userId && !isPublicPath(pathname) && needsSession(pathname)) {
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
      return render();
    }
    return redirectTo(sanitizeNextPath(searchParams.get("next")));
  }

  return render();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
