import { NO_STORE_HEADERS } from '../availability';
import { clientIp, rateOk } from '../../lib';
import { getNativeExecutionAccess, type NativeExecutionEnvironment } from '../runtime';
import { isRecord } from '../pins';
import { collectRaidBoss, RAID_REVIEW_BOSSES, type RaidReviewRequest, type RaidReviewRuntime } from './collector';
import { gradeBoss } from './grade';
import { openRaidReviewRuntime } from './runtime';

const MAX_BODY_BYTES = 2048;
const DEADLINE_MS = 140_000;
const RESPONSE_BYTES = 1024 * 1024;
const FAILURE = 'Raid Execution is temporarily unavailable. Try again later.';
class RaidInputError extends Error {}
export interface RaidHandlerOptions {
  now?: () => number;
  deadlineMs?: number;
  runtimeOptions?: { env?: NativeExecutionEnvironment };
  admission?: (request: Request) => boolean;
  openRuntime?: (request: Request, options: { now: () => number; signal: AbortSignal; env?: NativeExecutionEnvironment }) => Promise<RaidReviewRuntime | null>;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: NO_STORE_HEADERS });
function inputError(message: string): never { throw new RaidInputError(message); }
async function parseRequest(request: Request): Promise<RaidReviewRequest> {
  if (request.url.length > 1024 || new URL(request.url).search) inputError('Raid Execution accepts a JSON body without query parameters.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) inputError('A JSON request body is required.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) inputError('The request body is too large.');
  const reader = request.body?.getReader();
  if (!reader) inputError('A JSON request body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); inputError('The request body is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { inputError('The request body must be valid JSON.'); }
  if (!isRecord(body) || Object.keys(body).length !== 6 || Object.keys(body).some((k) => !['name', 'server', 'region', 'zone', 'difficulty', 'encounter'].includes(k))) inputError('Only name, server, region, zone, difficulty and encounter are accepted.');
  const validText = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(v);
  if (!validText(body.name) || !validText(body.server)) inputError('A raider name and realm are required.');
  if (typeof body.region !== 'string' || !['us', 'eu', 'kr', 'tw'].includes(body.region)) inputError('region must be us, eu, kr or tw.');
  if (body.zone !== 53 || body.difficulty !== 5 || !RAID_REVIEW_BOSSES.some((b) => b.id === body.encounter)) inputError('Raid Execution currently supports the reviewed Mythic raid only.');
  return { name: (body.name as string).trim(), server: (body.server as string).trim(), region: body.region as RaidReviewRequest['region'],
    zone: body.zone as number, difficulty: body.difficulty as number, encounter: body.encounter as number };
}
export function createRaidExecutionHandler(options: RaidHandlerOptions = {}) {
  const now = options.now ?? Date.now, deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > DEADLINE_MS) throw new RangeError('Invalid raid Execution deadline.');
  const openRuntime = options.openRuntime ?? openRaidReviewRuntime;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
    let parsed: RaidReviewRequest;
    try { parsed = await parseRequest(request); } catch (error) { return json({ error: error instanceof RaidInputError ? error.message : 'Invalid raid Execution request.' }, 400); }
    if (request.signal.aborted) return json({ error: 'The raid Execution request was canceled.' }, 499);
    if (!options.openRuntime && !getNativeExecutionAccess(request, options.runtimeOptions?.env)) return json({ error: FAILURE }, 503);
    if (!(options.admission ?? ((r) => rateOk(clientIp(r), 'raid')))(request)) return json({ error: 'Too many raid Execution lookups. Try again later.' }, 429);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Raid Execution deadline exceeded', 'TimeoutError')); }, deadlineMs);
    const cancel = () => controller.abort(new DOMException('Raid Execution canceled', 'AbortError'));
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    let runtime: RaidReviewRuntime | null = null;
    let response: Response;
    try {
      runtime = await openRuntime(request, { ...options.runtimeOptions, now, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!runtime) response = json({ error: FAILURE }, 503);
      else {
        const review = await collectRaidBoss(runtime, parsed, { now, signal: controller.signal });
        controller.signal.throwIfAborted();
        const body = JSON.stringify({ review, grade: gradeBoss(review) });
        response = Buffer.byteLength(body, 'utf8') > RESPONSE_BYTES ? json({ error: FAILURE }, 503)
          : new Response(body, { headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
      }
    } catch { response = request.signal.aborted ? json({ error: 'The raid Execution request was canceled.' }, 499)
      : timedOut ? json({ error: 'The raid Execution request exceeded its deadline.' }, 504) : json({ error: FAILURE }, 503); }
    finally {
      controller.abort();
      try { await runtime?.close(); } catch { response = json({ error: FAILURE }, 503); }
      clearTimeout(timer); request.signal.removeEventListener('abort', cancel);
    }
    if (request.signal.aborted) return json({ error: 'The raid Execution request was canceled.' }, 499);
    if (timedOut) return json({ error: 'The raid Execution request exceeded its deadline.' }, 504);
    return response;
  };
}
