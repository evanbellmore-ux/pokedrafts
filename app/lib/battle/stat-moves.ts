import type { BattleGame, BattleStatus, CombatStat } from "./types";

export type Stages = Partial<Record<CombatStat, number>>;
export type StatMove = { self?: Stages; userSecondary?: Stages; target?: Stages; preHit?: Stages };

/**
 * Damaging moves whose every use changes a stat stage (pinned Showdown c23d2e9 data/moves.ts and each
 * game's mod; tests/source checks this table against them): `self` is the move's self.boosts or
 * selfBoost.boosts, which change the user after the move whatever Sheer Force does; `userSecondary`
 * is a 100% secondary on the user and `target` a 100% secondary on the target, which Sheer Force
 * removes and the target's Shield Dust or Covert Cloak stop. `preHit` is the charge turn's rise before
 * the hit (Meteor Beam, Electro Shot, Skull Bash; the row already includes the first one). `games`
 * replaces the entry for a game whose mod differs. Moves whose stage changes never change their own
 * later damage (Speed, the user's defenses) are listed too: the per-use state skips them by relevance.
 * Accuracy and evasion changes (Mud-Slap) are left out: every use is assumed to hit.
 */
export const STAT_MOVES: Record<string, StatMove & { games?: Partial<Record<BattleGame, StatMove | null>> }> = {
  acidspray: { target: { spd: -2 } }, appleacid: { target: { spd: -1 } }, aquastep: { userSecondary: { spe: 1 } },
  armorcannon: { self: { def: -1, spd: -1 } }, aurawheel: { userSecondary: { spe: 1 } }, bittermalice: { target: { atk: -1 } },
  breakingswipe: { target: { atk: -1 } }, bulldoze: { target: { spe: -1 } }, chillingwater: { target: { atk: -1 } },
  clangingscales: { self: { def: -1 } }, closecombat: { self: { def: -1, spd: -1 } },
  dracometeor: { self: { spa: -2 } }, dragonascent: { self: { def: -1, spd: -1 } }, drumbeating: { target: { spe: -1 } },
  electroweb: { target: { spe: -1 } }, esperwing: { userSecondary: { spe: 1 } }, firelash: { target: { def: -1 } },
  flamecharge: { userSecondary: { spe: 1 } }, fleurcannon: { self: { spa: -2 } }, glaciate: { target: { spe: -1 } },
  gravapple: { target: { def: -1 } }, hammerarm: { self: { spe: -1 } }, headlongrush: { self: { def: -1, spd: -1 } },
  hyperspacefury: { self: { def: -1 } }, icehammer: { self: { spe: -1 } }, icywind: { target: { spe: -1 } },
  leafstorm: { self: { spa: -2 } }, lowsweep: { target: { spe: -1 } }, luminacrash: { target: { spd: -2 } },
  lunge: { target: { atk: -1 } }, makeitrain: { self: { spa: -1 }, games: { champions: { self: { spa: -2 } } } }, mudshot: { target: { spe: -1 } },
  mysticalfire: { target: { spa: -1 } }, mysticalpower: { userSecondary: { spa: 1 } }, overheat: { self: { spa: -2 } },
  pounce: { target: { spe: -1 } }, poweruppunch: { userSecondary: { atk: 1 } }, psychoboost: { self: { spa: -2 } },
  psyshieldbash: { userSecondary: { def: 1 } }, rapidspin: { userSecondary: { spe: 1 }, games: { ultra_sun_ultra_moon: null } },
  rocktomb: { target: { spe: -1 } }, scaleshot: { self: { def: -1, spe: 1 } }, skittersmack: { target: { spa: -1 } }, snarl: { target: { spa: -1 } },
  spinout: { self: { spe: -2 } }, spiritbreak: { target: { spa: -1 } }, strugglebug: { target: { spa: -1 } },
  superpower: { self: { atk: -1, def: -1 } }, thunderouskick: { target: { def: -1 } }, torchsong: { userSecondary: { spa: 1 } },
  trailblaze: { userSecondary: { spe: 1 } }, tropkick: { target: { atk: -1 } }, vcreate: { self: { spe: -1, def: -1, spd: -1 } },
  meteorbeam: { preHit: { spa: 1 } }, electroshot: { preHit: { spa: 1 } }, skullbash: { preHit: { def: 1 } },
};

/** This game's stat changes for the move, or undefined. */
export function statMove(moveId: string, game: BattleGame): StatMove | undefined {
  const entry = STAT_MOVES[moveId];
  if (!entry) return undefined;
  const replaced = entry.games?.[game];
  return replaced === null ? undefined : replaced ?? entry;
}

/**
 * Damaging moves whose every use gives the target a non-volatile status (pinned Showdown: a 100%
 * secondary, which Sheer Force removes and Shield Dust or Covert Cloak stop, or G-Max Malodor's and
 * G-Max Volt Crash's self.onHit, which they do not). Burn and poison then damage it at the end of each
 * turn; paralysis halves its Speed (Electro Ball's power reads it).
 */
export const STATUS_MOVES: Record<string, { status: BattleStatus; secondary: boolean }> = {
  inferno: { status: "brn", secondary: true }, mortalspin: { status: "psn", secondary: true }, nuzzle: { status: "par", secondary: true },
  stokedsparksurfer: { status: "par", secondary: true }, zapcannon: { status: "par", secondary: true }, gmaxmalodor: { status: "psn", secondary: false },
  gmaxvoltcrash: { status: "par", secondary: false },
};

/**
 * Max Moves (pinned Showdown data/moves.ts self.onHit): stage changes, the weather or terrain each sets,
 * G-Max Wind Rage clearing the screens and the terrain, and G-Max Sweetness curing the user's status.
 */
export const MAX_MOVE_EFFECTS: Record<string, { user?: Stages; foe?: Stages; weather?: string; terrain?: string; clearsScreens?: boolean; clearsTerrain?: boolean; curesUserStatus?: boolean }> = {
  "Max Knuckle": { user: { atk: 1 } }, "Max Ooze": { user: { spa: 1 } }, "Max Steelspike": { user: { def: 1 } }, "Max Quake": { user: { spd: 1 } },
  "Max Airstream": { user: { spe: 1 } }, "Max Strike": { foe: { spe: -1 } }, "Max Wyrmwind": { foe: { atk: -1 } }, "Max Phantasm": { foe: { def: -1 } },
  "Max Darkness": { foe: { spd: -1 } }, "Max Flutterby": { foe: { spa: -1 } },
  "Max Flare": { weather: "Sun" }, "Max Geyser": { weather: "Rain" }, "Max Hailstorm": { weather: "Hail" }, "Max Rockfall": { weather: "Sand" },
  "Max Lightning": { terrain: "Electric" }, "Max Overgrowth": { terrain: "Grassy" }, "Max Mindstorm": { terrain: "Psychic" }, "Max Starfall": { terrain: "Misty" },
  "G-Max Wind Rage": { clearsScreens: true, clearsTerrain: true }, "G-Max Sweetness": { curesUserStatus: true },
};

/**
 * Signature Z-Moves' own effects on a hit (pinned Showdown data/moves.ts; tests/source checks this table against the
 * pinned Dex): Clangorous Soulblaze's selfBoost (+1 to every stat once the move has hit, sim/battle-actions.ts useMoveInner;
 * Sheer Force removes it, data/abilities.ts sheerforce), Genesis Supernova's Psychic Terrain (a 100% secondary's
 * self.onHit: Sheer Force would remove it, Shield Dust and Covert Cloak keep self effects), Splintered Stormshards ending
 * the terrain (onHit). Stoked Sparksurfer's paralysis is in STATUS_MOVES; a generic Z-Move has no effect of its own.
 */
export const Z_MOVE_EFFECTS: Record<string, { user?: Stages; terrain?: string; clearsTerrain?: boolean }> = {
  "Clangorous Soulblaze": { user: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } },
  "Genesis Supernova": { terrain: "Psychic" },
  "Splintered Stormshards": { clearsTerrain: true },
};

/** Two-turn moves (pinned Showdown flags.charge): a charge turn before each use, unless skipped. */
export const CHARGE_MOVES = new Set([
  "bounce", "dig", "dive", "electroshot", "fly", "freezeshock", "iceburn", "meteorbeam", "phantomforce", "razorwind",
  "shadowforce", "skullbash", "skyattack", "skydrop", "solarbeam", "solarblade",
]);
/** Moves after which the user must recharge for a turn (pinned Showdown self.volatileStatus mustrecharge). */
export const RECHARGE_MOVES = new Set([
  "blastburn", "eternabeam", "frenzyplant", "gigaimpact", "hydrocannon", "hyperbeam", "meteorassault", "prismaticlaser", "roaroftime", "rockwrecker",
]);
/** Moves that cannot be used twice in a row (pinned Showdown onDisableMove on lastMove). */
export const NOT_TWICE_MOVES = new Set(["bloodmoon", "gigatonhammer"]);
