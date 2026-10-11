import { buildComparison } from './core.mjs';
import { clientIp, LogServiceError, rateOk, wcl, type WclQueryOptions } from '../lib';
import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../execution/availability';
import {
  assertUpstreamData, ComparisonDataError, InputError, normalizeComparison, parseCompareRequest,
  type ComparisonClient, type CompareParams,
} from './contracts';

export const COMPARE_TTL_MS = 600_000;
export const COMPARE_DEADLINE_MS = 55_000;
export const MAX_COMPARE_CACHE_ENTRIES = 32;
export const MAX_COMPARE_CACHE_BYTES = 8 * 1024 * 1024;

export interface CompareHandlerOptions {
  builder?: (client: ComparisonClient, params: CompareParams) => Promise<unknown>;
  query?: (document: string, variables?: Record<string, unknown>, options?: WclQueryOptions) => Promise<unknown>;
  clock?: () => number;
  admission?: (request: Request) => boolean;
  deadlineMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
}

interface CachedSuccess { at: number; body: string; bytes: number }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}
function serialized(body: string): Response {
  return new Response(body, { headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
function safeFailure(error: unknown): string {
  if (error instanceof LogServiceError || error instanceof ComparisonDataError) return error.message;
  const message = error instanceof Error ? error.message : '';
  if (/character .*not found/i.test(message)) return 'The requested character was not found on the log service.';
  if (/rankings are hidden|no ranked kill|no recent public kill/i.test(message)) return 'No accessible ranked or recent public kill was found for this encounter and difficulty.';
  if (/no mirrorable/i.test(message)) return 'No mirrorable world reference is available for this encounter and build.';
  if (/could not determine.*spec/i.test(message)) return 'The player specialization could not be determined for the selected fight.';
  if (/identity|actor|fight not found|incomplete|cursor|page cap/i.test(message)) return 'The public fight data was incomplete or the player identity could not be verified.';
  return 'The public log-service comparison could not be completed. Try again later.';
}
function positiveOption(value: number, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}

/** One handler owns one bounded warm-instance cache. Nothing is shared between
 * cold instances, and no comparison IDs or Execution pins are retained.
 * Injected transports must honor options.signal, just like the production WCL
 * client: the invocation waits for all started transport work to settle. */
export function createCompareHandler(options: CompareHandlerOptions = {}) {
  const builder = options.builder ?? buildComparison;
  const query = options.query ?? wcl;
  const clock = options.clock ?? Date.now;
  const admission = options.admission ?? ((request: Request) => rateOk(clientIp(request), 'compare'));
  const deadlineMs = positiveOption(options.deadlineMs ?? COMPARE_DEADLINE_MS, 'deadlineMs', COMPARE_DEADLINE_MS);
  const ttl = positiveOption(options.cacheTtlMs ?? COMPARE_TTL_MS, 'cacheTtlMs', COMPARE_TTL_MS);
  const maxEntries = positiveOption(options.maxCacheEntries ?? MAX_COMPARE_CACHE_ENTRIES, 'maxCacheEntries');
  const maxBytes = positiveOption(options.maxCacheBytes ?? MAX_COMPARE_CACHE_BYTES, 'maxCacheBytes');
  const cache = new Map<string, CachedSuccess>();
  let cachedBytes = 0;
  const remove = (key: string) => {
    const hit = cache.get(key);
    if (hit) { cachedBytes -= hit.bytes; cache.delete(key); }
  };
  const prune = (now: number) => {
    for (const [key, hit] of cache) if (now < hit.at || now - hit.at >= ttl) remove(key);
  };

  return async function compare(request: Request): Promise<Response> {
    if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
    let parsed: ReturnType<typeof parseCompareRequest>;
    try { parsed = parseCompareRequest(request); } catch (error) {
      return json({ error: error instanceof InputError ? error.message : 'Invalid comparison request.' }, 400);
    }
    if (request.signal.aborted) return json({ error: 'The comparison request was canceled.' }, 499);
    const { params, zone } = parsed;
    const key = JSON.stringify([params, zone]);
    prune(clock());
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return serialized(hit.body);
    }
    try {
      if (!admission(request)) return json({ error: 'rate limit: too many fresh compares from this address — try again later' }, 429);
    } catch {
      return json({ error: 'Comparison admission is temporarily unavailable.' }, 503);
    }

    const controller = new AbortController();
    const pending = new Set<Promise<unknown>>();
    let timedOut = false;
    const startedAt = clock();
    const timeout = () => {
      timedOut = true;
      controller.abort(new DOMException('Comparison deadline exceeded', 'TimeoutError'));
    };
    const timer = setTimeout(timeout, deadlineMs);
    const cancel = () => controller.abort(new DOMException('Comparison request canceled', 'AbortError'));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();

    const client: ComparisonClient = {
      query(document, variables = {}) {
        // After a required branch fails, canonical Boss continuations cannot
        // dispatch more network work while the invocation is being settled.
        if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
        const work = (async () => {
          controller.signal.throwIfAborted();
          const data = await query(document, variables, { signal: controller.signal });
          controller.signal.throwIfAborted();
          assertUpstreamData(document, data);
          return data;
        })();
        pending.add(work);
        // Both branches consume rejection; this bookkeeping never starts work
        // or leaves an unhandled finally/rejection promise behind.
        void work.then(() => pending.delete(work), () => pending.delete(work));
        return work;
      },
    };

    let response: Response;
    let cacheBody: string | null = null;
    try {
      const result = await builder(client, params);
      const { comparison, complete } = normalizeComparison(result, params);
      if (request.signal.aborted) {
        response = json({ error: 'The comparison request was canceled.' }, 499);
      } else {
        // An abort that affected only Boss may still leave a complete Overall
        // result; canonical buildComparison explicitly isolates that branch.
        const body = JSON.stringify({
          ...comparison,
          executionStatus: getHostedExecutionAvailability({
            zone,
            encounter: params.encounter, difficulty: params.difficulty,
            className: comparison.className, spec: comparison.spec,
            hero: params.hero ?? comparison.hero.a, pi: comparison.pi.a,
          }),
        });
        if (!timedOut && clock() - startedAt >= deadlineMs) timeout();
        if (timedOut && complete) {
          response = json({ error: 'The comparison exceeded its request deadline. Try again later.' }, 504);
        } else {
          response = serialized(body);
          if (complete && !timedOut && pending.size === 0) cacheBody = body;
        }
      }
    } catch (error) {
      response = request.signal.aborted
        ? json({ error: 'The comparison request was canceled.' }, 499)
        : timedOut
          ? json({ error: 'The comparison exceeded its request deadline. Try again later.' }, 504)
          : json({ error: safeFailure(error) }, 502);
    } finally {
      // Promise.all in the canonical builder can reject while its independent
      // Boss branch is still fetching. Abort it, then settle every started
      // query (including its body/retry wait) before returning any response.
      controller.abort(new DOMException('Comparison invocation finished', 'AbortError'));
      while (pending.size) await Promise.allSettled([...pending]);
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }

    if (request.signal.aborted) return json({ error: 'The comparison request was canceled.' }, 499);
    if (cacheBody !== null && !timedOut) {
      const bytes = Buffer.byteLength(cacheBody, 'utf8');
      if (bytes <= maxBytes) {
        prune(clock());
        remove(key);
        cache.set(key, { at: clock(), body: cacheBody, bytes });
        cachedBytes += bytes;
        while (cache.size > maxEntries || cachedBytes > maxBytes) remove(cache.keys().next().value!);
      }
    }
    return response;
  };
}
