import { normalizePokemonName } from "@/app/lib/pokemon";
import { pointsToTier, type DraftFormat, type DraftPokemon } from "@/app/types/draft";
import { LEAGUE_LIMITS } from "@/app/types/league";

/**
 * Pure helpers for the Pool Builder: parsing uploaded files and saved
 * formats, validating the editor state and building the JSON that is saved
 * to `draft_formats` or exported. The rules mirror `_validate_pool` in
 * docs/schema.md (1..2000 entries, unique non-empty names of at most 80
 * characters, integer points 1..20, tier = 21 - points) so a format saved
 * here is never refused when a league copies it.
 */

export const POOL_VERSION = "1.0";
export const MAX_FORMAT_NAME_LENGTH = 60;
export const MAX_POKEMON_NAME_LENGTH = 80;
export const MIN_POINTS = LEAGUE_LIMITS.poolPoints.min;
export const MAX_POINTS = LEAGUE_LIMITS.poolPoints.max;
export const MAX_POOL_SIZE = LEAGUE_LIMITS.poolSize.max;
/** Points given to a Pokémon added by name; the coach adjusts it afterwards. */
export const DEFAULT_POINTS = 10;

/** One editable row. `key` is a stable id for React keys and edits. */
export type PoolEntry = DraftPokemon & { key: string };

let nextKey = 0;

/** Collapses whitespace and trims; the name that is stored and compared. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function parsePoints(raw: unknown): number {
  if (typeof raw === "number") return Math.trunc(raw);
  if (typeof raw === "string") return Number.parseInt(raw.trim(), 10);
  return Number.NaN;
}

/** Parses points from a number or a string; NaN becomes `fallback`; clamped to 1..20. */
export function coercePoints(raw: unknown, fallback = MIN_POINTS): number {
  const parsed = parsePoints(raw);
  const value = Number.isNaN(parsed) ? fallback : parsed;
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, value));
}

export function makeEntry(name: string, points: number): PoolEntry {
  nextKey += 1;
  const clamped = coercePoints(points);
  return {
    key: `pool-${nextKey}`,
    name: cleanName(name).slice(0, MAX_POKEMON_NAME_LENGTH),
    points: clamped,
    tier: pointsToTier(clamped),
  };
}

export type ParsedPool = {
  /** `leagueName` from the file, or null when absent or blank. */
  name: string | null;
  entries: PoolEntry[];
  /** Entries dropped because they had no non-empty name. */
  skipped: number;
  /** Entries whose points were missing or outside 1..20 and were coerced. */
  adjusted: number;
};

/**
 * Accepts the shape this page exports and any `{ pokemon: [{ name, points }] }`
 * document. Nameless entries are skipped, points are coerced into 1..20 and
 * tiers are recomputed so a hand-edited file cannot disagree with itself.
 * Throws an Error with a user-facing message when the document is not a pool.
 */
export function parsePoolJson(value: unknown): ParsedPool {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("That file does not contain a draft pool.");
  }

  const raw = value as { leagueName?: unknown; pokemon?: unknown };
  if (!Array.isArray(raw.pokemon)) {
    throw new Error('That file is missing a "pokemon" list.');
  }
  if (raw.pokemon.length > MAX_POOL_SIZE) {
    throw new Error(`A draft pool can hold at most ${MAX_POOL_SIZE} Pokémon.`);
  }

  const entries: PoolEntry[] = [];
  let skipped = 0;
  let adjusted = 0;

  for (const item of raw.pokemon) {
    const record =
      typeof item === "object" && item !== null
        ? (item as { name?: unknown; points?: unknown })
        : {};
    const name = typeof record.name === "string" ? cleanName(record.name) : "";
    if (!name) {
      skipped += 1;
      continue;
    }
    const points = coercePoints(record.points);
    if (parsePoints(record.points) !== points) adjusted += 1;
    entries.push(makeEntry(name, points));
  }

  const leagueName =
    typeof raw.leagueName === "string" ? cleanName(raw.leagueName) : "";

  return {
    name: leagueName ? leagueName.slice(0, MAX_FORMAT_NAME_LENGTH) : null,
    entries,
    skipped,
    adjusted,
  };
}

/** `parsePoolJson` for the text of an uploaded file. */
export function parsePoolFile(text: string): ParsedPool {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  return parsePoolJson(parsed);
}

/** Lookup key used for duplicate detection ("Mr. Mime" and "mr-mime" collide). */
export function entryKey(name: string): string {
  return normalizePokemonName(cleanName(name));
}

/** Keys that appear on more than one row. Blank names are ignored. */
export function findDuplicateKeys(entries: readonly PoolEntry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entryKey(entry.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  counts.forEach((count, key) => {
    if (count > 1) duplicates.add(key);
  });
  return duplicates;
}

export function countBlankNames(entries: readonly PoolEntry[]): number {
  return entries.filter((entry) => !cleanName(entry.name)).length;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The message that blocks Save and Export, or null when the rows are valid.
 * The format name is checked separately because Export does not need it.
 */
export function rowProblem(entries: readonly PoolEntry[]): string | null {
  const duplicates = findDuplicateKeys(entries).size;
  const blank = countBlankNames(entries);
  const problems: string[] = [];
  if (duplicates > 0) {
    problems.push(plural(duplicates, "duplicate name", "duplicate names"));
  }
  if (blank > 0) {
    problems.push(plural(blank, "row without a name", "rows without a name"));
  }
  if (problems.length === 0) return null;
  return `Fix ${problems.join(" and ")} before saving or exporting.`;
}

/** The JSON stored in `draft_formats.json` and written by Export. */
export function toDraftFormat(
  name: string,
  entries: readonly PoolEntry[]
): DraftFormat {
  return {
    version: POOL_VERSION,
    leagueName: cleanName(name).slice(0, MAX_FORMAT_NAME_LENGTH),
    pokemon: entries.map((entry) => {
      const points = coercePoints(entry.points);
      return {
        name: cleanName(entry.name).slice(0, MAX_POKEMON_NAME_LENGTH),
        points,
        tier: pointsToTier(points),
      };
    }),
  };
}

/** `<name>-pool.json`, lowercase with hyphens. */
export function exportFileName(name: string): string {
  const slug = cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "draft"}-pool.json`;
}

/** Stable fingerprint of what Save would write, for unsaved-change detection. */
export function serializeEntries(entries: readonly PoolEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => [cleanName(entry.name), entry.points])
  );
}

/** "<name> (copy)", trimmed to fit the 60-character name limit. */
export function copyName(name: string): string {
  const suffix = " (copy)";
  const base = cleanName(name).slice(0, MAX_FORMAT_NAME_LENGTH - suffix.length);
  return `${base}${suffix}`;
}

/** Number of entries in a saved format's JSON, tolerant of odd shapes. */
export function countFormatPokemon(json: unknown): number {
  if (typeof json !== "object" || json === null) return 0;
  const pokemon = (json as { pokemon?: unknown }).pokemon;
  return Array.isArray(pokemon) ? pokemon.length : 0;
}
