import { pointsToTier, type DraftPokemon } from "@/app/types/draft";
import { LEAGUE_LIMITS } from "@/app/types/league";

/**
 * Pure helpers for the pool page. The draft list mirrors what
 * `update_league_pool` accepts (docs/schema.md, `_validate_pool`): 1..2000
 * entries, unique trimmed names (case-insensitive, at most 80 characters),
 * integer points 1..20, tier = 21 - points.
 */

/** `_validate_pool` caps names at 80 characters. */
export const POOL_NAME_MAX = 80;

/**
 * One row of the pool while it is being edited. Rows are keyed by their
 * index, so a removed row is flagged rather than spliced out: nothing
 * shifts under the cursor, and the order stays frozen until Save.
 */
export type PoolDraftEntry = {
  name: string;
  /** Null while the points field is empty or not a number. */
  points: number | null;
  removed: boolean;
};

export type PoolRow = {
  /** Index into the pool (view mode) or the draft list (edit mode). */
  index: number;
  name: string;
  points: number | null;
  tier: number | null;
};

export function toDraftEntries(pokemon: DraftPokemon[]): PoolDraftEntry[] {
  return pokemon.map((entry) => ({
    name: entry.name,
    points: entry.points,
    removed: false,
  }));
}

/** The uniqueness key `_validate_pool` uses: trimmed, case-insensitive. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Read-only order: most expensive first, then by name. */
export function viewRows(pokemon: DraftPokemon[]): PoolRow[] {
  return pokemon
    .map((entry, index) => ({
      index,
      name: entry.name,
      points: entry.points,
      tier: entry.tier,
    }))
    .sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
}

/** Edit order: the list as stored, removed rows hidden, tier recomputed. */
export function editRows(entries: PoolDraftEntry[]): PoolRow[] {
  const rows: PoolRow[] = [];
  entries.forEach((entry, index) => {
    if (entry.removed) return;
    rows.push({
      index,
      name: entry.name,
      points: entry.points,
      tier: entry.points === null ? null : pointsToTier(entry.points),
    });
  });
  return rows;
}

export function filterRows(rows: PoolRow[], search: string): PoolRow[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

export const POINTS_MESSAGE = `Points are whole numbers from ${LEAGUE_LIMITS.poolPoints.min} to ${LEAGUE_LIMITS.poolPoints.max}.`;

export function isValidPoints(points: number | null): points is number {
  return (
    points !== null &&
    Number.isInteger(points) &&
    points >= LEAGUE_LIMITS.poolPoints.min &&
    points <= LEAGUE_LIMITS.poolPoints.max
  );
}

/** Why `name` cannot be added to `entries`, or null when it can. */
export function addProblem(
  entries: PoolDraftEntry[],
  name: string,
  points: number | null
): string | null {
  const clean = name.trim();
  if (!clean) return "Enter a Pokémon name.";
  if (clean.length > POOL_NAME_MAX) {
    return `Names are at most ${POOL_NAME_MAX} characters.`;
  }
  const key = nameKey(clean);
  if (entries.some((entry) => !entry.removed && nameKey(entry.name) === key)) {
    return `${clean} is already in the pool.`;
  }
  if (!isValidPoints(points)) return POINTS_MESSAGE;
  const active = entries.filter((entry) => !entry.removed).length;
  if (active >= LEAGUE_LIMITS.poolSize.max) {
    return `A draft pool holds at most ${LEAGUE_LIMITS.poolSize.max} Pokémon.`;
  }
  return null;
}

export type PoolValidation =
  | { pokemon: DraftPokemon[]; error: null }
  | { pokemon: null; error: string };

function fail(error: string): PoolValidation {
  return { pokemon: null, error };
}

/** Client-side copy of the `_validate_pool` rules; the RPC re-validates. */
export function validatePool(entries: PoolDraftEntry[]): PoolValidation {
  const active = entries.filter((entry) => !entry.removed);

  if (active.length < LEAGUE_LIMITS.poolSize.min) {
    return fail("Add at least one Pokémon before saving.");
  }
  if (active.length > LEAGUE_LIMITS.poolSize.max) {
    return fail(
      `A draft pool holds at most ${LEAGUE_LIMITS.poolSize.max} Pokémon; this one has ${active.length}.`
    );
  }

  const seen = new Set<string>();
  const pokemon: DraftPokemon[] = [];

  for (const entry of active) {
    const name = entry.name.trim();
    if (!name) return fail("Every Pokémon needs a name.");
    if (name.length > POOL_NAME_MAX) {
      return fail(`${name} is longer than ${POOL_NAME_MAX} characters.`);
    }
    const key = nameKey(name);
    if (seen.has(key)) return fail(`${name} appears more than once.`);
    seen.add(key);
    if (!isValidPoints(entry.points)) {
      return fail(`${name}: ${POINTS_MESSAGE}`);
    }
    pokemon.push({ name, points: entry.points, tier: pointsToTier(entry.points) });
  }

  return { pokemon, error: null };
}
