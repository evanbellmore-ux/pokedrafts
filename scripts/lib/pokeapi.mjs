// Small PokeAPI client for the seeding scripts: status checks, retries with
// exponential backoff, species lookups by dex number, and a concurrency
// limiter so we stay polite to the public API.

const BASE_URL = "https://pokeapi.co/api/v2";

export class NotFoundError extends Error {
  /** @param {string} url */
  constructor(url) {
    super(`PokeAPI returned 404 for ${url}`);
    this.name = "NotFoundError";
  }
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET a JSON document. Retries network errors, 429 and 5xx responses with
 * exponential backoff; 404 throws NotFoundError immediately; any other
 * non-OK status throws.
 *
 * @param {string} url
 * @param {{ retries?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, options = {}) {
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  /** @type {unknown} */
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) {
        return await res.json();
      }
      if (res.status === 404) {
        throw new NotFoundError(url);
      }
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new Error(`PokeAPI ${res.status} ${res.statusText} for ${url}`);
      if (!retryable) {
        throw lastError;
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < retries) {
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** @param {number} dexNumber */
export function fetchSpecies(dexNumber) {
  return fetchJson(`${BASE_URL}/pokemon-species/${dexNumber}`);
}

/** @param {number | string} idOrSlug */
export function fetchPokemon(idOrSlug) {
  return fetchJson(`${BASE_URL}/pokemon/${idOrSlug}`);
}

/**
 * The species' English display name ("Mr. Mime", "Flabébé", "Type: Null"),
 * falling back to a title-cased slug.
 *
 * @param {{ name: string, names?: Array<{ language: { name: string }, name: string }> }} species
 */
export function englishName(species) {
  const english = species.names?.find((entry) => entry.language?.name === "en")?.name;
  if (english) {
    return english;
  }
  return species.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Resolves a species by dex number to its default variety's /pokemon record.
 * This works for species whose default form carries a suffix in PokeAPI
 * (deoxys-normal, giratina-altered, ...) and for names with special characters.
 *
 * @param {number} dexNumber
 */
export async function fetchDefaultVariety(dexNumber) {
  const species = await fetchSpecies(dexNumber);
  /** @type {Array<{ is_default: boolean, pokemon: { name: string, url: string } }>} */
  const varieties = species.varieties ?? [];
  const variety = varieties.find((entry) => entry.is_default) ?? varieties[0];
  if (variety?.pokemon?.url) {
    return fetchJson(variety.pokemon.url);
  }
  // Default forms share their species id, so this is a safe last resort.
  return fetchPokemon(dexNumber);
}

/**
 * Lowercase type names in slot order, e.g. ["fire", "flying"].
 *
 * @param {{ types?: Array<{ slot: number, type: { name: string } }> }} pokemon
 * @returns {[string | null, string | null]}
 */
export function typesOf(pokemon) {
  const names = [...(pokemon.types ?? [])]
    .sort((a, b) => a.slot - b.slot)
    .map((entry) => entry.type.name.toLowerCase());
  return [names[0] ?? null, names[1] ?? null];
}

/**
 * Runs `fn` over `items` with at most `limit` in flight. Results keep the
 * input order; a rejected item is recorded instead of aborting the run.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<Array<{ status: "ok", value: R } | { status: "error", error: unknown }>>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  /** @type {Array<{ status: "ok", value: R } | { status: "error", error: unknown }>} */
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "ok", value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { status: "error", error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
