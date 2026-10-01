import type { BuildIssue } from "@/app/lib/battle/types";

/**
 * Which collapsible settings sections are open, and the issue fields each had when last seen.
 * A Pokémon's Build settings is keyed by its slot key, so like its build it follows that Pokémon
 * through a Swap; Field conditions is keyed by the matchup revision. A Reset or game change (new
 * keys) starts them all collapsed.
 */
export type SettingsSections = { open: Readonly<Record<string, boolean>>; fields: Readonly<Record<string, readonly string[]>> };

export const NO_SETTINGS_SECTIONS: SettingsSections = { open: {}, fields: {} };

export const buildSectionKey = (slotKey: number) => `build-${slotKey}`;
export const fieldSectionKey = (revision: number) => `field-${revision}`;

export function setSectionOpen(sections: SettingsSections, key: string, open: boolean): SettingsSections {
  return !!sections.open[key] === open ? sections : { ...sections, open: { ...sections.open, [key]: open } };
}

/**
 * Opens a section when it gains an issue field it did not have, so a new problem is never hidden.
 * Fixing an issue, or one that stays, leaves the open state to the user.
 * Returns the same object when nothing changed.
 */
export function trackSectionIssues(sections: SettingsSections, entries: readonly { key: string; issues: readonly BuildIssue[] }[]): SettingsSections {
  let next = sections;
  for (const { key, issues } of entries) {
    const fields = [...new Set(issues.map((issue) => issue.field))].sort();
    const before = next.fields[key] ?? [];
    if (fields.length === before.length && fields.every((field, index) => field === before[index])) continue;
    const gained = fields.some((field) => !before.includes(field));
    next = { open: gained ? { ...next.open, [key]: true } : next.open, fields: { ...next.fields, [key]: fields } };
  }
  return next;
}
