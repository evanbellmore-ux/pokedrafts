// WCL boundaries are explicitly scoped. Missing/truncated data is never zero.
import { rememberFailure, describeFailure } from './diagnostics.mjs';
import { ADAPTER_VERSION, ANALYTICAL_VERSION, OPPORTUNITY_VERSION, CONTEXT_VERSION, BENEFIT_VERSION,
  REQUIRED_STREAMS, streamBinding, validateStream, streamReceipts, playerID, metadataID, abilityKey, effectKey, validateSourceProof,
  validateObjectiveContext, inspectOpportunityLedger, inspectBenefitLedger } from './contracts.mjs';
import { buildOpportunityLedger } from './opportunities.mjs';
import { buildBenefitLedger, buildDefensiveIntervals, resolvePlayerRoot } from './effects.mjs';
import { STATISTICS_VERSION, NATIVE_BOSS_FILTER, measureStatisticsFight } from './statistics.mjs';
export { ADAPTER_VERSION } from './contracts.mjs';

export class SourceError extends Error {
  constructor(message, kind = 'unsupported') { super(message); this.kind = kind; }
}
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '');
const unique = (v) => new Set(v).size === v.length;
const known = (v) => v?.state === 'known';
export const STATISTICS_STREAMS = REQUIRED_STREAMS.filter(({ name }) => ['CombatantInfo', 'Casts', 'DamageTaken', 'Deaths', 'Buffs', 'Healing'].includes(name));

export async function resolveScope(c, request) {
  const data = await c.query(`query($enc: Int!) {
    worldData { encounter(id: $enc) { id name zone { id name
      difficulties { id name sizes } partitions { id name default }
      encounters { id name }
    } } }
  }`, { enc: request.encounter });
  const encounter = data?.worldData?.encounter, zone = encounter?.zone;
  if (!zone || (request.zone && request.zone !== zone.id)) throw new SourceError('Encounter does not belong to the selected raid');
  const difficulty = zone.difficulties?.find((d) => d.id === request.difficulty);
  if (!Array.isArray(difficulty?.sizes) || difficulty.sizes.some((s) => !Number.isSafeInteger(s) || s < 0)) throw new SourceError('No verified raid size for this difficulty');
  // WCL explicitly defines an empty sizes list as flexible, not unknown.
  const sizes = difficulty.sizes.length ? difficulty.sizes : [0], size = request.size ?? sizes[0];
  if (!sizes.includes(size)) throw new SourceError('Unsupported leaderboard raid size');
  const partition = request.partition != null ? zone.partitions?.find((p) => p.id === request.partition) : zone.partitions?.find((p) => p.default);
  if (!partition) throw new SourceError('No verified current partition');
  return { zone: zone.id, zoneName: zone.name, encounter: encounter.id, encounterName: encounter.name,
    encounters: zone.encounters, difficulty: difficulty.id, size, partition: partition.id, patch: partition.name, adapterVersion: ADAPTER_VERSION };
}

export async function readRankings(c, scope, page) {
  const data = await c.query(`query($enc: Int!, $diff: Int!, $size: Int!, $partition: Int!, $page: Int!) {
    worldData { encounter(id: $enc) {
      fightRankings(metric: execution, difficulty: $diff, size: $size, partition: $partition, page: $page)
    } }
  }`, { enc: scope.encounter, diff: scope.difficulty, size: scope.size, partition: scope.partition, page });
  const result = data?.worldData?.encounter?.fightRankings;
  if (!Array.isArray(result?.rankings) || typeof result.hasMorePages !== 'boolean' || result.page !== page) throw new SourceError('Execution ranking response does not match the verified contract');
  return result;
}

export async function readEvents(c, code, fight, name, { maxPages = 20, onPage = () => {}, hostilityType = null } = {}) {
  const definition = REQUIRED_STREAMS.find((s) => s.name === name);
  if (!definition || hostilityType !== null && hostilityType !== definition.hostilityType) throw new SourceError('Unverified named event hostility scope', 'invalid');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20 || !playerID(fight?.id) || !finite(fight.startTime)
    || !finite(fight.endTime) || fight.endTime <= fight.startTime) throw new SourceError('Invalid event request bounds or page limit', 'invalid');
  const events = [], { dataType, hostilityType: hostility } = definition;
  const incomplete = (page, reason, paginationReason) => ({ state: 'incomplete', events, pages: page,
    binding: streamBinding(name, code, fight, false), reason: `${name}: ${reason}`,
    failureDiagnostic: describeFailure(null, { phase: 'event-page', page, paginationReason,
      classification: ['nonadvancing-cursor', 'page-cap'].includes(paginationReason) ? 'pagination' : 'response-contract' }) });
  let cursor = fight.startTime;
  for (let page = 1; page <= maxPages; page++) {
    let data;
    try {
      data = await c.query(`query($code: String!, $fid: [Int]!, $s: Float!, $e: Float!) {
        reportData { report(code: $code) {
          events(dataType: ${dataType}, hostilityType: ${hostility}, fightIDs: $fid, startTime: $s, endTime: $e, includeResources: true, limit: 10000) { data nextPageTimestamp }
        } }
      }`, { code, fid: [fight.id], s: cursor, e: fight.endTime });
    } catch (error) { throw rememberFailure(error, { page, phase: 'event-page' }, { fallback: true }); }
    const stream = data?.reportData?.report?.events;
    if (!Array.isArray(stream?.data) || !Object.hasOwn(stream, 'nextPageTimestamp')) return incomplete(page, 'missing page', 'missing-page');
    if (stream.data.some((e) => !finite(e?.timestamp) || e.timestamp < cursor || e.timestamp > fight.endTime || e.fight !== fight.id))
      return incomplete(page, 'event outside requested bounds or fight', 'event-outside-bounds');
    if (events.length + stream.data.length > 1_000_000) return incomplete(page, 'event collection exceeds verified contract', 'invalid-page');
    // Simultaneous events remain distinct, including multiple hits of one spell.
    try { onPage({ type: dataType, name, hostilityType: hostility, page, count: stream.data.length,
      events: stream.data, nextPageTimestamp: stream.nextPageTimestamp }); }
    catch (error) { throw rememberFailure(error, { page, phase: 'event-admission' }, { fallback: true }); }
    for (const event of stream.data) events.push(event);
    const next = stream.nextPageTimestamp;
    if (next === null) return { state: 'known', events, pages: page, binding: streamBinding(name, code, fight, true) };
    if (!finite(next) || next <= cursor || next > fight.endTime) return incomplete(page, 'nonadvancing cursor', 'nonadvancing-cursor');
    cursor = next;
  }
  return incomplete(maxPages, 'page cap reached', 'page-cap');
}

function validateFight(scope, fight, rep, { allowWipes = false } = {}) {
  if ((allowWipes ? typeof fight?.kill !== 'boolean' : !fight?.kill) || !playerID(fight.id) || fight.encounterID !== scope.encounter || fight.difficulty !== scope.difficulty
    || !playerID(fight.size) || scope.size !== 0 && fight.size !== scope.size || fight.difficulty === 5 && fight.size !== 20
    || rep?.zone?.id !== scope.zone || !finite(fight.startTime) || !finite(fight.endTime) || fight.endTime <= fight.startTime
    || !Array.isArray(fight.friendlyPlayers) || !fight.friendlyPlayers.length || fight.friendlyPlayers.length !== fight.size
    || !fight.friendlyPlayers.every(playerID) || !unique(fight.friendlyPlayers)) throw new SourceError('Fight is not a verified full-roster kill in the requested scope', 'invalid');
}
function validateActors(actors) {
  if (!Array.isArray(actors) || !actors.length || actors.some((a) => !metadataID(a?.id)) || !unique(actors.map((a) => a.id))) throw new SourceError('Missing or duplicate actor identities', 'incomplete');
}
function validateRoster(roster, fight, actors) {
  validateActors(actors);
  if (!Array.isArray(roster) || roster.length !== fight.size || !unique(roster.map((p) => p.id))) throw new SourceError('Incomplete or duplicate fight roster identities', 'incomplete');
  for (const p of roster) {
    if (p.specs !== undefined && (!Array.isArray(p.specs) || p.specs.some((s) => !text(s?.spec) || !finite(s.count))
      || p.specs.filter((s) => s.count > 0).length !== 1 || p.specs.find((s) => s.count > 0)?.spec !== p.spec))
      throw new SourceError('Multispec or mismatched fight specialization evidence', 'identity');
    const a = actors.find((a) => a.id === p.id && a.type === 'Player');
    if (!a || !fight.friendlyPlayers.includes(p.id) || !text(p.name) || !text(p.server) || !text(p.region) || !text(p.spec)
      || !text(a.name) || !text(a.server) || !text(a.subType) || norm(a.name) !== norm(p.name) || norm(a.server) !== norm(p.server)
      || a.subType !== p.className || !['dps', 'tank', 'healer'].includes(p.role)) throw new SourceError('Mismatched fight roster/player identity', 'identity');
  }
}
function validateOutput(output) {
  if (!Array.isArray(output) || output.some((e) => !playerID(e?.id) || !finite(e.total)) || !unique(output.map((e) => e.id))) throw new SourceError('Missing or invalid fight roster/output contract', 'incomplete');
}
function statisticsOutput(output) {
  // Native v3 tables can have independent signed pet rows. Their amounts and
  // ownership are validated together by the statistics engine, not v2's
  // player-only output contract; do not discard otherwise valid player rows.
  return Array.isArray(output) ? output : [];
}
function provenanceFor(rep, code, fight) {
  if (rep.code !== code || !finite(rep.startTime) || !finite(rep.endTime) || rep.endTime < rep.startTime
    || !Number.isSafeInteger(rep.revision) || rep.revision < 0 || rep.startTime + fight.endTime > rep.endTime)
    return { state: 'unsupported', code: null, reasons: ['Report code/dates/revision are not independently captured'] };
  return { state: 'known', code: rep.code, reportStartTime: rep.startTime, reportEndTime: rep.endTime, revision: rep.revision,
    fightStartTime: rep.startTime + fight.startTime, fightEndTime: rep.startTime + fight.endTime };
}

export class ExecutionSource {
  constructor(c, { maxPages = 20 } = {}) { this.c = c; this.maxPages = maxPages; this.heads = new Map(); }
  async head(code) {
    if (!/^[a-zA-Z0-9]{16}$/.test(code)) throw new SourceError('Anonymous or invalid report identity', 'inaccessible');
    if (!this.heads.has(code)) this.heads.set(code, this.c.query(`query($code: String!) {
      reportData { report(code: $code) { code startTime endTime revision visibility zone { id name }
        masterData { actors { id name server type subType gameID petOwner } abilities { gameID name } }
        fights { id encounterID difficulty size kill startTime endTime friendlyPlayers }
      } }
    }`, { code }).then((d) => d?.reportData?.report));
    // No unsupported phase fields are projected. Phase-dependent rules fail closed.
    return this.heads.get(code);
  }
  async fight(scope, candidate, catalog, { publicOnly = true, analyticalVersion = ANALYTICAL_VERSION, statisticsRules = {},
    statisticsStreams, targetsFirst = false, onPage = () => {}, onProgress = () => {} } = {}) {
    if (![ANALYTICAL_VERSION, STATISTICS_VERSION].includes(analyticalVersion)) throw new SourceError('Unknown analytical version', 'invalid');
    const statistical = analyticalVersion === STATISTICS_VERSION;
    const names = statisticsStreams ?? STATISTICS_STREAMS.map(({ name }) => name);
    if (typeof onPage !== 'function' || typeof onProgress !== 'function' || typeof targetsFirst !== 'boolean'
      || statisticsStreams !== undefined && (!statistical || !Array.isArray(names) || !names.length || !unique(names)
        || names.some((name) => !STATISTICS_STREAMS.some((stream) => stream.name === name)))) {
      throw new SourceError('Invalid bounded statistics collection plan', 'invalid');
    }
    const rep = await this.head(candidate.code);
    if (!rep || publicOnly && rep.visibility !== 'public') throw new SourceError('Report is not publicly accessible', 'inaccessible');
    const fight = rep.fights?.find((f) => f.id === candidate.fightID);
    validateFight(scope, fight, rep, { allowWipes: statistical });
    validateActors(rep.masterData?.actors);
    const nativeBoss = statistical && statisticsRules.nativeBossOutput === true;
    const bossField = nativeBoss ? `bossOutput: table(dataType: DamageDone, hostilityType: Friendlies,
      fightIDs: $fid, startTime: $s, endTime: $e, viewBy: Source, filterExpression: $filter)` : '';
    const details = await this.c.query(`query($code: String!, $fid: [Int]!${nativeBoss ? ', $s: Float!, $e: Float!, $filter: String!' : ''}) {
      reportData { report(code: $code) {
        playerDetails(fightIDs: $fid, includeCombatantInfo: true)
        output: table(dataType: DamageDone, fightIDs: $fid, viewBy: Source)
        ${bossField}
      } }
    }`, { code: candidate.code, fid: [fight.id], ...(nativeBoss ? { s: fight.startTime, e: fight.endTime, filter: NATIVE_BOSS_FILTER } : {}) });
    const groups = details?.reportData?.report?.playerDetails?.data?.playerDetails;
    let output = details?.reportData?.report?.output?.data?.entries;
    if (statistical) output = statisticsOutput(output);
    else validateOutput(output);
    const actors = rep.masterData.actors, roster = [];
    for (const [key, role] of [['dps', 'dps'], ['tanks', 'tank'], ['healers', 'healer']]) {
      if (!Array.isArray(groups?.[key])) throw new SourceError('Missing role roster', 'incomplete');
      for (const p of groups[key]) {
        const a = actors.find((a) => a.id === p?.id && a.type === 'Player');
        if (!Array.isArray(p?.specs) || p.specs.some((s) => !text(s?.spec) || !finite(s.count))) throw new SourceError('Missing fight specialization evidence', 'identity');
        const specs = p.specs.filter((s) => s.count > 0);
        if (specs.length !== 1) throw new SourceError('Multispec or missing fight specialization evidence', 'identity');
        roster.push({ ...p, className: a?.subType, spec: specs[0].spec, role });
      }
    }
    validateRoster(roster, fight, actors);
    const streams = {};
    const bossEntries = nativeBoss ? details?.reportData?.report?.bossOutput?.data?.entries : null;
    const bossOutput = nativeBoss ? { definition: 'native-boss-filter-table-v1', entries: bossEntries,
      binding: { code: candidate.code, fightID: fight.id, startTime: fight.startTime, endTime: fight.endTime,
        dataType: 'DamageDone', hostilityType: 'Friendlies', viewBy: 'Source', filterExpression: NATIVE_BOSS_FILTER,
        complete: Array.isArray(bossEntries) } } : null;
    const input = { scope, candidate, fight, rep, roster, output, useful: null, usefulScope: null, bossOutput, streams, catalog };
    if (statistical) onProgress({ stage: 'metadata', input });
    const collectStreams = async () => {
      for (const name of statistical ? names : REQUIRED_STREAMS.map(({ name }) => name)) {
        streams[name] = await readEvents(this.c, candidate.code, fight, name, { maxPages: this.maxPages, onPage });
        if (statistical) onProgress({ stage: 'stream', name, stream: streams[name], input });
      }
    };
    if (!statistical || !targetsFirst) await collectStreams();
    const targetNPCIDs = statisticsRules.usefulTargetNPCIDs ?? [], paddingNPCIDs = statisticsRules.paddingTargetNPCIDs ?? [];
    const statisticsTargetsReviewed = text(statisticsRules.version) && Array.isArray(targetNPCIDs) && targetNPCIDs.length > 0
      && targetNPCIDs.length <= 20 && targetNPCIDs.every(playerID) && unique(targetNPCIDs)
      && Array.isArray(paddingNPCIDs) && paddingNPCIDs.every(playerID) && unique(paddingNPCIDs)
      && !targetNPCIDs.some((id) => paddingNPCIDs.includes(id));
    const reviewedTargets = statistical ? statisticsTargetsReviewed ? targetNPCIDs : [] : catalog.usefulTargets;
    const usefulIDs = actors.filter((a) => (!statistical || a.type === 'NPC') && reviewedTargets.includes(a.gameID)).map((a) => a.id);
    let useful = null, usefulScope = null;
    if (!nativeBoss && (statistical ? statisticsTargetsReviewed : catalog.targetsReviewed) && usefulIDs.length && usefulIDs.length <= 20) {
      const alias = (id) => id < 0 ? `tn${-id}` : `t${id}`;
      const fields = usefulIDs.map((id) => `${alias(id)}: table(dataType: DamageDone, fightIDs: $fid, targetID: ${id}, viewBy: Source)`).join('\n');
      const result = await this.c.query(`query($code: String!, $fid: [Int]!) { reportData { report(code: $code) { ${fields} } } }`, { code: candidate.code, fid: [fight.id] });
      const tables = usefulIDs.map((id) => result?.reportData?.report?.[alias(id)]);
      if (statistical) {
        usefulScope = { verified: true, definition: 'native-target-tables-v1', NPCIDs: [...targetNPCIDs],
          reportCode: candidate.code, fightID: fight.id, startTime: fight.startTime, endTime: fight.endTime,
          tables: usefulIDs.map((targetID, index) => ({ targetID, entries: tables[index]?.data?.entries,
            binding: { code: candidate.code, fightID: fight.id, startTime: fight.startTime, endTime: fight.endTime,
              dataType: 'DamageDone', targetID, viewBy: 'Source', complete: Array.isArray(tables[index]?.data?.entries) } })) };
      } else if (tables.every((t) => Array.isArray(t?.data?.entries) && t.data.entries.every((e) => playerID(e?.id) && finite(e.total))
        && unique(t.data.entries.map((e) => e.id)))) {
        useful = new Map(roster.map((p) => [p.id, 0]));
        for (const t of tables) for (const e of t.data.entries) if (useful.has(e.id)) useful.set(e.id, useful.get(e.id) + e.total);
      }
    }
    input.useful = useful; input.usefulScope = usefulScope;
    if (statistical) onProgress({ stage: 'targets', input });
    if (statistical && targetsFirst) await collectStreams();
    return statistical ? normalizeStatisticsFight(input, { rules: statisticsRules }) : normalizeFight(input);
  }
}

export function normalizeStatisticsFight(input, options = {}) {
  const { scope, candidate, fight, rep, roster } = input;
  if (!/^[a-zA-Z0-9]{16}$/.test(candidate?.code) || candidate.fightID !== fight?.id) throw new SourceError('Mismatched statistics fight identity', 'identity');
  validateFight(scope, fight, rep, { allowWipes: true });
  validateRoster(roster, fight, rep.masterData?.actors);
  return measureStatisticsFight({ ...input, output: statisticsOutput(input.output) }, options);
}

export function normalizeFight({ scope, candidate, fight, rep, roster, output, useful, streams: inputStreams, catalog }) {
  validateFight(scope, fight, rep); validateRoster(roster, fight, rep.masterData?.actors); validateOutput(output);
  const start = fight.startTime, durationSec = (fight.endTime - start) / 1000, time = (e) => (e.timestamp - start) / 1000;
  const actorList = rep.masterData.actors, actors = new Map(actorList.map((a) => [a.id, a]));
  const abilities = new Map((rep.masterData.abilities ?? []).filter((a) => abilityKey(a?.gameID)).map((a) => [a.gameID, a.name]));
  const owner = new Map(actorList.map((a) => [a.id, resolvePlayerRoot(actors, a.id, fight.friendlyPlayers)]));
  const streams = {}, reasons = [], invalid = new Set(), invalidReasons = [];
  for (const { name } of REQUIRED_STREAMS) {
    const s = inputStreams?.[name], check = validateStream(s, name, candidate.code, fight);
    streams[name] = check.valid ? { ...s } : { ...s, state: !s || s.state === 'missing' ? 'missing' : 'incomplete', events: Array.isArray(s?.events) ? s.events : [], reason: s?.reason ?? check.reason };
    if (!check.valid) reasons.push(streams[name].reason);
  }
  const bad = (name, reason) => { invalid.add(name); invalidReasons.push(`${name}: ${reason}`); };
  const state = (name) => invalid.has(name) ? 'incomplete' : streams[name].state;
  const measurements = new Map(roster.map((p) => [p.id, { incoming: 0, count: 0, classified: 0, classifiedCount: 0, mitigated: 0, absorbed: 0,
    health: 0, effective: 0, consumed: 0, excluded: 0, repairAmbiguous: false, ownHarmObserved: false, deaths: [], pi: false, external: new Set() }]));
  const ruleFor = (id) => { const rules = catalog.mechanics.filter((r) => r.abilityIDs?.includes(id)); return rules.length === 1 ? rules[0] : null; };
  const combatants = new Map();
  for (const p of roster) {
    const entries = streams.CombatantInfo.events.filter((e) => e.type === 'combatantinfo' && e.sourceID === p.id);
    const ci = entries.length === 1 ? entries[0] : null;
    if (!ci || !playerID(ci.specID) || !Array.isArray(ci.talentTree) || !Array.isArray(ci.auras)
      || ci.talentTree.some((t) => !playerID(t?.id) || !finite(t.rank) || t.nodeID != null && !finite(t.nodeID))
      || ci.auras.some((a) => !abilityKey(a?.ability) || !metadataID(a.source))) bad('CombatantInfo', 'missing, duplicate or invalid fight-specific talents/initial auras');
    else combatants.set(p.id, ci);
  }
  const timeline = [...streams.DamageTaken.events.map((event) => ({ event, stream: 'DamageTaken' })),
    ...streams.Healing.events.map((event) => ({ event, stream: 'Healing' }))].sort((a, b) => a.event.timestamp - b.event.timestamp || Number(b.stream === 'DamageTaken') - Number(a.stream === 'DamageTaken'));
  for (const { event: e, stream } of timeline) {
    const target = measurements.get(e.targetID), sourceID = owner.get(e.sourceID), source = measurements.get(sourceID);
    if (stream === 'DamageTaken' && e.type === 'damage' && target) {
      if (!finite(e.amount) || !abilityKey(e.abilityGameID) || !actors.has(e.sourceID)
        || ['absorbed', 'mitigated', 'unmitigatedAmount', 'maxHitPoints'].some((k) => e[k] != null && !finite(e[k]))) {
        bad('DamageTaken', 'invalid incoming measurement'); bad('Healing', 'self-repair attribution depends on invalid damage'); continue;
      }
      const rule = ruleFor(e.abilityGameID), category = rule?.category ?? 'unknown';
      target.incoming += e.amount; target.count++; target.health = Math.max(target.health, e.maxHitPoints ?? 0);
      target.mitigated = finite(e.mitigated) && target.mitigated !== null ? target.mitigated + e.mitigated : null;
      target.absorbed = finite(e.absorbed) && target.absorbed !== null ? target.absorbed + e.absorbed : null;
      if (category !== 'unknown') { target.classified += e.amount; target.classifiedCount++; }
      if (e.amount > 0 && (category === 'avoidable' || category === 'unknown' || sourceID === e.targetID)) target.ownHarmObserved = true;
    } else if (stream === 'Healing' && ['heal', 'absorbed'].includes(e.type)) {
      if (target && sourceID == null) bad('Healing', 'healing source/pet ownership is unresolved');
      if (source && !target) bad('Healing', 'own-source healing target is not a verified raid participant');
      if ((source || target) && (!finite(e.amount) || !metadataID(e.sourceID) || !playerID(e.targetID) || !effectKey(e.abilityGameID)
        || e.type === 'absorbed' && (!effectKey(e.extraAbilityGameID) || !actors.has(e.attackerID)))) {
        bad('Healing', 'invalid healing/consumed-shield attribution'); continue;
      }
      if (!source || !target) continue;
      if (e.type === 'heal') {
        source.effective += e.amount; // amount is effective healing; overheal is never added.
        if (sourceID === e.targetID && target.ownHarmObserved && e.amount > 0) source.repairAmbiguous = true;
      } else {
        source.consumed += e.amount;
        if (sourceID === e.targetID) {
          const cause = ruleFor(e.extraAbilityGameID), attackerOwner = owner.get(e.attackerID);
          if (cause?.category === 'avoidable' || attackerOwner === e.targetID) source.excluded += e.amount;
          else if (!cause || !['unavoidable', 'neutral'].includes(cause.category)) source.repairAmbiguous = true;
        }
      }
    }
  }
  const absorptionGroups = new Map();
  for (const e of streams.DamageTaken.events) if (e.type === 'damage' && measurements.has(e.targetID) && finite(e.absorbed) && e.absorbed > 0) {
    const key = `${e.timestamp}:${e.sourceID}:${e.targetID}:${e.abilityGameID}`;
    absorptionGroups.set(key, (absorptionGroups.get(key) ?? 0) + e.absorbed);
  }
  const unresolvedAbsorption = [...absorptionGroups].some(([key, amount]) => {
    const native = streams.Healing.events.filter((e) => e.type === 'absorbed' && `${e.timestamp}:${e.attackerID}:${e.targetID}:${e.extraAbilityGameID}` === key);
    return !native.length || native.some((e) => !finite(e.amount) || !effectKey(e.abilityGameID) || owner.get(e.sourceID) == null)
      || native.reduce((sum, e) => sum + e.amount, 0) !== amount;
  });
  for (const e of streams.Deaths.events) if (e.type === 'death') {
    if (!playerID(e.targetID)) bad('Deaths', 'invalid death target identity');
    else if (measurements.has(e.targetID)) measurements.get(e.targetID).deaths.push({ time: time(e), name: 'Death' });
  }
  const receive = (m, source, targetID, abilityID, name) => {
    if (owner.get(source) == null) { bad(name, 'received support ownership is unresolved'); return; }
    if (abilityID === 10060) m.pi = true;
    if (owner.get(source) !== targetID && catalog.defenses.some((d) => d.abilityIDs.includes(abilityID))) m.external.add(abilityID);
  };
  for (const [id, ci] of combatants) for (const a of ci.auras) if (a.ability === 10060 || catalog.defenses.some((d) => d.abilityIDs.includes(a.ability))) receive(measurements.get(id), a.source, id, a.ability, 'CombatantInfo');
  for (const e of streams.Buffs.events) {
    const m = measurements.get(e.targetID);
    if (!m || !['applybuff', 'refreshbuff', 'removebuff'].includes(e.type)) continue;
    if (!abilityKey(e.abilityGameID)) { bad('Buffs', 'received buff ability is unresolved'); continue; }
    if (e.abilityGameID === 10060 || catalog.defenses.some((d) => d.abilityIDs.includes(e.abilityGameID))) {
      if (e.type !== 'removebuff') receive(m, e.sourceID, e.targetID, e.abilityGameID, 'Buffs');
      else if (owner.get(e.sourceID) == null) bad('Buffs', 'received aura removal ownership is unresolved');
    }
  }
  for (const name of invalid) streams[name] = { ...streams[name], state: 'incomplete' };
  let usage = buildDefensiveIntervals({ defenses: catalog.defenses, fight, code: candidate.code, streams, actors: actorList });
  if (usage.state !== 'known' && state('Buffs') === 'known' && state('CombatantInfo') === 'known') {
    bad('Buffs', usage.reasons[0]); streams.Buffs = { ...streams.Buffs, state: 'incomplete' };
    usage = { ...usage, state: 'incomplete' };
  }
  const provenance = provenanceFor(rep, candidate.code, fight);
  const sourceProof = { version: ANALYTICAL_VERSION, adapterVersion: ADAPTER_VERSION, catalogVersion: catalog.version,
    opportunityVersion: OPPORTUNITY_VERSION, contextVersion: CONTEXT_VERSION, benefitVersion: BENEFIT_VERSION,
    scope: { zone: scope.zone, encounter: scope.encounter, difficulty: scope.difficulty, size: fight.size, partition: scope.partition, patch: scope.patch },
    provenance, tuning: catalog.tuningFor(provenance, fight), roster: { state: 'known', expectedPlayers: fight.size, actorIDs: roster.map((p) => p.id).sort((a, b) => a - b) },
    streams: streamReceipts(streams, candidate.code, fight) };
  const normalizedFight = { encounter: scope.encounter, difficulty: scope.difficulty, size: fight.size, startTime: fight.startTime,
    endTime: fight.endTime, durationSec, kill: true };
  const emptyLedger = (version, reason) => ({ version, state: 'unsupported', records: [], reasons: [reason] });
  return roster.map((p) => {
    const m = measurements.get(p.id), ci = state('CombatantInfo') === 'known' ? combatants.get(p.id) : null, hero = ci ? catalog.identifyHero(p, ci) : null;
    const identity = { code: candidate.code, fightID: fight.id, actorID: p.id, name: p.name, server: p.server, region: p.region,
      className: p.className, spec: p.spec, role: p.role, hero: hero?.name ?? null, heroEvidence: hero?.evidence ?? null, verified: !!hero && !!ci };
    const supportKnown = ['Buffs', 'CombatantInfo'].every((name) => state(name) === 'known') && !!ci;
    const support = { pi: supportKnown ? m.pi : null, externals: supportKnown ? [...m.external].sort((a, b) => a - b) : null };
    const build = (rules) => buildOpportunityLedger({ rules, actorID: p.id, fight, code: candidate.code, streams, actors: actorList });
    let avoidanceLedger = catalog.criticalReviewed ? build(catalog.objectiveRules.filter((r) => r.components?.includes('avoidance'))) : emptyLedger(OPPORTUNITY_VERSION, 'Critical objective rules are unreviewed');
    const defenseLedger = catalog.dangersReviewed ? build(catalog.objectiveRules.filter((r) => r.components?.includes('defenses'))) : emptyLedger(OPPORTUNITY_VERSION, 'Defensive objective rules are unreviewed');
    const allOpportunities = build(catalog.objectiveRules);
    const incidents = [];
    if (known(avoidanceLedger)) {
      const linked = new Set();
      for (const o of avoidanceLedger.records) if (o.outcome.result === 'fail') for (const ref of o.outcome.evidenceRefs) if (ref.stream === 'DamageTaken' && Number.isSafeInteger(ref.index)) {
        const e = streams.DamageTaken.events[ref.index], mechanic = ruleFor(e.abilityGameID);
        if (mechanic?.category !== 'avoidable') { avoidanceLedger = emptyLedger(OPPORTUNITY_VERSION, 'Objective damage category is unreviewed'); break; }
        linked.add(ref.index); incidents.push({ opportunityID: o.id, time: time(e), abilityID: e.abilityGameID,
          name: abilities.get(e.abilityGameID) ?? mechanic.name, amount: e.amount, category: 'avoidable' });
      }
      if (streams.DamageTaken.events.some((e, index) => e.type === 'damage' && e.targetID === p.id && ruleFor(e.abilityGameID)?.category === 'avoidable' && !linked.has(index)))
        avoidanceLedger = emptyLedger(OPPORTUNITY_VERSION, 'Avoidable contact has no independent objective episode');
    }
    const inspectionCandidate = { identity, fight: normalizedFight, sourceProof, facts: { defenses: { opportunityLedger: defenseLedger } } };
    const avoided = inspectOpportunityLedger(avoidanceLedger, inspectionCandidate), defended = inspectOpportunityLedger(defenseLedger, inspectionCandidate);
    const benefitLedger = catalog.defensesReviewed ? buildBenefitLedger({ rules: catalog.benefitRules, opportunityRules: catalog.objectiveRules.filter((r) => r.components?.includes('defenses')),
      defenses: catalog.defenses, player: p, combatant: ci, opportunityLedger: defenseLedger, fight, code: candidate.code, streams, actors: actorList })
      : emptyLedger(BENEFIT_VERSION, 'Actual defensive benefit rules are unreviewed');
    const benefit = inspectBenefitLedger(benefitLedger, defended, inspectionCandidate);
    const context = catalog.contextFor({ player: p, combatant: ci, fight, pi: support.pi, externals: support.externals,
      sourceProof, opportunityLedger: allOpportunities, streams, code: candidate.code });
    const out = output.find((e) => e.id === p.id), healingKnown = state('Healing') === 'known' && state('DamageTaken') === 'known' && catalog.criticalReviewed && !m.repairAmbiguous && !unresolvedAbsorption;
    const result = { identity, fight: normalizedFight, sourceProof, context, support,
      coverage: { complete: sourceProof.streams.every(known) && !!ci && known(provenance),
        classificationAmount: state('DamageTaken') === 'known' ? m.incoming ? m.classified / m.incoming : 1 : null,
        classificationCount: state('DamageTaken') === 'known' ? m.count ? m.classifiedCount / m.count : 1 : null,
        critical: catalog.criticalReviewed, uncertainty: !catalog.criticalReviewed || invalid.size > 0 || !known(provenance) || !context.verified || !avoided.valid || !benefit.valid || m.repairAmbiguous || unresolvedAbsorption,
        reasons: [...new Set([...reasons, ...invalidReasons, ...catalog.reasons, ...(provenance.reasons ?? []), ...(sourceProof.tuning.reasons ?? []), ...context.reasons,
          ...(avoidanceLedger.reasons ?? []), ...(defenseLedger.reasons ?? []), ...(benefitLedger.reasons ?? []),
          ...(m.repairAmbiguous ? ['Self-repair usefulness cannot be attributed without allocating ambiguous health deficits'] : []),
          ...(unresolvedAbsorption ? ['Consumed-shield provider attribution is unavailable for incoming absorption'] : [])])] },
      facts: {
        participationRatio: finite(out?.activeTime) ? Math.min(1, out.activeTime / (durationSec * 1000)) : null,
        deaths: { state: state('Deaths'), events: m.deaths },
        incoming: { state: state('DamageTaken'), total: m.incoming, eventCount: m.count, mitigated: m.mitigated, absorbed: m.absorbed, maxHealth: m.health || null },
        avoidance: { state: avoidanceLedger.state, total: avoided.valid ? incidents.reduce((sum, i) => sum + i.amount, 0) : null,
          incidents: avoided.valid ? incidents : [], opportunityLedger: avoidanceLedger, opportunities: avoided.opportunities, failedOpportunityIDs: avoided.failedOpportunityIDs },
        defenses: { state: benefit.valid ? 'known' : benefitLedger.state === 'known' ? 'unsupported' : benefitLedger.state,
          opportunityLedger: defenseLedger, benefitLedger, covered: benefit.covered, coveredOpportunityIDs: benefit.coveredOpportunityIDs,
          opportunities: defended.opportunities, intervals: usage.intervals.get(p.id) ?? [] },
        output: { state: useful?.has(p.id) && finite(useful.get(p.id)) && finite(out?.total) ? 'known' : 'unsupported', usefulDamage: useful?.get(p.id) ?? null, allDamage: finite(out?.total) ? out.total : null },
        healing: { state: state('Healing'), effective: m.effective, consumed: m.consumed, selfRepairExcluded: m.repairAmbiguous || unresolvedAbsorption ? null : m.excluded,
          useful: healingKnown ? Math.max(0, m.effective + m.consumed - m.excluded) : null },
        interrupts: { state: state('Interrupts'), successes: streams.Interrupts.events.filter((e) => e.type === 'interrupt' && owner.get(e.sourceID) === p.id
          && abilityKey(e.abilityGameID) && abilityKey(e.extraAbilityGameID)).map((e) => ({ time: time(e), sourceID: p.id, targetID: e.targetID, abilityID: e.abilityGameID, causeAbilityID: e.extraAbilityGameID })) },
      } };
    if (!validateSourceProof(result)) result.coverage.uncertainty = true;
    if (context.verified && !validateObjectiveContext(result)) { context.verified = false; context.key = null; result.coverage.uncertainty = true; context.reasons.push('Objective context binding failed validation'); }
    return result;
  });
}

export function resolveActor(candidates, { actorID, name, server, region }) {
  const matches = candidates.filter(({ identity: i }) => (actorID == null || i.actorID === actorID) && norm(i.name) === norm(name) && norm(i.server) === norm(server) && (!region || norm(i.region) === norm(region)));
  if (matches.length !== 1) throw new SourceError('Player identity is missing or ambiguous in this fight', 'identity');
  return matches[0];
}
