// Row selection: which PokéAPI varieties become dataset rows, and of which
// form kind. Implements rules 1-7 of docs/release-architecture.md section 13.3
// in that order; rule 7 also drops a variety that duplicates a kept variety
// of its species (duplicateOf), so a cosmetic variant is never a row even
// when it differs from the default form. Pure.

import { defaultVarietyOf, formOf } from "./catalog.mjs";

/**
 * @typedef {import("./catalog.mjs").Catalog} Catalog
 * @typedef {import("./strip.mjs").StrippedSpecies} StrippedSpecies
 * @typedef {import("./strip.mjs").StrippedPokemon} StrippedPokemon
 * @typedef {"default" | "mega" | "regional" | "gender" | "other"} FormKind
 * @typedef {{ kind: FormKind, rule: number, region?: string }} Kept
 * @typedef {{ kind: "skip", rule: number, reason: string }} Skipped
 * @typedef {Kept | Skipped} Classification
 */

export const FORM_KINDS = /** @type {const} */ (["default", "mega", "regional", "gender", "other"]);

/**
 * Expected row counts per form kind from the 2026-09-16 crawl, which the
 * report asserts within {@link KIND_COUNT_TOLERANCE}.
 *
 * These are not the figures section 13.3 prints (1025 default, 97 mega, 59
 * regional "before the cosmetic drop", 4 gender, 64 other, about 1,230 rows):
 * they are what rules 1-7 as implemented here produce from that crawl, 1,237
 * rows, and the differences are deliberate. An amendment of 13.3 to these
 * sizes and to the two drops it does not describe has been requested from the
 * contract owner; until it lands, this comment and the "reconciles
 * EXPECTED_KIND_COUNTS" case in tests/unit/pokemon-dataset-integrity.test.ts
 * are the reviewable record of the divergence:
 *
 * - mega 97 -> 96. 13.3's 97 is PokéAPI's `is_mega` form count. The script
 *   also files the two Primal Reversions under `mega` (13.4 names "Primal
 *   Groudon" with the Megas; see isMegaLike), 99, then rule 7's duplicate
 *   drop removes the Megas of cosmetic varieties (tatsugiri-droopy-mega,
 *   tatsugiri-stretchy-mega, magearna-original-mega), 96.
 * - regional 59 -> 57. 13.3 counts the crawl before rule 2's "cosmetic
 *   drop": rule 2 skips pikachu-alola-cap (costume) and darmanitan-galar-zen
 *   (battle-only) before rule 4 sees their markers (raticate-totem-alola is a
 *   totem, dropped and not counted either way), 57.
 * - other 64 -> 55. Rules 1-6 read literally give 63 on this crawl, one fewer
 *   than 13.3 prints. Rule 7's duplicate drop then removes the six Minior
 *   colour cores (all equal to Minior Red Core) and squawkabilly-white-plumage
 *   (equal to Yellow Plumage), 56, and eternatus-eternamax, a Dynamax form
 *   13.1 rules out that PokéAPI does not flag battle-only, is skipped by slug
 *   under rule 2 like the Gigantamax forms, 55.
 *
 * The duplicate drop is the rule-7 clause 13.3 lacks: a variety whose stats,
 * types and abilities equal a variety of its species that is already a row is
 * cosmetic (13.1: cosmetic variants are never entries; 13.3 rule 6 itself
 * names Minior colours as cosmetic, which the literal rule cannot deliver
 * because every Minior core differs from the default Meteor form). See
 * duplicateOf.
 */
export const EXPECTED_KIND_COUNTS = /** @type {Record<FormKind, number>} */ ({
  default: 1025,
  mega: 96,
  regional: 57,
  gender: 4,
  other: 55,
});

/** Tolerance the report asserts against {@link EXPECTED_KIND_COUNTS}. */
export const KIND_COUNT_TOLERANCE = 0.05;

/** Pikachu varieties that are costumes, never battle-relevant entries. */
export const COSMETIC_PIKACHU_SUFFIXES = [
  "-cosplay",
  "-rock-star",
  "-belle",
  "-pop-star",
  "-phd",
  "-libre",
  "-original-cap",
  "-hoenn-cap",
  "-sinnoh-cap",
  "-unova-cap",
  "-kalos-cap",
  "-alola-cap",
  "-partner-cap",
  "-world-cap",
  "-starter",
];

/** Slug markers of regional forms, in the order they are tested. */
export const REGIONAL_MARKERS = /** @type {const} */ ([
  ["-alola", "alola"],
  ["-galar", "galar"],
  ["-hisui", "hisui"],
  ["-paldea", "paldea"],
]);

/**
 * Mega Evolutions and Primal Reversions are flagged battle-only by PokéAPI
 * like Gigantamax is, but the contract keeps them as `mega` rows (13.1,
 * 13.4's "Mega Charizard X" / "Primal Groudon" naming), so rule 2 lets them
 * through to rule 3.
 *
 * @param {import("./strip.mjs").StrippedForm | null} form
 * @param {string} slug
 */
export function isMegaLike(form, slug) {
  return Boolean(form?.is_mega) || /-primal$/.test(slug);
}

/**
 * @param {string} slug
 * @returns {{ marker: string, region: string } | null}
 */
export function regionalMarkerOf(slug) {
  for (const [marker, region] of REGIONAL_MARKERS) {
    if (slug.includes(marker)) {
      return { marker, region };
    }
  }
  return null;
}

/** @param {StrippedPokemon} pokemon */
function statsKey(pokemon) {
  return pokemon.stats.map((entry) => `${entry.stat.name}=${entry.base_stat}`).sort().join("|");
}

/** @param {StrippedPokemon} pokemon */
function typesKey(pokemon) {
  return [...pokemon.types]
    .sort((a, b) => a.slot - b.slot)
    .map((entry) => entry.type.name)
    .join("/");
}

/** @param {StrippedPokemon} pokemon */
function abilitiesKey(pokemon) {
  return pokemon.abilities
    .map((entry) => entry.ability.name)
    .sort()
    .join("|");
}

/**
 * The variety's battle data as one comparable string: base stats, types in
 * slot order and ability names. Two varieties with the same key are the same
 * Pokémon in battle, whatever they look like.
 *
 * @param {StrippedPokemon} pokemon
 */
export function battleKey(pokemon) {
  return `${statsKey(pokemon)}#${typesKey(pokemon)}#${abilitiesKey(pokemon)}`;
}

/**
 * True when the variety's stats, types or ability names differ from the
 * species' default variety (rule 6).
 *
 * @param {StrippedPokemon} pokemon
 * @param {StrippedPokemon} defaultVariety
 */
export function differsFromDefault(pokemon, defaultVariety) {
  return battleKey(pokemon) !== battleKey(defaultVariety);
}

/**
 * The slug of the variety a Mega Evolution or Primal Reversion evolved from:
 * "meowstic-female-mega" -> "meowstic-female", "charizard-mega-x" ->
 * "charizard", "groudon-primal" -> "groudon".
 *
 * @param {string} slug
 */
export function megaBaseSlug(slug) {
  return slug.replace(/-mega(-[xyz])?$/, "").replace(/-primal$/, "");
}

/** The rule 7 reason for a variety that duplicates another kept variety. */
export const DUPLICATE_REASON = "cosmetic: same stats, types and abilities as another kept form of the species";

/**
 * Rules 1-7 of section 13.3, in order.
 *
 * @param {Catalog} catalog
 * @param {StrippedSpecies} species
 * @param {StrippedPokemon} pokemon
 * @param {{ keep?: Set<string> }} [options] `keep`: slugs the curated
 *   overrides exempt from the battle-only skip (Crowned Zacian and Zamazenta,
 *   which PokéAPI flags battle-only but 13.1 lists as included forms)
 * @returns {Classification}
 */
export function classifyVariety(catalog, species, pokemon, options = {}) {
  const slug = pokemon.name;
  const defaultVariety = defaultVarietyOf(catalog, species);
  const form = formOf(catalog, pokemon);
  const kept = options.keep?.has(slug) ?? false;

  // 1. The species' default variety.
  if (pokemon.name === defaultVariety.name) {
    return { kind: "default", rule: 1 };
  }

  // 2. Battle-only, Gigantamax, totem and costume varieties. Eternamax is
  // Eternatus's Dynamax form, never obtainable, but PokéAPI does not flag it
  // battle-only, so it is skipped by slug like the Gigantamax forms (13.1).
  if (form?.is_battle_only && !isMegaLike(form, slug) && !kept) {
    return { kind: "skip", rule: 2, reason: "battle-only form" };
  }
  if (slug.includes("-gmax") || slug.endsWith("-eternamax")) {
    return { kind: "skip", rule: 2, reason: "gigantamax" };
  }
  if (slug.includes("-totem")) {
    return { kind: "skip", rule: 2, reason: "totem" };
  }
  if (
    slug.startsWith("pikachu-") &&
    COSMETIC_PIKACHU_SUFFIXES.some((suffix) => slug === `pikachu${suffix}`)
  ) {
    return { kind: "skip", rule: 2, reason: "cosmetic pikachu" };
  }
  if (slug === "eevee-starter") {
    return { kind: "skip", rule: 2, reason: "partner eevee" };
  }

  // 3. Mega Evolutions (and Primal Reversions, see isMegaLike).
  if (isMegaLike(form, slug)) {
    return { kind: "mega", rule: 3 };
  }

  // 4. Regional forms, Paldean Tauros breeds included.
  const regional = regionalMarkerOf(slug);
  if (regional) {
    return { kind: "regional", rule: 4, region: regional.region };
  }

  // 5. Gender forms that are distinct Pokémon.
  if (slug.endsWith("-female") || slug.endsWith("-male")) {
    return { kind: "gender", rule: 5 };
  }

  // 6. Anything whose battle data differs from the default form.
  if (differsFromDefault(pokemon, defaultVariety)) {
    return { kind: "other", rule: 6 };
  }

  // 7. Cosmetic.
  return {
    kind: "skip",
    rule: 7,
    reason: "cosmetic: same stats, types and abilities as the default form",
  };
}

/**
 * @typedef {{ slug: string, species: string, rule: number, reason: string, sameAs?: string }} SkippedVariety
 */

/**
 * Rule 7 for varieties that pass rule 6 but duplicate a variety of the same
 * species that is already a row: the Minior colour cores all match Minior
 * (Red Core), Squawkabilly White Plumage matches Yellow, and the Mega
 * Evolutions of a cosmetic variety (Droopy and Stretchy Mega Tatsugiri,
 * Mega Magearna Original) match the Mega of the kept variety. A Mega whose
 * own base variety is a row stays, so Mega Meowstic (Female) is kept
 * alongside Mega Meowstic even though PokéAPI gives them the same data.
 *
 * @param {StrippedPokemon} pokemon
 * @param {Kept} classification
 * @param {{ keySlugs: Map<string, string>, slugs: Set<string> }} seen kept
 *   varieties of the species so far, by battle key and by slug
 * @returns {string | null} the slug this variety duplicates, or null to keep it
 */
export function duplicateOf(pokemon, classification, seen) {
  if (classification.kind !== "other" && classification.kind !== "mega") {
    return null;
  }
  const original = seen.keySlugs.get(battleKey(pokemon));
  if (original === undefined) {
    return null;
  }
  if (classification.kind === "mega" && seen.slugs.has(megaBaseSlug(pokemon.name))) {
    return null;
  }
  return original;
}

/**
 * Walks every species' varieties in PokéAPI order and classifies each one.
 *
 * @param {Catalog} catalog
 * @param {{ keep?: Set<string> }} [options] see {@link classifyVariety}
 * @returns {{
 *   kept: Array<{ species: StrippedSpecies, pokemon: StrippedPokemon, classification: Kept }>,
 *   skipped: SkippedVariety[],
 * }}
 */
export function selectVarieties(catalog, options = {}) {
  /** @type {Array<{ species: StrippedSpecies, pokemon: StrippedPokemon, classification: Kept }>} */
  const kept = [];
  /** @type {SkippedVariety[]} */
  const skipped = [];
  const speciesList = [...catalog.speciesById.values()].sort((a, b) => a.id - b.id);
  for (const species of speciesList) {
    /** @type {{ keySlugs: Map<string, string>, slugs: Set<string> }} */
    const seen = { keySlugs: new Map(), slugs: new Set() };
    for (const variety of species.varieties) {
      const pokemon = catalog.pokemonByName.get(variety.pokemon.name);
      if (!pokemon) {
        throw new Error(`Species ${species.name}: variety ${variety.pokemon.name} is not in the cache.`);
      }
      const classification = classifyVariety(catalog, species, pokemon, options);
      if (classification.kind === "skip") {
        skipped.push({
          slug: pokemon.name,
          species: species.name,
          rule: classification.rule,
          reason: classification.reason,
        });
        continue;
      }
      const sameAs = duplicateOf(pokemon, classification, seen);
      if (sameAs !== null) {
        skipped.push({ slug: pokemon.name, species: species.name, rule: 7, reason: DUPLICATE_REASON, sameAs });
        continue;
      }
      kept.push({ species, pokemon, classification });
      seen.slugs.add(pokemon.name);
      if (!seen.keySlugs.has(battleKey(pokemon))) {
        seen.keySlugs.set(battleKey(pokemon), pokemon.name);
      }
    }
  }
  return { kept, skipped };
}
