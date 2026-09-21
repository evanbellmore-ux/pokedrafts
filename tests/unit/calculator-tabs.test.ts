import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CalculatorTabs, { CALCULATOR_TABS, calculatorTabForKey, calculatorTabIds } from "@/app/(app)/calculator/CalculatorTabs";

describe("calculator menu tabs", () => {
  it("places own-team and dependent-opponent menus at the ends", () => {
    expect(CALCULATOR_TABS.map(({ label }) => label)).toEqual(["My team", "Moves", "Build settings", "Field conditions", "Opponent"]);
  });

  it.each(CALCULATOR_TABS)("renders only $id as the selected sequential tab stop", ({ id: activeTab }) => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(CalculatorTabs, { prefix: "calculator", activeTab, onSelect }));
    expect(html).toContain('role="tablist" aria-label="Calculator menus"');
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
    expect(buttons).toHaveLength(5);
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
    const order = ["team", "moves", "builds", "field", "opponent"] as const;
    const index = order.indexOf(id);
    expect(calculatorTabForKey(id, "ArrowLeft")).toBe(order[(index + 4) % 5]);
    expect(calculatorTabForKey(id, "ArrowRight")).toBe(order[(index + 1) % 5]);
    expect(calculatorTabForKey(id, "Home")).toBe("team");
    expect(calculatorTabForKey(id, "End")).toBe("opponent");
  });

  it.each(["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "Escape", "a"])("leaves %s to native scrolling, focus or activation", (key) => {
    for (const { id } of CALCULATOR_TABS) expect(calculatorTabForKey(id, key)).toBeNull();
  });

  it("gives each calculator and pane its own stable IDs", () => {
    const ids = ["first", "second"].flatMap((prefix) => CALCULATOR_TABS.flatMap(({ id }) => Object.values(calculatorTabIds(prefix, id))));
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(calculatorTabIds("first", "moves")).toEqual({ tabId: "first-tab-moves", panelId: "first-pane-moves" });
  });

  it("shows settings issue counts without disabling a hidden destination", () => {
    const html = renderToStaticMarkup(createElement(CalculatorTabs, {
      prefix: "calculator", activeTab: "moves", onSelect: () => undefined,
      issues: { builds: 2, field: 1, team: 0 },
    }));
    expect(html).toMatch(/Build settings<span[^>]*>2<span[^>]*> settings to check/);
    expect(html).toMatch(/Field conditions<span[^>]*>1<span[^>]*> settings to check/);
    expect([...html.matchAll(/settings to check/g)]).toHaveLength(2);
    expect(html).not.toContain("disabled");
  });
});
