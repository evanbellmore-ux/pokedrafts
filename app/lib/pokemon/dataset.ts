import { isMissingTable, normalizePokemonName, toPokeApiSlug } from "@/app/lib/pokemon";
import { createClient } from "@/app/lib/supabase/client";
import type { FormKind, PokemonEntry } from "@/app/types/pokemon";

/**
 * The Pokémon dataset (`public.pokemon`, docs/release-architecture.md 13.4)
 * loaded once per session for the Pool Builder. Read-only: the seed script
 * is the table's only writer. Paginated like the dex so the ~1,230 rows
 * arrive in two requests whatever PostgREST's row limit is.
 */

export const DATASET_PAGE_SIZE = 1000;
const DATASET_MAX_PAGES = 20;

/** The columns of 13.4, in the order the type lists them. */
export const DATASET_COLUMNS =
  "id, species_id, slug, display_name, species_name, form_kind, form_label, type1, type2, hp, attack, defense, special_attack, special_defense, speed, bst, generation, tags, games, dex_numbers, sprite_url, updated_at";

const FORM_KINDS: readonly FormKind[] = ["default", "mega", "regional", "gender", "other"];

type DatasetRow = Partial<Record<keyof PokemonEntry, unknown>>;

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function dexNumbers(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const numbers: Record<string, number> = {};
  for (const [dex, number] of Object.entries(value)) {
    if (typeof number === "number" && Number.isFinite(number)) numbers[dex] = number;
  }
  return numbers;
}

/**
 * One table row as a `PokemonEntry`, or null when it lacks the identity
 * columns (id, slug, display name, first type). Everything else is coerced
 * so a partially filled row still renders rather than breaking the page.
 */
export function toPokemonEntry(row: unknown): PokemonEntry | null {
  if (typeof row !== "object" || row === null) return null;
  const raw = row as DatasetRow;
  const slug = text(raw.slug);
  const displayName = text(raw.display_name);
  const type1 = text(raw.type1);
  if (typeof raw.id !== "number" || !slug || !displayName || !type1) return null;

  const stats = {
    hp: integer(raw.hp),
    attack: integer(raw.attack),
    defense: integer(raw.defense),
    special_attack: integer(raw.special_attack),
    special_defense: integer(raw.special_defense),
    speed: integer(raw.speed),
  };
  const sum =
    stats.hp + stats.attack + stats.defense + stats.special_attack + stats.special_defense + stats.speed;
  const formKind = text(raw.form_kind);

  return {
    id: raw.id,
    species_id: integer(raw.species_id),
    slug,
    display_name: displayName,
    species_name: text(raw.species_name) ?? displayName,
    form_kind: (FORM_KINDS as readonly string[]).includes(formKind ?? "")
      ? (formKind as FormKind)
      : "other",
    form_label: text(raw.form_label),
    type1,
    type2: text(raw.type2),
    ...stats,
    bst: integer(raw.bst, sum),
    generation: integer(raw.generation, 1),
    tags: stringList(raw.tags),
    games: stringList(raw.games),
    dex_numbers: dexNumbers(raw.dex_numbers),
    sprite_url: text(raw.sprite_url),
    updated_at: text(raw.updated_at),
  };
}

let datasetPromise: Promise<PokemonEntry[]> | null = null;
let datasetCache: PokemonEntry[] | null = null;

/** Synchronously returns the dataset if it has already been loaded. */
export function getCachedDataset(): PokemonEntry[] | null {
  return datasetCache;
}

/**
 * Loads every `pokemon` row once per session (paginated until exhausted),
 * ordered by species then id. A failed load clears the cache so the next
 * call retries; an empty result is cached (the table has not been seeded)
 * and the builder shows its empty state. A table that does not exist yet
 * (the migration has not been applied: PostgREST answers PGRST205, Postgres
 * 42P01) is the same unseeded state, not an error, so a client deployed
 * before the migration shows the empty state rather than "Something went
 * wrong" (13.9 step 3).
 */
export function loadDataset(): Promise<PokemonEntry[]> {
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async () => {
    const supabase = createClient();
    const entries: PokemonEntry[] = [];

    for (let page = 0; page < DATASET_MAX_PAGES; page += 1) {
      const from = page * DATASET_PAGE_SIZE;
      const { data, error } = await supabase
        .from("pokemon")
        .select(DATASET_COLUMNS)
        .order("species_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + DATASET_PAGE_SIZE - 1);

      if (error) {
        if (page === 0 && isMissingTable(error)) break;
        throw error;
      }

      const rows = (data ?? []) as unknown[];
      for (const row of rows) {
        const entry = toPokemonEntry(row);
        if (entry) entries.push(entry);
      }
      if (rows.length < DATASET_PAGE_SIZE) break;
    }

    datasetCache = entries;
    return entries;
  })().catch((error) => {
    datasetPromise = null;
    throw error;
  });

  return datasetPromise;
}

/** Test hook: replaces the module cache. */
export function primeDatasetCache(entries: PokemonEntry[] | null) {
  datasetCache = entries;
  datasetPromise = entries ? Promise.resolve(entries) : null;
}

/** A name lookup over a fixed set of entries (see `indexDataset`). */
export type DatasetIndex = {
  /** The entry a typed name resolves to, or null (same rule as `findDatasetEntry`). */
  find(name: string): PokemonEntry | null;
};

/**
 * Builds a lookup keyed by every entry's normalized display name, normalized
 * slug and exact slug, so many names resolve at the cost of one pass over
 * the entries. The first entry in list order wins a shared key, exactly as
 * a linear scan would.
 */
export function indexDataset(entries: readonly PokemonEntry[]): DatasetIndex {
  const byKey = new Map<string, PokemonEntry>();
  const bySlug = new Map<string, PokemonEntry>();
  for (const entry of entries) {
    const nameKey = normalizePokemonName(entry.display_name);
    const slugKey = normalizePokemonName(entry.slug);
    if (!byKey.has(nameKey)) byKey.set(nameKey, entry);
    if (!byKey.has(slugKey)) byKey.set(slugKey, entry);
    if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
  }
  return {
    find(name) {
      const key = normalizePokemonName(name);
      if (!key) return null;
      return byKey.get(key) ?? bySlug.get(toPokeApiSlug(name)) ?? null;
    },
  };
}

/**
 * The entry whose display name or slug matches a typed name, ignoring
 * case, punctuation and spacing ("rotom-wash" finds "Rotom (Wash)"), or
 * whose slug is what `toPokeApiSlug` derives from the name, so the legacy
 * spellings the app already maps ("Paldean Tauros Blaze") land on the
 * dataset's own display name instead of being stored as typed.
 */
export function findDatasetEntry(
  entries: readonly PokemonEntry[],
  name: string
): PokemonEntry | null {
  return indexDataset(entries).find(name);
}
