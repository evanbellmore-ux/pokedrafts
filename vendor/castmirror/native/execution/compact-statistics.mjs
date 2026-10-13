// Pure native observation compaction, shared by local previews and live pools.
import { STATISTICS_VERSION, STATISTICS_COMPONENTS } from './statistics.mjs';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const scalars = (object, keys) => Object.fromEntries(keys.filter((k) => object && Object.hasOwn(object, k))
  .map((k) => [k, scalar(object[k]) ? object[k] : null]));
const list = (items, compact) => Array.isArray(items) ? items.map(compact) : null;

export function statisticsScope(scope) {
  if (!record(scope) || !['zone', 'encounter', 'difficulty'].every((key) => integer(scope[key], 1))) {
    throw new TypeError('Execution statistics previews require zone, encounter and difficulty IDs');
  }
  const compact = scalars(scope, ['zone', 'encounter', 'difficulty']);
  for (const key of ['size', 'partition']) {
    compact[key] = scope[key] ?? null;
    if (compact[key] !== null && !integer(compact[key])) throw new TypeError(`Invalid statistics ${key}`);
  }
  compact.patch = scope.patch ?? null;
  if (compact.patch !== null && !text(compact.patch)) throw new TypeError('Invalid statistics patch');
  return compact;
}

const statisticsStrings = (items) => Array.isArray(items) ? items.filter((value) => typeof value === 'string') : null;
const statisticsNumbers = (items) => list(items, (value) => finite(value) ? value : null);
const statisticsScalars = (object, keys) => Object.fromEntries(Object.entries(scalars(object, keys))
  .map(([key, value]) => [key, typeof value === 'number' && !finite(value) ? null : value]));
const STATISTICS_MEASUREMENTS = Object.freeze({
  avoidance: ['total', 'perSecond', 'hits', 'complete', 'basis', 'exposure'],
  survival: ['deathCount', 'firstDeathSec', 'firstDeathFraction', 'firstLifeSec', 'aliveTimeSec', 'complete', 'basis'],
  incoming: ['total', 'perSecond', 'eventCount', 'absorbed', 'mitigated', 'complete', 'basis', 'exposure'],
  defenses: ['rawUses', 'boundedUses', 'boundedUsesPerMinute', 'rejectedCount', 'complete', 'basis'],
  output: ['usefulDamage', 'usefulDamagePerSecond', 'allDamage', 'allDamagePerSecond', 'paddingDamage', 'unknownDamage', 'complete', 'basis', 'source', 'filterExpression'],
  healing: ['effective', 'consumed', 'total', 'perSecond', 'overheal', 'selfEffective', 'otherEffective', 'selfConsumed',
    'otherConsumed', 'self', 'other', 'petRecipient', 'selfDefinition', 'eventCount', 'complete', 'basis'],
});
function statisticsDefenseAbility(ability, definitionOnly = false) {
  if (!record(ability)) return null;
  const compact = { ...statisticsScalars(ability, definitionOnly ? ['minIntervalSec', 'charges', 'maxUsesPerFight', 'targetPolicy', 'className']
    : ['name', 'minIntervalSec', 'charges', 'maxUsesPerFight', 'targetPolicy', 'className', 'allowedCount', 'rawUses', 'boundedUses',
      'ignoredBeginOrAuraEvents', 'nonPersonalCasts', 'supported']), abilityIDs: statisticsNumbers(ability.abilityIDs),
    ...(ability.specs === undefined ? {} : { specs: statisticsStrings(ability.specs) }) };
  if (!definitionOnly) {
    // These are reduced usage/cap measurements, not raw cast event payloads.
    compact.accepted = list(ability.accepted, (use) => record(use) ? statisticsScalars(use, ['time', 'abilityID']) : null);
    compact.rejected = list(ability.rejected, (use) => record(use) ? statisticsScalars(use, ['time', 'abilityID', 'reason']) : null);
  }
  return compact;
}
function statisticsComponent(component, name) {
  if (!record(component) || !['known', 'incomplete', 'unsupported', 'missing'].includes(component.state) ||
      !(component.value === null || finite(component.value) && component.value >= 0) ||
      !record(component.measurements) || !record(component.definition) ||
      !['higher', 'lower', null].includes(component.direction) || typeof component.scoreEligible !== 'boolean') {
    throw new TypeError(`Invalid statistics ${name} component measurements`);
  }
  const measurements = statisticsScalars(component.measurements, STATISTICS_MEASUREMENTS[name]);
  const definition = statisticsScalars(component.definition, ['id', 'unit', 'rulesVersion',
    ...(name === 'survival' ? ['tieBreak'] : []), ...(name === 'incoming' ? ['direction', 'directionReason'] : []),
    ...(name === 'healing' ? ['self'] : []), ...(name === 'output' ? ['filterExpression', 'targets'] : [])]);
  if (name === 'avoidance') {
    definition.abilityIDs = statisticsNumbers(component.definition.abilityIDs);
    measurements.incidents = list(component.measurements.incidents, (incident) => record(incident)
      ? statisticsScalars(incident, ['time', 'abilityID', 'amount', 'absorbed', 'mitigated']) : null);
  } else if (name === 'survival') measurements.deathTimes = statisticsNumbers(component.measurements.deathTimes);
  else if (name === 'defenses') {
    measurements.abilities = list(component.measurements.abilities, (ability) => statisticsDefenseAbility(ability));
    definition.abilities = list(component.definition.abilities, (ability) => statisticsDefenseAbility(ability, true));
  } else if (name === 'output') {
    if (component.definition.id !== 'native-boss-damage-per-fight-second-v1') {
      definition.targetNPCIDs = statisticsNumbers(component.definition.targetNPCIDs);
    }
    for (const key of ['usefulTargetNPCIDs', 'paddingTargetNPCIDs']) measurements[key] = statisticsNumbers(component.measurements[key]);
  }
  return { ...statisticsScalars(component, ['state', 'value', 'direction', 'scoreEligible']),
    measurements, definition, limitations: statisticsStrings(component.limitations) ?? [], score: null };
}
export function compactStatisticsObservation(observation) {
  if (!record(observation) || observation.version !== STATISTICS_VERSION) {
    throw new TypeError(`Execution v3 previews accept only observations with version ${STATISTICS_VERSION}`);
  }
  const i = observation.identity, f = observation.fight, p = observation.provenance;
  if (!record(i) || !/^[a-zA-Z0-9]{16}$/.test(i.code) || !integer(i.fightID, 1) || !integer(i.actorID, 1) || i.verified !== true ||
      !['name', 'server', 'region', 'className', 'spec'].every((key) => text(i[key])) ||
      !['dps', 'tank', 'healer'].includes(i.role)) throw new TypeError('Invalid execution statistics observation identity');
  const scope = statisticsScope(observation.scope);
  if (!record(f) || !['encounter', 'difficulty', 'size'].every((key) => integer(f[key], 1) && f[key] === scope[key]) ||
      typeof f.kill !== 'boolean' || !finite(f.startTime) || f.startTime < 0 || !finite(f.endTime) || f.endTime <= f.startTime ||
      !finite(f.durationSec) || f.durationSec <= 0 || f.durationSec !== (f.endTime - f.startTime) / 1000 || !record(observation.components)) {
    throw new TypeError('Execution statistics observations require basic fight/component measurements');
  }
  if (!record(p) || !['current-bound', 'legacy-declared'].includes(p.mode) ||
      (p.mode === 'legacy-declared' ? p.legacy !== true || p.authenticated !== false : p.legacy !== false || p.authenticated !== null)) {
    throw new TypeError('Statistics provenance must retain its current-bound or unauthenticated legacy-declared label');
  }
  const provenance = { ...statisticsScalars(p, ['mode', 'legacy', 'authenticated', 'label', 'code', 'revision', 'reportStartTime', 'reportEndTime']),
    streams: list(p.streams, (stream) => record(stream) ? { ...statisticsScalars(stream,
      ['name', 'state', 'complete', 'mode', 'pages', 'eventCount', 'observedEventCount', 'invalidEventCount']),
      reasons: statisticsStrings(stream.reasons) ?? [] } : null) };
  return { version: STATISTICS_VERSION,
    identity: statisticsScalars(i, ['code', 'fightID', 'actorID', 'name', 'server', 'region', 'className', 'spec', 'role', 'verified']),
    scope, fight: statisticsScalars(f, ['encounter', 'difficulty', 'size', 'startTime', 'endTime', 'durationSec', 'kill']),
    provenance, support: { ...statisticsScalars(observation.support, ['pi', 'state']),
      limitations: statisticsStrings(observation.support?.limitations) ?? [] },
    components: Object.fromEntries(STATISTICS_COMPONENTS.map((name) => [name, statisticsComponent(observation.components[name], name)])) };
}
