// CENSUS 2 probe: which "not estimated" reasons typical turns meet today. Usage-weighted random 2v2 turns, run through the
// app's calculateDoublesTurn (no app code changed), with a histogram of the turn's reason and of the end of turn's reason.
//
// Champions: data/champions/training-usage.json (Smogon gen9championsvgc2026regmb 2026-08, cutoff 1630). Four species
// drawn by their share of the sets (no species twice on a side), each with an ability, item and spread drawn by their
// weights, and one move of any category drawn by its set share (Protect, Fake Out and the rest as they are carried; a
// move the engine cannot take is redrawn), aimed at a random legal target. The weather or terrain a drawn setter would
// leave (the slowest setter's, as the lead switch-ins order them) is put on the field; nothing else from earlier turns.
// Scarlet/Violet: the catalog's Random Battle Doubles sets (damaging moves only, default ability, no item): a weak proxy,
// kept apart.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-sim.ts [--n=4000] [--sv=1000] [--seed=7]
// Writes scripts/.cache/calc-audit/status2/design/census-sim.out.json.
import fs from "node:fs";
import path from "node:path";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import { DOUBLES_SLOTS, slotSide, turnNames, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const N = arg("n", 4000), NSV = arg("sv", 1000), SEED = arg("seed", 7);

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
const weighted = <T extends { weight: number }>(list: readonly T[]): T | undefined => {
  const total = list.reduce((sum, e) => sum + e.weight, 0);
  let r = random() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return list[list.length - 1];
};
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];

const WEATHER_SETTERS: Record<string, BattleConditions["weather"]> = { drought: "Sun", drizzle: "Rain", sandstream: "Sand", snowwarning: "Snow", orichalcumpulse: "Sun", megasol: "Sun" };
const TERRAIN_SETTERS: Record<string, BattleConditions["terrain"]> = { electricsurge: "Electric", grassysurge: "Grassy", psychicsurge: "Psychic", mistysurge: "Misty", hadronengine: "Electric", seedsower: "" };

type Usage = { species: Record<string, { sets: number; moves: { id: string; weight: number }[]; items: { id: string; weight: number }[]; spreads: { nature: string; points: BattleBuild extends infer _ ? Record<string, number> : never; weight: number }[]; abilities: { id: string; weight: number }[] }> };

type Row = { status: string; reason?: string; end?: string; actions: string; switchBy?: string };
const SELF_SWITCH = new Set(["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "shedtail", "chillyreception"]);
const DRAGS = new Set(["roar", "whirlwind", "dragontail", "circlethrow"]);
/** The trigger of a switch-out reason: the named Pokémon's item, ability or move, else a drag or a Red Card in the turn. */
function switchTrigger(input: DoublesTurnInput, reason: string): string {
  const names = turnNames(input);
  const slot = DOUBLES_SLOTS.find((each) => input.pokemon[each] && reason.startsWith(`${names[each]} switches out`));
  if (!slot) return "unknown";
  const e = input.pokemon[slot]!;
  if (e.build.itemId === "ejectbutton" || e.build.itemId === "ejectpack") return e.build.itemId;
  if (e.build.abilityId === "emergencyexit" || e.build.abilityId === "wimpout") return e.build.abilityId;
  if (e.action.moveId && SELF_SWITCH.has(e.action.moveId)) return e.action.moveId;
  const drag = DOUBLES_SLOTS.map((each) => input.pokemon[each]?.action.moveId).find((id) => id && DRAGS.has(id));
  if (drag) return drag;
  if (DOUBLES_SLOTS.some((each) => slotSide(each) !== slotSide(slot) && input.pokemon[each]?.build.itemId === "redcard")) return "redcard";
  return "other";
}
function summarise(rows: Row[]) {
  const switchBy: Record<string, { turn: number; end: number }> = {};
  for (const row of rows) {
    if (!row.switchBy) continue;
    const e = switchBy[row.switchBy] ??= { turn: 0, end: 0 };
    if (row.status === "not-estimated") e.turn++; else e.end++;
  }
  const turn = new Map<string, { n: number; examples: string[] }>(), end = new Map<string, { n: number; examples: string[] }>();
  const bump = (map: typeof turn, key: string, example: string) => { const e = map.get(key) ?? { n: 0, examples: [] }; e.n++; if (e.examples.length < 3) e.examples.push(example); map.set(key, e); };
  let ready = 0, issues = 0, notEstimated = 0, endReady = 0;
  for (const row of rows) {
    if (row.status === "issues") { issues++; continue; }
    if (row.status === "not-estimated") { notEstimated++; bump(turn, row.reason!, row.actions); continue; }
    ready++;
    if (row.end === "ready") endReady++; else bump(end, row.end!, row.actions);
  }
  const sorted = (map: typeof turn) => [...map].sort((a, b) => b[1].n - a[1].n).map(([reason, e]) => ({ reason, n: e.n, share: e.n / rows.length, examples: e.examples }));
  return { turns: rows.length, ready, notEstimated, issues, endReady, endNotEstimated: ready - endReady, switchBy, turnReasons: sorted(turn), endReasons: sorted(end) };
}

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
      const ability = weighted(s.row.abilities)?.id ?? "";
      const item = weighted(s.row.items)?.id ?? "";
      const spread = weighted(s.row.spreads);
      const b = createBuild(s.id, runtime);
      const build = { ...b, abilityId: ability || b.abilityId, abilityActive: defaultAbilityActive(ability || b.abilityId), itemId: item, nature: spread?.nature ?? "Serious",
        ...(b.game === "champions" ? { points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(spread?.points ?? {}) } } : {}) } as BattleBuild;
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

function run(input: DoublesTurnInput): Row {
  const actions = DOUBLES_SLOTS.map((slot) => { const e = input.pokemon[slot]!; return `${e.build.speciesId}[${e.build.abilityId}/${e.build.itemId || "-"}] ${e.action.moveId ?? "-"}${e.action.target ? `>${e.action.target}` : ""}`; }).join(" | ");
  try {
    const result = calculateDoublesTurn(input);
    const switched = (reason: string) => (/switches out: the replacement is not known/.test(reason) ? { switchBy: switchTrigger(input, reason) } : {});
    if (result.status === "not-estimated") return { status: result.status, reason: result.reason, actions, ...switched(result.reason) };
    if (result.status === "issues") return { status: "issues", actions };
    const end = result.endOfTurn.status === "ready" ? "ready" : result.endOfTurn.reason;
    return { status: "ready", end, actions, ...switched(end) };
  } catch (error) {
    return { status: "not-estimated", reason: `THROW ${(error as Error).message}`.slice(0, 160), actions };
  }
}

(async () => {
  const champions = await loadBattleRuntime("champions");
  const usage = JSON.parse(fs.readFileSync("data/champions/training-usage.json", "utf8")) as Usage;
  const rows: Row[] = [];
  let skipped = 0;
  const t0 = performance.now();
  while (rows.length < N) {
    const input = championsTurn(champions, usage);
    if (!input) { skipped++; continue; }
    rows.push(run(input));
  }
  const sv = await loadBattleRuntime("scarlet_violet");
  const svRows: Row[] = [];
  for (let i = 0; i < NSV; i++) svRows.push(run(svTurn(sv)));
  const out = { seed: SEED, ms: Math.round(performance.now() - t0), champions: { skipped, ...summarise(rows) }, scarletVioletRandomBattle: summarise(svRows) };
  fs.writeFileSync(path.resolve("scripts/.cache/calc-audit/status2/design/census-sim.out.json"), JSON.stringify(out, null, 1));
  for (const [label, s] of [["Champions (usage)", out.champions], ["SV (Random Battle Doubles sets)", out.scarletVioletRandomBattle]] as const) {
    console.log(`\n== ${label}: ${s.turns} turns, ready ${s.ready}, not estimated ${s.notEstimated} (${(s.notEstimated / s.turns * 100).toFixed(1)}%), issues ${s.issues}; end of turn not estimated ${s.endNotEstimated}`);
    console.log(`  switch-outs by trigger: ${JSON.stringify(s.switchBy)}`);
    for (const r of s.turnReasons) console.log(`  turn ${String(r.n).padStart(4)} ${(r.share * 100).toFixed(2).padStart(6)}%  ${r.reason}`);
    for (const r of s.endReasons) console.log(`  end  ${String(r.n).padStart(4)} ${(r.share * 100).toFixed(2).padStart(6)}%  ${r.reason}`);
  }
})();
