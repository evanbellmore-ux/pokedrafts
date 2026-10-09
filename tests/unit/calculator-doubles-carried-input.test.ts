import { act, createElement, useState, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import type { CalculatorState } from "@/app/(app)/calculator/doubles-prep";

// The 2v2 Substitute HP field through the real useDoublesView and calculator state, client-rendered in the fake DOM
// (status-eot review, ui F5): a value typed past its bounds leaves the text in the field until blur, so the field says
// which HP the turn uses. react-dom/client loads after the fake DOM is installed (canUseDOM).

let document: FakeDocument;
let root: { render: (node: unknown) => void; unmount: () => void };
let latest: CalculatorState | null = null;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  const { useDoublesView } = await import("@/app/(app)/calculator/useDoublesView");
  const { createDoubles } = await import("@/app/(app)/calculator/doubles-prep");
  const { createMatchup } = await import("@/app/(app)/calculator/roster-prep");
  const panel = { status: "empty", teamName: null, message: "No roster.", choices: [] } as never;
  const noop = () => undefined;
  function Harness(): ReactNode {
    const [calc, setCalc] = useState<CalculatorState>(() => ({ matchup: createMatchup(0), doubles: createDoubles(0) }));
    latest = calc;
    const view = useDoublesView({
      prefix: "calc", calc, setCalc, active: true, mounted: true, rosterPanels: { own: panel, opponent: panel }, desktopRosters: false,
      rollMode: "average", onRollModeChange: noop, navigation: { cancelPending: noop, visit: noop, afterRender: noop, reveal: noop, selectTab: noop },
    });
    return view.settings;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
  await act(async () => { root.render(createElement(Harness)); });
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

const one = (selector: string) => {
  const found = document.querySelectorAll(selector);
  if (!found.length) throw new Error(`none: ${selector}`);
  return found[0] as FakeElement;
};
async function fire(element: FakeElement, handler: "onChange" | "onBlur", target: Record<string, unknown>) {
  const run = reactProps(element)[handler] as (event: unknown) => void;
  await act(async () => { run({ target: { ...target }, currentTarget: element }); });
}

describe("2v2 Substitute HP field", () => {
  it("says which HP the turn uses while the typed value is past its bounds, and takes the bound on blur", async () => {
    await fire(one('input[data-doubles-substitute="own-left"]'), "onChange", { checked: true });
    const field = () => one('input[data-doubles-substitute-hp="own-left"]');
    const block = () => one('[data-doubles-carried="own-left"]').textContent;
    const max = Number(field().getAttribute("max"));
    expect(max).toBeGreaterThan(1);
    expect(field().value).toBe(String(max));
    expect(latest!.doubles.carried["own-left"]).toEqual({ substitute: max });
    expect(field().getAttribute("aria-invalid")).not.toBe("true");

    // One digit past the maximum: the turn keeps the maximum, and the field says so.
    await fire(field(), "onChange", { value: `${max}0` });
    expect(field().value).toBe(`${max}0`);
    expect(latest!.doubles.carried["own-left"]).toEqual({ substitute: max });
    expect(block()).toContain(`Charizard: a Substitute has at most ${max} HP; the turn uses ${max}.`);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    const described = field().getAttribute("aria-describedby") ?? "";
    expect(described.split(" ").some((id) => document.getElementById(id)?.textContent?.includes("the turn uses"))).toBe(true);

    // Blur: the field takes the maximum and the fact goes.
    await fire(field(), "onBlur", { value: `${max}0` });
    expect(field().value).toBe(String(max));
    expect(block()).not.toContain("the turn uses");

    // A value the state follows resyncs at once, with no fact.
    await fire(field(), "onChange", { value: "12" });
    expect(latest!.doubles.carried["own-left"]).toEqual({ substitute: 12 });
    await fire(field(), "onChange", { value: "120" });
    expect(field().value).toBe(String(max));
    expect(block()).not.toContain("the turn uses");

    // Below 1 at 1 HP: the turn uses 1.
    await fire(field(), "onChange", { value: "1" });
    await fire(field(), "onChange", { value: "0" });
    expect(field().value).toBe("0");
    expect(latest!.doubles.carried["own-left"]).toEqual({ substitute: 1 });
    expect(block()).toContain("Charizard: a Substitute has at least 1 HP; the turn uses 1.");
    // Cleared while typing: no fact.
    await fire(field(), "onChange", { value: "" });
    expect(block()).not.toContain("the turn uses");
  });
});
