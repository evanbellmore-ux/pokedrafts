import { act, createElement, useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SuggestionState, TeamProblems, TeamSourceDraft } from "@/app/(app)/training/model/view-types";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { createSetupDraft, emptySource, resolveTeam } from "@/app/(app)/training/setup/team-draft";
import type TeamSetupType from "@/app/(app)/training/setup/TeamSetup";
import type TeamSourcePanelType from "@/app/(app)/training/setup/TeamSourcePanel";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState, runtime, snapshotWith, suggestionsFor } from "../fixtures/training";

// The Choose 6 list's fold below 64rem (fake DOM: the classes, not the layout): decided for each list, then only opened by
// itself; a press of its toggle wins until the next list; the Start bar's side fact opens it.

const ROSTERS = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
const READY = suggestionsFor(createSetupDraft()).own;

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let TeamSourcePanel: typeof TeamSourcePanelType;
let TeamSetup: typeof TeamSetupType;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  TeamSourcePanel = (await import("@/app/(app)/training/setup/TeamSourcePanel")).default;
  TeamSetup = (await import("@/app/(app)/training/setup/TeamSetup")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

type PanelProps = { initial?: TeamSourceDraft; suggestions?: SuggestionState; problems?: TeamProblems | null; reveal?: number; state?: CalculatorRosterState };
/** Your team's panel on its own, its source kept in local state as the session keeps the draft. */
function Panel({ initial = emptySource(), suggestions = READY, problems = null, reveal = 0, state = ROSTERS }: PanelProps) {
  const [source, setSource] = useState<TeamSourceDraft>(initial);
  const team = resolveTeam(source, state, "own", suggestions, runtime);
  return createElement(TeamSourcePanel, {
    role: "own", team, source, ownMode: source.mode, runtime, visibility: null, problems, moveOptions: {}, shared: new Set<string>(), reveal,
    rosters: { state, selectLeague() {}, selectOpponent() {}, refresh() {} },
    onSource: (change) => setSource(change), onRetrySuggest() {}, onLoadMoves() {},
  });
}
const show = async (props: PanelProps = {}) => { await act(async () => { root.render(createElement(Panel, props)); }); };

const toggle = (role = "own") => document.querySelectorAll(`[data-training-choose-toggle="${role}"]`)[0];
const list = (role = "own") => document.getElementById(toggle(role).getAttribute("aria-controls")!) as FakeElement;
const folded = (role = "own") => {
  const expanded = toggle(role).getAttribute("aria-expanded");
  const hidden = /\bmax-lg:hidden\b/.test(list(role).getAttribute("class") ?? "");
  const line = document.querySelectorAll(`[data-training-chosen="${role}"]`).length > 0;
  // The toggle, the list's class and the folded line agree.
  expect(hidden).toBe(expanded === "false");
  expect(line).toBe(expanded === "false");
  return expanded === "false";
};
async function press(element: FakeElement) {
  element.focus();
  await act(async () => { (reactProps(element).onClick as () => void)(); });
}
const button = (label: string) => document.querySelectorAll("button").find((each) => each.textContent === label)!;

describe("Choose 6 below 64rem", () => {
  it("folds a clean list; its toggle opens and folds it; a problem opens a list left alone, not one you folded", async () => {
    await show();
    expect(folded()).toBe(true);
    expect(document.querySelectorAll('[data-training-chosen="own"]')[0].textContent).toBe("Garchomp · Gyarados · Incineroar · Aerodactyl · Aegislash · Aggron");
    await press(toggle());
    expect(folded()).toBe(false);
    expect(document.activeElement).toBe(toggle());
    await press(toggle());
    expect(folded()).toBe(true);
    // You folded it: a Showdown problem keeps it folded, and the folded line states the count.
    const key = list().querySelectorAll("[data-training-member]")[0].getAttribute("data-training-member")!;
    const problems = { team: [], members: { [key]: ["Garchomp can't learn Spore."] } };
    await show({ problems });
    expect(folded()).toBe(true);
    expect(document.querySelectorAll('[data-training-chosen="own"]')[0].textContent).toContain("Showdown rules: 1 problem.");
    // Another source and back: a new list, decided again (folded while clean), and then a problem opens it.
    await show({ problems: null });
    await press(button("PokéPaste"));
    await press(button("League team"));
    expect(folded()).toBe(true);
    await show({ problems });
    expect(folded()).toBe(false);
    await act(async () => { root.render(null); });
  });

  it("never folds by itself: a list open for five chosen stays open, the focus on its box, once the sixth is chosen", async () => {
    const five = resolveTeam(emptySource(), ROSTERS, "own", READY, runtime).chosen.slice(0, 5);
    await show({ initial: { ...emptySource(), chosen: five } });
    expect(folded()).toBe(false);
    expect(toggle().textContent).toBe("Choose 6 · 5 of 7 chosen · Your team");
    const boxes = list().querySelectorAll("input");
    const sixth = boxes.find((box) => !box.checked && !reactProps(box).checked)!;
    sixth.focus();
    await act(async () => { (reactProps(sixth).onChange as () => void)(); });
    expect(toggle().textContent).toBe("Choose 6 · 6 of 7 chosen · Your team");
    expect(folded()).toBe(false);
    expect(document.activeElement).toBe(sixth);
    await act(async () => { root.render(null); });
  });

  it("keeps its state through Refresh teams: the same roster coming back is not a new list", async () => {
    const reloading = { ...ROSTERS, status: "loading" as const, data: null, teamsStatus: "loading" as const };
    // You opened it: still open once the roster is back.
    await show();
    await press(toggle());
    expect(folded()).toBe(false);
    await show({ state: reloading });
    expect(document.querySelectorAll('[data-training-choose-toggle="own"]')).toHaveLength(0);
    await show({ state: ROSTERS });
    expect(folded()).toBe(false);
    // Left alone (folded while clean): still folded once the roster is back, not opened by the reload's empty side.
    await act(async () => { root.render(null); });
    await show();
    expect(folded()).toBe(true);
    await show({ state: reloading });
    await show({ state: ROSTERS });
    expect(folded()).toBe(true);
    // Another roster after the reload: a new list, decided again (folded while clean, though you had opened the last one).
    await press(toggle());
    expect(folded()).toBe(false);
    await show({ state: reloading });
    await show({ state: rosterState(OWN_ROSTER.slice(1), OPPONENT_ROSTER) });
    expect(toggle().textContent).toBe("Choose 6 · 6 of 6 chosen · Your team");
    expect(folded()).toBe(true);
    await act(async () => { root.render(null); });
  });

  it("opens when the Start bar asks (the reveal count), even a list you folded", async () => {
    await show();
    await press(toggle());
    await press(toggle());
    expect(folded()).toBe(true);
    await show({ reveal: 1 });
    expect(folded()).toBe(false);
    await act(async () => { root.render(null); });
  });

  it("the Start bar's side fact opens that side's list and gives its heading the focus", async () => {
    const draft = createSetupDraft();
    const ready = suggestionsFor(draft);
    const session = new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
    const snapshot = snapshotWith({ suggestions: { own: ready.own, opponent: { status: "idle" } } }, draft);
    await act(async () => {
      root.render(createElement(TeamSetup, { runtime, rosters: { state: ROSTERS, selectLeague() {}, selectOpponent() {}, refresh() {} }, snapshot, session: session as never }));
    });
    // The opponent's sets are still coming: its list is folded, and the bar's first fact is that side's.
    expect(folded("opponent")).toBe(true);
    expect(folded("own")).toBe(true);
    const fact = document.querySelectorAll('[data-training-start-side="opponent"]')[0];
    expect(fact.textContent).toBe("Opponent: Suggesting sets…");
    await press(fact);
    expect(folded("opponent")).toBe(false);
    expect(folded("own")).toBe(true);
    expect(document.activeElement).toBe(document.querySelectorAll('[data-training-team-heading="opponent"]')[0]);
    await act(async () => { root.render(null); });
  });
});
