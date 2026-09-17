// Display names and form labels (docs/release-architecture.md 13.4). The
// spellings follow what app/lib/pokemon/index.ts already accepts:
// regional prefixes ("Alolan Raichu", "Galarian Mr. Mime"), megas ("Mega
// Charizard X", "Mega Absol Z"), primals ("Primal Groudon"), gender forms
// ("Indeedee (Female)") and every other form as "Species (Form)" using the
// form's English name ("Rotom (Wash)", "Urshifu (Rapid Strike)"). Pure.

import { englishName, titleCaseSlug } from "./catalog.mjs";
import { regionalMarkerOf } from "./rows.mjs";

/** Prose prefix per regional marker. */
export const REGION_PREFIXES = /** @type {Record<string, string>} */ ({
  alola: "Alolan",
  galar: "Galarian",
  hisui: "Hisuian",
  paldea: "Paldean",
});

/** "fire" -> "Fire" (the app's capitalised type spelling). */
/** @param {string} name */
export function typeName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Generic trailing words PokéAPI appends to form names that the app's prose
 * convention drops: "Origin Forme" -> "Origin", "Low Key Form" -> "Low Key",
 * "Rapid Strike Style" -> "Rapid Strike", "Sandy Cloak" -> "Sandy".
 */
const GENERIC_FORM_WORDS = /\s+(form|forme|style|mode|cloak|size)$/i;

/**
 * The form's English name with the species name and generic suffix removed
 * ("Wash Rotom" -> "Wash", "Eternal Flower" stays). Empty when nothing is
 * left, so callers can fall back to the slug.
 *
 * @param {string} raw
 * @param {string} speciesName
 */
export function cleanFormName(raw, speciesName) {
  let value = raw.trim();
  const lower = value.toLowerCase();
  const at = lower.indexOf(speciesName.toLowerCase());
  if (at >= 0) {
    value = `${value.slice(0, at)} ${value.slice(at + speciesName.length)}`;
  }
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(GENERIC_FORM_WORDS, "").trim();
  return value;
}

/**
 * The slug remainder after the species slug: "charizard-mega-x" -> "-mega-x".
 *
 * @param {string} slug
 * @param {string} speciesSlug
 */
export function slugRemainder(slug, speciesSlug) {
  if (slug === speciesSlug) {
    return "";
  }
  return slug.startsWith(`${speciesSlug}-`) ? slug.slice(speciesSlug.length) : `-${slug}`;
}

/**
 * @typedef {{ display_name: string, form_label: string | null }} Naming
 */

/**
 * @param {{
 *   kind: import("./rows.mjs").FormKind,
 *   species: import("./strip.mjs").StrippedSpecies,
 *   pokemon: import("./strip.mjs").StrippedPokemon,
 *   form: import("./strip.mjs").StrippedForm | null,
 *   defaultVariety: import("./strip.mjs").StrippedPokemon,
 * }} input
 * @returns {Naming}
 */
export function nameVariety({ kind, species, pokemon, form, defaultVariety }) {
  const speciesName = englishName(species);
  const remainder = slugRemainder(pokemon.name, species.name);

  switch (kind) {
    case "default":
      return { display_name: speciesName, form_label: null };

    case "mega": {
      // "-male-mega", "-female-mega", "-droopy-mega", "-original-mega": the
      // part that is not the mega suffix names the variety that evolved. It
      // is only shown when it is not the species' default variety, so
      // "meowstic-male-mega" is "Mega Meowstic" and "meowstic-female-mega"
      // is "Mega Meowstic (Female)".
      const primal = remainder.endsWith("-primal");
      const letter = remainder.match(/-mega-([xyz])$/)?.[1]?.toUpperCase() ?? "";
      const base = remainder.replace(/-mega(-[xyz])?$/, "").replace(/-primal$/, "");
      const defaultRemainder = slugRemainder(defaultVariety.name, species.name);
      const extra = base && base !== defaultRemainder ? ` (${titleCaseSlug(base)})` : "";
      const word = primal ? "Primal" : "Mega";
      const label = letter ? `${word} ${letter}` : word;
      const suffix = letter ? ` ${letter}` : "";
      return {
        display_name: `${word} ${speciesName}${suffix}${extra}`,
        form_label: `${label}${extra}`,
      };
    }

    case "regional": {
      const marker = regionalMarkerOf(pokemon.name);
      const region = marker?.region ?? "";
      const prefix = REGION_PREFIXES[region] ?? titleCaseSlug(region);
      const rest = marker ? remainder.replace(marker.marker, "") : remainder;
      const breed = rest.match(/^-([a-z]+)-breed$/)?.[1];
      if (breed) {
        const breedName = `${titleCaseSlug(breed)} Breed`;
        return {
          display_name: `${prefix} ${speciesName} (${breedName})`,
          form_label: `${prefix} ${breedName}`,
        };
      }
      // "-standard" (Galarian Darmanitan) is the default mode; anything else
      // unexpected stays visible in parentheses so names remain unique.
      const extra = rest && rest !== "-standard" ? ` (${titleCaseSlug(rest)})` : "";
      return { display_name: `${prefix} ${speciesName}${extra}`, form_label: prefix };
    }

    case "gender": {
      const gender = pokemon.name.endsWith("-female") ? "Female" : "Male";
      return { display_name: `${speciesName} (${gender})`, form_label: gender };
    }

    case "other": {
      const english = form?.form_names.find((entry) => entry.language.name === "en")?.name ?? "";
      const cleaned = cleanFormName(english, speciesName) || titleCaseSlug(remainder);
      return { display_name: `${speciesName} (${cleaned})`, form_label: cleaned };
    }

    default:
      throw new Error(`Unknown form kind ${String(kind)} for ${pokemon.name}.`);
  }
}

/**
 * Names a variety by its slug remainder alone; used when the English form
 * name collides with another row of the same species.
 *
 * @param {import("./strip.mjs").StrippedSpecies} species
 * @param {import("./strip.mjs").StrippedPokemon} pokemon
 * @returns {Naming}
 */
export function nameBySlug(species, pokemon) {
  const speciesName = englishName(species);
  const label = titleCaseSlug(slugRemainder(pokemon.name, species.name));
  return { display_name: `${speciesName} (${label})`, form_label: label };
}
