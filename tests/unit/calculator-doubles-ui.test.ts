import { createElement, type ChangeEvent, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CHOSEN_HITS, CHOSEN_HITS_ACTIONS, CHOSEN_HITS_CONTEXTS, CHOSEN_HITS_NOT_ESTIMATED, CHOSEN_HITS_RULES,
  combatant, DOUBLE_TARGET, DOUBLE_TARGET_ACTIONS, DOUBLE_TARGET_RULES, fixture, ISSUES, NOT_ESTIMATED, NOT_ESTIMATED_ACTIONS, NOT_ESTIMATED_RULES,
  RULES, SELF_KO, SELF_KO_ACTIONS, SELF_KO_RULES, UNCERTAIN_ORDER, UNCERTAIN_ORDER_ACTIONS, UNCERTAIN_ORDER_RULES, UNCERTAIN_SPECIES, type DoublesFixture,
} from "../fixtures/doubles-turn";
import { positionalIn } from "../fixtures/naming";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import DoublesSettings from "@/app/(app)/calculator/DoublesSettings";
import DoublesMoves from "@/app/(app)/calculator/DoublesMoves";
import BattleConditions, { DoublesCarriedContext, describeDoublesConditions, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import {
  actionFact, cardHPLabel, cardReached, conditionsLine, factLine, hitLine, hpChangeText, listedHits, orderFact,
  residualLine, shownHP, startRowLine, stepHeading, substituteLine, targetName, turnHP, turnSummary,
} from "@/app/(app)/calculator/doubles-format";
import {
  carriedAbilityOn, carriedIssueTexts, carriedOptions, createDoubles, doublesSlotInput, getDoublesTurnInput, NO_CARRIED_OPTIONS, reconcileCarried, setDoublesCarried,
  setDoublesField, sleepTurnsMax, updateDoublesBuild, updateDoublesHP, type CalculatorState,
} from "@/app/(app)/calculator/doubles-prep";
import type { DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { createMatchup, getMoveOwner } from "@/app/(app)/calculator/roster-prep";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import {
  DOUBLES_SLOTS, slotSide, type DoublesCarried, type DoublesHit, type DoublesHP, type DoublesResidual, type DoublesSlotId, type DoublesStep, type DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveDamageResult } from "@/app/lib/battle/types";

// Keep real SSR and hooks while recording host handlers for DOM-free callback tests (as calculator-ui.test.ts does).
const hostEvents = vi.hoisted(() => ({
  capture: false,
  buttons: [] as (ComponentProps<"button"> & Record<string, unknown>)[],
  inputs: [] as (ComponentProps<"input"> & Record<string, unknown>)[],
  selects: [] as (ComponentProps<"select"> & Record<string, unknown>)[],
}));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (!hostEvents.capture) return;
    if (type === "button") hostEvents.buttons.push(props as typeof hostEvents.buttons[number]);
    if (type === "input") hostEvents.inputs.push(props as typeof hostEvents.inputs[number]);
    if (type === "select") hostEvents.selects.push(props as typeof hostEvents.selects[number]);
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
      if (hostEvents.capture && args[0] === "button") hostEvents.buttons.push(args[1] as typeof hostEvents.buttons[number]);
      if (hostEvents.capture && args[0] === "input") hostEvents.inputs.push(args[1] as typeof hostEvents.inputs[number]);
      if (hostEvents.capture && args[0] === "select") hostEvents.selects.push(args[1] as typeof hostEvents.selects[number]);
      return actual.jsxDEV(...args);
    },
  };
});

function capture(render: () => string) {
  hostEvents.buttons = [];
  hostEvents.inputs = [];
  hostEvents.selects = [];
  hostEvents.capture = true;
  try { return { html: render(), buttons: hostEvents.buttons, inputs: hostEvents.inputs, selects: hostEvents.selects }; }
  finally { hostEvents.capture = false; }
}

type SummaryProps = ComponentProps<typeof DoublesSummary>;

function summaryProps(view: DoublesFixture, overrides: Partial<SummaryProps> = {}): SummaryProps {
  return {
    runtime: championsRuntime, cards: view.cards, names: view.names, turn: view.turn, rollMode: "average", onRollModeChange: vi.fn(),
    replacement: null, movesControl: "moves-list", magicRoom: false, terrain: "",
    onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(),
    onActivateMove: vi.fn(), onChooseMove: vi.fn(), onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
    ...overrides,
  };
}

function summary(view: DoublesFixture, overrides: Partial<SummaryProps> = {}) {
  return renderToStaticMarkup(createElement(DoublesSummary, summaryProps(view, overrides)));
}

const doubleTarget = (turn: DoublesTurnResult | null = DOUBLE_TARGET) => fixture({ actions: DOUBLE_TARGET_ACTIONS, rules: DOUBLE_TARGET_RULES, turn });
const uncertain = () => fixture({ species: UNCERTAIN_SPECIES, actions: UNCERTAIN_ORDER_ACTIONS, rules: UNCERTAIN_ORDER_RULES, turn: UNCERTAIN_ORDER });
const notEstimated = () => fixture({ actions: NOT_ESTIMATED_ACTIONS, rules: NOT_ESTIMATED_RULES, turn: NOT_ESTIMATED });

/** One card's markup, up to the next card or the turn panel. */
function card(html: string, slot: DoublesSlotId) {
  const start = html.indexOf(`data-doubles-slot="${slot}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.slice(1).search(/data-doubles-slot="|data-doubles-turn/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function turnPanel(html: string) {
  const start = html.indexOf("<section data-doubles-turn");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

/** Text a sighted user can see: no tags, attributes or screen-reader-only text. */
function visibleText(html: string) {
  return html.replace(/<(\w+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

function text(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

function assertControlLabels(html: string, external: string[] = []) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby|controls)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect([...ids, ...external]).toContain(id);
  }
}

/** The live summary's last sentence for a shared fixture's end of turn: " End of turn not estimated: {reason}" when it is not estimated. */
function fixtureEnd(turn: DoublesTurnResult = DOUBLE_TARGET) {
  return turn.status === "ready" && turn.endOfTurn.status === "not-estimated" ? ` End of turn not estimated: ${turn.endOfTurn.reason}` : "";
}

const click = (button: { onClick?: unknown }) => (button.onClick as (event: MouseEvent<HTMLButtonElement>) => void)({} as MouseEvent<HTMLButtonElement>);
const change = (input: { onChange?: unknown }) => (input.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);

describe("2v2 text (doubles-format)", () => {
  const view = doubleTarget();
  const names = view.names;

  it("names each target by its Pokémon, and the acting Pokémon as itself", () => {
    expect(DOUBLES_SLOTS.map((slot) => targetName(names, "own-left", slot))).toEqual(["Itself", "Venusaur", "Blastoise", "Pikachu"]);
    expect(DOUBLES_SLOTS.map((slot) => targetName(names, "opponent-right", slot))).toEqual(["Charizard", "Venusaur", "Blastoise", "Itself"]);
    expect(names["opponent-right"]).toBe("Pikachu");
    expect(names["opponent-left"]).toBe("Blastoise");
    // A slot with no Pokémon has no name: the UI's unset mark.
    expect(targetName({ ...names, "opponent-left": "" }, "own-left", "opponent-left")).toBe("—");
  });

  it("writes each action as a fact", () => {
    expect(actionFact("Weather Ball", names, "own-left", RULES.ownSingle, "opponent-left")).toBe("Weather Ball → Blastoise");
    expect(actionFact("Earthquake", names, "own-left", RULES.earthquake, null)).toBe("Earthquake → both foes and Venusaur");
    expect(actionFact("Outrage", names, "own-left", RULES.random, null)).toBe("Outrage → a random foe");
    expect(actionFact("Helping Hand", names, "own-left", RULES.helpingHand, null)).toBe("Helping Hand → Venusaur");
    expect(actionFact("Protect", names, "own-left", RULES.self, null)).toBe("Protect · Targets itself");
    expect(actionFact("Tailwind", names, "own-left", RULES.ownSide, null)).toBe("Tailwind · Targets its side");
    expect(actionFact("Water Spout", names, "opponent-left", RULES.opponentSpreadFoes, null)).toBe("Water Spout → both foes");
    expect(actionFact("Weather Ball", names, "own-left", RULES.ownSingle, null)).toBe("Weather Ball · No target");
  });

  it("tells two of the same species apart by team", () => {
    const mirror = uncertain();
    expect(mirror.names["own-left"]).toBe("Garchomp (yours)");
    expect(mirror.names["opponent-left"]).toBe("Garchomp (opponent's)");
    expect(targetName(mirror.names, "opponent-left", "own-left")).toBe("Garchomp (yours)");
    expect(targetName(mirror.names, "own-left", "opponent-left")).toBe("Garchomp (opponent's)");
  });

  it("adds a chance to a fact that does not always hold, and an order only when it is uncertain", () => {
    expect(factLine({ text: "Faints before it moves.", chance: 0.625 })).toBe("Faints before it moves (62.5%).");
    expect(factLine({ text: "Fully paralysed.", chance: 1 })).toBe("Fully paralysed.");
    expect(factLine({ text: "Flinches (Fake Out)", chance: 0.5 })).toBe("Flinches (Fake Out) (50%)");
    expect(orderFact([{ position: 1, chance: 0.5 }, { position: 2, chance: 0.5 }])).toBe("Order: 1st 50% · 2nd 50%.");
    expect(orderFact([{ position: 3, chance: 1 }])).toBeNull();
  });

  it("shows the roll's HP, rounding the average's damage like 1v1", () => {
    const blastoise = DOUBLE_TARGET.status === "ready" ? DOUBLE_TARGET.hp["opponent-left"]! : null;
    expect((["low", "average", "high"] as const).map((mode) => shownHP(blastoise!, mode))).toEqual([4, 1, 0]);
    expect(shownHP({ start: 100, low: 50, average: 49.5, high: 40 }, "average")).toBe(49);
    expect(cardHPLabel(true, "high", "tera")).toBe("After the moves · High roll");
    expect(cardHPLabel(false, "average", "dynamax")).toBe("Current HP (Dynamax)");
    expect(cardHPLabel(false, "average", undefined)).toBe("Current HP");
  });

  it("writes hits, start rows, step headings and the live summary", () => {
    if (DOUBLE_TARGET.status !== "ready" || NOT_ESTIMATED.status !== "not-estimated") throw new Error("fixture");
    expect(hitLine(DOUBLE_TARGET.steps[2].hits[0], names)).toBe("Blastoise: 36–43 damage (23.38–27.92% of max HP) · KO chance 75%");
    expect(hitLine(DOUBLE_TARGET.steps[3].hits[0], names)).toBe("Charizard: 30–36 damage (19.61–23.53% of max HP) · KO chance 0% · reaches it 25%");
    expect(hitLine({ ...DOUBLE_TARGET.steps[3].hits[1], kind: "blocked", min: null, max: null }, names)).toBe("Venusaur: no damage · reaches it 25%");
    expect(hitLine({ ...DOUBLE_TARGET.steps[2].hits[0], row: { ...DOUBLE_TARGET.steps[2].hits[0].row!, hits: 3, hitChances: [{ hits: 2, chance: 0.5 }, { hits: 3, chance: 0.5 }] } }, names))
      .toBe("Blastoise: 36–43 damage (23.38–27.92% of max HP), 2–3 hits · KO chance 75%");
    // A chosen count is named, as 1v1's result-format hitRangeText(row, chosen) names it.
    const three = { ...DOUBLE_TARGET.steps[2].hits[0], row: { ...DOUBLE_TARGET.steps[2].hits[0].row!, hits: 3 } };
    expect(hitLine(three, names)).toBe("Blastoise: 36–43 damage (23.38–27.92% of max HP) · KO chance 75%");
    expect(hitLine(three, names, true)).toBe("Blastoise: 36–43 damage (23.38–27.92% of max HP), 3 hits · KO chance 75%");
    expect(startRowLine({ ...NOT_ESTIMATED.startRows[0], row: { ...NOT_ESTIMATED.startRows[0].row, hits: 3 } }, names, championsRuntime, true))
      .toBe("Heat Wave · Charizard → Blastoise: 26–31 damage (16.88–20.13% of max HP), 3 hits");
    expect(startRowLine(NOT_ESTIMATED.startRows[0], names, championsRuntime)).toBe("Heat Wave · Charizard → Blastoise: 26–31 damage (16.88–20.13% of max HP)");
    expect(startRowLine({ slot: "own-right", target: "opponent-left", row: { ...NOT_ESTIMATED.startRows[0].row, moveId: "sleeppowder", kind: "status", reason: null } }, names, championsRuntime))
      .toBe("Sleep Powder · Venusaur → Blastoise: Status move");
    expect(stepHeading(2, DOUBLE_TARGET.steps[1], names, championsRuntime, { arrow: true, text: "Blastoise" })).toBe("2 · Weather Ball · Charizard → Blastoise");
    expect(stepHeading(1, DOUBLE_TARGET.steps[0], names, championsRuntime, { arrow: false, text: "Targets itself" })).toBe("1 · Protect · Pikachu · Targets itself");
    expect(stepHeading(4, DOUBLE_TARGET.steps[3], names, championsRuntime, null)).toBe("4 · Water Spout · Blastoise → both foes");
    // With the end of turn not estimated (the fixture's), the HP is after the moves and the summary says why.
    expect(turnSummary(DOUBLE_TARGET, names, "average")).toBe(`Charizard HP remaining: 145 / 153. Venusaur HP remaining: 153 / 155. Blastoise HP remaining: 1 / 154, KO chance 75%. Pikachu HP remaining: 110 / 110.${fixtureEnd()}`);
    expect(turnSummary(NOT_ESTIMATED, names, "average")).toBe("Turn not estimated: Worry Seed is not modelled and comes before another move.");
    expect(turnSummary(ISSUES, names, "average")).toBe("Charizard: Weather Ball has no target.");
    expect(turnSummary(null, names, "average")).toBe("");
  });

  it("counts only the 2v2 field toggles it shows", () => {
    const field = createConditions();
    expect(describeDoublesConditions(field, { "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": false })).toBe("Doubles · No weather · No terrain · 0 toggles on");
    const busy = {
      ...field, weather: "Rain" as const, terrain: "Psychic" as const, critical: true, multipleTargets: true, fairyAura: true, trickRoom: true,
      attackerSide: { ...field.attackerSide, reflect: true, helpingHand: true, protect: true, charge: true },
      defenderSide: { ...field.defenderSide, tailwind: true, friendGuard: true, priorityShield: true },
    };
    // Critical hit, Trick Room, Reflect, Tailwind and one Charge; not the spread modifier, Fairy Aura or the derived side flags.
    expect(describeDoublesConditions(busy, { "own-left": true, "own-right": false, "opponent-left": false, "opponent-right": false })).toBe("Doubles · Rain · Psychic terrain · 5 toggles on");
  });
});

describe("2v2 summary (DoublesSummary)", () => {
  it("lays out two sides of two cards with their quick moves, No move and All moves", () => {
    const view = fixture();
    const html = summary(view);
    expect([...html.matchAll(/data-doubles-slot="([^"]+)"/g)].map((match) => match[1])).toEqual(DOUBLES_SLOTS);
    expect([...html.matchAll(/data-doubles-side="([^"]+)"[^>]*>\s*<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => [match[1], match[2]]))
      .toEqual([["own", "Your side"], ["opponent", "Opponent&#x27;s side"]]);
    const quick = [...html.matchAll(/<button[^>]*data-move-owner="([^"]+)"[^>]*aria-label="([^"]+)"/g)];
    expect(quick).toHaveLength(16);
    expect(new Set(quick.map((match) => match[2])).size).toBe(16);
    expect(quick[0][2]).toBe("Charizard move 1: Heat Wave");
    expect(quick.slice(12).every((match) => match[1] === `${view.cards["opponent-right"].slot.key}:0`)).toBe(true);
    expect(html.match(/data-doubles-no-move="[^"]+"[^>]*aria-pressed="true"/g)).toHaveLength(4);
    expect(html).toMatch(/aria-label="Venusaur: all moves" aria-controls="moves-list"/);
    // Each heading is the Pokémon's name (PokemonName), with no line above it naming a place.
    expect([...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map((match) => match[1])).toEqual(["Charizard", "Venusaur", "Blastoise", "Pikachu"]);
    expect(positionalIn(html)).toEqual([]);
    expect(html).not.toContain("<fieldset class=\"min-w-0\"><legend");
    expect(html).not.toContain("data-doubles-target");
    expect(text(turnPanel(html))).toContain("No moves chosen.");
    expect(card(html, "own-left")).toContain("Current HP");
    assertControlLabels(html, ["moves-list"]);
  });

  it("asks for a target only when the move takes one, and states every action", () => {
    const html = summary(doubleTarget());
    const charizard = card(html, "own-left");
    expect(charizard.match(/<legend[^>]*>Target<span class="sr-only"> for Charizard<\/span><\/legend>/)).not.toBeNull();
    const radios = [...charizard.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios.map((tag) => tag.match(/value="([^"]+)"/)?.[1])).toEqual(["opponent-left", "opponent-right", "own-right"]);
    expect(radios.map((tag) => /checked=""/.test(tag))).toEqual([true, false, false]);
    // One line per radio: the Pokémon's name.
    expect([...charizard.matchAll(/<label[^>]*for="[^"]+-target-[^"]+"[^>]*>([\s\S]*?)<\/label>/g)].map((match) => text(match[1]))).toEqual(["Blastoise", "Pikachu", "Venusaur"]);
    expect(text(charizard)).toMatch(/Blastoise[\s\S]*Pikachu[\s\S]*Venusaur/);
    expect(charizard).toMatch(/<p data-doubles-action="own-left" aria-hidden="true"[^>]*>Weather Ball<span aria-hidden="true"> → <\/span><span class="sr-only"> targets <\/span>Blastoise<\/p>/);
    const blastoise = card(html, "opponent-left");
    expect(blastoise).not.toContain('type="radio"');
    expect(blastoise).toMatch(/<p data-doubles-action="opponent-left" class[^>]*>Water Spout<span aria-hidden="true"> → <\/span><span class="sr-only"> targets <\/span>both foes<\/p>/);
    const pikachu = card(html, "opponent-right");
    expect(text(pikachu)).toContain("Move: Protect");
    expect(text(pikachu)).toContain("Protect · Targets itself");
    expect(pikachu).toMatch(/data-doubles-all-moves="opponent-right"[^>]*class="[^"]*border-accent-border/);
    expect(pikachu.match(/data-doubles-no-move="opponent-right"[^>]*aria-pressed="false"/)).not.toBeNull();
    const earthquake = summary(fixture({ species: { "own-left": "garchomp" }, actions: { "own-left": { moveId: "earthquake", target: null } }, rules: { "own-left": RULES.earthquake } }));
    expect(text(card(earthquake, "own-left"))).toContain("Earthquake →  targets both foes and Venusaur");
    expect(earthquake).toMatch(/aria-label="Garchomp move 2: Earthquake"[^>]*aria-pressed="true"/);
    expect(positionalIn(html)).toEqual([]);
    assertControlLabels(html, ["moves-list"]);
  });

  it.each([["low", 4, "Low roll"], ["average", 1, "Average estimate"], ["high", 0, "High roll"]] as const)("projects the %s roll's HP after the moves", (mode, shown, label) => {
    const html = summary(doubleTarget(), { rollMode: mode as DamageRollMode });
    const blastoise = card(html, "opponent-left");
    expect(blastoise).toContain(`After the moves · ${label}`);
    expect(blastoise).toMatch(new RegExp(`<span class="text-xl font-bold text-text">${shown}</span><span class="text-sm text-muted"> / 154 HP</span>`));
    expect(blastoise).toMatch(new RegExp(`role="meter" aria-label="Blastoise projected HP" aria-valuemin="0" aria-valuemax="154" aria-valuenow="${shown}" aria-valuetext="${shown} of 154 HP after the moves, ${label} \\(0–4\\). KO chance: 75%. Turn start HP: 60."`));
    expect(blastoise).toMatch(/data-hp-range="true" aria-hidden="true" class="absolute inset-y-0 bg-text\/25" style="left:0%;width:2.59740259740259\d*%"/);
    expect(text(blastoise)).toContain("Turn start: 60 / 154 · KO chance: 75%");
    expect(text(turnPanel(html))).toContain(`Turn · ${label}`);
  });

  it("shows a KO chance only on a Pokémon a move reaches", () => {
    const html = summary(doubleTarget());
    expect(text(card(html, "own-left"))).toContain("Turn start: 153 / 153 · KO chance: 0%");
    expect(text(card(html, "own-left"))).toContain("145 / 153 HP");
    const pikachu = text(card(html, "opponent-right"));
    expect(pikachu).toContain("After the moves · Average estimate");
    expect(pikachu).toContain("Turn start: 110 / 110");
    expect(pikachu).not.toContain("KO chance");
  });

  it("shows the reason once, in the turn, while results are paused", () => {
    const html = summary(doubleTarget(), { blockedReason: "HP preview paused while the calculator loads." });
    for (const slot of DOUBLES_SLOTS) {
      expect(card(html, slot)).toContain("Current HP");
      expect(card(html, slot)).not.toContain("After the moves");
    }
    expect(card(html, "opponent-left")).toMatch(/aria-valuenow="154" aria-valuetext="154 of 154 HP"/);
    expect(html.match(/HP preview paused while the calculator loads\./g)).toHaveLength(2);
    expect(turnPanel(html)).toMatch(/<p data-doubles-live="true" aria-live="polite" aria-atomic="true" class="sr-only">HP preview paused while the calculator loads\.<\/p>/);
    expect(turnPanel(html)).not.toContain("data-doubles-step");
  });

  it("names the Pokémon of an uncertain turn by team when both sides show a species", () => {
    const html = summary(uncertain());
    expect(html).toContain('aria-label="Garchomp (yours) move 1: Dragon Claw"');
    expect(html).toContain('aria-label="Garchomp (opponent&#x27;s) move 1: Dragon Claw"');
    const garchomp = card(html, "own-left");
    // Each card sits in its side's labelled group, so its heading gives the team to screen readers only.
    expect(garchomp).toMatch(/<h4[^>]*>Garchomp<span class="sr-only"> \(yours\)<\/span><\/h4>/);
    expect(card(html, "opponent-left")).toMatch(/<h4[^>]*>Garchomp<span class="sr-only"> \(opponent&#x27;s\)<\/span><\/h4>/);
    expect([...garchomp.matchAll(/<label[^>]*for="[^"]+-target-[^"]+"[^>]*>([\s\S]*?)<\/label>/g)].map((match) => text(match[1]))).toEqual(["Garchomp (opponent's)", "Pikachu", "Venusaur"]);
    expect(text(garchomp)).toContain("Dragon Claw →  targets Garchomp (opponent's)");
    expect(text(card(html, "own-left"))).toContain("91 / 183 HP");
    expect(positionalIn(html)).toEqual([]);
  });

  it("numbers two of one species on one side, with the team for screen readers only in their headings", () => {
    const html = summary(fixture({ species: { "own-left": "garchomp", "own-right": "garchomp", "opponent-left": "garchomp" } }));
    expect([...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map((match) => match[1])).toEqual([
      'Garchomp (<span class="sr-only">yours, </span>1)', 'Garchomp (<span class="sr-only">yours, </span>2)',
      'Garchomp<span class="sr-only"> (opponent&#x27;s)</span>', "Pikachu",
    ]);
    expect(html).toContain('aria-label="Garchomp (yours, 1) move 1: Dragon Claw"');
    expect(html).toContain('aria-label="Garchomp (yours, 2) move 1: Dragon Claw"');
    expect(html).toContain('aria-label="Change Garchomp (yours, 2)"');
    expect(html).toContain('aria-label="Garchomp (opponent&#x27;s) current HP"');
    expect(positionalIn(html)).toEqual([]);
  });
});

describe("2v2 turn (DoublesTurn)", () => {
  it("lists each move in turn order with each Pokémon it reaches", () => {
    const html = summary(doubleTarget());
    const panel = turnPanel(html);
    expect(panel).toMatch(/<ol aria-label="Actions in turn order"/);
    expect([...panel.matchAll(/data-doubles-step="([^"]+)"/g)].map((match) => match[1])).toEqual(["opponent-right", "own-left", "own-right", "opponent-left"]);
    const steps = text(panel);
    expect(steps).toContain("1 · Protect · Pikachu · Targets itself");
    expect(steps).toContain("2 · Weather Ball · Charizard →  targets Blastoise");
    expect(steps).toContain("Blastoise: 20–24 damage (12.99–15.58% of max HP) · KO chance 0%");
    expect(steps).toContain("Blastoise: 36–43 damage (23.38–27.92% of max HP) · KO chance 75%");
    expect(steps).toContain("Faints before it moves (75%).");
    expect(steps).toContain("Water Spout: 58 power at 60 HP (25%).");
    expect(steps).toContain("Charizard: 30–36 damage (19.61–23.53% of max HP) · KO chance 0% · reaches it 25%");
    expect(panel).toMatch(/<ul aria-label="Sludge Bomb hits from Venusaur"[^>]*><li data-doubles-hit="opponent-left"/);
    expect(panel).not.toMatch(/aria-label="Protect hits/);
    expect(steps).toContain("Every move hits; no critical hits; added effects below 100% do not happen.");
    expect(steps).toContain("Assumes no protecting move was used last turn.");
    expect(panel).toContain("Show move<span class=\"sr-only\"> Weather Ball, Charizard</span>");
    expect(positionalIn(panel)).toEqual([]);
    expect(text(panel.match(/<p data-doubles-live="true" aria-live="polite" aria-atomic="true" class="sr-only">([^<]*)<\/p>/)![1]))
      .toBe(`Charizard HP remaining: 145 / 153. Venusaur HP remaining: 153 / 155. Blastoise HP remaining: 1 / 154, KO chance 75%. Pikachu HP remaining: 110 / 110.${fixtureEnd()}`);
    expect(steps).not.toMatch(/Assumes the target uses a 0-priority move|Analytic: needs the Doubles turn order/);
  });

  it("states an uncertain order", () => {
    const html = turnPanel(summary(uncertain()));
    const panel = text(html);
    expect(panel.match(/Order: 1st 50% · 2nd 50%\./g)).toHaveLength(2);
    expect(panel).toContain("Faints before it moves (50%).");
    expect(panel).toContain("1 · Dragon Claw · Garchomp (yours) →  targets Garchomp (opponent's)");
    expect(panel).toContain("2 · Dragon Claw · Garchomp (opponent's) →  targets Garchomp (yours)");
    expect(panel).toContain("Garchomp (opponent's): 184–217 damage (100.55–118.58% of max HP) · KO chance 50% · reaches it 50%");
    // Two Pokémon use Dragon Claw: each hit list also names its user, so the two lists differ.
    expect([...html.matchAll(/<ul aria-label="(Dragon Claw hits[^"]*)"/g)].map((match) => match[1])).toEqual(["Dragon Claw hits from Garchomp (yours)", "Dragon Claw hits from Garchomp (opponent&#x27;s)"]);
    expect(positionalIn(html)).toEqual([]);
  });

  it("gives the reason a turn is not estimated, then each move's damage at the start of the turn", () => {
    const html = summary(notEstimated());
    const panel = turnPanel(html);
    expect(text(panel)).toContain("Turn not estimated: Worry Seed is not modelled and comes before another move.");
    expect(panel).toMatch(/<h4 id="([^"]+)"[^>]*>At the start of the turn<\/h4><ul aria-labelledby="\1"/);
    expect([...panel.matchAll(/<li data-doubles-start-row="[^"]+"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => text(match[1]))).toEqual([
      "Heat Wave · Charizard →  targets Blastoise: 26–31 damage (16.88–20.13% of max HP)",
      "Heat Wave · Charizard →  targets Pikachu: 70–83 damage (63.64–75.45% of max HP)",
    ]);
    expect(panel).not.toContain("data-doubles-step");
    for (const slot of DOUBLES_SLOTS) expect(card(html, slot)).toContain("Current HP");
    expect(html.match(/Worry Seed is not modelled/g)).toHaveLength(2);
  });

  it("lists the engine's validation messages with Fix settings", () => {
    const view = fixture({ actions: { "own-left": { moveId: "weatherball", target: null } }, rules: { "own-left": RULES.ownSingle }, turn: ISSUES });
    const onFixSettings = vi.fn();
    const { html, buttons } = capture(() => summary(view, { onFixSettings }));
    expect(text(turnPanel(html))).toContain("Charizard: Weather Ball has no target.");
    const fix = buttons.find((button) => [button.children].flat().includes("Fix settings"));
    expect(fix).toBeDefined();
    click(fix!);
    expect(onFixSettings).toHaveBeenCalledOnce();
  });

  it("shows the KO chance of a Pokémon that faints to its own move, with the step's fact", () => {
    const view = fixture({ actions: SELF_KO_ACTIONS, rules: SELF_KO_RULES, turn: SELF_KO });
    expect(view.cards["own-left"].reached).toBe(true);
    expect(view.cards["own-right"].reached).toBe(false);
    const html = summary(view);
    const charizard = card(html, "own-left");
    expect(text(charizard)).toContain("0 / 153 HP");
    expect(text(charizard)).toContain("Turn start: 5 / 153 · KO chance: 100%");
    expect(charizard).toContain('aria-valuetext="0 of 153 HP after the moves, Average estimate. KO chance: 100%. Turn start HP: 5."');
    expect(text(card(html, "own-right"))).not.toContain("KO chance");
    const panel = text(turnPanel(html));
    expect(panel).toContain("Charizard faints from recoil.");
    expect(panel).toContain("Blastoise: 50–59 damage (32.47–38.31% of max HP) · KO chance 0%");
    expect(panel).toContain("Charizard HP remaining: 0 / 153, KO chance 100%.");
  });

  it("names a hit count chosen in the move settings, as the 1v1 card does", () => {
    const chosen = text(turnPanel(summary(fixture({ actions: CHOSEN_HITS_ACTIONS, rules: CHOSEN_HITS_RULES, contexts: CHOSEN_HITS_CONTEXTS, turn: CHOSEN_HITS }))));
    expect(chosen).toContain("Blastoise: 78–96 damage (50.65–62.34% of max HP), 3 hits · KO chance 0%");
    // Without the chosen count the row's count is not named (the engine's random count gives hitChances, a range).
    const unchosen = text(turnPanel(summary(fixture({ actions: CHOSEN_HITS_ACTIONS, rules: CHOSEN_HITS_RULES, turn: CHOSEN_HITS }))));
    expect(unchosen).toContain("Blastoise: 78–96 damage (50.65–62.34% of max HP) · KO chance 0%");
    const start = text(turnPanel(summary(fixture({ actions: CHOSEN_HITS_ACTIONS, rules: CHOSEN_HITS_RULES, contexts: CHOSEN_HITS_CONTEXTS, turn: CHOSEN_HITS_NOT_ESTIMATED }))));
    expect(start).toContain("Bullet Seed · Venusaur →  targets Blastoise: 78–96 damage (50.65–62.34% of max HP), 3 hits");
    // A Z-Move or Max Move is converted: its count is not the one chosen.
    const dynamax = fixture({ actions: CHOSEN_HITS_ACTIONS, rules: CHOSEN_HITS_RULES, contexts: CHOSEN_HITS_CONTEXTS, turn: CHOSEN_HITS });
    const venusaur = dynamax.cards["own-right"];
    dynamax.cards["own-right"] = { ...venusaur, slot: { ...venusaur.slot, build: { ...venusaur.slot.build, mechanic: "dynamax" } } };
    expect(text(turnPanel(summary(dynamax)))).not.toContain("3 hits");
  });
});

describe("2v2 summary callbacks", () => {
  it("sends the current owner for quick moves, No move, All moves, targets and Show move", () => {
    const view = doubleTarget();
    view.cards["own-left"] = { ...view.cards["own-left"], slot: { ...view.cards["own-left"].slot, moveEpoch: 3 } };
    const props = summaryProps(view);
    const { buttons, inputs } = capture(() => renderToStaticMarkup(createElement(DoublesSummary, props)));
    const owner = getMoveOwner(view.cards["own-left"].slot);
    expect(owner).toEqual({ key: 0, epoch: 3 });
    click(buttons.find((button) => button["data-move-owner"] === "0:3" && button["data-move-slot"] === 2)!);
    expect(props.onActivateMove).toHaveBeenCalledWith(owner, 2);
    click(buttons.find((button) => button["data-doubles-no-move"] === "own-left")!);
    expect(props.onChooseMove).toHaveBeenCalledWith(owner, null);
    click(buttons.find((button) => button["data-doubles-all-moves"] === "own-left")!);
    expect(props.onShowMoves).toHaveBeenCalledWith(owner);
    change(inputs.find((input) => input.type === "radio" && String(input.name).endsWith("-target") && input.value === "opponent-right")!);
    expect(props.onTargetChange).toHaveBeenCalledWith(owner, "opponent-right");
    const show = buttons.filter((button) => button["aria-controls"] === "moves-list" && button["data-move-owner"] === undefined && button["data-doubles-all-moves"] === undefined);
    expect(show).toHaveLength(4);
    click(show[1]);
    expect(props.onShowStep).toHaveBeenCalledWith(owner, "weatherball");
    change(inputs.find((input) => input.type === "radio" && input.value === "high")!);
    expect(props.onRollModeChange).toHaveBeenCalledWith("high");
  });

  it("lets the cards the aimed move can hit pick its target", () => {
    const view = doubleTarget();
    // Nothing aimed yet: no frames, the cards as before.
    expect(summary(view)).not.toContain("data-doubles-card-pick");
    const props = summaryProps(view, { defaultAiming: "own-left" });
    const { html, buttons } = capture(() => renderToStaticMarkup(createElement(DoublesSummary, props)));
    const picks = buttons.filter((button) => button["data-doubles-card-pick"]);
    // Weather Ball from your left: both foes and the ally; the picked one is the left foe.
    expect(picks.map((button) => button["data-doubles-card-pick"])).toEqual(["own-right", "opponent-left", "opponent-right"]);
    const left = picks.find((button) => button["data-doubles-card-pick"] === "opponent-left")!;
    expect(left["aria-pressed"]).toBe(true);
    expect(left["aria-label"]).toBe(`Target ${view.names["opponent-left"]} with ${view.names["own-left"]}'s Weather Ball`);
    expect(left["aria-label"]).toBe("Target Blastoise with Charizard's Weather Ball");
    expect(html).toContain(`data-doubles-card-chip="true" class="wrap-anywhere text-xs font-semibold text-accent-text">Target of ${view.names["own-left"]}&#x27;s Weather Ball</p>`);
    expect(html.match(/data-doubles-card-target="eligible"/g)).toHaveLength(2);
    click(picks.find((button) => button["data-doubles-card-pick"] === "opponent-right")!);
    expect(props.onTargetChange).toHaveBeenCalledWith(getMoveOwner(view.cards["own-left"].slot), "opponent-right");
    // A move with its own targets (the opponent's left Water Spout) gives no frames.
    expect(summary(view, { defaultAiming: "opponent-left" })).not.toContain("data-doubles-card-pick");
    expect(visibleText(html)).not.toMatch(/Click|Choose a|to see|browse|Select a/);
    expect(positionalIn(html)).toEqual([]);
  });

  it("states facts only", () => {
    const tutorial = /Click|Choose a|to see|browse|Select a/;
    for (const view of [fixture(), doubleTarget(), uncertain(), notEstimated()]) {
      expect(visibleText(summary(view))).not.toMatch(tutorial);
      expect(positionalIn(summary(view))).toEqual([]);
    }
    expect(visibleText(summary(doubleTarget(), { blockedReason: "HP preview paused while the calculator loads." }))).not.toMatch(tutorial);
  });
});

describe("2v2 settings and Moves pane", () => {
  const view = doubleTarget();
  const slots = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, view.cards[slot].slot])) as Record<DoublesSlotId, ReturnType<typeof combatant>>;
  const settingsProps = (overrides: Partial<ComponentProps<typeof DoublesSettings>> = {}): ComponentProps<typeof DoublesSettings> => ({
    runtime: championsRuntime, names: view.names, slots,
    issues: { "own-left": [], "own-right": [{ field: "nature", message: "Nature is invalid." }], "opponent-left": [], "opponent-right": [] }, fieldIssues: [],
    builds: Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, { id: `build-${slot}`, open: slot === "own-right", onToggle: vi.fn() }])) as unknown as ComponentProps<typeof DoublesSettings>["builds"],
    field: { id: "field-2v2", open: true, onToggle: vi.fn() },
    renderEditor: (slot) => createElement("p", { "data-editor": slot }, `Editor ${slot}`),
    conditions: { ...createConditions(), critical: true }, onConditionsChange: vi.fn(),
    charged: { "own-left": true, "own-right": false, "opponent-left": false, "opponent-right": false }, onChargedChange: vi.fn(),
    ...overrides,
  });

  it("gives each slot its Build settings, then one Field conditions", () => {
    const props = settingsProps();
    const { html, buttons, inputs } = capture(() => renderToStaticMarkup(createElement(DoublesSettings, props)));
    expect(html).toMatch(/^<div data-doubles-settings="true" class="[^"]*doublesSettings/);
    expect([...html.matchAll(/data-build-toggle="([^"]+)" aria-expanded="(true|false)" aria-controls="([^"]+)"/g)].map((match) => [match[1], match[2], match[3]])).toEqual([
      ["own-left", "false", "build-own-left"], ["own-right", "true", "build-own-right"], ["opponent-left", "false", "build-opponent-left"], ["opponent-right", "false", "build-opponent-right"],
    ]);
    expect(text(html)).toContain("Build settingsCharizard");
    expect(text(html)).toContain("Build settingsPikachu");
    expect(positionalIn(html)).toEqual([]);
    expect(text(html)).toContain(", 1 setting to check");
    expect([...html.matchAll(/data-editor="([^"]+)"/g)].map((match) => match[1])).toEqual(DOUBLES_SLOTS);
    expect(html.match(/data-field-toggle="true" aria-expanded="true" aria-controls="field-2v2"/)).not.toBeNull();
    expect(text(html)).toContain("Field conditionsDoubles · No weather · No terrain · 2 toggles on");
    expect(html).toMatch(/<legend class="px-1 text-xs font-semibold text-text">Your side<\/legend>[\s\S]*Charge: Charizard[\s\S]*Charge: Venusaur[\s\S]*<legend class="px-1 text-xs font-semibold text-text">Opponent&#x27;s side<\/legend>[\s\S]*Charge: Blastoise[\s\S]*Charge: Pikachu/);
    expect(html).toMatch(/data-doubles-charge="own-left"[^>]*checked=""/);
    change(inputs.find((input) => input["data-doubles-charge"] === "opponent-left")!);
    expect(props.onChargedChange).toHaveBeenCalledWith("opponent-left", true);
    click(buttons.find((button) => button["data-build-toggle"] === "opponent-left")!);
    expect(props.builds["opponent-left"].onToggle).toHaveBeenCalledOnce();
    assertControlLabels(html);
  });

  it("chooses whose moves the pane lists and which Pokémon they are into", () => {
    const onFocusChange = vi.fn();
    const onIntoChange = vi.fn();
    const props = { names: view.names, focus: "own-right", into: "opponent-right", onFocusChange, onIntoChange } as unknown as ComponentProps<typeof DoublesMoves>;
    const { html, inputs } = capture(() => renderToStaticMarkup(createElement(DoublesMoves, props, createElement("section", { id: "moves-list" }, "List"))));
    expect(html).toMatch(/^<div data-doubles-moves="true"/);
    expect(html).toMatch(/<legend[^>]*>Moves for<\/legend>/);
    expect(html).toMatch(/<legend[^>]*>Damage into<\/legend>/);
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios.map((tag) => [/name="[^"]+-for"/.test(tag) ? "for" : "into", tag.match(/value="([^"]+)"/)?.[1], /checked=""/.test(tag)])).toEqual([
      ["for", "own-left", false], ["for", "own-right", true], ["for", "opponent-left", false], ["for", "opponent-right", false],
      ["into", "opponent-left", false], ["into", "opponent-right", true], ["into", "own-left", false],
    ]);
    // Each radio is the Pokémon's name, with no place beside it.
    const labels = (kind: string) => [...html.matchAll(new RegExp(`<label[^>]*for="[^"]+-${kind}-[^"]+"[^>]*>([\\s\\S]*?)</label>`, "g"))].map((match) => text(match[1]));
    expect(labels("for")).toEqual(["Charizard", "Venusaur", "Blastoise", "Pikachu"]);
    expect(labels("into")).toEqual(["Blastoise", "Pikachu", "Charizard"]);
    for (const label of [...labels("for"), ...labels("into")]) expect(label).not.toMatch(/ · your|foe ·/);
    expect(text(html)).toContain("Damage at the start of the turn, before any move.");
    expect(html).toContain('<section id="moves-list">List</section>');
    change(inputs.find((input) => input.value === "opponent-left" && String(input.name).endsWith("-for"))!);
    expect(onFocusChange).toHaveBeenCalledWith("opponent-left");
    change(inputs.find((input) => input.value === "own-left" && String(input.name).endsWith("-into"))!);
    expect(onIntoChange).toHaveBeenCalledWith("own-left");
    assertControlLabels(html);
    expect(visibleText(html)).not.toMatch(/Click|Choose a|to see|browse|Select a/);
    expect(positionalIn(html)).toEqual([]);
  });
});

// ---------- Status moves and end of turn (status-eot SPEC §5, ADDENDUM §5) ----------

const MINUS = "−";

function eotRow(moveId: string, min: number, max: number, maximum: number, overrides: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return {
    moveId, kind: "calculated", min, max, minPercent: Math.round(min / maximum * 10000) / 100, maxPercent: Math.round(max / maximum * 10000) / 100,
    rolls: null, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1, ...overrides,
  };
}

function record(start: number, maximum: number, rest: Partial<DoublesHP> = {}): DoublesHP {
  return { start, maximum, low: start, average: start, high: start, min: start, max: start, koChance: 0, heals: [], ...rest };
}

function effectHit(slot: DoublesSlotId, facts: DoublesHit["facts"], rest: Partial<DoublesHit> = {}): DoublesHit {
  return { slot, reached: 1, kind: "effect", min: null, max: null, minPercent: null, maxPercent: null, koChance: 0, cases: 0, facts, ...rest };
}

function eotStep(slot: DoublesSlotId, moveId: string, position: number, hits: DoublesHit[], rest: Partial<DoublesStep> = {}): DoublesStep {
  return { slot, moveId, order: [{ position, chance: 1 }], moves: 1, skipped: [], hits, facts: [], ...rest };
}

const SAND_FACT = "Assumes the Sandstorm does not end this turn.";
const HIT_FACT = "Every move hits; no critical hits; added effects below 100% do not happen.";

/**
 * In sand: Pikachu's Thunder Wave paralyses Charizard, whose Heat Wave (12.5% fully paralysed) meets Blastoise's
 * Substitute from an earlier turn and hits Pikachu; Venusaur's Leech Seed seeds Pikachu; Blastoise, confused, uses No move.
 * The end of turn: sand, Leech Seed between Pikachu and Venusaur, Pikachu's Toxic Orb. The numbers are fixtures.
 */
const EOT_ACTIONS = {
  "own-left": { moveId: "heatwave", target: null },
  "own-right": { moveId: "leechseed", target: "opponent-right" },
  "opponent-right": { moveId: "thunderwave", target: "own-left" },
} as const;
const EOT_RULES = { "own-left": RULES.ownSpreadFoes, "own-right": RULES.ownRightSingle, "opponent-right": RULES.opponentSingle };
const EOT_START = { "own-left": { hp: 153, maximum: 153 }, "own-right": { hp: 155, maximum: 155 }, "opponent-left": { hp: 154, maximum: 154 }, "opponent-right": { hp: 110, maximum: 110 } };
const EOT_MOVES_HP: Record<DoublesSlotId, DoublesHP> = {
  "own-left": record(153, 153, { conditions: [{ text: "Paralysed.", chance: 1 }] }),
  "own-right": record(155, 155),
  "opponent-left": record(154, 154, {
    low: 154, average: 145.585, high: 154, min: 126, max: 154,
    losses: [{ text: "Blastoise hurts itself in confusion: 23–28 HP.", chance: 0.33 }],
    conditions: [{ text: "Confused.", chance: 1 }, { text: "Substitute: 7 HP.", chance: 0.4375 }, { text: "Substitute: 12 HP.", chance: 0.4375 }, { text: "Substitute: 38 HP.", chance: 0.125 }],
  }),
  "opponent-right": record(110, 110, { low: 40, average: 45.5, high: 27, min: 27, max: 110, conditions: [{ text: "Leech Seed.", chance: 1 }] }),
};
const EOT_TURN_HP: Record<DoublesSlotId, DoublesHP> = {
  "own-left": { ...EOT_MOVES_HP["own-left"], low: 144, average: 144, high: 144, min: 144, max: 144 },
  "own-right": { ...EOT_MOVES_HP["own-right"], low: 155, average: 155, high: 155, min: 155, max: 155 },
  "opponent-left": { ...EOT_MOVES_HP["opponent-left"], low: 145, average: 136.585, high: 145, min: 117, max: 145 },
  "opponent-right": {
    ...EOT_MOVES_HP["opponent-right"], low: 21, average: 26.5, high: 8, min: 0, max: 91, koChance: 0.0625,
    conditions: [{ text: "Leech Seed.", chance: 1 }, { text: "Badly poisoned.", chance: 0.9375 }],
  },
};
const EOT_RESIDUALS: DoublesResidual[] = [
  { slot: "own-left", effect: "Sandstorm", chance: 1, min: -9, max: -9, koChance: 0, facts: [] },
  { slot: "opponent-left", effect: "Sandstorm", chance: 1, min: -9, max: -9, koChance: 0, facts: [] },
  { slot: "opponent-right", effect: "Sandstorm", chance: 1, min: -6, max: -6, koChance: 0, facts: [] },
  { slot: "opponent-right", effect: "Leech Seed", other: "own-right", chance: 1, min: -13, max: -13, koChance: 0.0625, facts: [] },
  { slot: "own-right", effect: "Leech Seed", other: "opponent-right", chance: 1, min: 8, max: 13, koChance: 0, facts: [] },
  { slot: "opponent-right", effect: "Toxic Orb", chance: 0.9375, min: null, max: null, koChance: 0, facts: [{ text: "Badly poisoned.", chance: 0.9375 }] },
];
const EOT_STEPS: DoublesStep[] = [
  eotStep("opponent-right", "thunderwave", 1, [effectHit("own-left", [{ text: "Is paralysed.", chance: 1 }])]),
  eotStep("own-left", "heatwave", 2, [
    { slot: "opponent-left", reached: 0.875, kind: "substitute", min: null, max: null, minPercent: null, maxPercent: null, koChance: 0, row: eotRow("heatwave", 26, 31, 154), cases: 1,
      substitute: { chance: 0.875, min: 26, max: 31, breaks: 0 }, facts: [] },
    { slot: "opponent-right", reached: 0.875, kind: "calculated", min: 70, max: 83, minPercent: 63.64, maxPercent: 75.45, koChance: 0, row: eotRow("heatwave", 70, 83, 110), cases: 1, facts: [] },
  ], { moves: 0.875, skipped: [{ text: "Fully paralysed.", chance: 0.125 }] }),
  eotStep("own-right", "leechseed", 3, [effectHit("opponent-right", [{ text: "Is seeded.", chance: 1 }])]),
];
const EOT_READY: DoublesTurnResult = {
  status: "ready", start: EOT_START, steps: EOT_STEPS, hp: EOT_MOVES_HP, startRows: [], facts: [HIT_FACT, SAND_FACT],
  endOfTurn: { status: "ready", hp: EOT_TURN_HP, residuals: EOT_RESIDUALS, facts: [] },
};
const SWITCH_REASON = "Venusaur switches out: the replacement is not known.";
const EOT_NOT_ESTIMATED: DoublesTurnResult = { ...EOT_READY, endOfTurn: { status: "not-estimated", reason: SWITCH_REASON } };
const EOT_QUIET: DoublesTurnResult = { ...EOT_READY, endOfTurn: { status: "ready", hp: EOT_TURN_HP, residuals: [], facts: [] } };

/** The four cards as useDoublesView makes them: the HP after the turn when its end of turn is estimated (turnHP). */
function eotView(turn: DoublesTurnResult = EOT_READY) {
  const view = fixture({ actions: EOT_ACTIONS, rules: EOT_RULES, turn });
  const ready = turn.status === "ready" ? turn : null;
  const shown = ready ? turnHP(ready) : null;
  for (const slot of DOUBLES_SLOTS) view.cards[slot] = { ...view.cards[slot], hp: shown?.hp[slot] ?? null, afterTurn: !!shown?.afterTurn, reached: cardReached(ready, slot) };
  return view;
}

describe("2v2 status moves and end of turn: text (doubles-format)", () => {
  const names = eotView().names;

  it("signs HP changes with a true minus sign", () => {
    expect(hpChangeText(163, 163)).toBe("+163");
    expect(hpChangeText(-87, -87)).toBe(`${MINUS}87`);
    expect(hpChangeText(12, 20)).toBe("+12–20");
    expect(hpChangeText(-22, -11)).toBe(`${MINUS}11–22`);
    expect(hpChangeText(-30, 40)).toBe(`${MINUS}30 to +40`);
    expect(hpChangeText(0, 0)).toBe("0");
  });

  it("writes a status move's hits: what it did, its HP change, or no effect", () => {
    const paralysed = effectHit("own-left", [{ text: "Is paralysed.", chance: 1 }]);
    expect(hitLine(paralysed, names, false, true)).toBe("Charizard");
    expect(hitLine({ ...paralysed, reached: 0.5 }, names, false, true)).toBe("Charizard · reaches it 50%");
    expect(hitLine(effectHit("opponent-left", [], { change: { min: 77, max: 77 } }), names, false, true)).toBe("Blastoise: +77 HP");
    expect(hitLine(effectHit("own-right", [], { change: { min: -38, max: -38 } }), names, false, true)).toBe(`Venusaur: ${MINUS}38 HP`);
    expect(hitLine(effectHit("opponent-left", [], { change: { min: -24, max: 31 }, reached: 0.25 }), names, false, true)).toBe(`Blastoise: ${MINUS}24 to +31 HP · reaches it 25%`);
    const blocked: DoublesHit = { ...paralysed, kind: "no-damage", facts: [{ text: "Charizard is behind a Substitute.", chance: 1 }] };
    expect(hitLine(blocked, names, false, true)).toBe("Charizard: no effect");
    expect(hitLine({ ...blocked, kind: "blocked" }, names, false, true)).toBe("Charizard: no effect");
    // A damaging move that does nothing keeps its wording.
    expect(hitLine({ ...blocked, kind: "blocked" }, names)).toBe("Charizard: no damage");
  });

  it("writes hits into a Substitute: the HP it lost, its breaks and the hits that reached the Pokémon", () => {
    if (EOT_READY.status !== "ready") throw new Error("fixture");
    const [intoSub, pikachu] = EOT_READY.steps[1].hits;
    expect(hitLine(intoSub, names)).toBe(`Blastoise's Substitute: ${MINUS}26–31 HP · reaches it 87.5%`);
    expect(substituteLine(pikachu, names)).toBeNull();
    const broke: DoublesHit = { ...pikachu, slot: "opponent-left", min: 20, max: 48, substitute: { chance: 1, min: 38, max: 38, breaks: 0.5 } };
    expect(substituteLine(broke, names)).toBe(`Blastoise's Substitute: ${MINUS}38 HP, breaks 50%`);
    expect(hitLine(broke, names)).toMatch(/^Blastoise: 20–48 damage/);
  });

  it("writes each residual with its HP change, the other Pokémon, its share of the turn and its KO chance", () => {
    expect(EOT_RESIDUALS.map((residual) => residualLine(residual, names))).toEqual([
      `Sandstorm · Charizard: ${MINUS}9 HP`,
      `Sandstorm · Blastoise: ${MINUS}9 HP`,
      `Sandstorm · Pikachu: ${MINUS}6 HP`,
      `Leech Seed · Pikachu: ${MINUS}13 HP (from Venusaur), KO chance 6.25%`,
      "Leech Seed · Venusaur: +8–13 HP (from Pikachu)",
      "Toxic Orb · Pikachu (93.75%)",
    ]);
    expect(residualLine({ slot: "own-left", effect: "Bad poison", chance: 0.5, min: -19, max: -9, koChance: 0.125, facts: [] }, names)).toBe(`Bad poison · Charizard: ${MINUS}9–19 HP (50%), KO chance 12.5%`);
    expect(residualLine({ slot: "own-left", effect: "Healer", other: "own-right", chance: 0.3, min: null, max: null, koChance: 0, facts: [] }, names)).toBe("Healer · Charizard (from Venusaur) (30%)");
  });

  it("writes a card's conditions on one line, a Substitute's HP worlds as one range", () => {
    expect(conditionsLine(EOT_MOVES_HP["opponent-left"].conditions!)).toBe("Confused · Substitute: 7–38 HP");
    expect(conditionsLine([{ text: "Paralysed.", chance: 1 }, { text: "Confused.", chance: 0.67 }])).toBe("Paralysed · Confused (67%)");
    expect(conditionsLine([{ text: "Substitute: 15 HP.", chance: 0.25 }, { text: "Substitute: 19 HP.", chance: 0.25 }, { text: "Swapped places with Venusaur.", chance: 0.5 }]))
      .toBe("Substitute: 15–19 HP (50%) · Swapped places with Venusaur (50%)");
    expect(conditionsLine([{ text: "Holds Choice Scarf.", chance: 1 }, { text: "Substitute: 35 HP.", chance: 1 }])).toBe("Holds Choice Scarf · Substitute: 35 HP");
  });

  it("labels the HP after the turn or after the moves, and summarises it for screen readers", () => {
    expect(cardHPLabel(true, "average", undefined, true)).toBe("After the turn · Average estimate");
    expect(cardHPLabel(true, "low", undefined, false)).toBe("After the moves · Low roll");
    expect(cardHPLabel(false, "average", undefined, true)).toBe("Current HP");
    if (EOT_READY.status !== "ready" || EOT_NOT_ESTIMATED.status !== "ready") throw new Error("fixture");
    expect(turnHP(EOT_READY)).toEqual({ hp: EOT_TURN_HP, afterTurn: true });
    expect(turnHP(EOT_NOT_ESTIMATED)).toEqual({ hp: EOT_MOVES_HP, afterTurn: false });
    expect(turnSummary(EOT_READY, names, "average")).toBe("Charizard HP remaining: 144 / 153. Venusaur HP remaining: 155 / 155. Blastoise HP remaining: 137 / 154. Pikachu HP remaining: 26 / 110, KO chance 6.25%.");
    expect(turnSummary(EOT_NOT_ESTIMATED, names, "average")).toBe(`Charizard HP remaining: 153 / 153. Venusaur HP remaining: 155 / 155. Blastoise HP remaining: 146 / 154. Pikachu HP remaining: 45 / 110. End of turn not estimated: ${SWITCH_REASON}`);
  });

  it("shows the KO chance of a Pokémon a residual takes HP from", () => {
    if (EOT_READY.status !== "ready") throw new Error("fixture");
    const quiet = { ...EOT_READY, steps: [] };
    // Sand reaches Charizard and Blastoise without a step; Venusaur only gains HP.
    expect(DOUBLES_SLOTS.map((slot) => cardReached(quiet, slot))).toEqual([true, false, true, true]);
    expect(DOUBLES_SLOTS.map((slot) => cardReached({ ...quiet, endOfTurn: { status: "not-estimated", reason: SWITCH_REASON } }, slot))).toEqual([false, false, false, false]);
  });
});

describe("2v2 status moves and end of turn: cards and turn panel", () => {
  it("shows each card's HP after the turn with its conditions", () => {
    const html = summary(eotView());
    const charizard = card(html, "own-left");
    expect(text(charizard)).toContain("After the turn · Average estimate");
    expect(charizard).toContain('aria-valuetext="144 of 153 HP after the turn, Average estimate. KO chance: 0%. Turn start HP: 153."');
    expect(charizard).toMatch(/<p data-doubles-conditions="own-left" class="[^"]*wrap-anywhere[^"]*text-muted[^"]*">Paralysed<\/p>/);
    expect(text(card(html, "opponent-left"))).toContain("Confused · Substitute: 7–38 HP");
    expect(text(card(html, "opponent-right"))).toContain("Leech Seed · Badly poisoned (93.75%)");
    expect(text(card(html, "opponent-right"))).toContain("KO chance: 6.25%");
    // Venusaur has no condition, so no line.
    expect(card(html, "own-right")).not.toContain("data-doubles-conditions");
    // The conditions line sits under the HP bar.
    expect(charizard.indexOf("data-doubles-conditions")).toBeGreaterThan(charizard.indexOf('role="meter"'));
  });

  it("shows HP after the moves when the end of turn is not estimated", () => {
    const html = summary(eotView(EOT_NOT_ESTIMATED));
    const charizard = card(html, "own-left");
    expect(text(charizard)).toContain("After the moves · Average estimate");
    expect(text(charizard)).not.toContain("After the turn");
    // Only Thunder Wave reaches Charizard before the end of turn (not estimated here): no KO chance to show.
    expect(charizard).toContain('aria-valuetext="153 of 153 HP after the moves, Average estimate. Turn start HP: 153."');
    expect(text(card(html, "opponent-right"))).toContain("Leech Seed");
    expect(text(card(html, "opponent-right"))).not.toContain("Badly poisoned");
  });

  it("lists the status moves' hits, the HP lost outside the moves, then the end of turn and the turn facts", () => {
    const panel = turnPanel(summary(eotView()));
    const steps = text(panel);
    expect(steps).toContain("1 · Thunder Wave · Pikachu →  targets Charizard");
    expect([...panel.matchAll(/<li data-doubles-hit="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => [match[1], text(match[2])])).toEqual([
      ["own-left", "CharizardIs paralysed."],
      ["opponent-left", `Blastoise's Substitute: ${MINUS}26–31 HP · reaches it 87.5%`],
      ["opponent-right", "Pikachu: 70–83 damage (63.64–75.45% of max HP) · KO chance 0% · reaches it 87.5%"],
      ["opponent-right", "PikachuIs seeded."],
    ]);
    expect(steps).toContain("Fully paralysed (12.5%).");
    expect(panel).toMatch(/<li data-doubles-loss="opponent-left" class="wrap-anywhere">Blastoise hurts itself in confusion: 23–28 HP \(33%\)\.<\/li>/);
    const end = panel.slice(panel.indexOf("data-doubles-end"));
    expect(end).toMatch(/^data-doubles-end="true"[^>]*><h4 id="([^"]+)"[^>]*>End of turn<\/h4><ul aria-labelledby="\1"/);
    expect([...end.matchAll(/<li data-doubles-residual="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => [match[1], text(match[2])])).toEqual([
      ["own-left", `Sandstorm · Charizard: ${MINUS}9 HP`],
      ["opponent-left", `Sandstorm · Blastoise: ${MINUS}9 HP`],
      ["opponent-right", `Sandstorm · Pikachu: ${MINUS}6 HP`],
      ["opponent-right", `Leech Seed · Pikachu: ${MINUS}13 HP (from Venusaur), KO chance 6.25%`],
      ["own-right", "Leech Seed · Venusaur: +8–13 HP (from Pikachu)"],
      ["opponent-right", "Toxic Orb · Pikachu (93.75%)Badly poisoned (93.75%)."],
    ]);
    // Steps, the HP lost outside them, the end of turn, then the turn facts.
    const at = (needle: string) => panel.indexOf(needle);
    expect(at("data-doubles-step")).toBeLessThan(at("data-doubles-loss"));
    expect(at("data-doubles-loss")).toBeLessThan(at("data-doubles-end"));
    expect(at("data-doubles-end")).toBeLessThan(at('aria-label="Turn facts"'));
    expect(steps).toContain(SAND_FACT);
    expect(panel).not.toContain("data-doubles-end-not-estimated");
    expect(steps).not.toContain("End-of-turn effects are not applied.");
    expect(panel).toMatch(/<p data-doubles-live="true"[^>]*>Charizard HP remaining: 144 \/ 153\. Venusaur HP remaining: 155 \/ 155\. Blastoise HP remaining: 137 \/ 154\. Pikachu HP remaining: 26 \/ 110, KO chance 6\.25%\.<\/p>/);
  });

  it("lists the end of turn's own facts", () => {
    if (EOT_READY.status !== "ready" || EOT_READY.endOfTurn.status !== "ready") throw new Error("fixture");
    const turn: DoublesTurnResult = { ...EOT_READY, endOfTurn: { ...EOT_READY.endOfTurn, residuals: [], facts: ["Garchomp switches out after the turn."] } };
    const end = turnPanel(summary(eotView(turn)));
    expect(end).toMatch(/data-doubles-end="true"[^>]*><h4[^>]*>End of turn<\/h4><ul aria-label="End-of-turn facts"[^>]*><li class="wrap-anywhere">Garchomp switches out after the turn\.<\/li><\/ul>/);
  });

  it("says why the end of turn is not estimated, and shows no end-of-turn section without residuals", () => {
    const panel = turnPanel(summary(eotView(EOT_NOT_ESTIMATED)));
    expect(panel).toMatch(new RegExp(`<p data-doubles-end-not-estimated="true" class="[^"]*wrap-anywhere[^"]*">End of turn not estimated: ${SWITCH_REASON}</p>`));
    expect(panel).not.toContain("data-doubles-end=");
    expect(panel.indexOf("data-doubles-end-not-estimated")).toBeLessThan(panel.indexOf('aria-label="Turn facts"'));
    const quiet = turnPanel(summary(eotView(EOT_QUIET)));
    expect(quiet).not.toContain("data-doubles-end");
    expect(text(card(summary(eotView(EOT_QUIET)), "own-left"))).toContain("After the turn · Average estimate");
  });

  it("shows an end of turn that acts when no Pokémon chose a move (sand); none acting: No moves chosen", () => {
    const moves = { "own-left": record(153, 153), "own-right": record(155, 155), "opponent-left": record(154, 154), "opponent-right": record(110, 110) };
    const sanded = { ...moves, "own-left": { ...moves["own-left"], low: 144, average: 144, high: 144, min: 144, max: 144 } };
    const sand: DoublesTurnResult = {
      status: "ready", start: EOT_START, steps: [], hp: moves, startRows: [], facts: [HIT_FACT, SAND_FACT],
      endOfTurn: { status: "ready", hp: sanded, residuals: [EOT_RESIDUALS[0]], facts: [] },
    };
    const view = (turn: DoublesTurnResult) => {
      const shown = turnHP(turn as Extract<DoublesTurnResult, { status: "ready" }>);
      const base = fixture({ turn });
      for (const slot of DOUBLES_SLOTS) base.cards[slot] = { ...base.cards[slot], hp: shown.hp[slot], afterTurn: shown.afterTurn, reached: cardReached(turn as Extract<DoublesTurnResult, { status: "ready" }>, slot) };
      return base;
    };
    const html = summary(view(sand));
    expect(text(turnPanel(html))).toContain(`Sandstorm · Charizard: ${MINUS}9 HP`);
    expect(text(turnPanel(html))).not.toContain("No moves chosen.");
    expect(text(card(html, "own-left"))).toContain("After the turn · Average estimate");
    const quiet = summary(view({ ...sand, endOfTurn: { status: "ready", hp: moves, residuals: [], facts: [] } }));
    expect(text(turnPanel(quiet))).toContain("No moves chosen.");
    expect(card(quiet, "own-left")).not.toContain("After the turn");
  });

  it("writes a calculated hit that also met a Substitute as two lines", () => {
    if (EOT_READY.status !== "ready") throw new Error("fixture");
    const [, pikachu] = EOT_READY.steps[1].hits;
    const broke: DoublesHit = { ...pikachu, substitute: { chance: 0.875, min: 21, max: 21, breaks: 0.875 }, facts: [{ text: "Its Substitute breaks.", chance: 0.875 }] };
    const turn: DoublesTurnResult = { ...EOT_READY, steps: [EOT_READY.steps[0], { ...EOT_READY.steps[1], hits: [EOT_READY.steps[1].hits[0], broke] }, EOT_READY.steps[2]] };
    const panel = turnPanel(summary(eotView(turn)));
    const line = panel.match(/<li data-doubles-hit="opponent-right"[^>]*>([\s\S]*?)<\/li>/)![1];
    expect(line).toMatch(new RegExp(`^<span data-doubles-substitute-hit="opponent-right" class="block">Pikachu&#x27;s Substitute: ${MINUS}21 HP, breaks 87.5% · reaches it 87.5%</span>Pikachu: 70–83 damage`));
    expect(text(line)).toContain("Its Substitute breaks (87.5%).");
  });

  it("states facts only, with names, at a phone's width", () => {
    const tutorial = /Click|Choose a|to see|browse|Select a/;
    for (const turn of [EOT_READY, EOT_NOT_ESTIMATED, EOT_QUIET]) {
      const html = summary(eotView(turn));
      expect(visibleText(html)).not.toMatch(tutorial);
      expect(visibleText(turnPanel(html))).not.toMatch(/\b(left|right) Pokémon\b/);
      expect(positionalIn(html)).toEqual([]);
      // Every new line wraps instead of widening the page at 375 px.
      for (const [, tag] of html.matchAll(/<(?:p|li)\b([^>]*data-doubles-(?:conditions|loss|residual|end-not-estimated)[^>]*)>/g)) expect(tag).toContain("wrap-anywhere");
      assertControlLabels(html, ["moves-list"]);
    }
  });
});

// ---------- State from earlier turns: Field conditions controls and their state (status-eot SPEC §5, ADDENDUM §5) ----------

const select = (target: { onChange?: unknown }, value: string) => (target.onChange as (event: ChangeEvent<HTMLSelectElement>) => void)({ target: { value } } as ChangeEvent<HTMLSelectElement>);
const tick = (input: { onChange?: unknown }, checked: boolean) => (input.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { checked } } as ChangeEvent<HTMLInputElement>);
const enter = (input: { onChange?: unknown }, value: string) => (input.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { value } } as ChangeEvent<HTMLInputElement>);

/** The four controls as useDoublesView builds them (doubles-prep carriedOptions), for the builds and carried state given. */
function carriedControlsFor(runtime: BattleRuntime, builds: Record<DoublesSlotId, BattleBuild>, names: Record<DoublesSlotId, string>,
  carried: Partial<Record<DoublesSlotId, DoublesCarried>> = {}, onChange: (slot: DoublesSlotId, carried: DoublesCarried) => void = () => undefined,
  issues: Partial<Record<DoublesSlotId, CarriedControl["issues"]>> = {}): CarriedControl[] {
  return DOUBLES_SLOTS.map((slot) => {
    const value = carried[slot] ?? {};
    return {
      slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], value, issues: issues[slot],
      options: builds[slot].currentHP === 0 ? NO_CARRIED_OPTIONS : carriedOptions(builds[slot], runtime, !!value.sleep?.rest),
      onChange: (next) => onChange(slot, next),
    };
  });
}

/** One Pokémon's block of controls (data-doubles-carried). */
function carriedBlock(html: string, slot: DoublesSlotId) {
  const start = html.indexOf(`data-doubles-carried="${slot}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.slice(1).search(/data-doubles-carried="|<\/fieldset>/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

const optionValues = (html: string, attribute: string) => {
  const tag = html.match(new RegExp(`<select[^>]*${attribute}[^>]*>([\\s\\S]*?)</select>`));
  return tag ? [...tag[1].matchAll(/<option value="(\d+)"/g)].map((match) => Number(match[1])) : null;
};

describe("2v2 state from earlier turns (Field conditions)", () => {
  const view = doubleTarget();
  const builds = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, view.cards[slot].slot.build])) as Record<DoublesSlotId, BattleBuild>;
  const slots = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, view.cards[slot].slot])) as Record<DoublesSlotId, ReturnType<typeof combatant>>;
  const settings = (controls: readonly CarriedControl[], charged: Partial<Record<DoublesSlotId, boolean>> = {}) => createElement(DoublesCarriedContext.Provider, { value: controls },
    createElement(DoublesSettings, {
      runtime: championsRuntime, names: view.names, slots,
      issues: { "own-left": [], "own-right": [], "opponent-left": [], "opponent-right": [] }, fieldIssues: [],
      builds: Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, { id: `build-${slot}`, open: false, onToggle: vi.fn() }])) as unknown as ComponentProps<typeof DoublesSettings>["builds"],
      field: { id: "field-2v2", open: true, onToggle: vi.fn() },
      renderEditor: (slot) => createElement("p", { "data-editor": slot }, `Editor ${slot}`),
      conditions: createConditions(), onConditionsChange: vi.fn(),
      charged: { "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": false, ...charged }, onChargedChange: vi.fn(),
    }));

  it("groups each Pokémon's Charge, Confused and Substitute under its name, in its side's fieldset", () => {
    const onChange = vi.fn();
    const { html, inputs } = capture(() => renderToStaticMarkup(settings(carriedControlsFor(championsRuntime, builds, view.names, {}, onChange), { "own-left": true })));
    const yours = html.slice(html.indexOf(">Your side</legend>"), html.indexOf(">Opponent&#x27;s side</legend>"));
    expect([...yours.matchAll(/data-doubles-carried="([^"]+)"/g)].map((match) => match[1])).toEqual(["own-left", "own-right"]);
    const charizard = carriedBlock(html, "own-left");
    expect(html).toMatch(/<div role="group" aria-labelledby="([^"]+)" data-doubles-carried="own-left"[^>]*><p id="\1"[^>]*>Charizard<\/p>/);
    expect(text(charizard)).toContain("Charge: Charizard");
    expect(text(charizard)).toContain("Confused: Charizard");
    expect(text(charizard)).toContain("Substitute: Charizard");
    expect(visibleText(charizard)).not.toContain("Charge: Charizard");
    expect(charizard).toMatch(/data-doubles-charge="own-left"[^>]*checked=""/);
    // No status: no counts.
    expect(charizard).not.toContain("<select");
    expect(text(charizard)).not.toMatch(/Turns lost|Bad poison|Rest sleep|Substitute HP/);
    // The Charge stays a single checkbox per Pokémon: none is left among the side's toggles.
    expect(html.match(/data-doubles-charge=/g)).toHaveLength(4);
    tick(inputs.find((input) => input["data-doubles-confused"] === "opponent-left")!, true);
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { confusion: { attempts: 0 } });
    const quarter = Math.floor(getBuildStats(builds["opponent-right"], championsRuntime)!.hp / 4);
    tick(inputs.find((input) => input["data-doubles-substitute"] === "opponent-right")!, true);
    expect(onChange).toHaveBeenLastCalledWith("opponent-right", { substitute: quarter });
    assertControlLabels(html);
    expect(visibleText(html)).not.toMatch(/Click|Choose a|to see|browse|Select a|\b(left|right) Pokémon\b/);
    expect(positionalIn(html)).toEqual([]);
  });

  it("shows the counts that apply to each Pokémon's status, bounded to what the game allows", () => {
    const status = (slot: DoublesSlotId, value: BattleBuild["status"], abilityId?: string) => ({ ...builds[slot], status: value, ...(abilityId ? { abilityId } : {}) });
    const asleep = { ...builds, "own-left": status("own-left", "slp"), "own-right": status("own-right", "frz"), "opponent-left": status("opponent-left", "tox"), "opponent-right": status("opponent-right", "slp", "earlybird") };
    const onChange = vi.fn();
    const controls = carriedControlsFor(championsRuntime, asleep, view.names, { "own-left": { sleep: { attempts: 1, rest: false } }, "opponent-left": { toxic: 3, confusion: { attempts: 2 } } }, onChange);
    const { html, inputs, selects } = capture(() => renderToStaticMarkup(settings(controls)));
    const charizard = carriedBlock(html, "own-left");
    // Champions: a sleep lasts 2 or 3 turns.
    expect(text(charizard)).toContain("Turns lost to sleep: Charizard");
    expect(optionValues(charizard, "data-doubles-sleep")).toEqual([0, 1, 2]);
    expect(charizard).toMatch(/<option value="1" selected="">1<\/option>/);
    expect(text(charizard)).toContain("Rest sleep: Charizard");
    // Champions freeze: at most 2 turns before it thaws.
    expect(optionValues(carriedBlock(html, "own-right"), "data-doubles-freeze")).toEqual([0, 1, 2]);
    expect(text(carriedBlock(html, "own-right"))).toContain("Turns lost to freeze: Venusaur");
    const blastoise = carriedBlock(html, "opponent-left");
    expect(optionValues(blastoise, "data-doubles-toxic")).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(optionValues(blastoise, "data-doubles-confusion-turns")).toEqual([0, 1, 2, 3, 4]);
    expect(text(blastoise)).toContain("Bad poison turns so far: Blastoise");
    expect(text(blastoise)).toContain("Confusion turns so far: Blastoise");
    // Early Bird counts each turn asleep twice.
    expect(optionValues(carriedBlock(html, "opponent-right"), "data-doubles-sleep")).toEqual([0, 1]);
    select(selects.find((entry) => entry["data-doubles-sleep"] === "own-left")!, "2");
    expect(onChange).toHaveBeenLastCalledWith("own-left", { sleep: { attempts: 2, rest: false } });
    // Back to 0: the turn's assumption, so nothing is carried.
    select(selects.find((entry) => entry["data-doubles-sleep"] === "own-left")!, "0");
    expect(onChange).toHaveBeenLastCalledWith("own-left", {});
    tick(inputs.find((input) => input["data-doubles-rest"] === "own-left")!, true);
    expect(onChange).toHaveBeenLastCalledWith("own-left", { sleep: { attempts: 1, rest: true } });
    select(selects.find((entry) => entry["data-doubles-toxic"] === "opponent-left")!, "0");
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { confusion: { attempts: 2 } });
    select(selects.find((entry) => entry["data-doubles-confusion-turns"] === "opponent-left")!, "4");
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { toxic: 3, confusion: { attempts: 4 } });
    tick(inputs.find((input) => input["data-doubles-confused"] === "opponent-left")!, false);
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { toxic: 3 });
    select(selects.find((entry) => entry["data-doubles-freeze"] === "own-right")!, "2");
    expect(onChange).toHaveBeenLastCalledWith("own-right", { freeze: { attempts: 2 } });
    assertControlLabels(html);
  });

  it("asks Scarlet/Violet for up to 3 turns lost to sleep, 2 after Rest, and no freeze turns", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    const build = { ...createBuild("snorlax", runtime), status: "slp" as const };
    expect(sleepTurnsMax(build, runtime, false)).toBe(3);
    expect(sleepTurnsMax(build, runtime, true)).toBe(2);
    expect(sleepTurnsMax({ ...build, abilityId: "earlybird" }, runtime, false)).toBe(1);
    expect(sleepTurnsMax(build, championsRuntime, false)).toBe(2);
    expect(carriedOptions({ ...build, status: "frz" }, runtime, false).freeze).toBeNull();
    expect(carriedOptions(build, runtime, false)).toMatchObject({ sleep: { max: 3 }, freeze: null, toxic: false, confusion: true });
  });

  it("shows a Substitute's HP from 1 to a quarter of the maximum HP", () => {
    const onChange = vi.fn();
    const quarter = Math.floor(getBuildStats(builds["opponent-left"], championsRuntime)!.hp / 4);
    const { html, inputs } = capture(() => renderToStaticMarkup(settings(carriedControlsFor(championsRuntime, builds, view.names, { "opponent-left": { substitute: 20 } }, onChange))));
    const blastoise = carriedBlock(html, "opponent-left");
    expect(blastoise).toMatch(/data-doubles-substitute="opponent-left"[^>]*checked=""/);
    expect(text(blastoise)).toContain("Substitute HP: Blastoise");
    const field = inputs.find((input) => input["data-doubles-substitute-hp"] === "opponent-left")!;
    expect([field.min, field.max, field.value]).toEqual([1, quarter, "20"]);
    enter(field, "999");
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { substitute: quarter });
    enter(field, "0");
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", { substitute: 1 });
    tick(inputs.find((input) => input["data-doubles-substitute"] === "opponent-left")!, false);
    expect(onChange).toHaveBeenLastCalledWith("opponent-left", {});
    // A 1-HP Pokémon (Shedinja) has no Substitute of its own to set.
    expect(carriedOptions(createBuild("shedinja"), championsRuntime, false).substitute).toBeNull();
    assertControlLabels(html);
  });

  it("shows no controls for a Pokémon that has fainted, keeping its Charge", () => {
    const fainted = { ...builds, "own-right": { ...builds["own-right"], currentHP: 0 } };
    const html = renderToStaticMarkup(settings(carriedControlsFor(championsRuntime, fainted, view.names, { "own-right": { confusion: { attempts: 1 } } })));
    const venusaur = carriedBlock(html, "own-right");
    expect(text(venusaur)).toContain("Charge: Venusaur");
    expect(venusaur).not.toMatch(/data-doubles-(confused|substitute|sleep)/);
  });

  it("marks a control the turn's input issue is about, with the issue as its fact", () => {
    const asleep = { ...builds, "own-left": { ...builds["own-left"], status: "slp" as const } };
    const issues = carriedIssueTexts([{ field: "carried.sleep", message: "it cannot have lost 3 turns to sleep." }, { field: "nature", message: "Nature is invalid." }], view.names["own-left"]);
    expect(issues).toEqual({ sleep: "Charizard: it cannot have lost 3 turns to sleep." });
    const html = renderToStaticMarkup(settings(carriedControlsFor(championsRuntime, asleep, view.names, { "own-left": { sleep: { attempts: 3, rest: false } } }, undefined, { "own-left": issues })));
    const charizard = carriedBlock(html, "own-left");
    expect(charizard).toMatch(/<select[^>]*aria-describedby="[^"]+-error"[^>]*aria-invalid="true"[^>]*data-doubles-sleep="own-left"/);
    expect(text(charizard)).toContain("Charizard: it cannot have lost 3 turns to sleep.");
    // The stored count stays visible, so the issue names a value the control shows.
    expect(optionValues(charizard, "data-doubles-sleep")).toEqual([0, 1, 2, 3]);
    assertControlLabels(html);
  });

  it("counts the ticked state-from-earlier-turns checkboxes among the toggles", () => {
    const field = createConditions();
    const none = { "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": false };
    const asleep = { ...builds, "opponent-left": { ...builds["opponent-left"], status: "slp" as const }, "opponent-right": { ...builds["opponent-right"], status: "tox" as const } };
    const controls = carriedControlsFor(championsRuntime, asleep, view.names, {
      "own-left": { confusion: { attempts: 1 }, substitute: 30 }, "opponent-left": { sleep: { attempts: 0, rest: true } }, "opponent-right": { toxic: 4 },
    });
    expect(describeDoublesConditions(field, none, controls)).toBe("Doubles · No weather · No terrain · 3 toggles on");
    expect(describeDoublesConditions(field, { ...none, "own-right": true }, controls)).toBe("Doubles · No weather · No terrain · 4 toggles on");
    expect(describeDoublesConditions(field, none)).toBe("Doubles · No weather · No terrain · 0 toggles on");
  });

  it("counts and shows only the controls a Pokémon has: none once it has fainted, though it keeps its state (ui F4)", () => {
    const field = createConditions();
    const none = { "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": false };
    const fainted = { ...builds, "own-right": { ...builds["own-right"], currentHP: 0 } };
    const kept: DoublesCarried = { confusion: { attempts: 2 }, substitute: 30 };
    const controls = carriedControlsFor(championsRuntime, fainted, view.names, { "own-right": kept });
    expect(controls[1].value).toBe(kept);
    expect(describeDoublesConditions(field, none, controls)).toBe("Doubles · No weather · No terrain · 0 toggles on");
    const venusaur = carriedBlock(renderToStaticMarkup(settings(controls)), "own-right");
    expect(venusaur).not.toMatch(/data-doubles-(confused|confusion-turns|substitute|substitute-hp)=/);
    expect(text(venusaur)).not.toMatch(/Confusion turns so far|Substitute HP/);
    // A Rest sleep kept from an Asleep status that has changed is not counted either.
    expect(describeDoublesConditions(field, none, carriedControlsFor(championsRuntime, builds, view.names, { "opponent-left": { sleep: { attempts: 0, rest: true } } })))
      .toBe("Doubles · No weather · No terrain · 0 toggles on");
  });

  it("takes the controls from its own prop as well as from the context", () => {
    const html = renderToStaticMarkup(createElement(BattleConditions, {
      value: createConditions(), issues: [], onChange: vi.fn(), variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" },
      carried: carriedControlsFor(championsRuntime, builds, view.names).slice(0, 1),
    }));
    expect([...html.matchAll(/data-doubles-carried="([^"]+)"/g)].map((match) => match[1])).toEqual(["own-left"]);
    // 1v1 never shows them.
    expect(renderToStaticMarkup(createElement(DoublesCarriedContext.Provider, { value: carriedControlsFor(championsRuntime, builds, view.names) },
      createElement(BattleConditions, { value: createConditions(), issues: [], onChange: vi.fn() })))).not.toContain("data-doubles-carried");
  });
});

describe("2v2 state from earlier turns (doubles-prep)", () => {
  const start = (): CalculatorState => ({ matchup: createMatchup(0), doubles: createDoubles(0) });
  const key = (state: CalculatorState, slot: DoublesSlotId) => state.doubles.slots[slot].key;
  const withStatus = (state: CalculatorState, slot: DoublesSlotId, status: BattleBuild["status"], extra: { abilityId?: string } = {}) =>
    updateDoublesBuild(state, key(state, slot), { ...state.doubles.slots[slot].build, status, ...extra } as BattleBuild);

  it("starts with none, sets a slot's state bounded to its build, and passes it in the turn's input", () => {
    let state = start();
    expect(DOUBLES_SLOTS.map((slot) => state.doubles.carried[slot])).toEqual([{}, {}, {}, {}]);
    expect(setDoublesCarried(state, key(state, "own-left"), {})).toBe(state);
    state = withStatus(state, "own-left", "slp");
    state = setDoublesCarried(state, key(state, "own-left"), { sleep: { attempts: 5, rest: false }, confusion: { attempts: 9 }, toxic: 3 });
    // Champions: at most 2 turns lost to sleep; confusion turns 0–4; no bad poison turns without Badly poisoned.
    expect(state.doubles.carried["own-left"]).toEqual({ sleep: { attempts: 2, rest: false }, confusion: { attempts: 4 } });
    const input = getDoublesTurnInput(state.doubles);
    expect(input.pokemon["own-left"]?.carried).toEqual({ sleep: { attempts: 2, rest: false }, confusion: { attempts: 4 } });
    // A slot with none passes none: every other turn's input is what it was.
    expect(input.pokemon["own-right"]).not.toHaveProperty("carried");
    expect(setDoublesCarried(state, key(state, "own-left"), { sleep: { attempts: 2, rest: false }, confusion: { attempts: 4 } })).toBe(state);
  });

  it("drops what a status change leaves stale, bounds what an ability or Rest changes, and resets for another Pokémon", () => {
    let state = withStatus(start(), "own-left", "slp");
    state = setDoublesCarried(state, key(state, "own-left"), { sleep: { attempts: 2, rest: false }, confusion: { attempts: 1 } });
    const early = withStatus(state, "own-left", "slp", { abilityId: "earlybird" });
    expect(early.doubles.carried["own-left"]).toEqual({ sleep: { attempts: 1, rest: false }, confusion: { attempts: 1 } });
    const woken = withStatus(state, "own-left", "par");
    expect(woken.doubles.carried["own-left"]).toEqual({ confusion: { attempts: 1 } });
    expect(woken.doubles.carried["own-right"]).toBe(state.doubles.carried["own-right"]);
    // Rest: a 3-turn sleep in every game.
    expect(reconcileCarried({ sleep: { attempts: 3, rest: true } }, { ...state.doubles.slots["own-left"].build }, championsRuntime)).toEqual({ sleep: { attempts: 2, rest: true } });
    const other = updateDoublesBuild(state, key(state, "own-left"), createBuild("garchomp"));
    expect(other.doubles.carried["own-left"]).toEqual({});
  });

  it("keeps a Substitute within a quarter of the maximum HP, and keeps it while the build is being edited", () => {
    let state = start();
    const build = state.doubles.slots["opponent-left"].build;
    const withHP = (base: BattleBuild, hp: number) => ({ ...base, points: { ...base.points!, hp } }) as BattleBuild;
    const full = withHP(build, 32);
    state = updateDoublesBuild(state, key(state, "opponent-left"), full);
    const quarter = Math.floor(getBuildStats(full, championsRuntime)!.hp / 4);
    state = setDoublesCarried(state, key(state, "opponent-left"), { substitute: quarter });
    expect(state.doubles.carried["opponent-left"]).toEqual({ substitute: quarter });
    const lower = withHP(full, 0);
    const lowered = updateDoublesBuild(state, key(state, "opponent-left"), lower);
    expect(lowered.doubles.carried["opponent-left"]).toEqual({ substitute: Math.floor(getBuildStats(lower, championsRuntime)!.hp / 4) });
    expect(Math.floor(getBuildStats(lower, championsRuntime)!.hp / 4)).toBeLessThan(quarter);
    const editing = withHP(full, 99);
    expect(reconcileCarried({ substitute: quarter }, editing, championsRuntime)).toEqual({ substitute: quarter });
  });

  it("passes an Imprison user's moves, the quick moves and the chosen one, and no last move", () => {
    const doubles = createDoubles(0);
    const combatant = doubles.slots["own-left"];
    const quick = combatant.moves.flatMap((move) => move.moveId ? [move.moveId] : []);
    const entry = doublesSlotInput(combatant, false, { moveId: "imprison", target: null }, {});
    expect(entry.moves).toEqual([...new Set([...quick, "imprison"])]);
    expect(entry).not.toHaveProperty("lastMove");
    expect(doublesSlotInput(combatant, false, { moveId: quick[0], target: "opponent-left" }, {})).not.toHaveProperty("moves");
  });

  it("gives the engine's input issue for a state the controls never set", () => {
    let state = withStatus(start(), "own-left", "slp");
    // Set directly, past setDoublesCarried's bounds.
    state = { ...state, doubles: { ...state.doubles, carried: { ...state.doubles.carried, "own-left": { sleep: { attempts: 3, rest: false } } } } };
    const turn = calculateDoublesTurn(getDoublesTurnInput(state.doubles));
    expect(turn.status).toBe("issues");
    if (turn.status !== "issues") throw new Error("issues");
    expect(carriedIssueTexts(turn.issues.pokemon["own-left"], "Charizard")).toEqual({ sleep: "Charizard: it cannot have lost 3 turns to sleep." });
  });
});

// ---------- status-eot UI review fixes (review/reviews.json, lens "ui") ----------

describe("2v2 state an ability ends as the turn starts (ui F1, F2)", () => {
  const key = (state: CalculatorState, slot: DoublesSlotId) => state.doubles.slots[slot].key;
  const edit = (state: CalculatorState, slot: DoublesSlotId, patch: Partial<BattleBuild>) =>
    updateDoublesBuild(state, key(state, slot), { ...state.doubles.slots[slot].build, ...patch } as BattleBuild);
  const sv = async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    return { runtime, state: { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) } as CalculatorState };
  };

  it("offers no count for a status its own ability cures at the turn's first Update, nor Confused with Own Tempo", async () => {
    const { runtime } = await sv();
    const build = createBuild("snorlax", runtime);
    // Pinned Showdown data/abilities.ts onUpdate: Immunity and Pastel Veil (poison), Insomnia and Vital Spirit (sleep), Magma Armor (freeze).
    expect(carriedOptions({ ...build, status: "tox", abilityId: "immunity" }, runtime, false).toxic).toBe(false);
    expect(carriedOptions({ ...build, status: "tox", abilityId: "pastelveil" }, runtime, false).toxic).toBe(false);
    expect(carriedOptions({ ...build, status: "slp", abilityId: "insomnia" }, runtime, false).sleep).toBeNull();
    expect(carriedOptions({ ...build, status: "slp", abilityId: "vitalspirit" }, runtime, true).sleep).toBeNull();
    expect(carriedOptions({ ...build, status: "frz", abilityId: "magmaarmor" }, championsRuntime, false).freeze).toBeNull();
    expect(carriedOptions({ ...build, abilityId: "owntempo" }, runtime, false).confusion).toBe(false);
    // Suppressed (a Neutralizing Gas on the field), the status and the confusion stand and keep their counts.
    expect(carriedOptions({ ...build, status: "tox", abilityId: "immunity" }, runtime, false, false).toxic).toBe(true);
    expect(carriedOptions({ ...build, status: "slp", abilityId: "insomnia" }, runtime, false, false).sleep).toEqual({ max: 3 });
    expect(carriedOptions({ ...build, abilityId: "owntempo" }, runtime, false, false).confusion).toBe(true);
    // Other abilities and statuses are unchanged.
    expect(carriedOptions({ ...build, status: "tox", abilityId: "insomnia" }, runtime, false).toxic).toBe(true);
    expect(carriedOptions({ ...build, status: "slp", abilityId: "immunity" }, runtime, false).sleep).toEqual({ max: 3 });
  });

  it("reads a Neutralizing Gas from another Pokémon that has not fainted, and an Ability Shield outside Magic Room", async () => {
    let { state } = await sv();
    expect(DOUBLES_SLOTS.map((slot) => carriedAbilityOn(state.doubles, slot))).toEqual([true, true, true, true]);
    state = edit(state, "opponent-right", { abilityId: "neutralizinggas" });
    expect(DOUBLES_SLOTS.map((slot) => carriedAbilityOn(state.doubles, slot))).toEqual([false, false, false, true]);
    expect(carriedAbilityOn(edit(state, "own-left", { itemId: "abilityshield" }).doubles, "own-left")).toBe(true);
    const room = setDoublesField(edit(state, "own-left", { itemId: "abilityshield" }), state.doubles.revision, { ...state.doubles.field, magicRoom: true });
    expect(carriedAbilityOn(room.doubles, "own-left")).toBe(false);
    expect(carriedAbilityOn(updateDoublesHP(state, key(state, "opponent-right"), "0").doubles, "own-left")).toBe(true);
  });

  it("drops a confusion or count the ability ends, keeps it while a Neutralizing Gas stands, and passes none to the turn", async () => {
    const setup = await sv();
    const { runtime } = setup;
    let state = updateDoublesBuild(setup.state, key(setup.state, "own-left"), { ...createBuild("slowbro", runtime), abilityId: "oblivious" });
    state = setDoublesCarried(state, key(state, "own-left"), { confusion: { attempts: 1 } });
    expect(state.doubles.carried["own-left"]).toEqual({ confusion: { attempts: 1 } });
    // Own Tempo ends it at the first Update (data/abilities.ts owntempo onUpdate): nothing to carry.
    const tempo = edit(state, "own-left", { abilityId: "owntempo" });
    expect(tempo.doubles.carried["own-left"]).toEqual({});
    expect(setDoublesCarried(tempo, key(tempo, "own-left"), { confusion: { attempts: 0 } })).toBe(tempo);
    // With a Neutralizing Gas on the field it stands; the gas leaving drops it.
    let gas = edit(tempo, "opponent-right", { abilityId: "neutralizinggas" });
    gas = setDoublesCarried(gas, key(gas, "own-left"), { confusion: { attempts: 2 } });
    expect(gas.doubles.carried["own-left"]).toEqual({ confusion: { attempts: 2 } });
    expect(edit(gas, "opponent-right", { abilityId: "static" }).doubles.carried["own-left"]).toEqual({});
    expect(updateDoublesHP(gas, key(gas, "opponent-right"), "0").doubles.carried["own-left"]).toEqual({});
    // Insomnia ends a sleep: its count goes with it.
    let asleep = edit(state, "own-right", { status: "slp" });
    asleep = setDoublesCarried(asleep, key(asleep, "own-right"), { sleep: { attempts: 1, rest: true } });
    expect(asleep.doubles.carried["own-right"]).toEqual({ sleep: { attempts: 1, rest: true } });
    expect(edit(asleep, "own-right", { abilityId: "insomnia" }).doubles.carried["own-right"]).toEqual({});
    // An Ability Shield keeps Own Tempo from the gas only outside Magic Room.
    let shield = edit(gas, "own-left", { itemId: "abilityshield" });
    expect(shield.doubles.carried["own-left"]).toEqual({});
    shield = setDoublesField(shield, shield.doubles.revision, { ...shield.doubles.field, magicRoom: true });
    shield = setDoublesCarried(shield, key(shield, "own-left"), { confusion: { attempts: 1 } });
    expect(shield.doubles.carried["own-left"]).toEqual({ confusion: { attempts: 1 } });
    expect(setDoublesField(shield, shield.doubles.revision, { ...shield.doubles.field, magicRoom: false }).doubles.carried["own-left"]).toEqual({});
    // The turn: Slowbro's Scald always hits (pinned Showdown: Own Tempo ends the confusion before any move).
    const scald = { ...tempo.doubles, actions: { ...tempo.doubles.actions, "own-left": { moveId: "scald", target: "opponent-left" as const } } };
    const input = getDoublesTurnInput(scald);
    expect(input.pokemon["own-left"]).not.toHaveProperty("carried");
    const turn = calculateDoublesTurn(input);
    expect(turn.status).toBe("ready");
    if (turn.status !== "ready") throw new Error("ready");
    const step = turn.steps.find((entry) => entry.slot === "own-left")!;
    expect(step.hits.find((hit) => hit.slot === "opponent-left")!.reached).toBeCloseTo(1, 9);
    expect([...step.skipped, ...step.facts].map((fact) => fact.text).join(" ")).not.toMatch(/confusion/i);
  });
});

describe("2v2 turn lines after the review (ui F3, F6, F7)", () => {
  const names = eotView().names;
  const RANDOM_HITS = [{ hits: 2, chance: 0.35 }, { hits: 3, chance: 0.35 }, { hits: 4, chance: 0.15 }, { hits: 5, chance: 0.15 }];
  const quiet = (steps: DoublesStep[]): Extract<DoublesTurnResult, { status: "ready" }> => ({
    status: "ready", start: EOT_START, steps, hp: EOT_MOVES_HP, startRows: [], facts: [HIT_FACT], endOfTurn: { status: "ready", hp: EOT_MOVES_HP, residuals: [], facts: [] },
  });

  it("gives no hit count to the hits that got past a Substitute (ui F3)", () => {
    const row = eotRow("rockblast", 25, 31, 235, { hits: 5, hitChances: RANDOM_HITS });
    const hit: DoublesHit = {
      slot: "opponent-left", reached: 0.759375, kind: "calculated", min: 25, max: 124, minPercent: 10.64, maxPercent: 52.77, koChance: 0, row, cases: 4,
      substitute: { chance: 1, min: 30, max: 30, breaks: 1 }, facts: [],
    };
    // Pinned Showdown: 1–4 hits reach the Pokémon after a 30 HP Substitute breaks, not the move's 2–5.
    expect(hitLine(hit, names)).toBe("Blastoise: 25–124 damage (10.64–52.77% of max HP) · KO chance 0% · reaches it 75.94%");
    expect(hitLine(hit, names, true)).not.toMatch(/\bhits?\b/);
    const clear: DoublesHit = { ...hit, reached: 1 };
    delete clear.substitute;
    expect(hitLine(clear, names)).toBe("Blastoise: 25–124 damage (10.64–52.77% of max HP), 2–5 hits · KO chance 0%");
  });

  it("shows no KO chance on a card only a status move reached, unless it took HP (ui F6)", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    const wave = quiet([eotStep("opponent-right", "thunderwave", 1, [effectHit("own-left", [{ text: "Is paralysed.", chance: 1 }])])]);
    expect(cardReached(wave, "own-left")).toBe(false);
    expect(cardReached(wave, "own-left", runtime)).toBe(false);
    const dance = quiet([eotStep("own-left", "swordsdance", 1, [effectHit("own-left", [{ text: "+2 Attack.", chance: 1 }])])]);
    expect(cardReached(dance, "own-left", runtime)).toBe(false);
    // Pain Split and Belly Drum take HP: the card keeps its KO chance.
    expect(cardReached(quiet([eotStep("own-right", "painsplit", 1, [effectHit("opponent-left", [], { change: { min: -88, max: -88 } })])]), "opponent-left", runtime)).toBe(true);
    // A status move it is immune to (no-damage) shows none with the move's category; a damaging move's still does.
    const immune: DoublesHit = { ...effectHit("opponent-left", [{ text: "Blastoise is immune.", chance: 1 }]), kind: "no-damage" };
    expect(cardReached(quiet([eotStep("opponent-right", "thunderwave", 1, [immune])]), "opponent-left", runtime)).toBe(false);
    expect(cardReached(quiet([eotStep("own-left", "earthquake", 1, [immune])]), "opponent-left", runtime)).toBe(true);
    expect(cardReached(quiet([eotStep("own-left", "earthquake", 1, [immune])]), "opponent-left")).toBe(true);
    expect(card(summary(eotView(wave)), "own-left")).not.toContain("KO chance");
  });

  it("leaves out a status move's hit that states nothing when the step says what the move did (ui F7)", () => {
    const wishFact = { text: "Wish: the Pokémon at Charizard's position regains HP at the end of the next turn.", chance: 1 };
    const lone = effectHit("own-left", []);
    const wish = eotStep("own-left", "wish", 1, [lone], { facts: [wishFact] });
    expect(listedHits(wish)).toEqual([]);
    // Kept: a share below 1, an HP change, a fact of its own, or a step without facts.
    const half = { ...lone, reached: 0.5 };
    const healed = effectHit("own-right", [], { change: { min: 77, max: 77 } });
    const seeded = effectHit("opponent-left", [{ text: "Is seeded.", chance: 1 }]);
    expect(listedHits({ ...wish, hits: [half, healed, seeded] })).toEqual([half, healed, seeded]);
    expect(listedHits({ ...wish, facts: [] })).toEqual([lone]);
    const panel = turnPanel(summary(eotView(quiet([wish]))));
    expect(text(panel)).toContain(wishFact.text);
    expect(panel).not.toContain("data-doubles-hit=");
    expect(panel).not.toContain("Wish hits");
  });

  it("leaves out a hit the move never reached, with nothing of its own to state (a Ghost type's Curse and its user)", async () => {
    // The engine lists a Ghost type's Curse user as a hit it never reaches (pinned Showdown data/moves.ts curse: target
    // "normal", nonGhostTarget "self" only for a non-Ghost user); the line would read "Charizard: no effect · reaches it 0%".
    const cursed = effectHit("opponent-left", [{ text: "Is cursed.", chance: 1 }]);
    const user: DoublesHit = { ...effectHit("own-left", []), kind: "no-damage", reached: 0 };
    const curse = eotStep("own-left", "curse", 1, [cursed, user], { facts: [{ text: "Curse: Charizard loses 76 HP.", chance: 1 }] });
    expect(listedHits(curse)).toEqual([cursed]);
    // Kept: a hit with a share above 0, or one that states a fact of its own.
    const some = { ...user, reached: 0.25 };
    const said: DoublesHit = { ...user, facts: [{ text: "Charizard is immune.", chance: 1 }] };
    expect(listedHits({ ...curse, hits: [cursed, some, said] })).toEqual([cursed, some, said]);
    expect(listedHits({ ...curse, facts: [] })).toEqual([cursed]);
    const panel = text(turnPanel(summary(eotView(quiet([curse])))));
    expect(panel).toContain("Is cursed.");
    expect(panel).not.toContain("reaches it 0%");
    // Through the engine (Scarlet/Violet): Gengar's Curse into Snorlax.
    const runtime = await loadBattleRuntime("scarlet_violet");
    const build = (id: string, abilityId: string): BattleBuild => ({ ...createBuild(id, runtime), abilityId });
    const turn = calculateDoublesTurn({
      runtime, field: { ...createConditions(), gameType: "Doubles" },
      pokemon: {
        "own-left": { build: build("gengar", "cursedbody"), contexts: {}, charged: false, action: { moveId: "curse", target: "opponent-left" } },
        "own-right": { build: build("venusaur", "overgrow"), contexts: {}, charged: false, action: { moveId: null, target: null } },
        "opponent-left": { build: build("snorlax", "thickfat"), contexts: {}, charged: false, action: { moveId: null, target: null } },
        "opponent-right": { build: build("charizard", "blaze"), contexts: {}, charged: false, action: { moveId: null, target: null } },
      },
    });
    if (turn.status !== "ready") throw new Error(`ready: ${turn.status}`);
    const step = turn.steps.find((entry) => entry.moveId === "curse")!;
    expect(listedHits(step).map((hit) => hit.slot)).toContain("opponent-left");
    expect(listedHits(step).every((hit) => hit.reached > 0 || hit.facts.length > 0)).toBe(true);
  });
});
