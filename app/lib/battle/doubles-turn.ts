import {
  calculateTurnMove, GAS_STAND_IN, matchupRows, partnerAbilitySuppressor, resolveTurnMove, settleDoublesStart, turnHP, turnPriority, turnProtectOutcome, turnSpeed, usesHelpers,
  type DoublesGas, type DoublesSettle, type MatchupResult, type SettledMatchup, type TurnMove,
} from "./calculate";
import {
  ABILITY_REPLACERS, ABSORBING, ANCHORING_ABILITIES, BUSTED_FORMS, RESIST_BERRIES, CALLING_MOVES, CHARGE_TURN_MOVES, DAMP_MOVES, DANCE_MOVES, DRAG_MOVES,
  FACE_REACTIVE_ITEMS, FACE_UNSAFE_MOVES, FAINT_REACTIONS, FUTURE_MOVES,
  GMAX_EFFECTS, IGNORE_ABILITY_MOVES, KO_BOOSTS, MOLD_BREAKERS, PLEDGE_MOVES, PRESENCE_THIRD_PARTY, SELF_DESTRUCT_MOVES,
  TYPE_LOSS_MOVES, VOLATILE_SECONDARY_MOVES,
  PENDING_MOVES, PRESENCE_MOVES, PROTECT_CONTACT, PROTECT_MOVES, RANDOM_STATUS_MAX_MOVES, REASONS, REDIRECT_ABILITIES,
  SEMI_INVULNERABLE_MOVES, STRONG_WEATHERS, SWITCH_MOVES, TRACKING_ABILITIES, TRACKS_TARGET_MOVES,
} from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, turnNames, type DoublesFact, type DoublesHit, type DoublesHP, type DoublesSideId,
  type DoublesSlotId, type DoublesStart, type DoublesStartRow, type DoublesStep, type DoublesTurnInput, type DoublesTurnResult,
  type DoublesOutcome, type DoublesOutcomeMon, type DoublesOutcomesResult, type DoublesEndOfTurn,
} from "./doubles-types";
import {
  cloneWorld, condition, entryCount, hpIn, join, mapHP, marginal, mergeWorlds, occupant, pointFactor, positionOf, RADIX, splitFactor,
  type EotState, type Factor, type MonState, type MoveVolatiles, type PendingAction, type SideState, type World,
} from "./doubles-world";
import * as statusHooks from "./doubles-status";
import * as eotHooks from "./doubles-eot";
import * as positionHooks from "./doubles-positions";
import * as itemHooks from "./doubles-items";
import * as substituteHooks from "./doubles-substitute";
import { getBerryResistType } from "@smogon/calc/dist/items";
import {
  berryArithmetic, berryHeals, berryUnnerved, BERRY_STEALERS, BERSERK_BERRIES, eatBerry, HEALING_BERRIES, KLUTZ_IGNORED_ITEMS, LANSAT_STARF, ownMoveId, PINCH_STAT_BERRIES, stolenEat, UNNERVES,
  type Berry, type TurnUnnerve,
} from "./hit-loop";
import { neutralEffectiveness } from "./engine-corrections.cjs";
import { isMaxActive } from "./mechanics";
import { getBuildStats, PRIORITY_SHIELD_ABILITIES, validateBuild, validateConditions } from "./model";
import type { BattleRuntime } from "./runtime";
import { accuracyDrop, everyUseStatus, MAX_MOVE_EFFECTS, statMove } from "./stat-moves";
import type { StatusStages } from "./status-table";
import type { BattleBuild, BattleConditions, BuildIssue, ChampionsMove, CombatStat, MoveContext, MoveDamageResult } from "./types";
import { doublesNoFoeLeft, doublesTargetRule } from "./doubles-targets";
import {
  buildAt, createTurnSearch, prepareUses, uncertain, USES_REFERENCE, type CalcTrace, type Mode, type TurnSide, type TurnStepEntry, type TurnStepOutcome, type TurnStepPart, type UsesSearch,
} from "./uses-to-ko";

// The 2v2 tab's turn (SPEC §4): every queued action in pinned Showdown c23d2e94's order, each random event branched
// exactly, each damaging hit one pairwise use (uses-to-ko.ts turnStep) with the target's state carried. A result is
// exact or the turn is not estimated with a fact reason (SPEC §2.2). Extension points for the rest of §2.2's "In" list:
// statusMove (Tailwind, Trick Room, Gravity, weather, terrain, screens), afterMove (Moxie and the other faint reactions,
// the Explosion family), contextFor, presenceGuards/PENDING_MOVES (each guard removed where a mechanic is modelled).
//
// Status moves and end of turn (scripts/.cache/calc-audit/status-eot/design SPEC.md §3.5, ADDENDUM.md §3.5): this file
// is the kernel. It hands a TurnKernel (closures over one walk's Ctx) to the hook modules, which own the mechanics:
// doubles-status.ts (Track A: BeforeMove, status moves), doubles-eot.ts (Track B: the end of turn), doubles-positions.ts,
// doubles-items.ts and doubles-substitute.ts (Track E: Ally Switch, Trick, hits into a Substitute). The hook points are
// listed in scripts/.cache/calc-audit/status-eot/build/STEP0.md; after Step 0 only the integrator edits this file.

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
/** Moves that cost their user half its maximum HP as they hit (data/moves.ts mindblown, steelbeam, chloroblast). */
const SELF_COST_MOVES = new Set(["mindblown", "steelbeam", "chloroblast"]);

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
  input: DoublesTurnInput; runtime: BattleRuntime; gen7: boolean; champions: boolean;
  names: Record<DoublesSlotId, string>;
  hp: Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>;
  actions: { slot: DoublesSlotId; moveId: string | null; target: DoublesSlotId | null }[];
  mode: Mode; memo: Memo;
  /** The "all" walk's statistics (null in the roll walks). */
  stats: StepStats[] | null;
  heals: Map<DoublesSlotId, Map<string, [number, number]>>;
  faintsBefore: Map<DoublesSlotId, number>;
  /** Slots that faint on some branch other than by a hit a step counts (hitStats.ko): their own move, a fixed loss. */
  otherFaints: Set<DoublesSlotId>;
  /** Slots whose move can reach only foes while both foe slots are empty (doublesNoFoeLeft): queued, but no step. */
  targetless: Set<DoublesSlotId>;
  /** Neutralizing Gas on the field from the turn's start (calculate.ts DoublesGas), or null. */
  gas: DoublesGas | null;
  /** The "all" walk: HP lost outside any step (kernel.lossFact; DoublesHP.losses), by slot and text. */
  losses: Map<DoublesSlotId, Map<string, number>>;
  /** The "all" walk: turn facts found during the walk (kernel.turnFact), in first-found order. */
  walkFacts: Set<string>;
  /** The hook modules' view of this context (kernelOf). */
  kernel?: TurnKernel;
  /** The "all" walk met a certain critical hit (applyStep): the turn's hit rule says so. */
  certainCrit?: true;
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
  /** turnNames: a species name, with " (yours)" / " (opponent's)" across sides and " (1)" / " (2)" within one (doublesNames); the input's names name a fainted Pokémon as its card does, else "" for an empty slot. */
  readonly names: Record<DoublesSlotId, string>;
  /** Each slot's engine maximum HP (Dynamax HP while Dynamaxed) and base maximum HP. */
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
  resolveTargets(w: World, action: PendingAction, info: TurnMoveInfo): Resolution[];
  /** The redirection that takes the move (a tie between two holders is not estimated), or null. */
  redirect(w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo, moveId: string, context: MoveContext | undefined): Redirection | null;
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
  conditionsFor(w: World, attacker: DoublesSlotId, target: DoublesSlotId, multiple: boolean, moveId?: string): BattleConditions;
  contextFor(w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext | undefined;
  /**
   * One pair's calculation and turn search, memoised. `behindSubstitute`: the calculation into a Substitute (ADDENDUM
   * §4.13.3): the target's working resist or Chilan Berry reads as Leftovers, an intact Disguise or Ice Face as no ability.
   */
  searchFor(w: World, attacker: DoublesSlotId, target: DoublesSlotId, moveId: string, conditions: BattleConditions, context: MoveContext | undefined,
    spread?: boolean, attackerHP?: number, opts?: { behindSubstitute?: true; healBlocked?: true }): SearchEntry;
  /** One pair's turnStep applied to the world; `part`: a step after hits into a Substitute (uses-to-ko.ts TurnStepPart). */
  applyStep(w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: TurnMoveInfo, spread: boolean, part?: TurnStepPart): StepChild[];
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
  maxEffects(w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): void;
  // ---- Stages and statuses (doubles-status.ts) ----
  selfBoost(w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null): void;
  foeDrop(w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken?: boolean, reflected?: boolean): void;
  giveStatus(w: World, slot: DoublesSlotId, given: statusHooks.GivenStatus, source: DoublesSlotId): void;
};

const alive = (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted;
const isFoe = (a: DoublesSlotId, b: DoublesSlotId) => slotSide(a) !== slotSide(b);
const moveName = (ctx: Ctx, id: string) => ctx.runtime.movesById.get(id)?.name ?? id;
const abilityName = (ctx: Ctx, id: string) => ctx.runtime.abilitiesById.get(id)?.name ?? id;
const itemName = (ctx: Ctx, id: string) => ctx.runtime.itemsById.get(id)?.name ?? id;
const itemWorks = (w: World, build: BattleBuild) => !w.field.magicRoom && build.abilityId !== "klutz";
const bump = <K>(map: Map<K, number>, key: K, mass: number) => map.set(key, (map.get(key) ?? 0) + mass);
const laterAction = (w: World) => w.remaining.some((entry) => alive(w, entry.slot));

function hitStats(step: StepStats, slot: DoublesSlotId): HitStats {
  let stats = step.hits.get(slot);
  if (!stats) {
    step.hits.set(slot, stats = {
      reached: 0, ko: 0, calculated: 0, blocked: 0, noDamage: 0, effect: 0, change: null, sub: { mass: 0, breaks: 0, min: Infinity, max: -Infinity },
      met: new Map(), firsts: new Map(), facts: new Map(),
    });
  }
  return stats;
}
const stepOf = (ctx: Ctx, action: PendingAction) => ctx.stats?.[action.index] ?? null;
function stepFact(ctx: Ctx, action: PendingAction, text: string, mass: number) {
  const step = stepOf(ctx, action);
  if (step) bump(step.facts, text, mass);
}
function hitFact(ctx: Ctx, action: PendingAction, slot: DoublesSlotId, text: string, mass: number) {
  const step = stepOf(ctx, action);
  if (step) bump(hitStats(step, slot).facts, text, mass);
}

/** The kernel of a context (made once). */
function kernelOf(ctx: Ctx): TurnKernel {
  return ctx.kernel ??= makeKernel(ctx);
}

function makeKernel(ctx: Ctx): TurnKernel {
  const kernel: TurnKernel = {
    input: ctx.input, runtime: ctx.runtime, names: ctx.names, hp: ctx.hp, gen7: ctx.gen7, champions: ctx.champions, mode: ctx.mode,
    get reference() { return DOUBLES_REFERENCE.on; },
    recording: ctx.stats !== null, gas: ctx.gas, budget: BUDGET,
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
    resolveTargets: (w, action, info) => resolveTargets(ctx, w, action, info),
    redirect: (w, attacker, target, info, moveId, context) => redirect(ctx, w, attacker, target, info, moveId, context),
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
    lockedBerryGuard: (w, slot) => lockedBerryGuard(ctx, w, slot),
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
    hitStats: (action, slot) => { const step = stepOf(ctx, action); return step ? hitStats(step, slot) : null; },
    subStat: (action, target, mass, taken, broke) => {
      const step = stepOf(ctx, action);
      if (!step) return;
      const sub = hitStats(step, target).sub;
      sub.mass += mass;
      if (broke) sub.breaks += mass;
      sub.min = Math.min(sub.min, taken);
      sub.max = Math.max(sub.max, taken);
    },
    lossFact: (slot, text, mass) => {
      if (!ctx.stats) return;
      let facts = ctx.losses.get(slot);
      if (!facts) ctx.losses.set(slot, facts = new Map());
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
    calcBuild,
    conditionsFor: (w, attacker, target, multiple, moveId) => conditionsFor(ctx, w, attacker, target, multiple, moveId),
    contextFor: (w, action, target, info) => contextFor(ctx, w, action, target, info),
    searchFor: (w, attacker, target, moveId, conditions, context, spread, attackerHP, opts) => searchFor(ctx, w, attacker, target, moveId, conditions, context, spread, attackerHP, opts),
    applyStep: (w, action, target, entry, info, spread, part) => applyStep(ctx, w, action, target, entry, info, spread, part),
    blockedHit: (w, action, info, check, contactEffect) => blockedHit(ctx, w, action, info, check, contactEffect),
    faceTaken: (w, attacker, target, row, move) => faceTaken(ctx, w, attacker, target, row, move),
    faceHit: (w, action, info, target, face, multiple, inSpread) => faceHit(ctx, w, action, info, target, face, multiple, inSpread),
    rowReason: (w, target, row, move) => rowReason(ctx, w, target, row, move),
    noDamageFact: (row, move, target) => noDamageFact(ctx, row, move, target),
    focusBandGuard: (w, target, row) => focusBandGuard(ctx, w, target, row),
    unnerveGuard: (w, attacker, target) => unnerveGuard(ctx, w, attacker, target),
    koBoost: (w, slot, count) => koBoost(ctx, w, slot, count),
    maxEffects: (w, action, info, target) => maxEffects(ctx, w, action, info, target),
    selfBoost: (w, slot, changes, action) => statusHooks.selfBoost(kernel, w, slot, changes, action),
    foeDrop: (w, slot, changes, source, broken, reflected) => statusHooks.foeDrop(kernel, w, slot, changes, source, broken, reflected),
    giveStatus: (w, slot, given, source) => statusHooks.giveStatus(kernel, w, slot, given, source),
  };
  return kernel;
}

// The moved helpers (doubles-status.ts) as this file calls them.
const selfBoost = (ctx: Ctx, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null) => statusHooks.selfBoost(kernelOf(ctx), w, slot, changes, action);
const foeDrop = (ctx: Ctx, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken = false, reflected = false) =>
  statusHooks.foeDrop(kernelOf(ctx), w, slot, changes, source, broken, reflected);
const giveStatus = (ctx: Ctx, w: World, slot: DoublesSlotId, given: statusHooks.GivenStatus, source: DoublesSlotId) => statusHooks.giveStatus(kernelOf(ctx), w, slot, given, source);
const proteanGuard = (ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, type: () => string) => statusHooks.proteanGuard(kernelOf(ctx), w, slot, moveId, type);
const stanceChange = (ctx: Ctx, w: World, slot: DoublesSlotId, blade: boolean) => statusHooks.stanceChange(kernelOf(ctx), w, slot, blade);
const berryConfusion = (ctx: Ctx, w: World, slot: DoublesSlotId, item: string) => statusHooks.berryConfusion(kernelOf(ctx), w, slot, item);

// ------------------------------------------------------------------------------------------------------------------
// Builds, conditions and the pairwise calculations
// ------------------------------------------------------------------------------------------------------------------

/** The build a calculation reads (HP lives in the factors): Plus and Minus from a living partner (data/abilities.ts plus, minus: pokemon.allies()). */
function calcBuild(w: World, slot: DoublesSlotId): BattleBuild {
  const build = w.mons[slot]!.build;
  if (build.abilityId !== "plus" && build.abilityId !== "minus") return { ...build, currentHP: null };
  const partner = allyOf(slot);
  const active = alive(w, partner) && ["plus", "minus"].includes(w.mons[partner]!.build.abilityId);
  return { ...build, currentHP: null, abilityActive: active };
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
function conditionsFor(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, multiple: boolean, moveId?: string): BattleConditions {
  // An exploding user's handlers on others are gone (World.ghost); its Cloud Nine still suppresses the weather
  // (sim/field.ts suppressingWeather reads the fainted flag, not HP).
  const living = DOUBLES_SLOTS.filter((slot) => alive(w, slot) && slot !== w.ghost);
  const has = (ability: string) => living.some((slot) => w.mons[slot]!.build.abilityId === ability);
  const negated = DOUBLES_SLOTS.some((slot) => alive(w, slot) && WEATHER_NEGATORS.has(w.mons[slot]!.build.abilityId));
  const side = (id: DoublesSideId) => {
    const state = w.sides[id];
    return { reflect: state.reflect, lightScreen: state.lightScreen, auroraVeil: state.auroraVeil, tailwind: state.tailwind, helpingHand: false, friendGuard: false, priorityShield: false, protect: false, charge: false };
  };
  const partner = allyOf(target);
  const partnerAbility = alive(w, partner) && partner !== w.ghost ? w.mons[partner]!.build.abilityId : "";
  // The attacker's partner's power boost (data/abilities.ts battery, powerspot, steelyspirit onAllyBasePower: a living
  // ally's handler, sim/pokemon.ts alliesAndSelf; calculate.ts partnerPowerBoosts reads the move's category and type).
  const ally = allyOf(attacker);
  const allyAbility = alive(w, ally) && ally !== w.ghost ? w.mons[ally]!.build.abilityId : "";
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  // A Z-Move with a spread target of its own used into one target (Clangorous Soulblaze): no spread modifier.
  const zContext = moveId ? ctx.input.pokemon[attacker]?.contexts[moveId] : undefined;
  const zInfo = !multiple && moveId && zContext?.useZ ? moveInfo(ctx, w, attacker, moveId, zContext) : null;
  const oneTarget = zInfo?.kind === "move" && zInfo.isZ && SPREAD_TARGETS.has(zInfo.effective.target);
  const ruin = ctx.runtime.profile.id === "scarlet_violet"
    ? { ruin: { sword: has("swordofruin"), beads: has("beadsofruin"), tablets: has("tabletsofruin"), vessel: has("vesselofruin") } } : {};
  return {
    gameType: "Doubles", ...w.field, weather: negated ? "" : w.field.weather, critical: ctx.input.field.critical, multipleTargets: multiple, ...(oneTarget ? { oneTarget } : {}),
    fairyAura: has("fairyaura"), darkAura: has("darkaura"), auraBreak: has("aurabreak"), ...ruin,
    attackerSide: {
      ...side(slotSide(attacker)), helpingHand: user.helpingHand === 1, charge: user.charged,
      ...(flowerGift(ctx, w, attacker, attacker, moveId) ? { flowerGift: true } : {}),
      ...(allyAbility === "battery" ? { battery: true } : {}),
      ...(allyAbility === "powerspot" ? { powerSpot: true } : {}),
      ...(allyAbility === "steelyspirit" ? { steelySpirit: true } : {}),
    },
    defenderSide: {
      ...side(slotSide(target)), protect: receiver.protect !== null,
      ...(target !== attacker && flowerGift(ctx, w, target, attacker, moveId) ? { flowerGift: true } : {}),
      // The target's partner's Friend Guard, the attacker's own when it hits its partner (data/abilities.ts friendguard onAnyModifyDamage).
      friendGuard: partner !== target && partnerAbility === "friendguard",
      // A partner's Queenly Majesty, Dazzling or Armor Tail stops a foe's priority move (onFoeTryMove).
      priorityShield: isFoe(attacker, target) && (PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(partnerAbility),
    },
  };
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
  const build = calcBuild(w, slot);
  const conditions = ownConditions(ctx, w, slot);
  const key = JSON.stringify([moveId, build, conditions.magicRoom, context]);
  let info = ctx.memo.moves.get(key);
  if (!info) ctx.memo.moves.set(key, info = resolveTurnMove(ctx.runtime.movesById.get(moveId)!, build, conditions, context, ctx.runtime));
  return info;
}

/**
 * Stored Power and Power Trip (data/moves.ts storedpower, powertrip basePowerCallback: 20 per positive stage of the user)
 * and Punishment (60 plus 20 per positive stage of the target) count accuracy and evasion stages (sim/pokemon.ts
 * positiveBoosts), which no calculation reads (MoveVolatiles.stages): not estimated while the Pokémon they read has one
 * above 0 from this turn (Double Team; Contrary against Sand Attack). Their Z-Moves and Max Moves have a power of their own.
 */
function hiddenStageGuard(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, moveId: string, context: MoveContext | undefined) {
  const reads = moveId === "storedpower" || moveId === "powertrip" ? attacker : moveId === "punishment" ? target : null;
  if (!reads || context?.useZ || isMaxActive(w.mons[attacker]!.build)) return;
  const stages = w.mons[reads]?.vol.stages;
  if (stages && ((stages.accuracy ?? 0) > 0 || (stages.evasion ?? 0) > 0)) notEstimated(REASONS.hiddenStages(moveName(ctx, moveId), ctx.names[reads]));
}

/**
 * One pair's calculation and its turn search (memoised by everything they read; SPEC §9). The target's Endure this turn
 * (doubles-status.ts endureFor: UsesEnv.endure) is read too. `behindSubstitute` (ADDENDUM §4.13.3): the calculation into
 * the target's Substitute, with the target's build changed for it alone: a working resist Berry or Chilan Berry reads as
 * Leftovers (their onSourceModifyDamage returns for hitSub, PS/data/items.ts, while Knock Off's 1.5x and Poltergeist still
 * see a held item: K6), an intact Disguise or Ice Face as no ability (their onEffectiveness and onCriticalHit return for
 * hitSub, PS/data/abilities.ts:979-1001, 1985-2002: U9). `healBlocked` (psychicNoiseKeepsBerry): the target's HP Berry reads
 * as Leftovers. The step's target build then holds the stand-in; the caller puts the real item and ability back.
 */
function searchFor(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, moveId: string, conditions: BattleConditions, context: MoveContext | undefined,
  spread = false, attackerHP?: number, opts?: { behindSubstitute?: true; healBlocked?: true }): SearchEntry {
  hiddenStageGuard(ctx, w, attacker, target, moveId, context);
  const move = ctx.runtime.movesById.get(moveId)!;
  const xb = attackerHP === undefined ? calcBuild(w, attacker) : { ...calcBuild(w, attacker), currentHP: baseHP(ctx, attacker, attackerHP) };
  let tb = calcBuild(w, target);
  const behind = !!opts?.behindSubstitute;
  if (behind && RESIST_BERRIES.has(tb.itemId) && itemWorks(w, tb)) tb = { ...tb, itemId: "leftovers" };
  if (behind && BUSTED_FORMS[tb.speciesId] && (tb.abilityId === "disguise" || tb.abilityId === "iceface")) tb = { ...tb, abilityId: GAS_STAND_IN };
  // `healBlocked` (psychicNoiseKeepsBerry): the target's HP Berry is not eaten at the hit's Update; it reads as Leftovers (no damage change).
  if (opts?.healBlocked) tb = { ...tb, itemId: "leftovers" };
  const fieldSettled = DOUBLES_SLOTS.filter((slot) => slot !== attacker && slot !== target && alive(w, slot)).flatMap((slot) => {
    const build = w.mons[slot]!.build;
    return [...(FIELD_SETTLED_ABILITIES.has(build.abilityId) ? [abilityName(ctx, build.abilityId)] : []), ...(FIELD_SETTLED_ITEMS.has(build.itemId) ? [itemName(ctx, build.itemId)] : [])];
  });
  const unnerve = turnUnnerve(w, attacker, target);
  const endure = statusHooks.endureFor(w, target);
  const key = JSON.stringify([moveId, xb, tb, conditions, context, fieldSettled, spread, unnerve, ...(endure ? ["endure"] : []), ...(behind ? ["substitute"] : [])]);
  const known = DOUBLES_REFERENCE.on ? undefined : ctx.memo.searches.get(key);
  if (known) return known;
  countCalculation(ctx);
  const trace: CalcTrace = {};
  const row = calculateTurnMove(move, xb, tb, conditions, context, ctx.runtime, trace);
  let entry: SearchEntry = { row, search: null, follow: false, trace };
  if (row.kind === "calculated" && row.max !== null && row.max > 0 && trace.result) {
    try {
      const m = prepareUses(xb, tb, conditions, ctx.runtime, usesHelpers(ctx.runtime), { turn: true, fieldSettled, ...(unnerve ? { unnerve } : {}), ...(endure ? { endure: true as const } : {}) });
      const search = createTurnSearch(m, {
        move, row, trace, context,
        rerun: (next) => {
          countCalculation(ctx);
          const nextTrace: CalcTrace = {};
          return { row: calculateTurnMove(move, next.attacker, next.defender, next.conditions, next.context, ctx.runtime, nextTrace), trace: nextTrace };
        },
      }, spread ? false : undefined);
      entry = { row, search, follow: !spread && search.needsAttackerHP(), trace };
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
function turnUnnerve(w: World, attacker: DoublesSlotId, target: DoublesSlotId): TurnUnnerve | undefined {
  const holders = DOUBLES_SLOTS.filter((slot) => alive(w, slot) && slot !== w.ghost && UNNERVES.has(w.mons[slot]!.build.abilityId));
  const third = (holder: DoublesSlotId) => holders.some((slot) => slot !== attacker && slot !== target && isFoe(slot, holder));
  const unnerve = { foes: isFoe(attacker, target) && w.ghost !== attacker, target: third(target), attacker: third(attacker) };
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
function unfollowed(before: BattleBuild, after: BattleBuild): BattleBuild {
  const item = before.itemId;
  if (after.itemId === item || !(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item])) return after;
  const stat = PINCH_STAT_BERRIES[item];
  if (!stat) return { ...after, itemId: item };
  const rise = (after.abilityId === "ripen" ? 2 : 1) * (after.abilityId === "contrary" ? -1 : 1) * (after.abilityId === "simple" ? 2 : 1);
  return { ...after, itemId: item, boosts: { ...after.boosts, [stat]: Math.max(-6, Math.min(6, (after.boosts[stat] ?? 0) - rise)) } };
}

/** The build after a step: the search's side for it (HP aside). */
function fromSide(build: BattleBuild, side: TurnSide): BattleBuild {
  return { ...buildAt(build, side, null, build.abilityActive, true), currentHP: null };
}

const sideKey = (side: TurnSide) => JSON.stringify({ ...side, hp: 0 });
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
  const move = ctx.runtime.movesById.get(action.moveId)!;
  // A fainted Pokémon's abilities and items give no ModifyPriority (sim/battle.ts runEvent skips fainted holders).
  if (!alive(w, action.slot)) return move.priority;
  const full = readsFullHP(ctx, w, action) ? fullHP(ctx, w, action.slot) ?? true : true;
  const build = { ...calcBuild(w, action.slot), currentHP: full ? null : Math.max(1, ctx.hp[action.slot].baseMaxHP - 1) };
  const conditions = ownConditions(ctx, w, action.slot);
  const context = ctx.input.pokemon[action.slot]!.contexts[action.moveId];
  const key = JSON.stringify([action.moveId, build, conditions.terrain, conditions.magicRoom, conditions.gravity, context]);
  let priority = ctx.memo.priorities.get(key);
  if (priority === undefined) ctx.memo.priorities.set(key, priority = turnPriority(move, build, conditions, context, ctx.runtime));
  if (typeof priority !== "number") notEstimated(priority.reason);
  return priority;
}

function speedOf(ctx: Ctx, w: World, slot: DoublesSlotId, firstTurn = false): number {
  const build = calcBuild(w, slot);
  const conditions = ownConditions(ctx, w, slot);
  const tailwind = w.sides[slotSide(slot)].tailwind;
  const key = JSON.stringify([build, tailwind, conditions.weather, conditions.terrain, conditions.trickRoom, conditions.magicRoom, firstTurn]);
  let speed = ctx.memo.speeds.get(key);
  if (speed === undefined) ctx.memo.speeds.set(key, speed = turnSpeed(build, tailwind, conditions, ctx.runtime, firstTurn));
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
  const items = !magicRoom && build.abilityId !== "klutz";
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
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const build = w.mons[slot]!.build;
    const partner = allyOf(slot);
    // As entered: Neutralizing Gas's suppression does not reach a Tatsugiri already commanding (its onSwitchIn).
    if (entry.build.abilityId === "commander" && input.pokemon[partner]?.build.speciesId.startsWith("dondozo")) notEstimated(REASONS.notIn2v2("Commander"));
    // Under Neutralizing Gas the ability an Ability Shield keeps would replace an attacker's that the gas then suppresses.
    if (ctx.gas && ABILITY_REPLACERS.has(build.abilityId)) notEstimated(REASONS.withGas(abilityName(ctx, build.abilityId)));
    for (const id of [build.abilityId, build.itemId]) {
      if (!id || !PRESENCE_THIRD_PARTY.has(id) || id === "imposter") continue;
      const name = ctx.runtime.abilitiesById.get(id)?.name ?? itemName(ctx, id);
      notEstimated(REASONS.notIn2v2(name));
    }
    const moveId = entry.action.moveId;
    if (!moveId || ctx.targetless.has(slot)) continue;
    const move = ctx.runtime.movesById.get(moveId)!;
    const context = entry.contexts[moveId];
    // A Dancer copies a dance move another Pokémon uses (sim/battle-actions.ts runMove).
    if (DANCE_MOVES.has(moveId) && DOUBLES_SLOTS.some((other) => other !== slot && w.mons[other]?.build.abilityId === "dancer")) notEstimated(REASONS.notModelled("Dancer"));
    // Track A's guards (doubles-status.ts presenceGuards: sleep, freeze, the HP-changing status moves, Pollen Puff on an ally).
    statusHooks.presenceGuards(kernelOf(ctx), w, slot);
    if (PRESENCE_MOVES.has(moveId) || PENDING_MOVES.has(moveId)) notEstimated(REASONS.notIn2v2(move.name));
    // A move that uses another move, picked from the battle or at random (callsMove; Instruct makes its target move
    // again); Sleep Talk only does so asleep or with Comatose (data/moves.ts sleeptalk onTry), and otherwise fails.
    if (CALLING_MOVES.has(moveId) && (moveId !== "sleeptalk" || build.abilityId === "comatose")) notEstimated(REASONS.notIn2v2(move.name));
    // Two different Pledges from partners combine: the first waits for the other (data/moves.ts firepledge,
    // grasspledge, waterpledge onPrepareHit queue.prioritizeAction).
    const partnerMove = input.pokemon[partner]?.action.moveId;
    if (PLEDGE_MOVES.has(moveId) && partnerMove && PLEDGE_MOVES.has(partnerMove) && partnerMove !== moveId) {
      notEstimated(REASONS.pledges(move.name, moveName(ctx, partnerMove)));
    }
    if (isMaxActive(build) && move.category === "Status") notEstimated(REASONS.maxGuard);
    if (build.itemId === "custapberry" && (build.abilityId === "quickdraw" || build.abilityId === "myceliummight")) notEstimated(REASONS.notIn2v2("Custap Berry"));
    if (move.category !== "Status" && isMaxActive(build)) {
      const info = moveInfo(ctx, w, slot, moveId, context);
      // A G-Max move's random status, with a later action (SPEC §2.2): the order is not known yet, so any other move.
      if (info.kind === "move" && RANDOM_STATUS_MAX_MOVES.has(info.effective.name) && DOUBLES_SLOTS.some((other) => other !== slot && input.pokemon[other]?.action.moveId)) {
        notEstimated(REASONS.randomStatus(info.effective.name));
      }
    }
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
    const build: BattleBuild = { ...start.folded, currentHP: null };
    const state = carriedState(ctx, slot, build);
    // A Figy-family Berry eaten as the turn starts confused it (settleItems confused): a fresh confusion (SPEC §4.6).
    if (start.items.confused && !state.vol.confusion) state.vol.confusion = { attempts: 0, min: 2 };
    mons[slot] = {
      build, fainted: false, moved: false, flinched: null, focusLost: false,
      charged: input.pokemon[slot]!.charged, protect: null, centre: null, helpingHand: 0, hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false,
      ...state,
    };
    factors.push(pointFactor(slot, turnHP(start.folded, ctx.runtime).hp));
  }
  const side = (conditions: BattleConditions["attackerSide"]): SideState => ({
    reflect: conditions.reflect, lightScreen: conditions.lightScreen, auroraVeil: conditions.auroraVeil, tailwind: conditions.tailwind,
    wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [],
  });
  const { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom } = input.field;
  return {
    mass: 1, mons, sides: { own: side(input.field.attackerSide), opponent: side(input.field.defenderSide) },
    field: { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom }, remaining: [], executed: 0, factors,
  };
}

/**
 * A Pokémon's state from earlier turns as the turn starts (status-eot SPEC §4.6, ADDENDUM §3.5.10): DoublesCarried mapped
 * into its moves-phase volatiles and its end-of-turn state. Sleep: the counter's decrease so far (attempts, twice each
 * with Early Bird: data/abilities.ts earlybird onBeforeMove), 0 without carried.sleep (a turn fact); Champions freeze:
 * the attempts; confusion: its attempts and the least duration (Axe Kick's 3); bad poison: the stage, 0 without
 * carried.toxic; the other end-of-turn fields copied (a trap's divisor 6 with Binding Band, else 8; a carried Yawn is
 * the one that lands now: 1); the Substitute's HP and the Ally Switch counter.
 */
function carriedState(ctx: Ctx, slot: DoublesSlotId, build: BattleBuild): { vol: MoveVolatiles; eot: EotState } {
  const carried = ctx.input.pokemon[slot]!.carried ?? {};
  const vol: MoveVolatiles = {}, eotState: EotState = {};
  if (build.status === "slp") vol.sleep = { elapsed: (carried.sleep?.attempts ?? 0) * (build.abilityId === "earlybird" ? 2 : 1), rest: carried.sleep?.rest ?? false };
  if (build.status === "frz" && ctx.champions) vol.freeze = { attempts: carried.freeze?.attempts ?? 0 };
  if (carried.confusion) vol.confusion = { attempts: carried.confusion.attempts, min: carried.confusion.axeKick ? 3 : 2 };
  if (carried.substitute !== undefined) vol.substitute = carried.substitute;
  if (carried.allySwitch !== undefined) vol.allySwitch = carried.allySwitch;
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
  if (carried.futureMove) eotState.futureMove = carried.futureMove;
  if (carried.cudChew) eotState.cudChew = true;
  return { vol, eot: eotState };
}

/** The start world after the turn's first Update (doubles-status.ts turnStartUpdate), as the guards known before the walk read it. */
function firstUpdated(ctx: Ctx, settle: DoublesSettle): World {
  const w = startWorld(ctx, settle);
  statusHooks.turnStartUpdate(kernelOf(ctx), w);
  return w;
}

/** The turn's root worlds: the queue with each action's fractional priority outcomes (Quick Claw, Quick Draw). */
function rootWorlds(ctx: Ctx, settle: DoublesSettle): World[] {
  const base = startWorld(ctx, settle);
  // A status its holder's own ability cures cannot stand at the turn's start in pinned Showdown (its SetStatus stops it):
  // generation 7's one sort reads the Speed without it (doubles-status.ts ownCuresAtStart).
  if (ctx.gen7) statusHooks.ownCuresAtStart(kernelOf(ctx), base);
  let worlds: { world: World; facts: { index: number; text: string }[] }[] = [{ world: base, facts: [] }];
  ctx.actions.forEach((action, index) => {
    const build = base.mons[action.slot]!.build;
    const outcomes = fractionalOutcomes(ctx, build, action.moveId, base.field.magicRoom);
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
  const done: World[] = [];
  while (worlds.length) {
    const next: World[] = [];
    for (const w0 of worlds) {
      for (const w of refine(ctx, w0)) {
        if (battleOver(ctx, w)) { done.push(w); continue; }
        const group = topGroup(ctx, w);
        if (!group.length) { done.push(w); continue; }
        // Each tied action is next with equal chance (sim/battle.ts:429-458 speedSort shuffles each tied run, at
        // every sort from generation 8 and once in generation 7). An action that changed the weather set it this turn
        // (World.weatherSet: a new duration, or none up).
        for (const action of group) {
          for (const out of execute(ctx, cloneWorld(w, w.mass / group.length), action)) {
            if (out.field.weather !== w.field.weather) out.weatherSet = true;
            next.push(out);
          }
        }
      }
    }
    worlds = DOUBLES_REFERENCE.on ? next.filter((world) => world.mass > 0) : mergeWorlds(next, ctx.mode === "all");
    if ((worlds.length > BUDGET.worlds || entryCount(worlds) > BUDGET.entries) && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);
  }
  return DOUBLES_REFERENCE.on ? done : mergeWorlds(done, ctx.mode === "all");
}

/**
 * Whether the battle is over in this world before its next action (sim/battle.ts faintMessages then checkWin, after
 * each action; runAction stops the queue once `ended`): a side with no Pokémon left to switch in (canSwitch false) has
 * every Pokémon it had in place fainted. No later action runs (its step's skip fact says so), and the end of turn passes
 * it through (doubles-eot.ts over). With canSwitch absent the turn assumes a Pokémon is left (doubles-eot.ts's fact).
 */
function battleOver(ctx: Ctx, w: World): boolean {
  const over = (["own", "opponent"] as const).some((side) => {
    if (ctx.input.canSwitch?.[side] !== false) return false;
    const present = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side && w.mons[slot]);
    return present.length > 0 && present.every((slot) => w.mons[slot]!.fainted);
  });
  if (!over) return false;
  for (const action of w.remaining) {
    const step = stepOf(ctx, action);
    if (step && action.moveId !== null && !w.mons[action.slot]!.fainted) bump(step.skipped, "The battle ends before it moves.", w.mass);
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
  if (action.moveId !== null) {
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
  // BeforeMove (doubles-status.ts beforeMove, Track A): the worlds that stop there (skip facts), then those that go on to
  // the move. No move (moveId null) runs it too and then does nothing.
  const { go, stopped } = statusHooks.beforeMove(kernelOf(ctx), w, action);
  const out: World[] = [...stopped];
  if (action.moveId === null) return [...out, ...go];
  for (const next of go) {
    if (step) step.moves += next.mass;
    const before = step ? selfLossSnapshot(next) : null;
    for (const world of runMove(ctx, next, action)) {
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
  // Status moves: doubles-status.ts statusMove (Track A).
  const status = move.category === "Status" && !context?.useZ;
  const moved = status ? statusHooks.statusMove(kernelOf(ctx), w, action, move) : damagingMove(ctx, w, action, move);
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
  for (const world of out) {
    // Parting Shot's drops set off no Eject Pack (data/items.ts ejectpack onAfterBoost: activeMove partingshot returns).
    eventGuards(ctx, before, world, exits, move.id !== "partingshot");
    gasShieldGuard(ctx, world);
    // The items Trick or Switcheroo moved in this action (World.itemsMoved) matter only to its eventGuards (no Symbiosis).
    delete world.itemsMoved;
  }
  return out;
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
    // A user Life Orb knocks out after the hits (onAfterMoveSecondarySelf) has not fainted yet at AfterMove (the faint
    // is processed later: sim/battle.ts faintMessages), so pinned Showdown still cures; one knocked out during the hits
    // (Destiny Bond, Innards Out, a Rowap Berry) has. Which it was is not followed.
    if (user.itemId === "lifeorb" && itemWorks(w, user) && user.abilityId !== "magicguard" && hit.some(cures)) notEstimated(REASONS.ariaFaint(ctx.names[action.slot]));
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
  const later = w.remaining.some((entry) => alive(w, entry.slot));
  const events = w.boosted;
  delete w.boosted;
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot], was = before[slot];
    if (!mon || !was || !was.alive) continue;
    const rose = !!events?.[slot]?.rose || (damaging && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0)));
    // A clearBoosts (Clear Smog: World.boosted reset) takes stages with no boost event: only the recorded drops count there.
    const fell = !!events?.[slot]?.fell || (damaging && !events?.[slot]?.reset && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0)));
    if (rose) {
      for (const other of DOUBLES_SLOTS) {
        if (!isFoe(other, slot) || !alive(w, other)) continue;
        const copier = w.mons[other]!.build;
        if (copier.abilityId === "opportunist") notEstimated(REASONS.copiesRise(abilityName(ctx, "opportunist")));
        if (copier.itemId === "mirrorherb" && itemWorks(w, copier)) notEstimated(REASONS.copiesRise(itemName(ctx, "mirrorherb")));
      }
    }
    const partner = allyOf(slot);
    // An item Trick or Switcheroo moved is not used: no Symbiosis (data/abilities.ts symbiosis onAllyAfterUseItem; ADDENDUM T11).
    if (was.itemId && !mon.build.itemId && !mon.fainted && !w.itemsMoved?.includes(slot) && alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
      notEstimated(REASONS.notIn2v2(abilityName(ctx, "symbiosis")));
    }
    // A gas holder's Eject Pack takes it out with its Neutralizing Gas, whether or not an action follows.
    if (!mon.fainted && ejectPack && fell && was.itemId === "ejectpack" && !w.field.magicRoom && mon.build.abilityId !== "klutz") gasEnds(ctx, w, slot);
    if (mon.fainted) continue;
    const item = was.itemId;
    const usable = !w.field.magicRoom && mon.build.abilityId !== "klutz";
    const ejects = ejectPack && fell && item === "ejectpack" && usable;
    const exits = damaging && ["emergencyexit", "wimpout"].includes(mon.build.abilityId) && was.above && [...marginal(w, slot).keys()].some((hp) => hp * 2 <= ctx.hp[slot].maxHP);
    if (later && (ejects || exits)) notEstimated(REASONS.switchesOut(ctx.names[slot]));
    if (ejects || exits) eotHooks.leaving(w, slot);
  }
}

/**
 * Cheek Pouch's heal as `slot` eats a Berry that heals nothing itself, a status Berry (data/abilities.ts cheekpouch
 * onEatItem: a third of its base maximum HP, capped at the maximum; none once fainted), applied to `w` in place.
 */
function pouchHeal(ctx: Ctx, w: World, slot: DoublesSlotId) {
  if (w.mons[slot]!.build.abilityId !== "cheekpouch") return;
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
 * Covet) or Magic Room starting or ending changes which abilities act: not followed.
 */
function gasShieldGuard(ctx: Ctx, w: World) {
  const shielded = ctx.gas?.shielded.filter((slot) => alive(w, slot)) ?? [];
  if (!shielded.length) return;
  if (w.field.magicRoom !== ctx.input.field.magicRoom || shielded.some((slot) => w.mons[slot]!.build.itemId !== "abilityshield")) notEstimated(REASONS.gasShield);
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
  if (!byHit && ctx.stats) ctx.otherFaints.add(slot);
  // Its Neutralizing Gas ends as it faints (faintMessages runs its ability's End).
  gasEnds(ctx, w, slot);
  w.sides[slotSide(slot)].faintedThisTurn += 1;
  // Receiver and Power of Alchemy copy the fainted ally's ability (onAllyFaint): not followed (SPEC §2.2).
  const partner = allyOf(slot);
  if (alive(w, partner) && FAINT_REACTIONS.has(w.mons[partner]!.build.abilityId)) notEstimated(REASONS.notIn2v2(abilityName(ctx, w.mons[partner]!.build.abilityId)));
  for (const other of DOUBLES_SLOTS) if (alive(w, other) && w.mons[other]!.build.abilityId === "soulheart") selfBoost(ctx, w, other, { spa: 1 }, null);
  const keeper = STRONG_WEATHERS[w.field.weather];
  if (keeper && mon.build.abilityId === keeper && !DOUBLES_SLOTS.some((other) => alive(w, other) && w.mons[other]!.build.abilityId === keeper)) {
    w.field = { ...w.field, weather: "" };
  }
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
  const conditions = conditionsFor(ctx, w, attacker, target, false);
  const key = JSON.stringify(["type", moveId, calcBuild(w, attacker), calcBuild(w, target), conditions, context]);
  let row = ctx.memo.rows.get(key);
  if (!row) {
    countCalculation(ctx);
    ctx.memo.rows.set(key, row = calculateTurnMove(ctx.runtime.movesById.get(moveId)!, calcBuild(w, attacker), calcBuild(w, target), { ...conditions, defenderSide: { ...conditions.defenderSide, protect: false, priorityShield: false } }, context, ctx.runtime));
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
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? [build.configuration.teraType] : null;
  const types = tera ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [];
  return types.includes("Grass") || build.abilityId === "overcoat" || (build.itemId === "safetygoggles" && itemWorks(w, build));
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
function redirection(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, moveId: string, context: MoveContext | undefined): { taken: Redirection; ties: DoublesSlotId[] } | null {
  const handlers: { slot: DoublesSlotId; priority: number; speed: number; by: string }[] = [];
  for (const slot of DOUBLES_SLOTS) {
    if (slot === attacker || !alive(w, slot)) continue;
    const mon = w.mons[slot]!;
    if (mon.centre && isFoe(slot, attacker) && !(mon.centre === "ragepowder" && powderImmune(ctx, w, attacker))) {
      handlers.push({ slot, priority: CENTRES[mon.centre].priority, speed: speedOf(ctx, w, slot), by: CENTRES[mon.centre].by });
    }
    const type = REDIRECT_ABILITIES[mon.build.abilityId];
    if (type && !breaks(w, attacker, slot, info) && !moveId.endsWith("pledge") && usedType(ctx, w, attacker, moveId, target, info, context) === type) {
      handlers.push({ slot, priority: 0, speed: speedOf(ctx, w, slot), by: abilityName(ctx, mon.build.abilityId) });
    }
  }
  if (!handlers.length) return null;
  handlers.sort((a, b) => b.priority - a.priority || b.speed - a.speed);
  // One holder's two handlers (Follow Me and Lightning Rod) are one Pokémon: the move goes to it either way.
  const top = handlers[0];
  const ties = [...new Set(handlers.filter((handler) => handler.slot !== top.slot && handler.priority === top.priority && handler.speed === top.speed).map((handler) => handler.slot))];
  return { taken: { slot: top.slot, by: top.by }, ties };
}

/** The redirection that takes the move (redirection); a tie between two holders is not estimated. */
function redirect(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>, moveId: string, context: MoveContext | undefined): Redirection | null {
  const found = redirection(ctx, w, attacker, target, info, moveId, context);
  if (found?.ties.length) notEstimated(REASONS.notIn2v2(found.taken.by));
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
  const tera = build.mechanic === "tera" && !!build.configuration?.teraType && build.configuration.teraType !== "Stellar";
  if (typesOf(ctx, build).includes("Flying") && !(mon.eot.roosted && !tera)) return false;
  if (build.abilityId === "levitate" || build.abilityId === "eelevate") return false;
  if (mon.eot.magnetRise) return false;
  return item !== "airballoon";
}

/** A build's types (a Terastallized one's Tera Type but Stellar). */
function typesOf(ctx: Ctx, build: BattleBuild): readonly string[] {
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? [build.configuration.teraType] : null;
  return tera ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [];
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
function resolveTargets(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>): Resolution[] {
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
    const taken = tracks ? null : redirect(ctx, world, attacker, target, info, move.id, context);
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
  const context: MoveContext = { ...base };
  if (user.build.abilityId === "analytic") context.turnOrder = DOUBLES_SLOTS.some((slot) => slot !== attacker && willMove(slot)) ? "first" : "last";
  if ((id === "boltbeak" || id === "fishiousrend") && !info.transformed) context.turnOrder = willMove(target) ? "first" : "last";
  if (id === "payback") context.doubled = !willMove(target);
  if (id === "assurance") {
    // hurtThisTurn (sim/battle.ts spreadDamage: any damage it took). A target whose own move's step followed its HP
    // (recoil, Life Orb, retaliation, draining) and that nothing else hurt may or may not have lost HP to it: not followed.
    if (!receiver.hurt && receiver.ownHP) notEstimated(REASONS.notIn2v2(moveName(ctx, id)));
    context.doubled = receiver.hurt;
  }
  if (id === "avalanche" || id === "revenge") context.doubled = user.damagedBy.includes(target);
  if (id === "lashout") context.doubled = user.statsLowered || !!base?.doubled;
  // Last Respects (data/moves.ts lastrespects: 50 + 50 per side.totalFainted): at least the side's empty slots, then this turn's faints.
  if (id === "lastrespects") context.fainted = Math.max(base?.fainted ?? 0, emptySlots(ctx.input, slotSide(attacker))) + w.sides[slotSide(attacker)].faintedThisTurn;
  if (id === "ragefist") context.timesHit = Math.min(6, (base?.timesHit ?? 0) + user.timesAttacked);
  return Object.keys(context).length ? context : undefined;
}

/**
 * A resist Berry (data/items.ts occaberry and its kin onSourceModifyDamage: eatItem, which Unnerve and As One stop) is
 * read by the engine's calculation, which stops it for the attacker's own Unnerve or As One alone (gen789
 * calculateFinalModsSMSSSV): where the turn reads otherwise (turnUnnerve: a third Pokémon's, or the attacker's against
 * its own partner), not estimated. The step reads every other Berry from the turn's Unnerve (UsesEnv.unnerve).
 */
function unnerveGuard(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId) {
  const reason = resistUnnerve(ctx, w, attacker, target);
  if (reason) notEstimated(reason);
}

/** unnerveGuard's reason for this pair, or null when the calculation reads the target's resist Berry as the turn does. */
function resistUnnerve(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId): string | null {
  const build = w.mons[target]!.build;
  if (attacker === target || !RESIST_BERRIES.has(build.itemId) || !itemWorks(w, build)) return null;
  const own = w.mons[attacker]!.build.abilityId;
  if (berryUnnerved(turnUnnerve(w, attacker, target), "target", own) === UNNERVES.has(own)) return null;
  const holder = DOUBLES_SLOTS.find((slot) => slot !== attacker && alive(w, slot) && slot !== w.ghost && isFoe(slot, target) && UNNERVES.has(w.mons[slot]!.build.abilityId));
  return REASONS.notIn2v2(abilityName(ctx, holder ? w.mons[holder]!.build.abilityId : own));
}

/** `through`: a Z-Move or Max Move that gets through a protecting move with a contact effect, which then acts (its condition's onHit). */
export type HitCheck = {
  slot: DoublesSlotId; block: null | { by: string; protect?: keyof typeof PROTECT_CONTACT } | { absorb: string }; through?: keyof typeof PROTECT_CONTACT;
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
  return targets.map((slot): HitCheck => {
    const target = w.mons[slot]!;
    const side = w.sides[slotSide(slot)];
    const conditions = conditionsFor(ctx, w, attacker, slot, false);
    const context = ctx.input.pokemon[attacker]!.contexts[move.id];
    const passes = () => turnProtectOutcome(move, calcBuild(w, attacker), calcBuild(w, slot), conditions, context, ctx.runtime) !== "blocked";
    if (side.wideGuard && spread && !passes()) return { slot, block: { by: "Wide Guard" } };
    // Quick Guard: move.priority above 0.1, Prankster's and Gale Wings' included (data/moves.ts quickguard onTryHit).
    if (side.quickGuard && priority > 0.1 && !passes()) return { slot, block: { by: "Quick Guard" } };
    const protector = target.protect ? moveName(ctx, Object.entries(PROTECT_MOVES).find(([, kind]) => kind === target.protect)![0]) : "";
    if (target.protect && !passes()) return { slot, block: { by: protector, protect: target.protect } };
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
  let heals = ctx.heals.get(slot);
  if (!heals) ctx.heals.set(slot, heals = new Map());
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

/**
 * A healing Berry a Berserk or Anger Shell lock (MoveVolatiles.berryLocked, after a confusion self-hit) keeps at or under
 * its line: a later hit on its holder (the pair's step reads a held Berry as due) and a status move that resets the lock
 * (doubles-status.ts hitOne) do not follow it: not estimated. The end of turn follows the lock (doubles-eot.ts updateSlot,
 * unlock: a residual's damage resets it).
 */
function lockedBerryGuard(ctx: Ctx, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon?.vol.berryLocked || mon.fainted) return;
  const item = mon.build.itemId;
  if (!BERSERK_BERRIES.has(item) || item === "enigmaberry" || !itemWorks(w, mon.build) || berryStopped(w, slot)) return;
  const { line } = berryArithmetic(item, { ...ctx.hp[slot], ability: mon.build.abilityId }, ctx.runtime.profile.generation);
  if ([...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line)) notEstimated(REASONS.berryLocked(abilityName(ctx, mon.build.abilityId), itemName(ctx, item)));
}

/**
 * A target's Starf Berry, a Ganlon or Apicot Berry (a defense the later hits read) or, with Cheek Pouch, a Lansat Berry
 * eaten at the Update between two hits of one move (data/items.ts onUpdate; sim/battle-actions.ts:967): the hits after
 * it read the new stage or HP, which the pair's step does not follow (applyStep eats a Lansat or Starf Berry after the
 * move). Not estimated where the hits before the last can take a target above the Berry's line to it
 * (verify-engine VE-F1-10, VE-F1-13).
 */
function berryBetweenHitsGuard(ctx: Ctx, w: World, target: DoublesSlotId, row: MoveDamageResult) {
  const hits = row.hits ?? 1;
  const mon = w.mons[target];
  if (hits < 2 || row.kind !== "calculated" || !mon || mon.fainted) return;
  const item = mon.build.itemId;
  const between = item === "starfberry" || item === "ganlonberry" || item === "apicotberry" || (item === "lansatberry" && mon.build.abilityId === "cheekpouch");
  if (!between || !itemWorks(w, mon.build) || berryStopped(w, target)) return;
  const { line } = berryArithmetic(item, { ...ctx.hp[target], ability: mon.build.abilityId }, ctx.runtime.profile.generation);
  const perHit = Array.isArray(row.rolls) && Array.isArray(row.rolls[0]) ? (row.rolls as number[][]).map((rolls) => Math.max(...rolls)) : null;
  const before = perHit ? perHit.slice(0, hits - 1).reduce((sum, each) => sum + each, 0) : row.max ?? 0;
  if ([...marginal(w, target).keys()].some((hp) => hp > line && hp - before <= line)) notEstimated(REASONS.berryBetweenHits(itemName(ctx, item), moveName(ctx, row.moveId)));
}

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

function damagingMove(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const attacker = action.slot;
  const context = ctx.input.pokemon[attacker]!.contexts[move.id];
  const info = moveInfo(ctx, w, attacker, move.id, context);
  if (info.kind !== "move") notEstimated(info.reason);
  const step = stepOf(ctx, action);
  if (step && info.transformed) { step.effectiveName = info.effective.name; step.effectiveType = info.effective.type; }
  // Future Sight and Doom Desire (flags.futuremove) land at the end of a later turn.
  if (FUTURE_MOVES.has(move.id) && !info.transformed) {
    stepFact(ctx, action, `${move.name} deals no damage this turn.`, w.mass);
    return [w];
  }
  if (chargesThisTurn(ctx, w, attacker, move, info)) return chargeTurn(ctx, w, action, move);
  // The move's priority as last sorted (Quick Guard, Upper Hand and the shields read move.priority, sim/battle.ts:2649).
  const priority = action.frozen ? action.frozen.priority - action.fractional : priorityOf(ctx, w, action);
  // Stance Change (onModifyMove): an attack gives Aegislash its Blade Forme (calculateMove calculates it so).
  const out: World[] = [];
  for (const resolution of resolveTargets(ctx, w, action, info)) {
    const world = resolution.world;
    for (const fact of resolution.facts) stepFact(ctx, action, fact, world.mass);
    if (!resolution.targets.length) {
      if (!resolution.failed) stepFact(ctx, action, `${move.name} fails: no target.`, world.mass);
      out.push(world);
      continue;
    }
    // Generation 7 keeps the priority sorted at the turn's start (no re-sort), while the calculation reads Gale Wings at
    // the HP it has now: where a priority shield or Psychic Terrain reads it, the two can differ.
    if (action.frozen && priority !== priorityOf(ctx, world, action)) {
      const shields = (slot: DoublesSlotId) => [slot, allyOf(slot)].some((each) => alive(world, each) && (PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(world.mons[each]!.build.abilityId));
      if (world.field.terrain === "Psychic" || resolution.targets.some(shields)) notEstimated(REASONS.notIn2v2(abilityName(ctx, world.mons[attacker]!.build.abilityId)));
    }
    // TryMove and Try (SPEC §4.4 step 5): TryMove reads the last target (sim/battle-actions.ts useMoveInner).
    const last = resolution.targets[resolution.targets.length - 1];
    if (step && info.transformed) { const used = usedMove(ctx, world, attacker, move.id, last, info); step.effectiveName = used.name; step.effectiveType = used.type; }
    // Then a damaging move's own Try that Track A follows (doubles-status.ts tryMove: Snore once its user woke this turn).
    const failure = moveFailure(ctx, world, action, move, last, priority, info) ?? statusHooks.tryMove(kernelOf(ctx), world, action, move, last, priority, info);
    if (failure) { stepFact(ctx, action, failure, world.mass); out.push(world); continue; }
    if (resolution.swap) stepFact(ctx, action, resolution.swap, world.mass);
    // PrepareHit (sim/battle-actions.ts trySpreadMoveHit): Protean and Libero; an exploding user has already fainted.
    if (info.transformed || !SELF_DESTRUCT_MOVES.has(move.id)) proteanGuard(ctx, world, attacker, move.id, () => usedType(ctx, world, attacker, move.id, last, info, context));
    if (step) for (const slot of resolution.targets) hitStats(step, slot).reached += world.mass;
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
        world.mons[check.slot]!.protect = null;
        world.sides[slotSide(check.slot)] = { ...world.sides[slotSide(check.slot)], wideGuard: false, quickGuard: false };
      }
    }
    // Explosion and its kin, and Mind Blown, change their user's HP once for the whole move (spreadStep), whatever
    // number of targets is left.
    const once = !info.transformed && (SELF_DESTRUCT_MOVES.has(move.id) || move.id === "mindblown");
    let after: World[];
    if (resolution.darts) after = dartsStep(ctx, world, action, info, checks);
    else if (resolution.spread && (resolution.targets.length > 1 || once)) after = spreadStep(ctx, world, action, info, checks, resolution.targets.length > 1);
    else after = singleStep(ctx, world, action, info, checks[0]);
    out.push(...after.map((next) => { stanceChange(ctx, next, attacker, true); return next; }));
  }
  return out;
}

/**
 * Whether a two-turn move charges this turn (data/moves.ts solarbeam and its kin onTryMove; the semi-invulnerable ones'
 * likewise): sun skips Solar Beam's and Solar Blade's charge, rain Electro Shot's (Pokemon.effectiveWeather: Cloud
 * Nine and Air Lock, the user's Utility Umbrella, Mega Sol's sun for all but Electro Shot), a usable Power Herb any
 * one (data/items.ts powerherb onChargeMove); a Z-Move or Max Move never charges.
 */
function chargesThisTurn(ctx: Ctx, w: World, slot: DoublesSlotId, move: ChampionsMove, info: Extract<TurnMove, { kind: "move" }>): boolean {
  if (info.transformed || (!CHARGE_TURN_MOVES.has(move.id) && !SEMI_INVULNERABLE_MOVES.has(move.id))) return false;
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
  if (SEMI_INVULNERABLE_MOVES.has(move.id) && w.remaining.some((entry) => alive(w, entry.slot))) notEstimated(REASONS.semiInvulnerable(ctx.names[attacker], move.name));
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
  if (priority > 0 && !isFoe(action.slot, target) && target !== action.slot) {
    const ability = w.mons[target]!.build.abilityId;
    // The engine blocks a priority move into a shield holder or a grounded Pokémon on Psychic Terrain from any side;
    // Showdown's onFoeTryMove and Psychic Terrain's onTryHit spare an ally's.
    if ((PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(ability)) notEstimated(REASONS.allyEffect(abilityName(ctx, ability)));
    if (w.field.terrain === "Psychic") notEstimated(REASONS.allyEffect("Psychic Terrain"));
  }
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
  return turnProtectOutcome(move, calcBuild(w, action.slot), calcBuild(w, target), conditions, context, ctx.runtime) !== "blocked";
}

/** One damaging hit X -> T through the pairwise engine, the target's (and a followed attacker's) state carried (SPEC §4.5). */
function singleStep(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, check: HitCheck, attackerHP?: number): World[] {
  const attacker = action.slot, target = check.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const step = stepOf(ctx, action);
  if (check.block) return blockedHit(ctx, w, action, info, check);
  // A damaging move with an effect of its own on this target instead of damage (doubles-status.ts singleHit, Track A:
  // Pollen Puff on an ally), or null.
  const instead = statusHooks.singleHit(kernelOf(ctx), w, action, info, check, attackerHP);
  if (instead) return instead;
  // Final Gambit's damage is its user's HP (data/moves.ts finalgambit damageCallback): one world per HP it has.
  if (move.id === "finalgambit" && !info.transformed && attackerHP === undefined) {
    return [...marginal(w, attacker).keys()].flatMap((hp) => condition(w, attacker, (value) => value === hp)
      .filter(({ meets }) => meets).flatMap(({ world }) => singleStep(ctx, world, action, info, check, hp)));
  }
  // A hit into a Substitute (doubles-substitute.ts single, Track E): its worlds, or null when the hit does not meet one.
  const behind = substituteHooks.single(kernelOf(ctx), w, action, info, check, attackerHP);
  if (behind) return behind;
  const conditions = conditionsFor(ctx, w, attacker, target, false, move.id);
  const context = contextFor(ctx, w, action, target, info);
  const kept = psychicNoiseKeepsBerry(ctx, w, attacker, target, info);
  const entry = searchFor(ctx, w, attacker, target, move.id, conditions, context, false, attackerHP, kept ? { healBlocked: true } : undefined);
  if (entry.row.kind !== "calculated") {
    const face = faceTaken(ctx, w, attacker, target, entry.row, move);
    if (face) return faceHit(ctx, w, action, info, target, face, false);
    notEstimated(rowReason(ctx, w, target, entry.row, move));
  }
  focusBandGuard(ctx, w, target, entry.row);
  if (!entry.search) {
    if (step) { hitStats(step, target).noDamage += w.mass; bump(hitStats(step, target).facts, noDamageFact(ctx, entry.row, move, target), w.mass); }
    return [w];
  }
  unnerveGuard(ctx, w, attacker, target);
  return applyStep(ctx, w, action, target, entry, info, false).flatMap(({ world, landed, knocked }) => {
    // The held Berry back in place of the stand-in (psychicNoiseKeepsBerry).
    const receiver = world.mons[target]!;
    if (kept && receiver.build.itemId === "leftovers") receiver.build = { ...receiver.build, itemId: kept };
    // The faint batch after the hits (sim/battle-actions.ts hitStepMoveHitLoop faintMessages): the knocker-out's rise.
    if (knocked) koBoost(ctx, world, attacker, 1);
    if (info.isMax && landed > 0) maxEffects(ctx, world, action, info, target);
    if (check.through && landed > 0) return protectContact(ctx, world, attacker, target, check.through, info, entry.follow);
    // Final Gambit's damageCallback faints its user as it deals the damage (data/moves.ts finalgambit).
    if (move.id === "finalgambit" && !info.transformed && landed > 0 && alive(world, attacker)) {
      return mapHP(world, attacker, () => ({ hp: 0, tag: "" })).map(({ world: next }) => { faint(ctx, next, attacker); return next; });
    }
    return [world];
  });
}

/** A target a check stopped (SPEC §4.4 step 6): an absorbing ability's effect, or the block's fact and a protecting move's contact effect. */
function blockedHit(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, check: HitCheck, contactEffect = true): World[] {
  const step = stepOf(ctx, action);
  const target = check.slot;
  if (step) hitStats(step, target).blocked += w.mass;
  if (!check.block) return [w];
  if ("absorb" in check.block) return absorbEffect(ctx, w, target, check.block.absorb, action);
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
function applyStep(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: Extract<TurnMove, { kind: "move" }>, spread: boolean, part?: TurnStepPart): StepChild[] {
  const attacker = action.slot;
  lockedBerryGuard(ctx, w, target);
  berryBetweenHitsGuard(ctx, w, target, entry.row);
  const follow = entry.follow && !spread;
  const world = cloneWorld(w);
  const at = join(world, follow ? [target, attacker] : [target]);
  const joint = world.factors[at];
  const extras = joint.slots.filter((slot) => slot !== target && !(follow && slot === attacker));
  // Entries by the extras' HP.
  const groups = new Map<number, { extras: number; byAttacker: Map<number, Map<number, number>> }>();
  for (const [key, mass] of joint.table) {
    let extrasKey = 0;
    extras.forEach((slot, index) => { extrasKey += hpIn(joint, key, slot) * RADIX ** index; });
    let group = groups.get(extrasKey);
    if (!group) groups.set(extrasKey, group = { extras: extrasKey, byAttacker: new Map() });
    const x = follow ? hpIn(joint, key, attacker) : 0;
    let dist = group.byAttacker.get(x);
    if (!dist) group.byAttacker.set(x, dist = new Map());
    const t = hpIn(joint, key, target);
    dist.set(t, (dist.get(t) ?? 0) + mass);
  }
  const step = stepOf(ctx, action);
  const children = new Map<string, { table: Map<number, number>; outcome: TurnStepOutcome }>();
  const order = [...(follow ? [attacker] : []), target, ...extras];
  const keyFor = (extrasKey: number, x: number, t: number) => {
    let key = 0;
    order.forEach((slot, index) => {
      const hp = slot === attacker && follow ? x : slot === target ? t : Math.floor(extrasKey / RADIX ** extras.indexOf(slot)) % RADIX;
      key += hp * RADIX ** index;
    });
    return key;
  };
  for (const group of groups.values()) {
    const entries: TurnStepEntry[] = [...group.byAttacker].map(([x, dist]) => ({ attackerHP: x, target: dist }));
    const result = entry.search!.turnStep(follow ? entries : [{ attackerHP: 0, target: mergeDists(entries) }], ctx.mode, follow, part);
    if ("failed" in result) notEstimated(result.failed);
    for (const [source, [least, most]] of result.heals) { noteHeal(ctx, target, source, least); noteHeal(ctx, target, source, most); }
    // A followed attacker's own HP Berry and Shell Bell (data/items.ts shellbell onAfterMoveSecondarySelf), and Cheek Pouch.
    for (const [source, [least, most]] of result.attackerHeals) { noteHeal(ctx, attacker, source, least); noteHeal(ctx, attacker, source, most); }
    // The target's Berry it ate with Bug Bite or Pluck (data/moves.ts bugbite, pluck onHit: the Eat on the user).
    for (const [item, [least, most]] of result.attackerAte) {
      const source = `${ctx.names[attacker]} eats ${ctx.names[target]}'s ${itemName(ctx, item)}`;
      noteHeal(ctx, attacker, source, least); noteHeal(ctx, attacker, source, most);
    }
    if (step) for (const [row, mass] of result.rows) note(hitStats(step, target).met, damageKey(row), row, mass * world.mass);
    for (const outcome of result.outcomes) {
      const signature = JSON.stringify([sideKey(outcome.attacker), follow && outcome.attackerFainted, sideKey(outcome.target), outcome.knocked, outcome.landed,
        outcome.conditions.weather, outcome.conditions.terrain, outcome.conditions.attackerSide.charge, outcome.conditions.defenderSide.reflect,
        outcome.conditions.defenderSide.lightScreen, outcome.conditions.defenderSide.auroraVeil]);
      let child = children.get(signature);
      if (!child) children.set(signature, child = { table: new Map(), outcome });
      const x = follow ? (outcome.attackerFainted ? 0 : outcome.attacker.hp) : 0;
      for (const [t, mass] of outcome.dist) {
        const key = keyFor(group.extras, x, outcome.knocked ? 0 : t);
        child.table.set(key, (child.table.get(key) ?? 0) + mass);
        if (step && outcome.knocked) hitStats(step, target).ko += mass * world.mass;
      }
    }
  }
  if (step) note(hitStats(step, target).firsts, JSON.stringify(entry.row), entry.row, world.mass);
  // A certain critical hit without the field's Critical hit (a critical-hit ratio of 4: calculate.ts certainCrit; an
  // always-critical move; Merciless): a fact on the hit, and the turn's hit rule says so (calculateDoublesTurn).
  if (step && !ctx.input.field.critical && entry.trace?.result?.rawDesc.isCritical) {
    ctx.certainCrit = true;
    const ratio = entry.row.assumptions.find((text) => text.startsWith(CERTAIN_CRIT));
    bump(hitStats(step, target).facts, ratio ?? `${entry.row.effectiveName ?? info.effective.name} is always a critical hit.`, world.mass);
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
    const user = next.mons[attacker]!, receiver = next.mons[target]!;
    const before = { user: user.build, receiver: receiver.build };
    if (spread) next.spread = [...(next.spread ?? []), sideKey(outcome.attacker)];
    else user.build = fromSide(user.build, outcome.attacker);
    if (follow) user.ownHP = true;
    receiver.build = fromSide(receiver.build, outcome.target);
    // The faint queue in hit order (sim/battle.ts faintMessages): the target, then an attacker its retaliation knocked out.
    if (outcome.knocked) faint(ctx, next, target, true);
    if (follow && outcome.attackerFainted) faint(ctx, next, attacker);
    // A knocked-out target's Unnerve or As One ends with its HP (sim/side.ts:390-396 allies()): the attacker eats a
    // Berry it stopped at the Update after the hit (sim/battle-actions.ts:967), after the hit's retaliation and drain
    // but before its recoil (applyRecoilDamage) or Steel Beam's cost. With either, where the attacker's HP ends at or
    // under the Berry's line, not followed; otherwise unnerveEnds eats it at the end of the action, at the same HP.
    const costly = !info.transformed && (info.recoil || SELF_COST_MOVES.has(info.effective.id));
    if (follow && costly && outcome.knocked && isFoe(attacker, target) && UNNERVES.has(before.receiver.abilityId) && !berryStopped(next, attacker)) {
      const item = before.user.itemId;
      if ((HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item]) && item !== "enigmaberry" && itemWorks(next, before.user)) {
        const line = berryArithmetic(item, { ...ctx.hp[attacker], ability: before.user.abilityId }, ctx.runtime.profile.generation).line;
        if (outcome.attackerFainted || outcome.attacker.hp <= line) notEstimated(REASONS.notIn2v2(abilityName(ctx, before.receiver.abilityId)));
      }
    }
    // A Figy-family Berry gone from the target in the step: eaten (a Berry Bug Bite, Pluck or Incinerate took is not).
    const taken = stolenInStep(w, action, target, entry, info, before, receiver.build, outcome.knocked);
    if (before.receiver.itemId && !receiver.build.itemId && !taken) berryConfusion(ctx, next, target, before.receiver.itemId);
    if (taken && (action.moveId === "bugbite" || action.moveId === "pluck")) stolenFacts(ctx, next, action, target, taken, before.user);
    // The field the step left: a weather or terrain it set or ended, Charge used up, screens a Max Move cleared.
    next.field = { ...next.field, weather: outcome.conditions.weather === "" && conditionsFor(ctx, w, attacker, target, false).weather === "" ? next.field.weather : outcome.conditions.weather, terrain: outcome.conditions.terrain };
    if (!outcome.conditions.attackerSide.charge) user.charged = false;
    veilGuard(ctx, next, attacker, target, before.receiver);
    if (outcome.landed > 0) hitReactions(ctx, next, attacker, target, before.receiver.itemId);
    if (outcome.landed > 0) {
      // Electromorphosis, and Wind Power against a wind move, charge the holder (data/abilities.ts onDamagingHit: addVolatile('charge')).
      const ability = receiver.build.abilityId;
      if (ability === "electromorphosis" || (ability === "windpower" && !!info.flags.wind)) receiver.charged = true;
      receiver.hurt = true;
      receiver.focusLost = true;
      // Every hit of the move once its last hit reached the Pokémon, a Substitute's included (sim/battle-actions.ts:990-996; K1).
      receiver.timesAttacked += outcome.landed + outcome.subHits;
      if (!receiver.damagedBy.includes(attacker)) receiver.damagedBy.push(attacker);
      if (!next.hitTargets?.includes(target)) next.hitTargets = [...(next.hitTargets ?? []), target];
    }
    for (const [mon, was] of [[user, before.user], [receiver, before.receiver]] as const) {
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
      const stats = hitStats(step, target);
      stats.calculated += next.mass;
    }
    afterHit(ctx, next, action, target, outcome, info);
    // The target's own Lansat or Starf Berry at the hit's Update (data/items.ts lansatberry, starfberry onUpdate at a quarter,
    // half with Gluttony; sim/battle-actions.ts:967), which the pair's step leaves held: Lansat's focusenergy for its later
    // move, Starf's random rise (one world each), Cheek Pouch (berryDue). A foe's Unnerve or As One stops it.
    const held = next.mons[target]!.build.itemId;
    const due = LANSAT_STARF.has(held) && outcome.landed > 0 && alive(next, target) && !berryStopped(next, target);
    for (const world of due ? berryDue(ctx, next, target) : [next]) out.push({ world, landed: outcome.landed, knocked: outcome.knocked });
  }
  return out;
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
  if (eat.weakens && alive(w, attacker) && laterDamaging(ctx, w)) notEstimated(REASONS.notIn2v2(abilityName(ctx, "ripen")));
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
 * (onDamagingHit); and, with a later action, Eject Button switching its holder out and Red Card the attacker
 * (onAfterMoveSecondary); Destiny Bond taking a foe that knocks its user out (data/moves.ts destinybond onFaint).
 */
function hitReactions(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, item: string) {
  const receiver = w.mons[target]!;
  if (receiver.build.abilityId === "cottondown") notEstimated(REASONS.notIn2v2(abilityName(ctx, "cottondown")));
  // A knockout's reactions of Track A (doubles-status.ts onKnockOut: Destiny Bond).
  statusHooks.onKnockOut(kernelOf(ctx), w, attacker, target);
  if (receiver.fainted || attacker === target) return;
  const usable = !w.field.magicRoom && receiver.build.abilityId !== "klutz";
  // A gas holder switched out takes its Neutralizing Gas with it, whether or not an action follows.
  if (item === "ejectbutton" && usable) gasEnds(ctx, w, target);
  if (item === "redcard" && usable && alive(w, attacker)) gasEnds(ctx, w, attacker);
  if (!w.remaining.some((entry) => alive(w, entry.slot))) {
    // With no later action the switch-out reaches only the end of turn (doubles-eot.ts leaving).
    if (item === "ejectbutton" && usable) eotHooks.leaving(w, target);
    if (item === "redcard" && usable && alive(w, attacker)) eotHooks.leaving(w, attacker);
    return;
  }
  if (item === "ejectbutton" && usable) notEstimated(REASONS.switchesOut(ctx.names[target]));
  if (item === "redcard" && usable && alive(w, attacker)) notEstimated(REASONS.switchesOut(ctx.names[attacker]));
}

/** A row the turn cannot use, as its reason: an intact Disguise or Ice Face against a multi-hit move has its own (SPEC §2.2). */
function rowReason(ctx: Ctx, w: World, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): string {
  const face = row.reason === "Intact Disguise takes the first hit." || row.reason === "Intact Ice Face takes the first physical hit.";
  const multi = move.multihit !== null || (row.hitRule?.kind === "fixed" && row.hitRule.hits > 1) || row.hitRule?.kind === "choose";
  if (face && multi) return REASONS.faceMultiHit(abilityName(ctx, w.mons[target]!.build.abilityId));
  return row.reason ?? REASONS.notIn2v2(move.name);
}

/** Focus Band (10% to survive each hit that would knock out, not branched): not estimated when this hit can knock out. */
function focusBandGuard(ctx: Ctx, w: World, target: DoublesSlotId, row: MoveDamageResult) {
  const build = w.mons[target]!.build;
  if (build.itemId !== "focusband" || !itemWorks(w, build) || row.max === null) return;
  const lowest = Math.min(...marginal(w, target).keys());
  if (row.max >= lowest) notEstimated(REASONS.focusBand);
  void ctx;
}

/** A no-damage row as a fact: the calculation's own reason (a failure, a partner's shield), or that the move had no effect. */
function noDamageFact(ctx: Ctx, row: MoveDamageResult, move: ChampionsMove, target: DoublesSlotId): string {
  return row.assumptions.length === 1 && row.assumptions[0] === row.description ? row.description : `${move.name} has no effect on ${ctx.names[target]}.`;
}

/**
 * Flower Veil (onAllyTryBoost, onAllySetStatus: a Grass-type Pokémon on its side) and Pastel Veil (onAllySetStatus:
 * poison) keep a foe's drop or status off a Pokémon the pair's step reads alone: when the step gave one, not followed.
 */
function veilGuard(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, was: BattleBuild) {
  if (!isFoe(attacker, target)) return;
  const now = w.mons[target]!.build;
  const dropped = STATS.some((stat) => (now.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0));
  const statused = !was.status && !!now.status;
  if (!dropped && !statused) return;
  const side = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === slotSide(target) && alive(w, slot) || slot === target);
  const types = ctx.runtime.speciesById.get(now.speciesId)?.types ?? [];
  const tera = now.mechanic === "tera" && now.configuration?.teraType && now.configuration.teraType !== "Stellar" ? [now.configuration.teraType] : null;
  for (const slot of side) {
    const ability = w.mons[slot]?.build.abilityId;
    if (ability === "flowerveil" && (tera ?? types).includes("Grass")) notEstimated(REASONS.notIn2v2("Flower Veil"));
    if (ability === "pastelveil" && (now.status === "psn" || now.status === "tox") && statused) notEstimated(REASONS.notIn2v2("Pastel Veil"));
  }
}

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
function afterHit(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: Extract<TurnMove, { kind: "move" }>) {
  const attacker = action.slot;
  const user = w.mons[attacker]!, receiver = w.mons[target]!;
  // Battle Bond on the knocker-out (onSourceAfterFaint) changes its later moves and form (SPEC §2.2): not followed.
  if (outcome.knocked && alive(w, attacker) && user.build.abilityId === "battlebond") notEstimated(REASONS.notIn2v2(abilityName(ctx, "battlebond")));
  if (outcome.target.smackedDown && w.remaining.some((entry) => alive(w, entry.slot))) notEstimated(REASONS.notIn2v2(moveName(ctx, action.moveId!)));
  // Aftermath (a contact move) and Innards Out hit back as their holder is knocked out (data/abilities.ts onDamagingHit with !target.hp).
  if (outcome.knocked) {
    const ability = receiver.build.abilityId;
    if ((ability === "aftermath" && info.contact) || ability === "innardsout") notEstimated(REASONS.notIn2v2(abilityName(ctx, ability)));
  }
  const id = action.moveId!;
  const hitAny = outcome.landed + outcome.subHits > 0;
  const own = !info.transformed && outcome.landed > 0;
  const ownAny = !info.transformed && hitAny;
  // U-turn, Volt Switch and Flip Turn switch the user out after a hit (selfSwitch): its replacement is not known. A gas
  // holder takes its Neutralizing Gas with it, whether or not an action follows. With no later action the switch
  // reaches only the end of turn (doubles-eot.ts leaving).
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted) gasEnds(ctx, w, attacker);
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted && w.remaining.some((entry) => alive(w, entry.slot))) {
    notEstimated(REASONS.switchesOut(ctx.names[attacker]));
  }
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted) eotHooks.leaving(w, attacker);
  // Dragon Tail and Circle Throw drag the target out (forceSwitch: sim/battle-actions.ts:1353-1360, then
  // sim/battle.ts:2821-2829 between actions), unless it is Dynamaxed or a Suction Cups or Guard Dog holder
  // (onDragOut, breakable): later moves meet its replacement, which is not known.
  const dragged = DRAG_MOVES.has(id) && own && !receiver.fainted && !isMaxActive(receiver.build)
    && !(ANCHORING_ABILITIES.has(receiver.build.abilityId) && !breaks(w, attacker, target, info));
  if (dragged) gasEnds(ctx, w, target);
  if (dragged && w.remaining.some((entry) => alive(w, entry.slot))) notEstimated(REASONS.switchesOut(ctx.names[target]));
  if (dragged) eotHooks.leaving(w, target);
  // Burn Up and Double Shock take their type from the user as they hit (data/moves.ts burnup, doubleshock self.onHit
  // setType; a Terastallized user keeps its types, sim/pokemon.ts setType): later hits read its species' types.
  if (TYPE_LOSS_MOVES.has(id) && ownAny && !user.fainted && user.build.mechanic !== "tera" && laterDamaging(ctx, w)) {
    notEstimated(REASONS.typeChange(moveName(ctx, id), ctx.names[attacker]));
  }
  // Glaive Rush (data/moves.ts glaiverush self volatile, onSourceModifyDamage 2x) until the user's next move.
  if (id === "glaiverush" && ownAny && !user.fainted && laterDamaging(ctx, w)) notEstimated(REASONS.takesDouble(moveName(ctx, id), ctx.names[attacker]));
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
  // Track A's reactions (doubles-status.ts afterHit: Dynamic Punch's and Chatter's confusion).
  statusHooks.afterHit(kernelOf(ctx), w, action, target, outcome, info);
  // Core Enforcer's onAfterSubDamage and Spectral Thief's stolen rises act on a hit into a Substitute too
  // (PS/data/moves.ts:2889-2893; sim/battle-actions.ts:781-797); the other volatile secondaries only on the Pokémon.
  if (outcome.landed > 0 || ((id === "coreenforcer" || id === "spectralthief") && hitAny)) volatileGuard(ctx, w, action, target, info);
  // Track B's reactions (doubles-eot.ts afterHit: trap, Salt Cure, Syrup Bomb, Psychic Noise, Smack Down; Rapid Spin, Mortal Spin).
  eotHooks.afterHit(kernelOf(ctx), w, action, target, outcome, info);
}

/** A 100% secondary reaches its target (sim/battle-actions.ts secondaries): Sheer Force removes it, Shield Dust (breakable) and Covert Cloak stop it. */
function secondaryLands(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): boolean {
  const receiver = w.mons[target]!.build;
  if (w.mons[attacker]!.build.abilityId === "sheerforce") return false;
  if (receiver.abilityId === "shielddust" && !breaks(w, attacker, target, info)) return false;
  void ctx;
  return !(receiver.itemId === "covertcloak" && itemWorks(w, receiver));
}

/**
 * The HP Berry `target` keeps through Psychic Noise's hit, or null (status-eot ER21c). Its 100% secondary Heal Block
 * (secondaryLands; Aroma Veil on the target's side stops it, data/abilities.ts aromaveil) comes before the hit's Update
 * (sim/battle-actions.ts hitStepMoveHitLoop: spreadMoveHit, then eachEvent('Update')), where an HP Berry's onTryEatItem
 * TryHeal then fails (data/items.ts): Sitrus, Oran, Berry Juice and the Figy family stay held and heal nothing. Enigma
 * Berry is eaten in the hit's Hit event, before the secondary. doubles-eot.ts afterHit then sets the Heal Block.
 */
function psychicNoiseKeepsBerry(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>): string | null {
  if (info.transformed || info.effective.id !== "psychicnoise" || attacker === target) return null;
  const receiver = w.mons[target]!;
  const item = receiver.build.itemId;
  if (!HEALING_BERRIES.has(item) || item === "enigmaberry" || !itemWorks(w, receiver.build) || receiver.eot.healBlock) return null;
  if (!secondaryLands(ctx, w, attacker, target, info)) return null;
  const veiled = [target, allyOf(target)].some((slot) => alive(w, slot) && w.mons[slot]!.build.abilityId === "aromaveil" && !breaks(w, attacker, slot, info));
  return veiled ? null : item;
}

/**
 * Flinch: Fake Out's and Upper Hand's 100% secondary on a target that has not moved (data/conditions.ts flinch);
 * Sheer Force removes it, Shield Dust and Covert Cloak stop it, Inner Focus, Dynamax and a focusing Focus Punch user resist it.
 */
function flinchCheck(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>) {
  const user = w.mons[action.slot]!, receiver = w.mons[target]!;
  if (!FLINCH_MOVES.has(action.moveId!) || info.transformed || receiver.fainted || receiver.moved) return;
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

/**
 * 100% secondaries the pair's step does not carry to later moves (SPEC §2.2, the third-party row): Psychic Noise
 * (heal block: no healing for it), Core Enforcer on a target that has moved (its ability suppressed), Burning
 * Jealousy and Alluring Voice on a target whose stats rose this turn (a burn, confusion), Spectral Thief's stolen
 * rises: not estimated while a later action follows.
 */
function volatileGuard(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, info: Extract<TurnMove, { kind: "move" }>) {
  const id = action.moveId!;
  if (info.transformed || !VOLATILE_SECONDARY_MOVES.has(id) || !alive(w, target)) return;
  // Core Enforcer suppresses a gas holder that has moved (data/moves.ts coreenforcer onHit: the gastroacid volatile), which
  // ends its Neutralizing Gas, whether or not an action follows.
  if (id === "coreenforcer" && !w.remaining.some((entry) => entry.slot === target)) gasEnds(ctx, w, target);
  if (!w.remaining.some((entry) => alive(w, entry.slot))) return;
  const receiver = w.mons[target]!;
  if ((id === "burningjealousy" || id === "alluringvoice") && !receiver.statsRaised) return;
  if (id === "coreenforcer" && w.remaining.some((entry) => entry.slot === target)) return;
  notEstimated(REASONS.notIn2v2(moveName(ctx, id)));
}

/**
 * A move with more than one target (SPEC §4.6 "Spread moves"), and Explosion and its kin and Mind Blown with any
 * number: each target hit runs as its own step from the attacker's state before the move, in Showdown's target order,
 * with the spread modifier while more than one target was in place as the move started (`multiple`;
 * sim/battle-actions.ts:551, 1733-1737), protected and immune ones included. The attacker's state each step leaves must
 * agree; its HP then changes once: the targets' retaliation summed (at the hit's Update), then Mind Blown's recoil
 * (sim/battle-actions.ts applyRecoilDamage, or onMoveFail) and Life Orb once when a target was hit (data/items.ts
 * lifeorb onAfterMoveSecondarySelf) at the next Update. Explosion's user fainted as the move started (useMoveInner),
 * so nothing reaches it. `prior`: Spiky Shield's damage taken before the hits, with no Update before them.
 */
function spreadStep(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, checks: HitCheck[], multiple: boolean, attackerHP?: number, prior = 0): World[] {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const step = stepOf(ctx, action);
  const user = w.mons[attacker]!.build;
  const selfDestruct = SELF_DESTRUCT_MOVES.has(move.id) && !info.transformed;
  const mindBlown = move.id === "mindblown" && !info.transformed;
  if (!selfDestruct && (info.drain || (user.itemId === "shellbell" && itemWorks(w, user)))) notEstimated(REASONS.spreadHeal(move.name));
  if (selfDestruct && !w.ghost) return spreadStep(ctx, Object.assign(cloneWorld(w), { ghost: attacker }), action, info, checks, multiple, attackerHP, prior);
  // Every target's TryHit runs before the hit loop (sim/battle-actions.ts:550-577 trySpreadMoveHit: hitStepTryHitEvent,
  // then hitStepMoveHitLoop): a protecting move's contact effect on the attacker (King's Shield's and Obstruct's drops
  // with Defiant, Baneful Bunker's poison, Burning Bulwark's burn) comes before any target is hit, and the other
  // targets' hits read it. Spiky Shield's damage (this.damage, no Update) joins the retaliation the hits bring: the
  // Update after the hits (sim/battle-actions.ts:967) is the first that can eat a Berry for it.
  const contact = checks.filter((check) => !check.done && check.block && "by" in check.block && check.block.protect && PROTECT_CONTACT[check.block.protect] && info.contact);
  if (contact.length) {
    let worlds = [cloneWorld(w)];
    let loss = prior;
    for (const check of contact) {
      const effect = PROTECT_CONTACT[(check.block as { protect: keyof typeof PROTECT_CONTACT }).protect]!;
      if (!effect.damage) { worlds = worlds.flatMap((world) => blockedHit(ctx, world, action, info, check)); continue; }
      for (const world of worlds) blockedHit(ctx, world, action, info, check, false);
      if (w.mons[attacker]!.build.abilityId !== "magicguard") loss += Math.max(1, Math.floor(ctx.hp[attacker].baseMaxHP / effect.damage));
    }
    const rest = checks.map((check): HitCheck => (contact.includes(check) ? { ...check, done: true } : check));
    return worlds.flatMap((world) => {
      // An attacker its contact effect knocks out still hits the rest (hitStepMoveHitLoop reads no user HP): not followed.
      const out = !alive(world, attacker) || [...marginal(world, attacker).keys()].some((hp) => hp <= loss);
      if (out && rest.some((check) => !check.block)) notEstimated(REASONS.notIn2v2(contact.map((check) => (check.block as { by: string }).by)[0]));
      return spreadStep(ctx, world, action, info, rest, multiple, attackerHP, loss);
    });
  }
  // Damage that reads the attacker's HP (Eruption, Water Spout, Blaze at a third): the world is taken apart by the part
  // of that HP the damage reads, each part's steps from a Pokémon at an HP of it (its HP does not change in the move).
  if (attackerHP === undefined) {
    const probe = checks.find((check) => !check.block);
    const entry = probe ? searchFor(ctx, w, attacker, probe.slot, move.id, conditionsFor(ctx, w, attacker, probe.slot, multiple, move.id), contextFor(ctx, w, action, probe.slot, info), true) : null;
    if (entry?.search?.readsAttackerHP()) {
      const classes = new Map<string, number>();
      for (const hp of marginal(w, attacker).keys()) { const key = entry.search.attackerHPClass(hp); if (!classes.has(key)) classes.set(key, hp); }
      if (classes.size > 1 || !classes.has(entry.search.attackerHPClass(ctx.hp[attacker].maxHP))) {
        return [...classes].flatMap(([key, hp]) => condition(w, attacker, (value) => entry.search!.attackerHPClass(value) === key)
          .filter(({ meets }) => meets).flatMap(({ world }) => spreadStep(ctx, world, action, info, checks, multiple, hp, prior)));
      }
    }
  }
  // Every target's calculation from the world before the move (all of the move's damage is dealt at once).
  const plans = checks.map((check) => {
    if (check.block) return { check, entry: null as SearchEntry | null, face: null as FaceKind | null, sub: null as substituteHooks.SubPlan | null };
    // A hit into a Substitute (doubles-substitute.ts plan, Track E): applied in the target's place in the hit order.
    const sub = substituteHooks.plan(kernelOf(ctx), w, action, info, check, multiple, attackerHP);
    if (sub) return { check, entry: null, face: null, sub };
    const conditions = conditionsFor(ctx, w, attacker, check.slot, multiple, move.id);
    const entry = searchFor(ctx, w, attacker, check.slot, move.id, conditions, contextFor(ctx, w, action, check.slot, info), true, attackerHP);
    if (entry.row.kind !== "calculated") {
      const face = faceTaken(ctx, w, attacker, check.slot, entry.row, move);
      if (!face) notEstimated(rowReason(ctx, w, check.slot, entry.row, move));
      return { check, entry: null, face, sub: null };
    }
    focusBandGuard(ctx, w, check.slot, entry.row);
    if (entry.search) unnerveGuard(ctx, w, attacker, check.slot);
    return { check, entry, face: null, sub: null };
  });
  const standing = checks.map((check) => check.slot).filter((slot) => alive(w, slot));
  let worlds: World[] = [cloneWorld(w)];
  worlds[0].spread = [];
  let retaliation = prior, hit = false;
  for (const { check, entry, face, sub } of plans) {
    const target = check.slot;
    if (check.block) { if (!check.done) worlds = worlds.flatMap((world) => blockedHit(ctx, world, action, info, check)); continue; }
    // It adds no retaliation (no DamagingHit behind a Substitute); Life Orb stays this step's, once per move.
    if (sub) { hit = true; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      worlds = worlds.flatMap((world) => faceHit(ctx, world, action, info, target, face, multiple, true));
      continue;
    }
    if (!entry!.search) {
      for (const world of worlds) if (step) { hitStats(step, target).noDamage += world.mass; bump(hitStats(step, target).facts, noDamageFact(ctx, entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    worlds = worlds.flatMap((world) => applyStep(ctx, world, action, target, entry!, info, true).map((child) => child.world));
  }
  // The attacker after the move: the state every target's step left it in (its own effects, applied once).
  const out: World[] = [];
  for (const world of worlds) {
    const states = [...new Set(world.spread ?? [])];
    delete world.spread;
    if (states.length > 1) notEstimated(REASONS.spreadEffect(move.name, ctx.names[attacker]));
    if (states.length === 1) {
      const side = JSON.parse(states[0]) as TurnSide;
      world.mons[attacker]!.build = unfollowed(world.mons[attacker]!.build, fromSide(world.mons[attacker]!.build, { ...side, hp: 0 }));
    }
    if (selfDestruct) {
      // Its HP went to 0 as the move started; it faints first in the batch (sim/battle.ts faintQueue order).
      delete world.ghost;
      out.push(...mapHP(world, attacker, () => ({ hp: 0, tag: "" })).map(({ world: next }) => { faint(ctx, next, attacker); return next; }));
      continue;
    }
    // The faint batch after the hits: the targets the move knocked out, the user's ally included (sim/battle.ts faintMessages).
    koBoost(ctx, world, attacker, standing.filter((slot) => world.mons[slot]!.fainted).length);
    const build = world.mons[attacker]!.build;
    const guarded = build.abilityId === "magicguard";
    const losses: (number | number[])[] = [];
    const end: number[] = [];
    if (mindBlown && !guarded) end.push(Math.max(1, Math.round(ctx.hp[attacker].maxHP / 2)));
    const sheerForce = build.abilityId === "sheerforce" && info.secondaries;
    if (hit && build.itemId === "lifeorb" && itemWorks(world, build) && !guarded && !sheerForce) end.push(Math.max(1, Math.floor(ctx.hp[attacker].baseMaxHP / 10)));
    // The retaliation comes in the hits; the Update after them (sim/battle-actions.ts:967) is before Mind Blown's recoil
    // and Life Orb, so a Berry the move made due without a loss (a target's Unnerve or As One ending with its HP) is eaten there.
    if (retaliation && !guarded) losses.push(retaliation);
    else if (end.length) losses.push(0);
    if (end.length) losses.push(end);
    out.push(...(losses.length ? afterLoss(ctx, world, attacker, ...losses) : [world]));
  }
  if (info.isMax && hit) for (const world of out) maxEffects(ctx, world, action, info, checks[0].slot);
  return out;
}

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
    if (entry.row.kind !== "calculated") return !!faceTaken(ctx, w, attacker, check.slot, entry.row, move) || notEstimated(rowReason(ctx, w, check.slot, entry.row, move));
    return !!entry.search;
  };
  const passing = checks.filter(lands);
  if (passing.length === 2) return spreadStep(ctx, w, action, info, checks, true);
  let worlds = [w];
  for (const check of checks) {
    if (passing.includes(check)) continue;
    worlds = worlds.flatMap((world) => singleStep(ctx, world, action, info, check));
  }
  for (const check of passing) worlds = worlds.flatMap((world) => singleStep(ctx, world, action, info, check));
  return worlds;
}

export type FaceKind = "disguise" | "iceface";
const FACE_REASONS: Record<string, FaceKind> = { "Intact Disguise takes the first hit.": "disguise", "Intact Ice Face takes the first physical hit.": "iceface" };

/** The intact Disguise or Ice Face a single-hit move's hit meets (calculateMove's reason), or null (a multi-hit move: rowReason's text). */
function faceTaken(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, row: MoveDamageResult, move: ChampionsMove): FaceKind | null {
  const face = FACE_REASONS[row.reason ?? ""];
  if (!face) return null;
  const multi = move.multihit !== null || (row.hitRule?.kind === "fixed" && row.hitRule.hits > 1) || row.hitRule?.kind === "choose"
    || w.mons[attacker]!.build.abilityId === "parentalbond";
  void ctx; void target;
  return multi ? null : face;
}

/**
 * A hit an intact Disguise or Ice Face takes (data/abilities.ts disguise, iceface): no damage (onDamage gives 0 and
 * onEffectiveness a neutral typeMod, so no Weakness Policy, Enigma Berry or resist Berry acts but a Chilan Berry, which
 * any Normal hit's getDamage eats), the busted form at the Update, and from generation 8 Disguise's 1/8 of the base
 * maximum HP then (not in generation 7, data/mods/gen7/abilities.ts). The hit still lands: the move's 100% stages and
 * statuses on the target (stat-moves.ts), a flinch, Focus Punch's lost focus, Rage Fist's count; the attacker's own effects are those of the same hit into the
 * busted form (faceProbe), and Life Orb follows. Items that act on a 0-damage hit and moves with other effects on their
 * target are not estimated. `inSpread`: the attacker's state goes to spreadStep's check, and its HP is spreadStep's.
 */
function faceHit(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, target: DoublesSlotId, face: FaceKind, multiple: boolean, inSpread = false): World[] {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const holder = w.mons[target]!;
  const faceName = abilityName(ctx, holder.build.abilityId);
  if (FACE_REACTIVE_ITEMS.has(holder.build.itemId) && itemWorks(w, holder.build)) notEstimated(REASONS.notIn2v2(faceName));
  if (!info.transformed && FACE_UNSAFE_MOVES.has(move.id)) notEstimated(REASONS.notIn2v2(faceName));
  if (w.mons[attacker]!.build.abilityId === "magician") notEstimated(REASONS.notIn2v2(faceName));
  // A Chilan Berry the hit eats (neutralRow), where the calculation reads Unnerve as the turn does (the other resist Berries
  // need a super-effective hit, which the face's never is).
  if (holder.build.itemId === "chilanberry") unnerveGuard(ctx, w, attacker, target);
  const found = faceProbe(ctx, w, action, info, target, multiple, faceName);
  const probe = found?.outcome ?? null;
  const world = cloneWorld(w);
  const user = world.mons[attacker]!, receiver = world.mons[target]!;
  if (probe) {
    if (inSpread) world.spread = [...(world.spread ?? []), sideKey(probe.attacker)];
    else user.build = unfollowed(user.build, fromSide(user.build, probe.attacker));
    if (!probe.conditions.attackerSide.charge) user.charged = false;
    world.field = { ...world.field, weather: probe.conditions.weather, terrain: probe.conditions.terrain };
  }
  const step = stepOf(ctx, action);
  if (step) {
    const stats = hitStats(step, target);
    bump(stats.facts, `${faceName}: ${ctx.names[target]} takes no damage.`, world.mass);
    // The damage Showdown calculates for the hit before the face takes it (getDamage at a neutral typeMod): the hit's row.
    if (found) { stats.calculated += world.mass; note(stats.met, damageKey(found.row), found.row, world.mass); note(stats.firsts, JSON.stringify(found.row), found.row, world.mass); }
    else stats.noDamage += world.mass;
  }
  // The hit's effects on the target: the resist Berry its damage ate (a Chilan Berry's onSourceModifyDamage, inside getDamage).
  receiver.build = { ...receiver.build, speciesId: BUSTED_FORMS[receiver.build.speciesId] ?? receiver.build.speciesId, ...(found?.berry ? { itemId: "" } : {}) };
  receiver.timesAttacked += 1;
  receiver.focusLost = true;
  if (!world.hitTargets?.includes(target)) world.hitTargets = [...(world.hitTargets ?? []), target];
  const sheerForce = user.build.abilityId === "sheerforce";
  // Serene Grace makes the move's 50% and 70% added effects certain (stat-moves.ts SERENE_GRACE_MOVES).
  const sereneGrace = user.build.abilityId === "serenegrace";
  const cloak = receiver.build.itemId === "covertcloak" && itemWorks(world, receiver.build);
  const stages = info.transformed ? undefined : statMove(move.id, ctx.runtime.profile.id, sereneGrace)?.target;
  if (stages && !sheerForce && !cloak) foeDrop(ctx, world, target, stages, attacker, breaks(world, attacker, target, info));
  const accuracy = info.transformed ? 0 : accuracyDrop(move.id, sereneGrace);
  if (accuracy && !sheerForce && !cloak) foeDrop(ctx, world, target, { accuracy }, attacker, breaks(world, attacker, target, info));
  const status = info.transformed ? undefined : everyUseStatus(move.id, sereneGrace);
  if (status && (status.status === "psn" || status.status === "tox" || status.status === "brn" || status.status === "par") && !(status.secondary && (sheerForce || cloak))) {
    giveStatus(ctx, world, target, status.status, attacker);
  }
  flinchCheck(ctx, world, action, target, info);
  const chip = face === "disguise" && !ctx.gen7 ? Math.max(1, Math.floor(ctx.hp[target].baseMaxHP / 8)) : 0;
  let worlds = chip ? afterLoss(ctx, world, target, chip) : [world];
  if (!inSpread) {
    // Life Orb after a hit that landed (its onAfterMoveSecondarySelf needs no damage), at the action's Update.
    worlds = worlds.flatMap((next) => {
      const build = next.mons[attacker]!.build;
      const lifeOrb = build.itemId === "lifeorb" && itemWorks(next, build) && build.abilityId !== "magicguard" && !(sheerForce && info.secondaries);
      return lifeOrb ? afterLoss(ctx, next, attacker, Math.max(1, Math.floor(ctx.hp[attacker].baseMaxHP / 10))) : [next];
    });
    if (info.isMax) for (const next of worlds) maxEffects(ctx, next, action, info, target);
  }
  return worlds;
}

/**
 * The attacker's state after a hit an intact face takes: the same hit into the busted form from the world before it,
 * not following the attacker's HP (the Gem, Throat Spray, Charge, Stellar and the move's own stages it uses); every
 * outcome must leave the attacker one state. Null when that hit deals no damage either.
 */
function faceProbe(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, target: DoublesSlotId, multiple: boolean, faceName: string): { outcome: TurnStepOutcome; row: MoveDamageResult; berry: string } | null {
  const attacker = action.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const probe = cloneWorld(w);
  const holder = probe.mons[target]!;
  probe.mons[target] = { ...holder, build: { ...holder.build, speciesId: BUSTED_FORMS[holder.build.speciesId] ?? holder.build.speciesId } };
  const conditions = conditionsFor(ctx, probe, attacker, target, multiple, move.id);
  const context = contextFor(ctx, probe, action, target, info);
  const entry = searchFor(ctx, probe, attacker, target, move.id, conditions, context, true);
  if (entry.row.kind !== "calculated") notEstimated(rowReason(ctx, probe, target, entry.row, move));
  if (!entry.search) return null;
  const result = entry.search.turnStep([{ attackerHP: 0, target: marginal(probe, target) }], ctx.mode, false);
  if ("failed" in result) notEstimated(result.failed);
  if (new Set(result.outcomes.map((outcome) => sideKey(outcome.attacker))).size > 1) notEstimated(REASONS.notIn2v2(faceName));
  if (!result.outcomes[0]) return null;
  return { outcome: result.outcomes[0], ...neutralRow(ctx, w, attacker, target, move, conditionsFor(ctx, w, attacker, target, multiple, move.id), context, faceName) };
}

/**
 * The damage a hit into an intact face is calculated with (Showdown's getDamage before onDamage gives 0): the intact
 * form's stats and every type of the holder neutral but an immunity (data/abilities.ts iceface and disguise
 * onEffectiveness give 0 for each of its types, sim/pokemon.ts runEffectiveness), so no super-effective or resisted
 * damage and nothing that reads it (Expert Belt, Filter, Tinted Lens), in every generation; a Snow holder that is Ice
 * type keeps its Defense. Never a critical hit (iceface and disguise onCriticalHit give false, so getDamage's
 * CriticalHit event stops the field's Critical hit, an always-critical move, a certain ratio and Merciless): calculated
 * with the intact form holding Battle Armor in place of the face, which in the engine does that alone, under
 * engine-corrections.cjs neutralEffectiveness. (Strong Winds, whose halving the engine applies apart, is only in Ultra
 * Sun / Ultra Moon, where neither Mimikyu nor Eiscue is Flying type.) `berry`: the holder's resist Berry the hit eats
 * (a Chilan Berry's onSourceModifyDamage runs inside getDamage for any Normal hit; the others need a super-effective
 * typeMod, which the face's hit never has), or "".
 */
function neutralRow(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, move: ChampionsMove, conditions: BattleConditions, context: MoveContext | undefined,
  faceName: string): { row: MoveDamageResult; berry: string } {
  if (!ctx.runtime.abilitiesById.has("battlearmor")) notEstimated(REASONS.notIn2v2(faceName));
  const plain: BattleBuild = { ...calcBuild(w, target), abilityId: "battlearmor", abilityActive: false };
  countCalculation(ctx);
  const trace: CalcTrace = {};
  const row = neutralEffectiveness(() => calculateTurnMove(move, calcBuild(w, attacker), plain, { ...conditions, critical: false }, context, ctx.runtime, trace));
  if (row.kind !== "calculated") notEstimated(rowReason(ctx, w, target, row, move));
  // The attacker's Neutralizing Gas would leave Battle Armor out of the engine's calculation, where the face still acts.
  if (trace.result?.rawDesc.isCritical) notEstimated(REASONS.notIn2v2(faceName));
  const used = trace.result?.rawDesc.defenderItem;
  return { row, berry: used && getBerryResistType(used) ? plain.itemId : "" };
}

/**
 * A Max Move's side effects beyond its target (data/moves.ts max* and gmax* self.onHit; SPEC §2.2): the stages it
 * gives the user go to the user's partner too and the drops it gives the target to the other foe (stat-moves.ts
 * MAX_MOVE_EFFECTS: the pair's step gives the user and the target theirs); G-Max Foam Burst's Speed drop and Volt
 * Crash's and Malodor's statuses on every foe; G-Max Resonance's Aurora Veil; G-Max Gravitas's Gravity; G-Max Sweetness
 * curing the partner. A G-Max move whose effect the turn does not follow is not estimated while a later action
 * follows (confusion, infatuation, a critical-hit stage, a Berry restored at random), or at all for G-Max Finale's heal.
 */
function maxEffects(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, target: DoublesSlotId) {
  const attacker = action.slot;
  const name = usedMove(ctx, w, attacker, action.moveId!, target, info).name;
  const effect = MAX_MOVE_EFFECTS[name];
  const partner = allyOf(attacker);
  // The foes by their positions after an Ally Switch (ADDENDUM §3.5.2).
  const foes = [...foesOf(attacker)].sort((a, b) => showdownPosition(w, a) - showdownPosition(w, b)).filter((slot) => alive(w, slot));
  if (effect?.user && alive(w, partner)) selfBoost(ctx, w, partner, effect.user, null);
  if (effect?.foe) for (const foe of foes) if (foe !== target) foeDrop(ctx, w, foe, effect.foe, attacker, breaks(w, attacker, foe, info));
  const gmax = GMAX_EFFECTS[name];
  if (!gmax) return;
  if (gmax.guard === "always" || (gmax.guard === "later" && w.remaining.some((entry) => alive(w, entry.slot)))) notEstimated(REASONS.notIn2v2(name));
  if (gmax.foeStages) for (const foe of foes) foeDrop(ctx, w, foe, gmax.foeStages, attacker, breaks(w, attacker, foe, info));
  if (gmax.foeStatus) for (const foe of foes) giveStatus(ctx, w, foe, gmax.foeStatus, attacker);
  if (gmax.side) w.sides[slotSide(attacker)] = { ...w.sides[slotSide(attacker)], [gmax.side]: true };
  if (gmax.gravity) w.field = { ...w.field, gravity: true };
  if (gmax.curesAllies && alive(w, partner)) w.mons[partner]!.build = { ...w.mons[partner]!.build, status: "" };
}

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
    input, runtime, gen7: runtime.profile.generation === 7, champions: runtime.profile.id === "champions", names, hp, actions, mode, memo, stats,
    heals: new Map(), faintsBefore: new Map(), otherFaints: new Set(), targetless: targetlessSlots(input), gas: settle.gas ?? null,
    losses: new Map(), walkFacts: new Set(),
  };
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

function validate(input: DoublesTurnInput): DoublesTurnResult | null {
  const { runtime } = input;
  const issues = { pokemon: {} as Partial<Record<DoublesSlotId, ReturnType<typeof validateBuild>>>, field: validateConditions({ ...input.field, gameType: "Doubles" }, runtime), actions: [] as { slot: DoublesSlotId; message: string }[] };
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const found = [...validateBuild(entry.build, runtime), ...carriedIssues(input, slot)];
    if (found.length) issues.pokemon[slot] = found;
    const { moveId, target } = entry.action;
    if (moveId === null) { if (target !== null) issues.actions.push({ slot, message: "No move takes no target." }); continue; }
    const species = runtime.speciesById.get(entry.build.speciesId);
    // The 1v1 rule (roster-prep.ts learnsMove): a move of the species' learnset, not a Z-Move or Max Move itself.
    const known = runtime.movesById.get(moveId);
    if (!known || known.isZ || known.isMax || !species?.moves.includes(moveId)) { issues.actions.push({ slot, message: "This Pokémon does not learn that move." }); continue; }
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
    const vest = entry.build.itemId === "assaultvest" && !input.field.magicRoom && !(entry.build.abilityId === "klutz" && !gas);
    if (vest && known.category === "Status" && moveId !== "mefirst") issues.actions.push({ slot, message: "Assault Vest stops status moves." });
  }
  return Object.keys(issues.pokemon).length || issues.field.length || issues.actions.length ? { status: "issues", issues } : null;
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
  const foe = (source: DoublesSlotId | undefined) => !source || (isFoe(slot, source) && !!input.pokemon[source]);
  if (!foe(carried.leechSeed)) add("carried.leechSeed", "Leech Seed's seeder is not a foe in the turn.");
  if (!foe(carried.trap?.source)) add("carried.trap", "the trap's source is not a foe in the turn.");
  else if (carried.trap?.move && !runtime.movesById.has(carried.trap.move)) add("carried.trap", "the trap's move is not a move of this game.");
  if (!foe(carried.syrupBomb)) add("carried.syrupBomb", "Syrup Bomb's source is not a foe in the turn.");
  if (carried.perish !== undefined && !whole(carried.perish, 1, 3)) add("carried.perish", "the perish count is 1, 2 or 3.");
  if (carried.wish !== undefined && !whole(carried.wish, 1)) add("carried.wish", "a Wish restores at least 1 HP.");
  if (carried.substitute !== undefined && !whole(carried.substitute, 1)) add("carried.substitute", "a Substitute has at least 1 HP.");
  if (carried.allySwitch !== undefined && (!(champions || runtime.profile.id === "scarlet_violet") || ![3, 9, 27, 81, 243, 729].includes(carried.allySwitch))) {
    add("carried.allySwitch", "Ally Switch's counter is 3, 9, 27, 81, 243 or 729 (Scarlet/Violet and Champions).");
  }
  if (typeof entry.lastMove === "string" && !runtime.movesById.has(entry.lastMove)) add("lastMove", "its last move is not in this game.");
  if (entry.moves && new Set(entry.moves).size !== entry.moves.length) add("moves", "its moves list a move twice.");
  return out;
}

/** Every learnable move of `slot` into `into` at the start of the turn (four-way settle, partners' abilities; no move of this turn). */
export function calculateDoublesMoves(input: DoublesTurnInput, slot: DoublesSlotId, into: DoublesSlotId): MatchupResult {
  const { runtime } = input;
  const attacker = input.pokemon[slot], defender = input.pokemon[into];
  const issues = { attacker: attacker ? validateBuild(attacker.build, runtime) : [], defender: defender ? validateBuild(defender.build, runtime) : [], field: validateConditions({ ...input.field, gameType: "Doubles" }, runtime) };
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
  const plus = calcBuild(world, slot);
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
  const unnerved = resistUnnerve(ctx, world, slot, into);
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
function turnFacts(input: DoublesTurnInput, gas: DoublesGas | null | undefined): string[] {
  const facts = [input.field.critical ? "Every move hits and every damaging hit is critical; added effects below 100% do not happen." : NO_CRITS, ...eotHooks.endFacts(input)];
  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart): the Pokémon whose abilities it suppresses.
  if (gas?.suppressed.length) {
    const names = turnNames(input);
    const list = DOUBLES_SLOTS.filter((slot) => gas.suppressed.includes(slot)).map((slot) => names[slot]);
    facts.push(`Neutralizing Gas suppresses the abilities of ${list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`}.`);
  }
  const targetless = targetlessSlots(input);
  if (targetless.size) facts.push("No target: both foes have fainted.");
  const moves = DOUBLES_SLOTS.filter((slot) => !targetless.has(slot)).map((slot) => input.pokemon[slot]?.action.moveId).filter((id): id is string => !!id);
  // Only the stalling moves with a protect volatile read the last turn (data/moves.ts protect onPrepareHit StallMove);
  // Wide Guard and Quick Guard check queue.willAct() alone from generation 7 (their onTry).
  if (moves.some((id) => PROTECT_MOVES[id])) facts.push("Assumes no protecting move was used last turn.");
  // Fake Out's and First Impression's own onTry (not their Z-Move's or Max Move's: hit-loop.ts ownMoveId).
  const firstTurn = DOUBLES_SLOTS.some((slot) => {
    const entry = input.pokemon[slot], id = entry?.action.moveId;
    return !!entry && !!id && !targetless.has(slot) && FIRST_TURN_MOVES.has(ownMoveId(id, { isZ: !!entry.contexts[id]?.useZ, isMax: isMaxActive(entry.build) }));
  });
  if (firstTurn) facts.push("Assumes the attacker's first turn in battle.");
  if (input.field.trickRoom || moves.includes("trickroom")) facts.push("Trick Room: slower Pokémon move first.");
  facts.push(...statusHooks.turnFacts(input, gas?.suppressed ?? []), ...positionHooks.turnFacts(input));
  return [...new Set(facts)];
}

/** HP distribution of each slot over the finished worlds (the mixture of its marginals). */
function distributions(worlds: World[]): Map<DoublesSlotId, Map<number, number>> {
  const out = new Map<DoublesSlotId, Map<number, number>>();
  for (const world of worlds) {
    for (const slot of DOUBLES_SLOTS) {
      if (!world.mons[slot]) continue;
      let dist = out.get(slot);
      if (!dist) out.set(slot, dist = new Map());
      for (const [hp, mass] of marginal(world, slot)) dist.set(hp, (dist.get(hp) ?? 0) + mass * world.mass);
    }
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
  const facts = turnFacts(input, settle.gas);
  const start: DoublesStart | null = settle.reason && DOUBLES_SLOTS.every((slot) => !settle.slots[slot]) ? null : Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = settle.slots[slot];
    if (!entry) return [slot, null];
    const hp = turnHP(entry.folded, input.runtime);
    return [slot, { hp: hp.hp, maximum: hp.maxHP, ...(entry.items.settledHP ? { settled: entry.items.settledHP } : {}) }];
  })) as DoublesStart;
  let rows: DoublesStartRow[] = [];
  const notEstimatedResult = (reason: string): DoublesTurnResult => {
    try { rows = start ? startRows(input, settle) : []; } catch { rows = []; }
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
      const hits = [...step.hits].map(([slot, stats]): DoublesHit => {
        const met = [...stats.met.values()];
        const first = [...stats.firsts.values()].sort((a, b) => b.mass - a.mass)[0]?.row;
        const calculated = met.map(({ row }) => row).filter((row) => row.min !== null && row.max !== null);
        const min = calculated.length ? Math.min(...calculated.map((row) => row.min!)) : null;
        const max = calculated.length ? Math.max(...calculated.map((row) => row.max!)) : null;
        const maximum = start?.[slot]?.maximum ?? 1;
        // A hit into a Substitute alone is "substitute" (ADDENDUM §3.5.9); a status move that acted, "effect" (Track A).
        const kind = stats.calculated > 0 ? "calculated" : stats.sub.mass > 0 ? "substitute" : stats.effect > 0 ? "effect" : stats.blocked > 0 ? "blocked" : "no-damage";
        const sub = stats.sub;
        return {
          slot, reached: Math.min(1, stats.reached), kind, min: kind === "calculated" ? min : null, max: kind === "calculated" ? max : null,
          minPercent: kind === "calculated" && min !== null ? min / maximum * 100 : null, maxPercent: kind === "calculated" && max !== null ? max / maximum * 100 : null,
          koChance: stats.ko > 0 && certain(slot) ? 1 : uncertain(stats.ko, stats.ko > 0), ...((kind === "calculated" || kind === "substitute") && first ? { row: first } : {}), cases: met.length, facts: fact(stats.facts),
          ...(stats.change ? { change: { ...stats.change } } : {}),
          ...(sub.mass > 0 ? { substitute: { chance: Math.min(1, sub.mass), min: sub.min, max: sub.max, breaks: Math.min(1, sub.breaks) } } : {}),
        };
      });
      const order = [...step.order].sort((a, b) => a[0] - b[0]).map(([position, chance]) => ({ position, chance: Math.min(1, chance) }));
      return {
        slot: step.slot, moveId: step.moveId, ...(step.effectiveName ? { effectiveName: step.effectiveName, effectiveType: step.effectiveType } : {}),
        order, moves: Math.min(1, step.moves), skipped: fact(step.skipped), hits, facts: fact(step.facts),
        mean: step.positionMass ? step.positionSum / step.positionMass : 0,
      };
    }).sort((a, b) => a.mean - b.mean || DOUBLES_SLOTS.indexOf(a.slot) - DOUBLES_SLOTS.indexOf(b.slot)).map((step): DoublesStep => {
      const { mean, ...rest } = step;
      void mean;
      return rest;
    });
    rows = startRows(input, settle);
    // The end of turn: ready when every walk's is, its HP built as the moves' from the worlds after the residuals.
    const [endAll, endLow, endHigh] = ends;
    const endOfTurn: DoublesEndOfTurn = endAll.status === "ready" && endLow.status === "ready" && endHigh.status === "ready"
      ? { status: "ready", hp: hpRecords(all, start!, endAll.worlds, endLow.worlds, endHigh.worlds, hp), residuals: endAll.residuals, facts: endAll.facts }
      : { status: "not-estimated", reason: [endAll, endLow, endHigh].map((end) => end.status === "not-estimated" ? end.reason : "").find(Boolean)! };
    // Ally Switch: the chance each side stands swapped after the moves.
    const swapped = swappedShares(finished);
    // The turn facts found during the walk (kernel.turnFact) after the ones read from the input.
    const turn = [...new Set([...facts, ...all.walkFacts])];
    return { status: "ready", start: start!, steps, hp, startRows: rows, facts: turn, ...(swapped ? { swapped } : {}), endOfTurn };
  } catch (error) {
    if (error instanceof NotEstimated) return notEstimatedResult(error.reason);
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
}

/** One walk's end of turn (doubles-eot.ts endOfTurn); a NotEstimated thrown inside it leaves the moves estimated. */
function endOfTurnOf(ctx: Ctx, worlds: World[]): eotHooks.EndOfTurnRun {
  try {
    return eotHooks.endOfTurn(kernelOf(ctx), worlds);
  } catch (error) {
    if (error instanceof NotEstimated) return { status: "not-estimated", reason: error.reason };
    throw error;
  }
}

/**
 * Each Pokémon's HP over a turn's finished worlds (SPEC §4.8): low and high from the roll walks' modes, the average, the
 * extremes and the KO chance from the "all" walk's mixture, the heals, the losses outside any step and the faint before
 * moving from the "all" walk's statistics, and its condition facts in those worlds (conditionFacts). `moves`: the HP
 * after the moves, for the HP after the end of turn (status-eot SPEC §4.9: its start, settled, heals, losses and faint
 * before moving are those; the rest is recomputed).
 */
function hpRecords(all: Ctx, start: DoublesStart, finished: World[], lowest: World[], highest: World[], moves?: Record<DoublesSlotId, DoublesHP | null>): Record<DoublesSlotId, DoublesHP | null> {
  const dists = distributions(finished), lows = distributions(lowest), highs = distributions(highest);
  const conditions = conditionStats(all, finished);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot): [DoublesSlotId, DoublesHP | null] => {
    const entry = start[slot];
    const dist = dists.get(slot);
    if (!entry || !dist) return [slot, null];
    let average = 0, min = Infinity, max = -Infinity, out = 0, total = 0;
    for (const [value, mass] of dist) { average += value * mass; total += mass; if (value < min) min = value; if (value > max) max = value; if (value <= 0) out += mass; }
    const kept = moves?.[slot];
    const heals = kept ? kept.heals : [...(all.heals.get(slot) ?? new Map<string, [number, number]>())].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`);
    const before = all.faintsBefore.get(slot) ?? 0;
    const faintsBefore = kept ? kept.faintsBeforeMoving : all.input.pokemon[slot]!.action.moveId !== null && before > 0 ? Math.min(1, before) : undefined;
    const losses = kept ? kept.losses : factList(all.losses.get(slot));
    const facts = conditions.get(slot);
    return [slot, {
      start: entry.hp, maximum: entry.maximum, ...(entry.settled ? { settled: entry.settled } : {}),
      low: modeOf(lows.get(slot), true), average: total ? average / total : entry.hp, high: modeOf(highs.get(slot), false),
      min, max, koChance: out >= 1 - 1e-12 && min <= 0 && max <= 0 ? 1 : uncertain(out, out > 0), heals,
      ...(faintsBefore !== undefined ? { faintsBeforeMoving: faintsBefore } : {}),
      ...(losses?.length ? { losses } : {}),
      ...(facts?.length ? { conditions: facts } : {}),
    }];
  })) as Record<DoublesSlotId, DoublesHP | null>;
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
    ...statusHooks.conditions(kernel, w, slot), ...eotHooks.conditions(kernel, w, slot),
    ...positionHooks.conditions(kernel, w, slot), ...itemHooks.conditions(kernel, w, slot), ...substituteHooks.conditions(kernel, w, slot),
  ];
}

/** Each slot's condition facts over finished worlds, with the share of the turn in which each holds. */
function conditionStats(ctx: Ctx, worlds: World[]): Map<DoublesSlotId, DoublesFact[]> {
  const kernel = kernelOf(ctx);
  const masses = new Map<DoublesSlotId, Map<string, number>>();
  for (const world of worlds) {
    for (const slot of DOUBLES_SLOTS) {
      if (!world.mons[slot]) continue;
      for (const text of new Set(conditionFacts(kernel, world, slot))) {
        let map = masses.get(slot);
        if (!map) masses.set(slot, map = new Map());
        bump(map, text, world.mass);
      }
    }
  }
  return new Map([...masses].map(([slot, map]) => [slot, factList(map)!]));
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
    let mass = 0, total = 0;
    for (const [key, entry] of factor.table) {
      total += entry;
      if (slots.every((slot) => hpIn(factor, key, slot) <= 0)) mass += entry;
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
function outcomeOf(ctx: Ctx, world: World, gas: DoublesGas | null | undefined): DoublesOutcome {
  const kernel = kernelOf(ctx);
  const mons: DoublesOutcome["mons"] = {};
  for (const slot of DOUBLES_SLOTS) {
    const mon = world.mons[slot];
    if (!mon) continue;
    const own = gas?.abilities[slot];
    const dist = marginal(world, slot);
    let total = 0;
    for (const mass of dist.values()) total += mass;
    const hp = [...dist].sort((a, b) => a[0] - b[0]).map(([value, mass]) => ({ hp: value, chance: total > 0 ? mass / total : 0 }));
    const build = own !== undefined && mon.build.abilityId === GAS_STAND_IN ? { ...mon.build, abilityId: own } : mon.build;
    const entry: DoublesOutcomeMon = { hp, build, protected: mon.protect !== null, moved: mon.moved };
    const a = statusHooks.outcomeMon(kernel, world, slot), b = eotHooks.outcomeMon(kernel, world, slot), e = positionHooks.outcomeMon(kernel, world, slot);
    const volatiles = [...new Set([...(a.volatiles ?? []), ...(b.volatiles ?? []), ...(e.volatiles ?? []), ...(mon.vol.substitute ? ["substitute"] : [])])].sort();
    if (volatiles.length) entry.volatiles = volatiles;
    if (a.sleepTurns !== undefined) entry.sleepTurns = a.sleepTurns;
    if (b.perishCount !== undefined) entry.perishCount = b.perishCount;
    if (mon.vol.substitute) entry.substitute = [{ hp: mon.vol.substitute, chance: 1 }];
    if (e.allySwitch !== undefined) entry.allySwitch = e.allySwitch;
    mons[slot] = entry;
  }
  const side = (state: SideState) => ({
    reflect: state.reflect, lightScreen: state.lightScreen, auroraVeil: state.auroraVeil, tailwind: state.tailwind, faintedThisTurn: state.faintedThisTurn,
    ...(state.safeguard ? { safeguard: true } : {}), ...(state.hazards.length ? { hazards: [...state.hazards] } : {}),
  });
  return {
    chance: world.mass, mons, sides: { own: side(world.sides.own), opponent: side(world.sides.opponent) }, field: { ...world.field },
    allFainted: { own: sideFaintedChance(world, "own"), opponent: sideFaintedChance(world, "opponent") },
    positions: { own: world.swapped?.own ? "swapped" : "kept", opponent: world.swapped?.opponent ? "swapped" : "kept" },
  };
}

/**
 * Outcomes whose builds, protect and moved flags, volatiles, perish counts, Ally Switch counters, sides, field and
 * positions are equal, merged: the chances add, and the HP distributions, the Substitutes' HP, the sleep counters'
 * expectations and allFainted become their chance-weighted mixtures (exact for the marginals and for allFainted).
 */
function mergeOutcomes(outcomes: DoublesOutcome[]): DoublesOutcome[] {
  type Mixed = { hp: Map<number, number>; substitute: Map<number, number> | null; sleep: number | null };
  const byKey = new Map<string, { outcome: DoublesOutcome; mixed: Map<DoublesSlotId, Mixed>; fainted: Record<DoublesSideId, number> }>();
  for (const outcome of outcomes) {
    const key = JSON.stringify([
      DOUBLES_SLOTS.map((slot) => {
        const mon = outcome.mons[slot];
        return mon ? [mon.build, mon.protected, mon.moved, mon.volatiles ?? null, mon.perishCount ?? null, mon.allySwitch ?? null] : null;
      }), outcome.sides, outcome.field, outcome.positions,
    ]);
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, entry = { outcome: { ...outcome, chance: 0 }, mixed: new Map(), fainted: { own: 0, opponent: 0 } });
    entry.outcome.chance += outcome.chance;
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      if (!mon) continue;
      let mixed = entry.mixed.get(slot);
      if (!mixed) entry.mixed.set(slot, mixed = { hp: new Map(), substitute: mon.substitute ? new Map() : null, sleep: mon.sleepTurns !== undefined ? 0 : null });
      for (const { hp, chance } of mon.hp) mixed.hp.set(hp, (mixed.hp.get(hp) ?? 0) + chance * outcome.chance);
      if (mixed.substitute) for (const { hp, chance } of mon.substitute ?? []) mixed.substitute.set(hp, (mixed.substitute.get(hp) ?? 0) + chance * outcome.chance);
      if (mixed.sleep !== null) mixed.sleep += (mon.sleepTurns ?? 0) * outcome.chance;
    }
    entry.fainted.own += outcome.allFainted.own * outcome.chance;
    entry.fainted.opponent += outcome.allFainted.opponent * outcome.chance;
  }
  return [...byKey.values()].map(({ outcome, mixed, fainted }) => {
    const share = (mass: number) => outcome.chance > 0 ? mass / outcome.chance : 0;
    const table = (map: Map<number, number>) => [...map].sort((a, b) => a[0] - b[0]).map(([value, mass]) => ({ hp: value, chance: share(mass) }));
    const mons: DoublesOutcome["mons"] = {};
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      const each = mixed.get(slot);
      if (!mon || !each) continue;
      mons[slot] = {
        ...mon, hp: table(each.hp), ...(each.substitute ? { substitute: table(each.substitute) } : {}), ...(each.sleep !== null ? { sleepTurns: share(each.sleep) } : {}),
      };
    }
    return { ...outcome, mons, allFainted: { own: share(fainted.own), opponent: share(fainted.opponent) } };
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
    const outcomes = mergeOutcomes(worlds.map((world) => outcomeOf(all, world, settle.gas))).map((outcome) => ({ ...outcome, chance: total > 0 ? outcome.chance / total : 0 }));
    return { status: "ready", start, outcomes, endOfTurn: end.status === "ready" ? "applied" : { notEstimated: end.reason } };
  } catch (error) {
    if (error instanceof NotEstimated) return { status: "not-estimated", reason: error.reason };
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
}
