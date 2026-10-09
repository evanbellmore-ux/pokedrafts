import { REASONS, SEMI_INVULNERABLE_MOVES, STRONG_WEATHERS } from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, slotSide, type DoublesFact, type DoublesOutcomeMon, type DoublesResidual, type DoublesSlotId, type DoublesTurnInput,
} from "./doubles-types";
import {
  cloneWorld, condition, endTrap, entryCount, hpIn, join, locate, mapHP, mapJoint, marginal, mergeWorlds, type EotState, type PendingAction, type World,
} from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { berryArithmetic, berryHeals, BERSERK_BERRIES, eatBerry, HEALING_BERRIES, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";
import { canSleep, canStatus, setStatus as giveEotStatus } from "./doubles-status";
import { isMaxActive } from "./mechanics";
import {
  badDreamsDamage, bigRoot, leechSeedDamage, ownResiduals, RESIDUAL_KEYS, residualPart, weatherResiduals, type OwnResidual, type ResidualKey, type ResidualMon,
} from "./residuals";
import type { BattleBuild, BattleConditions, BattleStatus, ChampionsMove, CombatStat } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The 2v2 turn's end of turn (status-eot SPEC §2.3, §4.7, §4.9; ADDENDUM §2.3, §4.11.5, §6.0): Track B's file. One residual
// phase on every finished world, in pinned Showdown c23d2e94's fieldEvent('Residual') order (sim/battle.ts:484-567): the
// handlers are collected once as the residual starts, sorted by order, priority, the holder's Speed (updateSpeed:
// getActionSpeed, Trick Room and Tailwind as the moves left them) and subOrder (sim/battle.ts:404-411), tied handlers
// shuffled (speedSort, :429-458: here every order is its own world when two tied handlers interact), a handler skipped
// when its holder has fainted (but a slot condition: Wish) or its state is gone, and faintMessages after each handler.
// The weather calls eachEvent('Weather') and the Update after it (sim/battle.ts:465-478); the final Update and the
// Emergency Exit check come after the residual (:2843-2866). The per-Pokémon amounts are residuals.ts's. doubles-turn.ts
// (frozen) calls endOfTurn after each walk and the other hooks below from the moves.

/** Step 0's reason while the end of turn was not applied; no longer a turn fact. */
export const END_NOT_APPLIED = "End-of-turn effects are not applied.";

/**
 * The end of turn on one walk's finished worlds (doubles-turn.ts runs it after each walk: the three of
 * calculateDoublesTurn, the one of calculateDoublesOutcomes). Ready: the worlds after the residuals (their HP builds
 * endOfTurn.hp, as the moves' worlds build hp), the residuals aggregated over the turn (the recording walk's; the
 * other walks return []), and end-of-turn facts. Not estimated: why (the moves stay estimated; the caller keeps the
 * worlds after the moves). A NotEstimated a kernel helper throws inside the phase is converted by doubles-turn.ts.
 */
export type EndOfTurnRun =
  | { status: "ready"; worlds: World[]; residuals: DoublesResidual[]; facts: string[] }
  | { status: "not-estimated"; reason: string };

/** The worlds an end of turn returned (outcomeMon and conditions read them as after the whole turn). */
const afterTurn = new WeakSet<World>();

/** A trap this turn's move set (afterHit): the move that set it, for the residual's name (EotState.trap carries no move). */
type TrapState = NonNullable<EotState["trap"]> & { move?: string };

const STAT_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
const STATUS_WORDS: Record<string, string> = { brn: "burn", par: "paralysis", psn: "poison", tox: "bad poison", slp: "sleep", frz: "freeze" };
const WEATHER_NAMES: Record<string, string> = {
  Sun: "Sun", Rain: "Rain", Sand: "Sandstorm", Snow: "Snow", Hail: "Hail", "Harsh Sunshine": "Harsh sunshine", "Heavy Rain": "Heavy rain", "Strong Winds": "Strong winds",
};
const RAIN = new Set<BattleConditions["weather"]>(["Rain", "Heavy Rain"]);
/** Weathers whose onFieldResidual calls eachEvent('Weather') (and so its Update) even when suppressed (data/conditions.ts). */
const ALWAYS_WEATHER = new Set<BattleConditions["weather"]>(["Rain", "Sun", "Heavy Rain", "Harsh Sunshine", "Strong Winds"]);
/** Moves that partially trap their target as they hit (data/moves.ts volatileStatus 'partiallytrapped'). */
const TRAP_MOVES: ReadonlySet<string> = new Set(["bind", "clamp", "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "wrap"]);
/** G-Max moves whose end-of-turn damage is not modelled (data/moves.ts gmaxvinelash, gmaxwildfire, gmaxcannonade, gmaxvolcalith side conditions; gmaxcentiferno, gmaxsandblast traps). */
const GMAX_OVER_TIME: ReadonlySet<string> = new Set(["G-Max Vine Lash", "G-Max Wildfire", "G-Max Cannonade", "G-Max Volcalith", "G-Max Centiferno", "G-Max Sandblast"]);
/**
 * Abilities whose form follows an HP line at order 29 (data/abilities.ts zenmode, shieldsdown, schooling, powerconstruct
 * onResidual): `low`, the holder is in the form its HP at or under the line calls for (Zen Mode's Zen form, Minior's Core,
 * Wishiwashi's Solo, Zygarde's Complete form, which never reverts).
 */
const FORM_LINES: Readonly<Record<string, { base: string; low: (speciesId: string) => boolean; line: (maxHP: number) => number; reverts: boolean }>> = {
  zenmode: { base: "darmanitan", low: (id) => id.endsWith("zen"), line: (max) => max / 2, reverts: true },
  shieldsdown: { base: "minior", low: (id) => id !== "miniormeteor", line: (max) => max / 2, reverts: true },
  schooling: { base: "wishiwashi", low: (id) => id !== "wishiwashischool", line: (max) => max / 4, reverts: true },
  powerconstruct: { base: "zygarde", low: (id) => id === "zygardecomplete", line: (max) => max / 2, reverts: false },
};
const CURING_BERRIES: Readonly<Record<string, readonly BattleStatus[]>> = {
  cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};

// ------------------------------------------------------------------------------------------------------------------
// Statistics: DoublesResidual from the recording walk
// ------------------------------------------------------------------------------------------------------------------

type Entry = {
  slot: DoublesSlotId; effect: string; other?: DoublesSlotId; chance: number; min: number; max: number; hp: boolean; ko: number;
  facts: Map<string, number>; key: number[];
};
const before = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};
class Recorder {
  private entries = new Map<string, Entry>();
  /**
   * One residual acting on `slot` in `mass` of the turn: its HP change (null for none), whether it knocked it out, its
   * facts. `part` keeps apart two entries of one effect and pair (mutual Leech Seed: the drain and the heal), so each
   * entry acts at most once on a path.
   */
  act(slot: DoublesSlotId, effect: string, other: DoublesSlotId | undefined, mass: number, key: number[], change: { delta: number; ko: boolean } | null, facts: string[] = [], part = "") {
    if (mass <= 0) return;
    const id = `${slot}|${effect}|${other ?? ""}|${part}`;
    let entry = this.entries.get(id);
    if (!entry) this.entries.set(id, entry = { slot, effect, ...(other ? { other } : {}), chance: 0, min: Infinity, max: -Infinity, hp: false, ko: 0, facts: new Map(), key });
    else if (before(key, entry.key)) entry.key = key;
    entry.chance += mass;
    if (change) {
      entry.hp = true;
      entry.min = Math.min(entry.min, change.delta);
      entry.max = Math.max(entry.max, change.delta);
      if (change.ko) entry.ko += mass;
    }
    for (const text of facts) entry.facts.set(text, (entry.facts.get(text) ?? 0) + mass);
  }
  result(): DoublesResidual[] {
    return [...this.entries.values()].sort((a, b) => before(a.key, b.key) ? -1 : before(b.key, a.key) ? 1 : DOUBLES_SLOTS.indexOf(a.slot) - DOUBLES_SLOTS.indexOf(b.slot) || a.effect.localeCompare(b.effect))
      .map((entry): DoublesResidual => ({
        slot: entry.slot, effect: entry.effect, ...(entry.other ? { other: entry.other } : {}), chance: Math.min(1, entry.chance),
        min: entry.hp ? entry.min : null, max: entry.hp ? entry.max : null, koChance: Math.min(1, entry.ko),
        facts: [...entry.facts].map(([text, chance]): DoublesFact => ({ text, chance: Math.min(1, chance) })),
      }));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The phase
// ------------------------------------------------------------------------------------------------------------------

/** One end of turn's context: the kernel, the statistics (recording walk only), facts found, and E2 (calculateDoublesOutcomes). */
type Phase = {
  kernel: TurnKernel; rec: Recorder | null; facts: Set<string>; turnFacts: Set<string>;
  /** calculateDoublesOutcomes' walk: random stage effects (Moody, Starf Berry) are not estimated there. */
  e2: boolean;
};

/** Each present Pokémon's Speed as the residual starts (sim/battle.ts:2814 updateSpeed; pokemon.speed, read by the sort and eachEvent). */
type Speeds = Partial<Record<DoublesSlotId, number>>;

/** A residual handler of one world: its sort key and holder's Speed, the slots whose state it reads and writes (ties, C9), and its run. */
type Handler = {
  key: ResidualKey; speed: number; seq: number; reads: readonly DoublesSlotId[]; writes: readonly DoublesSlotId[];
  run: (w: World, key: number[]) => World[];
};

const alive = (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted;
/** The slot has HP in this world (alive, and some HP above 0: a Pokémon at 0 HP not yet fainted stops nothing, sim/side.ts allies). */
const hasHP = (w: World, slot: DoublesSlotId) => alive(w, slot) && someHP(w, slot, (hp) => hp > 0);
/** Whether some HP of `slot` in the world meets `test` (the keys of its marginal, read from its factor without building it). */
function someHP(w: World, slot: DoublesSlotId, test: (hp: number) => boolean): boolean {
  const f = w.factors[locate(w, slot).factor];
  for (const key of f.table.keys()) if (test(hpIn(f, key, slot))) return true;
  return false;
}
/** Worlds merged (mergeWorlds); one world with mass is its own merge. */
function merge(kernel: TurnKernel, worlds: World[]): World[] {
  return worlds.length === 1 && worlds[0].mass > 0 ? worlds : mergeWorlds(worlds, kernel.mode === "all");
}
/** The statistics key extended by `part` while this walk records (Recorder); unread otherwise, so not built. */
const sub = (p: Phase, key: number[], part: number): number[] => p.rec ? [...key, part] : key;
const NO_KEY: number[] = [];

export function endOfTurn(kernel: TurnKernel, worlds: World[]): EndOfTurnRun {
  const reason = guardOf(kernel, worlds);
  if (reason) return { status: "not-estimated", reason };
  const phase: Phase = { kernel, rec: kernel.recording ? new Recorder() : null, facts: new Set(), turnFacts: new Set(), e2: kernel.mode === "all" && !kernel.recording };
  const out: World[] = [];
  for (const world of worlds) {
    out.push(...run(phase, cloneWorld(world)));
    budget(kernel, out);
  }
  const merged = kernel.reference ? out : merge(kernel, out);
  budget(kernel, merged);
  for (const world of merged) afterTurn.add(world);
  for (const text of phase.turnFacts) kernel.turnFact(text);
  return { status: "ready", worlds: merged, residuals: phase.rec?.result() ?? [], facts: [...phase.facts] };
}

function budget(kernel: TurnKernel, worlds: World[]) {
  if (kernel.reference) return;
  if (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries) kernel.notEstimated(REASONS.tooMany);
}

/**
 * Why the end of turn is not estimated, decided before it runs (SPEC §2.3): an end-of-turn guard the moves set (an L move
 * last, World.endGuard), a Pokémon that left with no later action (World.leaving), a carried Future Sight or Cud Chew, a
 * Harvest holder with no item, a Pickup holder with no item when another Pokémon lost one this turn, a G-Max move whose
 * damage over time landed (Sword/Shield), Moody in E2. The reason with the most mass, ties alphabetical; null for none.
 * An item used inside the residual before 28.2 (the weather's Update, a Lum Berry at a Yawn's sleep) is guarded by the
 * Harvest and Pickup handlers themselves (harvestGuard, pickupGuard).
 */
function guardOf(kernel: TurnKernel, worlds: World[]): string | null {
  const masses = new Map<string, number>();
  const gmax = new Map<DoublesSlotId, string>();
  for (const slot of DOUBLES_SLOTS) {
    const entry = kernel.input.pokemon[slot], moveId = entry?.action.moveId;
    if (!entry || !moveId || !worlds.length || !worlds[0].mons[slot]) continue;
    // A G-Max Move needs a Gigantamax user (its build's mechanic); no other build's move is converted to one.
    if (worlds[0].mons[slot]!.build.mechanic !== "gigantamax") continue;
    if (kernel.runtime.movesById.get(moveId)?.category === "Status" && !entry.contexts[moveId]?.useZ) continue;
    const info = kernel.moveInfo(worlds[0], slot, moveId, entry.contexts[moveId]);
    if (info.kind === "move" && GMAX_OVER_TIME.has(info.effective.name)) gmax.set(slot, info.effective.name);
  }
  const e2 = kernel.mode === "all" && !kernel.recording;
  for (const w of worlds) {
    const reason = worldGuard(kernel, w, gmax, e2);
    if (reason) masses.set(reason, (masses.get(reason) ?? 0) + w.mass);
  }
  if (!masses.size) return null;
  return [...masses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function worldGuard(kernel: TurnKernel, w: World, gmax: Map<DoublesSlotId, string>, e2: boolean): string | null {
  if (w.endGuard) return w.endGuard;
  if (w.leaving?.length) return REASONS.switchesOut(kernel.names[w.leaving[0]]);
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    if (mon.eot.futureMove) return REASONS.landing(kernel.moveName(mon.eot.futureMove));
    if (mon.eot.cudChew && !mon.fainted) return REASONS.notIn2v2(kernel.abilityName("cudchew"));
    if (mon.fainted) continue;
    const ability = mon.build.abilityId;
    if (gmax.has(slot) && mon.moved) return REASONS.overTime(gmax.get(slot)!);
    if (ability === "harvest" && !mon.build.itemId) return REASONS.notIn2v2(kernel.abilityName("harvest"));
    if (ability === "pickup" && !mon.build.itemId && DOUBLES_SLOTS.some((other) => other !== slot && kernel.input.pokemon[other]?.build.itemId && w.mons[other] && !w.mons[other]!.build.itemId)) {
      return REASONS.notIn2v2(kernel.abilityName("pickup"));
    }
    if (ability === "moody" && e2) return REASONS.notIn2v2(kernel.abilityName("moody"));
  }
  return null;
}

/** One world's end of turn: the worlds after the residuals and the final Update. */
function run(p: Phase, w0: World): World[] {
  const { kernel } = p;
  // A Pokémon at 0 HP the moves left unfainted faints now (none expected: the moves resolve their faints).
  let worlds = resolveFaints(kernel, [w0]);
  // A side with no Pokémon left to send in lost its last one during the moves: the battle ended there (no residual).
  const ended = worlds.filter((w) => over(p, w));
  worlds = worlds.filter((w) => !ended.includes(w));
  // Emergency Exit and Wimp Out read the HP at the residual's start (sim/battle.ts:2814 residualPokemon): split by it.
  const exits = DOUBLES_SLOTS.filter((slot) => alive(w0, slot) && ["emergencyexit", "wimpout"].includes(w0.mons[slot]!.build.abilityId) && canSwitch(kernel, slot));
  worlds = worlds.flatMap((w) => splitAbove(kernel, w, exits));
  const out: World[] = [...ended];
  for (const start of worlds) {
    const present = DOUBLES_SLOTS.filter((slot) => start.mons[slot]);
    const startBoosts = new Map(present.map((slot) => [slot, { ...start.mons[slot]!.build.boosts }]));
    const startItems = new Map(present.map((slot) => [slot, start.mons[slot]!.build.itemId]));
    // updateSpeed once, as the residual starts (sim/battle.ts:2814): the handlers' sort and the weather's eachEvent read it.
    const speeds: Speeds = {};
    for (const slot of present) speeds[slot] = kernel.speedOf(start, slot);
    const above = new Set(exits.filter((slot) => !someHP(start, slot, (hp) => undynamaxed(kernel, slot, hp) * 2 <= kernel.hp[slot].baseMaxHP)));
    const handlers = collect(p, start, startBoosts, startItems, speeds);
    handlers.sort(compareHandlers);
    let ws = [start];
    for (let i = 0; i < handlers.length;) {
      let j = i + 1;
      while (j < handlers.length && compareHandlers(handlers[i], handlers[j]) === 0) j++;
      ws = runGroup(p, ws, handlers.slice(i, j));
      if (!kernel.reference) ws = merge(kernel, ws);
      budget(kernel, ws);
      i = j;
    }
    // The final Update (sim/battle.ts:2860): every Pokémon with HP, after the faints; none once the battle ended.
    out.push(...ws.filter((w) => over(p, w)));
    ws = ws.filter((w) => !over(p, w)).flatMap((w) => updateAll(p, w, p.rec ? [LAST_KEY, 1] : NO_KEY));
    for (const w of ws) afterChecks(p, w, startBoosts, startItems, above);
    out.push(...ws);
  }
  return out;
}

const LAST_KEY = 2 ** 33;

function compareHandlers(a: Handler, b: Handler): number {
  return a.key.order - b.key.order || b.key.priority - a.key.priority || b.speed - a.speed || a.key.subOrder - b.key.subOrder;
}

/** A group of tied handlers (C9): once in collection order when no two touch the same Pokémon's state, else every order as its own world at mass/k!. */
function runGroup(p: Phase, worlds: World[], group: Handler[]): World[] {
  // A world whose battle ended (checkWin after a handler's faintMessages) runs no later handler.
  const step = (ws: World[], handler: Handler) => ws.flatMap((w) => over(p, w) ? [w]
    : resolveFaints(p.kernel, handler.run(w, p.rec ? [handler.key.order, -handler.key.priority, -handler.speed, handler.key.subOrder, handler.seq] : NO_KEY)));
  if (group.length === 1 || (!p.kernel.reference && commute(p.kernel, group))) return group.reduce(step, worlds);
  if (group.length > 5) p.kernel.notEstimated(REASONS.tooMany);
  const orders = permutations(group);
  return orders.flatMap((order) => order.reduce(step, worlds.map((w) => cloneWorld(w, w.mass / orders.length))));
}

function commute(kernel: TurnKernel, group: Handler[]): boolean {
  // A handler that can end the battle (a side with no Pokémon left to send in) decides whether the others run.
  if (group.some((handler) => handler.writes.some((slot) => kernel.input.canSwitch?.[slotSide(slot)] === false))) return false;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.writes.some((slot) => b.reads.includes(slot) || b.writes.includes(slot)) || b.writes.some((slot) => a.reads.includes(slot))) return false;
    }
  }
  return true;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

/** faintMessages after a handler: a slot holding 0 and positive HP is split, and the 0 side faints (kernel.faint: Soul-Heart, a strong weather, gas, Receiver). */
function resolveFaints(kernel: TurnKernel, worlds: World[]): World[] {
  // A strong weather ending with its last holder (kernel.faint) changes what a field-settled ability or item reads.
  const faint = (w: World, slot: DoublesSlotId) => {
    const weather = w.field.weather;
    kernel.faint(w, slot);
    if (w.field.weather !== weather) fieldChangeGuard(kernel, w);
  };
  let out = worlds;
  for (const slot of DOUBLES_SLOTS) {
    // Most handlers knock no one out: the worlds stand as they are.
    if (!out.some((w) => alive(w, slot) && someHP(w, slot, (hp) => hp <= 0))) continue;
    out = out.flatMap((w) => {
      if (!alive(w, slot) || !someHP(w, slot, (hp) => hp <= 0)) return [w];
      const positive = someHP(w, slot, (hp) => hp > 0);
      if (!positive) { faint(w, slot); return [w]; }
      return condition(w, slot, (hp) => hp > 0).map(({ world, meets }) => { if (!meets) faint(world, slot); return world; });
    });
  }
  return out;
}

/** Each slot with both 0 and positive HP split, no faint yet (the Update inside a handler, before its faintMessages). */
function splitZero(worlds: World[]): World[] {
  let out = worlds;
  for (const slot of DOUBLES_SLOTS) {
    if (!out.some((w) => alive(w, slot) && someHP(w, slot, (hp) => hp <= 0))) continue;
    out = out.flatMap((w) => {
      if (!alive(w, slot)) return [w];
      return someHP(w, slot, (hp) => hp <= 0) && someHP(w, slot, (hp) => hp > 0) ? condition(w, slot, (hp) => hp > 0).map(({ world }) => world) : [w];
    });
  }
  return out;
}

function splitAbove(kernel: TurnKernel, w: World, slots: DoublesSlotId[]): World[] {
  let out = [w];
  for (const slot of slots) {
    const line = (hp: number) => undynamaxed(kernel, slot, hp) * 2 > kernel.hp[slot].baseMaxHP;
    out = out.flatMap((x) => someHP(x, slot, line) && someHP(x, slot, (hp) => !line(hp)) ? condition(x, slot, line).map(({ world }) => world) : [x]);
  }
  return out;
}

/** sim/pokemon.ts getUndynamaxedHP: the HP without Dynamax (rounded up). */
function undynamaxed(kernel: TurnKernel, slot: DoublesSlotId, hp: number): number {
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  return maxHP !== baseMaxHP ? Math.ceil(hp * baseMaxHP / maxHP) : hp;
}

const SIDES = ["own", "opponent"] as const;
const canSwitch = (kernel: TurnKernel, slot: DoublesSlotId) => kernel.input.canSwitch?.[slotSide(slot)] ?? true;

/**
 * The battle is over in this world (sim/battle.ts checkWin after faintMessages): a side with no Pokémon left to send in
 * (canSwitch false) has every Pokémon it had in place fainted. With canSwitch absent the turn assumes one is left (a fact).
 */
function over(p: Phase, w: World): boolean {
  let done = false;
  for (const side of SIDES) {
    let present = false, wiped = true;
    for (const slot of DOUBLES_SLOTS) {
      const mon = w.mons[slot];
      if (!mon || slotSide(slot) !== side) continue;
      present = true;
      if (!mon.fainted) wiped = false;
    }
    if (!present || !wiped) continue;
    const left = p.kernel.input.canSwitch?.[side];
    if (left === false) done = true;
    else if (left === undefined) p.turnFacts.add(`Assumes ${side === "own" ? "your side" : "the opponent's side"} has a Pokémon left to switch in.`);
  }
  return done;
}

/** The Pokémon as the residual rules read it (residuals.ts). */
function residualMon(kernel: TurnKernel, w: World, slot: DoublesSlotId): ResidualMon {
  const mon = w.mons[slot]!;
  const build = mon.build;
  return {
    baseMaxHP: kernel.hp[slot].baseMaxHP, types: kernel.typesOf(build), ability: build.abilityId, item: kernel.itemWorks(w, build) ? build.itemId : "",
    status: build.status, toxicStage: mon.eot.toxic ?? 0, grounded: kernel.grounded(w, slot), semiInvulnerable: !!mon.eot.hidden,
    sheltered: mon.eot.hidden === "sheltered", saltCure: !!mon.eot.saltCure, aquaRing: !!mon.eot.aquaRing, ingrain: !!mon.eot.ingrain, curse: !!mon.eot.curse,
    healBlocked: !!mon.eot.healBlock,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// HP changes (one slot, or two together), recorded
// ------------------------------------------------------------------------------------------------------------------

/** `slot`'s HP through `to` (a deterministic change), recorded as `effect` where it changes. */
function changeHP(p: Phase, w: World, slot: DoublesSlotId, effect: string, key: number[], to: (hp: number) => number, other?: DoublesSlotId): World {
  if (p.rec) {
    for (const [hp, mass] of marginal(w, slot)) {
      const next = to(hp);
      if (next !== hp) p.rec.act(slot, effect, other, w.mass * mass, key, { delta: next - hp, ko: hp > 0 && next <= 0 });
    }
  }
  const hurt = !!w.mons[slot]?.vol.berryLocked && someHP(w, slot, (hp) => hp > 0 && to(hp) < hp);
  const out = mapHP(w, slot, (hp) => ({ hp: to(hp), tag: "" }))[0].world;
  if (hurt) unlock(out, slot);
  return out;
}
/**
 * A residual's damage (no move's: sim/battle.ts damage) resets a Berserk or Anger Shell lock (MoveVolatiles.berryLocked, a
 * confusion self-hit's; data/abilities.ts berserk, angershell onDamage: checkedBerserk true), so the Updates after it eat
 * the healing Berry the lock kept (updateSlot).
 */
function unlock(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon?.vol.berryLocked) return;
  const { berryLocked: _locked, ...rest } = mon.vol;
  void _locked;
  mon.vol = rest;
}
/** A residual's damage (capped at the HP) or heal (none at 0 HP or at full HP). */
function amountTo(kernel: TurnKernel, slot: DoublesSlotId, amount: number): (hp: number) => number {
  const max = kernel.hp[slot].maxHP;
  return (hp) => hp <= 0 ? hp : amount < 0 ? Math.max(0, hp + amount) : hp >= max ? hp : Math.min(max, hp + amount);
}
const ownName = (kernel: TurnKernel, id: OwnResidual["id"], w: World, slot: DoublesSlotId): string => {
  switch (id) {
    case "sandstorm": return "Sandstorm";
    case "hail": return "Hail";
    case "grassyterrain": return "Grassy Terrain";
    case "psn": return "Poison";
    case "tox": return "Bad poison";
    case "brn": return "Burn";
    case "curse": return "Curse";
    case "saltcure": return "Salt Cure";
    case "aquaring": return "Aqua Ring";
    case "ingrain": return "Ingrain";
    case "partiallytrapped": { const move = (w.mons[slot]!.eot.trap as TrapState | undefined)?.move; return move ? kernel.moveName(move) : "Partial trap"; }
    case "icebody": case "raindish": case "dryskin": case "solarpower": case "poisonheal": return kernel.abilityName(id);
    default: return kernel.itemName(id);
  }
};

// ------------------------------------------------------------------------------------------------------------------
// The handlers (collected once, as the residual starts)
// ------------------------------------------------------------------------------------------------------------------

function collect(p: Phase, w: World, startBoosts: Map<DoublesSlotId, BattleBuild["boosts"]>, startItems: Map<DoublesSlotId, string>, speeds: Speeds): Handler[] {
  const { kernel } = p;
  const handlers: Handler[] = [];
  const add = (key: ResidualKey, holder: DoublesSlotId | null, reads: readonly DoublesSlotId[], writes: readonly DoublesSlotId[], run: Handler["run"]) => {
    handlers.push({ key, speed: holder ? speeds[holder] ?? 0 : 0, seq: handlers.length, reads, writes, run });
  };
  // Order 1: the weather, one field handler (Speed 0) whose part on each Pokémon runs in Speed order, then its Update.
  if (w.field.weather) add(RESIDUAL_KEYS.weather, null, DOUBLES_SLOTS, DOUBLES_SLOTS, (x, key) => weatherHandler(p, x, key, speeds));
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    // Order 4: a Wish at this position (a slot condition: it runs for a fainted occupant too, and heals nothing then).
    if (mon.eot.wish !== undefined) {
      const at = kernel.occupant(w, slot);
      if (w.mons[at]) add(RESIDUAL_KEYS.wish, at, [at], [at], (x, key) => wishHandler(p, x, slot, key));
    }
  }
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const build = mon.build, ability = build.abilityId;
    const item = kernel.itemWorks(w, build) ? build.itemId : "";
    const ally = allyOf(slot);
    const own = (id: OwnResidual["id"]) => (x: World, key: number[]) => ownHandler(p, x, slot, id, key);
    if (w.field.terrain === "Grassy") add(RESIDUAL_KEYS.grassyterrain, slot, [slot], [slot], own("grassyterrain"));
    if (ability === "healer") add(RESIDUAL_KEYS.healer, slot, [slot, ally], [ally], (x, key) => healerHandler(p, x, slot, key));
    if (ability === "hydration") add(RESIDUAL_KEYS.hydration, slot, [slot], [slot], (x, key) => cureHandler(p, x, slot, "hydration", key));
    if (ability === "shedskin") add(RESIDUAL_KEYS.shedskin, slot, [slot], [slot], (x, key) => cureHandler(p, x, slot, "shedskin", key));
    if (item === "leftovers" || item === "blacksludge") add(RESIDUAL_KEYS[item], slot, [slot], [slot], own(item));
    if (mon.eot.aquaRing) add(RESIDUAL_KEYS.aquaring, slot, [slot], [slot], own("aquaring"));
    if (mon.eot.ingrain) add(RESIDUAL_KEYS.ingrain, slot, [slot], [slot], own("ingrain"));
    if (mon.eot.leechSeed) {
      const gainer = kernel.occupant(w, mon.eot.leechSeed);
      add(RESIDUAL_KEYS.leechseed, slot, [slot, gainer], [slot, gainer], (x, key) => leechSeedHandler(p, x, slot, key));
    }
    if (build.status === "psn" || build.status === "tox") add(RESIDUAL_KEYS[build.status], slot, [slot], [slot], (x, key) => poisonHandler(p, x, slot, build.status as "psn" | "tox", key));
    if (build.status === "brn") add(RESIDUAL_KEYS.brn, slot, [slot], [slot], (x, key) => statusDamage(p, x, slot, "brn", key));
    if (mon.eot.curse) add(RESIDUAL_KEYS.curse, slot, [slot], [slot], own("curse"));
    if (mon.eot.trap) add(RESIDUAL_KEYS.partiallytrapped, slot, [slot, mon.eot.trap.source], [slot], (x, key) => trapHandler(p, x, slot, key));
    if (mon.eot.saltCure) add(RESIDUAL_KEYS.saltcure, slot, [slot], [slot], own("saltcure"));
    if (mon.eot.syrupBomb) {
      const source = mon.eot.syrupBomb;
      // Its source gone before the residual: the volatile ended at that action's Update (data/moves.ts syrupbomb onUpdate).
      if (!alive(w, source)) mon.eot = { ...mon.eot, syrupBomb: undefined };
      else add(RESIDUAL_KEYS.syrupbomb, slot, [slot, source], [slot, source], (x, key) => syrupBombHandler(p, x, slot, source, key));
    }
    if (mon.eot.yawn) add(RESIDUAL_KEYS.yawn, slot, [slot], [slot], (x, key) => yawnHandler(p, x, slot, key));
    if (mon.eot.perish) add(RESIDUAL_KEYS.perishsong, slot, [slot], [slot], (x, key) => perishHandler(p, x, slot, key));
    // Order 25: Roost's volatile ends (data/moves.ts roost condition, duration 1): ungrounded again for the Orbs at 28.3.
    if (mon.eot.roosted) add(RESIDUAL_KEYS.roost, slot, [], [slot], (x) => { roostEnds(x, slot); return [x]; });
    if (ability === "baddreams") add(RESIDUAL_KEYS.baddreams, slot, [slot, ...foesOf(slot)], [...foesOf(slot)], (x, key) => badDreamsHandler(p, x, slot, key));
    if (ability === "speedboost") add(RESIDUAL_KEYS.speedboost, slot, [slot], [slot], (x, key) => speedBoostHandler(p, x, slot, key));
    if (ability === "harvest") add(RESIDUAL_KEYS.harvest, slot, [slot], [], (x) => harvestGuard(p, x, slot, startItems.get(slot) ?? ""));
    if (ability === "pickup") add(RESIDUAL_KEYS.pickup, slot, DOUBLES_SLOTS, [], (x) => pickupGuard(p, x, slot, startItems));
    if (ability === "moody") add(RESIDUAL_KEYS.moody, slot, [slot], [slot], (x) => { if (alive(x, slot)) p.turnFacts.add("Moody raises one stat and lowers another."); return [x]; });
    if (item === "stickybarb") add(RESIDUAL_KEYS.stickybarb, slot, [slot], [slot], own("stickybarb"));
    if (item === "flameorb" || item === "toxicorb") add(RESIDUAL_KEYS[item], slot, [slot], [slot], (x, key) => orbHandler(p, x, slot, item, key));
    if (FORM_LINES[ability]) add(RESIDUAL_KEYS[ability], slot, [slot], [slot], (x) => formGuard(p, x, slot));
    if (ability === "hungerswitch") add(RESIDUAL_KEYS.hungerswitch, slot, [slot], [slot], (x, key) => hungerSwitch(p, x, slot, key));
    if (item === "whiteherb") add(RESIDUAL_KEYS.whiteherb, slot, [slot], [slot], (x, key) => whiteHerb(p, x, slot, key));
    if (item === "ejectpack") add(RESIDUAL_KEYS.ejectpack, slot, [slot], [slot], (x, key) => ejectPack(p, x, slot, startBoosts.get(slot)!, key));
    if (item === "micleberry") add(RESIDUAL_KEYS.micleberry, slot, [slot, ...foesOf(slot)], [slot], (x, key) => micleBerry(p, x, slot, key));
  }
  return handlers;
}

/**
 * Order 1, the weather (data/conditions.ts onFieldResidual). Its duration counts down first (sim/battle.ts:515-521): a
 * weather from before the turn with weatherTurns 1 ends instead of acting. Rain, sun and the strong weathers call
 * eachEvent('Weather') always; sand, hail and snow only while not suppressed (field.isWeather). Under Cloud Nine or Air
 * Lock every Weather handler is skipped, but the Update after it still runs (sim/battle.ts:465-478).
 */
function weatherHandler(p: Phase, w: World, key: number[], speeds: Speeds): World[] {
  const { kernel } = p;
  const weather = w.field.weather;
  // A weather the moves set (World.weatherSet: Rain Dance after Sunny Day, Sand Spit) has a new duration and goes on
  // (sim/field.ts setWeather); only the one from before the turn has the input's turns left.
  const fromBefore = !w.weatherSet && weather === kernel.input.field.weather && !STRONG_WEATHERS[weather];
  if (fromBefore && kernel.input.weatherTurns === 1) {
    w.field = { ...w.field, weather: "" };
    fieldChangeGuard(kernel, w);
    p.facts.add(`${WEATHER_NAMES[weather] ?? weather} ends.`);
    return [w];
  }
  const suppressed = !kernel.effectiveWeather(w);
  if (suppressed && !ALWAYS_WEATHER.has(weather)) return [w];
  let ws = [w];
  if (!suppressed) {
    // eachEvent('Weather'): the Pokémon in the Speed updateSpeed gave them as the residual started.
    const order = DOUBLES_SLOTS.filter((slot) => alive(w, slot)).sort((a, b) => (speeds[b] ?? 0) - (speeds[a] ?? 0));
    const lasting = lastingFact(kernel, w);
    order.forEach((slot, index) => {
      ws = ws.map((x) => {
        let next = x;
        for (const each of weatherResiduals(residualMon(kernel, x, slot), weather)) {
          next = changeHP(p, next, slot, ownName(kernel, each.id, next, slot), sub(p, key, index), amountTo(kernel, slot, each.amount));
          if (lasting) p.turnFacts.add(lasting);
        }
        return next;
      });
    });
  }
  // The Update after the weather (gen 7+), before the handler's faintMessages: a Pokémon at 0 HP neither eats nor stops a Berry.
  return splitZero(ws).flatMap((x) => updateAll(p, x, sub(p, key, 100)));
}

/**
 * The turn fact for a result that relies on the weather from before the turn going on through this residual, when the
 * input does not give its turns left (weatherTurns): a weather's damage or heal, Hydration's cure, Leaf Guard stopping a
 * status. Null when the turns are given, or the weather is not the one from before the turn (a strong weather has none;
 * one the moves set has its new duration).
 */
function lastingFact(kernel: TurnKernel, w: World): string | null {
  const weather = w.field.weather;
  if (!weather || w.weatherSet || kernel.input.weatherTurns !== undefined || weather !== kernel.input.field.weather || STRONG_WEATHERS[weather]) return null;
  return `Assumes the ${WEATHER_NAMES[weather] ?? weather} does not end this turn.`;
}

/** Order 4: a Wish landing at `position` heals the Pokémon standing there (ADDENDUM A7; data/moves.ts wish condition onEnd: not a fainted one; Heal Block). */
function wishHandler(p: Phase, w: World, position: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  const holder = w.mons[position]!;
  const amount = holder.eot.wish!;
  holder.eot = { ...holder.eot, wish: undefined };
  const target = kernel.occupant(w, position);
  if (!alive(w, target) || w.mons[target]!.eot.healBlock) return [w];
  return [changeHP(p, w, target, "Wish", key, amountTo(kernel, target, Math.max(1, Math.trunc(amount))))];
}

/** A residual of the Pokémon on itself (residuals.ts ownResiduals), read as it runs: its holder still in, the state it reads still there. */
function ownHandler(p: Phase, w: World, slot: DoublesSlotId, id: OwnResidual["id"], key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = residualMon(kernel, w, slot);
  const each = ownResiduals(mon, { terrain: w.field.terrain, champions: kernel.champions }).find((entry) => entry.id === id);
  if (!each) return [w];
  return [changeHP(p, w, slot, ownName(kernel, id, w, slot), key, amountTo(kernel, slot, each.amount))];
}

/** Order 9: poison and bad poison (bad poison's stage rises first, Magic Guard or not; Poison Heal heals instead), on the status it still has. */
function poisonHandler(p: Phase, w: World, slot: DoublesSlotId, status: "psn" | "tox", key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.status !== status) return [w];
  const stage = mon.eot.toxic ?? 0;
  const out = statusDamage(p, w, slot, status, key);
  if (status === "tox") {
    for (const x of out) x.mons[slot]!.eot = { ...x.mons[slot]!.eot, toxic: Math.min(15, stage + 1) };
    const input = kernel.input.pokemon[slot];
    if (input?.build.status === "tox" && input.carried?.toxic === undefined) p.turnFacts.add(`Assumes this is ${kernel.names[slot]}'s first turn of bad poison damage.`);
  }
  return out;
}

/** A status's damage (9, 10), or Poison Heal's heal, on the status it still has. */
function statusDamage(p: Phase, w: World, slot: DoublesSlotId, status: "psn" | "tox" | "brn", key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || w.mons[slot]!.build.status !== status) return [w];
  const mon = residualMon(kernel, w, slot);
  const each = ownResiduals(mon, { terrain: "", champions: kernel.champions }).find((entry) => entry.id === status || (entry.id === "poisonheal" && status !== "brn"));
  if (!each) return [w];
  return [changeHP(p, w, slot, ownName(kernel, each.id, w, slot), key, amountTo(kernel, slot, each.amount))];
}

/** Order 5.3: Healer cures its ally's status (Champions 1/2, otherwise 3/10; data/mods/champions/abilities.ts healer). */
function healerHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  const ally = allyOf(slot);
  if (!alive(w, slot) || !hasHP(w, ally) || !w.mons[ally]!.build.status) return [w];
  const chance = kernel.champions ? 1 / 2 : 3 / 10;
  const cured = cloneWorld(w, w.mass * chance), kept = cloneWorld(w, w.mass * (1 - chance));
  p.rec?.act(ally, kernel.abilityName("healer"), slot, cured.mass, key, null, [`Cures its ${STATUS_WORDS[w.mons[ally]!.build.status]}.`]);
  cureStatus(cured, ally);
  return [cured, kept];
}

/** Order 5.3: Hydration in rain or Heavy Rain by the holder's own weather (a Utility Umbrella: none), Shed Skin with 33/100. */
function cureHandler(p: Phase, w: World, slot: DoublesSlotId, ability: "hydration" | "shedskin", key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const status = mon.build.status;
  if (!status) return [w];
  const fact = `Cures its ${STATUS_WORDS[status]}.`;
  if (ability === "hydration") {
    const umbrella = mon.build.itemId === "utilityumbrella" && kernel.itemWorks(w, mon.build);
    if (!RAIN.has(kernel.effectiveWeather(w)) || umbrella) return [w];
    // The cure relies on the rain from before the turn still being up (its end at order 1 would leave the status).
    const lasting = lastingFact(kernel, w);
    if (lasting) p.turnFacts.add(lasting);
    p.rec?.act(slot, kernel.abilityName(ability), undefined, w.mass, key, null, [fact]);
    cureStatus(w, slot);
    return [w];
  }
  const cured = cloneWorld(w, w.mass * 0.33), kept = cloneWorld(w, w.mass * 0.67);
  p.rec?.act(slot, kernel.abilityName(ability), undefined, cured.mass, key, null, [fact]);
  cureStatus(cured, slot);
  return [cured, kept];
}

/** sim/pokemon.ts cureStatus: the status and what goes with it (the sleep counter, bad poison's stage). */
function cureStatus(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  mon.build = { ...mon.build, status: "" };
  mon.vol = { ...mon.vol, sleep: undefined, freeze: undefined };
  mon.eot = { ...mon.eot, toxic: undefined };
}

/**
 * Order 8: Leech Seed (data/moves.ts leechseed condition onResidual). The Pokémon standing at the seeder's position gains
 * (ADDENDUM A6): none when that slot is empty or its Pokémon fainted. The seeded loses baseMaxHP/8 (at least 1, capped at its
 * HP; Magic Guard: nothing); the gainer heals what it lost (Big Root ×5324/4096; none at full HP, none under Heal Block), or
 * the seeded's Liquid Ooze deals that to it instead (Magic Guard stops it).
 */
function leechSeedHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !w.mons[slot]!.eot.leechSeed) return [w];
  const gainer = kernel.occupant(w, w.mons[slot]!.eot.leechSeed!);
  if (!alive(w, gainer)) return [w];
  const damage = leechSeedDamage(residualMon(kernel, w, slot));
  if (!damage) return [w];
  const seeded = w.mons[slot]!.build, gaining = w.mons[gainer]!;
  const ooze = seeded.abilityId === "liquidooze";
  if (ooze && gaining.eot.healBlock) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("liquidooze")));
  const guard = gaining.build.abilityId === "magicguard";
  const root = gaining.build.itemId === "bigroot" && kernel.itemWorks(w, gaining.build);
  const max = kernel.hp[gainer].maxHP;
  const gain = (hg: number, drained: number) => {
    if (hg <= 0) return hg;
    if (ooze) return guard ? hg : Math.max(0, hg - drained);
    if (gaining.eot.healBlock || hg >= max) return hg;
    return Math.min(max, hg + (root ? bigRoot(drained) : drained));
  };
  const seedName = kernel.moveName("leechseed"), oozeName = kernel.abilityName("liquidooze");
  if (gainer === slot) {
    // Its own position after an Ally Switch: it drains into itself (getAtSlot(sourceSlot) is the seeded).
    const self = changeHP(p, w, slot, seedName, key, (hp) => { const left = hp - Math.min(hp, damage); return left > 0 ? gain(left, Math.min(hp, damage)) : left; });
    unlock(self, slot);
    return [self];
  }
  if (p.rec) {
    for (const [hx, hg, mass] of jointEntries(w, slot, gainer)) {
      const drained = Math.min(hx, damage), after = gain(hg, drained);
      p.rec.act(slot, seedName, gainer, w.mass * mass, key, { delta: -drained, ko: hx - drained <= 0 }, [], "drain");
      if (after !== hg) p.rec.act(gainer, ooze ? oozeName : seedName, slot, w.mass * mass, key, { delta: after - hg, ko: hg > 0 && after <= 0 }, [], "gain");
    }
  }
  return mapJoint(w, [slot, gainer], (hx, hg) => { const drained = Math.min(hx, damage); return { hp: [hx - drained, gain(hg, drained)], tag: "" }; }).map(({ world }) => {
    // The seeded's loss, and Liquid Ooze's damage to the gainer, reset a Berserk or Anger Shell lock (unlock).
    unlock(world, slot);
    if (ooze && !guard) unlock(world, gainer);
    return world;
  });
}

/** Two slots' joint HP entries: [hpA, hpB, mass]. */
function jointEntries(w: World, a: DoublesSlotId, b: DoublesSlotId): [number, number, number][] {
  const base = cloneWorld(w);
  const at = join(base, [a, b]);
  const factor = base.factors[at];
  return [...factor.table].map(([key, mass]) => [hpIn(factor, key, a), hpIn(factor, key, b), mass]);
}

/** Order 13: a partial trap damages while its source is in with HP (data/conditions.ts partiallytrapped onResidual); otherwise it ends, silently. */
function trapHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !w.mons[slot]!.eot.trap) return [w];
  const trap = w.mons[slot]!.eot.trap!;
  if (!alive(w, trap.source)) { endTrap(w, slot); return [w]; }
  const mon = residualMon(kernel, w, slot);
  const each = ownResiduals({ ...mon, trapDivisor: trap.divisor }, { terrain: "", champions: kernel.champions }).find((entry) => entry.id === "partiallytrapped");
  if (!each) return [w];
  return [changeHP(p, w, slot, ownName(kernel, "partiallytrapped", w, slot), key, amountTo(kernel, slot, each.amount), trap.source)];
}

/** Order 14: Syrup Bomb lowers the holder's Speed by 1 from its source (data/moves.ts syrupbomb onResidual; Mirror Armor, Clear Body... through foeDrop). */
function syrupBombHandler(p: Phase, w: World, slot: DoublesSlotId, source: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot) || w.mons[slot]!.eot.syrupBomb !== source) return [w];
  const was = { ...w.mons[slot]!.build.boosts };
  p.kernel.foeDrop(w, slot, { spe: -1 }, source);
  stageFacts(p, w, slot, p.kernel.moveName("syrupbomb"), source, was, key);
  return [w];
}

/** Stage changes as facts ("Speed −1."), recorded under `effect`. */
function stageFacts(p: Phase, w: World, slot: DoublesSlotId, effect: string, other: DoublesSlotId | undefined, was: BattleBuild["boosts"], key: number[]) {
  if (!p.rec) return;
  const now = w.mons[slot]!.build.boosts;
  const facts = STATS.filter((stat) => (now[stat] ?? 0) !== (was[stat] ?? 0)).map((stat) => {
    const by = (now[stat] ?? 0) - (was[stat] ?? 0);
    return `${STAT_NAMES[stat]} ${by > 0 ? "+" : "−"}${Math.abs(by)}.`;
  });
  if (facts.length) p.rec.act(slot, effect, other, w.mass, key, null, facts);
}

/**
 * Order 23: Yawn (data/moves.ts yawn condition, duration 2). This turn's counts down; the one from last turn ends and
 * puts it to sleep (trySetStatus with the Yawn's source: Safeguard and Flower Veil let it through).
 */
function yawnHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.eot.yawn === 2) { mon.eot = { ...mon.eot, yawn: 1 }; return [w]; }
  mon.eot = { ...mon.eot, yawn: undefined };
  return setStatus(p, w, slot, "slp", "yawn", kernel.moveName("yawn"), key);
}

/** Order 24: Perish Song's count (data/moves.ts perishsong condition, duration 4): at 0 it faints. */
function perishHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !w.mons[slot]!.eot.perish) return [w];
  const mon = w.mons[slot]!;
  const count = mon.eot.perish! - 1;
  const name = kernel.moveName("perishsong");
  if (count > 0) {
    mon.eot = { ...mon.eot, perish: count };
    p.rec?.act(slot, name, undefined, w.mass, key, null, [`Perish count ${count}.`]);
    return [w];
  }
  mon.eot = { ...mon.eot, perish: undefined };
  return [changeHP(p, w, slot, name, key, () => 0)];
}

/** Roost's volatile ending at order 25 (its duration of 1 counted down: sim/battle.ts fieldEvent's end). */
function roostEnds(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (mon?.eot.roosted) mon.eot = { ...mon.eot, roosted: undefined };
}

/** Order 28.2: Bad Dreams on each sleeping or Comatose foe with HP while its holder has HP (data/abilities.ts baddreams; Magic Guard). */
function badDreamsHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!hasHP(w, slot)) return [w];
  let next = w;
  for (const foe of foesOf(slot)) {
    if (!hasHP(next, foe)) continue;
    const damage = badDreamsDamage(residualMon(kernel, next, foe));
    if (damage) next = changeHP(p, next, foe, kernel.abilityName("baddreams"), key, amountTo(kernel, foe, -damage), slot);
  }
  return [next];
}

/** Order 28.2: Speed Boost, +1 Speed (every Pokémon in the turn has been in since it started: activeTurns ≥ 1). */
function speedBoostHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot)) return [w];
  const was = { ...w.mons[slot]!.build.boosts };
  p.kernel.selfBoost(w, slot, { spe: 1 }, null);
  stageFacts(p, w, slot, p.kernel.abilityName("speedboost"), undefined, was, key);
  return [w];
}

/**
 * Order 28.2: Harvest restores a Berry eaten earlier (data/abilities.ts harvest onResidual: its holder with HP and no item,
 * its lastItem a Berry; sun or 1/2): not modelled. The holder with no item after the moves is guarded before the phase
 * (guardOf); here, the Berry it held as the residual started and ate in it (the weather's Update, a Lum Berry at a Yawn's sleep).
 */
function harvestGuard(p: Phase, w: World, slot: DoublesSlotId, startItem: string): World[] {
  const { kernel } = p;
  if (hasHP(w, slot) && !w.mons[slot]!.build.itemId && startItem.endsWith("berry")) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("harvest")));
  return [w];
}

/**
 * Order 28.2: Pickup takes an item another active Pokémon used this turn (data/abilities.ts pickup onResidual: its holder
 * with no item; a target with lastItem and usedItemThisTurn, every active Pokémon being adjacent in doubles): not modelled.
 * A Pokémon that held an item at the turn's start or as the residual started and holds none now stands for one.
 */
function pickupGuard(p: Phase, w: World, slot: DoublesSlotId, startItems: Map<DoublesSlotId, string>): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || w.mons[slot]!.build.itemId) return [w];
  const used = DOUBLES_SLOTS.some((other) => other !== slot && alive(w, other) && !w.mons[other]!.build.itemId && !!(kernel.input.pokemon[other]?.build.itemId || startItems.get(other)));
  if (used) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("pickup")));
  return [w];
}

/** Order 28.3: Flame Orb and Toxic Orb give their holder their status (trySetStatus on itself; no damage this turn). */
function orbHandler(p: Phase, w: World, slot: DoublesSlotId, item: "flameorb" | "toxicorb", key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const build = w.mons[slot]!.build;
  if (build.itemId !== item || !kernel.itemWorks(w, build)) return [w];
  return setStatus(p, w, slot, item === "flameorb" ? "brn" : "tox", "self", kernel.itemName(item), key);
}

/**
 * A status set at the end of turn (sim/pokemon.ts trySetStatus): Track A's canStatus decides (an existing status, the type
 * immunities, Safeguard and Flower Veil letting Yawn's sleep and a Pokémon's own Orb through, the terrains, the abilities)
 * and Track A's setStatus sets it (bad poison at stage 0, sleep's counter at 0). Then AfterSetStatus: a Lum Berry is eaten at
 * once (data/items.ts lumberry onAfterSetStatus), unless a foe's Unnerve or As One stops it; the other curing Berries wait
 * for the final Update.
 */
function setStatus(p: Phase, w: World, slot: DoublesSlotId, status: "slp" | "brn" | "tox", source: "yawn" | "self", effect: string, key: number[]): World[] {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const can = (x: World) => source === "yawn" ? canSleep(kernel, x, slot, null) : canStatus(kernel, x, slot, status, slot, {}) === null;
  if (!can(w)) {
    // Stopped only by the weather from before the turn (Leaf Guard in sun): that relies on the weather still being up.
    const lasting = lastingFact(kernel, w);
    if (lasting && can({ ...w, field: { ...w.field, weather: "" } })) p.turnFacts.add(lasting);
    // The Orbs (28.3) come after the terrain's and Gravity's countdowns (order 27: data/moves.ts mistyterrain, gravity
    // onFieldResidualOrder), whose turns left the input does not give: Misty Terrain from before the turn, or the grounding
    // Gravity gives it, stopping the status relies on them going on.
    if (source === "self") {
      const { terrain, gravity } = w.field;
      if (terrain && terrain === kernel.input.field.terrain && can({ ...w, field: { ...w.field, terrain: "" } })) p.turnFacts.add(`Assumes the ${terrain} Terrain does not end this turn.`);
      if (gravity && kernel.input.field.gravity && can({ ...w, field: { ...w.field, gravity: false } })) p.turnFacts.add("Assumes Gravity does not end this turn.");
    }
    return [w];
  }
  giveEotStatus(kernel, w, slot, status, source === "self" ? slot : null, {});
  p.rec?.act(slot, effect, undefined, w.mass, key, null, [status === "slp" ? "Falls asleep." : status === "brn" ? "Is burned." : "Is badly poisoned."]);
  if (mon.build.itemId === "lumberry" && kernel.itemWorks(w, mon.build) && !stopped(w, slot)) return eatCuring(p, w, slot, "lumberry", sub(p, key, 1));
  return [w];
}

/** A living foe with HP whose Unnerve or As One stops `slot`'s Berries (onFoeTryEatItem; sim/side.ts allies: only those with HP). */
function stopped(w: World, slot: DoublesSlotId): boolean {
  return DOUBLES_SLOTS.some((other) => slotSide(other) !== slotSide(slot) && hasHP(w, other) && other !== w.ghost && UNNERVES.has(w.mons[other]!.build.abilityId));
}

/** Cheek Pouch's heal as a Berry is eaten (data/abilities.ts cheekpouch onEatItem: baseMaxHP/3, at least 1; Heal Block stops it). */
function pouch(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World {
  const mon = w.mons[slot]!;
  if (mon.build.abilityId !== "cheekpouch" || mon.eot.healBlock) return w;
  return changeHP(p, w, slot, p.kernel.abilityName("cheekpouch"), sub(p, key, 1), amountTo(p.kernel, slot, residualPart(p.kernel.hp[slot].baseMaxHP, 3)));
}

/** A curing Berry eaten (onEat): the status (Lum: confusion too), no item (Unburden), Cheek Pouch. */
function eatCuring(p: Phase, w: World, slot: DoublesSlotId, item: string, key: number[]): World[] {
  const mon = w.mons[slot]!;
  const status = mon.build.status;
  const facts = [...(status ? [`Cures its ${STATUS_WORDS[status]}.`] : []), ...(mon.vol.confusion ? ["Snaps out of confusion."] : [])];
  p.rec?.act(slot, p.kernel.itemName(item), undefined, w.mass, key, null, facts);
  if (status && (item === "lumberry" || CURING_BERRIES[item]?.includes(status))) cureStatus(w, slot);
  if (item === "lumberry" || item === "persimberry") mon.vol = { ...mon.vol, confusion: undefined };
  loseItem(w, slot);
  return [pouch(p, w, slot, key)];
}

/** Its item used up (no item; Unburden: data/abilities.ts unburden onAfterUseItem). */
function loseItem(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
}

/**
 * An Update (sim/battle.ts eachEvent('Update')): each Pokémon with HP eats a Berry that is due (data/items.ts onUpdate):
 * a curing Berry for its status (Lum and Persim for confusion too), an HP Berry at or under its line (Sitrus, Oran,
 * Berry Juice at half; the Figy family at a quarter; Gluttony, Ripen, Cheek Pouch: hit-loop.ts berryArithmetic), a pinch
 * Berry at a quarter (Liechi and its kin; Lansat; Starf). A living foe's Unnerve or As One stops Berries (not Berry Juice);
 * Heal Block stops the HP Berries (onTryEatItem: TryHeal) and Cheek Pouch. Independent per Pokémon.
 */
function updateAll(p: Phase, w: World, key: number[]): World[] {
  let ws = [w];
  DOUBLES_SLOTS.forEach((slot, index) => { ws = ws.length === 1 ? updateSlot(p, ws[0], slot, sub(p, key, index)) : ws.flatMap((x) => updateSlot(p, x, slot, sub(p, key, index))); });
  return ws;
}

function updateSlot(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!hasHP(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const item = mon.build.itemId;
  if (!item || !kernel.itemWorks(w, mon.build)) return [w];
  const status = mon.build.status;
  if (item.endsWith("berry") && stopped(w, slot)) return [w];
  if ((item === "lumberry" && (status || mon.vol.confusion)) || (CURING_BERRIES[item]?.includes(status)) || (item === "persimberry" && mon.vol.confusion)) {
    return eatCuring(p, w, slot, item, key);
  }
  const pinch = item === "lansatberry" || item === "starfberry";
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item] || pinch) || item === "enigmaberry") return [w];
  if (HEALING_BERRIES.has(item) && mon.eot.healBlock) return [w];
  // A Berserk or Anger Shell lock left by a confusion self-hit: its TryEatItem fails for a healing Berry (unlock).
  if (mon.vol.berryLocked && BERSERK_BERRIES.has(item)) return [w];
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  const arithmetic = berryArithmetic(pinch ? "liechiberry" : item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, kernel.runtime.profile.generation);
  const berry = mon.eot.healBlock ? { ...arithmetic, pouch: 0 } : arithmetic;
  if (!someHP(w, slot, (hp) => hp > 0 && hp <= berry.line)) return [w];
  if (item === "starfberry" && p.e2) kernel.notEstimated(REASONS.notIn2v2(kernel.itemName("starfberry")));
  const name = kernel.itemName(item), pouchName = kernel.abilityName("cheekpouch");
  if (p.rec) {
    for (const [hp, mass] of marginal(w, slot)) {
      if (hp <= 0 || hp > berry.line) continue;
      const { heal, pouch: pouched } = berryHeals(berry, hp);
      const was = mon.build.boosts;
      const stat = PINCH_STAT_BERRIES[item];
      const rise = stat ? Math.max(-6, Math.min(6, (was[stat] ?? 0) + (mon.build.abilityId === "ripen" ? 2 : 1) * (mon.build.abilityId === "contrary" ? -1 : 1) * (mon.build.abilityId === "simple" ? 2 : 1))) - (was[stat] ?? 0) : 0;
      const facts = rise ? [`${STAT_NAMES[stat!]} ${rise > 0 ? "+" : "−"}${Math.abs(rise)}.`] : item === "lansatberry" ? ["Raises its critical-hit ratio."] : item === "starfberry" ? ["Raises one random stat by 2."] : [];
      p.rec.act(slot, name, undefined, w.mass * mass, key, heal ? { delta: heal, ko: false } : null, facts);
      if (pouched) p.rec.act(slot, pouchName, undefined, w.mass * mass, [...key, 1], { delta: pouched, ko: false });
    }
  }
  return mapHP(w, slot, (hp) => hp > 0 && hp <= berry.line ? { hp: eatBerry(berry, hp), tag: "ate" } : { hp, tag: "" }).map(({ world, tag }) => {
    if (tag !== "ate") return world;
    if (pinch) {
      loseItem(world, slot);
      if (item === "lansatberry" && !world.mons[slot]!.build.focusEnergy) world.mons[slot]!.build = { ...world.mons[slot]!.build, focusEnergy: true };
    } else kernel.ateBerry(world, slot, item);
    return world;
  });
}

/** Order 29: Zen Mode, Shields Down, Schooling and Power Construct change form across their HP line: not modelled. */
function formGuard(p: Phase, w: World, slot: DoublesSlotId): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const build = w.mons[slot]!.build;
  const rule = FORM_LINES[build.abilityId];
  const level = build.native ? build.native.level ?? 100 : 50;
  if (!rule || !build.speciesId.startsWith(rule.base) || (build.abilityId === "schooling" && level < 20)) return [w];
  const low = rule.low(build.speciesId);
  const line = rule.line(kernel.hp[slot].maxHP);
  const flips = someHP(w, slot, (hp) => hp > 0 && (hp <= line) !== low && (rule.reverts || !low));
  if (flips) kernel.notEstimated(REASONS.formChange(kernel.abilityName(build.abilityId), kernel.names[slot]));
  return [w];
}

/** Order 29: Hunger Switch flips Morpeko's form (data/abilities.ts hungerswitch; not while Terastallized). */
function hungerSwitch(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.mechanic === "tera" || !mon.build.speciesId.startsWith("morpeko")) return [w];
  const form = mon.build.speciesId === "morpeko" ? "morpekohangry" : "morpeko";
  if (!kernel.runtime.speciesById.has(form)) return [w];
  mon.build = { ...mon.build, speciesId: form };
  p.rec?.act(slot, kernel.abilityName("hungerswitch"), undefined, w.mass, key, null, [`Becomes ${kernel.runtime.speciesById.get(form)!.name}.`]);
  return [w];
}

/** Order 29: White Herb restores lowered stages (data/items.ts whiteherb onResidual) and is used up. */
function whiteHerb(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== "whiteherb" || !kernel.itemWorks(w, mon.build) || !STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0)) return [w];
  mon.build = { ...mon.build, boosts: Object.fromEntries(STATS.map((stat) => [stat, Math.max(0, mon.build.boosts[stat] ?? 0)])) as BattleBuild["boosts"] };
  loseItem(w, slot);
  p.rec?.act(slot, kernel.itemName("whiteherb"), undefined, w.mass, key, null, ["Restores its lowered stats."]);
  return [w];
}

/** Order 29: Eject Pack after a drop in the residual (data/items.ts ejectpack onAfterBoost, onResidual): it switches out after the turn. */
function ejectPack(p: Phase, w: World, slot: DoublesSlotId, was: BattleBuild["boosts"], key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !canSwitch(kernel, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== "ejectpack" || !kernel.itemWorks(w, mon.build) || !STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was[stat] ?? 0))) return [w];
  loseItem(w, slot);
  p.rec?.act(slot, kernel.itemName("ejectpack"), undefined, w.mass, key, null, ["Switches out after the turn."]);
  return [w];
}

/**
 * Micle Berry (no order: after every ordered handler; ADDENDUM C18): eaten at a quarter of its maximum HP or less (half
 * with Gluttony) unless a foe's Unnerve or As One stops it; its Cheek Pouch heals then.
 */
function micleBerry(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== "micleberry" || !kernel.itemWorks(w, mon.build) || stopped(w, slot)) return [w];
  const line = Math.floor(kernel.hp[slot].maxHP / (mon.build.abilityId === "gluttony" ? 2 : 4));
  const name = kernel.itemName("micleberry");
  return mapHP(w, slot, (hp) => ({ hp, tag: hp > 0 && hp <= line ? "ate" : "" })).map(({ world, tag }) => {
    if (tag !== "ate") return world;
    p.rec?.act(slot, name, undefined, world.mass, key, null, [`${name}: eaten.`]);
    loseItem(world, slot);
    return pouch(p, world, slot, key);
  });
}

/**
 * After the final Update: Emergency Exit and Wimp Out for a Pokémon above half HP at the residual's start and at half or
 * below now (sim/battle.ts:2860-2866), as facts; the guards for what the residual changed that the turn does not follow
 * (Opportunist and Mirror Herb copying a rise, Symbiosis after an item used up).
 */
function afterChecks(p: Phase, w: World, startBoosts: Map<DoublesSlotId, BattleBuild["boosts"]>, startItems: Map<DoublesSlotId, string>, above: Set<DoublesSlotId>) {
  const { kernel } = p;
  roomFact(p, w);
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    if (alive(w, slot) && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (startBoosts.get(slot)![stat] ?? 0))) {
      for (const other of DOUBLES_SLOTS) {
        if (slotSide(other) === slotSide(slot) || !alive(w, other)) continue;
        const copier = w.mons[other]!.build;
        if (copier.abilityId === "opportunist") kernel.notEstimated(REASONS.copiesRise(kernel.abilityName("opportunist")));
        if (copier.itemId === "mirrorherb" && kernel.itemWorks(w, copier)) kernel.notEstimated(REASONS.copiesRise(kernel.itemName("mirrorherb")));
      }
    }
    const partner = allyOf(slot);
    if (startItems.get(slot) && !mon.build.itemId && alive(w, slot) && alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
      kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("symbiosis")));
    }
    if (above.has(slot) && alive(w, slot) && p.rec) {
      let mass = 0;
      for (const [hp, share] of marginal(w, slot)) if (hp > 0 && undynamaxed(kernel, slot, hp) * 2 <= kernel.hp[slot].baseMaxHP) mass += share;
      if (mass > 0) p.rec.act(slot, kernel.abilityName(mon.build.abilityId), undefined, w.mass * mass, [LAST_KEY, 2], null, ["Switches out after the turn."]);
    }
  }
  if (kernel.gen7 || kernel.runtime.profile.generation !== 8) return;
  if (DOUBLES_SLOTS.some((slot) => alive(w, slot) && isMaxActive(w.mons[slot]!.build))) p.turnFacts.add("Assumes Dynamax started this turn.");
}

/**
 * Magic Room from before the turn still up after the residual: its countdown (order 27.6: data/moves.ts magicroom
 * onFieldResidualOrder 27, SubOrder 6) comes before the Orbs and Sticky Barb (28.3), White Herb (29), Micle Berry and the
 * final Update's Berries and herbs, and the input gives no turns left for it. Pinned with one turn left the room ends there
 * and those items act (verify-eot-probes/field-end-probe.ts, every game): a held item one of them would use relies on the
 * room going on. A Magic Room set this turn lasts 5 turns.
 */
function roomFact(p: Phase, w: World) {
  const { kernel } = p;
  if (!kernel.input.field.magicRoom || !w.field.magicRoom) return;
  const open: World = { ...w, field: { ...w.field, magicRoom: false } };
  if (DOUBLES_SLOTS.some((slot) => hasHP(w, slot) && lateItemActs(p, open, slot))) p.turnFacts.add("Assumes Magic Room does not end this turn.");
}

/** Whether `slot`'s held item would act after order 27 in `w` (a world whose items work but for Klutz): see roomFact. */
function lateItemActs(p: Phase, w: World, slot: DoublesSlotId): boolean {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const build = mon.build, item = build.itemId;
  if (!item || !kernel.itemWorks(w, build)) return false;
  if (item === "flameorb" || item === "toxicorb") return canStatus(kernel, w, slot, item === "flameorb" ? "brn" : "tox", slot, {}) === null;
  if (item === "stickybarb") return ownResiduals(residualMon(kernel, w, slot), { terrain: w.field.terrain, champions: kernel.champions }).some((entry) => entry.id === "stickybarb");
  if (item === "whiteherb") return STATS.some((stat) => (build.boosts[stat] ?? 0) < 0);
  // data/items.ts mentalherb onUpdate: attract, taunt, encore, torment, disable, healblock.
  if (item === "mentalherb") return !!(mon.vol.taunt || mon.vol.disabled || mon.vol.encore || mon.eot.healBlock);
  // data/items.ts boosterenergy onUpdate: a Protosynthesis or Quark Drive holder not yet boosted.
  if (item === "boosterenergy") return (build.abilityId === "protosynthesis" || build.abilityId === "quarkdrive") && !build.abilityActive;
  if (item === "micleberry") return !stopped(w, slot) && someHP(w, slot, (hp) => hp > 0 && hp <= Math.floor(kernel.hp[slot].maxHP / (build.abilityId === "gluttony" ? 2 : 4)));
  return berryDue(p, w, slot);
}

/** The Berry updateSlot would eat at an Update in `w` (its conditions without the item check): a curing Berry for its status or confusion, an HP or pinch Berry at its line. */
function berryDue(p: Phase, w: World, slot: DoublesSlotId): boolean {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const item = mon.build.itemId, status = mon.build.status;
  if (item.endsWith("berry") && stopped(w, slot)) return false;
  if ((item === "lumberry" && (status || mon.vol.confusion)) || CURING_BERRIES[item]?.includes(status) || (item === "persimberry" && mon.vol.confusion)) return true;
  const pinch = item === "lansatberry" || item === "starfberry";
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item] || pinch) || item === "enigmaberry") return false;
  if (HEALING_BERRIES.has(item) && mon.eot.healBlock) return false;
  if (mon.vol.berryLocked && BERSERK_BERRIES.has(item)) return false;
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  const line = berryArithmetic(pinch ? "liechiberry" : item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, kernel.runtime.profile.generation).line;
  return someHP(w, slot, (hp) => hp > 0 && hp <= line);
}

/** A weather or terrain that changed in the residual while a Pokémon whose ability or item settles on it is in (REASONS.fieldChange). */
function fieldChangeGuard(kernel: TurnKernel, w: World) {
  for (const slot of DOUBLES_SLOTS) {
    if (!alive(w, slot)) continue;
    const build = w.mons[slot]!.build;
    if (kernel.fieldSettledAbilities.has(build.abilityId)) kernel.notEstimated(REASONS.fieldChange(kernel.abilityName(build.abilityId)));
    if (kernel.fieldSettledItems.has(build.itemId) && kernel.itemWorks(w, build)) kernel.notEstimated(REASONS.fieldChange(kernel.itemName(build.itemId)));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Hooks from the moves (doubles-turn.ts)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Track B's reactions to one damaging hit (doubles-turn.ts afterHit, last). On a hit that reached the Pokémon
 * (`outcome.landed > 0`) and left it in: a partial trap from the trapping moves (move-level volatileStatus: not stopped by
 * Sheer Force or Shield Dust; Binding Band from the trapper's working item; none on one already trapped), Salt Cure and
 * Syrup Bomb (100% secondaries: Sheer Force removes them, Shield Dust and Covert Cloak stop them), Psychic Noise's Heal
 * Block (a secondary; Aroma Veil on the target's side stops it; a Mental Herb cures it at the hit's Update and is used),
 * Smack Down and Thousand Arrows grounding. On any hit of the move, a Substitute's included (C16): Rapid Spin and Mortal
 * Spin end their user's Leech Seed and trap and the hazards on its side (not with Sheer Force; the user with HP), and
 * Ceaseless Edge and Stone Axe set Spikes and Stealth Rock on the foe's side (E2 hazards).
 */
export function afterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  if (info.transformed) return;
  const attacker = action.slot;
  const id = info.effective.id;
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  const sheerForce = user.build.abilityId === "sheerforce" && !!info.secondaries;
  if (outcome.landed > 0 && alive(w, target) && attacker !== target) {
    if (TRAP_MOVES.has(id) && !receiver.eot.trap) {
      const band = user.build.itemId === "bindingband" && kernel.itemWorks(w, user.build);
      const trap: TrapState = { source: attacker, divisor: band ? 6 : 8, move: id };
      receiver.eot = { ...receiver.eot, trap };
    }
    const lands = kernel.secondaryLands(w, attacker, target, info);
    if (id === "saltcure" && lands && !receiver.eot.saltCure) receiver.eot = { ...receiver.eot, saltCure: true };
    if (id === "syrupbomb" && lands && !receiver.eot.syrupBomb) receiver.eot = { ...receiver.eot, syrupBomb: attacker };
    if (id === "psychicnoise" && lands && !receiver.eot.healBlock) {
      const veiled = [target, allyOf(target)].some((slot) => alive(w, slot) && w.mons[slot]!.build.abilityId === "aromaveil" && !kernel.breaks(w, attacker, slot, info));
      if (!veiled) {
        if (receiver.build.itemId === "mentalherb" && kernel.itemWorks(w, receiver.build)) loseItem(w, target);
        // The hit's Update comes after its secondaries (sim/battle-actions.ts hitStepMoveHitLoop: spreadMoveHit, then
        // eachEvent('Update')), so Heal Block stops an HP Berry there (data/items.ts onTryEatItem TryHeal): the step kept
        // it (doubles-turn.ts psychicNoiseKeepsBerry).
        else receiver.eot = { ...receiver.eot, healBlock: true };
      }
    }
    if (outcome.target.smackedDown && !receiver.eot.smackedDown) receiver.eot = { ...receiver.eot, smackedDown: true };
  }
  if (outcome.landed + outcome.subHits <= 0 || sheerForce) return;
  if ((id === "rapidspin" || id === "mortalspin") && hasHP(w, attacker)) {
    if (user.eot.leechSeed) user.eot = { ...user.eot, leechSeed: undefined };
    endTrap(w, attacker);
    const side = slotSide(attacker);
    if (w.sides[side].hazards.length) w.sides[side] = { ...w.sides[side], hazards: [] };
  }
  // foeSidesWithConditions: the user's foes' side, whichever Pokémon it hit; on a Substitute only while the user has HP.
  if ((id === "ceaselessedge" || id === "stoneaxe") && (outcome.landed > 0 || someHP(w, attacker, (hp) => hp > 0))) {
    const side = slotSide(attacker) === "own" ? "opponent" : "own";
    w.sides[side] = { ...w.sides[side], hazards: [...w.sides[side].hazards, id === "ceaselessedge" ? "spikes" : "stealthrock"] };
  }
}

/** A charge turn's user (doubles-turn.ts chargeTurn): eot.hidden for Dig and Dive ("sheltered") and Fly, Bounce, Phantom Force, Shadow Force ("semi"). */
export function charging(w: World, slot: DoublesSlotId, move: ChampionsMove) {
  if (!SEMI_INVULNERABLE_MOVES.has(move.id)) return;
  const mon = w.mons[slot]!;
  mon.eot = { ...mon.eot, hidden: move.id === "dig" || move.id === "dive" ? "sheltered" : "semi" };
}

/**
 * A Pokémon leaves during the moves with no later living action (a switch move, U-turn, Volt Switch, Flip Turn, Eject
 * Button, Red Card, Eject Pack, Emergency Exit, Wimp Out, Dragon Tail, Circle Throw): its replacement takes the end of
 * turn (World.leaving; the end of turn is not estimated).
 */
export function leaving(w: World, slot: DoublesSlotId) {
  if (w.leaving?.includes(slot)) return;
  w.leaving = [...(w.leaving ?? []), slot];
}

/** The turn facts read from the input in today's second place (doubles-turn.ts turnFacts): none (the end of turn's own come from the walk). */
export function endFacts(input: DoublesTurnInput): string[] {
  void input;
  return [];
}

/**
 * Track B's condition facts on `slot` in one world (DoublesHP.conditions): Leech Seed, a partial trap, Salt Cure, Aqua
 * Ring, Ingrain, Curse, Heal Block, drowsy, the perish count (after the moves: the count shown; after the turn: the
 * count after its countdown).
 */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [];
  const eot = mon.eot;
  const done = afterTurn.has(w);
  const out: string[] = [];
  if (eot.leechSeed) out.push("Leech Seed.");
  if (eot.trap) { const move = (eot.trap as TrapState).move; out.push(move ? `Trapped by ${kernel.moveName(move)}.` : "Partially trapped."); }
  if (eot.saltCure) out.push("Salt Cure.");
  if (eot.aquaRing) out.push("Aqua Ring.");
  if (eot.ingrain) out.push("Ingrain.");
  if (eot.curse) out.push("Cursed.");
  if (eot.healBlock) out.push("Heal Block.");
  if (eot.yawn && (done ? eot.yawn === 1 : true)) out.push("Drowsy.");
  if (eot.perish) out.push(`Perish count ${done ? eot.perish : Math.min(3, eot.perish)}.`);
  return out;
}

/** Track B's part of an E2 outcome Pokémon: the end-of-turn volatiles the next turn reads and the perish count after this turn. */
export function outcomeMon(kernel: TurnKernel, w: World, slot: DoublesSlotId): Pick<DoublesOutcomeMon, "volatiles" | "perishCount"> {
  void kernel;
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return {};
  const eot = mon.eot;
  const done = afterTurn.has(w);
  const volatiles: string[] = [];
  if (eot.leechSeed) volatiles.push("leechseed");
  if (eot.trap) volatiles.push("partiallytrapped");
  if (eot.saltCure) volatiles.push("saltcure");
  if (eot.aquaRing) volatiles.push("aquaring");
  if (eot.ingrain) volatiles.push("ingrain");
  if (eot.curse) volatiles.push("curse");
  if (eot.healBlock) volatiles.push("healblock");
  if (eot.syrupBomb) volatiles.push("syrupbomb");
  // After the turn a Yawn from this turn has counted down to 1 (drowsy next turn); after the moves, a Yawn landed this turn is still to come.
  if (done ? eot.yawn === 1 : eot.yawn === 2) volatiles.push("yawn");
  const perish = eot.perish ? (done ? eot.perish : eot.perish - 1) : 0;
  if (perish > 0) volatiles.push("perishsong");
  return { ...(volatiles.length ? { volatiles } : {}), ...(perish > 0 ? { perishCount: perish } : {}) };
}
