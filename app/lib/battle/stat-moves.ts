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

/**
 * The damaging moves whose added effects Serene Grace makes certain: it doubles each secondary's chance and a self
 * chance (pinned Showdown data/abilities.ts serenegrace onModifyMove: secondary.chance *= 2, move.self.chance *= 2),
 * and an effect happens when random(100) is below its chance (sim/battle-actions.ts secondaries, and self boosts in
 * moveHit), so every 50% and 70% one happens on each use (tests/source checks this table against each game's Dex).
 * `userSecondary` and `target` are secondaries as in STAT_MOVES (Sheer Force would remove them; Shield Dust and
 * Covert Cloak stop those on the target); Diamond Storm's `self` is its move.self, like STAT_MOVES' self; `status` is
 * a secondary status. Accuracy drops (Leaf Tornado, Octazooka) are left out: every use is assumed to hit. Dire Claw's
 * certain effect is a random status (SERENE_GRACE_RANDOM_STATUS).
 */
export const SERENE_GRACE_MOVES: Record<string, StatMove & { status?: BattleStatus }> = {
  barbbarrage: { status: "psn" }, chargebeam: { userSecondary: { spa: 1 } }, crushclaw: { target: { def: -1 } },
  diamondstorm: { self: { def: 2 } }, fierydance: { userSecondary: { spa: 1 } }, lusterpurge: { target: { spd: -1 } },
  malignantchain: { status: "tox" }, mistball: { target: { spa: -1 } }, poisonfang: { status: "tox" },
  razorshell: { target: { def: -1 } }, rocksmash: { target: { def: -1 } }, sacredfire: { status: "brn" },
  triplearrows: { target: { def: -1 } },
};
/** Dire Claw's 50% secondary poisons, paralyses or puts its target to sleep at random (data/moves.ts direclaw onHit this.sample). */
export const SERENE_GRACE_RANDOM_STATUS: ReadonlySet<string> = new Set(["direclaw"]);

/** Adds two stage changes, or undefined when neither has one. */
function addStages(a: Stages | undefined, b: Stages | undefined): Stages | undefined {
  if (!a || !b) return a ?? b;
  const sum: Stages = { ...a };
  for (const [stat, amount] of Object.entries(b) as [CombatStat, number][]) sum[stat] = (sum[stat] ?? 0) + amount;
  return sum;
}

/** This game's stat changes for the move, or undefined; with the user's Serene Grace, also those it makes certain (SERENE_GRACE_MOVES). */
export function statMove(moveId: string, game: BattleGame, sereneGrace = false): StatMove | undefined {
  const entry = STAT_MOVES[moveId];
  const replaced = entry?.games?.[game];
  const own = replaced === null ? undefined : replaced ?? entry;
  const doubled = sereneGrace ? SERENE_GRACE_MOVES[moveId] : undefined;
  if (!doubled || !(doubled.self || doubled.userSecondary || doubled.target)) return own;
  return Object.fromEntries(Object.entries({
    self: addStages(own?.self, doubled.self), userSecondary: addStages(own?.userSecondary, doubled.userSecondary),
    target: addStages(own?.target, doubled.target), preHit: own?.preHit,
  }).filter(([, stages]) => stages)) as StatMove;
}

/** The status the move gives its target on every use (STATUS_MOVES), with the user's Serene Grace also a secondary one it makes certain. */
export function everyUseStatus(moveId: string, sereneGrace = false): { status: BattleStatus; secondary: boolean } | undefined {
  const doubled = sereneGrace ? SERENE_GRACE_MOVES[moveId]?.status : undefined;
  return STATUS_MOVES[moveId] ?? (doubled ? { status: doubled, secondary: true } : undefined);
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
