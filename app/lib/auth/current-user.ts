import { friendlyError } from "@/app/lib/errors";
import type { SessionUser } from "@/app/types/league";

/**
 * Who is signed in, from the browser's point of view, classified so that a
 * transient failure is never mistaken for "logged out"
 * (docs/release-architecture.md section 8.2).
 *
 * The proxy owns the auth gate. It verifies the session cookie (locally with
 * asymmetric signing keys) and sends any request for /login straight back to
 * /dashboard while that cookie is valid. auth-js `getUser()` on the other
 * hand returns `{ data: { user: null }, error }` and KEEPS the local session
 * for a network failure, a 5xx, a rate limit and for a rejected token
 * (`user_not_found`, a banned user); it only removes the session for
 * `AuthSessionMissingError`. A page that reacts to `data.user === null` with
 * `router.push("/login")` therefore loops: /dashboard -> /login -> proxy 307
 * /dashboard -> ... until the access token expires.
 *
 * Callers handle the three outcomes:
 * - `signed-in`: use `user.id` / `user.email`.
 * - `signed-out`: auth-js has no local session (or has just cleared it), so
 *   the proxy agrees and `router.replace("/login")` renders the login page.
 * - `error`: keep the session, render `message` with a Retry action, and do
 *   not navigate.
 */
export type CurrentUserResult =
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out" }
  | { status: "error"; message: string };

type AuthErrorLike = {
  name?: string | null;
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

/**
 * The slice of `SupabaseClient["auth"]` this helper needs. Structural so it
 * is testable with a stub and against the real auth-js client
 * (tests/unit/auth-current-user.test.ts).
 */
export type CurrentUserAuth = {
  getUser(): Promise<{
    data: { user: { id: string; email?: string | null } | null };
    error: AuthErrorLike | null;
  }>;
};

/**
 * True for auth-js `AuthSessionMissingError`: either there was no session in
 * storage to begin with, or the auth server answered `session_not_found`
 * (signed out elsewhere, deleted), in which case auth-js has already removed
 * the local session and cleared the cookies.
 */
export function isSessionMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as AuthErrorLike;
  return name === "AuthSessionMissingError" || code === "session_not_found";
}

export async function getCurrentUser(
  auth: CurrentUserAuth
): Promise<CurrentUserResult> {
  let result: Awaited<ReturnType<CurrentUserAuth["getUser"]>>;
  try {
    result = await auth.getUser();
  } catch (caught) {
    return { status: "error", message: friendlyError(caught) };
  }

  const { data, error } = result;

  if (data.user) {
    return {
      status: "signed-in",
      user: { id: data.user.id, email: data.user.email ?? null },
    };
  }

  // No user and no error only happens when auth-js found no session at all.
  if (error === null || isSessionMissingError(error)) {
    return { status: "signed-out" };
  }

  return { status: "error", message: friendlyError(error) };
}
