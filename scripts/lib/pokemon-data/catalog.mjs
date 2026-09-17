// In-memory index over the stripped PokéAPI cache. Pure: built from arrays,
// no filesystem or network, so tests build one from the fixture directory
// and the script builds one from scripts/.cache/pokeapi/.

/**
 * @typedef {import("./strip.mjs").StrippedSpecies} StrippedSpecies
 * @typedef {import("./strip.mjs").StrippedPokemon} StrippedPokemon
 * @typedef {import("./strip.mjs").StrippedForm} StrippedForm
 * @typedef {import("./strip.mjs").StrippedPokedex} StrippedPokedex
 * @typedef {import("./strip.mjs").StrippedVersionGroup} StrippedVersionGroup
 * @typedef {import("./strip.mjs").StrippedGeneration} StrippedGeneration
 *
 * @typedef {{
 *   speciesById: Map<number, StrippedSpecies>,
 *   speciesByName: Map<string, StrippedSpecies>,
 *   pokemonByName: Map<string, StrippedPokemon>,
 *   formByName: Map<string, StrippedForm>,
 *   pokedexByName: Map<string, StrippedPokedex>,
 *   versionGroupByName: Map<string, StrippedVersionGroup>,
 *   generationByName: Map<string, StrippedGeneration>,
 * }} Catalog
 */

/**
 * @param {{
 *   species: StrippedSpecies[],
 *   pokemon: StrippedPokemon[],
 *   forms: StrippedForm[],
 *   pokedexes?: StrippedPokedex[],
 *   versionGroups?: StrippedVersionGroup[],
 *   generations?: StrippedGeneration[],
 * }} input
 * @returns {Catalog}
 */
export function buildCatalog(input) {
  /** @type {Catalog} */
  const catalog = {
    speciesById: new Map(),
    speciesByName: new Map(),
    pokemonByName: new Map(),
    formByName: new Map(),
    pokedexByName: new Map(),
    versionGroupByName: new Map(),
    generationByName: new Map(),
  };
  for (const species of input.species) {
    catalog.speciesById.set(species.id, species);
    catalog.speciesByName.set(species.name, species);
  }
  for (const pokemon of input.pokemon) {
    catalog.pokemonByName.set(pokemon.name, pokemon);
  }
  for (const form of input.forms) {
    catalog.formByName.set(form.name, form);
  }
  for (const pokedex of input.pokedexes ?? []) {
    catalog.pokedexByName.set(pokedex.name, pokedex);
  }
  for (const versionGroup of input.versionGroups ?? []) {
    catalog.versionGroupByName.set(versionGroup.name, versionGroup);
  }
  for (const generation of input.generations ?? []) {
    catalog.generationByName.set(generation.name, generation);
  }
  return catalog;
}

/**
 * The record's English name, falling back to a title-cased slug.
 *
 * @param {{ name: string, names?: Array<{ name: string, language: { name: string } }> }} record
 */
export function englishName(record) {
  const english = record.names?.find((entry) => entry.language?.name === "en")?.name;
  if (english) {
    return english;
  }
  return titleCaseSlug(record.name);
}

/**
 * "rapid-strike" -> "Rapid Strike".
 *
 * @param {string} slug
 */
export function titleCaseSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The species' default variety record.
 *
 * @param {Catalog} catalog
 * @param {StrippedSpecies} species
 */
export function defaultVarietyOf(catalog, species) {
  const entry = species.varieties.find((variety) => variety.is_default) ?? species.varieties[0];
  if (!entry) {
    throw new Error(`Species ${species.name} lists no varieties.`);
  }
  const pokemon = catalog.pokemonByName.get(entry.pokemon.name);
  if (!pokemon) {
    throw new Error(
      `Species ${species.name}: default variety ${entry.pokemon.name} is not in the cache.`
    );
  }
  return pokemon;
}

/**
 * The pokemon-form record that describes a variety: the form named like the
 * variety when there is one, otherwise its first listed form.
 *
 * @param {Catalog} catalog
 * @param {StrippedPokemon} pokemon
 * @returns {StrippedForm | null}
 */
export function formOf(catalog, pokemon) {
  const named = catalog.formByName.get(pokemon.name);
  if (named) {
    return named;
  }
  const first = pokemon.forms[0];
  return first ? (catalog.formByName.get(first.name) ?? null) : null;
}

/**
 * Generation number for a species ("generation-ix" -> 9), from the cached
 * generation record when present, else from the roman numeral in the name.
 *
 * @param {Catalog} catalog
 * @param {StrippedSpecies} species
 */
export function generationNumber(catalog, species) {
  const name = species.generation.name;
  const record = catalog.generationByName.get(name);
  if (record) {
    return record.id;
  }
  const parsed = romanToInt(name.replace(/^generation-/, ""));
  if (!parsed) {
    throw new Error(`Species ${species.name}: cannot read generation "${name}".`);
  }
  return parsed;
}

const ROMAN = /** @type {Record<string, number>} */ ({ i: 1, v: 5, x: 10, l: 50, c: 100 });

/** @param {string} value */
function romanToInt(value) {
  let total = 0;
  const chars = value.toLowerCase().split("");
  for (let index = 0; index < chars.length; index += 1) {
    const current = ROMAN[chars[index]];
    const next = ROMAN[chars[index + 1]] ?? 0;
    if (!current) {
      return 0;
    }
    total += current < next ? -current : current;
  }
  return total;
}
