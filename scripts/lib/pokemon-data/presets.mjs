// Regulation presets (docs/release-architecture.md 13.6): filling Champions
// rosters, applying filter rules for the report's counts, and the Reg A/B/C
// range-versus-tag agreement check that catches a wrong tag list. Pure.

/**
 * @typedef {{ kind: "roster", slugs: string[] }} RosterRule
 * @typedef {{
 *   kind: "filter",
 *   dexes: string[] | null,
 *   dexRanges: Record<string, Array<[number, number]>> | null,
 *   excludeTags: string[],
 *   restrictedPerTeam?: number,
 * }} FilterRule
 * @typedef {{
 *   key: string,
 *   game: string,
 *   name: string,
 *   starts: string | null,
 *   ends: string | null,
 *   source: string,
 *   rule: RosterRule | FilterRule,
 *   notes?: string,
 * }} Preset
 * @typedef {{ slug: string, games: string[], tags: string[], dex_numbers: Record<string, number> }} RuleRow
 */

/**
 * Paldea entry ranges that describe Reg A, B and C without tags: A keeps
 * 1-375 and 388-392 (no Paradox, no Treasures of Ruin, no Koraidon or
 * Miraidon), B adds the Paradox entries 376-387 and 397-398, C adds the
 * Treasures of Ruin 393-396.
 */
export const REGULATION_RANGES = /** @type {Record<string, Record<string, Array<[number, number]>>>} */ ({
  "sv-reg-a": { paldea: [[1, 375], [388, 392]] },
  "sv-reg-b": { paldea: [[1, 392], [397, 398]] },
  "sv-reg-c": { paldea: [[1, 398]] },
});

/**
 * Rows of `game` that a filter rule keeps.
 *
 * @template {RuleRow} T
 * @param {T[]} rows
 * @param {string} game
 * @param {Pick<FilterRule, "dexes" | "dexRanges" | "excludeTags">} rule
 * @returns {T[]}
 */
export function applyFilterRule(rows, game, rule) {
  return rows.filter((row) => {
    if (!row.games.includes(game)) {
      return false;
    }
    if (rule.dexes && !rule.dexes.some((dex) => dex in row.dex_numbers)) {
      return false;
    }
    if (rule.dexRanges) {
      const inRange = Object.entries(rule.dexRanges).some(([dex, ranges]) => {
        const number = row.dex_numbers[dex];
        return number !== undefined && ranges.some(([low, high]) => number >= low && number <= high);
      });
      if (!inRange) {
        return false;
      }
    }
    if (rule.excludeTags.some((tag) => row.tags.includes(tag))) {
      return false;
    }
    return true;
  });
}

/**
 * Rows a preset keeps.
 *
 * @template {RuleRow} T
 * @param {T[]} rows
 * @param {Preset} preset
 * @returns {T[]}
 */
export function presetRows(rows, preset) {
  if (preset.rule.kind === "roster") {
    const slugs = new Set(preset.rule.slugs);
    return rows.filter((row) => slugs.has(row.slug));
  }
  return applyFilterRule(rows, preset.game, preset.rule);
}

/**
 * @param {RuleRow[]} rows
 * @param {Preset[]} presets
 * @returns {Record<string, number>}
 */
export function presetCounts(rows, presets) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const preset of presets) {
    counts[preset.key] = presetRows(rows, preset).length;
  }
  return counts;
}

/**
 * Reg A, B and C derived by Paldea entry ranges must equal the same sets
 * derived by the presets' Pokédex and tag rules.
 *
 * @param {RuleRow[]} rows
 * @param {Preset[]} presets
 * @returns {string[]} problems, empty when every pair agrees
 */
export function checkRegulationAgreement(rows, presets) {
  /** @type {string[]} */
  const problems = [];
  for (const [key, ranges] of Object.entries(REGULATION_RANGES)) {
    const preset = presets.find((entry) => entry.key === key);
    if (!preset) {
      problems.push(`Preset ${key} is missing from regulations.json.`);
      continue;
    }
    if (preset.rule.kind !== "filter") {
      problems.push(`Preset ${key} must be a filter rule.`);
      continue;
    }
    const byRanges = new Set(
      applyFilterRule(rows, preset.game, {
        dexes: Object.keys(ranges),
        dexRanges: ranges,
        excludeTags: [],
      }).map((row) => row.slug)
    );
    const byTags = new Set(
      applyFilterRule(rows, preset.game, {
        dexes: preset.rule.dexes,
        dexRanges: null,
        excludeTags: preset.rule.excludeTags,
      }).map((row) => row.slug)
    );
    const onlyRanges = [...byRanges].filter((slug) => !byTags.has(slug));
    const onlyTags = [...byTags].filter((slug) => !byRanges.has(slug));
    if (onlyRanges.length > 0 || onlyTags.length > 0) {
      problems.push(
        `Preset ${key}: ranges and tags disagree. Only by ranges: [${onlyRanges.join(", ")}]. Only by tags: [${onlyTags.join(", ")}].`
      );
    }
  }
  return problems;
}

/**
 * Presets with roster slugs replaced by the resolved rosters; every other
 * field is kept as committed.
 *
 * @param {Preset[]} presets
 * @param {Record<string, string[]>} rosters preset key -> slugs
 * @returns {Preset[]}
 */
export function fillRosters(presets, rosters) {
  return presets.map((preset) => {
    if (preset.rule.kind !== "roster" || !(preset.key in rosters)) {
      return preset;
    }
    return { ...preset, rule: { ...preset.rule, slugs: rosters[preset.key] } };
  });
}
