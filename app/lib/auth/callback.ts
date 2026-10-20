/**
 * Shared vocabulary between app/auth/callback/route.ts (which writes
 * `/login?error=...`) and the login page (which turns it into copy).
 */

/**
 * `auth`: the email link was invalid or expired (or Supabase redirected
 * back with an `error` parameter).
 * `auth-device`: the PKCE `?code` was fine but the verifier cookie was
 * missing, which happens when a confirmation email is opened in a different
 * browser or device than the one that signed up. Supabase has already
 * confirmed the email in that case, so the user only needs to log in.
 * `auth-provider`: a sign-in through Discord did not finish: Discord or
 * Supabase sent back an `error` (the user cancelled, or the provider is
 * off), or its `?code` could not be exchanged.
 */
export type CallbackFailure = "auth" | "auth-device" | "auth-provider";

/** What the login form renders for a callback failure. */
export type LinkError = "invalid" | "other-device" | "provider";

const FAILURE_TO_LINK_ERROR: Record<CallbackFailure, LinkError> = {
  auth: "invalid",
  "auth-device": "other-device",
  "auth-provider": "provider",
};

/** Maps a raw `/login?error=` value to a LinkError, or null for anything else. */
export function parseCallbackFailure(
  value: string | null | undefined
): LinkError | null {
  if (value === "auth" || value === "auth-device" || value === "auth-provider") {
    return FAILURE_TO_LINK_ERROR[value];
  }
  return null;
}

/**
 * The query parameter a Discord sign-in adds to its `/auth/callback` URL
 * (`provider=discord`), so the route can tell a provider's return from an
 * email link's when it fails.
 */
export const PROVIDER_PARAM = "provider";

/** Where Discord sends the user back: `/auth/callback` with `next` and the provider marker. */
export function providerCallbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}&${PROVIDER_PARAM}=discord`;
}

/** Error code GoTrue uses when the PKCE verifier is not in storage. */
export const PKCE_VERIFIER_MISSING_CODE = "pkce_code_verifier_not_found";

/**
 * True for `AuthPKCECodeVerifierMissingError` from `exchangeCodeForSession`:
 * the `<storageKey>-code-verifier` cookie set by `signUp` /
 * `resetPasswordForEmail` is absent in this browser.
 */
export function isPkceVerifierMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, name } = error as { code?: unknown; name?: unknown };
  return (
    code === PKCE_VERIFIER_MISSING_CODE ||
    name === "AuthPKCECodeVerifierMissingError"
  );
}

/** Classifies a failed `exchangeCodeForSession` / `verifyOtp` error. */
export function classifyCallbackError(error: unknown): CallbackFailure {
  return isPkceVerifierMissing(error) ? "auth-device" : "auth";
}
