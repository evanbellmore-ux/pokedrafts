import { createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Continue with Discord (app/(auth)/DiscordSignIn.tsx) on the login and sign-up pages, shown while the Supabase project has
 * the Discord provider on (app/lib/auth/providers.ts), and its redirect through /auth/callback.
 */

const hostEvents = vi.hoisted(() => ({ capture: false, buttons: [] as Record<string, unknown>[] }));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (hostEvents.capture && type === "button") hostEvents.buttons.push(props as Record<string, unknown>);
  };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { record(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { record(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (hostEvents.capture && args[0] === "button") hostEvents.buttons.push(args[1] as Record<string, unknown>);
      return actual.jsxDEV(...args);
    },
  };
});

const oauth = vi.hoisted(() => ({ calls: [] as unknown[], result: { error: null as null | { message: string; name: string; status: number } } }));
vi.mock("@/app/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      async signInWithOAuth(options: unknown) {
        oauth.calls.push(options);
        return oauth.result;
      },
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

function capture(render: () => string) {
  hostEvents.buttons = [];
  hostEvents.capture = true;
  try { return { html: render(), buttons: hostEvents.buttons }; }
  finally { hostEvents.capture = false; }
}

describe("signInProviders", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
    vi.unstubAllGlobals();
  });

  it("offers Discord while the project's auth settings have it on, read with the publishable key and cached five minutes", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ external: { email: true, discord: true }, mailer_autoconfirm: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { signInProviders } = await import("@/app/lib/auth/providers");
    expect(await signInProviders()).toEqual({ discord: true });
    expect(fetch).toHaveBeenCalledWith("https://project.supabase.co/auth/v1/settings", { headers: { apikey: "anon-key" }, next: { revalidate: 300 } });
  });

  it("offers none while Discord is off, the settings cannot be read, or Supabase is not configured", async () => {
    const { signInProviders } = await import("@/app/lib/auth/providers");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ external: { email: true, discord: false } }), { status: 200 })));
    expect(await signInProviders()).toEqual({ discord: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ external: { email: true } }), { status: 200 })));
    expect(await signInProviders()).toEqual({ discord: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect(await signInProviders()).toEqual({ discord: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await signInProviders()).toEqual({ discord: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    expect(await signInProviders()).toEqual({ discord: false });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await signInProviders()).toEqual({ discord: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Continue with Discord", () => {
  beforeEach(() => {
    oauth.calls = [];
    oauth.result = { error: null };
    vi.stubGlobal("window", { location: { origin: "https://pokedrafts.example" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the browser to Discord through Supabase, back to /auth/callback with next and the provider marker", async () => {
    const { default: DiscordSignIn } = await import("@/app/(auth)/DiscordSignIn");
    const { html, buttons } = capture(() => renderToStaticMarkup(createElement(DiscordSignIn, { next: "/invite/ABC" })));
    expect(text(html)).toBe("Continue with Discord or use your email");
    const button = buttons.find((each) => String(each.children).includes("Continue with Discord"))!;
    expect(button.type).toBe("button");
    await (button.onClick as (event: MouseEvent<HTMLButtonElement>) => Promise<void>)({} as MouseEvent<HTMLButtonElement>);
    expect(oauth.calls).toEqual([{ provider: "discord", options: { redirectTo: "https://pokedrafts.example/auth/callback?next=%2Finvite%2FABC&provider=discord" } }]);
  });

  it("shows only on pages whose project has Discord on, above the email form", async () => {
    const { default: LoginForm } = await import("@/app/(auth)/login/LoginForm");
    const { default: SignupForm } = await import("@/app/(auth)/signup/SignupForm");
    const login = renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard", discord: true }));
    expect(text(login)).toContain("Continue with Discord or use your email");
    expect(login.indexOf("Continue with Discord")).toBeLessThan(login.indexOf('name="email"'));
    expect(renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard" }))).not.toContain("Continue with Discord");
    const signup = renderToStaticMarkup(createElement(SignupForm, { next: "/dashboard", discord: true }));
    expect(text(signup)).toContain("Continue with Discord or use your email");
    expect(signup.indexOf("Continue with Discord")).toBeLessThan(signup.indexOf('name="email"'));
    expect(renderToStaticMarkup(createElement(SignupForm, { next: "/dashboard", discord: false }))).not.toContain("Continue with Discord");
  });

  it("words a Discord sign-in that did not finish on the login page", async () => {
    const { default: LoginForm } = await import("@/app/(auth)/login/LoginForm");
    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/invite/ABC", linkError: "provider", discord: true }));
    expect(text(html)).toContain("Discord did not finish signing you in. Try again, or log in with your email and password.");
    expect(text(html)).not.toContain("from that link");
  });
});
