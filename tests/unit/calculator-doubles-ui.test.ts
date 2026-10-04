import { createElement, type ChangeEvent, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CHOSEN_HITS, CHOSEN_HITS_ACTIONS, CHOSEN_HITS_CONTEXTS, CHOSEN_HITS_NOT_ESTIMATED, CHOSEN_HITS_RULES,
  combatant, DOUBLE_TARGET, DOUBLE_TARGET_ACTIONS, DOUBLE_TARGET_RULES, fixture, ISSUES, NOT_ESTIMATED, NOT_ESTIMATED_ACTIONS, NOT_ESTIMATED_RULES,
  RULES, SELF_KO, SELF_KO_ACTIONS, SELF_KO_RULES, UNCERTAIN_ORDER, UNCERTAIN_ORDER_ACTIONS, UNCERTAIN_ORDER_RULES, UNCERTAIN_SPECIES, type DoublesFixture,
} from "../fixtures/doubles-turn";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import DoublesSettings from "@/app/(app)/calculator/DoublesSettings";
import DoublesMoves from "@/app/(app)/calculator/DoublesMoves";
import { describeDoublesConditions } from "@/app/(app)/calculator/BattleConditions";
import {
  actionFact, baseName, cardHPLabel, factLine, hitLine, orderFact, positionedName, relativeLabel, relativeName, shownHP, startRowLine, stepHeading, turnSummary,
} from "@/app/(app)/calculator/doubles-format";
import type { DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { getMoveOwner } from "@/app/(app)/calculator/roster-prep";
import { DOUBLES_SLOTS, type DoublesSlotId, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { createConditions } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";

// Keep real SSR and hooks while recording host handlers for DOM-free callback tests (as calculator-ui.test.ts does).
const hostEvents = vi.hoisted(() => ({
  capture: false,
  buttons: [] as (ComponentProps<"button"> & Record<string, unknown>)[],
  inputs: [] as (ComponentProps<"input"> & Record<string, unknown>)[],
}));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (!hostEvents.capture) return;
    if (type === "button") hostEvents.buttons.push(props as typeof hostEvents.buttons[number]);
    if (type === "input") hostEvents.inputs.push(props as typeof hostEvents.inputs[number]);
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
      return actual.jsxDEV(...args);
    },
  };
});

function capture(render: () => string) {
  hostEvents.buttons = [];
  hostEvents.inputs = [];
  hostEvents.capture = true;
  try { return { html: render(), buttons: hostEvents.buttons, inputs: hostEvents.inputs }; }
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

const click = (button: { onClick?: unknown }) => (button.onClick as (event: MouseEvent<HTMLButtonElement>) => void)({} as MouseEvent<HTMLButtonElement>);
const change = (input: { onChange?: unknown }) => (input.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);

describe("2v2 text (doubles-format)", () => {
  const view = doubleTarget();
  const names = view.names;

  it("names each target from the acting slot's place on the screen", () => {
    expect(DOUBLES_SLOTS.map((slot) => relativeLabel("own-left", slot))).toEqual(["Itself", "Ally", "Left foe", "Right foe"]);
    expect(DOUBLES_SLOTS.map((slot) => relativeLabel("opponent-right", slot))).toEqual(["Left foe", "Right foe", "Ally", "Itself"]);
    expect(relativeName(names, "own-right", "opponent-right")).toBe("Pikachu (right foe)");
    expect(positionedName(names, "opponent-left")).toBe("Blastoise (opponent's left)");
  });

  it("writes each action as a fact", () => {
    expect(actionFact("Weather Ball", names, "own-left", RULES.ownSingle, "opponent-left")).toBe("Weather Ball → Blastoise (left foe)");
    expect(actionFact("Earthquake", names, "own-left", RULES.earthquake, null)).toBe("Earthquake → both foes and Venusaur (ally)");
    expect(actionFact("Outrage", names, "own-left", RULES.random, null)).toBe("Outrage → a random foe");
    expect(actionFact("Helping Hand", names, "own-left", RULES.helpingHand, null)).toBe("Helping Hand → Venusaur (ally)");
    expect(actionFact("Protect", names, "own-left", RULES.self, null)).toBe("Protect · Targets itself");
    expect(actionFact("Tailwind", names, "own-left", RULES.ownSide, null)).toBe("Tailwind · Targets its side");
    expect(actionFact("Water Spout", names, "opponent-left", RULES.opponentSpreadFoes, null)).toBe("Water Spout → both foes");
    expect(actionFact("Weather Ball", names, "own-left", RULES.ownSingle, null)).toBe("Weather Ball · No target");
  });

  it("tells two of the same species apart by position, without repeating it", () => {
    const mirror = uncertain();
    expect(mirror.names["own-left"]).toBe("Garchomp (your left)");
    expect(mirror.names["opponent-left"]).toBe("Garchomp (opponent's left)");
    expect(baseName(mirror.names, "own-left")).toBe("Garchomp");
    expect(positionedName(mirror.names, "own-left")).toBe("Garchomp (your left)");
    expect(relativeName(mirror.names, "own-left", "opponent-left")).toBe("Garchomp (left foe)");
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
    expect(stepHeading(2, DOUBLE_TARGET.steps[1], names, championsRuntime, { arrow: true, text: "Blastoise (left foe)" })).toBe("2 · Weather Ball · Charizard (your left) → Blastoise (left foe)");
    expect(stepHeading(1, DOUBLE_TARGET.steps[0], names, championsRuntime, { arrow: false, text: "Targets itself" })).toBe("1 · Protect · Pikachu (opponent's right) · Targets itself");
    expect(stepHeading(4, DOUBLE_TARGET.steps[3], names, championsRuntime, null)).toBe("4 · Water Spout · Blastoise (opponent's left) → both foes");
    expect(turnSummary(DOUBLE_TARGET, names, "average")).toBe("Charizard HP remaining: 145 / 153. Venusaur HP remaining: 153 / 155. Blastoise HP remaining: 1 / 154, KO chance 75%. Pikachu HP remaining: 110 / 110.");
    expect(turnSummary(NOT_ESTIMATED, names, "average")).toBe("Turn not estimated: Sleep Powder is not modelled and comes before another move.");
    expect(turnSummary(ISSUES, names, "average")).toBe("Charizard (your left): Weather Ball has no target.");
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
    expect(quick[0][2]).toBe("Charizard your left move 1: Heat Wave");
    expect(quick.slice(12).every((match) => match[1] === `${view.cards["opponent-right"].slot.key}:0`)).toBe(true);
    expect(html.match(/data-doubles-no-move="[^"]+"[^>]*aria-pressed="true"/g)).toHaveLength(4);
    expect(html).toMatch(/aria-label="Venusaur your right: all moves" aria-controls="moves-list"/);
    expect(html).not.toContain("<fieldset class=\"min-w-0\"><legend");
    expect(html).not.toContain("data-doubles-target");
    expect(text(turnPanel(html))).toContain("No moves chosen.");
    expect(card(html, "own-left")).toContain("Current HP");
    assertControlLabels(html, ["moves-list"]);
  });

  it("asks for a target only when the move takes one, and states every action", () => {
    const html = summary(doubleTarget());
    const charizard = card(html, "own-left");
    expect(charizard.match(/<legend[^>]*>Target<span class="sr-only"> for Charizard your left<\/span><\/legend>/)).not.toBeNull();
    const radios = [...charizard.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios.map((tag) => tag.match(/value="([^"]+)"/)?.[1])).toEqual(["opponent-left", "opponent-right", "own-right"]);
    expect(radios.map((tag) => /checked=""/.test(tag))).toEqual([true, false, false]);
    expect(text(charizard)).toMatch(/Left foeBlastoise[\s\S]*Right foePikachu[\s\S]*AllyVenusaur/);
    expect(charizard).toMatch(/<p data-doubles-action="own-left" aria-hidden="true"[^>]*>Weather Ball<span aria-hidden="true"> → <\/span><span class="sr-only"> targets <\/span>Blastoise \(left foe\)<\/p>/);
    const blastoise = card(html, "opponent-left");
    expect(blastoise).not.toContain('type="radio"');
    expect(blastoise).toMatch(/<p data-doubles-action="opponent-left" class[^>]*>Water Spout<span aria-hidden="true"> → <\/span><span class="sr-only"> targets <\/span>both foes<\/p>/);
    const pikachu = card(html, "opponent-right");
    expect(text(pikachu)).toContain("Move: Protect");
    expect(text(pikachu)).toContain("Protect · Targets itself");
    expect(pikachu).toMatch(/data-doubles-all-moves="opponent-right"[^>]*class="[^"]*border-accent-border/);
    expect(pikachu.match(/data-doubles-no-move="opponent-right"[^>]*aria-pressed="false"/)).not.toBeNull();
    const earthquake = summary(fixture({ species: { "own-left": "garchomp" }, actions: { "own-left": { moveId: "earthquake", target: null } }, rules: { "own-left": RULES.earthquake } }));
    expect(text(card(earthquake, "own-left"))).toContain("Earthquake →  targets both foes and Venusaur (ally)");
    expect(earthquake).toMatch(/aria-label="Garchomp your left move 2: Earthquake"[^>]*aria-pressed="true"/);
    assertControlLabels(html, ["moves-list"]);
  });

  it.each([["low", 4, "Low roll"], ["average", 1, "Average estimate"], ["high", 0, "High roll"]] as const)("projects the %s roll's HP after the moves", (mode, shown, label) => {
    const html = summary(doubleTarget(), { rollMode: mode as DamageRollMode });
    const blastoise = card(html, "opponent-left");
    expect(blastoise).toContain(`After the moves · ${label}`);
    expect(blastoise).toMatch(new RegExp(`<span class="text-xl font-bold text-text">${shown}</span><span class="text-sm text-muted"> / 154 HP</span>`));
    expect(blastoise).toMatch(new RegExp(`role="meter" aria-label="Blastoise opponent&#x27;s left projected HP" aria-valuemin="0" aria-valuemax="154" aria-valuenow="${shown}" aria-valuetext="${shown} of 154 HP after the moves, ${label} \\(0–4\\). KO chance: 75%. Turn start HP: 60."`));
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

  it("names the Pokémon of an uncertain turn by position when two share a species", () => {
    const html = summary(uncertain());
    expect(html).toContain('aria-label="Garchomp your left move 1: Dragon Claw"');
    expect(html).toContain('aria-label="Garchomp opponent&#x27;s left move 1: Dragon Claw"');
    const garchomp = card(html, "own-left");
    expect(text(garchomp)).toMatch(/Left foeGarchomp/);
    expect(text(garchomp)).toContain("Dragon Claw →  targets Garchomp (left foe)");
    expect(text(card(html, "own-left"))).toContain("91 / 183 HP");
  });
});

describe("2v2 turn (DoublesTurn)", () => {
  it("lists each move in turn order with each Pokémon it reaches", () => {
    const html = summary(doubleTarget());
    const panel = turnPanel(html);
    expect(panel).toMatch(/<ol aria-label="Actions in turn order"/);
    expect([...panel.matchAll(/data-doubles-step="([^"]+)"/g)].map((match) => match[1])).toEqual(["opponent-right", "own-left", "own-right", "opponent-left"]);
    const steps = text(panel);
    expect(steps).toContain("1 · Protect · Pikachu (opponent's right) · Targets itself");
    expect(steps).toContain("2 · Weather Ball · Charizard (your left) →  targets Blastoise (left foe)");
    expect(steps).toContain("Blastoise: 20–24 damage (12.99–15.58% of max HP) · KO chance 0%");
    expect(steps).toContain("Blastoise: 36–43 damage (23.38–27.92% of max HP) · KO chance 75%");
    expect(steps).toContain("Faints before it moves (75%).");
    expect(steps).toContain("Water Spout: 58 power at 60 HP (25%).");
    expect(steps).toContain("Charizard: 30–36 damage (19.61–23.53% of max HP) · KO chance 0% · reaches it 25%");
    expect(panel).toMatch(/<ul aria-label="Sludge Bomb hits"[^>]*><li data-doubles-hit="opponent-left"/);
    expect(panel).not.toMatch(/aria-label="Protect hits"/);
    expect(steps).toContain("Every move hits; no critical hits; added effects below 100% do not happen.");
    expect(steps).toContain("Assumes no protecting move was used last turn.");
    expect(panel).toContain("Show move<span class=\"sr-only\"> Weather Ball, Charizard (your left)</span>");
    expect(panel).toMatch(/<p data-doubles-live="true" aria-live="polite" aria-atomic="true" class="sr-only">Charizard HP remaining: 145 \/ 153\. Venusaur HP remaining: 153 \/ 155\. Blastoise HP remaining: 1 \/ 154, KO chance 75%\. Pikachu HP remaining: 110 \/ 110\.<\/p>/);
    expect(steps).not.toMatch(/Assumes the target uses a 0-priority move|Analytic: needs the Doubles turn order/);
  });

  it("states an uncertain order", () => {
    const panel = text(turnPanel(summary(uncertain())));
    expect(panel.match(/Order: 1st 50% · 2nd 50%\./g)).toHaveLength(2);
    expect(panel).toContain("Faints before it moves (50%).");
    expect(panel).toContain("1 · Dragon Claw · Garchomp (your left) →  targets Garchomp (left foe)");
    expect(panel).toContain("2 · Dragon Claw · Garchomp (opponent's left) →  targets Garchomp (left foe)");
    expect(panel).toContain("Garchomp (opponent's left): 184–217 damage (100.55–118.58% of max HP) · KO chance 50% · reaches it 50%");
  });

  it("gives the reason a turn is not estimated, then each move's damage at the start of the turn", () => {
    const html = summary(notEstimated());
    const panel = turnPanel(html);
    expect(text(panel)).toContain("Turn not estimated: Sleep Powder is not modelled and comes before another move.");
    expect(panel).toMatch(/<h4 id="([^"]+)"[^>]*>At the start of the turn<\/h4><ul aria-labelledby="\1"/);
    expect([...panel.matchAll(/<li data-doubles-start-row="[^"]+"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => text(match[1]))).toEqual([
      "Heat Wave · Charizard →  targets Blastoise: 26–31 damage (16.88–20.13% of max HP)",
      "Heat Wave · Charizard →  targets Pikachu: 70–83 damage (63.64–75.45% of max HP)",
    ]);
    expect(panel).not.toContain("data-doubles-step");
    for (const slot of DOUBLES_SLOTS) expect(card(html, slot)).toContain("Current HP");
    expect(html.match(/Sleep Powder is not modelled/g)).toHaveLength(2);
  });

  it("lists the engine's validation messages with Fix settings", () => {
    const view = fixture({ actions: { "own-left": { moveId: "weatherball", target: null } }, rules: { "own-left": RULES.ownSingle }, turn: ISSUES });
    const onFixSettings = vi.fn();
    const { html, buttons } = capture(() => summary(view, { onFixSettings }));
    expect(text(turnPanel(html))).toContain("Charizard (your left): Weather Ball has no target.");
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

  it("states facts only", () => {
    const tutorial = /Click|Choose a|to see|browse|Select a/;
    for (const view of [fixture(), doubleTarget(), uncertain(), notEstimated()]) {
      expect(visibleText(summary(view))).not.toMatch(tutorial);
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
    expect(text(html)).toContain("Build settingsCharizard (your left)");
    expect(text(html)).toContain("Build settingsPikachu (opponent's right)");
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
    expect(text(html)).toContain("Venusaur · your right");
    expect(text(html)).toContain("Right foe · Pikachu");
    expect(text(html)).toContain("Ally · Charizard");
    expect(text(html)).toContain("Damage at the start of the turn, before any move.");
    expect(html).toContain('<section id="moves-list">List</section>');
    change(inputs.find((input) => input.value === "opponent-left" && String(input.name).endsWith("-for"))!);
    expect(onFocusChange).toHaveBeenCalledWith("opponent-left");
    change(inputs.find((input) => input.value === "own-left" && String(input.name).endsWith("-into"))!);
    expect(onIntoChange).toHaveBeenCalledWith("own-left");
    assertControlLabels(html);
    expect(visibleText(html)).not.toMatch(/Click|Choose a|to see|browse|Select a/);
  });
});
