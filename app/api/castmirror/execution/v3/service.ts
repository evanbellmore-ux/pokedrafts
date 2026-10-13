import { getHostedExecutionAvailability, NO_STORE_HEADERS } from '../availability';
import {
  COMPARISON_ID_PATTERN, EXECUTION_ANALYTICAL_VERSION, InvalidComparisonPin, isRecord, readComparisonPin,
  type PinnedComparison,
} from '../pins';
import { getNativeExecutionAccess, openNativeExecutionRuntime, type NativeExecutionRuntime, type NativeRuntimeOptions } from '../runtime';

export const EXECUTION_RESPONSE_BYTES = 1024 * 1024;
// The native job has one 120s budget and a 150s lease. Stop request transport
// early enough to settle bounded, no-retry database cleanup inside maxDuration.
export const EXECUTION_DEADLINE_MS = 140_000;
const COMPONENTS = ['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing'] as const;
const FAILURE = 'Native Execution is temporarily unavailable. Try again later.';
class ExecutionInputError extends Error {}

export interface ExecutionV3HandlerOptions {
  now?: () => number;
  deadlineMs?: number;
  runtimeOptions?: Omit<NativeRuntimeOptions, 'signal' | 'now'>;
  openRuntime?: (request: Request, options: NativeRuntimeOptions) => Promise<NativeExecutionRuntime | null>;
}
function json(value: unknown, status: number): Response { return Response.json(value, { status, headers: NO_STORE_HEADERS }); }
function unsupported(): Response { return json({ ...getHostedExecutionAvailability(), error: FAILURE }, 503); }
function parseRequest(request: Request): { comparisonID: string; piPolicy: 'Any' | 'Exclude' } {
  if (request.url.length > 1024) throw new ExecutionInputError('Execution request URL is too long.');
  const query = new URL(request.url).searchParams;
  for (const [key] of query) {
    if (key !== 'comparisonID' && key !== 'pi') throw new ExecutionInputError('Only comparisonID and pi are accepted.');
    if (query.getAll(key).length !== 1) throw new ExecutionInputError(`${key} must be provided only once.`);
  }
  const comparisonID = query.get('comparisonID');
  if (!comparisonID || !COMPARISON_ID_PATTERN.test(comparisonID)) throw new ExecutionInputError('comparisonID must be a retained comparison UUID.');
  const piPolicy = query.get('pi') ?? 'Any';
  if (piPolicy !== 'Any' && piPolicy !== 'Exclude') throw new ExecutionInputError('pi must be Any or Exclude.');
  return { comparisonID: comparisonID.toLowerCase(), piPolicy };
}
function pick(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}
function publicEvaluation(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || value.version !== EXECUTION_ANALYTICAL_VERSION || !isRecord(value.components)) throw new InvalidComparisonPin();
  const components = value.components;
  if (COMPONENTS.some((key) => !isRecord(components[key]))) throw new InvalidComparisonPin();
  // This is already the native public evaluation, not arbitrary builder data.
  // Project the public top-level contract again; never attach driver diagnostics.
  return { ...pick(value, ['version', 'status', 'score', 'mask', 'coverageWeight', 'weights', 'scope', 'identity', 'sample', 'support', 'provenance']),
    components: Object.fromEntries(COMPONENTS.map((key) => [key, components[key]])) };
}
export function projectExecutionReference(value: unknown, base: PinnedComparison, piPolicy: 'Any' | 'Exclude') {
  if (!isRecord(value) || value.rankingMetric !== 'execution' || !isRecord(value.execution) || !isRecord(value.pi)
    || !['a', 'b'].every((key) => value.pi && ((value.pi as Record<string, unknown>)[key] === null || typeof (value.pi as Record<string, unknown>)[key] === 'boolean'))
    || value.pi.excluded !== (piPolicy === 'Exclude')) throw new InvalidComparisonPin();
  const execution = value.execution;
  if (execution.analyticalVersion !== EXECUTION_ANALYTICAL_VERSION || execution.piPolicy !== piPolicy || execution.cohortMode !== 'spec'
    || typeof execution.comparable !== 'boolean' || !isRecord(execution.comparison) || !isRecord(execution.coverage)
    || !Array.isArray(execution.reasons) || execution.reasons.length > 64
    || execution.reasons.some((reason) => typeof reason !== 'string' || reason.length > 4096)) throw new InvalidComparisonPin();
  const coverage = execution.coverage;
  const acquisition = isRecord(coverage.acquisition) ? pick(coverage.acquisition, [
    'state', 'reason', 'cached', 'limits', 'counters', 'discoveryAttempted', 'discoveryHasMorePages', 'pagination',
    'accountingPersistence', 'accountingReason', 'accountingWriteRetries', 'cachePersistence', 'cacheReason',
  ]) : {};
  return {
    b: base.b, hero: base.hero, rankingMetric: 'execution',
    pi: { a: value.pi.a, b: value.pi.b, excluded: piPolicy === 'Exclude' },
    execution: {
      ...pick(execution, ['analyticalVersion', 'status', 'piPolicy', 'cohortMode', 'scope', 'comparable']),
      a: publicEvaluation(execution.a), b: publicEvaluation(execution.b),
      comparison: pick(execution.comparison, ['comparable', 'reason', 'comparison']),
      coverage: { ...pick(coverage, ['observations', 'players', 'kills', 'pi', 'excluded', 'sampleSelection']), acquisition },
      reasons: [...execution.reasons], globalWinner: null,
    },
  };
}

export function createExecutionV3Handler(options: ExecutionV3HandlerOptions = {}) {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? EXECUTION_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > EXECUTION_DEADLINE_MS) throw new RangeError('Invalid Execution deadline.');
  const openRuntime = options.openRuntime ?? openNativeExecutionRuntime;
  return async function executionV3(request: Request): Promise<Response> {
    if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
    let parsed: ReturnType<typeof parseRequest>;
    try { parsed = parseRequest(request); } catch (error) {
      return json({ error: error instanceof ExecutionInputError ? error.message : 'Invalid Execution request.' }, 400);
    }
    if (request.signal.aborted) return json({ error: 'The Execution request was canceled.' }, 499);
    if (!options.openRuntime && !getNativeExecutionAccess(request, options.runtimeOptions?.env)) return unsupported();
    const controller = new AbortController();
    const startedAt = now();
    let timedOut = false;
    const deadline = () => { timedOut = true; controller.abort(new DOMException('Execution deadline exceeded', 'TimeoutError')); };
    const timer = setTimeout(deadline, deadlineMs);
    const cancel = () => controller.abort(new DOMException('Execution request canceled', 'AbortError'));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    let runtime: NativeExecutionRuntime | null = null;
    let response: Response;
    try {
      runtime = await openRuntime(request, { ...options.runtimeOptions, now, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!runtime) response = unsupported();
      else {
        const stored = await runtime.store.readPin(parsed.comparisonID);
        controller.signal.throwIfAborted();
        if (stored === null) response = json({ error: 'The comparison pin is expired or unavailable. Create a new throughput comparison.' }, 409);
        else {
          const { base, params } = readComparisonPin(stored);
          const reference = await runtime.compare(base, params, { piPolicy: parsed.piPolicy, waitForInflight: false, signal: controller.signal });
          if (!timedOut && now() - startedAt >= deadlineMs) deadline();
          controller.signal.throwIfAborted();
          const body = JSON.stringify({ comparisonID: parsed.comparisonID, executionReference: projectExecutionReference(reference, base, parsed.piPolicy) });
          response = Buffer.byteLength(body, 'utf8') > EXECUTION_RESPONSE_BYTES
            ? json({ error: FAILURE }, 503)
            : new Response(body, { headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
        }
      }
    } catch {
      response = request.signal.aborted ? json({ error: 'The Execution request was canceled.' }, 499)
        : timedOut ? json({ error: 'The Execution request exceeded its deadline. Try again later.' }, 504)
          : json({ error: FAILURE }, 503);
    } finally {
      // Native compare settles every started query/attempt and releases its one
      // durable budget before resolving/rejecting. Do not race it into background.
      controller.abort(new DOMException('Execution invocation finished', 'AbortError'));
      try { await runtime?.close(); } catch { response = json({ error: FAILURE }, 503); }
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }
    if (request.signal.aborted) return json({ error: 'The Execution request was canceled.' }, 499);
    if (timedOut) return json({ error: 'The Execution request exceeded its deadline. Try again later.' }, 504);
    return response;
  };
}
