import { join } from "node:path";
import { Generations, Move } from "@smogon/calc";
import { isAvailable, toID, type AvailableData } from "../champions-data/transform";
import { canonical, loadModule, sha256 } from "./sources";
import {
  NATIVE_GAMES,
  type DexAPI,
  type NativeEngineSnapshot,
  type NativeLearnset,
  type NativeLearnsetSource,
  type NativeProfile,
  type NativeSnapshot,
} from "./types";

type RawLearnset = { learnset?: Record<string, string[]> } | null;

export function loadNativeSnapshots(runtime: string): NativeSnapshot[] {
  // Record the owner of the actual table object BEFORE Dex.loadData mutates and
  // merges module exports. Native inheritance is valid provenance; unlike
  // Champions, an inherited gen8/base table MUST NOT be treated as unproven.
  const origins = new WeakMap<object, Omit<NativeLearnsetSource, "speciesId">>();
  for (const [mod, file] of [["base", "data/learnsets"], ["gen8", "data/mods/gen8/learnsets"]]) {
    const raw = loadModule(join(runtime, `${file}.js`)) as { Learnsets: Record<string, RawLearnset> };
    for (const [id, row] of Object.entries(raw.Learnsets)) {
      if (!row?.learnset) continue;
      origins.set(row.learnset, {
        mod, file: `${file}.ts`, declarationSpeciesId: id,
        sha256: sha256(canonical(row.learnset)),
        markerGenerations: [...new Set(Object.values(row.learnset).flat().map((marker) => Number(marker[0])))].sort(),
      });
    }
  }
  const { Dex } = loadModule(join(runtime, "sim/dex.js")) as { Dex: DexAPI };
  return NATIVE_GAMES.map((profile) => {
    const dex = Dex.mod(profile.mod);
    const ancestry: string[] = [];
    for (let mod: DexAPI | undefined = dex; mod; mod = mod.parentMod ? Dex.mod(mod.parentMod) : undefined) {
      if (ancestry.includes(mod.currentMod)) throw new Error(`Cyclic native mod ancestry: ${profile.mod}`);
      ancestry.push(mod.currentMod);
    }
    if (dex.gen !== profile.gen || JSON.stringify(ancestry) !== JSON.stringify(profile.ancestry)) {
      throw new Error(`Pinned ${profile.mod} ancestry changed; review compilation and provenance before regenerating.`);
    }
    const describe = (row: AvailableData) => {
      const text = dex.text.get(row);
      return text.desc || text.shortDesc || "";
    };
    const speciesRows = [...dex.species.all()];
    const knownIDs = new Set(speciesRows.map((row) => row.id));
    // all() only walks actual Pokedex keys. Some genuine cosmetic identities
    // (Alcremie-Salted-Cream, Unown letters) exist solely in cosmeticFormes and
    // are synthesized by the pinned get() API. Enumerate that explicit list,
    // never arbitrary suffixes or a guessed base-species fallback.
    for (const row of [...speciesRows].filter(isAvailable)) {
      for (const name of row.cosmeticFormes ?? []) {
        if (knownIDs.has(toID(name))) continue;
        const cosmetic = dex.species.get(name);
        if (!cosmetic.exists || cosmetic.id !== toID(name) || !cosmetic.isCosmeticForme) {
          throw new Error(`Unresolved source-declared cosmetic identity: ${name}`);
        }
        speciesRows.push(cosmetic);
        knownIDs.add(cosmetic.id);
      }
    }
    return {
      profile, ancestry,
      species: speciesRows.map((row) => {
        const learnset: NativeLearnset = { movePool: [], sources: [] };
        if (isAvailable(row) && !row.placeholderFor) {
          try {
            learnset.sources = dex.species.getFullLearnset(row.id).map((entry) => {
              const origin = origins.get(entry.learnset);
              if (!origin || !ancestry.includes(origin.mod)) {
                throw new Error(`Unverified native learnset table: ${row.id} -> ${entry.species.id}`);
              }
              return { speciesId: entry.species.id, ...origin };
            });
            // Use pinned regional-evolution, pre-evolution, Sketch, HM-transfer
            // and HOME-reset semantics; never synthesize a marker-based union.
            learnset.movePool = [...dex.species.getMovePool(row.id, false)];
          } catch (error) {
            learnset.error = error instanceof Error ? error.message : String(error);
          }
        }
        const alias = row.isCosmeticForme ? dex.getAlias(row.id) : undefined;
        const cosmeticParent = alias ? dex.species.get(alias) : undefined;
        return {
          id: row.id, name: row.name, gen: row.gen, exists: row.exists, isNonstandard: row.isNonstandard,
          baseSpecies: row.baseSpecies, baseForme: row.baseForme, types: row.types,
          baseStats: row.baseStats, weightkg: row.weightkg, abilities: row.abilities,
          gender: row.gender, isCosmeticForme: row.isCosmeticForme,
          cosmeticFormes: row.cosmeticFormes,
          ...(cosmeticParent?.id !== row.id && cosmeticParent ? { cosmeticParent: cosmeticParent.id } : {}),
          placeholderFor: row.placeholderFor, battleOnly: row.battleOnly,
          changesFrom: row.changesFrom, isMega: row.isMega,
          requiredItem: row.requiredItem, requiredItems: row.requiredItems,
          requiredMove: row.requiredMove, requiredTeraType: row.requiredTeraType,
          canGigantamax: row.canGigantamax, cannotDynamax: row.cannotDynamax,
          gmaxUnreleased: row.gmaxUnreleased, learnset,
        };
      }),
      moves: dex.moves.all().map((row) => ({
        // DataMove deliberately collapses Hidden Power placeholders to the base
        // ID; our catalog preserves their explicit typed display/engine IDs.
        id: row.placeholderFor === "Hidden Power" ? toID(row.name) : row.id,
        name: row.name, gen: row.gen, exists: row.exists, isNonstandard: row.isNonstandard,
        placeholderFor: row.placeholderFor, type: row.type, category: row.category,
        basePower: row.basePower, accuracy: row.accuracy, priority: row.priority, target: row.target,
        multihit: row.multihit, ohko: row.ohko, description: describe(row),
        isZ: row.isZ, isMax: row.isMax, zMove: row.zMove, maxMove: row.maxMove,
      })),
      abilities: dex.abilities.all().map((row) => ({
        id: row.id, name: row.name, exists: row.exists, isNonstandard: row.isNonstandard, description: describe(row),
      })),
      items: dex.items.all().map((row) => ({
        id: row.id, name: row.name, exists: row.exists, isNonstandard: row.isNonstandard,
        megaStone: row.megaStone, description: describe(row), zMoveType: row.zMoveType,
        zMove: row.zMove, zMoveFrom: row.zMoveFrom, itemUser: row.itemUser,
      })),
    };
  });
}

export function loadNativeEngine(profile: NativeProfile): NativeEngineSnapshot {
  const generation = Generations.get(profile.gen);
  return {
    num: generation.num,
    species: [...generation.species],
    // Status category defaults belong to the Move API, not raw table absence.
    // Compare raw power/type: contextual constructor changes (Return's assumed
    // happiness, Struggle's typeless damage) are not species/move-data drift.
    moves: [...generation.moves].map((row) => ({ ...row, category: new Move(generation, row.name).category })),
    abilities: [...generation.abilities],
    items: [...generation.items],
  };
}
