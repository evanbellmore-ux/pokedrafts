// Cast Mirror compare API — serverless port of the standalone mirror's
// /api/compare (github.com/evanbellmore-ux/cast-mirror).
//
// Mirrors one of a character's kills (their best ranked one, or a specific
// fight pinned via code+fightID) against the best mirrorable world parse of
// the same spec on that encounter: cast streams, per-spell output, resource
// economy. The page lives at /castmirror.

import { wcl, slugify, rateOk, clientIp, getClasses, specFromFight } from '../lib';

export const maxDuration = 60;

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

const PI_SPELL = 10060; // Power Infusion

/** Did this player receive Power Infusion on this fight? */
async function fightHasPI(code: string, fightID: number, playerName: string): Promise<boolean> {
  const res = await wcl(
    `query($code: String!, $fid: [Int]!, $aid: Float!) {
       reportData { report(code: $code) {
         masterData { actors(type: "Player") { id name } }
         events(fightIDs: $fid, startTime: 0, endTime: 999999999999, dataType: Buffs, abilityID: $aid, limit: 2000) { data }
       } }
     }`, { code, fid: [fightID], aid: PI_SPELL });
  const rep = res.reportData.report;
  const wanted = playerName.trim().toLowerCase();
  const actor = rep?.masterData.actors.find((a: any) => a.name?.toLowerCase() === wanted);
  if (!actor) return false;
  return (rep.events?.data ?? []).some((e: any) =>
    (e.type === 'applybuff' || e.type === 'refreshbuff') && e.targetID === actor.id);
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
  code: string | null;
  fightID: number | null;
}

const compareCache = new Map<string, unknown>();

async function apiCompare(params: CompareParams) {
  const { name, server, region, encounter, difficulty, metric, code, fightID } = params;
  const pin = code && fightID ? { code, fightID } : null;
  const slug = slugify(server);
  const reg = region.toLowerCase();
  const classes = await getClasses();

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
  if (pin) {
    // mirror one specific kill, not the best one
    const match = ranks.find((r: any) => r.report?.code === pin.code && r.report?.fightID === pin.fightID);
    if (match) {
      best = { report: match.report, amount: match.amount, rankPercent: match.rankPercent };
      spec = match.spec;
    } else {
      spec = await specFromFight(pin.code, pin.fightID, name);
      if (!spec) throw new Error(`could not determine ${name}'s spec on ${pin.code}#${pin.fightID}`);
      best = { report: pin, amount: 0, rankPercent: null };
    }
  } else if (ranks.length) {
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
    spec = await specFromFight(local.code, local.fightID, name);
    if (!spec) throw new Error(`could not determine ${name}'s spec from the found kill`);
    best = { report: { code: local.code, fightID: local.fightID }, amount: 0, rankPercent: null };
  }
  const className = classes.get(ch.classID) ?? 'Unknown';

  const wr = await wcl(
    `query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!) {
       worldData { encounter(id: $enc) {
         name
         characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: 1)
       } }
     }`, { enc: encounter, cls: className, spec, diff: difficulty, metric });
  const encData = wr.worldData.encounter;
  const rankings = encData?.characterRankings?.rankings ?? [];
  // anonymous uploads can't be actor-matched — take the best mirrorable parse
  const usable = rankings.filter((r: any) =>
    r.name && r.name.toLowerCase() !== 'anonymous' && r.report?.code && !r.report.code.startsWith('a:') &&
    !(r.name.toLowerCase() === name.trim().toLowerCase() && r.report.code === best.report?.code));
  if (!usable.length) throw new Error(`no mirrorable world rankings for ${spec} ${className} on this encounter/difficulty`);

  // fair reference: if this kill went without Power Infusion, mirror the
  // best parse that also went without it
  const aHasPI = await fightHasPI(best.report.code, best.report.fightID, name);
  let top = usable[0];
  let piMatched = false;
  let bHasPI: boolean | null = null;
  if (!aHasPI) {
    for (const cand of usable.slice(0, 10)) {
      if (!(await fightHasPI(cand.report.code, cand.report.fightID, cand.name))) {
        piMatched = cand !== usable[0]; // only a "match" if PI'd logs were skipped
        top = cand;
        bHasPI = false;
        break;
      }
    }
  }
  if (bHasPI === null) bHasPI = await fightHasPI(top.report.code, top.report.fightID, top.name);

  const [mine, theirs] = await Promise.all([
    fetchFightSide(best.report.code, best.report.fightID, name, metric),
    fetchFightSide(top.report.code, top.report.fightID, top.name, metric),
  ]);
  if (!best.amount) best.amount = Math.round(Object.values(mine.dmg).reduce((a, b) => a + b, 0) / Math.max(1, mine.durSec));

  return {
    encounter: { id: encounter, name: encData.name }, difficulty, metric, spec, className,
    pi: { a: aHasPI, b: bHasPI, matched: piMatched, allTopHavePI: !aHasPI && !piMatched && bHasPI },
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
    code: q.get('code')?.trim() || null,
    fightID: Number(q.get('fightID')) || null,
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

  if (!rateOk(clientIp(request), 'compare')) {
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
