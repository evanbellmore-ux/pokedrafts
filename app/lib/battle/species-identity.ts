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
export function createSpeciesResolver(species: readonly Pick<ChampionsSpecies, "id" | "name" | "calcName">[], gameLabel = "Champions") {
  const aliases = new Map<string, Set<string>>();
  const engineAliases = new Map<string, Set<string>>();
  for (const entry of species) {
    const engineAlias = normalizeAlias(entry.calcName);
    const engineIDs = engineAliases.get(engineAlias) ?? new Set<string>();
    engineIDs.add(entry.id);
    engineAliases.set(engineAlias, engineIDs);
    const names = [entry.id, entry.name];
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
    // A shared engine name describes mechanics, not the chosen cosmetic form.
    // Prefer catalog aliases; keep unique engine-only aliases such as Aegislash-Shield.
    const alias = normalizeAlias(name);
    const ids = aliases.get(alias) ?? engineAliases.get(alias);
    if (!ids?.size) return { status: "unavailable", reason: `No exact ${gameLabel} match. Use the manual Pokémon selector.` };
    if (ids.size !== 1) return { status: "ambiguous", reason: `This name matches multiple ${gameLabel} forms. Choose the form manually.` };
    return { status: "resolved", speciesId: [...ids][0] };
  };
}

export const resolveRosterSpecies = createSpeciesResolver(champions.species);
