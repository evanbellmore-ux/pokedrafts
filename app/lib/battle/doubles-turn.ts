import {
  calculateTurnMove, GAS_STAND_IN, matchupRows, partnerAbilitySuppressor, resolveTurnMove, settleDoublesStart, turnHP, turnPriority, turnProtectOutcome, turnSpeed, usesHelpers,
  type DoublesGas, type DoublesSettle, type MatchupResult, type SettledMatchup, type TurnMove,
} from "./calculate";
import {
  ABILITY_REPLACERS, ABSORBING, ANCHORING_ABILITIES, BUSTED_FORMS, RESIST_BERRIES, CALLING_MOVES, CHARGE_TURN_MOVES, CONFUSING_BERRIES, CONFUSING_MOVES, DAMP_MOVES, DANCE_MOVES, DRAG_MOVES,
  FACE_REACTIVE_ITEMS, FACE_UNSAFE_MOVES, FAINT_REACTIONS, FIELD_MOVES, FUTURE_MOVES, GAS_CHANGING_MOVES,
  GMAX_EFFECTS, GRAVITY_MOVES, HP_STATUS_MOVES, IGNORE_ABILITY_MOVES, KO_BOOSTS, MODELLED_STATUS_MOVES, MOLD_BREAKERS, PLEDGE_MOVES, PRESENCE_THIRD_PARTY, SELF_DESTRUCT_MOVES,
  TYPE_LOSS_MOVES, VOLATILE_SECONDARY_MOVES,
  NO_EFFECT_MOVES, PENDING_MOVES, PRESENCE_MOVES, PROTECT_CONTACT, PROTECT_MOVES, RANDOM_STATUS_MAX_MOVES, REASONS, REDIRECT_ABILITIES,
  SEMI_INVULNERABLE_MOVES, SIDE_MOVES, STRONG_WEATHERS, SWITCH_MOVES, TERRAIN_MOVES, TRACKING_ABILITIES, TRACKS_TARGET_MOVES, WEATHER_MOVES,
} from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, doublesNames, foesOf, SHOWDOWN_POSITION, slotSide, type DoublesFact, type DoublesHit, type DoublesHP, type DoublesSideId,
  type DoublesSlotId, type DoublesStart, type DoublesStartRow, type DoublesStep, type DoublesTurnInput, type DoublesTurnResult,
  type DoublesOutcome, type DoublesOutcomeMon, type DoublesOutcomesResult,
} from "./doubles-types";
import {
  cloneWorld, condition, entryCount, hpIn, join, mapHP, marginal, mergeWorlds, pointFactor, RADIX, splitFactor,
  type Factor, type MonState, type PendingAction, type SideState, type World,
} from "./doubles-world";
import { getBerryResistType } from "@smogon/calc/dist/items";
import {
  berryArithmetic, berryHeals, berryUnnerved, BERRY_STEALERS, eatBerry, HEALING_BERRIES, KLUTZ_IGNORED_ITEMS, ownMoveId, PINCH_STAT_BERRIES, stolenEat, UNNERVES,
  type Berry, type TurnUnnerve,
} from "./hit-loop";
import { neutralEffectiveness } from "./engine-corrections.cjs";
import { isMaxActive } from "./mechanics";
import { getBuildStats, NATURES, PRIORITY_SHIELD_ABILITIES, validateBuild, validateConditions } from "./model";
import type { BattleRuntime } from "./runtime";
import { everyUseStatus, MAX_MOVE_EFFECTS, statMove } from "./stat-moves";
import type { BattleBuild, BattleConditions, ChampionsMove, CombatStat, MoveContext, MoveDamageResult } from "./types";
import { doublesNoFoeLeft, doublesTargetRule } from "./doubles-targets";
import {
  buildAt, createTurnSearch, prepareUses, uncertain, USES_REFERENCE, type CalcTrace, type Mode, type TurnSide, type TurnStepEntry, type TurnStepOutcome, type UsesSearch,
} from "./uses-to-ko";

// The 2v2 tab's turn (SPEC §4): every queued action in pinned Showdown c23d2e94's order, each random event branched
// exactly, each damaging hit one pairwise use (uses-to-ko.ts turnStep) with the target's state carried. A result is
// exact or the turn is not estimated with a fact reason (SPEC §2.2). Extension points for the rest of §2.2's "In" list:
// statusMove (Tailwind, Trick Room, Gravity, weather, terrain, screens), afterMove (Moxie and the other faint reactions,
// the Explosion family), contextFor, presenceGuards/PENDING_MOVES (each guard removed where a mechanic is modelled).

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

type HitStats = {
  reached: number; ko: number; calculated: number; blocked: number; noDamage: number;
  /** The calculations met, by their damage (rolls, hits and power), and each step's first calculation, by its row. */
  met: Map<string, { row: MoveDamageResult; mass: number }>; firsts: Map<string, { row: MoveDamageResult; mass: number }>;
  facts: Map<string, number>;
};
type StepStats = {
  slot: DoublesSlotId; moveId: string; order: Map<number, number>; moves: number; positionSum: number; positionMass: number;
  skipped: Map<string, number>; facts: Map<string, number>; hits: Map<DoublesSlotId, HitStats>; effectiveName?: string; effectiveType?: string;
};
type SearchEntry = { row: MoveDamageResult; search: UsesSearch | null; follow: boolean; trace?: CalcTrace };
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
};

const alive = (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted;
const isFoe = (a: DoublesSlotId, b: DoublesSlotId) => slotSide(a) !== slotSide(b);
const moveName = (ctx: Ctx, id: string) => ctx.runtime.movesById.get(id)?.name ?? id;
const abilityName = (ctx: Ctx, id: string) => ctx.runtime.abilitiesById.get(id)?.name ?? id;
const itemName = (ctx: Ctx, id: string) => ctx.runtime.itemsById.get(id)?.name ?? id;
const itemWorks = (w: World, build: BattleBuild) => !w.field.magicRoom && build.abilityId !== "klutz";
const bump = <K>(map: Map<K, number>, key: K, mass: number) => map.set(key, (map.get(key) ?? 0) + mass);

function hitStats(step: StepStats, slot: DoublesSlotId): HitStats {
  let stats = step.hits.get(slot);
  if (!stats) step.hits.set(slot, stats = { reached: 0, ko: 0, calculated: 0, blocked: 0, noDamage: 0, met: new Map(), firsts: new Map(), facts: new Map() });
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

/** One pair's calculation and its turn search (memoised by everything they read; SPEC §9). */
function searchFor(ctx: Ctx, w: World, attacker: DoublesSlotId, target: DoublesSlotId, moveId: string, conditions: BattleConditions, context: MoveContext | undefined,
  spread = false, attackerHP?: number): SearchEntry {
  const move = ctx.runtime.movesById.get(moveId)!;
  const xb = attackerHP === undefined ? calcBuild(w, attacker) : { ...calcBuild(w, attacker), currentHP: baseHP(ctx, attacker, attackerHP) };
  const tb = calcBuild(w, target);
  const fieldSettled = DOUBLES_SLOTS.filter((slot) => slot !== attacker && slot !== target && alive(w, slot)).flatMap((slot) => {
    const build = w.mons[slot]!.build;
    return [...(FIELD_SETTLED_ABILITIES.has(build.abilityId) ? [abilityName(ctx, build.abilityId)] : []), ...(FIELD_SETTLED_ITEMS.has(build.itemId) ? [itemName(ctx, build.itemId)] : [])];
  });
  const unnerve = turnUnnerve(w, attacker, target);
  const key = JSON.stringify([moveId, xb, tb, conditions, context, fieldSettled, spread, unnerve]);
  const known = DOUBLES_REFERENCE.on ? undefined : ctx.memo.searches.get(key);
  if (known) return known;
  countCalculation(ctx);
  const trace: CalcTrace = {};
  const row = calculateTurnMove(move, xb, tb, conditions, context, ctx.runtime, trace);
  let entry: SearchEntry = { row, search: null, follow: false, trace };
  if (row.kind === "calculated" && row.max !== null && row.max > 0 && trace.result) {
    try {
      const m = prepareUses(xb, tb, conditions, ctx.runtime, usesHelpers(ctx.runtime), { turn: true, fieldSettled, ...(unnerve ? { unnerve } : {}) });
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

function keyOf(ctx: Ctx, w: World, action: PendingAction): { priority: number; speed: number } {
  if (action.frozen) return action.frozen;
  return { priority: priorityOf(ctx, w, action) + action.fractional, speed: speedOf(ctx, w, action.slot) };
}

/** The actions tied at the head of the queue (sim/battle.ts comparePriority and speedSort). */
function topGroup(ctx: Ctx, w: World): PendingAction[] {
  let best: PendingAction[] = [];
  let top: { priority: number; speed: number } | null = null;
  for (const action of w.remaining) {
    const key = keyOf(ctx, w, action);
    if (!top || key.priority > top.priority || (key.priority === top.priority && key.speed > top.speed)) { top = key; best = [action]; }
    else if (key.priority === top.priority && key.speed === top.speed) best.push(action);
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
    // Sleep's counter is not known (data/conditions.ts slp onBeforeMove): a sleeping Pokémon may wake and use its move,
    // and Snore and Sleep Talk fail once it is awake (their onTry).
    if (build.status === "slp") notEstimated(REASONS.sleep);
    if (build.status === "frz") notEstimated(REASONS.freeze);
    if (HP_STATUS_MOVES.has(moveId)) notEstimated(REASONS.notModelled(move.name));
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
    if (moveId === "pollenpuff" && entry.action.target === partner) notEstimated(REASONS.pollenPuff);
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
    mons[slot] = {
      build: { ...start.folded, currentHP: null }, fainted: false, moved: false, flinched: null, focusLost: false,
      charged: input.pokemon[slot]!.charged, protect: null, centre: null, helpingHand: 0, hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false,
    };
    factors.push(pointFactor(slot, turnHP(start.folded, ctx.runtime).hp));
  }
  const side = (conditions: BattleConditions["attackerSide"]): SideState => ({
    reflect: conditions.reflect, lightScreen: conditions.lightScreen, auroraVeil: conditions.auroraVeil, tailwind: conditions.tailwind,
    wideGuard: false, quickGuard: false, faintedThisTurn: 0,
  });
  const { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom } = input.field;
  return {
    mass: 1, mons, sides: { own: side(input.field.attackerSide), opponent: side(input.field.defenderSide) },
    field: { weather, terrain, gravity, trickRoom, wonderRoom, magicRoom }, remaining: [], executed: 0, factors,
  };
}

/** The turn's root worlds: the queue with each action's fractional priority outcomes (Quick Claw, Quick Draw). */
function rootWorlds(ctx: Ctx, settle: DoublesSettle): World[] {
  const base = startWorld(ctx, settle);
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
  let worlds = rootWorlds(ctx, settle);
  const done: World[] = [];
  while (worlds.length) {
    const next: World[] = [];
    for (const w0 of worlds) {
      for (const w of refine(ctx, w0)) {
        const group = topGroup(ctx, w);
        if (!group.length) { done.push(w); continue; }
        // Each tied action is next with equal chance (sim/battle.ts:429-458 speedSort shuffles each tied run, at
        // every sort from generation 8 and once in generation 7).
        for (const action of group) next.push(...execute(ctx, cloneWorld(w, w.mass / group.length), action));
      }
    }
    worlds = DOUBLES_REFERENCE.on ? next.filter((world) => world.mass > 0) : mergeWorlds(next, ctx.mode === "all");
    if ((worlds.length > BUDGET.worlds || entryCount(worlds) > BUDGET.entries) && !DOUBLES_REFERENCE.on) notEstimated(REASONS.tooMany);
  }
  return DOUBLES_REFERENCE.on ? done : mergeWorlds(done, ctx.mode === "all");
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
  if (action.moveId === null) return [w];
  // BeforeMove, by handler priority (sim/battle-actions.ts runMove): flinch (data/conditions.ts flinch, 8), Gravity
  // (data/moves.ts gravity condition, 6), paralysis (1); then Focus Punch's beforeMoveCallback.
  if (mon.flinched) {
    if (step) bump(step.skipped, `Flinches (${mon.flinched}).`, w.mass);
    // Steadfast (data/abilities.ts steadfast onFlinch): +1 Speed, a rise a foe's Opportunist or Mirror Herb copies (eventGuards).
    if (mon.build.abilityId === "steadfast") {
      const before = snapshot(ctx, w);
      selfBoost(ctx, w, action.slot, { spe: 1 }, action);
      eventGuards(ctx, before, w);
    }
    return [w];
  }
  // Gravity stops a move with the gravity flag (not a Z-Move; a Max Move has none).
  const context = ctx.input.pokemon[action.slot]!.contexts[action.moveId];
  if (w.field.gravity && GRAVITY_MOVES.has(action.moveId) && !context?.useZ && !isMaxActive(mon.build)) {
    if (step) bump(step.skipped, `Gravity: ${moveName(ctx, action.moveId)} cannot be used.`, w.mass);
    return [w];
  }
  // Throat Chop (data/moves.ts throatchop condition onBeforeMove, priority 6): no sound move but a Z-Move or Max Move.
  if (mon.throatChopped) {
    const info = moveInfo(ctx, w, action.slot, action.moveId, context);
    if (info.kind === "move" && info.flags.sound && !info.isZ && !info.isMax) {
      if (step) bump(step.skipped, `Throat Chop: ${moveName(ctx, action.moveId)} cannot be used.`, w.mass);
      return [w];
    }
  }
  const out: World[] = [];
  if (mon.build.status === "par") {
    // Full paralysis (data/conditions.ts par onBeforeMove randomChance(1, 4), Magic Guard or not; 1/8 in Champions,
    // data/mods/champions/conditions.ts:2-10).
    const chance = ctx.champions ? 1 / 8 : 1 / 4;
    const stopped = cloneWorld(w, w.mass * chance);
    if (step) bump(step.skipped, "Fully paralysed.", stopped.mass);
    out.push(stopped);
    w.mass *= 1 - chance;
  }
  if (mon.focusLost && focuses(ctx, w, action.slot, action.moveId)) {
    if (step) bump(step.skipped, "Loses its focus (Focus Punch).", w.mass);
    out.push(w);
    return out;
  }
  if (step) step.moves += w.mass;
  const before = step ? selfLossSnapshot(w) : null;
  for (const world of runMove(ctx, w, action)) {
    // A user that faints in its own move (the Explosion family, Final Gambit, recoil, Life Orb, what its targets hit back with).
    if (step && before && world.mons[action.slot]!.fainted) stepFact(ctx, action, selfFaintFact(ctx, before, action, step), world.mass);
    out.push(world);
  }
  return out;
}

type LossSnapshot = Partial<Record<DoublesSlotId, { build: BattleBuild; protect: MonState["protect"] }>>;
function selfLossSnapshot(w: World): LossSnapshot {
  return Object.fromEntries(DOUBLES_SLOTS.filter((slot) => w.mons[slot]).map((slot) => [slot, { build: w.mons[slot]!.build, protect: w.mons[slot]!.protect }]));
}

/**
 * "{Name} faints ({sources})." for a user that faints in its own move: the move itself (selfdestruct, Final Gambit's
 * damageCallback, Mind Blown and its kin), or what can take its HP in it as the move starts (recoil, the Pokémon it
 * reached hitting back on contact: Rough Skin, Iron Barbs, Rocky Helmet, Spiky Shield; a Jaboca or Rowap Berry;
 * Liquid Ooze on a draining move; Life Orb), none of which Magic Guard lets through.
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
      if (info.contact && ["roughskin", "ironbarbs"].includes(target.build.abilityId)) sources.push(abilityName(ctx, target.build.abilityId));
      if (info.contact && items && target.build.itemId === "rockyhelmet") sources.push(itemName(ctx, "rockyhelmet"));
      if (info.contact && target.protect === "spikyshield") sources.push(moveName(ctx, "spikyshield"));
      if (items && target.build.itemId === (physical ? "jabocaberry" : "rowapberry")) sources.push(itemName(ctx, target.build.itemId));
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
  const moved = move.category === "Status" && !context?.useZ ? statusMove(ctx, w, action, move) : damagingMove(ctx, w, action, move);
  const out = moved.flatMap((world) => {
    const gone = DOUBLES_SLOTS.filter((slot) => before[slot]?.alive && world.mons[slot]!.fainted && UNNERVES.has(world.mons[slot]!.build.abilityId));
    return gone.length ? unnerveEnds(ctx, world, gone) : [world];
  });
  for (const world of out) {
    eventGuards(ctx, before, world);
    gasShieldGuard(ctx, world);
  }
  return out;
}

type Snapshot = Partial<Record<DoublesSlotId, { boosts: BattleBuild["boosts"]; itemId: string; above: boolean; alive: boolean }>>;

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
 * (onAfterMoveSecondary), Eject Pack after a drop (onAfterBoost), Emergency Exit and Wimp Out falling to half HP.
 */
function eventGuards(ctx: Ctx, before: Snapshot, w: World) {
  const later = w.remaining.some((entry) => alive(w, entry.slot));
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot], was = before[slot];
    if (!mon || !was || !was.alive) continue;
    const rose = STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0));
    const fell = STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0));
    if (rose) {
      for (const other of DOUBLES_SLOTS) {
        if (!isFoe(other, slot) || !alive(w, other)) continue;
        const copier = w.mons[other]!.build;
        if (copier.abilityId === "opportunist") notEstimated(REASONS.copiesRise(abilityName(ctx, "opportunist")));
        if (copier.itemId === "mirrorherb" && itemWorks(w, copier)) notEstimated(REASONS.copiesRise(itemName(ctx, "mirrorherb")));
      }
    }
    const partner = allyOf(slot);
    if (was.itemId && !mon.build.itemId && !mon.fainted && alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
      notEstimated(REASONS.notIn2v2(abilityName(ctx, "symbiosis")));
    }
    // A gas holder's Eject Pack takes it out with its Neutralizing Gas, whether or not an action follows.
    if (!mon.fainted && fell && was.itemId === "ejectpack" && !w.field.magicRoom && mon.build.abilityId !== "klutz") gasEnds(ctx, w, slot);
    if (!later || mon.fainted) continue;
    const item = was.itemId;
    const usable = !w.field.magicRoom && mon.build.abilityId !== "klutz";
    if (fell && item === "ejectpack" && usable) notEstimated(REASONS.switchesOut(ctx.names[slot]));
    if (["emergencyexit", "wimpout"].includes(mon.build.abilityId) && was.above && [...marginal(w, slot).keys()].some((hp) => hp * 2 <= ctx.hp[slot].maxHP)) {
      notEstimated(REASONS.switchesOut(ctx.names[slot]));
    }
  }
}

/** A boost the Pokémon gives itself (sim/battle.ts boost: Contrary, Simple, the ±6 cap). */
function selfBoost(ctx: Ctx, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null) {
  const mon = w.mons[slot]!;
  const ability = mon.build.abilityId;
  const boosts = { ...mon.build.boosts };
  for (const [stat, raw] of Object.entries(changes) as [CombatStat, number][]) {
    const amount = (ability === "contrary" ? -raw : raw) * (ability === "simple" ? 2 : 1);
    const before = boosts[stat] ?? 0;
    boosts[stat] = Math.max(-6, Math.min(6, before + amount));
    if ((boosts[stat] ?? 0) < before) mon.statsLowered = true;
    if ((boosts[stat] ?? 0) > before) mon.statsRaised = true;
  }
  mon.build = { ...mon.build, boosts };
  void action; void ctx;
}

/**
 * A foe's drop on `slot` from `source` (sim/battle.ts boost with a foe source): Contrary, Simple, Clear Amulet
 * (onTryBoost, priority 1), Clear Body and its kin, Hyper Cutter, Big Pecks, Mirror Armor, then Defiant and
 * Competitive (+2) on a fall, and White Herb after the move (onAnyAfterMove). Mirror Armor (data/abilities.ts
 * mirrorarmor onTryBoost, breakable: `broken`) turns each drop not already at −6 back on a living source, as that
 * Pokémon's own drop from a foe, which no Mirror Armor turns back again (`reflected`: its effect is Mirror Armor).
 */
function foeDrop(ctx: Ctx, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, source: DoublesSlotId | null, broken = false, reflected = false) {
  const mon = w.mons[slot]!;
  const ability = mon.build.abilityId;
  if (mon.build.itemId === "clearamulet" && itemWorks(w, mon.build)) return;
  if (["clearbody", "whitesmoke", "fullmetalbody"].includes(ability)) return;
  if (ability === "mirrorarmor" && !broken && !reflected && source && source !== slot) {
    const kept: Partial<Record<CombatStat, number>> = {}, bounced: Partial<Record<CombatStat, number>> = {};
    for (const [stat, raw] of Object.entries(changes) as [CombatStat, number][]) {
      if (raw >= 0) kept[stat] = raw;
      else if ((mon.build.boosts[stat] ?? 0) > -6) bounced[stat] = raw;
    }
    if (Object.keys(bounced).length && alive(w, source)) foeDrop(ctx, w, source, bounced, slot, false, true);
    changes = kept;
  }
  const boosts = { ...mon.build.boosts };
  let fell = false;
  for (const [stat, raw] of Object.entries(changes) as [CombatStat, number][]) {
    if (raw < 0 && ((ability === "hypercutter" && stat === "atk") || (ability === "bigpecks" && stat === "def"))) continue;
    const amount = (ability === "contrary" ? -raw : raw) * (ability === "simple" ? 2 : 1);
    const before = boosts[stat] ?? 0;
    boosts[stat] = Math.max(-6, Math.min(6, before + amount));
    if ((boosts[stat] ?? 0) < before) fell = true;
    if ((boosts[stat] ?? 0) > before) mon.statsRaised = true;
  }
  mon.build = { ...mon.build, boosts };
  if (!fell) return;
  mon.statsLowered = true;
  if (ability === "defiant") selfBoost(ctx, w, slot, { atk: 2 }, null);
  if (ability === "competitive") selfBoost(ctx, w, slot, { spa: 2 }, null);
  if (mon.build.itemId === "whiteherb" && itemWorks(w, mon.build) && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0)) {
    mon.build = { ...mon.build, itemId: "", boosts: Object.fromEntries(STATS.map((stat) => [stat, Math.max(0, mon.build.boosts[stat] ?? 0)])) as BattleBuild["boosts"] };
  }
}

/** Bad poison only from a Serene Grace user's Poison Fang or Malignant Chain (stat-moves.ts SERENE_GRACE_MOVES). */
type GivenStatus = "psn" | "tox" | "brn" | "par";

/** Whether a status lands (sim/pokemon.ts setStatus: runStatusImmunity and the immunities the builds show). */
function statusLands(ctx: Ctx, w: World, slot: DoublesSlotId, status: GivenStatus, source: DoublesSlotId): boolean {
  const build = w.mons[slot]!.build;
  if (build.status) return false;
  const types = typesOf(ctx, build);
  const ability = build.abilityId;
  if (["comatose", "purifyingsalt"].includes(ability) || (ability === "shieldsdown" && build.speciesId === "miniormeteor")) return false;
  if (ability === "leafguard" && ["Sun", "Harsh Sunshine"].includes(w.field.weather) && !(build.itemId === "utilityumbrella" && itemWorks(w, build))) return false;
  if (w.field.terrain === "Misty" && grounded(ctx, w, slot)) return false;
  if (status === "brn") return !types.includes("Fire") && !["waterveil", "waterbubble", "thermalexchange"].includes(ability);
  // Electric types are immune to paralysis from generation 6 (data/typechart.ts par).
  if (status === "par") return !types.includes("Electric") && ability !== "limber";
  const corrosion = w.mons[source]!.build.abilityId === "corrosion";
  return (corrosion || (!types.includes("Poison") && !types.includes("Steel"))) && !["immunity", "pastelveil"].includes(ability);
}

/**
 * A status set on `slot` by `source` (sim/pokemon.ts trySetStatus): Synchronize passes it back to its source
 * (data/abilities.ts synchronize onAfterSetStatus), then a curing Berry eats it at the Update (data/items.ts lumberry
 * and its kin onUpdate) unless a foe's Unnerve or As One stops the Berry (onFoeTryEatItem).
 */
function giveStatus(ctx: Ctx, w: World, slot: DoublesSlotId, status: GivenStatus, source: DoublesSlotId) {
  if (!statusLands(ctx, w, slot, status, source)) return;
  const mon = w.mons[slot]!;
  mon.build = { ...mon.build, status };
  if (mon.build.abilityId === "synchronize" && source !== slot && alive(w, source)) giveStatus(ctx, w, source, status, slot);
  const item = mon.build.itemId;
  const cures = item === "lumberry" || ((status === "psn" || status === "tox") && item === "pechaberry") || (status === "brn" && item === "rawstberry") || (status === "par" && item === "cheriberry");
  const unnerved = DOUBLES_SLOTS.some((other) => alive(w, other) && other !== w.ghost && isFoe(other, slot) && UNNERVES.has(w.mons[other]!.build.abilityId));
  if (cures && itemWorks(w, mon.build) && !unnerved) {
    mon.build = { ...mon.build, itemId: "", status: "" };
    pouchHeal(ctx, w, slot);
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
// Status moves (SPEC §4.4 step 9)
// ------------------------------------------------------------------------------------------------------------------

/** A living Pokémon still has a damaging move queued (what a change to another Pokémon's types or damage taken can reach). */
function laterDamaging(ctx: Ctx, w: World): boolean {
  return w.remaining.some((entry) => alive(w, entry.slot) && !!entry.moveId
    && (ctx.runtime.movesById.get(entry.moveId)!.category !== "Status" || !!ctx.input.pokemon[entry.slot]!.contexts[entry.moveId]?.useZ));
}

/**
 * Protean and Libero (data/abilities.ts protean, libero onPrepareHit; data/mods/gen8/abilities.ts on every move): the
 * user takes its move's one type as the move is about to hit (after Try: sim/battle-actions.ts trySpreadMoveHit,
 * tryMoveHit), unless the move is a future move or calls another, the user is Terastallized (sim/pokemon.ts setType)
 * or already of that type alone. The calculations read the species' types, so a later damaging action is not
 * estimated. `type`: the move's type after ModifyType, read only for a holder.
 */
function proteanGuard(ctx: Ctx, w: World, slot: DoublesSlotId, moveId: string, type: () => string) {
  const build = w.mons[slot]!.build;
  if ((build.abilityId !== "protean" && build.abilityId !== "libero") || build.mechanic === "tera") return;
  if (FUTURE_MOVES.has(moveId) || CALLING_MOVES.has(moveId) || !laterDamaging(ctx, w)) return;
  const used = type();
  if (!used || used === "???" || typesOf(ctx, build).join() === used) return;
  notEstimated(REASONS.typeChange(abilityName(ctx, build.abilityId), ctx.names[slot]));
}

function statusMove(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  const name = ctx.names[slot];
  // A move aimed at the ally (Helping Hand, Aromatic Mist, Coaching, Dragon Cheer, Hold Hands) with the ally fainted or
  // its slot empty: sim/battle.ts getTarget keeps a fainted ally, sim/pokemon.ts getMoveTargets then has no target and
  // sim/battle-actions.ts useMoveInner fails it (-fail, [notarget]) before any PrepareHit (Protean).
  const partner = allyOf(slot);
  if (move.target === "adjacentAlly" && !alive(w, partner)) {
    stepFact(ctx, action, `${move.name} fails: ${w.mons[partner] ? ctx.names[partner] : "its ally"} has fainted.`, w.mass);
    return [w];
  }
  // A protecting move that fails stops in its own PrepareHit (data/moves.ts protect onPrepareHit), before Protean's:
  // it fails only with no action left, where nothing reads the type.
  proteanGuard(ctx, w, slot, move.id, () => move.type);
  const protect = PROTECT_MOVES[move.id];
  if (protect) {
    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.
    if (!w.remaining.length) { stepFact(ctx, action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }
    mon.protect = protect;
    // Stance Change (data/abilities.ts stancechange onModifyMove): King's Shield gives Aegislash its Shield Forme.
    if (move.id === "kingsshield") stanceChange(ctx, w, slot, false);
    return [w];
  }
  if (move.id === "wideguard" || move.id === "quickguard") {
    if (!w.remaining.length) { stepFact(ctx, action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }
    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };
    return [w];
  }
  if (move.id === "helpinghand") {
    const ally = partner;
    // onTryHit: the ally must still have a move queued (data/moves.ts:8584-8585 queue.willMove).
    if (!w.remaining.some((entry) => entry.slot === ally)) {
      stepFact(ctx, action, `Helping Hand fails: ${ctx.names[ally]} has already moved.`, w.mass);
      return [w];
    }
    w.mons[ally]!.helpingHand += 1;
    if (w.mons[ally]!.helpingHand > 1) notEstimated(REASONS.notIn2v2("Helping Hand"));
    stepFact(ctx, action, `Helping Hand: ${ctx.names[ally]}'s move has 1.5x power.`, w.mass);
    return [w];
  }
  if (move.id === "followme" || move.id === "ragepowder") {
    mon.centre = move.id;
    return [w];
  }
  // Destiny Bond (data/moves.ts destinybond): a foe's move that knocks its user out this turn is guarded (hitReactions).
  if (move.id === "destinybond") {
    mon.destinyBond = true;
    return [w];
  }
  if (fieldMove(ctx, w, action, move)) return [w];
  if (NO_EFFECT_MOVES.has(move.id) || MODELLED_STATUS_MOVES.has(move.id)) return [w];
  const later = w.remaining.some((entry) => alive(w, entry.slot));
  fieldGuard(ctx, w, slot, move);
  // With Neutralizing Gas on the field these can end it or change what it suppresses, whether or not an action follows.
  if (ctx.gas && GAS_CHANGING_MOVES.has(move.id)) notEstimated(REASONS.withGas(move.name));
  if (SWITCH_MOVES.has(move.id)) gasEnds(ctx, w, slot);
  if (SWITCH_MOVES.has(move.id) && later) notEstimated(REASONS.switchesOut(name));
  // Any other status move changes later moves in ways the turn does not follow (SPEC §2.2): harmless only when no
  // living Pokémon still has an action.
  if (later) notEstimated(REASONS.notModelledBefore(move.name));
  return [w];
}

/** The weather as the field's effectiveWeather reads it (sim/field.ts: none while a living Cloud Nine or Air Lock holder suppresses it). */
function effectiveWeather(w: World): BattleConditions["weather"] {
  return DOUBLES_SLOTS.some((slot) => alive(w, slot) && WEATHER_NEGATORS.has(w.mons[slot]!.build.abilityId)) ? "" : w.field.weather;
}

/**
 * Tailwind, the screens, Trick Room, Gravity and the weather and terrain moves (SPEC §4.4 step 9): each sets its side
 * or field state, which every later calculation and, from generation 8, the next sort read; or it fails where
 * Showdown's own check does. Whether `move` is one of them.
 */
function fieldMove(ctx: Ctx, w: World, action: PendingAction, move: ChampionsMove): boolean {
  const slot = action.slot;
  const side = slotSide(slot);
  const fail = (reason: string) => { stepFact(ctx, action, `${move.name} fails: ${reason}.`, w.mass); return true; };
  const done = (text: string) => { stepFact(ctx, action, text, w.mass); return true; };
  const flag = SIDE_MOVES[move.id];
  if (flag) {
    // sim/side.ts addSideCondition fails while the condition is up (none of the four has onSideRestart).
    if (w.sides[side][flag]) return fail(`it is already up on ${ctx.names[slot]}'s side`);
    // Aurora Veil's onTry: this.field.isWeather(['hail', 'snowscape']), through effectiveWeather.
    if (move.id === "auroraveil" && effectiveWeather(w) !== "Hail" && effectiveWeather(w) !== "Snow") return fail("there is no hail or snow");
    fieldGuard(ctx, w, slot, move);
    w.sides[side] = { ...w.sides[side], [flag]: true };
    return done(`${move.name} starts on ${ctx.names[slot]}'s side.`);
  }
  if (move.id === "trickroom") {
    fieldGuard(ctx, w, slot, move);
    // A Trick Room used while it is up ends it (data/moves.ts trickroom condition onFieldRestart).
    w.field = { ...w.field, trickRoom: !w.field.trickRoom };
    return done(w.field.trickRoom ? "Trick Room starts." : "Trick Room ends.");
  }
  if (move.id === "gravity") {
    // sim/field.ts addPseudoWeather fails while it is up (Gravity has no onFieldRestart).
    if (w.field.gravity) return fail("Gravity is already up");
    w.field = { ...w.field, gravity: true };
    return done("Gravity starts.");
  }
  const weather = WEATHER_MOVES[move.id];
  if (weather) {
    // sim/field.ts setWeather: the weather already up fails (generation 3 on); a living strong-weather holder stops
    // any other weather while its own is up (data/abilities.ts desolateland onAnySetWeather and its kin).
    if (w.field.weather === weather) return fail(`the weather is already ${weather}`);
    const keeper = STRONG_WEATHERS[w.field.weather];
    if (keeper && DOUBLES_SLOTS.some((other) => alive(w, other) && w.mons[other]!.build.abilityId === keeper)) return fail(`${w.field.weather} cannot be replaced`);
    fieldGuard(ctx, w, slot, move);
    w.field = { ...w.field, weather };
    return done(`The weather becomes ${weather}.`);
  }
  const terrain = TERRAIN_MOVES[move.id];
  if (terrain) {
    // sim/field.ts setTerrain: the terrain already up fails.
    if (w.field.terrain === terrain) return fail(`the terrain is already ${terrain} Terrain`);
    fieldGuard(ctx, w, slot, move);
    w.field = { ...w.field, terrain };
    return done(`The terrain becomes ${terrain} Terrain.`);
  }
  return false;
}

/**
 * A status move that changes the field changes what the battle settled from it (SPEC §2.2): a weather or a terrain
 * with a field-settled ability or item in (Protosynthesis, Quark Drive, Forecast, Mimicry, Flower Gift, Ice Face, a
 * Seed, Booster Energy), Tailwind with Wind Rider or Wind Power on its side, Trick Room with a Room Service holder.
 */
function fieldGuard(ctx: Ctx, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  const living = DOUBLES_SLOTS.filter((other) => alive(w, other));
  if (FIELD_MOVES.has(move.id)) {
    for (const other of living) {
      const build = w.mons[other]!.build;
      if (FIELD_SETTLED_ABILITIES.has(build.abilityId)) notEstimated(REASONS.fieldChange(abilityName(ctx, build.abilityId)));
      if (FIELD_SETTLED_ITEMS.has(build.itemId)) notEstimated(REASONS.fieldChange(itemName(ctx, build.itemId)));
    }
  }
  if (move.id === "tailwind") {
    for (const other of living) {
      const ability = w.mons[other]!.build.abilityId;
      if (slotSide(other) === slotSide(slot) && (ability === "windrider" || ability === "windpower")) notEstimated(REASONS.activates(move.name, abilityName(ctx, ability)));
    }
  }
  if (move.id === "trickroom") {
    for (const other of living) if (w.mons[other]!.build.itemId === "roomservice") notEstimated(REASONS.activates(move.name, itemName(ctx, "roomservice")));
  }
}

function stanceChange(ctx: Ctx, w: World, slot: DoublesSlotId, blade: boolean) {
  const mon = w.mons[slot]!;
  if (mon.build.abilityId !== "stancechange" || mon.build.transformedFrom || !mon.build.speciesId.startsWith("aegislash")) return;
  const form = blade ? "aegislashblade" : "aegislash";
  if (ctx.runtime.speciesById.has(form)) mon.build = { ...mon.build, speciesId: form };
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

type Redirection = { slot: DoublesSlotId; by: string };
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

/** Spread targets in Showdown's order (sim/pokemon.ts getMoveTargets): the adjacent ally first, then the foes by position. */
function spreadTargets(w: World, attacker: DoublesSlotId, targetType: string): DoublesSlotId[] {
  const foes = [...foesOf(attacker)].sort((a, b) => SHOWDOWN_POSITION[a].position - SHOWDOWN_POSITION[b].position).filter((slot) => alive(w, slot));
  const ally = allyOf(attacker);
  return [...(targetType === "allAdjacent" && alive(w, ally) ? [ally] : []), ...foes];
}

/** Whether `slot` is grounded (sim/pokemon.ts isGrounded): Gravity, Iron Ball, then not Flying, Levitate, Eelevate or Air Balloon. */
function grounded(ctx: Ctx, w: World, slot: DoublesSlotId): boolean {
  const build = w.mons[slot]!.build;
  if (w.field.gravity) return true;
  const item = itemWorks(w, build) ? build.itemId : "";
  if (item === "ironball") return true;
  if (typesOf(ctx, build).includes("Flying")) return false;
  if (build.abilityId === "levitate" || build.abilityId === "eelevate") return false;
  return item !== "airballoon";
}

/** A build's types (a Terastallized one's Tera Type but Stellar). */
function typesOf(ctx: Ctx, build: BattleBuild): readonly string[] {
  const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? [build.configuration.teraType] : null;
  return tera ?? ctx.runtime.speciesById.get(build.speciesId)?.types ?? [];
}

/** `darts`: Dragon Darts' smart targets, one dart each while both pass the hit steps (sim/pokemon.ts getSmartTargets). */
type Resolution = { world: World; targets: DoublesSlotId[]; spread: boolean; darts?: true; facts: string[] };

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
  let picks: { world: World; target: DoublesSlotId; facts: string[] }[];
  if (targetType === "randomNormal") {
    // sim/battle.ts getRandomTarget: one living foe at random.
    picks = living.map((target) => ({ world: living.length > 1 ? cloneWorld(w, w.mass / living.length) : w, target, facts: [] }));
  } else {
    const chosen = action.target!;
    if (alive(w, chosen)) picks = [{ world: w, target: chosen, facts: [] }];
    // A move aimed at a fainted ally keeps that target; one aimed at a fainted foe goes to the other foe, or with none
    // left to the foe across (sim/battle.ts:2464-2487 getTarget, getRandomTarget: foe.active[length - 1 - position]).
    // Redirection then runs on that target, and the move fails only when it is still a fainted one (sim/pokemon.ts:824-840).
    else if (!isFoe(attacker, chosen)) picks = [{ world: w, target: chosen, facts: [] }];
    else if (!living.length) {
      // An empty slot (no Pokémon) stands for the fainted foe there: redirection reads nothing more of the target.
      const fallen = w.mons[across(attacker)] ? across(attacker) : foesOf(attacker).find((slot) => w.mons[slot]);
      picks = fallen ? [{ world: w, target: fallen, facts: [] }] : [];
    }
    else picks = [{ world: w, target: living[0], facts: [`${ctx.names[chosen]} fainted: ${move.name} hits ${ctx.names[living[0]]}.`] }];
  }
  if (!picks.length) return [{ world: w, targets: [], spread: false, facts: [] }];
  const tracks = tracksTarget(w, attacker, move, info);
  const darts = move.id === "dragondarts" && !info.transformed;
  return picks.flatMap(({ world, target, facts }) => {
    const taken = tracks ? null : redirect(ctx, world, attacker, target, info, move.id, context);
    if (!taken && !alive(world, target)) return [{ world, targets: [], spread: false, facts: [] }];
    const routed = taken ? taken.slot : target;
    const routeFacts = taken && taken.slot !== target ? [...facts, takesFact(ctx, taken, move)] : facts;
    // getSmartTargets: Dragon Darts' target's partner too, unless that is the user or has fainted; a redirection
    // handler that applies turns smart targeting off (data/moves.ts followme, data/abilities.ts lightningrod).
    const second = allyOf(routed);
    if (!darts || taken || second === attacker || !alive(world, second)) return [{ world, targets: [routed], spread: false, facts: routeFacts }];
    return [{ world, targets: [routed, second], spread: false, darts: true as const, facts: routeFacts }];
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
type HitCheck = {
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
 * Figy family and the stat Berries at a quarter, Gluttony, Ripen, Cheek Pouch). One world per outcome.
 */
function afterLoss(ctx: Ctx, w: World, slot: DoublesSlotId, ...losses: (number | number[])[]): World[] {
  const mon = w.mons[slot]!;
  const item = mon.build.itemId;
  const usable = itemWorks(w, mon.build) && (HEALING_BERRIES.has(item) || !!PINCH_STAT_BERRIES[item]) && item !== "enigmaberry";
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
  return outcomes.map(({ world, tag }) => {
    const target = world.mons[slot]!;
    target.hurt = true;
    if (tag.startsWith("fainted")) faint(ctx, world, slot);
    if (tag.endsWith("ate")) ateBerry(ctx, world, slot, item);
    return world;
  });
}

/** What eating an HP or pinch Berry leaves (data/items.ts onEat): no item (Unburden), a pinch Berry's rise (Ripen), a Figy-family Berry's confusion. */
function ateBerry(ctx: Ctx, w: World, slot: DoublesSlotId, item: string) {
  const mon = w.mons[slot]!;
  const stat = PINCH_STAT_BERRIES[item];
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  if (stat) selfBoost(ctx, w, slot, { [stat]: mon.build.abilityId === "ripen" ? 2 : 1 }, null);
  berryConfusion(ctx, w, slot, item);
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

/** `slot` eats a Berry that is due at an Update (unnerveEnds): one world per outcome. */
function berryDue(ctx: Ctx, w: World, slot: DoublesSlotId): World[] {
  const mon = w.mons[slot]!;
  const item = mon.build.itemId, status = mon.build.status;
  if (!item || !itemWorks(w, mon.build)) return [w];
  // data/items.ts lumberry, cheriberry, chestoberry, pechaberry, rawstberry, aspearberry onUpdate.
  const cures = item === "lumberry" ? !!status : { cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"] }[item]?.includes(status) ?? false;
  if (cures) { mon.build = { ...mon.build, itemId: "", status: "" }; pouchHeal(ctx, w, slot); return [w]; }
  if (!(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item]) || item === "enigmaberry") return [w];
  const { maxHP, baseMaxHP } = ctx.hp[slot];
  const berry = berryArithmetic(item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, ctx.runtime.profile.generation);
  if (![...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= berry.line)) return [w];
  return mapHP(w, slot, (hp) => {
    if (hp <= 0 || hp > berry.line) return { hp, tag: "" };
    noteBerry(ctx, slot, item, berry, hp);
    return { hp: eatBerry(berry, hp), tag: "ate" };
  }).map(({ world, tag }) => {
    if (tag === "ate") ateBerry(ctx, world, slot, item);
    return world;
  });
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
      stepFact(ctx, action, `${move.name} fails: no target.`, world.mass);
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
    const failure = moveFailure(ctx, world, action, move, last, priority, info);
    if (failure) { stepFact(ctx, action, failure, world.mass); out.push(world); continue; }
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
  // Queenly Majesty, Dazzling and Armor Tail (data/abilities.ts onFoeTryMove): a foe's move used with priority above
  // 0.1 (move.priority, sim/battle.ts:2649) at the holder or its partner fails in TryMove, before it reaches anyone
  // (sim/battle-actions.ts useMoveInner). Breakable: the attacker's Mold Breaker and ignoreAbility moves pass them.
  if (priority > 0.1 && isFoe(action.slot, target) && info) {
    for (const holder of [target, allyOf(target)]) {
      if (!alive(w, holder)) continue;
      const ability = w.mons[holder]!.build.abilityId;
      if (!(PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(ability) || breaks(w, action.slot, holder, info)) continue;
      return `${move.name} fails: ${ctx.names[holder]} has ${abilityName(ctx, ability)}.`;
    }
  }
  if (priority > 0 && !isFoe(action.slot, target) && target !== action.slot) {
    const ability = w.mons[target]!.build.abilityId;
    // The engine blocks a priority move into a shield holder or a grounded Pokémon on Psychic Terrain from any side;
    // Showdown's onFoeTryMove and Psychic Terrain's onTryHit spare an ally's.
    if ((PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(ability)) notEstimated(REASONS.allyEffect(abilityName(ctx, ability)));
    if (w.field.terrain === "Psychic") notEstimated(REASONS.allyEffect("Psychic Terrain"));
  }
  return null;
}

/** One damaging hit X -> T through the pairwise engine, the target's (and a followed attacker's) state carried (SPEC §4.5). */
function singleStep(ctx: Ctx, w: World, action: PendingAction, info: Extract<TurnMove, { kind: "move" }>, check: HitCheck, attackerHP?: number): World[] {
  const attacker = action.slot, target = check.slot;
  const move = ctx.runtime.movesById.get(action.moveId!)!;
  const step = stepOf(ctx, action);
  if (check.block) return blockedHit(ctx, w, action, info, check);
  // Final Gambit's damage is its user's HP (data/moves.ts finalgambit damageCallback): one world per HP it has.
  if (move.id === "finalgambit" && !info.transformed && attackerHP === undefined) {
    return [...marginal(w, attacker).keys()].flatMap((hp) => condition(w, attacker, (value) => value === hp)
      .filter(({ meets }) => meets).flatMap(({ world }) => singleStep(ctx, world, action, info, check, hp)));
  }
  const conditions = conditionsFor(ctx, w, attacker, target, false, move.id);
  const context = contextFor(ctx, w, action, target, info);
  const entry = searchFor(ctx, w, attacker, target, move.id, conditions, context, false, attackerHP);
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
 * joint table over the joined slots. `spread`: the attacker's state is recorded for spreadStep, not applied.
 */
function applyStep(ctx: Ctx, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry, info: Extract<TurnMove, { kind: "move" }>, spread: boolean): { world: World; landed: number; knocked: boolean }[] {
  const attacker = action.slot;
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
    const result = entry.search!.turnStep(follow ? entries : [{ attackerHP: 0, target: mergeDists(entries) }], ctx.mode, follow);
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
  const out: { world: World; landed: number; knocked: boolean }[] = [];
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
      receiver.timesAttacked += outcome.landed;
      if (!receiver.damagedBy.includes(attacker)) receiver.damagedBy.push(attacker);
    }
    for (const [mon, was] of [[user, before.user], [receiver, before.receiver]] as const) {
      if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < (was.boosts[stat] ?? 0)) || (was.itemId === "whiteherb" && !mon.build.itemId)) mon.statsLowered = true;
      if (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (was.boosts[stat] ?? 0))) mon.statsRaised = true;
    }
    // Screens the move broke on the target's side (Brick Break, Psychic Fangs, Raging Bull, G-Max Wind Rage: the step's conditions).
    if (isFoe(attacker, target)) {
      const side = next.sides[slotSide(target)], left = outcome.conditions.defenderSide;
      if ((side.reflect && !left.reflect) || (side.lightScreen && !left.lightScreen) || (side.auroraVeil && !left.auroraVeil)) {
        next.sides[slotSide(target)] = { ...side, reflect: side.reflect && left.reflect, lightScreen: side.lightScreen && left.lightScreen, auroraVeil: side.auroraVeil && left.auroraVeil };
      }
    }
    if (step) {
      const stats = hitStats(step, target);
      stats.calculated += next.mass;
    }
    afterHit(ctx, next, action, target, outcome, info);
    out.push({ world: next, landed: outcome.landed, knocked: outcome.knocked });
  }
  return out;
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
  if (receiver.fainted && receiver.destinyBond && isFoe(attacker, target)) notEstimated(REASONS.notIn2v2(moveName(ctx, "destinybond")));
  if (receiver.fainted || attacker === target) return;
  const usable = !w.field.magicRoom && receiver.build.abilityId !== "klutz";
  // A gas holder switched out takes its Neutralizing Gas with it, whether or not an action follows.
  if (item === "ejectbutton" && usable) gasEnds(ctx, w, target);
  if (item === "redcard" && usable && alive(w, attacker)) gasEnds(ctx, w, attacker);
  if (!w.remaining.some((entry) => alive(w, entry.slot))) return;
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

/** The turn's reactions to one hit (SPEC §4.4 step 8): flinch from Fake Out and Upper Hand, the faint reactions not yet followed. */
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
  const own = !info.transformed && outcome.landed > 0;
  // U-turn, Volt Switch and Flip Turn switch the user out after a hit (selfSwitch): its replacement is not known. A gas
  // holder takes its Neutralizing Gas with it, whether or not an action follows.
  if (SWITCH_MOVES.has(id) && own && !user.fainted) gasEnds(ctx, w, attacker);
  if (SWITCH_MOVES.has(id) && own && !user.fainted && w.remaining.some((entry) => alive(w, entry.slot))) {
    notEstimated(REASONS.switchesOut(ctx.names[attacker]));
  }
  // Dragon Tail and Circle Throw drag the target out (forceSwitch: sim/battle-actions.ts:1353-1360, then
  // sim/battle.ts:2821-2829 between actions), unless it is Dynamaxed or a Suction Cups or Guard Dog holder
  // (onDragOut, breakable): later moves meet its replacement, which is not known.
  const dragged = DRAG_MOVES.has(id) && own && !receiver.fainted && !isMaxActive(receiver.build)
    && !(ANCHORING_ABILITIES.has(receiver.build.abilityId) && !breaks(w, attacker, target, info));
  if (dragged) gasEnds(ctx, w, target);
  if (dragged && w.remaining.some((entry) => alive(w, entry.slot))) notEstimated(REASONS.switchesOut(ctx.names[target]));
  // Burn Up and Double Shock take their type from the user as they hit (data/moves.ts burnup, doubleshock self.onHit
  // setType; a Terastallized user keeps its types, sim/pokemon.ts setType): later hits read its species' types.
  if (TYPE_LOSS_MOVES.has(id) && own && !user.fainted && user.build.mechanic !== "tera" && laterDamaging(ctx, w)) {
    notEstimated(REASONS.typeChange(moveName(ctx, id), ctx.names[attacker]));
  }
  // Glaive Rush (data/moves.ts glaiverush self volatile, onSourceModifyDamage 2x) until the user's next move.
  if (id === "glaiverush" && own && !user.fainted && laterDamaging(ctx, w)) notEstimated(REASONS.takesDouble(moveName(ctx, id), ctx.names[attacker]));
  if (outcome.landed > 0) flinchCheck(ctx, w, action, target, info);
  // Throat Chop's 100% secondary (data/moves.ts throatchop secondary onHit addVolatile): no sound move for its target.
  if (id === "throatchop" && own && !receiver.fainted && secondaryLands(ctx, w, attacker, target, info)) receiver.throatChopped = true;
  // Dynamic Punch's and Chatter's confusion (data/conditions.ts confusion: 33% to hit itself at its BeforeMove), on a
  // target with a move still to use: not estimated. Own Tempo (breakable) and Misty Terrain under a grounded target
  // stop it (onTryAddVolatile).
  if (CONFUSING_MOVES.has(id) && own && !receiver.fainted && secondaryLands(ctx, w, attacker, target, info)
    && w.remaining.some((entry) => entry.slot === target && entry.moveId !== null)
    && !(receiver.build.abilityId === "owntempo" && !breaks(w, attacker, target, info)) && !(w.field.terrain === "Misty" && grounded(ctx, w, target))) {
    notEstimated(REASONS.confusion);
  }
  volatileGuard(ctx, w, action, target, info);
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
 * A Figy-family Berry `slot` ate (data/items.ts figyberry and its kin onEat) confuses it when its Nature lowers that
 * Berry's stat, unless Own Tempo or Misty Terrain under it stops it (onTryAddVolatile); confused with a move still to
 * use, it hits itself 33% of the time (data/conditions.ts confusion onBeforeMove): not estimated.
 */
function berryConfusion(ctx: Ctx, w: World, slot: DoublesSlotId, item: string) {
  const stat = CONFUSING_BERRIES[item];
  if (!stat || !alive(w, slot) || !w.remaining.some((entry) => entry.slot === slot && entry.moveId !== null)) return;
  const build = w.mons[slot]!.build;
  if (NATURES.find((nature) => nature.name === build.nature)?.minus !== stat || build.abilityId === "owntempo") return;
  if (w.field.terrain === "Misty" && grounded(ctx, w, slot)) return;
  notEstimated(REASONS.confusion);
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
    if (check.block) return { check, entry: null as SearchEntry | null, face: null as FaceKind | null };
    const conditions = conditionsFor(ctx, w, attacker, check.slot, multiple, move.id);
    const entry = searchFor(ctx, w, attacker, check.slot, move.id, conditions, contextFor(ctx, w, action, check.slot, info), true, attackerHP);
    if (entry.row.kind !== "calculated") {
      const face = faceTaken(ctx, w, attacker, check.slot, entry.row, move);
      if (!face) notEstimated(rowReason(ctx, w, check.slot, entry.row, move));
      return { check, entry: null, face };
    }
    focusBandGuard(ctx, w, check.slot, entry.row);
    if (entry.search) unnerveGuard(ctx, w, attacker, check.slot);
    return { check, entry, face: null };
  });
  const standing = checks.map((check) => check.slot).filter((slot) => alive(w, slot));
  let worlds: World[] = [cloneWorld(w)];
  worlds[0].spread = [];
  let retaliation = prior, hit = false;
  for (const { check, entry, face } of plans) {
    const target = check.slot;
    if (check.block) { if (!check.done) worlds = worlds.flatMap((world) => blockedHit(ctx, world, action, info, check)); continue; }
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

type FaceKind = "disguise" | "iceface";
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
  const sheerForce = user.build.abilityId === "sheerforce";
  // Serene Grace makes the move's 50% and 70% added effects certain (stat-moves.ts SERENE_GRACE_MOVES).
  const sereneGrace = user.build.abilityId === "serenegrace";
  const cloak = receiver.build.itemId === "covertcloak" && itemWorks(world, receiver.build);
  const stages = info.transformed ? undefined : statMove(move.id, ctx.runtime.profile.id, sereneGrace)?.target;
  if (stages && !sheerForce && !cloak) foeDrop(ctx, world, target, stages, attacker, breaks(world, attacker, target, info));
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
  const foes = [...foesOf(attacker)].sort((a, b) => SHOWDOWN_POSITION[a].position - SHOWDOWN_POSITION[b].position).filter((slot) => alive(w, slot));
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
  const names = doublesNames(input.pokemon, runtime);
  const hp = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const build = settle.slots[slot]?.folded;
    const values = build ? turnHP(build, runtime) : { maxHP: 0, baseMaxHP: 0 };
    return [slot, { maxHP: values.maxHP, baseMaxHP: values.baseMaxHP }];
  })) as Ctx["hp"];
  const actions = DOUBLES_SLOTS.filter((slot) => input.pokemon[slot]).map((slot) => ({ slot, moveId: input.pokemon[slot]!.action.moveId, target: aimedAt(input, slot) }));
  return {
    input, runtime, gen7: runtime.profile.generation === 7, champions: runtime.profile.id === "champions", names, hp, actions, mode, memo, stats,
    heals: new Map(), faintsBefore: new Map(), otherFaints: new Set(), targetless: targetlessSlots(input), gas: settle.gas ?? null,
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
    const found = validateBuild(entry.build, runtime);
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
  }
  return Object.keys(issues.pokemon).length || issues.field.length || issues.actions.length ? { status: "issues", issues } : null;
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
  const results = moves.flatMap((id) => {
    const row = rows.get(id);
    if (!row) return [];
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
type StartRoute = { target: DoublesSlotId; fact?: string; oneTarget?: boolean; spread?: boolean; row?: MoveDamageResult; conditional?: true };

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
    const later = centred ? redirection(ctx, centred.world, slot, target, info, move.id, context) : null;
    const user = later && centred!.users.get(later.taken.slot);
    if (!later || !user || later.ties.length || later.taken.slot === routed || !mayComeAfter(ctx, w, slot, user)) continue;
    // Spotlight keeps Dragon Darts' smart targeting (data/moves.ts spotlight): no game has both.
    if (darts && later.taken.by === CENTRES.spotlight.by) continue;
    // TryMove into it once that move has been used (Sucker Punch into the Follow Me user, which has moved).
    const fails = startFailure(ctx, w, slot, move, info, later.taken.slot, user);
    routes.push({
      target: later.taken.slot, fact: `${later.taken.by}: ${ctx.names[later.taken.slot]} takes ${move.name} if ${later.taken.by} comes first.`,
      oneTarget: darts, conditional: true, ...(fails ? { row: emptyRow(move, fails) } : {}),
    });
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

function turnFacts(input: DoublesTurnInput, gas: DoublesGas | null | undefined): string[] {
  const facts = [input.field.critical
    ? "Every move hits and every damaging hit is critical; added effects below 100% do not happen."
    : "Every move hits; no critical hits; added effects below 100% do not happen.", "End-of-turn effects are not applied."];
  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart): the Pokémon whose abilities it suppresses.
  if (gas?.suppressed.length) {
    const names = doublesNames(input.pokemon, input.runtime);
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
  return facts;
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
    presenceGuards(all, startWorld(all, settle));
    const finished = walk(all, settle);
    const lowest = walk(createContext(input, settle, memo, "lowest", null), settle);
    const highest = walk(createContext(input, settle, memo, "highest", null), settle);
    const dists = distributions(finished), lows = distributions(lowest), highs = distributions(highest);
    const hp = Object.fromEntries(DOUBLES_SLOTS.map((slot): [DoublesSlotId, DoublesHP | null] => {
      const entry = start?.[slot];
      const dist = dists.get(slot);
      if (!entry || !dist) return [slot, null];
      let average = 0, min = Infinity, max = -Infinity, out = 0, total = 0;
      for (const [value, mass] of dist) { average += value * mass; total += mass; if (value < min) min = value; if (value > max) max = value; if (value <= 0) out += mass; }
      const heals = [...(all.heals.get(slot) ?? new Map<string, [number, number]>())].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`);
      const before = all.faintsBefore.get(slot) ?? 0;
      return [slot, {
        start: entry.hp, maximum: entry.maximum, ...(entry.settled ? { settled: entry.settled } : {}),
        low: modeOf(lows.get(slot), true), average: total ? average / total : entry.hp, high: modeOf(highs.get(slot), false),
        min, max, koChance: out >= 1 - 1e-12 && min <= 0 && max <= 0 ? 1 : uncertain(out, out > 0), heals,
        ...(input.pokemon[slot]!.action.moveId !== null && before > 0 ? { faintsBeforeMoving: Math.min(1, before) } : {}),
      }];
    })) as Record<DoublesSlotId, DoublesHP | null>;
    // A hit's KO chance is 1 when it is the only way its target faints on any branch and the target faints on every one
    // (its card's certain KO): the float sum of the branches can fall short of 1.
    const koHits = new Map<DoublesSlotId, number>();
    for (const step of stats) for (const [slot, each] of step.hits) if (each.ko > 0) bump(koHits, slot, 1);
    const certain = (slot: DoublesSlotId) => hp[slot]?.koChance === 1 && koHits.get(slot) === 1 && !all.otherFaints.has(slot);
    const steps = stats.filter((step) => step.moveId && !all.targetless.has(step.slot)).map((step): DoublesStep & { mean: number } => {
      const fact = (map: Map<string, number>): DoublesFact[] => [...map].map(([text, chance]) => ({ text, chance: Math.min(1, chance) }));
      const hits = [...step.hits].map(([slot, stats]): DoublesHit => {
        const met = [...stats.met.values()];
        const first = [...stats.firsts.values()].sort((a, b) => b.mass - a.mass)[0]?.row;
        const calculated = met.map(({ row }) => row).filter((row) => row.min !== null && row.max !== null);
        const min = calculated.length ? Math.min(...calculated.map((row) => row.min!)) : null;
        const max = calculated.length ? Math.max(...calculated.map((row) => row.max!)) : null;
        const maximum = start?.[slot]?.maximum ?? 1;
        const kind = stats.calculated > 0 ? "calculated" : stats.blocked > 0 ? "blocked" : "no-damage";
        return {
          slot, reached: Math.min(1, stats.reached), kind, min: kind === "calculated" ? min : null, max: kind === "calculated" ? max : null,
          minPercent: kind === "calculated" && min !== null ? min / maximum * 100 : null, maxPercent: kind === "calculated" && max !== null ? max / maximum * 100 : null,
          koChance: stats.ko > 0 && certain(slot) ? 1 : uncertain(stats.ko, stats.ko > 0), ...(kind === "calculated" && first ? { row: first } : {}), cases: met.length, facts: fact(stats.facts),
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
    return { status: "ready", start: start!, steps, hp, startRows: rows, facts };
  } catch (error) {
    if (error instanceof NotEstimated) return notEstimatedResult(error.reason);
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
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
 * back the ability it replaced (DoublesGas.abilities), which the gas still suppresses.
 */
function outcomeOf(world: World, gas: DoublesGas | null | undefined): DoublesOutcome {
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
    mons[slot] = entry;
  }
  const side = (state: SideState) => ({ reflect: state.reflect, lightScreen: state.lightScreen, auroraVeil: state.auroraVeil, tailwind: state.tailwind, faintedThisTurn: state.faintedThisTurn });
  return {
    chance: world.mass, mons, sides: { own: side(world.sides.own), opponent: side(world.sides.opponent) }, field: { ...world.field },
    allFainted: { own: sideFaintedChance(world, "own"), opponent: sideFaintedChance(world, "opponent") },
  };
}

/**
 * Outcomes whose builds, protect and moved flags, sides and field are equal, merged: the chances add, and the HP
 * distributions and allFainted become their chance-weighted mixtures (exact for the marginals and for allFainted).
 */
function mergeOutcomes(outcomes: DoublesOutcome[]): DoublesOutcome[] {
  const byKey = new Map<string, { outcome: DoublesOutcome; hp: Map<DoublesSlotId, Map<number, number>>; fainted: Record<DoublesSideId, number> }>();
  for (const outcome of outcomes) {
    const key = JSON.stringify([
      DOUBLES_SLOTS.map((slot) => { const mon = outcome.mons[slot]; return mon ? [mon.build, mon.protected, mon.moved] : null; }), outcome.sides, outcome.field,
    ]);
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, entry = { outcome: { ...outcome, chance: 0 }, hp: new Map(), fainted: { own: 0, opponent: 0 } });
    entry.outcome.chance += outcome.chance;
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      if (!mon) continue;
      let dist = entry.hp.get(slot);
      if (!dist) entry.hp.set(slot, dist = new Map());
      for (const { hp, chance } of mon.hp) dist.set(hp, (dist.get(hp) ?? 0) + chance * outcome.chance);
    }
    entry.fainted.own += outcome.allFainted.own * outcome.chance;
    entry.fainted.opponent += outcome.allFainted.opponent * outcome.chance;
  }
  return [...byKey.values()].map(({ outcome, hp, fainted }) => {
    const share = (mass: number) => outcome.chance > 0 ? mass / outcome.chance : 0;
    const mons: DoublesOutcome["mons"] = {};
    for (const slot of DOUBLES_SLOTS) {
      const mon = outcome.mons[slot];
      const dist = hp.get(slot);
      if (!mon || !dist) continue;
      mons[slot] = { ...mon, hp: [...dist].sort((a, b) => a[0] - b[0]).map(([value, mass]) => ({ hp: value, chance: share(mass) })) };
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
    presenceGuards(all, startWorld(all, settle));
    const finished = walk(all, settle);
    let total = 0;
    for (const world of finished) total += world.mass;
    const outcomes = mergeOutcomes(finished.map((world) => outcomeOf(world, settle.gas))).map((outcome) => ({ ...outcome, chance: total > 0 ? outcome.chance / total : 0 }));
    return { status: "ready", start, outcomes };
  } catch (error) {
    if (error instanceof NotEstimated) return { status: "not-estimated", reason: error.reason };
    throw error;
  } finally {
    USES_REFERENCE.on = usesReference;
  }
}
