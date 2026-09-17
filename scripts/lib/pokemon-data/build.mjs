// The dataset build, end to end and pure: catalog + overrides + presets +
// Serebii rows in, dataset rows + filled presets + report + problems out.
// scripts/build-pokemon-data.mjs owns the filesystem and network around it;
// tests/unit/pokemon-data-build.test.ts runs it on the fixture cache.

import { defaultVarietyOf, englishName, formOf, generationNumber } from "./catalog.mjs";
import { GAME_KEYS, dexNumbersFor, gamesFor, validateGames } from "./games.mjs";
import { nameVariety, typeName } from "./names.mjs";
import { checkRegulationAgreement, fillRosters, presetCounts } from "./presets.mjs";
import { buildReport, kindCountProblems, presetDriftWarnings } from "./report.mjs";
import { EXPECTED_KIND_COUNTS, FORM_KINDS, selectVarieties } from "./rows.mjs";
import { buildRosters, expandRosterForms } from "./serebii.mjs";
import { TAGS, tagsFor, validateCuratedTags } from "./tags.mjs";

/**
 * @typedef {{
 *   id: number,
 *   species_id: number,
 *   slug: string,
 *   display_name: string,
 *   species_name: string,
 *   form_kind: import("./rows.mjs").FormKind,
 *   form_label: string | null,
 *   type1: string,
 *   type2: string | null,
 *   hp: number,
 *   attack: number,
 *   defense: number,
 *   special_attack: number,
 *   special_defense: number,
 *   speed: number,
 *   generation: number,
 *   tags: string[],
 *   games: string[],
 *   dex_numbers: Record<string, number>,
 *   sprite_url: string | null,
 * }} DatasetRow
 *
 * @typedef {{
 *   notes?: string,
 *   tags?: Partial<Record<"restricted" | "paradox" | "ultra_beast", string[]>>,
 *   keep?: Record<string, string>,
 *   rows?: Record<string, Record<string, unknown>>,
 * }} RawOverrides
 *
 * @typedef {{
 *   curated: import("./tags.mjs").CuratedTags,
 *   keep: Set<string>,
 *   rows: Map<string, Record<string, unknown>>,
 *   problems: string[],
 * }} Overrides
 */

/** The columns of public.pokemon minus the generated `bst` and `updated_at`. */
export const ROW_COLUMNS = /** @type {const} */ ([
  "id",
  "species_id",
  "slug",
  "display_name",
  "species_name",
  "form_kind",
  "form_label",
  "type1",
  "type2",
  "hp",
  "attack",
  "defense",
  "special_attack",
  "special_defense",
  "speed",
  "generation",
  "tags",
  "games",
  "dex_numbers",
  "sprite_url",
]);

/** PokéAPI stat name -> column. */
const STAT_COLUMNS = /** @type {Record<string, "hp" | "attack" | "defense" | "special_attack" | "special_defense" | "speed">} */ ({
  hp: "hp",
  attack: "attack",
  defense: "defense",
  "special-attack": "special_attack",
  "special-defense": "special_defense",
  speed: "speed",
});

/** Row override keys that are not columns: `games` and `tags` are unioned. */
const UNION_COLUMNS = new Set(["games", "tags"]);

/**
 * Checks and indexes data/pokemon/overrides.json.
 *
 * @param {RawOverrides} raw
 * @param {import("./catalog.mjs").Catalog} catalog
 * @returns {Overrides}
 */
export function normalizeOverrides(raw, catalog) {
  /** @type {string[]} */
  const problems = [];
  const curated = {
    restricted: raw.tags?.restricted ?? [],
    paradox: raw.tags?.paradox ?? [],
    ultra_beast: raw.tags?.ultra_beast ?? [],
  };
  problems.push(...validateCuratedTags(curated, catalog));

  const keep = new Set(Object.keys(raw.keep ?? {}));
  for (const slug of keep) {
    if (!catalog.pokemonByName.has(slug)) {
      problems.push(`overrides.keep: "${slug}" is not a PokéAPI pokemon slug.`);
    }
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const rows = new Map();
  for (const [slug, override] of Object.entries(raw.rows ?? {})) {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      problems.push(`overrides.rows.${slug} must be an object.`);
      continue;
    }
    for (const key of Object.keys(override)) {
      if (key !== "notes" && !ROW_COLUMNS.includes(/** @type {any} */ (key))) {
        problems.push(`overrides.rows.${slug}: "${key}" is not a dataset column.`);
      }
    }
    if (!catalog.pokemonByName.has(slug)) {
      const missing = ROW_COLUMNS.filter((column) => !(column in override));
      if (missing.length > 0) {
        problems.push(
          `overrides.rows.${slug}: PokéAPI does not know this slug, so the override must give every column; missing ${missing.join(", ")}.`
        );
      }
    }
    rows.set(slug, override);
  }
  return { curated, keep, rows, problems };
}

/**
 * @param {{
 *   catalog: import("./catalog.mjs").Catalog,
 *   species: import("./strip.mjs").StrippedSpecies,
 *   pokemon: import("./strip.mjs").StrippedPokemon,
 *   kind: import("./rows.mjs").FormKind,
 *   curated: import("./tags.mjs").CuratedTags,
 * }} input
 * @returns {DatasetRow}
 */
export function buildRow({ catalog, species, pokemon, kind, curated }) {
  const defaultVariety = defaultVarietyOf(catalog, species);
  const form = formOf(catalog, pokemon);
  const naming = nameVariety({ kind, species, pokemon, form, defaultVariety });
  const types = [...pokemon.types].sort((a, b) => a.slot - b.slot).map((entry) => typeName(entry.type.name));
  const isDefault = pokemon.name === defaultVariety.name;

  /** @type {DatasetRow} */
  const row = {
    id: pokemon.id,
    species_id: species.id,
    slug: pokemon.name,
    display_name: naming.display_name,
    species_name: englishName(species),
    form_kind: kind,
    form_label: naming.form_label,
    type1: types[0] ?? "",
    type2: types[1] ?? null,
    hp: 0,
    attack: 0,
    defense: 0,
    special_attack: 0,
    special_defense: 0,
    speed: 0,
    generation: generationNumber(catalog, species),
    tags: tagsFor(species, curated),
    games: gamesFor({ pokemon, species, isDefault }),
    dex_numbers: dexNumbersFor(species),
    sprite_url:
      pokemon.sprites.official_artwork ??
      pokemon.sprites.front_default ??
      defaultVariety.sprites.official_artwork ??
      defaultVariety.sprites.front_default ??
      null,
  };
  for (const entry of pokemon.stats) {
    const column = STAT_COLUMNS[entry.stat.name];
    if (column) {
      row[column] = entry.base_stat;
    }
  }
  return row;
}

/**
 * Applies one row override: `games` and `tags` are unioned (kept in
 * canonical order), every other column replaces the built value.
 *
 * @param {DatasetRow} row
 * @param {Record<string, unknown>} override
 * @returns {DatasetRow}
 */
export function applyRowOverride(row, override) {
  /** @type {any} */
  const next = { ...row };
  for (const [key, value] of Object.entries(override)) {
    if (key === "notes") {
      continue;
    }
    if (UNION_COLUMNS.has(key) && Array.isArray(value)) {
      const merged = new Set([...(/** @type {string[]} */ (next[key]) ?? []), ...value.map(String)]);
      const order = key === "games" ? GAME_KEYS : TAGS;
      next[key] = [...order].filter((entry) => merged.has(entry));
      for (const entry of merged) {
        if (!order.includes(/** @type {never} */ (entry))) {
          next[key].push(entry);
        }
      }
      continue;
    }
    next[key] = value;
  }
  return next;
}

/** @param {unknown} value */
function isInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Column-level checks that mirror the table's constraints (13.4).
 *
 * @param {DatasetRow} row
 * @returns {string[]} problems
 */
export function validateRow(row) {
  /** @type {string[]} */
  const problems = [];
  const label = `Row ${row.slug || row.id}`;
  if (!isInt(row.id) || row.id <= 0) problems.push(`${label}: id must be a positive integer.`);
  if (!isInt(row.species_id) || row.species_id <= 0) problems.push(`${label}: species_id must be a positive integer.`);
  if (typeof row.slug !== "string" || row.slug.length === 0) problems.push(`${label}: slug is empty.`);
  if (typeof row.display_name !== "string" || row.display_name.length === 0) problems.push(`${label}: display_name is empty.`);
  if (typeof row.species_name !== "string" || row.species_name.length === 0) problems.push(`${label}: species_name is empty.`);
  if (!FORM_KINDS.includes(row.form_kind)) problems.push(`${label}: form_kind "${row.form_kind}" is not one of ${FORM_KINDS.join(", ")}.`);
  if (row.form_label !== null && typeof row.form_label !== "string") problems.push(`${label}: form_label must be a string or null.`);
  if (typeof row.type1 !== "string" || row.type1.length === 0) problems.push(`${label}: type1 is empty.`);
  if (row.type2 !== null && (typeof row.type2 !== "string" || row.type2.length === 0)) problems.push(`${label}: type2 must be a type or null.`);
  for (const stat of /** @type {const} */ (["hp", "attack", "defense", "special_attack", "special_defense", "speed"])) {
    if (!isInt(row[stat]) || row[stat] < 1 || row[stat] > 255) problems.push(`${label}: ${stat} must be an integer between 1 and 255.`);
  }
  if (!isInt(row.generation) || row.generation < 1 || row.generation > 9) problems.push(`${label}: generation must be between 1 and 9.`);
  if (!Array.isArray(row.tags) || row.tags.some((tag) => !TAGS.includes(/** @type {never} */ (tag)))) problems.push(`${label}: tags must be a subset of ${TAGS.join(", ")}.`);
  if (!Array.isArray(row.games) || row.games.some((game) => !GAME_KEYS.includes(game))) problems.push(`${label}: games must be a subset of ${GAME_KEYS.join(", ")}.`);
  if (!row.dex_numbers || typeof row.dex_numbers !== "object" || Array.isArray(row.dex_numbers) || Object.values(row.dex_numbers).some((value) => !isInt(value))) problems.push(`${label}: dex_numbers must map Pokédex names to integers.`);
  if (row.sprite_url !== null && typeof row.sprite_url !== "string") problems.push(`${label}: sprite_url must be a string or null.`);
  return problems;
}

/**
 * @param {DatasetRow[]} rows
 * @param {keyof DatasetRow} column
 * @returns {string[]}
 */
function duplicateProblems(rows, column) {
  /** @type {Map<unknown, string[]>} */
  const seen = new Map();
  for (const row of rows) {
    const list = seen.get(row[column]) ?? [];
    list.push(row.slug);
    seen.set(row[column], list);
  }
  return [...seen.entries()]
    .filter(([, slugs]) => slugs.length > 1)
    .map(([value, slugs]) => `${column} "${String(value)}" is shared by ${slugs.join(", ")}; fix it in overrides.json.`);
}

/**
 * @param {{
 *   catalog: import("./catalog.mjs").Catalog,
 *   overrides: RawOverrides,
 *   presets: import("./presets.mjs").Preset[],
 *   serebiiPages: Record<string, import("./serebii.mjs").SerebiiRow[]>,
 *   previousReport?: { byPreset?: Record<string, number> } | null,
 *   expectedKindCounts?: Record<string, number> | null,
 * }} input
 * @returns {{
 *   rows: DatasetRow[],
 *   regulations: import("./presets.mjs").Preset[],
 *   report: import("./report.mjs").Report,
 *   skipped: import("./report.mjs").SkippedVariety[],
 *   problems: string[],
 *   warnings: string[],
 * }}
 */
export function buildDataset({
  catalog,
  overrides: rawOverrides,
  presets,
  serebiiPages,
  previousReport = null,
  expectedKindCounts = EXPECTED_KIND_COUNTS,
}) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];

  const overrides = normalizeOverrides(rawOverrides, catalog);
  problems.push(...overrides.problems);
  problems.push(...validateGames(catalog));

  // Rules 1-7.
  const { kept, skipped } = selectVarieties(catalog, { keep: overrides.keep });

  /** @type {DatasetRow[]} */
  let rows = kept.map(({ species, pokemon, classification }) =>
    buildRow({ catalog, species, pokemon, kind: classification.kind, curated: overrides.curated })
  );

  // Curated overrides: patch known rows, add rows PokéAPI lacks.
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  for (const [slug, override] of overrides.rows) {
    const existing = bySlug.get(slug);
    if (existing) {
      bySlug.set(slug, applyRowOverride(existing, override));
    } else if (catalog.pokemonByName.has(slug)) {
      problems.push(
        `overrides.rows.${slug}: this variety is skipped by the selection rules (${skipped.find((entry) => entry.slug === slug)?.reason ?? "unknown reason"}); list it under "keep" to exempt it.`
      );
    } else {
      bySlug.set(slug, /** @type {DatasetRow} */ (applyRowOverride(/** @type {any} */ ({}), override)));
    }
  }
  rows = [...bySlug.values()].sort((a, b) => a.species_id - b.species_id || a.id - b.id);

  for (const row of rows) {
    problems.push(...validateRow(row));
  }
  problems.push(...duplicateProblems(rows, "id"));
  problems.push(...duplicateProblems(rows, "slug"));
  problems.push(...duplicateProblems(rows, "display_name"));

  // Champions rosters from Serebii, cumulative, resolved to dataset slugs,
  // plus the forms a suffix-less row stands for (see expandRosterForms).
  const { rosters, unmapped } = buildRosters(serebiiPages, catalog);
  problems.push(...unmapped);
  const order = new Map(rows.map((row, index) => [row.slug, index]));
  /** @type {Record<string, string[]>} */
  const orderedRosters = {};
  for (const [presetKey, resolved] of Object.entries(rosters)) {
    const slugs = expandRosterForms(resolved, rows);
    for (const slug of slugs) {
      const row = bySlug.get(slug);
      if (!row) {
        problems.push(`Roster ${presetKey}: "${slug}" is not a dataset row.`);
      } else if (!row.games.includes("champions")) {
        problems.push(
          `Roster ${presetKey}: "${slug}" is not available in champions; add {"games": ["champions"]} to overrides.json rows.${slug}.`
        );
      }
    }
    orderedRosters[presetKey] = [...slugs].sort(
      (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)
    );
  }
  const regulations = fillRosters(presets, orderedRosters);

  // Reg A-C by ranges must equal Reg A-C by tags.
  problems.push(...checkRegulationAgreement(rows, regulations));

  const counts = presetCounts(rows, regulations);
  const report = buildReport({
    rows,
    skipped,
    presetCounts: counts,
    unmapped,
    expected: expectedKindCounts ?? {},
  });
  if (expectedKindCounts) {
    problems.push(...kindCountProblems(report.byFormKind, expectedKindCounts));
  }
  warnings.push(...presetDriftWarnings(previousReport, counts));

  return { rows, regulations, report, skipped, problems, warnings };
}
