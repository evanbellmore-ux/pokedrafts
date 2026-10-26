import { createElement, useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppNav from "@/app/components/AppNav";
import MobilePanelBar from "@/app/(app)/leagues/[leagueId]/draft/MobilePanelBar";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: vi.fn(),
  useRef: vi.fn(),
}));
vi.mock("next/link", () => ({ default: "a" }));
const navigation = vi.hoisted(() => ({ pathname: "/calculator" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/components/ThemeToggle", () => ({ default: () => null }));

const header = { getBoundingClientRect: vi.fn(() => ({ height: 93 })) };
const setProperty = vi.fn();
const removeProperty = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();
let resize: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = "/calculator";
  header.getBoundingClientRect.mockReturnValue({ height: 93 });
  vi.mocked(useRef).mockReturnValue({ current: header });
  vi.stubGlobal("document", { documentElement: { style: { setProperty, removeProperty } } });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("wrapping app navigation", () => {
  it("keeps the calculator link accessible and active", () => {
    const html = renderToStaticMarkup(createElement(AppNav));
    // Text tabs: the visible label is the accessible name.
    expect(html).toMatch(/<a href="\/calculator" aria-current="page"[^>]*>Calculator</);
    expect(html).toContain('aria-label="Primary"');
    // Below md the tabs get their own row, which scrolls instead of overflowing.
    expect(html).toContain("order-last -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto");
    expect(html).toContain("Skip to content");
  });

  it("keeps the one-row header for md and up, where brand, tabs and account fit", () => {
    const html = renderToStaticMarkup(createElement(AppNav));
    // One row needs about 680px of content with the Watch tab (728 with the sm gutters), so 640-767 wraps too.
    expect(html).toContain("md:flex-nowrap md:gap-6");
    expect(html).not.toMatch(/\bsm:(flex-nowrap|order-none|w-auto|overflow-visible|flex-none|h-14)\b/);
    // The wrapped tab row is full-bleed in either gutter.
    expect(html).toContain("sm:-mx-6 sm:w-[calc(100%+3rem)]");
    // Tabs fit a 360px phone at 13px and a 320px one at 12px (tighter padding, no row padding).
    const tab = html.match(/<a href="\/watch"[^>]*class="([^"]+)"/)?.[1] ?? "";
    expect(tab).toContain("px-1.5 text-[13px]");
    expect(tab).toContain("max-[22.5rem]:px-1 max-[22.5rem]:text-xs");
    expect(tab).toContain("md:h-14 md:flex-none md:px-3 md:text-sm");
  });

  it("links Training after Calculator and marks it active on /training", () => {
    const html = renderToStaticMarkup(createElement(AppNav));
    expect(html).toMatch(/<a href="\/training"[^>]*>Training</);
    expect(html.indexOf('href="/calculator"')).toBeLessThan(html.indexOf('href="/training"'));
    navigation.pathname = "/training";
    const active = renderToStaticMarkup(createElement(AppNav));
    expect(active).toMatch(/<a href="\/training" aria-current="page"[^>]*>Training</);
    expect(active).not.toMatch(/<a href="\/calculator" aria-current="page"/);
  });

  it("links Watch last and marks it active on the public league pages", () => {
    const html = renderToStaticMarkup(createElement(AppNav));
    expect(html).toMatch(/<a href="\/watch"[^>]*>Watch</);
    expect(html.indexOf('href="/training"')).toBeLessThan(html.indexOf('href="/watch"'));
    navigation.pathname = "/watch/abc";
    expect(renderToStaticMarkup(createElement(AppNav))).toMatch(/<a href="\/watch" aria-current="page"[^>]*>Watch</);
  });

  it("marks Dashboard as the current section on league pages, not as the page", () => {
    navigation.pathname = "/leagues/abc/standings";
    const html = renderToStaticMarkup(createElement(AppNav));
    expect(html).toMatch(/<a href="\/dashboard" aria-current="true"[^>]*>Dashboard</);
    expect(html).not.toContain('aria-current="page"');
    navigation.pathname = "/dashboard";
    expect(renderToStaticMarkup(createElement(AppNav))).toMatch(
      /<a href="\/dashboard" aria-current="page"[^>]*>Dashboard</
    );
  });

  it("keeps Sign out and the theme picker in a collapsed account menu", () => {
    const html = renderToStaticMarkup(createElement(AppNav));
    const trigger = html.match(/<button[^>]*aria-label="Account"[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain('aria-expanded="false"');
    const panelId = trigger.match(/aria-controls="([^"]+)"/)?.[1];
    expect(panelId).toBeTruthy();
    const panel = html.slice(html.indexOf(`id="${panelId}"`));
    expect(panel).toMatch(/^id="[^"]+" data-menu-panel="" hidden=""/);
    expect(panel).toContain("Signed in as");
    expect(panel).toMatch(/<button type="button"[^>]*>.*Sign out<\/button>/);
  });

  it("measures the header, follows resizes and removes its observer on unmount", () => {
    renderToStaticMarkup(createElement(AppNav));
    const cleanup = vi.mocked(useEffect).mock.calls[0][0]();
    expect(observe).toHaveBeenCalledWith(header);
    expect(setProperty).toHaveBeenLastCalledWith("--app-nav-height", "93px");

    for (const height of [65, 145, 220]) {
      header.getBoundingClientRect.mockReturnValue({ height });
      resize();
      expect(setProperty).toHaveBeenLastCalledWith("--app-nav-height", `${height}px`);
    }

    expect(cleanup).toBeTypeOf("function");
    if (typeof cleanup === "function") cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeProperty).toHaveBeenCalledWith("--app-nav-height");
  });

  it("positions the draft panel bar using the same measured height", () => {
    const html = renderToStaticMarkup(createElement(MobilePanelBar, {
      active: "pool", onChange: () => undefined, unreadChat: 2,
    }));
    expect(html).toContain("top-[var(--app-nav-height,4rem)]");
    expect(html).not.toContain("top-16");
    expect(html).toContain('aria-label="Draft room panels"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("2 new messages");
  });
});
