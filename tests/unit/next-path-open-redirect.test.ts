import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEXT_PATH,
  isSafeNextPath,
  sanitizeNextPath,
  withNextParam,
} from "@/app/lib/auth/next-path";

const ORIGIN = "https://pokedrafts.example";

/**
 * Mirrors what proxy.ts, the auth callback and the login/signup pages do:
 * `searchParams.get("next")` (one round of percent-decoding) followed by
 * `sanitizeNextPath`, then `new URL(next, origin)` for the redirect.
 */
function resolveNext(rawQuery: string) {
  const next = sanitizeNextPath(new URLSearchParams(rawQuery).get("next"));
  return new URL(next, ORIGIN);
}

describe("next parameter cannot leave the origin", () => {
  it.each([
    // protocol-relative, plain and encoded
    "next=//evil.example",
    "next=%2F%2Fevil.example",
    "next=/%2F%2Fevil.example",
    "next=%2F%2Fevil.example%2Fdashboard",
    // backslash tricks (browsers treat "\" as "/")
    "next=/\\evil.example",
    "next=/%5Cevil.example",
    "next=%5C%5Cevil.example",
    "next=/\\/evil.example",
    "next=/%5C%5Cevil.example",
    // schemes, plain and encoded
    "next=https://evil.example",
    "next=https%3A%2F%2Fevil.example",
    "next=javascript:alert(1)",
    "next=javascript%3Aalert(1)",
    "next=/javascript:alert(1)",
    "next=data:text/html,x",
    // whitespace and control characters the URL parser would strip
    "next=/%09/evil.example",
    "next=/%0A/evil.example",
    "next=/%0D%0ALocation:%20https://evil.example",
    "next=%20//evil.example",
    "next=/%00//evil.example",
    // double-encoded values stay literal percent sequences on our origin
    "next=%252F%252Fevil.example",
    "next=/%252F%252Fevil.example",
    // dot-segment games
    "next=/..//evil.example",
    "next=/%2e%2e//evil.example",
    "next=/dashboard/..//evil.example",
    // userinfo and port lookalikes
    "next=/@evil.example",
    "next=/evil.example:443",
    // missing / empty / repeated
    "",
    "next=",
    "next=dashboard",
    "next=//evil.example&next=/dashboard",
  ])("%s resolves on our origin", (rawQuery) => {
    const url = resolveNext(rawQuery);
    expect(url.origin).toBe(ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("pokedrafts.example");
  });

  it("falls back to the dashboard for every hostile value", () => {
    for (const raw of [
      "next=//evil.example",
      "next=%2F%2Fevil.example",
      "next=/%5Cevil.example",
      "next=https%3A%2F%2Fevil.example",
      "next=/%09/evil.example",
    ]) {
      expect(sanitizeNextPath(new URLSearchParams(raw).get("next"))).toBe(
        DEFAULT_NEXT_PATH
      );
    }
  });
});

describe("next parameter round trip", () => {
  it.each([
    "/invite/ABC123",
    "/leagues/8f3c9c1e-1111-4222-8333-444455556666/draft",
    "/leagues/8f3c9c1e-1111-4222-8333-444455556666?tab=picks&x=1",
    "/update-password",
    "/dashboard?welcome=1",
  ])("preserves %s through withNextParam and URLSearchParams", (path) => {
    const href = withNextParam("/login", path);
    const query = href.split("?")[1] ?? "";
    const decoded = new URLSearchParams(query).get("next");
    // withNextParam omits the param for the default destination only.
    if (path === DEFAULT_NEXT_PATH) {
      expect(decoded).toBeNull();
      return;
    }
    expect(decoded).toBe(path);
    expect(sanitizeNextPath(decoded)).toBe(path);
    const url = new URL(sanitizeNextPath(decoded), ORIGIN);
    expect(url.origin).toBe(ORIGIN);
    expect(`${url.pathname}${url.search}`).toBe(path);
  });

  it("keeps the invite code when the proxy encodes pathname+search", () => {
    const pathname = "/invite/AbC123";
    const search = "?ref=email";
    const next = sanitizeNextPath(`${pathname}${search}`, "");
    const loginHref = `/login?next=${encodeURIComponent(next)}`;
    const decoded = new URLSearchParams(loginHref.split("?")[1]).get("next");
    expect(sanitizeNextPath(decoded)).toBe("/invite/AbC123?ref=email");
  });

  it("never treats an auth page as a destination", () => {
    for (const path of [
      "/login",
      "/login?next=/dashboard",
      "/signup?next=/invite/X",
      "/forgot-password",
      "/auth/callback?code=abc",
    ]) {
      expect(isSafeNextPath(path)).toBe(true);
      expect(sanitizeNextPath(path)).toBe(DEFAULT_NEXT_PATH);
    }
  });
});
