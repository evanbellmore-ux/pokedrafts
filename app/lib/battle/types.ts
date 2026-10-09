import type { HitCountRule } from "./hit-count";

export type BattleStat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type CombatStat = Exclude<BattleStat, "hp">;
export type StatTable<T = number> = Record<BattleStat, T>;
export type BattleGame = "champions" | "ultra_sun_ultra_moon" | "sword_shield" | "scarlet_violet";
export type NativeBattleGame = Exclude<BattleGame, "champions">;
export type SetConfiguration = {
  teraType?: string;
  gigantamax?: boolean;
  dynamaxLevel?: number;
  happiness?: number;
  gender?: "M" | "F" | "N";
  hiddenPowerType?: string;
};
export type BattleMechanic = "tera" | "dynamax" | "gigantamax";

export type ChampionsSpecies = {
  id: string;
  name: string;
  /** Exact name understood by the pinned calculation engine. */
  calcName: string;
  baseSpecies: string;
  types: string[];
  baseStats: StatTable;
  weightkg: number;
  abilities: string[];
  /** The same abilities in Showdown's slot order (0, 1, Hidden, Special); `abilities` is sorted. */
  abilityOrder?: string[];
  moves: string[];
  battleForm: boolean;
  requiredItem: string | null;
  requiredItems?: string[];
  gender?: "M" | "F" | "N";
  canGigantamax?: string;
  gmaxNames?: string[];
  cannotDynamax?: boolean;
  requiredMove?: string;
  requiredTeraType?: string;
  changesFrom?: string;
  battleOnly?: string[];
  /** Known coverage gaps, never a reason to substitute another species. */
  unsupported: string[];
};

export type ChampionsMove = {
  id: string;
  name: string;
  type: string;
  category: "Physical" | "Special" | "Status";
  power: number;
  /** Null denotes an accuracy check that is not a normal percentage. */
  accuracy: number | null;
  /**
   * Base PP in this game's pinned Showdown data (Champions caps it at 20). Generated catalogs always
   * carry it; hand-built test catalogs may omit it.
   */
  pp?: number;
  /** PP Ups do not raise this move's PP (pinned Showdown noPPBoosts). */
  noPPBoosts?: true;
  priority: number;
  target: string;
  multihit: number | [number, number] | null;
  ohko: boolean;
  isZ?: boolean;
  isMax?: boolean;
  zMovePower?: number;
  maxMovePower?: number;
  description: string;
  unsupported: string[];
};

export type ChampionsAbility = {
  id: string;
  name: string;
  description: string;
  unsupported: string[];
};

export type ChampionsItem = {
  id: string;
  name: string;
  description: string;
  megaStone: string | null;
  megaEvolves: string | null;
  /** Some stones have distinct targets for each gender/form. */
  megaTargets: { baseSpeciesId: string; formId: string }[];
  zMoveType?: string;
  zMove?: string;
  zMoveFrom?: string;
  itemUser?: string[];
  unsupported: string[];
};

export type ChampionsCatalog = {
  version: 1;
  game: "champions";
  level: 50;
  sources: {
    engine: { revision: string; url: string };
    showdown: { revision: string; url: string };
  };
  species: ChampionsSpecies[];
  moves: ChampionsMove[];
  abilities: ChampionsAbility[];
  items: ChampionsItem[];
  coverage: {
    species: number;
    moves: number;
    unsupportedSpecies: number;
    unsupportedMoves: number;
    notes: string[];
  };
};

/** One format's quick-move defaults from pinned Showdown Random Battle sets (scripts/lib/battle-data/random-battle.ts). */
export type RandomBattleFormat = {
  file: string;
  species: Record<string, string[]>;
  /** Each form's most generated ability among its own supported ones (move-defaults usualAbility). */
  abilities: Record<string, string>;
  aggregate: string[];
};
export type RandomBattle = { formats: Partial<Record<"Singles" | "Doubles", RandomBattleFormat>> };
export type NativeCatalog = Omit<ChampionsCatalog, "game" | "level"> & {
  game: NativeBattleGame;
  level: null;
  /** Native games only; hand-built test catalogs may omit it. */
  randomBattle?: RandomBattle;
};
export type BattleCatalog = ChampionsCatalog | NativeCatalog;
export type BattleStatus = "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz";

type BuildBase = {
  speciesId: string;
  nature: string;
  abilityId: string;
  /** Explicit activation for conditional abilities; not a blanket ability switch. */
  abilityActive: boolean;
  itemId: string;
  boosts: Record<CombatStat, number | null>;
  /** Base (pre-Dynamax) HP; null means full HP. Raw editor text is stored separately. */
  currentHP: number | null;
  status: BattleStatus;
  configuration?: SetConfiguration;
  mechanic?: BattleMechanic;
  /** Prepared move IDs supplied by the importer/controller for form prerequisites. */
  preparedMoves?: readonly string[];
  /** Supreme Overlord: allies fainted before this Pokémon entered, 0–5 (count-moves.ts). */
  faintedAllies?: number;
  /** Trace: the ability it copied, when not the other shown Pokémon's (imposter.ts tracedAbility). */
  tracedAbility?: string;
  /**
   * Magic Room item timing (model roomItemChoice): false when its Booster Energy or terrain Seed was
   * not used before the room was set (it entered under the room, or the terrain started after it), so
   * the item is still held and does nothing. Unset means it was used on entry, or when its terrain
   * started, before the room (always true of a lead); pinned Showdown's room does not undo a used item.
   */
  itemUsedBeforeRoom?: boolean;
  /**
   * Protosynthesis / Quark Drive item timing (model fieldItemChoice), with the sun or Electric Terrain
   * up: whether its Booster Energy, terrain Seed or Room Service acted before that field activated the
   * ability. True: the Booster Energy was used while the field was down after the holder entered (on
   * entry before it started, or when it ended; it is gone and the ability keeps the stat it picked then),
   * or the Seed or Room Service was used first, so the ability's stat counts its stage change. False: the
   * field activated the ability first (pinned Showdown runs a Pokémon's ability before its item when the
   * terrain or weather changes). Unset: the Booster Energy is still held, and a Seed or Room Service came
   * first unless the other shown Pokémon's Drought, Orichalcum Pulse, Electric Surge or Hadron Engine set
   * the field as both entered. With the sun up but the other Pokémon's Cloud Nine or Air Lock out, false
   * means the sun activated Protosynthesis before that ability came in, which used up the Booster Energy
   * with no effect and ended Protosynthesis; otherwise its Booster Energy activated it.
   */
  itemUsedBeforeField?: boolean;
  /** Set only by the calculation for a transformed Imposter user: its own species and base HP. */
  transformedFrom?: { speciesId: string; baseHP: number };
  /**
   * Set only by the calculation: the stat Download raised on entry, already in the stages, when the
   * engine would pick differently: the foe transformed after Download read it, or at a shared lead
   * Download acted before the foe's terrain Seed, Embody Aspect or a slower Dauntless Shield, before
   * its form changed (Mega Evolution, Primal Reversion, Schooling...) and before any Wonder Room
   * (intimidate.ts beforeDownload, atLead). The engine's own Download is then switched off.
   */
  settledDownload?: CombatStat;
  /**
   * Set when an Intimidate this Pokémon copied with Trace has been stored in both builds' stages (its
   * Trace form Mega Evolved): the intimidatedKey of the Pokémon that took it, so the calculation does
   * not apply it to that Pokémon again (a roster reselect keeps both builds' stages).
   */
  copiedIntimidateStored?: string;
  /** Set only by the calculation: the stat an active Protosynthesis or Quark Drive boosts. */
  settledBoostedStat?: CombatStat;
  /**
   * Set only by the calculation: its Custap Berry was eaten when its move was chosen this turn (pinned
   * Showdown battle-queue.ts resolveAction runs FractionalPriority then), so it is gone and the Pokémon
   * moves first in its priority bracket this turn.
   */
  settledCustap?: true;
  /**
   * Set only by the calculation: it ate a Lansat Berry before the move (pinned Showdown lansatberry onEat adds
   * the focusenergy volatile, +2 critical-hit ratio while it stays in).
   */
  settledFocusEnergy?: true;
  /** Set only by the 2v2 turn and Training: the focusenergy volatile from the move (+2 critical-hit ratio). Lansat keeps settledFocusEnergy. */
  focusEnergy?: true;
  /** Set only by the 2v2 turn and Training: Dragon Cheer's critical-hit stages (+2 when the Pokémon was a Dragon type as it started). */
  dragonCheer?: 1 | 2;
  /**
   * Set only by the calculation, in generation 7: the Speed stage and Unburden state this turn's order was set
   * with, before the item it used at the turn's first Update changed them (pinned Showdown sim/battle.ts runAction
   * sorts the queue again after an action only from generation 8), and that item's name.
   */
  firstTurnSpeed?: { spe: number; unburden: boolean; item: string };
  /**
   * Set only by the calculation, for the uses after the first: the stages its Opportunist or Mirror Herb (`by`)
   * stored from a foe's Berry eaten before the move, which it applies after the attacker's first use when the
   * attacker moves first (pinned Showdown onFoeAfterBoost, then onAnyAfterMove).
   */
  pendingCopy?: { stages: Partial<Record<CombatStat, number>>; by: string[] };
};

export type ChampionsBuild = BuildBase & {
  game: "champions";
  points: StatTable<number | null>;
  native?: never;
};
export type NativeBuild = BuildBase & {
  game: NativeBattleGame;
  points?: never;
  native: {
    level: number | null;
    evs: StatTable<number | null>;
    ivs: StatTable<number | null>;
    /** Optional innate IVs when effective, hyper-trained IVs differ. */
    innateIVs?: StatTable<number | null>;
  };
};
export type BattleBuild = ChampionsBuild | NativeBuild;

export type SideConditions = {
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  /** This side's Pokémon has a Friend Guard partner (Doubles), cutting damage it takes to 75%. */
  friendGuard: boolean;
  /**
   * This side's Pokémon has a partner (Doubles) with Queenly Majesty, Dazzling or Armor Tail, which stops
   * the other side's priority moves aimed at either of them (pinned Showdown onFoeTryMove).
   */
  priorityShield: boolean;
  /** This side's Pokémon is protecting (Protect, Detect or a similar move) this turn. */
  protect: boolean;
  /** Tailwind is active on this side, doubling its Pokémon's Speed. */
  tailwind: boolean;
  /** This side's Pokémon used Charge, doubling the power of its next Electric attack. */
  charge: boolean;
  /**
   * Doubles turn only: this side's Pokémon has a Cherrim partner whose Flower Gift raises its Attack and Sp. Def by
   * 1.5x in the sun (pinned Showdown flowergift onAllyModifyAtk / onAllyModifySpD; doubles-turn.ts flowerGift).
   */
  flowerGift?: boolean;
  /**
   * Doubles turn only: this side's attacker has a partner whose Battery (its Special moves), Power Spot (its moves) or
   * Steely Spirit (its Steel moves) raises its move's power (pinned Showdown battery, powerspot, steelyspirit
   * onAllyBasePower; doubles-turn.ts conditionsFor, calculate.ts partnerPowerBoosts).
   */
  battery?: boolean;
  powerSpot?: boolean;
  steelySpirit?: boolean;
};

export type BattleConditions = {
  gameType: "Singles" | "Doubles";
  weather: "" | "Sun" | "Rain" | "Sand" | "Snow" | "Hail" | "Harsh Sunshine" | "Heavy Rain" | "Strong Winds";
  terrain: "" | "Electric" | "Grassy" | "Misty" | "Psychic";
  critical: boolean;
  multipleTargets: boolean;
  gravity: boolean;
  trickRoom: boolean;
  wonderRoom: boolean;
  magicRoom: boolean;
  fairyAura: boolean;
  attackerSide: SideConditions;
  defenderSide: SideConditions;
  /** Doubles turn only: a Ruin ability on an active Pokémon (calculate.ts makeField; the engine exempts holders). */
  ruin?: { sword?: boolean; beads?: boolean; tablets?: boolean; vessel?: boolean };
  /** Doubles turn only: Dark Aura and Aura Break on an active Pokémon. */
  darkAura?: boolean;
  auraBreak?: boolean;
  /**
   * Doubles turn only: the move has one target as it starts, so a Z-Move whose own target is a spread one (Clangorous
   * Soulblaze) takes no spread modifier (pinned Showdown sim/battle-actions.ts trySpreadMoveHit sets spreadHit only for
   * more than one target).
   */
  oneTarget?: boolean;
};

/**
 * hits: the chosen hit count; unset, a random count (2–5 hit moves, Loaded Dice Population Bomb) gives the
 * row's `hitChances` range, and a move that checks accuracy for every hit has all of them land.
 * doubled: the event that doubles a move in EVENT_DOUBLING_MOVES happened (event-moves.ts).
 * fainted / timesHit / party: Last Respects, Rage Fist and Beat Up counts (count-moves.ts).
 */
export type MoveContext = {
  hits?: number; useZ?: boolean; stellarFirstUse?: boolean; doubled?: boolean;
  fainted?: number; timesHit?: number; party?: readonly string[];
  /**
   * The turn order chosen for a move that depends on it: Analytic's user moves "last" (after every
   * other Pokémon) or "first" (someone moves after it); Bolt Beak and Fishious Rend move "first"
   * (before the target, or the target switched in) or "last". Unset, it is worked out when it can be.
   */
  turnOrder?: "first" | "last";
};
export type BuildIssue = { field: string; message: string };

export type MoveDamageResult = {
  moveId: string;
  effectiveName?: string;
  effectiveType?: string;
  effectivePower?: number;
  effectiveCategory?: "Physical" | "Special" | "Status";
  kind: "calculated" | "status" | "needs-context" | "unsupported";
  min: number | null;
  max: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  /** Engine roll structure is retained; nested arrays are not flattened. */
  rolls: number | number[] | number[][] | null;
  ohkoChance: number | null;
  description: string;
  assumptions: string[];
  reason: string | null;
  /**
   * The hits that land: the fixed or chosen count (Parental Bond's two strikes are 2), or with `hitChances`
   * the largest count that can land, after `attackerFaintsOnHit`. null: no count resolved (a row with no
   * damage result), or a random count into a target no hit reaches (an immune target: pinned Showdown
   * rolls the count only in hitStepMoveHitLoop, after the immunity steps).
   */
  hits: number | null;
  /**
   * The hit count rule the calculation used (hit-count.ts hitCountRule for the attacker it settled on, so a
   * transformed Imposter user's copied Skill Link counts), for the move details' hit selector. Set on rows
   * where the count was resolved: calculated rows and a stale chosen count's "Needs the hit count" row.
   */
  hitRule?: HitCountRule;
  /**
   * Set when the hit count is random and none is chosen (pinned Showdown hitStepMoveHitLoop): a 2–5 hit
   * move (2 and 3 hits 35% each, 4 and 5 hits 15% each; with Loaded Dice 4 or 5 hits, 50% each) or
   * Population Bomb with Loaded Dice (4–10 hits, 1/7 each). Each count of hits that land with its chance,
   * ascending by hits, chances summing to 1, after `attackerFaintsOnHit` (the counts it cuts short merge
   * into its hit). `hits` is the largest count and `rolls` holds that many hits (number[][], one roll set
   * per hit in hit order), so a count's damage is the sum of its first hits; min/max and their percents run
   * from the fewest hits at their lowest rolls to the most hits at their highest rolls.
   */
  hitChances?: { hits: number; chance: number }[];
  /**
   * The attacker faints on this hit from the damage the target deals back on a hit (Rough Skin, Iron Barbs,
   * Rocky Helmet, a Jaboca or Rowap Berry, Gulp Missile), net of its own healing between hits, so no later
   * hit lands (pinned Showdown hitStepMoveHitLoop stops once the user has fainted against one target). `of`
   * is the count it would otherwise make (the fixed, chosen or largest random count), and for a random count
   * `ofMin` the fewest of its counts that reach `hit` (the counts it cuts short run from `ofMin` to `of`);
   * `by` names the sources in the order they hit. `hits`, `hitChances`, `rolls` and the damage already stop
   * at `hit`. Unset when the hit it faints on hangs on the rolls (draining heals by what a hit dealt: Parental
   * Bond's Drain Punch): `rolls` and `hits` then reach the latest hit that can land, min runs to the earliest
   * faint at the lowest rolls and max to the latest at the highest, and an assumption states the faint's chance.
   */
  attackerFaintsOnHit?: { hit: number; of: number; ofMin?: number; by: string[] };
  /**
   * Set by the calculation when the target it settled on (a Sturdy copied by Trace or Imposter included,
   * after Mold Breaker, Neutralizing Gas, Magic Room and Klutz) keeps a survival effect that this hit's
   * damage reaches: Focus Sash or Sturdy at full HP, or Focus Band. The HP preview withholds on it.
   */
  survival?: "Focus Sash" | "Focus Band" | "Sturdy";
  /**
   * False Swipe and Hold Back (not their Z-Move or Max Move): the hit leaves the target at least 1 HP
   * (pinned Showdown onDamage returns target.hp - 1) before any survival effect can act, so survival is
   * never set and ohkoChance is 0. The rolls stay before that cap; the HP preview stops at 1 HP.
   */
  leavesOneHP?: true;
  /**
   * A second outcome with its own chance, such as Fickle Beam's 30% doubled power or the 50% physical hit
   * of a Shell Side Arm tie. The main fields describe the case usualLabel names; ohkoChance weighs both.
   */
  alternate?: { chance: number; label: string; usualLabel: string; min: number; max: number; minPercent: number; maxPercent: number; rolls: number[] };
  /** How many uses of this move in a row knock the target out (app/lib/battle/uses-to-ko.ts); set on calculated rows. */
  usesToKO?: UsesToKO;
  /**
   * One use from the target's HP when the move starts (after any berry it ate before the move), its hits
   * walked as pinned Showdown does: the hits stop once the target faints, Focus Sash or Sturdy at full HP
   * leaves 1 HP on the first hit only, and the target's HP berries eat at its line between hits and after
   * the last. Set on calculated rows when the result is exact; the HP preview and, for rows with more than
   * one hit, ohkoChance come from it.
   */
  afterUse?: AfterUse;
};

/** The target's HP after one use (MoveDamageResult.afterUse); HP values are whole HP except `average`. */
export type AfterUse = {
  /** The target's HP when the move starts. */
  start: number;
  /** HP left with every hit at its lowest roll and the fewest hits. */
  low: number;
  /** HP left with every hit at its highest roll and the most hits. */
  high: number;
  /** Expected HP left over every hit count and roll sequence (exact, not rounded). */
  average: number;
  /** The least and the most HP left over every hit count and roll sequence. */
  min: number;
  max: number;
  /**
   * Chance (0–1) the use knocks the target out, before the end of the turn. With a confused attacker it
   * includes the chance the attacker hits itself instead (the HP values above are for the move being used).
   */
  koChance: number;
  /** HP the target regains during or right after the hits on some sequence, as facts ("Sitrus Berry: +45 HP."). */
  heals: string[];
  /** The one sequence each of `low` and `high` is (AfterUsePath), where it was walked; added to the contract for the HP preview's damage. */
  paths?: { low: AfterUsePath; high: AfterUsePath };
};

/** One roll path of AfterUse: the HP its hits took off (the HP lost plus the HP regained) and the healing on it. */
export type AfterUsePath = { dealt: number; heals: string[] };

/**
 * A side's HP when the move starts, set when it ate an HP berry or drank Berry Juice before the move (or Cheek
 * Pouch healed it as it ate another Berry there). HP values are base (pre-Dynamax) HP, as BattleBuild.currentHP.
 */
export type SettledHP = {
  /** HP when the move starts, after the item. */
  hp: number;
  /** The HP as entered. */
  entered: number;
  maxHP: number;
  /** The item's name ("Sitrus Berry"). */
  item: string;
};

/**
 * Repeated uses of one move by the same attacker into the same target, from the target's current HP,
 * with both staying in and the target doing nothing that changes it. Each use is conditional on hitting
 * (accuracy is not applied), with no critical hits unless the field's Critical hit is set or the
 * attacker's critical-hit ratio makes every hit critical (calculate.ts critRatioStage), the chosen or
 * fixed hit count on every use (a random count rolls its own count each use, with the chances the
 * attacker has then), and the field as set. The state each use leaves (stat stages, items used up,
 * abilities, forms, the attacker's HP, counters, end-of-turn healing and damage) carries into the next.
 */
export type UsesToKO =
  | {
    kind: "uses";
    /** Uses that knock the target out whatever the rolls (the worst roll sequence); null: more than `limit`. */
    guaranteed: number | null;
    /** The fewest uses that can knock it out (the best roll sequence); null: more than `limit`. */
    fewest: number | null;
    /**
     * Chance (0-1) that guaranteed - 1 uses are enough, each use rolling its own damage; set when that is at
     * least 1 use and possible. For guaranteed 2 it is the chance one use (with that turn's end) knocks out,
     * which can differ from ohkoChance (a multi-hit move, end-of-turn damage).
     */
    fasterChance?: number;
    /** With no guarantee (guaranteed null): the chance (0-1) the target is out within `limit` uses and before the attacker faints, when some roll sequence does it. */
    chance?: number;
    /** Some roll sequence makes the attacker faint (recoil, Life Orb, Rough Skin...) before the target is out, so no count is guaranteed. */
    faintsFirst?: true;
    /** End-of-turn damage on the target (weather, status, Black Sludge...) can be what knocks it out, so a count can be lower than the hits alone need. */
    endOfTurn?: true;
    /** The most uses counted, and why: the move's PP with PP Ups (halved by the target's Pressure), the uses the attacker's own HP allows (Steel Beam, Mind Blown, Chloroblast), or the calculation cap. */
    limit: number;
    limitReason: "pp" | "pressure" | "self-cost" | "cap";
    /**
     * With no guarantee within `limit` and no sequence fainting the attacker first there: the guaranteed count with the
     * limit lifted (the worst roll sequence's uses, none fainting the attacker first), when known (uses-to-ko.ts neededUses).
     * Never set for Steel Beam's family, whose own cost sets the limit.
     */
    needed?: number;
    /** What the count follows, in short sentences ("Draco Meteor lowers the attacker's Sp. Atk after each use."). */
    carried: string[];
    /** What the count leaves out, in short sentences ("Assumes 3 hits on every use."). */
    notes: string[];
    /** A survival effect that stops the first use's KO (full-HP Focus Sash or Sturdy). */
    survival?: "Focus Sash" | "Sturdy";
    /** The use after which the attacker faints, on the lowest and the highest roll paths, when within the count. */
    attackerFaints?: { lowest?: number; highest?: number };
    /** Turns that are not uses: "Recharges after each use", "Charges for a turn before each use", "Truant: one use every other turn". */
    turns?: string;
  }
  /**
   * One use at most: the user faints (Explosion, Final Gambit), the move works only on its first turn out
   * (Fake Out, First Impression) or once per battle (a Z-Move), or the move cannot be used again (Burn Up,
   * Steel Roller...). koChance: the chance that use knocks out, with that turn's end-of-turn damage.
   */
  | { kind: "single-use"; reason: string; koChance: number }
  /** No number of uses knocks it out: False Swipe and Hold Back leave 1 HP, Endeavor stops at the user's HP, and no end-of-turn damage finishes it. */
  | { kind: "never"; reason: string }
  /** The move deals no damage (immune, blocked or fails). */
  | { kind: "no-damage" }
  /** A repeat cannot be counted, with a short reason. */
  | { kind: "not-estimated"; reason: string };
