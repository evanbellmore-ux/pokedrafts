/**
 * Maps Supabase / PostgREST / auth / network errors to sentences that are
 * safe and useful to show to users. Raw database messages are logged to the
 * console and replaced with a generic sentence; messages raised by our own
 * Postgres functions (SQLSTATE P0001) are written for users and shown
 * verbatim, as are GoTrue auth messages.
 */

export type ErrorLike = {
  code?: string | number | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  name?: string | null;
  status?: number | null;
  __isAuthError?: boolean;
};

export const GENERIC_ERROR = "Something went wrong, please try again.";
export const CONNECTION_ERROR = "Connection problem, please try again.";
export const PERMISSION_ERROR = "You do not have permission to do that.";
export const NOTHING_TO_UPDATE_ERROR =
  "Nothing to update, you may not have permission.";
export const ALREADY_EXISTS_ERROR = "That already exists.";
export const TOO_MANY_REQUESTS_ERROR =
  "Too many attempts, please wait a moment and try again.";
export const SESSION_EXPIRED_ERROR = "Your session has expired. Log in again.";
export const ACCOUNT_UNAVAILABLE_ERROR = "This account is no longer available.";
export const FEATURE_UNAVAILABLE_ERROR =
  "This feature is not available yet, please try again later.";

const AUTH_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "Incorrect email or password."],
  [
    /email not confirmed/i,
    "Please confirm your email address before logging in.",
  ],
  [/user already registered/i, "An account with this email already exists."],
  [/password should be at least/i, "That password is too short."],
  [
    /same password/i,
    "Choose a password that is different from your current one.",
  ],
  [/rate limit|too many requests/i, TOO_MANY_REQUESTS_ERROR],
  [
    /token has expired|otp expired|invalid or has expired|link is invalid/i,
    "That link has expired. Request a new one.",
  ],
  [/auth session missing/i, "You are not logged in."],
];

const NETWORK_PATTERNS =
  /failed to fetch|fetch failed|network ?error|networkerror|load failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|timed out/i;

const RLS_PATTERNS =
  /row-level security|permission denied|violates row level/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asErrorLike(error: unknown): ErrorLike {
  if (!isRecord(error)) return {};
  return {
    code:
      typeof error.code === "string" || typeof error.code === "number"
        ? error.code
        : null,
    message: typeof error.message === "string" ? error.message : null,
    details: typeof error.details === "string" ? error.details : null,
    hint: typeof error.hint === "string" ? error.hint : null,
    name: typeof error.name === "string" ? error.name : null,
    status: typeof error.status === "number" ? error.status : null,
    __isAuthError: error.__isAuthError === true,
  };
}

/** Returns the SQLSTATE / PostgREST code as a string, if any. */
export function getErrorCode(error: unknown): string | null {
  const like = asErrorLike(error);
  return like.code == null ? null : String(like.code);
}

/** True when the error was raised by one of our own Postgres functions. */
export function isAppRaisedError(error: unknown): boolean {
  return getErrorCode(error) === "P0001";
}

/** Snake-case detail code from `raise exception using detail = '...'`. */
export function getErrorDetailCode(error: unknown): string | null {
  if (!isAppRaisedError(error)) return null;
  const details = asErrorLike(error).details?.trim();
  return details && /^[a-z0-9_]+$/.test(details) ? details : null;
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && NETWORK_PATTERNS.test(error.message)) {
    return true;
  }
  const like = asErrorLike(error);
  if (like.name === "AuthRetryableFetchError") return true;
  if (like.name === "AbortError") return true;
  return !!like.message && NETWORK_PATTERNS.test(like.message);
}

/** Raw errors are logged, never displayed (release-architecture.md, 2). */
function logRawError(error: unknown): void {
  if (typeof console !== "undefined") {
    console.error("[pokedrafts] unexpected error", error);
  }
}

function isAuthError(error: unknown): boolean {
  const like = asErrorLike(error);
  return (
    like.__isAuthError === true ||
    (typeof like.name === "string" && like.name.startsWith("Auth"))
  );
}

export function friendlyError(error: unknown): string {
  if (error == null) return GENERIC_ERROR;

  if (typeof error === "string") {
    return error.trim() || GENERIC_ERROR;
  }

  const like = asErrorLike(error);
  const code = getErrorCode(error);
  const message = like.message?.trim() ?? "";

  if (isNetworkError(error)) return CONNECTION_ERROR;

  if (like.status === 429) return TOO_MANY_REQUESTS_ERROR;

  // Our own functions raise with a user-facing message.
  if (code === "P0001" && message) return message;

  // PostgREST cannot find the function: the deployed client is ahead of the
  // database, typically because the hardening migration has not been applied
  // to that project yet (release-architecture.md, section 10). The log line
  // names the missing function so the gap is obvious in the console.
  if (code === "PGRST202") {
    logRawError(error);
    return FEATURE_UNAVAILABLE_ERROR;
  }

  if (code === "PGRST116") return NOTHING_TO_UPDATE_ERROR;
  if (code === "42501" || RLS_PATTERNS.test(message)) return PERMISSION_ERROR;
  if (code === "23505") return ALREADY_EXISTS_ERROR;
  if (code === "23503") {
    return "That is still linked to other records and cannot be changed.";
  }
  if (code === "23514" || code === "22P02" || code === "22001") {
    return "One of the values is not valid.";
  }
  // GoTrue rejects a still-valid JWT whose user was deleted or banned; auth-js
  // returns this from getUser() and keeps the local session.
  if (code === "user_not_found" || code === "user_banned") {
    return ACCOUNT_UNAVAILABLE_ERROR;
  }
  if (code === "PGRST301" || like.status === 401) {
    return SESSION_EXPIRED_ERROR;
  }

  if (isAuthError(error)) {
    for (const [pattern, friendly] of AUTH_MESSAGES) {
      if (pattern.test(message)) return friendly;
    }
    return message || GENERIC_ERROR;
  }

  if (error instanceof Error && !code) {
    // Plain application errors thrown by our own code are user-facing.
    return message || GENERIC_ERROR;
  }

  logRawError(error);
  return GENERIC_ERROR;
}
