import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type {
  DoublesBenchPokemon, DoublesCarried, DoublesHazards, DoublesHP, DoublesOutcome, DoublesOutcomeMon, DoublesPokemonInput, DoublesSideId, DoublesSlotId, DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, SideConditions } from "@/app/lib/battle/types";

/**
 * E2 (Training SPEC §5.11): calculateDoublesOutcomes is calculateDoublesTurn's "all" walk as finished worlds. For every case
 * of tests/unit/doubles-turn-showdown.test.ts (read from that file, unchanged) and 300 seeded turns from the generator of
 * tests/unit/doubles-turn-perf.test.ts, the outcomes' HP mixture equals calculateDoublesTurn's average (1e-9), min, max and
 * KO chance (1e-9), and each outcome's allFainted is at most its smallest marginal KO chance on that side. With the end of
 * turn applied (status-eot SPEC §4.9) the outcomes are after the whole turn and equal endOfTurn.hp; otherwise they are
 * after the moves, equal hp, and say why the end of turn is not estimated. status2 wave 2: with a bench, hp[slot] is the
 * slot's starting Pokémon wherever it is (E2: mons[slot] without an id, or DoublesOutcome.benched with id slot:{slot}), and each
 * newcomer's E2 HP (mons[slot] with its id, or benched again) equals hpEntered (endOfTurn.hpEntered when applied) given that it
 * came in.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const SIDES: DoublesSideId[] = ["own", "opponent"];
const side = (slot: DoublesSlotId): DoublesSideId => slot.startsWith("own") ? "own" : "opponent";

// ---------- The Showdown cases (the same input builder as doubles-turn-showdown.test.ts) ----------
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Carried = Omit<DoublesCarried, "trap" | "futureMove" | "cudChew" | "ppLeft"> & {
  trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; cudChew?: true | string; ppLeft?: Record<string, number>;
  // status2 wave 1b (as doubles-turn-showdown.test.ts): a landing from a Pokémon of the turn, or from one not in battle.
  futureMove?: string | { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; bench: Omit<Mon, "move">; benchSide: "own" | "opponent"; fainted?: true; terastallized?: string }
    | { move: "futuresight" | "doomdesire"; benchId: string; benchSide: "own" | "opponent" };
};
type Mon = {
  species: string; appSpecies?: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>; level?: number; hp?: number; status?: BattleBuild["status"];
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; teraType?: string; choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  charged?: boolean; appBuild?: Record<string, unknown>; absent?: boolean; gender?: string;
  carried?: Carried; substitute?: number; moves?: string[]; lastMove?: string | null;
  move: string | null; target?: DoublesSlotId; context?: MoveContext;
  // status2: as doubles-turn-showdown.test.ts (verify/gen-tests.ts).
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true }; switchIn?: true;
  appBoosts?: Partial<Record<Exclude<Stat, "hp">, number>>;
  types?: string[]; addedType?: "Grass" | "Ghost"; lastItem?: string | null; firstTurn?: boolean;
  lastMoveTarget?: DoublesSlotId | null; exactMoves?: true;
};
type SideField = {
  tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; safeguard?: boolean; mist?: boolean; luckyChant?: boolean; gmaxResidual?: SideConditions["gmaxResidual"];
  // status2 wave 2 (as doubles-turn-showdown.test.ts): the hazards before the turn, the input's DoublesTurnInput.hazards.
  hazards?: string[]; layers?: { spikes?: 1 | 2 | 3; toxicSpikes?: 1 | 2 };
};
/** status2 wave 2 (as doubles-turn-showdown.test.ts): a bench member (DoublesBenchPokemon). */
type Member = Omit<Mon, "move"> & { id: string };
type Field = Partial<Pick<BattleConditions, "weather" | "terrain" | "trickRoom" | "gravity" | "wonderRoom" | "magicRoom" | "critical" | "mudSport" | "waterSport">> & { own?: SideField; opponent?: SideField };
type Case = {
  id: string; game: "sv" | "swsh" | "usum" | "champions"; field?: Field; slots: Record<DoublesSlotId, Mon>;
  weatherTurns?: number; canSwitch?: Partial<Record<"own" | "opponent", boolean>>;
  entryOrder?: DoublesTurnInput["entryOrder"]; fieldTurns?: DoublesTurnInput["fieldTurns"];
  battleLastMove?: string | null; faintedLastTurn?: DoublesTurnInput["faintedLastTurn"]; echoedVoice?: DoublesTurnInput["echoedVoice"];
  bench?: Partial<Record<DoublesSideId, { members?: Member[] }>>; replacement?: Partial<Record<DoublesSlotId, string>>;
};
const GAMES: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** The generated file's case table: one literal, or (status2 V1) parts `const CASES_n: Case[] = [ ... ];` of 400 rows. */
function showdownCases(): Case[] {
  const text = readFileSync("tests/unit/doubles-turn-showdown.test.ts", "utf8").replace(/\r\n/g, "\n");
  const heads = [...text.matchAll(/const CASES(?:_\d+)?: Case\[\] = \[\n/g)];
  const cases: Case[] = [];
  for (const head of heads) {
    const start = head.index! + head[0].length - 2;
    const end = text.indexOf("\n];", start);
    if (end < 0) break;
    cases.push(...(new Function(`return ${text.slice(start, end + 3).replace(/;$/, "")}`)() as Case[]));
  }
  if (!cases.length) throw new Error("The Showdown cases were not found.");
  return cases;
}
function caseBuild(m: Mon, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(m.appSpecies ?? toId(m.species), runtime);
  const abilityId = toId(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toId(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(m.appBoosts ?? m.boosts) }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender === "M" || m.gender === "F" ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const trained = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  // status2 wave 1b: an appBuild configuration (G-Max's dynamaxLevel, gigantamax) adds to the set's gender and Tera type.
  const merged = { ...configuration, ...((m.appBuild?.configuration ?? {}) as Record<string, unknown>) };
  return { ...trained, ...mechanic, ...typed, ...m.appBuild, ...(Object.keys(merged).length ? { configuration: merged } : {}) } as BattleBuild;
}
/** status2 wave 1b: a landing's user (doubles-turn-showdown.test.ts landing): a slot, or the build of one not in battle. */
function landing(fm: NonNullable<Carried["futureMove"]>, runtime: BattleRuntime, c?: Case): DoublesCarried["futureMove"] {
  if (typeof fm === "string") return toId(fm);
  if ("source" in fm) return { move: fm.move, source: fm.source };
  // status2 wave 2: its user is a bench member (its build as it is on the bench).
  if ("benchId" in fm) {
    const member = c?.bench?.[fm.benchSide]?.members?.find((x) => x.id === fm.benchId);
    if (!member) throw new Error(`no bench member ${fm.benchId}`);
    return { move: fm.move, build: caseBuild({ ...member, move: null }, runtime) };
  }
  const bench: Mon = { ...fm.bench, move: null };
  return { move: fm.move, build: caseBuild(fm.terastallized ? { ...bench, teraType: fm.terastallized, choice: "terastallize" } : bench, runtime) };
}
/** The state from earlier turns (doubles-turn-showdown.test.ts carried). */
function carriedOf(m: Mon, runtime: BattleRuntime, c?: Case): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, cudChew, ppLeft, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: toId(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: landing(futureMove, runtime, c) } : {}),
    ...(cudChew ? { cudChew: cudChew === true ? true : toId(cudChew) } : {}), ...(ppLeft ? { ppLeft: Object.fromEntries(Object.entries(ppLeft).map(([k, v]) => [toId(k), v])) } : {}),
    ...(charging ? { charging: toId(charging) } : {}), ...(encore ? { encore: { move: toId(encore.move), turns: encore.turns } } : {}), ...(disable ? { disable: { move: toId(disable.move), turns: disable.turns } } : {}),
    ...(m.substitute !== undefined ? { substitute: m.substitute } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
const sideOf = (s: SideField | undefined) => ({
  ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil,
  ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
  ...(s?.gmaxResidual?.length ? { gmaxResidual: [...s.gmaxResidual] } : {}),
});
async function caseInput(c: Case): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(GAMES[c.game]);
  const f = c.field ?? {};
  const field: BattleConditions = {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: sideOf(f.own), defenderSide: sideOf(f.opponent),
    ...(f.mudSport ? { mudSport: true } : {}), ...(f.waterSport ? { waterSport: true } : {}),
  };
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.move === null ? null : toId(m.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...m.context };
    const state = carriedOf(m, runtime, c);
    const entry: DoublesPokemonInput = {
      build: caseBuild(m, runtime), contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {}, charged: !!m.charged,
      action: { moveId, target: m.target ?? null },
      ...(state ? { carried: state } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toId(m.lastMove) } : {}),
      // status2 wave 2 (T2P-AST): a slot with exactMoves has exactly these Showdown slots, so Assist can read them.
      ...(m.moves || m.exactMoves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...(m.moves ?? []).map(toId)])] } : {}),
      ...(m.switchIn ? { switchedIn: true as const } : {}),
      ...(m.earlierThisTurn && Object.keys(m.earlierThisTurn).length ? { earlierThisTurn: { ...m.earlierThisTurn } } : {}),
      ...(m.lastItem !== undefined ? { lastItem: m.lastItem === null ? null : toId(m.lastItem) } : {}),
      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
      ...(m.lastMoveTarget !== undefined ? { lastMoveTarget: m.lastMoveTarget } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}), ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
    ...(c.battleLastMove !== undefined ? { battleLastMove: c.battleLastMove === null ? null : toId(c.battleLastMove) } : {}),
    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}), ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
    // status2 wave 2: the bench (a side with members), the replacement and the hazards (doubles-turn-showdown.test.ts benchInput).
    ...benchInput(c, runtime),
  };
  // A move the app takes no chosen target for gets none, whatever Showdown's choice aims at (as the Showdown test does).
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry?.action.moveId && entry.action.target && doublesTargetRule(turn, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return turn;
}

const HAZARD_KEYS: Record<string, Exclude<keyof DoublesHazards, "order">> = { stealthrock: "stealthRock", spikes: "spikes", toxicspikes: "toxicSpikes", stickyweb: "stickyWeb", gmaxsteelsurge: "steelsurge" };
/** status2 wave 2 (doubles-turn-showdown.test.ts benchInput): the bench members, the replacement and the hazards with their layers. */
function benchInput(c: Case, runtime: BattleRuntime): Pick<DoublesTurnInput, "bench" | "replacement" | "hazards"> {
  const bench: Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> = {};
  for (const sideId of SIDES) {
    const members = c.bench?.[sideId]?.members;
    if (!members) continue;
    bench[sideId] = members.map((m) => {
      const state = carriedOf({ ...m, move: null }, runtime);
      const kept = { ...(state?.sleep ? { sleep: state.sleep } : {}), ...(state?.freeze ? { freeze: state.freeze } : {}), ...(state?.onceUsed ? { onceUsed: state.onceUsed } : {}) };
      return { id: m.id, build: caseBuild({ ...m, move: null }, runtime), ...(Object.keys(kept).length ? { carried: kept } : {}), ...(m.moves?.length ? { moves: [...new Set(m.moves.map(toId))] } : {}) };
    });
  }
  const hazards: Partial<Record<DoublesSideId, DoublesHazards>> = {};
  for (const sideId of SIDES) {
    const s = c.field?.[sideId];
    const out: DoublesHazards = {};
    for (const h of s?.hazards ?? []) {
      const key = HAZARD_KEYS[h];
      if (key === "spikes") out.spikes = s?.layers?.spikes ?? 1;
      else if (key === "toxicSpikes") out.toxicSpikes = s?.layers?.toxicSpikes ?? 1;
      else if (key) out[key] = true;
    }
    // Review 2 (R7-2): the order they went up (the oracle adds them in the case's order).
    if ((s?.hazards?.length ?? 0) > 1) out.order = [...s!.hazards!] as DoublesHazards["order"];
    if (Object.keys(out).length) hazards[sideId] = out;
  }
  return {
    ...(Object.keys(bench).length ? { bench } : {}), ...(c.replacement && Object.keys(c.replacement).length ? { replacement: { ...c.replacement } } : {}),
    ...(Object.keys(hazards).length ? { hazards } : {}),
  };
}
/** status2 wave 2: the outcomes with each slot's entry its starting Pokémon (DoublesOutcome.benched's slot:{slot} where it left). */
function identity(outcomes: DoublesOutcome[], label: string): DoublesOutcome[] {
  return outcomes.map((o) => ({
    ...o, mons: Object.fromEntries(SLOTS.flatMap((slot) => {
      const m = o.mons[slot];
      if (!m?.id) return m ? [[slot, m]] : [];
      const left = o.benched?.[side(slot)]?.find((b) => b.id === `slot:${slot}`);
      expect(left, `${label} ${slot}: the starting Pokémon on the bench (the occupant is ${m.id})`).toBeDefined();
      return left ? [[slot, left]] : [];
    })),
  }));
}
/** status2 wave 2: each newcomer's E2 HP, given that it came in, against hpEntered (endOfTurn.hpEntered when applied). */
function newcomers(label: string, outcomes: DoublesOutcome[], want: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>> | undefined) {
  const seen = new Set<string>();
  for (const o of outcomes) {
    for (const slot of SLOTS) if (o.mons[slot]?.id) seen.add(`${slot}|${o.mons[slot]!.id}`);
    for (const each of SIDES) for (const b of o.benched?.[each] ?? []) if (b.id !== `slot:${b.slot}`) seen.add(`${b.slot}|${b.id}`);
  }
  const wanted = Object.entries(want ?? {}).flatMap(([slot, byId]) => Object.keys(byId ?? {}).map((who) => `${slot}|${who}`));
  expect([...seen].sort(), `${label} newcomers`).toEqual(wanted.sort());
  for (const key of wanted) {
    const [slot, who] = key.split("|") as [DoublesSlotId, string];
    const hp = want![slot]![who];
    const monOf = (o: DoublesOutcome): DoublesOutcomeMon | undefined => o.mons[slot]?.id === who ? o.mons[slot] : o.benched?.[side(slot)]?.find((b) => b.id === who && b.slot === slot);
    let mass = 0, average = 0, ko = 0, min = Infinity, max = -Infinity;
    for (const o of outcomes) {
      const mon = monOf(o);
      if (!mon) continue;
      mass += o.chance;
      for (const entry of mon.hp) {
        average += o.chance * entry.chance * entry.hp;
        if (entry.hp <= 0) ko += o.chance * entry.chance;
        min = Math.min(min, entry.hp);
        max = Math.max(max, entry.hp);
      }
    }
    expect(mass, `${label} ${key} came in`).toBeGreaterThan(0);
    expect(Math.abs(average / mass - hp.average), `${label} ${key} average`).toBeLessThanOrEqual(1e-9 * Math.max(1, hp.maximum));
    expect({ min, max }, `${label} ${key} range`).toEqual({ min: hp.min, max: hp.max });
    expect(Math.abs(Math.min(ko / mass, 1 - 1e-12) - Math.min(hp.koChance, 1 - 1e-12)), `${label} ${key} KO chance`).toBeLessThanOrEqual(1e-9);
  }
}

// ---------- The perf test's typical turns (the same generator, other seeds) ----------
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

// ---------- The comparison ----------
type Tally = { ready: number; notEstimated: number; issues: number; budgetOnly: number; worlds: number[] };
function compare(label: string, input: DoublesTurnInput, tally: Tally) {
  const full = calculateDoublesTurn(input);
  const outcomes = calculateDoublesOutcomes(input);
  if (full.status === "issues") {
    expect(outcomes.status, label).toBe("issues");
    tally.issues++;
    return;
  }
  if (full.status === "not-estimated") {
    // The one difference: three walks share the calculation budget there, one walk here.
    if (outcomes.status === "ready") {
      expect(full.reason, label).toBe("Too many cases to follow.");
      tally.budgetOnly++;
      return;
    }
    expect(outcomes, label).toEqual({ status: "not-estimated", reason: full.reason });
    tally.notEstimated++;
    return;
  }
  expect(outcomes.status, label).toBe("ready");
  if (outcomes.status !== "ready") return;
  tally.ready++;
  tally.worlds.push(outcomes.outcomes.length);
  expect(outcomes.start, label).toEqual(full.start);
  const chances = outcomes.outcomes.reduce((sum, outcome) => sum + outcome.chance, 0);
  expect(Math.abs(chances - 1), `${label} chances`).toBeLessThanOrEqual(1e-9);
  // The end of turn: applied in both or not estimated in both, with the same reason (one walk here, three there).
  const applied = outcomes.endOfTurn === "applied";
  // Moody and a Starf Berry change only stages: the calculator states the fact, E2 (next turn's builds) cannot follow them.
  const e2Only = ["Moody is not modelled in 2v2.", "Starf Berry is not modelled in 2v2."];
  if (full.endOfTurn.status === "ready" && !applied) expect(e2Only, label).toContain((outcomes.endOfTurn as { notEstimated: string }).notEstimated);
  else if (full.endOfTurn.status === "ready") expect(outcomes.endOfTurn, label).toBe("applied");
  else if (applied) expect(full.endOfTurn.reason, label).toBe("Too many cases to follow.");
  else expect(outcomes.endOfTurn, label).toEqual({ notEstimated: full.endOfTurn.reason });
  const after = full.endOfTurn.status === "ready" ? full.endOfTurn.hp : null;
  if (applied && !after) return;
  // status2 wave 2: hp[slot] is the slot's starting Pokémon wherever it is; the newcomers are hpEntered's.
  const starting = input.bench ? identity(outcomes.outcomes, label) : outcomes.outcomes;
  if (input.bench) newcomers(label, outcomes.outcomes, applied && full.endOfTurn.status === "ready" ? full.endOfTurn.hpEntered : full.hpEntered);
  for (const slot of SLOTS) {
    const want = applied ? after![slot] : full.hp[slot];
    const present = starting.filter((outcome) => outcome.mons[slot]);
    if (!want) { expect(present.length, `${label} ${slot}`).toBe(0); continue; }
    expect(present.length, `${label} ${slot}`).toBe(outcomes.outcomes.length);
    let average = 0, ko = 0, min = Infinity, max = -Infinity;
    for (const outcome of present) {
      const mon = outcome.mons[slot]!;
      expect(Math.abs(mon.hp.reduce((sum, entry) => sum + entry.chance, 0) - 1), `${label} ${slot} HP chances`).toBeLessThanOrEqual(1e-9);
      expect(mon.hp.map((entry) => entry.hp), `${label} ${slot} ascending`).toEqual([...mon.hp.map((entry) => entry.hp)].sort((a, b) => a - b));
      for (const entry of mon.hp) {
        average += outcome.chance * entry.chance * entry.hp;
        if (entry.hp <= 0) ko += outcome.chance * entry.chance;
        min = Math.min(min, entry.hp);
        max = Math.max(max, entry.hp);
      }
    }
    expect(Math.abs(average - want.average), `${label} ${slot} average`).toBeLessThanOrEqual(1e-9 * Math.max(1, want.maximum));
    expect({ min, max }, `${label} ${slot} range`).toEqual({ min: want.min, max: want.max });
    expect(Math.abs(Math.min(ko, 1 - 1e-12) - Math.min(want.koChance, 1 - 1e-12)), `${label} ${slot} KO chance`).toBeLessThanOrEqual(1e-9);
  }
  for (const outcome of outcomes.outcomes) allFaintedBound(label, outcome);
}
function allFaintedBound(label: string, outcome: DoublesOutcome) {
  for (const each of SIDES) {
    const slots = SLOTS.filter((slot) => side(slot) === each && outcome.mons[slot]);
    const kos = slots.map((slot) => outcome.mons[slot]!.hp.filter((entry) => entry.hp <= 0).reduce((sum, entry) => sum + entry.chance, 0));
    if (!slots.length) { expect(outcome.allFainted[each], `${label} ${each} none present`).toBe(1); continue; }
    expect(outcome.allFainted[each], `${label} ${each} allFainted`).toBeLessThanOrEqual(Math.min(...kos) + 1e-12);
    expect(outcome.allFainted[each], `${label} ${each} allFainted`).toBeGreaterThanOrEqual(0);
    // One present Pokémon: allFainted is its own KO chance.
    if (slots.length === 1) expect(Math.abs(outcome.allFainted[each] - kos[0]), `${label} ${each} one present`).toBeLessThanOrEqual(1e-12);
  }
}

describe("calculateDoublesOutcomes (E2)", () => {
  it("equals calculateDoublesTurn on every pinned Showdown case", async () => {
    const tally: Tally = { ready: 0, notEstimated: 0, issues: 0, budgetOnly: 0, worlds: [] };
    const cases = showdownCases();
    expect(cases.length).toBeGreaterThan(100);
    for (const c of cases) compare(c.id, await caseInput(c), tally);
    expect(tally.ready).toBe(cases.length);
  }, 120_000);

  it("equals calculateDoublesTurn on 300 seeded typical turns", async () => {
    const tally: Tally = { ready: 0, notEstimated: 0, issues: 0, budgetOnly: 0, worlds: [] };
    const games: BattleGame[] = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"];
    const random = rng(20261005);
    for (let i = 0; i < 300; i++) compare(`turn ${i}`, typicalTurn(await loadBattleRuntime(games[i % games.length]), random), tally);
    expect(tally.ready + tally.notEstimated + tally.issues + tally.budgetOnly).toBe(300);
    expect(tally.ready).toBeGreaterThan(200);
  }, 300_000);

  it("equals calculateDoublesTurn in the reference mode too (no splits, no merges, no memo)", async () => {
    const tally: Tally = { ready: 0, notEstimated: 0, issues: 0, budgetOnly: 0, worlds: [] };
    const cases = showdownCases().slice(0, 24);
    DOUBLES_REFERENCE.on = true;
    try {
      for (const c of cases) compare(c.id, await caseInput(c), tally);
    } finally {
      DOUBLES_REFERENCE.on = false;
    }
    expect(tally.ready).toBe(cases.length);
  }, 120_000);

  it("merges equal outcomes and carries post-turn builds and Protect", async () => {
    const runtime = await loadBattleRuntime("champions");
    const mon = (speciesId: string, moveId: string | null, target: DoublesSlotId | null): DoublesPokemonInput => ({
      build: createBuild(speciesId, runtime), contexts: {}, charged: false, action: { moveId, target },
    });
    const input: DoublesTurnInput = {
      runtime, field: { ...createConditions(), gameType: "Doubles" },
      pokemon: {
        "own-left": mon("garchomp", "dragonclaw", "opponent-left"), "own-right": mon("incineroar", "fakeout", "opponent-right"),
        "opponent-left": mon("charizard", "protect", null), "opponent-right": mon("venusaur", "sludgebomb", "own-left"),
      },
    };
    const result = calculateDoublesOutcomes(input);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Protect takes Dragon Claw; Fake Out flinches Venusaur: one discrete outcome.
    expect(result.outcomes).toHaveLength(1);
    const [outcome] = result.outcomes;
    expect(outcome.chance).toBeCloseTo(1, 12);
    expect(outcome.mons["opponent-left"]!.protected).toBe(true);
    expect(outcome.mons["opponent-left"]!.hp).toEqual([{ hp: result.start["opponent-left"]!.hp, chance: 1 }]);
    expect(outcome.mons["opponent-right"]!.moved).toBe(true);
    expect(outcome.mons["own-left"]!.hp).toEqual([{ hp: result.start["own-left"]!.hp, chance: 1 }]);
    expect(outcome.allFainted).toEqual({ own: 0, opponent: 0 });
  });
});
