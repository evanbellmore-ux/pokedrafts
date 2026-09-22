import { champions } from "./catalog";
import type { ChampionsSpecies } from "./types";

export type SpeciesResolution =
  | { status: "resolved"; speciesId: string }
  | { status: "unavailable" | "ambiguous"; reason: string };

function normalizeAlias(name: string) {
  return name.normalize("NFKD").toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f").replace(/♂/g, "m")
    .replace(/\bfemale\b/g, "f").replace(/\bmale\b/g, "m")
    .replace(/[\s._'’‘:()[\]-]/g, "");
}

/** Only complete, catalog-backed aliases; search tokens are not species identities. */
export function createSpeciesResolver(species: readonly Pick<ChampionsSpecies, "id" | "name" | "calcName">[]) {
  const aliases = new Map<string, Set<string>>();
  for (const entry of species) {
    const names = [entry.id, entry.name, entry.calcName];
    const mega = entry.name.match(/^(.+)-Mega(?:-(X|Y|Z))?$/);
    if (mega) names.push(`Mega ${mega[1]} ${mega[2] ?? ""}`);
    const regional = entry.name.match(/^(.+)-(Alola|Galar|Hisui|Paldea)(.*)$/);
    if (regional) {
      const adjectives: Record<string, string> = { Alola: "Alolan", Galar: "Galarian", Hisui: "Hisuian", Paldea: "Paldean" };
      names.push(`${adjectives[regional[2]]} ${regional[1]}${regional[3]}`);
    }
    for (const name of names) {
      const alias = normalizeAlias(name);
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(entry.id);
      aliases.set(alias, ids);
    }
  }
  return (name: string): SpeciesResolution => {
    const ids = aliases.get(normalizeAlias(name));
    if (!ids?.size) return { status: "unavailable", reason: "No exact Champions match. Use the manual Pokémon selector." };
    if (ids.size !== 1) return { status: "ambiguous", reason: "This name matches multiple Champions forms. Choose the form manually." };
    return { status: "resolved", speciesId: [...ids][0] };
  };
}

export const resolveRosterSpecies = createSpeciesResolver(champions.species);
