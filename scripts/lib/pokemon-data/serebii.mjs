// Serebii Champions regulation pages (docs/release-architecture.md 13.3).
// Each roster row is an icon `/pokedex-champions/icon/<dex>[-<suffix>].png`
// followed by an anchor `<a href="/pokedex-champions/<slug>/">Name<br />日本語</a>`;
// the suffix names the form and is resolved against the species' PokéAPI
// varieties. Pure: parsing takes the HTML string, resolution takes the
// catalog.

import { englishName } from "./catalog.mjs";
import { megaBaseSlug } from "./rows.mjs";

/** The regulation pages, in roster order (rosters are cumulative). */
export const SEREBII_REGULATIONS = /** @type {const} */ ([
  {
    key: "m-a",
    presetKey: "champions-m-a",
    url: "https://www.serebii.net/pokemonchampions/rankedbattle/regulationm-a.shtml",
  },
  {
    key: "m-b",
    presetKey: "champions-m-b",
    url: "https://www.serebii.net/pokemonchampions/rankedbattle/regulationm-b.shtml",
  },
  {
    key: "m-c",
    presetKey: "champions-m-c",
    url: "https://www.serebii.net/pokemonchampions/rankedbattle/regulationm-c.shtml",
  },
]);

/**
 * Icon suffix -> candidate PokéAPI slug suffixes. A candidate is tried as
 * `<species>` + suffix and `<default variety>` + suffix against the species'
 * varieties and exactly one must exist.
 */
export const SUFFIX_TABLE = /** @type {Record<string, string[]>} */ ({
  m: ["-mega"],
  mx: ["-mega-x"],
  my: ["-mega-y"],
  mz: ["-mega-z"],
  a: ["-alola", "-paldea-aqua-breed"],
  g: ["-galar"],
  h: ["-hisui"],
  p: ["-paldea", "-paldea-combat-breed"],
  b: ["-paldea-blaze-breed"],
  e: ["-eternal"],
  l: ["-low-key"],
  f: ["-female"],
});

/**
 * @typedef {{ dex: number, slug: string, name: string, suffix: string | null }} SerebiiRow
 */

/** @param {string} value */
function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

/**
 * Every roster row on a regulation page, in page order.
 *
 * @param {string} html
 * @returns {{ rows: SerebiiRow[], problems: string[] }}
 */
export function parseSerebiiPage(html) {
  const iconPattern = /\/pokedex-champions\/icon\/(\d+)(?:-([a-z]+))?\.png/gi;
  // A name anchor: text (not a nested tag) optionally followed by <br /> and
  // the Japanese name. The anchor around the icon starts with <img and does
  // not match.
  const anchorPattern = /<a href="\/pokedex-champions\/([^/"]+)\/">\s*([^<\s][^<]*?)\s*(?:<br\s*\/?>[^<]*)?<\/a>/gi;

  /** @type {Array<{ index: number, dex: number, suffix: string | null }>} */
  const icons = [];
  for (const match of html.matchAll(iconPattern)) {
    icons.push({
      index: match.index ?? 0,
      dex: Number.parseInt(match[1], 10),
      suffix: match[2] ? match[2].toLowerCase() : null,
    });
  }
  /** @type {Array<{ index: number, slug: string, name: string }>} */
  const anchors = [];
  for (const match of html.matchAll(anchorPattern)) {
    anchors.push({
      index: match.index ?? 0,
      slug: decodeEntities(match[1]),
      name: decodeEntities(match[2]).replace(/\s+/g, " ").trim(),
    });
  }

  /** @type {SerebiiRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  let anchorAt = 0;
  for (let index = 0; index < icons.length; index += 1) {
    const icon = icons[index];
    const limit = icons[index + 1]?.index ?? Number.POSITIVE_INFINITY;
    while (anchorAt < anchors.length && anchors[anchorAt].index < icon.index) {
      anchorAt += 1;
    }
    const anchor = anchors[anchorAt];
    if (!anchor || anchor.index > limit) {
      problems.push(
        `Icon #${String(icon.dex).padStart(4, "0")}${icon.suffix ? `-${icon.suffix}` : ""} has no name anchor after it.`
      );
      continue;
    }
    anchorAt += 1;
    rows.push({ dex: icon.dex, slug: anchor.slug, name: anchor.name, suffix: icon.suffix });
  }
  return { rows, problems };
}

/** @param {string} value */
function nameKey(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(mega|primal|alolan|galarian|hisuian|paldean)\s+/, "")
    .replace(/\s+[xyz]$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/** @param {SerebiiRow} row */
function describeRow(row) {
  return `#${String(row.dex).padStart(4, "0")}${row.suffix ? `-${row.suffix}` : ""} ${row.name}`;
}

/**
 * Resolves one roster row to a PokéAPI pokemon slug.
 *
 * @param {SerebiiRow} row
 * @param {import("./catalog.mjs").Catalog} catalog
 * @returns {{ ok: true, slug: string } | { ok: false, error: string }}
 */
export function resolveSerebiiRow(row, catalog) {
  const species = catalog.speciesById.get(row.dex);
  if (!species) {
    return { ok: false, error: `${describeRow(row)}: no species has dex number ${row.dex}.` };
  }
  if (nameKey(row.name) !== nameKey(englishName(species))) {
    return {
      ok: false,
      error: `${describeRow(row)}: name does not match species ${englishName(species)} (#${species.id}).`,
    };
  }
  const defaultVariety =
    species.varieties.find((variety) => variety.is_default) ?? species.varieties[0];
  if (!defaultVariety) {
    return { ok: false, error: `${describeRow(row)}: species ${species.name} has no varieties.` };
  }
  if (row.suffix === null) {
    return { ok: true, slug: defaultVariety.pokemon.name };
  }
  const options = SUFFIX_TABLE[row.suffix];
  if (!options) {
    return { ok: false, error: `${describeRow(row)}: unknown icon suffix "${row.suffix}".` };
  }
  const varieties = new Set(species.varieties.map((variety) => variety.pokemon.name));
  /** @type {Set<string>} */
  const candidates = new Set();
  for (const option of options) {
    candidates.add(`${species.name}${option}`);
    candidates.add(`${defaultVariety.pokemon.name}${option}`);
  }
  const matches = [...candidates].filter((candidate) => varieties.has(candidate));
  if (matches.length !== 1) {
    return {
      ok: false,
      error: `${describeRow(row)}: suffix "${row.suffix}" matches ${matches.length} varieties of ${species.name} (${matches.join(", ") || "none"}; tried ${[...candidates].join(", ")}).`,
    };
  }
  return { ok: true, slug: matches[0] };
}

/**
 * A Serebii row without an icon suffix names the species: Serebii only draws
 * a form icon for forms it has a Champions Pokédex page for (Megas,
 * regionals, Eternal Floette, Low Key Toxtricity, Indeedee-F), so Rotom,
 * Lycanroc, Gourgeist, Meowstic and Basculegion appear once each while their
 * appliance, time, size and gender forms are legal too. The roster therefore
 * also takes every `other` and `gender` row of such a species that is
 * available in `champions` (a PokéAPI Champions learnset or an override).
 *
 * Serebii's "m" icon likewise names the species' Mega once, and
 * resolveSerebiiRow maps it to the default variety's Mega (Mega Meowstic is
 * meowstic-male-mega). So when a species named without a suffix also has its
 * default variety's Mega on the roster, the Megas of the forms added above
 * join too when they carry `champions` (Mega Meowstic (Female)). Regionals
 * and any other Mega are never added this way: Serebii's icons name them.
 *
 * Only a suffix-less row resolves to a species' default variety, so "the
 * roster names a default row" is the same thing as "the row had no suffix".
 *
 * @template {{ slug: string, species_id: number, form_kind: string, games: string[] }} T
 * @param {string[]} slugs resolved roster slugs, in roster order
 * @param {T[]} rows the dataset rows
 * @returns {string[]} the roster with the expanded forms appended, in dataset order
 */
export function expandRosterForms(slugs, rows) {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  /** @param {T} row */
  const inChampions = (row) => row.games.includes("champions");

  /** @type {Map<number, string>} species id -> its default row's slug, for species named without a suffix */
  const namedDefaults = new Map();
  for (const slug of slugs) {
    const row = bySlug.get(slug);
    if (row?.form_kind === "default") {
      namedDefaults.set(row.species_id, row.slug);
    }
  }
  /** @type {Set<number>} species whose default variety's Mega is on the roster */
  const megaNamed = new Set();
  for (const slug of slugs) {
    const row = bySlug.get(slug);
    if (row?.form_kind === "mega" && namedDefaults.get(row.species_id) === megaBaseSlug(row.slug)) {
      megaNamed.add(row.species_id);
    }
  }
  /** @type {Set<string>} the `other` and `gender` rows a suffix-less row stands for */
  const forms = new Set();
  for (const row of rows) {
    if (
      namedDefaults.has(row.species_id) &&
      (row.form_kind === "other" || row.form_kind === "gender") &&
      inChampions(row)
    ) {
      forms.add(row.slug);
    }
  }

  const expanded = new Set(slugs);
  for (const row of rows) {
    if (forms.has(row.slug)) {
      expanded.add(row.slug);
    } else if (
      row.form_kind === "mega" &&
      megaNamed.has(row.species_id) &&
      forms.has(megaBaseSlug(row.slug)) &&
      inChampions(row)
    ) {
      expanded.add(row.slug);
    }
  }
  return [...expanded];
}

/**
 * Cumulative rosters per preset: M-B is M-A plus M-B's rows, and so on.
 *
 * @param {Record<string, SerebiiRow[]>} pagesByKey rows per regulation key ("m-a", ...)
 * @param {import("./catalog.mjs").Catalog} catalog
 * @returns {{ rosters: Record<string, string[]>, unmapped: string[] }}
 */
export function buildRosters(pagesByKey, catalog) {
  /** @type {Record<string, string[]>} */
  const rosters = {};
  /** @type {string[]} */
  const unmapped = [];
  /** @type {string[]} */
  const cumulative = [];
  const seen = new Set();
  for (const regulation of SEREBII_REGULATIONS) {
    const rows = pagesByKey[regulation.key];
    if (!rows) {
      unmapped.push(`Regulation ${regulation.key}: no Serebii rows were provided.`);
      rosters[regulation.presetKey] = [...cumulative];
      continue;
    }
    for (const row of rows) {
      const resolved = resolveSerebiiRow(row, catalog);
      if (!resolved.ok) {
        unmapped.push(`Regulation ${regulation.key}: ${resolved.error}`);
        continue;
      }
      if (!seen.has(resolved.slug)) {
        seen.add(resolved.slug);
        cumulative.push(resolved.slug);
      }
    }
    rosters[regulation.presetKey] = [...cumulative];
  }
  return { rosters, unmapped };
}
