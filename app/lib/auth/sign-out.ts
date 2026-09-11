import { friendlyError } from "@/app/lib/errors";

/**
 * The slice of `SupabaseClient["auth"]` that signing out needs. Kept
 * structural so the helper is unit-testable with a stub and against the
 * real auth-js client (tests/unit/auth-sign-out.test.ts).
 */
export type SignOutAuth = {
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
};

export type SignOutResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Signs out of this browser only (`scope: 'local'`) and reports failure
 * instead of swallowing it (docs/release-architecture.md section 3.2).
 *
 * auth-js still POSTs to `/logout?scope=local` for a local scope and, when
 * that request fails with anything other than a 401/403/404 (network
 * failure, 5xx, rate limit), returns `{ error }` WITHOUT removing the local
 * session. Navigating to /login in that state bounces straight back to
 * /dashboard through the proxy, so callers must only navigate when `ok`.
 */
export async function signOutLocally(
  auth: SignOutAuth
): Promise<SignOutResult> {
  try {
    const { error } = await auth.signOut({ scope: "local" });
    if (error) return { ok: false, message: friendlyError(error) };
    return { ok: true };
  } catch (caught) {
    return { ok: false, message: friendlyError(caught) };
  }
}
