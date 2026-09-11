import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALREADY_EXISTS_ERROR,
  CONNECTION_ERROR,
  FEATURE_UNAVAILABLE_ERROR,
  GENERIC_ERROR,
  NOTHING_TO_UPDATE_ERROR,
  PERMISSION_ERROR,
  SESSION_EXPIRED_ERROR,
  TOO_MANY_REQUESTS_ERROR,
  friendlyError,
  getErrorDetailCode,
  isAppRaisedError,
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
