// FINAL2 (status2 final gate): a copy of int2/census/budget-probe.ts with its output folder moved to build/final2/census and the label "final gate"; nothing else changed.
// Integration 2's copy of int1a/census/budget-probe.ts (itself design/tier2-eot-training-probes-3.ts, T2E's budget measurement,
// ADDENDUM2 §7.3). The engine copy is made from the live app/lib/battle at run time (./.t2-engine/ next to this file) and
// deleted after. Changes from 1a's: the output folder (build/int2/census), the label; optional recorders for the bounds the
// later waves added (doubles-spread.ts's spread worlds, doubles-switch.ts's request rounds and healthiest-pick combinations);
// and `--bench`: the same turns with census-bench.ts's bench (2 per side, second stream seed + 1_000_003; the E2 call with
// Training's replacementOrder own: "healthiest") and, with `--hazards`, Stealth Rock + 1 Spikes layer on both sides.
// Output (stdout) and tier2-eot-training-probes-3[.bench|.hazards].out.json in build/int2/census.
// TIER 2 budgets probe (too-many, engine-error): how close today's turns run to the count budgets, so the new branching
// families' multipliers can be read against the headroom. No app code changes: the engine (app/lib/battle) is copied into
// ./.t2-engine/ at run time, the copy's budget checks get a recorder (the peak of each budget's use per turn), the census
// sample (census-sim.ts's sampler, the same seed and draws: 8000 usage-weighted Champions turns, 2000 Scarlet/Violet Random
// Battle Doubles turns) is run through calculateDoublesTurn and, for Champions, calculateDoublesOutcomes (E2, Training's
// call), and the copy is deleted.
//
// Recorded per turn (max over the turn's walks): worlds and entries after each moves-phase action (doubles-turn.ts walk,
// :944), after each end-of-turn handler group (doubles-eot.ts budget), calculations (countCalculation, :533; shared by the
// three walks), the pairwise step's reruns and states against their budgets (uses-to-ko.ts:2645, :2832, turn mode only),
// the largest tied end-of-turn group, and at the spread-heal guard (doubles-turn.ts:2454) the size of the joint table the
// SPEC2 C12 model would hold after the move: |attacker HP| × Π over the targets that are not blocked (|target HP| × 16).
//
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-3.ts > scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-3.out 2> scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-3.err
import fs from "node:fs";
import path from "node:path";

const HERE = path.resolve("scripts/.cache/calc-audit/status2/build/final2/census");
const COPY = path.join(HERE, ".t2-engine");
const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const N = arg("n", 8000), NSV = arg("sv", 2000), SEED = arg("seed", 7);
const BENCH = args.includes("--bench") || args.includes("--hazards"), HAZARDS = args.includes("--hazards");
const MODE = HAZARDS ? "hazards" : BENCH ? "bench" : "plain";

type Peak = { worlds: number; entries: number; calcs: number; eotWorlds: number; eotEntries: number; reruns: number; states: number; tie: number; drain: number; spreadWorlds: number; spreadEntries: number; rounds: number; combos: number };
const fresh = (): Peak => ({ worlds: 0, entries: 0, calcs: 0, eotWorlds: 0, eotEntries: 0, reruns: 0, states: 0, tie: 0, drain: 0, spreadWorlds: 0, spreadEntries: 0, rounds: 0, combos: 0 });

function patch(file: string, from: string, to: string) {
  const at = path.join(COPY, file);
  const text = fs.readFileSync(at, "utf8");
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: patch anchor found ${count} times: ${from.slice(0, 80)}`);
  fs.writeFileSync(at, text.replace(from, to));
}

// Integration 1a: an anchor that 1a removed (the spread-heal guard: S models spread heals) is skipped and named.
const skipped: string[] = [];
function patchIf(file: string, from: string, to: string) {
  const text = fs.readFileSync(path.join(COPY, file), "utf8");
  if (!text.includes(from)) { skipped.push(`${file}: ${from.slice(0, 60)}`); return; }
  patch(file, from, to);
}

function makeCopy() {
  fs.rmSync(COPY, { recursive: true, force: true });
  fs.cpSync(path.resolve("app/lib/battle"), COPY, { recursive: true });
  const T2 = "(globalThis as any).__T2";
  patch("doubles-turn.ts", "const BUDGET = { worlds: 1_500, entries: 200_000, calculations: 160 };", "export const BUDGET = { worlds: 1_500, entries: 200_000, calculations: 160 };");
  patch("doubles-turn.ts", "  if (++ctx.memo.calculations > BUDGET.calculations && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);",
    `  ++ctx.memo.calculations; { const r = ${T2}; if (r) r.calcs = Math.max(r.calcs, ctx.memo.calculations); }\n  if (ctx.memo.calculations > BUDGET.calculations && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);`);
  patch("doubles-turn.ts", "    if ((worlds.length > BUDGET.worlds || entryCount(worlds) > BUDGET.entries) && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);",
    `    { const r = ${T2}; if (r) { r.worlds = Math.max(r.worlds, worlds.length); r.entries = Math.max(r.entries, entryCount(worlds)); } }\n    if ((worlds.length > BUDGET.worlds || entryCount(worlds) > BUDGET.entries) && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);`);
  patchIf("doubles-turn.ts", "  if (!selfDestruct && (info.drain || (user.itemId === \"shellbell\" && itemWorks(w, user)))) notEstimated(REASONS.spreadHeal(move.name));",
    `  if (!selfDestruct && (info.drain || (user.itemId === "shellbell" && itemWorks(w, user)))) { const r = ${T2}; if (r) { let est = marginal(w, attacker).size; for (const check of checks) if (!check.block && w.mons[check.slot]) est *= marginal(w, check.slot).size * 16; r.drain = Math.max(r.drain, est); } notEstimated(REASONS.spreadHeal(move.name)); }`);
  patch("doubles-eot.ts", "  if (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries) kernel.notEstimated(REASONS.tooMany);",
    `  { const r = ${T2}; if (r) { r.eotWorlds = Math.max(r.eotWorlds, worlds.length); r.eotEntries = Math.max(r.eotEntries, entryCount(worlds)); } }\n  if (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries) kernel.notEstimated(REASONS.tooMany);`);
  patch("doubles-eot.ts", "  if (group.length > 5) p.kernel.notEstimated(REASONS.tooMany);",
    `  { const r = ${T2}; if (r) r.tie = Math.max(r.tie, group.length); }\n  if (group.length > 5) p.kernel.notEstimated(REASONS.tooMany);`);
  patch("uses-to-ko.ts", "          if (this.reruns + unknown > this.runBudget()) { this.exceeded = true; return []; }",
    `          { const r = ${T2}; if (r && this.turnMode) r.reruns = Math.max(r.reruns, (this.reruns + unknown) / this.runBudget()); }\n          if (this.reruns + unknown > this.runBudget()) { this.exceeded = true; return []; }`);
  patch("uses-to-ko.ts", "          if (mode === \"all\" && this.states > STATE_BUDGET) { this.exceeded = true; return []; }",
    `          { const r = ${T2}; if (r && this.turnMode && mode === "all") r.states = Math.max(r.states, this.states / STATE_BUDGET); }\n          if (mode === "all" && this.states > STATE_BUDGET) { this.exceeded = true; return []; }`);
  // Integration 2: the later waves' bounds (optional anchors).
  patchIf("doubles-spread.ts", "    if (!kernel.reference && (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries)) kernel.notEstimated(REASONS.tooMany);",
    `    { const r = ${T2}; if (r) { r.spreadWorlds = Math.max(r.spreadWorlds, worlds.length); r.spreadEntries = Math.max(r.spreadEntries, entryCount(worlds)); } }\n    if (!kernel.reference && (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries)) kernel.notEstimated(REASONS.tooMany);`);
  patchIf("doubles-switch.ts", "    if (guard > 8) kernel.notEstimated(REASONS.tooMany);",
    `    { const r = ${T2}; if (r) r.rounds = Math.max(r.rounds, guard); }\n    if (guard > 8) kernel.notEstimated(REASONS.tooMany);`);
  patchIf("doubles-switch.ts", "      if (combos.length > 256) kernel.notEstimated(REASONS.tooMany);",
    `      { const r = ${T2}; if (r) r.combos = Math.max(r.combos, combos.length); }\n      if (combos.length > 256) kernel.notEstimated(REASONS.tooMany);`);
}

// ---- census-sim.ts's sampler, verbatim in its draws (the same seed gives the same turns) ----
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
// Integration 2: census-bench.ts's bench stream (only the bench draws read it, so the turns stay census-sim's).
const benchRandom = rng(SEED + 1_000_003);
const benchWeighted = <T extends { weight: number }>(list: readonly T[]): T | undefined => {
  const total = list.reduce((sum, e) => sum + e.weight, 0);
  let r = benchRandom() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return list[list.length - 1];
};
const WEATHER_SETTERS: Record<string, string> = { drought: "Sun", drizzle: "Rain", sandstream: "Sand", snowwarning: "Snow", orichalcumpulse: "Sun", megasol: "Sun" };
const TERRAIN_SETTERS: Record<string, string> = { electricsurge: "Electric", grassysurge: "Grassy", psychicsurge: "Psychic", mistysurge: "Misty", hadronengine: "Electric", seedsower: "" };
const SLOTS = ["own-left", "own-right", "opponent-left", "opponent-right"] as const;
type Slot = typeof SLOTS[number];
const sideOf = (slot: Slot) => slot.startsWith("own") ? "own" : "opponent";

(async () => {
  makeCopy();
  try {
    const model = await import("./.t2-engine/model");
    const { loadBattleRuntime } = await import("./.t2-engine/load-runtime");
    const { doublesTargetRule } = await import("./.t2-engine/doubles-targets");
    const turn = await import("./.t2-engine/doubles-turn");
    const { createBuild, createConditions, defaultAbilityActive, getBuildStats, validateBuild } = model;
    const g = globalThis as any;

    const finishInput = (runtime: any, pokemon: any, field: any) => {
      const input = { runtime, field, pokemon };
      for (const slot of SLOTS) {
        const entry = pokemon[slot];
        if (!entry?.action.moveId) continue;
        const rule = doublesTargetRule(input as any, slot, entry.action.moveId);
        if (rule.kind === "choose") entry.action = { ...entry.action, target: rule.options.length ? pick(rule.options) : null };
      }
      return input;
    };
    const championsTurn = (runtime: any, usage: any) => {
      const species = Object.entries(usage.species).map(([id, row]: [string, any]) => ({ id, row, weight: row.sets }));
      const pokemon: any = {};
      const used = new Set<string>();
      let weather = "", terrain = "";
      let weatherSpeed = Infinity, terrainSpeed = Infinity;
      for (const slot of SLOTS) {
        let built: any = null;
        for (let tries = 0; tries < 30 && !built; tries++) {
          const s: any = weighted(species)!;
          const base = s.id.replace(/mega[xy]?$/, "");
          const key = `${sideOf(slot)}:${base}`;
          if (used.has(key) || !runtime.speciesById.has(s.id)) continue;
          const ability = weighted(s.row.abilities as any[])?.id ?? "";
          const item = weighted(s.row.items as any[])?.id ?? "";
          const spread: any = weighted(s.row.spreads as any[]);
          const b = createBuild(s.id, runtime);
          const build = { ...b, abilityId: ability || b.abilityId, abilityActive: defaultAbilityActive(ability || b.abilityId), itemId: item, nature: spread?.nature ?? "Serious",
            ...(b.game === "champions" ? { points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(spread?.points ?? {}) } } : {}) };
          if (validateBuild(build, runtime).length) continue;
          const known = runtime.speciesById.get(s.id)!;
          const moves = s.row.moves.filter((m: any) => known.moves.includes(m.id) && runtime.movesById.has(m.id) && !runtime.movesById.get(m.id)!.unsupported.length);
          const move: any = weighted(moves);
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
    };
    const svTurn = (runtime: any) => {
      const sets = runtime.catalog.randomBattle.formats.Doubles.species;
      const ids = Object.keys(sets).filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
      const pokemon: any = {};
      for (const slot of SLOTS) {
        const id = pick(ids);
        const known = runtime.speciesById.get(id)!;
        const moves = sets[id].filter((m: string) => known.moves.includes(m) && runtime.movesById.get(m) && !runtime.movesById.get(m)!.unsupported.length);
        pokemon[slot] = { build: createBuild(id, runtime), contexts: {}, charged: false, action: { moveId: moves.length ? pick(moves) : null, target: null } };
      }
      return finishInput(runtime, pokemon, { ...createConditions(), gameType: "Doubles" });
    };

    // Integration 2: census-bench.ts's bench builders (verbatim in their draws).
    const baseOf = (id: string) => id.replace(/mega[xy]?$/, "").replace(/-?mega(-?[xy])?$/, "");
    const championsBench = (runtime: any, usage: any, input: any) => {
      const species = Object.entries(usage.species).map(([id, row]: [string, any]) => ({ id, row, weight: row.sets }));
      const bench: any = {};
      for (const side of ["own", "opponent"]) {
        const used = new Set(SLOTS.filter((slot) => sideOf(slot) === side).map((slot) => baseOf(input.pokemon[slot]!.build.speciesId)));
        const list: any[] = [];
        for (let tries = 0; tries < 60 && list.length < 2; tries++) {
          const s: any = benchWeighted(species)!;
          if (used.has(baseOf(s.id)) || !runtime.speciesById.has(s.id)) continue;
          const ability = benchWeighted(s.row.abilities as any[])?.id ?? "";
          const item = benchWeighted(s.row.items as any[])?.id ?? "";
          const spread: any = benchWeighted(s.row.spreads as any[]);
          const b = createBuild(s.id, runtime);
          const build = { ...b, abilityId: ability || b.abilityId, abilityActive: defaultAbilityActive(ability || b.abilityId), itemId: item, nature: spread?.nature ?? "Serious",
            ...(b.game === "champions" ? { points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(spread?.points ?? {}) } } : {}) };
          if (validateBuild(build, runtime).length) continue;
          const known = runtime.speciesById.get(s.id)!;
          const pool = s.row.moves.filter((m: any) => known.moves.includes(m.id) && runtime.movesById.has(m.id));
          const moves: string[] = [];
          while (moves.length < 4 && moves.length < pool.length) { const m: any = benchWeighted(pool.filter((each: any) => !moves.includes(each.id))); if (m) moves.push(m.id); else break; }
          used.add(baseOf(s.id));
          list.push({ id: `${side}-bench-${list.length + 1}`, build, moves });
        }
        bench[side] = list;
      }
      return bench;
    };
    // census-bench.ts's validBench: a species whose default build the engine accepts on a bench.
    const benchValid = new Map<string, boolean>();
    const validBench = (runtime: any, id: string) => {
      if (benchValid.has(id)) return benchValid.get(id)!;
      const idle = (speciesId: string) => ({ build: createBuild(speciesId, runtime), contexts: {}, charged: false, action: { moveId: null, target: null } });
      const result = turn.calculateDoublesTurn({ runtime, field: { ...createConditions(), gameType: "Doubles" },
        pokemon: { "own-left": idle("snorlax"), "own-right": idle("snorlax"), "opponent-left": idle("snorlax"), "opponent-right": idle("snorlax") },
        bench: { own: [{ id: "probe", build: createBuild(id, runtime) }] } } as any);
      const ok = result.status !== "issues";
      benchValid.set(id, ok);
      return ok;
    };
    const svBench = (runtime: any, input: any) => {
      const sets = runtime.catalog.randomBattle.formats.Doubles.species;
      const ids = Object.keys(sets).filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
      const bench: any = {};
      for (const side of ["own", "opponent"]) {
        const used = new Set(SLOTS.filter((slot) => sideOf(slot) === side).map((slot) => input.pokemon[slot]!.build.speciesId));
        const list: any[] = [];
        for (let tries = 0; tries < 60 && list.length < 2; tries++) {
          const id = ids[Math.floor(benchRandom() * ids.length)];
          if (used.has(id) || !validBench(runtime, id)) continue;
          const known = runtime.speciesById.get(id)!;
          const moves = sets[id].filter((m: string) => known.moves.includes(m) && runtime.movesById.get(m)).slice(0, 4);
          used.add(id);
          list.push({ id: `${side}-bench-${list.length + 1}`, build: createBuild(id, runtime), moves });
        }
        bench[side] = list;
      }
      return bench;
    };
    const HAZARD_SET = { own: { stealthRock: true, spikes: 1 }, opponent: { stealthRock: true, spikes: 1 } };
    const withBench = (input: any, bench: any) => !BENCH ? input : { ...input, bench, ...(HAZARDS ? { hazards: HAZARD_SET } : {}) };

    type Row = { status: string; reason?: string; end?: string; peak: Peak; e2?: { status: string; peak: Peak; outcomes: number; end?: string }; triggers: string[] };
    const TRIGGERS: [string, (input: any) => boolean][] = [
      ["moody (E2 ×20 at 28.2)", (i) => SLOTS.some((s) => i.pokemon[s]?.build.abilityId === "moody")],
      ["form line (×2 at 29)", (i) => SLOTS.some((s) => ["zenmode", "shieldsdown", "schooling", "powerconstruct"].includes(i.pokemon[s]?.build.abilityId))],
      ["cud chew holder", (i) => SLOTS.some((s) => i.pokemon[s]?.build.abilityId === "cudchew")],
      ["harvest (×2)", (i) => SLOTS.some((s) => i.pokemon[s]?.build.abilityId === "harvest")],
      ["pickup (≤×3)", (i) => SLOTS.some((s) => i.pokemon[s]?.build.abilityId === "pickup")],
      ["attract (×2 per BeforeMove)", (i) => SLOTS.some((s) => i.pokemon[s]?.action.moveId === "attract")],
      ["acupressure (≤×7)", (i) => SLOTS.some((s) => i.pokemon[s]?.action.moveId === "acupressure")],
      ["conversion 2 (≤×7)", (i) => SLOTS.some((s) => i.pokemon[s]?.action.moveId === "conversion2")],
      ["trace (≤×2)", (i) => SLOTS.some((s) => i.pokemon[s]?.build.abilityId === "trace")],
      ["drag (≤×4, R)", (i) => SLOTS.some((s) => ["roar", "whirlwind", "dragontail", "circlethrow"].includes(i.pokemon[s]?.action.moveId))],
      ["spread heal (C12 joint)", (i) => SLOTS.some((s) => ["matchagotcha", "paraboliccharge", "drainingkiss"].includes(i.pokemon[s]?.action.moveId) || i.pokemon[s]?.build.itemId === "shellbell")],
      ["future sight user (lands later)", (i) => SLOTS.some((s) => i.pokemon[s]?.action.moveId === "futuresight")],
      ["switch family (R: self-switch, drag, Eject Button/Pack, Red Card, Emergency Exit, Wimp Out)", (i) => SLOTS.some((s) => ["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "shedtail", "chillyreception", "roar", "whirlwind", "dragontail", "circlethrow"].includes(i.pokemon[s]?.action.moveId) || ["ejectbutton", "ejectpack", "redcard"].includes(i.pokemon[s]?.build.itemId) || ["emergencyexit", "wimpout"].includes(i.pokemon[s]?.build.abilityId))],
    ];
    const load = (p: Peak) => Math.max(p.worlds / 1500, p.entries / 200000, p.calcs / 160, p.eotWorlds / 1500, p.eotEntries / 200000, p.reruns, p.states);
    const stateLoad = (p: Peak) => Math.max(p.worlds / 1500, p.entries / 200000, p.eotWorlds / 1500, p.eotEntries / 200000);
    const calcLoad = (p: Peak) => p.calcs / 160;
    const stepLoad = (p: Peak) => Math.max(p.reruns, p.states);
    const endLoad = (p: Peak) => Math.max(p.eotWorlds / 1500, p.eotEntries / 200000);
    const runOne = (input: any, e2: boolean): Row => {
      const triggers = TRIGGERS.filter(([, t]) => t(input)).map(([name]) => name);
      g.__T2 = fresh();
      let row: Row;
      try {
        const result = turn.calculateDoublesTurn(input);
        const peak = g.__T2 as Peak;
        row = result.status === "not-estimated" ? { status: result.status, reason: result.reason, peak, triggers }
          : result.status === "issues" ? { status: "issues", peak, triggers }
          : { status: "ready", end: result.endOfTurn.status === "ready" ? "ready" : result.endOfTurn.reason, peak, triggers };
      } catch (error) {
        row = { status: "throw", reason: String((error as Error).message).slice(0, 120), peak: g.__T2, triggers };
      }
      if (e2) {
        g.__T2 = fresh();
        try {
          const out = turn.calculateDoublesOutcomes(BENCH ? { ...input, replacementOrder: { own: "healthiest" } } : input);
          row.e2 = { status: out.status, peak: g.__T2, outcomes: out.status === "ready" ? out.outcomes.length : 0, ...(out.status === "ready" && out.endOfTurn !== "applied" ? { end: out.endOfTurn.notEstimated } : out.status === "not-estimated" ? { end: out.reason } : {}) };
        } catch (error) {
          row.e2 = { status: "throw", peak: g.__T2, outcomes: 0, end: String((error as Error).message).slice(0, 120) };
        }
      }
      g.__T2 = null;
      return row;
    };
    const t0 = performance.now();
    const champions = await loadBattleRuntime("champions");
    const usage = JSON.parse(fs.readFileSync("data/champions/training-usage.json", "utf8"));
    const rows: Row[] = [];
    while (rows.length < N) {
      const input = championsTurn(champions, usage);
      if (!input) continue;
      const bench = championsBench(champions, usage, input);
      rows.push(runOne(withBench(input, bench), true));
    }
    const sv = await loadBattleRuntime("scarlet_violet");
    const svRows: Row[] = [];
    for (let i = 0; i < NSV; i++) { const input = svTurn(sv); const bench = svBench(sv, input); svRows.push(runOne(withBench(input, bench), false)); }
    const ms = Math.round(performance.now() - t0);

    const BINS = [1 / 1000, 1 / 100, 1 / 64, 1 / 32, 1 / 20, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, Infinity];
    const label = (x: number) => x === Infinity ? "> 1 (over)" : x >= 1 ? "≤ 1" : `≤ 1/${Math.round(1 / x)}`;
    const hist = (values: number[]) => {
      const counts = BINS.map(() => 0);
      for (const v of values) counts[BINS.findIndex((b) => v <= b)]++;
      return BINS.map((b, i) => `${label(b)} ${counts[i]}`).join(" | ");
    };
    const share = (n: number, d: number) => `${n} (${(n / Math.max(1, d) * 100).toFixed(2)} %)`;
    const report = (name: string, list: Row[], e2: boolean) => {
      const measured = list.filter((r) => r.status === "ready");
      console.log(`\n== ${name}: ${list.length} turns (${measured.length} ready, ${list.filter((r) => r.status === "not-estimated").length} not estimated, ${list.filter((r) => r.status === "throw").length} engine throws)`);
      console.log(`  "Too many cases to follow." today: turn ${list.filter((r) => r.reason === "Too many cases to follow.").length}, end of turn ${list.filter((r) => r.end === "Too many cases to follow.").length}${e2 ? `, E2 ${list.filter((r) => r.e2?.end === "Too many cases to follow.").length}` : ""}`);
      console.log(`  engine errors ("This matchup could not be calculated"): ${list.filter((r) => /could not be calculated/.test(r.reason ?? "") || /could not be calculated/.test(r.end ?? "")).length}`);
      console.log(`  world-state load (max of worlds/1500 and entries/200000, moves and end of turn), ready turns:`);
      console.log(`    ${hist(measured.map((r) => stateLoad(r.peak)))}`);
      console.log(`  calculation load (calculations/160, shared by the three walks), ready turns:`);
      console.log(`    ${hist(measured.map((r) => calcLoad(r.peak)))}`);
      console.log(`  pairwise-step load (reruns/48, states/STATE_BUDGET), ready turns:`);
      console.log(`    ${hist(measured.map((r) => stepLoad(r.peak)))}`);
      console.log(`  end-of-turn load (worlds/1500, entries/200000 after each handler group), ready turns with the end of turn ready:`);
      console.log(`    ${hist(measured.filter((r) => r.end === "ready").map((r) => endLoad(r.peak)))}`);
      const by = (key: keyof Peak) => { const v = measured.map((r) => r.peak[key] as number).sort((a, b) => a - b); const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; return `p50 ${+q(0.5).toFixed(3)} p90 ${+q(0.9).toFixed(3)} p99 ${+q(0.99).toFixed(3)} max ${+v[v.length - 1].toFixed(3)}`; };
      for (const key of ["worlds", "entries", "calcs", "eotWorlds", "eotEntries", "reruns", "states", "tie", "spreadWorlds", "spreadEntries", "rounds", "combos"] as const) console.log(`    ${key.padEnd(10)} ${by(key)}`);
      if (e2) {
        const ready = list.filter((r) => r.e2?.status === "ready");
        console.log(`  E2 statuses: ${JSON.stringify(list.reduce((m: Record<string, number>, r) => { m[r.e2?.status ?? "-"] = (m[r.e2?.status ?? "-"] ?? 0) + 1; return m; }, {}))}; E2 throws ${list.filter((r) => r.e2?.status === "throw").length}; E2 calculations max ${Math.max(0, ...list.filter((r) => r.e2?.status === "ready").map((r) => r.e2!.peak.calcs))}; E2 rounds max ${Math.max(0, ...list.map((r) => r.e2?.peak?.rounds ?? 0))}, combos max ${Math.max(0, ...list.map((r) => r.e2?.peak?.combos ?? 0))}`);
        console.log(`  E2 (calculateDoublesOutcomes): ${ready.length} ready; end of turn applied ${ready.filter((r) => !r.e2!.end).length}`);
        console.log(`    E2 world-state load: ${hist(ready.map((r) => stateLoad(r.e2!.peak)))}`);
        console.log(`    E2 calculation load: ${hist(ready.map((r) => calcLoad(r.e2!.peak)))}`);
        console.log(`    E2 end-of-turn load: ${hist(ready.filter((r) => !r.e2!.end).map((r) => endLoad(r.e2!.peak)))}`);
        const oc = ready.map((r) => r.e2!.outcomes).sort((a, b) => a - b);
        console.log(`    E2 outcomes per turn: p50 ${oc[Math.floor(oc.length / 2)]} p90 ${oc[Math.floor(oc.length * 0.9)]} p99 ${oc[Math.floor(oc.length * 0.99)]} max ${oc[oc.length - 1]}`);
      }
      console.log(`  by trigger (turns with it; over the budget if its branches multiplied the turn's peak load by m):`);
      for (const [name] of TRIGGERS) {
        const withIt = list.filter((r) => r.triggers.includes(name));
        if (!withIt.length) { console.log(`    ${name}: none in the sample`); continue; }
        const ready = withIt.filter((r) => r.status === "ready");
        const over = (m: number) => ready.filter((r) => stateLoad(r.peak) * m > 1).length;
        const calcOver = (m: number) => ready.filter((r) => calcLoad(r.peak) * m > 1).length;
        const e2over = (m: number) => withIt.filter((r) => r.e2?.status === "ready" && !r.e2.end && endLoad(r.e2.peak) * m > 1).length;
        const worst = Math.max(0, ...ready.map((r) => stateLoad(r.peak))), worstCalc = Math.max(0, ...ready.map((r) => calcLoad(r.peak)));
        console.log(`    ${name}: ${withIt.length} turns, ${ready.length} ready; worst world-state load ${worst.toFixed(4)} (over if ×${worst ? Math.ceil(1 / worst) : "∞"}), worst calculation load ${worstCalc.toFixed(3)}; world-state ×2 over ${over(2)}, ×8 ${over(8)}, ×20 ${over(20)}; calculations ×2 over ${calcOver(2)}, ×7 ${calcOver(7)}${e2 ? `; E2 end-of-turn ×2 over ${e2over(2)}, ×16 ${e2over(16)}, ×20 ${e2over(20)}` : ""}`);
      }
      const drains = list.filter((r) => r.peak.drain > 0).map((r) => r.peak.drain).sort((a, b) => a - b);
      if (drains.length) {
        const q = (p: number) => drains[Math.min(drains.length - 1, Math.floor(p * drains.length))];
        console.log(`  spread heal turns (guarded today: ${drains.length}): the C12 joint after the move, |attacker| × Π(|target| × 16): p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${drains[drains.length - 1]}; above 200 000 entries in one world: ${share(drains.filter((d) => d > 200000).length, drains.length)}; above 20 000: ${share(drains.filter((d) => d > 20000).length, drains.length)}`);
      }
      // Headroom for the end-of-turn families that the sample never sets up (carried Future Sight, carried Cud Chew):
      const endReady = measured.filter((r) => r.end === "ready");
      console.log(`  headroom for a landing's 16 rolls on one factor (end-of-turn entries ×16 over 200 000): ${share(endReady.filter((r) => r.peak.eotEntries * 16 > 200000).length, endReady.length)}; ×20 (Moody in E2): ${share(endReady.filter((r) => r.peak.eotEntries * 20 > 200000 || r.peak.eotWorlds * 20 > 1500).length, endReady.length)}`);
    };
    console.log(`tier2 budgets probe: seed ${SEED}, ${N} Champions + ${NSV} Scarlet/Violet turns, ${ms} ms (engine copy of this tree's app/lib/battle, final gate; mode ${MODE})`);
    for (const s of skipped) console.log(`  anchor gone in this tree, not recorded: ${s}`);
    report("Champions (usage-weighted, census-sim's sampler)", rows, true);
    report("Scarlet/Violet (Random Battle Doubles sets)", svRows, false);
    fs.writeFileSync(path.join(HERE, `tier2-eot-training-probes-3${MODE === "plain" ? "" : `.${MODE}`}.out.json`), JSON.stringify({ seed: SEED, ms, champions: rows.map((r) => ({ s: r.status, r: r.reason, e: r.end, p: r.peak, e2: r.e2, t: r.triggers })), sv: svRows.map((r) => ({ s: r.status, r: r.reason, e: r.end, p: r.peak, t: r.triggers })) }));
  } finally {
    fs.rmSync(COPY, { recursive: true, force: true });
  }
})();
