import type {
  ChampionsCatalog,
  ChampionsItem,
  ChampionsMove,
  ChampionsSpecies,
  RandomBattle,
} from "../../../app/lib/battle/types";
import type {
  AvailableData,
  EngineSnapshot,
  ResolvedAbility,
  ResolvedItem,
  ResolvedMove,
  ResolvedSpecies,
} from "../champions-data/transform";

// randomBattleSets: pinned Showdown Random Battle set files per format (gen 7 and 8 publish Singles only),
// and randomBattleFormats: the pinned format whose team generator reads each file.
export const NATIVE_GAMES = [
  { game: "ultra_sun_ultra_moon", gen: 7, mod: "gen7", ancestry: ["gen7", "gen8", "base"], randomBattleSets: { Singles: "data/random-battles/gen7/sets.json" }, randomBattleFormats: { Singles: "gen7randombattle" } },
  { game: "sword_shield", gen: 8, mod: "gen8", ancestry: ["gen8", "base"], randomBattleSets: { Singles: "data/random-battles/gen8/sets.json" }, randomBattleFormats: { Singles: "gen8randombattle" } },
  { game: "scarlet_violet", gen: 9, mod: "gen9", ancestry: ["base"], randomBattleSets: { Singles: "data/random-battles/gen9/sets.json", Doubles: "data/random-battles/gen9/doubles-sets.json" }, randomBattleFormats: { Singles: "gen9randombattle", Doubles: "gen9randomdoublesbattle" } },
] as const;
/** Teams the build generates per Random Battle format, and the fixed Gen 5 RNG seed (no sodium PRNG needed). */
export const RANDOM_BATTLE_RUN = { teams: 10000, seed: "1,2,3,4" } as const;
/** The pinned team generators whose getForme maps Random Battle set keys to forms. */
export const RANDOM_BATTLE_CODE = ["data/random-battles/gen7/teams.ts", "data/random-battles/gen8/teams.ts", "data/random-battles/gen9/teams.ts"] as const;
export type NativeProfile = typeof NATIVE_GAMES[number];
export type NativeGame = NativeProfile["game"];
export type NativeSpecies = ChampionsSpecies & {
  gender?: "M" | "F" | "N";
  canGigantamax?: string;
  gmaxNames?: string[];
  cannotDynamax?: boolean;
  requiredItems?: string[];
  requiredMove?: string;
  requiredTeraType?: string;
  changesFrom?: string;
  battleOnly?: string[];
};
export type NativeMove = ChampionsMove & {
  isZ?: boolean;
  isMax?: boolean;
  zMovePower?: number;
  maxMovePower?: number;
};
export type NativeItem = ChampionsItem & {
  zMoveType?: string;
  zMove?: string;
  zMoveFrom?: string;
  itemUser?: string[];
};
export type NativeCatalog = Omit<ChampionsCatalog, "game" | "level" | "species" | "moves" | "items"> & {
  game: NativeGame;
  level: null;
  species: NativeSpecies[];
  moves: NativeMove[];
  items: NativeItem[];
  randomBattle?: RandomBattle;
};

export type NativeLearnsetSource = {
  speciesId: string;
  mod: string;
  file: string;
  declarationSpeciesId: string;
  sha256: string;
  markerGenerations: number[];
};
export type NativeLearnset = {
  movePool: string[];
  sources: NativeLearnsetSource[];
  /** Moves getMovePool offers (still in movePool) that pinned Showdown's team validator says this form cannot know. */
  validatorRejected?: string[];
  error?: string;
};
export type NativeResolvedSpecies = Omit<ResolvedSpecies, "learnset"> & {
  gen: number;
  baseForme: string;
  gender?: "M" | "F" | "N" | "";
  isCosmeticForme?: boolean;
  cosmeticFormes?: readonly string[];
  /** Proven Dex alias, captured only for a source-declared cosmetic form. */
  cosmeticParent?: string;
  placeholderFor?: string;
  canGigantamax?: string;
  cannotDynamax?: boolean;
  gmaxUnreleased?: boolean;
  requiredMove?: string;
  requiredTeraType?: string;
  requiredAbility?: string;
  otherFormes?: readonly string[];
  learnset: NativeLearnset;
};
export type NativeResolvedMove = ResolvedMove & {
  gen: number;
  placeholderFor?: string;
  isZ?: boolean | string;
  isMax?: boolean | string;
  zMove?: { basePower?: number };
  maxMove?: { basePower: number };
};
export type NativeResolvedItem = ResolvedItem & {
  zMoveType?: string;
  zMove?: true | string;
  zMoveFrom?: string;
  itemUser?: readonly string[];
};
export type NativeSnapshot = {
  profile: NativeProfile;
  ancestry: string[];
  species: NativeResolvedSpecies[];
  moves: NativeResolvedMove[];
  abilities: ResolvedAbility[];
  items: NativeResolvedItem[];
};
export type NativeEngineSnapshot = Omit<EngineSnapshot, "species" | "moves"> & {
  species: (EngineSnapshot["species"][number] & {
    gender?: "M" | "F" | "N";
    canGigantamax?: string;
  })[];
  moves: (EngineSnapshot["moves"][number] & {
    isZ?: boolean | string;
    isMax?: boolean | string;
    zMove?: { basePower?: number };
    maxMove?: { basePower: number };
  })[];
};
export type DexAPI = {
  gen: number;
  currentMod: string;
  parentMod: string;
  mod(name: string): DexAPI;
  getAlias(id: string): string | undefined;
  species: {
    all(): Omit<NativeResolvedSpecies, "learnset">[];
    get(id: string): Omit<NativeResolvedSpecies, "learnset">;
    getFullLearnset(id: string): {
      species: { id: string };
      learnset: Record<string, string[]>;
    }[];
    getMovePool(id: string, isNatDex?: boolean): Set<string>;
  };
  moves: { all(): Omit<NativeResolvedMove, "description">[]; get(id: string): Omit<NativeResolvedMove, "description"> };
  abilities: { all(): Omit<ResolvedAbility, "description">[] };
  items: { all(): Omit<NativeResolvedItem, "description">[] };
  text: { get(row: AvailableData): { desc?: string; shortDesc?: string } };
};
