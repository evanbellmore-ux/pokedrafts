// Server-side Warcraft Logs client for the Cast Mirror API routes. OAuth
// credentials stay in the existing server environment; nothing is persisted.
// Warm-instance metadata caches are bounded optimizations, not durable state.

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const API_URL = 'https://www.warcraftlogs.com/api/v2/client';
const METADATA_TTL = 600_000;

let apiToken: string | null = null;
let tokenExpiresAt = 0;

export interface WclQueryOptions { signal?: AbortSignal }

type LogServiceErrorCode = 'credentials' | 'oauth' | 'unauthorized' | 'rate-limit' | 'unavailable' | 'response' | 'query';
const LOG_SERVICE_ERRORS: Record<LogServiceErrorCode, string> = {
  credentials: 'log-service credentials are not configured on the server',
  oauth: 'log-service authentication is temporarily unavailable',
  unauthorized: 'log-service authentication failed',
  'rate-limit': 'the log-service API is rate limited right now — try again in a few minutes',
  unavailable: 'the log service is temporarily unavailable — try again later',
  response: 'the log-service response was incomplete or invalid',
  query: 'the log service could not complete this query using public data',
};

/** Only these controlled messages may be returned to clients. Never expose
 * an OAuth body, raw GraphQL error, query, authorization header, or token. */
export class LogServiceError extends Error {
  constructor(readonly code: LogServiceErrorCode) {
    super(LOG_SERVICE_ERRORS[code]);
    this.name = 'LogServiceError';
  }
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Request canceled', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function metadataID(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function metadataName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

async function serviceFetch(url: string, init: RequestInit, options: WclQueryOptions): Promise<Response> {
  options.signal?.throwIfAborted();
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: options.signal });
  } catch {
    options.signal?.throwIfAborted();
    throw new LogServiceError('unavailable');
  }
}

async function authenticate(force = false, options: WclQueryOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  if (!force && apiToken && Date.now() < tokenExpiresAt - 60_000) return apiToken;
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new LogServiceError('credentials');
  const res = await serviceFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  }, options);
  let json: unknown;
  try { json = await res.json(); } catch {
    options.signal?.throwIfAborted();
    throw new LogServiceError('oauth');
  }
  options.signal?.throwIfAborted();
  if (!res.ok || !isRecord(json) || typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 16_384
    || typeof json.expires_in !== 'number' || !Number.isFinite(json.expires_in) || json.expires_in <= 0 || json.expires_in > 604_800) {
    throw new LogServiceError('oauth');
  }
  apiToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return apiToken;
}

/** The existing three-attempt retry budget, with optional cancellation through
 * OAuth, response bodies, WCL fetches, and the short retry waits. Existing
 * navigation callers still use wcl(document, variables) unchanged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve the existing schema-less navigation API; typed consumers supply T.
export async function wcl<T = any>(query: string, variables: Record<string, unknown> = {}, options: WclQueryOptions = {}): Promise<T> {
  let lastError: LogServiceError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    options.signal?.throwIfAborted();
    const token = await authenticate(attempt > 1, options);
    const res = await serviceFetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    }, options);
    let text: string;
    try { text = await res.text(); } catch {
      options.signal?.throwIfAborted();
      throw new LogServiceError('unavailable');
    }
    options.signal?.throwIfAborted();
    if (res.status === 401) {
      apiToken = null;
      tokenExpiresAt = 0;
      lastError = new LogServiceError('unauthorized');
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = new LogServiceError(res.status === 429 ? 'rate-limit' : 'unavailable');
      if (attempt < 3) await sleep(500 * 2 ** (attempt - 1), options.signal);
      continue;
    }
    if (!res.ok) throw new LogServiceError('query');
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new LogServiceError('response'); }
    if (!isRecord(json) || (json.errors != null && !Array.isArray(json.errors))) throw new LogServiceError('response');
    if (Array.isArray(json.errors) && json.errors.length) {
      const rateLimited = json.errors.some((e) => isRecord(e) && typeof e.message === 'string' && /rate limit/i.test(e.message));
      throw new LogServiceError(rateLimited ? 'rate-limit' : 'query');
    }
    if (!isRecord(json.data)) throw new LogServiceError('response');
    return json.data as T;
  }
  throw lastError ?? new LogServiceError('unavailable');
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 4096;

/** Existing per-IP limits on fresh requests, per warm instance. */
export function rateOk(ip: string, kind: 'compare' | 'character'): boolean {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
  const key = kind + ':' + ip.slice(0, 128);
  const bucket = buckets.get(key) ?? { count: 0, resetAt: now + 3600_000 };
  bucket.count++;
  buckets.delete(key);
  buckets.set(key, bucket);
  while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  return bucket.count <= (kind === 'compare' ? 12 : 30);
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.slice(0, 128).split(',')[0].trim() || 'unknown';
}

let classesCache: { at: number; out: Map<number, string> } | null = null;

export async function getClasses(options: WclQueryOptions = {}): Promise<Map<number, string>> {
  options.signal?.throwIfAborted();
  if (classesCache && Date.now() - classesCache.at < METADATA_TTL) return classesCache.out;
  const g = await wcl<{ gameData?: { classes?: unknown } }>(`query { gameData { classes { id name } } }`, {}, options);
  const rows = g.gameData?.classes;
  if (!Array.isArray(rows) || !rows.length || rows.length > 128 || !rows.every((x) => isRecord(x) && metadataID(x.id) && metadataName(x.name))) {
    throw new LogServiceError('response');
  }
  const out = new Map<number, string>(rows.map((x) => [x.id as number, (x.name as string).replace(/\s+/g, '')]));
  classesCache = { at: Date.now(), out };
  return out;
}

export interface ZoneInfo {
  id: number;
  name: string;
  encounters: { id: number; name: string }[];
}
interface ZoneRow extends ZoneInfo { difficulties: { id: number }[] }
let zonesCache: { at: number; out: ZoneInfo[] } | null = null;

/** Raid zones, newest first, with at most twelve complete zone entries. */
export async function getZones(options: WclQueryOptions = {}): Promise<ZoneInfo[]> {
  options.signal?.throwIfAborted();
  if (zonesCache && Date.now() - zonesCache.at < METADATA_TTL) return zonesCache.out;
  const g = await wcl<{ worldData?: { zones?: unknown } }>(`query { worldData { zones { id name difficulties { id } encounters { id name } } } }`, {}, options);
  const rows = g.worldData?.zones;
  if (!Array.isArray(rows) || rows.length > 2000 || !rows.every((z) => isRecord(z) && metadataID(z.id) && metadataName(z.name)
    && Array.isArray(z.difficulties) && z.difficulties.length <= 32 && z.difficulties.every((d) => isRecord(d) && metadataID(d.id))
    && Array.isArray(z.encounters) && z.encounters.length <= 128 && z.encounters.every((e) => isRecord(e) && metadataID(e.id) && metadataName(e.name)))) {
    throw new LogServiceError('response');
  }
  const out = (rows as ZoneRow[])
    .filter((z) => z.encounters.length && z.difficulties.some((d) => d.id === 5) && !z.difficulties.some((d) => d.id === 10))
    .sort((a, b) => b.id - a.id).slice(0, 12)
    .map((z) => ({ id: z.id, name: z.name, encounters: z.encounters.map((e) => ({ id: e.id, name: e.name })) }));
  zonesCache = { at: Date.now(), out };
  return out;
}

/** Spec on a pinned fight, preserving the navigation API with optional cancellation. */
export async function specFromFight(code: string, fightID: number, name: string, options: WclQueryOptions = {}): Promise<string | undefined> {
  const sum = await wcl<{ reportData?: { report?: { table?: { data?: { composition?: { name?: string; specs?: { spec?: string }[] }[] } } } } }>(
    `query($code: String!, $fid: [Int]!) {
       reportData { report(code: $code) { table(dataType: Summary, fightIDs: $fid) } }
     }`, { code, fid: [fightID] }, options);
  const me = (sum.reportData?.report?.table?.data?.composition ?? [])
    .find((p) => p.name?.toLowerCase() === name.trim().toLowerCase());
  return me?.specs?.[0]?.spec;
}
