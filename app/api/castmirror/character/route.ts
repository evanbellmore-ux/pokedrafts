// Cast Mirror character API — every ranked kill of every boss in one raid
// for one character, parses sorted best-first per boss. Feeds the page's
// kill browser; a chip click pins /api/castmirror/compare to that fight.

import { wcl, slugify, rateOk, clientIp, getClasses, getZones } from '../lib';

export const maxDuration = 30;

interface CharacterParams {
  name: string;
  server: string;
  region: string;
  zone: number;
  difficulty: number;
  metric: 'dps' | 'hps';
}

const characterCache = new Map<string, { at: number; out: unknown }>();

async function apiCharacter(params: CharacterParams) {
  const zones = await getZones();
  const zone = zones.find((z) => z.id === params.zone) ?? zones[0];
  const classes = await getClasses();

  const aliases = zone.encounters
    .map((e) => `e${e.id}: encounterRankings(encounterID: ${e.id}, difficulty: $diff, metric: $metric)`)
    .join('\n');
  const cd = await wcl(
    `query($name: String!, $slug: String!, $region: String!, $diff: Int!, $metric: CharacterRankingMetricType!) {
       characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) {
         name
         classID
         ${aliases}
       } }
     }`, { name: params.name, slug: slugify(params.server), region: params.region.toLowerCase(), diff: params.difficulty, metric: params.metric });
  const ch = cd.characterData.character;
  if (!ch) throw new Error(`character "${params.name}" on ${params.server}-${params.region} not found`);

  let hidden = false;
  const bosses = zone.encounters.map((e) => {
    const er = ch[`e${e.id}`];
    if (er?.error) hidden = true;
    const kills = ((er?.ranks ?? []) as any[])
      .filter((r) => r.report?.code)
      .map((r) => ({
        code: r.report.code as string, fightID: r.report.fightID as number,
        parse: Math.floor(r.rankPercent ?? 0), amount: Math.round(r.amount ?? 0),
        durSec: Math.round((r.duration ?? 0) / 1000), when: r.startTime ?? 0, spec: r.spec ?? '',
      }))
      .sort((a, b) => b.parse - a.parse || b.amount - a.amount);
    return { id: e.id, name: e.name, kills };
  });
  return {
    name: ch.name ?? params.name,
    className: classes.get(ch.classID) ?? '',
    zone: { id: zone.id, name: zone.name },
    hidden,
    bosses,
  };
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const params: CharacterParams = {
    name: q.get('name')?.trim() ?? '',
    server: q.get('server')?.trim() ?? '',
    region: q.get('region') || 'us',
    zone: Number(q.get('zone')) || 0,
    difficulty: Number(q.get('difficulty') || 4),
    metric: q.get('metric') === 'hps' ? 'hps' : 'dps',
  };
  if (!params.name || !params.server) {
    return Response.json({ error: 'name and server are required' }, { status: 400 });
  }
  if (![3, 4, 5].includes(params.difficulty)) {
    return Response.json({ error: 'difficulty must be 3, 4, or 5' }, { status: 400 });
  }

  const key = JSON.stringify(params);
  const hit = characterCache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return Response.json(hit.out);

  if (!rateOk(clientIp(request), 'character')) {
    return Response.json({ error: 'rate limit: too many lookups from this address — try again later' }, { status: 429 });
  }

  try {
    const out = await apiCharacter(params);
    characterCache.set(key, { at: Date.now(), out });
    return Response.json(out);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
