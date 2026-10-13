import { buildComparison } from './core.mjs';
import { clientIp, LogServiceError, rateOk, wcl, type WclQueryOptions } from '../lib';
import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../execution/availability';
import { createHostedComparisonBinder } from '../execution/runtime';
import { COMPARISON_ID_PATTERN, EXECUTION_PIN_TTL_MS, nativeExecutionStatus, type CompareExecutionBinder, type ExecutionPinBinding } from '../execution/pins';
import {
  assertUpstreamData, comparisonDataDiagnostic, ComparisonDataError, InputError, normalizeComparison, parseCompareRequest,
  type Comparison, type ComparisonClient, type CompareParams, type FightSide,
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
  executionBinder?: false | ((request: Request, context: { now: () => number; deadlineAt: number }) => CompareExecutionBinder | null);
}

interface CachedSuccess { at: number; body: string; bytes: number; pinCreatedAt: number | null }

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

/** Copy a normalized whitelist, including nested headers, before a server-only
 * binder sees it. Nested builder Execution/IDs and post-build mutations cannot
 * change the pair retained in Postgres. Throughput values remain unchanged. */
function protectedComparison(value: Comparison): Comparison {
  const projectSide = (side: FightSide): FightSide => {
    const scope = { zone: side.scope.zone, encounter: side.scope.encounter, difficulty: side.scope.difficulty, size: side.scope.size };
    // Preserve valid legacy display fields, never use them as native provenance.
    const legacyScope = side.scope as typeof side.scope & { partition?: unknown; patch?: unknown };
    if (legacyScope.partition === null || typeof legacyScope.partition === 'number' && Number.isSafeInteger(legacyScope.partition) && legacyScope.partition > 0) {
      Object.assign(scope, { partition: legacyScope.partition });
    }
    if (legacyScope.patch === null || typeof legacyScope.patch === 'string' && legacyScope.patch.length <= 128) Object.assign(scope, { patch: legacyScope.patch });
    return Object.freeze({
      name: side.name, server: side.server, actorID: side.actorID, code: side.code, fightID: side.fightID,
      amount: side.amount, rankPercent: side.rankPercent, durSec: side.durSec, kill: side.kill, scope: Object.freeze(scope),
      ...(side.rankingPatch ? { rankingPatch: Object.freeze({ current: side.rankingPatch.current, selected: side.rankingPatch.selected, fallback: true as const }) } : {}),
      casts: side.casts.map(([at, name]) => [at, name]), dmg: { ...side.dmg },
      resources: Object.fromEntries(Object.entries(side.resources).map(([key, resource]) => [key, {
        max: resource.max, spentSnap: resource.spentSnap, gained: resource.gained, waste: resource.waste,
        series: resource.series.map(([at, amount]) => [at, amount]),
      }])), lust: side.lust.map(([start, end]) => [start, end]),
    }) as FightSide;
  };
  const projectPI = (pi: Comparison['pi']) => Object.freeze({ a: pi.a, b: pi.b, excluded: pi.excluded });
  const projectHero = (hero: Comparison['hero']) => Object.freeze({ a: hero.a, b: hero.b, alt: hero.alt, requested: hero.requested });
  const out: Comparison = {
    encounter: Object.freeze({ id: value.encounter.id, name: value.encounter.name }), difficulty: value.difficulty, metric: value.metric,
    spec: value.spec, className: value.className, pi: projectPI(value.pi), hero: projectHero(value.hero), a: projectSide(value.a), b: projectSide(value.b),
  };
  if (value.bossReference) out.bossReference = Object.freeze({
    b: projectSide(value.bossReference.b), pi: projectPI(value.bossReference.pi), hero: projectHero(value.bossReference.hero), rankingMetric: 'bossdps',
  });
  else if (Object.hasOwn(value, 'bossReference')) out.bossReference = null;
  if (value.bossReferenceError) out.bossReferenceError = value.bossReferenceError;
  return Object.freeze(out);
}
function expiredPin(body: string): string {
  const value = JSON.parse(body);
  delete value.comparisonID;
  value.executionV3Status = nativeExecutionStatus(null);
  return JSON.stringify(value);
}
function pinExpired(createdAt: number | null, now: number): boolean {
  return createdAt !== null && (now < createdAt || now - createdAt >= EXECUTION_PIN_TTL_MS);
}

/** One handler owns one bounded throughput warm cache, not an Execution store.
 * Native IDs come only from the durable server binder, with their original TTL.
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
    const params = Object.freeze({ ...parsed.params });
    const { zone } = parsed;
    const binderStartedAt = clock();
    const binder = options.executionBinder === false ? null
      : (options.executionBinder ?? createHostedComparisonBinder)(request, { now: clock, deadlineAt: binderStartedAt + deadlineMs });
    const key = JSON.stringify([params, zone, binder?.cacheKey ?? null]);
    prune(clock());
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      // Cleanup/cache insertion may occur after DB minting. A warm hit cannot
      // slide the pin TTL, reacquire a pin, or re-enable an expired native view.
      return serialized(pinExpired(hit.pinCreatedAt, clock()) ? expiredPin(hit.body) : hit.body);
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

    let observerHealthy = true;
    const client: ComparisonClient = {
      query(document, variables = {}) {
        // After a required branch fails, canonical Boss continuations cannot
        // dispatch more network work while the invocation is being settled.
        if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
        // Snapshot the actual scalar query context before asynchronous transport.
        // A builder's later mutation cannot manufacture default-current evidence.
        const queryVariables = Object.freeze({ ...variables });
        const work = (async () => {
          controller.signal.throwIfAborted();
          const data = await query(document, queryVariables, { signal: controller.signal });
          controller.signal.throwIfAborted();
          assertUpstreamData(document, data);
          if (binder && observerHealthy) {
            try { binder.observe(document, queryVariables, data); } catch { observerHealthy = false; }
          }
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
    let pinCreatedAt: number | null = null;
    try {
      const result = await builder(client, params);
      const normalized = normalizeComparison(result, params);
      const comparison = protectedComparison(normalized.comparison);
      const { complete } = normalized;
      const previousPatchPair = comparison.a.rankingPatch?.fallback === true || comparison.b.rankingPatch?.fallback === true;
      const previousPatchReference = previousPatchPair || comparison.bossReference?.b.rankingPatch?.fallback === true;
      if (!timedOut && clock() - startedAt >= deadlineMs) timeout();
      if (request.signal.aborted) {
        response = json({ error: 'The comparison request was canceled.' }, 499);
      } else if (timedOut && complete) {
        // Preserve the existing throughput deadline, independent of optional pins.
        response = json({ error: 'The comparison exceeded its request deadline. Try again later.' }, 504);
      } else {
        let binding: ExecutionPinBinding | null = null;
        // Historical throughput labels are not proof of a compatible native cohort.
        if (binder && !previousPatchPair && observerHealthy && !controller.signal.aborted && pending.size === 0) {
          // Throughput is already complete. End optional metadata transport early
          // enough for the bounded pin RPC (5s) and store close (5s) to settle
          // inside the unchanged 55s invocation; do not race either into background.
          const bindingTimer = setTimeout(() => controller.abort(new DOMException('Optional Execution binding deadline exceeded', 'TimeoutError')),
            Math.max(1, deadlineMs - 11_000 - (clock() - startedAt)));
          try {
            const candidate = await binder.bind(comparison, params, client, controller.signal);
            if (!controller.signal.aborted && candidate && COMPARISON_ID_PATTERN.test(candidate.comparisonID) && Number.isSafeInteger(candidate.createdAt)
              && candidate.createdAt >= 0 && candidate.createdAt <= clock() && !pinExpired(candidate.createdAt, clock())) binding = candidate;
          } catch { /* Optional DB/provenance failure must not erase throughput. */ }
          finally { clearTimeout(bindingTimer); }
        }
        pinCreatedAt = binding?.createdAt ?? null;
        const body = JSON.stringify({
          ...comparison,
          executionStatus: getHostedExecutionAvailability({
            zone,
            encounter: params.encounter, difficulty: params.difficulty,
            className: comparison.className, spec: comparison.spec,
            hero: params.hero ?? comparison.hero.a, pi: comparison.pi.a,
          }),
          ...(binder ? { executionV3Status: nativeExecutionStatus(binding) } : {}),
          ...(binding ? { comparisonID: binding.comparisonID } : {}),
        });
        response = serialized(body);
        // Recheck current rankings next time instead of retaining a previous-patch
        // result after new current-patch logs have appeared.
        if (complete && !previousPatchReference && !timedOut && pending.size === 0) cacheBody = body;
      }
    } catch (error) {
      const diagnostic = error instanceof LogServiceError ? 'transport.log-service' : comparisonDataDiagnostic(error);
      response = request.signal.aborted
        ? json({ error: 'The comparison request was canceled.' }, 499)
        : timedOut
          ? json({ error: 'The comparison exceeded its request deadline. Try again later.' }, 504)
          : json({ error: safeFailure(error), ...(diagnostic ? { diagnostic } : {}) }, 502);
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
    if (pinExpired(pinCreatedAt, clock())) {
      const safeBody = expiredPin(cacheBody ?? await response.text());
      response = serialized(safeBody);
      if (cacheBody !== null) cacheBody = safeBody;
      pinCreatedAt = null;
    }
    if (cacheBody !== null && !timedOut) {
      const bytes = Buffer.byteLength(cacheBody, 'utf8');
      if (bytes <= maxBytes) {
        prune(clock());
        remove(key);
        cache.set(key, { at: clock(), body: cacheBody, bytes, pinCreatedAt });
        cachedBytes += bytes;
        while (cache.size > maxEntries || cachedBytes > maxBytes) remove(cache.keys().next().value!);
      }
    }
    return response;
  };
}
