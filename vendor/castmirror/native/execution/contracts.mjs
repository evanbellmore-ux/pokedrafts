// Versioned observable facts. Review approval never substitutes for event evidence.
export const ANALYTICAL_VERSION = 'execution-observable-2';
export const ADAPTER_VERSION = 'wcl-execution-3';
export const OPPORTUNITY_VERSION = 'objective-opportunity-1';
export const CONTEXT_VERSION = 'objective-context-1';
export const BENEFIT_VERSION = 'defensive-benefit-1';
export const PARTICIPATION_VERSION = 'damage-active-time-v1';
export const REQUIRED_STREAMS = Object.freeze([
  ['CombatantInfo', 'CombatantInfo', 'Friendlies'], ['Debuffs', 'Debuffs', 'Friendlies'],
  ['Casts', 'Casts', 'Friendlies'], ['EnemyCasts', 'Casts', 'Enemies'],
  ['Interrupts', 'Interrupts', 'Friendlies'], ['DamageTaken', 'DamageTaken', 'Friendlies'],
  ['Deaths', 'Deaths', 'Friendlies'], ['Buffs', 'Buffs', 'Friendlies'], ['Healing', 'Healing', 'Friendlies'],
].map(([name, dataType, hostilityType]) => Object.freeze({ name, dataType, hostilityType })));
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
export const playerID = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647;
export const metadataID = (v) => Number.isSafeInteger(v) && v >= -2_147_483_648 && v <= 2_147_483_647;
export const abilityKey = (v) => typeof v === 'number' && Number.isFinite(v);
export const effectKey = (v) => abilityKey(v) && v > 0;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = (items) => new Set(items).size === items.length;
const known = (v) => v?.state === 'known';

export function streamBinding(name, code, fight, paginationComplete = false) {
  const definition = REQUIRED_STREAMS.find((s) => s.name === name);
  if (!definition) throw new TypeError('Unknown Execution stream');
  return { ...definition, code, fightID: fight.id, startTime: fight.startTime, endTime: fight.endTime, paginationComplete };
}

export function validateStream(stream, name, code, fight) {
  const expected = streamBinding(name, code, fight, true), b = stream?.binding;
  const valid = known(stream) && Array.isArray(stream.events) && integer(stream.pages) && stream.pages >= 1 && stream.pages <= 20
    && record(b) && Object.keys(expected).every((k) => b[k] === expected[k])
    && stream.events.length <= 1_000_000 && stream.events.every((e) => record(e) && finite(e.timestamp)
      && e.timestamp >= fight.startTime && e.timestamp <= fight.endTime && e.fight === fight.id);
  return { valid, reason: valid ? null : `${name}: incomplete or unverified stream binding` };
}

export function streamReceipts(streams, code, fight) {
  return REQUIRED_STREAMS.map(({ name }) => {
    const s = streams?.[name], check = validateStream(s, name, code, fight);
    return { ...streamBinding(name, code, fight, check.valid), state: check.valid ? 'known' : s?.state === 'missing' ? 'missing' : 'incomplete',
      pages: integer(s?.pages) ? s.pages : null, eventCount: Array.isArray(s?.events) ? s.events.length : null };
  });
}

export function contextKey(c) {
  return JSON.stringify([CONTEXT_VERSION, c.catalogVersion, c.tuningKey, c.role, c.size, c.durationBucket,
    c.gearBucket, c.pi, c.externals, c.exposureKey, c.healingDemand?.key ?? null]);
}

export function validateObjectiveContext(candidate) {
  const c = candidate?.context, p = candidate?.sourceProof;
  return record(c) && c.version === CONTEXT_VERSION && c.verified === true && text(c.key)
    && text(c.catalogVersion) && c.catalogVersion === p?.catalogVersion && text(c.tuningKey) && c.tuningKey === p?.tuning?.key
    && c.role === candidate.identity?.role && c.size === candidate.fight?.size
    && integer(c.durationBucket) && c.durationBucket === Math.floor(candidate.fight.durationSec / 20)
    && integer(c.gearBucket) && typeof c.pi === 'boolean' && c.pi === candidate.support?.pi
    && Array.isArray(c.externals) && c.externals.every(finite) && unique(c.externals)
    && same(c.externals, [...c.externals].sort((a, b) => a - b)) && same(c.externals, candidate.support?.externals)
    && text(c.exposureKey) && c.key === contextKey(c)
    && (String(c.role).toLowerCase() !== 'healer' || known(c.healingDemand) && c.healingDemand.method === 'logged-necessary-health-v1'
      && text(c.healingDemand.key) && validEvidenceRefs(c.healingDemand.evidenceRefs, p.streams)
      && c.healingDemand.evidenceRefs.some((ref) => ref.stream === 'DamageTaken' && integer(ref.index)));
}

export function validateSourceProof(candidate) {
  const p = candidate?.sourceProof, f = candidate?.fight, i = candidate?.identity, v = p?.provenance;
  if (!record(p) || p.version !== ANALYTICAL_VERSION || p.adapterVersion !== ADAPTER_VERSION || !text(p.catalogVersion)
    || p.opportunityVersion !== OPPORTUNITY_VERSION || p.contextVersion !== CONTEXT_VERSION || p.benefitVersion !== BENEFIT_VERSION
    || !record(f) || !playerID(i?.actorID) || !playerID(i?.fightID) || !text(i?.code)) return false;
  if (!known(v) || v.code !== i.code || !integer(v.revision) || !finite(v.reportStartTime) || !finite(v.reportEndTime)
    || v.reportEndTime < v.reportStartTime || !finite(f.startTime) || !finite(f.endTime) || f.endTime <= f.startTime
    || v.fightStartTime !== v.reportStartTime + f.startTime || v.fightEndTime !== v.reportStartTime + f.endTime
    || v.fightEndTime > v.reportEndTime || f.durationSec !== (f.endTime - f.startTime) / 1000) return false;
  const t = p.tuning;
  if (!known(t) || !text(t.key) || !finite(t.effectiveFrom) || t.effectiveFrom > v.fightStartTime
    || !(t.effectiveUntil === null || finite(t.effectiveUntil) && t.effectiveUntil >= v.fightEndTime)
    || !Array.isArray(t.evidenceRefs) || !t.evidenceRefs.length || !t.evidenceRefs.every(text)) return false;
  const scope = p.scope;
  if (!record(scope) || !playerID(scope.zone) || !playerID(scope.partition) || !text(scope.patch)
    || !playerID(f.encounter) || !playerID(f.difficulty) || !playerID(f.size)
    || scope.encounter !== f.encounter || scope.difficulty !== f.difficulty || scope.size !== f.size
    || t.encounter !== scope.encounter || t.difficulty !== scope.difficulty || t.size !== scope.size || t.partition !== scope.partition) return false;
  const r = p.roster;
  if (!known(r) || r.expectedPlayers !== f.size || !Array.isArray(r.actorIDs) || r.actorIDs.length !== f.size
    || !r.actorIDs.every(playerID) || !unique(r.actorIDs) || !r.actorIDs.includes(i.actorID)) return false;
  return Array.isArray(p.streams) && p.streams.length === REQUIRED_STREAMS.length && unique(p.streams.map((s) => s.name))
    && REQUIRED_STREAMS.every((definition) => {
      const s = p.streams.find((entry) => entry.name === definition.name);
      return known(s) && s.dataType === definition.dataType && s.hostilityType === definition.hostilityType
        && s.code === i.code && s.fightID === i.fightID && s.startTime === f.startTime && s.endTime === f.endTime
        && s.paginationComplete === true && integer(s.pages) && s.pages >= 1 && s.pages <= 20
        && integer(s.eventCount) && s.eventCount <= 1_000_000;
    });
}

export function validEvidenceRefs(refs, receipts, { anchor = false } = {}) {
  return Array.isArray(refs) && refs.length > 0 && refs.length <= 1_000_000 && refs.every((ref) => {
    if (!record(ref) || !text(ref.stream) || anchor && !['EnemyCasts', 'Debuffs'].includes(ref.stream)) return false;
    const s = receipts?.find((entry) => entry.name === ref.stream);
    return known(s) && s.paginationComplete === true && (integer(ref.index) && ref.index < s.eventCount
      || !anchor && ref.complete === true && ref.index === undefined);
  });
}

export function inspectOpportunityLedger(ledger, candidate) {
  const fail = (reason) => ({ valid: false, opportunities: null, failedOpportunityIDs: [], eligibleIDs: [], reasons: [reason] });
  if (!known(ledger) || ledger.version !== OPPORTUNITY_VERSION || !Array.isArray(ledger.records) || ledger.records.length > 1_000_000)
    return fail('objective_opportunities_unavailable');
  const ids = [], anchors = [], eligibleIDs = [], failedOpportunityIDs = [], receipts = candidate.sourceProof?.streams;
  for (const o of ledger.records) {
    if (!record(o) || !text(o.id) || !text(o.ruleID) || !text(o.ruleVersion) || o.unit !== 'mechanic-episode'
      || o.actorID !== candidate.identity?.actorID || !finite(o.start) || !finite(o.end) || o.end < o.start
      || o.end > candidate.fight?.durationSec || !validEvidenceRefs(o.anchorRefs, receipts, { anchor: true })
      || !known(o.eligibility) || typeof o.eligibility.eligible !== 'boolean'
      || !['raidwide', 'explicit-target'].includes(o.eligibility.basis) || !validEvidenceRefs(o.eligibility.evidenceRefs, receipts)
      || !known(o.outcome) || !['pass', 'fail', 'not-applicable'].includes(o.outcome.result)
      || !validEvidenceRefs(o.outcome.evidenceRefs, receipts)) return fail('objective_opportunity_or_outcome_invalid');
    if (o.eligibility.eligible && o.outcome.result === 'not-applicable' || !o.eligibility.eligible && o.outcome.result !== 'not-applicable')
      return fail('objective_eligibility_outcome_conflict');
    ids.push(o.id);
    anchors.push(JSON.stringify([o.ruleID, o.ruleVersion, o.actorID,
      o.anchorRefs.map((ref) => [ref.stream, ref.index]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
    if (o.eligibility.eligible) { eligibleIDs.push(o.id); if (o.outcome.result === 'fail') failedOpportunityIDs.push(o.id); }
  }
  if (!unique(ids) || !unique(anchors)) return fail('duplicate_objective_opportunity');
  return { valid: true, opportunities: eligibleIDs.length, eligibleIDs, failedOpportunityIDs, reasons: [] };
}

export function inspectBenefitLedger(ledger, opportunities, candidate) {
  const fail = (reason) => ({ valid: false, covered: null, coveredOpportunityIDs: [], reasons: [reason] });
  if (!opportunities.valid || !known(ledger) || ledger.version !== BENEFIT_VERSION || !Array.isArray(ledger.records)
    || ledger.records.length > 1_000_000) return fail('defensive_benefit_unavailable');
  const ids = [], covered = new Set(), nativeOpportunities = new Map();
  for (const b of ledger.records) {
    if (!record(b) || !text(b.id) || !opportunities.eligibleIDs.includes(b.opportunityID) || !text(b.ruleID) || !text(b.ruleVersion)
      || b.attribution !== 'source-native' || b.method !== 'wcl-consumed-shield-v1' || b.effectKind !== 'consumed-shield'
      || b.providerID !== candidate.identity?.actorID || b.targetID !== candidate.identity?.actorID
      || !finite(b.abilityID) || b.abilityID <= 0 || !finite(b.causeAbilityID) || b.causeAbilityID <= 0 || !finite(b.amount) || !finite(b.minimumBenefit) || b.minimumBenefit <= 0
      || !finite(b.time) || b.time > candidate.fight?.durationSec || !text(b.school)
      || !validEvidenceRefs(b.evidenceRefs, candidate.sourceProof?.streams)
      || !b.evidenceRefs.some((r) => r.stream === 'Healing' && integer(r.index))) return fail('defensive_benefit_attribution_invalid');
    const o = candidate.facts?.defenses?.opportunityLedger?.records?.find((entry) => entry.id === b.opportunityID);
    if (!o || b.opportunityRuleID !== o.ruleID || b.opportunityRuleVersion !== o.ruleVersion)
      return fail('defensive_benefit_rule_mismatch');
    if (b.time < o.start || b.time > o.end) return fail('defensive_benefit_outside_opportunity');
    for (const ref of b.evidenceRefs.filter((entry) => entry.stream === 'Healing' && integer(entry.index))) {
      if (nativeOpportunities.has(ref.index) && nativeOpportunities.get(ref.index) !== b.opportunityID)
        return fail('defensive_benefit_ambiguous_opportunity');
      nativeOpportunities.set(ref.index, b.opportunityID);
    }
    ids.push(b.id);
    if (b.amount >= b.minimumBenefit) covered.add(b.opportunityID);
  }
  if (!unique(ids)) return fail('duplicate_defensive_benefit');
  return { valid: true, covered: covered.size, coveredOpportunityIDs: [...covered].sort(), reasons: [] };
}

export function participationEvidence(candidate) {
  const measured = candidate?.facts?.participationRatio;
  return { version: PARTICIPATION_VERSION, method: 'DamageDone.activeTime/full-fight-ms',
    ratio: finite(measured) && measured <= 1 ? measured : null, threshold: 0.95,
    certifiesGeneralActivity: false, certifiesHealerParticipation: false,
    limitations: String(candidate?.identity?.role).toLowerCase() === 'healer' ? ['damage_active_time_cannot_certify_healer_participation'] : [] };
}
