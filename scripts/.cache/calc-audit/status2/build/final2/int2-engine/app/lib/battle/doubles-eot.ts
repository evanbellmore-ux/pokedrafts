import { GAS_STAND_IN } from "./calculate";
import { REASONS, SEMI_INVULNERABLE_MOVES, STRONG_WEATHERS } from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, sideCanSwitch, slotSide, startId, type DoublesFact, type DoublesOutcomeMon, type DoublesResidual, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput,
} from "./doubles-types";
import {
  cloneWorld, condition, endTrap, entryCount, hpIn, join, locate, mapHP, mapJoint, marginal, mergeWorlds, sheltered, withSpecies, type EotState, type MonState, type PendingAction,
  type Stage, type World,
} from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as faceNs from "./doubles-faces";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as guardNs from "./doubles-guards";
import * as hiddenNs from "./doubles-hidden";
import * as substituteNs from "./doubles-substitute";
import * as switchNs from "./doubles-switch";
import { berryArithmetic, berryHeals, BERSERK_BERRIES, eatBerry, HEALING_BERRIES, PINCH_STAT_BERRIES, stolenEat, UNNERVES } from "./hit-loop";
import { berryConfusion, canSleep, canStatus, setStatus as giveEotStatus } from "./doubles-status";
import { signed, STAGE_NAMES } from "./doubles-use";
import { isMaxActive } from "./mechanics";
import {
  badDreamsDamage, bigRoot, leechSeedDamage, ownResiduals, RESIDUAL_KEYS, residualPart, SIDE_RESIDUALS, sideResidualDamage, weatherResiduals, type OwnResidual, type ResidualKey,
  type ResidualMon,
} from "./residuals";
import type { BattleBuild, BattleConditions, BattleStatus, ChampionsMove, CombatStat, MoveContext } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const faceHooks = { ...faceNs };
const fieldChangeHooks = { ...fieldChangeNs };
const guardHooks = { ...guardNs };
const hiddenHooks = { ...hiddenNs };
const substituteHooks = { ...substituteNs };
const switchHooks = { ...switchNs };

// The 2v2 turn's end of turn (status-eot SPEC §2.3, §4.7, §4.9; ADDENDUM §2.3, §4.11.5, §6.0): Track B's file. One residual
// phase on every finished world, in pinned Showdown c23d2e94's fieldEvent('Residual') order (sim/battle.ts:484-567): the
// handlers are collected once as the residual starts, sorted by order, priority, the holder's Speed (updateSpeed:
// getActionSpeed, Trick Room and Tailwind as the moves left them) and subOrder (sim/battle.ts:404-411), tied handlers
// shuffled (speedSort, :429-458: here every order is its own world when two tied handlers interact), a handler skipped
// when its holder has fainted (but a slot condition: Wish) or its state is gone, and faintMessages after each handler.
// The weather calls eachEvent('Weather') and the Update after it (sim/battle.ts:465-478); the final Update and the
// Emergency Exit check come after the residual (:2843-2866). The per-Pokémon amounts are residuals.ts's. doubles-turn.ts
// (frozen) calls endOfTurn after each walk and the other hooks below from the moves.
//
// status2 Track E1 (SPEC2 §4.6, ADDENDUM2 §4.1 step 8): Nightmare (11), Octolock (14), the countdowns of Telekinesis (19),
// Heal Block (20) and Embargo (21), Harvest and Pickup on the item history (28.2, one Speed-sorted group: C8), the
// Opportunist and Mirror Herb copies (29: the end of turn's boost() events reach the copiers through D's ledger,
// doubles-guards.ts noteRise, C9), White Herb with accuracy and evasion (29), Liquid Ooze against a heal-blocked seeder by Speed, the
// final Update's Lansat and Starf through the kernel's ateBerry, and a rise there left pending (MonState.copy, E2's
// pendingCopy: A11).
//
// status2 Track E2 (ADDENDUM2 §4.1 step 8, §4.3; T2E §4.1-§4.6, IN §4.3, T2M §6.3's E+, T2P §12's E): the Future Sight and
// Doom Desire landing (3, through kernel.residualHit), the G-Max side residuals and the Fire Pledge's sea of fire (5.1, one
// side-residual handler) with Centiferno's and Sandblast's traps outliving their user (13), the Taunt, Encore and Disable
// countdowns (15, 16, 17), the Pledges' countdowns (26.7-26.9), Gravity, Magic Room and the terrain from before the turn
// ending with one turn left (27.2, 27.6, 27.7), Uproar's upkeep (28.1) and Yawn's sleep failing under it, Cud Chew and Moody
// in the one Speed-sorted 28.2 group, Zen Mode, Shields Down and Schooling (29; Power Construct keeps its reason), and a
// carried two-turn release that did not happen ending after the residual (twoturnmove's duration).

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
/**
 * status2 E2 (T2E §4.4): the G-Max moves whose self.onHit sets a 4-turn side condition on the foes' side, which deals
 * damage at 5.1 (data/moves.ts gmaxvinelash, gmaxwildfire, gmaxcannonade, gmaxvolcalith), and those that trap every
 * active foe with a partial trap that outlives its user (gmaxcentiferno, gmaxsandblast: data/conditions.ts partiallytrapped
 * onResidual gmaxEffect).
 */
const GMAX_SIDE = new Set(["gmaxvinelash", "gmaxwildfire", "gmaxcannonade", "gmaxvolcalith"]);
const GMAX_TRAPS = new Set(["gmaxcentiferno", "gmaxsandblast"]);
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
/**
 * The status2 volatiles' residual names (SPEC2 §5.1: "Nightmare", "Octolock", "Heal Block ends"...), fixed: a game whose
 * catalog lacks the move still has the volatile (Psychic Noise's Heal Block in Scarlet/Violet and Champions).
 */
const VOLATILE_NAMES = {
  nightmare: "Nightmare", octolock: "Octolock", telekinesis: "Telekinesis", healblock: "Heal Block", embargo: "Embargo", taunt: "Taunt", encore: "Encore", disable: "Disable", uproar: "Uproar",
} as const;
const CURING_BERRIES: Readonly<Record<string, readonly BattleStatus[]>> = {
  cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};

// ------------------------------------------------------------------------------------------------------------------
// Statistics: DoublesResidual from the recording walk
// ------------------------------------------------------------------------------------------------------------------

type Entry = {
  slot: DoublesSlotId; id?: string; effect: string; other?: DoublesSlotId; chance: number; min: number; max: number; hp: boolean; ko: number;
  /** status2 R: `other`'s occupant where it acted (null: the slot's starting Pokémon), "mixed" where it differs between paths (DoublesResidual.otherId). */
  otherAt?: string | null | "mixed";
  facts: Map<string, number>; key: number[];
  /** status2: the HP changes by mass, kept once an entry acts twice on one path (Recorder.again: min and max from them). */
  values?: Map<number, number>;
};
const before = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};
class Recorder {
  private entries = new Map<string, Entry>();
  /** status2 R-E: the occupants of the world being run where not the slots' starting Pokémon (DoublesResidual.id). */
  ids: Partial<Record<DoublesSlotId, string>> = {};
  /**
   * One residual acting on `slot` in `mass` of the turn: its HP change (null for none), whether it knocked it out, its
   * facts. `part` keeps apart two entries of one effect and pair (mutual Leech Seed: the drain and the heal), so each
   * entry acts at most once on a path.
   */
  act(slot: DoublesSlotId, effect: string, other: DoublesSlotId | undefined, mass: number, key: number[], change: { delta: number; ko: boolean } | null, facts: string[] = [], part = "") {
    if (mass <= 0) return;
    const occupant = this.ids[slot];
    const id = `${slot}|${effect}|${other ?? ""}|${part}${occupant !== undefined ? `|${occupant}` : ""}`;
    let entry = this.entries.get(id);
    // status2 R: the Pokémon at `other` now (a newcomer at a seeder's or a Healer's place), kept apart from the entry's key.
    const otherAt = other ? this.ids[other] ?? null : undefined;
    if (!entry) this.entries.set(id, entry = { slot, ...(occupant !== undefined ? { id: occupant } : {}), effect, ...(other ? { other, otherAt } : {}), chance: 0, min: Infinity, max: -Infinity, hp: false, ko: 0, facts: new Map(), key });
    else {
      if (before(key, entry.key)) entry.key = key;
      if (other && entry.otherAt !== otherAt) entry.otherAt = "mixed";
    }
    entry.chance += mass;
    if (change) {
      entry.hp = true;
      entry.min = Math.min(entry.min, change.delta);
      entry.max = Math.max(entry.max, change.delta);
      if (change.ko) entry.ko += mass;
      if (entry.values) entry.values.set(change.delta, (entry.values.get(change.delta) ?? 0) + mass);
    }
    for (const text of facts) entry.facts.set(text, (entry.facts.get(text) ?? 0) + mass);
  }
  /**
   * status2 (Harvest, Pickup: a Berry its holder ate earlier in this end of turn is eaten again): the second act on `mass` of
   * paths that the entry already counted, as the oracle sums an effect per path (2v2/verify compare.ts residuals): no chance
   * added, `mass` moved from the first act's change `from` to `to` (their sum), its facts added. False where the entry has no
   * such change to move (the caller records it as an entry of its own).
   */
  again(slot: DoublesSlotId, effect: string, mass: number, change: { from: number; to: number } | null, facts: string[] = []): boolean {
    const entry = this.entries.get(`${slot}|${effect}||${this.ids[slot] !== undefined ? `|${this.ids[slot]}` : ""}`);
    if (!entry || mass <= 0) return !!entry;
    if (change) {
      if (!entry.hp || (!entry.values && entry.min !== entry.max)) return false;
      const values = entry.values ??= new Map([[entry.min, entry.chance]]);
      if ((values.get(change.from) ?? 0) < mass * (1 - 1e-9)) return false;
      const left = values.get(change.from)! - mass;
      if (left > entry.chance * 1e-12) values.set(change.from, left); else values.delete(change.from);
      values.set(change.to, (values.get(change.to) ?? 0) + mass);
      entry.min = Math.min(...values.keys());
      entry.max = Math.max(...values.keys());
    }
    for (const text of facts) entry.facts.set(text, (entry.facts.get(text) ?? 0) + mass);
    return true;
  }
  /** A fact on an entry already acted on, known only after a later branch (a Starf Berry's stat): its chance unchanged. */
  fact(slot: DoublesSlotId, effect: string, text: string, mass: number) {
    const entry = this.entries.get(`${slot}|${effect}||${this.ids[slot] !== undefined ? `|${this.ids[slot]}` : ""}`);
    if (entry && mass > 0) entry.facts.set(text, (entry.facts.get(text) ?? 0) + mass);
  }
  result(): DoublesResidual[] {
    return [...this.entries.values()].sort((a, b) => before(a.key, b.key) ? -1 : before(b.key, a.key) ? 1 : DOUBLES_SLOTS.indexOf(a.slot) - DOUBLES_SLOTS.indexOf(b.slot) || a.effect.localeCompare(b.effect))
      .map((entry): DoublesResidual => ({
        slot: entry.slot, ...(entry.id !== undefined ? { id: entry.id } : {}), effect: entry.effect, ...(entry.other ? { other: entry.other } : {}),
        ...(entry.otherAt === "mixed" ? { otherId: null } : typeof entry.otherAt === "string" ? { otherId: entry.otherAt } : {}), chance: Math.min(1, entry.chance),
        min: entry.hp ? entry.min : null, max: entry.hp ? entry.max : null, koChance: Math.min(1, entry.ko),
        facts: [...entry.facts].map(([text, chance]): DoublesFact => ({ text, chance: Math.min(1, chance) })),
      }));
  }
}

/**
 * status2: a Berry a Harvest, Pickup or Cud Chew holder ate in this end of turn, on its MonState for the recording walk only
 * (so a second eat of it on the same path is Recorder.again): the item and its heal where one value (null: none, or
 * several). Track-local (as D's marks), in discreteKey while it stands, dropped before the phase returns its worlds.
 */
type EotMon = MonState & { eotAte?: { item: string; heal: number | null } };
const ateMark = (w: World, slot: DoublesSlotId) => (w.mons[slot] as EotMon | undefined)?.eotAte;
const EATS_AGAIN: ReadonlySet<string> = new Set(["harvest", "pickup", "cudchew"]);
function markAte(p: Phase, w: World, slot: DoublesSlotId, item: string, heal: number | null) {
  const mon = w.mons[slot] as EotMon | undefined;
  if (!p.rec || !mon || !EATS_AGAIN.has(mon.build.abilityId)) return;
  mon.eotAte = { item, heal };
}
function dropMarks(w: World) {
  for (const slot of DOUBLES_SLOTS) delete (w.mons[slot] as EotMon | undefined)?.eotAte;
}

// ------------------------------------------------------------------------------------------------------------------
// The phase
// ------------------------------------------------------------------------------------------------------------------

/** One end of turn's context: the kernel, the statistics (recording walk only), facts found, and E2 (calculateDoublesOutcomes). */
type Phase = {
  kernel: TurnKernel; rec: Recorder | null; facts: Set<string>; turnFacts: Set<string>;
  /** calculateDoublesOutcomes' walk: Moody and the forms at 29 always branch there (the outcomes read the stages and forms). */
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
    // status2 R-E: the hook modules and the statistics read this world's occupants (doubles-turn.ts syncOccupants).
    kernel.occupy(world);
    if (phase.rec) phase.rec.ids = occupantIds(world);
    out.push(...run(phase, cloneWorld(world)));
    budget(kernel, out);
  }
  kernel.occupy(null);
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
 * last, World.endGuard), a Pokémon that left with no later action (World.leaving), a landing whose user is not given (a
 * bare move id: C33) or not in battle beside two holders of one partner boost (landingGuard), Cud Chew's Berry not given
 * (`cudChew: true`). The reason with the most mass, ties alphabetical; null for none. status2 E1: Harvest and Pickup are
 * modelled on the turn's item history (harvestHandler, pickupHandler); only a turn that keeps none (TurnKernel.tracksItems
 * false: D's readers rule) keeps today's guards here and in harvestGuard, pickupGuard (an item used inside the residual
 * before 28.2: the weather's Update, a Lum Berry at a Yawn's sleep). status2 E2: the landing, Cud Chew, Moody, the G-Max
 * damage over time and the field effects ending this turn are modelled.
 */
function guardOf(kernel: TurnKernel, worlds: World[]): string | null {
  const masses = new Map<string, number>();
  for (const w of worlds) {
    const reason = worldGuard(kernel, w);
    if (reason) masses.set(reason, (masses.get(reason) ?? 0) + w.mass);
  }
  if (!masses.size) return null;
  return [...masses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function worldGuard(kernel: TurnKernel, w: World): string | null {
  if (w.endGuard) return w.endGuard;
  if (w.leaving?.length) return REASONS.switchesOut(kernel.names[w.leaving[0]]);
  // status2 E2: the terrain the input says ends now, where this turn could have set it again (terrainResettable).
  const terrain = kernel.input.field.terrain;
  if (kernel.input.fieldTurns?.terrain === 1 && terrain && w.field.terrain === terrain && terrainResettable(kernel)) return REASONS.notIn2v2(`${terrain} Terrain ending`);
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    if (mon.eot.futureMove) {
      const reason = landingGuard(kernel, w, slot);
      if (reason) return reason;
    }
    if (mon.eot.cudChew === true && !mon.fainted) return REASONS.needsCudChewBerry(kernel.names[slot]);
    if (mon.fainted) continue;
    const ability = mon.build.abilityId;
    // Without item history (no reader in the turn: D's tracksItems), Harvest and Pickup keep today's guards.
    if (!kernel.tracksItems && ability === "harvest" && !mon.build.itemId) return REASONS.notIn2v2(kernel.abilityName("harvest"));
    if (!kernel.tracksItems && ability === "pickup" && !mon.build.itemId && DOUBLES_SLOTS.some((other) => other !== slot && kernel.input.pokemon[other]?.build.itemId && w.mons[other] && !w.mons[other]!.build.itemId)) {
      return REASONS.notIn2v2(kernel.abilityName("pickup"));
    }
  }
  return null;
}

/** status2 R-E: the occupants of `w` that are not their slots' starting Pokémon (Recorder.ids: DoublesResidual.id). */
function occupantIds(w: World): Partial<Record<DoublesSlotId, string>> {
  const out: Partial<Record<DoublesSlotId, string>> = {};
  for (const slot of DOUBLES_SLOTS) { const id = w.mons[slot]?.id; if (id !== undefined) out[slot] = id; }
  return out;
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
    // status2 (C9): the boost() events reach the copiers through D's ledger as they happen (noteRise); the action table
    // World.boosted has no reader here (clearLedger).
    clearLedger(start);
    const handlers = collect(p, start, startBoosts, startItems, speeds);
    handlers.sort(compareHandlers);
    let ws = [start];
    for (let i = 0; i < handlers.length;) {
      let j = i + 1;
      while (j < handlers.length && compareHandlers(handlers[i], handlers[j]) === 0) j++;
      ws = runGroup(p, ws, handlers.slice(i, j));
      // World.boosted is not in discreteKey: dropped before the merge.
      for (const w of ws) clearLedger(w);
      if (!kernel.reference) ws = merge(kernel, ws);
      budget(kernel, ws);
      i = j;
    }
    // status2 E2 (T2M §6.3's E+): a two-turn move charged last turn whose release did not happen this turn ends with the
    // residual (data/conditions.ts twoturnmove duration 2: a duration-only handler, no order, so after every ordered one).
    for (const w of ws) releaseEnds(w);
    // The final Update (sim/battle.ts:2860): every Pokémon with HP, after the faints; none once the battle ended.
    out.push(...ws.filter((w) => over(p, w)));
    ws = ws.filter((w) => !over(p, w)).flatMap((w) => updateAll(p, w, p.rec ? [LAST_KEY, 1] : NO_KEY));
    // A rise at the final Update (a pinch Berry) stays in a copier's MonState.copy, pending into the next turn (E2 pendingCopy, A11).
    for (const w of ws) clearLedger(w);
    for (const w of ws) afterChecks(p, w, startItems, above);
    // status2 R-E: the switches after the residual (Eject Pack at 29, Emergency Exit and Wimp Out, a landing's Red Card), with
    // their newcomers' entry before the next turn (doubles-switch.ts afterTurn); none without a bench.
    ws = ws.flatMap((w) => switchHooks.afterTurn(kernel, w) ?? [w]);
    out.push(...ws);
  }
  // The recording walk's marks of a Berry eaten in this end of turn (EotMon.eotAte) end with it.
  if (p.rec) for (const w of out) dropMarks(w);
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
  if (group.some((handler) => handler.writes.some((slot) => sideCanSwitch(kernel.input, slotSide(slot)) === false))) return false;
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
    const before = fieldBefore(kernel, w);
    kernel.faint(w, slot);
    // status2 E2: FC's end-of-turn field change with the field before it (doubles-fieldchange.ts eotField: the re-settle),
    // for a strong weather ending with its last holder or a Cloud Nine or Air Lock holder leaving the weather seen.
    if (w.field.weather !== before.weather || kernel.effectiveWeather(w) !== before.effective) fieldChangeHooks.eotField(kernel, w, before);
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
// status2 R: a side's bench, where given, takes canSwitch's place (sideCanSwitch).
const canSwitch = (kernel: TurnKernel, slot: DoublesSlotId) => sideCanSwitch(kernel.input, slotSide(slot)) ?? true;

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
    const left = sideCanSwitch(p.kernel.input, side);
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
    // status2 (A2): its types in this world (pinned getTypes: a set or added type, Roost), as hasType reads them.
    baseMaxHP: kernel.hp[slot].baseMaxHP, types: kernel.typesIn(w, slot), ability: build.abilityId, item: kernel.itemWorks(w, build) ? build.itemId : "",
    status: build.status, toxicStage: mon.eot.toxic ?? 0, grounded: kernel.grounded(w, slot), semiInvulnerable: !!mon.eot.hidden,
    sheltered: sheltered(mon.eot.hidden), saltCure: !!mon.eot.saltCure, aquaRing: !!mon.eot.aquaRing, ingrain: !!mon.eot.ingrain, curse: !!mon.eot.curse,
    healBlocked: !!mon.eot.healBlock, ...(mon.eot.nightmare ? { nightmare: true } : {}),
  };
}

/**
 * A boost() inside the end of turn (TurnKernel.applyBoosts, doubles-stages.ts: Contrary, Simple, the cap, TryBoost, Mirror
 * Armor, Mist, Defiant and Competitive, the ledger D reads) with no Mold Breaker (no active move) and White Herb left to its
 * own residual handler at 29 (data/items.ts whiteherb onResidualOrder 29: no AfterMove reaches the residual; A1's
 * `herb: false`, passed through the kernel). The stages that changed.
 */
function eotBoost(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: Partial<Record<Stage, number>>, source: DoublesSlotId | null,
  opts: { effect: "move" | "ability" | "item" | null; by?: string }): Partial<Record<Stage, number>> {
  return kernel.applyBoosts(w, slot, changes, source, { ...opts, broken: false, herb: false } as Parameters<TurnKernel["applyBoosts"]>[4]);
}

/**
 * `slot`'s item, ignored as the residual starts, works again later in it: its Embargo ends at order 21 (one turn left) and
 * Magic Room is down or ends at 27.6 (status2 E2: fieldTurns 1), and no Klutz.
 */
function itemFreed(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const mon = w.mons[slot]!;
  const room = w.field.magicRoom && !fieldEnds(kernel, w, "magicRoom");
  const suppressed = !!mon.build.itemSuppressed && mon.eot.embargo !== 1;
  return !room && !suppressed && mon.build.abilityId !== "klutz";
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
    case "nightmare": return VOLATILE_NAMES.nightmare;
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
    // status2 E2, order 3: a Future Sight or Doom Desire landing at this position (a slot condition, as Wish: the holder's
    // Speed is the occupant's; it runs for a fainted occupant and hits nothing then). Its source's state is read and written.
    const future = mon.eot.futureMove;
    if (future && !("bare" in future)) {
      const at = kernel.occupant(w, slot);
      const touched = future.source !== null && w.mons[future.source] ? [at, future.source] : [at];
      if (w.mons[at]) add(RESIDUAL_KEYS.futuremove, at, touched, touched, (x, key) => landingHandler(p, x, slot, key));
    }
    // Order 4: a Wish at this position (a slot condition: it runs for a fainted occupant too, and heals nothing then).
    if (mon.eot.wish !== undefined) {
      const at = kernel.occupant(w, slot);
      if (w.mons[at]) add(RESIDUAL_KEYS.wish, at, [at], [at], (x, key) => wishHandler(p, x, slot, key));
    }
  }
  // status2 E2, order 5.1: each side condition that damages its side's active Pokémon (the G-Max four, the sea of fire),
  // one handler per Pokémon at its Speed (sim/battle.ts fieldEvent: findSideEventHandlers with the active Pokémon as holder).
  for (const side of SIDES) {
    for (const id of sideResiduals(w, side)) {
      for (const slot of DOUBLES_SLOTS) {
        if (slotSide(slot) !== side || !alive(w, slot)) continue;
        add(RESIDUAL_KEYS.sideresidual, slot, [slot], [slot], (x, key) => sideResidualHandler(p, x, slot, id, key));
      }
    }
  }
  // status2 E2, order 26.7-26.9: the Pledges' side conditions count down (a side's handler: no Speed of its own).
  for (const side of SIDES) {
    const pledge = w.sides[side].pledge;
    for (const kind of ["water", "fire", "grass"] as const) {
      if (pledge?.[kind] !== undefined) add(RESIDUAL_KEYS[`pledge${kind}`], null, [], [], (x, key) => pledgeCountdown(p, x, side, kind, key));
    }
  }
  // status2 E2, order 27: the field effects from before the turn whose turns left end now (fieldTurns 1).
  for (const which of ["gravity", "magicRoom", "terrain"] as const) {
    if (fieldEnds(kernel, w, which)) add(RESIDUAL_KEYS[which === "magicRoom" ? "magicroom" : which], null, DOUBLES_SLOTS, DOUBLES_SLOTS, (x, key) => fieldEnd(p, x, which, key));
  }
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const build = mon.build, ability = build.abilityId;
    // An item handler is collected whatever ignoringItem says (sim/battle.ts findPokemonEventHandlers; runEvent skips it
    // while ignored), so an item Embargo frees at 21 acts after it (status2 C4), as one Magic Room's end at 27.6 frees
    // (status2 E2): each handler reads itemWorks as it runs.
    const item = kernel.itemWorks(w, build) || itemFreed(kernel, w, slot) ? build.itemId : "";
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
      add(RESIDUAL_KEYS.leechseed, slot, [slot, gainer], [slot, gainer], (x, key) => leechSeedHandler(p, x, slot, key, speeds));
    }
    if (build.status === "psn" || build.status === "tox") add(RESIDUAL_KEYS[build.status], slot, [slot], [slot], (x, key) => poisonHandler(p, x, slot, build.status as "psn" | "tox", key));
    if (build.status === "brn") add(RESIDUAL_KEYS.brn, slot, [slot], [slot], (x, key) => statusDamage(p, x, slot, "brn", key));
    // status2: Nightmare (11).
    if (mon.eot.nightmare) add(RESIDUAL_KEYS.nightmare, slot, [slot], [slot], (x, key) => nightmareHandler(p, x, slot, key));
    if (mon.eot.curse) add(RESIDUAL_KEYS.curse, slot, [slot], [slot], own("curse"));
    if (mon.eot.trap) add(RESIDUAL_KEYS.partiallytrapped, slot, [slot, mon.eot.trap.source], [slot], (x, key) => trapHandler(p, x, slot, key));
    if (mon.eot.saltCure) add(RESIDUAL_KEYS.saltcure, slot, [slot], [slot], own("saltcure"));
    if (mon.eot.syrupBomb) {
      const source = mon.eot.syrupBomb;
      // Its source gone before the residual: the volatile ended at that action's Update (data/moves.ts syrupbomb onUpdate).
      if (!alive(w, source)) mon.eot = { ...mon.eot, syrupBomb: undefined };
      else add(RESIDUAL_KEYS.syrupbomb, slot, [slot, source], [slot, source], (x, key) => syrupBombHandler(p, x, slot, source, key));
    }
    // status2: Octolock (14, by Speed with Syrup Bomb; Mirror Armor writes its source), the countdowns (19, 20, 21).
    if (mon.eot.octolock) {
      const source = mon.eot.octolock;
      add(RESIDUAL_KEYS.octolock, slot, [slot, source], [slot, source], (x, key) => octolockHandler(p, x, slot, source, key));
    }
    // status2 E2 (IN §4.3): Taunt (15), Encore (16) and Disable (17) with their turns left (carried, or a use this turn's).
    if (mon.vol.taunt && mon.eot.tauntLeft !== undefined) add(RESIDUAL_KEYS.taunt, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "taunt", key));
    if (mon.vol.encore && mon.eot.encoreLeft !== undefined) add(RESIDUAL_KEYS.encore, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "encore", key));
    if (mon.vol.disabled && mon.eot.disableLeft !== undefined) add(RESIDUAL_KEYS.disable, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "disable", key));
    if (mon.eot.telekinesis !== undefined) add(RESIDUAL_KEYS.telekinesis, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "telekinesis", key));
    if (mon.eot.healBlock && mon.eot.healBlockLeft !== undefined) add(RESIDUAL_KEYS.healblock, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "healblock", key));
    if (mon.eot.embargo !== undefined) add(RESIDUAL_KEYS.embargo, slot, [slot], [slot], (x, key) => countdown(p, x, slot, "embargo", key));
    if (mon.eot.yawn) add(RESIDUAL_KEYS.yawn, slot, [slot], [slot], (x, key) => yawnHandler(p, x, slot, key));
    if (mon.eot.perish) add(RESIDUAL_KEYS.perishsong, slot, [slot], [slot], (x, key) => perishHandler(p, x, slot, key));
    // Order 25: Roost's volatile ends (data/moves.ts roost condition, duration 1): ungrounded again for the Orbs at 28.3.
    if (mon.eot.roosted) add(RESIDUAL_KEYS.roost, slot, [], [slot], (x) => { roostEnds(x, slot); return [x]; });
    // status2 E2: Uproar's upkeep (28.1): its turns counted down at the use (CL's vol.uproar: turns left after this one).
    if (mon.vol.uproar !== undefined) add(RESIDUAL_KEYS.uproar, slot, [slot], [slot], (x, key) => uproarHandler(p, x, slot, key));
    if (ability === "baddreams") add(RESIDUAL_KEYS.baddreams, slot, [slot, ...foesOf(slot)], [...foesOf(slot)], (x, key) => badDreamsHandler(p, x, slot, key));
    if (ability === "speedboost") add(RESIDUAL_KEYS.speedboost, slot, [slot], [slot], (x, key) => speedBoostHandler(p, x, slot, key));
    // status2 (C8): Harvest and Pickup on the item history, in the one Speed-sorted 28.2 group (Pickup clears a candidate's
    // lastItem, which a slower Harvest then lacks). Without item history (D's tracksItems false), today's guards.
    if (ability === "harvest") {
      if (kernel.tracksItems) add(RESIDUAL_KEYS.harvest, slot, [slot], [slot], (x, key) => harvestHandler(p, x, slot, key));
      else add(RESIDUAL_KEYS.harvest, slot, [slot], [], (x) => harvestGuard(p, x, slot, startItems.get(slot) ?? ""));
    }
    if (ability === "pickup") {
      if (kernel.tracksItems) add(RESIDUAL_KEYS.pickup, slot, DOUBLES_SLOTS, DOUBLES_SLOTS, (x, key) => pickupHandler(p, x, slot, key));
      else add(RESIDUAL_KEYS.pickup, slot, DOUBLES_SLOTS, [], (x) => pickupGuard(p, x, slot, startItems));
    }
    // status2 E2 (T2E §4.2, §4.3): Cud Chew for every holder (a Berry may be eaten in this residual before 28.2), Moody.
    if (ability === "cudchew") {
      add(RESIDUAL_KEYS.cudchew, slot, [slot], [slot], (x, key) => cudChewHandler(p, x, slot, key));
      // C29: no Berry due from last turn, when the input does not say (a Berry is due only the turn after it was eaten).
      const entry = kernel.input.pokemon[slot];
      if (entry && entry.carried?.cudChew === undefined && !entry.build.itemId.endsWith("berry")) p.turnFacts.add(`Assumes ${kernel.names[slot]} ate no Berry last turn.`);
    }
    if (ability === "moody") add(RESIDUAL_KEYS.moody, slot, [slot], [slot], (x, key) => moodyHandler(p, x, slot, key));
    if (item === "stickybarb") add(RESIDUAL_KEYS.stickybarb, slot, [slot], [slot], own("stickybarb"));
    if (item === "flameorb" || item === "toxicorb") add(RESIDUAL_KEYS[item], slot, [slot], [slot], (x, key) => orbHandler(p, x, slot, item, key));
    if (FORM_LINES[ability]) add(RESIDUAL_KEYS[ability], slot, [slot], [slot], (x, key) => formHandler(p, x, slot, key));
    if (ability === "hungerswitch") add(RESIDUAL_KEYS.hungerswitch, slot, [slot], [slot], (x, key) => hungerSwitch(p, x, slot, key));
    // status2 (C9): the copies at 29 (an ability's, then at the same Speed an item's: subOrder 7, 8).
    if (ability === "opportunist") add(RESIDUAL_KEYS.opportunist, slot, [slot], [slot], (x, key) => copyHandler(p, x, slot, "opportunist", key));
    if (item === "mirrorherb") add(RESIDUAL_KEYS.mirrorherb, slot, [slot], [slot], (x, key) => copyHandler(p, x, slot, "mirrorherb", key));
    if (item === "whiteherb") add(RESIDUAL_KEYS.whiteherb, slot, [slot], [slot], (x, key) => whiteHerb(p, x, slot, key));
    if (item === "ejectpack") add(RESIDUAL_KEYS.ejectpack, slot, [slot], [slot], (x, key) => ejectPack(p, x, slot, startBoosts.get(slot)!, key));
    if (item === "micleberry") add(RESIDUAL_KEYS.micleberry, slot, [slot, ...foesOf(slot)], [slot], (x, key) => micleBerry(p, x, slot, key));
  }
  return handlers;
}

// ------------------------------------------------------------------------------------------------------------------
// status2 E2: Future Sight and Doom Desire landing (order 3; T2E §4.1)
// ------------------------------------------------------------------------------------------------------------------

/** The partner abilities that boost an ally's move (data/abilities.ts battery, powerspot, steelyspirit onAllyBasePower). */
const PARTNER_BOOSTS = ["battery", "powerspot", "steelyspirit"] as const;
type Landing = { move: "futuresight" | "doomdesire"; source: DoublesSlotId | null; build: BattleBuild | null };

/**
 * The side the user of a landing at `position` is on, for a user not in battle (a build): the input's (`side` on the
 * carried landing, when given), else the side across from the position when the side cannot change the hit (no living
 * partner-boost holder on either side, no Telepathy on the position's side: the only side readers, T2E §4.1.3), else null.
 */
function landingSide(kernel: TurnKernel, w: World, position: DoublesSlotId): DoublesSideId | null {
  const carried = kernel.input.pokemon[position]?.carried?.futureMove;
  const given = carried && typeof carried === "object" ? (carried as { side?: DoublesSideId }).side : undefined;
  if (given) return given;
  const reads = DOUBLES_SLOTS.some((slot) => alive(w, slot) && ((PARTNER_BOOSTS as readonly string[]).includes(w.mons[slot]!.build.abilityId)
    || (slotSide(slot) === slotSide(position) && w.mons[slot]!.build.abilityId === "telepathy")));
  return reads ? null : slotSide(position) === "own" ? "opponent" : "own";
}

/**
 * The landing's reason before the end of turn runs (guardOf): a bare move id (C33: needsLandingUser); a user not in
 * battle whose side the input does not give where the side changes the hit (needsLandingUser); a user not in battle with
 * two living holders of one partner boost on its side (each chains its boost on its ally's move, and the calculation's
 * partner flag counts one: REASONS.landingPartners; only a duplicate species can do it).
 */
function landingGuard(kernel: TurnKernel, w: World, position: DoublesSlotId): string | null {
  const future = w.mons[position]!.eot.futureMove!;
  if ("bare" in future) return REASONS.needsLandingUser(kernel.moveName(future.bare));
  if (future.source !== null) return null;
  const side = landingSide(kernel, w, position);
  if (!side) return REASONS.needsLandingUser(kernel.moveName(future.move));
  for (const ability of PARTNER_BOOSTS) {
    const holders = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side && alive(w, slot) && w.mons[slot]!.build.abilityId === ability);
    if (holders.length > 1) return REASONS.landingPartners(kernel.moveName(future.move), kernel.abilityName(ability));
  }
  return null;
}

/**
 * A user's build while it is not active (PS/sim/pokemon.ts ignoringAbility, ignoringItem: gen ≥ 5 and !isActive; its stat
 * stages and volatiles cleared as it left: clearVolatile), as the landing's calculation reads it: its ability a stand-in,
 * no item (a Primal Orb is still read, but changes no landing), stages 0, no critical-hit volatile. `fainted` (a Pokémon
 * of the turn that fainted, sim/battle.ts faintMessages): no Terastallization or Dynamax, a Mega or Primal form back to
 * its base species, its world types and stats from its species again (withSpecies).
 */
function inactiveBuild(kernel: TurnKernel, build: BattleBuild, fainted: boolean): { build: BattleBuild; reverted: string | null; tera: boolean } {
  const zero = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as BattleBuild["boosts"];
  let out: BattleBuild = { ...build, abilityId: GAS_STAND_IN, abilityActive: false, itemId: "", boosts: zero, currentHP: null };
  delete out.focusEnergy; delete out.settledFocusEnergy; delete out.dragonCheer; delete out.itemSuppressed;
  if (!fainted) return { build: out, reverted: null, tera: false };
  const tera = out.mechanic === "tera";
  delete out.mechanic;
  const species = kernel.runtime.speciesById.get(out.speciesId);
  const base = species?.battleForm && species.changesFrom && species.requiredItem ? species.changesFrom : null;
  out = withSpecies(out, base ?? out.speciesId);
  return { build: out, reverted: base, tera };
}

/** status2 R-E: where the Pokémon that started the turn in `source` stands now (its slot, or another after a switch), or null: it left. */
function standsAt(w: World, source: DoublesSlotId): DoublesSlotId | null {
  if (w.mons[source] && w.mons[source]!.id === undefined) return source;
  return DOUBLES_SLOTS.find((slot) => w.mons[slot]?.id === startId(source)) ?? null;
}

/** The landing's user as the hit reads it (T2E §4.1.3): its build, an active user's slot (its state read and written), the slot of a user of the turn, its side, the line's facts. */
type LandingUser = { build: BattleBuild; attacker: DoublesSlotId | null; slot: DoublesSlotId | null; side: DoublesSideId; facts: string[] };

function landingUser(kernel: TurnKernel, w: World, future: Landing, position: DoublesSlotId): LandingUser {
  const source = future.source;
  // status2 R-E: the user is the Pokémon that started the turn in `source`, wherever it stands now (standsAt), or on the bench.
  const at = source !== null ? standsAt(w, source) : null;
  if (at !== null && alive(w, at)) return { build: kernel.calcBuild(w, at), attacker: at, slot: at, side: slotSide(at), facts: [] };
  if (source !== null && at === null) {
    const left = w.benched?.[slotSide(source)]?.find((each) => each.id === startId(source) && !each.back);
    const name = kernel.startNames[source];
    const { build } = inactiveBuild(kernel, left ? left.mon.build : w.mons[source]!.build, false);
    return { build, attacker: null, slot: null, side: slotSide(source), facts: [`${name} is not in battle: its ability, item and stat changes do not count.`] };
  }
  if (source !== null) {
    const name = kernel.names[source];
    const { build, reverted, tera } = inactiveBuild(kernel, w.mons[source]!.build, true);
    const facts = [`${name} has fainted: its ability, item and stat changes do not count.`];
    if (reverted) facts.push(`${name} is back to ${kernel.runtime.speciesById.get(reverted)?.name ?? reverted} after fainting.`);
    if (tera) facts.push(`${name}'s Terastallization ended as it fainted.`);
    return { build, attacker: null, slot: source, side: slotSide(source), facts };
  }
  const given = future.build!;
  const { build } = inactiveBuild(kernel, given, false);
  const name = kernel.runtime.speciesById.get(given.speciesId)?.name ?? given.speciesId;
  return { build, attacker: null, slot: null, side: landingSide(kernel, w, position)!, facts: [`${name} is not in battle: its ability, item and stat changes do not count.`] };
}

/**
 * Order 3 (status2 E2; T2E §4.1; PS/data/conditions.ts:379-421 futuremove): the landing at `position` ends there and hits
 * the Pokémon now at that slot (kernel.occupant) with trySpreadMoveHit's steps: nothing for a fainted occupant or for its
 * own user ("{Move} does not hit: {Name} is its user."); Protect and Endure from this turn are gone (the kernel's
 * residual step reads neither); the invulnerability step (a hidden Pokémon is missed unless No Guard is on either side);
 * Telepathy against its ally's landing; the type immunity (the calculation's no-damage row: "{Name} is immune."); a
 * Substitute takes the hit (landingIntoSubstitute) unless an active Infiltrator user's passes it; otherwise
 * kernel.residualHit (the Berry at the hit's Update, Focus Sash, Sturdy, Multiscale, Weakness Policy, Berserk...). Then
 * an active user holding a working Life Orb loses 1/10 of its maximum HP (Magic Guard none), hit or not (FS07c), unless
 * the target's Red Card dragged it out (forceSwitchFlag: after the turn, its own residual line). The recording walk's
 * lines come from per-value clones (recordLanding): the damage under the move's name, the Berry its own line.
 */
function landingHandler(p: Phase, w: World, position: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  const holder = w.mons[position]!;
  const future = holder.eot.futureMove;
  if (!future || "bare" in future) return [w];
  const { futureMove: _landed, ...eot } = holder.eot;
  void _landed;
  holder.eot = eot;
  const target = kernel.occupant(w, position);
  const move = kernel.runtime.movesById.get(future.move);
  if (!move) return kernel.notEstimated(REASONS.notIn2v2(future.move));
  if (!alive(w, target)) return [w];
  if (future.source !== null && standsAt(w, future.source) === target) {
    p.rec?.act(target, move.name, undefined, w.mass, key, null, [`${move.name} does not hit: ${kernel.names[target]} is its user.`]);
    return [w];
  }
  const user = landingUser(kernel, w, future, position);
  const other = user.slot ?? undefined;
  const receiver = w.mons[target]!;
  // Its Protect and Endure from this turn are removed (target.removeVolatile('Protect'), 'Endure'; the shields stay).
  if (receiver.protect === "protect") receiver.protect = null;
  if (receiver.vol.endure) { const { endure: _endure, ...vol } = receiver.vol; void _endure; receiver.vol = vol; }
  const noGuard = receiver.build.abilityId === "noguard" || (user.attacker !== null && user.build.abilityId === "noguard");
  // The move's line ("-end … move: Future Sight"): its facts, no HP; the damage is a line of its own (recordLanding).
  const record = (world: World, facts: string[]) => p.rec?.act(target, move.name, other, world.mass, key, null, facts);
  const lifeOrb = (worlds: World[]) => worlds.map((world) => landingLifeOrb(p, world, user, target, sub(p, key, 2)));
  // The invulnerability step (sim/battle-actions.ts hitStepInvulnerabilityEvent; No Guard's onAnyInvulnerability).
  if (hiddenHooks.hiddenKind(w, target) && !noGuard) {
    record(w, [...user.facts, `${move.name} misses ${kernel.names[target]}.`]);
    return lifeOrb([w]);
  }
  // TryHit: Telepathy against an ally's damaging move (data/abilities.ts telepathy onTryHit).
  if (slotSide(target) === user.side && receiver.build.abilityId === "telepathy") {
    record(w, [...user.facts, `${kernel.abilityName("telepathy")}: ${kernel.names[target]} is not hit.`]);
    return lifeOrb([w]);
  }
  let conditions = kernel.conditionsFor(w, user.attacker, target, false, move.id, { side: user.side });
  const hands = user.attacker ? w.mons[user.attacker]!.helpingHand : 0;
  // Helping Hand an active user received this turn still boosts it (FS17: the helpinghand volatile lasts to the residual's end).
  if (hands === 1) conditions = { ...conditions, attackerSide: { ...conditions.attackerSide, helpingHand: true } };
  const analytic = user.build.abilityId === "analytic";
  const context: MoveContext | undefined = hands >= 2 || analytic
    ? { ...(analytic ? { turnOrder: "last" as const } : {}), ...(hands >= 2 ? { helpingHands: Math.min(3, hands) as 2 | 3 } : {}) } : undefined;
  const attackerBuild = { ...user.build, currentHP: null };
  const hit = { move: move.id, position, attacker: user.slot, side: user.side, build: user.build, conditions, ...(context ? { context } : {}) };
  // A Substitute: an active Infiltrator user's landing passes it (data.moveData.infiltrates); otherwise it takes the hit.
  if (receiver.vol.substitute && !(user.attacker !== null && user.build.abilityId === "infiltrator")) {
    return lifeOrb(landingIntoSubstitute(p, w, target, user, move, conditions, context, key));
  }
  const entry = kernel.searchFor(w, user.attacker, target, move.id, conditions, context, false, undefined, { attackerBuild });
  if (entry.row.kind !== "calculated") return kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  if (!entry.search) {
    record(w, [...user.facts, kernel.noDamageFact(entry.row, move, target)]);
    return lifeOrb([w]);
  }
  // The residual step never follows its user's HP (searchFor with attackerBuild: its Life Orb's or Shell Bell's own HP, a
  // drain, the target's Innards Out are not followed).
  record(w, user.facts);
  // The hit itself (kernel.residualHit), on a world without what the kernel's residual step stops at but the landing
  // passes: a Substitute an Infiltrator user ignores, a hidden state No Guard opens (both put back after the hit). A Red
  // Card's drag of an active user (hitReactions, switchOut: leaving) happens after the turn (forceSwitchFlag): not a
  // switch the end of turn waits for.
  const dragged = new WeakSet<World>();
  const run = (world: World): World[] => {
    const sub = world.mons[target]!.vol.substitute, hidden = world.mons[target]!.eot.hidden;
    const open = cloneWorld(world);
    const mon = open.mons[target]!;
    if (sub !== undefined) { const { substitute: _sub, ...vol } = mon.vol; void _sub; mon.vol = vol; }
    if (hidden !== undefined) { const { hidden: _hidden, ...rest } = mon.eot; void _hidden; mon.eot = rest; }
    const leaving = open.leaving;
    // status2 R-E: with the user's side's bench the drag is a pending switch made after the residual (doubles-switch.ts afterTurn).
    const draggedBefore = user.attacker !== null && switchHooks.dragSet(open, user.attacker);
    return kernel.residualHit(open, hit).map(({ world: child }) => {
      const back = child.mons[target]!;
      if (sub !== undefined && !back.fainted) back.vol = { ...back.vol, substitute: sub };
      if (hidden !== undefined && !back.fainted) back.eot = { ...back.eot, hidden };
      if (user.attacker !== null) {
        const left = child.leaving?.length !== leaving?.length;
        if (left) { if (leaving?.length) child.leaving = [...leaving]; else delete child.leaving; }
        if (left || (!draggedBefore && switchHooks.dragSet(child, user.attacker))) dragged.add(child);
      }
      return child;
    });
  };
  if (p.rec) recordLanding(p, w, target, move.name, other, key, run);
  const children = run(w);
  return children.map((child) => {
    markLandingBerry(p, w, child, target);
    if (!dragged.has(child)) return landingLifeOrb(p, child, user, target, sub(p, key, 2));
    p.rec?.act(user.attacker!, kernel.itemName("redcard"), target, child.mass, [LAST_KEY, 3], null, ["Dragged out after the turn."]);
    return child;
  });
}

/**
 * The recording walk's lines of the landing (T2E §4.1.5): for each HP value of the target, the hit on a clone conditioned
 * on it (memoised calculations; the clones are discarded), with the target's HP or stat Berry taken off for the hit and
 * put back after it, where the hit's Update then eats it (updateSlot records its own line, as the oracle's [from] item
 * line): the damage is a line of its own (part "hit"; the oracle's futuremove line), with its knockouts. The walks stay identical.
 */
function recordLanding(p: Phase, w: World, target: DoublesSlotId, effect: string, other: DoublesSlotId | undefined, key: number[], run: (world: World) => World[]) {
  const held = w.mons[target]!.build.itemId;
  const due = (HEALING_BERRIES.has(held) && held !== "enigmaberry") || !!PINCH_STAT_BERRIES[held] || held === "lansatberry" || held === "starfberry";
  for (const [hp] of marginal(w, target)) {
    const part = condition(w, target, (value) => value === hp).find(({ meets }) => meets);
    if (!part) continue;
    const base = part.world;
    if (due) base.mons[target]!.build = { ...base.mons[target]!.build, itemId: "" };
    for (const child of run(base)) {
      for (const [after, mass] of marginal(child, target)) {
        const change = after !== hp ? { delta: after - hp, ko: hp > 0 && after <= 0 } : null;
        p.rec!.act(target, effect, other, child.mass * mass, key, change, [], "hit");
      }
      if (!due || !alive(child, target) || child.mons[target]!.build.itemId) continue;
      child.mons[target]!.build = { ...child.mons[target]!.build, itemId: held };
      updateSlot(p, child, target, sub(p, key, 1));
    }
  }
}

/** A Berry the landing's hit made the target eat (its item gone, the Berry held before), marked for a later eat of it in this end of turn (EotMon.eotAte: Cud Chew, Harvest). */
function markLandingBerry(p: Phase, before: World, child: World, target: DoublesSlotId) {
  if (!p.rec) return;
  const held = before.mons[target]!.build.itemId;
  if (!held.endsWith("berry") || !alive(child, target) || child.mons[target]!.build.itemId) return;
  const { maxHP, baseMaxHP } = p.kernel.hp[target];
  const heal = HEALING_BERRIES.has(held) && held !== "enigmaberry" ? berryArithmetic(held, { maxHP, baseMaxHP, ability: before.mons[target]!.build.abilityId }, p.kernel.runtime.profile.generation).heal : 0;
  markAte(p, child, target, held, heal || null);
}

/** Life Orb after the landing (data/items.ts lifeorb onAfterMoveSecondarySelf: an active user's working Life Orb, baseMaxhp / 10; Magic Guard none). */
function landingLifeOrb(p: Phase, w: World, user: LandingUser, target: DoublesSlotId, key: number[]): World {
  const { kernel } = p;
  const slot = user.attacker;
  if (slot === null || !alive(w, slot)) return w;
  const build = w.mons[slot]!.build;
  if (build.itemId !== "lifeorb" || !kernel.itemWorks(w, build) || build.abilityId === "magicguard") return w;
  return changeHP(p, w, slot, kernel.itemName("lifeorb"), key, amountTo(kernel, slot, -residualPart(kernel.hp[slot].baseMaxHP, 10)), target);
}

/**
 * The landing into the target's Substitute (data/moves.ts substitute onTryPrimaryHit): the damage the calculation behind
 * a Substitute gives (a resist Berry and an intact Disguise not read: searchFor's behindSubstitute) comes off it, which
 * breaks at 0; the Pokémon is untouched. One world per HP the Substitute keeps (doubles-substitute.ts subPrefix over the
 * search's cases); none for no damage (an immunity).
 */
function landingIntoSubstitute(p: Phase, w: World, target: DoublesSlotId, user: LandingUser, move: ChampionsMove, conditions: BattleConditions, context: MoveContext | undefined,
  key: number[]): World[] {
  const { kernel } = p;
  const entry = kernel.searchFor(w, user.attacker, target, move.id, conditions, context, false, undefined, { behindSubstitute: true, attackerBuild: { ...user.build, currentHP: null } });
  if (entry.row.kind !== "calculated") return kernel.notEstimated(kernel.rowReason(w, target, entry.row, move));
  const other = user.slot ?? undefined;
  if (!entry.search) {
    p.rec?.act(target, move.name, other, w.mass, key, null, [...user.facts, kernel.noDamageFact(entry.row, move, target)]);
    return [w];
  }
  const search = entry.search;
  const out: World[] = [];
  for (const { world, hp: t } of faceHooks.byClass(w, target, (hp) => search.targetHPClass(hp))) {
    const cases = search.turnCases(search.initial.att.hp, t, kernel.mode);
    if ("failed" in cases) return kernel.notEstimated(cases.failed);
    const start = world.mons[target]!.vol.substitute!;
    for (const each of substituteHooks.subPrefix(cases, start)) {
      const next = cloneWorld(world, world.mass * each.mass);
      const mon = next.mons[target]!;
      const { substitute: _was, ...vol } = mon.vol;
      void _was;
      mon.vol = each.left > 0 ? { ...vol, substitute: each.left } : vol;
      p.rec?.act(target, move.name, other, next.mass, key, null, [...user.facts, ...(each.left === 0 ? ["Its Substitute breaks."] : [])]);
      out.push(next);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// status2 E2: Cud Chew, Moody (28.2), the forms (29)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Order 28.2 (status2 E2; T2E §4.2; PS/data/abilities.ts:742-771 cudchew): with HP and a Berry recorded, its counter falls
 * by 1 (2: eaten during the moves, so not yet; 1: carried, or eaten in this residual: kernel.noteItemUse); at 0 the Berry
 * is eaten again (reEat) and the record ends.
 */
function cudChewHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  if (!hasHP(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const chew = mon.eot.cudChew;
  if (!chew || chew === true) return [w];
  if (chew.counter > 1) { mon.eot = { ...mon.eot, cudChew: { berry: chew.berry, counter: 1 } }; return [w]; }
  const { cudChew: _done, ...eot } = mon.eot;
  void _done;
  mon.eot = eot;
  return reEat(p, w, slot, chew.berry, key);
}

/**
 * Cud Chew's eat (singleEvent('Eat', item): the Berry's onEat with nothing held, no TryEatItem, so a foe's Unnerve does
 * not stop it; suppressed while its holder ignores items: Embargo, Magic Room; no item used, no Unburden, no Symbiosis,
 * no lastItem): its heal (Heal Block stops it: TryHeal; none at full HP), its cure (Lum also confusion; Persim
 * confusion), its stage through boost() (the copiers' ledger), the Figy family's confusion, Lansat's focus, Starf's
 * random +2 (one world per stat below +6, as the final Update's: kernel ateBerry). Lines: "Cud Chew" ("Eats its {Berry}
 * again."), and the Berry's own (its HP summed per path with an earlier eat of it in this end of turn: Recorder.again).
 */
function reEat(p: Phase, w: World, slot: DoublesSlotId, berry: string, key: number[]): World[] {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const name = kernel.itemName(berry);
  p.rec?.act(slot, kernel.abilityName("cudchew"), undefined, w.mass, key, null, [`Eats its ${name} again.`]);
  const eat = stolenEat(berry, { baseMaxHP: kernel.hp[slot].baseMaxHP, ability: mon.build.abilityId, ignoresItem: !kernel.itemWorks(w, mon.build) }, kernel.runtime.profile.generation);
  const facts: string[] = [];
  const status = mon.build.status;
  if (status && eat.cures.includes(status)) { facts.push(`Cures its ${STATUS_WORDS[status]}.`); cureStatus(w, slot); }
  if (eat.curesConfusion && mon.vol.confusion) { facts.push("Snaps out of confusion."); mon.vol = { ...mon.vol, confusion: undefined }; }
  let next = w;
  const heal = eat.heal && !mon.eot.healBlock ? eat.heal : 0;
  if (heal) {
    const max = kernel.hp[slot].maxHP;
    const mark = ateMark(w, slot)?.item === berry ? ateMark(w, slot)! : null;
    if (p.rec) {
      for (const [hp, mass] of marginal(w, slot)) {
        const healed = Math.min(max, hp + heal) - hp;
        const change = healed && mark ? (mark.heal !== null ? { from: mark.heal, to: mark.heal + healed } : undefined) : null;
        const again = !!mark && change !== undefined && p.rec.again(slot, name, w.mass * mass, change, facts);
        if (!again) p.rec.act(slot, name, undefined, w.mass * mass, sub(p, key, 1), healed ? { delta: healed, ko: false } : null, facts, mark ? "again" : "");
      }
    }
    next = mapHP(w, slot, (hp) => ({ hp: hp > 0 ? Math.min(max, hp + heal) : hp, tag: "" }))[0].world;
  } else if (facts.length) p.rec?.act(slot, name, undefined, w.mass, sub(p, key, 1), null, facts);
  const holder = next.mons[slot]!;
  if (eat.confuses) {
    const was = !!holder.vol.confusion;
    berryConfusion(kernel, next, slot, berry);
    if (!was && holder.vol.confusion) p.rec?.act(slot, name, undefined, next.mass, sub(p, key, 1), null, ["Becomes confused."]);
  }
  if (eat.focusEnergy && !holder.build.focusEnergy && !holder.build.settledFocusEnergy && !holder.build.dragonCheer) {
    holder.build = { ...holder.build, settledFocusEnergy: true };
    p.rec?.act(slot, name, undefined, next.mass, sub(p, key, 1), null, ["Raises its critical-hit ratio."]);
  }
  if (Object.keys(eat.stages).length) {
    const was = { ...holder.build.boosts };
    eotBoost(kernel, next, slot, eat.stages, slot, { effect: "item", by: name });
    stageFacts(p, next, slot, name, undefined, was, sub(p, key, 1));
  }
  if (!eat.starf) return [next];
  const raised = STATS.filter((stat) => (holder.build.boosts[stat] ?? 0) < 6);
  if (!raised.length) return [next];
  const share = next.mass / raised.length;
  const worlds = raised.map((_, index) => (index === 0 ? next : cloneWorld(next, share)));
  next.mass = share;
  raised.forEach((stat, index) => {
    const x = worlds[index];
    const was = { ...x.mons[slot]!.build.boosts };
    eotBoost(kernel, x, slot, { [stat]: eat.starf }, slot, { effect: "item", by: name });
    stageFacts(p, x, slot, name, undefined, was, sub(p, key, 1));
  });
  return worlds;
}

/** Moody's stats (PS/data/abilities.ts:2701-2733 moody: every stat but accuracy and evasion; generation 7's counts them too, PS/data/mods/gen7/abilities.ts). */
const MOODY_STATS: Stage[] = ["atk", "def", "spa", "spd", "spe"];
const MOODY_STATS_GEN7: Stage[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const stageOf = (mon: MonState, stat: Stage) => stat === "accuracy" || stat === "evasion" ? mon.vol.stages?.[stat] ?? 0 : mon.build.boosts[stat] ?? 0;

/**
 * Whether something after Moody's 28.2 reads `slot`'s stages in the calculator's walks (T2E §4.3.2, the readers rule): its
 * White Herb or Eject Pack (29), its own stat Berry at the final Update (Starf's open stats, a pinch Berry's rise), a foe's
 * Opportunist or Mirror Herb (the copy at 29 and pending after). The HP never reads them.
 */
function moodyRead(w: World, slot: DoublesSlotId): boolean {
  const item = w.mons[slot]!.build.itemId;
  if (item === "whiteherb" || item === "ejectpack" || item === "starfberry" || PINCH_STAT_BERRIES[item]) return true;
  return foesOf(slot).some((foe) => alive(w, foe) && (w.mons[foe]!.build.abilityId === "opportunist" || w.mons[foe]!.build.itemId === "mirrorherb"));
}

/**
 * Order 28.2 (status2 E2; T2E §4.3): Moody samples a stat below +6 for +2, then another above −6 for −1, and boost()s them
 * on its holder (Contrary, Simple, the caps; the ledger's copiers; Eject Pack's drop): one world per pair at the product of
 * the two uniform picks. E2 always branches (the outcomes read the stages); the calculator's walks only where a later
 * reader exists (moodyRead), else the world stays and the recording walk records each pair's stage facts with its mass.
 */
function moodyHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const stats = kernel.gen7 ? MOODY_STATS_GEN7 : MOODY_STATS;
  const ups = stats.filter((stat) => stageOf(mon, stat) < 6);
  const pairs: { up: Stage | null; down: Stage | null; share: number }[] = [];
  for (const up of ups.length ? ups : [null]) {
    const downs = stats.filter((stat) => stageOf(mon, stat) > -6 && stat !== up);
    const upShare = ups.length ? 1 / ups.length : 1;
    if (!downs.length) { if (up) pairs.push({ up, down: null, share: upShare }); continue; }
    for (const down of downs) pairs.push({ up, down, share: upShare / downs.length });
  }
  if (!pairs.length) return [w];
  const name = kernel.abilityName("moody");
  const apply = (x: World, pair: (typeof pairs)[number]) => {
    const was = { ...x.mons[slot]!.build.boosts }, wasStages = { ...x.mons[slot]!.vol.stages };
    eotBoost(kernel, x, slot, { ...(pair.up ? { [pair.up]: 2 } : {}), ...(pair.down ? { [pair.down]: -1 } : {}) }, slot, { effect: "ability", by: name });
    return moodyFacts(x.mons[slot]!, was, wasStages);
  };
  if (!p.e2 && !moodyRead(w, slot)) {
    if (p.rec) for (const pair of pairs) p.rec.act(slot, name, undefined, w.mass * pair.share, key, null, apply(cloneWorld(w), pair));
    return [w];
  }
  const worlds = pairs.map((pair, index) => (index === 0 ? w : cloneWorld(w, w.mass * pair.share)));
  w.mass *= pairs[0].share;
  return pairs.map((pair, index) => {
    const x = worlds[index];
    const facts = apply(x, pair);
    p.rec?.act(slot, name, undefined, x.mass, key, null, facts);
    return x;
  });
}

/** The stage facts of one Moody boost() ("Attack +2.", "Speed −1."; generation 7 also "Accuracy +2.", "Evasion −1."). */
function moodyFacts(mon: MonState, was: BattleBuild["boosts"], wasStages: NonNullable<MonState["vol"]["stages"]>): string[] {
  const out: string[] = [];
  for (const stat of STATS) {
    const by = (mon.build.boosts[stat] ?? 0) - (was[stat] ?? 0);
    if (by) out.push(`${STAT_NAMES[stat]} ${by > 0 ? "+" : "−"}${Math.abs(by)}.`);
  }
  for (const stat of ["accuracy", "evasion"] as const) {
    const by = (mon.vol.stages?.[stat] ?? 0) - (wasStages[stat] ?? 0);
    if (by) out.push(`${stat === "accuracy" ? "Accuracy" : "Evasion"} ${by > 0 ? "+" : "−"}${Math.abs(by)}.`);
  }
  return out;
}

/**
 * The form a Zen Mode, Shields Down or Schooling holder takes at 29 at `hp` (PS/data/abilities.ts zenmode, shieldsdown,
 * schooling onResidual; maxhp: the engine's, Dynamax included), or null for none: Zen Mode at half or less into its Zen
 * form (Darmanitan-Zen, Darmanitan-Galar-Zen), above half back (its battleOnly form); Shields Down above half into
 * Minior-Meteor, at half or less back to its core (the set's species: the input's, Minior for a Meteor input, every core
 * having the same stats, types and weight); Schooling (level 20 and up) above a quarter into Wishiwashi-School, at a
 * quarter or less back.
 */
function formAt(kernel: TurnKernel, slot: DoublesSlotId, build: BattleBuild, hp: number): string | null {
  const max = kernel.hp[slot].maxHP;
  const id = build.speciesId;
  if (build.abilityId === "zenmode" && id.startsWith("darmanitan")) {
    const zen = id.endsWith("zen");
    if (hp <= max / 2 && !zen) return id.includes("galar") ? "darmanitangalarzen" : "darmanitanzen";
    if (hp > max / 2 && zen) return id.slice(0, -3);
    return null;
  }
  if (build.abilityId === "shieldsdown" && id.startsWith("minior")) {
    const meteor = id === "miniormeteor";
    if (hp > max / 2 && !meteor) return "miniormeteor";
    if (hp <= max / 2 && meteor) { const own = kernel.input.pokemon[slot]?.build.speciesId; return own && own !== "miniormeteor" ? own : "minior"; }
    return null;
  }
  if (build.abilityId === "schooling" && id.startsWith("wishiwashi")) {
    if (hp > max / 4 && id === "wishiwashi") return "wishiwashischool";
    if (hp <= max / 4 && id === "wishiwashischool") return "wishiwashi";
  }
  return null;
}

/**
 * Order 29 (status2 E2; T2E §4.5): Zen Mode, Shields Down and Schooling change their holder's form across the HP line
 * (formAt), its HP and maximum HP unchanged (the paired forms have equal base HP), through setSpecies' resets
 * (withSpecies: types, stored stats, weight). Not for a transformed holder or Schooling under level 20; a Dynamaxed
 * holder keeps REASONS.formChange. E2 splits the world on the line (the outcomes read the form); the calculator's walks
 * do not (nothing later in the turn reads it) and record "Becomes {Form}." with the flipping share's mass. Power
 * Construct keeps its reason (formGuard: its maximum HP changes).
 */
function formHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (build.abilityId === "powerconstruct") return formGuard(p, w, slot);
  const level = build.native ? build.native.level ?? 100 : 50;
  if (mon.vol.transform || build.transformedFrom || (build.abilityId === "schooling" && level < 20)) return [w];
  const flips = (hp: number) => hp > 0 && formAt(kernel, slot, build, hp) !== null;
  if (!someHP(w, slot, flips)) return [w];
  if (isMaxActive(build)) return kernel.notEstimated(REASONS.formChange(kernel.abilityName(build.abilityId), kernel.names[slot]));
  const name = kernel.abilityName(build.abilityId);
  const text = (form: string) => `Becomes ${kernel.runtime.speciesById.get(form)?.name ?? form}.`;
  if (!p.e2) {
    if (p.rec) for (const [hp, mass] of marginal(w, slot)) if (flips(hp)) p.rec.act(slot, name, undefined, w.mass * mass, key, null, [text(formAt(kernel, slot, build, hp)!)]);
    return [w];
  }
  return condition(w, slot, flips).map(({ world, meets }) => {
    if (!meets) return world;
    const form = formAt(kernel, slot, build, [...marginal(world, slot).keys()].find(flips)!)!;
    world.mons[slot]!.build = withSpecies(world.mons[slot]!.build, form);
    p.rec?.act(slot, name, undefined, world.mass, key, null, [text(form)]);
    return world;
  });
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
    const before = fieldBefore(kernel, w);
    w.field = { ...w.field, weather: "" };
    // status2 E2: FC's re-settle with the field before the end (its facts on the holders' residual lines).
    fieldChangeHooks.eotField(kernel, w, before, eotSink(p, key));
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

/** sim/pokemon.ts cureStatus: the status and what goes with it (the sleep counter, bad poison's stage; a sleep's Nightmare: status2 CR11). */
function cureStatus(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const asleep = mon.build.status === "slp";
  mon.build = { ...mon.build, status: "" };
  mon.vol = { ...mon.vol, sleep: undefined, freeze: undefined };
  mon.eot = { ...mon.eot, toxic: undefined, ...(asleep && mon.eot.nightmare ? { nightmare: undefined } : {}) };
}

/**
 * Order 8: Leech Seed (data/moves.ts leechseed condition onResidual). The Pokémon standing at the seeder's position gains
 * (ADDENDUM A6): none when that slot is empty or its Pokémon fainted. The seeded loses baseMaxHP/8 (at least 1, capped at its
 * HP; Magic Guard: nothing); the gainer heals what it lost (Big Root ×5324/4096; none at full HP, none under Heal Block), or
 * the seeded's Liquid Ooze deals that to it instead (Magic Guard stops it). status2 (F4 §4.16, GA4): a heal-blocked gainer's
 * TryHeal runs two handlers in speedSort order (sim/battle.ts comparePriority: the holders' Speed as the residual started,
 * then subOrder): its Heal Block (a volatile: subOrder 2) stops the heal and Liquid Ooze with it, unless the seeded is
 * faster, whose Liquid Ooze (an ability: 7) deals the damage first; at one Speed the volatile's subOrder goes first.
 */
function leechSeedHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[], speeds: Speeds): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !w.mons[slot]!.eot.leechSeed) return [w];
  const gainer = kernel.occupant(w, w.mons[slot]!.eot.leechSeed!);
  if (!alive(w, gainer)) return [w];
  const damage = leechSeedDamage(residualMon(kernel, w, slot));
  if (!damage) return [w];
  const seeded = w.mons[slot]!.build, gaining = w.mons[gainer]!;
  const ooze = seeded.abilityId === "liquidooze" && (!gaining.eot.healBlock || (speeds[slot] ?? 0) > (speeds[gainer] ?? 0));
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

/**
 * Order 13: a partial trap damages while its source is in with HP (data/conditions.ts partiallytrapped onResidual); otherwise
 * it ends, silently. status2 E2: a G-Max Centiferno or Sandblast trap goes on after its user left (its gmaxEffect).
 */
function trapHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !w.mons[slot]!.eot.trap) return [w];
  const trap = w.mons[slot]!.eot.trap!;
  if (!alive(w, trap.source) && !trap.gmax) { endTrap(w, slot); return [w]; }
  const mon = residualMon(kernel, w, slot);
  const each = ownResiduals({ ...mon, trapDivisor: trap.divisor }, { terrain: "", champions: kernel.champions }).find((entry) => entry.id === "partiallytrapped");
  if (!each) return [w];
  return [changeHP(p, w, slot, ownName(kernel, "partiallytrapped", w, slot), key, amountTo(kernel, slot, each.amount), trap.source)];
}

/** Order 14: Syrup Bomb lowers the holder's Speed by 1 from its source (data/moves.ts syrupbomb onResidual; Mirror Armor, Clear Body... through eotBoost). */
function syrupBombHandler(p: Phase, w: World, slot: DoublesSlotId, source: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot) || w.mons[slot]!.eot.syrupBomb !== source) return [w];
  const was = { ...w.mons[slot]!.build.boosts };
  eotBoost(p.kernel, w, slot, { spe: -1 }, source, { effect: "move" });
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
 * Order 11: Nightmare (data/moves.ts nightmare condition onResidual: this.damage(baseMaxhp / 4), Magic Guard none). The
 * volatile stands only on a sleeping or Comatose Pokémon (its onStart; every sleep cure removes it: sim/pokemon.ts
 * cureStatus), so one that is neither has lost it already (CR11): it ends silently.
 */
function nightmareHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot) || !w.mons[slot]!.eot.nightmare) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.status !== "slp" && mon.build.abilityId !== "comatose") {
    mon.eot = { ...mon.eot, nightmare: undefined };
    return [w];
  }
  return ownHandler(p, w, slot, "nightmare", key);
}

/**
 * Order 14: Octolock (data/moves.ts octolock condition onResidual). Its source gone, at 0 HP or with no active turn yet
 * (a Pokémon that switched in this turn: activeTurns 0) ends it silently; otherwise boost({def: −1, spd: −1}) on the holder
 * from the source with the move as its effect (TV18c, CR05): Clear Amulet, Clear Body and kin, Mirror Armor back onto the
 * source, Mist (a move's effect from another Pokémon), then Defiant and Competitive per stat lowered, and the boost() table
 * on the ledger for the copiers at 29 (C9).
 */
function octolockHandler(p: Phase, w: World, slot: DoublesSlotId, source: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || w.mons[slot]!.eot.octolock !== source) return [w];
  if (!alive(w, source) || kernel.input.pokemon[source]?.switchedIn) {
    w.mons[slot]!.eot = { ...w.mons[slot]!.eot, octolock: undefined };
    return [w];
  }
  const was = { ...w.mons[slot]!.build.boosts }, wasSource = { ...w.mons[source]!.build.boosts };
  eotBoost(kernel, w, slot, { def: -1, spd: -1 }, source, { effect: "move" });
  const name = VOLATILE_NAMES.octolock;
  stageFacts(p, w, slot, name, source, was, key);
  // A drop Mirror Armor sent back onto the source.
  stageFacts(p, w, source, name, slot, wasSource, sub(p, key, 1));
  return [w];
}

/** The volatiles whose duration counts down at the residual with no handler of their own (15, 16, 17; 19, 20, 21). */
type Countdown = "taunt" | "encore" | "disable" | "telekinesis" | "healblock" | "embargo";

/**
 * Orders 19, 20, 21 (status2 C3, C4; CR01, CR02): Telekinesis, Heal Block and Embargo count their turns down (sim/battle.ts
 * fieldEvent: `handler.state.duration--`), and at 0 the volatile ends (its End: "-end"): no longer floating for the Orbs'
 * Misty Terrain (28.3); later heals (Cheek Pouch, a Berry Harvest restores) and the final Update's HP Berries act again;
 * the item works again for Sticky Barb and the Orbs (28.3), White Herb, Mirror Herb and Eject Pack (29), Micle and the final
 * Update. Turns left after the countdown go to E2 (DoublesOutcomeMon.turnsLeft). A Heal Block with no turns given (none
 * from the input) does not count down. status2 E2 (IN §4.3): Taunt (15), Encore (16) and Disable (17) likewise, from
 * the turns the input gives or a use this turn wrote (EotState.tauntLeft, encoreLeft, disableLeft); at 0 the volatile
 * ends. Encore's own end when its move has no PP left (data/moves.ts encore onResidual) comes from the input's turns
 * (Training passes 1 then).
 */
function countdown(p: Phase, w: World, slot: DoublesSlotId, which: Countdown, key: number[]): World[] {
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (which === "taunt" || which === "encore" || which === "disable") return volatileCountdown(p, w, slot, which, key);
  const left = which === "telekinesis" ? mon.eot.telekinesis : which === "embargo" ? mon.eot.embargo : mon.eot.healBlock ? mon.eot.healBlockLeft : undefined;
  if (left === undefined) return [w];
  const next = left - 1;
  if (which === "telekinesis") mon.eot = { ...mon.eot, telekinesis: next > 0 ? next : undefined };
  else if (which === "embargo") {
    mon.eot = { ...mon.eot, embargo: next > 0 ? next : undefined };
    if (next <= 0 && mon.build.itemSuppressed) {
      const { itemSuppressed: _suppressed, ...build } = mon.build;
      void _suppressed;
      mon.build = build;
    }
  } else mon.eot = next > 0 ? { ...mon.eot, healBlockLeft: next } : { ...mon.eot, healBlock: undefined, healBlockLeft: undefined };
  if (next <= 0) p.rec?.act(slot, `${VOLATILE_NAMES[which]} ends`, undefined, w.mass, key, null);
  return [w];
}

/** Taunt, Encore and Disable's countdown (countdown): the volatile with its turns left, ended at 0 (Taunt ends, Encore ends, Disable ends). */
function volatileCountdown(p: Phase, w: World, slot: DoublesSlotId, which: "taunt" | "encore" | "disable", key: number[]): World[] {
  const mon = w.mons[slot]!;
  const field = which === "taunt" ? "tauntLeft" : which === "encore" ? "encoreLeft" : "disableLeft";
  const up = which === "taunt" ? !!mon.vol.taunt : which === "encore" ? !!mon.vol.encore : !!mon.vol.disabled;
  const left = mon.eot[field];
  if (!up || left === undefined) return [w];
  const next = left - 1;
  if (next > 0) { mon.eot = { ...mon.eot, [field]: next }; return [w]; }
  const { [field]: _gone, ...eot } = mon.eot;
  void _gone;
  mon.eot = eot;
  const vol = { ...mon.vol };
  delete vol[which === "disable" ? "disabled" : which];
  mon.vol = vol;
  p.rec?.act(slot, `${VOLATILE_NAMES[which]} ends`, undefined, w.mass, key, null);
  return [w];
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
  // status2 E2 (T2M §6.3's E+): while an active Pokémon has the uproar volatile (to its upkeep at 28.1), every sleep fails
  // (data/moves.ts uproar condition onAnySetStatus: null for slp).
  if (DOUBLES_SLOTS.some((other) => alive(w, other) && w.mons[other]!.vol.uproar !== undefined)) {
    p.rec?.act(slot, kernel.moveName("yawn"), undefined, w.mass, key, null, [`Cannot fall asleep: ${kernel.moveName("uproar")}.`]);
    return [w];
  }
  return setStatus(p, w, slot, "slp", "yawn", kernel.moveName("yawn"), key);
}

/**
 * Order 28.1: Uproar's upkeep (data/moves.ts uproar condition, duration 3: the duration counts down first, then its
 * onResidual ends it under Throat Chop). CL keeps vol.uproar as the turns left after this one: at 0 it ends here.
 */
function uproarHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const left = mon.vol.uproar;
  if (left === undefined || (left > 0 && !mon.throatChopped)) return [w];
  const { uproar: _gone, ...vol } = mon.vol;
  void _gone;
  mon.vol = vol;
  p.rec?.act(slot, `${VOLATILE_NAMES.uproar} ends`, undefined, w.mass, key, null);
  return [w];
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

// ------------------------------------------------------------------------------------------------------------------
// status2 E2: side conditions, the Pledges' countdowns, field effects ending, a carried release ending
// ------------------------------------------------------------------------------------------------------------------

/** The side conditions up on `side` that damage at 5.1 (T2E §4.4, T2P §3.17): the G-Max ones (SideState.gmax), the sea of fire (SideState.pledge.fire). */
function sideResiduals(w: World, side: DoublesSideId): (keyof typeof SIDE_RESIDUALS)[] {
  const state = w.sides[side];
  const gmax = (state.gmax ?? []).filter((id): id is keyof typeof SIDE_RESIDUALS => id in SIDE_RESIDUALS && id !== "firepledge");
  return state.pledge?.fire !== undefined ? [...gmax, "firepledge"] : gmax;
}
/** The residual line's name for a side condition: the move's (G-Max Wildfire, Fire Pledge). */
const SIDE_NAMES: Record<keyof typeof SIDE_RESIDUALS, string> = {
  gmaxvinelash: "G-Max Vine Lash", gmaxwildfire: "G-Max Wildfire", gmaxcannonade: "G-Max Cannonade", gmaxvolcalith: "G-Max Volcalith", firepledge: "Fire Pledge",
};

/**
 * Order 5.1 (status2 E2; T2E §4.4, T2P §3.17): one side condition's damage to `slot` (data/moves.ts gmaxvinelash and its
 * kin: baseMaxhp / 6 unless it has the condition's type; firepledge: baseMaxhp / 8 unless Fire; this.damage: Magic Guard
 * stops it), while the condition is still up and `slot` still in. Recorded under the move's name.
 */
function sideResidualHandler(p: Phase, w: World, slot: DoublesSlotId, id: keyof typeof SIDE_RESIDUALS, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !sideResiduals(w, slotSide(slot)).includes(id)) return [w];
  const damage = sideResidualDamage(residualMon(kernel, w, slot), id);
  if (!damage) return [w];
  const name = kernel.runtime.movesById.get(id)?.name ?? SIDE_NAMES[id];
  return [changeHP(p, w, slot, name, key, amountTo(kernel, slot, -damage))];
}

/**
 * Orders 26.7, 26.8, 26.9 (status2 E2; T2P §3.17): a Pledge's side condition counts its 4 turns down (SideState.pledge:
 * the turns left before this countdown, PR's 4 for one set this turn); at 0 it ends (data/moves.ts waterpledge, firepledge,
 * grasspledge condition onSideResidualOrder 26: duration only). E2 reads the turns left after the turn.
 */
function pledgeCountdown(p: Phase, w: World, side: DoublesSideId, kind: "fire" | "grass" | "water", key: number[]): World[] {
  void p; void key;
  const state = w.sides[side];
  const left = state.pledge?.[kind];
  if (left === undefined) return [w];
  const pledge = { ...state.pledge };
  if (left - 1 > 0) pledge[kind] = left - 1; else delete pledge[kind];
  const { pledge: _was, ...rest } = state;
  void _was;
  w.sides[side] = Object.keys(pledge).length ? { ...rest, pledge } : rest;
  return [w];
}

/**
 * A field effect up from before the turn that ends at this end of turn (status2 E2; T2E §4.6.2, IN §4.3): its turns
 * left before this countdown are 1 (DoublesTurnInput.fieldTurns), it is still the one from before (not set this turn:
 * World.fieldSet for Gravity and Magic Room; the terrain the input had, with no Pokémon of the turn able to set it again
 * after it was cleared or changed: terrainResettable). Gravity at 27.2, Magic Room at 27.6, the terrain at 27.7.
 */
function fieldEnds(kernel: TurnKernel, w: World, which: "gravity" | "magicRoom" | "terrain"): boolean {
  if (kernel.input.fieldTurns?.[which] !== 1) return false;
  const field = kernel.input.field;
  if (which === "gravity") return !!field.gravity && w.field.gravity && !w.fieldSet?.gravity;
  if (which === "magicRoom") return !!field.magicRoom && w.field.magicRoom && !w.fieldSet?.magicRoom;
  return !!field.terrain && w.field.terrain === field.terrain && !terrainResettable(kernel);
}

/** The terrains' own moves and Surge abilities (data/moves.ts electricterrain and its kin; data/abilities.ts electricsurge and its kin, hadronengine). */
const TERRAIN_MOVES: Readonly<Record<string, string>> = { Electric: "electricterrain", Grassy: "grassyterrain", Misty: "mistyterrain", Psychic: "psychicterrain" };
const TERRAIN_ABILITIES: Readonly<Record<string, readonly string[]>> = {
  Electric: ["electricsurge", "hadronengine"], Grassy: ["grassysurge"], Misty: ["mistysurge"], Psychic: ["psychicsurge"],
};
/** The moves that give a Pokémon another's ability mid-turn (its Start then runs: a Surge sets its terrain). */
const ABILITY_COPY_MOVES: ReadonlySet<string> = new Set(["skillswap", "roleplay", "entrainment", "doodle"]);
/** The abilities that take a fainted ally's ability (data/abilities.ts receiver, powerofalchemy) or a foe's (trace). */
const ABILITY_TAKERS: ReadonlySet<string> = new Set(["receiver", "powerofalchemy", "trace"]);

/** The moves that end a terrain (data/moves.ts steelroller, icespinner onAfterHit; defog in generation 8 on; gmaxwindrage; splinteredstormshards). */
const TERRAIN_CLEARERS: ReadonlySet<string> = new Set(["steelroller", "icespinner", "defog", "gmaxwindrage", "splinteredstormshards"]);

/**
 * Whether the terrain the input had could have been ended or replaced this turn and then set again (a terrain is new then,
 * with 5 turns: sim/field.ts setTerrain fails while the same terrain is up): a Pokémon of the turn able to set that terrain
 * (its terrain move, a Dynamax user's damaging move: a Max Move's terrain, Seed Sower for Grassy, one of its Surges given
 * by an ability move or taken by Receiver, Power of Alchemy or Trace) and one able to end or replace it first (a move that
 * ends terrains, any terrain move, a Max Move, Seed Sower, a Surge so given). The world keeps no record of a terrain set
 * this turn, so such a turn keeps the reason for that terrain's end (worldGuard).
 */
function terrainResettable(kernel: TurnKernel): boolean {
  const terrain = kernel.input.field.terrain;
  if (!terrain) return false;
  const entries = DOUBLES_SLOTS.map((slot) => kernel.input.pokemon[slot]).filter((entry): entry is NonNullable<typeof entry> => !!entry);
  const surges = (which: readonly string[]) => entries.some((entry) => which.includes(entry.build.abilityId));
  const copies = entries.some((entry) => (entry.action.moveId !== null && ABILITY_COPY_MOVES.has(entry.action.moveId)) || ABILITY_TAKERS.has(entry.build.abilityId));
  const maxMove = entries.some((entry) => !!entry.action.moveId && (entry.build.mechanic === "dynamax" || entry.build.mechanic === "gigantamax")
    && kernel.runtime.movesById.get(entry.action.moveId)?.category !== "Status");
  const sower = entries.some((entry) => entry.build.abilityId === "seedsower");
  const sets = maxMove || entries.some((entry) => entry.action.moveId === TERRAIN_MOVES[terrain]) || (terrain === "Grassy" && sower) || (copies && surges(TERRAIN_ABILITIES[terrain] ?? []));
  const ends = maxMove || sower || entries.some((entry) => !!entry.action.moveId && (TERRAIN_CLEARERS.has(entry.action.moveId) || Object.values(TERRAIN_MOVES).includes(entry.action.moveId)))
    || (copies && surges(Object.values(TERRAIN_ABILITIES).flat()));
  return sets && ends;
}

/**
 * Orders 27.2, 27.6, 27.7 (status2 E2): Gravity, Magic Room or the terrain from before the turn with one turn left ends
 * (fieldEnds; data/moves.ts gravity, magicroom, electricterrain and kin: onFieldResidualOrder 27, duration). Later
 * handlers read the field as it is now: grounded again for the Orbs under Misty Terrain (28.3), the items Magic Room
 * held back (collect's itemFreed: Sticky Barb, the Orbs, White Herb, Mirror Herb, Eject Pack, Micle, the final Update's
 * Berries and Mental Herb). A terrain's end goes through FC's end-of-turn field change (a field-settled holder).
 * End-of-turn facts "Gravity ends.", "Magic Room ends.", "{Terrain} Terrain ends." (as the weather's).
 */
function fieldEnd(p: Phase, w: World, which: "gravity" | "magicRoom" | "terrain", key: number[]): World[] {
  const { kernel } = p;
  if (!fieldEnds(kernel, w, which)) return [w];
  if (which === "gravity") {
    w.field = { ...w.field, gravity: false };
    p.facts.add(`${kernel.moveName("gravity")} ends.`);
  } else if (which === "magicRoom") {
    w.field = { ...w.field, magicRoom: false };
    p.facts.add(`${kernel.moveName("magicroom")} ends.`);
  } else {
    const before = fieldBefore(kernel, w);
    const terrain = w.field.terrain;
    w.field = { ...w.field, terrain: "" };
    p.facts.add(`${terrain} Terrain ends.`);
    fieldChangeHooks.eotField(kernel, w, before, eotSink(p, key));
  }
  return [w];
}

/**
 * After the residual (status2 E2, T2M §6.3's E+): a two-turn move charged last turn (vol.locked, from carried.charging)
 * whose release did not happen this turn ends hidden (data/conditions.ts twoturnmove, duration 2: its End removes the
 * move's own volatile; no order, so after every ordered handler). A release that happened left its hidden state at its
 * BeforeMove (H: doubles-hidden.ts beforeMove, release). No HP.
 */
function releaseEnds(w: World) {
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon?.vol.locked || mon.eot.hidden !== mon.vol.locked) continue;
    const { hidden: _hidden, ...eot } = mon.eot;
    void _hidden;
    mon.eot = eot;
  }
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

/**
 * Order 28.2: Speed Boost, +1 Speed while activeTurns is above 0 (data/abilities.ts speedboost): not on a Pokémon that
 * switched in this turn (DoublesPokemonInput.switchedIn: activeTurns 0 until the next turn starts, sim/battle.ts endTurn).
 */
function speedBoostHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  if (!alive(w, slot) || p.kernel.input.pokemon[slot]?.switchedIn) return [w];
  const was = { ...w.mons[slot]!.build.boosts };
  eotBoost(p.kernel, w, slot, { spe: 1 }, slot, { effect: null });
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

/**
 * A Pokémon's pinned lastItem as a 28.2 handler reads it (status2 §3.3 item history): the world's (an item it used or ate
 * this turn, the input's from an earlier turn, "" once Harvest restored it or Pickup took it), else the input's None (""),
 * else undefined: not known (DoublesPokemonInput.lastItem absent, Q4).
 */
function lastItemOf(kernel: TurnKernel, w: World, slot: DoublesSlotId): string | undefined {
  const mon = w.mons[slot]!;
  if (mon.lastItem !== undefined) return mon.lastItem;
  const given = kernel.input.pokemon[slot]?.lastItem;
  return given === null ? "" : given;
}

/**
 * Order 28.2: Harvest (data/abilities.ts harvest onResidual, F4 §4.2; C1–C4): its holder with HP and no item gets back its
 * lastItem when that is a Berry, for certain in sun or Harsh Sunshine (field.isWeather: Cloud Nine and Air Lock suppress it,
 * a Utility Umbrella does not), otherwise with 1/2; setItem, then lastItem "". A failed 1/2 keeps lastItem (E2). The final
 * Update eats the Berry when it is due. With no Berry this turn and the input's item from an earlier turn not given:
 * "Harvest needs {Name}'s item from an earlier turn." (the end of turn only).
 */
function harvestHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.itemId) return [w];
  const last = lastItemOf(kernel, w, slot);
  if (last === undefined) kernel.notEstimated(REASONS.needsLastItem(kernel.abilityName("harvest"), kernel.names[slot]));
  if (!last || !last.endsWith("berry")) return [w];
  const weather = kernel.effectiveWeather(w);
  const sun = weather === "Sun" || weather === "Harsh Sunshine";
  const restore = (x: World) => {
    const holder = x.mons[slot]!;
    holder.build = { ...holder.build, itemId: last };
    holder.lastItem = "";
    p.rec?.act(slot, kernel.abilityName("harvest"), undefined, x.mass, key, null, [`${kernel.abilityName("harvest")}: ${kernel.itemName(last)} back.`]);
    return x;
  };
  if (sun) {
    // It relies on the sun from before the turn still being up at 28.2 (its end at order 1 would make it 1/2).
    const lasting = lastingFact(kernel, w);
    if (lasting) p.turnFacts.add(lasting);
    return [restore(w)];
  }
  const kept = cloneWorld(w, w.mass / 2);
  w.mass /= 2;
  return [restore(w), kept];
}

/**
 * Order 28.2: Pickup (data/abilities.ts pickup onResidual, F4 §4.3; C5–C8, C19): its holder with no item takes the lastItem
 * of one of the other active Pokémon (isAdjacent: every other one in doubles, not a fainted one) whose item was used this
 * turn (usedItemThisTurn and lastItem: eaten or used in the moves or the residual, or earlier this turn before the first
 * move: DoublesPokemonInput.earlierThisTurn; not one taken: Knock Off, Thief, Bug Bite; not a popped Air Balloon), sampled
 * uniformly (one world each at 1/k); that lastItem is cleared, and the new item starts (receiveAtResidual).
 */
function pickupHandler(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || w.mons[slot]!.build.itemId) return [w];
  const others = DOUBLES_SLOTS.filter((other) => other !== slot && alive(w, other));
  // C19: a Pokémon holding nothing whose item from an earlier turn is given could have used it earlier this turn.
  for (const other of others) {
    const entry = kernel.input.pokemon[other], mon = w.mons[other]!;
    if (!mon.usedItem && !entry?.build.itemId && !mon.build.itemId && typeof entry?.lastItem === "string" && entry.lastItem && !entry.earlierThisTurn?.usedItem) p.turnFacts.add(`Assumes ${kernel.names[other]} used no item earlier this turn.`);
  }
  const candidates = others.filter((other) => w.mons[other]!.usedItem && w.mons[other]!.lastItem);
  if (!candidates.length) return [w];
  const share = w.mass / candidates.length;
  const worlds = candidates.map((_, index) => (index === 0 ? w : cloneWorld(w, share)));
  w.mass = share;
  return candidates.flatMap((other, index) => {
    const x = worlds[index];
    const item = x.mons[other]!.lastItem!;
    x.mons[other]!.lastItem = "";
    x.mons[slot]!.build = { ...x.mons[slot]!.build, itemId: item };
    p.rec?.act(slot, kernel.abilityName("pickup"), other, x.mass, key, null, [`${kernel.abilityName("pickup")}: picks up ${kernel.itemName(item)}.`]);
    return receiveAtResidual(p, x, slot, sub(p, key, 1));
  });
}

/** The Terrain Seeds and their terrains (data/items.ts electricseed and kin onStart: `field.isTerrain`) and the stat each raises. */
const SEEDS: Readonly<Record<string, { terrain: BattleConditions["terrain"]; stat: CombatStat }>> = {
  electricseed: { terrain: "Electric", stat: "def" }, grassyseed: { terrain: "Grassy", stat: "def" }, mistyseed: { terrain: "Misty", stat: "spd" }, psychicseed: { terrain: "Psychic", stat: "spd" },
};

/**
 * An item Pickup gave its holder as setItem starts it (sim/pokemon.ts setItem: singleEvent('Start'), skipped while it is
 * ignored: Klutz, Magic Room, Embargo): a Terrain Seed in its terrain and Room Service under Trick Room are used at once
 * (useItem: their boost, the item gone, item history, Unburden; CQ03c), White Herb with a lowered stage restores it. The
 * used item's AfterUseItem reaches a partner's Symbiosis (D's symbiosisReceived: not followed). Booster Energy for a
 * Protosynthesis or Quark Drive holder not yet boosted keeps today's narrow reason. A Berry or Mental Herb waits for the
 * final Update (updateSlot); the others change nothing this turn.
 */
function receiveAtResidual(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const build = mon.build, item = build.itemId;
  if (!kernel.itemWorks(w, build)) return [w];
  const seed = SEEDS[item];
  const consume = (changes: Partial<Record<CombatStat, number>> | null) => {
    guardHooks.symbiosisReceived(kernel, w, slot, () => true);
    const was = { ...mon.build.boosts };
    if (changes) eotBoost(kernel, w, slot, changes, slot, { effect: "item" });
    loseItem(kernel, w, slot);
    stageFacts(p, w, slot, kernel.itemName(item), undefined, was, key);
  };
  if (seed && w.field.terrain === seed.terrain) consume({ [seed.stat]: 1 });
  else if (item === "roomservice" && w.field.trickRoom) consume({ spe: -1 });
  else if (item === "boosterenergy" && (build.abilityId === "protosynthesis" || build.abilityId === "quarkdrive") && !build.abilityActive) {
    kernel.notEstimated(REASONS.received(kernel.itemName(item), kernel.names[slot]));
  } else if (item === "whiteherb" && (STATS.some((stat) => (build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0))) {
    guardHooks.symbiosisReceived(kernel, w, slot, () => true);
    return whiteHerb(p, w, slot, key);
  }
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
    // status2 E2: not when the input gives their turns left (fieldTurns: an end at 27 is then modelled).
    if (source === "self") {
      const { terrain, gravity } = w.field;
      const turns = kernel.input.fieldTurns ?? {};
      if (terrain && turns.terrain === undefined && terrain === kernel.input.field.terrain && can({ ...w, field: { ...w.field, terrain: "" } })) p.turnFacts.add(`Assumes the ${terrain} Terrain does not end this turn.`);
      if (gravity && turns.gravity === undefined && kernel.input.field.gravity && can({ ...w, field: { ...w.field, gravity: false } })) p.turnFacts.add("Assumes Gravity does not end this turn.");
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
  const name = p.kernel.itemName(item);
  // A Berry Harvest or Pickup gave back after it was eaten earlier in this end of turn: the same path's second eat.
  if (p.rec && !(ateMark(w, slot)?.item === item && p.rec.again(slot, name, w.mass, null, facts))) p.rec.act(slot, name, undefined, w.mass, key, null, facts);
  if (status && (item === "lumberry" || CURING_BERRIES[item]?.includes(status))) cureStatus(w, slot);
  if (item === "lumberry" || item === "persimberry") mon.vol = { ...mon.vol, confusion: undefined };
  loseItem(p.kernel, w, slot);
  markAte(p, w, slot, item, null);
  return [pouch(p, w, slot, key)];
}

/** Its item used up (no item; Unburden: data/abilities.ts unburden onAfterUseItem); status2: the item history (kernel.noteItemUse, a no-op unless kept). */
function loseItem(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  kernel.noteItemUse(w, slot, mon.build.itemId);
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
  if (item === "mentalherb") return mentalHerb(p, w, slot, key);
  // status2 E2: Booster Energy at an Update for a Protosynthesis or Quark Drive holder whose field is down (data/items.ts
  // boosterenergy onUpdate: the field ended in this end of turn, or Magic Room or Embargo let the item work again): FC's
  // itemsAfterField, as A3's room end calls it.
  if (item === "boosterenergy" && boosterDown(kernel, w, slot)) return fieldChangeHooks.itemsAfterField(kernel, w, slot, eotSink(p, key));
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
  const name = kernel.itemName(item), pouchName = kernel.abilityName("cheekpouch");
  const build = mon.build;
  // status2: a Berry Harvest or Pickup gave back after it was eaten earlier in this end of turn (ateMark): the second eat on
  // those paths (Recorder.again: the oracle sums an effect per path). The heals of this eat, for the mark it leaves.
  const mark = ateMark(w, slot)?.item === item ? ateMark(w, slot)! : null;
  const heals = new Set<number>();
  if (p.rec) {
    for (const [hp, mass] of marginal(w, slot)) {
      if (hp <= 0 || hp > berry.line) continue;
      const { heal, pouch: pouched } = berryHeals(berry, hp);
      heals.add(heal);
      const was = build.boosts;
      const stat = PINCH_STAT_BERRIES[item];
      const rise = stat ? Math.max(-6, Math.min(6, (was[stat] ?? 0) + (build.abilityId === "ripen" ? 2 : 1) * (build.abilityId === "contrary" ? -1 : 1) * (build.abilityId === "simple" ? 2 : 1))) - (was[stat] ?? 0) : 0;
      // Lansat's focusenergy (status2: settledFocusEnergy, through the kernel's ateBerry) only where none stands; Starf's
      // random stat is recorded per branch below.
      const focus = item === "lansatberry" && !build.focusEnergy && !build.settledFocusEnergy && !build.dragonCheer;
      const facts = rise ? [`${STAT_NAMES[stat!]} ${rise > 0 ? "+" : "−"}${Math.abs(rise)}.`] : focus ? ["Raises its critical-hit ratio."] : [];
      const change = heal && mark ? (mark.heal !== null ? { from: mark.heal, to: mark.heal + heal } : undefined) : null;
      const again = !!mark && change !== undefined && p.rec.again(slot, name, w.mass * mass, change, facts);
      if (!again) p.rec.act(slot, name, undefined, w.mass * mass, key, heal ? { delta: heal, ko: false } : null, facts, mark ? "again" : "");
      if (pouched) p.rec.act(slot, pouchName, undefined, w.mass * mass, [...key, 1], { delta: pouched, ko: false });
    }
  }
  const single = heals.size === 1 ? [...heals][0] : null;
  const heal = single === null ? null : mark ? (mark.heal === null ? null : mark.heal + single) : single || null;
  // status2 (F4 §4.13, §4.14): every Berry through the kernel's ateBerry: item history, Unburden, the pinch rise, a Figy
  // Berry's confusion, Lansat's settledFocusEnergy, and Starf's random stat as one world per stat below +6 (each walk; E2's
  // guard gone), whose rise reaches the copiers' ledger like any other.
  return mapHP(w, slot, (hp) => hp > 0 && hp <= berry.line ? { hp: eatBerry(berry, hp), tag: "ate" } : { hp, tag: "" }).flatMap(({ world, tag }) => {
    if (tag !== "ate") return [world];
    const was = { ...world.mons[slot]!.build.boosts };
    const worlds = kernel.ateBerry(world, slot, item);
    for (const x of worlds) markAte(p, x, slot, item, heal);
    if (p.rec && item === "starfberry") {
      for (const x of worlds) {
        for (const stat of STATS) {
          const by = (x.mons[slot]!.build.boosts[stat] ?? 0) - (was[stat] ?? 0);
          if (by) p.rec.fact(slot, name, `${STAT_NAMES[stat]} ${by > 0 ? "+" : "−"}${Math.abs(by)}.`, x.mass);
        }
      }
    }
    return worlds;
  });
}

/** The field as FC's re-settle reads it before an end-of-turn change (doubles-fieldchange.ts FieldBefore). */
function fieldBefore(kernel: TurnKernel, w: World): { weather: string; terrain: string; effective: string } {
  return { weather: w.field.weather, terrain: w.field.terrain, effective: kernel.effectiveWeather(w) };
}

/** The end of turn's fact sink for FC's re-settle (FieldSource): each fact on its Pokémon's residual line, named by the fact's lead ("Ice Face: …") or its ability. */
function eotSink(p: Phase, key: number[]) {
  return {
    fact: (w: World, slot: DoublesSlotId, text: string) => {
      const lead = text.indexOf(": ");
      p.rec?.act(slot, lead > 0 ? text.slice(0, lead) : p.kernel.abilityName(w.mons[slot]!.build.abilityId), undefined, w.mass, key, null, [text]);
    },
  };
}

/** A Protosynthesis or Quark Drive holder whose field is down (data/items.ts boosterenergy onUpdate: no sun, no Electric Terrain; doubles-field.ts boosterDown's rule). */
function boosterDown(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const ability = w.mons[slot]!.build.abilityId;
  if (ability === "protosynthesis") return kernel.effectiveWeather(w) !== "Sun";
  if (ability === "quarkdrive") return w.field.terrain !== "Electric";
  return false;
}

/**
 * Mental Herb at an Update of the end of turn (data/items.ts mentalherb onUpdate: attraction, Taunt, Encore, Torment, Disable,
 * Heal Block; Unnerve does not stop it): used, every one of them ends. It meets one there only once its item works again
 * (Embargo ending at 21) or as a new item (Pickup); in the moves the action's Update uses it at once (doubles-status.ts).
 */
function mentalHerb(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  const mon = w.mons[slot]!;
  const ending = [
    ...(mon.vol.attract ? ["attraction"] : []), ...(mon.vol.taunt ? ["Taunt"] : []), ...(mon.vol.encore ? ["Encore"] : []),
    ...(mon.vol.disabled ? ["Disable"] : []), ...(mon.eot.healBlock ? ["Heal Block"] : []),
  ];
  if (!ending.length) return [w];
  loseItem(kernel, w, slot);
  mon.vol = { ...mon.vol, attract: undefined, taunt: undefined, encore: undefined, disabled: undefined };
  mon.eot = { ...mon.eot, healBlock: undefined, healBlockLeft: undefined, tauntLeft: undefined, encoreLeft: undefined, disableLeft: undefined };
  const list = ending.length === 1 ? ending[0] : `${ending.slice(0, -1).join(", ")} and ${ending[ending.length - 1]}`;
  p.rec?.act(slot, kernel.itemName("mentalherb"), undefined, w.mass, key, null, [`Its ${list} end${ending.length === 1 ? "s" : ""}.`]);
  return [w];
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
  // A form change through setSpecies' resets (status2 withSpecies).
  mon.build = withSpecies(mon.build, form);
  p.rec?.act(slot, kernel.abilityName("hungerswitch"), undefined, w.mass, key, null, [`Becomes ${kernel.runtime.speciesById.get(form)!.name}.`]);
  return [w];
}

/**
 * Order 29: White Herb restores lowered stages (data/items.ts whiteherb onResidual: onStart reads every stage, accuracy and
 * evasion included, status2 M1) and is used up.
 */
function whiteHerb(p: Phase, w: World, slot: DoublesSlotId, key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const hidden = Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);
  if (mon.build.itemId !== "whiteherb" || !kernel.itemWorks(w, mon.build) || !(STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || hidden)) return [w];
  mon.build = { ...mon.build, boosts: Object.fromEntries(STATS.map((stat) => [stat, Math.max(0, mon.build.boosts[stat] ?? 0)])) as BattleBuild["boosts"] };
  if (hidden) mon.vol = { ...mon.vol, stages: Object.fromEntries(Object.entries(mon.vol.stages!).map(([stat, stage]) => [stat, Math.max(0, stage ?? 0)])) };
  loseItem(kernel, w, slot);
  p.rec?.act(slot, kernel.itemName("whiteherb"), undefined, w.mass, key, null, ["Restores its lowered stats."]);
  return [w];
}

/**
 * The end of turn's boost() events reach the copiers through D's ledger itself (doubles-guards.ts noteRise, called by every
 * applyBoosts: each living foe Opportunist or working Mirror Herb adds the positive parts to its pending copy, MonState.copy,
 * status2 C9), applied at 29 (copyHandler) or, after the final Update, carried into the next turn (E2 pendingCopy, A11).
 * World.boosted, the action's table for eventGuards, has no reader inside the end of turn and is not in discreteKey: it is
 * dropped after each handler group and the final Update, so no merge keeps a stale one.
 */
function clearLedger(w: World) {
  if (w.boosted) delete w.boosted;
}

/**
 * Order 29 (status2 C9, CR05, A9): Opportunist (subOrder 7) and Mirror Herb (8) apply the copy accumulated since their last
 * application (data/abilities.ts opportunist onResidual: this.boost(boosts, holder); data/items.ts mirrorherb onResidual:
 * useItem, whose onUse boosts while the item is still held, then the item is gone: item history, Unburden). The holder's
 * Contrary and Simple act on its own boost. The copy is no boost() event a foe's copier adds (onFoeAfterBoost skips effect
 * Opportunist / Mirror Herb): what the ledger added to the other Pokémon's pending copies during it is taken back. Residual
 * "Opportunist" / "Mirror Herb" with "copies +4 Attack." per stat.
 */
function copyHandler(p: Phase, w: World, slot: DoublesSlotId, by: "opportunist" | "mirrorherb", key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot)) return [w];
  const mon = w.mons[slot]!;
  const copy = mon.copy;
  if (!copy || copy.by !== by) return [w];
  if (by === "opportunist" ? mon.build.abilityId !== "opportunist" : mon.build.itemId !== "mirrorherb" || !kernel.itemWorks(w, mon.build)) return [w];
  const name = by === "opportunist" ? kernel.abilityName("opportunist") : kernel.itemName("mirrorherb");
  delete mon.copy;
  const pending = new Map(DOUBLES_SLOTS.filter((other) => other !== slot && w.mons[other]).map((other) => [other, w.mons[other]!.copy]));
  const changed = eotBoost(kernel, w, slot, copy.stages, slot, { effect: by === "opportunist" ? "ability" : "item", by: name });
  for (const [other, was] of pending) {
    if (was) w.mons[other]!.copy = was;
    else delete w.mons[other]!.copy;
  }
  if (by === "mirrorherb") loseItem(kernel, w, slot);
  const facts = (Object.entries(changed) as [Stage, number][]).filter(([, amount]) => amount).map(([stat, amount]) => `copies ${signed(amount)} ${STAGE_NAMES[stat]}.`);
  p.rec?.act(slot, name, undefined, w.mass, key, null, facts.length ? facts : ["Its stats cannot go higher."]);
  return [w];
}

/** Order 29: Eject Pack after a drop in the residual (data/items.ts ejectpack onAfterBoost, onResidual): it switches out after the turn. */
function ejectPack(p: Phase, w: World, slot: DoublesSlotId, was: BattleBuild["boosts"], key: number[]): World[] {
  const { kernel } = p;
  if (!alive(w, slot) || !canSwitch(kernel, slot)) return [w];
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== "ejectpack" || !kernel.itemWorks(w, mon.build) || !STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was[stat] ?? 0))) return [w];
  // status2 R-E: with the side's bench, onUseItem waits while a switchFlag of `true` stands (another Pack used at 29): marked,
  // it is used at the switch-in after the turn (doubles-switch.ts: onAnySwitchIn −4).
  if (kernel.baseInput.bench?.[slotSide(slot)] && switchHooks.flagStanding(w)) { mon.ejectMarked = true; return [w]; }
  loseItem(kernel, w, slot);
  p.rec?.act(slot, kernel.itemName("ejectpack"), undefined, w.mass, key, null, ["Switches out after the turn."]);
  // The residual's switch-out (R's doubles-switch.ts: after the turn, with the side's bench; else nothing follows it).
  switchHooks.switchOut(kernel, w, slot, "residual", null);
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
    loseItem(kernel, world, slot);
    return pouch(p, world, slot, key);
  });
}

/**
 * After the final Update: Emergency Exit and Wimp Out for a Pokémon above half HP at the residual's start and at half or
 * below now (sim/battle.ts:2860-2866), as facts; the guards for what the residual changed that the turn does not follow
 * (Symbiosis after an item used up: D's guard; the copies are applied at 29 and pending after the final Update).
 */
function afterChecks(p: Phase, w: World, startItems: Map<DoublesSlotId, string>, above: Set<DoublesSlotId>) {
  const { kernel } = p;
  roomFact(p, w);
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    // Symbiosis after an item used up (D's doubles-guards.ts, moved verbatim). The copies of a rise are modelled (status2 C9:
    // copyHandler at 29; a rise at the final Update stays pending), so D's copierEndOfTurn has no caller here.
    guardHooks.symbiosisEndOfTurn(kernel, w, slot, startItems.get(slot));
    // status2 R-E: with the side's bench, Emergency Exit and Wimp Out switch out after the turn where the HP is at most half
    // (doubles-switch.ts afterTurn splits the world there).
    if (above.has(slot) && alive(w, slot) && kernel.baseInput.bench?.[slotSide(slot)]) switchHooks.switchOut(kernel, w, slot, "exit", null);
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
 * room going on. A Magic Room set this turn lasts 5 turns (status2: World.fieldSet, also after the one from before ended).
 */
function roomFact(p: Phase, w: World) {
  const { kernel } = p;
  // status2 E2: with its turns left given (fieldTurns), its end at 27.6 is modelled (fieldEnd).
  if (!kernel.input.field.magicRoom || !w.field.magicRoom || w.fieldSet?.magicRoom || kernel.input.fieldTurns?.magicRoom !== undefined) return;
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
  if (item === "whiteherb") return STATS.some((stat) => (build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);
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

// The residual's field-change guard (fieldChangeGuard) moved to FC's doubles-fieldchange.ts (changed, through eotField).

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
  if (info.isMax && outcome.landed + outcome.subHits > 0) gmaxAfterHit(kernel, w, action.slot, info);
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
        if (receiver.build.itemId === "mentalherb" && kernel.itemWorks(w, receiver.build)) loseItem(kernel, w, target);
        // The hit's Update comes after its secondaries (sim/battle-actions.ts hitStepMoveHitLoop: spreadMoveHit, then
        // eachEvent('Update')), so Heal Block stops an HP Berry there (data/items.ts onTryEatItem TryHeal): the step kept
        // it (doubles-turn.ts psychicNoiseKeepsBerry). status2 (C3): its duration, 2 for Psychic Noise (data/moves.ts healblock
        // durationCallback), counts down at this end of turn's order 20.
        else receiver.eot = { ...receiver.eot, healBlock: true, healBlockLeft: 2 };
      }
    }
    if (outcome.target.smackedDown && !receiver.eot.smackedDown) receiver.eot = { ...receiver.eot, smackedDown: true };
  }
  if (outcome.landed + outcome.subHits <= 0 || sheerForce) return;
  if ((id === "rapidspin" || id === "mortalspin") && hasHP(w, attacker)) {
    if (user.eot.leechSeed) user.eot = { ...user.eot, leechSeed: undefined };
    endTrap(w, attacker);
    const side = slotSide(attacker);
    // status2 Step 1 #7 (SPEC2 §3.3): the hazards from before the turn are cleared too (SideState.hazardsFrom null: E2's
    // DoublesOutcome.sides.hazardsFrom, which Training's nextClock reads; PS/data/moves.ts rapidspin, mortalspin onAfterHit).
    w.sides[side] = { ...w.sides[side], hazards: [], hazardsFrom: null };
  }
  // foeSidesWithConditions: the user's foes' side, whichever Pokémon it hit; on a Substitute only while the user has HP.
  if ((id === "ceaselessedge" || id === "stoneaxe") && (outcome.landed > 0 || someHP(w, attacker, (hp) => hp > 0))) {
    const side = slotSide(attacker) === "own" ? "opponent" : "own";
    const hazard = id === "ceaselessedge" ? "spikes" : "stealthrock";
    // status2 R: a hazard up already, or at its layers, does not go up again (R's doubles-switch.ts hazardFails; Step 2: none).
    if (!switchHooks.hazardFails(kernel, w, side, hazard)) w.sides[side] = { ...w.sides[side], hazards: [...w.sides[side].hazards, hazard] };
  }
}

/**
 * status2 E2 (T2E §4.4.2): a G-Max move's self.onHit once it hit (a Substitute's or a protection's quarter included; set
 * though the target fainted: GX01-GX03): Vine Lash, Wildfire, Cannonade and Volcalith set their 4-turn side condition on
 * the user's foes' side (SideState.gmax: its 5.1 damage this turn included); Centiferno and Sandblast trap every foe in
 * with HP not already trapped (Binding Band: 1/6), a trap that outlives its user (EotState.trap.gmax).
 */
function gmaxAfterHit(kernel: TurnKernel, w: World, attacker: DoublesSlotId, info: TurnMoveInfo) {
  const id = info.effective.id;
  const foeSide: DoublesSideId = slotSide(attacker) === "own" ? "opponent" : "own";
  if (GMAX_SIDE.has(id)) {
    const side = w.sides[foeSide];
    if (!side.gmax?.includes(id)) w.sides[foeSide] = { ...side, gmax: [...(side.gmax ?? []), id] };
    return;
  }
  if (!GMAX_TRAPS.has(id)) return;
  const user = w.mons[attacker]!.build;
  const band = user.itemId === "bindingband" && kernel.itemWorks(w, user);
  for (const foe of foesOf(attacker)) {
    const mon = w.mons[foe];
    if (!mon || !hasHP(w, foe) || mon.eot.trap) continue;
    const trap: TrapState = { source: attacker, divisor: band ? 6 : 8, move: id, gmax: true };
    mon.eot = { ...mon.eot, trap };
  }
}

/**
 * A charge turn's user (doubles-turn.ts chargeTurn): eot.hidden, the hidden move's id (status2 C20; Dig and Dive shelter
 * it: doubles-world.ts sheltered; Fly, Bounce, Phantom Force, Shadow Force leave it semi-invulnerable).
 */
export function charging(w: World, slot: DoublesSlotId, move: ChampionsMove) {
  if (!SEMI_INVULNERABLE_MOVES.has(move.id)) return;
  const mon = w.mons[slot]!;
  mon.eot = { ...mon.eot, hidden: move.id as NonNullable<EotState["hidden"]> };
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
  // status2: Nightmare, Octolock, Telekinesis and Embargo are A2's condition facts (doubles-typing.ts conditions; integration 1a).
  if (eot.yawn && (done ? eot.yawn === 1 : true)) out.push("Drowsy.");
  if (eot.perish) out.push(`Perish count ${done ? eot.perish : Math.min(3, eot.perish)}.`);
  // A copy still pending after the final Update (status2 A11): applied at the next turn's first AfterMove.
  if (done && mon.copy) {
    const name = mon.copy.by === "opportunist" ? kernel.abilityName("opportunist") : kernel.itemName("mirrorherb");
    const parts = (Object.entries(mon.copy.stages) as [Stage, number][]).filter(([, amount]) => amount > 0).map(([stat, amount]) => `${signed(amount)} ${STAGE_NAMES[stat]}`);
    if (parts.length) out.push(`${name}: copies ${parts.join(", ")} next turn.`);
  }
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
  // status2 integration 1b (CL's ask): Uproar's volatile while it stands (vol.uproar: the turns left after this turn, which
  // uproarHandler ends at 0 or under Throat Chop at 28.1).
  if (mon.vol.uproar !== undefined) volatiles.push("uproar");
  // status2: nightmare, octolock, telekinesis and embargo are A2's (doubles-typing.ts outcomeVolatiles: nightmare while asleep,
  // octolock while its source is in; integration 1a); turns left in DoublesOutcomeMon.turnsLeft.
  // After the turn a Yawn from this turn has counted down to 1 (drowsy next turn); after the moves, a Yawn landed this turn is still to come.
  if (done ? eot.yawn === 1 : eot.yawn === 2) volatiles.push("yawn");
  const perish = eot.perish ? (done ? eot.perish : eot.perish - 1) : 0;
  if (perish > 0) volatiles.push("perishsong");
  return { ...(volatiles.length ? { volatiles } : {}), ...(perish > 0 ? { perishCount: perish } : {}) };
}
