import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises app/auth/callback/route.ts end to end with a stand-in server
 * client, checking every redirect it can produce.
 */
type Outcome = { error: null | { code?: string; name?: string; message?: string } };

const behaviour: {
  exchange: Outcome;
  verify: Outcome;
  calls: { exchange: string[]; verify: unknown[] };
} = {
  exchange: { error: null },
  verify: { error: null },
  calls: { exchange: [], verify: [] },
};

vi.mock("@/app/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: {
      async exchangeCodeForSession(code: string) {
        behaviour.calls.exchange.push(code);
        return behaviour.exchange;
      },
      async verifyOtp(params: unknown) {
        behaviour.calls.verify.push(params);
        return behaviour.verify;
      },
    },
  }),
}));

const ORIGIN = "https://pokedrafts.example";

async function get(pathAndQuery: string, headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new NextRequest(new URL(pathAndQuery, ORIGIN), { headers }));
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

beforeEach(() => {
  behaviour.exchange = { error: null };
  behaviour.verify = { error: null };
  behaviour.calls = { exchange: [], verify: [] };
});

describe("auth callback route", () => {
  it("sends the user to /login?error=auth when neither code nor token_hash is present", async () => {
    const response = await get("/auth/callback");
    expect(response.status).toBe(307);
    const url = location(response);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBeNull();
    expect(behaviour.calls.exchange).toHaveLength(0);
    expect(behaviour.calls.verify).toHaveLength(0);
  });

  it("keeps next on the failure redirect when there is nothing to exchange", async () => {
    const response = await get("/auth/callback?next=%2Finvite%2FABC");
    const url = location(response);
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
  });

  it("exchanges a PKCE code and redirects to the validated next", async () => {
    const response = await get("/auth/callback?code=abc&next=%2Finvite%2FABC");
    expect(behaviour.calls.exchange).toEqual(["abc"]);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);
  });

  it("defaults to /dashboard when next is missing", async () => {
    const response = await get("/auth/callback?code=abc");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("classifies a missing PKCE verifier as auth-device and keeps next", async () => {
    behaviour.exchange = {
      error: {
        name: "AuthPKCECodeVerifierMissingError",
        code: "pkce_code_verifier_not_found",
      },
    };
    const response = await get("/auth/callback?code=abc&next=%2Finvite%2FABC");
    const url = location(response);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth-device");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
  });

  it("reports any other exchange failure as auth", async () => {
    behaviour.exchange = { error: { code: "otp_expired" } };
    const response = await get("/auth/callback?code=abc&next=%2Fupdate-password");
    const url = location(response);
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBe("/update-password");
  });

  it("verifies a token_hash link and unwraps a {{ .RedirectTo }} next", async () => {
    const redirectTo = `${ORIGIN}/auth/callback?next=%2Finvite%2FABC`;
    const response = await get(
      `/auth/callback?token_hash=h&type=signup&next=${encodeURIComponent(redirectTo)}`
    );
    expect(behaviour.calls.verify).toEqual([{ token_hash: "h", type: "signup" }]);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/ABC`);
  });

  it("rejects an unknown otp type without calling Supabase", async () => {
    const response = await get("/auth/callback?token_hash=h&type=sms");
    expect(behaviour.calls.verify).toHaveLength(0);
    expect(location(response).searchParams.get("error")).toBe("auth");
  });

  it("passes a Supabase ?error straight to /login without exchanging", async () => {
    const response = await get(
      "/auth/callback?error=access_denied&error_code=otp_expired&code=abc&next=%2Finvite%2FABC"
    );
    expect(behaviour.calls.exchange).toHaveLength(0);
    const url = location(response);
    expect(url.searchParams.get("error")).toBe("auth");
    expect(url.searchParams.get("next")).toBe("/invite/ABC");
  });

  it.each([
    "//evil.example",
    "%2F%2Fevil.example",
    "/%5Cevil.example",
    "https://evil.example",
    "https%3A%2F%2Fevil.example%2Fx",
    "javascript:alert(1)",
    "/login",
    "/auth/callback?next=%2F%2Fevil.example",
  ])("never redirects off-origin for next=%s", async (raw) => {
    const success = await get(`/auth/callback?code=abc&next=${raw}`);
    expect(location(success).origin).toBe(ORIGIN);

    behaviour.exchange = { error: { code: "otp_expired" } };
    const failure = await get(`/auth/callback?code=abc&next=${raw}`);
    const url = location(failure);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
  });

  it("uses x-forwarded-host for the redirect base outside development", async () => {
    const response = await get("/auth/callback?code=abc", {
      "x-forwarded-host": "pokedrafts.example",
      "x-forwarded-proto": "https",
    });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });
});
