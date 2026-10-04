import { act, createElement, type ComponentType } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import type { DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { MatchupResult } from "@/app/lib/battle/calculate";

// Client renders of the whole calculator in a fake DOM: how often each view's regions render, and what the engines
// calculate, while the other view is shown. react-dom/client loads after the fake DOM is installed (canUseDOM).

const counts = vi.hoisted(() => ({
  doublesSummary: 0, doublesSettings: 0, doublesMoves: 0, doublesMoveResults: 0,
  matchupSummary: 0, buildSettings: 0, matchupMoveResults: 0,
  turn: 0, pane: 0, representative: 0, matchup: 0,
}));
const rosters = vi.hoisted(() => ({ state: null as unknown }));

function counted<P extends object>(actual: ComponentType<P>, count: (props: P) => void) {
  return function Counted(props: P) {
    count(props);
    return createElement(actual, props);
  };
}

vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => false }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", async () => {
  const { createRosterState } = await import("@/app/(app)/calculator/roster-data");
  rosters.state = createRosterState();
  return { default: () => ({ state: rosters.state, selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }) };
});
vi.mock("@/app/lib/battle/calculate", () => ({
  calculateMatchup: () => {
    counts.matchup += 1;
    return { issues: { attacker: [], defender: [], field: [] }, results: [] } satisfies MatchupResult;
  },
}));
vi.mock("@/app/lib/battle/doubles-turn", () => ({
  calculateDoublesTurn: (): DoublesTurnResult => {
    counts.turn += 1;
    return { status: "not-estimated", reason: "Too many cases to follow.", start: null, startRows: [], facts: [] };
  },
  calculateDoublesMoves: (): MatchupResult => {
    counts.pane += 1;
    return { issues: { attacker: [], defender: [], field: [] }, results: [] };
  },
  doublesRepresentative: () => {
    counts.representative += 1;
    return null;
  },
  DOUBLES_REFERENCE: { on: false },
}));
vi.mock("@/app/(app)/calculator/DoublesSummary", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/DoublesSummary")>();
  return { ...actual, default: counted(actual.default, () => { counts.doublesSummary += 1; }) };
});
vi.mock("@/app/(app)/calculator/DoublesSettings", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/DoublesSettings")>();
  return { ...actual, default: counted(actual.default, () => { counts.doublesSettings += 1; }) };
});
vi.mock("@/app/(app)/calculator/DoublesMoves", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/DoublesMoves")>();
  return { ...actual, default: counted(actual.default, () => { counts.doublesMoves += 1; }) };
});
vi.mock("@/app/(app)/calculator/MatchupSummary", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/MatchupSummary")>();
  return { ...actual, default: counted(actual.default, () => { counts.matchupSummary += 1; }) };
});
vi.mock("@/app/(app)/calculator/BuildSettings", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/BuildSettings")>();
  return { ...actual, default: counted(actual.default, () => { counts.buildSettings += 1; }) };
});
// 2v2's list has the "Moves" heading; 1v1's has none (the default).
vi.mock("@/app/(app)/calculator/MoveResults", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/MoveResults")>();
  return { ...actual, default: counted(actual.default, (props) => { if (props.heading) counts.doublesMoveResults += 1; else counts.matchupMoveResults += 1; }) };
});

let document: FakeDocument;
let root: { render: (node: unknown) => void; unmount: () => void };

/** Lets the lazily imported engines resolve and their state updates commit. */
async function settle() {
  for (let index = 0; index < 5; index++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function buttons(match: (button: FakeElement) => boolean) {
  return document.querySelectorAll("button").filter(match);
}

function button(match: (button: FakeElement) => boolean) {
  const found = buttons(match);
  if (found.length === 0) throw new Error("No such button.");
  return found[0];
}

async function click(element: FakeElement) {
  const onClick = reactProps(element).onClick as (event: unknown) => void;
  await act(async () => { onClick({ currentTarget: element, target: element, preventDefault() {}, stopPropagation() {} }); });
  await settle();
}

const mode = (value: "1v1" | "2v2") => button((entry) => entry.localName === "button" && entry.getAttribute("data-calculator-mode") === value);
const regions = (value: "1v1" | "2v2") => document.querySelectorAll(`div[data-calculator-mode-only="${value}"]`);
const inRegion = (value: "1v1" | "2v2", element: FakeElement) => regions(value).some((region) => region.contains(element));
const snapshot = () => ({ ...counts });

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
  await act(async () => { root.render(createElement(CalculatorClient)); });
  await settle();
});

afterAll(async () => {
  await act(async () => { root?.unmount(); });
});

describe("the view the mode switch hides", () => {
  it("is not rendered or recalculated by the shown view's updates", async () => {
    expect(regions("2v2")).toHaveLength(0);
    expect(counts.doublesSummary).toBe(0);
    await click(mode("2v2"));
    expect(regions("2v2")).toHaveLength(3);
    for (const region of regions("2v2")) expect(region.hidden).toBe(false);
    for (const region of regions("1v1")) expect(region.hidden).toBe(true);
    expect(counts.turn).toBeGreaterThan(0);
    expect(counts.pane).toBeGreaterThan(0);

    // Back to 1v1: one render hides each 2v2 region, then 1v1 updates skip them.
    await click(mode("1v1"));
    for (const region of regions("2v2")) expect(region.hidden).toBe(true);
    for (const region of regions("1v1")) expect(region.hidden).toBe(false);
    const hidden = snapshot();
    await click(button((entry) => entry.textContent.endsWith("Swap")));
    const quick = button((entry) => entry.hasAttribute("data-move-owner") && entry.getAttribute("data-move-slot") === "0" && inRegion("1v1", entry));
    await click(quick);
    await click(button((entry) => entry.getAttribute("data-team-source") === "own" && entry.getAttribute("data-team-mode") === "paste"));
    const after = snapshot();
    expect(after.matchupSummary).toBeGreaterThan(hidden.matchupSummary);
    for (const key of ["doublesSummary", "doublesSettings", "doublesMoves", "doublesMoveResults", "turn", "pane", "representative"] as const) {
      expect([key, after[key]]).toEqual([key, hidden[key]]);
    }

    // Shown again, 2v2 renders the current state, with the team-source notice the 1v1 update gave it.
    await click(mode("2v2"));
    for (const region of regions("2v2")) expect(region.hidden).toBe(false);
    expect(counts.doublesSummary).toBeGreaterThan(after.doublesSummary);
    const notices = document.querySelectorAll('p[role="status"]').map((entry) => entry.textContent);
    expect(notices).toContain("Team source changed. Current Pokémon and their preparation kept.");

    // And 2v2 updates skip the hidden 1v1 regions.
    const shown = snapshot();
    const own = button((entry) => entry.hasAttribute("data-move-owner") && entry.getAttribute("data-move-slot") === "0" && inRegion("2v2", entry));
    await click(own);
    await click(button((entry) => entry.getAttribute("data-doubles-no-move") === "own-left"));
    const later = snapshot();
    expect(later.doublesSummary).toBeGreaterThan(shown.doublesSummary);
    for (const key of ["matchupSummary", "buildSettings", "matchupMoveResults", "matchup"] as const) {
      expect([key, later[key]]).toEqual([key, shown[key]]);
    }
  });
});
