import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALREADY_EXISTS_ERROR,
  CONNECTION_ERROR,
  EMAIL_COOLDOWN_ERROR,
  EMAIL_UNAVAILABLE_ERROR,
  FEATURE_UNAVAILABLE_ERROR,
  GENERIC_ERROR,
  NOTHING_TO_UPDATE_ERROR,
  PERMISSION_ERROR,
  SESSION_EXPIRED_ERROR,
  TOO_MANY_REQUESTS_ERROR,
  emailCooldownError,
  friendlyError,
  getErrorDetailCode,
  isAppRaisedError,
  isEmailSendFailure,
} from "@/app/lib/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("friendlyError", () => {
  it("maps PostgREST and SQLSTATE codes", () => {
    expect(friendlyError({ code: "PGRST116", message: "JSON object requested" })).toBe(
      NOTHING_TO_UPDATE_ERROR
    );
    expect(friendlyError({ code: "42501", message: "permission denied" })).toBe(
      PERMISSION_ERROR
    );
    expect(
      friendlyError({
        code: "42501",
        message: 'new row violates row-level security policy for table "leagues"',
      })
    ).toBe(PERMISSION_ERROR);
    expect(friendlyError({ code: "23505", message: "duplicate key value" })).toBe(
      ALREADY_EXISTS_ERROR
    );
    expect(friendlyError({ code: "PGRST301", message: "JWT expired" })).toBe(
      SESSION_EXPIRED_ERROR
    );
  });

  it("shows messages raised by our own functions verbatim", () => {
    const error = {
      code: "P0001",
      message: "It is not your turn to pick.",
      details: "not_your_turn",
    };
    expect(friendlyError(error)).toBe("It is not your turn to pick.");
    expect(isAppRaisedError(error)).toBe(true);
    expect(getErrorDetailCode(error)).toBe("not_your_turn");
    expect(getErrorDetailCode({ code: "23505" })).toBeNull();
  });

  it("detects network failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe(CONNECTION_ERROR);
    expect(
      friendlyError({ name: "AuthRetryableFetchError", message: "fetch failed" })
    ).toBe(CONNECTION_ERROR);
    expect(friendlyError({ message: "TypeError: fetch failed" })).toBe(
      CONNECTION_ERROR
    );
  });

  it("translates common auth messages and passes others through", () => {
    expect(
      friendlyError({
        name: "AuthApiError",
        __isAuthError: true,
        status: 400,
        message: "Invalid login credentials",
      })
    ).toBe("Incorrect email or password.");
    expect(
      friendlyError({
        name: "AuthApiError",
        __isAuthError: true,
        status: 400,
        message: "Email not confirmed",
      })
    ).toBe("Please confirm your email address before logging in.");
    expect(
      friendlyError({
        name: "AuthApiError",
        __isAuthError: true,
        status: 422,
        message: "Signup requires a valid password",
      })
    ).toBe("Signup requires a valid password");
  });

  it("rate limits", () => {
    expect(friendlyError({ status: 429, message: "Too many requests" })).toBe(
      TOO_MANY_REQUESTS_ERROR
    );
    // GoTrue's per-IP request limit stays the user's attempts.
    expect(
      friendlyError({ __isAuthError: true, name: "AuthApiError", status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" })
    ).toBe(TOO_MANY_REQUESTS_ERROR);
  });

  it("says the email could not be sent when GoTrue cannot send an auth email, not that the user tried too often", () => {
    const auth = (status: number, code: string | undefined, message: string) => ({ __isAuthError: true, name: "AuthApiError", status, code, message });
    // The project's email sending limit (the built-in sender's couple an hour, or the limit set with custom SMTP).
    expect(friendlyError(auth(429, "over_email_send_rate_limit", "email rate limit exceeded"))).toBe(EMAIL_UNAVAILABLE_ERROR);
    // An older GoTrue with no error code.
    expect(friendlyError(auth(429, undefined, "email rate limit exceeded"))).toBe(EMAIL_UNAVAILABLE_ERROR);
    // The built-in sender only sends to the project's team.
    expect(friendlyError(auth(400, "email_address_not_authorized", 'Email address "coach@example.com" cannot be used as it is not authorized'))).toBe(EMAIL_UNAVAILABLE_ERROR);
    // A custom SMTP server that refused the message.
    expect(friendlyError(auth(500, "unexpected_failure", "Error sending confirmation email"))).toBe(EMAIL_UNAVAILABLE_ERROR);
    expect(friendlyError(auth(500, "unexpected_failure", "Error sending recovery email"))).toBe(EMAIL_UNAVAILABLE_ERROR);
    expect(isEmailSendFailure(auth(500, "unexpected_failure", "Error sending recovery email"))).toBe(true);
    // Not an auth error, or not an email failure.
    expect(isEmailSendFailure({ message: "Error sending recovery email" })).toBe(false);
    expect(isEmailSendFailure(auth(400, "validation_failed", "Unable to validate email address: invalid format"))).toBe(false);
    expect(EMAIL_UNAVAILABLE_ERROR).toBe("We can't send email right now, please try again later.");
  });

  it("says how long to wait for GoTrue's per-address email cooldown, which shares the sending limit's code", () => {
    const auth = (status: number, code: string | undefined, message: string) => ({ __isAuthError: true, name: "AuthApiError", status, code, message });
    // supabase/auth generateFrequencyLimitErrorMessage: the seconds left, rounded down, always "seconds".
    const cooldown = (seconds: number) => auth(429, "over_email_send_rate_limit", `For security purposes, you can only request this after ${seconds} seconds.`);
    expect(friendlyError(cooldown(42))).toBe("Please wait 42 seconds before requesting another email.");
    expect(friendlyError(cooldown(1))).toBe("Please wait 1 second before requesting another email.");
    // Under a second left reads 0.
    expect(friendlyError(cooldown(0))).toBe("Please wait 1 second before requesting another email.");
    expect(emailCooldownError(cooldown(42))).toBe("Please wait 42 seconds before requesting another email.");
    expect(isEmailSendFailure(cooldown(42))).toBe(false);
    // An older GoTrue with no error code.
    expect(friendlyError(auth(429, undefined, "For security purposes, you can only request this after 17 seconds."))).toBe("Please wait 17 seconds before requesting another email.");
    // A cooldown message that gives no wait.
    expect(friendlyError(auth(429, "over_email_send_rate_limit", "For security purposes, you can only request this once every 60 seconds"))).toBe(EMAIL_COOLDOWN_ERROR);
    expect(EMAIL_COOLDOWN_ERROR).toBe("Please wait a moment before requesting another email.");
    // The project's sending limit keeps the outage text.
    expect(emailCooldownError(auth(429, "over_email_send_rate_limit", "email rate limit exceeded"))).toBeNull();
    expect(friendlyError(auth(429, "over_email_send_rate_limit", "email rate limit exceeded"))).toBe(EMAIL_UNAVAILABLE_ERROR);
    // The SMS cooldown, and the same words outside GoTrue, are not this one.
    expect(emailCooldownError(auth(429, "over_sms_send_rate_limit", "For security purposes, you can only request this after 42 seconds."))).toBeNull();
    expect(emailCooldownError({ message: "For security purposes, you can only request this after 42 seconds." })).toBeNull();
  });

  it("tells the user a function is missing from the database and logs which", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = {
      code: "PGRST202",
      message:
        "Could not find the function public.get_invite_preview(p_code) in the schema cache",
      details: "Searched for the function public.get_invite_preview with parameter p_code or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
      hint: null,
    };
    expect(friendlyError(error)).toBe(FEATURE_UNAVAILABLE_ERROR);
    expect(FEATURE_UNAVAILABLE_ERROR).not.toBe(GENERIC_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("[pokedrafts] unexpected error", error);
  });

  it("hides raw database messages and logs them", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      friendlyError({ code: "XX000", message: "internal error at line 12" })
    ).toBe(GENERIC_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("handles nullish, string and plain Error inputs", () => {
    expect(friendlyError(null)).toBe(GENERIC_ERROR);
    expect(friendlyError(undefined)).toBe(GENERIC_ERROR);
    expect(friendlyError("Team name is required.")).toBe("Team name is required.");
    expect(friendlyError("   ")).toBe(GENERIC_ERROR);
    expect(friendlyError(new Error("Pick a team name first."))).toBe(
      "Pick a team name first."
    );
  });
});
