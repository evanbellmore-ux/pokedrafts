// The hosted transport validates inputs and required data without changing the
// source-pinned comparison algorithm. No credentials, retained pins, or I/O here.

export type ThroughputMetric = 'dps' | 'hps';
export type Region = 'us' | 'eu' | 'kr' | 'tw';
export type Difficulty = 3 | 4 | 5;

export interface CompareParams {
  name: string;
  server: string;
  region: Region;
  encounter: number;
  difficulty: Difficulty;
  metric: ThroughputMetric;
  code: string | null;
  fightID: number | null;
  hero: string | null;
}

export interface RequestedExecutionContext {
  zone: number | null;
  encounter: number;
  difficulty: Difficulty;
  className: string | null;
  spec: string | null;
  hero: string | null;
  pi: boolean | null;
}

export interface ComparisonClient {
  query(document: string, variables?: Record<string, unknown>): Promise<unknown>;
}

export interface FightSide {
  name: string;
  server: string;
  actorID: number;
  code: string;
  fightID: number;
  amount: number;
  rankPercent: number | null;
  scope: { zone: number | null; encounter: number; difficulty: Difficulty; size: number | null };
  durSec: number;
  kill: boolean;
  casts: [number, string][];
  dmg: Record<string, number>;
  resources: Record<string, { max: number; spentSnap: number; gained: number; waste: number; series: [number, number][] }>;
  lust: [number, number][];
}

export interface SupportInfo { a: boolean; b: boolean; excluded: boolean }
export interface HeroInfo { a: string | null; b: string | null; alt: string | null; requested: string | null }

export interface Comparison {
  encounter: { id: number; name: string };
  difficulty: Difficulty;
  metric: ThroughputMetric;
  spec: string;
  className: string;
  pi: SupportInfo;
  hero: HeroInfo;
  a: FightSide;
  b: FightSide;
  bossReference?: { b: FightSide; pi: SupportInfo; hero: HeroInfo; rankingMetric: 'bossdps' } | null;
  bossReferenceError?: string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const DATA_DIAGNOSTICS = [
  'data.unclassified',
  'upstream.envelope', 'upstream.classes.envelope', 'upstream.classes.entries',
  'upstream.character.envelope', 'upstream.character.rankings-context', 'upstream.character.rankings-entries', 'upstream.character.recent-reports',
  'upstream.world.encounter', 'upstream.world.pagination', 'upstream.world.entries',
  'upstream.report.envelope', 'upstream.report.actors', 'upstream.report.abilities', 'upstream.report.fights', 'upstream.report.public-scope', 'upstream.report.fight-context',
  'upstream.events.envelope', 'upstream.events.entries', 'upstream.events.pagination',
  'upstream.casts.envelope', 'upstream.casts.entries', 'upstream.casts.pagination', 'upstream.casts.evidence',
  'upstream.resources.envelope', 'upstream.resources.entries', 'upstream.resources.pagination', 'upstream.resources.evidence',
  'upstream.pi.envelope', 'upstream.pi.entries', 'upstream.pi.targets',
  'upstream.table.envelope', 'upstream.summary.composition', 'upstream.damage.entries', 'upstream.healing.entries', 'upstream.lust.bands',
  'normalized.context', 'normalized.support', 'normalized.hero', 'normalized.player-match', 'normalized.requested-pin', 'normalized.boss-reference',
  'normalized.player.identity', 'normalized.player.ranking', 'normalized.player.fight', 'normalized.player.scope',
  'normalized.player.casts', 'normalized.player.damage', 'normalized.player.resources', 'normalized.player.lust',
  'normalized.overall.identity', 'normalized.overall.ranking', 'normalized.overall.fight', 'normalized.overall.scope',
  'normalized.overall.casts', 'normalized.overall.damage', 'normalized.overall.resources', 'normalized.overall.lust',
  'normalized.boss.identity', 'normalized.boss.ranking', 'normalized.boss.fight', 'normalized.boss.scope',
  'normalized.boss.casts', 'normalized.boss.damage', 'normalized.boss.resources', 'normalized.boss.lust',
] as const;
export type ComparisonDataDiagnostic = typeof DATA_DIAGNOSTICS[number];
const DATA_DIAGNOSTIC_SET: ReadonlySet<string> = new Set(DATA_DIAGNOSTICS);

export class ComparisonDataError extends Error {
  readonly diagnostic?: ComparisonDataDiagnostic;
  constructor(diagnostic?: ComparisonDataDiagnostic) {
    super('The log-service response was incomplete or incompatible with the requested comparison.');
    this.name = 'ComparisonDataError';
    this.diagnostic = diagnostic;
  }
}

/** Project only a fixed assertion-site label, never error properties or data. */
export function comparisonDataDiagnostic(error: unknown): ComparisonDataDiagnostic | null {
  if (!(error instanceof ComparisonDataError)) return null;
  const label: unknown = Object.getOwnPropertyDescriptor(error, 'diagnostic')?.value;
  return typeof label === 'string' && DATA_DIAGNOSTIC_SET.has(label)
    ? label as ComparisonDataDiagnostic : 'data.unclassified';
}

const MAX_INT = 2_147_483_647;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PUBLIC_REPORT = /^[A-Za-z0-9]{16}$/;

function parameter(q: URLSearchParams, key: string): string | null {
  if (q.getAll(key).length > 1) throw new InputError(`${key} must be provided only once`);
  return q.get(key);
}

function textParameter(q: URLSearchParams, key: string, max: number, required = false): string | null {
  const raw = parameter(q, key);
  if (raw != null && (raw.length > max || CONTROL.test(raw))) {
    throw new InputError(`${key} must be a bounded string without control characters`);
  }
  const value = raw?.trim() || null;
  if (required && !value) throw new InputError(`${key} is required`);
  return value;
}

function integerParameter(q: URLSearchParams, key: string, required = false): number | null {
  const raw = parameter(q, key);
  if (raw === null) {
    if (required) throw new InputError(`${key} is required`);
    return null;
  }
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_INT) {
    throw new InputError(`${key} must be a positive integer ID`);
  }
  return Number(raw);
}

function zoneParameter(q: URLSearchParams): number | null {
  const raw = parameter(q, 'zone');
  // The canonical browser uses 0 (or an initial empty value) for Auto. It is
  // explicitly unverified context, not an integer raid/benchmark scope.
  if (raw === null || raw === '' || raw === '0') return null;
  return integerParameter(q, 'zone');
}

function difficultyParameter(q: URLSearchParams): Difficulty {
  const value = integerParameter(q, 'difficulty') ?? 4;
  if (value !== 3 && value !== 4 && value !== 5) throw new InputError('difficulty must be 3, 4, or 5');
  return value;
}

export function parseCompareRequest(request: Request): { params: CompareParams; zone: number | null } {
  if (request.url.length > 4096) throw new InputError('comparison request URL is too long');
  const q = new URL(request.url).searchParams;
  const name = textParameter(q, 'name', 64, true)!;
  const server = textParameter(q, 'server', 128, true)!;
  const rawRegion = textParameter(q, 'region', 2);
  const region = (rawRegion ?? 'us').toLowerCase();
  if ((q.has('region') && !rawRegion) || !['us', 'eu', 'kr', 'tw'].includes(region)) throw new InputError('region must be us, eu, kr, or tw');
  const rawMetric = textParameter(q, 'metric', 3);
  const metric = rawMetric ?? 'dps';
  if ((q.has('metric') && !rawMetric) || (metric !== 'dps' && metric !== 'hps')) throw new InputError('metric must be dps or hps');
  const encounter = integerParameter(q, 'encounter', true)!;
  const difficulty = difficultyParameter(q);
  const code = textParameter(q, 'code', 16);
  const fightID = integerParameter(q, 'fightID');
  // Empty pins are not a way to silently fall back to the character's best kill.
  if ((q.has('code') && !code) || (code === null) !== (fightID === null)) {
    throw new InputError('code and fightID must be supplied together');
  }
  if (code !== null && !PUBLIC_REPORT.test(code)) throw new InputError('code must be a public 16-character report code');
  const hero = textParameter(q, 'hero', 80);
  const zone = zoneParameter(q);
  return { params: { name, server, region: region as Region, encounter, difficulty, metric, code, fightID, hero }, zone };
}

export function parseExecutionRequest(request: Request): RequestedExecutionContext {
  if (request.url.length > 4096) throw new InputError('Execution status request URL is too long');
  const q = new URL(request.url).searchParams;
  const rawPI = textParameter(q, 'pi', 5);
  if ((q.has('pi') && rawPI === null) || (rawPI !== null && rawPI !== 'true' && rawPI !== 'false')) throw new InputError('pi must be true or false');
  return {
    zone: zoneParameter(q),
    encounter: integerParameter(q, 'encounter', true)!,
    difficulty: difficultyParameter(q),
    className: textParameter(q, 'className', 64),
    spec: textParameter(q, 'spec', 64),
    hero: textParameter(q, 'hero', 80),
    pi: rawPI === null ? null : rawPI === 'true',
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
}
function positiveID(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value: unknown): value is number { return finite(value) && value >= 0; }
function resourceType(value: unknown): value is number { return finite(value) && Number.isInteger(value) && value >= -MAX_INT - 1 && value <= MAX_INT; }
const LUST_RE = /bloodlust|heroism|time warp|fury of the aspects|primal rage|harrier|ancient hysteria|netherwinds|drums of|feral hysteria/i;
function requireData(condition: unknown, diagnostic: ComparisonDataDiagnostic): asserts condition { if (!condition) throw new ComparisonDataError(diagnostic); }
function reportIdentity(value: unknown): boolean {
  return record(value) && string(value.code, 128) && !value.code.startsWith('a:') && positiveID(value.fightID);
}

/** Validate the JSON-bearing WCL fields that otherwise default to empty streams,
 * unknown PI, or incomplete rankings in the canonical algorithm. */
export function assertUpstreamData(document: string, value: unknown): void {
  requireData(record(value), 'upstream.envelope');
  if (document.includes('gameData')) {
    const game = value.gameData;
    requireData(record(game) && Array.isArray(game.classes) && game.classes.length > 0 && game.classes.length <= 128, 'upstream.classes.envelope');
    requireData(game.classes.every((c) => record(c) && positiveID(c.id) && string(c.name, 64)), 'upstream.classes.entries');
  }
  if (document.includes('characterData')) {
    const data = value.characterData;
    requireData(record(data) && Object.hasOwn(data, 'character'), 'upstream.character.envelope');
    const ch = data.character;
    if (ch === null) return; // A missing character is a controlled canonical error.
    requireData(record(ch), 'upstream.character.envelope');
    if (document.includes('encounterRankings')) {
      requireData(positiveID(ch.classID) && record(ch.encounterRankings), 'upstream.character.rankings-context');
      const ranks = ch.encounterRankings.ranks;
      requireData(Array.isArray(ranks) || !!ch.encounterRankings.error, 'upstream.character.rankings-context');
      if (Array.isArray(ranks)) {
        requireData(ranks.length <= 10_000 && ranks.every((r) => record(r) && reportIdentity(r.report) && nonnegative(r.amount) && string(r.spec, 64)), 'upstream.character.rankings-entries');
      }
    }
    if (document.includes('recentReports')) {
      requireData(record(ch.recentReports) && Array.isArray(ch.recentReports.data), 'upstream.character.recent-reports');
      requireData(ch.recentReports.data.length <= 10 && ch.recentReports.data.every((r) => record(r) && string(r.code, 128) && !r.code.startsWith('a:')), 'upstream.character.recent-reports');
    }
  }
  if (document.includes('characterRankings')) {
    const data = value.worldData;
    requireData(record(data) && record(data.encounter) && string(data.encounter.name), 'upstream.world.encounter');
    const rankings = data.encounter.characterRankings;
    requireData(record(rankings) && Array.isArray(rankings.rankings) && rankings.rankings.length <= 100 && typeof rankings.hasMorePages === 'boolean', 'upstream.world.pagination');
    requireData(rankings.rankings.every((r) => {
      if (!record(r)) return false;
      // Match the canonical usable-pool filter before validating evidence.
      // Unnamed/anonymous/inaccessible rows never contribute a reference.
      if (r.name == null || r.name === '') return true;
      if (!string(r.name, 128)) return false;
      if (r.name.toLowerCase() === 'anonymous' || r.report == null) return true;
      if (!record(r.report)) return false;
      if (r.report.code == null || r.report.code === '') return true;
      if (!string(r.report.code, 128)) return false;
      if (r.report.code.startsWith('a:')) return true;
      return positiveID(r.report.fightID) && nonnegative(r.amount)
        && (r.talents == null || (Array.isArray(r.talents) && r.talents.every((t) => record(t) && positiveID(t.talentID))));
    }), 'upstream.world.entries');
  }
  if (!document.includes('reportData')) return;
  const data = value.reportData;
  requireData(record(data) && Object.hasOwn(data, 'report'), 'upstream.report.envelope');
  const report = data.report;
  if (report === null && document.includes('killType: Kills')) return; // Inaccessible recent uploads can be skipped.
  requireData(record(report), 'upstream.report.envelope');
  if (document.includes('masterData')) {
    requireData(record(report.masterData) && Array.isArray(report.masterData.actors), 'upstream.report.actors');
    const selection = /actors\(type:\s*"Player"\)\s*\{([^}]*)\}/.exec(document)?.[1] ?? '';
    // Unnamed roster actors cannot match; selected identity is still required
    // by sideActor and final normalization, including a positive actor ID.
    requireData(report.masterData.actors.every((a) => record(a) && (a.name == null || string(a.name, 128)) && (!/\bid\b/.test(selection) || positiveID(a.id))), 'upstream.report.actors');
    if (document.includes('abilities {')) {
      requireData(Array.isArray(report.masterData.abilities), 'upstream.report.abilities');
      // WCL gameID is Float: numeric lookup keys are not actor/fight Int IDs.
      requireData(report.masterData.abilities.every((a) => record(a) && finite(a.gameID) && (a.name == null || string(a.name))), 'upstream.report.abilities');
    }
  }
  if (document.includes('fights(')) {
    requireData(Array.isArray(report.fights), 'upstream.report.fights');
    requireData(report.fights.every((f) => record(f) && positiveID(f.id)), 'upstream.report.fights');
    if (document.includes('endTime kill')) {
      requireData(report.visibility === 'public' && (report.zone == null || (record(report.zone) && positiveID(report.zone.id))), 'upstream.report.public-scope');
      requireData(report.fights.every((f) => record(f) && finite(f.startTime) && finite(f.endTime) && f.endTime > f.startTime
        && positiveID(f.encounterID) && [3, 4, 5].includes(Number(f.difficulty)) && typeof f.kill === 'boolean'), 'upstream.report.fight-context');
    }
  }
  if (document.includes('events(')) {
    const cast = document.includes('dataType: Casts'), resource = document.includes('dataType: Resources'), pi = document.includes('abilityID: $aid');
    const kind = Number(cast) + Number(resource) + Number(pi) !== 1 ? 'events' : cast ? 'casts' : resource ? 'resources' : 'pi';
    const events = report.events;
    requireData(record(events) && Array.isArray(events.data), `upstream.${kind}.envelope`);
    requireData(events.data.length <= (document.includes('abilityID: $aid') ? 2000 : 10_000), `upstream.${kind}.entries`);
    requireData(events.data.every((e) => record(e) && string(e.type, 64)), `upstream.${kind}.entries`);
    if (document.includes('nextPageTimestamp')) {
      requireData(Object.hasOwn(events, 'nextPageTimestamp') && (events.nextPageTimestamp === null || nonnegative(events.nextPageTimestamp)), kind === 'pi' ? 'upstream.events.pagination' : `upstream.${kind}.pagination`);
    }
    if (document.includes('dataType: Casts')) {
      // The core skips null/untyped snapshots and accepts signed resource keys.
      // Typed evidence remains numeric; optional maxima are never filled/coerced.
      requireData(events.data.every((e) => record(e) && (e.type !== 'cast' || (finite(e.timestamp) && finite(e.abilityGameID)
        && (e.classResources == null || (Array.isArray(e.classResources) && e.classResources.every((r) => r === null || (record(r)
          && (r.type == null || (resourceType(r.type) && nonnegative(r.amount) && (r.max == null || nonnegative(r.max))))))))))), 'upstream.casts.evidence');
    }
    if (document.includes('dataType: Resources')) {
      requireData(events.data.every((e) => record(e) && (e.type !== 'resourcechange' || e.resourceChangeType == null || (resourceType(e.resourceChangeType)
        && (e.resourceChange == null || finite(e.resourceChange)) && (e.waste == null || nonnegative(e.waste))))), 'upstream.resources.evidence');
    }
    if (document.includes('abilityID: $aid')) {
      requireData(events.data.every((e) => record(e) && ((e.type !== 'applybuff' && e.type !== 'refreshbuff') || positiveID(e.targetID))), 'upstream.pi.targets');
    }
  }
  if (document.includes('table(')) {
    requireData(record(report.table) && record(report.table.data), 'upstream.table.envelope');
    const table = report.table.data;
    if (document.includes('dataType: Summary')) requireData(Array.isArray(table.composition), 'upstream.summary.composition');
    if (document.includes('dataType: DamageDone') || document.includes('dataType: Healing')) {
      requireData(Array.isArray(table.entries) && table.entries.every((e) => record(e) && nonnegative(e.total) && (string(e.name) || (e.total === 0 && e.name == null))), document.includes('dataType: Healing') ? 'upstream.healing.entries' : 'upstream.damage.entries');
    }
    if (document.includes('dataType: Buffs')) {
      const auras = table.auras ?? table.entries;
      requireData(Array.isArray(auras) && auras.every((a) => record(a) && (a.name == null || string(a.name))
        && (!LUST_RE.test(typeof a.name === 'string' ? a.name : '') || a.bands == null || (Array.isArray(a.bands)
          && a.bands.every((b) => record(b) && finite(b.startTime) && finite(b.endTime) && b.endTime >= b.startTime)))), 'upstream.lust.bands');
    }
  }
}

function validateSupport(value: unknown): void {
  requireData(record(value) && ['a', 'b', 'excluded'].every((k) => typeof value[k] === 'boolean'), 'normalized.support');
}
function validateHero(value: unknown): void {
  requireData(record(value) && ['a', 'b', 'alt', 'requested'].every((k) => value[k] === null || string(value[k], 80)), 'normalized.hero');
}
function validateSide(value: unknown, params: CompareParams, kind: 'player' | 'overall' | 'boss'): void {
  requireData(record(value) && string(value.name, 128) && string(value.server, 128) && positiveID(value.actorID) && reportIdentity(value), `normalized.${kind}.identity`);
  requireData(nonnegative(value.amount) && (value.rankPercent === null || (nonnegative(value.rankPercent) && value.rankPercent <= 100)), `normalized.${kind}.ranking`);
  requireData(finite(value.durSec) && value.durSec > 0 && value.kill === true, `normalized.${kind}.fight`);
  requireData(record(value.scope) && value.scope.encounter === params.encounter && value.scope.difficulty === params.difficulty
    && (value.scope.zone === null || positiveID(value.scope.zone)) && (value.scope.size === null || nonnegative(value.scope.size)), `normalized.${kind}.scope`);
  requireData(Array.isArray(value.casts) && value.casts.length <= 200_000
    && value.casts.every((c) => Array.isArray(c) && c.length === 2 && nonnegative(c[0]) && string(c[1])), `normalized.${kind}.casts`);
  requireData(record(value.dmg) && Object.values(value.dmg).every(nonnegative), `normalized.${kind}.damage`);
  requireData(record(value.resources) && Object.values(value.resources).every((r) => record(r)
    && ['max', 'spentSnap', 'waste'].every((k) => nonnegative(r[k])) && finite(r.gained) && Array.isArray(r.series) && r.series.length <= 400
    && r.series.every((s) => Array.isArray(s) && s.length === 2 && nonnegative(s[0]) && nonnegative(s[1]))), `normalized.${kind}.resources`);
  requireData(Array.isArray(value.lust) && value.lust.every((w) => Array.isArray(w) && w.length === 2 && nonnegative(w[0]) && finite(w[1]) && w[1] > w[0]), `normalized.${kind}.lust`);
}

export function safeBossError(value: unknown): string {
  const message = typeof value === 'string' ? value : value instanceof Error ? value.message : '';
  if (/no mirrorable.*bossdps/i.test(message)) return 'No mirrorable Boss damage ranking is currently available for this encounter and build.';
  if (/incomplete|incompatible|cursor|page cap|identity|actor|fight not found/i.test(message)) {
    return 'Boss damage reference is unavailable because the log-service data was incomplete.';
  }
  return 'Boss damage reference is temporarily unavailable. Overall damage is still available.';
}

/** Whitelist the canonical throughput contract: never forward a retained
 * comparison ID, Execution score, benchmark, or hydration from a builder. */
export function normalizeComparison(value: unknown, params: CompareParams): { comparison: Comparison; complete: boolean } {
  requireData(record(value) && record(value.encounter) && value.encounter.id === params.encounter && string(value.encounter.name), 'normalized.context');
  requireData(value.difficulty === params.difficulty && value.metric === params.metric && string(value.spec, 64) && string(value.className, 64), 'normalized.context');
  validateSupport(value.pi);
  validateHero(value.hero);
  validateSide(value.a, params, 'player');
  validateSide(value.b, params, 'overall');
  requireData(record(value.a) && string(value.a.name, 128) && value.a.name.trim().toLowerCase() === params.name.trim().toLowerCase(), 'normalized.player-match');
  if (params.code !== null) requireData(value.a.code === params.code && value.a.fightID === params.fightID, 'normalized.requested-pin');
  const comparison = {
    encounter: value.encounter, difficulty: value.difficulty, metric: value.metric, spec: value.spec, className: value.className,
    pi: value.pi, hero: value.hero, a: value.a, b: value.b,
  } as unknown as Comparison;
  let complete = true;
  if (params.metric === 'dps') {
    try {
      const boss = value.bossReference;
      requireData(record(boss) && boss.rankingMetric === 'bossdps' && !value.bossReferenceError, 'normalized.boss-reference');
      validateSide(boss.b, params, 'boss');
      validateSupport(boss.pi);
      validateHero(boss.hero);
      comparison.bossReference = { b: boss.b, pi: boss.pi, hero: boss.hero, rankingMetric: 'bossdps' } as Comparison['bossReference'];
    } catch (error) {
      complete = false;
      comparison.bossReference = null;
      comparison.bossReferenceError = safeBossError(value.bossReferenceError ?? error);
    }
  }
  return { comparison, complete };
}
