import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/app/lib/content-security-policy";

/**
 * The policy proxy.ts sends with every page (app/lib/content-security-policy.ts),
 * parsed back into directives.
 */
function directives(policy: string) {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources] as const;
    })
  );
}

const SUPABASE = "https://abcdefghijklmnop.supabase.co";

function production(overrides: Partial<Parameters<typeof contentSecurityPolicy>[0]> = {}) {
  return directives(
    contentSecurityPolicy({
      nonce: "bm9uY2U=",
      supabaseUrl: SUPABASE,
      development: false,
      https: true,
      ...overrides,
    })
  );
}

describe("contentSecurityPolicy", () => {
  it("runs scripts from our origin and nonce-stamped inline scripts only", () => {
    const script = production().get("script-src");
    expect(script).toContain("'self'");
    expect(script).toContain("'nonce-bm9uY2U='");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    // Host sources stay on: the Vercel Toolbar script carries no nonce.
    expect(script).not.toContain("'strict-dynamic'");
    expect(script).toContain("https://vercel.live");
  });

  it("allows eval in development only, for React's debugging", () => {
    expect(production({ development: true }).get("script-src")).toContain("'unsafe-eval'");
  });

  it("reaches Supabase over https and its realtime socket over wss", () => {
    const connect = production({ supabaseUrl: `${SUPABASE}/` }).get("connect-src");
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain("wss://abcdefghijklmnop.supabase.co");
  });

  it("follows a local Supabase over http and ws", () => {
    const connect = production({ supabaseUrl: "http://127.0.0.1:54321" }).get("connect-src");
    expect(connect).toContain("http://127.0.0.1:54321");
    expect(connect).toContain("ws://127.0.0.1:54321");
  });

  it("lets the sprite hosts, PokeAPI and PokéPaste through", () => {
    const policy = production();
    expect(policy.get("img-src")).toEqual(
      expect.arrayContaining(["'self'", "data:", "blob:", SUPABASE, "https://raw.githubusercontent.com"])
    );
    expect(policy.get("connect-src")).toEqual(
      expect.arrayContaining(["https://pokeapi.co", "https://pokepast.es"])
    );
  });

  it("runs the Training worker from our origin", () => {
    expect(production().get("worker-src")).toEqual(["'self'"]);
  });

  it("allows the Vercel Toolbar's sources from Vercel's CSP guide", () => {
    const policy = production();
    expect(policy.get("connect-src")).toEqual(
      expect.arrayContaining(["https://vercel.live", "wss://ws-us3.pusher.com"])
    );
    expect(policy.get("img-src")).toEqual(
      expect.arrayContaining(["https://vercel.live", "https://vercel.com"])
    );
    expect(policy.get("frame-src")).toEqual(["https://vercel.live"]);
    expect(policy.get("style-src")).toEqual(
      expect.arrayContaining(["https://vercel.live", "'unsafe-inline'"])
    );
    expect(policy.get("font-src")).toEqual(
      expect.arrayContaining(["https://vercel.live", "https://assets.vercel.com"])
    );
  });

  it("locks down plugins, base URLs, form targets and framing", () => {
    const policy = production();
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("upgrades insecure requests only on https", () => {
    expect(production().has("upgrade-insecure-requests")).toBe(true);
    expect(production({ https: false }).has("upgrade-insecure-requests")).toBe(false);
  });
});
