// data/pokemon/report.json: counts per game, form kind, tag and preset, the
// skipped varieties with reasons, and the roster names that could not be
// mapped (empty on a successful build). Pure.

import { GAME_KEYS } from "./games.mjs";
import { EXPECTED_KIND_COUNTS, FORM_KINDS, KIND_COUNT_TOLERANCE } from "./rows.mjs";
import { TAGS } from "./tags.mjs";

/**
 * @typedef {import("./build.mjs").DatasetRow} DatasetRow
 * @typedef {import("./rows.mjs").SkippedVariety} SkippedVariety
 * @typedef {{
 *   rows: number,
 *   species: number,
 *   byFormKind: Record<string, number>,
 *   expectedByFormKind: Record<string, number>,
 *   byGame: Record<string, number>,
 *   byTag: Record<string, number>,
 *   byPreset: Record<string, number>,
 *   skippedByReason: Record<string, number>,
 *   skipped: SkippedVariety[],
 *   unmappedRosterNames: string[],
 * }} Report
 */

/**
 * @param {{
 *   rows: DatasetRow[],
 *   skipped: SkippedVariety[],
 *   presetCounts: Record<string, number>,
 *   unmapped: string[],
 *   expected?: Record<string, number>,
 * }} input
 * @returns {Report}
 */
export function buildReport({ rows, skipped, presetCounts, unmapped, expected = EXPECTED_KIND_COUNTS }) {
  /** @type {Record<string, number>} */
  const byFormKind = {};
  for (const kind of FORM_KINDS) {
    byFormKind[kind] = 0;
  }
  /** @type {Record<string, number>} */
  const byGame = {};
  for (const key of GAME_KEYS) {
    byGame[key] = 0;
  }
  /** @type {Record<string, number>} */
  const byTag = {};
  for (const tag of TAGS) {
    byTag[tag] = 0;
  }
  const species = new Set();
  for (const row of rows) {
    species.add(row.species_id);
    byFormKind[row.form_kind] = (byFormKind[row.form_kind] ?? 0) + 1;
    for (const game of row.games) {
      byGame[game] = (byGame[game] ?? 0) + 1;
    }
    for (const tag of row.tags) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }
  /** @type {Record<string, number>} */
  const skippedByReason = {};
  for (const entry of skipped) {
    skippedByReason[entry.reason] = (skippedByReason[entry.reason] ?? 0) + 1;
  }
  return {
    rows: rows.length,
    species: species.size,
    byFormKind,
    expectedByFormKind: { ...expected },
    byGame,
    byTag,
    byPreset: { ...presetCounts },
    skippedByReason,
    skipped: [...skipped].sort((a, b) => a.rule - b.rule || a.slug.localeCompare(b.slug)),
    unmappedRosterNames: [...unmapped],
  };
}

/**
 * The per-kind counts must land within the tolerance of the expected sizes.
 *
 * @param {Record<string, number>} byFormKind
 * @param {Record<string, number>} expected
 * @param {number} [tolerance]
 * @returns {string[]} problems
 */
export function kindCountProblems(byFormKind, expected, tolerance = KIND_COUNT_TOLERANCE) {
  /** @type {string[]} */
  const problems = [];
  for (const [kind, want] of Object.entries(expected)) {
    const got = byFormKind[kind] ?? 0;
    if (Math.abs(got - want) > want * tolerance) {
      problems.push(
        `Form kind "${kind}": ${got} rows, expected ${want} (±${Math.round(tolerance * 100)}%). Review the skipped list, then update EXPECTED_KIND_COUNTS if the move is right.`
      );
    }
  }
  return problems;
}

/**
 * Preset counts that moved by more than `threshold` since the committed
 * report are worth a look (a Serebii layout change, a wrong tag list).
 *
 * @param {{ byPreset?: Record<string, number> } | null | undefined} previous
 * @param {Record<string, number>} current
 * @param {number} [threshold]
 * @returns {string[]} warnings
 */
export function presetDriftWarnings(previous, current, threshold = 0.2) {
  /** @type {string[]} */
  const warnings = [];
  const before = previous?.byPreset;
  if (!before) {
    return warnings;
  }
  for (const [key, count] of Object.entries(current)) {
    const was = before[key];
    if (typeof was !== "number" || was === 0) {
      continue;
    }
    const change = Math.abs(count - was) / was;
    if (change > threshold) {
      warnings.push(
        `Preset ${key}: ${was} -> ${count} rows (${Math.round(change * 100)}% change since the committed report).`
      );
    }
  }
  return warnings;
}
