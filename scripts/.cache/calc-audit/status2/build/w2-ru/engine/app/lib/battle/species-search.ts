import { LEGACY_ROSTER_ALIASES, POOL_BUILDER_ROSTER_ALIASES, resolveRosterName } from "./roster-identity";
import type { BattleRuntime } from "./runtime";
import { catalogAliasNames } from "./species-identity";
import type { ChampionsSpecies } from "./types";

/** Search text is compared after lowercasing and removing everything but letters and digits. */
export function normalizeSearchText(text: string) {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Pool Builder / legacy roster names by the species id they resolve to. */
const rosterNamesById = new Map<string, string[]>();
for (const [name, alias] of Object.entries({ ...LEGACY_ROSTER_ALIASES, ...POOL_BUILDER_ROSTER_ALIASES })) {
  const id = typeof alias === "string" ? alias : alias.speciesId;
  rosterNamesById.set(id, [...(rosterNamesById.get(id) ?? []), name]);
}

/**
 * Every name a coach might type for one form, for substring search rather than
 * identity: the Showdown name, id and base species; the calculator's catalog
 * aliases ("Mega Charizard X", "Alolan Raichu"); gender words for -F and -M forms
 * ("Meowstic Female"), and "Male" for a plain form whose female is a separate
 * "-F" form (Showdown's male Meowstic is plain "Meowstic"); and the Pool Builder
 * and legacy roster names that resolve to this form ("Paldean Tauros (Blaze
 * Breed)", "Floette (Eternal Flower)"). Anything the league roster lookup accepts
 * for a form is therefore findable.
 */
export function speciesSearchNames(entry: Pick<ChampionsSpecies, "id" | "name" | "baseSpecies">, hasFemaleForm = false): string[] {
  const names = [...catalogAliasNames(entry), entry.baseSpecies];
  for (const [marker, word] of [["F", "Female"], ["M", "Male"]] as const) {
    const pattern = new RegExp(`-${marker}(?=-|$)`);
    if (pattern.test(entry.name)) names.push(entry.name.replace(pattern, ` ${word}`));
  }
  if (hasFemaleForm) names.push(`${entry.name} Male`);
  return [...names, ...(rosterNamesById.get(entry.id) ?? [])];
}

/** "male" is inside "female": a typed "male" must match the word, not the tail of "female". */
function containsToken(text: string, token: string) {
  return token === "male" ? text.replace(/female/g, "").includes(token) : text.includes(token);
}

/**
 * The chooser's search: every typed word must appear in the form's search text,
 * so "Alolan Raichu", "Raichu Alola" and "raichu" all find Raichu-Alola. Results
 * keep the catalog's alphabetical order by Showdown name.
 */
export function createSpeciesSearch(runtime: BattleRuntime) {
  const names = new Set(runtime.catalog.species.map((entry) => entry.name));
  const entries = [...runtime.catalog.species]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((entry) => ({ entry, text: speciesSearchNames(entry, names.has(`${entry.name}-F`)).map(normalizeSearchText).join(" ") }));
  return (query: string): ChampionsSpecies[] => {
    const tokens = query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean);
    // Only punctuation or a non-Latin script leaves no word to match: show no results.
    if (!tokens.length && query.trim()) return [];
    const matches = entries.filter(({ text }) => tokens.every((token) => containsToken(text, token))).map(({ entry }) => entry);
    // Any other spelling the league roster lookup accepts ("Ninetales-Alolan", a PokéAPI slug) finds its form.
    const resolved = query.trim() ? resolveRosterName(runtime, query.trim()) : null;
    const form = resolved?.status === "resolved" ? runtime.speciesById.get(resolved.speciesId) : undefined;
    return form && !matches.includes(form) ? [form, ...matches] : matches;
  };
}
