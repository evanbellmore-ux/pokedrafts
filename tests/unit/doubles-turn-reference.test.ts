import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame } from "@/app/lib/battle/types";
import { USES_REFERENCE } from "@/app/lib/battle/uses-to-ko";

/**
 * SPEC §8.3: the optimised turn (factor splitting, mixture merges, memoised searches) equals the reference turn
 * (DOUBLES_REFERENCE.on with USES_REFERENCE.on: every state's whole calculation rerun) to 1e-12, on seeded random turns from
 * the Champions usage sets (data/champions/move-usage.json) and the native Random Battle Doubles sets.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ITEMS = ["sitrusberry", "lifeorb", "focussash", "choiceband", "choicespecs", "rockyhelmet", "leftovers", "assaultvest", "shellbell", "occaberry", ""];
const SPREAD = new Set(["allAdjacent", "allAdjacentFoes"]);

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sets(runtime: BattleRuntime): Map<string, string[]> {
  if (runtime.profile.id === "champions") {
    const usage = JSON.parse(readFileSync("data/champions/move-usage.json", "utf8")) as { formats: { Doubles: { species: Record<string, string[]> } } };
    return new Map(Object.entries(usage.formats.Doubles.species));
  }
  // The generation 7 and 8 catalogs carry Random Battle Singles sets only.
  const formats = (runtime.catalog as { randomBattle?: { formats: Partial<Record<"Singles" | "Doubles", { species: Record<string, string[]> }>> } }).randomBattle?.formats;
  return new Map(Object.entries(formats?.Doubles?.species ?? formats?.Singles?.species ?? {}));
}
/** A typical turn: four set Pokémon, each with one of its moves (at most two spread moves) or No move, an item, some HP lost. */
function fuzzTurn(runtime: BattleRuntime, random: () => number): DoublesTurnInput {
  const pool = sets(runtime);
  const ids = [...pool.keys()].filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  let spread = 0;
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  for (const slot of SLOTS) {
    const id = pick(ids);
    const species = runtime.speciesById.get(id)!;
    const moves = pool.get(id)!.filter((m) => {
      const move = runtime.movesById.get(m);
      return move && species.moves.includes(m) && !move.unsupported.length && (spread < 2 || !SPREAD.has(move.target));
    });
    const moveId = moves.length && random() < 0.9 ? pick(moves) : null;
    if (moveId && SPREAD.has(runtime.movesById.get(moveId)!.target)) spread++;
    const base = createBuild(id, runtime);
    const abilities = species.abilities.filter((a) => !runtime.abilitiesById.get(a)?.unsupported.length);
    const abilityId = abilities.length ? pick(abilities) : base.abilityId;
    const item = base.itemId || pick(ITEMS.filter((i) => !i || runtime.itemsById.has(i)));
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: item } as BattleBuild;
    pokemon[slot] = { build, contexts: {}, charged: false, action: { moveId, target: null } };
  }
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
  for (const slot of SLOTS) {
    const entry = pokemon[slot]!;
    if (!entry.action.moveId) continue;
    const rule = doublesTargetRule(input, slot, entry.action.moveId);
    if (rule.kind === "choose") entry.action = { ...entry.action, target: pick(rule.options) };
  }
  return input;
}

/** Equal, numbers within 1e-12 (relative above 1). */
function expectClose(a: unknown, b: unknown, path: string) {
  if (typeof a === "number" && typeof b === "number") {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path}.length`).toBe(b.length);
    a.forEach((value, i) => expectClose(value, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) expectClose((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    return;
  }
  expect(a, path).toEqual(b);
}

function reference(input: DoublesTurnInput): DoublesTurnResult {
  DOUBLES_REFERENCE.on = true;
  USES_REFERENCE.on = true;
  try {
    return calculateDoublesTurn(input);
  } finally {
    DOUBLES_REFERENCE.on = false;
    USES_REFERENCE.on = false;
  }
}

describe("the optimised 2v2 turn equals the reference turn", () => {
  const games: BattleGame[] = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"];
  for (const game of games) {
    it(`on seeded ${game} turns`, async () => {
      const runtime = await loadBattleRuntime(game);
      const random = rng(games.indexOf(game) + 1);
      let ready = 0;
      for (let i = 0; i < 8; i++) {
        const input = fuzzTurn(runtime, random);
        const fast = calculateDoublesTurn(input);
        const slow = reference(input);
        expectClose(fast, slow, `${game} turn ${i}`);
        if (fast.status === "ready") ready++;
      }
      // The sets give mostly estimated turns, so the comparison is not only of guards.
      expect(ready).toBeGreaterThan(0);
    }, 240_000);
  }
});
