// Reduces raw PokéAPI responses to the fields the dataset pipeline reads.
// The build script strips every cache entry through these functions before
// handing them to the pure logic, and the unit-test fixture under
// tests/fixtures/pokeapi/ is written with the same functions, so both paths
// see exactly one shape.

/** The cache kinds the pipeline crawls, and the field that keys each one. */
export const CACHE_KINDS = /** @type {const} */ ({
  "pokemon-species": "id",
  pokemon: "name",
  "pokemon-form": "name",
  pokedex: "name",
  "version-group": "name",
  generation: "name",
});

/**
 * @typedef {{ name: string, language: { name: string } }} LocalizedName
 * @typedef {{
 *   id: number,
 *   name: string,
 *   is_legendary: boolean,
 *   is_mythical: boolean,
 *   generation: { name: string },
 *   names: LocalizedName[],
 *   varieties: Array<{ is_default: boolean, pokemon: { name: string } }>,
 *   pokedex_numbers: Array<{ entry_number: number, pokedex: { name: string } }>,
 * }} StrippedSpecies
 * @typedef {{
 *   id: number,
 *   name: string,
 *   is_default: boolean,
 *   species: { name: string },
 *   forms: Array<{ name: string }>,
 *   stats: Array<{ base_stat: number, stat: { name: string } }>,
 *   types: Array<{ slot: number, type: { name: string } }>,
 *   abilities: Array<{ is_hidden: boolean, slot: number, ability: { name: string } }>,
 *   version_groups: string[],
 *   sprites: { front_default: string | null, official_artwork: string | null },
 * }} StrippedPokemon
 * @typedef {{
 *   id: number,
 *   name: string,
 *   form_name: string,
 *   is_default: boolean,
 *   is_battle_only: boolean,
 *   is_mega: boolean,
 *   pokemon: { name: string },
 *   form_names: LocalizedName[],
 *   names: LocalizedName[],
 * }} StrippedForm
 * @typedef {{ id: number, name: string, is_main_series: boolean, version_groups: string[] }} StrippedPokedex
 * @typedef {{ id: number, name: string, generation: string, pokedexes: string[] }} StrippedVersionGroup
 * @typedef {{ id: number, name: string, version_groups: string[] }} StrippedGeneration
 */

/** @param {LocalizedName[] | undefined} names */
function englishOnly(names) {
  return (names ?? [])
    .filter((entry) => entry?.language?.name === "en" && typeof entry.name === "string")
    .map((entry) => ({ name: entry.name, language: { name: "en" } }));
}

/** @param {Array<{ name: string }> | undefined} refs */
function namesOf(refs) {
  return (refs ?? []).map((entry) => entry.name);
}

/**
 * @param {any} raw
 * @returns {StrippedSpecies}
 */
export function stripSpecies(raw) {
  return {
    id: raw.id,
    name: raw.name,
    is_legendary: Boolean(raw.is_legendary),
    is_mythical: Boolean(raw.is_mythical),
    generation: { name: raw.generation?.name ?? "" },
    names: englishOnly(raw.names),
    varieties: (raw.varieties ?? []).map((/** @type {any} */ entry) => ({
      is_default: Boolean(entry.is_default),
      pokemon: { name: entry.pokemon.name },
    })),
    pokedex_numbers: (raw.pokedex_numbers ?? []).map((/** @type {any} */ entry) => ({
      entry_number: entry.entry_number,
      pokedex: { name: entry.pokedex.name },
    })),
  };
}

/**
 * @param {any} raw
 * @returns {StrippedPokemon}
 */
export function stripPokemon(raw) {
  /** @type {Set<string>} */
  const versionGroups = new Set();
  for (const move of raw.moves ?? []) {
    for (const detail of move.version_group_details ?? []) {
      if (detail.version_group?.name) {
        versionGroups.add(detail.version_group.name);
      }
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    is_default: Boolean(raw.is_default),
    species: { name: raw.species.name },
    forms: (raw.forms ?? []).map((/** @type {any} */ entry) => ({ name: entry.name })),
    stats: (raw.stats ?? []).map((/** @type {any} */ entry) => ({
      base_stat: entry.base_stat,
      stat: { name: entry.stat.name },
    })),
    types: (raw.types ?? []).map((/** @type {any} */ entry) => ({
      slot: entry.slot,
      type: { name: entry.type.name },
    })),
    abilities: (raw.abilities ?? []).map((/** @type {any} */ entry) => ({
      is_hidden: Boolean(entry.is_hidden),
      slot: entry.slot,
      ability: { name: entry.ability.name },
    })),
    version_groups: [...versionGroups].sort(),
    sprites: {
      front_default: raw.sprites?.front_default ?? null,
      official_artwork: raw.sprites?.other?.["official-artwork"]?.front_default ?? null,
    },
  };
}

/**
 * @param {any} raw
 * @returns {StrippedForm}
 */
export function stripForm(raw) {
  return {
    id: raw.id,
    name: raw.name,
    form_name: raw.form_name ?? "",
    is_default: Boolean(raw.is_default),
    is_battle_only: Boolean(raw.is_battle_only),
    is_mega: Boolean(raw.is_mega),
    pokemon: { name: raw.pokemon.name },
    form_names: englishOnly(raw.form_names),
    names: englishOnly(raw.names),
  };
}

/**
 * @param {any} raw
 * @returns {StrippedPokedex}
 */
export function stripPokedex(raw) {
  return {
    id: raw.id,
    name: raw.name,
    is_main_series: Boolean(raw.is_main_series),
    version_groups: namesOf(raw.version_groups),
  };
}

/**
 * @param {any} raw
 * @returns {StrippedVersionGroup}
 */
export function stripVersionGroup(raw) {
  return {
    id: raw.id,
    name: raw.name,
    generation: raw.generation?.name ?? "",
    pokedexes: namesOf(raw.pokedexes),
  };
}

/**
 * @param {any} raw
 * @returns {StrippedGeneration}
 */
export function stripGeneration(raw) {
  return {
    id: raw.id,
    name: raw.name,
    version_groups: namesOf(raw.version_groups),
  };
}

/**
 * File name (without directory) a record is cached under: species by id,
 * everything else by name.
 *
 * @param {keyof typeof CACHE_KINDS} kind
 * @param {{ id: number, name: string }} record
 */
export function cacheFileName(kind, record) {
  return `${record[CACHE_KINDS[kind]]}.json`;
}

/** Strip function per cache kind, keyed like {@link CACHE_KINDS}. */
export const STRIPPERS = {
  "pokemon-species": stripSpecies,
  pokemon: stripPokemon,
  "pokemon-form": stripForm,
  pokedex: stripPokedex,
  "version-group": stripVersionGroup,
  generation: stripGeneration,
};
