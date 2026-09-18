import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useDesktopRosterLayout } from "@/app/(app)/calculator/useDesktopRosterLayout";
import CalculatorClient from "@/app/(app)/calculator/CalculatorClient";

function Layout({ beforeChange }: { beforeChange: () => void }) {
  return createElement("span", null, useDesktopRosterLayout(beforeChange) ? "desktop" : "compact");
}

describe("calculator desktop layout SSR", () => {
  it("renders the complete calculator with its real hooks and no browser or authentication setup", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToStaticMarkup(createElement(CalculatorClient));
    expect(html).toContain('data-calculator-layout="compact"');
    expect(html).not.toContain("data-calculator-roster-rail");
    expect([...html.matchAll(/data-calculator-roster="/g)]).toHaveLength(2);
    expect(html).toContain("Loading your leagues");
    expect(html).toContain("Loading the Champions engine");
  });

  it("uses compact markup without a browser or invoking focus capture", () => {
    const beforeChange = vi.fn();
    expect(typeof window).toBe("undefined");
    expect(renderToStaticMarkup(createElement(Layout, { beforeChange }))).toBe("<span>compact</span>");
    expect(beforeChange).not.toHaveBeenCalled();
  });

  it("keeps the server snapshot compact even when a browser reports a wide viewport", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    const beforeChange = vi.fn();
    vi.stubGlobal("window", { matchMedia });
    try {
      expect(renderToStaticMarkup(createElement(Layout, { beforeChange }))).toBe("<span>compact</span>");
      expect(matchMedia).not.toHaveBeenCalled();
      expect(beforeChange).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
