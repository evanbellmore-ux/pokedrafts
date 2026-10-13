import { berryHeals, eatBerry, type Berry } from "./hit-loop";
import type { BattleRuntime } from "./runtime";
import type { AfterUse, BattleStatus, ChampionsItem } from "./types";
import { itemTakeable } from "./uses-to-ko";

/**
 * Fling (SPEC2 §4.7, guards.md §4.5): the held item's data, the failure rules and the effects on the target, as pinned
 * Showdown c23d2e94 has them (PS/data/moves.ts fling onPrepareHit, :5743-5771):
 * - it fails when its user ignores its item (`ignoringItem(true)`: Magic Room, Embargo, Klutz from generation 5), when the
 *   item's TakeItem fails for its own user (a Mega Stone of its family, a plate for Arceus, a Memory for Silvally, a Drive for
 *   Genesect, a mask for Ogerpon, Booster Energy for a Paradox Pokémon, the Rusted items, the Origin items, a Z-Crystal), and
 *   when the item has no `fling` data (Poké Balls, Normal Gem, Flower Sweet, the Z-Crystals, the Primal Orbs...);
 * - its base power is `item.fling.basePower`;
 * - a Berry is eaten by the target (onHit: singleEvent Eat, then runEvent EatItem, with no TryEatItem, so Unnerve does not stop
 *   it); else `fling.effect` (White Herb, Mental Herb) acts on the target (onHit); else `fling.status` or
 *   `fling.volatileStatus` is a secondary effect (no chance: certain), added after Sheer Force's onModifyMove, so Sheer Force
 *   neither removes it nor boosts Fling, while Shield Dust and Covert Cloak stop it;
 * - the item stays held through the hit (its own damage effects apply: Life Orb's boost, a type-boosting item, Choice Band)
 *   and the `fling` volatile removes it at the next Update.
 */

/** A status Fling gives as a secondary effect (data/items.ts fling.status: Flame Orb, Toxic Orb, Poison Barb, Light Ball). */
export type FlingStatus = Extract<BattleStatus, "brn" | "par" | "psn" | "tox">;

/**
 * One catalog item's Fling data (scripts/lib/champions-data/transform.ts flingData, from the game's pinned mod): its base
 * power, its secondary status or volatile status, its own onHit effect, and whether it is a Berry (the target eats it).
 * An item with no `fling` field cannot be flung.
 */
export type FlingData = {
  basePower: number;
  status?: FlingStatus;
  volatileStatus?: "flinch";
  effect?: "whiteherb" | "mentalherb";
  berry?: true;
};

/** A catalog item as the generator writes it, with its Fling data. */
export type FlingItem = ChampionsItem & { fling?: FlingData };

/** The engine move name a flung item's power runs under: a neutral name keeps the engine's own Fling branch (its getFlingPower) off. */
export const FLING_ENGINE_NAME = "Fling (item power)";

/** The item's Fling data in this game's catalog, or undefined when it has none (Fling fails). */
export function flingData(runtime: BattleRuntime, itemId: string): FlingData | undefined {
  return (runtime.itemsById.get(itemId) as FlingItem | undefined)?.fling;
}

/** What Fling's failure check reads of its user (all in effect: an active Klutz, its own species for TakeItem). */
export type FlingUser = {
  /** Its held item ("" for none). */
  itemId: string;
  /** Its own species (a transformed Pokémon's from before Transform: pinned onTakeItem reads source.baseSpecies). */
  speciesId: string;
  /** Its name, for the facts. */
  name: string;
  /** Klutz works (not suppressed by the other battler's Neutralizing Gas). */
  klutz: boolean;
  /** Embargo is on it (2v2: BattleBuild.itemSuppressed). */
  embargo: boolean;
};

/** The facts of a Fling that fails (each "Fling fails: …"). */
export const FLING_FAILS = {
  noItem: (name: string) => `Fling fails: ${name} has no item.`,
  magicRoom: "Fling fails under Magic Room.",
  klutz: (name: string) => `Fling fails: ${name} has Klutz.`,
  embargo: (name: string) => `Fling fails: ${name} is under Embargo.`,
  cannotFling: (item: string) => `Fling fails: ${item} cannot be flung.`,
} as const;

/** The Primal Orbs, which sim/pokemon.ts ignoringItem never ignores (they still have no fling data). */
const PRIMAL_ORBS = new Set(["redorb", "blueorb"]);

/**
 * Why Fling fails for this user, as a fact, or null when it is thrown, in pinned Showdown's order: ignoringItem(true) (not for a
 * Primal Orb; Embargo and Magic Room, then Klutz), then the item's TakeItem and its fling data, which an empty item also fails
 * (the fact then says it has none). `paradox`: whether a species is a Paradox Pokémon (Booster Energy's onTakeItem).
 */
export function flingFailure(user: FlingUser, magicRoom: boolean, runtime: BattleRuntime, paradox: (speciesId: string) => boolean): string | null {
  if (!PRIMAL_ORBS.has(user.itemId)) {
    if (user.embargo) return FLING_FAILS.embargo(user.name);
    if (magicRoom) return FLING_FAILS.magicRoom;
    if (user.klutz) return FLING_FAILS.klutz(user.name);
  }
  if (!user.itemId) return FLING_FAILS.noItem(user.name);
  const item = runtime.itemsById.get(user.itemId);
  if (!flingData(runtime, user.itemId) || !itemTakeable(runtime, paradox, user.itemId, user.speciesId, user.speciesId, false)) {
    return FLING_FAILS.cannotFling(item?.name ?? user.itemId);
  }
  return null;
}

/** The effect a flung item has on its target (Showdown's order: a Berry, then fling.effect, then a status, then a volatile status). */
export type FlungEffect =
  | { kind: "berry" }
  | { kind: "status"; status: FlingStatus }
  | { kind: "flinch" }
  | { kind: "whiteherb" }
  | { kind: "mentalherb" }
  | { kind: "none" };

export function flungEffect(data: FlingData): FlungEffect {
  if (data.berry) return { kind: "berry" };
  if (data.effect) return { kind: data.effect };
  if (data.status) return { kind: "status", status: data.status };
  if (data.volatileStatus === "flinch") return { kind: "flinch" };
  return { kind: "none" };
}

/** The status facts (guards.md §4.5 step 6). */
const STATUS_TEXT: Record<FlingStatus, string> = { brn: "is burned", par: "is paralysed", psn: "is poisoned", tox: "is badly poisoned" };

/** The fact of a flung item's effect on a target that is hit and still in. */
export function flungFact(effect: FlungEffect, item: string, target: string): string | null {
  switch (effect.kind) {
    case "berry": return `${item}: ${target} eats it.`;
    case "status": return `${item}: ${target} ${STATUS_TEXT[effect.status]}.`;
    case "flinch": return `${item}: ${target} flinches if it has not moved.`;
    case "whiteherb": return `White Herb: ${target}'s lowered stats are restored.`;
    case "mentalherb": return `Mental Herb: ${target}'s Taunt, Encore, Disable, Torment, Heal Block and attraction end.`;
    default: return null;
  }
}

/** What a flung status's landing reads of the target and the field, all in effect (calculate.ts flungStatusTarget). */
export type FlungStatusTarget = {
  /** Its status before the hit ("" for none). */
  status: BattleStatus | "";
  /** Its types now (a Tera type alone when Terastallized, but Stellar). */
  types: readonly string[];
  /** Its ability in effect ("" when the other battler's Neutralizing Gas suppresses it). */
  ability: string;
  /** Its held item, when the item works (not under Klutz or Embargo; Fling never flies under Magic Room). */
  item: string;
  /** Its species (Shields Down's Meteor Form). */
  speciesId: string;
  /** It is on the ground (sim/pokemon.ts isGrounded, with the attacker's Mold Breaker ignoring Levitate). */
  grounded: boolean;
  /** Safeguard on its side (2v2), which an Infiltrator attacker passes. */
  safeguard: boolean;
};

/** The attacker as a flung status reads it: its ability in effect, and whether it ignores breakable target abilities. */
export type FlungStatusSource = { ability: string; moldBreaker: boolean };

/** Breakable target abilities a Mold Breaker attacker ignores during Fling (PS/data/abilities.ts flags.breakable). */
const BREAKABLE = new Set(["shielddust", "waterveil", "waterbubble", "thermalexchange", "immunity", "pastelveil", "limber", "flowerveil", "purifyingsalt", "leafguard"]);
/** The target's held Berries that cure a status as soon as it is set (onUpdate), and what each cures. */
const AT_ONCE_CURES: Record<string, readonly FlingStatus[]> = { lumberry: ["brn", "par", "psn", "tox"], rawstberry: ["brn"], pechaberry: ["psn", "tox"], cheriberry: ["par"] };
/** The attacker abilities that stop the target's Berries (Unnerve, As One). */
const UNNERVES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);

/**
 * Whether a flung status lands on a target that is hit and still in (pinned Showdown: ModifySecondaries' Shield Dust and Covert
 * Cloak, then trySetStatus: an existing status, the type immunities with Corrosion's exception, the SetStatus handlers: Comatose,
 * Purifying Salt, Shields Down's Meteor Form, Leaf Guard in sun, Water Veil, Water Bubble and Thermal Exchange for a burn,
 * Immunity and Pastel Veil for poison, Limber for paralysis, Flower Veil on a Grass type, Misty Terrain on the ground,
 * Safeguard), and stays (a working Lum, Rawst, Pecha or Cheri Berry it holds cures it at once unless the attacker's Unnerve
 * or As One stops it). `sunny`: the target's effective weather is sun or Harsh Sunshine.
 */
export function flungStatusLands(status: FlingStatus, target: FlungStatusTarget, source: FlungStatusSource, terrain: string, sunny: boolean): boolean {
  const ability = source.moldBreaker && BREAKABLE.has(target.ability) ? "" : target.ability;
  if (ability === "shielddust" || target.item === "covertcloak") return false;
  if (target.status) return false;
  const corrosion = source.ability === "corrosion" && (status === "psn" || status === "tox");
  if (status === "brn" && target.types.includes("Fire")) return false;
  if ((status === "psn" || status === "tox") && !corrosion && (target.types.includes("Poison") || target.types.includes("Steel"))) return false;
  if (status === "par" && target.types.includes("Electric")) return false;
  if (["comatose", "purifyingsalt"].includes(ability) || (ability === "shieldsdown" && target.speciesId === "miniormeteor")) return false;
  if (ability === "leafguard" && sunny) return false;
  if (status === "brn" && ["waterveil", "waterbubble", "thermalexchange"].includes(ability)) return false;
  if ((status === "psn" || status === "tox") && ["immunity", "pastelveil"].includes(ability)) return false;
  if (status === "par" && ability === "limber") return false;
  if (ability === "flowerveil" && target.types.includes("Grass")) return false;
  if (terrain === "Misty" && target.grounded) return false;
  if (target.safeguard && source.ability !== "infiltrator") return false;
  if (AT_ONCE_CURES[target.item]?.includes(status) && !UNNERVES.has(source.ability)) return false;
  return true;
}

/** A status whose end of turn changes the target's HP (burn and poison: damage, or Poison Heal's heal). */
export const HP_STATUSES: ReadonlySet<FlingStatus> = new Set(["brn", "psn", "tox"]);

/** One heal of the target in the hit's onHit, capped at its maximum HP: the flung Berry's, Cheek Pouch's, its own Enigma Berry's. */
export type UseHeal = { source: string; amount: number };

/**
 * One use of a single hit from the target's HP at the move's start, as uses-to-ko.ts firstUse walks it (types.ts AfterUse):
 * each of the rolls (equally likely), a KO roll left at 1 HP by Focus Sash or Sturdy at full HP (`endure`), then the heals
 * of the hit's onHit in order (`onHit`: Fling's Berry eaten by the target, its Cheek Pouch, its own Enigma Berry after a
 * super-effective hit), then the target's own HP item at the Update after the move (`update`: Sitrus, Oran, the Figy family,
 * Berry Juice, at its line). calculate.ts flingUses checks this walk without Fling's heals against uses-to-ko's own first use
 * before it uses it with them.
 */
export type FirstUseInput = {
  start: number;
  maxHP: number;
  rolls: readonly number[];
  endure: boolean;
  onHit: readonly UseHeal[];
  update: { source: string; berry: Berry } | null;
};

/** The largest double below 1 (uses-to-ko.ts BELOW_ONE): a chance that is not certain is never reported as 1. */
const BELOW_ONE = 1 - Number.EPSILON / 2;

export function firstUseWalk({ start, maxHP, rolls, endure, onHit, update }: FirstUseInput): AfterUse {
  const note = (heals: Map<string, [number, number]>, source: string, amount: number, sum: boolean) => {
    if (amount <= 0) return;
    const known = heals.get(source);
    if (!known) heals.set(source, [amount, amount]);
    else if (sum) { known[0] += amount; known[1] += amount; }
    else { known[0] = Math.min(known[0], amount); known[1] = Math.max(known[1], amount); }
  };
  const walk = (roll: number, heals: Map<string, [number, number]>, sum: boolean): number => {
    let hp = start - roll;
    if (hp <= 0) {
      if (!endure) return 0;
      hp = 1;
    }
    for (const { source, amount } of onHit) {
      const healed = Math.min(maxHP, hp + amount);
      note(heals, source, healed - hp, sum);
      hp = healed;
    }
    if (update && hp <= update.berry.line) {
      const { heal, pouch } = berryHeals(update.berry, hp);
      note(heals, update.source, heal, sum);
      note(heals, "Cheek Pouch", pouch, sum);
      hp = eatBerry(update.berry, hp);
    }
    return hp;
  };
  const all = new Map<string, [number, number]>();
  const dist = new Map<number, number>();
  let out = 0, seen = false;
  const share = 1 / rolls.length;
  for (const roll of rolls) {
    const hp = walk(roll, all, false);
    if (hp === 0) { out += share; seen = true; } else dist.set(hp, (dist.get(hp) ?? 0) + share);
  }
  let average = 0, min = seen || !dist.size ? 0 : Infinity, max = 0;
  for (const [hp, p] of dist) {
    average += hp * p;
    min = Math.min(min, hp);
    max = Math.max(max, hp);
  }
  const facts = (heals: Map<string, [number, number]>) => [...heals].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`);
  const regained = (heals: Map<string, [number, number]>) => [...heals.values()].reduce((total, [amount]) => total + amount, 0);
  let low: number, high: number;
  let paths: NonNullable<AfterUse["paths"]>;
  if (!all.size) {
    [low, high] = [max, min];
    paths = { low: { dealt: start - low, heals: [] }, high: { dealt: start - high, heals: [] } };
  } else {
    const lowest = new Map<string, [number, number]>(), highest = new Map<string, [number, number]>();
    low = walk(rolls[0], lowest, true);
    high = walk(rolls[rolls.length - 1], highest, true);
    paths = { low: { dealt: start - low + regained(lowest), heals: facts(lowest) }, high: { dealt: start - high + regained(highest), heals: facts(highest) } };
  }
  const koChance = dist.size ? Math.min(BELOW_ONE, out > 0 || !seen ? out : Number.MIN_VALUE) : 1;
  return { start, low, high, average, min, max, koChance, heals: facts(all), paths };
}
