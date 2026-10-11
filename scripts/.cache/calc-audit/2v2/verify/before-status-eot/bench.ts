// SPEC §9 performance bench (Node): calculateDoublesTurn over every V case plus 200 fuzzed typical turns (four actions, at most
// two spread moves), and calculateDoublesMoves for a full learnset.
// Targets: turn p50 ≤ 30 ms, p95 ≤ 120 ms, every case ≤ 400 ms (a "Too many cases to follow" result included);
// Moves pane ≤ 25 ms.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/bench.ts [--fuzz=200] [--seed=1]
// Writes scripts/.cache/calc-audit/2v2/verify/results/bench.json.
import fs from "node:fs";
import path from "node:path";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import type { MatchupResult } from "@/app/lib/battle/calculate";
import { CASES } from "./cases";
import { caseInput, runtimeFor } from "./app-turn";

type Engine = {
  calculateDoublesTurn: (input: DoublesTurnInput) => DoublesTurnResult;
  calculateDoublesMoves: (input: DoublesTurnInput, slot: DoublesSlotId, into: DoublesSlotId) => MatchupResult;
};
type Targets = {
  doublesTargetRule: (input: DoublesTurnInput, slot: DoublesSlotId, moveId: string) => import("@/app/lib/battle/doubles-types").DoublesTargetRule;
};

export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPREAD = new Set(["allAdjacent", "allAdjacentFoes"]);
/** Doubles sets: the Champions usage snapshot and the native Random Battle Doubles sets (SPEC §8.3). */
export function doublesSets(runtime: BattleRuntime): Map<string, string[]> {
  if (runtime.profile.id === "champions") {
    const usage = JSON.parse(fs.readFileSync("data/champions/move-usage.json", "utf8")) as { formats: { Doubles: { species: Record<string, string[]> } } };
    return new Map(Object.entries(usage.formats.Doubles.species));
  }
  // The generation 7 and 8 catalogs carry Random Battle Singles sets only.
  const formats = (runtime.catalog as { randomBattle?: { formats: Partial<Record<"Singles" | "Doubles", { species: Record<string, string[]> }>> } }).randomBattle?.formats;
  return new Map(Object.entries(formats?.Doubles?.species ?? formats?.Singles?.species ?? {}));
}

/** One typical turn: four Pokémon with sets, each using a damaging move (at most two spread moves) at a random valid target. */
export function fuzzTurn(runtime: BattleRuntime, sets: Map<string, string[]>, random: () => number, targets: Targets): DoublesTurnInput {
  const ids = [...sets.keys()].filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  let spread = 0;
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  for (const slot of DOUBLES_SLOTS) {
    const id = pick(ids);
    const species = runtime.speciesById.get(id)!;
    const moves = sets.get(id)!.filter((m) => {
      const move = runtime.movesById.get(m);
      return move && move.category !== "Status" && species.moves.includes(m) && !move.unsupported.length && (spread < 2 || !SPREAD.has(move.target));
    });
    const moveId = moves.length ? pick(moves) : null;
    if (moveId && SPREAD.has(runtime.movesById.get(moveId)!.target)) spread++;
    pokemon[slot] = { build: createBuild(id, runtime), contexts: {}, charged: false, action: { moveId, target: null } };
  }
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
  for (const slot of DOUBLES_SLOTS) {
    const entry = pokemon[slot]!;
    if (!entry.action.moveId) continue;
    const rule = targets.doublesTargetRule(input, slot, entry.action.moveId);
    if (rule.kind === "choose") entry.action = { ...entry.action, target: pick(rule.options) };
  }
  return input;
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/bench.ts")) {
  (async () => {
    const args = process.argv.slice(2);
    const fuzz = Number(args.find((a) => a.startsWith("--fuzz="))?.split("=")[1] ?? 200);
    const seed = Number(args.find((a) => a.startsWith("--seed="))?.split("=")[1] ?? 1);
    const engine = await import("@/app/lib/battle/doubles-turn") as unknown as Engine;
    const targets = await import("@/app/lib/battle/doubles-targets") as unknown as Targets;
    const timed = (input: DoublesTurnInput) => {
      const t0 = performance.now();
      const result = engine.calculateDoublesTurn(input);
      return { ms: performance.now() - t0, result };
    };
    const rows: { id: string; ms: number; status: string; reason?: string }[] = [];
    // Warm the engine chunk and the catalogs.
    for (const c of CASES.slice(0, 3)) timed(caseInput(c, await runtimeFor(c)));
    for (const c of CASES) {
      const input = caseInput(c, await runtimeFor(c));
      const { ms, result } = timed(input);
      rows.push({ id: c.id, ms, status: result.status, ...(result.status === "not-estimated" ? { reason: result.reason } : {}) });
    }
    const random = rng(seed);
    const fuzzRows: typeof rows = [];
    const games = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const;
    for (let i = 0; i < fuzz; i++) {
      const runtime = await loadBattleRuntime(games[i % games.length]);
      const input = fuzzTurn(runtime, doublesSets(runtime), random, targets);
      const { ms, result } = timed(input);
      fuzzRows.push({ id: `fuzz-${i}-${runtime.profile.id}`, ms, status: result.status, ...(result.status === "not-estimated" ? { reason: result.reason } : {}) });
    }
    const moves: { slot: DoublesSlotId; into: DoublesSlotId; ms: number; rows: number }[] = [];
    for (const c of CASES.filter((x) => !x.notEstimated).slice(0, 12)) {
      const input = caseInput(c, await runtimeFor(c));
      for (const slot of ["own-left", "opponent-right"] as const) {
        const into: DoublesSlotId = slot === "own-left" ? "opponent-left" : "own-right";
        if (!input.pokemon[slot] || !input.pokemon[into]) continue;
        const t0 = performance.now();
        const out = engine.calculateDoublesMoves(input, slot, into);
        moves.push({ slot, into, ms: performance.now() - t0, rows: out.results.length });
      }
    }
    const all = [...rows, ...fuzzRows].map((r) => r.ms);
    const summary = {
      turn: { p50: pct(all, 0.5), p95: pct(all, 0.95), max: Math.max(...all), n: all.length, targets: { p50: 30, p95: 120, max: 400 } },
      movesPane: { max: Math.max(...moves.map((m) => m.ms)), p50: pct(moves.map((m) => m.ms), 0.5), n: moves.length, target: 25 },
      slowest: [...rows, ...fuzzRows].sort((a, b) => b.ms - a.ms).slice(0, 10),
      statuses: Object.fromEntries(["ready", "not-estimated", "issues"].map((s) => [s, [...rows, ...fuzzRows].filter((r) => r.status === s).length])),
      reasons: Object.entries([...rows, ...fuzzRows].reduce<Record<string, number>>((acc, r) => (r.reason ? { ...acc, [r.reason]: (acc[r.reason] ?? 0) + 1 } : acc), {})).sort((a, b) => b[1] - a[1]),
    };
    fs.writeFileSync(path.resolve("scripts/.cache/calc-audit/2v2/verify/results/bench.json"), JSON.stringify({ summary, rows, fuzzRows, moves }, null, 1));
    console.log(JSON.stringify(summary, null, 1));
  })();
}
