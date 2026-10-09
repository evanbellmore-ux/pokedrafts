import type { BattleConditions, BattleStatus } from "./types";

// The end of turn's per-Pokémon rules (status-eot SPEC §4.8), shared by the 1v1 search (uses-to-ko.ts residuals(), an
// adapter over these) and the 2v2 end of turn (doubles-eot.ts). Pure: no engine imports. Pinned Showdown c23d2e94:
// data/conditions.ts (weather, psn, tox, brn, partiallytrapped), data/moves.ts (aquaring, ingrain, leechseed, curse,
// saltcure, grassyterrain), data/abilities.ts, data/items.ts, data/mods/champions; sim/battle.ts fieldEvent and
// resolvePriority for the keys (tests/source/doubles-residuals.test.ts checks them against the pinned dex).

/**
 * A residual handler's sort key (sim/battle.ts comparePriority: order ascending, priority descending, the holder's Speed
 * descending, subOrder ascending). `order` absent in the dex (Micle Berry, Dynamax) sorts last: 4294967296. `subOrder`
 * is the dex's, or resolvePriority's default by effect type: Condition 2, slot condition 3, side condition 4, Weather 5,
 * Ability 7, Item 8, a Status 0.
 */
export type ResidualKey = { order: number; subOrder: number; priority: number };

/** One Pokémon as the end of turn reads it (each engine builds it from its own state). */
export type ResidualMon = {
  baseMaxHP: number;
  types: readonly string[];
  /** The ability in effect ("" or a stand-in when suppressed). */
  ability: string;
  /** The item that works (the caller applies Klutz and Magic Room): "" for none. */
  item: string;
  status: BattleStatus;
  /** Bad poison's stage before this end of turn (pinned tox statusState.stage), 0–15. */
  toxicStage: number;
  /** sim/pokemon.ts isGrounded, as the caller reads it (Gravity, Ingrain, Smack Down, Iron Ball; Flying, Levitate, Magnet Rise, Air Balloon). */
  grounded: boolean;
  /** On the charge turn of Fly, Bounce, Phantom Force, Shadow Force, Dig or Dive (sim/pokemon.ts isSemiInvulnerable). */
  semiInvulnerable: boolean;
  /** Underground or underwater (Dig, Dive): no sand or hail (data/moves.ts dig, dive condition onImmunity). */
  sheltered: boolean;
  saltCure?: boolean; aquaRing?: boolean; ingrain?: boolean; curse?: boolean;
  /** Partially trapped, its damage's divisor (Binding Band 6, else 8); the source check is the caller's. */
  trapDivisor?: 6 | 8;
  /** Heal Block (Psychic Noise): every residual heal fails (data/moves.ts healblock condition onTryHeal). */
  healBlocked?: boolean;
};

export type ResidualId = "sandstorm" | "hail" | "icebody" | "raindish" | "dryskin" | "solarpower" | "grassyterrain" | "leftovers"
  | "blacksludge" | "aquaring" | "ingrain" | "poisonheal" | "psn" | "tox" | "brn" | "curse" | "partiallytrapped" | "saltcure" | "stickybarb";

/** One residual on its own holder: + heal, − damage, before the HP cap (and before a heal's full-HP check). */
export type OwnResidual = { id: ResidualId; key: ResidualKey; amount: number };

/** The order handlers without an order sort at (sim/battle.ts comparePriority: `order || 4294967296`). */
export const LAST_ORDER = 4294967296;

/**
 * Every residual key the two engines use, by handler (inventory.ts in the design folder lists the pinned ones).
 * Weather sub-effects (sand and hail damage, Ice Body, Rain Dish, Dry Skin, Solar Power) run inside the weather's
 * onFieldResidual (order 1), each Pokémon in Speed order (sim/battle.ts eachEvent('Weather')).
 */
export const RESIDUAL_KEYS: Readonly<Record<string, ResidualKey>> = {
  weather: { order: 1, subOrder: 5, priority: 0 },
  sandstorm: { order: 1, subOrder: 5, priority: 0 }, hail: { order: 1, subOrder: 5, priority: 0 }, icebody: { order: 1, subOrder: 5, priority: 0 },
  raindish: { order: 1, subOrder: 5, priority: 0 }, dryskin: { order: 1, subOrder: 5, priority: 0 }, solarpower: { order: 1, subOrder: 5, priority: 0 },
  futuremove: { order: 3, subOrder: 3, priority: 0 },
  wish: { order: 4, subOrder: 3, priority: 0 },
  grassyterrain: { order: 5, subOrder: 2, priority: 0 },
  healer: { order: 5, subOrder: 3, priority: 0 }, hydration: { order: 5, subOrder: 3, priority: 0 }, shedskin: { order: 5, subOrder: 3, priority: 0 },
  leftovers: { order: 5, subOrder: 4, priority: 0 }, blacksludge: { order: 5, subOrder: 4, priority: 0 },
  aquaring: { order: 6, subOrder: 2, priority: 0 },
  ingrain: { order: 7, subOrder: 2, priority: 0 },
  leechseed: { order: 8, subOrder: 2, priority: 0 },
  psn: { order: 9, subOrder: 0, priority: 0 }, tox: { order: 9, subOrder: 0, priority: 0 }, poisonheal: { order: 9, subOrder: 0, priority: 0 },
  brn: { order: 10, subOrder: 0, priority: 0 },
  curse: { order: 12, subOrder: 2, priority: 0 },
  partiallytrapped: { order: 13, subOrder: 2, priority: 0 }, saltcure: { order: 13, subOrder: 2, priority: 0 },
  syrupbomb: { order: 14, subOrder: 2, priority: 0 },
  yawn: { order: 23, subOrder: 2, priority: 0 },
  perishsong: { order: 24, subOrder: 2, priority: 0 },
  roost: { order: 25, subOrder: 2, priority: 0 },
  baddreams: { order: 28, subOrder: 2, priority: 0 }, speedboost: { order: 28, subOrder: 2, priority: 0 }, moody: { order: 28, subOrder: 2, priority: 0 },
  harvest: { order: 28, subOrder: 2, priority: 0 }, pickup: { order: 28, subOrder: 2, priority: 0 }, cudchew: { order: 28, subOrder: 2, priority: 0 },
  slowstart: { order: 28, subOrder: 2, priority: 0 },
  stickybarb: { order: 28, subOrder: 3, priority: 0 }, flameorb: { order: 28, subOrder: 3, priority: 0 }, toxicorb: { order: 28, subOrder: 3, priority: 0 },
  hungerswitch: { order: 29, subOrder: 7, priority: 0 }, opportunist: { order: 29, subOrder: 7, priority: 0 }, powerconstruct: { order: 29, subOrder: 7, priority: 0 },
  schooling: { order: 29, subOrder: 7, priority: 0 }, shieldsdown: { order: 29, subOrder: 7, priority: 0 }, zenmode: { order: 29, subOrder: 7, priority: 0 },
  ejectpack: { order: 29, subOrder: 8, priority: 0 }, mirrorherb: { order: 29, subOrder: 8, priority: 0 }, whiteherb: { order: 29, subOrder: 8, priority: 0 },
  micleberry: { order: LAST_ORDER, subOrder: 8, priority: 0 },
};

/** A residual damage or heal of baseMaxHP/divisor: floored, at least 1 (sim/battle.ts spreadDamage clampIntRange; heal trunc, at least 1). */
export const residualPart = (baseMaxHP: number, divisor: number) => Math.max(1, Math.floor(baseMaxHP / divisor));

/** Big Root on a drain, Leech Seed, Ingrain or Aqua Ring heal (data/items.ts bigroot onTryHeal chainModify([5324, 4096]); sim/battle.ts modify). */
export function bigRoot(amount: number): number {
  return Math.trunc((Math.trunc(amount * 5324) + 2047) / 4096);
}

const SAND_IMMUNE_TYPES = ["Rock", "Ground", "Steel"];
const SAND_IMMUNE_ABILITIES = new Set(["overcoat", "sandforce", "sandrush", "sandveil"]);
const HAIL_IMMUNE_ABILITIES = new Set(["overcoat", "icebody", "snowcloak"]);
const RAIN = new Set<BattleConditions["weather"]>(["Rain", "Heavy Rain"]);
const SUN = new Set<BattleConditions["weather"]>(["Sun", "Harsh Sunshine"]);

/**
 * The weather handler's part for one Pokémon (order 1; data/conditions.ts sandstorm, hail onWeather; data/abilities.ts
 * icebody, raindish, dryskin, solarpower onWeather), in the handler's own order, for `weather` acting (the caller
 * leaves it out when the weather is suppressed or ends now). Sand and hail need no immunity (Rock, Ground, Steel;
 * Ice; Overcoat, Sand Force, Sand Rush, Sand Veil; Ice Body, Snow Cloak; Safety Goggles; underground or underwater),
 * and Magic Guard stops them, Dry Skin's and Solar Power's sun damage. Rain Dish, Dry Skin and Solar Power read the
 * holder's own weather (Pokemon.effectiveWeather: a Utility Umbrella cancels sun and rain); Ice Body does not. Heal
 * Block stops the heals.
 */
export function weatherResiduals(mon: ResidualMon, weather: BattleConditions["weather"]): OwnResidual[] {
  const out: OwnResidual[] = [];
  const add = (id: ResidualId, amount: number) => out.push({ id, key: RESIDUAL_KEYS[id], amount });
  const guard = mon.ability === "magicguard";
  const umbrella = mon.item === "utilityumbrella", goggles = mon.item === "safetygoggles";
  const sun = SUN.has(weather) && !umbrella, rain = RAIN.has(weather) && !umbrella;
  const part = (divisor: number) => residualPart(mon.baseMaxHP, divisor);
  const heals = !mon.healBlocked;
  if (weather === "Sand" && !mon.types.some((type) => SAND_IMMUNE_TYPES.includes(type)) && !SAND_IMMUNE_ABILITIES.has(mon.ability) && !goggles && !guard && !mon.sheltered) add("sandstorm", -part(16));
  if (weather === "Hail" && !mon.types.includes("Ice") && !HAIL_IMMUNE_ABILITIES.has(mon.ability) && !goggles && !guard && !mon.sheltered) add("hail", -part(16));
  if (mon.ability === "icebody" && (weather === "Hail" || weather === "Snow") && heals) add("icebody", part(16));
  if (mon.ability === "raindish" && rain && heals) add("raindish", part(16));
  if (mon.ability === "dryskin" && rain && heals) add("dryskin", part(8));
  if ((mon.ability === "dryskin" || mon.ability === "solarpower") && sun && !guard) add(mon.ability === "dryskin" ? "dryskin" : "solarpower", -part(8));
  return out;
}

/**
 * Every residual of the Pokémon on itself but the weather's, in key order: Grassy Terrain (5.2: grounded, not
 * semi-invulnerable), Leftovers and Black Sludge (5.4), Aqua Ring (6) and Ingrain (7) with Big Root, poison and bad poison
 * (9: clampIntRange(baseMaxHP/16, 1) × the stage after it rises, at most 15) or Poison Heal's 1/8 instead, burn (10;
 * Heatproof halves the clamped value, at least 1), Curse (12), a partial trap (13: the caller checks its source) and
 * Salt Cure (13: 1/8, Water and Steel 1/4; Champions 1/16 and 1/8), Sticky Barb (28.3). Magic Guard stops every damage
 * (data/abilities.ts magicguard onDamage), Heal Block every heal (Poison Heal's too, which then also takes no damage).
 * Hydration, Healer and Shed Skin's cures, Bad Dreams and Leech Seed are the callers'.
 */
export function ownResiduals(mon: ResidualMon, env: { terrain: BattleConditions["terrain"]; champions: boolean }): OwnResidual[] {
  const out: OwnResidual[] = [];
  const add = (id: ResidualId, amount: number) => { if (amount) out.push({ id, key: RESIDUAL_KEYS[id], amount }); };
  const guard = mon.ability === "magicguard";
  const heals = !mon.healBlocked;
  const part = (divisor: number) => residualPart(mon.baseMaxHP, divisor);
  const root = (amount: number) => mon.item === "bigroot" ? bigRoot(amount) : amount;
  if (env.terrain === "Grassy" && mon.grounded && !mon.semiInvulnerable && heals) add("grassyterrain", part(16));
  if (mon.item === "leftovers" && heals) add("leftovers", part(16));
  if (mon.item === "blacksludge") {
    if (mon.types.includes("Poison")) { if (heals) add("blacksludge", part(16)); } else if (!guard) add("blacksludge", -part(8));
  }
  if (mon.aquaRing && heals) add("aquaring", root(part(16)));
  if (mon.ingrain && heals) add("ingrain", root(part(16)));
  if (mon.status === "psn" || mon.status === "tox") {
    if (mon.ability === "poisonheal") { if (heals) add("poisonheal", part(8)); } else if (!guard) add(mon.status, -(mon.status === "psn" ? part(8) : part(16) * Math.min(15, mon.toxicStage + 1)));
  }
  if (mon.status === "brn" && !guard) add("brn", -(mon.ability === "heatproof" ? Math.max(1, Math.floor(part(16) / 2)) : part(16)));
  if (mon.curse && !guard) add("curse", -part(4));
  if (mon.trapDivisor && !guard) add("partiallytrapped", -part(mon.trapDivisor));
  if (mon.saltCure && !guard) {
    const resisted = mon.types.includes("Water") || mon.types.includes("Steel");
    add("saltcure", -part(env.champions ? (resisted ? 8 : 16) : (resisted ? 4 : 8)));
  }
  if (mon.item === "stickybarb" && !guard) add("stickybarb", -part(8));
  return out;
}

/** Bad Dreams' damage to one foe (28.2; data/abilities.ts baddreams): 1/8 to a sleeping or Comatose foe, 0 otherwise or under Magic Guard. */
export function badDreamsDamage(target: ResidualMon): number {
  if (target.status !== "slp" && target.ability !== "comatose") return 0;
  return target.ability === "magicguard" ? 0 : residualPart(target.baseMaxHP, 8);
}

/** Leech Seed's drain from the seeded (8; data/moves.ts leechseed condition onResidual), before the cap at its HP; 0 under Magic Guard. */
export function leechSeedDamage(seeded: ResidualMon): number {
  return seeded.ability === "magicguard" ? 0 : residualPart(seeded.baseMaxHP, 8);
}
