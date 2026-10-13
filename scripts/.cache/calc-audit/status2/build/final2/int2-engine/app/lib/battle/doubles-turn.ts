import {
  calculateTurnMove, GAS_PROOF_ABILITIES, GAS_STAND_IN, matchupRows, partnerAbilitySuppressor, resolveTurnMove, turnHP, turnPriority, turnProtectOutcome, turnSpeed, usesHelpers,
  type DoublesGas, type DoublesSettle, type MatchupResult, type SettledMatchup, type TurnMove,
} from "./calculate";
import {
  ABILITY_REPLACERS, ABSORBING, ANCHORING_ABILITIES, BUSTED_FORMS, RESIST_BERRIES, CHARGE_TURN_MOVES, DAMP_MOVES, DANCE_MOVES, DRAG_MOVES,
  FUTURE_MOVES, IGNORE_ABILITY_MOVES, KO_BOOSTS, MOLD_BREAKERS, SELF_COST_MOVES, SELF_DESTRUCT_MOVES,
  PROTECT_CONTACT, PROTECT_MOVES, REASONS, REDIRECT_ABILITIES,
  SEMI_INVULNERABLE_MOVES, STRONG_WEATHERS, SWITCH_MOVES, TRACKING_ABILITIES, TRACKS_TARGET_MOVES,
} from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, sideCanSwitch, slotSide, startId, turnBenchNames, turnNames, type DoublesFact, type DoublesReplaced, type DoublesHit, type DoublesHP, type DoublesSideId,
  type DoublesSlotId, type DoublesStart, type DoublesStartRow, type DoublesStep, type DoublesTurnInput, type DoublesTurnResult,
  type DoublesOutcome, type DoublesOutcomeMon, type DoublesOutcomesResult, type DoublesEndOfTurn,
} from "./doubles-types";
import {
  cloneWorld, condition, digitAt, entryCount, join, mapHP, marginal, mergeWorlds, occupant, pointFactor, positionOf, radixPow, splitFactor,
  type EotState, type Factor, type MonState, type MoveVolatiles, type PendingAction, type SideState, type Stage, type World,
} from "./doubles-world";
import * as statusNs from "./doubles-status";
import * as eotNs from "./doubles-eot";
import * as positionNs from "./doubles-positions";
import * as itemNs from "./doubles-items";
import * as substituteNs from "./doubles-substitute";
// status2 Step 0a hook modules (SPEC2 §3.5, ADDENDUM2 §3.5; scripts/.cache/calc-audit/status2/build/STEP0A.md has the map).
import * as abilityNs from "./doubles-abilities";
import * as callingNs from "./doubles-calling";
import * as faceNs from "./doubles-faces";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as guardNs from "./doubles-guards";
import * as hiddenNs from "./doubles-hidden";
import * as historyNs from "./doubles-history";
import * as maxNs from "./doubles-max";
import * as pairNs from "./doubles-pairs";
import * as presenceNs from "./doubles-presence";
import * as reactionNs from "./doubles-reactions";
import * as spreadNs from "./doubles-spread";
import * as stageNs from "./doubles-stages";
import * as switchNs from "./doubles-switch";
import * as typingNs from "./doubles-typing";
import * as startNs from "./doubles-start";
import { settleDoublesStart } from "./doubles-start";
import type { Use } from "./doubles-use";
import { getBerryResistType } from "@smogon/calc/dist/items";
import {
  berryArithmetic, berryHeals, BERRY_STEALERS, BERSERK_BERRIES, CANT_SUPPRESS, eatBerry, HEALING_BERRIES, KLUTZ_IGNORED_ITEMS, LANSAT_STARF, ownMoveId, PINCH_STAT_BERRIES, stolenEat, UNNERVES,
  type Berry, type TurnUnnerve,
} from "./hit-loop";
import { isMaxActive } from "./mechanics";
import { getBuildStats, PRIORITY_SHIELD_ABILITIES, validateBuild, validateConditions } from "./model";
import type { BattleRuntime } from "./runtime";
import { accuracyDrop, MAX_MOVE_EFFECTS, statMove } from "./stat-moves";
import { healFlag, type StatusStages } from "./status-table";
import type { BattleBuild, BattleConditions, BattleGame, BuildIssue, ChampionsMove, CombatStat, MoveContext, MoveDamageResult } from "./types";
import { doublesNoFoeLeft, doublesTargetRule } from "./doubles-targets";
import {
  buildAt, createTurnSearch, prepareUses, uncertain, USES_REFERENCE, type CalcTrace, type Mode, type TurnSide, type TurnStepEntry, type TurnStepOutcome, type TurnStepPart, type UsesEnv, type UsesSearch,
} from "./uses-to-ko";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const statusHooks = { ...statusNs };
const eotHooks = { ...eotNs };
const positionHooks = { ...positionNs };
const itemHooks = { ...itemNs };
const substituteHooks = { ...substituteNs };
const abilityHooks = { ...abilityNs };
const callingHooks = { ...callingNs };
const faceHooks = { ...faceNs };
const fieldChangeHooks = { ...fieldChangeNs };
const guardHooks = { ...guardNs };
const hiddenHooks = { ...hiddenNs };
const historyHooks = { ...historyNs };
const maxHooks = { ...maxNs };
const pairHooks = { ...pairNs };
const presenceHooks = { ...presenceNs };
const reactionHooks = { ...reactionNs };
const spreadHooks = { ...spreadNs };
const stageHooks = { ...stageNs };
const switchHooks = { ...switchNs };
const typingHooks = { ...typingNs };
const startHooks = { ...startNs };

// The 2v2 tab's turn (SPEC §4): every queued action in pinned Showdown c23d2e94's order, each random event branched
// exactly, each damaging hit one pairwise use (uses-to-ko.ts turnStep) with the target's state carried. A result is
// exact or the turn is not estimated with a fact reason (SPEC §2.2). Extension points for the rest of §2.2's "In" list:
// statusMove (Tailwind, Trick Room, Gravity, weather, terrain, screens), afterMove (Moxie and the other faint reactions,
// the Explosion family), contextFor, presenceGuards (each guard removed where a mechanic is modelled).
//
// Status moves and end of turn (scripts/.cache/calc-audit/status-eot/design SPEC.md §3.5, ADDENDUM.md §3.5): this file
// is the kernel. It hands a TurnKernel (closures over one walk's Ctx) to the hook modules, which own the mechanics:
// doubles-status.ts (Track A: BeforeMove, status moves), doubles-eot.ts (Track B: the end of turn), doubles-positions.ts,
// doubles-items.ts and doubles-substitute.ts (Track E: Ally Switch, Trick, hits into a Substitute). The hook points are
// listed in scripts/.cache/calc-audit/status-eot/build/STEP0.md; after Step 0 only the integrator edits this file.
// status2 (scripts/.cache/calc-audit/status2/design SPEC2.md §3.5, ADDENDUM2.md §3.5; build/STEP0A.md): today's guards and
// helpers moved into their owners' hook modules (doubles-stages.ts, doubles-abilities.ts, doubles-typing.ts, doubles-field.ts,
// doubles-fieldchange.ts, doubles-guards.ts, doubles-spread.ts, doubles-hidden.ts, doubles-reactions.ts, doubles-pairs.ts,
// doubles-faces.ts, doubles-max.ts, doubles-presence.ts, doubles-calling.ts, doubles-history.ts, doubles-switch.ts), each
// called where the code stood; the kernel plumbing for the new state reads only fields nothing sets yet.

/** Test-only (SPEC §8.3): no factor splitting, no mixture merges, no memoised searches; with USES_REFERENCE, no shared calculations. */
export const DOUBLES_REFERENCE = { on: false };

/** Count budgets (SPEC §9): exceeding one is "Too many cases to follow.", never a wrong number. */
const BUDGET = { worlds: 1_500, entries: 200_000, calculations: 160 };

class NotEstimated extends Error {
  constructor(readonly reason: string) { super(reason); }
}
function notEstimated(reason: string): never {
  throw new NotEstimated(reason);
}

const STAT_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
const WEATHER_NEGATORS = new Set(["cloudnine", "airlock"]);
const FIELD_SETTLED_ABILITIES = new Set(["forecast", "mimicry", "protosynthesis", "quarkdrive", "flowergift", "iceface"]);
const FIELD_SETTLED_ITEMS = new Set(["electricseed", "grassyseed", "psychicseed", "mistyseed", "boosterenergy"]);
const FIRST_TURN_MOVES = new Set(["fakeout", "firstimpression"]);
const FLINCH_MOVES = new Set(["fakeout", "upperhand"]);
const TARGET_ATTACK_MOVES = new Set(["suckerpunch", "thunderclap"]);
const SPREAD_TARGETS = new Set(["allAdjacent", "allAdjacentFoes"]);
const SCREEN_BREAKERS = new Set(["brickbreak", "psychicfangs", "ragingbull"]);
/** status2: the moves whose damage a hidden defender doubles (takenMods.hidden: Fly's, Bounce's and Sky Drop's Gust and Twister; Dig's Earthquake and Magnitude; Dive's Surf and Whirlpool). */
const HIDDEN_MARKS: Partial<Record<NonNullable<EotState["hidden"]>, NonNullable<NonNullable<BattleBuild["takenMods"]>["hidden"]>>> = {
  fly: "fly", bounce: "bounce", dig: "dig", dive: "dive", skydrop: "skydrop",
};

/** One target's statistics over a step (the "all" walk): DoublesHit is assembled from it. */
export type HitStats = {
  reached: number; ko: number; calculated: number; blocked: number; noDamage: number;
  /** Mass in which a status move reached it and acted (DoublesHit kind "effect"; Track A). */
  effect: number;
  /** The least and the most HP a status move changed on it (DoublesHit.change; Track A), or null. */
  change: { min: number; max: number } | null;
  /** Hits that met its Substitute (kernel.subStat; DoublesHit.substitute): their mass, the mass in which it broke, the HP it lost. */
  sub: { mass: number; breaks: number; min: number; max: number };
  /** The calculations met, by their damage (rolls, hits and power), and each step's first calculation, by its row. */
  met: Map<string, { row: MoveDamageResult; mass: number }>; firsts: Map<string, { row: MoveDamageResult; mass: number }>;
  facts: Map<string, number>;
};
/** One action's statistics over the turn (the "all" walk): DoublesStep is assembled from it. */
export type StepStats = {
  slot: DoublesSlotId; moveId: string; order: Map<number, number>; moves: number; positionSum: number; positionMass: number;
  skipped: Map<string, number>; facts: Map<string, number>; hits: Map<DoublesSlotId, HitStats>; effectiveName?: string; effectiveType?: string;
  /** status2 (kernel.extraStep): a second step of the same Pokémon this turn, a Dancer's copy or an instructed move. */
  copied?: "Dancer" | "Instruct";
  /** status2 PR: the index of the action a copy copies (one step per source: two dances copied by one Dancer are two steps). */
  from?: number;
  /** status2 R: a copy by a Pokémon that is not the slot's starting Pokémon (DoublesStep.id: a newcomer's Dancer copy). */
  id?: string;
  /** status2 R-E: the hits on a Pokémon that came in during the turn, by `{slot}|{id}` (DoublesHit.id). Absent: none. */
  entered?: Map<string, HitStats & { slot: DoublesSlotId; id: string }>;
  /** status2 R-E: every hit entry's key in the step's hit order (a slot, or `{slot}|{id}`), once an entered one exists. */
  keys?: string[];
};
/** One pair's calculation and its turn search (searchFor). */
export type SearchEntry = { row: MoveDamageResult; search: UsesSearch | null; follow: boolean; trace?: CalcTrace };
/** The move a Pokémon uses this turn, resolved (calculate.ts resolveTurnMove's "move" kind). */
export type TurnMoveInfo = Extract<TurnMove, { kind: "move" }>;
/** One child world of a pair's step (applyStep): its hits on the target (`landed`) and whether the target was knocked out. */
export type StepChild = { world: World; landed: number; knocked: boolean };
type Memo = {
  searches: Map<string, SearchEntry>; priorities: Map<string, number | { reason: string }>; speeds: Map<string, number>;
  moves: Map<string, TurnMove>; rows: Map<string, MoveDamageResult>; calculations: number;
};
type Ctx = {
  /**
   * The input the hook modules read (kernel.input). status2 R-E: the view of the Pokémon standing in the world the walk is at
   * (syncOccupants): a newcomer's slot holds its bench entry (switchedIn, no action), so a read by slot names the occupant.
   */
  input: DoublesTurnInput; runtime: BattleRuntime; gen7: boolean; champions: boolean;
  /** status2 R-E: the turn's input as given (ctx.input is the occupants' view of it). */
  baseInput: DoublesTurnInput;
  /** status2 R-E: the input views made so far, by their occupants' signature (each made once, so the caches keyed by input hit). */
  views: Map<string, DoublesTurnInput>;
  /**
   * status2 R-E: each slot's occupant in the world the walk is at where it is not the slot's starting Pokémon: its id (a bench id,
   * or another slot's startId). The statistics of hits, heals, losses and faints are kept apart by it.
   */
  occupants: Partial<Record<DoublesSlotId, string>>;
  /** status2 R-E: the action the walk is executing (its step takes the switch facts), or null. */
  acting: PendingAction | null;
  /** The names of the Pokémon at the four slots (turnNames; status2 R: a newcomer's while the walk is at a world it stands in: syncOccupants). */
  names: Record<DoublesSlotId, string>;
  /** status2 R: the bench Pokémon's names by id (turnBenchNames; empty without a bench). */
  benchNames: Record<string, string>;
  /** status2 R: the slots' starting Pokémon's names and HP (turnNames, the settle's turnHP), which syncOccupants puts back. */
  startNames: Readonly<Record<DoublesSlotId, string>>;
  startHP: Readonly<Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>>;
  /** status2 R: names and hp hold a newcomer's now (syncOccupants). */
  renamed: boolean;
  /** Each slot's engine maximum HP and base maximum HP (status2 R: a newcomer's while the walk is at a world it stands in: syncOccupants). */
  hp: Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>;
  actions: { slot: DoublesSlotId; moveId: string | null; target: DoublesSlotId | null }[];
  mode: Mode; memo: Memo;
  /** The "all" walk's statistics (null in the roll walks). */
  stats: StepStats[] | null;
  /** By slot (status2 R-E: by statKey, a newcomer's apart from the slot's starting Pokémon). */
  heals: Map<string, Map<string, [number, number]>>;
  faintsBefore: Map<DoublesSlotId, number>;
  /** Slots that faint on some branch other than by a hit a step counts (hitStats.ko): their own move, a fixed loss (status2 R-E: by statKey). */
  otherFaints: Set<string>;
  /** Slots whose move can reach only foes while both foe slots are empty (doublesNoFoeLeft): queued, but no step. */
  targetless: Set<DoublesSlotId>;
  /**
   * Neutralizing Gas on the field from the turn's start (calculate.ts DoublesGas), or null. status2 R-E: the view of the world's
   * occupants (syncOccupants: a newcomer under the gas stands in its slot's entries; a slot whose Pokémon left, not).
   */
  gas: DoublesGas | null;
  /** status2 R-E: the gas as the turn started (settle.gas). */
  baseGas: DoublesGas | null;
  /** status2 R-E: the gas views made so far, by their occupants' signature. */
  gasViews: Map<string, DoublesGas | null>;
  /** The "all" walk: HP lost outside any step (kernel.lossFact; DoublesHP.losses), by slot (status2 R-E: by statKey) and text. */
  losses: Map<string, Map<string, number>>;
  /** The "all" walk: turn facts found during the walk (kernel.turnFact), in first-found order. */
  walkFacts: Set<string>;
  /** The hook modules' view of this context (kernelOf). */
  kernel?: TurnKernel;
  /** The "all" walk met a certain critical hit (applyStep): the turn's hit rule says so. */
  certainCrit?: true;
  // ---- status2 (SPEC2 §3.5, §4.9's readers rule; ADDENDUM2 §3.5) ----
  /** The turn keeps item history (doubles-guards.ts tracksItems): MonState.lastItem and usedItem are written. */
  tracksItems: boolean;
  /** A tie the entry order decides can happen (two possible redirectors of one move, two Dancers, a Download holder): MonState.entry is written. */
  entryReaders: boolean;
  /** World.didSomething and lastSuccessful (a Dancer copying a dance move, a Fusion user), World.lastMove (a Copycat user) have a reader. */
  historyReaders: { didSomething: boolean; lastMove: boolean };
  /** True while endOfTurnOf runs. */
  inEndOfTurn: boolean;
};

/**
 * The turn's kernel (status-eot SPEC §3.5, ADDENDUM §3.5): closures over one walk's private context. The hook modules
 * (doubles-status.ts, doubles-eot.ts, doubles-positions.ts, doubles-items.ts, doubles-substitute.ts) receive it and import
 * only this type. Every helper is the one this file uses itself, so a hook reads and changes the world as the turn does.
 */
export type TurnKernel = {
  // ---- Context ----
  readonly input: DoublesTurnInput;
  readonly runtime: BattleRuntime;
  /**
   * turnNames: a species name, with " (yours)" / " (opponent's)" across sides and " (1)" / " (2)" within one (doublesNames); the
   * input's names name a fainted Pokémon as its card does, else "" for an empty slot. status2 R: the Pokémon standing in the
   * slot in the world the walk is at (a newcomer's from benchNames: syncOccupants), so a hook's text names the occupant.
   */
  readonly names: Record<DoublesSlotId, string>;
  /** status2 R: the bench Pokémon's names by id (turnBenchNames: after the four slots', each side's bench in order); empty without a bench. */
  readonly benchNames: Readonly<Record<string, string>>;
  /** status2 R: the names of the Pokémon that started the turn in each slot (turnNames), whoever stands there now (`names` follows the occupant). */
  readonly startNames: Readonly<Record<DoublesSlotId, string>>;
  /** status2 R: the name of the Pokémon at mons[slot] in `w`: names[slot] for the slot's starting Pokémon, a newcomer's from benchNames (MonState.id). */
  nameOf(w: World, slot: DoublesSlotId): string;
  /** status2 R-E: the turn's input as given (`input` is the view of the occupants of the world the walk is at). */
  readonly baseInput: DoublesTurnInput;
  /** status2 R-E: the action the walk is executing (its step takes the switch facts), or null. */
  readonly acting: PendingAction | null;
  /** status2 R-E: names, hp and the input view follow `w`'s occupants (null: the slots' starting Pokémon); doubles-switch.ts and doubles-eot.ts call it per world. */
  occupy(w: World | null): void;
  /** status2 R-E: the slots' starting Pokémon's engine and base maximum HP (the settle's: `hp` follows the occupant). */
  readonly startHP: Readonly<Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>>;
  /** status2 R-E: one queued action run now, as the walk runs it (execute: its BeforeMove, its move; Pursuit at a switch-out's BeforeSwitchOut). */
  runAction(w: World, action: PendingAction): World[];
  /** Each slot's engine maximum HP (Dynamax HP while Dynamaxed) and base maximum HP (status2 R: the occupant's, as `names`). */
  readonly hp: Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>;
  readonly gen7: boolean;
  readonly champions: boolean;
  /** "all": every outcome; "lowest" / "highest": the roll walks. */
  readonly mode: Mode;
  /** DOUBLES_REFERENCE.on: no factor splits, no mixture merges, no memoised searches (tie shortcuts off). */
  readonly reference: boolean;
  /** This walk records the turn's statistics (calculateDoublesTurn's "all" walk): steps, hits, losses, turn facts. */
  readonly recording: boolean;
  /** Neutralizing Gas on the field from the turn's start (calculate.ts DoublesGas), or null. */
  readonly gas: DoublesGas | null;
  /** The count budgets (SPEC §9): over one is REASONS.tooMany. */
  readonly budget: Readonly<{ worlds: number; entries: number; calculations: number }>;
  /** The abilities and items a weather or terrain change would change (searchFor's fieldSettled, fieldGuard). */
  readonly fieldSettledAbilities: ReadonlySet<string>;
  readonly fieldSettledItems: ReadonlySet<string>;
  /** The slot's move has no target because both foe slots are empty (doublesNoFoeLeft). */
  targetless(slot: DoublesSlotId): boolean;
  moveName(id: string): string;
  abilityName(id: string): string;
  itemName(id: string): string;
  // ---- World state ----
  alive(w: World, slot: DoublesSlotId): boolean;
  isFoe(a: DoublesSlotId, b: DoublesSlotId): boolean;
  /** A Pokémon fainting (faint count, Soul-Heart, a strong weather ending, gas, Receiver guard); `byHit`: a hit a step counts. */
  faint(w: World, slot: DoublesSlotId, byHit?: boolean): void;
  /** Its Speed in this world as the turn sorts it (Trick Room, Tailwind, paralysis, stages, items; memoised). */
  speedOf(w: World, slot: DoublesSlotId): number;
  /** A build's types (a Terastallized one's Tera Type but Stellar). */
  typesOf(build: BattleBuild): readonly string[];
  /** sim/pokemon.ts isGrounded: Gravity, Ingrain, Smack Down, Iron Ball; then not Flying (unless Roosted), Levitate, Magnet Rise, Air Balloon. */
  grounded(w: World, slot: DoublesSlotId): boolean;
  itemWorks(w: World, build: BattleBuild): boolean;
  /** The field's weather as effectiveWeather reads it (none while a living Cloud Nine or Air Lock holder suppresses it). */
  effectiveWeather(w: World): BattleConditions["weather"];
  /** A living Pokémon still has a damaging move queued. */
  laterDamaging(w: World): boolean;
  /** A living Pokémon still has an action queued. */
  laterAction(w: World): boolean;
  occupant(w: World, position: DoublesSlotId): DoublesSlotId;
  positionOf(w: World, slot: DoublesSlotId): DoublesSlotId;
  /** Powder immunity (Grass, Overcoat, Safety Goggles). */
  powderImmune(w: World, slot: DoublesSlotId): boolean;
  /** Neutralizing Gas ending with `slot` (not estimated while a Pokémon it suppressed is still in). */
  gasEnds(w: World, slot: DoublesSlotId): void;
  /** Whether a Pokémon with Unburden-free Berries is stopped from eating (a living foe's Unnerve or As One). */
  berryStopped(w: World, slot: DoublesSlotId): boolean;
  // ---- Moves ----
  breaks(w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): boolean;
  /** The integer priority an action is used with in this world (no fractional part). */
  priorityOf(w: World, action: PendingAction): number;
  /** The move `slot` uses (Z-Move and Max Move conversion), memoised. */
  moveInfo(w: World, slot: DoublesSlotId, moveId: string, context: MoveContext | undefined): TurnMove;
  /** The type the move has used against `target` (after ModifyType). */
  usedType(w: World, attacker: DoublesSlotId, moveId: string, target: DoublesSlotId, info: TurnMoveInfo, context: MoveContext | undefined): string;
  /** The dex target type the move is used with in this world (a Z-Move's own, a Max Move's, Expanding Force's spread). */
  usedTargetType(w: World, attacker: DoublesSlotId, move: ChampionsMove, info: TurnMoveInfo): string;
  /** The targets a move reaches in this world, with the worlds a random target splits into (positions included). */
  resolveTargets(w: World, action: PendingAction, info: TurnMoveInfo, type?: string): Resolution[];
  /** The redirection that takes the move (a tie between two holders is not estimated), or null. */
  redirect(w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo, moveId: string, context: MoveContext | undefined, type?: string): Redirection | null;
  /** Spread targets in Showdown's order: the adjacent ally first, then the foes by position. */
  spreadTargets(w: World, attacker: DoublesSlotId, targetType: string): DoublesSlotId[];
  /** Snipe Shot, Stalwart and Propeller Tail keep the chosen target. */
  tracksTarget(w: World, attacker: DoublesSlotId, move: ChampionsMove, info: TurnMoveInfo): boolean;
  /** Whether the move passes `target`'s protection (calculate.ts turnProtectOutcome not "blocked"). */
  protectPasses(w: World, action: PendingAction, target: DoublesSlotId): boolean;
  /** TryMove and Try (moveFailure: Sucker Punch, Upper Hand, Damp, the priority shields), or null. */
  moveFailure(w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info?: TurnMoveInfo): string | null;
  /** Queenly Majesty, Dazzling and Armor Tail of `target` or its partner against a foe's priority move (C6), or null. */
  priorityShield(w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string | null;
  /** TryHit for each target of a damaging move (Wide Guard, Quick Guard, protection, Telepathy, the absorbing abilities). */
  hitChecks(w: World, action: PendingAction, info: TurnMoveInfo, targets: DoublesSlotId[], spread: boolean, priority: number): HitCheck[];
  /** Whether `slot`'s move this turn is a focusing Focus Punch. */
  focuses(w: World, slot: DoublesSlotId, moveId: string | null): boolean;
  /** A 100% secondary reaches its target (Sheer Force, Shield Dust, Covert Cloak). */
  secondaryLands(w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): boolean;
  // ---- HP and Berries ----
  /** The Pokémon's HP after fixed losses outside its move's hits, its HP or pinch Berry at each Update: one world per outcome. */
  afterLoss(w: World, slot: DoublesSlotId, ...losses: (number | number[])[]): World[];
  /** `slot` eats a Berry that is due at an Update: one world per outcome. */
  berryDue(w: World, slot: DoublesSlotId): World[];
  /** Not estimated where a Berserk or Anger Shell lock (MoveVolatiles.berryLocked) keeps `slot`'s healing Berry at or under its line. */
  lockedBerryGuard(w: World, slot: DoublesSlotId): void;
  /** What eating an HP or pinch Berry leaves (no item, Unburden, the pinch rise, a Figy-family Berry's confusion, Lansat's focus, Starf's random rise: one world each, `w` first). */
  ateBerry(w: World, slot: DoublesSlotId, item: string): World[];
  /** Cheek Pouch's heal for a Berry that heals nothing itself, in place. */
  pouchHeal(w: World, slot: DoublesSlotId): void;
  /** The heals list (DoublesHP.heals) in the "all" walk. */
  noteHeal(slot: DoublesSlotId, source: string, amount: number): void;
  noteBerry(slot: DoublesSlotId, item: string, berry: Berry, hp: number): void;
  /** The Update after an Unnerve or As One holder went: the Berries it stopped that are due. */
  unnerveEnds(w: World, gone: DoublesSlotId[]): World[];
  /** An absorbing ability's effect (a quarter healed, a stat rise, Flash Fire). */
  absorbEffect(w: World, slot: DoublesSlotId, ability: string, action: PendingAction): World[];
  /** A protecting move's effect on a blocked contact attacker. */
  protectContact(w: World, attacker: DoublesSlotId, protector: DoublesSlotId, kind: keyof typeof PROTECT_CONTACT, info: TurnMoveInfo, followed?: boolean): World[];
  // ---- Statistics (the "all" walk; no-ops otherwise) ----
  step(action: PendingAction): StepStats | null;
  stepFact(action: PendingAction, text: string, mass: number): void;
  hitFact(action: PendingAction, slot: DoublesSlotId, text: string, mass: number): void;
  /** Why the action did not use its move (DoublesStep.skipped). */
  skipFact(action: PendingAction, text: string, mass: number): void;
  hitStats(action: PendingAction, slot: DoublesSlotId): HitStats | null;
  /** A hit's part into `target`'s Substitute: `taken` the HP it lost, `broke` whether it broke (DoublesHit.substitute). */
  subStat(action: PendingAction, target: DoublesSlotId, mass: number, taken: number, broke: boolean): void;
  /** HP `slot` lost outside any step (DoublesHP.losses: "{Name} hurts itself in confusion: 23–28 HP."). */
  lossFact(slot: DoublesSlotId, text: string, mass: number): void;
  /** A turn fact found during the walk (DoublesTurnResult.facts, after the facts read from the input; deduplicated). */
  turnFact(text: string): void;
  // ---- Guards ----
  snapshot(w: World): Snapshot;
  /** `damaging` (default true): Emergency Exit and Wimp Out are checked (status-eot C7: only after damaging moves). */
  eventGuards(before: Snapshot, w: World, damaging?: boolean): void;
  gasShieldGuard(w: World): void;
  notEstimated(reason: string): never;
  /** The reason of a NotEstimated this file throws, or null for any other error. */
  reasonOf(error: unknown): string | null;
  /** A Pokémon leaves during the moves with no later action (doubles-eot.ts leaving). */
  leaving(w: World, slot: DoublesSlotId): void;
  // ---- Build data ----
  /** model.ts getBuildStats: the stored stats. */
  buildStats(build: BattleBuild): ReturnType<typeof getBuildStats>;
  // ---- Calculations ----
  /** The build a calculation reads (HP in the factors; Plus and Minus). */
  calcBuild(w: World, slot: DoublesSlotId): BattleBuild;
  /**
   * The field one pair's calculation reads. `residual` (T2E §3.5): a hit at the residual from a source not in battle
   * (`attacker` null: the attacker side is `residual.side`, no user state) or in it: no Helping Hand or Charge but an active
   * source's own, no protect flag on the target.
   */
  conditionsFor(w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, multiple: boolean, moveId?: string, residual?: { side: DoublesSideId }): BattleConditions;
  contextFor(w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext | undefined;
  /**
   * One pair's calculation and turn search, memoised. `behindSubstitute`: the calculation into a Substitute (ADDENDUM
   * §4.13.3): the target's working resist or Chilan Berry reads as Leftovers, an intact Disguise or Ice Face as no ability.
   * `attackerBuild` (T2E §3.5): the build the calculation reads for the attacker (a residual hit's source), and `attacker`
   * null for a source not in battle (no attacker exclusion in the field-settled list, no attacker Unnerve).
   */
  searchFor(w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, conditions: BattleConditions, context: MoveContext | undefined,
    spread?: boolean, attackerHP?: number, opts?: { behindSubstitute?: true; healBlocked?: true; attackerBuild?: BattleBuild }): SearchEntry;
  /**
   * One pair's turnStep applied to the world; `part`: a step after hits into a Substitute (uses-to-ko.ts TurnStepPart).
   * `residual` (T2E §3.5): a hit at the residual: not followed, no write to an attacker not alive, no Eject Button, no Destiny
   * Bond, no statistics.
   */
  applyStep(w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: TurnMoveInfo, spread: boolean, part?: TurnStepPart,
    opts?: { residual?: { attacker: DoublesSlotId | null } }): StepChild[];
  /** The turn's reactions to one hit (afterHit), for a hit no step applies: an intact Disguise's or Ice Face's 0-damage hit (doubles-faces.ts). */
  afterHit(w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, raisedBefore?: boolean): void;
  blockedHit(w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck, contactEffect?: boolean): World[];
  faceTaken(w: World, attacker: DoublesSlotId, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): FaceKind | null;
  faceHit(w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId, face: FaceKind, multiple: boolean, inSpread?: boolean): World[];
  rowReason(w: World, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): string;
  noDamageFact(row: MoveDamageResult, move: ChampionsMove, target: DoublesSlotId): string;
  focusBandGuard(w: World, target: DoublesSlotId, row: MoveDamageResult): void;
  unnerveGuard(w: World, attacker: DoublesSlotId, target: DoublesSlotId): void;
  /** The knocker-out's rise after a faint batch of `count` (Moxie and its kin). */
  koBoost(w: World, slot: DoublesSlotId, count: number): void;
  /** A Max Move's side effects beyond its target. */
  maxEffects(w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): World[];
  // ---- Stages and statuses (doubles-stages.ts, doubles-status.ts) ----
  selfBoost(w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null): void;
  foeDrop(w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken?: boolean, reflected?: boolean): void;
  giveStatus(w: World, slot: DoublesSlotId, given: statusNs.GivenStatus, source: DoublesSlotId): void;
  /** doubles-stages.ts applyBoosts (sim/battle.ts boost), for the hook modules that cannot import it (D's copies, E's residuals: no cycle). */
  applyBoosts(w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null,
    opts?: { use?: Use; effect?: "move" | "ability" | "item" | null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string; herb?: false }): Partial<Record<Stage, number>>;
  // ---- status2 (SPEC2 §3.5, ADDENDUM2 §3.5): the shared state's helpers and the queue, calling and residual kernel ----
  /** The turn keeps item history (doubles-guards.ts tracksItems; SPEC2 §4.9's readers rule). */
  readonly tracksItems: boolean;
  /** True while the end of turn runs (endOfTurnOf): a Berry eaten there sets Cud Chew's counter to 1. */
  readonly inEndOfTurn: boolean;
  /**
   * `slot` used or ate `item` (pinned eatItem / useItem: lastItem, usedItemThisTurn; a Cud Chew holder's Berry eaten, not
   * stolen, sets eot.cudChew with counter 1 at the end of turn, 2 in the moves): a no-op unless tracksItems.
   */
  noteItemUse(w: World, slot: DoublesSlotId, item: string): void;
  /** Its types in this world (pinned getTypes): a Tera type (not Stellar) alone; else its world types or its species', with Roost's Type event (no Flying; none left: Normal), then its added type. */
  typesIn(w: World, slot: DoublesSlotId): string[];
  /**
   * After You ("next": the action next, order 3) and Quash ("last", order 201) on `slot`'s queued action (sim/battle-queue.ts
   * prioritizeAction; generation 7's frozen queue keeps the order of use). Whether it was queued.
   */
  prioritize(w: World, slot: DoublesSlotId, where: "next" | "last"): boolean;
  /** An action inserted into this world's queue (a pulled Round, an instructed move; PR, CL): replaced, never mutated. */
  insertAction(w: World, action: PendingAction): void;
  /** A Dancer's copy (PR): `slot` uses `moveId` at `target` as an external move, with its own BeforeMove (`index`: extraStep's). */
  externalUse(w: World, slot: DoublesSlotId, moveId: string, target: DoublesSlotId | null, index: number): World[];
  /**
   * The one calling path (C36; CL): the action's user uses `moveId` at `target` with no BeforeMove and no PP, at `priority`
   * (default: the caller's) and with `prankster` (default: its own); a damaging move through damagingMove, a status move
   * through doubles-status.ts runCalledStatus. `action`: the caller's (its statistics).
   */
  useCalled(w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean; snatched?: true; bounced?: true }): World[];
  /**
   * A second step of `slot` this turn (DoublesStep.copied): its statistics' index (an action's `index`), or -1 outside the
   * recording walk. `id`: its Pokémon's MonState.id (status2 R: a newcomer's copy is its own step, DoublesStep.id).
   */
  extraStep(key: "Dancer" | "Instruct", slot: DoublesSlotId, moveId: string, from?: number, id?: string): number;
  /** One damaging hit at the residual (T2E §4.1.4; E2's landing): the child worlds and, per world, the hits that reached the Pokémon. */
  residualHit(w: World, hit: ResidualHit): { world: World; landed: number }[];
  // ---- the moved code's private helpers (status2: doubles-faces.ts, doubles-spread.ts, doubles-max.ts, doubles-reactions.ts) ----
  /**
   * The attacker after a step that did not follow its HP: an HP or pinch Berry it ate there put back (unfollowed);
   * `standIn` (healStandIn of the world before): its heal-block stand-in's real item back.
   */
  unfollowed(before: BattleBuild, after: BattleBuild, standIn?: boolean): BattleBuild;
  /** status2 C14: `slot`'s HP Berry (as the attacker, its Shell Bell too) heals nothing under Heal Block: a step reads it as Leftovers. */
  healStandIn(w: World, slot: DoublesSlotId, attacker: boolean): boolean;
  /** The build after a step: the search's side for it (HP aside). */
  fromSide(build: BattleBuild, side: TurnSide): BattleBuild;
  /** A step side's key (its HP aside). */
  sideKey(side: TurnSide): string;
  /** Flinch from Fake Out and Upper Hand on a target that still has an action. */
  flinchCheck(w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): void;
  /** One calculation against the budget (REASONS.tooMany past it). */
  countCalculation(): void;
  /** The statistics' calculations met (DoublesHit.cases) and each step's first calculation (DoublesHit.row), by row. */
  noteMet(action: PendingAction, slot: DoublesSlotId, row: MoveDamageResult, mass: number): void;
  noteFirst(action: PendingAction, slot: DoublesSlotId, row: MoveDamageResult, mass: number): void;
  /** The Z-Move or Max Move a converted move is when used against `target` (usedMove). */
  usedMove(w: World, attacker: DoublesSlotId, moveId: string, target: DoublesSlotId, info: TurnMoveInfo): { name: string; type: string };
  /** Unnerve and As One for one pair's step (turnUnnerve); `attacker` null: a residual hit's source not in battle. */
  turnUnnerve(w: World, attacker: DoublesSlotId | null, target: DoublesSlotId): TurnUnnerve | undefined;
};

/** One damaging hit at the residual (TurnKernel.residualHit; T2E §4.1.4). */
export type ResidualHit = {
  move: string; position: DoublesSlotId; attacker: DoublesSlotId | null; side: DoublesSideId; build: BattleBuild;
  conditions: BattleConditions; context?: MoveContext;
};

const alive = (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted;
const isFoe = (a: DoublesSlotId, b: DoublesSlotId) => slotSide(a) !== slotSide(b);
const moveName = (ctx: Ctx, id: string) => ctx.runtime.movesById.get(id)?.name ?? id;
const abilityName = (ctx: Ctx, id: string) => ctx.runtime.abilitiesById.get(id)?.name ?? id;
const itemName = (ctx: Ctx, id: string) => ctx.runtime.itemsById.get(id)?.name ?? id;
const itemWorks = (w: World, build: BattleBuild) => !w.field.magicRoom && !build.itemSuppressed && build.abilityId !== "klutz";
const bump = <K>(map: Map<K, number>, key: K, mass: number) => map.set(key, (map.get(key) ?? 0) + mass);
const laterAction = (w: World) => w.remaining.some((entry) => alive(w, entry.slot));

const emptyHitStats = (): HitStats => ({
  reached: 0, ko: 0, calculated: 0, blocked: 0, noDamage: 0, effect: 0, change: null, sub: { mass: 0, breaks: 0, min: Infinity, max: -Infinity },
  met: new Map(), firsts: new Map(), facts: new Map(),
});
/**
 * The statistics of `slot` in a step. status2 R-E: `occupant`, the slot's occupant when it is not the slot's starting
 * Pokémon (ctx.occupants): its own entry (StepStats.entered; DoublesHit.id), in the step's hit order (StepStats.keys).
 */
function hitStats(step: StepStats, slot: DoublesSlotId, occupant?: string): HitStats {
  if (occupant !== undefined) {
    const key = `${slot}|${occupant}`;
    const entered = step.entered ??= new Map();
    let stats = entered.get(key);
    if (!stats) {
      entered.set(key, stats = { ...emptyHitStats(), slot, id: occupant });
      (step.keys ??= [...step.hits.keys()]).push(key);
    }
    return stats;
  }
  let stats = step.hits.get(slot);
  if (!stats) {
    step.hits.set(slot, stats = emptyHitStats());
    step.keys?.push(slot);
  }
  return stats;
}
const stepOf = (ctx: Ctx, action: PendingAction) => ctx.stats?.[action.index] ?? null;
/**
 * status2 R-E: the key of `slot`'s occupant in the per-Pokémon statistics (heals, losses, faints): the slot for its starting
 * Pokémon, `{slot}|{id}` for a Pokémon that came in (ctx.occupants).
 */
const statKey = (ctx: Ctx, slot: DoublesSlotId): string => monKey(slot, ctx.occupants[slot]);
/**
 * status2 R-E: the key of the Pokémon with `id` at `slot` (World.mons, World.benched) in the per-Pokémon results: a slot's
 * starting Pokémon by its own slot wherever it stands (id absent, or its startId), a bench Pokémon by `{slot}|{id}`.
 */
const monKey = (slot: DoublesSlotId, id: string | undefined): string => (id === undefined ? slot : id.startsWith("slot:") ? id.slice(5) : `${slot}|${id}`);
/** status2 R-E: the name of the Pokémon with `id` in `slot` (MonState.id): the slot's starting Pokémon (absent), another slot's (startId), a bench Pokémon's. */
function monName(ctx: Ctx, slot: DoublesSlotId, id: string | undefined): string {
  if (id === undefined) return ctx.startNames[slot];
  if (id.startsWith("slot:")) return ctx.startNames[id.slice(5) as DoublesSlotId] ?? id;
  return ctx.benchNames[id] ?? id;
}
function stepFact(ctx: Ctx, action: PendingAction, text: string, mass: number) {
  const step = stepOf(ctx, action);
  if (step) bump(step.facts, text, mass);
}
function hitFact(ctx: Ctx, action: PendingAction, slot: DoublesSlotId, text: string, mass: number) {
  const step = stepOf(ctx, action);
  if (step) bump(hitStats(step, slot, ctx.occupants[slot]).facts, text, mass);
}

/** The kernel of a context (made once). */
function kernelOf(ctx: Ctx): TurnKernel {
  return ctx.kernel ??= makeKernel(ctx);
}

function makeKernel(ctx: Ctx): TurnKernel {
  const kernel: TurnKernel = {
    get input() { return ctx.input; },
    runtime: ctx.runtime, names: ctx.names, benchNames: ctx.benchNames, startNames: ctx.startNames, hp: ctx.hp, gen7: ctx.gen7, champions: ctx.champions, mode: ctx.mode,
    nameOf: (w, slot) => monName(ctx, slot, w.mons[slot]?.id),
    baseInput: ctx.baseInput,
    get acting() { return ctx.acting; },
    occupy: (w) => syncOccupants(ctx, w),
    startHP: ctx.startHP,
    runAction: (w, action) => execute(ctx, w, action),
    get reference() { return DOUBLES_REFERENCE.on; },
    recording: ctx.stats !== null, get gas() { return ctx.gas; }, budget: BUDGET,
    fieldSettledAbilities: FIELD_SETTLED_ABILITIES, fieldSettledItems: FIELD_SETTLED_ITEMS,
    targetless: (slot) => ctx.targetless.has(slot),
    moveName: (id) => moveName(ctx, id), abilityName: (id) => abilityName(ctx, id), itemName: (id) => itemName(ctx, id),
    alive, isFoe,
    faint: (w, slot, byHit) => faint(ctx, w, slot, byHit),
    speedOf: (w, slot) => speedOf(ctx, w, slot),
    typesOf: (build) => typesOf(ctx, build),
    grounded: (w, slot) => grounded(ctx, w, slot),
    itemWorks,
    effectiveWeather,
    laterDamaging: (w) => laterDamaging(ctx, w),
    laterAction,
    occupant, positionOf,
    powderImmune: (w, slot) => powderImmune(ctx, w, slot),
    gasEnds: (w, slot) => gasEnds(ctx, w, slot),
    berryStopped,
    breaks,
    priorityOf: (w, action) => priorityOf(ctx, w, action),
    moveInfo: (w, slot, moveId, context) => moveInfo(ctx, w, slot, moveId, context),
    usedType: (w, attacker, moveId, target, info, context) => usedType(ctx, w, attacker, moveId, target, info, context),
    usedTargetType: (w, attacker, move, info) => usedTargetType(ctx, w, attacker, move, info),
    resolveTargets: (w, action, info, type) => resolveTargets(ctx, w, action, info, type),
    redirect: (w, attacker, target, info, moveId, context, type) => redirect(ctx, w, attacker, target, info, moveId, context, type),
    spreadTargets,
    tracksTarget,
    protectPasses: (w, action, target) => protectPasses(ctx, w, action, target),
    moveFailure: (w, action, move, target, priority, info) => moveFailure(ctx, w, action, move, target, priority, info),
    priorityShield: (w, action, move, target, priority, info) => priorityShield(ctx, w, action, move, target, priority, info),
    hitChecks: (w, action, info, targets, spread, priority) => hitChecks(ctx, w, action, info, targets, spread, priority),
    focuses: (w, slot, moveId) => focuses(ctx, w, slot, moveId),
    secondaryLands: (w, attacker, target, info) => secondaryLands(ctx, w, attacker, target, info),
    afterLoss: (w, slot, ...losses) => afterLoss(ctx, w, slot, ...losses),
    berryDue: (w, slot) => berryDue(ctx, w, slot),
    lockedBerryGuard: (w, slot) => guardHooks.lockedBerryGuard(kernel, w, slot),
    ateBerry: (w, slot, item) => ateBerry(ctx, w, slot, item),
    pouchHeal: (w, slot) => pouchHeal(ctx, w, slot),
    noteHeal: (slot, source, amount) => noteHeal(ctx, slot, source, amount),
    noteBerry: (slot, item, berry, hp) => noteBerry(ctx, slot, item, berry, hp),
    unnerveEnds: (w, gone) => unnerveEnds(ctx, w, gone),
    absorbEffect: (w, slot, ability, action) => absorbEffect(ctx, w, slot, ability, action),
    protectContact: (w, attacker, protector, kind, info, followed) => protectContact(ctx, w, attacker, protector, kind, info, followed),
    step: (action) => stepOf(ctx, action),
    stepFact: (action, text, mass) => stepFact(ctx, action, text, mass),
    hitFact: (action, slot, text, mass) => hitFact(ctx, action, slot, text, mass),
    skipFact: (action, text, mass) => { const step = stepOf(ctx, action); if (step) bump(step.skipped, text, mass); },
    hitStats: (action, slot) => { const step = stepOf(ctx, action); return step ? hitStats(step, slot, ctx.occupants[slot]) : null; },
    subStat: (action, target, mass, taken, broke) => {
      const step = stepOf(ctx, action);
      if (!step) return;
      const sub = hitStats(step, target, ctx.occupants[target]).sub;
      sub.mass += mass;
      if (broke) sub.breaks += mass;
      sub.min = Math.min(sub.min, taken);
      sub.max = Math.max(sub.max, taken);
    },
    lossFact: (slot, text, mass) => {
      if (!ctx.stats) return;
      const key = statKey(ctx, slot);
      let facts = ctx.losses.get(key);
      if (!facts) ctx.losses.set(key, facts = new Map());
      bump(facts, text, mass);
    },
    turnFact: (text) => { if (ctx.stats) ctx.walkFacts.add(text); },
    snapshot: (w) => snapshot(ctx, w),
    eventGuards: (before, w, damaging) => eventGuards(ctx, before, w, damaging),
    gasShieldGuard: (w) => gasShieldGuard(ctx, w),
    notEstimated,
    reasonOf: (error) => error instanceof NotEstimated ? error.reason : null,
    leaving: (w, slot) => eotHooks.leaving(w, slot),
    buildStats: (build) => getBuildStats(build, ctx.runtime),
    calcBuild: (w, slot) => calcBuild(ctx, w, slot),
    conditionsFor: (w, attacker, target, multiple, moveId, residual) => conditionsFor(ctx, w, attacker, target, multiple, moveId, residual),
    contextFor: (w, action, target, info) => contextFor(ctx, w, action, target, info),
    searchFor: (w, attacker, target, moveId, conditions, context, spread, attackerHP, opts) => searchFor(ctx, w, attacker, target, moveId, conditions, context, spread, attackerHP, opts),
    applyStep: (w, action, target, entry, info, spread, part, opts) => applyStep(ctx, w, action, target, entry, info, spread, part, opts),
    afterHit: (w, action, target, outcome, info, raisedBefore) => afterHit(ctx, w, action, target, outcome, info, raisedBefore),
    blockedHit: (w, action, info, check, contactEffect) => blockedHit(ctx, w, action, info, check, contactEffect),
    // The moved code (status2): S's faces, W's Focus Band, K's Unnerve, M's Max Moves; the kernel members keep their names.
    faceTaken: (w, attacker, target, row, move) => faceHooks.faceTaken(kernel, w, attacker, target, row, move),
    faceHit: (w, action, info, target, face, multiple, inSpread) => faceHooks.faceHit(kernel, w, action, info, target, face, multiple, inSpread),
    rowReason: (w, target, row, move) => rowReason(ctx, w, target, row, move),
    noDamageFact: (row, move, target) => noDamageFact(ctx, row, move, target),
    focusBandGuard: (w, target, row) => pairHooks.focusBand(kernel, w, target, row),
    unnerveGuard: (w, attacker, target) => reactionHooks.unnerveStand(kernel, w, attacker, target),
    koBoost: (w, slot, count) => koBoost(ctx, w, slot, count),
    maxEffects: (w, action, info, target) => maxHooks.maxEffects(kernel, w, action, info, target),
    selfBoost: (w, slot, changes, action) => stageHooks.selfBoost(kernel, w, slot, changes, action),
    foeDrop: (w, slot, changes, source, broken, reflected) => stageHooks.foeDrop(kernel, w, slot, changes, source, broken, reflected),
    giveStatus: (w, slot, given, source) => statusHooks.giveStatus(kernel, w, slot, given, source),
    applyBoosts: (w, slot, changes, source, opts) => stageHooks.applyBoosts(kernel, w, slot, changes, source, opts),
    // status2.
    tracksItems: ctx.tracksItems,
    inEndOfTurn: ctx.inEndOfTurn,
    noteItemUse: (w, slot, item) => noteItemUse(ctx, w, slot, item),
    typesIn: (w, slot) => typesIn(ctx, w, slot),
    prioritize: (w, slot, where) => prioritize(ctx, w, slot, where),
    insertAction,
    externalUse: (w, slot, moveId, target, index) => externalUse(ctx, w, slot, moveId, target, index),
    useCalled: (w, action, moveId, target, opts) => useCalled(ctx, w, action, moveId, target, opts),
    extraStep: (key, slot, moveId, from, id) => extraStep(ctx, key, slot, moveId, from, id),
    residualHit: (w, hit) => residualHit(ctx, w, hit),
    unfollowed, fromSide, sideKey,
    healStandIn,
    flinchCheck: (w, action, target, info) => flinchCheck(ctx, w, action, target, info),
    countCalculation: () => countCalculation(ctx),
    noteMet: (action, slot, row, mass) => { const step = stepOf(ctx, action); if (step) note(hitStats(step, slot, ctx.occupants[slot]).met, damageKey(row), row, mass); },
    noteFirst: (action, slot, row, mass) => { const step = stepOf(ctx, action); if (step) note(hitStats(step, slot, ctx.occupants[slot]).firsts, JSON.stringify(row), row, mass); },
    usedMove: (w, attacker, moveId, target, info) => usedMove(ctx, w, attacker, moveId, target, info),
    turnUnnerve,
  };
  return kernel;
}

/** An action inserted into the world's queue (kernel.insertAction): the queue replaced, never mutated. */
function insertAction(w: World, action: PendingAction) {
  w.remaining = [...w.remaining, action];
}

// The moved helpers (doubles-stages.ts, doubles-status.ts, doubles-typing.ts) as this file calls them.
const selfBoost = (ctx: Ctx, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null) => stageHooks.selfBoost(kernelOf(ctx), w, slot, changes, action);
const foeDrop = (ctx: Ctx, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken = false, reflected = false) =>
  stageHooks.foeDrop(kernelOf(ctx), w, slot, changes, source, broken, reflected);
const giveStatus = (ctx: Ctx, w: World, slot: DoublesSlotId, given: statusNs.GivenStatus, source: DoublesSlotId) => statusHooks.giveStatus(kernelOf(ctx), w, slot, given, source);
const proteanGuard = (ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, type: () => string) => typingHooks.proteanGuard(kernelOf(ctx), w, slot, moveId, type);
const stanceChange = (ctx: Ctx, w: World, slot: DoublesSlotId, blade: boolean) => statusHooks.stanceChange(kernelOf(ctx), w, slot, blade);
const berryConfusion = (ctx: Ctx, w: World, slot: DoublesSlotId, item: string) => statusHooks.berryConfusion(kernelOf(ctx), w, slot, item);

// ------------------------------------------------------------------------------------------------------------------
// Builds, conditions and the pairwise calculations
// ------------------------------------------------------------------------------------------------------------------

/**
 * The build a calculation reads (HP lives in the factors): Plus and Minus from a living partner (data/abilities.ts plus,
 * minus: pokemon.allies()); status2's calculation-only markers from the world (turnMarks), none while no state sets them.
 */
function calcBuild(ctx: Ctx, w: World, slot: DoublesSlotId, withMarks = true): BattleBuild {
  // `withMarks` false: the build without turnMarks' markers (speedOf, which reads none of them).
  const build = w.mons[slot]!.build;
  const marks = withMarks ? turnMarks(ctx, w, slot) : null;
  if (build.abilityId !== "plus" && build.abilityId !== "minus") return marks ? { ...build, currentHP: null, ...marks } as BattleBuild : { ...build, currentHP: null };
  const partner = allyOf(slot);
  const active = alive(w, partner) && ["plus", "minus"].includes(w.mons[partner]!.build.abilityId);
  return marks ? { ...build, currentHP: null, abilityActive: active, ...marks } as BattleBuild : { ...build, currentHP: null, abilityActive: active };
}

/**
 * status2 (SPEC2 §3.5, ADDENDUM2 §3.5): the markers a calculation reads from `slot`'s world state, each only while its state
 * stands: Roost's types (its Flying type gone while roosted, not Terastallized), Tar Shot, Foresight or Miracle Eye, the
 * grounding overrides (Ingrain and Smack Down pin it unless Gravity is up, which the engine reads itself; Magnet Rise and
 * Telekinesis float it unless pinned or holding a working Iron Ball), the final modifiers on the damage it takes (Minimize,
 * Glaive Rush, Ripen's weakened Berry, the hidden move), G-Max Chi Strike's critical-hit stages and Laser Focus.
 */
function turnMarks(ctx: Ctx, w: World, slot: DoublesSlotId): Partial<BattleBuild> | null {
  const mon = w.mons[slot]!;
  const { vol, eot, build } = mon;
  // None of the states stands (every world today's turn makes but a few): no markers.
  if (!eot.roosted && !vol.tarShot && !vol.revealed && !eot.ingrain && !eot.smackedDown && !eot.magnetRise && !eot.telekinesis && !vol.minimize
    && !vol.glaiveRush && !vol.berryWeaken && !eot.hidden && !vol.chiStrike && !vol.laserFocus) return null;
  const marks: Partial<BattleBuild> = {};
  const tera = build.mechanic === "tera" && !!build.configuration?.teraType && build.configuration.teraType !== "Stellar";
  const base = build.types ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [];
  if (eot.roosted && !tera && base.includes("Flying")) {
    const left = base.filter((type) => type !== "Flying");
    marks.types = left.length ? left : ["Normal"];
  }
  if (vol.tarShot) marks.tarShot = true;
  if (vol.revealed) marks.revealed = vol.revealed;
  const pinned = (eot.ingrain || eot.smackedDown) && !w.field.gravity;
  const ironBall = build.itemId === "ironball" && itemWorks(w, build);
  if (pinned) marks.grounding = "pinned";
  else if ((eot.magnetRise || eot.telekinesis) && !ironBall && !eot.ingrain && !eot.smackedDown) marks.grounding = "floating";
  const hidden = eot.hidden ? HIDDEN_MARKS[eot.hidden] : undefined;
  if (vol.minimize || vol.glaiveRush || vol.berryWeaken || hidden) {
    marks.takenMods = { ...(vol.minimize ? { minimize: true } : {}), ...(vol.glaiveRush ? { glaiveRush: true } : {}), ...(vol.berryWeaken ? { berryWeaken: true } : {}), ...(hidden ? { hidden } : {}) };
  }
  if (vol.chiStrike) marks.critBoost = vol.chiStrike;
  if (vol.laserFocus) marks.laserFocus = true;
  return marks;
}

/**
 * Flower Gift on `boosted`'s partner (data/abilities.ts flowergift onAllyModifyAtk, onAllyModifySpD): a living Cherrim
 * (effectState.target.baseSpecies) gives its partner 1.5x Attack and Sp. Def while that partner's own weather is Sun or
 * Harsh Sunshine (Pokemon.effectiveWeather: Cloud Nine and Air Lock, its Utility Umbrella). Breakable: `attacker`'s
 * Mold Breaker or an ignoreAbility move stops it unless Cherrim holds an Ability Shield (sim/battle.ts:365
 * suppressingAbility); Body Press attacks with Defense (ModifyDef), which it does not raise. The engine's side flag
 * isFlowerGift applies it (gen789 calculateAtModsSMSSSV, calculateDfModsSMSSSV). `moveId`: the move the flag is for
 * (unset: one whose own id ignores no ability).
 */
function flowerGift(ctx: Ctx, w: World, boosted: DoublesSlotId, attacker: DoublesSlotId, moveId: string | undefined): boolean {
  const holder = allyOf(boosted);
  if (!alive(w, holder) || holder === w.ghost || !w.mons[boosted]) return false;
  const cherrim = w.mons[holder]!.build;
  if (cherrim.abilityId !== "flowergift" || !cherrim.speciesId.startsWith("cherrim")) return false;
  const weather = effectiveWeather(w);
  if (weather !== "Sun" && weather !== "Harsh Sunshine") return false;
  const own = w.mons[boosted]!.build;
  if (own.itemId === "utilityumbrella" && itemWorks(w, own)) return false;
  const shielded = cherrim.itemId === "abilityshield" && !w.field.magicRoom;
  if (holder !== attacker && !shielded && MOLD_BREAKERS.has(w.mons[attacker]!.build.abilityId)) return false;
  if (!moveId) return true;
  const info = moveInfo(ctx, w, attacker, moveId, ctx.input.pokemon[attacker]!.contexts[moveId]);
  if (info.kind !== "move") return true;
  if (holder !== attacker && !shielded && IGNORE_ABILITY_MOVES.has(info.effective.id)) return false;
  return !(boosted === attacker && info.effective.id === "bodypress");
}

/**
 * The field one pair's calculation reads (SPEC §4.5): the partners' flags and the field effects of the four Pokémon.
 * `moveId`: the move calculated (Flower Gift reads it).
 */
function conditionsFor(ctx: Ctx, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, multiple: boolean, moveId?: string, residual?: { side: DoublesSideId }): BattleConditions {
  // An exploding user's handlers on others are gone (World.ghost); its Cloud Nine still suppresses the weather
  // (sim/field.ts suppressingWeather reads the fainted flag, not HP).
  const living = DOUBLES_SLOTS.filter((slot) => alive(w, slot) && slot !== w.ghost);
  const has = (ability: string) => living.some((slot) => w.mons[slot]!.build.abilityId === ability);
  const negated = DOUBLES_SLOTS.some((slot) => alive(w, slot) && WEATHER_NEGATORS.has(w.mons[slot]!.build.abilityId));
  const side = (id: DoublesSideId) => {
    const state = w.sides[id];
    const out: BattleConditions["attackerSide"] = {
      reflect: state.reflect, lightScreen: state.lightScreen, auroraVeil: state.auroraVeil, tailwind: state.tailwind, helpingHand: false, friendGuard: false, priorityShield: false, protect: false, charge: false,
    };
    // status2: Lucky Chant on the side (no critical hit into it), the swamp (Grass + Water Pledge: Speed ×0.25); absent while not up.
    if (state.luckyChant) out.luckyChant = true;
    if (state.safeguard) out.safeguard = true;
    if (state.pledge?.grass) out.swamp = true;
    return out;
  };
  const partner = allyOf(target);
  const partnerAbility = alive(w, partner) && partner !== w.ghost ? w.mons[partner]!.build.abilityId : "";
  // The attacker's partner's power boost (data/abilities.ts battery, powerspot, steelyspirit onAllyBasePower: a living
  // ally's handler, sim/pokemon.ts alliesAndSelf; calculate.ts partnerPowerBoosts reads the move's category and type).
  // A residual hit's source not in battle (T2E §4.1.3): its side's living Pokémon are its allies.
  const ally = attacker ? allyOf(attacker) : null;
  const allyAbility = ally && alive(w, ally) && ally !== w.ghost ? w.mons[ally]!.build.abilityId : "";
  const sideAbilities = attacker ? null : DOUBLES_SLOTS.filter((slot) => slotSide(slot) === residual!.side && alive(w, slot) && slot !== w.ghost).map((slot) => w.mons[slot]!.build.abilityId);
  const battery = sideAbilities ? sideAbilities.includes("battery") : allyAbility === "battery";
  const powerSpot = sideAbilities ? sideAbilities.includes("powerspot") : allyAbility === "powerspot";
  const steelySpirit = sideAbilities ? sideAbilities.includes("steelyspirit") : allyAbility === "steelyspirit";
  const user = attacker ? w.mons[attacker]! : null, receiver = w.mons[target]!;
  const attackerSide = attacker ? slotSide(attacker) : residual!.side;
  // A Z-Move with a spread target of its own used into one target (Clangorous Soulblaze): no spread modifier.
  const zContext = moveId && attacker ? ctx.input.pokemon[attacker]?.contexts[moveId] : undefined;
  const zInfo = !multiple && moveId && attacker && zContext?.useZ ? moveInfo(ctx, w, attacker, moveId, zContext) : null;
  const oneTarget = zInfo?.kind === "move" && zInfo.isZ && SPREAD_TARGETS.has(zInfo.effective.target);
  const ruin = ctx.runtime.profile.id === "scarlet_violet"
    ? { ruin: { sword: has("swordofruin"), beads: has("beadsofruin"), tablets: has("tabletsofruin"), vessel: has("vesselofruin") } } : {};
  const out: BattleConditions = {
    gameType: "Doubles", ...w.field, weather: negated ? "" : w.field.weather, critical: ctx.input.field.critical, multipleTargets: multiple, ...(oneTarget ? { oneTarget } : {}),
    fairyAura: has("fairyaura"), darkAura: has("darkaura"), auraBreak: has("aurabreak"), ...ruin,
    attackerSide: {
      // A residual hit (T2E §4.1.3): Helping Hand and Charge only from an active source's own state.
      ...side(attackerSide), helpingHand: !residual && user?.helpingHand === 1, charge: !!user?.charged,
      ...(attacker && flowerGift(ctx, w, attacker, attacker, moveId) ? { flowerGift: true } : {}),
      ...(battery ? { battery: true } : {}),
      ...(powerSpot ? { powerSpot: true } : {}),
      ...(steelySpirit ? { steelySpirit: true } : {}),
    },
    defenderSide: {
      ...side(slotSide(target)), protect: !residual && receiver.protect !== null && receiver.protect !== "maxguard",
      ...(attacker && target !== attacker && flowerGift(ctx, w, target, attacker, moveId) ? { flowerGift: true } : {}),
      // The target's partner's Friend Guard, the attacker's own when it hits its partner (data/abilities.ts friendguard onAnyModifyDamage).
      friendGuard: partner !== target && partnerAbility === "friendguard",
      // A partner's Queenly Majesty, Dazzling or Armor Tail stops a foe's priority move (onFoeTryMove).
      priorityShield: !!attacker && isFoe(attacker, target) && (PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(partnerAbility),
    },
  };
  // status2 (ADDENDUM2 §3.5): the move's target is the user's ally (the shields' and Psychic Terrain's priority blocks do not
  // apply); (SPEC2 §3.5) Mat Block on the target's side for a foe's Z-Move or Max Move (protected, at a quarter, with its name).
  if (attacker && target !== attacker && !isFoe(attacker, target)) out.allyTarget = true;
  if (w.sides[slotSide(target)].matBlock && attacker && moveId && target !== attacker) {
    const info = moveInfo(ctx, w, attacker, moveId, ctx.input.pokemon[attacker]?.contexts[moveId]);
    if (info.kind === "move" && (info.isZ || info.isMax)) {
      out.defenderSide.protect = !residual;
      out.defenderSide.protectName = moveName(ctx, "matblock");
    }
  }
  return out;
}

/** The field for one Pokémon's own reads (its priority, Speed, the move it uses). */
function ownConditions(ctx: Ctx, w: World, slot: DoublesSlotId): BattleConditions {
  return conditionsFor(ctx, w, slot, slot, false);
}

function countCalculation(ctx: Ctx) {
  if (++ctx.memo.calculations > BUDGET.calculations && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);
}

/** The move `slot` uses (Z-Move and Max Move conversion), memoised. */
function moveInfo(ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, context: MoveContext | undefined): TurnMove {
  const build = calcBuild(ctx, w, slot);
  // The memo key reads the field itself (ownConditions' magicRoom); the conditions are built on a miss only.
  const key = JSON.stringify([moveId, build, w.field.magicRoom, context]);
  let info = ctx.memo.moves.get(key);
  if (!info) ctx.memo.moves.set(key, info = resolveTurnMove(ctx.runtime.movesById.get(moveId)!, build, ownConditions(ctx, w, slot), context, ctx.runtime));
  return info;
}

/**
 * One pair's calculation and its turn search (memoised by everything they read; SPEC §9). The target's Endure this turn
 * (doubles-status.ts endureFor: UsesEnv.endure) is read too. `behindSubstitute` (ADDENDUM §4.13.3): the calculation into
 * the target's Substitute, with the target's build changed for it alone: a working resist Berry or Chilan Berry reads as
 * Leftovers (their onSourceModifyDamage returns for hitSub, PS/data/items.ts, while Knock Off's 1.5x and Poltergeist still
 * see a held item: K6), an intact Disguise or Ice Face as no ability (their onEffectiveness and onCriticalHit return for
 * hitSub, PS/data/abilities.ts:979-1001, 1985-2002: U9). `healBlocked` (psychicNoiseKeepsBerry; status2 C14: a heal-blocked
 * target): the target's HP Berry reads as Leftovers; `attackerHealBlocked` (C14): the attacker's HP Berry and Shell Bell
 * likewise. The step's builds then hold the stand-ins; the caller puts the real items and ability back. `attackerBuild`
 * (status2 T2E §3.5): the build a residual hit's source is calculated with; `attacker` null: a source not in battle.
 */
function searchFor(ctx: Ctx, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, conditions: BattleConditions, context: MoveContext | undefined,
  spread = false, attackerHP?: number, opts?: { behindSubstitute?: true; healBlocked?: true; attackerHealBlocked?: true; attackerBuild?: BattleBuild }): SearchEntry {
  guardHooks.hiddenStageGuard(kernelOf(ctx), w, attacker, target, moveId, context);
  const move = ctx.runtime.movesById.get(moveId)!;
  const own = opts?.attackerBuild ?? calcBuild(ctx, w, attacker!);
  let xb = attackerHP === undefined ? own : { ...own, currentHP: baseHP(ctx, attacker!, attackerHP) };
  // status2 C14: a heal-blocked attacker's HP Berry and Shell Bell heal nothing; they read as Leftovers (no damage change).
  // From eot.healBlock (healStandIn; none while nothing sets it), not for a residual source's own build.
  if (opts?.attackerHealBlocked || (attacker && !opts?.attackerBuild && healStandIn(w, attacker, true))) xb = { ...xb, itemId: "leftovers" };
  let tb = calcBuild(ctx, w, target);
  if (attacker && !opts?.attackerBuild) [xb, tb] = reactionHooks.calcStandIns(kernelOf(ctx), w, attacker, target, moveId, xb, tb);
  const behind = !!opts?.behindSubstitute;
  if (behind && RESIST_BERRIES.has(tb.itemId) && itemWorks(w, tb)) tb = { ...tb, itemId: "leftovers" };
  if (behind && BUSTED_FORMS[tb.speciesId] && (tb.abilityId === "disguise" || tb.abilityId === "iceface")) tb = { ...tb, abilityId: GAS_STAND_IN };
  // `healBlocked` (psychicNoiseKeepsBerry): the target's HP Berry is not eaten at the hit's Update; it reads as Leftovers (no damage change).
  // status2 C14: likewise under a Heal Block it already has (healStandIn; applyStep puts the Berry back).
  if (opts?.healBlocked || healStandIn(w, target, false)) tb = { ...tb, itemId: "leftovers" };
  const fieldSettled = DOUBLES_SLOTS.filter((slot) => slot !== attacker && slot !== target && alive(w, slot)).flatMap((slot) => {
    const build = w.mons[slot]!.build;
    return [...(FIELD_SETTLED_ABILITIES.has(build.abilityId) ? [abilityName(ctx, build.abilityId)] : []), ...(FIELD_SETTLED_ITEMS.has(build.itemId) ? [itemName(ctx, build.itemId)] : [])];
  });
  const unnerve = turnUnnerve(w, attacker, target);
  const endure = statusHooks.endureFor(w, target);
  // status2 (SPEC2 §3.5, ADDENDUM2 §3.5): the step's environment from the sides and the hook modules: Mist on either side,
  // D's reports, K's and W's parts. Every part is absent while nothing sets it, so the key and the options are today's.
  const kernel = kernelOf(ctx);
  const extra: UsesEnv = {};
  // status2 Step 1 #1 (F4 F1): the target is the attacker's ally (Bulldoze, Earthquake, a move aimed at the partner): Defiant,
  // Competitive, Opportunist and Mirror Herb answer a foe's change only (PS/data/abilities.ts defiant, competitive
  // onAfterEachBoost `target.isAlly(source)`; opportunist onFoeAfterBoost; PS/data/items.ts mirrorherb onFoeAfterBoost).
  if (attacker && attacker !== target && !isFoe(attacker, target)) extra.allies = true;
  const mistAtt = !!attacker && !!w.sides[slotSide(attacker)].mist, mistDef = !!attacker && !!w.sides[slotSide(target)].mist;
  if (mistAtt || mistDef) extra.mist = { ...(mistAtt ? { att: true as const } : {}), ...(mistDef ? { def: true as const } : {}) };
  // PR (status2 wave 1b): the last hit for a foe's hit into a Counter-family user (presence.stepReport).
  const presenceReport = presenceHooks.stepReport(kernel, w, attacker, target, moveId);
  const report = presenceReport ? { ...guardHooks.stepReport(kernel), ...presenceReport } : guardHooks.stepReport(kernel);
  if (Object.keys(report).length) extra.report = report;
  Object.assign(extra, reactionHooks.stepEnv(kernel, w, attacker, target, moveId, spread), pairHooks.stepEnv(kernel, w, attacker, target, moveId, spread), fieldChangeHooks.stepEnv(kernel, w, attacker, target, moveId, spread));
  const extraSet = Object.keys(extra).length > 0;
  const key = JSON.stringify([moveId, xb, tb, conditions, context, fieldSettled, spread, unnerve, ...(endure ? ["endure"] : []), ...(behind ? ["substitute"] : []),
    ...(extraSet ? [extra] : []), ...(opts?.attackerBuild ? ["residual"] : [])]);
  const known = DOUBLES_REFERENCE.on ? undefined : ctx.memo.searches.get(key);
  if (known) return known;
  countCalculation(ctx);
  const trace: CalcTrace = {};
  const row = calculateTurnMove(move, xb, tb, conditions, context, ctx.runtime, trace);
  let entry: SearchEntry = { row, search: null, follow: false, trace };
  if (row.kind === "calculated" && row.max !== null && row.max > 0 && trace.result) {
    try {
      const m = prepareUses(xb, tb, conditions, ctx.runtime, usesHelpers(ctx.runtime), {
        turn: true, fieldSettled, ...(unnerve ? { unnerve } : {}), ...(endure ? { endure: true as const } : {}), ...(extraSet ? extra : {}),
      });
      const search = createTurnSearch(m, {
        move, row, trace, context,
        rerun: (next) => {
          countCalculation(ctx);
          const nextTrace: CalcTrace = {};
          return { row: calculateTurnMove(move, next.attacker, next.defender, next.conditions, next.context, ctx.runtime, nextTrace), trace: nextTrace };
        },
      }, spread || opts?.attackerBuild ? false : undefined);
      entry = { row, search, follow: !spread && !opts?.attackerBuild && search.needsAttackerHP(), trace };
    } catch (error) {
      if (error instanceof NotEstimated) throw error;
      notEstimated(`This matchup could not be calculated: ${error instanceof Error ? error.message : "Unknown engine error."}`);
    }
  }
  ctx.memo.searches.set(key, entry);
  return entry;
}

/**
 * Unnerve and As One for one pair's step (data/abilities.ts unnerve, asoneglastrier, asonespectrier onFoeTryEatItem:
 * any foe of the Berry's holder that is still in, an exploding user no longer: World.ghost): whether the attacker and
 * the target are foes (each one's own then stops the other's Berries, as the step reads it), and whether a third
 * Pokémon's stops the target's or the attacker's. Undefined when that is the step's own reading.
 */
function turnUnnerve(w: World, attacker: DoublesSlotId | null, target: DoublesSlotId): TurnUnnerve | undefined {
  const holders = DOUBLES_SLOTS.filter((slot) => alive(w, slot) && slot !== w.ghost && UNNERVES.has(w.mons[slot]!.build.abilityId));
  const third = (holder: DoublesSlotId) => holders.some((slot) => slot !== attacker && slot !== target && isFoe(slot, holder));
  // status2 (T2E §3.5): a residual hit's source not in battle has no Unnerve of its own and no Berries.
  const unnerve = { foes: !!attacker && isFoe(attacker, target) && w.ghost !== attacker, target: third(target), attacker: !!attacker && third(attacker) };
  return unnerve.foes && !unnerve.target && !unnerve.attacker ? undefined : unnerve;
}

/** A build's currentHP for an engine HP (toBuild: Dynamax HP scaled back), null at full. */
function baseHP(ctx: Ctx, slot: DoublesSlotId, hp: number): number | null {
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const ratio = maxHP / baseMaxHP;
  const base = ratio !== 1 ? (hp + 0.5) / ratio : hp;
  return base >= baseMaxHP ? null : base;
}

/**
 * The attacker after a step that did not follow its HP (a spread move's, a face's probe): the step read it at full HP,
 * so an HP or pinch Berry its own recoil or retaliation made it eat there is put back (with the pinch Berry's rise);
 * the turn changes that HP once afterwards (spreadStep, faceHit: afterLoss eats it where it is due).
 */
function unfollowed(before: BattleBuild, after: BattleBuild, standIn = false): BattleBuild {
  if (standIn) after = unStandIn(true, before, after);
  const item = before.itemId;
  if (after.itemId === item || !(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item])) return after;
  const stat = PINCH_STAT_BERRIES[item];
  if (!stat) return { ...after, itemId: item };
  const rise = (after.abilityId === "ripen" ? 2 : 1) * (after.abilityId === "contrary" ? -1 : 1) * (after.abilityId === "simple" ? 2 : 1);
  return { ...after, itemId: item, boosts: { ...after.boosts, [stat]: Math.max(-6, Math.min(6, (after.boosts[stat] ?? 0) - rise)) } };
}

/**
 * status2 C14 (SPEC2 §3.5): under Heal Block an HP Berry's TryEatItem (TryHeal) fails and Shell Bell heals nothing, so a
 * heal-blocked Pokémon's HP Berry (as the attacker, its Shell Bell too) reads as Leftovers in a step (no damage change, held
 * through the hit); searchFor applies it from eot.healBlock, and unStandIn puts the real item back after the step.
 */
function healStandIn(w: World, slot: DoublesSlotId, attacker: boolean): boolean {
  const mon = w.mons[slot];
  if (!mon?.eot.healBlock || !itemWorks(w, mon.build)) return false;
  const item = mon.build.itemId;
  return (HEALING_BERRIES.has(item) && item !== "enigmaberry") || (attacker && item === "shellbell");
}

/** The real item back for a heal-block stand-in (healStandIn) that the step's build still holds as Leftovers. */
function unStandIn(standIn: boolean, before: BattleBuild, after: BattleBuild): BattleBuild {
  return standIn && after.itemId === "leftovers" && before.itemId !== "leftovers" ? { ...after, itemId: before.itemId } : after;
}

/** The build after a step: the search's side for it (HP aside). */
function fromSide(build: BattleBuild, side: TurnSide): BattleBuild {
  return { ...buildAt(build, side, null, build.abilityActive, true), currentHP: null };
}

const sideKey = (side: TurnSide) => JSON.stringify({ ...side, hp: 0 });
/** A boolean's, a number's or an absent value's text as an element of a JSON array (perf pass 1b: applyStep's signatures). */
const scalarText = (value: boolean | number | undefined) => (value === undefined ? "null" : typeof value === "number" && !Number.isFinite(value) ? "null" : String(value));
/** An absent count (JSON's null) as 0, a count from 0 to 62 as itself + 1, else -1 (not within childKey's bounds). */
const countPart = (value: number | undefined) => {
  const count = value ?? undefined;
  return count === undefined ? 0 : Number.isInteger(count) && count >= 0 && count < 63 ? count + 1 : -1;
};
/**
 * Perf pass 1b: applyStep's key of a child: one number for parts within these bounds (the ids below 4096, the conditions'
 * below 256, the hits below 64, the two counts absent or below 63), else the parts' JSON texts. Each set of parts has one key,
 * and two sets share a key only when every part's JSON text is the same (the signature's JSON array was the same).
 */
function childKey(attacker: number, fainted: boolean, target: number, knocked: boolean, landed: number, conditions: number,
  stopAt: number | undefined, faintedInHits: number | undefined): number | string {
  const stop = countPart(stopAt), inHits = countPart(faintedInHits);
  if (attacker < 4096 && target < 4096 && conditions < 256 && Number.isInteger(landed) && landed >= 0 && landed < 64 && stop >= 0 && inHits >= 0) {
    return ((((((attacker * 4096 + target) * 256 + conditions) * 64 + landed) * 64 + stop) * 64 + inHits) * 2 + (fainted ? 1 : 0)) * 2 + (knocked ? 1 : 0);
  }
  return `${attacker},${scalarText(fainted)},${target},${scalarText(knocked)},${scalarText(landed)},${conditions},${scalarText(stopAt)},${scalarText(faintedInHits)}`;
}
/** What a calculation says about the damage (two calculations with equal keys are one case of a hit). */
const damageKey = (row: MoveDamageResult) => JSON.stringify([row.min, row.max, row.rolls, row.hits, row.hitChances, row.alternate, row.effectiveName, row.effectivePower, row.effectiveType, row.effectiveCategory]);
function note(map: Map<string, { row: MoveDamageResult; mass: number }>, key: string, row: MoveDamageResult, mass: number) {
  const known = map.get(key);
  if (known) known.mass += mass; else map.set(key, { row, mass });
}

// ------------------------------------------------------------------------------------------------------------------
// Order (SPEC §4.1 step 4, §4.3): priority with the fractional part fixed at queue time, then Speed; ties uniform.
// ------------------------------------------------------------------------------------------------------------------

/** Whether every mass of `slot`'s HP is its maximum (Gale Wings), or null when the world holds both. */
function fullHP(ctx: Ctx, w: World, slot: DoublesSlotId): boolean | null {
  const max = ctx.hp[slot].maxHP;
  let full = false, not = false;
  for (const hp of marginal(w, slot).keys()) { if (hp >= max) full = true; else not = true; }
  return full && not ? null : full;
}

/** Gale Wings reads full HP when the queue is sorted (data/abilities.ts galewings onModifyPriority). */
function readsFullHP(ctx: Ctx, w: World, action: PendingAction): boolean {
  if (!action.moveId || !alive(w, action.slot)) return false;
  const build = w.mons[action.slot]!.build;
  if (build.abilityId !== "galewings") return false;
  const move = ctx.runtime.movesById.get(action.moveId)!;
  if (move.category === "Status") return move.type === "Flying";
  const info = moveInfo(ctx, w, action.slot, action.moveId, ctx.input.pokemon[action.slot]!.contexts[action.moveId]);
  return info.kind === "move" && info.effective.type === "Flying";
}

/** The integer priority an action is used with in this world (sim/battle.ts:2641-2649), without its fractional part. */
function priorityOf(ctx: Ctx, w: World, action: PendingAction): number {
  if (!action.moveId) return 0;
  // status2 M: a Dynamaxed Pokémon's status move is Max Guard (doubles-max.ts usedStatus).
  const move = maxHooks.usedStatus(kernelOf(ctx), w, action, ctx.runtime.movesById.get(action.moveId)!);
  // A fainted Pokémon's abilities and items give no ModifyPriority (sim/battle.ts runEvent skips fainted holders).
  if (!alive(w, action.slot)) return move.priority;
  const full = readsFullHP(ctx, w, action) ? fullHP(ctx, w, action.slot) ?? true : true;
  const build = { ...calcBuild(ctx, w, action.slot), currentHP: full ? null : Math.max(1, ctx.hp[action.slot].baseMaxHP - 1) };
  const context = ctx.input.pokemon[action.slot]!.contexts[action.moveId];
  // The memo key reads the field itself (ownConditions' terrain, magicRoom, gravity); the conditions are built on a miss only.
  const key = JSON.stringify([action.moveId, build, w.field.terrain, w.field.magicRoom, w.field.gravity, context]);
  let priority = ctx.memo.priorities.get(key);
  if (priority === undefined) ctx.memo.priorities.set(key, priority = turnPriority(move, build, ownConditions(ctx, w, action.slot), context, ctx.runtime));
  if (typeof priority !== "number") notEstimated(priority.reason);
  return priority;
}

function speedOf(ctx: Ctx, w: World, slot: DoublesSlotId, firstTurn = false): number {
  // Its Speed reads none of the calculation-only markers (turnMarks: types, grounding, the damage it takes, its critical hits).
  const build = calcBuild(ctx, w, slot, false);
  const side = w.sides[slotSide(slot)];
  const tailwind = side.tailwind;
  // The memo key reads the field itself (ownConditions' weather is effectiveWeather's; its terrain, trickRoom, magicRoom), and
  // the swamp (status2: SideConditions.swamp, which turnSpeed reads); the conditions are built on a miss only.
  const key = JSON.stringify([build, tailwind, effectiveWeather(w), w.field.terrain, w.field.trickRoom, w.field.magicRoom, firstTurn, !!side.pledge?.grass]);
  let speed = ctx.memo.speeds.get(key);
  if (speed === undefined) ctx.memo.speeds.set(key, speed = turnSpeed(build, tailwind, ownConditions(ctx, w, slot), ctx.runtime, firstTurn));
  return speed;
}

/**
 * An action's sort key (sim/battle-queue.ts:277-287, sim/battle.ts comparePriority): order ascending (absent 200; After You
 * 3, Quash 201: PendingAction.order), then priority and Speed descending. Generation 7's frozen priority and Speed keep the
 * order too.
 */
function keyOf(ctx: Ctx, w: World, action: PendingAction): { order: number; priority: number; speed: number } {
  const order = action.order ?? 200;
  if (action.frozen) return { order, ...action.frozen };
  return { order, priority: priorityOf(ctx, w, action) + action.fractional, speed: speedOf(ctx, w, action.slot) };
}

/** The actions tied at the head of the queue (sim/battle.ts comparePriority and speedSort). */
function topGroup(ctx: Ctx, w: World): PendingAction[] {
  let best: PendingAction[] = [];
  let top: { order: number; priority: number; speed: number } | null = null;
  for (const action of w.remaining) {
    const key = keyOf(ctx, w, action);
    const ahead = !top || key.order < top.order || (key.order === top.order
      && (key.priority > top.priority || (key.priority === top.priority && key.speed > top.speed)));
    if (ahead) { top = key; best = [action]; }
    else if (key.order === top!.order && key.priority === top!.priority && key.speed === top!.speed) best.push(action);
  }
  return best;
}

/** A world split where an order key reads HP it holds both sides of (Gale Wings' full HP; SPEC §4.3 loop step 1). */
function refine(ctx: Ctx, w: World): World[] {
  if (ctx.gen7) return [w];
  for (const action of w.remaining) {
    if (!readsFullHP(ctx, w, action) || fullHP(ctx, w, action.slot) !== null) continue;
    const max = ctx.hp[action.slot].maxHP;
    return condition(w, action.slot, (hp) => hp >= max).flatMap(({ world }) => refine(ctx, world));
  }
  return [w];
}

/**
 * The fractional priority outcomes of an action, fixed at queue time (sim/battle-queue.ts:249 FractionalPriority with
 * 0): Stall, Lagging Tail and Full Incense (-0.1), then Quick Draw (30% of attacks: 0.1) and Mycelium Might (status
 * moves: -0.1), then Quick Claw (20% while the value is at most 0) and an eaten Custap Berry (settleItems settledCustap).
 * Neither item works for a Mycelium Might holder's status move.
 */
function fractionalOutcomes(ctx: Ctx, build: BattleBuild, moveId: string | null, magicRoom: boolean): { value: number; chance: number; fact?: string }[] {
  const status = !moveId || ctx.runtime.movesById.get(moveId)!.category === "Status";
  const items = !magicRoom && build.abilityId !== "klutz" && !build.itemSuppressed;
  let value = 0;
  if ((items && (build.itemId === "laggingtail" || build.itemId === "fullincense")) || build.abilityId === "stall") value = -0.1;
  let outcomes: { value: number; chance: number; fact?: string }[] = [{ value, chance: 1 }];
  if (build.abilityId === "quickdraw" && !status) outcomes = [{ value: 0.1, chance: 0.3, fact: "Quick Draw" }, { value, chance: 0.7 }];
  if (build.abilityId === "myceliummight" && status) outcomes = outcomes.map((entry) => ({ ...entry, value: -0.1 }));
  const blocked = status && build.abilityId === "myceliummight";
  if (items && build.itemId === "quickclaw" && !blocked) {
    outcomes = outcomes.flatMap((entry) => entry.value <= 0
      ? [{ value: 0.1, chance: entry.chance * 0.2, fact: "Quick Claw" }, { ...entry, chance: entry.chance * 0.8 }] : [entry]);
  }
  if (build.settledCustap && !blocked) outcomes = outcomes.map((entry) => entry.value <= 0 ? { ...entry, value: 0.1 } : entry);
  return outcomes;
}

// ------------------------------------------------------------------------------------------------------------------
// Guards known before the walk (SPEC §4.1 step 2)
// ------------------------------------------------------------------------------------------------------------------

function presenceGuards(ctx: Ctx, w: World) {
  const { input } = ctx;
  const kernel = kernelOf(ctx);
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const build = w.mons[slot]!.build;
    // status2 (ADDENDUM2 §1.3, C27): presenceGuards keeps its loop and its order; each guard line calls its owner's hook in place.
    // As entered: Neutralizing Gas's suppression does not reach a Tatsugiri already commanding (PR).
    presenceHooks.commanderGuard(kernel, w, slot);
    // Under Neutralizing Gas the ability an Ability Shield keeps would replace an attacker's that the gas then suppresses.
    if (ctx.gas && ABILITY_REPLACERS.has(build.abilityId)) notEstimated(REASONS.withGas(abilityName(ctx, build.abilityId)));
    // Poison Puppeteer (PR's PRESENCE_THIRD_PARTY line; Imposter is the settle's).
    presenceHooks.thirdPartyGuard(kernel, w, slot);
    // A carried hidden release (C38: H; the stub gives today's semi-invulnerable reason).
    hiddenHooks.carriedStart(kernel, w, slot);
    const moveId = entry.action.moveId;
    if (!moveId || ctx.targetless.has(slot)) continue;
    const move = ctx.runtime.movesById.get(moveId)!;
    // A Dancer copies a dance move another Pokémon uses (sim/battle-actions.ts runMove; PR).
    presenceHooks.dancerGuard(kernel, w, slot, moveId);
    // Track A's guards (doubles-status.ts presenceGuards: the HP-changing status moves; CL's Sleep Talk and Uproar inside).
    statusHooks.presenceGuards(kernel, w, slot);
    // The presence moves (PR).
    presenceHooks.movesGuard(kernel, w, slot, move);
    // A move that uses another move (CL).
    callingHooks.callingGuard(kernel, w, slot);
    // Two different Pledges from partners combine (PR).
    presenceHooks.pledgeGuard(kernel, w, slot, move);
    // A Dynamaxed Pokémon's status move is Max Guard (M).
    maxHooks.statusMove(kernel, w, slot);
    // Custap Berry with Quick Draw or Mycelium Might (ST: doubles-start.ts custapGuard).
    startHooks.custapGuard(kernel, w, slot);
    // A G-Max move's random status, with a later action (M).
    maxHooks.randomStatusGuard(kernel, w, slot);
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The walk (SPEC §4.3)
// ------------------------------------------------------------------------------------------------------------------

function startWorld(ctx: Ctx, settle: DoublesSettle): World {
  const { input } = ctx;
  const mons: World["mons"] = {};
  const factors: Factor[] = [];
  for (const slot of DOUBLES_SLOTS) {
    const start = settle.slots[slot];
    if (!start) continue;
    const folded: BattleBuild = { ...start.folded, currentHP: null };
    const state = carriedState(ctx, slot, folded);
    const build = state.build ?? folded;
    // A Figy-family Berry eaten as the turn starts confused it (settleItems confused): a fresh confusion (SPEC §4.6).
    if (start.items.confused && !state.vol.confusion) state.vol.confusion = { attempts: 0, min: 2 };
    // status2 (ADDENDUM2 C19): what happened to it earlier this turn (pinned statsRaisedThisTurn, statsLoweredThisTurn,
    // usedItemThisTurn) and a Pokémon that switched in this turn (no action: moved from the start, T2E §3.5).
    const earlier = input.pokemon[slot]!.earlierThisTurn;
    mons[slot] = {
      build, fainted: false, moved: !!input.pokemon[slot]!.switchedIn, flinched: null, focusLost: false,
      charged: input.pokemon[slot]!.charged, protect: null, centre: null, helpingHand: 0, hurt: false, damagedBy: [], timesAttacked: 0,
      statsLowered: !!earlier?.statsLowered, statsRaised: !!earlier?.statsRaised, vol: state.vol, eot: state.eot,
    };
    if (state.mon) Object.assign(mons[slot]!, state.mon);
    if (start.copy) mons[slot]!.copy = { stages: { ...start.copy.stages }, by: start.copy.by };
    // Item history (only while the turn tracks items): an item used earlier this turn (Pickup reads it), the input's last item.
    if (ctx.tracksItems && earlier?.usedItem) mons[slot]!.usedItem = true;
    if (ctx.tracksItems && typeof input.pokemon[slot]!.lastItem === "string") mons[slot]!.lastItem = input.pokemon[slot]!.lastItem!;
    // An item the start settle used up (F3 §4.1: the input item, not a popped Air Balloon). One it ate at the turn's first
    // Update (settleItems: start.items.build has none) was used this turn (usedItemThisTurn: Pickup reads it; integration
    // 1a); a Terrain Seed used on entry (only `folded` drops it) was not.
    const held = input.pokemon[slot]!.build.itemId;
    if (ctx.tracksItems && held && !start.folded.itemId && held !== "airballoon") mons[slot]!.lastItem = held;
    if (ctx.tracksItems && held && !start.items.build.itemId && held !== "airballoon") mons[slot]!.usedItem = true;
    // The entry order's rank (only with a tie reader: ctx.entryReaders).
    const rank = input.entryOrder?.[slot];
    if (ctx.entryReaders && rank !== undefined) mons[slot]!.entry = rank;
    factors.push(pointFactor(slot, turnHP(start.folded, ctx.runtime).hp));
  }
  const side = (conditions: BattleConditions["attackerSide"]): SideState => {
    const out: SideState = {
      reflect: conditions.reflect, lightScreen: conditions.lightScreen, auroraVeil: conditions.auroraVeil, tailwind: conditions.tailwind,
      wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: !!conditions.safeguard, hazards: [],
    };
    // status2: Mist, Lucky Chant and the G-Max side conditions from an earlier turn, each only when the input sets it.
    if (conditions.mist) out.mist = true;
    if (conditions.luckyChant) out.luckyChant = true;
    if (conditions.gmaxResidual?.length) out.gmax = [...conditions.gmaxResidual];
    return out;
  };
  // status2 (T2P §9.2): a commanding Tatsugiri from an earlier turn (Training) and its Dondozo.
  for (const slot of DOUBLES_SLOTS) {
    if (!input.pokemon[slot]?.carried?.commanding || !mons[slot] || !mons[allyOf(slot)]) continue;
    mons[slot]!.commanding = allyOf(slot);
    mons[allyOf(slot)]!.commanded = slot;
  }
  const { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom } = input.field;
  const field: World["field"] = { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom };
  // status2: Mud Sport and Water Sport from an earlier turn, only when set (Ion Deluge is this turn's only).
  if (input.field.mudSport) field.mudSport = true;
  if (input.field.waterSport) field.waterSport = true;
  return { mass: 1, mons, sides: { own: side(input.field.attackerSide), opponent: side(input.field.defenderSide) }, field, remaining: [], executed: 0, factors };
}

/**
 * A Pokémon's state from earlier turns as the turn starts (status-eot SPEC §4.6, ADDENDUM §3.5.10): DoublesCarried mapped
 * into its moves-phase volatiles and its end-of-turn state. Sleep: the counter's decrease so far (attempts, twice each
 * with Early Bird: data/abilities.ts earlybird onBeforeMove), 0 without carried.sleep (a turn fact); Champions freeze:
 * the attempts; confusion: its attempts and the least duration (Axe Kick's 3); bad poison: the stage, 0 without
 * carried.toxic; the other end-of-turn fields copied (a trap's divisor 6 with Binding Band, else 8; a carried Yawn is
 * the one that lands now: 1); the Substitute's HP and the Ally Switch counter.
 */
function carriedState(ctx: Ctx, slot: DoublesSlotId, build: BattleBuild): { vol: MoveVolatiles; eot: EotState; mon?: Partial<MonState>; build?: BattleBuild } {
  const carried = ctx.input.pokemon[slot]!.carried ?? {};
  const vol: MoveVolatiles = {}, eotState: EotState = {};
  if (build.status === "slp") vol.sleep = { elapsed: (carried.sleep?.attempts ?? 0) * (build.abilityId === "earlybird" ? 2 : 1), rest: carried.sleep?.rest ?? false };
  if (build.status === "frz" && ctx.champions) vol.freeze = { attempts: carried.freeze?.attempts ?? 0 };
  if (carried.confusion) vol.confusion = { attempts: carried.confusion.attempts, min: carried.confusion.axeKick ? 3 : 2 };
  if (carried.substitute !== undefined) vol.substitute = carried.substitute;
  // status2 C23: 1 is "not used last turn" (no counter, no assumption).
  if (carried.allySwitch !== undefined && carried.allySwitch !== 1) vol.allySwitch = carried.allySwitch;
  if (build.status === "tox") eotState.toxic = carried.toxic ?? 0;
  if (carried.leechSeed) eotState.leechSeed = carried.leechSeed;
  if (carried.trap) eotState.trap = { source: carried.trap.source, divisor: carried.trap.bindingBand ? 6 : 8, ...(carried.trap.move ? { move: carried.trap.move } : {}) };
  if (carried.saltCure) eotState.saltCure = true;
  if (carried.aquaRing) eotState.aquaRing = true;
  if (carried.ingrain) eotState.ingrain = true;
  if (carried.curse) eotState.curse = true;
  if (carried.syrupBomb) eotState.syrupBomb = carried.syrupBomb;
  if (carried.yawn) eotState.yawn = 1;
  if (carried.perish !== undefined) eotState.perish = carried.perish;
  if (carried.wish !== undefined) eotState.wish = carried.wish;
  // Widened (status2 C33): a bare id keeps today's meaning; the object forms carry the user (E2 reads them).
  if (carried.futureMove) {
    const future = carried.futureMove;
    eotState.futureMove = typeof future === "string" ? { bare: future }
      : { move: future.move, source: "source" in future ? future.source : null, build: "build" in future ? future.build : null };
  }
  if (carried.cudChew) eotState.cudChew = carried.cudChew === true ? true : { berry: carried.cudChew, counter: 1 };
  // ---- status2 (SPEC2 §3.5, ADDENDUM2 §3.5, IN §4.1): each only when the input sets it ----
  if (!ctx.input.pokemon[slot]!.carried) return { vol, eot: eotState };
  const mon: Partial<MonState> = {};
  let world: BattleBuild | undefined;
  const ownMove = ctx.input.pokemon[slot]!.action.moveId;
  // A1: Stockpile's layers and counts (C17: absent counts are −layers each), Power Trick / Power Shift (the stored Attack and
  // Defense swapped), No Retreat, Minimize, Gastro Acid (the real ability kept, the build's suppressed), trapped, the stages.
  if (carried.stockpile) vol.stockpile = { layers: carried.stockpile.layers, def: carried.stockpile.def ?? -carried.stockpile.layers, spd: carried.stockpile.spd ?? -carried.stockpile.layers };
  if (carried.powerTrick || carried.powerShift) {
    const stats = getBuildStats(build, ctx.runtime);
    if (stats) world = { ...build, storedStats: { atk: stats.def, def: stats.atk, spa: stats.spa, spd: stats.spd, spe: stats.spe } };
    if (carried.powerTrick) vol.powerTrick = true;
    if (carried.powerShift) vol.powerShift = true;
  }
  if (carried.noRetreat) vol.noRetreat = true;
  if (carried.minimize) vol.minimize = true;
  if (carried.gastroAcid) { vol.gastroAcid = build.abilityId; world = { ...(world ?? build), abilityId: GAS_STAND_IN }; }
  if (carried.trapped) vol.trapped = true;
  if (carried.stages) {
    const stages = Object.fromEntries(Object.entries(carried.stages).filter(([, stage]) => !!stage));
    if (Object.keys(stages).length) vol.stages = stages;
  }
  // C38: a two-turn move charged last turn is released this turn (vol.locked); the six hidden moves hold it out of reach.
  if (carried.charging) {
    vol.locked = carried.charging;
    if (SEMI_INVULNERABLE_MOVES.has(carried.charging)) eotState.hidden = carried.charging as NonNullable<EotState["hidden"]>;
  }
  // A2: Tar Shot, Foresight or Miracle Eye, Telekinesis, Heal Block, Embargo (its item suppressed on the world build), Nightmare,
  // Octolock, Attract.
  if (carried.tarShot) vol.tarShot = true;
  if (carried.foresight) vol.revealed = "foresight";
  if (carried.miracleEye) vol.revealed = "miracleeye";
  if (carried.telekinesis !== undefined) eotState.telekinesis = carried.telekinesis;
  if (carried.healBlock !== undefined) { eotState.healBlock = true; eotState.healBlockLeft = carried.healBlock; }
  if (carried.embargo !== undefined) { eotState.embargo = carried.embargo; world = { ...(world ?? build), itemSuppressed: true }; }
  if (carried.nightmare) eotState.nightmare = true;
  if (carried.octolock) eotState.octolock = carried.octolock;
  if (carried.attract) vol.attract = carried.attract;
  // D: a pending Opportunist or Mirror Herb copy, the Berserk lock, Glaive Rush, Ripen's weakened Berry.
  if (carried.copy && Object.keys(carried.copy).length) mon.copy = { stages: { ...carried.copy }, by: build.abilityId === "opportunist" ? "opportunist" : "mirrorherb" };
  if (carried.berryLocked) vol.berryLocked = true;
  if (carried.glaiveRush) vol.glaiveRush = true;
  if (carried.berryWeaken) vol.berryWeaken = true;
  // H: Lock-On. N: the stall counter (readers rule: only with its own protecting move or Endure; 1: none), the recharge, a
  // Destiny Bond still up, Laser Focus, Taunt, Encore and Disable with their turns, the once-a-battle effects.
  if (carried.lockOn) vol.lockOn = carried.lockOn;
  const protecting = !!ownMove && (!!PROTECT_MOVES[ownMove] || ownMove === "endure" || ownMove === "wideguard" || ownMove === "quickguard" || maxHooks.maxGuardAction(ctx.input, slot));
  if (carried.stall !== undefined && carried.stall !== 1 && protecting) vol.stall = carried.stall;
  if (carried.mustRecharge) vol.mustRecharge = true;
  if (carried.destinyBond) mon.destinyBond = true;
  if (carried.laserFocus) vol.laserFocus = true;
  if (carried.taunt !== undefined) { vol.taunt = true; eotState.tauntLeft = carried.taunt; }
  if (carried.encore) { vol.encore = carried.encore.move; eotState.encoreLeft = carried.encore.turns; }
  if (carried.disable) { vol.disabled = carried.disable.move; eotState.disableLeft = carried.disable.turns; }
  if (carried.onceUsed?.length) vol.onceUsed = [...carried.onceUsed];
  // CL: an Uproar from an earlier turn (vol.uproar: its turns left after this one). PR: a carried Bide.
  if (carried.uproar !== undefined) vol.uproar = carried.uproar - 1;
  if (carried.bide) vol.bide = { ...carried.bide };
  // (furyCutter, rollout, defenseCurl and ppLeft: PR reads Fury Cutter's, Rollout's, Defense Curl's and the PP left from the
  // input; commanding: startWorld sets Commander's pair.)
  return { vol, eot: eotState, ...(Object.keys(mon).length ? { mon } : {}), ...(world ? { build: world } : {}) };
}

/** The start world after the turn's first Update (doubles-status.ts turnStartUpdate), as the guards known before the walk read it. */
function firstUpdated(ctx: Ctx, settle: DoublesSettle): World {
  const w = startWorld(ctx, settle);
  statusHooks.turnStartUpdate(kernelOf(ctx), w);
  return w;
}

/** The turn's root worlds: the queue with each action's fractional priority outcomes (Quick Claw, Quick Draw). */
function rootWorlds(ctx: Ctx, settle: DoublesSettle): World[] {
  // status2 (T2P §4.2–§4.4): the start variants (doubles-start.ts variants; the stub: the one settle), each at its weight.
  const variants = startHooks.variants(kernelOf(ctx), settle);
  if (variants.length === 1 && variants[0].weight === 1) return rootWorldsOf(ctx, variants[0].settle);
  return variants.flatMap(({ weight, settle: one }) => rootWorldsOf(ctx, one, weight));
}

function rootWorldsOf(ctx: Ctx, settle: DoublesSettle, weight = 1): World[] {
  const base = startWorld(ctx, settle);
  base.mass = weight;
  // A status its holder's own ability cures cannot stand at the turn's start in pinned Showdown (its SetStatus stops it):
  // generation 7's one sort reads the Speed without it (doubles-status.ts ownCuresAtStart).
  if (ctx.gen7) statusHooks.ownCuresAtStart(kernelOf(ctx), base);
  // status2: N's used Protean or Libero (a stub), once per present slot.
  for (const slot of DOUBLES_SLOTS) if (base.mons[slot]) historyHooks.proteanUsed(kernelOf(ctx), base, slot);
  let worlds: { world: World; facts: { index: number; text: string }[] }[] = [{ world: base, facts: [] }];
  // PR's root actions (a commanding Tatsugiri takes none; the stub: all) and no action for a Pokémon that switched in this
  // turn (T2E §3.5); each keeps its index (the statistics' place).
  const queued = presenceHooks.rootActions(kernelOf(ctx), ctx.actions.map((action, index) => ({ ...action, index }))).filter((action) => !ctx.input.pokemon[action.slot]?.switchedIn);
  queued.forEach((action) => {
    const index = action.index;
    const build = base.mons[action.slot]!.build;
    const outcomes = settle.slots[action.slot]?.fractional ?? fractionalOutcomes(ctx, build, action.moveId, base.field.magicRoom);
    worlds = worlds.flatMap(({ world, facts }) => outcomes.map((outcome) => {
      const next = cloneWorld(world, world.mass * outcome.chance);
      next.remaining = [...next.remaining, { index, slot: action.slot, moveId: action.moveId, target: action.target, fractional: outcome.value }];
      return { world: next, facts: outcome.fact ? [...facts, { index, text: `${outcome.fact}: ${ctx.names[action.slot]} moves first in its priority bracket.` }] : facts };
    }));
  });
  // Generation 7 sorts the queue once, at the turn's start (no re-sort after an action: sim/battle.ts:2919 needs gen 8).
  if (ctx.gen7) {
    for (const { world } of worlds) {
      world.remaining = world.remaining.map((action) => ({ ...action, frozen: { priority: priorityOf(ctx, world, action) + action.fractional, speed: speedOf(ctx, world, action.slot, true) } }));
    }
  }
  for (const { world, facts } of worlds) {
    for (const fact of facts) if (ctx.stats) bump(ctx.stats[fact.index].facts, fact.text, world.mass);
  }
  return worlds.map(({ world }) => world);
}

function walk(ctx: Ctx, settle: DoublesSettle): World[] {
  // The turn's first Update (doubles-status.ts turnStartUpdate): after generation 7 froze the order, before the first sort.
  let worlds = rootWorlds(ctx, settle);
  for (const world of worlds) statusHooks.turnStartUpdate(kernelOf(ctx), world);
  // status2: PR's turn start (Beak Blast's heat, Shell Trap's set; a stub).
  for (const world of worlds) presenceHooks.turnStart(kernelOf(ctx), world);
  const done: World[] = [];
  while (worlds.length) {
    const next: World[] = [];
    for (const w0 of worlds) {
      // status2 R: the per-slot names and HP of the Pokémon standing in this world (a no-op until a newcomer stands in one).
      syncOccupants(ctx, w0);
      // status2 R-E: an Emergency Exit or Wimp Out holder of a side with a bench whose HP straddles half is split there first
      // (doubles-switch.ts exitWorlds; none without a bench), so each action reads whether it was above half.
      for (const w of refine(ctx, w0).flatMap((world) => switchHooks.exitWorlds(kernelOf(ctx), world))) {
        if (battleOver(ctx, w)) { done.push(w); continue; }
        const group = topGroup(ctx, w);
        if (!group.length) { done.push(w); continue; }
        // Each tied action is next with equal chance (sim/battle.ts:429-458 speedSort shuffles each tied run, at
        // every sort from generation 8 and once in generation 7). An action that changed the weather set it this turn
        // (World.weatherSet: a new duration, or none up). status2 R: the switch-outs the action set are made as it ends
        // (doubles-switch.ts betweenActions: a newcomer's weather counts as the action's; null keeps the world).
        for (const action of group) {
          ctx.acting = action;
          for (const acted of execute(ctx, cloneWorld(w, w.mass / group.length), action)) {
            for (const out of switchHooks.betweenActions(kernelOf(ctx), acted) ?? [acted]) {
              if (out.field.weather !== w.field.weather) out.weatherSet = true;
              next.push(out);
            }
          }
          ctx.acting = null;
        }
      }
    }
    worlds = DOUBLES_REFERENCE.on ? next.filter((world) => world.mass > 0) : mergeWorlds(next, ctx.mode === "all");
    if ((worlds.length > BUDGET.worlds || entryCount(worlds) > BUDGET.entries) && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);
  }
  // status2 R: the slots' starting Pokémon's names and HP again for what reads the context after the walk.
  syncOccupants(ctx, null);
  return DOUBLES_REFERENCE.on ? done : mergeWorlds(done, ctx.mode === "all");
}

/**
 * status2 R (Step 2): the per-slot data the hook modules read by slot (kernel.names, kernel.hp) follow the Pokémon standing
 * there in `w` (null: the slots' starting Pokémon): a newcomer's name from benchNames and its turnHP. Every world of one
 * action has the same occupants (a switch-out is made only as the action ends: doubles-switch.ts betweenActions), so the
 * walk sets them once per world before its next action; R-E sets them where it reads finished worlds one by one (the end
 * of turn, the result's per-world reads). Without a newcomer in any world (no bench: MonState.id is never set) it does nothing.
 */
function syncOccupants(ctx: Ctx, w: World | null) {
  if (!ctx.renamed && !w?.benched) return;
  let renamed = false;
  let signature = "";
  for (const slot of DOUBLES_SLOTS) {
    const mon = w?.mons[slot];
    if (mon?.id === undefined && !mon?.entered) {
      ctx.names[slot] = ctx.startNames[slot];
      ctx.hp[slot] = ctx.startHP[slot];
      delete ctx.occupants[slot];
      signature += "|";
      continue;
    }
    renamed = true;
    signature += `|${mon.id ?? ""}${mon.entered ? "+" : ""}`;
    ctx.names[slot] = monName(ctx, slot, mon.id);
    if (mon.id === undefined) delete ctx.occupants[slot]; else ctx.occupants[slot] = mon.id;
    if (mon.id === undefined) ctx.hp[slot] = ctx.startHP[slot];
    else if (mon.id.startsWith("slot:")) ctx.hp[slot] = ctx.startHP[mon.id.slice(5) as DoublesSlotId];
    else {
      const { maxHP, baseMaxHP } = turnHP(mon.build, ctx.runtime);
      ctx.hp[slot] = { maxHP, baseMaxHP };
    }
  }
  ctx.renamed = renamed;
  ctx.input = renamed ? occupantView(ctx, w!, signature) : ctx.baseInput;
  ctx.gas = renamed && ctx.baseGas ? gasView(ctx, w!, signature) : ctx.baseGas;
}

/**
 * status2 R-E: the turn's Neutralizing Gas as the occupants of `w` stand: a slot whose starting Pokémon left keeps none of its
 * entries (holder, suppressed, shielded, ability); a newcomer the gas suppresses (MonState.gassed: its own ability behind the
 * stand-in) is suppressed with its ability, one an Ability Shield keeps is shielded. One view per occupant set.
 */
function gasView(ctx: Ctx, w: World, signature: string): DoublesGas {
  const known = ctx.gasViews.get(signature);
  if (known) return known;
  const base = ctx.baseGas!;
  const own = (slot: DoublesSlotId) => !w.mons[slot] || w.mons[slot]!.id === undefined;
  const view: DoublesGas = {
    holders: base.holders.filter(own), suppressed: base.suppressed.filter(own), shielded: base.shielded.filter(own),
    abilities: Object.fromEntries(Object.entries(base.abilities).filter(([slot]) => own(slot as DoublesSlotId))),
  };
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.id === undefined) continue;
    if (mon.gassed !== undefined) { view.suppressed.push(slot); view.abilities[slot] = mon.gassed; }
    else if (mon.build.itemId === "abilityshield" && !GAS_PROOF_ABILITIES.has(mon.build.abilityId)) view.shielded.push(slot);
  }
  ctx.gasViews.set(signature, view);
  return view;
}

/**
 * status2 R-E: the input as the hook modules read it while `w`'s occupants stand (STEP2.md's identity item 3): each slot whose
 * Pokémon came in this turn holds its entry as it came in (a bench Pokémon's build, moves and kept state; a slot's starting
 * Pokémon back in: its own input entry), with no action, no contexts, no last move and switchedIn (pinned newlySwitched: Payback,
 * Bolt Beak; the readers' "since it came in"). One view per occupant set, made once (the caches keyed by input object hit).
 */
function occupantView(ctx: Ctx, w: World, signature: string): DoublesTurnInput {
  const known = ctx.views.get(signature);
  if (known) return known;
  const base = ctx.baseInput;
  const pokemon = { ...base.pokemon };
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || (mon.id === undefined && !mon.entered)) continue;
    const blank = { contexts: {}, charged: false, action: { moveId: null, target: null }, switchedIn: true as const, lastMove: null };
    if (mon.id === undefined || mon.id.startsWith("slot:")) {
      const own = base.pokemon[mon.id === undefined ? slot : mon.id.slice(5) as DoublesSlotId]!;
      pokemon[slot] = { build: own.build, ...blank, ...(own.moves ? { moves: own.moves } : {}) };
      continue;
    }
    const side = slotSide(slot);
    const entry = base.bench?.[side]?.find((each) => each.id === mon.id);
    if (!entry) continue;
    pokemon[slot] = { build: entry.build, ...blank, ...(entry.moves ? { moves: entry.moves } : {}), ...(entry.carried ? { carried: entry.carried } : {}) };
  }
  const view: DoublesTurnInput = { ...base, pokemon };
  ctx.views.set(signature, view);
  return view;
}

/**
 * Whether the battle is over in this world before its next action (sim/battle.ts faintMessages then checkWin, after
 * each action; runAction stops the queue once `ended`): a side with no Pokémon left to switch in (canSwitch false) has
 * every Pokémon it had in place fainted. No later action runs (its step's skip fact says so), and the end of turn passes
 * it through (doubles-eot.ts over). With canSwitch absent the turn assumes a Pokémon is left (doubles-eot.ts's fact).
 * status2 R: a side's bench, where given, takes canSwitch's place (sideCanSwitch).
 */
function battleOver(ctx: Ctx, w: World): boolean {
  const over = (["own", "opponent"] as const).some((side) => {
    if (sideCanSwitch(ctx.input, side) !== false) return false;
    const present = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side && w.mons[slot]);
    return present.length > 0 && present.every((slot) => w.mons[slot]!.fainted);
  });
  if (!over) return false;
  for (const action of w.remaining) {
    const step = stepOf(ctx, action);
    if (!step || action.moveId === null) continue;
    // A fainted Pokémon's action is skipped as execute skips it (sim/battle.ts:2707).
    // (Its card's faintsBeforeMoving stays a fainting before its turn came: here the battle ended first.)
    if (w.mons[action.slot]!.fainted) bump(step.skipped, "Faints before it moves.", w.mass);
    else bump(step.skipped, "The battle ends before it moves.", w.mass);
  }
  return true;
}

// ------------------------------------------------------------------------------------------------------------------
// One action (SPEC §4.4)
// ------------------------------------------------------------------------------------------------------------------

function execute(ctx: Ctx, w: World, action: PendingAction): World[] {
  w.remaining = w.remaining.filter((entry) => entry !== action);
  const step = stepOf(ctx, action);
  const mon = w.mons[action.slot]!;
  // Both foe slots empty: the action stays queued for the others' order reads and does nothing (no target, no step).
  if (ctx.targetless.has(action.slot)) {
    if (!mon.fainted) mon.moved = true;
    return [w];
  }
  if (action.moveId !== null && action.source === "instruct") {
    // status2 CL: an instructed move is the target's second use (DoublesStep.copied), not an action of the turn's order.
    if (step) { step.positionSum += (w.executed + 0.5) * w.mass; step.positionMass += w.mass; }
  } else if (action.moveId !== null) {
    w.executed++;
    if (step) { bump(step.order, w.executed, w.mass); step.positionSum += w.executed * w.mass; step.positionMass += w.mass; }
  }
  // A fainted Pokémon's action stays queued and does nothing (sim/battle.ts:2707).
  if (mon.fainted) {
    if (action.moveId !== null) {
      if (step) bump(step.skipped, "Faints before it moves.", w.mass);
      bump(ctx.faintsBefore, action.slot, w.mass);
    }
    return [w];
  }
  mon.moved = true;
  // status2: an Encore that changes the queued move rewrites the action before BeforeMove (D's doubles-guards.ts
  // encoreRewrites): one world per target getRandomTarget can pick (integration 1a), each run as its own action.
  const kernel = kernelOf(ctx);
  const rewrites = mon.vol.encore ? guardHooks.encoreRewrites(kernel, w, action) : null;
  if (rewrites && rewrites.length > 1) return rewrites.flatMap((rewrite) => executeUsed(ctx, rewrite.world, action, guardHooks.encoreRewrite(kernel, rewrite.world, rewrite.action)));
  return executeUsed(ctx, w, action, guardHooks.encoreRewrite(kernel, w, rewrites ? rewrites[0].action : action));
}

/** execute from BeforeMove on, for `used`: the action as it is used (an Encore's rewrite of the queued `action`). */
function executeUsed(ctx: Ctx, w: World, action: PendingAction, used: PendingAction): World[] {
  const step = stepOf(ctx, action);
  // BeforeMove (doubles-status.ts beforeMove, Track A): the worlds that stop there (skip facts), then those that go on to
  // the move. No move (moveId null) runs it too and then does nothing.
  const { go, stopped } = statusHooks.beforeMove(kernelOf(ctx), w, used);
  const out: World[] = [...stopped];
  // No move (Splash) past BeforeMove: its AfterMoveSecondary on itself ends a Berserk or Anger Shell lock (status2 Step 1 #2).
  if (used.moveId === null) {
    // status2 CL: a No move past its BeforeMove is Splash, the battle's last move (Copycat).
    if (ctx.historyReaders.lastMove) for (const world of go) world.lastMove = "splash";
    // PR (status2 wave 1b): No move past BeforeMove is Splash's use: lastSuccessfulMoveThisTurn not a Fusion move (TP1·F2).
    if (ctx.historyReaders.didSomething) for (const world of go) world.lastSuccessful = null;
    return [...out, ...go.flatMap((world) => guardHooks.noMoveUnlock(kernelOf(ctx), world, used.slot))];
  }
  for (const next of go) {
    if (step) step.moves += next.mass;
    const before = step ? selfLossSnapshot(next) : null;
    for (const world of runMove(ctx, next, used)) {
      // A user that faints in its own move (the Explosion family, Final Gambit, recoil, Life Orb, what its targets hit back with).
      if (step && before && world.mons[action.slot]!.fainted) stepFact(ctx, action, selfFaintFact(ctx, before, action, step), world.mass);
      out.push(world);
    }
  }
  return out;
}

type LossSnapshot = Partial<Record<DoublesSlotId, { build: BattleBuild; protect: MonState["protect"]; substitute: boolean }>>;
function selfLossSnapshot(w: World): LossSnapshot {
  return Object.fromEntries(DOUBLES_SLOTS.filter((slot) => w.mons[slot]).map((slot) => [slot, { build: w.mons[slot]!.build, protect: w.mons[slot]!.protect, substitute: !!w.mons[slot]!.vol.substitute }]));
}

/**
 * "{Name} faints ({sources})." for a user that faints in its own move: the move itself (selfdestruct, Final Gambit's
 * damageCallback, Mind Blown and its kin), or what can take its HP in it as the move starts (recoil, the Pokémon it
 * reached hitting back on contact: Rough Skin, Iron Barbs, Rocky Helmet, Spiky Shield; a Jaboca or Rowap Berry;
 * Liquid Ooze on a draining move; Life Orb), none of which Magic Guard lets through. A one-hit move into a Substitute
 * meets none of the target's DamagingHit handlers (Rough Skin, Iron Barbs, Rocky Helmet, a Jaboca or Rowap Berry:
 * ADDENDUM §4.13.8); Liquid Ooze still acts on its drain (K2).
 */
function selfFaintFact(ctx: Ctx, before: LossSnapshot, action: PendingAction, step: StepStats): string {
  const name = ctx.names[action.slot];
  const user = before[action.slot]!.build;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const context = ctx.input.pokemon[action.slot]!.contexts[move.id];
  const info = resolveTurnMove(move, { ...user, currentHP: null }, ctx.input.field, context, ctx.runtime);
  const own = info.kind === "move" && !info.transformed;
  if (own && (SELF_DESTRUCT_MOVES.has(move.id) || SELF_COST_MOVES.has(move.id) || move.id === "finalgambit")) return `${name} faints (${move.name}).`;
  const sources: string[] = [];
  if (info.kind === "move" && user.abilityId !== "magicguard") {
    if (info.recoil && user.abilityId !== "rockhead") sources.push("recoil");
    const physical = info.effective.category === "Physical";
    for (const slot of step.hits.keys()) {
      const target = before[slot];
      if (!target || slot === action.slot) continue;
      const items = !ctx.input.field.magicRoom && target.build.abilityId !== "klutz";
      const reached = !(target.substitute && move.multihit === null && substituteHooks.meetsSubstitute(user, info));
      if (reached && info.contact && ["roughskin", "ironbarbs"].includes(target.build.abilityId)) sources.push(abilityName(ctx, target.build.abilityId));
      if (reached && info.contact && items && target.build.itemId === "rockyhelmet") sources.push(itemName(ctx, "rockyhelmet"));
      if (info.contact && target.protect === "spikyshield") sources.push(moveName(ctx, "spikyshield"));
      if (reached && items && target.build.itemId === (physical ? "jabocaberry" : "rowapberry")) sources.push(itemName(ctx, target.build.itemId));
      if (info.drain && target.build.abilityId === "liquidooze") sources.push(abilityName(ctx, "liquidooze"));
      if (reached && (target.build.abilityId === "innardsout" || (target.build.abilityId === "aftermath" && info.contact))) sources.push(abilityName(ctx, target.build.abilityId));
    }
    const sheerForce = user.abilityId === "sheerforce" && info.secondaries;
    if (user.itemId === "lifeorb" && !ctx.input.field.magicRoom && user.abilityId !== "klutz" && !sheerForce) sources.push(itemName(ctx, "lifeorb"));
  }
  const unique = [...new Set(sources)];
  return unique.length ? `${name} faints (${unique.join(", ")}).` : `${name} faints.`;
}

function runMove(ctx: Ctx, w: World, action: PendingAction): World[] {
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const context = ctx.input.pokemon[action.slot]!.contexts[move.id];
  const before = snapshot(ctx, w);
  // status2: a carried release leaves its hidden state (H; a stub).
  hiddenHooks.release(kernelOf(ctx), w, action);
  // Status moves: doubles-status.ts statusMove (Track A).
  const status = move.category === "Status" && !context?.useZ;
  const moved = status ? statusHooks.statusMove(kernelOf(ctx), w, action, maxHooks.usedStatus(kernelOf(ctx), w, action, move)) : damagingMove(ctx, w, action, move);
  // Sparkling Aria's own AfterMove (sparklingAria), not its Z-Move's or Max Move's.
  const aria = !status && move.id === "sparklingaria" ? moveInfo(ctx, w, action.slot, move.id, context) : null;
  for (const world of moved) {
    if (aria?.kind === "move" && !aria.transformed) sparklingAria(ctx, world, action, aria);
    delete world.hitTargets;
  }
  const out = moved.flatMap((world) => {
    const gone = DOUBLES_SLOTS.filter((slot) => before[slot]?.alive && world.mons[slot]!.fainted && UNNERVES.has(world.mons[slot]!.build.abilityId));
    return gone.length ? unnerveEnds(ctx, world, gone) : [world];
  });
  // Whether Emergency Exit and Wimp Out are checked after this action (doubles-status.ts exitsAfter: Track A's C7).
  const exits = statusHooks.exitsAfter(kernelOf(ctx), action, move);
  // status2 (SPEC2 §4.1 step 7): the move's own AfterMove (A1: Spit Up's Stockpile End), then the onAnyAfterMove copies (D);
  // both stubs keep the world.
  const kernel = kernelOf(ctx);
  const after: World[] = [];
  for (const world of out) {
    const moved = abilityHooks.afterMove(kernel, world, action);
    for (const each of moved ?? [world]) {
      const copied = guardHooks.afterMoveCopies(kernel, each, action);
      if (copied) after.push(...copied); else after.push(each);
    }
  }
  for (const world of after) {
    // Parting Shot's drops set off no Eject Pack (data/items.ts ejectpack onAfterBoost: activeMove partingshot returns).
    eventGuards(ctx, before, world, exits, move.id !== "partingshot");
    gasShieldGuard(ctx, world);
    // The items Trick or Switcheroo moved in this action (World.itemsMoved) matter only to its eventGuards (no Symbiosis);
    // likewise the items a takeItem removed (World.itemsTaken, status2).
    delete world.itemsMoved;
    delete world.itemsTaken;
    // The history the later actions read (status2 ADDENDUM2 §3.5; only with their readers): Fusion's and Dancer's, Copycat's.
    noteHistory(ctx, world, move.id);
  }
  // PR's after-action (Dancer's copies; a stub).
  const done: World[] = [];
  for (const world of after) {
    const copies = presenceHooks.afterAction(kernel, world, action);
    if (copies) done.push(...copies); else done.push(world);
  }
  return done;
}

// ------------------------------------------------------------------------------------------------------------------
// status2: the queue, calling and memory kernel (T2P §9.3, ADDENDUM2 §3.5, C36). Inert: no hook calls them in Step 0.
// ------------------------------------------------------------------------------------------------------------------

/**
 * After You ("next": order 3) and Quash ("last": order 201) on `slot`'s queued action (sim/battle-queue.ts prioritizeAction,
 * data/moves.ts afteryou, quash). Generation 7's frozen queue keeps the order of use: a later After You's action before an
 * earlier one's, a later Quash's after (data/mods/gen7/moves.ts quash: inserted before the residual). Whether it was queued.
 * (doubles-status.ts order's queue edit, moved verbatim.)
 */
function prioritize(ctx: Ctx, w: World, slot: DoublesSlotId, where: "next" | "last"): boolean {
  const queued = w.remaining.find((each) => each.slot === slot);
  if (!queued) return false;
  const after = where === "next";
  const orders = w.remaining.map((each) => each.order ?? 200);
  let value = after ? 3 : 201;
  if (ctx.gen7) value = after ? Math.min(3, ...orders.filter((each) => each < 200).map((each) => each - 0.001)) : Math.max(201, ...orders.filter((each) => each > 200).map((each) => each + 0.001));
  w.remaining = w.remaining.map((each) => (each === queued ? { ...each, order: value } : each));
  return true;
}

/** The history the later actions read, after `moveId`'s use (only with its readers: SPEC2 §4.9): Fusion's and Dancer's, Copycat's. */
function noteHistory(ctx: Ctx, w: World, moveId: string) {
  if (ctx.historyReaders.didSomething) { w.didSomething = true; w.lastSuccessful = moveId; }
  if (ctx.historyReaders.lastMove && !callingHooks.ownsLastMove(moveId)) w.lastMove = moveId;
}

/**
 * A Dancer's copy (PR; sim/battle-actions.ts runMove with externalMove): `slot` uses `moveId` at `target` as its own action,
 * with its own BeforeMove (doubles-status.ts beforeMove) and no PP; `index`: its statistics (extraStep's).
 */
function externalUse(ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, target: DoublesSlotId | null, index: number): World[] {
  const action: PendingAction = { index, slot, moveId, target, fractional: 0, external: true };
  // status2 integration 1b: a copy (a Dancer's) sorts right after the action that set it off (as CL-6's instructed move): it is
  // no action of the turn's order (DoublesStep.order), so only its position for the steps' sort.
  const step = ctx.stats?.[index];
  if (step?.copied) { step.positionSum += (w.executed + 0.5) * w.mass; step.positionMass += w.mass; }
  const { go, stopped } = statusHooks.beforeMove(kernelOf(ctx), w, action);
  return [...stopped, ...go.flatMap((world) => runMove(ctx, world, action))];
}

/**
 * The one calling path (C36; CL): `action`'s user uses `moveId` at `target` with no BeforeMove and no PP, at `opts.priority`
 * (default: the caller's) and with `opts.prankster` (default: its own); a damaging move through damagingMove, a status move
 * through doubles-status.ts runCalledStatus. The statistics are the caller's (its action's index).
 */
function useCalled(ctx: Ctx, w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean; snatched?: true; bounced?: true }): World[] {
  const move = ctx.runtime.movesById.get(moveId);
  if (!move) notEstimated(REASONS.notIn2v2(moveId));
  const called: PendingAction = { ...action, moveId, target };
  const priority = opts?.priority ?? (action.frozen ? action.frozen.priority - action.fractional : priorityOf(ctx, w, action));
  const status = move.category === "Status" && !ctx.input.pokemon[action.slot]?.contexts[moveId]?.useZ;
  const worlds = status
    ? statusHooks.runCalledStatus(kernelOf(ctx), w, called, move, target, { priority, ...(opts?.prankster !== undefined ? { prankster: opts.prankster } : {}), ...(opts?.snatched ? { snatched: true as const } : {}), ...(opts?.bounced ? { bounced: true as const } : {}) })
    : damagingMove(ctx, w, called, move, priority);
  for (const world of worlds) noteHistory(ctx, world, moveId);
  return worlds;
}

/**
 * A second step of `slot` this turn (DoublesStep.copied): its statistics' index (one per key, slot, move, source and Pokémon:
 * status2 R's `id`, a newcomer's MonState.id), or -1 outside the recording walk.
 */
function extraStep(ctx: Ctx, key: "Dancer" | "Instruct", slot: DoublesSlotId, moveId: string, from?: number, id?: string): number {
  if (!ctx.stats) return -1;
  const known = ctx.stats.findIndex((step) => step.copied === key && step.slot === slot && step.moveId === moveId && step.from === from && step.id === id);
  if (known >= 0) return known;
  ctx.stats.push({
    slot, moveId, order: new Map(), moves: 0, positionSum: 0, positionMass: 0, skipped: new Map(), facts: new Map(), hits: new Map(), copied: key,
    ...(from !== undefined ? { from } : {}), ...(id !== undefined ? { id } : {}),
  });
  return ctx.stats.length - 1;
}

/**
 * Sparkling Aria's onAfterMove (data/moves.ts sparklingaria): with its user still in and the move's secondaries kept (no
 * Sheer Force), each Pokémon it hit (World.hitTargets) that is burned is cured, the user aside: with more than one hit
 * whatever its Shield Dust, with one only where the secondary's volatile landed (secondaryLands: Shield Dust, Covert Cloak).
 */
function sparklingAria(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>) {
  const hit = w.hitTargets ?? [];
  const user = w.mons[action.slot]!.build;
  if (user.abilityId === "sheerforce") return;
  const cures = (slot: DoublesSlotId) => slot !== action.slot && alive(w, slot) && w.mons[slot]!.build.status === "brn" && (hit.length > 1 || secondaryLands(ctx, w, action.slot, slot, info));
  if (!alive(w, action.slot)) {
    // A user Life Orb knocks out after the hits has not fainted yet at AfterMove: W's doubles-pairs.ts ariaFaint.
    pairHooks.ariaFaint(kernelOf(ctx), w, action, hit, cures);
    return;
  }
  for (const slot of hit) {
    const mon = w.mons[slot]!;
    if (slot === action.slot || !alive(w, slot) || mon.build.status !== "brn") continue;
    if (hit.length === 1 && !secondaryLands(ctx, w, action.slot, slot, info)) continue;
    mon.build = { ...mon.build, status: "" };
    hitFact(ctx, action, slot, `${moveName(ctx, "sparklingaria")}: its burn is cured.`, w.mass);
  }
}

/** What eventGuards compares across an action. */
export type Snapshot = Partial<Record<DoublesSlotId, { boosts: BattleBuild["boosts"]; itemId: string; above: boolean; alive: boolean }>>;

/** What eventGuards compares across an action: each Pokémon's stages, item, whether it was alive, and whether some HP of it was above half. */
function snapshot(ctx: Ctx, w: World): Snapshot {
  const out: Snapshot = {};
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon) continue;
    out[slot] = { boosts: { ...mon.build.boosts }, itemId: mon.build.itemId, alive: !mon.fainted, above: [...marginal(w, slot).keys()].some((hp) => hp * 2 > ctx.hp[slot].maxHP) };
  }
  return out;
}

/**
 * The third-party reactions to an action the turn does not follow, as event guards (SPEC §2.2): Opportunist and
 * Mirror Herb copying a foe's rise (onFoeAfterBoost); Symbiosis passing its item to a partner that used its own
 * (onAllyAfterUseItem); and, with a later action, the switch-outs: Eject Button and Red Card after a damaging hit
 * (onAfterMoveSecondary), Eject Pack after a drop (onAfterBoost), Emergency Exit and Wimp Out falling to half HP; with
 * none, those reach only the end of turn (doubles-eot.ts leaving). A rise and a drop are the boost() events the action
 * made (World.boosted, recorded by doubles-status.ts applyBoosts: accuracy and evasion included, a rise Defiant undid
 * included, a clearBoosts none) and, for a damaging move, the stages its pairs' steps changed (the pairwise engine's
 * boost() records none; applyStep adds a drop Defiant or Competitive hid). `damaging`: the action was a damaging move;
 * Emergency Exit and Wimp Out act only from damaging-move paths (sim/battle-actions.ts:530,542,1015,1132,1395; status-eot
 * C7), not after a status move's HP change or a confusion self-hit. `ejectPack`: false for Parting Shot, whose drops set
 * off no Eject Pack (data/items.ts ejectpack onAfterBoost).
 */
function eventGuards(ctx: Ctx, before: Snapshot, w: World, damaging = true, ejectPack = true) {
  const kernel = kernelOf(ctx);
  const events = w.boosted;
  delete w.boosted;
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot], was = before[slot];
    if (!mon || !was || !was.alive) continue;
    const rose = !!events?.[slot]?.rose || (damaging && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0)));
    // A clearBoosts (Clear Smog: World.boosted reset) takes stages with no boost event: only the recorded drops count there.
    const fell = !!events?.[slot]?.fell || (damaging && !events?.[slot]?.reset && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0)));
    // Opportunist and Mirror Herb copying the rise (D's doubles-guards.ts copierGuard, moved verbatim).
    if (rose) guardHooks.copierGuard(kernel, w, slot);
    // An item Trick or Switcheroo moved is not used: no Symbiosis (data/abilities.ts symbiosis onAllyAfterUseItem; ADDENDUM T11; D's),
    // asked where the item it held is gone.
    if (was.itemId && !mon.build.itemId) guardHooks.symbiosisAfterAction(kernel, w, slot, was);
    // A gas holder's Eject Pack takes it out with its Neutralizing Gas, whether or not an action follows.
    if (!mon.fainted && ejectPack && fell && was.itemId === "ejectpack" && !w.field.magicRoom && mon.build.abilityId !== "klutz") gasEnds(ctx, w, slot);
    if (mon.fainted) continue;
    const item = was.itemId;
    const usable = !w.field.magicRoom && mon.build.abilityId !== "klutz";
    const ejects = ejectPack && fell && item === "ejectpack" && usable;
    const exits = damaging && ["emergencyexit", "wimpout"].includes(mon.build.abilityId) && was.above && [...marginal(w, slot).keys()].some((hp) => hp * 2 <= ctx.hp[slot].maxHP);
    // The switch-out: with a later living action its replacement is not known, with none the end of turn's (R's doubles-switch.ts).
    // status2 R-E: with the side's bench, Emergency Exit (in the move, where its HP is now at most half) and then the Eject Pack
    // (at AfterMove: waits while a switch is flagged) are both R's to resolve as the action ends.
    if (sideBench(ctx, slot)) {
      if (exits) switchHooks.switchOut(kernel, w, slot, "exit", null);
      if (ejects) switchHooks.switchOut(kernel, w, slot, "ejectpack", null);
    } else if (ejects || exits) switchHooks.switchOut(kernel, w, slot, ejects ? "ejectpack" : "exit", null);
  }
}

/**
 * Cheek Pouch's heal as `slot` eats a Berry that heals nothing itself, a status Berry (data/abilities.ts cheekpouch
 * onEatItem: a third of its base maximum HP, capped at the maximum; none once fainted), applied to `w` in place.
 */
function pouchHeal(ctx: Ctx, w: World, slot: DoublesSlotId) {
  // status2 C14: Heal Block stops Cheek Pouch's heal (sim/battle.ts heal: TryHeal).
  if (w.mons[slot]!.build.abilityId !== "cheekpouch" || w.mons[slot]!.eot.healBlock) return;
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const pouch = Math.max(1, Math.floor(baseMaxHP / 3));
  const [only] = mapHP(w, slot, (hp) => {
    if (hp <= 0) return { hp, tag: "" };
    const healed = Math.min(maxHP, hp + pouch);
    noteHeal(ctx, slot, "Cheek Pouch", healed - hp);
    return { hp: healed, tag: "" };
  });
  // One tag: the same world, its HP moved.
  w.factors = only.world.factors;
}

/**
 * Neutralizing Gas ends as its last holder leaves (faints, switches out or is dragged out) or loses it (Core Enforcer):
 * pinned Showdown data/abilities.ts neutralizinggas onEnd then runs every other active Pokémon's ability Start again
 * (speed-sorted: Intimidate, Hospitality's heal...), and from then on the abilities it suppressed act (sim/pokemon.ts
 * ignoringAbility). Not followed: not estimated while a Pokémon whose ability it suppressed is still in.
 */
function gasEnds(ctx: Ctx, w: World, slot: DoublesSlotId) {
  const gas = ctx.gas;
  if (!gas?.holders.includes(slot) || gas.holders.some((other) => other !== slot && alive(w, other))) return;
  if (gas.suppressed.some((other) => other !== slot && alive(w, other))) notEstimated(REASONS.gasEnds);
}

/**
 * Under Neutralizing Gas, an Ability Shield keeps its holder's ability only while it is held and works (pinned Showdown
 * sim/pokemon.ts ignoringAbility reads hasItem('Ability Shield'): not under Magic Room). A Shield lost (Knock Off, Thief,
 * Covet), Magic Room starting or ending, or an Embargo on it (status2) changes which abilities act: not followed.
 */
function gasShieldGuard(ctx: Ctx, w: World) {
  const shielded = ctx.gas?.shielded.filter((slot) => alive(w, slot)) ?? [];
  // status2 (integration 1a): a suppressed Pokémon whose Ability Shield now works (given by Bestow, Recycle or Symbiosis; Magic
  // Room ending) gets its ability back (ignoringAbility: hasItem('Ability Shield'), which ignores Klutz).
  if (ctx.gas?.suppressed.some((slot) => alive(w, slot) && w.mons[slot]!.build.itemId === "abilityshield" && !w.field.magicRoom && !w.mons[slot]!.build.itemSuppressed)) notEstimated(REASONS.gasShield);
  if (!shielded.length) return;
  // status2 (SPEC2 §8.4): an Embargo on it ignores the Shield too (hasItem reads ignoringItem); a carried one never let it act.
  if (w.field.magicRoom !== ctx.input.field.magicRoom || shielded.some((slot) => w.mons[slot]!.build.itemId !== "abilityshield" || w.mons[slot]!.build.itemSuppressed)) notEstimated(REASONS.gasShield);
}

/**
 * A Pokémon fainting (sim/battle.ts faintMessages): its side's faint count (Last Respects), Soul-Heart's +1 Sp. Atk on
 * every other living holder (data/abilities.ts soulheart onAnyFaint), and a strong weather ending with its last
 * living holder (data/abilities.ts desolateland onEnd and its kin). `byHit`: a hit the step counts knocked it out.
 */
function faint(ctx: Ctx, w: World, slot: DoublesSlotId, byHit = false) {
  const mon = w.mons[slot]!;
  if (mon.fainted) return;
  mon.fainted = true;
  // Fainting clears its volatiles (sim/battle.ts faintMessages: clearVolatile): its Substitute too.
  if (mon.vol.substitute) mon.vol = { ...mon.vol, substitute: undefined };
  if (!byHit && ctx.stats) ctx.otherFaints.add(statKey(ctx, slot));
  // Its Neutralizing Gas ends as it faints (faintMessages runs its ability's End).
  gasEnds(ctx, w, slot);
  w.sides[slotSide(slot)].faintedThisTurn += 1;
  // Receiver and Power of Alchemy copy the fainted ally's ability (onAllyFaint): K's doubles-reactions.ts allyFaint.
  reactionHooks.allyFaint(kernelOf(ctx), w, slot);
  for (const other of DOUBLES_SLOTS) if (alive(w, other) && w.mons[other]!.build.abilityId === "soulheart") selfBoost(ctx, w, other, { spa: 1 }, null);
  fieldChangeHooks.fainted(kernelOf(ctx), w, slot);
  const keeper = STRONG_WEATHERS[w.field.weather];
  if (keeper && mon.build.abilityId === keeper && !DOUBLES_SLOTS.some((other) => alive(w, other) && w.mons[other]!.build.abilityId === keeper)) {
    const field = w.field;
    w.field = { ...w.field, weather: "" };
    // A field change outside a field move (FC; a stub).
    fieldChangeHooks.stepField(kernelOf(ctx), w, field);
  }
  // Commander's pair (PR; a stub).
  presenceHooks.onFaint(kernelOf(ctx), w, slot);
  // Its hidden state and charge go; a Sky Drop user frees the Pokémon it held (H's doubles-hidden.ts fainted).
  hiddenHooks.fainted(kernelOf(ctx), w, slot);
}

/**
 * The knocker-out's rise after a move's faint batch of `count` Pokémon (KO_BOOSTS: AfterFaint runs once per batch with
 * its length, sim/battle.ts faintMessages), while the knocker-out is still in. Beast Boost and Eelevate raise the
 * best raw stat (sim/pokemon.ts getBestStat(true, true): stored stats, the first of equals).
 */
function koBoost(ctx: Ctx, w: World, slot: DoublesSlotId, count: number) {
  if (count <= 0 || !alive(w, slot)) return;
  const build = w.mons[slot]!.build;
  const kind = KO_BOOSTS[build.abilityId];
  if (!kind) return;
  let stat: CombatStat = kind === "best" ? "atk" : kind;
  if (kind === "best") {
    const stats = getBuildStats(build, ctx.runtime);
    if (!stats) notEstimated(REASONS.notIn2v2(abilityName(ctx, build.abilityId)));
    let best = 0;
    for (const each of STATS) if (stats![each] > best) { best = stats![each]; stat = each; }
  }
  selfBoost(ctx, w, slot, { [stat]: count }, null);
}

// ------------------------------------------------------------------------------------------------------------------
// Status moves (SPEC §4.4 step 9): doubles-status.ts statusMove (Track A), through the kernel. The helpers they share:
// ------------------------------------------------------------------------------------------------------------------

/** A living Pokémon still has a damaging move queued (what a change to another Pokémon's types or damage taken can reach). */
function laterDamaging(ctx: Ctx, w: World): boolean {
  return w.remaining.some((entry) => alive(w, entry.slot) && !!entry.moveId
    && (ctx.runtime.movesById.get(entry.moveId)!.category !== "Status" || !!ctx.input.pokemon[entry.slot]!.contexts[entry.moveId]?.useZ));
}

/** The weather as the field's effectiveWeather reads it (sim/field.ts: none while a living Cloud Nine or Air Lock holder suppresses it). */
function effectiveWeather(w: World): BattleConditions["weather"] {
  return DOUBLES_SLOTS.some((slot) => alive(w, slot) && WEATHER_NEGATORS.has(w.mons[slot]!.build.abilityId)) ? "" : w.field.weather;
}

// ------------------------------------------------------------------------------------------------------------------
// Damaging moves (SPEC §4.4 steps 4-8, §4.5)
// ------------------------------------------------------------------------------------------------------------------

/** The move's calculation against `target` as it is used (after ModifyType: an -ate ability, Weather Ball...), memoised. */
function usedRow(ctx: Ctx, w: World, attacker: DoublesSlotId, moveId: string, target: DoublesSlotId, context: MoveContext | undefined): MoveDamageResult {
  // status2 (A2, F2 §2.3): Electrify on the user or Ion Deluge on the field types the move as used (contextFor's retype).
  const retype = w.mons[attacker]!.vol.electrify ? "electrify" : w.field.ionDeluge ? "iondeluge" : undefined;
  if (retype && !context?.retype) context = { ...context, retype };
  const conditions = conditionsFor(ctx, w, attacker, target, false);
  const key = JSON.stringify(["type", moveId, calcBuild(ctx, w, attacker), calcBuild(ctx, w, target), conditions, context]);
  let row = ctx.memo.rows.get(key);
  if (!row) {
    countCalculation(ctx);
    ctx.memo.rows.set(key, row = calculateTurnMove(ctx.runtime.movesById.get(moveId)!, calcBuild(ctx, w, attacker), calcBuild(ctx, w, target), { ...conditions, defenderSide: { ...conditions.defenderSide, protect: false, priorityShield: false } }, context, ctx.runtime));
  }
  return row;
}

/** The type the move has when it is used against `target` (after ModifyType: an -ate ability, Weather Ball...), from its calculation. */
function usedType(ctx: Ctx, w: World, attacker: DoublesSlotId, moveId: string, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, context: MoveContext | undefined): string {
  return usedRow(ctx, w, attacker, moveId, target, context).effectiveType ?? info.effective.type;
}

/**
 * The Z-Move or Max Move a converted move is when used against `target`: the type it takes first (Weather Ball,
 * Terrain Pulse, Revelation Dance, Multi-Attack, a Max Move's -ate ability) picks it (hit-loop.ts usedMoveName), which
 * resolveTurnMove, before the calculation types the move, names Breakneck Blitz or Max Strike. Its own effects follow it.
 */
function usedMove(ctx: Ctx, w: World, attacker: DoublesSlotId, moveId: string, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): { name: string; type: string } {
  if (!info.transformed || !["Breakneck Blitz", "Max Strike"].includes(info.effective.name)) return { name: info.effective.name, type: info.effective.type };
  const row = usedRow(ctx, w, attacker, moveId, target, ctx.input.pokemon[attacker]!.contexts[moveId]);
  return { name: row.effectiveName ?? info.effective.name, type: row.effectiveType ?? info.effective.type };
}

/** The attacker's breaker ignores the target's breakable ability (Mold Breaker and its kin, ignoreAbility moves), unless an Ability Shield keeps it. */
function breaks(w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): boolean {
  const user = w.mons[attacker]!.build, holder = w.mons[target]!.build;
  if (holder.itemId === "abilityshield" && !w.field.magicRoom) return false;
  return MOLD_BREAKERS.has(user.abilityId) || IGNORE_ABILITY_MOVES.has(info.effective.id);
}

/** Powder immunity (sim/pokemon.ts runStatusImmunity('powder')): Grass types, Overcoat, Safety Goggles. */
function powderImmune(ctx: Ctx, w: World, slot: DoublesSlotId): boolean {
  const build = w.mons[slot]!.build;
  return typesOf(ctx, build).includes("Grass") || build.abilityId === "overcoat" || (build.itemId === "safetygoggles" && itemWorks(w, build));
}

export type Redirection = { slot: DoublesSlotId; by: string };
/** The centres of attention (MonState.centre): the move that makes one and its RedirectTarget handler priority. */
const CENTRES: Record<NonNullable<MonState["centre"]>, { by: string; priority: number }> = {
  spotlight: { by: "Spotlight", priority: 2 }, followme: { by: "Follow Me", priority: 1 }, ragepowder: { by: "Rage Powder", priority: 1 },
};

/**
 * Redirection (sim/pokemon.ts getMoveTargets: priorityEvent('RedirectTarget') sorted by sim/battle.ts:413-419):
 * Spotlight on a foe of the attacker (data/moves.ts spotlight condition onFoeRedirectTargetPriority 2; only the start
 * rows set it, the turn guards the move), Follow Me and Rage Powder of the attacker's foes (1; Rage Powder not on a
 * powder-immune attacker), then Lightning Rod and Storm Drain of any other Pokémon for a move of their type (0; not
 * pledge moves; breakable), equal priorities by the holder's Speed, then by its ability's effectOrder (when it entered),
 * which the turn does not know. The first that applies takes the move (fastExit), even when it is the chosen target,
 * with the other Pokémon it ties with (`ties`); null when none applies.
 */
function redirection(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, moveId: string, context: MoveContext | undefined,
  type?: string): { taken: Redirection; ties: DoublesSlotId[]; tied: Redirection[] } | null {
  // status2 (SPEC2 §3.5): `type`, the move's type as used when the caller knows it (a called or retyped move), else usedType.
  const handlers: { slot: DoublesSlotId; priority: number; speed: number; by: string }[] = [];
  for (const slot of DOUBLES_SLOTS) {
    if (slot === attacker || !alive(w, slot)) continue;
    const mon = w.mons[slot]!;
    if (mon.centre && isFoe(slot, attacker) && !(mon.centre === "ragepowder" && powderImmune(ctx, w, attacker))) {
      handlers.push({ slot, priority: CENTRES[mon.centre].priority, speed: speedOf(ctx, w, slot), by: CENTRES[mon.centre].by });
    }
    const drawn = REDIRECT_ABILITIES[mon.build.abilityId];
    if (drawn && !breaks(w, attacker, slot, info) && !moveId.endsWith("pledge") && (type ?? usedType(ctx, w, attacker, moveId, target, info, context)) === drawn) {
      handlers.push({ slot, priority: 0, speed: speedOf(ctx, w, slot), by: abilityName(ctx, mon.build.abilityId) });
    }
  }
  if (!handlers.length) return null;
  handlers.sort((a, b) => b.priority - a.priority || b.speed - a.speed);
  // One holder's two handlers (Follow Me and Lightning Rod) are one Pokémon: the move goes to it either way.
  const top = handlers[0];
  const tiedHandlers = handlers.filter((handler) => handler.slot !== top.slot && handler.priority === top.priority && handler.speed === top.speed);
  const ties = [...new Set(tiedHandlers.map((handler) => handler.slot))];
  // Each tied Pokémon's first handler (status2: the entry order may decide between them, history.entryTie).
  const tied = ties.map((slot) => ({ slot, by: tiedHandlers.find((handler) => handler.slot === slot)!.by }));
  return { taken: { slot: top.slot, by: top.by }, ties, tied };
}

/**
 * The redirection that takes the move (redirection). A tie between two holders: the entry order decides (N's
 * doubles-history.ts entryTie: the older ability state), or with it unknown, not estimated.
 */
function redirect(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, moveId: string, context: MoveContext | undefined,
  type?: string): Redirection | null {
  const found = redirection(ctx, w, attacker, target, info, moveId, context, type);
  if (found?.ties.length) {
    // status2 N (C37): the oldest ability state among the tied holders (doubles-history.ts entryTie), pairwise; not known: not estimated.
    let first = found.taken.slot;
    for (const tie of found.ties) {
      const older = historyHooks.entryTie(kernelOf(ctx), w, first, tie);
      if (older === null) notEstimated(REASONS.needsEntryOrder(found.taken.by, ctx.names[first], ctx.names[tie]));
      first = older;
    }
    return first === found.taken.slot ? found.taken : found.tied[found.ties.indexOf(first)];
  }
  return found?.taken ?? null;
}

/** The foe across from `slot` (sim/battle.ts getRandomTarget's last resort: foe.active[length - 1 - position]): the same screen side. */
function across(slot: DoublesSlotId): DoublesSlotId {
  const [left, right] = foesOf(slot);
  return slot.endsWith("left") ? left : right;
}

/** A Pokémon's Showdown position (sim/pokemon.ts position) in this world: its slot's, or its ally's after an Ally Switch. */
const showdownPosition = (w: World, slot: DoublesSlotId) => SHOWDOWN_POSITION[positionOf(w, slot)].position;

/**
 * Spread targets in Showdown's order (sim/pokemon.ts getMoveTargets): the adjacent ally first, then the foes by position
 * (sim/pokemon.ts:732-735, :809-814), their positions after an Ally Switch (ADDENDUM A5).
 */
function spreadTargets(w: World, attacker: DoublesSlotId, targetType: string): DoublesSlotId[] {
  const foes = [...foesOf(attacker)].sort((a, b) => showdownPosition(w, a) - showdownPosition(w, b)).filter((slot) => alive(w, slot));
  const ally = allyOf(attacker);
  return [...(targetType === "allAdjacent" && alive(w, ally) ? [ally] : []), ...foes];
}

/**
 * Whether `slot` is grounded (sim/pokemon.ts:2148-2160 isGrounded): Gravity, Ingrain, Smack Down (EotState), Iron Ball;
 * then not Flying (a Roosted Pokémon is not Flying unless Terastallized: data/moves.ts roost condition onType), Levitate,
 * Eelevate, Magnet Rise (EotState) or Air Balloon.
 */
function grounded(ctx: Ctx, w: World, slot: DoublesSlotId): boolean {
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (w.field.gravity) return true;
  if (mon.eot.ingrain || mon.eot.smackedDown) return true;
  const item = itemWorks(w, build) ? build.itemId : "";
  if (item === "ironball") return true;
  // Its types in this world (typesIn: a Roosted Pokémon is not Flying unless Terastallized).
  if (typesIn(ctx, w, slot).includes("Flying")) return false;
  if (build.abilityId === "levitate" || build.abilityId === "eelevate") return false;
  if (mon.eot.magnetRise) return false;
  // status2: Telekinesis after Magnet Rise (sim/pokemon.ts isGrounded).
  if (mon.eot.telekinesis) return false;
  return item !== "airballoon";
}

/**
 * A build's types (a Terastallized one's Tera Type but Stellar); status2: its world types (BuildBase.types, after a setType)
 * in place of its species', then its added type (Forest's Curse, Trick-or-Treat): pinned getTypes without the Type event.
 */
function typesOf(ctx: Ctx, build: BattleBuild): readonly string[] {
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? [build.configuration.teraType] : null;
  if (tera) return tera;
  const base = build.types ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [];
  return build.addedType ? [...base, build.addedType] : base;
}

/**
 * status2 (SPEC2 §3.5): `slot`'s types in this world (pinned getTypes, PS/sim/pokemon.ts): a Tera type but Stellar alone;
 * else its world types or its species', through Roost's Type event (data/moves.ts roost condition onType: no Flying), with
 * Normal when none is left (generation 5 on), then its added type.
 */
function typesIn(ctx: Ctx, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot]!;
  const build = mon.build;
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? build.configuration.teraType : null;
  if (tera) return [tera];
  let types = [...(build.types ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [])];
  if (mon.eot.roosted && types.includes("Flying")) types = types.filter((type) => type !== "Flying");
  if (!types.length) types = ["Normal"];
  return build.addedType ? [...types, build.addedType] : types;
}

/**
 * status2 (SPEC2 §3.5; F3 §4.1): `slot` used or ate `item` (pinned eatItem / useItem: pokemon.lastItem, usedItemThisTurn);
 * a Cud Chew holder's Berry eaten this way (data/abilities.ts cudchew onEatItem: not one Bug Bite or Pluck took, which is
 * not its own eat) is re-eaten at the end of a later turn: counter 2, or 1 when the queue is empty (the end of turn). A
 * no-op unless the turn keeps item history (ctx.tracksItems).
 */
function noteItemUse(ctx: Ctx, w: World, slot: DoublesSlotId, item: string) {
  if (!ctx.tracksItems || !item) return;
  const mon = w.mons[slot];
  if (!mon) return;
  mon.lastItem = item;
  mon.usedItem = true;
  if (mon.build.abilityId === "cudchew" && item.endsWith("berry")) mon.eot = { ...mon.eot, cudChew: { berry: item, counter: ctx.inEndOfTurn ? 1 : 2 } };
}

/**
 * Where a damaging move goes in one world (resolveTargets). `darts`: Dragon Darts' smart targets, one dart each while
 * both pass the hit steps (sim/pokemon.ts getSmartTargets). `failed`: with no target, the facts already say why it fails
 * (no "no target" fact).
 */
export type Resolution = { world: World; targets: DoublesSlotId[]; spread: boolean; darts?: true; facts: string[]; failed?: true; swap?: string };

/**
 * The dex target type `attacker`'s move is used with in this world: a Z-Move's own (getActiveZMove: Clangorous
 * Soulblaze's allAdjacentFoes), a Max Move's adjacentFoe, and the spread ModifyMove makes (data/moves.ts expandingforce:
 * Psychic Terrain and a grounded user; terastarstorm: Terapagos-Stellar), which useMoveInner then retargets
 * (sim/battle-actions.ts).
 */
function usedTargetType(ctx: Ctx, w: World, attacker: DoublesSlotId, move: ChampionsMove, info: Extract<TurnMove, { kind: "move" }>): string {
  const targetType = info.isZ ? info.effective.target || "normal" : info.isMax ? "adjacentFoe" : move.target;
  if (!info.transformed && ((move.id === "expandingforce" && w.field.terrain === "Psychic" && grounded(ctx, w, attacker))
    || (move.id === "terastarstorm" && w.mons[attacker]!.build.speciesId === "terapagosstellar"))) return "allAdjacentFoes";
  return targetType;
}

/**
 * Whether the move keeps its chosen target (no redirection, sim/pokemon.ts getMoveTargets): Snipe Shot's own
 * tracksTarget, not its Max Move's (the move used), and Stalwart's and Propeller Tail's on any move (their onModifyMove).
 */
function tracksTarget(w: World, attacker: DoublesSlotId, move: ChampionsMove, info: Extract<TurnMove, { kind: "move" }>): boolean {
  return (TRACKS_TARGET_MOVES.has(move.id) && !info.transformed) || TRACKING_ABILITIES.has(w.mons[attacker]!.build.abilityId);
}

/** The targets a move reaches in this world (SPEC §4.4 step 4), with the worlds a random target or a redirection tie splits into. */
function resolveTargets(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, type?: string): Resolution[] {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const context = ctx.input.pokemon[attacker]!.contexts[move.id];
  const targetType = usedTargetType(ctx, w, attacker, move, info);
  if (SPREAD_TARGETS.has(targetType)) return [{ world: w, targets: spreadTargets(w, attacker, targetType), spread: true, facts: [] }];
  const living = foesOf(attacker).filter((slot) => alive(w, slot));
  const tracks = tracksTarget(w, attacker, move, info);
  const darts = move.id === "dragondarts" && !info.transformed;
  // `swap`: the fact for a hit an Ally Switch sends to the Pokémon now at the chosen position (kept unless redirected).
  let picks: { world: World; target: DoublesSlotId; facts: string[]; swap?: string }[];
  if (targetType === "randomNormal") {
    // sim/battle.ts getRandomTarget: one living foe at random.
    picks = living.map((target) => ({ world: living.length > 1 ? cloneWorld(w, w.mass / living.length) : w, target, facts: [] }));
  } else {
    const aimed = action.target!;
    // Positions (ADDENDUM §3.5.1): the move is aimed at a position, whose Pokémon an Ally Switch can change; a tracking
    // move keeps the Pokémon chosen at queue time, its user's own ally included (sim/battle-queue.ts:268 originalTarget,
    // sim/battle.ts:2440-2447). One aimed at its user's ally's place after that ally's Ally Switch, where its user now
    // stands, has no target (sim/battle.ts:2456-2462; A2), and Dragon Darts there is not followed (A2, p1:149).
    if (!tracks && !isFoe(attacker, aimed) && occupant(w, aimed) === attacker) {
      if (darts) notEstimated(REASONS.dartsAimSelf);
      if (["adjacentAlly", "any", "normal"].includes(targetType)) {
        return [{ world: w, targets: [], spread: false, facts: [`${move.name} fails: after Ally Switch, ${ctx.names[attacker]} stands in ${ctx.names[allyOf(attacker)]}'s place.`], failed: true }];
      }
    }
    const chosen = tracks ? aimed : occupant(w, aimed);
    const swap = chosen !== aimed ? `Ally Switch: ${move.name} hits ${ctx.names[chosen]} in ${ctx.names[aimed]}'s place.` : undefined;
    if (alive(w, chosen)) picks = [{ world: w, target: chosen, facts: [], ...(swap ? { swap } : {}) }];
    // A move aimed at a fainted ally keeps that target; one aimed at a fainted foe goes to the other foe, or with none
    // left to the foe across (sim/battle.ts:2464-2487 getTarget, getRandomTarget: foe.active[length - 1 - position]).
    // Redirection then runs on that target, and the move fails only when it is still a fainted one (sim/pokemon.ts:824-840).
    else if (!isFoe(attacker, chosen)) picks = [{ world: w, target: chosen, facts: [] }];
    else if (!living.length) {
      // An empty slot (no Pokémon) stands for the fainted foe there: redirection reads nothing more of the target. The
      // foe across is the one across from where the attacker stands now (ADDENDUM §3.5.1).
      const facing = occupant(w, across(positionOf(w, attacker)));
      const fallen = w.mons[facing] ? facing : foesOf(attacker).find((slot) => w.mons[slot]);
      picks = fallen ? [{ world: w, target: fallen, facts: [] }] : [];
    }
    else picks = [{ world: w, target: living[0], facts: [`${ctx.names[chosen]} fainted: ${move.name} hits ${ctx.names[living[0]]}.`] }];
  }
  if (!picks.length) return [{ world: w, targets: [], spread: false, facts: [] }];
  return picks.flatMap(({ world, target, facts, swap }) => {
    const taken = tracks ? null : redirect(ctx, world, attacker, target, info, move.id, context, type);
    if (!taken && !alive(world, target)) return [{ world, targets: [], spread: false, facts: [] }];
    const routed = taken ? taken.slot : target;
    const routeFacts = taken && taken.slot !== target ? [...facts, takesFact(ctx, taken, move)] : facts;
    // The Ally Switch fact is the caller's to state once TryMove passes (a Sucker Punch failing on the new occupant hits no one).
    const moved = !(taken && taken.slot !== target) && swap ? { swap } : {};
    // getSmartTargets: Dragon Darts' target's partner too, unless that is the user or has fainted; a redirection
    // handler that applies turns smart targeting off (data/moves.ts followme, data/abilities.ts lightningrod).
    const second = allyOf(routed);
    if (!darts || taken || second === attacker || !alive(world, second)) return [{ world, targets: [routed], spread: false, facts: routeFacts, ...moved }];
    return [{ world, targets: [routed, second], spread: false, darts: true as const, facts: routeFacts, ...moved }];
  });
}

/** "Lightning Rod: Raichu takes Thunderbolt." */
function takesFact(ctx: Ctx, taken: Redirection, move: ChampionsMove): string {
  return `${taken.by}: ${ctx.names[taken.slot]} takes ${move.name}.`;
}

/** Derived contexts (SPEC §4.7): the turn sets what the 1v1 asks about the turn's order and events. */
function contextFor(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): MoveContext | undefined {
  const attacker = action.slot;
  const base = ctx.input.pokemon[attacker]!.contexts[action.moveId!];
  const id = action.moveId!;
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  const willMove = (slot: DoublesSlotId) => alive(w, slot) && w.remaining.some((entry) => entry.slot === slot);
  // status2 (T2E §4.7.4): a Pokémon that switched in this turn (pinned newlySwitched): Payback is not doubled into it, Bolt
  // Beak and Fishious Rend are; Analytic does not wait for it (it has no action).
  const switchedIn = !!ctx.input.pokemon[target]?.switchedIn;
  const context: MoveContext = { ...base };
  if (user.build.abilityId === "analytic") context.turnOrder = DOUBLES_SLOTS.some((slot) => slot !== attacker && willMove(slot)) ? "first" : "last";
  if ((id === "boltbeak" || id === "fishiousrend") && !info.transformed) context.turnOrder = willMove(target) || switchedIn ? "first" : "last";
  if (id === "payback") context.doubled = !willMove(target) && !switchedIn;
  // hurtThisTurn (W's doubles-pairs.ts assurance, moved verbatim).
  if (id === "assurance") context.doubled = pairHooks.assurance(kernelOf(ctx), w, action, target);
  if (id === "avalanche" || id === "revenge") context.doubled = user.damagedBy.includes(target);
  if (id === "lashout") context.doubled = user.statsLowered || !!base?.doubled;
  // Last Respects (data/moves.ts lastrespects: 50 + 50 per side.totalFainted): at least the side's empty slots, then this turn's faints.
  if (id === "lastrespects") context.fainted = Math.max(base?.fainted ?? 0, emptySlots(ctx.input, slotSide(attacker))) + w.sides[slotSide(attacker)].faintedThisTurn;
  if (id === "ragefist") context.timesHit = Math.min(6, (base?.timesHit ?? 0) + user.timesAttacked);
  // ---- status2 (SPEC2 §3.5, ADDENDUM2 §3.5): each only while its state stands (none set in Step 0) ----
  // Spit Up's layers (vol.stockpile); Electrify on the user or Ion Deluge on the field; the positive accuracy and evasion
  // stages Stored Power and Power Trip (the user's) and Punishment (the target's) count; two or three Helping Hands.
  if (id === "spitup" && !info.transformed && user.vol.stockpile) context.stockpile = user.vol.stockpile.layers;
  if (user.vol.electrify) context.retype = "electrify";
  else if (w.field.ionDeluge) context.retype = "iondeluge";
  if (!info.transformed && (id === "storedpower" || id === "powertrip" || id === "punishment")) {
    const stages = id === "punishment" ? receiver.vol.stages : user.vol.stages;
    const hidden = Math.max(0, stages?.accuracy ?? 0) + Math.max(0, stages?.evasion ?? 0);
    if (hidden) context.hiddenStages = hidden;
  }
  if (user.helpingHand >= 2) context.helpingHands = Math.min(3, user.helpingHand) as 2 | 3;
  // A two-turn move charged last turn, released now (C38: vol.locked): no charge of its own (integration 1a).
  if (!info.transformed && user.vol.locked === id) context.released = true;
  // A one-hit KO move's hit: the target's maximum HP (D's ohkoStep took the immunities first; integration 1a).
  if (!info.transformed && info.effective.ohko) context.ohko = true;
  // W's part (doubles-pairs.ts context): the priority the move is used with where the calculation would read another, a chosen hit count.
  const paired = pairHooks.context(kernelOf(ctx), w, action, info);
  if (paired) Object.assign(context, paired);
  // PR's and CL's derived contexts (stubs: none).
  const own = presenceHooks.context(kernelOf(ctx), w, action, target, info), called = callingHooks.context(kernelOf(ctx), w, action, target, info);
  if (own) Object.assign(context, own);
  if (called) Object.assign(context, called);
  return Object.keys(context).length ? context : undefined;
}

// The resist Berry's Unnerve guard (unnerveGuard, resistUnnerve) moved to K's doubles-reactions.ts (unnerveStand, resistUnnerve).

/** `through`: a Z-Move or Max Move that gets through a protecting move with a contact effect, which then acts (its condition's onHit). */
export type HitCheck = {
  /** `hidden` (status2 C27): the invulnerability step's miss, the label in "{Move} misses {Name} ({hidden})." (by "miss"). */
  slot: DoublesSlotId; block: null | { by: string; protect?: keyof typeof PROTECT_CONTACT; hidden?: string } | { absorb: string }; through?: keyof typeof PROTECT_CONTACT;
  /** spreadStep: the block's effect was applied before the hit loop (a protecting move's contact effect). */
  done?: true;
};

/** Telepathy (data/abilities.ts telepathy onTryHit, breakable): its holder takes no damaging move of its ally's. */
function telepathyBlocks(w: World, attacker: DoublesSlotId, slot: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): boolean {
  return w.mons[slot]!.build.abilityId === "telepathy" && !isFoe(attacker, slot) && slot !== attacker && !breaks(w, attacker, slot, info);
}

/** TryHit for each target, by handler priority (SPEC §4.4 step 6): Wide Guard and Quick Guard (4), the protecting moves (3), Telepathy and the absorbing abilities. */
function hitChecks(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, targets: DoublesSlotId[], spread: boolean, priority: number): HitCheck[] {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const kernel = kernelOf(ctx);
  return targets.map((slot): HitCheck => {
    const target = w.mons[slot]!;
    const side = w.sides[slotSide(slot)];
    // status2 (C27): the invulnerability step comes first (sim/battle-actions.ts hitStepInvulnerabilityEvent): a commanding
    // Tatsugiri (PR), then the hidden kinds (H). Stubs: none.
    const label = presenceHooks.invulnerable(kernel, w, attacker, slot);
    if (label) return { slot, block: { by: "miss", hidden: label } };
    const missed = hiddenHooks.misses(kernel, w, action, info, slot);
    if (missed) return missed;
    const context = ctx.input.pokemon[attacker]!.contexts[move.id];
    // The conditions only where a protection asks (status2: built lazily; the same values).
    let conditions: BattleConditions | undefined;
    const passes = () => turnProtectOutcome(move, calcBuild(ctx, w, attacker), calcBuild(ctx, w, slot), conditions ??= conditionsFor(ctx, w, attacker, slot, false), context, ctx.runtime) !== "blocked";
    if (side.wideGuard && spread && !passes()) return { slot, block: { by: "Wide Guard" } };
    // Quick Guard: move.priority above 0.1, Prankster's and Gale Wings' included (data/moves.ts quickguard onTryHit).
    if (side.quickGuard && priority > 0.1 && !passes()) return { slot, block: { by: "Quick Guard" } };
    const protector = target.protect ? moveName(ctx, Object.entries(PROTECT_MOVES).find(([, kind]) => kind === target.protect)![0]) : "";
    if (target.protect && !(target.protect === "maxguard" ? maxHooks.passesMaxGuard(kernel, w, action, info, slot) : passes())) return { slot, block: { by: protector, protect: target.protect } };
    // status2 (A3): Mat Block on the target's side stops a foe's move with the protect flag (data/moves.ts matblock
    // onTryHit), but a Z-Move or Max Move, which breaks through at a quarter (conditionsFor). Absent while nothing sets it.
    if (side.matBlock && slot !== attacker && !passes()) return { slot, block: { by: moveName(ctx, "matblock") } };
    // A Z-Move or Max Move that breaks through still meets the contact effect (its condition's onHit, isZOrMaxPowered).
    const through = target.protect && PROTECT_CONTACT[target.protect] && info.contact && (info.isZ || info.isMax) ? target.protect : undefined;
    const ability = target.build.abilityId;
    if (telepathyBlocks(w, attacker, slot, info)) return { slot, block: { by: "Telepathy" }, through };
    const absorb = ABSORBING[ability];
    if (absorb && slot !== attacker && !breaks(w, attacker, slot, info)) {
      const type = usedType(ctx, w, attacker, move.id, slot, info, context);
      if (absorb.wind ? !!info.flags.wind : absorb.type === type) return { slot, block: { absorb: ability }, through };
    }
    return { slot, block: null, through };
  });
}

/** An absorbing ability's effect (data/abilities.ts onTryHit): a quarter of the base maximum HP healed, a stat rise, or Flash Fire. */
function absorbEffect(ctx: Ctx, w: World, slot: DoublesSlotId, ability: string, action: PendingAction): World[] {
  const effect = ABSORBING[ability];
  const name = abilityName(ctx, ability);
  if (effect.stages) {
    selfBoost(ctx, w, slot, effect.stages, action);
    hitFact(ctx, action, slot, `${name}: ${Object.entries(effect.stages).map(([stat, amount]) => `+${amount} ${STAT_NAMES[stat as CombatStat]}`).join(", ")}.`, w.mass);
    return [w];
  }
  if (effect.flashFire) {
    w.mons[slot]!.build = { ...w.mons[slot]!.build, abilityActive: true };
    hitFact(ctx, action, slot, "Flash Fire: its Fire moves have 1.5x power.", w.mass);
    return [w];
  }
  // status2 C14: under Heal Block the absorbing ability's heal fails (data/abilities.ts voltabsorb onTryHit: this.heal), the
  // move still absorbed.
  if (w.mons[slot]!.eot.healBlock) {
    const step = stepOf(ctx, action);
    if (step) { const stats = hitStats(step, slot, ctx.occupants[slot]); stats.blocked -= w.mass; stats.noDamage += w.mass; }
    hitFact(ctx, action, slot, `${name}: no damage.`, w.mass);
    return [w];
  }
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const heal = Math.max(1, Math.floor(baseMaxHP / 4));
  return mapHP(w, slot, (hp) => {
    const healed = Math.min(maxHP, hp + heal);
    if (healed > hp) noteHeal(ctx, slot, name, healed - hp);
    return { hp: healed, tag: "" };
  }).map(({ world }) => {
    hitFact(ctx, action, slot, `${name}: no damage, and it regains HP.`, world.mass);
    return world;
  });
}

/**
 * noteHeal for `slot`'s HP or pinch Berry `item` eaten at `hp`: the Berry's heal and Cheek Pouch's as their own lines
 * (hit-loop.ts berryHeals), as the turn's steps list them (uses-to-ko.ts noteBerry, noteAttackerBerry).
 */
function noteBerry(ctx: Ctx, slot: DoublesSlotId, item: string, berry: Berry, hp: number) {
  const { heal, pouch } = berryHeals(berry, hp);
  noteHeal(ctx, slot, itemName(ctx, item), heal);
  noteHeal(ctx, slot, "Cheek Pouch", pouch);
}

function noteHeal(ctx: Ctx, slot: DoublesSlotId, source: string, amount: number) {
  if (ctx.mode !== "all" || amount <= 0) return;
  const key = statKey(ctx, slot);
  let heals = ctx.heals.get(key);
  if (!heals) ctx.heals.set(key, heals = new Map());
  const known = heals.get(source);
  if (!known) heals.set(source, [amount, amount]);
  else { known[0] = Math.min(known[0], amount); known[1] = Math.max(known[1], amount); }
}

/** A protecting move's effect on a blocked contact attacker (data/moves.ts kingsshield, spikyshield... condition onTryHit). */
function protectContact(ctx: Ctx, w: World, attacker: DoublesSlotId, protector: DoublesSlotId, kind: keyof typeof PROTECT_CONTACT, info: Extract<TurnMove, { kind: "move" }>, followed = false): World[] {
  const effect = PROTECT_CONTACT[kind];
  if (!effect || !info.contact || !alive(w, attacker)) return [w];
  if (effect.stages) {
    const stages = kind === "kingsshield" && ctx.gen7 ? { atk: -2 } : effect.stages;
    foeDrop(ctx, w, attacker, stages, protector);
    return [w];
  }
  if (effect.status) { giveStatus(ctx, w, attacker, effect.status, protector); return [w]; }
  const user = w.mons[attacker]!.build;
  if (user.abilityId === "magicguard") return [w];
  // Through the protection the loss comes during the hit, before what the step already took (Life Orb, recoil): not
  // followed where the step changed the attacker's HP.
  if (followed) notEstimated(REASONS.notIn2v2(moveName(ctx, Object.entries(PROTECT_MOVES).find(([, each]) => each === kind)![0])));
  const loss = Math.max(1, Math.floor(ctx.hp[attacker].baseMaxHP / effect.damage!));
  return afterLoss(ctx, w, attacker, loss);
}

/**
 * The attacker's HP after a fixed loss outside its move's hits (Spiky Shield; a spread move's retaliation and Life
 * Orb): fainted at 0, else its HP or pinch Berry at the Update (berryArithmetic: Sitrus, Oran, Berry Juice at half, the
 * Figy family, the stat Berries, Lansat and Starf at a quarter, Gluttony, Ripen, Cheek Pouch). Damage from something
 * other than a move resets a Berserk or Anger Shell lock (onDamage: checkedBerserk true). One world per outcome.
 */
function afterLoss(ctx: Ctx, w: World, slot: DoublesSlotId, ...losses: (number | number[])[]): World[] {
  const mon = w.mons[slot]!;
  if (mon.vol.berryLocked) { const { berryLocked: _locked, ...rest } = mon.vol; void _locked; mon.vol = rest; }
  const item = mon.build.itemId;
  const usable = itemWorks(w, mon.build) && (HEALING_BERRIES.has(item) || !!PINCH_STAT_BERRIES[item] || LANSAT_STARF.has(item)) && item !== "enigmaberry";
  const unnerved = DOUBLES_SLOTS.some((other) => alive(w, other) && other !== w.ghost && isFoe(other, slot) && UNNERVES.has(w.mons[other]!.build.abilityId)) && item !== "berryjuice";
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const berry = usable && !unnerved ? berryArithmetic(item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, ctx.runtime.profile.generation) : null;
  const outcomes = mapHP(w, slot, (start) => {
    let hp = start, ate = false;
    // Each entry is one Update's losses (an array: several with no Update between them, as Mind Blown's recoil and Life Orb).
    for (const group of losses) {
      if (hp <= 0) break;
      for (const loss of typeof group === "number" ? [group] : group) hp = Math.max(0, hp - loss);
      if (berry && !ate && hp > 0 && hp <= berry.line) { noteBerry(ctx, slot, item, berry, hp); hp = eatBerry(berry, hp); ate = true; }
    }
    return { hp, tag: `${hp <= 0 ? "fainted" : "in"}|${ate ? "ate" : ""}` };
  });
  return outcomes.flatMap(({ world, tag }) => {
    const target = world.mons[slot]!;
    target.hurt = true;
    if (tag.startsWith("fainted")) faint(ctx, world, slot);
    return tag.endsWith("ate") ? ateBerry(ctx, world, slot, item) : [world];
  });
}

/**
 * What eating an HP or pinch Berry leaves (data/items.ts onEat): no item (Unburden), a pinch Berry's rise (Ripen), a
 * Figy-family Berry's confusion, Lansat Berry's focusenergy volatile (+2 critical-hit ratio; none with Focus Energy's or
 * Dragon Cheer's), Starf Berry's +2 (Ripen +4) to one of its stats below +6 at random (this.sample: one world each). The
 * first world is `w`, changed in place.
 */
function ateBerry(ctx: Ctx, w: World, slot: DoublesSlotId, item: string): World[] {
  const mon = w.mons[slot]!;
  // Item history (status2 F3 §4.1; a no-op unless the turn keeps it).
  noteItemUse(ctx, w, slot, item);
  const stat = PINCH_STAT_BERRIES[item];
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  if (stat) selfBoost(ctx, w, slot, { [stat]: mon.build.abilityId === "ripen" ? 2 : 1 }, null);
  berryConfusion(ctx, w, slot, item);
  // The Lansat Berry's focusenergy is BattleBuild.settledFocusEnergy (types.ts: focusEnergy is the move's), so a certain
  // critical hit names the Berry (calculate.ts critRatio), as the pair's step does for an attacker that ate one (uses-to-ko.ts toBuild).
  if (item === "lansatberry" && !mon.build.focusEnergy && !mon.build.settledFocusEnergy && !mon.build.dragonCheer) mon.build = { ...mon.build, settledFocusEnergy: true };
  if (item !== "starfberry" || !alive(w, slot)) return [w];
  const raised = STATS.filter((each) => (mon.build.boosts[each] ?? 0) < 6);
  if (!raised.length) return [w];
  const amount = mon.build.abilityId === "ripen" ? 4 : 2;
  const share = w.mass / raised.length;
  const worlds = raised.map((_, index) => (index === 0 ? w : cloneWorld(w, share)));
  w.mass = share;
  raised.forEach((each, index) => selfBoost(ctx, worlds[index], slot, { [each]: amount }, null));
  return worlds;
}

// The Berserk lock's guard (doubles-guards.ts lockedBerryGuard) and the Berry between hits (doubles-pairs.ts betweenHits)
// moved to their owners (status2); the kernel's lockedBerryGuard delegates.

/** A living foe of `slot` whose Unnerve or As One stops `slot`'s Berries (onFoeTryEatItem; an exploding user's no longer: World.ghost). */
function berryStopped(w: World, slot: DoublesSlotId): boolean {
  return DOUBLES_SLOTS.some((other) => alive(w, other) && other !== w.ghost && isFoe(other, slot) && UNNERVES.has(w.mons[other]!.build.abilityId));
}

/**
 * The Update after an Unnerve or As One holder's HP reached 0 in an action: sim/side.ts:390-396 allies() keeps only
 * Pokémon with HP, so its onFoeTryEatItem (data/abilities.ts unnerve, asoneglastrier, asonespectrier) no longer runs at
 * the next eachEvent('Update') (sim/battle-actions.ts:967 after each hit, :1003, sim/battle.ts:2861 after the action).
 * Each of its foes that no other holder still stops eats a Berry that is due: an HP or pinch Berry at or under its line
 * (data/items.ts sitrusberry and its kin onUpdate), a curing Berry for its status. `gone`: the holders that went.
 * The foe's HP does not change between that Update and the end of the action unless it is the action's user, whose
 * step reads the holder's Unnerve throughout (applyStep and spreadStep take that case), so the end of the action is exact.
 */
function unnerveEnds(ctx: Ctx, w: World, gone: DoublesSlotId[]): World[] {
  let worlds = [w];
  for (const slot of DOUBLES_SLOTS) {
    if (!alive(w, slot) || !gone.some((holder) => isFoe(holder, slot)) || berryStopped(w, slot)) continue;
    worlds = worlds.flatMap((world) => berryDue(ctx, world, slot));
  }
  return worlds;
}

/**
 * `slot` eats a Berry that is due at an Update (unnerveEnds, a received item, Pain Split): one world per outcome. A
 * Berserk or Anger Shell lock keeps a healing Berry (MoveVolatiles.berryLocked: TryEatItem fails).
 */
function berryDue(ctx: Ctx, w: World, slot: DoublesSlotId): World[] {
  const mon = w.mons[slot]!;
  const item = mon.build.itemId, status = mon.build.status;
  if (!item || !itemWorks(w, mon.build)) return [w];
  // data/items.ts lumberry, cheriberry, chestoberry, pechaberry, rawstberry, aspearberry onUpdate.
  const cures = item === "lumberry" ? !!status : { cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"] }[item]?.includes(status) ?? false;
  if (cures) { mon.build = { ...mon.build, itemId: "", status: "" }; pouchHeal(ctx, w, slot); return [w]; }
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item] || LANSAT_STARF.has(item)) || item === "enigmaberry") return [w];
  if (mon.vol.berryLocked && BERSERK_BERRIES.has(item)) return [w];
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const berry = berryArithmetic(item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, ctx.runtime.profile.generation);
  if (![...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= berry.line)) return [w];
  return mapHP(w, slot, (hp) => {
    if (hp <= 0 || hp > berry.line) return { hp, tag: "" };
    noteBerry(ctx, slot, item, berry, hp);
    return { hp: eatBerry(berry, hp), tag: "ate" };
  }).flatMap(({ world, tag }) => (tag === "ate" ? ateBerry(ctx, world, slot, item) : [world]));
}

/**
 * A damaging move's use (SPEC §4.4 steps 4-8). `called` (status2 kernel.useCalled): the priority a calling move's called
 * move is used with (no queue entry of its own).
 */
function damagingMove(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove, called?: number): World[] {
  const attacker = action.slot;
  const kernel = kernelOf(ctx);
  const context = ctx.input.pokemon[attacker]!.contexts[move.id];
  const info = moveInfo(ctx, w, attacker, move.id, context);
  if (info.kind !== "move") notEstimated(info.reason);
  const step = stepOf(ctx, action);
  if (step && info.transformed) { step.effectiveName = info.effective.name; step.effectiveType = info.effective.type; }
  // status2 (SPEC2 §3.5): A2's combination guard, then A1's own Try (Spit Up without a Stockpile). Stubs: none.
  typingHooks.comboGuard(kernel, w, action, move, info);
  const tried = abilityHooks.damagingTry(kernel, w, action, move, info);
  if (tried) { stepFact(ctx, action, tried, w.mass); return [w]; }
  // Future Sight and Doom Desire (flags.futuremove) land at the end of a later turn.
  if (FUTURE_MOVES.has(move.id) && !info.transformed) {
    stepFact(ctx, action, `${move.name} deals no damage this turn.`, w.mass);
    return [w];
  }
  if (chargesThisTurn(ctx, w, attacker, move, info)) return chargeTurn(ctx, w, action, move);
  // The move's priority as last sorted (Quick Guard, Upper Hand and the shields read move.priority, sim/battle.ts:2649).
  const priority = called ?? (action.frozen ? action.frozen.priority - action.fractional : priorityOf(ctx, w, action));
  // Stance Change (onModifyMove): an attack gives Aegislash its Blade Forme (calculateMove calculates it so).
  const out: World[] = [];
  // PR's own aim (Spotlight's and the Pledges' targets; a stub: the kernel's resolution).
  for (const resolution of presenceHooks.aim(kernel, w, action, info) ?? resolveTargets(ctx, w, action, info)) {
    const world = resolution.world;
    for (const fact of resolution.facts) stepFact(ctx, action, fact, world.mass);
    if (!resolution.targets.length) {
      if (!resolution.failed) stepFact(ctx, action, `${move.name} fails: no target.`, world.mass);
      out.push(world);
      continue;
    }
    // Generation 7 keeps the priority sorted at the turn's start (no re-sort), while the calculation reads Gale Wings at
    // the HP it has now: where a priority shield or Psychic Terrain reads it, the two can differ (W's doubles-pairs.ts frozenPriority).
    pairHooks.frozenPriority(kernel, world, action, priority, resolution);
    // TryMove and Try (SPEC §4.4 step 5): TryMove reads the last target (sim/battle-actions.ts useMoveInner).
    const last = resolution.targets[resolution.targets.length - 1];
    if (step && info.transformed) { const used = usedMove(ctx, world, attacker, move.id, last, info); step.effectiveName = used.name; step.effectiveType = used.type; }
    // Then a damaging move's own Try that Track A follows (doubles-status.ts tryMove: Snore once its user woke this turn);
    // status2: PR's (Round, Shell Trap, Echoed Voice), D's Fling and N's first-turn moves (stubs: none).
    const failure = moveFailure(ctx, world, action, move, last, priority, info) ?? statusHooks.tryMove(kernel, world, action, move, last, priority, info)
      ?? presenceHooks.tryMove(kernel, world, action, move, last, priority, info) ?? guardHooks.flingTry(kernel, world, action, move, last, info)
      ?? historyHooks.moveTry(kernel, world, action, move, last, info);
    if (failure) { stepFact(ctx, action, failure, world.mass); out.push(world); continue; }
    // Powder on the user against a Fire move (A2, TryMove −1): the worlds after its loss, the move failed (a stub: none).
    const powdered = typingHooks.powderTryMove(kernel, world, action, move, () => usedType(ctx, world, attacker, move.id, last, info, context));
    if (powdered) { out.push(...powdered); continue; }
    if (resolution.swap) stepFact(ctx, action, resolution.swap, world.mass);
    // The move's own PrepareHit first (PR: a Pledge waiting for its partner's; a stub: none).
    const waits = presenceHooks.prepareHit(kernel, world, action, info);
    if (waits) { out.push(...waits); continue; }
    // PrepareHit (sim/battle-actions.ts trySpreadMoveHit): Protean and Libero; an exploding user has already fainted.
    if (info.transformed || !SELF_DESTRUCT_MOVES.has(move.id)) proteanGuard(ctx, world, attacker, move.id, () => usedType(ctx, world, attacker, move.id, last, info, context));
    if (step) for (const slot of resolution.targets) hitStats(step, slot, ctx.occupants[slot]).reached += world.mass;
    const checks = hitChecks(ctx, world, action, info, resolution.targets, resolution.spread, priority);
    // Brick Break, Psychic Fangs and Raging Bull break the screens on a target's side in their onTryHit, after a
    // protection's (data/moves.ts brickbreak; sim/battle.ts compareLeftToRightOrder: Protect's onTryHitPriority 3).
    if (SCREEN_BREAKERS.has(move.id) && !info.transformed) {
      for (const check of checks) {
        if (check.block) continue;
        const side = slotSide(check.slot);
        world.sides[side] = { ...world.sides[side], reflect: false, lightScreen: false, auroraVeil: false };
      }
    }
    // Feint (breaksProtect, hitStepBreakProtect): the protection of a target it reaches ends, and from generation 6 its
    // side's Wide Guard and Quick Guard (sim/battle-actions.ts hitStepBreakProtect).
    if (move.id === "feint" && !info.transformed) {
      for (const check of checks) {
        if (check.block) continue;
        if (world.mons[check.slot]!.protect !== "maxguard") world.mons[check.slot]!.protect = null;
        // status2: Crafty Shield and Mat Block too (hitStepBreakProtect's side conditions), each only while up.
        const { craftyShield: _crafty, matBlock: _mat, ...side } = world.sides[slotSide(check.slot)];
        void _crafty; void _mat;
        world.sides[slotSide(check.slot)] = { ...side, wideGuard: false, quickGuard: false };
      }
    }
    // Explosion and its kin, and Mind Blown, change their user's HP once for the whole move (spreadStep), whatever
    // number of targets is left.
    const once = !info.transformed && (SELF_DESTRUCT_MOVES.has(move.id) || move.id === "mindblown");
    let after: World[];
    if (resolution.darts) after = dartsStep(ctx, world, action, info, checks);
    else if (resolution.spread && (resolution.targets.length > 1 || once)) after = spreadHooks.spreadStep(kernel, world, action, info, checks, resolution.targets.length > 1);
    else after = pairHooks.hitCounts(kernel, world, action, info, checks[0]).flatMap((part) => singleStep(ctx, part.world, part.action, info, checks[0]));
    // Struggle's recoil (status2 T2E §4.7.2; sim/battle-actions.ts applyRecoilDamage: struggleRecoil, a quarter of the base
    // maximum HP rounded, as directDamage: Magic Guard does not stop it) after a hit that dealt damage, a Substitute's too.
    if (move.id === "struggle" && !info.transformed) after = after.flatMap((next) => struggleRecoil(ctx, world, next, action, checks));
    // Crash damage when every target failed (status2 Step 1 #10; H's doubles-hidden.ts crash): per world, whether a hit
    // reached a target or its Substitute.
    after = hiddenHooks.crash(kernel, after, action, info, (next) => hitSomething(world, next, checks));
    out.push(...after.map((next) => { stanceChange(ctx, next, attacker, true); return next; }));
  }
  return out;
}

/** Struggle's recoil in one world after its hit (damagingMove): where the hit reached its target or met its Substitute. */
function struggleRecoil(ctx: Ctx, before: World, w: World, action: PendingAction, checks: HitCheck[]): World[] {
  const attacker = action.slot;
  if (!alive(w, attacker) || !hitSomething(before, w, checks)) return [w];
  // status2 (integration 1a): directDamage sets no hurtThisTurn and runs no Damage event (a Berserk lock would stay).
  const mon = w.mons[attacker]!;
  if (mon.vol.berryLocked) notEstimated(REASONS.combo(moveName(ctx, "struggle"), `${abilityName(ctx, mon.build.abilityId)}'s locked ${itemName(ctx, mon.build.itemId)}`));
  const hurt = mon.hurt;
  return afterLoss(ctx, w, attacker, Math.max(1, Math.round(ctx.hp[attacker].baseMaxHP / 4))).map((world) => { world.mons[attacker]!.hurt = hurt; return world; });
}

/**
 * Whether the move's hits reached a target in `w` (World.hitTargets: a hit on the Pokémon or its Disguise or Ice Face) or met
 * a target's Substitute (its HP changed from `before`, the world as the hits started): Struggle's recoil, and not a crash.
 */
function hitSomething(before: World, w: World, checks: HitCheck[]): boolean {
  return checks.some((check) => !check.block && (w.hitTargets?.includes(check.slot)
    || (!!before.mons[check.slot]?.vol.substitute && w.mons[check.slot]?.vol.substitute !== before.mons[check.slot]!.vol.substitute)));
}

/**
 * Whether a two-turn move charges this turn (data/moves.ts solarbeam and its kin onTryMove; the semi-invulnerable ones'
 * likewise): sun skips Solar Beam's and Solar Blade's charge, rain Electro Shot's (Pokemon.effectiveWeather: Cloud
 * Nine and Air Lock, the user's Utility Umbrella, Mega Sol's sun for all but Electro Shot), a usable Power Herb any
 * one (data/items.ts powerherb onChargeMove); a Z-Move or Max Move never charges.
 */
function chargesThisTurn(ctx: Ctx, w: World, slot: DoublesSlotId, move: ChampionsMove, info: Extract<TurnMove, { kind: "move" }>): boolean {
  if (info.transformed || (!CHARGE_TURN_MOVES.has(move.id) && !SEMI_INVULNERABLE_MOVES.has(move.id))) return false;
  // status2 (C38): a move charged last turn (vol.locked from carried.charging) is released now, with no charge.
  if (w.mons[slot]!.vol.locked === move.id) return false;
  const build = w.mons[slot]!.build;
  const umbrella = build.itemId === "utilityumbrella" && itemWorks(w, build);
  const megaSol = build.abilityId === "megasol" && move.id !== "electroshot";
  const weather = megaSol ? "Sun" : umbrella && ["Sun", "Rain", "Harsh Sunshine", "Heavy Rain"].includes(effectiveWeather(w)) ? "" : effectiveWeather(w);
  if ((move.id === "solarbeam" || move.id === "solarblade") && (weather === "Sun" || weather === "Harsh Sunshine")) return false;
  if (move.id === "electroshot" && (weather === "Rain" || weather === "Heavy Rain")) return false;
  return !(build.itemId === "powerherb" && itemWorks(w, build));
}

/**
 * A charge turn: no damage this turn. Meteor Beam and Electro Shot raise the user's Sp. Atk and Skull Bash its
 * Defense first (their onTryMove boost). A semi-invulnerable user (Fly, Dig, Dive, Bounce, Phantom Force, Shadow
 * Force) is not followed past it (SPEC §2.2).
 */
function chargeTurn(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const attacker = action.slot;
  // A semi-invulnerable user with a later action (H's doubles-hidden.ts chargeHidden, moved verbatim).
  hiddenHooks.chargeHidden(kernelOf(ctx), w, action, move);
  // The charge turn as the end of turn reads it (doubles-eot.ts charging: Dig and Dive sheltered, Fly and its kin semi-invulnerable).
  eotHooks.charging(w, attacker, move);
  const rise = statMove(move.id, ctx.runtime.profile.id)?.preHit;
  if (rise) selfBoost(ctx, w, attacker, rise, action);
  stepFact(ctx, action, `${move.name}: ${ctx.names[attacker]} charges this turn.`, w.mass);
  return [w];
}

/** The move fails before it hits (TryMove, Try): Sucker Punch, Thunderclap and Upper Hand against the target's queued move; a target's own shield against an ally. */
function moveFailure(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info?: Extract<TurnMove, { kind: "move" }>): string | null {
  const queued = w.remaining.find((entry) => entry.slot === target && alive(w, target));
  const queuedMove = queued?.moveId ? ctx.runtime.movesById.get(queued.moveId) : undefined;
  // Sucker Punch and Thunderclap pass a target about to use Me First (data/moves.ts suckerpunch, thunderclap onTry); their
  // Z-Move or Max Move has no onTry (hit-loop.ts ownMoveId), nor Upper Hand's.
  const own = info?.transformed ? "" : move.id;
  if (TARGET_ATTACK_MOVES.has(own) && (!queuedMove || (queuedMove.category === "Status" && queuedMove.id !== "mefirst"))) {
    return `${move.name} fails: ${ctx.names[target]} has no attacking move.`;
  }
  if (own === "upperhand" && (!queuedMove || queuedMove.category === "Status" || priorityOf(ctx, w, queued!) <= 0.1)) return `Upper Hand fails: ${ctx.names[target]} has no priority attack.`;
  // Damp (data/abilities.ts damp onAnyTryMove): any active holder stops the explosions in TryMove; breakable, so the
  // user's Mold Breaker passes another's (not an Ability Shield holder's).
  if (DAMP_MOVES.has(move.id) && info && !info.transformed) {
    for (const slot of DOUBLES_SLOTS) {
      if (!alive(w, slot) || w.mons[slot]!.build.abilityId !== "damp" || (slot !== action.slot && breaks(w, action.slot, slot, info))) continue;
      return `${move.name} fails: ${ctx.names[slot]} has Damp.`;
    }
  }
  const shield = info ? priorityShield(ctx, w, action, move, target, priority, info) : null;
  if (shield) return shield;
  // A priority move into the user's own ally (W's doubles-pairs.ts allyShield, moved verbatim).
  pairHooks.allyShield(kernelOf(ctx), w, action, move, target, priority);
  return null;
}

/**
 * Queenly Majesty, Dazzling and Armor Tail (data/abilities.ts onFoeTryMove): a foe's move used with priority above
 * 0.1 (move.priority, sim/battle.ts:2649) at the holder or its partner fails in TryMove, before it reaches anyone
 * (sim/battle-actions.ts useMoveInner). Breakable: the attacker's Mold Breaker and ignoreAbility moves pass them.
 */
function priorityShield(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: Extract<TurnMove, { kind: "move" }>): string | null {
  if (!(priority > 0.1 && isFoe(action.slot, target))) return null;
  for (const holder of [target, allyOf(target)]) {
    if (!alive(w, holder)) continue;
    const ability = w.mons[holder]!.build.abilityId;
    if (!(PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(ability) || breaks(w, action.slot, holder, info)) continue;
    return `${move.name} fails: ${ctx.names[holder]} has ${abilityName(ctx, ability)}.`;
  }
  return null;
}

/** Whether the move passes `target`'s protection (calculate.ts turnProtectOutcome, as hitChecks reads it). */
function protectPasses(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId): boolean {
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const conditions = conditionsFor(ctx, w, action.slot, target, false);
  const context = ctx.input.pokemon[action.slot]!.contexts[move.id];
  return turnProtectOutcome(move, calcBuild(ctx, w, action.slot), calcBuild(ctx, w, target), conditions, context, ctx.runtime) !== "blocked";
}

/** One damaging hit X -> T through the pairwise engine, the target's (and a followed attacker's) state carried (SPEC §4.5). */
function singleStep(ctx: Ctx, w0: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, check: HitCheck, attackerHP?: number): World[] {
  const attacker = action.slot, target = check.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const step = stepOf(ctx, action);
  const kernel = kernelOf(ctx);
  if (check.block) return blockedHit(ctx, w0, action, info, check);
  // Sky Drop's charge turn lifts its target (H's doubles-hidden.ts skyDropHit; null for any other move).
  const lifted = hiddenHooks.skyDropHit(kernel, w0, action, info, check);
  if (lifted) return lifted;
  // A damaging move with an effect of its own on this target instead of damage (doubles-status.ts singleHit, Track A:
  // Pollen Puff on an ally), or null.
  const instead = statusHooks.singleHit(kernel, w0, action, info, check, attackerHP);
  if (instead) return instead;
  // Final Gambit's damage is its user's HP (data/moves.ts finalgambit damageCallback): one world per HP it has.
  if (move.id === "finalgambit" && !info.transformed && attackerHP === undefined) {
    return [...marginal(w0, attacker).keys()].flatMap((hp) => condition(w0, attacker, (value) => value === hp)
      .filter(({ meets }) => meets).flatMap(({ world }) => singleStep(ctx, world, action, info, check, hp)));
  }
  // status2 integration 1b: an Innards Out holder whose HP differs between entries, one world per HP it has (its loss on the
  // user is the HP it had as the move started: K's stepEnv koRetaliation reads one value).
  if (reactionHooks.innardsOutSplit(kernel, w0, action, target)) {
    return [...marginal(w0, target).keys()].flatMap((hp) => condition(w0, target, (value) => value === hp)
      .filter(({ meets }) => meets).flatMap(({ world }) => singleStep(ctx, world, action, info, check, attackerHP)));
  }
  // status2: K's steal before the target's calculation (Spectral Thief's hitStepStealBoosts, before the hit loop; a stub: none).
  const w = reactionHooks.beforeStep(kernel, w0, action, info, check) ?? w0;
  // A hit into a Substitute (doubles-substitute.ts single, Track E): its worlds, or null when the hit does not meet one.
  const behind = substituteHooks.single(kernel, w, action, info, check, attackerHP);
  if (behind) return behind;
  // status2: D's one-hit KO move as a fixed hit (a stub: none, the calculation's row).
  const fixed = guardHooks.ohkoStep(kernel, w, action, info, check);
  if (fixed) return fixed(w);
  const conditions = conditionsFor(ctx, w, attacker, target, false, move.id);
  const context = contextFor(ctx, w, action, target, info);
  // Psychic Noise's Heal Block before the hit's Update (A2's doubles-typing.ts psychicNoiseKeepsBerry, moved verbatim).
  const kept = typingHooks.psychicNoiseKeepsBerry(kernel, w, attacker, target, info);
  // status2 Step 1 #2: a Champions Sheer Force hit locks a Berserk or Anger Shell holder's healing Berry (D's doubles-guards.ts sheerForceLock).
  const locked = kept ? null : guardHooks.sheerForceLock(kernel, w, attacker, target, info);
  const entry = searchFor(ctx, w, attacker, target, move.id, conditions, context, false, attackerHP, kept || locked ? { healBlocked: true } : undefined);
  if (entry.row.kind !== "calculated") {
    const face = faceHooks.faceTaken(kernel, w, attacker, target, entry.row, move);
    if (face) return faceHooks.faceHit(kernel, w, action, info, target, face, false);
    notEstimated(rowReason(ctx, w, target, entry.row, move));
  }
  // Focus Band (W's doubles-pairs.ts focusBand, moved verbatim).
  pairHooks.focusBand(kernel, w, target, entry.row);
  if (!entry.search) {
    if (step) { hitStats(step, target, ctx.occupants[target]).noDamage += w.mass; bump(hitStats(step, target, ctx.occupants[target]).facts, noDamageFact(ctx, entry.row, move, target), w.mass); }
    return [w];
  }
  // The resist Berry's Unnerve (K's doubles-reactions.ts unnerveStand, moved verbatim).
  reactionHooks.unnerveStand(kernel, w, attacker, target);
  return applyStep(ctx, w, action, target, entry, info, false).flatMap(({ world, landed, knocked }) => {
    // The held Berry back in place of the stand-in (psychicNoiseKeepsBerry; sheerForceLock, with the lock where the hit reached it).
    const receiver = world.mons[target]!;
    if (kept && receiver.build.itemId === "leftovers") receiver.build = { ...receiver.build, itemId: kept };
    if (locked && receiver.build.itemId === "leftovers") {
      receiver.build = { ...receiver.build, itemId: locked };
      if (landed > 0 && !receiver.fainted) receiver.vol = { ...receiver.vol, berryLocked: "sheerforce" };
    }
    // The faint batch after the hits (sim/battle-actions.ts hitStepMoveHitLoop faintMessages): the knocker-out's rise.
    if (knocked) koBoost(ctx, world, attacker, 1);
    // M: the Max Move's side effects (G-Max ones' random worlds included: doubles-max.ts maxEffects), then a protection's contact effect.
    if (info.isMax && landed > 0) return maxHooks.maxEffects(kernel, world, action, info, target).flatMap((each) => (check.through ? protectContact(ctx, each, attacker, target, check.through, info, entry.follow) : [each]));
    if (check.through && landed > 0) return protectContact(ctx, world, attacker, target, check.through, info, entry.follow);
    // Final Gambit's damageCallback faints its user as it deals the damage (data/moves.ts finalgambit).
    if (move.id === "finalgambit" && !info.transformed && landed > 0 && alive(world, attacker)) {
      return mapHP(world, attacker, () => ({ hp: 0, tag: "" })).map(({ world: next }) => { faint(ctx, next, attacker); return next; });
    }
    return [world];
  });
}

/**
 * status2 (T2E §4.1.4): one damaging hit at the residual (pinned futuremove onEnd: trySpreadMoveHit(…, notActive)) into the
 * Pokémon at `hit.position`: the pair's step from `hit.build`, with no attacker side of the turn when the source is not in
 * battle (`hit.attacker` null) or has fainted. Checks in Showdown's order: the semi-invulnerable miss (eot.hidden, Dig and
 * Dive too), Telepathy (a source on the target's side), the type immunity and Wonder Guard (the calculation's no-damage
 * row); no Protect, Endure, Wide Guard or Quick Guard, no redirection. A Substitute or an intact Disguise or Ice Face in the
 * way is not followed yet (E2's landing models them). Then applyStep with opts.residual. The child worlds with, per world,
 * the hits that reached the Pokémon. Called only from doubles-eot.ts (E2).
 */
function residualHit(ctx: Ctx, w: World, hit: ResidualHit): { world: World; landed: number }[] {
  const target = occupant(w, hit.position);
  if (!alive(w, target)) return [{ world: w, landed: 0 }];
  const move = ctx.runtime.movesById.get(hit.move);
  if (!move) notEstimated(REASONS.notIn2v2(hit.move));
  const receiver = w.mons[target]!;
  // A source of the turn that is still in reads as the attacker (its Life Orb, Moxie, the target's Rowap and Jaboca Berries,
  // Red Card); one that fainted, or one not in battle, has no state the step writes.
  const source = hit.attacker !== null && alive(w, hit.attacker) ? hit.attacker : null;
  const slot = hit.attacker ?? DOUBLES_SLOTS.find((each) => slotSide(each) === hit.side)!;
  const action: PendingAction = { index: -1, slot, moveId: move.id, target, fractional: 0, ...(source ? {} : { userless: true as const }) };
  if (receiver.eot.hidden) return [{ world: w, landed: 0 }];
  if (slotSide(target) === hit.side && receiver.build.abilityId === "telepathy") return [{ world: w, landed: 0 }];
  if (receiver.vol.substitute) notEstimated(REASONS.notIn2v2(move.name));
  const info = resolveTurnMove(move, { ...hit.build, currentHP: null }, hit.conditions, hit.context, ctx.runtime);
  if (info.kind !== "move") notEstimated(info.reason);
  const entry = searchFor(ctx, w, source, target, move.id, hit.conditions, hit.context, false, undefined, { attackerBuild: { ...hit.build, currentHP: null } });
  if (entry.row.kind !== "calculated") notEstimated(rowReason(ctx, w, target, entry.row, move));
  if (!entry.search) return [{ world: w, landed: 0 }];
  return applyStep(ctx, w, action, target, entry, info, false, undefined, { residual: { attacker: source, build: hit.build } }).map(({ world, landed, knocked }) => {
    if (knocked && source) koBoost(ctx, world, source, 1);
    return { world, landed };
  });
}

/** A target a check stopped (SPEC §4.4 step 6): an absorbing ability's effect, or the block's fact and a protecting move's contact effect. */
function blockedHit(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, check: HitCheck, contactEffect = true): World[] {
  const step = stepOf(ctx, action);
  const target = check.slot;
  if (step) hitStats(step, target, ctx.occupants[target]).blocked += w.mass;
  if (!check.block) return [w];
  if ("absorb" in check.block) return absorbEffect(ctx, w, target, check.block.absorb, action);
  // status2 (C27): the invulnerability step's miss (hitChecks).
  if (check.block.hidden) { hitFact(ctx, action, target, `${moveName(ctx, action.moveId!)} misses ${ctx.names[target]} (${check.block.hidden}).`, w.mass); return [w]; }
  hitFact(ctx, action, target, `${check.block.by} blocks ${moveName(ctx, action.moveId!)}.`, w.mass);
  return check.block.protect && contactEffect ? protectContact(ctx, w, action.slot, target, check.block.protect, info) : [w];
}

/**
 * Apply one pair's turnStep to the world (SPEC §4.5 steps 2-4): the factors holding the target (and a followed
 * attacker) joined; for each assignment of their other slots one call; one child world per discrete outcome, with the
 * joint table over the joined slots. `spread`: the attacker's state is recorded for spreadStep, not applied. `part`: a
 * step after hits into a Substitute (ADDENDUM §3.5.5; uses-to-ko.ts TurnStepPart): one case of the run, its first
 * `skip` hits already dealt to the Substitute; the target's hit count then takes every hit of the move once a hit
 * reached it (K1), and only outcomes with a hit on the target count as calculated.
 */
function applyStep(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: Extract<TurnMove, { kind: "move" }>, spread: boolean, part?: TurnStepPart,
  opts?: { residual?: { attacker: DoublesSlotId | null; build?: BattleBuild } }): StepChild[] {
  const attacker = action.slot;
  const kernel = kernelOf(ctx);
  // status2 (T2E §3.5): a hit at the residual is not followed, writes nothing to an attacker that is not in (its `attacker`
  // null or fainted), records no statistics, sets off no Eject Button and no Destiny Bond (hitReactions).
  const residual = opts?.residual;
  const writes = !residual || (residual.attacker !== null && alive(w, residual.attacker));
  // The Berserk lock (D's doubles-guards.ts lockedBerryGuard) and a Berry between hits (W's doubles-pairs.ts betweenHits), moved verbatim.
  guardHooks.lockedBerryGuard(kernel, w, target);
  pairHooks.betweenHits(kernel, w, action, target, entry);
  const follow = entry.follow && !spread && !residual;
  // status2 C14: the heal-block stand-ins searchFor read (healStandIn), put back on the builds after the step.
  const targetStandIn = !!w.mons[target]!.eot.healBlock && healStandIn(w, target, false);
  // status2 Step 1 #12: the target's stats rose this turn before this hit (statsRaisedThisTurn as its secondaries read it).
  const raisedBefore = w.mons[target]!.statsRaised;
  const userStandIn = !residual && !!w.mons[attacker]?.eot.healBlock && healStandIn(w, attacker, true);
  const world = cloneWorld(w);
  const at = join(world, follow ? [target, attacker] : [target]);
  const joint = world.factors[at];
  const extras = joint.slots.filter((slot) => slot !== target && !(follow && slot === attacker));
  // Perf pass 1b: the digits are read at their indexes, found once (the same keys and sums, in the same order).
  const extrasAt = extras.map((slot) => joint.slots.indexOf(slot));
  const targetAt = joint.slots.indexOf(target), attackerAt = follow ? joint.slots.indexOf(attacker) : -1;
  // Entries by the extras' HP.
  const groups = new Map<number, { extras: number; byAttacker: Map<number, Map<number, number>> }>();
  for (const [key, mass] of joint.table) {
    let extrasKey = 0;
    for (let index = 0; index < extrasAt.length; index++) extrasKey += digitAt(key, extrasAt[index]) * radixPow(index);
    let group = groups.get(extrasKey);
    if (!group) groups.set(extrasKey, group = { extras: extrasKey, byAttacker: new Map() });
    const x = follow ? digitAt(key, attackerAt) : 0;
    let dist = group.byAttacker.get(x);
    if (!dist) group.byAttacker.set(x, dist = new Map());
    const t = digitAt(key, targetAt);
    dist.set(t, (dist.get(t) ?? 0) + mass);
  }
  const step = residual ? null : stepOf(ctx, action);
  const children = new Map<number | string, { table: Map<number, number>; outcome: TurnStepOutcome }>();
  const order = [...(follow ? [attacker] : []), target, ...extras];
  // Each place of `order`: the followed attacker (-1), the target (-2), or the extra's index in the extras key.
  const sources = order.map((slot) => (slot === attacker && follow ? -1 : slot === target ? -2 : extras.indexOf(slot)));
  const keyFor = (extrasKey: number, x: number, t: number) => {
    let key = 0;
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      const hp = source === -1 ? x : source === -2 ? t : digitAt(extrasKey, source);
      key += hp * radixPow(index);
    }
    return key;
  };
  // Perf pass 1b: the outcomes' sides as short ids, one per distinct sideKey text (equal texts, one id), so the children's
  // signatures group exactly as the texts did. The search's node states are not changed once made, so a side object's text
  // is read once per step.
  const sideTexts = new Map<TurnSide, string>(), sideIds = new Map<string, number>();
  const sideId = (side: TurnSide) => {
    let text = sideTexts.get(side);
    if (text === undefined) sideTexts.set(side, text = sideKey(side));
    let id = sideIds.get(text);
    if (id === undefined) sideIds.set(text, id = sideIds.size);
    return id;
  };
  // Perf pass 1b: the conditions' fields the signature reads, as one id per distinct text (as sideId), and each row's
  // damageKey read once per step (the search's rows and conditions are not changed once made).
  const conditionIds = new Map<BattleConditions, number>(), conditionTexts = new Map<string, number>();
  const conditionId = (conditions: BattleConditions) => {
    let id = conditionIds.get(conditions);
    if (id === undefined) {
      const text = JSON.stringify([conditions.weather, conditions.terrain, conditions.attackerSide.charge, conditions.defenderSide.reflect,
        conditions.defenderSide.lightScreen, conditions.defenderSide.auroraVeil]);
      id = conditionTexts.get(text);
      if (id === undefined) conditionTexts.set(text, id = conditionTexts.size);
      conditionIds.set(conditions, id);
    }
    return id;
  };
  const rowKeys = new Map<MoveDamageResult, string>();
  // With four places or fewer every key is below 2^48, so its sum is exact in any order: the extras' part is summed once per
  // group, and the followed attacker's and the target's added to it (the same keys as keyFor's).
  const exactKeys = sources.length <= 4;
  const attackerPlace = sources.indexOf(-1), targetPlace = sources.indexOf(-2);
  for (const group of groups.values()) {
    const entries: TurnStepEntry[] = [...group.byAttacker].map(([x, dist]) => ({ attackerHP: x, target: dist }));
    const result = entry.search!.turnStep(follow ? entries : [{ attackerHP: 0, target: mergeDists(entries) }], ctx.mode, follow, part);
    if ("failed" in result) notEstimated(result.failed);
    for (const [source, [least, most]] of result.heals) { noteHeal(ctx, target, source, least); noteHeal(ctx, target, source, most); }
    // A followed attacker's own HP Berry and Shell Bell (data/items.ts shellbell onAfterMoveSecondarySelf), and Cheek Pouch.
    if (writes) for (const [source, [least, most]] of result.attackerHeals) { noteHeal(ctx, attacker, source, least); noteHeal(ctx, attacker, source, most); }
    // The target's Berry it ate with Bug Bite or Pluck (data/moves.ts bugbite, pluck onHit: the Eat on the user).
    for (const [item, [least, most]] of result.attackerAte) {
      const source = `${ctx.names[attacker]} eats ${ctx.names[target]}'s ${itemName(ctx, item)}`;
      noteHeal(ctx, attacker, source, least); noteHeal(ctx, attacker, source, most);
    }
    if (step) {
      for (const [row, mass] of result.rows) {
        let rowKey = rowKeys.get(row);
        if (rowKey === undefined) rowKeys.set(row, rowKey = damageKey(row));
        note(hitStats(step, target, ctx.occupants[target]).met, rowKey, row, mass * world.mass);
      }
    }
    let extrasPart = 0;
    if (exactKeys) for (let index = 0; index < sources.length; index++) if (sources[index] >= 0) extrasPart += digitAt(group.extras, sources[index]) * radixPow(index);
    for (const outcome of result.outcomes) {
      // The signature's parts (an id for each side and for the conditions' fields), so two signatures are equal exactly when
      // the JSON array of those values was: one number for parts within its bounds (52 bits), else their JSON texts.
      const keyed = childKey(sideId(outcome.attacker), follow && outcome.attackerFainted, sideId(outcome.target), outcome.knocked, outcome.landed,
        conditionId(outcome.conditions), outcome.stopAt, outcome.attackerFaintedInHits);
      // PR (status2 wave 1b): a reported last hit keeps its child apart (the Counter family's record reads it per world).
      const signature = outcome.lastHit ? `${keyed}|${outcome.lastHit.damage}|${outcome.lastHit.category}|${outcome.dealt ?? -1}` : keyed;
      let child = children.get(signature);
      if (!child) children.set(signature, child = { table: new Map(), outcome });
      const x = follow ? (outcome.attackerFainted ? 0 : outcome.attacker.hp) : 0;
      const fixedPart = exactKeys ? extrasPart + (attackerPlace >= 0 ? x * radixPow(attackerPlace) : 0) : 0;
      const targetPow = radixPow(targetPlace);
      for (const [t, mass] of outcome.dist) {
        const key = exactKeys ? fixedPart + (outcome.knocked ? 0 : t) * targetPow : keyFor(group.extras, x, outcome.knocked ? 0 : t);
        child.table.set(key, (child.table.get(key) ?? 0) + mass);
        if (step && outcome.knocked) hitStats(step, target, ctx.occupants[target]).ko += mass * world.mass;
      }
    }
  }
  if (step) note(hitStats(step, target, ctx.occupants[target]).firsts, JSON.stringify(entry.row), entry.row, world.mass);
  // A certain critical hit without the field's Critical hit (a critical-hit ratio of 4: calculate.ts certainCrit; an
  // always-critical move; Merciless): a fact on the hit, and the turn's hit rule says so (calculateDoublesTurn).
  if (step && !ctx.input.field.critical && entry.trace?.result?.rawDesc.isCritical) {
    ctx.certainCrit = true;
    const ratio = entry.row.assumptions.find((text) => text.startsWith(CERTAIN_CRIT));
    bump(hitStats(step, target, ctx.occupants[target]).facts, ratio ?? `${entry.row.effectiveName ?? info.effective.name} is always a critical hit.`, world.mass);
  }
  const out: StepChild[] = [];
  for (const { table, outcome } of children.values()) {
    let total = 0;
    for (const mass of table.values()) total += mass;
    if (total <= 0) continue;
    for (const [key, mass] of table) table.set(key, mass / total);
    const next = cloneWorld(world, world.mass * total);
    next.factors[at] = { slots: order, table };
    if (!DOUBLES_REFERENCE.on) next.factors.splice(at, 1, ...splitFactor(next.factors[at]));
    const user = next.mons[attacker], receiver = next.mons[target]!;
    // A residual hit's source build (opts.residual.build) stands for an attacker not in the turn.
    const before = { user: residual?.build ?? user!.build, receiver: receiver.build };
    if (spread) next.spread = [...(next.spread ?? []), sideTexts.get(outcome.attacker) ?? sideKey(outcome.attacker)];
    else if (writes) user!.build = userStandIn ? unStandIn(true, before.user, fromSide(user!.build, outcome.attacker)) : fromSide(user!.build, outcome.attacker);
    if (follow) user!.ownHP = true;
    receiver.build = targetStandIn ? unStandIn(true, before.receiver, fromSide(receiver.build, outcome.target)) : fromSide(receiver.build, outcome.target);
    // A Berry between two hits stopped the use (uses-to-ko.ts stopAt): the rest of the move from that hit (W's doubles-pairs.ts continueHits).
    if (outcome.stopAt !== undefined) { out.push(...pairHooks.continueHits(kernel, next, action, target, entry, info, outcome, before, part)); continue; }
    // The faint queue in hit order (sim/battle.ts faintMessages): the target, then an attacker its retaliation knocked out.
    if (outcome.knocked) faint(ctx, next, target, true);
    if (follow && outcome.attackerFainted) faint(ctx, next, attacker);
    // A knocked-out target's Unnerve or As One ending before the attacker's recoil (K's doubles-reactions.ts unnerveRecoil, moved verbatim).
    reactionHooks.unnerveRecoil(kernel, next, action, target, outcome, info, before, follow);
    // A Figy-family Berry gone from the target in the step: eaten (a Berry Bug Bite, Pluck or Incinerate took is not).
    const taken = stolenInStep(w, action, target, entry, info, before, receiver.build, outcome.knocked);
    if (before.receiver.itemId && !receiver.build.itemId && !taken) berryConfusion(ctx, next, target, before.receiver.itemId);
    if (taken && (action.moveId === "bugbite" || action.moveId === "pluck")) stolenFacts(ctx, next, action, target, taken, before.user);
    // Item history (status2 F3 §4.1: each lost item used or taken; only while the turn keeps it).
    if (ctx.tracksItems) stepItems(ctx, next, action, target, info, entry, before, taken);
    // The field the step left: a weather or terrain it set or ended, Charge used up, screens a Max Move cleared.
    const kept = outcome.conditions.weather === ""
      && (residual ? conditionsFor(ctx, w, residual.attacker, target, false, undefined, { side: slotSide(attacker) }) : conditionsFor(ctx, w, attacker, target, false)).weather === "";
    next.field = { ...next.field, weather: kept ? next.field.weather : outcome.conditions.weather, terrain: outcome.conditions.terrain };
    if (next.field.weather !== w.field.weather || next.field.terrain !== w.field.terrain) fieldChangeHooks.stepField(kernel, next, w.field, action);
    if (writes && !outcome.conditions.attackerSide.charge) user!.charged = false;
    // Flower Veil and Pastel Veil (K's doubles-reactions.ts veil, moved verbatim).
    reactionHooks.veil(kernel, next, attacker, target, before.receiver);
    // A Sheer Force move with secondaries runs no AfterMoveSecondary event (sim/battle-actions.ts afterMoveSecondaryEvent): no Eject Button, no Red Card.
    if (outcome.landed > 0) hitReactions(ctx, next, attacker, target, before.receiver.itemId, residual, before.user.abilityId === "sheerforce" && info.secondaries);
    if (outcome.landed > 0) {
      // Electromorphosis, and Wind Power against a wind move, charge the holder (data/abilities.ts onDamagingHit: addVolatile('charge')).
      const ability = receiver.build.abilityId;
      if (ability === "electromorphosis" || (ability === "windpower" && !!info.flags.wind)) receiver.charged = true;
      receiver.hurt = true;
      receiver.focusLost = true;
      // Every hit of the move once its last hit reached the Pokémon, a Substitute's included (sim/battle-actions.ts:990-996; K1).
      receiver.timesAttacked += outcome.landed + outcome.subHits;
      if (!residual && !receiver.damagedBy.includes(attacker)) receiver.damagedBy.push(attacker);
      if (!next.hitTargets?.includes(target)) next.hitTargets = [...(next.hitTargets ?? []), target];
    }
    for (const [mon, was] of writes ? [[user!, before.user], [receiver, before.receiver]] as const : [[receiver, before.receiver]] as const) {
      if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0)) || (was.itemId === "whiteherb" && !mon.build.itemId)) mon.statsLowered = true;
      if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0))) mon.statsRaised = true;
    }
    // A foe's drop of the stat Defiant or Competitive then raises (hiddenDrop) happened though the stage did not fall:
    // Eject Pack reads the drop's AfterBoost (eventGuards), Lash Out statsLoweredThisTurn.
    if (outcome.landed > 0 && isFoe(attacker, target) && hiddenDrop(ctx, w, action, target, info, before.user, before.receiver, receiver.build)) {
      receiver.statsLowered = true;
      next.boosted = { ...next.boosted, [target]: { ...next.boosted?.[target], fell: true } };
    }
    // Screens the move broke on the target's side (Brick Break, Psychic Fangs, Raging Bull, G-Max Wind Rage: the step's conditions).
    if (isFoe(attacker, target)) {
      const side = next.sides[slotSide(target)], left = outcome.conditions.defenderSide;
      if ((side.reflect && !left.reflect) || (side.lightScreen && !left.lightScreen) || (side.auroraVeil && !left.auroraVeil)) {
        next.sides[slotSide(target)] = { ...side, reflect: side.reflect && left.reflect, lightScreen: side.lightScreen && left.lightScreen, auroraVeil: side.auroraVeil && left.auroraVeil };
      }
    }
    // With a part, only the outcomes in which a hit reached the Pokémon (those that met only the Substitute: kernel.subStat).
    if (step && (!part || outcome.landed > 0)) {
      const stats = hitStats(step, target, ctx.occupants[target]);
      stats.calculated += next.mass;
    }
    // W's Assurance record per world (a stub: nothing).
    pairHooks.hurt(kernel, next, action, outcome, info, follow, target, before);
    if (residual) residualReactions(ctx, next, action, target, outcome, info);
    else afterHit(ctx, next, action, target, outcome, info, raisedBefore);
    // The target's own Lansat or Starf Berry at the hit's Update (data/items.ts lansatberry, starfberry onUpdate at a quarter,
    // half with Gluttony; sim/battle-actions.ts:967), which the pair's step leaves held: Lansat's focusenergy for its later
    // move, Starf's random rise (one world each), Cheek Pouch (berryDue). A foe's Unnerve or As One stops it.
    const held = next.mons[target]!.build.itemId;
    const due = LANSAT_STARF.has(held) && outcome.landed > 0 && alive(next, target) && !berryStopped(next, target);
    for (const child of due ? berryDue(ctx, next, target) : [next]) out.push({ world: child, landed: outcome.landed, knocked: outcome.knocked });
  }
  return out;
}

/**
 * status2 (F3 §4.1): the items the pair's step took from the attacker and the target, each classed. Taken, with no
 * lastItem (pinned takeItem): Knock Off's (not a resist Berry the hit ate), a Berry Bug Bite, Pluck or Incinerate took
 * (`stolen`), one Thief, Covet or Magician moved to the attacker, a popped Air Balloon, a Sticky Barb that moved, the
 * attacker's that Pickpocket took: World.itemsTaken. Otherwise used or eaten (noteItemUse). Only with ctx.tracksItems.
 */
function stepItems(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, entry: SearchEntry,
  before: { user: BattleBuild; receiver: BattleBuild }, stolen: string | null) {
  const attacker = action.slot;
  const user = attacker !== target ? w.mons[attacker] : undefined, receiver = w.mons[target]!;
  const held = before.receiver.itemId;
  if (held && receiver.build.itemId !== held) {
    const resisted = entry.trace?.result?.rawDesc.defenderItem;
    const ateResist = !!resisted && !!getBerryResistType(resisted);
    const taken = (ownMoveId(action.moveId!, info) === "knockoff" && !ateResist) || stolen === held || held === "airballoon"
      || (!!user && !before.user.itemId && user.build.itemId === held);
    if (taken) w.itemsTaken = [...(w.itemsTaken ?? []), target];
    else noteItemUse(ctx, w, target, held);
  }
  const own = before.user.itemId;
  if (user && own && user.build.itemId !== own) {
    const taken = !before.receiver.itemId && receiver.build.itemId === own;
    if (taken) w.itemsTaken = [...(w.itemsTaken ?? []), attacker];
    else noteItemUse(ctx, w, attacker, own);
  }
}

/**
 * Whether the pair's step dropped a stat of `target` that its Defiant (Attack) or Competitive (Sp. Atk) then raised by 2
 * (data/abilities.ts defiant, competitive onAfterEachBoost; sim/battle.ts boost: the drop's AfterBoost runs after that
 * rise), which its stages alone do not show: the move's own drop of that stat on the target (stat-moves.ts STAT_MOVES
 * target, a secondary that must land; a Max Move's foe drop, MAX_MOVE_EFFECTS), and the stat rose in the step, or stayed
 * at +6. Defiant and Competitive rise only after a foe's drop, and no other effect of a foe's move raises that stat.
 */
function hiddenDrop(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, user: BattleBuild, was: BattleBuild, now: BattleBuild): boolean {
  const stat: CombatStat | null = was.abilityId === "defiant" ? "atk" : was.abilityId === "competitive" ? "spa" : null;
  if (!stat) return false;
  const stages = info.isMax ? MAX_MOVE_EFFECTS[usedMove(ctx, w, action.slot, action.moveId!, target, info).name]?.foe
    : info.isZ ? undefined : statMove(ownMoveId(action.moveId!, info), ctx.runtime.profile.id, user.abilityId === "serenegrace")?.target;
  if (!((stages?.[stat] ?? 0) < 0) || (!info.isMax && !secondaryLands(ctx, w, action.slot, target, info))) return false;
  const from = was.boosts[stat] ?? 0, to = now.boosts[stat] ?? 0;
  return to > from || (from === 6 && to === 6);
}

/**
 * The target's Berry Bug Bite, Pluck or Incinerate took in a step (data/moves.ts bugbite, pluck, incinerate onHit), or null:
 * the Berry it held before the step and no longer holds, unless the step's damage ate it (a resist Berry) or its unbroken
 * Sticky Hold kept it and it ate it itself (Sticky Hold lets go only once its holder has fainted). Their Z-Move or Max Move
 * takes nothing (hit-loop.ts ownMoveId).
 */
function stolenInStep(w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: Extract<TurnMove, { kind: "move" }>,
  before: { user: BattleBuild; receiver: BattleBuild }, after: BattleBuild, knocked: boolean): string | null {
  if (!BERRY_STEALERS.has(ownMoveId(action.moveId!, info))) return null;
  const held = before.receiver.itemId;
  if (!held.endsWith("berry") || after.itemId === held) return null;
  const resisted = entry.trace?.result?.rawDesc.defenderItem;
  if (resisted && getBerryResistType(resisted)) return null;
  if (before.receiver.abilityId === "stickyhold" && !breaks(w, action.slot, target, info) && !knocked) return null;
  return held;
}

/**
 * What the user got from the target's Berry it ate with Bug Bite or Pluck (hit-loop.ts stolenEat), which the step applied:
 * its stages and the status it cured as the hit's facts (its HP is the user's heals). Ripen's mark of an eaten resist Berry
 * halves the next damage its holder takes (data/abilities.ts ripen onSourceModifyDamage berryWeaken): not followed while a
 * later move can hit it.
 */
function stolenFacts(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, item: string, user: BattleBuild) {
  const attacker = action.slot;
  const ignoresItem = w.field.magicRoom || (user.abilityId === "klutz" && !KLUTZ_IGNORED_ITEMS.has(user.itemId));
  const eat = stolenEat(item, { baseMaxHP: ctx.hp[attacker].baseMaxHP, ability: user.abilityId, ignoresItem }, ctx.runtime.profile.generation);
  // Ripen's weakened Berry (D's doubles-guards.ts ripenGuard, moved verbatim).
  guardHooks.ripenGuard(kernelOf(ctx), w, attacker, !!eat.weakens);
  const effects: string[] = [];
  for (const [stat, amount] of Object.entries(eat.stages) as [CombatStat, number][]) {
    // The rise as boost() makes it from the stage the user had: Contrary, Simple, the ±6 cap.
    const from = user.boosts[stat] ?? 0;
    const by = Math.max(-6, Math.min(6, from + amount * (user.abilityId === "contrary" ? -1 : 1) * (user.abilityId === "simple" ? 2 : 1))) - from;
    if (by) effects.push(`${by > 0 ? "+" : ""}${by} ${STAT_NAMES[stat]}`);
  }
  if (user.status && eat.cures.includes(user.status)) effects.push(`its ${STATUS_WORDS[user.status]} is cured`);
  if (effects.length) hitFact(ctx, action, target, `${ctx.names[attacker]} eats ${ctx.names[target]}'s ${itemName(ctx, item)}: ${effects.join(", ")}.`, w.mass);
}
const STATUS_WORDS: Record<string, string> = { brn: "burn", par: "paralysis", psn: "poison", tox: "bad poison", slp: "sleep", frz: "freeze" };

/**
 * Reactions to a damaging hit the turn does not follow (SPEC §2.2): Cotton Down lowering every other Pokémon's Speed
 * (onDamagingHit; K's doubles-reactions.ts cottonDown); and, with a later action, Eject Button switching its holder out and
 * Red Card the attacker (onAfterMoveSecondary; R's doubles-switch.ts switchOut); Destiny Bond taking a foe that knocks its
 * user out (data/moves.ts destinybond onFaint). `residual` (T2E §3.5): a hit at the residual sets off no Eject Button and no
 * Destiny Bond; Red Card acts only on a source still in. `sheerForce` (status2 R-E): the hit's move had its secondaries removed
 * by its user's Sheer Force (move.hasSheerForce), so afterMoveSecondaryEvent does not run: neither item acts.
 */
function hitReactions(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, item: string, residual?: { attacker: DoublesSlotId | null }, sheerForce = false) {
  const kernel = kernelOf(ctx);
  const receiver = w.mons[target]!;
  reactionHooks.cottonDown(kernel, w, attacker, target);
  // A knockout's reactions of Track A (doubles-status.ts onKnockOut: Destiny Bond).
  if (!residual) statusHooks.onKnockOut(kernel, w, attacker, target);
  if (receiver.fainted || attacker === target) return;
  const usable = itemWorks(w, receiver.build);
  const eject = !residual && !sheerForce && item === "ejectbutton" && usable;
  const red = !sheerForce && item === "redcard" && usable && alive(w, attacker) && (!residual || residual.attacker === attacker);
  // status2 R-E: Red Card reads its attacker's HP before the attacker's Life Orb (AfterMoveSecondary, then AfterMoveSecondarySelf,
  // which its drag stops): an attacker knocked out in the step with a working Life Orb may have fainted to it alone (or to the
  // hit's Rough Skin or Rocky Helmet first, which the world does not tell apart): not followed.
  const attackerBuild = w.mons[attacker]?.build;
  if (!sheerForce && !residual && item === "redcard" && usable && w.mons[attacker]?.fainted && attackerBuild?.itemId === "lifeorb" && attackerBuild.abilityId !== "magicguard"
    && itemWorks(w, attackerBuild) && sideCanSwitch(ctx.input, slotSide(attacker)) !== false) {
    notEstimated(REASONS.combo(itemName(ctx, "redcard"), itemName(ctx, "lifeorb")));
  }
  // A gas holder switched out takes its Neutralizing Gas with it, whether or not an action follows.
  if (eject) gasEnds(ctx, w, target);
  if (red) gasEnds(ctx, w, attacker);
  // With a later action the replacement is not known; with none the switch-out reaches only the end of turn (doubles-eot.ts leaving).
  // status2 R-E: with the side's bench, R's switchOut decides whether the item acts (and uses it up); Red Card names its holder.
  if (eject) switchHooks.switchOut(kernel, w, target, "ejectbutton", null);
  if (red) switchHooks.switchOut(kernel, w, attacker, "redcard", null, target);
}

/** status2 R-E: the side of `slot` has a bench (DoublesTurnInput.bench): its switch-outs are R's (doubles-switch.ts replaceSlot). */
const sideBench = (ctx: Ctx, slot: DoublesSlotId) => !!ctx.baseInput.bench?.[slotSide(slot)];

/** A row the turn cannot use, as its reason: an intact Disguise or Ice Face against a multi-hit move has its own (S's doubles-faces.ts multiHit; SPEC §2.2). */
function rowReason(ctx: Ctx, w: World, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): string {
  return faceHooks.multiHit(kernelOf(ctx), w, target, row, move) ?? row.reason ?? REASONS.notIn2v2(move.name);
}

// Focus Band (focusBandGuard) moved to W's doubles-pairs.ts focusBand; the kernel's focusBandGuard delegates.

/** A no-damage row as a fact: the calculation's own reason (a failure, a partner's shield), or that the move had no effect. */
function noDamageFact(ctx: Ctx, row: MoveDamageResult, move: ChampionsMove, target: DoublesSlotId): string {
  return row.assumptions.length === 1 && row.assumptions[0] === row.description ? row.description : `${move.name} has no effect on ${ctx.names[target]}.`;
}

// Flower Veil and Pastel Veil (veilGuard) moved to K's doubles-reactions.ts veil.

function mergeDists(entries: TurnStepEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const entry of entries) for (const [hp, mass] of entry.target) out.set(hp, (out.get(hp) ?? 0) + mass);
  return out;
}

/**
 * The turn's reactions to one hit (SPEC §4.4 step 8): flinch from Fake Out and Upper Hand, the faint reactions not yet
 * followed. With hits into a Substitute (ADDENDUM §3.5.6) the user's own rules act when any hit of the move landed, a
 * Substitute's included (`hitAny`: switching out, a type lost, Glaive Rush, Core Enforcer, Spectral Thief), and the
 * target's when a hit reached the Pokémon (`outcome.landed > 0`). Then Track A's reactions (doubles-status.ts afterHit)
 * and, last, Track B's (doubles-eot.ts afterHit).
 */
function afterHit(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: Extract<TurnMove, { kind: "move" }>, raisedBefore = false) {
  const attacker = action.slot;
  const kernel = kernelOf(ctx);
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  // Battle Bond on the knocker-out (K's doubles-reactions.ts afterKnockOut), Smack Down's and Thousand Arrows' grounding
  // (A2's doubles-typing.ts groundingAfterHit), Aftermath and Innards Out (K's koRetaliationAfter): moved verbatim.
  reactionHooks.afterKnockOut(kernel, w, action, outcome);
  typingHooks.groundingAfterHit(kernel, w, action, target, outcome, info);
  reactionHooks.koRetaliationAfter(kernel, w, action, target, outcome, info);
  const id = action.moveId!;
  const hitAny = outcome.landed + outcome.subHits > 0;
  const own = !info.transformed && outcome.landed > 0;
  const ownAny = !info.transformed && hitAny;
  // status2 U2: Minimize's condition doubles a minimize-flag move's damage (A1 F1 §4.2; calculate.ts MINIMIZE_MOVES, takenMods.minimize).
  if (ownAny && receiver.vol.minimize && abilityHooks.MINIMIZE_MOVES.has(id)) hitFact(ctx, action, target, "Minimize: double damage.", w.mass);
  // U-turn, Volt Switch and Flip Turn switch the user out after a hit (selfSwitch): its replacement is not known. A gas
  // holder takes its Neutralizing Gas with it, whether or not an action follows. With no later action the switch
  // reaches only the end of turn (doubles-eot.ts leaving; R's doubles-switch.ts switchOut). A side with no Pokémon left to
  // switch in (canSwitch false; status2 R: an empty bench) keeps it in (sim/battle-actions.ts:1290-1291 canSwitch(source.side)).
  const switchable = (slot: DoublesSlotId) => sideCanSwitch(ctx.input, slotSide(slot)) !== false;
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted && switchable(attacker)) {
    gasEnds(ctx, w, attacker);
    switchHooks.switchOut(kernel, w, attacker, "selfswitch", action);
  }
  // Dragon Tail and Circle Throw drag the target out (forceSwitch: sim/battle-actions.ts:1353-1360, then
  // sim/battle.ts:2821-2829 between actions), unless it is Dynamaxed or a Suction Cups or Guard Dog holder
  // (onDragOut, breakable), or its side has no Pokémon left to switch in (canSwitch false, :1357): later moves meet its
  // replacement, which is not known.
  const dragged = DRAG_MOVES.has(id) && own && !receiver.fainted && switchable(target) && !isMaxActive(receiver.build)
    && !(ANCHORING_ABILITIES.has(receiver.build.abilityId) && !breaks(w, attacker, target, info));
  if (dragged) {
    gasEnds(ctx, w, target);
    switchHooks.switchOut(kernel, w, target, "drag", action);
  }
  // Burn Up and Double Shock losing their type (A2's doubles-typing.ts afterHit, moved verbatim; Color Change there later).
  typingHooks.afterHit(kernel, w, action, target, outcome, info, ownAny);
  // Glaive Rush until the user's next move (D's doubles-guards.ts glaiveRushAfter, moved verbatim).
  guardHooks.glaiveRushAfter(kernel, w, action, ownAny);
  if (outcome.landed > 0) flinchCheck(ctx, w, action, target, info);
  // A certain accuracy drop (stat-moves.ts accuracyDrop: Mud-Slap; Octazooka and Leaf Tornado with Serene Grace), a
  // secondary of the hit, which the pair's step leaves out: boost() with its TryBoost (Keen Eye, Mind's Eye, Illuminate,
  // Clear Body...), Mirror Armor, Defiant and Competitive, and the drop Eject Pack reads.
  const accuracy = own && !receiver.fainted ? accuracyDrop(id, user.build.abilityId === "serenegrace") : 0;
  if (accuracy && secondaryLands(ctx, w, attacker, target, info)) foeDrop(ctx, w, target, { accuracy }, attacker, breaks(w, attacker, target, info));
  // Clear Smog's onHit clearBoosts (data/moves.ts clearsmog): this turn's accuracy and evasion stages go too (the step clears
  // the others). It runs no boost event: the stages it took are no drop for Eject Pack (eventGuards; verify-engine VE-M1-1).
  if (id === "clearsmog" && own && !receiver.fainted) {
    if (receiver.vol.stages) { const { stages: _stages, ...rest } = receiver.vol; void _stages; receiver.vol = rest; }
    w.boosted = { ...w.boosted, [target]: { ...w.boosted?.[target], reset: true } };
  }
  // Throat Chop's 100% secondary (data/moves.ts throatchop secondary onHit addVolatile): no sound move for its target.
  if (id === "throatchop" && own && !receiver.fainted && secondaryLands(ctx, w, attacker, target, info)) receiver.throatChopped = true;
  // status2 integration 1a (A1 I6): the trapped volatile of Jaw Lock and Thousand Waves (onHit) and of Anchor Shot and Spirit
  // Shackle (a certain secondary: not under Sheer Force, not into Shield Dust or Covert Cloak); doubles-abilities.ts trapAfterHit.
  if (own && (id === "jawlock" || id === "thousandwaves" || ((id === "anchorshot" || id === "spiritshackle") && secondaryLands(ctx, w, attacker, target, info)))) {
    abilityHooks.trapAfterHit(kernel, w, action, attacker, target, id);
  }
  // Track A's reactions (doubles-status.ts afterHit: Dynamic Punch's and Chatter's confusion).
  statusHooks.afterHit(kernel, w, action, target, outcome, info);
  // Core Enforcer's onAfterSubDamage and Spectral Thief's stolen rises act on a hit into a Substitute too
  // (PS/data/moves.ts:2889-2893; sim/battle-actions.ts:781-797); the other volatile secondaries only on the Pokémon:
  // K's doubles-reactions.ts volatileSecondary and A2's doubles-typing.ts psychicNoiseGuard (volatileGuard, moved verbatim).
  if (outcome.landed > 0 || ((id === "coreenforcer" || id === "spectralthief") && hitAny)) {
    reactionHooks.volatileSecondary(kernel, w, action, target, info, hitAny, raisedBefore);
    typingHooks.psychicNoiseGuard(kernel, w, action, target, info);
  }
  // Track B's reactions (doubles-eot.ts afterHit: trap, Salt Cure, Syrup Bomb, Psychic Noise, Smack Down; Rapid Spin, Mortal Spin).
  eotHooks.afterHit(kernel, w, action, target, outcome, info);
  // status2: D's Fling and PR's hit reactions (stubs: nothing).
  guardHooks.flingAfter(kernel, w, action, target, outcome, info);
  presenceHooks.afterHit(kernel, w, action, target, outcome, info);
  // status2 CL: Uproar's own TryHit wakes every sleeper, then its volatile starts (doubles-calling.ts afterHit).
  callingHooks.afterHit(kernel, w, action, target, outcome, info);
}

/**
 * status2 (T2E §4.1.4): the reactions to a hit at the residual (applyStep's `residual`), the target's own: Aftermath and
 * Innards Out (K), A2's type changes on the target (Color Change). The attacker's and the move's own afterHit lines are
 * the moves' alone (a landing move has none).
 */
function residualReactions(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: Extract<TurnMove, { kind: "move" }>) {
  const kernel = kernelOf(ctx);
  reactionHooks.koRetaliationAfter(kernel, w, action, target, outcome, info);
  typingHooks.afterHit(kernel, w, action, target, outcome, info, false);
}

/** A 100% secondary reaches its target (sim/battle-actions.ts secondaries): Sheer Force removes it, Shield Dust (breakable) and Covert Cloak stop it. */
function secondaryLands(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): boolean {
  const receiver = w.mons[target]!.build;
  if (w.mons[attacker]!.build.abilityId === "sheerforce") return false;
  if (receiver.abilityId === "shielddust" && !breaks(w, attacker, target, info)) return false;
  void ctx;
  return !(receiver.itemId === "covertcloak" && itemWorks(w, receiver));
}

// Psychic Noise's kept Berry (psychicNoiseKeepsBerry) moved to A2's doubles-typing.ts.

/**
 * Flinch: Fake Out's and Upper Hand's 100% secondary on a target that has not moved (data/conditions.ts flinch);
 * Sheer Force removes it, Shield Dust and Covert Cloak stop it, Inner Focus, Dynamax and a focusing Focus Punch user resist it.
 */
function flinchCheck(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>) {
  const user = w.mons[action.slot]!, receiver = w.mons[target]!;
  // status2 (ADDENDUM2 §3.5): "has not moved" is "has an action left" (w.remaining; a Pokémon that switched in has none).
  if (!FLINCH_MOVES.has(action.moveId!) || info.transformed || receiver.fainted || !w.remaining.some((entry) => entry.slot === target)) return;
  const ability = receiver.build.abilityId;
  const broken = breaks(w, action.slot, target, info);
  const blocked = user.build.abilityId === "sheerforce" || (ability === "shielddust" && !broken) || (ability === "innerfocus" && !broken)
    || (receiver.build.itemId === "covertcloak" && itemWorks(w, receiver.build)) || isMaxActive(receiver.build)
    || w.remaining.some((entry) => entry.slot === target && focuses(ctx, w, target, entry.moveId));
  if (!blocked) receiver.flinched = moveName(ctx, action.moveId!);
}

/**
 * Whether `slot`'s move this turn is a focusing Focus Punch (data/moves.ts focuspunch: its priorityChargeCallback adds the
 * focus volatile as the turn starts, which a damaging hit breaks (beforeMoveCallback) and which resists a flinch); its
 * Z-Move and Max Move do not focus (sim/battle-queue.ts: no priorityChargeCallback with action.zmove or action.maxMove;
 * runMove calls the converted move's beforeMoveCallback: hit-loop.ts ownMoveId).
 */
function focuses(ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string | null): boolean {
  if (moveId !== "focuspunch") return false;
  const info = moveInfo(ctx, w, slot, moveId, ctx.input.pokemon[slot]!.contexts[moveId]);
  return info.kind === "move" && !info.transformed;
}

// The volatile secondaries' guard (volatileGuard) moved to K's doubles-reactions.ts volatileSecondary and A2's
// doubles-typing.ts psychicNoiseGuard; spreadStep moved to D's doubles-spread.ts.

/**
 * Dragon Darts at its smart targets (sim/battle-actions.ts trySpreadMoveHit, hitStepMoveHitLoop): one dart into each,
 * in target order, while both pass the hit steps (spreadStep: no spread modifier, move.spreadHit is not set for smart
 * targets); a target that fails one (Protect, an immunity) leaves both darts to the other.
 */
function dartsStep(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, checks: HitCheck[]): World[] {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const lands = (check: HitCheck) => {
    if (check.block) return false;
    const entry = searchFor(ctx, w, attacker, check.slot, move.id, conditionsFor(ctx, w, attacker, check.slot, true, move.id), contextFor(ctx, w, action, check.slot, info), true);
    if (entry.row.kind !== "calculated") return !!faceHooks.faceTaken(kernelOf(ctx), w, attacker, check.slot, entry.row, move) || notEstimated(rowReason(ctx, w, check.slot, entry.row, move));
    return !!entry.search;
  };
  const passing = checks.filter(lands);
  if (passing.length === 2) return spreadHooks.spreadStep(kernelOf(ctx), w, action, info, checks, true);
  let worlds = [w];
  for (const check of checks) {
    if (passing.includes(check)) continue;
    worlds = worlds.flatMap((world) => singleStep(ctx, world, action, info, check));
  }
  for (const check of passing) worlds = worlds.flatMap((world) => singleStep(ctx, world, action, info, check));
  return worlds;
}

export type FaceKind = "disguise" | "iceface";
// Disguise and Ice Face (faceTaken, faceHit, faceProbe, neutralRow) moved to S's doubles-faces.ts; a Max Move's side effects
// (maxEffects) to M's doubles-max.ts. The kernel's faceTaken, faceHit and maxEffects delegate.

// ------------------------------------------------------------------------------------------------------------------
// The API (SPEC §3.3)
// ------------------------------------------------------------------------------------------------------------------

const settles = new WeakMap<DoublesTurnInput, DoublesSettle>();
function settleOf(input: DoublesTurnInput): DoublesSettle {
  let settle = settles.get(input);
  if (!settle) settles.set(input, settle = settleDoublesStart(input));
  return settle;
}

/** The Pokémon the 1v1 helpers read as "the other" for `slot`; null when two act on it (§4.2) or the slot is empty. */
export function doublesRepresentative(input: DoublesTurnInput, slot: DoublesSlotId): DoublesSlotId | null {
  return settleOf(input).slots[slot]?.representative ?? null;
}

function createContext(input: DoublesTurnInput, settle: DoublesSettle, memo: Memo, mode: Mode, stats: StepStats[] | null): Ctx {
  const { runtime } = input;
  const names = turnNames(input);
  const hp = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const build = settle.slots[slot]?.folded;
    const values = build ? turnHP(build, runtime) : { maxHP: 0, baseMaxHP: 0 };
    return [slot, { maxHP: values.maxHP, baseMaxHP: values.baseMaxHP }];
  })) as Ctx["hp"];
  const actions = DOUBLES_SLOTS.filter((slot) => input.pokemon[slot]).map((slot) => ({ slot, moveId: input.pokemon[slot]!.action.moveId, target: aimedAt(input, slot) }));
  return {
    input, runtime, gen7: runtime.profile.generation === 7, champions: runtime.profile.id === "champions", hp, actions, mode, memo, stats,
    // status2 R: names and hp are this context's own (syncOccupants writes a newcomer's in them; the input's names are never changed).
    names: { ...names }, benchNames: turnBenchNames(input), startNames: names, startHP: { ...hp }, renamed: false,
    // status2 R-E: the input as given, its occupants' views, the occupants and the action executing.
    baseInput: input, views: new Map(), occupants: {}, acting: null,
    heals: new Map(), faintsBefore: new Map(), otherFaints: new Set(), targetless: targetlessSlots(input), gas: settle.gas ?? null, baseGas: settle.gas ?? null, gasViews: new Map(),
    losses: new Map(), walkFacts: new Set(),
    // status2 (SPEC2 §4.9's readers rule): the new state is written only where something reads it.
    ...readersOf(input), inEndOfTurn: false,
  };
}

/** The readers of an input (createContext's tracksItems, entryReaders, historyReaders), worked out once per input. */
const READERS = new WeakMap<DoublesTurnInput, Pick<Ctx, "tracksItems" | "entryReaders" | "historyReaders">>();
function readersOf(input: DoublesTurnInput): Pick<Ctx, "tracksItems" | "entryReaders" | "historyReaders"> {
  let known = READERS.get(input);
  if (!known) {
    // status2 R-E: a bench Pokémon can come in and read item history (a Harvest, Pickup, Symbiosis or Cud Chew holder), or
    // tie in the entry order (Dancer, Download), as one of the slots' Pokémon would: each read as if it stood in a slot.
    const benched = (["own", "opponent"] as const).flatMap((side) => (input.bench?.[side] ?? []).map((each) => ({ side, each })));
    const tracks = guardHooks.tracksItems(input) || benched.some(({ side, each }) => guardHooks.tracksItems({ ...input, pokemon: benchView(input, side, each.build) }));
    const entry = entryReaders(input) || benched.some(({ each }) => each.build.abilityId === "dancer" || each.build.abilityId === "download");
    known = { tracksItems: tracks, entryReaders: entry, historyReaders: historyReaders(input) };
    READERS.set(input, known);
  }
  return known;
}

/** status2 R-E: the input's slots with a bench build standing in its side's first slot (readersOf's reads of a bench Pokémon). */
function benchView(input: DoublesTurnInput, side: DoublesSideId, build: BattleBuild): DoublesTurnInput["pokemon"] {
  const slot = side === "own" ? "own-left" : "opponent-left";
  return { ...input.pokemon, [slot]: { build, contexts: {}, charged: false, action: { moveId: null, target: null }, switchedIn: true } };
}

/**
 * Whether the entry order can decide a tie this turn (ctx.entryReaders; IN §4.1): two possible redirectors of one move (a
 * Lightning Rod or Storm Drain holder, a Follow Me, Rage Powder or Spotlight user), two Dancers, a Download holder.
 */
function entryReaders(input: DoublesTurnInput): boolean {
  const present = DOUBLES_SLOTS.flatMap((slot) => (input.pokemon[slot] ? [input.pokemon[slot]!] : []));
  const redirectors = present.filter((entry) => !!REDIRECT_ABILITIES[entry.build.abilityId] || (entry.action.moveId ?? "") in CENTRES).length;
  const dancers = present.filter((entry) => entry.build.abilityId === "dancer").length;
  return redirectors >= 2 || dancers >= 2 || present.some((entry) => entry.build.abilityId === "download");
}

/**
 * The history readers (ctx.historyReaders): World.didSomething and lastSuccessful for a Dancer that can copy another
 * Pokémon's dance move, or a Fusion user; World.lastMove for a Copycat user (each a turn today's presence guards stop).
 */
function historyReaders(input: DoublesTurnInput): { didSomething: boolean; lastMove: boolean } {
  const present = DOUBLES_SLOTS.flatMap((slot) => (input.pokemon[slot] ? [input.pokemon[slot]!] : []));
  const moves = present.map((entry) => entry.action.moveId ?? "");
  const dancer = present.some((entry, at) => DANCE_MOVES.has(moves[at]) && present.some((other, each) => each !== at && other.build.abilityId === "dancer"));
  return { didSomething: dancer || moves.includes("fusionbolt") || moves.includes("fusionflare"), lastMove: moves.includes("copycat") };
}

/**
 * The slot a living Pokémon's chosen target stands for: a foe slot that is empty (its Pokémon fainted with no
 * replacement) is the other foe, as pinned Showdown retargets a move at a fainted foe (sim/battle.ts getTarget,
 * getRandomTarget: sim/side.ts randomFoe, the one foe in place); otherwise the chosen slot.
 */
function aimedAt(input: DoublesTurnInput, slot: DoublesSlotId): DoublesSlotId | null {
  const target = input.pokemon[slot]?.action.target ?? null;
  if (!target || input.pokemon[target] || !isFoe(slot, target)) return target;
  return foesOf(slot).find((foe) => input.pokemon[foe]) ?? null;
}

/** The slots whose move has no target because both foe slots are empty (doublesNoFoeLeft). */
function targetlessSlots(input: DoublesTurnInput): Set<DoublesSlotId> {
  return new Set(DOUBLES_SLOTS.filter((slot) => {
    const moveId = input.pokemon[slot]?.action.moveId;
    return !!moveId && doublesNoFoeLeft(input, slot, moveId);
  }));
}

/** The empty slots on a side: Pokémon that fainted with no replacement (Last Respects counts them: side.totalFainted). */
function emptySlots(input: DoublesTurnInput, side: DoublesSideId): number {
  return DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side && !input.pokemon[slot]).length;
}

/** status2 (A2, N): validateBuild's used-Protean issue, which the 2v2 turn reads instead (SPEC2's types, or N's typeUnknown). */
const usedProtean = (build: BattleBuild, issue: { field: string }) => issue.field === "abilityActive" && (build.abilityId === "protean" || build.abilityId === "libero");

function validate(input: DoublesTurnInput): DoublesTurnResult | null {
  const { runtime } = input;
  const issues = { pokemon: {} as Partial<Record<DoublesSlotId, ReturnType<typeof validateBuild>>>, field: validateConditions({ ...input.field, gameType: "Doubles" }, runtime), actions: [] as { slot: DoublesSlotId; message: string }[] };
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const found = [...validateBuild(entry.build, runtime).filter((issue) => !usedProtean(entry.build, issue)), ...carriedIssues(input, slot)];
    if (found.length) issues.pokemon[slot] = found;
    const { moveId, target } = entry.action;
    // status2 (ADDENDUM2 §3.7): the action a carried state locks or forbids.
    const locked = carriedAction(input, slot);
    if (locked) issues.actions.push({ slot, message: locked });
    if (moveId === null) { if (target !== null) issues.actions.push({ slot, message: "No move takes no target." }); continue; }
    const species = runtime.speciesById.get(entry.build.speciesId);
    // The 1v1 rule (roster-prep.ts learnsMove): a move of the species' learnset, not a Z-Move or Max Move itself. Struggle
    // (status2 T2E §4.7.2) is legal for any Pokémon (Training passes it).
    const known = runtime.movesById.get(moveId);
    if (!known || known.isZ || known.isMax || (moveId !== "struggle" && !species?.moves.includes(moveId))) { issues.actions.push({ slot, message: "This Pokémon does not learn that move." }); continue; }
    const rule = doublesTargetRule(input, slot, moveId);
    // A foe slot that is empty stands for the other foe (aimedAt); with no foe left the move has no target.
    const emptyFoe = target !== null && isFoe(slot, target) && !input.pokemon[target]
      && ((rule.kind === "choose" && rule.options.some((option) => isFoe(slot, option))) || doublesNoFoeLeft(input, slot, moveId));
    const targetIssue = rule.kind !== "choose" ? (target !== null ? "This move takes no chosen target." : null)
      : !target ? (rule.options.length ? "No target is chosen for this move." : null)
      : !rule.options.includes(target) && !emptyFoe ? "This move cannot target that Pokémon." : null;
    if (targetIssue) issues.actions.push({ slot, message: targetIssue });
    // Assault Vest disables every status move but Me First (data/items.ts assaultvest onDisableMove), unless its holder
    // ignores it (Klutz, not under Neutralizing Gas; Magic Room).
    const gas = DOUBLES_SLOTS.some((other) => input.pokemon[other]?.build.abilityId === "neutralizinggas");
    const vest = entry.build.itemId === "assaultvest" && !input.field.magicRoom && entry.carried?.embargo === undefined && !(entry.build.abilityId === "klutz" && !gas);
    if (vest && known.category === "Status" && moveId !== "mefirst") issues.actions.push({ slot, message: "Assault Vest stops status moves." });
  }
  // status2 (ADDENDUM2 §3.7, IN §3.5): the turn-level inputs (entry ranks, the battle's last move, Echoed Voice, field turns).
  issues.field.push(...turnIssues(input));
  // status2 R (IN §5.7): the bench, the replacements and the hazards.
  if (input.bench || input.replacement || input.hazards || input.replacementOrder) {
    const found = benchIssues(input);
    issues.field.push(...found.field);
    for (const [slot, list] of Object.entries(found.pokemon) as [DoublesSlotId, BuildIssue[]][]) issues.pokemon[slot] = [...(issues.pokemon[slot] ?? []), ...list];
  }
  return Object.keys(issues.pokemon).length || issues.field.length || issues.actions.length ? { status: "issues", issues } : null;
}

const HAZARD_MOVES = [["stealthRock", "stealthrock", "Stealth Rock"], ["spikes", "spikes", "Spikes"], ["toxicSpikes", "toxicspikes", "Toxic Spikes"], ["stickyWeb", "stickyweb", "Sticky Web"]] as const;

/**
 * status2 R (IN §5.7, F4 §5.4; Step 2): the bench's, the replacements' and the hazards' issues. A side's bench holds at most
 * four Pokémon, each under its own id (a slot's startId names a Pokémon in play) and each a valid build, shown as `Bench
 * {Name}: …` (validateBuild's issues but a used Protean's, which resets as it comes in; its sleep and freeze counters,
 * once-a-battle effects and moves list as carriedIssues reads them); a Pokémon's replacement is one of its side's bench Pokémon (an issue
 * on the Pokémon; an empty slot's is not read); Spikes have 1 to 3 layers, Toxic Spikes 1 or 2, and each hazard's move is in
 * the game (G-Max Steelsurge: SwSh).
 */
function benchIssues(input: DoublesTurnInput): { field: BuildIssue[]; pokemon: Partial<Record<DoublesSlotId, BuildIssue[]>> } {
  const { runtime } = input;
  const field: BuildIssue[] = [];
  const pokemon: Partial<Record<DoublesSlotId, BuildIssue[]>> = {};
  const add = (key: string, message: string) => field.push({ field: key, message });
  const whole = (value: number, least: number, most = Infinity) => Number.isInteger(value) && value >= least && value <= most;
  const champions = runtime.profile.id === "champions";
  const gen9 = runtime.profile.id === "scarlet_violet" || champions;
  const names = turnBenchNames(input);
  const ids = new Set<string>();
  for (const side of ["own", "opponent"] as const) {
    const list = input.bench?.[side];
    if (!list) continue;
    if (list.length > 4) add(`bench.${side}`, "A bench holds at most four Pokémon.");
    list.forEach((each, index) => {
      const key = `bench.${side}.${index}`;
      const name = names[each.id] || each.id;
      if (each.id.startsWith("slot:")) add(key, `${name} is already in play.`);
      else if (ids.has(each.id)) add(key, "Two bench Pokémon have the same id.");
      ids.add(each.id);
      const { build } = each;
      for (const issue of validateBuild(build, runtime)) if (!usedProtean(build, issue)) add(key, `Bench ${name}: ${issue.message}`);
      const carried = each.carried ?? {};
      if (carried.sleep) {
        const { attempts, rest } = carried.sleep;
        const longest = rest || champions ? 3 : 4;
        if (build.status !== "slp") add(key, `Bench ${name}: turns lost to sleep need the Asleep status.`);
        else if (!whole(attempts, 0) || attempts * (build.abilityId === "earlybird" ? 2 : 1) >= longest) add(key, `Bench ${name}: it cannot have lost ${attempts} turns to sleep.`);
      }
      if (carried.freeze) {
        if (!champions) add(key, `Bench ${name}: turns lost to freeze are counted in Champions only.`);
        else if (build.status !== "frz") add(key, `Bench ${name}: turns lost to freeze need the Frozen status.`);
        else if (!whole(carried.freeze.attempts, 0, 2)) add(key, `Bench ${name}: it cannot have lost ${carried.freeze.attempts} turns to freeze.`);
      }
      if (carried.onceUsed?.length) {
        const known = ["battlebond", "intrepidsword", "dauntlessshield", "supersweetsyrup"];
        if (!gen9 || carried.onceUsed.some((id) => !known.includes(id))) add(key, `Bench ${name}: Only generation 9 counts once-a-battle effects.`);
        else if (carried.onceUsed.includes("battlebond") && runtime.profile.id !== "scarlet_violet") add(key, `Bench ${name}: Battle Bond counts once a battle in Scarlet/Violet only.`);
      }
      if (each.moves && new Set(each.moves).size !== each.moves.length) add(key, `Bench ${name}: its moves list a move twice.`);
    });
  }
  for (const [slot, id] of Object.entries(input.replacement ?? {}) as [DoublesSlotId, string][]) {
    if (!input.pokemon[slot]) continue;
    if (!(input.bench?.[slotSide(slot)] ?? []).some((each) => each.id === id)) (pokemon[slot] ??= []).push({ field: "replacement", message: "Its replacement is not on its side's bench." });
  }
  // A side's replacement order (Training): "healthiest", or ids of its own bench Pokémon and of its Pokémon in play.
  for (const side of ["own", "opponent"] as const) {
    const order = input.replacementOrder?.[side];
    if (order === undefined || order === "healthiest") continue;
    const known = new Set([...(input.bench?.[side] ?? []).map((each) => each.id), ...DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side).map(startId)]);
    if (!Array.isArray(order) || order.some((id) => !known.has(id))) add(`replacementOrder.${side}`, "A replacement order names a Pokémon that is not on its side.");
  }
  for (const side of ["own", "opponent"] as const) {
    const hazards = input.hazards?.[side];
    if (!hazards) continue;
    const key = `hazards.${side}`;
    if (hazards.spikes !== undefined && !whole(hazards.spikes, 1, 3)) add(`${key}.spikes`, "Spikes have 1 to 3 layers.");
    if (hazards.toxicSpikes !== undefined && !whole(hazards.toxicSpikes, 1, 2)) add(`${key}.toxicSpikes`, "Toxic Spikes have 1 or 2 layers.");
    for (const [flag, id, name] of HAZARD_MOVES) if (hazards[flag] !== undefined && !runtime.movesById.has(id)) add(`${key}.${flag}`, `${name} is not in this game.`);
    if (hazards.steelsurge && !runtime.movesById.has("gmaxsteelsurge")) add(`${key}.steelsurge`, "G-Max Steelsurge is not in this game.");
  }
  return { field, pokemon };
}

/**
 * status2 (ADDENDUM2 §3.7, IN §3.5, T2E §3.1, C40): the action issue of a slot's carried state, or null: a two-turn move it
 * charged, Encore, Uproar and Bide lock its action; Disable forbids its move; Taunt forbids a status move (Me First and a
 * Z-Move aside) and Heal Block a heal-flag move (a Z-Move or Max Move aside).
 */
function carriedAction(input: DoublesTurnInput, slot: DoublesSlotId): string | null {
  const entry = input.pokemon[slot]!;
  const carried = entry.carried ?? {};
  const { runtime } = input;
  const moveId = entry.action.moveId;
  const name = (id: string) => runtime.movesById.get(id)?.name ?? id;
  const zOrMax = !!moveId && (!!entry.contexts[moveId]?.useZ || isMaxActive(entry.build));
  if (carried.charging && moveId !== carried.charging) return `It is locked into ${name(carried.charging)}.`;
  if (carried.encore && moveId !== carried.encore.move) return `Encore locks it into ${name(carried.encore.move)}.`;
  if (carried.uproar !== undefined && moveId !== "uproar") return "It is locked into Uproar.";
  if (carried.bide && moveId !== "bide") return "It is locked into Bide.";
  if (carried.disable && moveId === carried.disable.move) return `${name(moveId)} is disabled.`;
  const names = turnNames(input);
  if (carried.taunt !== undefined && moveId && moveId !== "mefirst" && !entry.contexts[moveId]?.useZ && runtime.movesById.get(moveId)?.category === "Status") {
    return `${names[slot]} is taunted: it cannot use ${name(moveId)}.`;
  }
  if (carried.healBlock !== undefined && moveId && !zOrMax && healFlag(moveId, runtime.profile.id as BattleGame)) return `${names[slot]} is under Heal Block: it cannot use ${name(moveId)}.`;
  return null;
}

/** status2 (ADDENDUM2 §3.7, IN §3.5, T2E §3.1): the turn-level inputs' issues (DoublesTurnInput's earlier-turn fields). */
function turnIssues(input: DoublesTurnInput): BuildIssue[] {
  const out: BuildIssue[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const whole = (value: number, least: number, most = Infinity) => Number.isInteger(value) && value >= least && value <= most;
  if (input.entryOrder && Object.values(input.entryOrder).some((rank) => !whole(rank!, 0))) add("entryOrder", "Entry ranks are whole numbers from 0.");
  if (typeof input.battleLastMove === "string" && !input.runtime.movesById.has(input.battleLastMove)) add("battleLastMove", "The battle's last move is not in this game.");
  if (input.echoedVoice !== undefined && !whole(input.echoedVoice, 0, 5)) add("echoedVoice", "Echoed Voice's multiplier is 0 to 5.");
  const up: Record<"terrain" | "gravity" | "magicRoom", { on: boolean; name: string; most: number }> = {
    terrain: { on: !!input.field.terrain, name: "The terrain", most: 8 },
    gravity: { on: !!input.field.gravity, name: "Gravity", most: 5 },
    magicRoom: { on: !!input.field.magicRoom, name: "Magic Room", most: 5 },
  };
  for (const [key, turns] of Object.entries(input.fieldTurns ?? {}) as ["terrain" | "gravity" | "magicRoom", number][]) {
    if (!up[key].on) add(`fieldTurns.${key}`, `${up[key].name} is not up.`);
    else if (!whole(turns, 1)) add(`fieldTurns.${key}`, "Turns left are 1 or more.");
    else if (turns > up[key].most) add(`fieldTurns.${key}`, `${up[key].name} lasts 1 to ${up[key].most} more turns.`);
  }
  return out;
}

/**
 * The issues of a slot's state from earlier turns and its move history (status-eot SPEC §3.1, ADDENDUM §3.1), shown as
 * "{Name}: …": carried sleep without Asleep or more turns than any sleep lasts (2–4 turns, Champions and Rest 2–3: the
 * hidden counter would be 0; Early Bird counts each turn twice), carried freeze outside Champions, without Frozen or past
 * its third turn, confusion turns outside 0–4, bad poison turns without Badly poisoned or outside 0–15, a Leech Seed,
 * trap or Syrup Bomb source that is not a foe in the turn, a perish count outside 1–3, a Wish or a Substitute below 1 HP
 * (a Wish's HP is half its user's maximum, which can be more than the receiver's; a Substitute Shed Tail passed keeps its
 * maker's quarter: C13′), an Ally Switch counter outside Scarlet/Violet and Champions or not a power of 3 from 3 to 729,
 * a last move not in the game's catalog, and a moves list with a move twice.
 */
function carriedIssues(input: DoublesTurnInput, slot: DoublesSlotId): BuildIssue[] {
  const entry = input.pokemon[slot]!;
  const { runtime } = input;
  const out: BuildIssue[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const whole = (value: number, least: number, most = Infinity) => Number.isInteger(value) && value >= least && value <= most;
  const champions = runtime.profile.id === "champions";
  const { build } = entry;
  const carried = entry.carried ?? {};
  if (carried.sleep) {
    const { attempts, rest } = carried.sleep;
    const longest = rest || champions ? 3 : 4;
    if (build.status !== "slp") add("carried.sleep", "turns lost to sleep need the Asleep status.");
    else if (!whole(attempts, 0) || attempts * (build.abilityId === "earlybird" ? 2 : 1) >= longest) add("carried.sleep", `it cannot have lost ${attempts} turns to sleep.`);
  }
  if (carried.freeze) {
    if (!champions) add("carried.freeze", "turns lost to freeze are counted in Champions only.");
    else if (build.status !== "frz") add("carried.freeze", "turns lost to freeze need the Frozen status.");
    else if (!whole(carried.freeze.attempts, 0, 2)) add("carried.freeze", `it cannot have lost ${carried.freeze.attempts} turns to freeze.`);
  }
  if (carried.confusion && !whole(carried.confusion.attempts, 0, 4)) add("carried.confusion", "confusion turns so far are 0 to 4.");
  if (carried.toxic !== undefined) {
    if (build.status !== "tox") add("carried.toxic", "bad poison turns need the Badly poisoned status.");
    else if (!whole(carried.toxic, 0, 15)) add("carried.toxic", "bad poison turns are 0 to 15.");
  }
  // status2 C32: the seeder, the trapper and Syrup Bomb's source may be the ally (the handlers read positions and sources).
  const source = (from: DoublesSlotId | undefined) => !from || (from !== slot && !!input.pokemon[from]);
  if (!source(carried.leechSeed)) add("carried.leechSeed", "Leech Seed's seeder is not a Pokémon of the turn.");
  if (!source(carried.trap?.source)) add("carried.trap", "the trap's source is not a Pokémon of the turn.");
  else if (carried.trap?.move && !runtime.movesById.has(carried.trap.move)) add("carried.trap", "the trap's move is not a move of this game.");
  if (!source(carried.syrupBomb)) add("carried.syrupBomb", "Syrup Bomb's source is not a Pokémon of the turn.");
  if (carried.perish !== undefined && !whole(carried.perish, 1, 3)) add("carried.perish", "the perish count is 1, 2 or 3.");
  if (carried.wish !== undefined && !whole(carried.wish, 1)) add("carried.wish", "a Wish restores at least 1 HP.");
  if (carried.substitute !== undefined && !whole(carried.substitute, 1)) add("carried.substitute", "a Substitute has at least 1 HP.");
  // status2 C23: 1 is "not used last turn" (no assumption).
  if (carried.allySwitch !== undefined && (!(champions || runtime.profile.id === "scarlet_violet") || ![1, 3, 9, 27, 81, 243, 729].includes(carried.allySwitch))) {
    add("carried.allySwitch", "Ally Switch's counter is 1, 3, 9, 27, 81, 243 or 729 (Scarlet/Violet and Champions).");
  }
  if (typeof entry.lastMove === "string" && !runtime.movesById.has(entry.lastMove)) add("lastMove", "its last move is not in this game.");
  if (entry.moves && new Set(entry.moves).size !== entry.moves.length) add("moves", "its moves list a move twice.");
  out.push(...status2Issues(input, slot));
  return out;
}

/**
 * status2's carried-state issues (SPEC2 §3.1, ADDENDUM2 §3.7, IN §3.5, T2E §3.1, T2M §2.1, T2P §9.1), as `{Name}: …` on the
 * slot; each only when its input is set.
 */
function status2Issues(input: DoublesTurnInput, slot: DoublesSlotId): BuildIssue[] {
  const entry = input.pokemon[slot]!;
  const { runtime } = input;
  const out: BuildIssue[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const whole = (value: number, least: number, most = Infinity) => Number.isInteger(value) && value >= least && value <= most;
  const { build } = entry;
  const carried = entry.carried ?? {};
  const gen9 = runtime.profile.id === "scarlet_violet" || runtime.profile.id === "champions";
  const moveName = (id: string) => runtime.movesById.get(id)?.name ?? id;
  const inGame = (field: string, id: string) => { if (!runtime.movesById.has(id)) add(field, `${moveName(id)} is not in this game.`); };
  const other = (from: DoublesSlotId) => from !== slot && !!input.pokemon[from];
  // A1: Stockpile, Power Trick and Power Shift, No Retreat, Minimize, Gastro Acid, a charged two-turn move, the stages.
  if (carried.stockpile) {
    const { layers, def, spd } = carried.stockpile;
    if (!whole(layers, 1, 3)) add("carried.stockpile", "Stockpile has 1 to 3 layers.");
    else if ([def, spd].some((count) => count !== undefined && !whole(count, -layers, 0))) add("carried.stockpile", "Stockpile changes each stat at most once per layer.");
    inGame("carried.stockpile", "stockpile");
  }
  if (carried.powerTrick) inGame("carried.powerTrick", "powertrick");
  if (carried.powerShift) inGame("carried.powerShift", "powershift");
  if (carried.noRetreat) inGame("carried.noRetreat", "noretreat");
  if (carried.minimize) inGame("carried.minimize", "minimize");
  if (carried.gastroAcid) {
    inGame("carried.gastroAcid", "gastroacid");
    if (CANT_SUPPRESS.has(build.abilityId)) add("carried.gastroAcid", `Gastro Acid cannot suppress ${runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId}.`);
  }
  if (carried.charging && !(CHARGE_TURN_MOVES.has(carried.charging) || SEMI_INVULNERABLE_MOVES.has(carried.charging) || carried.charging === "geomancy") || (carried.charging && !runtime.movesById.has(carried.charging))) {
    add("carried.charging", `${moveName(carried.charging!)} is not a two-turn move.`);
  }
  if (carried.stages && Object.values(carried.stages).some((stage) => stage !== undefined && !whole(stage, -6, 6))) add("carried.stages", "Accuracy and evasion stages are −6 to +6.");
  // A2: Tar Shot, Foresight, Miracle Eye, Telekinesis, Heal Block, Embargo, Nightmare, Octolock, Attract.
  if (carried.tarShot) inGame("carried.tarShot", "tarshot");
  if (carried.foresight) inGame("carried.foresight", "foresight");
  if (carried.miracleEye) inGame("carried.miracleEye", "miracleeye");
  if (carried.foresight && carried.miracleEye) add("carried.miracleEye", "Foresight and Miracle Eye cannot both be on it.");
  if (carried.telekinesis !== undefined) inGame("carried.telekinesis", "telekinesis");
  if (carried.healBlock !== undefined && !whole(carried.healBlock, 1, 4)) add("carried.healBlock", "Heal Block lasts 1 to 4 more turns.");
  if (carried.embargo !== undefined) inGame("carried.embargo", "embargo");
  if (carried.nightmare) {
    inGame("carried.nightmare", "nightmare");
    if (build.status !== "slp" && build.abilityId !== "comatose") add("carried.nightmare", "Nightmare needs the Asleep status or Comatose.");
  }
  if (carried.octolock) {
    inGame("carried.octolock", "octolock");
    if (!isFoe(slot, carried.octolock) || !input.pokemon[carried.octolock]) add("carried.octolock", "Octolock's source is not a foe in the turn.");
  }
  if (carried.attract) {
    inGame("carried.attract", "attract");
    const gender = (each: DoublesSlotId) => input.pokemon[each]?.build.configuration?.gender ?? runtime.speciesById.get(input.pokemon[each]?.build.speciesId ?? "")?.gender;
    if (!other(carried.attract)) add("carried.attract", "Attract's source is not in the turn.");
    else {
      const own = gender(slot), theirs = gender(carried.attract);
      if (own && theirs && (own === "N" || theirs === "N" || own === theirs)) add("carried.attract", "Infatuation needs opposite genders.");
    }
  }
  // D: a pending copy, the Berserk lock, Ripen's weakened Berry, the last item.
  if (carried.copy && Object.values(carried.copy).some((amount) => amount !== undefined && !(amount > 0))) add("carried.copy", "A pending copy raises each stat by 1 or more.");
  if (carried.berryLocked && !((build.abilityId === "berserk" || build.abilityId === "angershell") && HEALING_BERRIES.has(build.itemId))) add("carried.berryLocked", "A Berry lock needs Berserk or Anger Shell and a healing Berry.");
  if (carried.berryWeaken && build.abilityId !== "ripen") add("carried.berryWeaken", "Only Ripen weakens the next hit after a Berry.");
  if (carried.glaiveRush) inGame("carried.glaiveRush", "glaiverush");
  if (typeof entry.lastItem === "string" && !runtime.itemsById.has(entry.lastItem)) add("lastItem", "its last item is not in this game.");
  if (entry.earlierThisTurn?.usedItem && typeof entry.lastItem !== "string") add("earlierThisTurn", "An item used earlier this turn needs the item.");
  // H: Lock-On.
  if (carried.lockOn && !other(carried.lockOn)) add("carried.lockOn", "Lock-On's target is not a Pokémon of the turn.");
  // N: the stall counter (C23), the recharge, Laser Focus, Taunt, Encore, Disable, Mental Herb, the once-a-battle effects.
  if (carried.stall !== undefined && ![1, 3, 9, 27, 81, 243, 729].includes(carried.stall)) add("carried.stall", "The protecting moves' counter is 1, 3, 9, 27, 81, 243 or 729.");
  if (carried.laserFocus && !runtime.movesById.has("laserfocus")) add("carried.laserFocus", "Laser Focus is not in this game.");
  if (carried.taunt !== undefined && !whole(carried.taunt, 1, 3)) add("carried.taunt", "Taunt lasts 1 to 3 more turns.");
  if (carried.encore && !whole(carried.encore.turns, 1, 3)) add("carried.encore", "Encore lasts 1 to 3 more turns.");
  if (carried.disable && !whole(carried.disable.turns, 1, 4)) add("carried.disable", "Disable lasts 1 to 4 more turns.");
  const mentalHerb = build.itemId === "mentalherb" && !input.field.magicRoom && build.abilityId !== "klutz" && carried.embargo === undefined;
  if (mentalHerb && (carried.taunt !== undefined || carried.encore || carried.disable || carried.attract || carried.healBlock !== undefined)) add("carried.mentalHerb", "Mental Herb would have cured it.");
  if (carried.onceUsed?.length) {
    const known = ["battlebond", "intrepidsword", "dauntlessshield", "supersweetsyrup"];
    if (!gen9 || carried.onceUsed.some((id) => !known.includes(id))) add("carried.onceUsed", "Only generation 9 counts once-a-battle effects.");
    else if (carried.onceUsed.includes("battlebond") && runtime.profile.id !== "scarlet_violet") add("carried.onceUsed", "Battle Bond counts once a battle in Scarlet/Violet only.");
  }
  if (carried.mustRecharge && entry.action.moveId !== null) add("carried.mustRecharge", "A Pokémon that must recharge takes no move.");
  if (carried.destinyBond) inGame("carried.destinyBond", "destinybond");
  // T2E: a Pokémon that switched in this turn.
  if (entry.switchedIn && entry.action.moveId !== null) add("switchedIn", "A Pokémon that switched in this turn takes no move.");
  if (entry.switchedIn && carried.mustRecharge) add("switchedIn", "A Pokémon that switched in this turn does not recharge.");
  if (entry.switchedIn && entry.firstTurn === false) add("firstTurn", "A Pokémon that switched in this turn is on its first turn.");
  // E: Cud Chew's Berry, a landing's user.
  if (typeof carried.cudChew === "string") {
    if (!carried.cudChew.endsWith("berry") || !runtime.itemsById.has(carried.cudChew)) add("carried.cudChew", "Cud Chew re-eats a Berry.");
    else if (build.abilityId !== "cudchew") add("carried.cudChew", "Only Cud Chew re-eats a Berry.");
  }
  if (carried.futureMove && typeof carried.futureMove === "object") {
    const future = carried.futureMove;
    const name = moveName(future.move);
    if (!runtime.movesById.has(future.move)) add("carried.futureMove", `${name} is not in this game.`);
    else if ("source" in future && !input.pokemon[future.source]) add("carried.futureMove", `Its ${name}'s user is not in the turn.`);
    else if ("build" in future) for (const issue of validateBuild(future.build, runtime)) add("carried.futureMove", `${name}'s user: ${issue.message}`);
  }
  // CL: Uproar. PR: Bide, Commander, Fury Cutter, Rollout.
  if (carried.uproar !== undefined && !whole(carried.uproar, 1, 2)) add("carried.uproar", "Uproar lasts 1 to 2 more turns.");
  if (carried.bide) {
    if (runtime.profile.id !== "ultra_sun_ultra_moon") add("carried.bide", "Bide is not in this game.");
    else if (!whole(carried.bide.stored, 0)) add("carried.bide", "Bide's stored damage is a whole number.");
  }
  if (carried.commanding && !(build.speciesId.startsWith("tatsugiri") && input.pokemon[allyOf(slot)]?.build.speciesId.startsWith("dondozo"))) add("carried.commanding", "Only Tatsugiri commands, from its ally Dondozo.");
  if (carried.furyCutter !== undefined && entry.moves && !entry.moves.includes("furycutter")) add("carried.furyCutter", "Fury Cutter is not one of its moves.");
  if (carried.rollout !== undefined && entry.moves && !entry.moves.includes("rollout") && !entry.moves.includes("iceball")) add("carried.rollout", "Rollout is not one of its moves.");
  if (carried.defenseCurl) inGame("carried.defenseCurl", "defensecurl");
  if (carried.ppLeft && Object.entries(carried.ppLeft).some(([id, left]) => !runtime.movesById.has(id) || !whole(left, 0))) add("carried.ppLeft", "PP left is a whole number from 0, for a move of this game.");
  return out;
}

/** Every learnable move of `slot` into `into` at the start of the turn (four-way settle, partners' abilities; no move of this turn). */
export function calculateDoublesMoves(input: DoublesTurnInput, slot: DoublesSlotId, into: DoublesSlotId): MatchupResult {
  const { runtime } = input;
  const attacker = input.pokemon[slot], defender = input.pokemon[into];
  const known = (build: BattleBuild) => validateBuild(build, runtime).filter((issue) => !(usedProtean(build, issue) && build.types?.length));
  const issues = { attacker: attacker ? known(attacker.build) : [], defender: defender ? known(defender.build) : [], field: validateConditions({ ...input.field, gameType: "Doubles" }, runtime) };
  if (!attacker || !defender || slot === into || Object.values(issues).some((list) => list.length)) return { issues, results: [] };
  const settle = settleOf(input);
  const species = runtime.speciesById.get(attacker.build.speciesId)!;
  if (!settle.slots[slot] || !settle.slots[into]) {
    return { issues, results: species.moves.flatMap((id) => { const move = runtime.movesById.get(id); return move ? [{ ...emptyRow(move, settle.reason ?? REASONS.tooMany) }] : []; }) };
  }
  return pairRows(input, settle, slot, into, species.moves, attacker.contexts);
}

function emptyRow(move: ChampionsMove, reason: string): MoveDamageResult {
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind: "unsupported", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: move.description, assumptions: [], reason, hits: null,
  };
}

/**
 * Where `slot` using `moveId` stands in the turn's order as the turn starts (the pane's and the start rows' Analytic,
 * Bolt Beak and Fishious Rend, read as contextFor reads the turn: sim/battle-queue.ts willMove): each action's priority,
 * its fractional priority outcomes (Quick Claw, Quick Draw...) and its Speed in the start world (generation 7: the
 * first-turn Speed), every combination of outcomes. "last" when every other action (`against` alone, when set) comes
 * before it in each, "first" when one comes after it in each; otherwise why the order is not known.
 */
function startOrder(ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, against: DoublesSlotId | null): "first" | "last" | { reason: string } {
  type Key = { slot: DoublesSlotId; outcomes: { value: number; fact?: string }[]; priority: number; speed: number };
  const key = (each: DoublesSlotId, id: string | null): Key => {
    const action: PendingAction = { index: -1, slot: each, moveId: id, target: null, fractional: 0 };
    return { slot: each, outcomes: fractionalOutcomes(ctx, w.mons[each]!.build, id, w.field.magicRoom), priority: priorityOf(ctx, w, action), speed: speedOf(ctx, w, each, ctx.gen7) };
  };
  const mine = key(slot, moveId);
  const others = DOUBLES_SLOTS.filter((each) => each !== slot && w.mons[each] && (!against || each === against)).map((each) => key(each, ctx.input.pokemon[each]!.action.moveId));
  if (!others.length) return "last";
  let after = 0, before = 0, combos = 0;
  let tie: number | null = null;
  const facts = new Set<string>();
  const walk = (index: number, chosen: number[]) => {
    if (index < others.length) {
      for (const outcome of others[index].outcomes) { if (outcome.fact && others[index].outcomes.length > 1) facts.add(`${ctx.names[others[index].slot]}'s ${outcome.fact}`); walk(index + 1, [...chosen, outcome.value]); }
      return;
    }
    for (const own of mine.outcomes) {
      if (own.fact && mine.outcomes.length > 1) facts.add(`${ctx.names[slot]}'s ${own.fact}`);
      combos++;
      let later = false, sure = true;
      others.forEach((other, at) => {
        const theirs = other.priority + chosen[at], ours = mine.priority + own.value;
        if (theirs === ours && other.speed === mine.speed) { sure = false; tie = mine.speed; }
        else if (theirs < ours || (theirs === ours && other.speed < mine.speed)) later = true;
      });
      if (later) after++;
      else if (sure) before++;
    }
  };
  walk(0, []);
  if (after === combos) return "first";
  if (before === combos) return "last";
  return { reason: tie !== null ? `Speed tie at ${Math.abs(tie)}` : [...facts].join(" and ") };
}

/**
 * The start pair's rows (calculate.ts matchupRows), with the partners' flags from the start of the turn: Flower Gift
 * per move (flowerGift reads the move), a partner's power boost (conditionsFor), and the turn order Analytic, Bolt Beak
 * and Fishious Rend read (startOrder). `several`: whether the move reaches more than `into` as it is used (false: both of
 * Dragon Darts' darts into it; a spread move's living targets), where the start rows know (startRoutes); otherwise the
 * target rule's hits or, for a move aimed at one, whether more than one other Pokémon is in.
 */
function pairRows(input: DoublesTurnInput, settle: DoublesSettle, slot: DoublesSlotId, into: DoublesSlotId, moves: readonly string[], contexts: Record<string, MoveContext>, several?: boolean): MatchupResult {
  const { runtime } = input;
  const memo: Memo = { searches: new Map(), priorities: new Map(), speeds: new Map(), moves: new Map(), rows: new Map(), calculations: -Infinity };
  const ctx = createContext(input, settle, memo, "all", null);
  const world = startWorld(ctx, settle);
  const a = settle.slots[slot]!, d = settle.slots[into]!;
  const multiple = several ?? DOUBLES_SLOTS.filter((each) => each !== slot && input.pokemon[each]).length > 1;
  const plain = conditionsFor(ctx, world, slot, into, multiple);
  const plus = calcBuild(ctx, world, slot);
  const attacker = { ...a.build, abilityActive: plus.abilityActive };
  const analytic = attacker.abilityId === "analytic";
  const ordered = new Map<string, { reason: string }>();
  const own: Record<string, MoveContext> = { ...contexts };
  for (const id of moves) {
    const move = runtime.movesById.get(id);
    if (!move || (move.category === "Status" && !contexts[id]?.useZ)) continue;
    const reads = (analytic && !FUTURE_MOVES.has(id)) || id === "boltbeak" || id === "fishiousrend";
    if (!reads) continue;
    let order: ReturnType<typeof startOrder>;
    try {
      order = startOrder(ctx, world, slot, id, analytic ? null : into);
    } catch (error) {
      if (error instanceof NotEstimated) { ordered.set(id, { reason: error.reason }); continue; }
      throw error;
    }
    if (typeof order === "string") own[id] = { ...contexts[id], turnOrder: order };
    else if (analytic) ordered.set(id, order);
  }
  // Payback doubles once its target has moved (contextFor: !willMove), read from the four chosen actions as the turn
  // starts (startOrder against the target); an order the start does not know leaves its row not calculated.
  let paybackUnknown: string | null = null;
  if (moves.includes("payback")) {
    let order: ReturnType<typeof startOrder>;
    try {
      order = startOrder(ctx, world, slot, "payback", into);
    } catch (error) {
      if (!(error instanceof NotEstimated)) throw error;
      order = { reason: error.reason };
    }
    if (typeof order === "string") own.payback = { ...own.payback, doubled: order === "last" };
    else paybackUnknown = order.reason;
  }
  // Last Respects counts the side's empty slots (side.totalFainted), the count given or more (contextFor).
  const fallen = emptySlots(input, slotSide(slot));
  if (moves.includes("lastrespects") && fallen > (own.lastrespects?.fainted ?? 0)) own.lastrespects = { ...own.lastrespects, fainted: fallen };
  // Moves whose calculation reads a different field are calculated apart: Flower Gift (an ignoreAbility move, Body
  // Press), a spread move's targets as the turn starts (doublesTargetRule: more than one in place), a one-target Z-Move,
  // and the Explosion family, whose user's handlers on others are gone as it hits (World.ghost: its Friend Guard on its
  // partner, its aura or Ruin), as the turn reads them (damagingMove).
  const fieldKey = (conditions: BattleConditions) => JSON.stringify(conditions);
  const groups = new Map<string, { field: BattleConditions; moves: string[] }>([[fieldKey(plain), { field: plain, moves: [] }]]);
  const ghost = Object.assign(cloneWorld(world), { ghost: slot });
  for (const id of moves) {
    // A status move's row reads no field.
    const damaging = runtime.movesById.get(id)?.category !== "Status" || !!contexts[id]?.useZ;
    const rule = damaging && runtime.movesById.has(id) ? doublesTargetRule(input, slot, id) : null;
    const spread = several ?? (rule?.kind === "auto" && !rule.random ? rule.hits.length > 1 : multiple);
    const info = damaging && SELF_DESTRUCT_MOVES.has(id) ? moveInfo(ctx, world, slot, id, contexts[id]) : null;
    const exploding = info?.kind === "move" && !info.transformed;
    const conditions = damaging && (spread !== multiple || plain.attackerSide.flowerGift || plain.defenderSide.flowerGift || contexts[id]?.useZ || exploding)
      ? conditionsFor(ctx, exploding ? ghost : world, slot, into, spread, id) : plain;
    const groupKey = fieldKey(conditions);
    let group = groups.get(groupKey);
    if (!group) groups.set(groupKey, group = { field: conditions, moves: [] });
    group.moves.push(id);
  }
  const rows = new Map<string, MoveDamageResult>();
  let result: MatchupResult | null = null;
  for (const { field: conditions, moves: part } of groups.values()) {
    if (!part.length && (result || moves.length)) continue;
    // Friend Guard is dropped where the attacker's Mold Breaker ignores it (settleMatchup's suppressor).
    const suppressor = conditions.defenderSide.friendGuard ? partnerAbilitySuppressor(attacker, d.build, runtime) : null;
    const field = suppressor ? { ...conditions, defenderSide: { ...conditions.defenderSide, friendGuard: false } } : conditions;
    const settled: SettledMatchup = {
      issues: { attacker: [], defender: [], field: [] },
      attacker, defender: d.build, field, moves: part,
      notes: [...a.lines, ...d.lines], names: { attacker: ctx.names[slot], defender: ctx.names[into] },
      attackerItems: a.items, defenderItems: d.items, suppressor,
      ...(a.items.settledHP || d.items.settledHP ? { settledHP: { ...(a.items.settledHP ? { attacker: a.items.settledHP } : {}), ...(d.items.settledHP ? { defender: d.items.settledHP } : {}) } } : {}),
    };
    const computed = matchupRows(settled, own, runtime);
    result ??= computed;
    part.forEach((id, index) => { if (computed.results[index]) rows.set(id, computed.results[index]); });
  }
  // The target's resist Berry where the calculation reads Unnerve otherwise than the turn (resistUnnerve): the rows of
  // the type it resists are not estimated.
  const unnerved = RESIST_BERRIES.has(world.mons[into]!.build.itemId) ? reactionHooks.resistUnnerve(kernelOf(ctx), world, slot, into) : null;
  const resisted = unnerved ? getBerryResistType(runtime.itemsById.get(d.build.itemId)?.name as never) : undefined;
  // A Substitute from an earlier turn (carried.substitute) takes a move that does not pass it (doubles-substitute.ts
  // meetsSubstitute: no sound or bypassing move, no Infiltrator): the calculation into the Pokémon is not what the move
  // deals there (a 30 HP Substitute in front of Rock Blast: Showdown's most is 124 by 1-4 hits), so the row is not estimated.
  // An immunity comes before the Substitute (sim/battle-actions.ts hitStepTryHitEvent and hitStepTypeImmunity; the
  // Substitute's TryPrimaryHit is in the hit loop): a row with no damage stays.
  const behindSubstitute = (id: string) => {
    if (!world.mons[into]?.vol.substitute) return false;
    let info: TurnMove;
    try { info = moveInfo(ctx, world, slot, id, own[id]); } catch (error) { if (error instanceof NotEstimated) return true; throw error; }
    return info.kind === "move" && substituteHooks.meetsSubstitute(world.mons[slot]!.build, info);
  };
  const results = moves.flatMap((id) => {
    const row = rows.get(id);
    if (!row) return [];
    if ((row.kind === "calculated" ? (row.max ?? 0) > 0 : row.kind === "needs-context") && behindSubstitute(id)) {
      const { effectiveName, effectiveType, effectivePower, effectiveCategory } = row;
      return [{ ...emptyRow(runtime.movesById.get(id)!, `${ctx.names[into]} is behind a Substitute.`), effectiveName, effectiveType, effectivePower, effectiveCategory }];
    }
    if (resisted && row.kind === "calculated" && row.effectiveType === resisted) return [emptyRow(runtime.movesById.get(id)!, unnerved!)];
    const unknown = ordered.get(id);
    // An Analytic hit whose order is not known as the turn starts (the 1v1 text with the reason).
    if (unknown && row.kind === "needs-context" && row.reason === "Analytic: needs the Doubles turn order.") return [{ ...row, reason: `Analytic: needs the turn order (${unknown.reason}).` }];
    if (id === "payback" && paybackUnknown !== null && row.kind === "calculated") return [emptyRow(runtime.movesById.get(id)!, `Payback: needs the turn order (${paybackUnknown}).`)];
    return [row];
  });
  return { ...result!, results };
}

/**
 * Where a start row's move goes as the turn starts (startRoutes): the Pokémon, a fact, its row when it is no calculation,
 * and whether it reaches one Pokémon alone (`oneTarget`: both of Dragon Darts' darts) or, for a move that spreads as it is
 * used, several (`spread`).
 */
export type StartRoute = { target: DoublesSlotId; fact?: string; oneTarget?: boolean; spread?: boolean; row?: MoveDamageResult; conditional?: true };

/**
 * Why `slot`'s move fails in TryMove as the turn starts (moveFailure on `last`, the last Pokémon it reaches, with every
 * other Pokémon's chosen action still to come but one that certainly comes first, and the move's priority bracket), or null.
 * `first`: a Pokémon whose move has been used by then (a centre of attention's user, for the row it makes).
 */
function startFailure(ctx: Ctx, w: World, slot: DoublesSlotId, move: ChampionsMove, info: Extract<TurnMove, { kind: "move" }>, last: DoublesSlotId, first?: DoublesSlotId): string | null {
  const queue = cloneWorld(w);
  const pending = (index: number, each: (typeof ctx.actions)[number]): PendingAction => ({ index, slot: each.slot, moveId: each.moveId, target: each.target, fractional: 0 });
  // Sucker Punch, Thunderclap and Upper Hand read the target's queued move: one that comes before them in every order
  // the start allows (startOrder) has moved by then.
  let moved = false;
  if ((TARGET_ATTACK_MOVES.has(move.id) || move.id === "upperhand") && !info.transformed && ctx.input.pokemon[last]) {
    try {
      moved = last === first || startOrder(ctx, w, slot, move.id, last) === "last";
    } catch (error) {
      if (!(error instanceof NotEstimated)) throw error;
    }
  }
  queue.remaining = ctx.actions.flatMap((each, index) => (each.slot === slot || each.slot === first || (moved && each.slot === last) ? [] : [pending(index, each)]));
  const own = ctx.actions.findIndex((each) => each.slot === slot);
  const failure = moveFailure(ctx, queue, pending(own, ctx.actions[own]), move, last, priorityOf(ctx, queue, pending(own, ctx.actions[own])), info);
  return moved && failure ? `${move.name} fails: ${ctx.names[last]} moves first.` : failure;
}

/**
 * The centres of attention this turn's moves make, each set as it is once its move has been used (data/moves.ts
 * followme, ragepowder: on their user; spotlight: on its target, or on its user when reflected), in a copy of the start
 * world; null when no Pokémon chose one. `users`: each centre's user. A Dynamaxed Pokémon's status move is Max Guard.
 */
function centredWorld(ctx: Ctx, w: World): { world: World; users: Map<DoublesSlotId, DoublesSlotId> } | null {
  let world: World | null = null;
  const users = new Map<DoublesSlotId, DoublesSlotId>();
  for (const slot of DOUBLES_SLOTS) {
    const entry = ctx.input.pokemon[slot];
    const moveId = entry?.action.moveId;
    if (!entry || !moveId || !w.mons[slot] || !(moveId in CENTRES) || isMaxActive(entry.build)) continue;
    let centre = moveId === "spotlight" ? aimedAt(ctx.input, slot) : slot;
    if (!centre || !w.mons[centre]) continue;
    if (moveId === "spotlight") {
      // Spotlight (priority 3; protect and reflectable flags): its target's protecting move (priority 4) stops it, and its
      // Magic Coat (4) or Magic Bounce (data/abilities.ts magicbounce onTryHit, breakable) reflects it onto its user.
      const targetMove = ctx.input.pokemon[centre]?.action.moveId ?? "";
      if (PROTECT_MOVES[targetMove]) continue;
      const holder = w.mons[centre]!.build;
      const shielded = holder.itemId === "abilityshield" && !w.field.magicRoom;
      if (targetMove === "magiccoat" || (holder.abilityId === "magicbounce" && (shielded || !MOLD_BREAKERS.has(w.mons[slot]!.build.abilityId)))) centre = slot;
    }
    world ??= cloneWorld(w);
    world.mons[centre]!.centre = moveId as keyof typeof CENTRES;
    users.set(centre, slot);
  }
  return world ? { world, users } : null;
}

/**
 * Whether `attacker`'s move can come after `user`'s as the turn starts: not when it moves first in every order the start
 * allows (startOrder: its priority bracket above, or the same bracket and faster, with every Quick Claw outcome; sim/battle.ts
 * comparePriority). An order the start does not know reads as can.
 */
function mayComeAfter(ctx: Ctx, w: World, attacker: DoublesSlotId, user: DoublesSlotId): boolean {
  try {
    return startOrder(ctx, w, attacker, ctx.input.pokemon[attacker]!.action.moveId!, user) !== "first";
  } catch (error) {
    if (error instanceof NotEstimated) return true;
    throw error;
  }
}

/**
 * The one smart target Dragon Darts' two darts both hit as the turn starts; "each" when each takes one (the target's
 * partner too: sim/pokemon.ts getSmartTargets), or null when that is not known: both darts go to the target when its
 * partner is the user or not in (resolveTargets), and to one when the other's would not land (dartsStep: an immunity).
 */
function dartsSplit(ctx: Ctx, w: World, slot: DoublesSlotId, move: ChampionsMove, target: DoublesSlotId, context: MoveContext | undefined): DoublesSlotId | "each" | null {
  const second = allyOf(target);
  if (second === slot || !alive(w, second)) return target;
  const lands = (each: DoublesSlotId) => {
    const row = usedRow(ctx, w, slot, move.id, each, context);
    return row.kind === "calculated" ? (row.max ?? 0) > 0 : null;
  };
  const first = lands(target), other = lands(second);
  if (first === null || other === null || (!first && !other)) return null;
  if (first && other) return "each";
  return first ? target : second;
}

/**
 * Where `slot`'s damaging move goes as the turn starts, for each Pokémon it is aimed at (`aimed`: the chosen one, each
 * foe of a random target, or a spread move's targets), as the turn resolves it (resolveTargets): Expanding Force and Tera
 * Starstorm spread to every foe in; a move that fails in TryMove fails into each (startFailure); a redirection that
 * applies at the start takes it (Lightning Rod, Storm Drain: its fact, and both of Dragon Darts' darts; two holders that
 * tie: their fact, no number); Dragon Darts' two darts both go to one smart target when there is no other or the other's
 * would not land, and otherwise one each, the target's partner a row of its own (dartsSplit); a centre of attention this
 * turn's moves make (Follow Me, Rage Powder, Spotlight) takes it once its move has been used, a row of its own with that
 * fact (or why the move then fails: startFailure with that move's user moved), unless the attacker moves first in every
 * order the start allows (mayComeAfter); Telepathy blocks it into its holder's ally (hitChecks). A move that spreads or
 * keeps its target is not redirected.
 */
function startRoutes(ctx: Ctx, w: World, centred: ReturnType<typeof centredWorld>, slot: DoublesSlotId, move: ChampionsMove, aimed: DoublesSlotId[]): StartRoute[] {
  const context = ctx.input.pokemon[slot]!.contexts[move.id];
  const info = moveInfo(ctx, w, slot, move.id, context);
  if (info.kind !== "move") return aimed.map((target) => ({ target }));
  const blocked = (target: DoublesSlotId): StartRoute => telepathyBlocks(w, slot, target, info) ? { target, row: emptyRow(move, `Telepathy blocks ${move.name}.`) } : { target };
  const type = usedTargetType(ctx, w, slot, move, info);
  // Expanding Force and Tera Starstorm, aimed at one, spread as they are used (resolveTargets).
  const reached = SPREAD_TARGETS.has(type) && !SPREAD_TARGETS.has(move.target) && aimed.length ? spreadTargets(w, slot, type) : aimed;
  // TryMove on the last of them (resolveTargets' last target, moveFailure): Sucker Punch, Thunderclap and Upper Hand
  // against the target's chosen move, Damp, the priority shields.
  const failure = reached.length ? startFailure(ctx, w, slot, move, info, SPREAD_TARGETS.has(type) || tracksTarget(w, slot, move, info) ? reached[reached.length - 1] : redirection(ctx, w, slot, reached[0], info, move.id, context)?.taken.slot ?? reached[0]) : null;
  if (failure) return reached.map((target) => ({ target, row: emptyRow(move, failure) }));
  if (SPREAD_TARGETS.has(type)) return reached.map((target) => ({ ...blocked(target), ...(reached !== aimed ? { spread: reached.length > 1 } : {}) }));
  if (tracksTarget(w, slot, move, info)) return aimed.map(blocked);
  const darts = move.id === "dragondarts" && !info.transformed;
  const routes: StartRoute[] = [];
  for (const target of aimed) {
    const found = redirection(ctx, w, slot, target, info, move.id, context);
    if (found?.ties.length) {
      const holders = [found.taken.slot, ...found.ties].map((each) => ctx.names[each]).join(" or ");
      routes.push({ target, row: emptyRow(move, `${found.taken.by}: ${holders} takes ${move.name}.`) });
      continue;
    }
    const taken = found && found.taken.slot !== target ? found.taken : null;
    const routed = taken?.slot ?? target;
    const split = darts && !taken ? dartsSplit(ctx, w, slot, move, routed, context) : null;
    routes.push({ ...blocked(routed), ...(taken ? { fact: takesFact(ctx, taken, move), oneTarget: darts } : {}), ...(split === routed ? { oneTarget: true } : {}) });
    // The other dart: into the target's partner (each takes one), or both there when the target's would not land.
    if (split === "each") routes.push(blocked(allyOf(routed)));
    else if (split && split !== routed) routes.push({ target: split, oneTarget: true });
    // The centre of attention this turn's moves make, once its move has been used.
    const centredRoute = (): StartRoute | null => {
      const later = centred ? redirection(ctx, centred.world, slot, target, info, move.id, context) : null;
      const user = later && centred!.users.get(later.taken.slot);
      if (!later || !user || later.ties.length || later.taken.slot === routed || !mayComeAfter(ctx, w, slot, user)) return null;
      // Spotlight keeps Dragon Darts' smart targeting (data/moves.ts spotlight): no game has both.
      if (darts && later.taken.by === CENTRES.spotlight.by) return null;
      // TryMove into it once that move has been used (Sucker Punch into the Follow Me user, which has moved).
      const fails = startFailure(ctx, w, slot, move, info, later.taken.slot, user);
      return {
        target: later.taken.slot, fact: `${later.taken.by}: ${ctx.names[later.taken.slot]} takes ${move.name} if ${later.taken.by} comes first.`,
        oneTarget: darts, conditional: true, ...(fails ? { row: emptyRow(move, fails) } : {}),
      };
    };
    const conditional = centredRoute();
    if (conditional) routes.push(conditional);
    // An Ally Switch chosen this turn (doubles-positions.ts startRoute, Track E: ADDENDUM §4.11.7).
    const swap = positionHooks.startRoute(kernelOf(ctx), w, slot, move, info, target, routed);
    if (swap) routes.push(swap);
  }
  // One row per Pokémon as the turn starts (a random target's two picks can meet), with a fact either gave, and one once a
  // centre of attention's move has been used where that one differs (both of Dragon Darts' darts, a failure).
  const kept: StartRoute[] = [];
  for (const route of routes) {
    const twin = kept.findIndex((known) => known.target === route.target && !!known.conditional === !!route.conditional);
    if (twin < 0) kept.push(route);
    else if (!kept[twin].fact && route.fact && !kept[twin].row) kept[twin] = { ...kept[twin], fact: route.fact };
  }
  const same = (a: StartRoute, b: StartRoute) => !!a.oneTarget === !!b.oneTarget && !!a.row === !!b.row && a.row?.reason === b.row?.reason;
  return kept.filter((route) => !route.conditional || !kept.some((known) => !known.conditional && known.target === route.target && same(known, route))).map((route) => {
    const { conditional, ...rest } = route;
    void conditional;
    return rest;
  });
}

/**
 * The damage of each chosen damaging move into each Pokémon it reaches, at the start of the turn
 * (DoublesTurnResult.startRows): where it goes then (startRoutes) and the pair's rows (pairRows).
 */
function startRows(input: DoublesTurnInput, settle: DoublesSettle): DoublesStartRow[] {
  const rows: DoublesStartRow[] = [];
  const memo: Memo = { searches: new Map(), priorities: new Map(), speeds: new Map(), moves: new Map(), rows: new Map(), calculations: -Infinity };
  const ctx = createContext(input, settle, memo, "all", null);
  const world = startWorld(ctx, settle);
  const centred = centredWorld(ctx, world);
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry?.action.moveId || !settle.slots[slot]) continue;
    const move = input.runtime.movesById.get(entry.action.moveId);
    if (!move || (move.category === "Status" && !entry.contexts[move.id]?.useZ)) continue;
    const rule = doublesTargetRule(input, slot, move.id);
    const aimed = aimedAt(input, slot);
    const targets = (rule.kind === "choose" ? (aimed ? [aimed] : []) : rule.kind === "auto" ? rule.hits : []).filter((target) => settle.slots[target]);
    let routes: StartRoute[];
    try {
      routes = startRoutes(ctx, world, centred, slot, move, targets);
    } catch (error) {
      if (!(error instanceof NotEstimated)) throw error;
      routes = targets.map((target) => ({ target, row: emptyRow(move, error.reason) }));
    }
    for (const route of routes) {
      if (!settle.slots[route.target]) continue;
      const row = route.row ?? pairRows(input, settle, slot, route.target, [move.id], entry.contexts, route.oneTarget ? false : route.spread).results[0];
      if (row) rows.push({ slot, target: route.target, row, ...(route.fact ? { fact: route.fact } : {}) });
    }
  }
  return rows;
}

/** The hit rule without the field's Critical hit, and with a certain critical hit met in the turn (calculateDoublesTurn). */
const NO_CRITS = "Every move hits; no critical hits; added effects below 100% do not happen.";
const CERTAIN_CRITS = "Every move hits; critical hits only where certain; added effects below 100% do not happen.";
/** calculate.ts's assumption for a critical-hit ratio that makes every hit critical. */
const CERTAIN_CRIT = "Every hit is a critical hit (";

/**
 * The turn's facts read from the input (SPEC §2.3; status-eot SPEC §2.5): the hit rule, then the end of turn's
 * (doubles-eot.ts endFacts: "End-of-turn effects are not applied." until Track B lands), the field's, and the tracks'
 * input facts (doubles-status.ts and doubles-positions.ts turnFacts), each once.
 */
function turnFacts(input: DoublesTurnInput, settle: DoublesSettle): string[] {
  const gas = settle.gas;
  const facts = [input.field.critical ? "Every move hits and every damaging hit is critical; added effects below 100% do not happen." : NO_CRITS, ...eotHooks.endFacts(input)];
  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart): the Pokémon whose abilities it suppresses.
  if (gas?.suppressed.length) {
    const names = turnNames(input);
    const list = DOUBLES_SLOTS.filter((slot) => gas.suppressed.includes(slot)).map((slot) => names[slot]);
    facts.push(`Neutralizing Gas suppresses the abilities of ${list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`}.`);
  }
  facts.push(...startHooks.turnFacts(settle));
  const targetless = targetlessSlots(input);
  if (targetless.size) facts.push("No target: both foes have fainted.");
  const moves = DOUBLES_SLOTS.filter((slot) => !targetless.has(slot)).map((slot) => input.pokemon[slot]?.action.moveId).filter((id): id is string => !!id);
  // Only the stalling moves with a protect volatile read the last turn (data/moves.ts protect onPrepareHit StallMove);
  // Wide Guard and Quick Guard check queue.willAct() alone from generation 7 (their onTry). status2: not for a Pokémon whose
  // counter is given (carried.stall).
  if (DOUBLES_SLOTS.some((slot) => !targetless.has(slot) && (!!PROTECT_MOVES[input.pokemon[slot]?.action.moveId ?? ""] || maxHooks.maxGuardAction(input, slot)) && input.pokemon[slot]!.carried?.stall === undefined)) {
    facts.push("Assumes no protecting move was used last turn.");
  }
  // Fake Out's and First Impression's own onTry (not their Z-Move's or Max Move's: hit-loop.ts ownMoveId); status2: not for a
  // Pokémon whose first turn is given (DoublesPokemonInput.firstTurn).
  const firstTurn = DOUBLES_SLOTS.some((slot) => {
    const entry = input.pokemon[slot], id = entry?.action.moveId;
    return !!entry && !!id && !targetless.has(slot) && entry.firstTurn === undefined && FIRST_TURN_MOVES.has(ownMoveId(id, { isZ: !!entry.contexts[id]?.useZ, isMax: isMaxActive(entry.build) }));
  });
  if (firstTurn) facts.push("Assumes the attacker's first turn in battle.");
  // status2 (T2E §3.5): a Pokémon that switched in this turn, one that must recharge.
  const named = turnNames(input);
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (entry?.switchedIn) facts.push(`${named[slot]} switched in this turn and takes no action.`);
    if (entry?.carried?.mustRecharge) facts.push(`${named[slot]} must recharge.`);
  }
  // status2 Step 1 #12 (ADDENDUM2 §2.5, C19): a Burning Jealousy or Alluring Voice of the turn can reach a Pokémon with a stage
  // above 0 as the turn starts whose earlier rise this turn the input does not give (DoublesPokemonInput.earlierThisTurn).
  for (const user of DOUBLES_SLOTS) {
    const entry = input.pokemon[user], id = entry?.action.moveId;
    if (!entry || targetless.has(user) || (id !== "burningjealousy" && id !== "alluringvoice") || entry.contexts[id]?.useZ || isMaxActive(entry.build)) continue;
    const reached = id === "burningjealousy" ? foesOf(user) : entry.action.target ? [entry.action.target] : [];
    for (const slot of reached) {
      const other = input.pokemon[slot];
      if (!other || slot === user || other.earlierThisTurn?.statsRaised) continue;
      const stages = [...Object.values(other.build.boosts), ...Object.values(other.carried?.stages ?? {})];
      if (stages.some((stage) => (stage ?? 0) > 0)) facts.push(`Assumes ${named[slot]}'s stats did not rise earlier this turn.`);
    }
  }
  if (input.field.trickRoom || moves.includes("trickroom")) facts.push("Trick Room: slower Pokémon move first.");
  // status2 Step 1 #4: the settled abilities (Trace's copy) for the first Update's cures.
  const settled = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, settle.slots[slot] ? { abilityId: settle.slots[slot]!.folded.abilityId } : null]));
  facts.push(...statusHooks.turnFacts(input, gas?.suppressed ?? [], settled), ...positionHooks.turnFacts(input));
  return [...new Set(facts)];
}

/**
 * HP distribution of each Pokémon over the finished worlds (the mixture of its marginals; masses not normalised), by monKey:
 * a slot's starting Pokémon by its slot (where it stands, or as it left: World.benched), a bench Pokémon that came in by
 * `{slot}|{id}` (status2 R-E).
 */
function distributions(worlds: World[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const add = (key: string, entries: Iterable<readonly [number, number]>, mass: number) => {
    let dist = out.get(key);
    if (!dist) out.set(key, dist = new Map());
    for (const [hp, share] of entries) dist.set(hp, (dist.get(hp) ?? 0) + share * mass);
  };
  for (const world of worlds) {
    for (const slot of DOUBLES_SLOTS) {
      if (!world.mons[slot]) continue;
      add(monKey(slot, world.mons[slot]!.id), marginal(world, slot), world.mass);
    }
    if (!world.benched) continue;
    for (const side of ["own", "opponent"] as const) for (const entry of world.benched[side] ?? []) if (!entry.back) add(monKey(entry.slot, entry.id), entry.hp, world.mass);
  }
  return out;
}

/** The most likely HP (SPEC §4.8): ties to the higher HP for `low`, to the lower for `high`. */
function modeOf(dist: Map<number, number> | undefined, preferHigh: boolean): number {
  let best = -1, bestMass = -1;
  for (const [hp, mass] of [...(dist ?? new Map<number, number>())].sort((a, b) => a[0] - b[0])) {
    if (mass > bestMass + 1e-12 || (Math.abs(mass - bestMass) <= 1e-12 && preferHigh)) { best = hp; bestMass = mass; }
  }
  return best;
}

/** The 2v2 turn (SPEC §4.1). */
export function calculateDoublesTurn(input: DoublesTurnInput): DoublesTurnResult {
  const invalid = validate(input);
  if (invalid) return invalid;
  const settle = settleOf(input);
  const facts = turnFacts(input, settle);
  const start: DoublesStart | null = settle.reason && DOUBLES_SLOTS.every((slot) => !settle.slots[slot]) ? null : Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = settle.slots[slot];
    if (!entry) return [slot, null];
    const hp = turnHP(entry.folded, input.runtime);
    return [slot, { hp: hp.hp, maximum: hp.maxHP, ...(entry.items.settledHP ? { settled: entry.items.settledHP } : {}) }];
  })) as DoublesStart;
  let rows: DoublesStartRow[] = [];
  const notEstimatedResult = (reason: string): DoublesTurnResult => {
    try { rows = start ? startHooks.rowsByVariant(settle, (one) => startRows(input, one)) : []; } catch { rows = []; }
    return { status: "not-estimated", reason, start, startRows: rows, facts };
  };
  if (settle.reason) return notEstimatedResult(settle.reason);
  const reference = DOUBLES_REFERENCE.on;
  const usesReference = USES_REFERENCE.on;
  if (reference) USES_REFERENCE.on = true;
  try {
    const memo: Memo = { searches: new Map(), priorities: new Map(), speeds: new Map(), moves: new Map(), rows: new Map(), calculations: 0 };
    const stats: StepStats[] = DOUBLES_SLOTS.filter((slot) => input.pokemon[slot]).map((slot) => ({
      slot, moveId: input.pokemon[slot]!.action.moveId ?? "", order: new Map(), moves: 0, positionSum: 0, positionMass: 0, skipped: new Map(), facts: new Map(), hits: new Map(),
    }));
    const all = createContext(input, settle, memo, "all", stats);
    presenceGuards(all, firstUpdated(all, settle));
    const finished = walk(all, settle);
    const lowCtx = createContext(input, settle, memo, "lowest", null), highCtx = createContext(input, settle, memo, "highest", null);
    const lowest = walk(lowCtx, settle);
    const highest = walk(highCtx, settle);
    // The end of turn on each walk's finished worlds (doubles-eot.ts endOfTurn, Track B).
    const ends = [endOfTurnOf(all, finished), endOfTurnOf(lowCtx, lowest), endOfTurnOf(highCtx, highest)] as const;
    const hp = hpRecords(all, start!, finished, lowest, highest);
    // A hit's KO chance is 1 when it is the only way its target faints on any branch and the target faints on every one
    // (its card's certain KO): the float sum of the branches can fall short of 1.
    const koHits = new Map<DoublesSlotId, number>();
    for (const step of stats) for (const [slot, each] of step.hits) if (each.ko > 0) bump(koHits, slot, 1);
    const certain = (slot: DoublesSlotId) => hp[slot]?.koChance === 1 && koHits.get(slot) === 1 && !all.otherFaints.has(slot);
    // A certain critical hit met in the turn (applyStep): the turn's hit rule says so.
    if (all.certainCrit && facts.includes(NO_CRITS)) facts.splice(facts.indexOf(NO_CRITS), 1, CERTAIN_CRITS);
    const steps = stats.filter((step) => step.moveId && !all.targetless.has(step.slot)).map((step): DoublesStep & { mean: number } => {
      const fact = (map: Map<string, number>): DoublesFact[] => [...map].map(([text, chance]) => ({ text, chance: Math.min(1, chance) }));
      // status2 R-E: with a Pokémon that came in reached, the hits in the step's order (StepStats.keys), its own apart (DoublesHit.id).
      const entries: [DoublesSlotId, HitStats, string | undefined][] = step.keys
        ? step.keys.map((key) => key.includes("|") ? [step.entered!.get(key)!.slot, step.entered!.get(key)!, step.entered!.get(key)!.id] : [key as DoublesSlotId, step.hits.get(key as DoublesSlotId)!, undefined])
        : [...step.hits].map(([slot, stats]) => [slot, stats, undefined]);
      const hits = entries.map(([slot, stats, id]): DoublesHit => {
        const met = [...stats.met.values()];
        const first = [...stats.firsts.values()].sort((a, b) => b.mass - a.mass)[0]?.row;
        const calculated = met.map(({ row }) => row).filter((row) => row.min !== null && row.max !== null);
        const min = calculated.length ? Math.min(...calculated.map((row) => row.min!)) : null;
        const max = calculated.length ? Math.max(...calculated.map((row) => row.max!)) : null;
        const maximum = id === undefined ? start?.[slot]?.maximum ?? 1 : enteredMaximum(all, slot, id);
        // A hit into a Substitute alone is "substitute" (ADDENDUM §3.5.9); a status move that acted, "effect" (Track A).
        const kind = stats.calculated > 0 ? "calculated" : stats.sub.mass > 0 ? "substitute" : stats.effect > 0 ? "effect" : stats.blocked > 0 ? "blocked" : "no-damage";
        const sub = stats.sub;
        return {
          slot, ...(id !== undefined ? { id } : {}), reached: Math.min(1, stats.reached), kind, min: kind === "calculated" ? min : null, max: kind === "calculated" ? max : null,
          minPercent: kind === "calculated" && min !== null ? min / maximum * 100 : null, maxPercent: kind === "calculated" && max !== null ? max / maximum * 100 : null,
          koChance: stats.ko > 0 && id === undefined && certain(slot) ? 1 : uncertain(stats.ko, stats.ko > 0), ...((kind === "calculated" || kind === "substitute") && first ? { row: first } : {}), cases: met.length, facts: fact(stats.facts),
          ...(stats.change ? { change: { ...stats.change } } : {}),
          ...(sub.mass > 0 ? { substitute: { chance: Math.min(1, sub.mass), min: sub.min, max: sub.max, breaks: Math.min(1, sub.breaks) } } : {}),
        };
      });
      const order = [...step.order].sort((a, b) => a[0] - b[0]).map(([position, chance]) => ({ position, chance: Math.min(1, chance) }));
      return {
        slot: step.slot, moveId: step.moveId, ...(step.effectiveName ? { effectiveName: step.effectiveName, effectiveType: step.effectiveType } : {}),
        order, moves: Math.min(1, step.moves), skipped: fact(step.skipped), hits, facts: fact(step.facts),
        ...(step.copied ? { copied: step.copied } : {}), ...(step.id !== undefined ? { id: step.id } : {}),
        mean: step.positionMass ? step.positionSum / step.positionMass : 0,
      };
    }).sort((a, b) => a.mean - b.mean || DOUBLES_SLOTS.indexOf(a.slot) - DOUBLES_SLOTS.indexOf(b.slot)).map((step): DoublesStep => {
      const { mean, ...rest } = step;
      void mean;
      return rest;
    });
    rows = startHooks.rowsByVariant(settle, (one) => startRows(input, one));
    // The end of turn: ready when every walk's is, its HP built as the moves' from the worlds after the residuals.
    const [endAll, endLow, endHigh] = ends;
    // status2 R-E: the Pokémon that came in (hpEntered) and the slots whose Pokémon left (replaced), after the moves and after
    // the turn (the switches after the residual: DoublesEndOfTurn.replaced).
    const entered = all.baseInput.bench ? enteredRecords(all, finished, lowest, highest) : null;
    const replaced = all.baseInput.bench ? replacedRecords(all, start!, finished, lowest, highest, false) : null;
    let endOfTurn: DoublesEndOfTurn;
    if (endAll.status === "ready" && endLow.status === "ready" && endHigh.status === "ready") {
      const ready: Extract<DoublesEndOfTurn, { status: "ready" }> = { status: "ready", hp: hpRecords(all, start!, endAll.worlds, endLow.worlds, endHigh.worlds, hp), residuals: endAll.residuals, facts: endAll.facts };
      const after = all.baseInput.bench ? enteredRecords(all, endAll.worlds, endLow.worlds, endHigh.worlds, entered ?? undefined) : null;
      const late = all.baseInput.bench ? replacedRecords(all, start!, endAll.worlds, endLow.worlds, endHigh.worlds, true) : null;
      if (after) ready.hpEntered = after;
      if (late) ready.replaced = late;
      endOfTurn = ready;
    } else {
      endOfTurn = { status: "not-estimated", reason: [endAll, endLow, endHigh].map((end) => end.status === "not-estimated" ? end.reason : "").find(Boolean)! };
    }
    // Ally Switch: the chance each side stands swapped after the moves.
    const swapped = swappedShares(finished);
    // The turn facts found during the walk (kernel.turnFact) after the ones read from the input.
    const turn = [...new Set([...facts, ...all.walkFacts])];
    return {
      status: "ready", start: start!, steps, hp, startRows: rows, facts: turn, ...(swapped ? { swapped } : {}), endOfTurn,
      ...(replaced ? { replaced } : {}), ...(entered ? { hpEntered: entered } : {}),
    };
  } catch (error) {
    if (error instanceof NotEstimated) return notEstimatedResult(error.reason);
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
}

/** status2 R-E: a bench Pokémon's maximum HP (turnHP), for its hits' percentages (DoublesHit.id). */
function enteredMaximum(ctx: Ctx, slot: DoublesSlotId, id: string): number {
  if (id.startsWith("slot:")) return ctx.startHP[id.slice(5) as DoublesSlotId]?.maxHP || 1;
  const bench = ctx.baseInput.bench?.[slotSide(slot)]?.find((each) => each.id === id);
  return bench ? turnHP(bench.build, ctx.runtime).maxHP : 1;
}

/** One walk's end of turn (doubles-eot.ts endOfTurn); a NotEstimated thrown inside it leaves the moves estimated. */
function endOfTurnOf(ctx: Ctx, worlds: World[]): eotNs.EndOfTurnRun {
  const kernel = kernelOf(ctx) as { inEndOfTurn: boolean };
  ctx.inEndOfTurn = kernel.inEndOfTurn = true;
  try {
    return eotHooks.endOfTurn(kernelOf(ctx), worlds);
  } catch (error) {
    if (error instanceof NotEstimated) return { status: "not-estimated", reason: error.reason };
    throw error;
  } finally {
    ctx.inEndOfTurn = kernel.inEndOfTurn = false;
  }
}

/**
 * Each Pokémon's HP over a turn's finished worlds (SPEC §4.8): low and high from the roll walks' modes, the average, the
 * extremes and the KO chance from the "all" walk's mixture, the heals, the losses outside any step and the faint before
 * moving from the "all" walk's statistics, and its condition facts in those worlds (conditionFacts). `moves`: the HP
 * after the moves, for the HP after the end of turn (status-eot SPEC §4.9: its start, settled, heals, losses and faint
 * before moving are those; the rest is recomputed). status2 R-E: a slot's record is its starting Pokémon's wherever it is
 * (in the slot, in another after a switch, or on the bench as it left: distributions' monKey).
 */
function hpRecords(all: Ctx, start: DoublesStart, finished: World[], lowest: World[], highest: World[], moves?: Record<DoublesSlotId, DoublesHP | null>): Record<DoublesSlotId, DoublesHP | null> {
  const dists = distributions(finished), lows = distributions(lowest), highs = distributions(highest);
  const conditions = conditionStats(all, finished);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot): [DoublesSlotId, DoublesHP | null] => {
    const entry = start[slot];
    if (!entry || !dists.get(slot)) return [slot, null];
    const before = all.faintsBefore.get(slot) ?? 0;
    const faintsBefore = all.baseInput.pokemon[slot]!.action.moveId !== null && before > 0 ? Math.min(1, before) : undefined;
    return [slot, hpRecord(all, slot, { start: entry.hp, maximum: entry.maximum, ...(entry.settled ? { settled: entry.settled } : {}) }, dists, lows, highs, conditions, moves?.[slot], faintsBefore)];
  })) as Record<DoublesSlotId, DoublesHP | null>;
}

/** One Pokémon's DoublesHP from its key's distributions (hpRecords; status2 R-E: hpEntered's and DoublesReplaced's too). */
function hpRecord(all: Ctx, key: string, head: Pick<DoublesHP, "start" | "maximum" | "settled">, dists: Map<string, Map<number, number>>, lows: Map<string, Map<number, number>>,
  highs: Map<string, Map<number, number>>, conditions: Map<string, DoublesFact[]>, kept: DoublesHP | null | undefined, faintsBefore?: number): DoublesHP {
  const dist = dists.get(key)!;
  let average = 0, min = Infinity, max = -Infinity, out = 0, total = 0;
  for (const [value, mass] of dist) { average += value * mass; total += mass; if (value < min) min = value; if (value > max) max = value; if (value <= 0) out += mass; }
  // status2 R-E: a Pokémon that came in during the turn is in some worlds only: its chances are within them.
  if (total > 0 && Math.abs(total - 1) > 1e-12 && key.includes("|")) out /= total;
  const heals = kept ? kept.heals : [...(all.heals.get(key) ?? new Map<string, [number, number]>())].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`);
  const losses = kept ? kept.losses : factList(all.losses.get(key));
  const facts = conditions.get(key);
  const fainting = kept ? kept.faintsBeforeMoving : faintsBefore;
  return {
    ...head, low: modeOf(lows.get(key), true), average: total ? average / total : head.start, high: modeOf(highs.get(key), false),
    min, max, koChance: out >= 1 - 1e-12 && min <= 0 && max <= 0 ? 1 : uncertain(out, out > 0), heals,
    ...(fainting !== undefined ? { faintsBeforeMoving: fainting } : {}),
    ...(losses?.length ? { losses } : {}),
    ...(facts?.length ? { conditions: facts } : {}),
  };
}

/**
 * status2 R-E: each Pokémon that came in during the turn, by the slot it is in (or left last) and its bench id, with its HP
 * over the worlds in which it came in (DoublesTurnResult.hpEntered after the moves, DoublesEndOfTurn.hpEntered after the
 * turn: `moves`, the records after the moves, keep their heals and losses). Null: none came in.
 */
function enteredRecords(all: Ctx, finished: World[], lowest: World[], highest: World[], moves?: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>>):
  Partial<Record<DoublesSlotId, Record<string, DoublesHP>>> | null {
  const dists = distributions(finished);
  const keys = [...dists.keys()].filter((key) => key.includes("|"));
  if (!keys.length) return null;
  const lows = distributions(lowest), highs = distributions(highest);
  const conditions = conditionStats(all, finished);
  const out: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>> = {};
  for (const key of keys) {
    const [slot, id] = key.split("|") as [DoublesSlotId, string];
    const bench = all.baseInput.bench?.[slotSide(slot)]?.find((each) => each.id === id);
    if (!bench) continue;
    const hp = turnHP(bench.build, all.runtime);
    (out[slot] ??= {})[id] = hpRecord(all, key, { start: hp.hp, maximum: hp.maxHP }, dists, lows, highs, conditions, moves?.[slot]?.[id]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * status2 R-E: each slot whose Pokémon left during the turn (World.benched: `late`, the switches after the residual, else
 * the moves'), with each leaver's HP as it left over the worlds in which it did and each Pokémon that came in with the share
 * of the turn in which it did (DoublesReplaced). Null: none left.
 */
function replacedRecords(all: Ctx, start: DoublesStart, finished: World[], lowest: World[], highest: World[], late: boolean): Partial<Record<DoublesSlotId, DoublesReplaced>> | null {
  type Slot = { left: Map<string, { chance: number; dist: Map<number, number> }>; entered: Map<string, number> };
  const collect = (worlds: World[]) => {
    const out = new Map<DoublesSlotId, Slot>();
    const slotOf = (slot: DoublesSlotId) => { let entry = out.get(slot); if (!entry) out.set(slot, entry = { left: new Map(), entered: new Map() }); return entry; };
    for (const world of worlds) {
      for (const side of ["own", "opponent"] as const) {
        for (const entry of world.benched?.[side] ?? []) {
          if (!!entry.late !== late) continue;
          const record = slotOf(entry.slot);
          let left = record.left.get(entry.id);
          if (!left) record.left.set(entry.id, left = { chance: 0, dist: new Map() });
          left.chance += world.mass;
          for (const [hp, share] of entry.hp) left.dist.set(hp, (left.dist.get(hp) ?? 0) + share * world.mass);
          if (entry.id !== startId(entry.slot)) bump(record.entered, entry.id, world.mass);
        }
      }
      for (const slot of DOUBLES_SLOTS) {
        const mon = world.mons[slot];
        if (!mon?.entered || !!mon.late !== late) continue;
        bump(slotOf(slot).entered, mon.id ?? startId(slot), world.mass);
      }
    }
    return out;
  };
  const records = collect(finished);
  if (!records.size) return null;
  const lows = collect(lowest), highs = collect(highest);
  const leftDists = (from: Map<DoublesSlotId, Slot>) => new Map([...from].flatMap(([slot, record]) => [...record.left].map(([id, { dist }]) => [`${slot}|${id}`, dist] as const)));
  const dists = leftDists(records), lowDists = leftDists(lows), highDists = leftDists(highs);
  const out: Partial<Record<DoublesSlotId, DoublesReplaced>> = {};
  for (const [slot, record] of records) {
    const left = [...record.left].map(([id, { chance }]) => {
      const owner = id.startsWith("slot:") ? id.slice(5) as DoublesSlotId : null;
      const bench = owner ? null : all.baseInput.bench?.[slotSide(slot)]?.find((each) => each.id === id);
      const head = owner && start[owner] ? { start: start[owner]!.hp, maximum: start[owner]!.maximum } : bench ? { start: turnHP(bench.build, all.runtime).hp, maximum: turnHP(bench.build, all.runtime).maxHP } : { start: 0, maximum: 1 };
      const key = `${slot}|${id}`;
      const heals = all.heals.get(owner ?? key);
      const hp = hpRecord(all, key, head, dists, lowDists, highDists, new Map(), { ...head, low: 0, high: 0, average: 0, min: 0, max: 0, koChance: 0, heals: heals ? [...heals].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`) : [] });
      return { id, hp, chance: Math.min(1, chance) };
    });
    const entered = [...record.entered].map(([id, chance]) => ({ id, chance: Math.min(1, chance) }));
    out[slot] = { left, entered };
  }
  return out;
}

/** Facts with their chances from a map of masses (each at most 1), in first-found order; undefined for none. */
function factList(map: Map<string, number> | undefined): DoublesFact[] | undefined {
  return map?.size ? [...map].map(([text, chance]) => ({ text, chance: Math.min(1, chance) })) : undefined;
}

/**
 * A Pokémon's condition facts in one world (DoublesHP.conditions; ADDENDUM §3.5.12): Track A's statuses and volatiles,
 * Track B's end-of-turn states, and Track E's positions, items and Substitute, in that order.
 */
function conditionFacts(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  return [
    ...statusHooks.conditions(kernel, w, slot), ...typingHooks.conditions(kernel, w, slot), ...eotHooks.conditions(kernel, w, slot),
    ...positionHooks.conditions(kernel, w, slot), ...itemHooks.conditions(kernel, w, slot), ...substituteHooks.conditions(kernel, w, slot), ...maxHooks.conditions(kernel, w, slot),
  ];
}

/**
 * Each Pokémon's condition facts over finished worlds, with the share of the turn in which each holds, by monKey (status2
 * R-E: each world's occupants read as they stand: syncOccupants).
 */
function conditionStats(ctx: Ctx, worlds: World[]): Map<string, DoublesFact[]> {
  const kernel = kernelOf(ctx);
  const masses = new Map<string, Map<string, number>>();
  for (const world of worlds) {
    syncOccupants(ctx, world);
    for (const slot of DOUBLES_SLOTS) {
      if (!world.mons[slot]) continue;
      const key = monKey(slot, world.mons[slot]!.id);
      for (const text of new Set(conditionFacts(kernel, world, slot))) {
        let map = masses.get(key);
        if (!map) masses.set(key, map = new Map());
        bump(map, text, world.mass);
      }
    }
  }
  syncOccupants(ctx, null);
  return new Map([...masses].map(([key, map]) => [key, factList(map)!]));
}

/** Ally Switch (World.swapped): each side's share of the finished worlds in which its two Pokémon stand swapped; null when none. */
function swappedShares(worlds: World[]): Partial<Record<DoublesSideId, number>> | null {
  const shares: Partial<Record<DoublesSideId, number>> = {};
  let total = 0;
  for (const world of worlds) total += world.mass;
  for (const world of worlds) for (const side of ["own", "opponent"] as const) if (world.swapped?.[side]) shares[side] = (shares[side] ?? 0) + world.mass;
  const out = Object.fromEntries(Object.entries(shares).map(([side, mass]) => [side, Math.min(1, total > 0 ? mass / total : 0)])) as Partial<Record<DoublesSideId, number>>;
  return Object.keys(out).length ? out : null;
}


// ------------------------------------------------------------------------------------------------------------------
// The turn as finished worlds (Training AI, SPEC E2): one "all" walk; no lowest and highest walks, no steps, no start rows
// ------------------------------------------------------------------------------------------------------------------

/** The chance, in one world, that every present Pokémon of `side` is at 0 HP: the factors are independent, so the product over them. */
function sideFaintedChance(world: World, side: DoublesSideId): number {
  let chance = 1;
  for (const factor of world.factors) {
    const slots = factor.slots.filter((slot) => slotSide(slot) === side);
    if (!slots.length) continue;
    // Perf pass 1b: the side's digits read at their indexes, found once (the same test and sums, in the same order).
    const places = slots.map((slot) => factor.slots.indexOf(slot));
    let mass = 0, total = 0;
    for (const [key, entry] of factor.table) {
      total += entry;
      let out = true;
      for (let index = 0; index < places.length; index++) if (!(digitAt(key, places[index]) <= 0)) { out = false; break; }
      if (out) mass += entry;
    }
    chance *= total > 0 ? mass / total : 0;
  }
  return chance;
}

/**
 * One finished world as an outcome (its mass not yet normalised). Under Neutralizing Gas each Run Away stand-in is given
 * back the ability it replaced (DoublesGas.abilities), which the gas still suppresses. The next turn's state (status-eot
 * SPEC §3.1, ADDENDUM §3.1): the volatiles (Track A's, Track B's and Track E's hooks, a Substitute standing; sorted), the
 * sleep counter and perish count, the Substitute's HP, the Ally Switch counter, Safeguard and the hazards that landed on
 * each side, and whether each side's Pokémon stand swapped.
 */
function outcomeOf(ctx: Ctx, world: World): DoublesOutcome {
  const kernel = kernelOf(ctx);
  // status2 R-E: the hook modules read this world's occupants (names, hp, the input view).
  syncOccupants(ctx, world);
  const mons: DoublesOutcome["mons"] = {};
  for (const slot of DOUBLES_SLOTS) {
    const mon = world.mons[slot];
    if (!mon) continue;
    // The gas stand-in's own ability is the slot's starting Pokémon's (a newcomer under the gas is not followed).
    const own = ctx.gas?.abilities[slot];
    const dist = marginal(world, slot);
    let total = 0;
    for (const mass of dist.values()) total += mass;
    const hp = [...dist].sort((a, b) => a[0] - b[0]).map(([value, mass]) => ({ hp: value, chance: total > 0 ? mass / total : 0 }));
    const build = own !== undefined && mon.build.abilityId === GAS_STAND_IN ? { ...mon.build, abilityId: own } : mon.build;
    const entry: DoublesOutcomeMon = { hp, build, protected: mon.protect !== null, moved: mon.moved };
    const a = statusHooks.outcomeMon(kernel, world, slot), b = eotHooks.outcomeMon(kernel, world, slot), e = positionHooks.outcomeMon(kernel, world, slot);
    // status2 integration 1a: A1's outcome (its volatiles, the real ability behind Gastro Acid's stand-in, the accuracy and
    // evasion stages, a transformed Pokémon's moves), A2's volatiles, a charged two-turn move's twoturnmove with the move's own
    // volatile (H), Glaive Rush (D).
    const f = abilityHooks.outcomeMon(kernel, world, slot);
    const volatiles = [...new Set([...(a.volatiles ?? []), ...typingHooks.outcomeVolatiles(kernel, world, slot), ...(b.volatiles ?? []), ...(e.volatiles ?? []), ...f.volatiles,
      ...(mon.vol.substitute ? ["substitute"] : []), ...(mon.vol.charging && !mon.fainted ? ["twoturnmove", mon.vol.charging] : []),
      ...(mon.vol.glaiveRush && !mon.fainted ? ["glaiverush"] : []), ...maxHooks.outcomeVolatiles(kernel, world, slot), ...presenceHooks.outcomeVolatiles(kernel, world, slot)])].sort();
    if (volatiles.length) entry.volatiles = volatiles;
    if (f.build) entry.build = f.build;
    if (a.sleepTurns !== undefined) entry.sleepTurns = a.sleepTurns;
    if (b.perishCount !== undefined) entry.perishCount = b.perishCount;
    if (mon.vol.substitute) entry.substitute = [{ hp: mon.vol.substitute, chance: 1 }];
    if (e.allySwitch !== undefined) entry.allySwitch = e.allySwitch;
    Object.assign(entry, status2Mon(mon), f.fields);
    // status2 R: the occupant's id when it came in this turn (absent: the slot's starting Pokémon).
    if (mon.id !== undefined) entry.id = mon.id;
    mons[slot] = entry;
  }
  // status2 R: the Pokémon that left (World.benched), as R's doubles-switch.ts benchedOutcome reports each.
  let benched: DoublesOutcome["benched"];
  if (world.benched) {
    benched = {};
    for (const each of ["own", "opponent"] as const) {
      // R-E: a leaver that came back in later this turn is its slot's occupant now (BenchedMon.back), not on the bench.
      const list = world.benched[each]?.filter((entry) => !entry.back);
      if (list?.length) benched[each] = list.map((entry) => switchHooks.benchedOutcome(kernel, world, entry));
    }
  }
  const side = (state: SideState) => ({
    reflect: state.reflect, lightScreen: state.lightScreen, auroraVeil: state.auroraVeil, tailwind: state.tailwind, faintedThisTurn: state.faintedThisTurn,
    ...(state.safeguard ? { safeguard: true } : {}), ...(state.hazards.length ? { hazards: [...state.hazards] } : {}),
    // status2: each only while set (absent in every world Step 0 makes).
    ...(state.mist ? { mist: true } : {}), ...(state.luckyChant ? { luckyChant: true } : {}), ...(state.clock ? { clock: { ...state.clock } } : {}),
    ...(state.hazardsFrom !== undefined ? { hazardsFrom: state.hazardsFrom } : {}), ...(state.benchCured ? { benchCured: true as const } : {}),
    ...(state.pledge ? { pledge: { ...state.pledge } } : {}), ...(state.gmax?.length ? { gmax: [...state.gmax] } : {}),
  });
  // Ion Deluge ends with the turn (status2: absent from the outcome).
  const { ionDeluge: _ionDeluge, ...field } = world.field;
  void _ionDeluge;
  return {
    chance: world.mass, mons, sides: { own: side(world.sides.own), opponent: side(world.sides.opponent) }, field,
    ...(world.fieldSet ? { fieldSet: { ...world.fieldSet } } : {}),
    allFainted: { own: sideFaintedChance(world, "own"), opponent: sideFaintedChance(world, "opponent") },
    positions: { own: world.swapped?.own ? "swapped" : "kept", opponent: world.swapped?.opponent ? "swapped" : "kept" },
    ...(benched && Object.keys(benched).length ? { benched } : {}),
  };
}

/**
 * status2's outcome fields of one Pokémon (SPEC2 §3.1, ADDENDUM2 §3.1, T2E §3.1, IN §4.1), each only while its state is set
 * by a new input or a track: Stockpile, a charged move, the once-a-battle effects, G-Max Chi Strike, a pending copy, the
 * last item (item history), Ripen's weakened Berry, Cud Chew's Berry, the turns left. The accuracy and evasion stages and
 * the Berserk lock, which today's turn already sets (MoveVolatiles.stages, berryLocked), join the outcome with their
 * tracks (A1, D), so E2's outcomes stay as they were.
 */
function status2Mon(mon: MonState): Partial<DoublesOutcomeMon> {
  const { vol, eot } = mon;
  const out: Partial<DoublesOutcomeMon> = {};
  if (vol.stockpile) out.stockpile = { ...vol.stockpile };
  if (vol.charging) out.charging = vol.charging;
  if (vol.onceUsed?.length) out.onceUsed = [...vol.onceUsed];
  if (vol.chiStrike) out.chiStrike = vol.chiStrike;
  if (mon.copy) out.pendingCopy = { ...mon.copy.stages };
  if (mon.lastItem) out.lastItem = mon.lastItem;
  if (vol.berryWeaken) out.berryWeaken = true;
  // status2 integration 1a (D): a Berserk or Anger Shell lock left after the turn (Showdown's checkedBerserk false).
  if (vol.berryLocked && !mon.fainted) out.berryLocked = true;
  if (eot.cudChew && typeof eot.cudChew === "object") out.cudChew = eot.cudChew.berry;
  const turns: NonNullable<DoublesOutcomeMon["turnsLeft"]> = {
    ...(eot.healBlock && eot.healBlockLeft !== undefined ? { healblock: eot.healBlockLeft } : {}),
    ...(eot.embargo !== undefined ? { embargo: eot.embargo } : {}), ...(eot.telekinesis !== undefined ? { telekinesis: eot.telekinesis } : {}),
    ...(vol.taunt && eot.tauntLeft !== undefined ? { taunt: eot.tauntLeft } : {}), ...(vol.encore && eot.encoreLeft !== undefined ? { encore: eot.encoreLeft } : {}),
    ...(vol.disabled && eot.disableLeft !== undefined ? { disable: eot.disableLeft } : {}), ...(vol.uproar !== undefined ? { uproar: vol.uproar } : {}),
  };
  if (Object.keys(turns).length) out.turnsLeft = turns;
  return out;
}

/**
 * Outcomes whose builds, protect and moved flags, volatiles, perish counts, Ally Switch counters, sides, field and
 * positions are equal, merged: the chances add, and the HP distributions, the Substitutes' HP, the sleep counters'
 * expectations and allFainted become their chance-weighted mixtures (exact for the marginals and for allFainted).
 */
function mergeOutcomes(outcomes: DoublesOutcome[]): DoublesOutcome[] {
  type Mixed = { hp: Map<number, number>; substitute: Map<number, number> | null; sleep: number | null };
  const byKey = new Map<string, { outcome: DoublesOutcome; mixed: Map<string, Mixed>; fainted: Record<DoublesSideId, number>; benched: Map<string, Mixed> }>();
  for (const outcome of outcomes) {
    const key = JSON.stringify([
      DOUBLES_SLOTS.map((slot) => {
        const mon = outcome.mons[slot];
        // status2: the new fields (each absent unless set), after today's; R's occupant id.
        const { stockpile, stages, moves, pendingCopy, lastItem, berryLocked, berryWeaken, turnsLeft, charging, onceUsed, chiStrike, cudChew, id } = mon ?? {};
        const extra = { stockpile, stages, moves, pendingCopy, lastItem, berryLocked, berryWeaken, turnsLeft, charging, onceUsed, chiStrike, cudChew, id };
        return mon ? [mon.build, mon.protected, mon.moved, mon.volatiles ?? null, mon.perishCount ?? null, mon.allySwitch ?? null, extra] : null;
      }), outcome.sides, outcome.field, outcome.positions, outcome.fieldSet ?? null,
      // status2 R: the leavers but their HP and sleep counters, which mix below as the occupants' do (only while one left).
      ...(outcome.benched ? [Object.entries(outcome.benched).map(([side, list]) => [side, (list ?? []).map((mon) => ({ ...mon, hp: null, sleepTurns: null }))])] : []),
    ]);
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, entry = { outcome: { ...outcome, chance: 0 }, mixed: new Map(), fainted: { own: 0, opponent: 0 }, benched: new Map() });
    entry.outcome.chance += outcome.chance;
    const mix = (map: Map<string, Mixed>, at: string, mon: DoublesOutcomeMon) => {
      let mixed = map.get(at);
      if (!mixed) map.set(at, mixed = { hp: new Map(), substitute: mon.substitute ? new Map() : null, sleep: mon.sleepTurns !== undefined ? 0 : null });
      for (const { hp, chance } of mon.hp) mixed.hp.set(hp, (mixed.hp.get(hp) ?? 0) + chance * outcome.chance);
      if (mixed.substitute) for (const { hp, chance } of mon.substitute ?? []) mixed.substitute.set(hp, (mixed.substitute.get(hp) ?? 0) + chance * outcome.chance);
      if (mixed.sleep !== null) mixed.sleep += (mon.sleepTurns ?? 0) * outcome.chance;
    };
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      if (!mon) continue;
      mix(entry.mixed, slot, mon);
    }
    for (const [side, list] of Object.entries(outcome.benched ?? {})) (list ?? []).forEach((mon, index) => mix(entry.benched, `${side}:${index}`, mon));
    entry.fainted.own += outcome.allFainted.own * outcome.chance;
    entry.fainted.opponent += outcome.allFainted.opponent * outcome.chance;
  }
  return [...byKey.values()].map(({ outcome, mixed, fainted, benched }) => {
    const share = (mass: number) => outcome.chance > 0 ? mass / outcome.chance : 0;
    const table = (map: Map<number, number>) => [...map].sort((a, b) => a[0] - b[0]).map(([value, mass]) => ({ hp: value, chance: share(mass) }));
    const mixedMon = <T extends DoublesOutcomeMon>(mon: T, each: Mixed): T => ({
      ...mon, hp: table(each.hp), ...(each.substitute ? { substitute: table(each.substitute) } : {}), ...(each.sleep !== null ? { sleepTurns: share(each.sleep) } : {}),
    });
    const mons: DoublesOutcome["mons"] = {};
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      const each = mixed.get(slot);
      if (!mon || !each) continue;
      mons[slot] = mixedMon(mon, each);
    }
    const out: DoublesOutcome = { ...outcome, mons, allFainted: { own: share(fainted.own), opponent: share(fainted.opponent) } };
    if (outcome.benched) {
      out.benched = Object.fromEntries(Object.entries(outcome.benched).map(([side, list]) => [side, (list ?? []).map((mon, index) => mixedMon(mon, benched.get(`${side}:${index}`)!))]));
    }
    return out;
  });
}

/**
 * calculateDoublesTurn's validate → settle → guards → one "all" walk, returned as finished worlds (no low/high walks, no
 * steps, no start rows). Its status is calculateDoublesTurn's on the same input, except that a turn whose lowest or highest
 * walk alone runs over the calculation budget (BUDGET.calculations, shared by the three walks there) is ready here. The
 * outcomes' HP mixture of each slot is calculateDoublesTurn's HP distribution of that slot.
 */
export function calculateDoublesOutcomes(input: DoublesTurnInput): DoublesOutcomesResult {
  const invalid = validate(input);
  if (invalid?.status === "issues") return { status: "issues", issues: invalid.issues };
  const settle = settleOf(input);
  if (settle.reason) return { status: "not-estimated", reason: settle.reason };
  const start = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = settle.slots[slot];
    if (!entry) return [slot, null];
    const hp = turnHP(entry.folded, input.runtime);
    return [slot, { hp: hp.hp, maximum: hp.maxHP, ...(entry.items.settledHP ? { settled: entry.items.settledHP } : {}) }];
  })) as DoublesStart;
  const usesReference = USES_REFERENCE.on;
  if (DOUBLES_REFERENCE.on) USES_REFERENCE.on = true;
  try {
    const memo: Memo = { searches: new Map(), priorities: new Map(), speeds: new Map(), moves: new Map(), rows: new Map(), calculations: 0 };
    const all = createContext(input, settle, memo, "all", null);
    presenceGuards(all, firstUpdated(all, settle));
    const finished = walk(all, settle);
    // The end of turn (doubles-eot.ts endOfTurn): applied, the outcomes are after the whole turn; otherwise after the moves.
    const end = endOfTurnOf(all, finished);
    const worlds = end.status === "ready" ? end.worlds : finished;
    let total = 0;
    for (const world of worlds) total += world.mass;
    const each = worlds.map((world) => outcomeOf(all, world));
    syncOccupants(all, null);
    const outcomes = mergeOutcomes(each).map((outcome) => ({ ...outcome, chance: total > 0 ? outcome.chance / total : 0 }));
    return { status: "ready", start, outcomes, endOfTurn: end.status === "ready" ? "applied" : { notEstimated: end.reason } };
  } catch (error) {
    if (error instanceof NotEstimated) return { status: "not-estimated", reason: error.reason };
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
}
