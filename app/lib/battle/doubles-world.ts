import { allyOf, slotSide, type DoublesSideId, type DoublesSlotId } from "./doubles-types";
import type { BattleBuild, BattleConditions } from "./types";

// The doubles turn's worlds (SPEC §4.3): one discrete state of the turn with its mass, and the Pokémon's HP as factors (a
// partition of the present slots into independent joint tables). Exactness never rests on a factor being split; a
// split is kept only when every joint entry equals the product of its marginals.

/** HP keys: each slot of a factor is one digit in radix 4096 (engine HP, Dynamax HP included, is below 4096). */
export const RADIX = 4096;
/** Relative tolerance for a factor's split (SPEC §4.3). */
const SPLIT_TOLERANCE = 1e-12;

export type Factor = { slots: DoublesSlotId[]; table: Map<number, number> };

export type ProtectKind = "protect" | "kingsshield" | "spikyshield" | "banefulbunker" | "obstruct" | "silktrap" | "burningbulwark";

/**
 * Moves-phase volatiles (status-eot SPEC §3.4; ADDENDUM §3.4). Track A (doubles-status.ts) writes them, Track E the
 * Substitute's hits and the Ally Switch counter; the end of turn reads only sleep (Bad Dreams reads build.status).
 * Values are immutable: replace a field, never mutate one in place (cloneMon copies the object shallowly).
 */
export type MoveVolatiles = {
  /** With build.status "slp": the counter's total decrease (attempts × 1, Early Bird × 2), and whether Rest put it to sleep. */
  sleep?: { elapsed: number; rest: boolean };
  /** Champions, with build.status "frz": BeforeMoves spent frozen. */
  freeze?: { attempts: number };
  /** Confused: BeforeMoves spent confused, and the least duration (T uniform on min..5; Axe Kick's 3); fresh: attempts 0. */
  confusion?: { attempts: number; min: 2 | 3 };
  taunt?: true;
  /** The move Disable stops (set only when it can still act). */
  disabled?: string;
  /** The move Encore holds it to (E2 "encore"; it changes no action this turn). */
  encore?: string;
  imprisoning?: true;
  /** Its Substitute's HP left: from carried.substitute or this turn's Substitute; hits lower it (Track E); deleted at 0. */
  substitute?: number;
  endure?: true;
  /** Its move this turn passed BeforeMove (lastMove for later reads). */
  usedMove?: string;
  /** Scarlet/Violet, Champions: the Ally Switch counter (carried, or 3 after a first use this turn). */
  allySwitch?: number;
  /**
   * Berserk or Anger Shell after a confusion self-hit (data/abilities.ts berserk, angershell onDamage: checkedBerserk false
   * for an effect of type Move): the TryEatItem of its healing Berry fails (Sitrus, Oran, the Figy family; not Berry Juice,
   * which is used, not eaten) until damage from something other than a move resets it (doubles-turn.ts afterLoss).
   */
  berryLocked?: true;
  /**
   * Its accuracy and evasion stages from this turn (sim/pokemon.ts boosts.accuracy, boosts.evasion; no input carries them,
   * so they start at 0): written by doubles-status.ts applyBoosts, cleared by Haze and White Herb. The calculations do not
   * read them: Stored Power, Power Trip and Punishment are not estimated while one is positive (doubles-turn.ts applyStep).
   */
  stages?: { accuracy?: number; evasion?: number };
};

/**
 * End-of-turn state (one writer per field: A = status engine, B = end-of-turn engine, as marked; C16's Rapid Spin and
 * Mortal Spin and a Substitute starting may also end leechSeed and trap). Values are immutable, as MoveVolatiles'.
 */
export type EotState = {
  /** A (setStatus "tox": 0) / carried. */
  toxic?: number;
  /** A / carried: the position of the seeder (Leech Seed's sourceSlot). */
  leechSeed?: DoublesSlotId;
  /** B (trapping damaging moves) / carried: the trapper (a Pokémon), the divisor (Binding Band 6) and the move that set it (the residual's name). */
  trap?: { source: DoublesSlotId; divisor: 6 | 8; move?: string };
  /** B / carried. */
  saltCure?: true;
  /** A / carried. */
  aquaRing?: true; ingrain?: true; curse?: true;
  /** B / carried: the Pokémon whose Syrup Bomb it is. */
  syrupBomb?: DoublesSlotId;
  /** A (2: this turn's) / carried (1: falls asleep at this end of turn). */
  yawn?: 1 | 2;
  /** A (4: this turn's Perish Song) / carried (1–3). */
  perish?: number;
  /** Carried: a Wish landing on this slot (a position) at this end of turn, its HP. */
  wish?: number;
  /** A. */
  roosted?: true; magnetRise?: true;
  /** B. */
  smackedDown?: true;
  /** B (Psychic Noise). */
  healBlock?: true;
  /** B (charge turn: Dig/Dive vs Fly/Bounce/Phantom Force/Shadow Force). */
  hidden?: "sheltered" | "semi";
  /** Carried. */
  futureMove?: string; cudChew?: true;
};

/** Everything about one Pokémon in a world but its HP (which is in the factors). */
export type MonState = {
  /** The settled build, updated along the turn (items, stages, ability, form, status, mechanic); currentHP is unused. */
  build: BattleBuild;
  fainted: boolean;
  /** Its action has been picked (sim/battle-queue.ts willMove no longer finds it). */
  moved: boolean;
  /** The move that made it flinch (Fake Out, Upper Hand), or null. */
  flinched: string | null;
  /** Focus Punch's lostFocus (data/moves.ts focuspunch condition onHit). */
  focusLost: boolean;
  /** It used Charge before (its next Electric attack doubles), until an Electric move uses it up. */
  charged: boolean;
  protect: ProtectKind | null;
  /** It is the centre of attention (doubles-turn.ts redirection): its Follow Me or Rage Powder; Spotlight in the start rows only. */
  centre: "followme" | "ragepowder" | "spotlight" | null;
  /** Helping Hand received this turn. */
  helpingHand: number;
  /** It took damage this turn (sim/battle.ts spreadDamage hurtThisTurn). */
  hurt: boolean;
  /** The Pokémon whose moves dealt it damage this turn (sim/pokemon.ts attackedBy). */
  damagedBy: DoublesSlotId[];
  /** Hits taken this turn (sim/battle-actions.ts timesAttacked). */
  timesAttacked: number;
  /** A stat stage of its fell this turn (sim/battle.ts boost statsLoweredThisTurn). */
  statsLowered: boolean;
  /** A stat stage of its rose this turn (sim/battle.ts boost statsRaisedThisTurn). */
  statsRaised: boolean;
  /** It used Destiny Bond this turn (data/moves.ts destinybond volatile). */
  destinyBond?: true;
  /** Its own move's step followed its HP (recoil, Life Orb, retaliation, draining): whether it lost HP is in the factors. */
  ownHP?: true;
  /** Throat Chop hit it this turn (data/moves.ts throatchop condition): no sound move. */
  throatChopped?: true;
  /** Moves-phase volatiles (Track A, Track E). */
  vol: MoveVolatiles;
  /** End-of-turn state (Track A, Track B). */
  eot: EotState;
};

export type SideState = {
  reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; wideGuard: boolean; quickGuard: boolean; faintedThisTurn: number;
  /** Safeguard up on the side (Track A). */
  safeguard: boolean;
  /** Hazard move ids that landed on the side this turn, in order (Track A; Magic Bounce sends them back). Replace the array, never push into it. */
  hazards: string[];
};
export type FieldState = Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom">;

/** One queued action (sim/battle-queue.ts): a move, or "No move" (a Splash-like pass), with its fractional priority fixed at queue time. */
export type PendingAction = {
  /** Index into the turn's actions. */
  index: number;
  slot: DoublesSlotId;
  moveId: string | null;
  target: DoublesSlotId | null;
  fractional: number;
  /** Generation 7: the priority (fractional included) and Speed sorted at the turn's start, frozen for the turn. */
  frozen?: { priority: number; speed: number };
  /**
   * The queue's order key (sim/battle-queue.ts:277-287 comparePriority, order ascending first): absent = 200, a move;
   * After You 3 (the action next, data/moves.ts:195-216), Quash 201 (last, data/moves.ts:14455-14472; gen 7's
   * data/mods/gen7/moves.ts:750-766 inserts it before the residual, also last).
   */
  order?: number;
};

export type World = {
  mass: number;
  mons: Partial<Record<DoublesSlotId, MonState>>;
  sides: Record<DoublesSideId, SideState>;
  field: FieldState;
  remaining: PendingAction[];
  /** Move actions picked so far (positions among the slots with a move). */
  executed: number;
  factors: Factor[];
  /** While a spread move runs (doubles-turn.ts): the attacker's state each target's step left, compared afterwards. */
  spread?: string[];
  /**
   * While Explosion and its kin hit (doubles-turn.ts spreadStep): their user, at 0 HP with its faint queued, whose
   * Ally, Foe and Any handlers no longer run (sim/pokemon.ts allies() needs HP; sim/battle.ts findEventHandlers).
   */
  ghost?: DoublesSlotId;
  /** Pokémon that left during the moves with no later action (S moves, U-turn, Eject Button...): the end of turn is not estimated (Track B: doubles-eot.ts leaving). */
  leaving?: DoublesSlotId[];
  /** An end-of-turn-level guard set during the moves (an L move as the last action...): the end of turn is not estimated with this reason. */
  endGuard?: string;
  /** Ally Switch: this side's two Pokémon stand swapped (PS/sim/battle.ts:1588-1607). */
  swapped?: Partial<Record<DoublesSideId, true>>;
  /** During one action: the Pokémon whose item Trick or Switcheroo moved (eventGuards: no Symbiosis, T11). Cleared after the action. */
  itemsMoved?: DoublesSlotId[];
  /**
   * During one action (its BeforeMove included): the Pokémon a boost() reached with a rise or a drop in the table its
   * AfterBoost reads (sim/battle.ts boost: after ChangeBoost, the cap and TryBoost; accuracy and evasion included), as
   * doubles-status.ts applyBoosts records it: Opportunist and Mirror Herb read a rise (onFoeAfterBoost), Eject Pack a
   * drop (onAfterBoost), whatever the stage ends at. A clearBoosts (Haze) is none. `reset`: a damaging move's clearBoosts
   * (Clear Smog) set the Pokémon's stages to 0, so the step's stage difference is no drop there. eventGuards reads and clears it.
   */
  boosted?: Partial<Record<DoublesSlotId, { rose?: true; fell?: true; reset?: true }>>;
  /** During one damaging action: the Pokémon its move hit (sim/battle-actions.ts move.hitTargets), in hit order (Sparkling Aria). */
  hitTargets?: DoublesSlotId[];
  /**
   * An action of the moves changed the weather (doubles-turn.ts walk): the weather up now was set this turn (or none is
   * up), so it has its new duration (sim/field.ts setWeather) and is not the one from before the turn whose turns left
   * the input gives (doubles-eot.ts weatherHandler).
   */
  weatherSet?: true;
};

/** Where the Pokémon that started the turn in `slot` stands now. */
export function positionOf(w: World, slot: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(slot)] ? allyOf(slot) : slot;
}
/** The Pokémon (its starting slot) standing at `position` now. In doubles the swap is its own inverse, so this is positionOf's map. */
export function occupant(w: World, position: DoublesSlotId): DoublesSlotId {
  return w.swapped?.[slotSide(position)] ? allyOf(position) : position;
}
/** A partial trap ends on `slot` (its Substitute starting: PS/data/moves.ts:18336-18339; its Rapid Spin, Mortal Spin: C16). */
export function endTrap(w: World, slot: DoublesSlotId): void {
  const mon = w.mons[slot];
  if (mon?.eot.trap) mon.eot = { ...mon.eot, trap: undefined };
}

const digit =(key: number, index: number) => Math.floor(key / RADIX ** index) % RADIX;

/** A slot's factor index and its digit in that factor. */
export function locate(world: World, slot: DoublesSlotId): { factor: number; index: number } {
  for (let factor = 0; factor < world.factors.length; factor++) {
    const index = world.factors[factor].slots.indexOf(slot);
    if (index >= 0) return { factor, index };
  }
  throw new Error(`No HP factor holds ${slot}.`);
}

/** The HP digit of `slot` in a key of `factor`. */
export function hpIn(factor: Factor, key: number, slot: DoublesSlotId): number {
  return digit(key, factor.slots.indexOf(slot));
}

/** The key with `slot`'s digit set to `hp`. */
export function withHP(factor: Factor, key: number, slot: DoublesSlotId, hp: number): number {
  const index = factor.slots.indexOf(slot);
  return key + (hp - digit(key, index)) * RADIX ** index;
}

export function pointFactor(slot: DoublesSlotId, hp: number): Factor {
  return { slots: [slot], table: new Map([[hp, 1]]) };
}

/** The product of two independent factors. */
export function product(a: Factor, b: Factor): Factor {
  const shift = RADIX ** a.slots.length;
  const table = new Map<number, number>();
  for (const [keyA, massA] of a.table) for (const [keyB, massB] of b.table) table.set(keyA + keyB * shift, massA * massB);
  return { slots: [...a.slots, ...b.slots], table };
}

/** A slot's marginal: HP -> mass. */
export function marginal(world: World, slot: DoublesSlotId): Map<number, number> {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const out = new Map<number, number>();
  for (const [key, mass] of f.table) {
    const hp = hpIn(f, key, slot);
    out.set(hp, (out.get(hp) ?? 0) + mass);
  }
  return out;
}

/** Merge the factors holding `slots` into one (their product), returning its index. */
export function join(world: World, slots: DoublesSlotId[]): number {
  const indexes = [...new Set(slots.map((slot) => locate(world, slot).factor))].sort((a, b) => a - b);
  if (indexes.length === 1) return indexes[0];
  let joined = world.factors[indexes[0]];
  for (const index of indexes.slice(1)) joined = product(joined, world.factors[index]);
  world.factors = [...world.factors.filter((_, index) => !indexes.includes(index)), joined];
  return world.factors.length - 1;
}

/** A factor's canonical text, to compare tables. */
export function factorKey(factor: Factor): string {
  const keys = [...factor.table.keys()].sort((a, b) => a - b);
  return `${factor.slots.join(",")}:${keys.map((key) => `${key}=${factor.table.get(key)}`).join(";")}`;
}

function normalise(table: Map<number, number>): number {
  let total = 0;
  for (const mass of table.values()) total += mass;
  if (total > 0 && total !== 1) for (const [key, mass] of table) table.set(key, mass / total);
  return total;
}

/**
 * The factor as independent parts where that is exact: each slot is split off when every joint entry equals the product
 * of its marginal and the rest's within SPLIT_TOLERANCE, over the full product support (SPEC §4.3).
 */
export function splitFactor(factor: Factor, reference = false): Factor[] {
  if (factor.slots.length === 1 || reference) return [factor];
  for (const slot of factor.slots) {
    const at = factor.slots.indexOf(slot);
    const rest = factor.slots.filter((other) => other !== slot);
    const own = new Map<number, number>(), others = new Map<number, number>();
    for (const [key, mass] of factor.table) {
      const hp = digit(key, at);
      const restKey = key - hp * RADIX ** at;
      own.set(hp, (own.get(hp) ?? 0) + mass);
      others.set(restKey, (others.get(restKey) ?? 0) + mass);
    }
    if (own.size * others.size !== factor.table.size) continue;
    let independent = true;
    for (const [key, mass] of factor.table) {
      const hp = digit(key, at);
      const expected = own.get(hp)! * others.get(key - hp * RADIX ** at)!;
      if (Math.abs(mass - expected) > SPLIT_TOLERANCE * Math.max(mass, expected)) { independent = false; break; }
    }
    if (!independent) continue;
    // Re-key the rest without the split slot's digit.
    const restTable = new Map<number, number>();
    for (const [restKey, mass] of others) {
      let key = 0;
      for (let index = 0, digitAt = 0; index < factor.slots.length; index++) {
        if (index === at) continue;
        key += digit(restKey, index) * RADIX ** digitAt++;
      }
      restTable.set(key, mass);
    }
    return [{ slots: [slot], table: own }, ...splitFactor({ slots: rest, table: restTable })];
  }
  return [factor];
}

/** A copy of the Pokémon's state whose parts can be changed (vol and eot copied shallowly: their values are immutable). */
export function cloneMon(mon: MonState): MonState {
  return { ...mon, damagedBy: [...mon.damagedBy], vol: { ...mon.vol }, eot: { ...mon.eot } };
}

/** A copy of the world whose discrete parts can be changed (factors shared until replaced). */
export function cloneWorld(world: World, mass = world.mass): World {
  const mons: World["mons"] = {};
  for (const [slot, mon] of Object.entries(world.mons) as [DoublesSlotId, MonState][]) mons[slot] = cloneMon(mon);
  return {
    mass, mons, sides: { own: { ...world.sides.own }, opponent: { ...world.sides.opponent } }, field: { ...world.field },
    remaining: [...world.remaining], executed: world.executed, factors: [...world.factors], ...(world.spread ? { spread: [...world.spread] } : {}),
    ...(world.ghost ? { ghost: world.ghost } : {}),
    ...(world.leaving ? { leaving: [...world.leaving] } : {}), ...(world.endGuard !== undefined ? { endGuard: world.endGuard } : {}),
    ...(world.swapped ? { swapped: { ...world.swapped } } : {}), ...(world.itemsMoved ? { itemsMoved: [...world.itemsMoved] } : {}),
    ...(world.boosted ? { boosted: { ...world.boosted } } : {}), ...(world.hitTargets ? { hitTargets: [...world.hitTargets] } : {}),
    ...(world.weatherSet ? { weatherSet: true as const } : {}),
  };
}

/**
 * The world restricted to the entries where `slot`'s HP meets `test`, and the rest: up to two worlds, each table
 * renormalised and the mass scaled (SPEC §4.3 conditioning). The tag says which side each is.
 */
export function condition(world: World, slot: DoublesSlotId, test: (hp: number) => boolean): { world: World; meets: boolean }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const parts = [new Map<number, number>(), new Map<number, number>()];
  for (const [key, mass] of f.table) parts[test(hpIn(f, key, slot)) ? 0 : 1].set(key, mass);
  const out: { world: World; meets: boolean }[] = [];
  for (const [index, table] of parts.entries()) {
    if (!table.size) continue;
    const share = normalise(table);
    if (share <= 0 && parts[1 - index].size) continue;
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    out.push({ world: next, meets: index === 0 });
  }
  return out;
}

/**
 * The world after `slot`'s HP goes through `map` (a deterministic change: a heal, a fixed loss), split by the tag the
 * map gives each HP (a Berry eaten or not, fainted or not): one world per tag, each table renormalised.
 */
export function mapHP(world: World, slot: DoublesSlotId, map: (hp: number) => { hp: number; tag: string }): { world: World; tag: string }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const { hp, tag } = map(hpIn(f, key, slot));
    let table = byTag.get(tag);
    if (!table) byTag.set(tag, table = new Map());
    const next = withHP(f, key, slot, hp);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    next.factors.splice(factor, 1, ...splitFactor(next.factors[factor]));
    out.push({ world: next, tag });
  }
  return out;
}

/**
 * The world after `slot` loses an amount drawn from `dist` (loss → mass, summing to 1), convolved into its factor: `apply`
 * maps an HP and a loss to the HP after and a tag (afterLoss-style: "fainted" or "in", a Berry eaten or not), one world
 * per tag, each table renormalised and re-split exactly (a confusion self-hit's rolls: Track A).
 */
export function lossDist(world: World, slot: DoublesSlotId, dist: ReadonlyMap<number, number>, apply: (hp: number, loss: number) => { hp: number; tag: string }): { world: World; tag: string }[] {
  const { factor } = locate(world, slot);
  const f = world.factors[factor];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const hp = hpIn(f, key, slot);
    for (const [loss, share] of dist) {
      const { hp: after, tag } = apply(hp, loss);
      let table = byTag.get(tag);
      if (!table) byTag.set(tag, table = new Map());
      const next = withHP(f, key, slot, after);
      table.set(next, (table.get(next) ?? 0) + mass * share);
    }
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    if (share <= 0) continue;
    const next = cloneWorld(world, world.mass * share);
    next.factors[factor] = { slots: f.slots, table };
    next.factors.splice(factor, 1, ...splitFactor(next.factors[factor]));
    out.push({ world: next, tag });
  }
  return out;
}

/**
 * The world after the HPs of `a` and `b` go through `map` together (Pain Split, Leech Seed: Track B), from their joined
 * factors: each joint entry rewritten, one world per tag, each table renormalised and re-split exactly.
 */
export function mapJoint(world: World, [a, b]: readonly [DoublesSlotId, DoublesSlotId], map: (hpA: number, hpB: number) => { hp: readonly [number, number]; tag: string }): { world: World; tag: string }[] {
  const base = cloneWorld(world);
  const at = join(base, [a, b]);
  const f = base.factors[at];
  const byTag = new Map<string, Map<number, number>>();
  for (const [key, mass] of f.table) {
    const { hp: [toA, toB], tag } = map(hpIn(f, key, a), hpIn(f, key, b));
    let table = byTag.get(tag);
    if (!table) byTag.set(tag, table = new Map());
    const next = withHP(f, withHP(f, key, a, toA), b, toB);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  const out: { world: World; tag: string }[] = [];
  for (const [tag, table] of byTag) {
    const share = normalise(table);
    if (share <= 0) continue;
    const next = cloneWorld(base, world.mass * share);
    next.factors[at] = { slots: f.slots, table };
    next.factors.splice(at, 1, ...splitFactor(next.factors[at]));
    out.push({ world: next, tag });
  }
  return out;
}

/** The discrete key two worlds must share to merge: everything but the mass and the factor tables (their partition included). */
export function discreteKey(world: World): string {
  const partition = world.factors.map((factor) => factor.slots.join(",")).sort();
  return JSON.stringify([world.mons, world.sides, world.field, world.remaining, world.executed, world.spread ?? null, partition,
    world.swapped ?? null, world.endGuard ?? null, world.leaving ?? null, world.weatherSet ?? null]);
}

/**
 * Worlds with equal discrete keys merged (SPEC §4.3): every table equal, the masses add; exactly one table different
 * (with `mixtures`), that factor becomes their mixture, which is exact since m1(f⊗g1) + m2(f⊗g2) = f⊗(m1 g1 + m2 g2).
 */
export function mergeWorlds(worlds: World[], mixtures: boolean): World[] {
  const byKey = new Map<string, { world: World; keys: Map<string, string> }[]>();
  const out: World[] = [];
  for (const world of worlds) {
    if (world.mass <= 0) continue;
    const key = discreteKey(world);
    const keys = new Map(world.factors.map((factor) => [factor.slots.join(","), factorKey(factor)]));
    const group = byKey.get(key);
    if (!group) { byKey.set(key, [{ world, keys }]); out.push(world); continue; }
    let merged = false;
    for (const entry of group) {
      const different = [...keys].filter(([slots, text]) => entry.keys.get(slots) !== text).map(([slots]) => slots);
      if (!different.length) { entry.world.mass += world.mass; merged = true; break; }
      if (mixtures && different.length === 1) {
        const slots = different[0];
        const at = entry.world.factors.findIndex((factor) => factor.slots.join(",") === slots);
        const other = world.factors.find((factor) => factor.slots.join(",") === slots)!;
        const total = entry.world.mass + world.mass;
        const table = new Map<number, number>();
        for (const [k, m] of entry.world.factors[at].table) table.set(k, m * entry.world.mass / total);
        for (const [k, m] of other.table) table.set(k, (table.get(k) ?? 0) + m * world.mass / total);
        entry.world.factors = [...entry.world.factors];
        entry.world.factors[at] = { slots: other.slots, table };
        entry.world.mass = total;
        entry.keys.set(slots, factorKey(entry.world.factors[at]));
        merged = true;
        break;
      }
    }
    if (!merged) { group.push({ world, keys }); out.push(world); }
  }
  return out;
}

/** The number of factor entries across worlds (budget). */
export function entryCount(worlds: World[]): number {
  let count = 0;
  for (const world of worlds) for (const factor of world.factors) count += factor.table.size;
  return count;
}
