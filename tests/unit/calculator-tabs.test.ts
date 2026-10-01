import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CalculatorTabs, { CALCULATOR_TABS, calculatorTabForKey, calculatorTabIds } from "@/app/(app)/calculator/CalculatorTabs";

describe("calculator menu tabs", () => {
  // Build settings and Field conditions are not menus: they are collapsible sections under the summary.
  it("places own-team and dependent-opponent menus at the ends", () => {
    expect(CALCULATOR_TABS.map(({ label }) => label)).toEqual(["My team", "Moves", "Opponent"]);
  });

  it.each(CALCULATOR_TABS)("renders only $id as the selected sequential tab stop", ({ id: activeTab }) => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(CalculatorTabs, { prefix: "calculator", activeTab, onSelect }));
    expect(html).toContain('role="tablist" aria-label="Calculator menus"');
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
    expect(buttons).toHaveLength(3);
    CALCULATOR_TABS.forEach(({ id }, index) => {
      const ids = calculatorTabIds("calculator", id);
      expect(buttons[index]).toContain('type="button"');
      expect(buttons[index]).toContain('role="tab"');
      expect(buttons[index]).toContain(`id="${ids.tabId}"`);
      expect(buttons[index]).toContain(`aria-controls="${ids.panelId}"`);
      expect(buttons[index]).toContain(`aria-selected="${id === activeTab}"`);
      expect(buttons[index]).toContain(`tabindex="${id === activeTab ? 0 : -1}"`);
      expect(buttons[index]).not.toContain("disabled");
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(CALCULATOR_TABS)("maps wrapping Left/Right and Home/End from $id", ({ id }) => {
    const order = ["team", "moves", "opponent"] as const;
    const index = order.indexOf(id);
    expect(calculatorTabForKey(id, "ArrowLeft")).toBe(order[(index + 2) % 3]);
    expect(calculatorTabForKey(id, "ArrowRight")).toBe(order[(index + 1) % 3]);
    expect(calculatorTabForKey(id, "Home")).toBe("team");
    expect(calculatorTabForKey(id, "End")).toBe("opponent");
  });

  it.each(["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "Escape", "a"])("leaves %s to native scrolling, focus or activation", (key) => {
    for (const { id } of CALCULATOR_TABS) expect(calculatorTabForKey(id, key)).toBeNull();
  });

  it("gives each calculator and pane its own stable IDs", () => {
    const ids = ["first", "second"].flatMap((prefix) => CALCULATOR_TABS.flatMap(({ id }) => Object.values(calculatorTabIds(prefix, id))));
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(calculatorTabIds("first", "moves")).toEqual({ tabId: "first-tab-moves", panelId: "first-pane-moves" });
  });

  it("leaves settings and their issue counts to the sections under the summary", () => {
    const html = renderToStaticMarkup(createElement(CalculatorTabs, { prefix: "calculator", activeTab: "moves", onSelect: () => undefined }));
    expect(html).not.toMatch(/Build settings|Field conditions|to check|disabled/);
  });
});
