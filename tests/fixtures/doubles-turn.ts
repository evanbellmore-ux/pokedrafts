// Hand-built 2v2 views and turn results for the UI tests (no engine): the numbers are fixtures, not calculations.
import type { DoublesCardView } from "@/app/(app)/calculator/DoublesCard";
import { cardReached } from "@/app/(app)/calculator/doubles-format";
import type { Combatant, RosterPanel } from "@/app/(app)/calculator/roster-prep";
import {
  DOUBLES_SLOTS, doublesNames, type DoublesAction, type DoublesHP, type DoublesHit, type DoublesSlotId, type DoublesStart, type DoublesStep,
  type DoublesEndOfTurn, type DoublesTargetRule, type DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { createBuild, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

export const SPECIES: Record<DoublesSlotId, string> = { "own-left": "charizard", "own-right": "venusaur", "opponent-left": "blastoise", "opponent-right": "pikachu" };

/** A fresh Combatant as createMatchup makes them, keyed revision * 4 + slot index. */
export function combatant(slot: DoublesSlotId, speciesId = SPECIES[slot], revision = 0): Combatant {
  const index = DOUBLES_SLOTS.indexOf(slot);
  const moves = createMoveSlots(speciesId, "Doubles");
  const build = withUsualAbility(createBuild(speciesId), usualAbility(speciesId, "Doubles"));
  return { key: revision * 4 + index, editorRevision: 0, role: slot.startsWith("own") ? "own" : "opponent", build, hpInput: "", source: null, moves, megaBase: null, contexts: {}, moveEpoch: 0 };
}

export const EMPTY_PANEL: RosterPanel = { status: "empty", teamName: null, message: "No roster.", choices: [] };

export const NO_ACTION: DoublesAction = { moveId: null, target: null };

export const RULES = {
  /** A single target from your left: left foe, right foe, ally. */
  ownSingle: { kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] },
  ownRightSingle: { kind: "choose", options: ["opponent-left", "opponent-right", "own-left"] },
  opponentSingle: { kind: "choose", options: ["own-left", "own-right", "opponent-right"] },
  ownSpreadFoes: { kind: "auto", hits: ["opponent-left", "opponent-right"] },
  opponentSpreadFoes: { kind: "auto", hits: ["own-left", "own-right"] },
  earthquake: { kind: "auto", hits: ["opponent-left", "opponent-right", "own-right"] },
  random: { kind: "auto", hits: ["opponent-left", "opponent-right"], random: true },
  helpingHand: { kind: "auto", hits: ["own-right"] },
  self: { kind: "none", scope: "self" },
  ownSide: { kind: "none", scope: "own-side" },
} satisfies Record<string, DoublesTargetRule>;

export type DoublesFixture = {
  cards: Record<DoublesSlotId, DoublesCardView>;
  names: Record<DoublesSlotId, string>;
  turn: DoublesTurnResult | null;
};

/**
 * Four card views; `actions`, `rules` and move `contexts` per slot, `turn` supplying each card's HP and reach as
 * useDoublesView does (doubles-format cardReached).
 */
export function fixture(options: {
  species?: Partial<Record<DoublesSlotId, string>>;
  actions?: Partial<Record<DoublesSlotId, DoublesAction>>;
  rules?: Partial<Record<DoublesSlotId, DoublesTargetRule>>;
  contexts?: Partial<Record<DoublesSlotId, Record<string, MoveContext>>>;
  turn?: DoublesTurnResult | null;
} = {}): DoublesFixture {
  const turn = options.turn ?? null;
  const slots = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = combatant(slot, options.species?.[slot] ?? SPECIES[slot]);
    return [slot, options.contexts?.[slot] ? { ...entry, contexts: options.contexts[slot] } : entry];
  })) as Record<DoublesSlotId, Combatant>;
  const ready = turn?.status === "ready" ? turn : null;
  const cards = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const action = options.actions?.[slot] ?? NO_ACTION;
    const view: DoublesCardView = {
      id: slot, slot: slots[slot], action, rule: action.moveId ? options.rules?.[slot] ?? null : null,
      hp: ready ? ready.hp[slot] : null, reached: cardReached(ready, slot),
      issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null,
    };
    return [slot, view];
  })) as Record<DoublesSlotId, DoublesCardView>;
  return { cards, names: doublesNames(slots, championsRuntime), turn };
}

function damageRow(moveId: string, min: number, max: number, maximum: number, overrides: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return {
    moveId, kind: "calculated", min, max, minPercent: Math.round(min / maximum * 10000) / 100, maxPercent: Math.round(max / maximum * 10000) / 100,
    rolls: null, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1, ...overrides,
  };
}

function hit(slot: DoublesSlotId, row: MoveDamageResult, koChance: number, reached = 1, facts: DoublesHit["facts"] = []): DoublesHit {
  return { slot, reached, kind: "calculated", min: row.min, max: row.max, minPercent: row.minPercent, maxPercent: row.maxPercent, koChance, row, cases: 1, facts };
}

function step(slot: DoublesSlotId, moveId: string, position: number, hits: DoublesHit[], extra: Partial<DoublesStep> = {}): DoublesStep {
  return { slot, moveId, order: [{ position, chance: 1 }], moves: 1, skipped: [], hits, facts: [], ...extra };
}

function full(start: number, maximum = start): DoublesHP {
  return { start, maximum, low: start, average: start, high: start, min: start, max: start, koChance: 0, heals: [] };
}

const FULL_START: DoublesStart = {
  "own-left": { hp: 153, maximum: 153 }, "own-right": { hp: 155, maximum: 155 }, "opponent-left": { hp: 154, maximum: 154 }, "opponent-right": { hp: 110, maximum: 110 },
};

const FACTS = ["Every move hits; no critical hits; added effects below 100% do not happen."];
/** Every ready fixture's end of turn: not estimated (a reason the engine gives), so the cards show HP after the moves. */
const END_OF_TURN: DoublesEndOfTurn = { status: "not-estimated", reason: "Too many cases to follow." };

/**
 * Both of your Pokémon into Blastoise (opponent's left, at 60 / 154): Weather Ball then Sludge Bomb, a 75% KO, so Blastoise
 * faints before its Water Spout 75% of the time. Pikachu protects first.
 */
export const DOUBLE_TARGET_ACTIONS: Record<DoublesSlotId, DoublesAction> = {
  "own-left": { moveId: "weatherball", target: "opponent-left" },
  "own-right": { moveId: "sludgebomb", target: "opponent-left" },
  "opponent-left": { moveId: "waterspout", target: null },
  "opponent-right": { moveId: "protect", target: null },
};
export const DOUBLE_TARGET_RULES: Record<DoublesSlotId, DoublesTargetRule> = {
  "own-left": RULES.ownSingle, "own-right": RULES.ownRightSingle, "opponent-left": RULES.opponentSpreadFoes, "opponent-right": RULES.self,
};
export const DOUBLE_TARGET: DoublesTurnResult = {
  status: "ready",
  start: { ...FULL_START, "opponent-left": { hp: 60, maximum: 154 } },
  steps: [
    step("opponent-right", "protect", 1, []),
    step("own-left", "weatherball", 2, [hit("opponent-left", damageRow("weatherball", 20, 24, 154), 0)]),
    step("own-right", "sludgebomb", 3, [hit("opponent-left", damageRow("sludgebomb", 36, 43, 154, { ohkoChance: 0.75 }), 0.75)]),
    step("opponent-left", "waterspout", 4, [
      hit("own-left", damageRow("waterspout", 30, 36, 153), 0, 0.25),
      hit("own-right", damageRow("waterspout", 8, 10, 155), 0, 0.25),
    ], { moves: 0.25, skipped: [{ text: "Faints before it moves.", chance: 0.75 }], facts: [{ text: "Water Spout: 58 power at 60 HP.", chance: 0.25 }] }),
  ],
  hp: {
    "own-left": { start: 153, maximum: 153, low: 153, average: 144.75, high: 153, min: 117, max: 153, koChance: 0, heals: [] },
    "own-right": { start: 155, maximum: 155, low: 155, average: 152.75, high: 155, min: 145, max: 155, koChance: 0, heals: [] },
    "opponent-left": { start: 60, maximum: 154, low: 4, average: 0.625, high: 0, min: 0, max: 4, koChance: 0.75, heals: [], faintsBeforeMoving: 0.75 },
    "opponent-right": full(110),
  },
  startRows: [],
  facts: [...FACTS, "Assumes no protecting move was used last turn."],
  endOfTurn: END_OF_TURN,
};

/** A Garchomp mirror into each other: a speed tie, so each moves first half the time and the other faints before it moves. */
export const UNCERTAIN_ORDER_ACTIONS: Partial<Record<DoublesSlotId, DoublesAction>> = {
  "own-left": { moveId: "dragonclaw", target: "opponent-left" },
  "opponent-left": { moveId: "dragonclaw", target: "own-left" },
};
export const UNCERTAIN_ORDER_RULES: Partial<Record<DoublesSlotId, DoublesTargetRule>> = { "own-left": RULES.ownSingle, "opponent-left": RULES.opponentSingle };
export const UNCERTAIN_SPECIES: Partial<Record<DoublesSlotId, string>> = { "own-left": "garchomp", "opponent-left": "garchomp" };
const tie = [{ position: 1, chance: 0.5 }, { position: 2, chance: 0.5 }];
const mirrorHP: DoublesHP = { start: 183, maximum: 183, low: 183, average: 91.5, high: 0, min: 0, max: 183, koChance: 0.5, heals: [], faintsBeforeMoving: 0.5 };
export const UNCERTAIN_ORDER: DoublesTurnResult = {
  status: "ready",
  start: { ...FULL_START, "own-left": { hp: 183, maximum: 183 }, "opponent-left": { hp: 183, maximum: 183 } },
  steps: [
    step("own-left", "dragonclaw", 1, [hit("opponent-left", damageRow("dragonclaw", 184, 217, 183, { ohkoChance: 1 }), 0.5, 0.5)],
      { order: tie, moves: 0.5, skipped: [{ text: "Faints before it moves.", chance: 0.5 }] }),
    step("opponent-left", "dragonclaw", 1, [hit("own-left", damageRow("dragonclaw", 184, 217, 183, { ohkoChance: 1 }), 0.5, 0.5)],
      { order: tie, moves: 0.5, skipped: [{ text: "Faints before it moves.", chance: 0.5 }] }),
  ],
  hp: { "own-left": mirrorHP, "own-right": full(155), "opponent-left": mirrorHP, "opponent-right": full(110) },
  startRows: [],
  facts: FACTS,
  endOfTurn: END_OF_TURN,
};

/** Venusaur's Worry Seed comes before other moves: the turn is not estimated, and each move's start-of-turn damage is listed. */
export const NOT_ESTIMATED_ACTIONS: Partial<Record<DoublesSlotId, DoublesAction>> = {
  "own-left": { moveId: "heatwave", target: null },
  "own-right": { moveId: "worryseed", target: "opponent-left" },
};
export const NOT_ESTIMATED_RULES: Partial<Record<DoublesSlotId, DoublesTargetRule>> = { "own-left": RULES.ownSpreadFoes, "own-right": RULES.ownRightSingle };
export const NOT_ESTIMATED: DoublesTurnResult = {
  status: "not-estimated",
  reason: "Worry Seed is not modelled and comes before another move.",
  start: FULL_START,
  startRows: [
    { slot: "own-left", target: "opponent-left", row: damageRow("heatwave", 26, 31, 154) },
    { slot: "own-left", target: "opponent-right", row: damageRow("heatwave", 70, 83, 110) },
  ],
  facts: [],
};

/** An action the engine rejects. */
export const ISSUES: DoublesTurnResult = {
  status: "issues",
  issues: { pokemon: {}, field: [], actions: [{ slot: "own-left", message: "Weather Ball has no target." }] },
};

/**
 * Charizard (your left, at 5 / 153) uses Flare Blitz into Blastoise and faints to its recoil; no move reaches Charizard.
 * The step's fact stands in for the engine's self-effect fact.
 */
export const SELF_KO_ACTIONS: Partial<Record<DoublesSlotId, DoublesAction>> = { "own-left": { moveId: "flareblitz", target: "opponent-left" } };
export const SELF_KO_RULES: Partial<Record<DoublesSlotId, DoublesTargetRule>> = { "own-left": RULES.ownSingle };
export const SELF_KO: DoublesTurnResult = {
  status: "ready",
  start: { ...FULL_START, "own-left": { hp: 5, maximum: 153 } },
  steps: [
    step("own-left", "flareblitz", 1, [hit("opponent-left", damageRow("flareblitz", 50, 59, 154), 0)],
      { facts: [{ text: "Charizard faints from recoil.", chance: 1 }] }),
  ],
  hp: {
    "own-left": { start: 5, maximum: 153, low: 0, average: 0, high: 0, min: 0, max: 0, koChance: 1, heals: [] },
    "own-right": full(155),
    "opponent-left": { start: 154, maximum: 154, low: 104, average: 99.5, high: 95, min: 95, max: 104, koChance: 0, heals: [] },
    "opponent-right": full(110),
  },
  startRows: [],
  facts: FACTS,
  endOfTurn: END_OF_TURN,
};

/** Venusaur (your right) uses Bullet Seed into Blastoise with 3 hits chosen in its move settings. */
export const CHOSEN_HITS_ACTIONS: Partial<Record<DoublesSlotId, DoublesAction>> = { "own-right": { moveId: "bulletseed", target: "opponent-left" } };
export const CHOSEN_HITS_RULES: Partial<Record<DoublesSlotId, DoublesTargetRule>> = { "own-right": RULES.ownRightSingle };
export const CHOSEN_HITS_CONTEXTS: Partial<Record<DoublesSlotId, Record<string, MoveContext>>> = { "own-right": { bulletseed: { hits: 3 } } };
const bulletSeed = damageRow("bulletseed", 78, 96, 154, { hits: 3 });
export const CHOSEN_HITS: DoublesTurnResult = {
  status: "ready",
  start: FULL_START,
  steps: [step("own-right", "bulletseed", 1, [hit("opponent-left", bulletSeed, 0)])],
  hp: {
    "own-left": full(153), "own-right": full(155),
    "opponent-left": { start: 154, maximum: 154, low: 76, average: 67, high: 58, min: 58, max: 76, koChance: 0, heals: [] },
    "opponent-right": full(110),
  },
  startRows: [],
  facts: FACTS,
  endOfTurn: END_OF_TURN,
};
/** The same move in a not-estimated turn's start rows. */
export const CHOSEN_HITS_NOT_ESTIMATED: DoublesTurnResult = {
  status: "not-estimated", reason: "Worry Seed is not modelled and comes before another move.", start: FULL_START,
  startRows: [{ slot: "own-right", target: "opponent-left", row: bulletSeed }], facts: [],
};
