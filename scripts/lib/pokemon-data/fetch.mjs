// HTTP helpers for the build script: a JSON fetcher with a descriptive
// User-Agent (PokéAPI returns 403 without one) and retry with exponential
// backoff, and a bounded-concurrency map. The fetch and sleep functions are
// injectable so tests run without a network.

export const USER_AGENT =
  "pokedrafts-build-pokemon-data/1.0 (+https://github.com/evanbellmore-ux/pokedrafts)";

/** At most this many requests in flight at once. */
export const MAX_IN_FLIGHT = 6;

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  /**
   * @param {string} url
   * @param {number} status
   */
  constructor(url, status) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

/**
 * @param {{
 *   fetch?: typeof globalThis.fetch,
 *   userAgent?: string,
 *   retries?: number,
 *   baseDelayMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   accept?: string,
 * }} [options]
 * @returns {(url: string) => Promise<string>} fetches the body as text
 */
export function createTextFetcher(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent ?? USER_AGENT;
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const accept = options.accept ?? "*/*";

  return async function fetchText(url) {
    /** @type {unknown} */
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetchImpl(url, { headers: { "user-agent": userAgent, accept } });
        if (res.ok) {
          return await res.text();
        }
        const error = new HttpError(url, res.status);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) {
          throw error;
        }
        lastError = error;
      } catch (error) {
        if (error instanceof HttpError && !(error.status === 429 || error.status >= 500)) {
          throw error;
        }
        lastError = error;
      }
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

/**
 * @param {Parameters<typeof createTextFetcher>[0]} [options]
 * @returns {(url: string) => Promise<any>}
 */
export function createJsonFetcher(options = {}) {
  const fetchText = createTextFetcher({ accept: "application/json", ...options });
  return async function fetchJson(url) {
    return JSON.parse(await fetchText(url));
  };
}

/**
 * Runs `fn` over `items` with at most `limit` in flight, keeping input order.
 * The first rejection aborts the run (workers stop picking up new items) and
 * is rethrown once the in-flight calls settle.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length);
  /** @type {unknown} */
  let failure;
  let failed = false;
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !failed) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  });
  await Promise.all(workers);
  if (failed) {
    throw failure;
  }
  return results;
}
