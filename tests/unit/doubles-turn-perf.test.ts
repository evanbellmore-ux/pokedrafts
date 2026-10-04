import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesMoves, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleGame } from "@/app/lib/battle/types";

/**
 * SPEC §9 budgets with 3× slack for a shared test machine: calculateDoublesTurn p50 ≤ 90 ms and p95 ≤ 360 ms over typical
 * turns (four actions, at most two spread moves), every turn ≤ 1200 ms (a "Too many cases to follow" result included), and the
 * Moves pane for a full learnset ≤ 75 ms. Budgets are counts, so results never depend on time; this only guards the cost.
 * The Node bench without slack is scripts/.cache/calc-audit/2v2/verify/bench.ts.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
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
function typicalTurn(runtime: BattleRuntime, random: () => number): DoublesTurnInput {
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
      return move && move.category !== "Status" && species.moves.includes(m) && !move.unsupported.length && (spread < 2 || !SPREAD.has(move.target));
    });
    const moveId = moves.length ? pick(moves) : null;
    if (moveId && SPREAD.has(runtime.movesById.get(moveId)!.target)) spread++;
    pokemon[slot] = { build: createBuild(id, runtime), contexts: {}, charged: false, action: { moveId, target: null } };
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
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))];

describe("2v2 performance (SPEC §9, 3× slack)", () => {
  it("calculates typical turns within the budget", async () => {
    const games: BattleGame[] = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"];
    const random = rng(7);
    const inputs: DoublesTurnInput[] = [];
    for (let i = 0; i < 60; i++) inputs.push(typicalTurn(await loadBattleRuntime(games[i % games.length]), random));
    for (const input of inputs.slice(0, 4)) calculateDoublesTurn(input);
    const times = inputs.map((input) => {
      const start = performance.now();
      calculateDoublesTurn(input);
      return performance.now() - start;
    });
    expect(percentile(times, 0.5)).toBeLessThanOrEqual(90);
    expect(percentile(times, 0.95)).toBeLessThanOrEqual(360);
    expect(Math.max(...times)).toBeLessThanOrEqual(1200);
  }, 120_000);

  it("lists a full learnset in the Moves pane within the budget", () => {
    const build = (id: string) => ({ build: createBuild(id, championsRuntime), contexts: {}, charged: false, action: { moveId: null, target: null } });
    const input: DoublesTurnInput = {
      runtime: championsRuntime, field: { ...createConditions(), gameType: "Doubles" },
      pokemon: { "own-left": build("garchomp"), "own-right": build("charizard"), "opponent-left": build("venusaur"), "opponent-right": build("blastoise") },
    };
    calculateDoublesMoves(input, "own-right", "opponent-left");
    const times = (["own-left", "opponent-right"] as const).map((slot) => {
      const fresh = { ...input, pokemon: { ...input.pokemon } };
      const start = performance.now();
      const rows = calculateDoublesMoves(fresh, slot, slot === "own-left" ? "opponent-left" : "own-right");
      const ms = performance.now() - start;
      expect(rows.results.length).toBeGreaterThan(40);
      return ms;
    });
    expect(Math.max(...times)).toBeLessThanOrEqual(75);
  });
});
