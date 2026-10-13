// FINAL2 (status2 final gate): a copy of int2/census/census-bench.ts writing build/final2/census/census-bench.json; nothing else changed.
// Integration 2 (ADDENDUM2 §8.7 step 3, "the census sample's switch family"): census-sim.ts's sample with a bench.
// The turns are census-sim.ts's, drawn verbatim from the same seed with the same calls (its `random` stream is untouched);
// each side's bench (2 Pokémon, as VGC's four brought; in SV only species whose default build the engine accepts on a bench) is
// drawn from a second stream (seed + 1_000_003), so every turn is the
// same turn as in census-sim's sample. Each turn runs three ways through calculateDoublesTurn:
//   plain:   as census-sim.ts (no bench: the switch-out reasons are the calculator without a Bench);
//   bench:   with `bench` (both sides, full HP, each with 4 drawn moves); no hazards;
//   hazards: with `bench` and Stealth Rock + 1 layer of Spikes on both sides (every newcomer's entry).
// The plain run must equal census-sim.final.json's counts (checked by the caller). Throws are kept as rows.
//
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/final2/census/census-bench.ts --n=8000 --sv=2000 --seed=7
// Writes scripts/.cache/calc-audit/status2/build/final2/census/census-bench.json.
import fs from "node:fs";
import path from "node:path";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import { DOUBLES_SLOTS, slotSide, type DoublesBenchPokemon, type DoublesPokemonInput, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const N = arg("n", 4000), NSV = arg("sv", 1000), SEED = arg("seed", 7);
const OUT = path.resolve("scripts/.cache/calc-audit/status2/build/final2/census/census-bench.json");

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
const random = rng(SEED);
const benchRandom = rng(SEED + 1_000_003);
const weightedBy = <T extends { weight: number }>(r: () => number, list: readonly T[]): T | undefined => {
  const total = list.reduce((sum, e) => sum + e.weight, 0);
  let x = r() * total;
  for (const e of list) { x -= e.weight; if (x <= 0) return e; }
  return list[list.length - 1];
};
const weighted = <T extends { weight: number }>(list: readonly T[]) => weightedBy(random, list);
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
const pickBy = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];

const WEATHER_SETTERS: Record<string, BattleConditions["weather"]> = { drought: "Sun", drizzle: "Rain", sandstream: "Sand", snowwarning: "Snow", orichalcumpulse: "Sun", megasol: "Sun" };
const TERRAIN_SETTERS: Record<string, BattleConditions["terrain"]> = { electricsurge: "Electric", grassysurge: "Grassy", psychicsurge: "Psychic", mistysurge: "Misty", hadronengine: "Electric", seedsower: "" };

type UsageRow = { sets: number; moves: { id: string; weight: number }[]; items: { id: string; weight: number }[]; spreads: { nature: string; points: Record<string, number>; weight: number }[]; abilities: { id: string; weight: number }[] };
type Usage = { species: Record<string, UsageRow> };

// ---- census-sim.ts's sampler, verbatim in its draws ----
function finishInput(runtime: BattleRuntime, pokemon: Record<DoublesSlotId, DoublesPokemonInput | null>, field: BattleConditions): DoublesTurnInput {
  const input: DoublesTurnInput = { runtime, field, pokemon };
  for (const slot of DOUBLES_SLOTS) {
    const entry = pokemon[slot];
    if (!entry?.action.moveId) continue;
    const rule = doublesTargetRule(input, slot, entry.action.moveId);
    if (rule.kind === "choose") entry.action = { ...entry.action, target: rule.options.length ? pick(rule.options) : null };
  }
  return input;
}
function usageBuild(runtime: BattleRuntime, s: { id: string; row: UsageRow }, draw: <T extends { weight: number }>(list: readonly T[]) => T | undefined): BattleBuild {
  const ability = draw(s.row.abilities)?.id ?? "";
  const item = draw(s.row.items)?.id ?? "";
  const spread = draw(s.row.spreads);
  const b = createBuild(s.id, runtime);
  return { ...b, abilityId: ability || b.abilityId, abilityActive: defaultAbilityActive(ability || b.abilityId), itemId: item, nature: spread?.nature ?? "Serious",
    ...(b.game === "champions" ? { points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(spread?.points ?? {}) } } : {}) } as BattleBuild;
}
function championsTurn(runtime: BattleRuntime, usage: Usage): DoublesTurnInput | null {
  const species = Object.entries(usage.species).map(([id, row]) => ({ id, row, weight: row.sets }));
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const used = new Set<string>();
  let weather: BattleConditions["weather"] = "", terrain: BattleConditions["terrain"] = "";
  let weatherSpeed = Infinity, terrainSpeed = Infinity;
  for (const slot of DOUBLES_SLOTS) {
    let built: { build: BattleBuild; moveId: string } | null = null;
    for (let tries = 0; tries < 30 && !built; tries++) {
      const s = weighted(species)!;
      const base = s.id.replace(/mega[xy]?$/, "");
      const key = `${slotSide(slot)}:${base}`;
      if (used.has(key) || !runtime.speciesById.has(s.id)) continue;
      const build = usageBuild(runtime, s, weighted);
      if (validateBuild(build, runtime).length) continue;
      const known = runtime.speciesById.get(s.id)!;
      const moves = s.row.moves.filter((m) => known.moves.includes(m.id) && runtime.movesById.has(m.id) && !runtime.movesById.get(m.id)!.unsupported.length);
      const move = weighted(moves);
      if (!move) continue;
      used.add(key);
      built = { build, moveId: move.id };
    }
    if (!built) return null;
    const speed = getBuildStats(built.build, runtime)?.spe ?? 0;
    const w = WEATHER_SETTERS[built.build.abilityId], t = TERRAIN_SETTERS[built.build.abilityId];
    if (w && speed <= weatherSpeed) { weather = w; weatherSpeed = speed; }
    if (t && speed <= terrainSpeed) { terrain = t; terrainSpeed = speed; }
    pokemon[slot] = { build: built.build, contexts: {}, charged: false, action: { moveId: built.moveId, target: null } };
  }
  return finishInput(runtime, pokemon, { ...createConditions(), gameType: "Doubles", weather, terrain });
}
function svTurn(runtime: BattleRuntime): DoublesTurnInput {
  const sets = (runtime.catalog as unknown as { randomBattle: { formats: { Doubles: { species: Record<string, string[]> } } } }).randomBattle.formats.Doubles.species;
  const ids = Object.keys(sets).filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  for (const slot of DOUBLES_SLOTS) {
    const id = pick(ids);
    const known = runtime.speciesById.get(id)!;
    const moves = sets[id].filter((m) => known.moves.includes(m) && runtime.movesById.get(m) && !runtime.movesById.get(m)!.unsupported.length);
    pokemon[slot] = { build: createBuild(id, runtime), contexts: {}, charged: false, action: { moveId: moves.length ? pick(moves) : null, target: null } };
  }
  return finishInput(runtime, pokemon, { ...createConditions(), gameType: "Doubles" });
}

// ---- the bench (second stream only) ----
const SIDES: DoublesSideId[] = ["own", "opponent"];
const baseOf = (id: string) => id.replace(/mega[xy]?$/, "").replace(/-?mega(-?[xy])?$/, "");
function championsBench(runtime: BattleRuntime, usage: Usage, input: DoublesTurnInput): Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> {
  const species = Object.entries(usage.species).map(([id, row]) => ({ id, row, weight: row.sets }));
  const draw = <T extends { weight: number }>(list: readonly T[]) => weightedBy(benchRandom, list);
  const bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> = {};
  for (const side of SIDES) {
    const used = new Set(DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side).map((slot) => baseOf(input.pokemon[slot]!.build.speciesId)));
    const list: DoublesBenchPokemon[] = [];
    for (let tries = 0; tries < 60 && list.length < 2; tries++) {
      const s = draw(species)!;
      if (used.has(baseOf(s.id)) || !runtime.speciesById.has(s.id)) continue;
      const build = usageBuild(runtime, s, draw);
      if (validateBuild(build, runtime).length) continue;
      const known = runtime.speciesById.get(s.id)!;
      const pool = s.row.moves.filter((m) => known.moves.includes(m.id) && runtime.movesById.has(m.id));
      const moves: string[] = [];
      while (moves.length < 4 && moves.length < pool.length) { const m = draw(pool.filter((each) => !moves.includes(each.id))); if (m) moves.push(m.id); else break; }
      used.add(baseOf(s.id));
      list.push({ id: `${side}-bench-${list.length + 1}`, build, moves });
    }
    bench[side] = list;
  }
  return bench;
}
/**
 * Whether a Random Battle species' default build is a valid bench Pokémon (the engine's own validation: not a battle-only form
 * such as a Terastal one, not a form that needs a move it lacks); census-sim's actives keep its draws as they are.
 */
const benchValid = new Map<string, boolean>();
function validBench(runtime: BattleRuntime, id: string): boolean {
  const known = benchValid.get(id);
  if (known !== undefined) return known;
  const idle = (speciesId: string): DoublesPokemonInput => ({ build: createBuild(speciesId, runtime), contexts: {}, charged: false, action: { moveId: null, target: null } });
  const result = calculateDoublesTurn({ runtime, field: { ...createConditions(), gameType: "Doubles" },
    pokemon: { "own-left": idle("snorlax"), "own-right": idle("snorlax"), "opponent-left": idle("snorlax"), "opponent-right": idle("snorlax") },
    bench: { own: [{ id: "probe", build: createBuild(id, runtime) }] } });
  const ok = result.status !== "issues";
  benchValid.set(id, ok);
  return ok;
}
function svBench(runtime: BattleRuntime, input: DoublesTurnInput): Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> {
  const sets = (runtime.catalog as unknown as { randomBattle: { formats: { Doubles: { species: Record<string, string[]> } } } }).randomBattle.formats.Doubles.species;
  const ids = Object.keys(sets).filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
  const bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> = {};
  for (const side of SIDES) {
    const used = new Set(DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side).map((slot) => input.pokemon[slot]!.build.speciesId));
    const list: DoublesBenchPokemon[] = [];
    for (let tries = 0; tries < 60 && list.length < 2; tries++) {
      const id = pickBy(benchRandom, ids);
      if (used.has(id) || !validBench(runtime, id)) continue;
      const known = runtime.speciesById.get(id)!;
      const moves = sets[id].filter((m) => known.moves.includes(m) && runtime.movesById.get(m)).slice(0, 4);
      used.add(id);
      list.push({ id: `${side}-bench-${list.length + 1}`, build: createBuild(id, runtime), moves });
    }
    bench[side] = list;
  }
  return bench;
}

type Res = { s: string; r?: string; e?: string; ms: number; replaced?: number };
function run(input: DoublesTurnInput): Res {
  const t0 = performance.now();
  try {
    const result = calculateDoublesTurn(input);
    const ms = +(performance.now() - t0).toFixed(2);
    if (result.status === "not-estimated") return { s: "not-estimated", r: result.reason, ms };
    if (result.status === "issues") return { s: "issues", r: JSON.stringify(result.issues).slice(0, 200), ms };
    return { s: "ready", e: result.endOfTurn.status === "ready" ? "ready" : result.endOfTurn.reason, ms, replaced: Object.keys(result.replaced ?? {}).length + (result.endOfTurn.status === "ready" ? Object.keys(result.endOfTurn.replaced ?? {}).length : 0) };
  } catch (error) {
    return { s: "throw", r: `THROW ${(error as Error).message}`.slice(0, 200), ms: +(performance.now() - t0).toFixed(2) };
  }
}
type Row = { actions: string; bench: string; plain: Res; bench1: Res; hazards: Res };
const actionsOf = (input: DoublesTurnInput) => DOUBLES_SLOTS.map((slot) => { const e = input.pokemon[slot]!; return `${e.build.speciesId}[${e.build.abilityId}/${e.build.itemId || "-"}] ${e.action.moveId ?? "-"}${e.action.target ? `>${e.action.target}` : ""}`; }).join(" | ");
const benchOf = (bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>>) => SIDES.map((side) => `${side}: ${(bench[side] ?? []).map((b) => `${b.build.speciesId}[${b.build.abilityId}/${b.build.itemId || "-"}]`).join(", ")}`).join("; ");
const HAZARDS = { own: { stealthRock: true as const, spikes: 1 as const }, opponent: { stealthRock: true as const, spikes: 1 as const } };
function three(input: DoublesTurnInput, bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>>): Row {
  const plain = run(input);
  const bench1 = run({ ...input, bench });
  const hazards = run({ ...input, bench, hazards: HAZARDS });
  return { actions: actionsOf(input), bench: benchOf(bench), plain, bench1, hazards };
}

(async () => {
  const t0 = performance.now();
  const champions = await loadBattleRuntime("champions");
  const usage = JSON.parse(fs.readFileSync("data/champions/training-usage.json", "utf8")) as Usage;
  const rows: Row[] = [];
  let skipped = 0;
  while (rows.length < N) {
    const input = championsTurn(champions, usage);
    if (!input) { skipped++; continue; }
    rows.push(three(input, championsBench(champions, usage, input)));
  }
  const sv = await loadBattleRuntime("scarlet_violet");
  const svRows: Row[] = [];
  for (let i = 0; i < NSV; i++) { const input = svTurn(sv); svRows.push(three(input, svBench(sv, input))); }
  const ms = Math.round(performance.now() - t0);
  fs.writeFileSync(OUT, JSON.stringify({ seed: SEED, benchSeed: SEED + 1_000_003, ms, skipped, champions: rows, sv: svRows }));
  console.log(`census-bench: seed ${SEED}, ${rows.length} Champions (skipped ${skipped}) + ${svRows.length} SV turns, ${ms} ms; wrote ${path.relative(process.cwd(), OUT)}`);
})();
