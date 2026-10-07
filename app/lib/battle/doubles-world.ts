import type { DoublesSideId, DoublesSlotId } from "./doubles-types";
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
};

export type SideState = { reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; wideGuard: boolean; quickGuard: boolean; faintedThisTurn: number };
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
};

const digit = (key: number, index: number) => Math.floor(key / RADIX ** index) % RADIX;

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

export function cloneMon(mon: MonState): MonState {
  return { ...mon, damagedBy: [...mon.damagedBy] };
}

/** A copy of the world whose discrete parts can be changed (factors shared until replaced). */
export function cloneWorld(world: World, mass = world.mass): World {
  const mons: World["mons"] = {};
  for (const [slot, mon] of Object.entries(world.mons) as [DoublesSlotId, MonState][]) mons[slot] = cloneMon(mon);
  return {
    mass, mons, sides: { own: { ...world.sides.own }, opponent: { ...world.sides.opponent } }, field: { ...world.field },
    remaining: [...world.remaining], executed: world.executed, factors: [...world.factors], ...(world.spread ? { spread: [...world.spread] } : {}),
    ...(world.ghost ? { ghost: world.ghost } : {}),
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

/** The discrete key two worlds must share to merge: everything but the mass and the factor tables (their partition included). */
export function discreteKey(world: World): string {
  const partition = world.factors.map((factor) => factor.slots.join(",")).sort();
  return JSON.stringify([world.mons, world.sides, world.field, world.remaining, world.executed, world.spread ?? null, partition]);
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
