import { describe, expect, it } from "vitest";
import {
  classifyCallbackError,
  isPkceVerifierMissing,
  parseCallbackFailure,
} from "@/app/lib/auth/callback";
import {
  DEFAULT_NEXT_PATH,
  resolveCallbackNext,
} from "@/app/lib/auth/next-path";

const ORIGIN = "https://pokedrafts.example";

/**
 * Mirrors app/auth/callback/route.ts: how the failure redirect is built and
 * how the login page reads it back.
 */
function failureUrl(reason: string, next: string) {
  const url = new URL("/login", ORIGIN);
  url.searchParams.set("error", reason);
  if (next !== DEFAULT_NEXT_PATH) url.searchParams.set("next", next);
  return url;
}

describe("resolveCallbackNext", () => {
  it("accepts a plain safe path", () => {
    expect(resolveCallbackNext("/invite/ABC123")).toBe("/invite/ABC123");
    expect(resolveCallbackNext("/update-password")).toBe("/update-password");
  });

  it("falls back for missing, hostile or auth-page values", () => {
    expect(resolveCallbackNext(null)).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("")).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("//evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("/login")).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("javascript:alert(1)")).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext(42)).toBe(DEFAULT_NEXT_PATH);
  });

  it("keeps only the path of an absolute URL, never its host", () => {
    expect(resolveCallbackNext(`${ORIGIN}/invite/ABC123?ref=email`)).toBe(
      "/invite/ABC123?ref=email"
    );
    // A foreign host contributes only its path; the redirect stays on our origin.
    expect(resolveCallbackNext("https://evil.example/leagues/x")).toBe(
      "/leagues/x"
    );
    expect(resolveCallbackNext("https://evil.example")).toBe(
      DEFAULT_NEXT_PATH
    );
    expect(resolveCallbackNext("ftp://evil.example/x")).toBe(DEFAULT_NEXT_PATH);
  });

  it("unwraps a {{ .RedirectTo }} callback URL from a token-hash email template", () => {
    // emailRedirectTo is `<origin>/auth/callback?next=/invite/CODE`; a
    // template using `&next={{ .RedirectTo }}` hands us that whole URL.
    expect(
      resolveCallbackNext(`${ORIGIN}/auth/callback?next=%2Finvite%2FCODE`)
    ).toBe("/invite/CODE");
    expect(resolveCallbackNext(`${ORIGIN}/auth/callback?next=/invite/CODE`)).toBe(
      "/invite/CODE"
    );
    expect(resolveCallbackNext("/auth/callback?next=/update-password")).toBe(
      "/update-password"
    );
  });

  it("unwraps only one level and still sanitizes the inner value", () => {
    expect(resolveCallbackNext(`${ORIGIN}/auth/callback`)).toBe(
      DEFAULT_NEXT_PATH
    );
    expect(
      resolveCallbackNext(`${ORIGIN}/auth/callback?next=//evil.example`)
    ).toBe(DEFAULT_NEXT_PATH);
    expect(
      resolveCallbackNext(
        `${ORIGIN}/auth/callback?next=${encodeURIComponent("/auth/callback?next=/x")}`
      )
    ).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext(`${ORIGIN}/auth/callback?next=/login`)).toBe(
      DEFAULT_NEXT_PATH
    );
  });

  it("honours a custom fallback", () => {
    expect(resolveCallbackNext(null, "/")).toBe("/");
    expect(resolveCallbackNext("//bad", "/")).toBe("/");
  });
});

describe("callback failure classification", () => {
  it("recognises the missing PKCE verifier by code or by name", () => {
    expect(
      isPkceVerifierMissing({
        name: "AuthPKCECodeVerifierMissingError",
        code: "pkce_code_verifier_not_found",
        status: 400,
        message: "PKCE code verifier not found in storage.",
      })
    ).toBe(true);
    expect(isPkceVerifierMissing({ code: "pkce_code_verifier_not_found" })).toBe(
      true
    );
    expect(isPkceVerifierMissing({ name: "AuthPKCECodeVerifierMissingError" })).toBe(
      true
    );
  });

  it("treats every other error as an invalid or expired link", () => {
    expect(isPkceVerifierMissing({ code: "otp_expired", status: 403 })).toBe(false);
    expect(isPkceVerifierMissing(null)).toBe(false);
    expect(isPkceVerifierMissing("boom")).toBe(false);
    expect(classifyCallbackError({ code: "otp_expired" })).toBe("auth");
    expect(classifyCallbackError({ code: "pkce_code_verifier_not_found" })).toBe(
      "auth-device"
    );
  });

  it("round-trips the reason and next through /login", () => {
    const url = failureUrl("auth-device", "/invite/ABC123");
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(parseCallbackFailure(url.searchParams.get("error"))).toBe(
      "other-device"
    );
    expect(url.searchParams.get("next")).toBe("/invite/ABC123");

    const plain = failureUrl("auth", DEFAULT_NEXT_PATH);
    expect(plain.search).toBe("?error=auth");
    expect(parseCallbackFailure(plain.searchParams.get("error"))).toBe("invalid");
  });

  it("ignores unknown error values on the login page", () => {
    expect(parseCallbackFailure("nope")).toBeNull();
    expect(parseCallbackFailure(undefined)).toBeNull();
    expect(parseCallbackFailure(null)).toBeNull();
    expect(parseCallbackFailure("")).toBeNull();
  });
});
