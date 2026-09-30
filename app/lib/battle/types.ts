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

export type NativeCatalog = Omit<ChampionsCatalog, "game" | "level"> & {
  game: NativeBattleGame;
  level: null;
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
  /** Set only by the calculation for a transformed Imposter user: its own species and base HP. */
  transformedFrom?: { speciesId: string; baseHP: number };
  /**
   * Set only by the calculation: the stat Download raised on entry, already in the stages, when the
   * foe transformed after it (the engine would read the transformed foe's defenses instead).
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
  /** This side's Pokémon is protecting (Protect, Detect or a similar move) this turn. */
  protect: boolean;
  /** Tailwind is active on this side, doubling its Pokémon's Speed. */
  tailwind: boolean;
  /** This side's Pokémon used Charge, doubling the power of its next Electric attack. */
  charge: boolean;
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
};

/**
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
  hits: number | null;
  /**
   * A second outcome with its own chance, such as Fickle Beam's 30% doubled power. The main fields
   * describe the usual case; ohkoChance weighs both.
   */
  alternate?: { chance: number; label: string; min: number; max: number; minPercent: number; maxPercent: number; rolls: number[] };
};
