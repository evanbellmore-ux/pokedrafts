// Shared Warcraft Logs client + caches for the Cast Mirror API routes.
// Auth is OAuth2 client_credentials — set WCL_CLIENT_ID / WCL_CLIENT_SECRET
// in the Vercel project env. Module-scope caches live as long as a warm
// serverless instance; their job is keeping repeat traffic off the API
// points budget, not durability.

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const API_URL = 'https://www.warcraftlogs.com/api/v2/client';

let apiToken: string | null = null;
let tokenExpiresAt = 0;

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authenticate(force = false): Promise<string> {
  if (!force && apiToken && Date.now() < tokenExpiresAt - 60_000) return apiToken;
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('log-service credentials are not configured on the server');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  if (!res.ok) throw new Error(`OAuth token request failed (${res.status})`);
  const json = await res.json();
  apiToken = json.access_token as string;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return apiToken;
}

/** GraphQL query with a small retry budget (serverless has a time budget —
 * no long rate-limit sleeps; those fail fast with a clear message). */
export async function wcl(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const token = await authenticate(attempt > 1);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (res.status === 401) {
      apiToken = null;
      lastError = new Error('Unauthorized');
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`log service returned ${res.status}`);
      if (attempt < 3) await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new Error(`log-service request failed (${res.status})`);
    const json = JSON.parse(text);
    if (json.errors?.length) {
      const message = json.errors.map((e: { message: string }) => e.message).join('; ');
      if (/rate limit/i.test(message)) throw new Error('the log-service API is rate limited right now — try again in a few minutes');
      throw new Error(`log-service error: ${message}`);
    }
    if (!json.data) throw new Error('log-service response contained no data');
    return json.data;
  }
  throw lastError ?? new Error('query failed after retries');
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Per-IP limit on fresh (uncached) requests, per warm instance. */
export function rateOk(ip: string, kind: 'compare' | 'character'): boolean {
  const now = Date.now();
  const key = kind + ':' + ip;
  const b = buckets.get(key) ?? { count: 0, resetAt: now + 3600_000 };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + 3600_000; }
  b.count++;
  buckets.set(key, b);
  return b.count <= (kind === 'compare' ? 12 : 30);
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}

let classesCache: Map<number, string> | null = null;

export async function getClasses(): Promise<Map<number, string>> {
  if (classesCache) return classesCache;
  const g = await wcl(`query { gameData { classes { id name } } }`);
  classesCache = new Map(g.gameData.classes.map((x: any) => [x.id, x.name.replace(/\s+/g, '')]));
  return classesCache;
}

export interface ZoneInfo {
  id: number;
  name: string;
  encounters: { id: number; name: string }[];
}

let zonesCache: ZoneInfo[] | null = null;

/** Raid zones (newest first) with their encounter lists. Raids are the
 * zones with a Mythic difficulty and no Mythic+ difficulty. */
export async function getZones(): Promise<ZoneInfo[]> {
  if (zonesCache) return zonesCache;
  const g = await wcl(`query { worldData { zones { id name difficulties { id } encounters { id name } } } }`);
  zonesCache = (g.worldData.zones ?? [])
    .filter((z: any) => z.encounters?.length && z.difficulties?.some((d: any) => d.id === 5) && !z.difficulties.some((d: any) => d.id === 10))
    .sort((a: any, b: any) => b.id - a.id)
    .slice(0, 12)
    .map((z: any) => ({ id: z.id, name: z.name, encounters: z.encounters.map((e: any) => ({ id: e.id, name: e.name })) }));
  return zonesCache!;
}

/** Spec of one player on one specific fight, from the summary composition. */
export async function specFromFight(code: string, fightID: number, name: string): Promise<string | undefined> {
  const sum = await wcl(
    `query($code: String!, $fid: [Int]!) {
       reportData { report(code: $code) { table(dataType: Summary, fightIDs: $fid) } }
     }`, { code, fid: [fightID] });
  const me = (sum.reportData.report?.table?.data?.composition ?? [])
    .find((p: any) => p.name?.toLowerCase() === name.trim().toLowerCase());
  return me?.specs?.[0]?.spec;
}
