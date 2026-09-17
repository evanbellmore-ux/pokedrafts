// Tags (docs/release-architecture.md 13.4): `legendary` and `mythical` come
// from PokéAPI's species flags; `restricted`, `paradox` and `ultra_beast`
// are curated species lists in data/pokemon/overrides.json; `sub_legendary`
// is legendary and not restricted. Every row of a species carries its
// species' tags. Pure.

/** Canonical tag order, also the order tags appear in a row. */
export const TAGS = /** @type {const} */ ([
  "legendary",
  "sub_legendary",
  "restricted",
  "mythical",
  "paradox",
  "ultra_beast",
]);

/**
 * @typedef {typeof TAGS[number]} Tag
 * @typedef {{ restricted: string[], paradox: string[], ultra_beast: string[] }} CuratedTags
 */

/**
 * @param {import("./strip.mjs").StrippedSpecies} species
 * @param {CuratedTags} curated species slugs per curated tag
 * @returns {Tag[]}
 */
export function tagsFor(species, curated) {
  const restricted = curated.restricted.includes(species.name);
  /** @type {Tag[]} */
  const tags = [];
  if (species.is_legendary) {
    tags.push("legendary");
    if (!restricted) {
      tags.push("sub_legendary");
    }
  }
  if (restricted) {
    tags.push("restricted");
  }
  if (species.is_mythical) {
    tags.push("mythical");
  }
  if (curated.paradox.includes(species.name)) {
    tags.push("paradox");
  }
  if (curated.ultra_beast.includes(species.name)) {
    tags.push("ultra_beast");
  }
  return tags;
}

/**
 * Every curated slug must name a species in the catalog, otherwise a typo
 * would silently drop a tag.
 *
 * @param {CuratedTags} curated
 * @param {import("./catalog.mjs").Catalog} catalog
 * @returns {string[]} problems, empty when valid
 */
export function validateCuratedTags(curated, catalog) {
  /** @type {string[]} */
  const problems = [];
  for (const tag of /** @type {const} */ (["restricted", "paradox", "ultra_beast"])) {
    const list = curated[tag];
    if (!Array.isArray(list)) {
      problems.push(`overrides.tags.${tag} must be an array of species slugs.`);
      continue;
    }
    for (const slug of list) {
      if (!catalog.speciesByName.has(slug)) {
        problems.push(`overrides.tags.${tag}: "${slug}" is not a species slug.`);
      }
    }
    const unique = new Set(list);
    if (unique.size !== list.length) {
      problems.push(`overrides.tags.${tag} lists a species twice.`);
    }
  }
  return problems;
}
