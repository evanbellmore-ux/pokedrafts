import manifest from "@/data/champions/manifest.json";
import { abilitiesById, champions, itemsById, movesById, speciesById } from "./catalog";
import { BATTLE_PROFILES, type BattleProfile } from "./profiles";
import { createSpeciesResolver } from "./species-identity";
import type { BattleCatalog, ChampionsAbility, ChampionsItem, ChampionsMove, ChampionsSpecies } from "./types";

export type BattleRuntime = {
  readonly identity: string;
  readonly profile: BattleProfile;
  readonly catalog: BattleCatalog;
  readonly speciesById: ReadonlyMap<string, ChampionsSpecies>;
  readonly movesById: ReadonlyMap<string, ChampionsMove>;
  readonly abilitiesById: ReadonlyMap<string, ChampionsAbility>;
  readonly itemsById: ReadonlyMap<string, ChampionsItem>;
};

const resolvers = new WeakMap<BattleRuntime, ReturnType<typeof createSpeciesResolver>>();

/** Keep executable caches outside preparation state so snapshots remain cloneable. */
export function resolveRuntimeSpecies(runtime: BattleRuntime, name: string) {
  let resolve = resolvers.get(runtime);
  if (!resolve) {
    resolve = createSpeciesResolver(runtime.catalog.species, runtime.profile.id === "champions" ? "Champions" : runtime.profile.label);
    resolvers.set(runtime, resolve);
  }
  return resolve(name);
}

/** A runtime is owned by a matchup, never installed as a global current game. */
export function createBattleRuntime(catalog: BattleCatalog, catalogSha256: string): BattleRuntime {
  const profile = BATTLE_PROFILES[catalog.game];
  if (!profile || catalog.version !== 1 || !/^[a-f0-9]{64}$/.test(catalogSha256)) {
    throw new Error("The battle catalog has an unsupported profile or identity.");
  }
  return Object.freeze({
    identity: `${profile.id}:${profile.version}:${catalogSha256}`,
    profile,
    catalog,
    speciesById: catalog === champions ? speciesById : new Map(catalog.species.map((row) => [row.id, row])),
    movesById: catalog === champions ? movesById : new Map(catalog.moves.map((row) => [row.id, row])),
    abilitiesById: catalog === champions ? abilitiesById : new Map(catalog.abilities.map((row) => [row.id, row])),
    itemsById: catalog === champions ? itemsById : new Map(catalog.items.map((row) => [row.id, row])),
  });
}

export const championsRuntime = createBattleRuntime(champions, manifest.catalogSha256);
