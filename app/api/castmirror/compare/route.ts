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
  lust: [number, number][];
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

  // Bloodlust-family windows in this FIGHT — raid-wide, any variant, any
  // caster, regardless of who received it or whether this player was alive
  const LUST_RE = /bloodlust|heroism|time warp|fury of the aspects|primal rage|harrier|ancient hysteria|netherwinds|drums of|feral hysteria/i;
  const bt = await wcl(
    `query($code: String!, $fid: [Int]!) {
       reportData { report(code: $code) { table(dataType: Buffs, fightIDs: $fid) } }
     }`, { code, fid: [fightID] });
  const auras = bt.reportData.report?.table?.data?.auras ?? bt.reportData.report?.table?.data?.entries ?? [];
  const durSec = Math.round((fight.endTime - fight.startTime) / 1000);
  const rawLust: [number, number][] = [];
  for (const a of auras) {
    if (!LUST_RE.test(a.name ?? '')) continue;
    for (const b of a.bands ?? []) {
      const s = Math.max(0, Math.round((b.startTime - fight.startTime) / 100) / 10);
      const e2 = Math.min(durSec, Math.round((b.endTime - fight.startTime) / 100) / 10);
      if (e2 > s) rawLust.push([s, e2]);
    }
  }
  rawLust.sort((x, y) => x[0] - y[0]);
  const lust: [number, number][] = [];
  for (const w of rawLust) {
    const last = lust[lust.length - 1];
    if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]);
    else lust.push([w[0], w[1]]);
  }

  return { name: actor.name, durSec, kill: !!fight.kill, casts, dmg, resources, lust };
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

/** Hero-tree signature abilities: exact names that appear in a player's
 * casts or damage/healing table only when that hero tree is taken. */
const HERO_SIG: Record<string, string> = {
  'Vampiric Strike': "San'layn", 'Infliction of Sorrow': "San'layn", 'The Blood is Life': "San'layn", 'Blood Mist': "San'layn",
  "Reaper's Mark": 'Deathbringer', 'Wave of Souls': 'Deathbringer', 'Soul Rupture': 'Deathbringer', 'Exterminate': 'Deathbringer',
  "Rider's Champion": 'Rider of the Apocalypse', "Mograine's Death and Decay": 'Rider of the Apocalypse', "Whitemane's Death Coil": 'Rider of the Apocalypse', "Trollbane's Icy Fury": 'Rider of the Apocalypse', "Nazgrim's Conquest": 'Rider of the Apocalypse',
  'Arcane Phoenix': 'Sunfury', 'Glorious Incandescence': 'Sunfury', 'Excess Fire': 'Sunfury', 'Burden of Power': 'Sunfury',
  'Arcane Splinter': 'Spellslinger', 'Frost Splinter': 'Spellslinger', 'Splinterstorm': 'Spellslinger',
  'Frostfire Bolt': 'Frostfire', 'Frostfire Burst': 'Frostfire', 'Excess Frost': 'Frostfire',
  'Demolish': 'Colossus', 'Colossal Might': 'Colossus',
  "Slayer's Strike": 'Slayer', 'Overwhelming Blades': 'Slayer',
  'Thunder Blast': 'Mountain Thane', 'Avatar of the Storm': 'Mountain Thane', 'Lightning Strike': 'Mountain Thane',
  'Dawnlight': 'Herald of the Sun', "Sun's Avatar": 'Herald of the Sun',
  'Hammer of Light': 'Templar', "Light's Guidance": 'Templar',
  'Holy Bulwark': 'Lightsmith', 'Sacred Weapon': 'Lightsmith', 'Lesser Weapon': 'Lightsmith', 'Lesser Bulwark': 'Lightsmith', 'Blessing of the Forge': 'Lightsmith', 'Armory of Light': 'Lightsmith', 'Pillar of Lights': 'Lightsmith',
  'Black Arrow': 'Dark Ranger', 'Bleak Arrows': 'Dark Ranger', 'Phantom Pain': 'Dark Ranger',
  'Lunar Storm': 'Sentinel', 'Sentinel Watch': 'Sentinel',
  'Vicious Hunt': 'Pack Leader', 'Pack Coordination': 'Pack Leader', 'Boar Charge': 'Pack Leader', 'Bear Summon (Howl of the Pack Leader)': 'Pack Leader', 'Stampede': 'Pack Leader',
  'Moonlight Chakram': 'Sentinel',
  'Unseen Blade': 'Trickster', 'Coup de Grace': 'Trickster', 'Fazed': 'Trickster',
  'Hunt Them Down': 'Deathstalker', "Deathstalker's Mark": 'Deathstalker', 'Corrupt the Blood': 'Deathstalker',
  'Fatebound Coin (Tails)': 'Fatebound', 'Fatebound Coin (Heads)': 'Fatebound', 'Fate Intertwined': 'Fatebound', 'Hand of Fate': 'Fatebound',
  'Void Blast': 'Voidweaver', 'Entropic Rift': 'Voidweaver', 'Collapsing Void': 'Voidweaver', 'Void Shield': 'Voidweaver', 'Voidwraith': 'Voidweaver',
  'Piety': 'Oracle',
  'Premonition of Insight': 'Oracle', 'Premonition of Piety': 'Oracle', 'Premonition of Solace': 'Oracle', 'Premonition of Clairvoyance': 'Oracle',
  'Power Surge': 'Archon', 'Manifested Power': 'Archon',
  'Ruination': 'Diabolist', 'Infernal Bolt': 'Diabolist', 'Chaos Salvo': 'Diabolist',
  'Wither': 'Hellcaller', 'Malevolence': 'Hellcaller', 'Blackened Soul': 'Hellcaller',
  'Soul Anathema': 'Soul Harvester', 'Demonic Soul': 'Soul Harvester',
  'Flurry Strikes': 'Shado-Pan', 'Wisdom of the Wall': 'Shado-Pan',
  'Celestial Conduit': 'Conduit of the Celestials', 'Strength of the Black Ox': 'Conduit of the Celestials', 'Courage of the White Tiger': 'Conduit of the Celestials', 'Flight of the Red Crane': 'Conduit of the Celestials',
  'Aspect of Harmony': 'Master of Harmony', 'Purified Spirit': 'Master of Harmony',
  'Ravage': 'Druid of the Claw', 'Dreadful Wound': 'Druid of the Claw',
  'Bloodseeker Vines': 'Wildstalker', 'Symbiotic Blooms': 'Wildstalker',
  'Dream Surge': 'Keeper of the Grove', 'Treants of the Moon': 'Keeper of the Grove',
  'Boundless Moonlight': "Elune's Chosen", 'Lunar Insight': "Elune's Chosen", 'Red Moon': "Elune's Chosen", 'Moonless Night': "Elune's Chosen",
  'Bursting Growth': 'Wildstalker',
  'Tempest': 'Stormbringer', 'Awakening Storms': 'Stormbringer',
  'Surging Totem': 'Totemic', 'Lively Totems': 'Totemic',
  'Call of the Ancestors': 'Farseer', 'Ancestral Swiftness': 'Farseer',
  'Engulf': 'Flameshaper', 'Consume Flame': 'Flameshaper',
  'Chrono Flame': 'Chronowarden', 'Temporal Burst': 'Chronowarden',
  'Mass Disintegrate': 'Scalecommander', 'Mass Eruption': 'Scalecommander', 'Bombardments': 'Scalecommander',
  "Reaver's Glaive": 'Aldrachi Reaver', 'Art of the Glaive': 'Aldrachi Reaver', 'Wounded Quarry': 'Aldrachi Reaver',
  'Demonsurge': 'Fel-Scarred', 'Soul Sunder': 'Fel-Scarred',
  // Devourer (Midnight): Void-Scarred mirrors Fel-Scarred's surge pattern;
  // Annihilator is the void-cataclysm tree (shared with Vengeance)
  'Voidsurge': 'Void-Scarred', 'Voidblade': 'Void-Scarred', 'Hungering Slash': 'Void-Scarred',
  'Collapsing Star': 'Annihilator', 'Voidfall Meteor': 'Annihilator', 'Soulburst': 'Annihilator', 'Eradicate': 'Annihilator', 'Catastrophe': 'Annihilator',
};

/** Hero tree of a set of ability names, or null when nothing matches. */
function heroOf(names: Set<string>): string | null {
  const votes = new Map<string, number>();
  for (const n of names) {
    const tree = HERO_SIG[n];
    if (tree) votes.set(tree, (votes.get(tree) ?? 0) + 1);
  }
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1]) ? sorted[0][0] : null;
}

const heroCandCache = new Map<string, string | null>();

/** Hero tree of one ranked player, from their damage/healing table names. */
async function heroOfCandidate(cand: any, metric: string): Promise<string | null> {
  const key = cand.report.code + '#' + cand.report.fightID + '#' + cand.name;
  if (heroCandCache.has(key)) return heroCandCache.get(key)!;
  const head = await wcl(
    `query($code: String!) { reportData { report(code: $code) { masterData { actors(type: "Player") { id name } } } } }`,
    { code: cand.report.code });
  const actor = head.reportData.report?.masterData.actors.find((a: any) => a.name?.toLowerCase() === cand.name.toLowerCase());
  let tree: string | null = null;
  if (actor) {
    const tbl = await wcl(
      `query($code: String!, $fid: [Int]!, $src: Int!) {
         reportData { report(code: $code) { table(dataType: ${metric === 'hps' ? 'Healing' : 'DamageDone'}, fightIDs: $fid, sourceID: $src) } }
       }`, { code: cand.report.code, fid: [cand.report.fightID], src: actor.id });
    tree = heroOf(new Set((tbl.reportData.report?.table?.data?.entries ?? []).map((e: any) => e.name)));
  }
  heroCandCache.set(key, tree);
  return tree;
}

interface HeroBlock {
  ids: Set<number>;
  entries: any[];
  tree?: string | null;
}

/** Split ranked entries (with combatantInfo talents) into the hero-tree
 * groups: hero nodes are 5+ talent IDs that always travel together and
 * split the field. Returns 0, 1, or 2 blocks. */
function heroBlocks(entries: any[]): HeroBlock[] {
  const withTalents = entries.filter((e) => Array.isArray(e.talents) && e.talents.length);
  if (withTalents.length < 4) return [];
  const masks = new Map<number, string>();
  for (const [i, e] of withTalents.entries()) {
    for (const t of e.talents) {
      masks.set(t.talentID, (masks.get(t.talentID) ?? '').padEnd(i, '0') + '1');
    }
  }
  const n = withTalents.length;
  const groups = new Map<string, number[]>();
  for (const [id, m0] of masks) {
    const m = m0.padEnd(n, '0');
    const ones = [...m].filter((x) => x === '1').length;
    if (ones < 2 || ones / n >= 0.95) continue; // a rare tree still counts; a universal talent never does
    groups.set(m, (groups.get(m) ?? []).concat(id));
  }
  const blocks = [...groups.entries()]
    .filter(([, ids]) => ids.length >= 5)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([mask, ids]) => ({
      ids: new Set(ids),
      entries: withTalents.filter((_, i) => mask[i] === '1'),
    }));
  if (blocks.length === 2) {
    const set1 = new Set(blocks[0].entries);
    if (blocks[1].entries.some((e) => set1.has(e))) return [blocks[0]];
  }
  return blocks;
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
  hero: string | null;
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

  // fairness: one check on the player's own kill decides the ranking pool.
  // No Power Infusion -> the log service filters to no-external-buff parses
  // server-side (externalBuffs: Exclude); with PI, anything goes.
  const aHasPI = await fightHasPI(best.report.code, best.report.fightID, name);
  let excluded = !aHasPI;

  // pages 1-3: the top logs decide the reference; the deeper pages give the
  // hero-tree clustering a chance to see the off-meta tree at all
  let encName: string | null = null;
  const fetchRankings = async (xb: string): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 1; page <= 3; page++) {
      const wr = await wcl(
        `query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $page: Int!, $xb: ExternalBuffRankFilter) {
           worldData { encounter(id: $enc) {
             name
             characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: $page, includeCombatantInfo: true, externalBuffs: $xb)
           } }
         }`, { enc: encounter, cls: className, spec, diff: difficulty, metric, page, xb });
      const encData = wr.worldData.encounter;
      encName = encData?.name ?? encName;
      const got = encData?.characterRankings?.rankings ?? [];
      out.push(...got);
      if (got.length < 100 || !encData?.characterRankings?.hasMorePages) break;
    }
    return out;
  };
  let rankings = await fetchRankings(excluded ? 'Exclude' : 'Any');
  if (!rankings.length && excluded) {
    excluded = false; // no externals-free parses ranked at all — fall back
    rankings = await fetchRankings('Any');
  }
  // anonymous uploads can't be actor-matched — take the best mirrorable parse
  const usable = rankings.filter((r: any) =>
    r.name && r.name.toLowerCase() !== 'anonymous' && r.report?.code && !r.report.code.startsWith('a:') &&
    !(r.name.toLowerCase() === name.trim().toLowerCase() && r.report.code === best.report?.code));
  if (!usable.length) throw new Error(`no mirrorable world rankings for ${spec} ${className} on this encounter/difficulty`);

  // the player's side — hero-tree matching reads their ability names
  const mine = await fetchFightSide(best.report.code, best.report.fightID, name, metric);
  if (!best.amount) best.amount = Math.round(Object.values(mine.dmg).reduce((a, b) => a + b, 0) / Math.max(1, mine.durSec));

  // hero trees: cluster the rankings by their hero-talent blocks, name each
  // block by its top log's signature abilities, classify this kill likewise
  const aHero = heroOf(new Set([...mine.casts.map((x) => x[1]), ...Object.keys(mine.dmg)]));
  const blocks = heroBlocks(usable);
  for (const bl of blocks) bl.tree = await heroOfCandidate(bl.entries[0], metric);
  const blockOf = (entry: any) => blocks.find((bl) => bl.entries.includes(entry));
  const wanted = params.hero || aHero;
  const wantedBlock = wanted ? blocks.find((bl) => bl.tree === wanted) : null;
  const pool = wantedBlock ? wantedBlock.entries : usable;

  // the ranking pool is already externals-fair — take its top
  const top: any = pool[0];
  const bHasPI = excluded ? false : await fightHasPI(top.report.code, top.report.fightID, top.name);

  const theirs = await fetchFightSide(top.report.code, top.report.fightID, top.name, metric);
  const bHero = blockOf(top)?.tree
    ?? heroOf(new Set([...theirs.casts.map((x) => x[1]), ...Object.keys(theirs.dmg)]));
  const altTree = blocks.find((bl) => bl.tree && bl.tree !== (bHero ?? wanted))?.tree ?? null;

  return {
    encounter: { id: encounter, name: encName ?? `#${encounter}` }, difficulty, metric, spec, className,
    pi: { a: aHasPI, b: bHasPI, excluded },
    hero: { a: aHero, b: bHero, alt: altTree, requested: params.hero || null },
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
    hero: q.get('hero')?.trim() || null,
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
