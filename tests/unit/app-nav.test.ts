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
vi.mock("next/navigation", () => ({
  usePathname: () => "/calculator",
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
    expect(html).toMatch(/<a href="\/calculator" aria-current="page" aria-label="Calculator"/);
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain("flex w-full max-w-full flex-wrap");
    expect(html).toContain("Skip to content");
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
