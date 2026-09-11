/**
 * Validation for the `next` redirect parameter carried through the proxy,
 * the auth callback route, and the login/signup/invite pages.
 *
 * A path is only honoured when it is a same-origin absolute path: it must
 * start with exactly one "/" (so "//evil.example" and "/\\evil" are rejected),
 * contain no scheme, no control characters and no backslashes.
 */

export const DEFAULT_NEXT_PATH = "/dashboard";

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function isSafeNextPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  if (CONTROL_CHARS.test(value)) return false;
  // Reject anything that could parse as a scheme once a lenient URL parser
  // strips the leading slash (e.g. "/javascript:alert(1)").
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

/**
 * Returns `value` when it is a safe relative path, otherwise `fallback`.
 * Also rejects redirect loops back into the auth pages themselves.
 */
export function sanitizeNextPath(
  value: unknown,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  if (!isSafeNextPath(value)) return fallback;
  const pathname = value.split(/[?#]/)[0] ?? "";
  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/auth/callback"
  ) {
    return fallback;
  }
  return value;
}

const CALLBACK_PATH = "/auth/callback";

/**
 * Resolves the `next` parameter as it arrives at `/auth/callback`.
 *
 * Besides a plain path, it accepts an absolute `http(s)` URL and keeps only
 * its path, query and fragment (the host is discarded, so this can never
 * redirect off-origin). When that path is `/auth/callback` itself, the
 * inner `next` is unwrapped one level. This is what a Supabase email
 * template that links to
 * `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}`
 * produces, because `emailRedirectTo` is already
 * `<origin>/auth/callback?next=<path>`. Token-hash links work from any
 * browser, unlike PKCE `?code` links which need the verifier cookie from
 * the browser that started the flow. Anything else falls back to
 * `fallback`, and the result always passes `sanitizeNextPath`.
 */
export function resolveCallbackNext(
  value: unknown,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;

  let candidate = value;
  if (!candidate.startsWith("/") && /^https?:\/\//i.test(candidate)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return fallback;
    }
    candidate = `${url.pathname}${url.search}${url.hash}`;
    // A bare origin (Supabase's default RedirectTo is the Site URL) names no
    // destination at all, so it means "the default page", not the landing.
    if (candidate === "/") return fallback;
  }

  if (candidate.split(/[?#]/)[0] === CALLBACK_PATH) {
    let inner: string | null = null;
    try {
      inner = new URL(candidate, "http://localhost").searchParams.get("next");
    } catch {
      inner = null;
    }
    return sanitizeNextPath(inner, fallback);
  }

  return sanitizeNextPath(candidate, fallback);
}

/** Builds `/login?next=...` (or `/signup?next=...`) for a destination. */
export function withNextParam(
  basePath: string,
  next: string | null | undefined
) {
  const safe = next && isSafeNextPath(next) ? next : null;
  if (!safe || safe === DEFAULT_NEXT_PATH) return basePath;
  return `${basePath}?next=${encodeURIComponent(safe)}`;
}
