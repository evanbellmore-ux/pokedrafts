// Cast Mirror compare API — serverless port of the standalone mirror's
// /api/compare (github.com/evanbellmore-ux/cast-mirror).
//
// Finds a character's best ranked kill of an encounter, fetches the
// world-#1 same-spec parse on that fight, and returns both cast streams,
// per-spell output, and resource economy. The page lives at /castmirror.
//
// Auth is OAuth2 client_credentials against the Warcraft Logs v2 API —
// set WCL_CLIENT_ID / WCL_CLIENT_SECRET in the Vercel project env. The
// response cache and per-IP limiter are module-scope, so they live as
// long as a warm serverless instance (good enough: their job is to stop
// repeat traffic from draining the API points budget).

export const maxDuration = 60;

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const API_URL = 'https://www.warcraftlogs.com/api/v2/client';

let apiToken: string | null = null;
let tokenExpiresAt = 0;

function slugify(value: string): string {
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
async function wcl(query: string, variables: Record<string, unknown> = {}): Promise<any> {
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

interface FightSide {
  name: string;
  durSec: number;
  kill: boolean;
  casts: [number, string][];
  dmg: Record<string, number>;
  resources: Record<string, { max: number; spentSnap: number; gained: number; waste: number; series: [number, number][] }>;
}

async function fetchFightSide(code: string, fightID: number, playerName: string, metric: string): Promise<FightSide> {
  const head = await wcl(
    `query($code: String!, $fid: [Int]!) {
       reportData { report(code: $code) {
         masterData { actors(type: "Player") { id name } abilities { gameID name } }
         fights(fightIDs: $fid) { id startTime endTime kill }
       } }
     }`, { code, fid: [fightID] });
  const rep = head.reportData.report;
  const fight = rep?.fights?.[0];
  const wanted = playerName.trim().toLowerCase();
  const actor = rep?.masterData.actors.find((a: any) => a.name?.toLowerCase() === wanted);
  if (!rep || !fight || !actor) throw new Error(`actor/fight not found for ${playerName} in ${code}#${fightID}`);
  const abilityName = new Map<number, string>(
    rep.masterData.abilities.map((a: any) => [a.gameID, a.name ?? String(a.gameID)]),
  );

  const casts: [number, string][] = [];
  const snap = new Map<number, { max: number; series: [number, number][]; spent: number; last: number | null }>();
  const noteSnapshot = (t: number, resList: any[] | undefined) => {
    for (const r of resList ?? []) {
      if (r?.type == null) continue;
      const s = snap.get(r.type) ?? { max: 0, series: [], spent: 0, last: null };
      s.max = Math.max(s.max, r.max ?? 0);
      if (s.last != null && r.amount < s.last) s.spent += s.last - r.amount;
      s.last = r.amount;
      if (!s.series.length || t - s.series[s.series.length - 1][0] >= 1.5) s.series.push([t, r.amount]);
      snap.set(r.type, s);
    }
  };
  let cursor: number | null = fight.startTime;
  while (cursor !== null && cursor < fight.endTime) {
    const page = await wcl(
      `query($code: String!, $fid: [Int]!, $s: Float!, $e: Float!, $src: Int!) {
         reportData { report(code: $code) {
           events(fightIDs: $fid, startTime: $s, endTime: $e, dataType: Casts, sourceID: $src, includeResources: true, limit: 10000) { data nextPageTimestamp }
         } }
       }`, { code, fid: [fightID], s: cursor, e: fight.endTime, src: actor.id });
    const ev = page.reportData.report?.events;
    if (!ev) break;
    for (const e of ev.data) {
      if (e.type !== 'cast') continue;
      const t = Math.round((e.timestamp - fight.startTime) / 100) / 10;
      casts.push([t, abilityName.get(e.abilityGameID) ?? String(e.abilityGameID)]);
      noteSnapshot(t, e.classResources);
    }
    cursor = ev.nextPageTimestamp ?? null;
  }

  const gains = new Map<number, { gained: number; waste: number }>();
  cursor = fight.startTime;
  while (cursor !== null && cursor < fight.endTime) {
    const page = await wcl(
      `query($code: String!, $fid: [Int]!, $s: Float!, $e: Float!, $src: Int!) {
         reportData { report(code: $code) {
           events(fightIDs: $fid, startTime: $s, endTime: $e, dataType: Resources, targetID: $src, limit: 10000) { data nextPageTimestamp }
         } }
       }`, { code, fid: [fightID], s: cursor, e: fight.endTime, src: actor.id });
    const ev = page.reportData.report?.events;
    if (!ev) break;
    for (const e of ev.data) {
      if (e.type !== 'resourcechange' || e.resourceChangeType == null) continue;
      const g = gains.get(e.resourceChangeType) ?? { gained: 0, waste: 0 };
      g.gained += e.resourceChange ?? 0;
      g.waste += e.waste ?? 0;
      gains.set(e.resourceChangeType, g);
    }
    cursor = ev.nextPageTimestamp ?? null;
  }
  const resources: FightSide['resources'] = {};
  for (const type of new Set([...snap.keys(), ...gains.keys()])) {
    const s = snap.get(type);
    const g = gains.get(type);
    resources[type] = {
      max: s?.max ?? 0,
      spentSnap: Math.round(s?.spent ?? 0),
      gained: Math.round(g?.gained ?? 0),
      waste: Math.round(g?.waste ?? 0),
      series: (s?.series ?? []).filter((_, i, a) => a.length <= 400 || i % Math.ceil(a.length / 400) === 0),
    };
  }

  const tbl = await wcl(
    `query($code: String!, $fid: [Int]!, $src: Int!) {
       reportData { report(code: $code) {
         table(dataType: ${metric === 'hps' ? 'Healing' : 'DamageDone'}, fightIDs: $fid, sourceID: $src)
       } }
     }`, { code, fid: [fightID], src: actor.id });
  const dmg: Record<string, number> = {};
  for (const e of tbl.reportData.report?.table?.data?.entries ?? []) if (e.total) dmg[e.name] = e.total;

  return { name: actor.name, durSec: Math.round((fight.endTime - fight.startTime) / 1000), kill: !!fight.kill, casts, dmg, resources };
}

/** Hidden-rankings fallback: scan the character's recent reports for their
 * newest kill of the encounter at this difficulty. */
async function recentKillFor(name: string, slug: string, region: string, encounter: number, wclDiff: number) {
  const rr = await wcl(
    `query($name: String!, $slug: String!, $region: String!) {
       characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) {
         recentReports(limit: 10) { data { code } }
       } }
     }`, { name, slug, region });
  const reports = rr.characterData.character?.recentReports?.data ?? [];
  const wanted = name.trim().toLowerCase();
  for (const r of reports) {
    const rep = await wcl(
      `query($code: String!) {
         reportData { report(code: $code) {
           masterData { actors(type: "Player") { name } }
           fights(killType: Kills) { id encounterID difficulty startTime }
         } }
       }`, { code: r.code });
    const rp = rep.reportData.report;
    if (!rp) continue;
    if (!rp.masterData.actors.some((a: any) => a.name?.toLowerCase() === wanted)) continue;
    const fight = rp.fights.filter((f: any) => f.encounterID === encounter && f.difficulty === wclDiff).pop();
    if (fight) return { code: r.code as string, fightID: fight.id as number };
  }
  return null;
}

interface CompareParams {
  name: string;
  server: string;
  region: string;
  encounter: number;
  difficulty: number;
  metric: 'dps' | 'hps';
}

let classesCache: Map<number, string> | null = null;
const compareCache = new Map<string, unknown>();
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateOk(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { count: 0, resetAt: now + 3600_000 };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + 3600_000; }
  b.count++;
  buckets.set(ip, b);
  return b.count <= 12; // fresh compares per IP per hour (per warm instance)
}

async function apiCompare(params: CompareParams) {
  const { name, server, region, encounter, difficulty, metric } = params;
  const slug = slugify(server);
  const reg = region.toLowerCase();

  if (!classesCache) {
    const g = await wcl(`query { gameData { classes { id name } } }`);
    classesCache = new Map(g.gameData.classes.map((x: any) => [x.id, x.name.replace(/\s+/g, '')]));
  }

  const cd = await wcl(
    `query($name: String!, $slug: String!, $region: String!, $enc: Int!, $diff: Int!, $metric: CharacterRankingMetricType!) {
       characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) {
         classID
         encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric)
       } }
     }`, { name, slug, region: reg, enc: encounter, diff: difficulty, metric });
  const ch = cd.characterData.character;
  if (!ch) throw new Error(`character "${name}" on ${server}-${region} not found`);
  const ranks = ch.encounterRankings?.ranks ?? [];
  let best: { report: { code: string; fightID: number }; amount: number; rankPercent: number | null };
  let spec: string | undefined;
  if (ranks.length) {
    const top = ranks.slice().sort((a: any, b: any) => b.amount - a.amount)[0];
    best = { report: top.report, amount: top.amount, rankPercent: top.rankPercent };
    spec = top.spec;
  } else {
    const local = await recentKillFor(name, slug, reg, encounter, difficulty);
    if (!local) {
      throw new Error(ch.encounterRankings?.error
        ? `${name}'s rankings are hidden on the log service, and no recent public kill of this encounter was found`
        : `${name} has no ranked kill of this encounter at this difficulty`);
    }
    const sum = await wcl(
      `query($code: String!, $fid: [Int]!) {
         reportData { report(code: $code) { table(dataType: Summary, fightIDs: $fid) } }
       }`, { code: local.code, fid: [local.fightID] });
    const me = (sum.reportData.report?.table?.data?.composition ?? [])
      .find((p: any) => p.name?.toLowerCase() === name.trim().toLowerCase());
    spec = me?.specs?.[0]?.spec;
    if (!spec) throw new Error(`could not determine ${name}'s spec from the found kill`);
    best = { report: { code: local.code, fightID: local.fightID }, amount: 0, rankPercent: null };
  }
  const className = classesCache.get(ch.classID) ?? 'Unknown';

  const wr = await wcl(
    `query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!) {
       worldData { encounter(id: $enc) {
         name
         characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: 1)
       } }
     }`, { enc: encounter, cls: className, spec, diff: difficulty, metric });
  const encData = wr.worldData.encounter;
  const rankings = encData?.characterRankings?.rankings ?? [];
  if (!rankings.length) throw new Error(`no world rankings for ${spec} ${className} on this encounter/difficulty`);
  let top = rankings[0];
  if (top.name?.toLowerCase() === name.trim().toLowerCase() && top.report?.code === best.report?.code && rankings[1]) top = rankings[1];

  const [mine, theirs] = await Promise.all([
    fetchFightSide(best.report.code, best.report.fightID, name, metric),
    fetchFightSide(top.report.code, top.report.fightID, top.name, metric),
  ]);
  if (!best.amount) best.amount = Math.round(Object.values(mine.dmg).reduce((a, b) => a + b, 0) / Math.max(1, mine.durSec));

  return {
    encounter: { id: encounter, name: encData.name }, difficulty, metric, spec, className,
    a: { server, amount: Math.round(best.amount), code: best.report.code, fightID: best.report.fightID, rankPercent: Math.round(best.rankPercent ?? 0), ...mine },
    b: { server: top.server?.name ?? '?', amount: Math.round(top.amount), code: top.report.code, fightID: top.report.fightID, rankPercent: 100, ...theirs },
  };
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const params: CompareParams = {
    name: q.get('name')?.trim() ?? '',
    server: q.get('server')?.trim() ?? '',
    region: q.get('region') || 'us',
    encounter: Number(q.get('encounter')),
    difficulty: Number(q.get('difficulty') || 4),
    metric: q.get('metric') === 'hps' ? 'hps' : 'dps',
  };
  if (!params.name || !params.server || !Number.isFinite(params.encounter) || !params.encounter) {
    return Response.json({ error: 'name, server, and encounter are required' }, { status: 400 });
  }
  if (![3, 4, 5].includes(params.difficulty)) {
    return Response.json({ error: 'difficulty must be 3, 4, or 5' }, { status: 400 });
  }

  const key = JSON.stringify(params);
  const cached = compareCache.get(key);
  if (cached) return Response.json(cached);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (!rateOk(ip)) {
    return Response.json({ error: 'rate limit: too many fresh compares from this address — try again later' }, { status: 429 });
  }

  try {
    const out = await apiCompare(params);
    compareCache.set(key, out);
    return Response.json(out);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
