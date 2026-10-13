// The app side of the 2v2 validation (SPEC §8.1): each case as a DoublesTurnInput, run through calculateDoublesTurn
// (app/lib/battle/doubles-turn.ts, SPEC §3.3). The engine is loaded lazily, so the input builder and the catalog preflight work
// before it exists. status-eot: the case's carried state, Substitute, last move, moves, weatherTurns and canSwitch are mapped
// into the input (SPEC §7 step 6, ADDENDUM §7.1 step 3); a case with `outcomes` also runs calculateDoublesOutcomes (E2).
//
// Run from the repo root (the @/ alias resolves from there):
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/app-turn.ts [V01 ...] [--preflight]
// Writes scripts/.cache/calc-audit/2v2/verify/app-results/<id>.json ({ input summary, result, ms }).
import fs from "node:fs";
import path from "node:path";
import { createBuild, createConditions, createSide, defaultAbilityActive, validateBuild } from "@/app/lib/battle/model";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";
import type { DoublesBenchPokemon, DoublesCarried, DoublesHazards, DoublesOutcomesResult, DoublesPokemonInput, DoublesSideId, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { GAME_RUNTIME, SLOTS, toID, type Case, type CaseBenchMon, type CaseMon, type CaseSide, type SlotId } from "./case-types";
import { CASES } from "./cases";

export const APP_RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/app-results");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export async function runtimeFor(c: Case): Promise<BattleRuntime> {
  return loadBattleRuntime(GAME_RUNTIME[c.game]);
}

/** The app build for a case Pokémon: Showdown names to ids, EVs or Stat Points, the start state. */
export function caseBuild(m: CaseMon, runtime: BattleRuntime): BattleBuild {
  const speciesId = m.appSpecies ?? toID(m.species);
  const base = createBuild(speciesId, runtime);
  const abilityId = toID(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toID(m.item ?? ""),
    // status2 Step 1 #14: a switch-in case gives the stages after the switch's entry effects (appBoosts).
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(m.appBoosts ?? m.boosts) }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  // status2 wave 1a: a set gender (Attract, Captivate, Cute Charm) is the build's too (SetConfiguration.gender).
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const build = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  // status2 wave 1a: the types and the added type from an earlier turn (BuildBase.types, addedType).
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  // status2 wave 1b: an appBuild configuration (G-Max's dynamaxLevel, gigantamax) adds to the set's gender and Tera type.
  const appConfiguration = (m.appBuild?.configuration ?? {}) as Record<string, unknown>;
  const merged = { ...configuration, ...appConfiguration };
  return { ...build, ...mechanic, ...typed, ...m.appBuild, ...(Object.keys(merged).length ? { configuration: merged } : {}) } as BattleBuild;
}

function side(s: CaseSide | undefined) {
  return {
    ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil,
    // status2 (SPEC2 §3.2): Safeguard, Mist, Lucky Chant from an earlier turn; set only when up (1v1 and Step 0 inputs keep none).
    ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
    // status2 wave 1b (SwSh, C28): G-Max damage over time from an earlier turn.
    ...(s?.gmaxResidual?.length ? { gmaxResidual: [...s.gmaxResidual] } : {}),
  };
}
export function caseField(c: Case): BattleConditions {
  const f = c.field ?? {};
  return {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: side(f.own), defenderSide: side(f.opponent),
    // status2 (USUM): Mud Sport and Water Sport from an earlier turn.
    ...(f.mudSport ? { mudSport: true } : {}), ...(f.waterSport ? { waterSport: true } : {}),
  };
}

/** status-eot: the case's state from earlier turns as DoublesCarried (the public counts; ADDENDUM's Substitute and Ally Switch counter). */
export function caseCarried(m: CaseMon, runtime?: BattleRuntime, caseOf?: Case): DoublesCarried | undefined {
  const c = m.carried ?? {};
  const out: DoublesCarried = {};
  if (c.sleep) out.sleep = { attempts: c.sleep.attempts, rest: c.sleep.rest };
  if (c.freeze) out.freeze = { attempts: c.freeze.attempts };
  if (c.confusion) out.confusion = { attempts: c.confusion.attempts, ...(c.confusion.axeKick ? { axeKick: true as const } : {}) };
  if (c.toxic !== undefined) out.toxic = c.toxic;
  if (c.leechSeed) out.leechSeed = c.leechSeed;
  // The trapping move names the residual (DoublesCarried.trap.move; the oracle's line defaults to Fire Spin).
  if (c.trap) out.trap = { source: c.trap.source, bindingBand: c.trap.bindingBand, move: toID(c.trap.move ?? "Fire Spin") };
  if (c.saltCure) out.saltCure = true;
  if (c.aquaRing) out.aquaRing = true;
  if (c.ingrain) out.ingrain = true;
  if (c.curse) out.curse = true;
  if (c.syrupBomb) out.syrupBomb = c.syrupBomb;
  if (c.yawn) out.yawn = true;
  if (c.perish) out.perish = c.perish;
  if (c.wish) out.wish = c.wish;
  // status2 wave 1b (C33): a landing from a Pokémon of the turn (`source`) or from one not in battle (`build`, as it is now).
  if (typeof c.futureMove === "string") out.futureMove = toID(c.futureMove);
  else if (c.futureMove && "source" in c.futureMove) out.futureMove = { move: c.futureMove.move, source: c.futureMove.source };
  // status2 wave 2: a landing from a bench member: its build as it is on the bench (benchMember finds it in the case).
  else if (c.futureMove && "benchId" in c.futureMove) {
    if (!runtime || !caseOf) throw new Error("a landing from a bench member needs the runtime and the case");
    const fm = c.futureMove;
    const member = caseOf.bench?.[fm.benchSide]?.members?.find((x) => x.id === fm.benchId);
    if (!member) throw new Error(`no bench member ${fm.benchId} on ${fm.benchSide}`);
    out.futureMove = { move: fm.move, build: caseBuild(member, runtime) };
  } else if (c.futureMove) {
    if (!runtime) throw new Error("a landing from a build needs the runtime");
    const fm = c.futureMove;
    const benched = caseBuild(fm.terastallized ? { ...fm.bench, teraType: fm.terastallized, choice: "terastallize" } : fm.bench, runtime);
    // A user that fainted on an earlier turn is given as its build too (its ability, item and stages do not count either way).
    out.futureMove = { move: fm.move, build: benched };
  }
  if (c.cudChew) out.cudChew = c.cudChew === true ? true : toID(c.cudChew);
  if (c.allySwitch) out.allySwitch = c.allySwitch;
  // status2: accuracy and evasion stages from earlier turns.
  if (c.stages && (c.stages.accuracy || c.stages.evasion)) out.stages = { ...(c.stages.accuracy ? { accuracy: c.stages.accuracy } : {}), ...(c.stages.evasion ? { evasion: c.stages.evasion } : {}) };
  if (m.substitute !== undefined) out.substitute = m.substitute;
  Object.assign(out, carried2(c));
  return Object.keys(out).length ? out : undefined;
}
/**
 * status2 wave 1a: the DoublesCarried fields of SPEC2 §3.1 and ADDENDUM2 §3.1 (CaseCarried mirrors them: the same names and
 * shapes, slots for Pokémon, move names to ids). Stockpile's counts pass only when the case gives them (C17).
 */
export function carried2(c: NonNullable<CaseMon["carried"]>): Partial<DoublesCarried> {
  const out: Partial<DoublesCarried> = {};
  if (c.stockpile) out.stockpile = { layers: c.stockpile.layers, ...(c.stockpile.def !== undefined ? { def: c.stockpile.def } : {}), ...(c.stockpile.spd !== undefined ? { spd: c.stockpile.spd } : {}) };
  for (const key of ["powerTrick", "powerShift", "noRetreat", "minimize", "gastroAcid", "trapped", "tarShot", "foresight", "miracleEye", "nightmare",
    "berryLocked", "glaiveRush", "berryWeaken", "mustRecharge", "destinyBond", "laserFocus"] as const) {
    if (c[key]) (out as Record<string, unknown>)[key] = true;
  }
  if (c.charging) out.charging = toID(c.charging);
  if (c.telekinesis) out.telekinesis = c.telekinesis;
  if (c.healBlock) out.healBlock = c.healBlock;
  if (c.embargo) out.embargo = c.embargo;
  if (c.octolock) out.octolock = c.octolock;
  if (c.attract) out.attract = c.attract;
  if (c.copy) out.copy = { ...c.copy };
  if (c.lockOn) out.lockOn = c.lockOn;
  if (c.stall) out.stall = c.stall;
  if (c.taunt) out.taunt = c.taunt;
  if (c.encore) out.encore = { move: toID(c.encore.move), turns: c.encore.turns };
  if (c.disable) out.disable = { move: toID(c.disable.move), turns: c.disable.turns };
  if (c.onceUsed?.length) out.onceUsed = [...c.onceUsed];
  // status2 wave 1b (ADDENDUM2 §3.1, CL and PR).
  if (c.uproar) out.uproar = c.uproar;
  if (c.furyCutter !== undefined) out.furyCutter = c.furyCutter;
  if (c.rollout !== undefined) out.rollout = c.rollout;
  if (c.defenseCurl) out.defenseCurl = true;
  if (c.ppLeft) out.ppLeft = Object.fromEntries(Object.entries(c.ppLeft).map(([move, pp]) => [toID(move), pp]));
  if (c.bide) out.bide = { stored: c.bide.stored, source: c.bide.source, release: c.bide.release };
  return out;
}

export function caseInput(c: Case, runtime: BattleRuntime): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.action.move === null ? null : toID(m.action.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...(m.action.context as MoveContext | undefined) };
    const carried = caseCarried(m, runtime, c);
    const entry: DoublesPokemonInput = {
      build: caseBuild(m, runtime),
      contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {},
      charged: !!m.charged,
      action: { moveId, target: (m.action.target ?? null) as DoublesSlotId | null },
      ...(carried ? { carried } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toID(m.lastMove) } : {}),
      // status2 wave 2 (T2P-AST): a slot with exactMoves has exactly these Showdown slots (sim-dfs sdSet), so Assist can read them.
      ...(m.moves || m.exactMoves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...(m.moves ?? []).map(toID)])] } : {}),
      // status2 Step 1 #11 (C19) and #14: what happened earlier this turn; a Pokémon that switched in this turn (no action).
      ...(m.earlierThisTurn && Object.keys(m.earlierThisTurn).length ? { earlierThisTurn: { ...m.earlierThisTurn } } : {}),
      ...(m.action.switchIn ? { switchedIn: true as const } : {}),
      // status2 wave 1a: the last item (Recycle, Harvest, Pickup), not its first turn (Fake Out, First Impression).
      ...(m.lastItem !== undefined ? { lastItem: m.lastItem === null ? null : toID(m.lastItem) } : {}),
      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
      // status2 wave 1b: the target of its last move (Instruct).
      ...(m.lastMoveTarget !== undefined ? { lastMoveTarget: m.lastMoveTarget } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  // canSwitch: the oracle keeps one bench Pokémon per side unless the case says otherwise (SPEC §7 step 6).
  const input: DoublesTurnInput = {
    runtime, field: caseField(c), pokemon,
    ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    // status2 wave 1a: the entry order and the field effects' turns left.
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}),
    ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
    // status2 wave 1b: the battle's history (Copycat, Retaliate, Echoed Voice).
    ...(c.battleLastMove !== undefined ? { battleLastMove: c.battleLastMove === null ? null : toID(c.battleLastMove) } : {}),
    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}),
    ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
    // status2 wave 2 (Track R-V): the bench, the replacement and the hazards (DoublesTurnInput.bench, replacement, hazards).
    ...caseBenchInput(c, runtime),
  };
  // A move that takes no chosen target in the app (doubles-targets.ts: self, an ally-only move, a spread or random move)
  // gets none, whatever the case's Showdown choice aims at.
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (!entry?.action.moveId || !entry.action.target) continue;
    if (doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}

/** status2 wave 2: a bench member as the app's DoublesBenchPokemon (its build, sleep and freeze counters, onceUsed, moves). */
export function benchPokemon(m: CaseBenchMon, runtime: BattleRuntime): DoublesBenchPokemon {
  const all = caseCarried(m, runtime);
  const carried: DoublesBenchPokemon["carried"] = {
    ...(all?.sleep ? { sleep: all.sleep } : {}), ...(all?.freeze ? { freeze: all.freeze } : {}), ...(all?.onceUsed ? { onceUsed: all.onceUsed } : {}),
  };
  return { id: m.id, build: caseBuild(m, runtime), ...(Object.keys(carried).length ? { carried } : {}), ...(m.moves?.length ? { moves: [...new Set(m.moves.map(toID))] } : {}) };
}
/** The hazard ids of CaseSide.hazards as DoublesHazards (with CaseSide.layers). */
const HAZARD_KEYS: Record<string, Exclude<keyof DoublesHazards, "order">> = { stealthrock: "stealthRock", spikes: "spikes", toxicspikes: "toxicSpikes", stickyweb: "stickyWeb", gmaxsteelsurge: "steelsurge" };
export function caseHazards(s: CaseSide | undefined): DoublesHazards | null {
  const out: DoublesHazards = {};
  for (const id of s?.hazards ?? []) {
    const key = HAZARD_KEYS[id];
    if (!key) throw new Error(`hazard ${id} has no DoublesHazards key`);
    if (key === "spikes") out.spikes = s?.layers?.spikes ?? 1;
    else if (key === "toxicSpikes") out.toxicSpikes = s?.layers?.toxicSpikes ?? 1;
    else out[key] = true;
  }
  // Review 2 (R7-2): the order they went up (sim-dfs adds them in the case's order: effectOrder).
  if ((s?.hazards?.length ?? 0) > 1) out.order = [...s!.hazards!] as DoublesHazards["order"];
  return Object.keys(out).length ? out : null;
}
/** status2 wave 2: the input's bench (a side with members, [] included), replacement and hazards (each only when the case has it). */
export function caseBenchInput(c: Case, runtime: BattleRuntime): Pick<DoublesTurnInput, "bench" | "replacement" | "hazards"> {
  const bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> = {};
  for (const side of ["own", "opponent"] as const) {
    const members = c.bench?.[side]?.members;
    if (members) bench[side] = members.map((m) => benchPokemon(m, runtime));
  }
  const hazards: Partial<Record<DoublesSideId, DoublesHazards>> = {};
  for (const side of ["own", "opponent"] as const) {
    const h = caseHazards(c.field?.[side]);
    if (h) hazards[side] = h;
  }
  return {
    ...(Object.keys(bench).length ? { bench } : {}),
    ...(c.replacement && Object.keys(c.replacement).length ? { replacement: { ...c.replacement } } : {}),
    ...(Object.keys(hazards).length ? { hazards } : {}),
  };
}

/** Catalog problems the engine would report as issues: unknown species, ability, item, or a move the species does not learn. */
export function preflight(c: Case, runtime: BattleRuntime): string[] {
  const out: string[] = [];
  for (const slot of SLOTS) {
    const m = c.slots[slot];
    if (m.absent) continue;
    const build = caseBuild(m, runtime);
    for (const issue of validateBuild(build, runtime)) out.push(`${slot} ${build.speciesId}: ${issue.field}: ${issue.message}`);
    const move = m.action.move === null ? null : toID(m.action.move);
    const species = runtime.speciesById.get(build.speciesId);
    if (move && !runtime.movesById.has(move)) out.push(`${slot}: move ${move} is not in the ${runtime.profile.id} catalog`);
    else if (move && species && !species.moves.includes(move)) out.push(`${slot}: ${species.name} does not learn ${move} in ${runtime.profile.id}`);
  }
  // status2 wave 2: the bench members' builds and moves.
  for (const side of ["own", "opponent"] as const) {
    for (const m of c.bench?.[side]?.members ?? []) {
      const build = caseBuild(m, runtime);
      for (const issue of validateBuild(build, runtime)) out.push(`bench ${m.id} ${build.speciesId}: ${issue.field}: ${issue.message}`);
      const species = runtime.speciesById.get(build.speciesId);
      for (const move of (m.moves ?? []).map(toID)) {
        if (!runtime.movesById.has(move)) out.push(`bench ${m.id}: move ${move} is not in the ${runtime.profile.id} catalog`);
        else if (species && !species.moves.includes(move)) out.push(`bench ${m.id}: ${species.name} does not learn ${move} in ${runtime.profile.id}`);
      }
    }
  }
  return out;
}

type Engine = {
  calculateDoublesTurn: (input: DoublesTurnInput) => DoublesTurnResult;
  calculateDoublesOutcomes: (input: DoublesTurnInput) => DoublesOutcomesResult;
};
let engine: Engine | null | undefined;
export async function loadEngine(): Promise<Engine | null> {
  if (engine !== undefined) return engine;
  try {
    engine = (await import("@/app/lib/battle/doubles-turn")) as unknown as Engine;
  } catch (e) {
    console.log(`doubles-turn.ts is not loadable: ${(e as Error).message.split("\n")[0]}`);
    engine = null;
  }
  return engine;
}

export type AppTurn = { result: DoublesTurnResult | null; ms: number; error?: string; preflight: string[]; outcomes?: DoublesOutcomesResult | null; outcomesError?: string };
export async function appTurn(c: Case): Promise<AppTurn> {
  const runtime = await runtimeFor(c);
  const pre = preflight(c, runtime);
  const e = await loadEngine();
  if (!e) return { result: null, ms: 0, error: "engine not built", preflight: pre };
  const input = caseInput(c, runtime);
  const t0 = performance.now();
  let out: AppTurn;
  try {
    const result = e.calculateDoublesTurn(input);
    out = { result, ms: performance.now() - t0, preflight: pre };
  } catch (err) {
    return { result: null, ms: performance.now() - t0, error: (err as Error).stack ?? String(err), preflight: pre };
  }
  if (c.outcomes) {
    try {
      out.outcomes = e.calculateDoublesOutcomes(caseInput(c, runtime));
    } catch (err) {
      out.outcomes = null;
      out.outcomesError = (err as Error).stack ?? String(err);
    }
  }
  return out;
}

export type SlotIdAlias = SlotId;

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/app-turn.ts")) {
  (async () => {
    const args = process.argv.slice(2);
    const ids = args.filter((a) => !a.startsWith("--"));
    const onlyPreflight = args.includes("--preflight");
    const outDir = args.find((a) => a.startsWith("--out="))?.split("=")[1];
    const dir = outDir ? path.resolve(outDir) : APP_RESULTS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    for (const c of CASES) {
      if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
      const runtime = await runtimeFor(c);
      const pre = preflight(c, runtime);
      if (onlyPreflight) {
        console.log(`${c.id}: ${pre.length ? pre.join(" | ") : "ok"}`);
        continue;
      }
      const out = await appTurn(c);
      fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(out, null, 1));
      console.log(`${c.id}: ${out.error ? out.error.split("\n")[0] : out.result?.status} (${out.ms.toFixed(1)} ms)${pre.length ? ` preflight: ${pre.join(" | ")}` : ""}`);
    }
  })();
}
