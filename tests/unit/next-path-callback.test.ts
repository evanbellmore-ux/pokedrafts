import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEXT_PATH,
  resolveCallbackNext,
  sanitizeNextPath,
} from "@/app/lib/auth/next-path";

const ORIGIN = "https://pokedrafts.example";

/**
 * `resolveCallbackNext` is what app/auth/callback/route.ts feeds into
 * `new URL(next, base)`. It must never produce an off-origin destination,
 * must unwrap a `{{ .RedirectTo }}` value exactly one level, and must never
 * hand back one of the auth pages (which would loop through /login).
 */
describe("resolveCallbackNext: plain paths", () => {
  it.each(["/invite/ABC", "/update-password", "/leagues/x/draft?tab=picks#top"])(
    "keeps a safe relative path %s",
    (path) => {
      expect(resolveCallbackNext(path)).toBe(path);
    }
  );

  it.each([null, undefined, "", 42, {}])("falls back for %s", (value) => {
    expect(resolveCallbackNext(value)).toBe(DEFAULT_NEXT_PATH);
  });

  it("honours a custom fallback", () => {
    expect(resolveCallbackNext("", "/x")).toBe("/x");
    expect(resolveCallbackNext("//evil.example", "/x")).toBe("/x");
  });
});

describe("resolveCallbackNext: absolute URLs keep only path, query and hash", () => {
  it("discards the host of an http(s) URL, even a foreign one", () => {
    expect(resolveCallbackNext("https://evil.example/invite/ABC?x=1#h")).toBe(
      "/invite/ABC?x=1#h"
    );
    expect(resolveCallbackNext(`${ORIGIN}/dashboard?welcome=1`)).toBe(
      "/dashboard?welcome=1"
    );
  });

  it("treats a bare origin (Supabase's default RedirectTo) as the default page", () => {
    expect(resolveCallbackNext(ORIGIN)).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext(`${ORIGIN}/`)).toBe(DEFAULT_NEXT_PATH);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://evil.example/x",
    "HTTPS:evil.example",
    "//evil.example/invite/ABC",
    "https://evil.example//other.example",
  ])("rejects %s", (value) => {
    expect(resolveCallbackNext(value)).toBe(DEFAULT_NEXT_PATH);
  });
});

describe("resolveCallbackNext: unwrapping {{ .RedirectTo }}", () => {
  it("unwraps /auth/callback?next=<path> one level", () => {
    expect(
      resolveCallbackNext(`${ORIGIN}/auth/callback?next=%2Finvite%2FABC`)
    ).toBe("/invite/ABC");
    expect(resolveCallbackNext("/auth/callback?next=/update-password")).toBe(
      "/update-password"
    );
  });

  it("does not unwrap a second level and never returns an auth page", () => {
    expect(
      resolveCallbackNext(
        "/auth/callback?next=%2Fauth%2Fcallback%3Fnext%3D%2Finvite%2FABC"
      )
    ).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("/auth/callback")).toBe(DEFAULT_NEXT_PATH);
    expect(resolveCallbackNext("/auth/callback?code=abc")).toBe(
      DEFAULT_NEXT_PATH
    );
    for (const page of ["/login", "/signup", "/forgot-password"]) {
      expect(
        resolveCallbackNext(`/auth/callback?next=${encodeURIComponent(page)}`)
      ).toBe(DEFAULT_NEXT_PATH);
      expect(resolveCallbackNext(`${ORIGIN}${page}?next=/dashboard`)).toBe(
        DEFAULT_NEXT_PATH
      );
    }
  });

  it("rejects an off-origin inner next", () => {
    for (const inner of [
      "//evil.example",
      "https://evil.example/x",
      "/" + String.fromCharCode(92) + "evil.example",
      "javascript:alert(1)",
    ]) {
      expect(
        resolveCallbackNext(
          `${ORIGIN}/auth/callback?next=${encodeURIComponent(inner)}`
        )
      ).toBe(DEFAULT_NEXT_PATH);
    }
  });

  it("only unwraps when the path is exactly /auth/callback", () => {
    expect(resolveCallbackNext("/auth/callbackx?next=%2F%2Fevil.example")).toBe(
      "/auth/callbackx?next=%2F%2Fevil.example"
    );
    expect(resolveCallbackNext("/auth/callback/?next=%2Finvite%2FABC")).toBe(
      "/auth/callback/?next=%2Finvite%2FABC"
    );
  });
});

describe("resolveCallbackNext: result is always accepted by sanitizeNextPath", () => {
  it.each([
    "/invite/ABC",
    `${ORIGIN}/auth/callback?next=%2Finvite%2FABC`,
    "https://evil.example/leagues/x",
    "//evil.example",
    "/auth/callback?next=%2F%2Fevil.example",
    "not-a-path",
  ])("%s resolves on our origin", (value) => {
    const next = resolveCallbackNext(value);
    expect(sanitizeNextPath(next)).toBe(next);
    const url = new URL(next, ORIGIN);
    expect(url.origin).toBe(ORIGIN);
  });
});
