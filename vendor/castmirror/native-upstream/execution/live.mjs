// On-demand native v3 comparisons. No catalog readiness, pilot artifacts or raid crawl.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ExecutionSource, SourceError, resolveScope, readEvents, normalizeStatisticsFight } from './source.mjs';
import { streamBinding } from './contracts.mjs';
import { maintenanceClient } from './maintenance.mjs';
import { createLiveBudget, createDurableLiveBudget, LIVE_LIMITS } from './live-budget.mjs';
import { STATISTICS_VERSION, STATISTICS_COMPONENTS, evaluateStatistics, compareStatistics } from './statistics.mjs';
import { compactStatisticsObservation } from './compact-statistics.mjs';
import reviewed from './statistics-v3-rules.json' with { type: 'json' };

export const LIVE_RULES_VERSION = 'native-live-statistics-2';
export const LIVE_TTL = 10 * 60_000;
const CACHE_LIMIT = 64, CACHE_BYTES = 8 * 1024 * 1024;
const codeOK = (v) => /^[A-Za-z0-9]{16}$/.test(v ?? '');
const positiveID = (v) => Number.isSafeInteger(v) && v > 0;
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '');
const pick = (value, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(value ?? {}, k)).map((k) => [k, value[k]]));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keyOf = (o) => JSON.stringify([o.identity.code, o.identity.fightID, o.identity.actorID]);
const playerOf = (o) => JSON.stringify([norm(o.identity.name), norm(o.identity.server), norm(o.identity.region)]);
const matchesSide = (o, side) => o.identity.code === side?.code && o.identity.fightID === side?.fightID
  && o.identity.actorID === side?.actorID && norm(o.identity.name) === norm(side?.name) && norm(o.identity.server) === norm(side?.server);
const sideAttempt = (side) => JSON.stringify([side?.code, side?.fightID, side?.actorID]);
const rankingScope = (base, params) => params.executionRankingScope ?? base.executionRankingContext?.scope ?? null;
const safeReason = (error) => typeof error?.code === 'string' && /^[a-z-]{1,60}$/.test(error.code) ? error.code
  : error instanceof SourceError ? error.kind === 'inaccessible' ? 'public-native-evidence-unavailable' : 'native-context-unverified'
    : 'native-acquisition-unavailable';
function accountingDiagnostic(error) {
  const cause = error?.cause;
  return { reason: safeReason(error),
    causeName: ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AssertionError'].includes(cause?.name) ? cause.name : null,
    causeCode: typeof cause?.code === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(cause.code) ? cause.code : null,
    syscall: typeof cause?.syscall === 'string' && /^[A-Za-z]{1,30}$/.test(cause.syscall) ? cause.syscall : null,
    frames: typeof cause?.stack === 'string' ? cause.stack.split('\n').slice(1, 8).map((line) =>
      line.match(/[\\/]execution[\\/]((?:live-budget|maintenance)\.mjs:\d+:\d+)/)?.[1]).filter(Boolean) : [] };
}
function compactLiveObservation(observation) {
  const compact = compactStatisticsObservation(observation);
  // Aggregate avoidance and rejected-cast totals are sufficient for this UI.
  // Do not retain potentially large incident/display lists in a live pool.
  delete compact.components.avoidance.measurements.incidents;
  for (const ability of compact.components.defenses.measurements.abilities ?? []) delete ability.rejected;
  return compact;
}

export function liveStatisticsRules(scope) {
  // Personal cast definitions are independent of encounter mechanics. Keep their
  // reviewed class/spec restrictions; an unreviewed button stays unavailable.
  const exact = Object.keys(reviewed.scope).every((k) => scope[k] === reviewed.scope[k]);
  return { version: LIVE_RULES_VERSION, defensives: structuredClone(reviewed.defensives),
    avoidableAbilityIDs: exact ? [...reviewed.avoidableAbilityIDs] : [],
    usefulTargetNPCIDs: exact ? [...reviewed.usefulTargetNPCIDs] : [],
    paddingTargetNPCIDs: [], incomingDirection: null,
    nativeBossOutput: true };
}

export async function readLiveRankings(client, scope, { className, spec, role }) {
  const result = await client.query(`query($enc: Int!, $diff: Int!, $size: Int!, $partition: Int!, $cls: String!, $spec: String!, $metric: CharacterRankingMetricType!) {
    worldData { encounter(id: $enc) {
      characterRankings(className: $cls, specName: $spec, difficulty: $diff, size: $size, partition: $partition,
        metric: $metric, page: 1, externalBuffs: Any)
    } }
  }`, { enc: scope.encounter, diff: scope.difficulty, size: scope.size, partition: scope.partition,
    cls: className, spec, metric: role === 'healer' ? 'hps' : 'dps' });
  const data = result?.worldData?.encounter?.characterRankings;
  if (!Array.isArray(data?.rankings) || data.rankings.length > LIVE_LIMITS.rankingRows
    || typeof data.hasMorePages !== 'boolean' || data.page !== undefined && data.page !== 1) {
    throw new SourceError('Ranking discovery contract unavailable', 'incomplete');
  }
  // Rankings are discovery leads, never Execution scores or proof of PI absence.
  const candidates = new Map();
  for (const row of data.rankings) {
    if (!codeOK(row?.report?.code) || !positiveID(row.report.fightID) || typeof row.name !== 'string'
      || !row.name.trim() || norm(row.name) === 'anonymous') continue;
    const candidate = { code: row.report.code, fightID: row.report.fightID };
    candidates.set(JSON.stringify(candidate), candidate);
  }
  return { rows: data.rankings.length, hasMorePages: data.hasMorePages, candidates: [...candidates.values()] };
}

function recordPage(input, page, budget) {
  budget.recordEvents(page);
  const prior = input.streams[page.name];
  if (page.page !== (prior?.pages ?? 0) + 1) throw budget.stop('event-page-accounting-mismatch');
  const complete = page.nextPageTimestamp === null;
  input.streams[page.name] = { state: complete ? 'known' : 'incomplete', pages: page.page,
    events: [...(prior?.events ?? []), ...page.events],
    binding: streamBinding(page.name, input.candidate.code, input.fight, complete) };
}

const SAMPLE_FIELDS = ['observations', 'players', 'kills', 'fights', 'minimumObservations', 'minimumPlayers',
  'sufficient', 'confidence', 'confidenceCaps', 'legacyObservations', 'maxPlayerShare', 'maxFightShare',
  'duplicateCount', 'conflictingDuplicates', 'invalidObservations'];
const MEASUREMENT_FIELDS = ['total', 'perSecond', 'damage', 'hits', 'complete', 'basis', 'exposure', 'deathCount',
  'deathTimes', 'firstDeathSec', 'firstDeathFraction', 'firstLifeSec', 'aliveTimeSec', 'eventCount', 'absorbed', 'mitigated',
  'rawUses', 'boundedUses', 'boundedUsesPerMinute', 'rejectedCount', 'usefulDamage', 'usefulDamagePerSecond',
  'allDamage', 'allDamagePerSecond', 'paddingDamage', 'unknownDamage', 'effective', 'consumed', 'overheal',
  'self', 'other', 'selfEffective', 'otherEffective', 'selfConsumed', 'otherConsumed', 'petRecipient', 'selfDefinition',
  'source', 'usefulTargetNPCIDs', 'paddingTargetNPCIDs'];
export function publicStatisticsEvaluation(evaluation, pi = null) {
  const e = evaluation;
  return { version: e.version, status: e.status, score: e.score, mask: e.mask, coverageWeight: e.coverageWeight,
    weights: e.weights, scope: e.scope, identity: e.identity && pick(e.identity, ['name', 'server', 'className', 'spec', 'role', 'verified']),
    sample: pick(e.sample, SAMPLE_FIELDS), support: { pi },
    provenance: pick(e.provenance, ['mode', 'authenticated', 'method', 'label', 'piPolicy', 'cohortMode', 'limitations']),
    components: Object.fromEntries(STATISTICS_COMPONENTS.map((name) => {
      const c = e.components[name], measurements = pick(c.measurements, MEASUREMENT_FIELDS);
      if (Array.isArray(c.measurements?.abilities)) measurements.abilities = c.measurements.abilities.map((a) =>
        pick(a, ['name', 'abilityIDs', 'minIntervalSec', 'charges', 'maxUsesPerFight', 'targetPolicy', 'allowedCount',
          'rawUses', 'boundedUses', 'ignoredBeginOrAuraEvents', 'nonPersonalCasts', 'supported']));
      return [name, { ...pick(c, ['state', 'value', 'definition', 'direction', 'scoreEligible', 'weight', 'score', 'percentile', 'limitations']),
        measurements, sample: pick(c.sample, SAMPLE_FIELDS) }];
    })) };
}

export function liveStatisticsReference(base, observations, { piPolicy = 'Any', acquisition = {} } = {}) {
  if (!['Any', 'Exclude'].includes(piPolicy)) throw new TypeError('PI policy must be Any or Exclude');
  const a = observations.find((o) => matchesSide(o, base.a));
  const b = observations.find((o) => matchesSide(o, base.b));
  const options = { piPolicy, cohortMode: 'spec' };
  const ae = evaluateStatistics(a, observations, options), be = evaluateStatistics(b, observations, options);
  const comparison = compareStatistics(ae, be);
  const compatible = a ? observations.filter((o) => ['zone', 'encounter', 'difficulty', 'size', 'partition', 'patch']
    .every((k) => o.scope[k] === a.scope[k]) && o.fight.kill === a.fight.kill
    && ['className', 'spec', 'role'].every((k) => o.identity[k] === a.identity[k])) : [];
  const pi = { present: 0, absent: 0, unknown: 0 };
  for (const o of compatible) pi[o.support.pi === true ? 'present' : o.support.pi === false ? 'absent' : 'unknown']++;
  const reasons = ['Local empirical sample percentiles, not official Warcraft Logs percentiles or an individual world ranking',
    'The existing ranked reference is measured against the same compatible sample; no global Execution winner is claimed',
    'Ranking-selected bounded sample, not an unbiased population sample',
    'Defensive usage is not mitigation effectiveness; unreviewed measurements stay unavailable'];
  if (!a) reasons.push('Selected fight measurements unavailable: public visibility or verified native identity/metadata required');
  if (!b) reasons.push('Ranked reference measurements unavailable; player measurements remain independent');
  if (ae.score === null) reasons.push('Insufficient compatible evidence for a player index; available measurements are retained');
  if (piPolicy === 'Exclude') reasons.push('Exclude PI requires known absence; present and unknown are excluded without Any fallback');
  if (acquisition.reason) reasons.push(`Acquisition limited: ${acquisition.reason}`);
  if (acquisition.accountingPersistence === 'unavailable') reasons.push('Accounting persistence unavailable; measured results are retained, with quota protections still fail-closed and no automatic acquisition retry');
  if (acquisition.cachePersistence === 'unavailable') reasons.push('Cache persistence unavailable; these measurements are retained in this response, not claimed as a shared persisted cache');
  const coverage = { observations: compatible.length, players: new Set(compatible.map(playerOf)).size,
    kills: new Set(compatible.filter((o) => o.fight.kill).map((o) => JSON.stringify([o.identity.code, o.identity.fightID]))).size,
    pi, excluded: piPolicy === 'Exclude' ? pi.present + pi.unknown : 0,
    sampleSelection: 'ranking-selected bounded local cohort', acquisition };
  return { b: base.b, rankingMetric: 'execution', hero: base.hero,
    pi: { a: a?.support.pi ?? null, b: b?.support.pi ?? null, excluded: piPolicy === 'Exclude' },
    execution: { analyticalVersion: STATISTICS_VERSION, status: ae.status, piPolicy, cohortMode: 'spec',
      a: publicStatisticsEvaluation(ae, a?.support.pi ?? null), b: publicStatisticsEvaluation(be, b?.support.pi ?? null),
      scope: ae.scope, comparable: comparison.comparable, comparison, coverage, reasons, globalWinner: null } };
}

export class LiveExecutionService {
  constructor({ client, directory, legacyDirectory, store, account, warmCache = true, now = Date.now, isForegroundBusy = () => false,
    budgetFactory, sourceFactory = (client) => new ExecutionSource(client, { maxPages: LIVE_LIMITS.eventPages }),
    onAccountingFailure = (diagnostic) => console.warn('Execution accounting persistence unavailable', JSON.stringify(diagnostic)) } = {}) {
    if (typeof client !== 'function' || (!store && !directory) ||
        (store && (!['readPool', 'savePool'].every((key) => typeof store[key] === 'function'))) || typeof warmCache !== 'boolean') {
      throw new TypeError('Live Execution requires a client provider and private cache directory or pool store');
    }
    this.client = client; this.directory = directory ? path.resolve(directory) : undefined; this.legacyDirectory = legacyDirectory;
    this.store = store; this.account = account; this.warmCache = warmCache;
    this.now = now; this.isForegroundBusy = isForegroundBusy;
    this.budgetFactory = budgetFactory ?? (store ? createDurableLiveBudget : createLiveBudget); this.sourceFactory = sourceFactory;
    this.onAccountingFailure = onAccountingFailure;
    this.pools = new Map(); this.inflight = new Map(); this.active = false;
  }
  poolKey(base, params = {}) {
    const pinned = rankingScope(base, params);
    return hash([STATISTICS_VERSION, LIVE_RULES_VERSION, base.encounter.id, base.difficulty,
      base.a.scope?.zone, base.a.scope?.size, base.className, base.spec, pinned?.partition ?? null, pinned?.patch ?? null]);
  }
  rememberPool(pool) {
    if (!this.warmCache) return;
    this.pools.delete(pool.key);
    this.pools.set(pool.key, pool);
    while (this.pools.size > CACHE_LIMIT) this.pools.delete(this.pools.keys().next().value);
  }
  async readPool(key) {
    // A warm map is optional L1 only. Store-backed callers always read shared
    // authority, including misses/replacements by another service instance.
    let pool = this.store ? await this.store.readPool(key) : this.pools.get(key);
    if (this.store) {
      try {
        if (pool && Buffer.byteLength(JSON.stringify(pool), 'utf8') > CACHE_BYTES) return null;
        pool = pool == null ? null : structuredClone(pool);
      } catch { return null; }
    }
    if (!this.store && !pool) {
      try {
        const file = path.join(this.directory, `${key}.pool.json`), info = await fs.lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > CACHE_BYTES) return null;
        pool = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    if (!pool || pool.version !== STATISTICS_VERSION || pool.rulesVersion !== LIVE_RULES_VERSION || pool.key !== key
      || !Number.isSafeInteger(pool.at) || pool.at > this.now() || this.now() - pool.at >= LIVE_TTL
      || !Array.isArray(pool.attempted) || pool.attempted.length > CACHE_LIMIT * (LIVE_LIMITS.kills + 2)
      || pool.attempted.some((item) => typeof item !== 'string' || item.length > 150)
      || !Array.isArray(pool.observations) || pool.observations.length > LIVE_LIMITS.observations
      || pool.observations.some((o) => o?.support?.pi !== null && typeof o?.support?.pi !== 'boolean')) {
      this.pools.delete(key); return null;
    }
    try { pool.observations = pool.observations.map(compactLiveObservation); }
    catch { this.pools.delete(key); return null; }
    this.rememberPool(pool);
    return pool;
  }
  async savePool(pool, ownership) {
    const data = JSON.stringify(pool);
    if (Buffer.byteLength(data) > CACHE_BYTES) throw Object.assign(new Error('Execution compact cache exceeded its bound'), { code: 'compact-cache-size-cap' });
    if (this.store) {
      if (!ownership || typeof ownership.account !== 'string' || typeof ownership.owner !== 'string' ||
          !Number.isSafeInteger(ownership.fence) || ownership.fence < 1) {
        throw Object.assign(new Error('Execution compact cache requires an owned writer'), { code: 'compact-cache-writer-required' });
      }
      await this.store.savePool(pool, ownership);
      this.rememberPool(pool);
      return;
    }
    const names = (await fs.readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.pool\.json$/.test(name));
    const filename = `${pool.key}.pool.json`;
    // Never prune account records, jobs, historical evidence or the pilot.
    if (names.length >= CACHE_LIMIT && !names.includes(filename)) {
      for (const name of names) {
        const file = path.join(this.directory, name), info = await fs.lstat(file);
        if (info.isFile() && !info.isSymbolicLink() && this.now() - info.mtimeMs >= LIVE_TTL) { await fs.unlink(file); break; }
      }
      if ((await fs.readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.pool\.json$/.test(name)).length >= CACHE_LIMIT) {
        throw Object.assign(new Error('Execution compact cache is full'), { code: 'compact-cache-full' });
      }
    }
    const temporary = path.join(this.directory, `${filename}.${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, path.join(this.directory, filename)); }
    finally { await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
    this.rememberPool(pool);
  }
  async compare(base, params = {}, { piPolicy = 'Any', signal, waitForInflight = true } = {}) {
    if (!['Any', 'Exclude'].includes(piPolicy) || !codeOK(base.a?.code) || !positiveID(base.a.fightID)
      || !positiveID(base.a.actorID) || !positiveID(base.encounter?.id) || !positiveID(base.difficulty)
      || typeof waitForInflight !== 'boolean' || signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError('Invalid pinned Execution comparison');
    }
    const key = this.poolKey(base, params);
    if (waitForInflight && this.inflight.has(key)) await this.inflight.get(key);
    let pool, readFailed = false;
    const read = async () => {
      try { return await this.readPool(key); }
      catch (error) { if (!this.store) throw error; readFailed = true; return null; }
    };
    const limited = (reason) => liveStatisticsReference(base, pool?.observations ?? [], { piPolicy,
      acquisition: { ...pool?.acquisition, state: 'limited', reason, cached: !!pool,
        ...(readFailed ? { cachePersistence: 'unavailable', cacheReason: 'compact-cache-read-failed' } : {}) } });
    pool = await read();
    if (readFailed) return limited('compact-cache-read-failed');
    if (signal?.aborted) return limited('cancelled');
    // Shared/disk reads yield; another caller may have claimed this pool meanwhile.
    if (this.inflight.has(key)) {
      if (!waitForInflight) return limited('another-comparison-active');
      await this.inflight.get(key); pool = await read();
      if (readFailed) return limited('compact-cache-read-failed');
      if (signal?.aborted) return limited('cancelled');
    }
    const needs = (side) => codeOK(side?.code) && positiveID(side?.fightID) && positiveID(side?.actorID)
      && !pool?.observations.some((o) => matchesSide(o, side)) && !pool?.attempted.includes(sideAttempt(side));
    const cached = !!pool && !needs(base.a) && !needs(base.b);
    if (!pool || needs(base.a) || needs(base.b)) {
      if (this.active) return limited('another-comparison-active');
      const promise = this.acquire(base, params, key, pool, { signal });
      this.inflight.set(key, promise);
      try { pool = await promise; } finally { this.inflight.delete(key); }
    }
    return liveStatisticsReference(base, pool.observations, { piPolicy, acquisition: { ...pool.acquisition, cached } });
  }
  async acquire(base, params, key, previous, { signal } = {}) {
    this.active = true;
    let budget, release = () => {}, ownership, wrapped, ownershipLive = true;
    const inputs = new Map(), observations = new Map((previous?.observations ?? []).map((o) => [keyOf(o), o]));
    const attempted = new Set(previous?.attempted ?? []);
    let scope = previous?.scope, role = null, reason = null, discovery = null;
    let discoveryAttempted = previous?.acquisition?.discoveryAttempted === true;
    const keep = (input) => {
      const measured = normalizeStatisticsFight(input, { rules: liveStatisticsRules(input.scope) })
        .filter((o) => o.identity.className === base.className && o.identity.spec === base.spec
          && (role === null || o.identity.role === role));
      // A flexible 30-person raid is valid; only the bounded compatible spec subset
      // consumes observation credit, not every unrelated roster participant.
      const selected = measured.find((o) => matchesSide(o, base.a));
      if (selected) role = selected.identity.role;
      const chosen = measured.sort((a, b) => Number(matchesSide(b, base.a) || matchesSide(b, base.b))
        - Number(matchesSide(a, base.a) || matchesSide(a, base.b))).slice(0, LIVE_LIMITS.playersPerKill);
      for (const o of chosen) observations.set(keyOf(o), compactLiveObservation(o));
      return chosen;
    };
    try {
      ({ budget, release, ownership } = await this.budgetFactory({ directory: this.directory, legacyDirectory: this.legacyDirectory,
        store: this.store, account: this.account, now: this.now, signal, isForegroundBusy: this.isForegroundBusy }));
      wrapped = maintenanceClient(await this.client(), budget);
      await wrapped.measure();
      const pinned = rankingScope(base, params);
      scope = await resolveScope(wrapped, { zone: base.a.scope?.zone ?? params.zone,
        encounter: base.encounter.id, difficulty: base.difficulty, partition: pinned?.partition });
      const verifiedPin = pinned && ['zone', 'encounter', 'difficulty', 'size', 'partition', 'patch']
        .every((k) => pinned[k] === scope[k]);
      const unknownScope = { ...scope, partition: null, patch: null };
      const source = this.sourceFactory(wrapped);
      const collect = async (candidate, boundScope, force = false) => {
        const id = JSON.stringify([candidate.code, candidate.fightID]);
        if (!force && attempted.has(id) || inputs.has(id)) return;
        budget.count('kills');
        if (!source.heads.has(candidate.code)) budget.count('reportHeads');
        attempted.add(id);
        let input;
        try {
          await source.fight(boundScope, candidate, null, { analyticalVersion: STATISTICS_VERSION,
            statisticsRules: liveStatisticsRules(boundScope), statisticsStreams: ['Deaths', 'Casts'], targetsFirst: true,
            onProgress: (progress) => { input = progress.input; inputs.set(id, input); },
            onPage: (page) => recordPage(input, page, budget) });
        } finally {
          if (input) { const rows = keep(input); budget.recordPlayers(rows.length); }
        }
      };
      // The selected actor is pinned by the ordinary comparison, not by a ranking
      // lead. Unverified historic partition is kept unknown, never relabeled current.
      const collectSide = async (side, boundScope) => {
        if (!codeOK(side?.code) || !positiveID(side?.fightID) || !positiveID(side?.actorID)
          || [...observations.values()].some((o) => matchesSide(o, side)) || attempted.has(sideAttempt(side))) return;
        await collect({ code: side.code, fightID: side.fightID }, boundScope, true);
      };
      await collectSide(base.a, verifiedPin && params.executionCurrentPartition === true ? scope : unknownScope);
      role = [...observations.values()].find((o) => matchesSide(o, base.a))?.identity.role ?? null;
      if (!role) throw new SourceError('Selected public native player measurements unavailable', 'inaccessible');
      // The already-pinned reference does not depend on optional ranking discovery.
      const referenceCurrent = params.executionReferenceCurrentPartition === true ||
        (!this.store && params.executionReferenceCurrentPartition === undefined);
      try { await collectSide(base.b, verifiedPin && referenceCurrent ? scope : unknownScope); }
      catch (error) { if (!(error instanceof SourceError)) throw error; reason = safeReason(error); }
      if (!discoveryAttempted) {
        const before = budget.snapshot().counters.graphql;
        try {
          discovery = await readLiveRankings(wrapped, scope, { className: base.className, spec: base.spec, role });
          budget.recordRanking(discovery.rows);
        } catch (error) { reason = safeReason(error); }
        finally { discoveryAttempted = budget.snapshot().counters.graphql > before; }
      }
      for (const candidate of discovery?.candidates ?? []) {
        if (budget.snapshot().counters.kills >= LIVE_LIMITS.kills) break;
        if (!codeOK(candidate.code) || !positiveID(candidate.fightID)) continue;
        try { await collect(candidate, scope); }
        catch (error) { if (!(error instanceof SourceError)) throw error; }
      }
      // Breadth before depth: a sample gets independently complete survival/casts
      // first; enrichment cannot erase those metrics if Healing is truncated.
      const priority = role === 'healer' ? ['Healing', 'CombatantInfo', 'Buffs', 'DamageTaken']
        : ['CombatantInfo', 'Buffs', 'Healing', 'DamageTaken'];
      for (const name of priority) for (const input of inputs.values()) {
        try {
          input.streams[name] = await readEvents(wrapped, input.candidate.code, input.fight, name,
            { maxPages: LIVE_LIMITS.eventPages, onPage: (page) => recordPage(input, page, budget) });
        } finally { keep(input); }
      }
    } catch (error) {
      reason = safeReason(error);
    } finally {
      const state = budget?.snapshot();
      // No dispatch means no attempted acquisition: an explicit retry may recheck
      // a transient writer/foreground block without resetting any terminal job.
      if (state?.counters.graphql > 0) {
        attempted.add(sideAttempt(base.a));
        attempted.add(sideAttempt(base.b));
      }
      let pool, accountingReason = null, reportedError;
      const report = (error) => {
        if (error !== reportedError) {
          reportedError = error;
          try { this.onAccountingFailure(accountingDiagnostic(error)); } catch {}
        }
        return safeReason(error);
      };
      const writeRetries = () => Number.isSafeInteger(budget?.liveWriteRetries) && budget.liveWriteRetries >= 0
        ? budget.liveWriteRetries : 0;
      const retain = async () => {
        pool.acquisition.accountingWriteRetries = writeRetries();
        if (budget && (!this.store || ownershipLive)) {
          try { await this.savePool(pool, ownership); }
          catch (error) {
            pool.acquisition.cachePersistence = 'unavailable';
            pool.acquisition.cacheReason = ['compact-cache-full', 'compact-cache-size-cap'].includes(error.code)
              ? error.code : 'compact-cache-write-failed';
            this.rememberPool(pool);
          }
        } else {
          if (this.store) Object.assign(pool.acquisition, { cachePersistence: 'unavailable', cacheReason: 'compact-cache-write-failed' });
          this.rememberPool(pool);
        }
      };
      try {
        try { if (wrapped) await wrapped.settle(); }
        catch (error) { accountingReason = report(error); reason ??= accountingReason; }
        pool = { version: STATISTICS_VERSION, rulesVersion: LIVE_RULES_VERSION, key, at: this.now(), scope,
          attempted: [...attempted].slice(-CACHE_LIMIT * (LIVE_LIMITS.kills + 2)), observations: [...observations.values()].sort((a, b) =>
            Number(matchesSide(b, base.a) || matchesSide(b, base.b)) - Number(matchesSide(a, base.a) || matchesSide(a, base.b)))
            .slice(0, LIVE_LIMITS.observations),
          acquisition: { state: reason ? 'limited' : 'complete', reason, limits: LIVE_LIMITS,
            counters: budget?.snapshot().counters ?? {}, discoveryAttempted,
            ...(accountingReason ? { accountingPersistence: 'unavailable', accountingReason } : {}),
            discoveryHasMorePages: discovery?.hasMorePages ?? previous?.acquisition?.discoveryHasMorePages ?? null,
            pagination: 'At most one ranking page; bounded event pages. No all-boss scan or automatic retry.' } };
        await retain();
        return pool;
      } finally {
        try {
          ownershipLive = false;
          await release();
          if (pool && pool.acquisition.accountingWriteRetries !== writeRetries()) await retain();
        } catch (error) {
          if (!pool) throw error;
          // Cleanup cannot erase independent measurements or reset uncertain debt.
          const failure = report(error);
          Object.assign(pool.acquisition, { state: 'limited', reason: pool.acquisition.reason ?? failure,
            accountingPersistence: 'unavailable', accountingReason: failure });
          await retain();
        } finally { this.active = false; }
      }
    }
  }
}
