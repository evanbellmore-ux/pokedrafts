import { describe, expect, it } from "vitest";
import { afterHit, callingGuard, CALLS_MOVE, context, ownsLastMove, uproarSleep, WIRED } from "@/app/lib/battle/doubles-calling";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn, type TurnKernel, type TurnMoveInfo } from "@/app/lib/battle/doubles-turn";
import { doublesNames, type DoublesCarried, type DoublesPokemonInput, type DoublesSlotId, type DoublesStep, type DoublesTurnInput, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { pointFactor, type MonState, type PendingAction, type World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";
import type { TurnStepOutcome } from "@/app/lib/battle/uses-to-ko";

/**
 * status2 Track CL (ADDENDUM2 §4.3 CL, §2.3 #28 #49 #51; T2P §3.9-§3.15; T2M §3.26, §3.28): app/lib/battle/doubles-calling.ts.
 * Nature Power, Copycat, Mirror Move, Me First, Instruct, Sleep Talk, Uproar and Helping Hand twice (through Instruct), each
 * against pinned Showdown c23d2e94. The cases are Track V2's (verify/cases-t2p.ts, cases-t2m-1b.ts, cases-in-1b.ts) and
 * scripts/.cache/calc-audit/status2/build/cl/cases-extra.ts', as each oracle run had them; the numbers are those runs'
 * (build/cl/results, through verify/sim-dfs.ts: every move hits, no critical hit, added effects below 100% fail). Level 50,
 * 31 IVs, Serious, 0 EVs or Stat Points unless set; own-left, own-right, opponent-left, opponent-right.
 *
 * A model that needs an integrator line (build/W1B-CL.md CL-1 … CL-6; doubles-calling.ts WIRED) is `needs(...)`: it.fails on
 * this tree, where the line is not in and its guard gives a reason instead, and it() on the scratch tree that has the lines
 * (CL_INT=1 with scripts/.cache/calc-audit/status2/build/cl/int.config.mts). The integrator flips them to it() with the lines.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Spec = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; carried?: DoublesCarried; lastMove?: string | null; lastMoveTarget?: DoublesSlotId | null; moves?: string[];
  exactMoves?: true; move: string | null; target?: DoublesSlotId; context?: MoveContext;
};
/** [min, max, average, low, high, koChance] after the moves, Showdown's (the slots that change; the others keep their HP). */
type HPRow = [number, number, number, number, number, number];
type Case = {
  game: "sv" | "swsh" | "usum" | "champions"; field?: { terrain?: BattleConditions["terrain"]; gravity?: boolean }; battleLastMove?: string | null;
  slots: Record<"OL" | "OR" | "PL" | "PR", Spec>; hp: Partial<Record<"OL" | "OR" | "PL" | "PR", HPRow>>;
};
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const KEYS = { OL, OR, PL, PR } as const;
const GAME: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const runtimeOf = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const wired = process.env.CL_INT === "1";
/** A case that needs integrator lines (`lines`, for the report): it() where they are in, it.fails here. */
const needs = (lines: string) => { void lines; return wired ? it : it.fails; };

function buildOf(runtime: BattleRuntime, m: Spec): BattleBuild {
  const base = createBuild(toID(m.species), runtime);
  const ability = toID(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: toID(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } }) as BattleBuild;
}
/** The case as the 2v2 input (verify/app-turn.ts caseInput's mapping of these fields). */
async function inputOf(c: Case): Promise<DoublesTurnInput> {
  const runtime = await runtimeOf(GAME[c.game]);
  const pokemon = Object.fromEntries(Object.entries(c.slots).map(([key, m]) => {
    const moveId = m.move === null ? null : toID(m.move);
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: moveId && m.context ? { [moveId]: m.context } : {}, charged: false,
      action: { moveId, target: m.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toID(m.lastMove) } : {}),
      ...(m.lastMoveTarget !== undefined ? { lastMoveTarget: m.lastMoveTarget } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toID)])] } : {}),
    };
    return [KEYS[key as keyof typeof KEYS], entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  const input: DoublesTurnInput = {
    runtime, pokemon, canSwitch: { own: true, opponent: true },
    field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), terrain: c.field?.terrain ?? "", gravity: !!c.field?.gravity },
    ...(c.battleLastMove !== undefined ? { battleLastMove: c.battleLastMove === null ? null : toID(c.battleLastMove) } : {}),
  };
  // A move that takes no chosen target in the app gets none (doubles-targets.ts), whatever the Showdown choice aims at.
  for (const slot of Object.values(KEYS)) {
    const entry = pokemon[slot];
    if (entry.action.moveId && entry.action.target && doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
async function ready(c: Case): Promise<Ready> {
  const result = calculateDoublesTurn(await inputOf(c));
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
async function reason(c: Case): Promise<string> {
  const result = calculateDoublesTurn(await inputOf(c));
  return result.status === "not-estimated" ? result.reason : result.status;
}
/** Showdown's HP after the moves: the listed slots' rows, every other slot at its start. */
function expectHP(result: Ready, c: Case) {
  for (const [key, slot] of Object.entries(KEYS)) {
    const hp = result.hp[slot]!;
    const row = c.hp[key as keyof typeof KEYS];
    if (!row) { expect([hp.min, hp.max], `${key} unchanged`).toEqual([hp.start, hp.start]); continue; }
    const [min, max, average, low, high, ko] = row;
    expect({ min: hp.min, max: hp.max, low: hp.low, high: hp.high }, key).toEqual({ min, max, low, high });
    expect(hp.average, `${key} average`).toBeCloseTo(average, 9);
    expect(hp.koChance, `${key} KO chance`).toBeCloseTo(ko, 12);
  }
}
const stepOf = (result: Ready, slot: DoublesSlotId, copied?: DoublesStep["copied"]) => result.steps.find((step) => step.slot === slot && step.copied === copied)!;
const chance = (facts: { text: string; chance: number }[], text: string) => facts.filter((fact) => fact.text === text).reduce((sum, fact) => sum + fact.chance, 0);
const hitOf = (step: DoublesStep, slot: DoublesSlotId) => step.hits.find((hit) => hit.slot === slot);
const nameOf = async (c: Case, slot: DoublesSlotId) => { const input = await inputOf(c); return doublesNames(input.pokemon, input.runtime)[slot]; };

// The cases, as each oracle run had them (build/cl/results/<id>.json's key), with Showdown's HP after the moves.
const CASES: Record<string, Case> = {
  "T2P-NAT-01-swsh": {
    game: "swsh", field: { terrain: "Electric" },
    slots: { OL: { species: "Bellossom", ability: "Chlorophyll", evs: { spe: 252 }, move: "Nature Power", target: PL },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Raichu", ability: "Lightning Rod", move: null } },
    hp: {},
  },
  "T2P-NAT-02-usum": {
    game: "usum", field: { terrain: "Psychic" },
    slots: { OL: { species: "Bellossom", ability: "Chlorophyll", evs: { spe: 252 }, move: "Nature Power", target: PL },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PL: [183, 191, 187.4375, 191, 183, 0] },
  },
  "T2P-NAT-03-usum": {
    game: "usum",
    slots: { OL: { species: "Bellossom", ability: "Chlorophyll", evs: { spe: 252 }, move: "Nature Power", target: PL },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PL: [204, 209, 206.8125, 209, 204, 0] },
  },
  "T2P-NAT-03b-usum": {
    game: "usum",
    slots: { OL: { species: "Whimsicott", ability: "Prankster", move: "Nature Power", target: PR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Umbreon", ability: "Synchronize", move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null } },
    hp: { PR: [207, 212, 209.5625, 212, 207, 0] },
  },
  "T2P-MEF-01-usum": {
    game: "usum",
    slots: { OL: { species: "Absol", ability: "Justified", evs: { spe: 252 }, move: "Me First", target: PR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: OL } },
    hp: { OL: [21, 38, 29.75, 38, 21, 0], PR: [43, 65, 54.375, 65, 43, 0] },
  },
  "T2P-MEF-02-usum": {
    game: "usum",
    slots: { OL: { species: "Absol", ability: "Justified", evs: { spe: 252 }, move: "Me First", target: PR },
      OR: { species: "Absol", ability: "Justified", evs: { spe: 248 }, move: "Me First", target: PL },
      PL: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 4 }, move: "Rock Slide" },
      PR: { species: "Garchomp", ability: "Rough Skin", move: "Swords Dance" } },
    hp: { OL: [93, 101, 97, 101, 93, 0], OR: [93, 101, 97, 101, 93, 0], PL: [159, 163, 160.75, 163, 159, 0], PR: [159, 163, 160.75, 163, 159, 0] },
  },
  "T2P-MIR-01-usum": {
    game: "usum",
    slots: { OL: { species: "Fearow", ability: "Keen Eye", move: "Mirror Move", target: PR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: OR } },
    hp: { OL: [123, 123, 123, 123, 123, 0], OR: [139, 154, 147.0625, 154, 139, 0], PR: [113, 125, 119.25, 125, 113, 0] },
  },
  "T2P-MIR-02-usum": {
    game: "usum",
    slots: { OL: { species: "Fearow", ability: "Keen Eye", evs: { spe: 252 }, move: "Mirror Move", target: PR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Garchomp", ability: "Rough Skin", lastMove: "Dragon Claw", move: "Swords Dance" } },
    hp: { OL: [123, 123, 123, 123, 123, 0], PR: [113, 125, 119.25, 125, 113, 0] },
  },
  "T2M-ST-01-sv": {
    game: "sv",
    slots: { OL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 240 }, status: "slp", moves: ["Body Slam", "Earthquake", "Protect"], exactMoves: true, move: "Sleep Talk" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { OR: [183, 235, 219.14583333333334, 235, 235, 0], PL: [147, 235, 205.65624999999997, 235, 235, 0], PR: [147, 235, 205.65624999999997, 235, 235, 0] },
  },
  "T2M-ST-01-champions": {
    game: "champions",
    slots: { OL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 30 }, status: "slp", moves: ["Body Slam", "Earthquake", "Protect"], exactMoves: true, move: "Sleep Talk" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 1 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 3 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, move: null } },
    hp: { OR: [183, 235, 219.14583333333334, 235, 235, 0], PL: [147, 235, 205.65624999999997, 235, 235, 0], PR: [147, 235, 205.65624999999997, 235, 235, 0] },
  },
  "T2M-ST-02-usum": {
    game: "usum",
    slots: { OL: { species: "Komala", ability: "Comatose", moves: ["Wood Hammer", "Sucker Punch"], exactMoves: true, move: "Sleep Talk" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: "Body Slam", target: OR },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { OL: [112, 140, 127.125, 140, 112, 0], OR: [147, 160, 154.0625, 160, 147, 0], PL: [150, 235, 203.953125, 235, 235, 0], PR: [150, 235, 215.453125, 235, 235, 0] },
  },
  "T2M-ST-02b-usum": {
    game: "usum",
    slots: { OL: { species: "Komala", ability: "Comatose", moves: ["Rest", "Wood Hammer"], exactMoves: true, move: "Sleep Talk" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { OL: [112, 140, 127.125, 140, 112, 0], PL: [150, 235, 215.453125, 235, 235, 0], PR: [150, 235, 215.453125, 235, 235, 0] },
  },
  "T2P-CPY-01-sv": {
    game: "sv",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: OR } },
    hp: { OR: [139, 154, 147.0625, 154, 139, 0], PL: [196, 235, 217.1875, 235, 196, 0], PR: [125, 183, 156.6875, 183, 125, 0] },
  },
  "T2P-CPY-02-champions": {
    game: "champions", battleLastMove: "Body Slam",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", evs: { spe: 32 }, move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 1 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 3 }, move: null } },
    hp: { PL: [194, 235, 216.28125, 235, 194, 0], PR: [194, 235, 216.28125, 235, 194, 0] },
  },
  "T2P-CPY-03-sv": {
    game: "sv",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 248 }, move: "Protect" } },
    hp: {},
  },
  "T2P-CPY-04-swsh": {
    game: "swsh",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 200 }, move: "Protect" },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: OR } },
    hp: { PL: [196, 235, 217.1875, 235, 196, 0], PR: [125, 183, 156.6875, 183, 125, 0] },
  },
  "T2P-CPY-05-usum": {
    game: "usum",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 248 }, status: "par", move: "Body Slam", target: OL },
      PR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: OR } },
    hp: { OL: [89, 170, 114.546875, 103, 89, 0], OR: [139, 154, 147.0625, 154, 139, 0], PL: [196, 235, 217.1875, 235, 196, 0], PR: [125, 183, 156.6875, 183, 125, 0] },
  },
  "IN-CPY-01-sv": {
    game: "sv", battleLastMove: "Ember",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", evs: { spe: 252 }, move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 32 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PL: [226, 235, 231.09375, 235, 226, 0], PR: [226, 235, 231.09375, 235, 226, 0] },
  },
  "IN-CPY-01-usum": {
    game: "usum", battleLastMove: "Tackle",
    slots: { OL: { species: "Liepard", ability: "Limber", evs: { spe: 252 }, move: "Copycat" },
      OR: { species: "Shuckle", ability: "Sturdy", move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PL: [211, 235, 224.125, 235, 211, 0], PR: [211, 235, 224.125, 235, 211, 0] },
  },
  "IN-CPY-01b-sv": {
    game: "sv", battleLastMove: null,
    slots: { OL: { species: "Clefable", ability: "Magic Guard", evs: { spe: 252 }, move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 32 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: {},
  },
  "T2P-INS-01-sv": {
    game: "sv",
    slots: { OL: { species: "Oranguru", ability: "Inner Focus", move: "Instruct", target: OR },
      OR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: PR },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null } },
    hp: { PR: [43, 73, 59.125, 73, 43, 0] },
  },
  "T2P-INS-02-champions": {
    game: "champions",
    slots: { OL: { species: "Oranguru", ability: "Inner Focus", evs: { spe: 32 }, move: "Instruct", target: OR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 0 }, lastMove: "Earthquake", lastMoveTarget: null, move: "Body Slam", target: PR },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 1 }, move: null } },
    hp: { OL: [121, 128, 124.75, 128, 121, 0], PL: [183, 191, 187.4375, 191, 183, 0], PR: [95, 116, 106.5, 116, 95, 0] },
  },
  "T2P-INS-03-swsh": {
    game: "swsh",
    slots: { OL: { species: "Oranguru", ability: "Inner Focus", move: "Instruct", target: PR },
      OR: { species: "Oranguru", ability: "Inner Focus", evs: { spe: 4 }, move: "Instruct", target: PL },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: "Protect" },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, lastMove: null, move: null } },
    hp: {},
  },
  "T2P-INS-04-champions": {
    game: "champions",
    slots: { OL: { species: "Oranguru", ability: "Inner Focus", move: "Instruct", target: OR },
      OR: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 32 }, move: "Dragon Claw", target: PR },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 1 }, hp: 1, move: null } },
    hp: { PL: [139, 154, 147.0625, 154, 139, 0], PR: [0, 0, 0, 0, 0, 1] },
  },
  "T2P-INS-05-usum": {
    game: "usum",
    slots: { OL: { species: "Oranguru", ability: "Inner Focus", evs: { spe: 252 }, move: "Instruct", target: OR },
      OR: { species: "Garchomp", ability: "Rough Skin", lastMove: "Dragon Claw", lastMoveTarget: PL, move: "Dragon Claw", target: PR },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null } },
    hp: { PR: [43, 73, 59.125, 73, 43, 0] },
  },
  "T2M-HH-01-sv": {
    game: "sv",
    slots: { OL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 0 }, move: "Body Slam", target: PR },
      OR: { species: "Clefable", ability: "Magic Guard", move: "Helping Hand", target: OL },
      PL: { species: "Oranguru", ability: "Inner Focus", evs: { spe: 252 }, move: "Instruct", target: OR },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PR: [40, 70, 55.5, 70, 40, 0] },
  },
  "T2M-HH-01-champions": {
    game: "champions",
    slots: { OL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 0 }, move: "Body Slam", target: PR },
      OR: { species: "Clefable", ability: "Magic Guard", move: "Helping Hand", target: OL },
      PL: { species: "Oranguru", ability: "Inner Focus", evs: { spe: 32 }, move: "Instruct", target: OR },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, move: null } },
    hp: { PR: [40, 70, 55.5, 70, 40, 0] },
  },
  "T2M-UP-01-sv": {
    game: "sv",
    slots: { OL: { species: "Annihilape", ability: "Inner Focus", evs: { spe: 252 }, move: "Uproar" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, hp: 100, move: "Rest" },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, status: "slp", move: null },
      PR: { species: "Amoonguss", ability: "Effect Spore", move: "Spore", target: OL } },
    hp: { OR: [100, 100, 100, 100, 100, 0], PL: [212, 235, 224.59375, 235, 212, 0], PR: [160, 189, 175.84375, 189, 160, 0] },
  },
  "T2M-UP-01-swsh": {
    game: "swsh",
    slots: { OL: { species: "Exploud", ability: "Soundproof", evs: { spe: 252 }, move: "Uproar" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, hp: 100, move: "Rest" },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, status: "slp", move: null },
      PR: { species: "Amoonguss", ability: "Effect Spore", move: "Spore", target: OL } },
    hp: { OR: [100, 100, 100, 100, 100, 0], PL: [183, 235, 211.21875, 235, 183, 0], PR: [122, 189, 158.21875, 189, 122, 0] },
  },
  "T2E-UP-01-sv": {
    game: "sv",
    slots: { OL: { species: "Annihilape", ability: "Inner Focus", evs: { spe: 252 }, carried: { uproar: 2 }, move: "Uproar" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 24 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, carried: { yawn: true }, move: null } },
    hp: { PL: [212, 235, 224.59375, 235, 212, 0], PR: [212, 235, 224.59375, 235, 212, 0] },
  },
  "T2E-UP-01-champions": {
    game: "champions",
    slots: { OL: { species: "Annihilape", ability: "Inner Focus", evs: { spe: 32 }, carried: { uproar: 2 }, move: "Uproar" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 1 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 3 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 2 }, carried: { yawn: true }, move: null } },
    hp: { PL: [212, 235, 224.59375, 235, 212, 0], PR: [212, 235, 224.59375, 235, 212, 0] },
  },
  "CL-X-PRK-sv": {
    game: "sv", battleLastMove: "Dragon Claw",
    slots: { OL: { species: "Grafaiai", ability: "Prankster", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Umbreon", ability: "Synchronize", move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PR: [186, 235, 212.5, 235, 186, 0] },
  },
  "CL-X-STC-sv": {
    game: "sv",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 248 }, status: "slp", moves: ["Body Slam"], exactMoves: true, move: "Sleep Talk" },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null } },
    hp: { PL: [106, 235, 175.8125, 235, 106, 0], PR: [106, 235, 175.8125, 235, 106, 0] },
  },
  "CL-X-SPL-sv": {
    game: "sv",
    slots: { OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 248 }, move: null },
      PL: { species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 }, move: "Dragon Claw", target: OR },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 0 }, move: null } },
    hp: { OR: [139, 154, 147.0625, 154, 139, 0] },
  },
  "CL-X-UPS-sv": {
    game: "sv",
    slots: { OL: { species: "Noivern", ability: "Infiltrator", move: "Uproar" },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Amoonguss", ability: "Effect Spore", evs: { spe: 252 }, move: "Spore", target: OR },
      PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null } },
    hp: { PL: [141, 189, 167, 189, 141, 0], PR: [198, 235, 218.125, 235, 198, 0] },
  },
  "CL-X-GRV-usum": {
    game: "usum", field: { gravity: true },
    slots: { OL: { species: "Fearow", ability: "Keen Eye", evs: { spe: 252 }, move: "Mirror Move", target: PR },
      OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
      PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null },
      PR: { species: "Hitmonlee", ability: "Limber", lastMove: "High Jump Kick", move: null } },
    hp: {},
  },
};

// ------------------------------------------------------------------------------------------------------------------
// Nature Power (SwSh, USUM; PS/data/moves.ts naturepower; TP2·N1-N3)
// ------------------------------------------------------------------------------------------------------------------

describe("Nature Power: the terrain's move at its target, through the called move's own redirection (PS/data/moves.ts naturepower)", () => {
  it("SwSh, Electric Terrain: Thunderbolt at the target, taken by a Lightning Rod (T2P-NAT-01, TP2·N1, N2)", async () => {
    const c = CASES["T2P-NAT-01-swsh"];
    const result = await ready(c);
    expectHP(result, c);
    const step = stepOf(result, OL);
    expect(chance(step.facts, "Nature Power calls Thunderbolt.")).toBeCloseTo(1, 12);
    expect(chance(step.facts, `Lightning Rod: ${await nameOf(c, PR)} takes Thunderbolt.`)).toBeCloseTo(1, 12);
    expect(step).toMatchObject({ moveId: "naturepower", effectiveName: "Thunderbolt", effectiveType: "Electric" });
    // Nature Power's own hit reached its target (Showdown's hit loop: its onTryHit), the called Thunderbolt the Lightning Rod.
    expect(hitOf(step, PL)).toMatchObject({ kind: "effect", reached: 1 });
    expect(hitOf(step, PR)).toMatchObject({ kind: "blocked", reached: 1 });
  });
  for (const id of ["T2P-NAT-02-usum", "T2P-NAT-03-usum"]) {
    it(`${id}: Psychic on Psychic Terrain, Tri Attack on none (TP2·N1)`, async () => {
      const c = CASES[id];
      const result = await ready(c);
      expectHP(result, c);
      const called = id === "T2P-NAT-02-usum" ? "Psychic" : "Tri Attack";
      expect(chance(stepOf(result, OL).facts, `Nature Power calls ${called}.`)).toBeCloseTo(1, 12);
      expect(hitOf(stepOf(result, OL), PL)).toMatchObject({ kind: "calculated", reached: 1 });
    });
  }
  it("USUM: a Prankster Nature Power hits a foe that is not Dark (T2P-NAT-03b) and fails into a Dark one (TP2·N3)", async () => {
    const c = CASES["T2P-NAT-03b-usum"];
    expectHP(await ready(c), c);
    const dark: Case = { ...c, slots: { ...c.slots, OL: { ...c.slots.OL, target: PL } }, hp: {} };
    const result = await ready(dark);
    expectHP(result, dark);
    expect(chance(hitOf(stepOf(result, OL), PL)!.facts, "Prankster: Umbreon is not affected.")).toBeCloseTo(1, 12);
    expect(chance(stepOf(result, OL).facts, "Nature Power calls Tri Attack.")).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Me First and Mirror Move (USUM)
// ------------------------------------------------------------------------------------------------------------------

describe("Me First: the target's queued attack at 1.5x (PS/data/moves.ts mefirst onTryHit, its condition's onBasePower)", () => {
  it("before the target's Dragon Claw: Dragon Claw at 1.5x into it, 118-140 (T2P-MEF-01, TP2·MF1)", async () => {
    const c = CASES["T2P-MEF-01-usum"];
    const result = await ready(c);
    expectHP(result, c);
    const step = stepOf(result, OL);
    expect(chance(step.facts, "Me First calls Dragon Claw.")).toBeCloseTo(1, 12);
    expect(hitOf(step, PR)).toMatchObject({ kind: "calculated", min: 118, max: 140 });
  });
  it("into a status move it fails; into a spread Rock Slide it copies the spread move (T2P-MEF-02, TP2·MF2)", async () => {
    const c = CASES["T2P-MEF-02-usum"];
    const result = await ready(c);
    expectHP(result, c);
    expect(chance(hitOf(stepOf(result, OL), PR)!.facts, `Me First fails: ${await nameOf(c, PR)}'s move is not an attack.`)).toBeCloseTo(1, 12);
    const spread = stepOf(result, OR);
    expect(chance(spread.facts, "Me First calls Rock Slide.")).toBeCloseTo(1, 12);
    for (const slot of [PL, PR]) expect(hitOf(spread, slot)).toMatchObject({ kind: "calculated", min: 20, max: 24, reached: 1 });
  });
  it("a random-target move keeps Me First's target in Showdown, which the turn's own pick would not: the reason", async () => {
    const c: Case = {
      game: "usum", hp: {},
      slots: {
        OL: { species: "Absol", ability: "Justified", evs: { spe: 252 }, move: "Me First", target: PR }, OR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: null },
        PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: null }, PR: { species: "Salamence", ability: "Intimidate", move: "Outrage" },
      },
    };
    expect(await reason(c)).toBe("Me First with Outrage is not modelled in 2v2.");
  });
  it("context: 6144 for the called move only (not Me First, an instructed move or a copy)", () => {
    const kernel = { input: { pokemon: { [OL]: { action: { moveId: "mefirst" } } } } } as unknown as TurnKernel;
    const info = { transformed: false } as TurnMoveInfo;
    const action = (more: Partial<PendingAction>): PendingAction => ({ index: 0, slot: OL, moveId: "dragonclaw", target: PR, fractional: 0, ...more });
    expect(context(kernel, {} as World, action({}), PR, info)).toEqual({ powerMods: [6144] });
    expect(context(kernel, {} as World, action({ moveId: "mefirst" }), PR, info)).toBeUndefined();
    expect(context(kernel, {} as World, action({ source: "instruct" }), PR, info)).toBeUndefined();
    expect(context(kernel, {} as World, action({ external: true }), PR, info)).toBeUndefined();
    expect(context(kernel, {} as World, action({}), PR, { transformed: true } as TurnMoveInfo)).toBeUndefined();
  });
});

describe("Mirror Move: the target's last move with the mirror flag, at the target (PS/data/moves.ts mirrormove onTryHit)", () => {
  it("before the target moves: its last move from an earlier turn, the input's (T2P-MIR-02, TP2·MM2)", async () => {
    const c = CASES["T2P-MIR-02-usum"];
    const result = await ready(c);
    expectHP(result, c);
    expect(chance(stepOf(result, OL).facts, "Mirror Move calls Dragon Claw.")).toBeCloseTo(1, 12);
  });
  needs("CL-3")("after the target's Dragon Claw this turn: Dragon Claw at the target (T2P-MIR-01, TP2·MM1)", async () => {
    const c = CASES["T2P-MIR-01-usum"];
    expectHP(await ready(c), c);
  });
  it("Gravity stops the called High Jump Kick at its ModifyMove (PS/data/moves.ts gravity condition onModifyMove; cl/cases-extra.ts CL-X-GRV)", async () => {
    const c = CASES["CL-X-GRV-usum"];
    const result = await ready(c);
    expectHP(result, c);
    const step = stepOf(result, OL);
    expect(step.moves).toBeCloseTo(1, 12);
    expect(chance(step.facts, "Mirror Move calls High Jump Kick.")).toBeCloseTo(1, 12);
    expect(chance(step.facts, "Gravity: High Jump Kick cannot be used.")).toBeCloseTo(1, 12);
  });
  it("the last move from before the turn not given: the existing needs text (Q3)", async () => {
    const c = CASES["T2P-MIR-02-usum"];
    const unknown: Case = { ...c, slots: { ...c.slots, PR: { ...c.slots.PR, lastMove: undefined } } };
    expect(await reason(unknown)).toBe(`Mirror Move needs ${await nameOf(c, PR)}'s move from the last turn.`);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Sleep Talk (all four)
// ------------------------------------------------------------------------------------------------------------------

describe("Sleep Talk: a uniform pick over its callable moves, at a random foe (PS/data/moves.ts sleeptalk)", () => {
  it("Comatose counts as asleep: Wood Hammer or Sucker Punch, 1/2 each, at a random foe (T2M-ST-02, TP2·ST2)", async () => {
    const c = CASES["T2M-ST-02-usum"];
    const result = await ready(c);
    expectHP(result, c);
    const step = stepOf(result, OL);
    expect(chance(step.facts, "Sleep Talk calls Wood Hammer.")).toBeCloseTo(1 / 2, 12);
    expect(chance(step.facts, "Sleep Talk calls Sucker Punch.")).toBeCloseTo(1 / 2, 12);
    // Two moves called: no one effective move for the step.
    expect(step.effectiveName).toBeUndefined();
  });
  it("Rest is callable and fails under Comatose (T2M-ST-02b)", async () => {
    const c = CASES["T2M-ST-02b-usum"];
    const result = await ready(c);
    expectHP(result, c);
    expect(chance(stepOf(result, OL).facts, "Sleep Talk calls Rest.")).toBeCloseTo(1 / 2, 12);
  });
  needs("CL-5")("asleep with Body Slam, Earthquake and Protect: 1/3 each, Protect called through the early branch (T2M-ST-01, T2-ST01)", async () => {
    for (const id of ["T2M-ST-01-sv", "T2M-ST-01-champions"]) {
      const c = CASES[id];
      const result = await ready(c);
      expectHP(result, c);
      for (const move of ["Body Slam", "Earthquake", "Protect"]) expect(chance(stepOf(result, OL).facts, `Sleep Talk calls ${move}.`)).toBeCloseTo(1 / 3, 12);
    }
  });
  it("its user's moves not given: the reason (needsMoves); awake: it fails", async () => {
    const c = CASES["T2M-ST-02b-usum"];
    const unknown: Case = { ...c, slots: { ...c.slots, OL: { ...c.slots.OL, moves: undefined } } };
    expect(await reason(unknown)).toBe(`Sleep Talk needs ${await nameOf(c, OL)}'s moves.`);
    const awake: Case = { ...c, slots: { ...c.slots, OL: { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], move: "Sleep Talk" } }, hp: {} };
    const result = await ready(awake);
    expectHP(result, awake);
    expect(chance(stepOf(result, OL).facts, `Sleep Talk fails: ${await nameOf(awake, OL)} is awake.`)).toBeCloseTo(1, 12);
  });
  it("only uncallable moves (charge, nosleeptalk): it fails", async () => {
    const c: Case = { ...CASES["T2M-ST-02b-usum"], hp: {} };
    const none: Case = { ...c, slots: { ...c.slots, OL: { species: "Snorlax", ability: "Thick Fat", status: "slp", moves: ["Solar Beam", "Belch"], move: "Sleep Talk" } } };
    const result = await ready(none);
    expectHP(result, none);
    expect(chance(stepOf(result, OL).facts, `Sleep Talk fails: ${await nameOf(none, OL)} has no move it can call.`)).toBeCloseTo(1, 12);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Copycat (all four)
// ------------------------------------------------------------------------------------------------------------------

describe("Copycat: the battle's last move at a random foe (PS/data/moves.ts copycat, PS/sim/battle.ts clearActiveMove)", () => {
  needs("CL-4")("after a foe's Dragon Claw: Dragon Claw at a random foe, 1/2 each (T2P-CPY-01, TP2·CC1)", async () => {
    const c = CASES["T2P-CPY-01-sv"];
    const result = await ready(c);
    expectHP(result, c);
    const step = stepOf(result, OL);
    expect(chance(step.facts, "Copycat calls Dragon Claw.")).toBeCloseTo(1, 12);
    expect(step.effectiveName).toBe("Dragon Claw");
    // Copycat's own hit on its user (its hit steps reach it), and the called move's into each foe.
    expect(hitOf(step, OL)).toMatchObject({ kind: "effect", reached: 1 });
    expect(hitOf(step, PL)).toMatchObject({ kind: "calculated", reached: 0.5, min: 33, max: 39 });
    expect(hitOf(step, PR)).toMatchObject({ kind: "calculated", reached: 0.5, min: 48, max: 58 });
  });
  needs("CL-4")("moving first: the battle's last move before this turn (battleLastMove) (T2P-CPY-02, IN-CPY-01, IN-P11)", async () => {
    for (const id of ["T2P-CPY-02-champions", "IN-CPY-01-sv", "IN-CPY-01-usum"]) expectHP(await ready(CASES[id]), CASES[id]);
  });
  needs("CL-4")("after a blocked move (copied), after a fully paralysed foe (the move before it) (T2P-CPY-04, -05, TP2·CC4, CC5)", async () => {
    for (const id of ["T2P-CPY-04-swsh", "T2P-CPY-05-usum"]) expectHP(await ready(CASES[id]), CASES[id]);
  });
  needs("CL-4")("after Protect (failcopycat) and with no move used in the battle: it fails (T2P-CPY-03, IN-CPY-01b)", async () => {
    const protect = await ready(CASES["T2P-CPY-03-sv"]);
    expectHP(protect, CASES["T2P-CPY-03-sv"]);
    expect(chance(stepOf(protect, OL).facts, "Copycat fails: it cannot copy Protect.")).toBeCloseTo(1, 12);
    const none = await ready(CASES["IN-CPY-01b-sv"]);
    expectHP(none, CASES["IN-CPY-01b-sv"]);
    expect(chance(stepOf(none, OL).facts, "Copycat fails: no move has been used.")).toBeCloseTo(1, 12);
  });
  needs("CL-4")("after a Sleep Talk's call: the called Body Slam is the last move, not Sleep Talk; after a No move: Splash (CL-X-STC, CL-X-SPL)", async () => {
    const talk = await ready(CASES["CL-X-STC-sv"]);
    expectHP(talk, CASES["CL-X-STC-sv"]);
    expect(chance(stepOf(talk, OL).facts, "Copycat calls Body Slam.")).toBeCloseTo(1, 12);
    const splash = await ready(CASES["CL-X-SPL-sv"]);
    expectHP(splash, CASES["CL-X-SPL-sv"]);
    expect(chance(stepOf(splash, OL).facts, "Copycat calls Splash.")).toBeCloseTo(1, 12);
  });
  needs("CL-4")("a Prankster Copycat's called Dragon Claw is immune into a Dark foe it picks (pranksterBoosted; CL-X-PRK)", async () => {
    const c = CASES["CL-X-PRK-sv"];
    const result = await ready(c);
    expectHP(result, c);
    const hit = hitOf(stepOf(result, OL), PL)!;
    expect(hit).toMatchObject({ kind: "no-damage", reached: 0.5 });
    expect(chance(hit.facts, "Prankster: Umbreon is not affected.")).toBeCloseTo(0.5, 12);
  });
  it("moving first with the battle's last move not given: the reason (needsLastMoveUsed)", async () => {
    // Every Pokémon acts (no No move), so the wired and the unwired tree give the same reason.
    const c: Case = {
      game: "sv", hp: {},
      slots: {
        OL: { species: "Clefable", ability: "Magic Guard", evs: { spe: 252 }, move: "Copycat" }, OR: { species: "Snorlax", ability: "Thick Fat", move: "Body Slam", target: PL },
        PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: "Body Slam", target: OR }, PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: "Body Slam", target: OR },
      },
    };
    expect(await reason(c)).toBe("Copycat needs the last move used before this turn.");
  });
  it("USUM: a Z-Move in the turn is the battle's last move as the Z-Move (it fails Copycat), which the history does not keep: the reason", async () => {
    const c: Case = {
      game: "usum", hp: {}, battleLastMove: "Tackle",
      slots: {
        OL: { species: "Clefable", ability: "Magic Guard", move: "Copycat" }, OR: { species: "Snorlax", ability: "Thick Fat", move: "Body Slam", target: PL },
        PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, item: "Normalium Z", move: "Body Slam", target: OR, context: { useZ: true } },
        PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: "Body Slam", target: OR },
      },
    };
    expect(await reason(c)).toBe("Copycat with a Z-Move is not modelled in 2v2.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Instruct (all four) and Helping Hand twice (C26)
// ------------------------------------------------------------------------------------------------------------------

describe("Instruct: the target's last move again at once, prioritized next (PS/data/moves.ts instruct, sim/battle-queue.ts prioritizeAction)", () => {
  needs("CL-3, CL-6")("on an ally that moved this turn: its Dragon Claw again, the same target (T2P-INS-01, TP2·I1)", async () => {
    const c = CASES["T2P-INS-01-sv"];
    const result = await ready(c);
    expectHP(result, c);
    const copy = stepOf(result, OR, "Instruct");
    expect(copy).toMatchObject({ moveId: "dragonclaw", moves: 1 });
    expect(chance(copy.facts, "Instruct: Garchomp uses Dragon Claw again.")).toBeCloseTo(1, 12);
    expect(hitOf(copy, PR)).toMatchObject({ kind: "calculated", min: 81, max: 96 });
    expect(result.facts).toContain("Assumes Garchomp's Dragon Claw has PP left.");
  });
  needs("CL-6")("on a slower ally: its Earthquake from an earlier turn first, then its own Body Slam (T2P-INS-02, TP3·FU3)", async () => {
    const c = CASES["T2P-INS-02-champions"];
    const result = await ready(c);
    expectHP(result, c);
    expect(stepOf(result, OR, "Instruct")).toMatchObject({ moveId: "earthquake", moves: 1 });
  });
  needs("CL-3, CL-6")("a target fainted since: the instructed move is retargeted (T2P-INS-04, TP2·I4); lastMoveTarget given (T2P-INS-05)", async () => {
    for (const id of ["T2P-INS-04-champions", "T2P-INS-05-usum"]) expectHP(await ready(CASES[id]), CASES[id]);
  });
  it("Protect blocks Instruct; a target with no last move: it fails (T2P-INS-03, TP2·I3)", async () => {
    const c = CASES["T2P-INS-03-swsh"];
    const result = await ready(c);
    expectHP(result, c);
    expect(chance(hitOf(stepOf(result, OR), PL)!.facts, "Protect blocks Instruct.")).toBeCloseTo(1, 12);
    expect(chance(hitOf(stepOf(result, OL), PR)!.facts, `Instruct fails: ${await nameOf(c, PR)} has used no move.`)).toBeCloseTo(1, 12);
    expect(result.steps.some((step) => step.copied)).toBe(false);
  });
  it("an earlier turn's single-target move with no lastMoveTarget: the reason (needsLastTarget); no last move given: needsLastMove", async () => {
    const c = CASES["T2P-INS-05-usum"];
    // Garchomp slowest (0 Speed IVs, Brave) so that Instruct comes first.
    const slow = { ...c.slots.OR, nature: "Brave", ivs: { spe: 0 } };
    expect(await reason({ ...c, slots: { ...c.slots, OR: { ...slow, lastMoveTarget: undefined } } })).toBe("Instruct needs the target of Garchomp's last move.");
    expect(await reason({ ...c, slots: { ...c.slots, OR: { ...slow, lastMove: undefined, lastMoveTarget: undefined } } })).toBe("Instruct needs Garchomp's move from the last turn.");
  });
  needs("CL-3, CL-6")("Helping Hand twice: the instructed Helping Hand gives two (2.25x: Body Slam 165-195) (T2M-HH-01, C26)", async () => {
    for (const id of ["T2M-HH-01-sv", "T2M-HH-01-champions"]) {
      const c = CASES[id];
      const result = await ready(c);
      expectHP(result, c);
      expect(chance(stepOf(result, OR, "Instruct").facts, "Instruct: Clefable uses Helping Hand again.")).toBeCloseTo(1, 12);
      expect(hitOf(stepOf(result, OL), PR)).toMatchObject({ kind: "calculated", min: 165, max: 195 });
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Uproar (all four)
// ------------------------------------------------------------------------------------------------------------------

describe("Uproar: its hit wakes every sleeper; while it is up no Pokémon falls asleep (PS/data/moves.ts uproar)", () => {
  needs("CL-1, CL-2")("wakes an asleep foe; its ally's Rest and a foe's Spore then fail (T2M-UP-01, T2-UP01)", async () => {
    for (const id of ["T2M-UP-01-sv", "T2M-UP-01-swsh"]) {
      const c = CASES[id];
      const result = await ready(c);
      expectHP(result, c);
      // The sleeper wakes at every hit (a hit fact where it is the target, a step fact where the other foe is).
      const woken = `Uproar: ${await nameOf(c, PL)} wakes up.`;
      expect(chance(stepOf(result, OL).facts, woken) + chance(hitOf(stepOf(result, OL), PL)!.facts, woken)).toBeCloseTo(1, 12);
      expect(chance(hitOf(stepOf(result, OR), OR)!.facts, "Rest fails: Uproar.")).toBeCloseTo(1, 12);
      expect(chance(hitOf(stepOf(result, PR), OL)!.facts, `${await nameOf(c, OL)} cannot fall asleep: Uproar.`)).toBeCloseTo(1, 12);
      expect(result.facts).toContain(`Assumes ${await nameOf(c, OL)} did not use Uproar last turn.`);
    }
  });
  needs("CL-1, CL-2")("Uproar's hit first (Noivern is faster): a later Spore fails (CL-X-UPS)", async () => {
    const c = CASES["CL-X-UPS-sv"];
    const result = await ready(c);
    expectHP(result, c);
    expect(chance(hitOf(stepOf(result, PL), OR)!.facts, `${await nameOf(c, OR)} cannot fall asleep: Uproar.`)).toBeCloseTo(1, 12);
  });
  needs("CL-1, CL-2")("an Uproar from last turn: the turn is followed with no assumption about it (T2E-UP-01)", async () => {
    for (const id of ["T2E-UP-01-sv", "T2E-UP-01-champions"]) {
      const c = CASES[id];
      const result = await ready(c);
      expectHP(result, c);
      expect(result.facts).not.toContain(`Assumes ${await nameOf(c, OL)} did not use Uproar last turn.`);
    }
  });
  (wired ? it.skip : it)("a called Uproar (Copycat's) waits for CL-1 and CL-2: the reason", async () => {
    const c: Case = {
      game: "sv", hp: {}, battleLastMove: "Uproar",
      slots: {
        OL: { species: "Clefable", ability: "Magic Guard", evs: { spe: 252 }, move: "Copycat" }, OR: { species: "Snorlax", ability: "Thick Fat", move: "Body Slam", target: PL },
        PL: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 8 }, move: "Body Slam", target: OR }, PR: { species: "Snorlax", ability: "Thick Fat", evs: { spe: 16 }, move: "Body Slam", target: OR },
      },
    };
    expect(await reason(c)).toBe("Uproar is not modelled in 2v2.");
  });
  it("into awake foes only: followed today, with the assumption about last turn", async () => {
    const c: Case = { ...CASES["CL-X-UPS-sv"], slots: { ...CASES["CL-X-UPS-sv"].slots, PL: { species: "Amoonguss", ability: "Effect Spore", evs: { spe: 252 }, move: null } } };
    const result = await ready({ ...c, hp: {} }).catch(() => null);
    // Unwired (CL-1 / CL-2 not in) a turn with no sleep at all is followed already; its assumption stands either way.
    if (result) expect(result.facts).toContain("Assumes Noivern did not use Uproar last turn.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The guards that stay, the hooks on hand-made worlds
// ------------------------------------------------------------------------------------------------------------------

describe("the calling moves that stay guarded (ADDENDUM2 §2.3 #28)", () => {
  it("Metronome (its 553-607-move pool against the 160 calculations of the budget) and Assist (wave 2's bench)", async () => {
    const base = CASES["T2P-NAT-03-usum"];
    expect(await reason({ ...base, slots: { ...base.slots, OL: { species: "Clefable", ability: "Magic Guard", move: "Metronome" } } })).toBe("Metronome is not modelled in 2v2.");
    expect(await reason({ ...base, slots: { ...base.slots, OL: { species: "Liepard", ability: "Prankster", move: "Assist" } } })).toBe("Assist needs the moves of Liepard's party.");
  });
  it("a called move is the action's active move after it (a Dancer copies a called dance, a later Fusion move reads a called one): the reasons", async () => {
    const st = CASES["T2M-ST-01-sv"];
    const dancer: Case = { ...st, slots: { ...st.slots, OL: { ...st.slots.OL, moves: ["Swords Dance", "Body Slam"] }, PR: { species: "Oricorio", ability: "Dancer", move: null } } };
    expect(await reason(dancer)).toBe("Sleep Talk with Dancer is not modelled in 2v2.");
    const cp = CASES["T2P-CPY-01-sv"];
    const fusion: Case = { ...cp, slots: { ...cp.slots, PR: { species: "Reshiram", ability: "Turboblaze", move: "Fusion Flare", target: OR } } };
    expect(await reason(fusion)).toBe("Copycat with Fusion Flare is not modelled in 2v2.");
  });
  it("Instruct by a Protean or Libero user (its PrepareHit changes the type, which doubles-typing.ts leaves out): the reason", async () => {
    const { kernel, w } = await handMade();
    const instruct = { ...kernel, input: { ...kernel.input, pokemon: { ...kernel.input.pokemon, [OL]: { ...kernel.input.pokemon[OL]!, action: { moveId: "instruct", target: OR } } } },
      moveName: (id: string) => (id === "instruct" ? "Instruct" : id), abilityName: (id: string) => (id === "protean" ? "Protean" : id), typesIn: () => ["Water"],
      notEstimated: (text: string): never => { throw new Error(text); } } as unknown as TurnKernel;
    w.mons[OL]!.build = { ...w.mons[OL]!.build, abilityId: "protean", abilityActive: true };
    expect(() => callingGuard(instruct, w, OL)).toThrow("Instruct with Protean is not modelled in 2v2.");
    w.mons[OL]!.build = { ...w.mons[OL]!.build, abilityActive: false };
    expect(() => callingGuard(instruct, w, OL)).not.toThrow();
  });
});

/** A hand-made world for the hooks: four Snorlax (Thick Fat) in an SV turn. */
async function handMade(mons: Partial<Record<DoublesSlotId, Partial<MonState>>> = {}) {
  const runtime = await runtimeOf("scarlet_violet");
  const c: Case = { game: "sv", hp: {}, slots: { OL: { species: "Snorlax", ability: "Thick Fat", move: "uproar" }, OR: { species: "Snorlax", ability: "Thick Fat", move: null }, PL: { species: "Snorlax", ability: "Thick Fat", move: null }, PR: { species: "Snorlax", ability: "Thick Fat", move: null } } };
  const input = await inputOf(c);
  const facts: { text: string; mass: number; slot?: DoublesSlotId }[] = [];
  const kernel = {
    input, runtime, names: doublesNames(input.pokemon, runtime),
    alive: (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted,
    stepFact: (_action: PendingAction, text: string, mass: number) => { facts.push({ text, mass }); },
    hitFact: (_action: PendingAction, slot: DoublesSlotId, text: string, mass: number) => { facts.push({ text, mass, slot }); },
  } as unknown as TurnKernel;
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
  const mon = (slot: DoublesSlotId): MonState => ({
    build: input.pokemon[slot]!.build, fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0,
    hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {}, ...mons[slot],
  });
  const slots = [OL, OR, PL, PR];
  const w: World = {
    mass: 1, mons: Object.fromEntries(slots.map((slot) => [slot, mon(slot)])), sides: { own: { ...side }, opponent: { ...side } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining: [], executed: 0, factors: slots.map((slot) => pointFactor(slot, 235)),
  };
  return { kernel, w, facts, input };
}
const outcome = (landed: number, subHits = 0) => ({ landed, subHits } as unknown as TurnStepOutcome);
const uproarAction: PendingAction = { index: 0, slot: OL, moveId: "uproar", target: null, fractional: 0 };

describe("the hooks on a hand-made world", () => {
  it("afterHit: Uproar's hit wakes every sleeper in battle (Nightmare ends with the sleep) and starts its volatile (2 turns left after this one)", async () => {
    const { kernel, w, facts } = await handMade({
      [OR]: { build: { ...(await handMade()).w.mons[OR]!.build, status: "slp" }, vol: { sleep: { elapsed: 1, rest: false } }, eot: { nightmare: true } },
      [PR]: { build: { ...(await handMade()).w.mons[PR]!.build, status: "slp" }, vol: { sleep: { elapsed: 0, rest: true } } },
    });
    afterHit(kernel, w, uproarAction, PR, outcome(1), { transformed: false } as TurnMoveInfo);
    for (const slot of [OR, PR]) {
      expect(w.mons[slot]!.build.status).toBe("");
      expect(w.mons[slot]!.vol.sleep).toBeUndefined();
    }
    expect(w.mons[OR]!.eot.nightmare).toBeUndefined();
    expect(w.mons[OL]!.vol.uproar).toBe(2);
    expect(facts.map((fact) => [fact.text, fact.slot ?? null])).toEqual([["Uproar: Snorlax (yours, 2) wakes up.", null], ["Uproar: Snorlax (opponent's, 2) wakes up.", PR]]);
  });
  it("afterHit: no hit (blocked, immune), a Max Move's or Z-Move's, another move: nothing; a carried Uproar keeps its turns", async () => {
    const asleep = async () => handMade({ [OR]: { build: { ...(await handMade()).w.mons[OR]!.build, status: "slp" }, vol: { sleep: { elapsed: 0, rest: false } } } });
    for (const [action, out, info] of [
      [uproarAction, outcome(0), { transformed: false }], [uproarAction, outcome(1), { transformed: true }], [{ ...uproarAction, moveId: "hypervoice" }, outcome(1), { transformed: false }],
    ] as const) {
      const { kernel, w } = await asleep();
      afterHit(kernel, w, action, PR, out, info as TurnMoveInfo);
      expect(w.mons[OR]!.build.status).toBe("slp");
      expect(w.mons[OL]!.vol.uproar).toBeUndefined();
    }
    const { kernel, w } = await handMade({ [OL]: { vol: { uproar: 0 } } });
    afterHit(kernel, w, uproarAction, PR, outcome(0, 1), { transformed: false } as TurnMoveInfo);
    expect(w.mons[OL]!.vol.uproar).toBe(0);
  });
  it("uproarSleep: while a Pokémon in battle has the uproar volatile (a fainted or leaving holder's ends)", async () => {
    expect(uproarSleep((await handMade()).kernel, (await handMade()).w, OR)).toBe(false);
    const up = await handMade({ [PL]: { vol: { uproar: 1 } } });
    expect(uproarSleep(up.kernel, up.w, OR)).toBe(true);
    const fainted = await handMade({ [PL]: { vol: { uproar: 1 }, fainted: true } });
    expect(uproarSleep(fainted.kernel, fainted.w, OR)).toBe(false);
    const leaving = await handMade({ [PL]: { vol: { uproar: 1 } } });
    leaving.w.leaving = [PL];
    expect(uproarSleep(leaving.kernel, leaving.w, OR)).toBe(false);
  });
  it("ownsLastMove: the callers write the battle's last move themselves (CL-4); WIRED lists the integrator lines", () => {
    for (const id of ["naturepower", "copycat", "mirrormove", "mefirst", "sleeptalk"]) expect(ownsLastMove(id)).toBe(true);
    for (const id of ["instruct", "metronome", "dragonclaw", "splash"]) expect(ownsLastMove(id)).toBe(false);
    expect(Object.keys(WIRED).sort()).toEqual(["history", "instructOrder", "uproarHit", "uproarSleep", "usedMove"]);
    // Pinned callsMove (Protean waits for the called move): not Instruct.
    expect([...CALLS_MOVE].sort()).toEqual(["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk"]);
  });
});
