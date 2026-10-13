// Execution v3 measures native combat statistics, not duties, opportunities or benefit.
import { playerID, metadataID, validateStream, REQUIRED_STREAMS } from './contracts.mjs';
import { resolvePlayerRoot } from './effects.mjs';

export const STATISTICS_VERSION = 'execution-statistical-3';
// WCL Pins documents actor.class = boss; this is a native provider filter, not name matching.
export const NATIVE_BOSS_FILTER = 'target.class = "boss"';
export const STATISTICS_COMPONENTS = Object.freeze(['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing']);
export const STATISTICS_WEIGHTS = Object.freeze({
  dps: Object.freeze({ avoidance: 30, survival: 15, incoming: 10, defenses: 20, output: 20, healing: 5 }),
  tank: Object.freeze({ avoidance: 20, survival: 15, incoming: 10, defenses: 35, output: 15, healing: 5 }),
  healer: Object.freeze({ avoidance: 20, survival: 15, incoming: 10, defenses: 15, output: 5, healing: 35 }),
});

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => amount(v) && v > 0;
const codeID = (v) => typeof v === 'string' && /^[A-Za-z0-9]{16}$/.test(v);
const norm = (v) => v.trim().toLowerCase().replace(/[\s-]+/g, '');
const unique = (v) => new Set(v).size === v.length;
const idList = (v) => Array.isArray(v) && v.length > 0 && v.every(playerID) && unique(v);
const sorted = (v) => [...v].sort((a, b) => a - b);
const sameSet = (a, b) => idList(a) && idList(b) && a.length === b.length && a.every((v) => b.includes(v));
const spell = (v) => typeof v === 'number' && Number.isFinite(v);
const effect = (v) => spell(v) && v > 0;
const effectList = (v) => Array.isArray(v) && v.length > 0 && v.every(effect) && unique(v);
const finiteSum = (values) => { const total = values.reduce((sum, v) => sum + v, 0); return amount(total) ? total : null; };
const rate = (v, duration) => amount(v) && positive(duration) && amount(v / duration) ? v / duration : null;
const dedup = (v) => [...new Set(v)];
const canonical = (v) => JSON.stringify(stable(v));
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
function fail(message, kind = 'invalid') { throw Object.assign(new TypeError(message), { kind }); }
function basicInput(input) {
  if (!object(input)) fail('Statistics input must be an object');
  const { scope, candidate, fight, rep, roster } = input;
  if (!object(scope) || !object(fight) || !object(rep) || !codeID(candidate?.code) || candidate.fightID !== fight.id
    || !playerID(fight.id) || !playerID(fight.encounterID) || !playerID(fight.difficulty) || !playerID(fight.size)
    || typeof fight.kill !== 'boolean' || !amount(fight.startTime) || !amount(fight.endTime) || fight.endTime <= fight.startTime
    || !positive((fight.endTime - fight.startTime) / 1000) || scope.encounter !== fight.encounterID || scope.difficulty !== fight.difficulty
    || !playerID(scope.zone) || rep.zone?.id !== scope.zone || !count(scope.size) || scope.size !== 0 && scope.size !== fight.size
    || !idList(fight.friendlyPlayers) || fight.friendlyPlayers.length !== fight.size) fail('Invalid statistics fight, duration or report identity');
  if (rep.code !== undefined && rep.code !== candidate.code) fail('Statistics report code disagrees with the selected report');
  const actors = rep.masterData?.actors;
  if (!Array.isArray(actors) || !actors.length || actors.some((a) => !object(a) || !metadataID(a.id)) || !unique(actors.map((a) => a.id)))
    fail('Missing or duplicate statistics actor metadata', 'identity');
  if (!Array.isArray(roster) || roster.length !== fight.size || !unique(roster.map((p) => p?.id))) fail('Invalid statistics roster', 'identity');
  const byID = new Map(actors.map((a) => [a.id, a]));
  for (const p of roster) {
    const a = byID.get(p?.id);
    if (!playerID(p?.id) || !fight.friendlyPlayers.includes(p.id) || a?.type !== 'Player' || a.petOwner != null && a.petOwner !== 0
      || ![p.name, p.server, p.region, p.className, p.spec, a.name, a.server, a.subType].every(text)
      || norm(a.name) !== norm(p.name) || norm(a.server) !== norm(p.server) || a.subType !== p.className
      || !Object.hasOwn(STATISTICS_WEIGHTS, p.role)) fail('Unverified statistics player identity', 'identity');
    if (p.specs !== undefined && (!Array.isArray(p.specs) || p.specs.some((s) => !text(s?.spec) || !amount(s.count))
      || p.specs.filter((s) => s.count > 0).length !== 1 || p.specs.find((s) => s.count > 0)?.spec !== p.spec))
      fail('Mismatched fight specialization', 'identity');
  }
  return { byID, duration: (fight.endTime - fight.startTime) / 1000 };
}

function inFight(e, fight) {
  return object(e) && amount(e.timestamp) && e.timestamp >= fight.startTime && e.timestamp <= fight.endTime && e.fight === fight.id;
}
function streamView(stream, name, code, fight, legacy) {
  const check = validateStream(stream, name, code, fight);
  const events = Array.isArray(stream?.events) ? stream.events : [];
  const legacyDeclared = legacy && stream?.binding === undefined && stream?.state === 'known'
    && count(stream.pages) && stream.pages > 0 && stream.pages <= 20 && events.length <= 1_000_000;
  const legacyComplete = legacyDeclared && events.every((e) => inFight(e, fight));
  const b = stream?.binding;
  // Incomplete pagination can retain bound, valid records. A foreign binding cannot.
  const bound = object(b) && b.name === name && b.code === code && b.fightID === fight.id
    && b.startTime === fight.startTime && b.endTime === fight.endTime
    && b.dataType === REQUIRED_STREAMS.find((s) => s.name === name)?.dataType
    && b.hostilityType === REQUIRED_STREAMS.find((s) => s.name === name)?.hostilityType;
  const trusted = check.valid || bound || legacyDeclared;
  const observed = trusted ? events.filter((e) => inFight(e, fight)) : [];
  return { name, complete: check.valid || legacyComplete, legacy: legacyDeclared, observed,
    state: check.valid || legacyComplete ? 'known' : !stream || stream.state === 'missing' ? 'missing' : 'incomplete',
    pages: count(stream?.pages) ? stream.pages : null, eventCount: events.length, observedEventCount: observed.length,
    invalidEventCount: trusted ? events.length - observed.length : events.length,
    reasons: check.valid || legacyComplete ? [] : [check.reason] };
}
function component(state, value, measurements, definition, direction, limitations = [], eligible = true) {
  const known = state === 'known' && value !== null;
  return { state: known ? 'known' : state === 'known' ? 'incomplete' : state, value: known ? value : null,
    measurements, definition, direction, scoreEligible: known && eligible && direction !== null,
    limitations: dedup(limitations), score: null };
}
function summaryState(view, invalid, observedCount) {
  return view.complete && !invalid ? 'known' : view.state === 'missing' && !observedCount ? 'missing' : 'incomplete';
}
function totalFields(view, invalid, records, duration, fields) {
  const state = summaryState(view, invalid, records.length), observed = view.complete || records.length > 0;
  const totals = Object.fromEntries(fields.map((k) => [k, observed ? finiteSum(records.map((r) => r[k])) : null]));
  if (Object.values(totals).some((v) => v === null) && observed) return { state: 'incomplete', totals, complete: false, basis: 'observed-lower-bound' };
  return { state, totals, complete: state === 'known', basis: state === 'known' ? 'complete-native-total' : observed ? 'observed-lower-bound' : 'unavailable' };
}

const personalTargetPolicies = ['self-target-required', 'inherently-personal', 'inherently-personal-npc-target'];
function defensiveScopeValid(r) {
  return (r.className === undefined || text(r.className)) && (r.specs === undefined || text(r.className)
    && Array.isArray(r.specs) && r.specs.length > 0 && r.specs.every(text) && unique(r.specs));
}
function defensiveScopeMatches(r, player) {
  return (r.className === undefined || r.className === player.className)
    && (r.specs === undefined || Array.isArray(r.specs) && r.specs.includes(player.spec));
}
function defensiveDefinition(r) {
  return { abilityIDs: sorted(r.abilityIDs), minIntervalSec: r.minIntervalSec, charges: r.charges,
    maxUsesPerFight: r.maxUsesPerFight, targetPolicy: r.targetPolicy,
    ...(r.className !== undefined ? { className: r.className } : {}),
    ...(r.specs !== undefined ? { specs: Array.isArray(r.specs) ? [...r.specs].sort() : r.specs } : {}) };
}
function defensiveRules(rules) {
  const list = rules.defensives;
  const recognizable = Array.isArray(list) ? list.filter((r) => object(r) && effectList(r.abilityIDs) && text(r.name)) : [];
  const supported = (r) => positive(r.minIntervalSec) && (r.maxUsesPerFight === undefined || playerID(r.maxUsesPerFight))
    && (r.charges === undefined || playerID(r.charges)) && defensiveScopeValid(r)
    && (r.targetPolicy === undefined || personalTargetPolicies.includes(r.targetPolicy));
  const aliases = recognizable.flatMap((r) => r.abilityIDs);
  const valid = recognizable.length > 0 && recognizable.length === list?.length && unique(aliases) && recognizable.every(supported);
  return { list: recognizable, valid, supported };
}
function measureDefenses(view, invalid, events, player, fight, rules, duration, byID) {
  const reviewed = defensiveRules(rules), applicable = reviewed.list.filter((r) => defensiveScopeMatches(r, player)), seen = new Set(), byRule = [];
  for (const r of applicable) {
    const matching = events.filter((e) => r.abilityIDs.includes(e.abilityGameID));
    // Only reviewed caster-personal buttons may retain an Environment/selected-NPC cast target.
    const isPersonal = (e) => e.sourceID === player.id && (e.targetID === player.id
      || ['inherently-personal', 'inherently-personal-npc-target'].includes(r.targetPolicy) && (e.targetID == null || e.targetID === 0)
      || r.targetPolicy === 'inherently-personal-npc-target' && byID.get(e.targetID)?.type === 'NPC' && !byID.get(e.targetID).petOwner);
    const personal = matching.filter(isPersonal);
    const completed = personal.filter((e) => e.type === 'cast');
    const supported = reviewed.supported(r), charges = r.charges ?? 1;
    const capacity = supported ? Math.min(r.maxUsesPerFight ?? Number.MAX_SAFE_INTEGER,
      charges + Math.floor(duration / r.minIntervalSec)) : null;
    const ready = supported ? Array.from({ length: Math.min(charges, completed.length + 1) }, () => -Infinity) : [];
    const accepted = [], rejected = [];
    let nextCharge = 0;
    for (const e of [...completed].sort((a, b) => a.timestamp - b.timestamp)) {
      const at = (e.timestamp - fight.startTime) / 1000, key = canonical([e.timestamp, e.sourceID, sorted(r.abilityIDs)]);
      if (seen.has(key)) { rejected.push({ time: at, abilityID: e.abilityGameID, reason: 'duplicate-completed-cast' }); continue; }
      seen.add(key);
      if (!supported) continue;
      if (accepted.length >= capacity) { rejected.push({ time: at, abilityID: e.abilityGameID, reason: 'fight-count-cap' }); continue; }
      if (at < ready[nextCharge]) { rejected.push({ time: at, abilityID: e.abilityGameID, reason: 'minimum-interval-cap' }); continue; }
      nextCharge++;
      ready.push(Math.max(at, ready.at(-1) ?? at) + r.minIntervalSec);
      accepted.push({ time: at, abilityID: e.abilityGameID });
    }
    byRule.push({ name: r.name, abilityIDs: sorted(r.abilityIDs), minIntervalSec: supported ? r.minIntervalSec : null,
      charges: supported ? charges : null, maxUsesPerFight: supported ? r.maxUsesPerFight ?? null : null,
      targetPolicy: r.targetPolicy ?? 'self-target-required', ...(r.className !== undefined ? { className: r.className } : {}),
      ...(r.specs !== undefined ? { specs: r.specs } : {}), allowedCount: capacity, rawUses: completed.length, boundedUses: supported ? accepted.length : null,
      ignoredBeginOrAuraEvents: personal.filter((e) => e.type !== 'cast').length,
      nonPersonalCasts: matching.filter((e) => e.type === 'cast' && !isPersonal(e)).length,
      accepted, rejected, supported });
  }
  const complete = view.complete && !invalid, observed = complete || byRule.some((r) => r.rawUses > 0);
  const rawUses = applicable.length && observed ? finiteSum(byRule.map((r) => r.rawUses)) : null;
  const valid = reviewed.valid && applicable.length > 0;
  const boundedUses = valid && observed ? finiteSum(byRule.map((r) => r.boundedUses)) : null;
  const rejectedCount = finiteSum(byRule.map((r) => r.rejected.length));
  const state = !valid ? 'unsupported' : summaryState(view, invalid, rawUses ?? 0);
  return component(state, boundedUses === null ? null : rate(boundedUses, duration / 60),
    { rawUses, boundedUses, boundedUsesPerMinute: boundedUses === null ? null : rate(boundedUses, duration / 60), rejectedCount,
      abilities: byRule, complete: state === 'known', basis: complete ? 'completed-personal-casts' : observed ? 'observed-lower-bound' : 'unavailable' },
    { id: 'bounded-personal-defensive-casts-per-minute-v1', unit: 'uses/minute', rulesVersion: text(rules.version) ? rules.version : null,
      abilities: byRule.map(defensiveDefinition).sort((a, b) => canonical(a).localeCompare(canonical(b))) }, 'higher',
    ['usage-is-not-proven-mitigation-effectiveness', 'reviewed-subset-not-all-personal-defensives', 'counting-caps-may-withhold-legitimate-reduced-or-reset-casts',
      ...(!reviewed.valid ? ['reviewed-ability-specific-caps-unavailable'] : []),
      ...(!applicable.length ? ['reviewed-personal-ability-list-unavailable-for-class-spec'] : []),
      ...(!complete ? ['completed-cast-source-incomplete'] : []), ...(rejectedCount > 0 ? ['rejected-duplicate-or-counting-cap-casts'] : [])]);
}

function bindingMatches(b, code, fight, targetID = undefined) {
  return object(b) && b.code === code && b.fightID === fight.id && b.startTime === fight.startTime && b.endTime === fight.endTime
    && b.dataType === 'DamageDone' && (targetID === undefined ? b.name === 'DamageDone' && b.hostilityType === 'Friendlies' : b.targetID === targetID && b.viewBy === 'Source');
}
function knownNonplayerDamageSource(sourceID, byID, rosterIDs) {
  const seen = new Set();
  let actor = byID.get(sourceID);
  while (actor) {
    if (!metadataID(actor.id) || seen.has(actor.id)) return false;
    seen.add(actor.id);
    if (actor.petOwner == null || actor.petOwner === 0) return actor.type === 'NPC'
      || actor.type === 'Player' && !rosterIDs.includes(actor.id);
    if (actor.type === 'Player' || !metadataID(actor.petOwner)) return false;
    actor = byID.get(actor.petOwner);
  }
  return false;
}

// Both overall and filtered tables use the same native ownership aggregation.
// Top-level pet rows are independent; nested pets are display breakdowns of
// their parent's total, never additional damage or name-based ownership proof.
function sourceTableTotals(entries, input, byID, roots) {
  const result = new Map(input.roster.map((p) => [p.id, { values: [], invalid: false }]));
  let complete = Array.isArray(entries) && entries.length <= 1_000_000;
  const rows = complete ? entries : [], counts = new Map(), nestedIDs = new Set(), nestedSources = new Set();
  for (const row of rows) {
    counts.set(row?.id, (counts.get(row?.id) ?? 0) + 1);
    const root = roots.get(row?.id);
    if (result.has(root) && Array.isArray(row?.pets)) for (const pet of row.pets) {
      if (metadataID(pet?.id) && pet.id !== row.id && roots.get(pet.id) === root) nestedSources.add(pet.id);
    }
  }
  if ([...counts.values()].some((n) => n > 1)) complete = false;
  for (const row of rows) {
    const id = row?.id, source = byID.get(id), root = roots.get(id);
    if (!metadataID(id) || !source) { complete = false; continue; }
    if (!result.has(root)) {
      if (!knownNonplayerDamageSource(id, byID, input.fight.friendlyPlayers)) complete = false;
      continue;
    }
    const m = result.get(root);
    if (counts.get(id) !== 1 || nestedSources.has(id) || !amount(row.total)) { m.invalid = true; continue; }
    m.values.push(row.total);
    if (!Array.isArray(row.pets)) continue;
    const breakdown = [];
    for (const pet of row.pets) {
      if (!object(pet)) { m.invalid = true; continue; }
      // Older native display breakdowns can be name-only. They are not counted
      // or resolved; an explicit actor ID must agree with verified ownership.
      if (Object.hasOwn(pet, 'id')) {
        const actor = byID.get(pet.id);
        if (!metadataID(pet.id) || !actor || actor.type === 'Player' || roots.get(pet.id) !== root
          || pet.id === id || counts.has(pet.id) || nestedIDs.has(pet.id)) m.invalid = true;
        nestedIDs.add(pet.id);
      }
      if (pet.total !== undefined) {
        if (!amount(pet.total)) m.invalid = true;
        else breakdown.push(pet.total);
      }
    }
    const petTotal = finiteSum(breakdown);
    if (petTotal === null || petTotal > row.total) m.invalid = true;
  }
  return { result, complete };
}
function overallDamageFor(table, playerID) {
  const m = table.result.get(playerID);
  return table.complete && !m.invalid && m.values.length > 0 ? finiteSum(m.values) : null;
}

// The collector supplies bound native target tables before pet-root aggregation.
// Explicitly bound Maps remain supported for earlier local statistical inputs.
function nativeDamage(input, byID, roots, usefulIDs, paddingIDs) {
  const { usefulScope: s, candidate, fight } = input;
  if (!object(s) || s.verified !== true) return null;
  const eventsMode = s.definition === 'native-target-events-v1' && Array.isArray(s.events);
  const tablesMode = s.definition === 'native-target-tables-v1' && Array.isArray(s.tables);
  if (!eventsMode && !tablesMode) return null;
  const result = new Map(input.roster.map((p) => [p.id, { useful: [], padding: [], unknown: [], all: [], invalid: false }]));
  let complete = true, globallyInvalid = false;
  const seenTargets = new Set(), invalidTargets = new Set();
  const add = (sourceID, targetID, value) => {
    const source = byID.get(sourceID), root = roots.get(sourceID), target = byID.get(targetID);
    if (!metadataID(sourceID) || !source) { globallyInvalid = true; return; }
    if (root == null) {
      if (knownNonplayerDamageSource(sourceID, byID, fight.friendlyPlayers)) return;
      globallyInvalid = true; return;
    }
    const m = result.get(root);
    if (!amount(value)) { m.invalid = true; return; }
    m.all.push(value);
    if (!metadataID(targetID) || target?.type !== 'NPC' || !playerID(target.gameID)) { m.unknown.push(value); m.invalid = true; return; }
    if (usefulIDs?.includes(target.gameID)) m.useful.push(value);
    else if (paddingIDs?.includes(target.gameID)) m.padding.push(value);
    else m.unknown.push(value);
  };
  if (eventsMode) {
    const bound = bindingMatches(s.binding, candidate.code, fight);
    const pages = count(s.pages) && s.pages > 0 && s.pages <= 20;
    complete = bound && pages && s.state === 'known' && s.binding.paginationComplete === true
      && s.events.length <= 1_000_000 && s.events.every((e) => inFight(e, fight));
    if (!bound) return { result, complete: false, globallyInvalid: true, mode: s.definition };
    for (const e of s.events) {
      if (!inFight(e, fight)) continue;
      if (!text(e.type)) { globallyInvalid = true; continue; }
      if (e.type === 'damage') {
        if (!spell(e.abilityGameID)) { const root = roots.get(e.sourceID); if (result.has(root)) result.get(root).invalid = true; else globallyInvalid = true; continue; }
        add(e.sourceID, e.targetID, e.amount);
      }
    }
  } else {
    if (!s.tables.length || s.tables.length > 1_000_000) complete = false;
    for (const t of s.tables) {
      const target = byID.get(t?.targetID), bound = bindingMatches(t?.binding, candidate.code, fight, t?.targetID);
      if (!metadataID(t?.targetID) || target?.type !== 'NPC' || !playerID(target.gameID) || seenTargets.has(t.targetID)) {
        globallyInvalid = true; continue;
      }
      seenTargets.add(t.targetID);
      if (!bound || t.binding.complete !== true || !Array.isArray(t.entries) || !unique(t.entries.map((e) => e?.id))) {
        invalidTargets.add(t.targetID); complete = false;
      }
      if (!bound || !Array.isArray(t.entries)) continue;
      const sources = sourceTableTotals(t.entries, input, byID, roots);
      if (!sources.complete) { invalidTargets.add(t.targetID); complete = false; }
      for (const [root, m] of sources.result) {
        if (m.invalid) result.get(root).invalid = true;
        if (m.values.length) add(root, t.targetID, finiteSum(m.values));
      }
    }
    // No missing target table is quietly interpreted as zero damage.
    for (const a of byID.values()) if (a.type === 'NPC' && usefulIDs?.includes(a.gameID) && (!seenTargets.has(a.id) || invalidTargets.has(a.id))) complete = false;
    if (![...seenTargets].some((id) => usefulIDs?.includes(byID.get(id)?.gameID))) complete = false;
  }
  const paddingComplete = eventsMode ? complete : complete && [...byID.values()].filter((a) => a.type === 'NPC' && paddingIDs?.includes(a.gameID))
    .every((a) => seenTargets.has(a.id) && !invalidTargets.has(a.id));
  return { result, complete, paddingComplete, globallyInvalid, mode: s.definition };
}
function measureNativeBossOutput(input, rules, byID, roots, duration, overall) {
  const table = input.bossOutput, binding = table?.binding;
  const bound = table?.definition === 'native-boss-filter-table-v1' && object(binding)
    && binding.code === input.candidate.code && binding.fightID === input.fight.id
    && binding.startTime === input.fight.startTime && binding.endTime === input.fight.endTime
    && binding.dataType === 'DamageDone' && binding.hostilityType === 'Friendlies'
    && binding.viewBy === 'Source' && binding.filterExpression === NATIVE_BOSS_FILTER;
  const entries = bound && Array.isArray(table.entries) ? table.entries : null;
  const totals = sourceTableTotals(entries, input, byID, roots);
  const complete = totals.complete && binding.complete === true;
  return new Map(input.roster.map((p) => {
    const allDamage = overallDamageFor(overall, p.id), m = totals.result.get(p.id);
    const usefulDamage = entries === null ? null : finiteSum(m.values);
    const valid = complete && !m.invalid && usefulDamage !== null && (allDamage === null || usefulDamage <= allDamage);
    const limitations = ['native-provider-boss-classification-not-a-duty-or-mechanic-score',
      'relevant-nonboss-adds-unclassified', 'padding-target-total-unavailable',
      ...(!valid ? ['native-boss-filter-source-incomplete-or-unresolved'] : []),
      ...(allDamage === null ? ['overall-damage-total-unavailable'] : [])];
    return [p.id, component(valid ? 'known' : entries === null ? 'unsupported' : 'incomplete', rate(usefulDamage, duration),
      { usefulDamage, usefulDamagePerSecond: rate(usefulDamage, duration), allDamage, allDamagePerSecond: rate(allDamage, duration),
        paddingDamage: null, unknownDamage: valid && allDamage !== null ? allDamage - usefulDamage : null,
        complete: valid, basis: valid ? 'complete-native-boss-filter-total' : entries === null ? 'unavailable' : 'observed-lower-bound',
        source: 'native-boss-filter-table-v1', filterExpression: NATIVE_BOSS_FILTER,
        usefulTargetNPCIDs: null, paddingTargetNPCIDs: null },
      { id: 'native-boss-damage-per-fight-second-v1', unit: 'damage/second', filterExpression: NATIVE_BOSS_FILTER,
        rulesVersion: text(rules.version) ? rules.version : null, targets: 'provider-classified-bosses-only' }, 'higher', limitations)];
  }));
}
function measureOutput(input, rules, byID, roots, duration) {
  const overall = sourceTableTotals(input.output, input, byID, roots);
  if (rules.nativeBossOutput === true) return measureNativeBossOutput(input, rules, byID, roots, duration, overall);
  const usefulIDs = idList(rules.usefulTargetNPCIDs) ? rules.usefulTargetNPCIDs : null;
  const paddingIDs = idList(rules.paddingTargetNPCIDs) ? rules.paddingTargetNPCIDs : null;
  const overlap = usefulIDs && paddingIDs && usefulIDs.some((id) => paddingIDs.includes(id));
  const s = input.usefulScope;
  const scopeOK = object(s) && s.verified === true && ['native-target-tables-v1', 'native-target-events-v1'].includes(s.definition)
    && usefulIDs !== null && sameSet(s.NPCIDs, usefulIDs) && !overlap
    && usefulIDs.every((id) => [...byID.values()].some((a) => a.type === 'NPC' && a.gameID === id))
    && (s.reportCode === undefined || s.reportCode === input.candidate.code)
    && (s.code === undefined || s.code === input.candidate.code) && (s.fightID === undefined || s.fightID === input.fight.id)
    && (s.startTime === undefined || s.startTime === input.fight.startTime) && (s.endTime === undefined || s.endTime === input.fight.endTime);
  const native = scopeOK ? nativeDamage(input, byID, roots, usefulIDs, paddingIDs) : null;
  const mapBound = scopeOK && s.definition === 'native-target-tables-v1' && input.useful instanceof Map
    && (s.reportCode ?? s.code) === input.candidate.code && s.fightID === input.fight.id
    && s.startTime === input.fight.startTime && s.endTime === input.fight.endTime;
  const mapOK = mapBound && s.complete === true;
  const badMapIdentity = mapBound && [...input.useful.keys()].some((id) => !playerID(id) || !input.fight.friendlyPlayers.includes(id));
  return new Map(input.roster.map((p) => {
    const allDamage = overallDamageFor(overall, p.id);
    let usefulDamage = null, paddingDamage = null, unknownDamage = null, state = 'unsupported', basis = 'unavailable', mode = null;
    const limitations = ['useful-target-damage-is-not-a-duty-or-mechanic-score'];
    if (!scopeOK) limitations.push('reviewed-consistent-useful-target-scope-unavailable');
    else if (native) {
      const m = native.result.get(p.id), observed = m.all.length > 0 || native.complete;
      const valid = native.complete && !native.globallyInvalid && !m.invalid;
      usefulDamage = observed ? finiteSum(m.useful) : null;
      paddingDamage = paddingIDs && !overlap && native.paddingComplete && valid ? finiteSum(m.padding) : null;
      unknownDamage = observed ? finiteSum(m.unknown) : null;
      state = valid && usefulDamage !== null ? 'known' : 'incomplete';
      basis = state === 'known' ? 'complete-native-target-total' : observed ? 'observed-lower-bound' : 'unavailable';
      mode = native.mode;
      if (!valid) limitations.push('native-target-source-incomplete-or-unresolved');
      if (native.mode === 'native-target-tables-v1' && allDamage !== null && observed) {
        const targetTotal = finiteSum(m.all);
        if (targetTotal !== null && targetTotal <= allDamage) unknownDamage = allDamage - (usefulDamage ?? 0) - (paddingDamage ?? 0);
      }
    } else if (mapBound) {
      mode = s.definition;
      const value = input.useful.get(p.id);
      if (!badMapIdentity && input.useful.has(p.id) && amount(value) && (mapOK || s.complete === false)) {
        usefulDamage = value; state = mapOK ? 'known' : 'incomplete';
        basis = mapOK ? 'reviewed-native-target-table-aggregate' : 'observed-lower-bound';
        unknownDamage = mapOK && allDamage !== null && value <= allDamage ? allDamage - value : null;
      } else { state = 'incomplete'; limitations.push('native-target-table-player-total-unavailable'); }
      if (!mapOK) limitations.push('native-target-table-aggregate-completeness-unverified');
      limitations.push('aggregate-preserves-reviewed-useful-scope-not-other-target-classification');
    } else limitations.push('native-useful-damage-source-unavailable');
    if (allDamage !== null && usefulDamage !== null && (usefulDamage > allDamage || paddingDamage !== null && usefulDamage + paddingDamage > allDamage)) {
      state = 'incomplete'; limitations.push('native-and-overall-damage-totals-conflict');
    }
    if (!paddingIDs || overlap || paddingDamage === null) limitations.push('padding-target-total-unavailable');
    if (allDamage === null) limitations.push('overall-damage-total-unavailable');
    return [p.id, component(state, rate(usefulDamage, duration),
      { usefulDamage, usefulDamagePerSecond: rate(usefulDamage, duration), allDamage, allDamagePerSecond: rate(allDamage, duration),
        paddingDamage, unknownDamage, complete: state === 'known', basis, source: mode,
        usefulTargetNPCIDs: usefulIDs ? sorted(usefulIDs) : null, paddingTargetNPCIDs: paddingIDs ? sorted(paddingIDs) : null },
      { id: 'reviewed-useful-target-damage-per-fight-second-v1', unit: 'damage/second', rulesVersion: text(rules.version) ? rules.version : null,
        targetNPCIDs: usefulIDs ? sorted(usefulIDs) : null }, 'higher', limitations)];
  }));
}

export function measureStatisticsFight(input, { rules = {}, legacy = false } = {}) {
  const { byID, duration } = basicInput(input);
  if (!object(rules) || typeof legacy !== 'boolean') fail('Invalid statistics review rules or legacy flag');
  const { candidate, scope, fight, rep, roster, streams = {} } = input;
  const roots = new Map([...byID.keys()].map((id) => [id, resolvePlayerRoot(byID, id, fight.friendlyPlayers)]));
  const views = Object.fromEntries(REQUIRED_STREAMS.map(({ name }) => [name, streamView(streams?.[name], name, candidate.code, fight, legacy)]));
  const measurements = new Map(roster.map((p) => [p.id, { damage: [], deaths: [], healing: [], casts: [],
    invalidDamage: false, invalidAvoidance: false, invalidDeaths: false, invalidHealing: false, invalidCasts: false, pi: false, invalidPI: false, initialAuras: null }]));
  const globalBad = { DamageTaken: false, Deaths: false, Healing: false, Casts: false, Buffs: false, CombatantInfo: false };
  const root = (id) => metadataID(id) ? roots.get(id) ?? null : null;
  for (const e of views.DamageTaken.observed) {
    if (!text(e.type)) { globalBad.DamageTaken = true; continue; }
    if (e.type !== 'damage') continue;
    const target = byID.get(e.targetID), m = measurements.get(e.targetID);
    if (!metadataID(e.targetID) || !target) { globalBad.DamageTaken = true; continue; }
    if (!m) continue; // Pet damage taken is not the player's native damage taken.
    // Incoming attribution is to the verified recipient, not an inferred attacker.
    // Only avoidance additionally needs native ability membership to be known.
    if (!spell(e.abilityGameID)) m.invalidAvoidance = true;
    if (!amount(e.amount)) {
      m.invalidDamage = true;
      if (!spell(e.abilityGameID) || !effectList(rules.avoidableAbilityIDs) || rules.avoidableAbilityIDs.includes(e.abilityGameID)) m.invalidAvoidance = true;
      continue;
    }
    m.damage.push({ time: (e.timestamp - fight.startTime) / 1000, abilityID: spell(e.abilityGameID) ? e.abilityGameID : null, amount: e.amount,
      absorbed: amount(e.absorbed) ? e.absorbed : null, mitigated: amount(e.mitigated) ? e.mitigated : null });
  }
  for (const e of views.Deaths.observed) {
    if (!text(e.type)) { globalBad.Deaths = true; continue; }
    if (e.type !== 'death') continue;
    if (!metadataID(e.targetID) || !byID.has(e.targetID)) { globalBad.Deaths = true; continue; }
    const m = measurements.get(e.targetID);
    if (m) m.deaths.push((e.timestamp - fight.startTime) / 1000);
  }
  for (const e of views.Casts.observed) {
    if (!text(e.type)) { globalBad.Casts = true; continue; }
    if (!['cast', 'begincast', 'applybuff', 'refreshbuff', 'removebuff'].includes(e.type)) continue;
    const source = byID.get(e.sourceID), id = root(e.sourceID);
    if (!metadataID(e.sourceID) || !source) { globalBad.Casts = true; continue; }
    if (id === null) {
      if (source.type === 'Pet' || source.petOwner != null && source.petOwner !== 0) globalBad.Casts = true;
      continue;
    }
    const m = measurements.get(id);
    if (!spell(e.abilityGameID) || e.targetID != null && e.targetID !== 0 && (!metadataID(e.targetID) || !byID.has(e.targetID))) {
      m.invalidCasts = true; continue;
    }
    m.casts.push(e);
  }
  for (const e of views.Healing.observed) {
    if (!text(e.type)) { globalBad.Healing = true; continue; }
    if (!['heal', 'absorbed'].includes(e.type)) continue;
    const source = byID.get(e.sourceID), id = root(e.sourceID), targetID = root(e.targetID);
    if (!metadataID(e.sourceID) || !source) { globalBad.Healing = true; continue; }
    if (id === null) {
      if (source.type === 'Pet' || source.petOwner != null && source.petOwner !== 0) globalBad.Healing = true;
      continue; // Known non-player healing is never assigned to a healer.
    }
    const m = measurements.get(id);
    if (targetID === null || !amount(e.amount) || !effect(e.abilityGameID)) {
      m.invalidHealing = true; continue;
    }
    m.healing.push({ type: e.type, amount: e.amount, self: targetID === id, petTarget: e.targetID !== targetID,
      overheal: e.type === 'heal' && amount(e.overheal) ? e.overheal : null, time: (e.timestamp - fight.startTime) / 1000 });
  }
  for (const e of views.CombatantInfo.observed) {
    const m = measurements.get(e.sourceID);
    if (e.type !== 'combatantinfo') {
      // A malformed record beside a valid empty initial row cannot prove PI
      // absence. Do not use its auras to manufacture positive presence either.
      if (m) m.invalidPI = true;
      else globalBad.CombatantInfo = true;
    } else if (e.type === 'combatantinfo' && (!metadataID(e.sourceID) || !byID.has(e.sourceID))) {
      globalBad.CombatantInfo = true;
    }
  }
  for (const p of roster) {
    const m = measurements.get(p.id), ci = views.CombatantInfo.observed.filter((e) => e.type === 'combatantinfo' && e.sourceID === p.id);
    // A literal native PI on this verified beneficiary proves presence without
    // identifying its caster. Absence needs a complete, valid initial ability list.
    if (ci.some((e) => Array.isArray(e.auras) && e.auras.some((a) => object(a) && a.ability === 10060))) m.pi = true;
    if (ci.length !== 1 || !Array.isArray(ci[0].auras) || ci[0].auras.some((a) => !object(a) || !effect(a.ability))) m.invalidPI = true;
    else m.initialAuras = ci[0].auras;
  }
  for (const e of views.Buffs.observed) {
    if (!text(e.type)) { globalBad.Buffs = true; continue; }
    if (!['applybuff', 'refreshbuff', 'removebuff'].includes(e.type)) continue;
    const m = measurements.get(e.targetID);
    if (!metadataID(e.targetID) || !byID.has(e.targetID)) { globalBad.Buffs = true; continue; }
    if (!m) continue;
    if (!effect(e.abilityGameID)) { m.invalidPI = true; continue; }
    if (e.abilityGameID === 10060) m.pi = true;
  }
  const outputs = measureOutput(input, rules, byID, roots, duration);
  const provenance = { mode: legacy ? 'legacy-declared' : 'current-bound', legacy, authenticated: legacy ? false : null,
    label: legacy ? 'Legacy completeness declared locally; not authenticated' : 'Named stream bindings validated locally',
    code: candidate.code, revision: count(rep.revision) ? rep.revision : null,
    reportStartTime: amount(rep.startTime) ? rep.startTime : null, reportEndTime: amount(rep.endTime) ? rep.endTime : null,
    streams: REQUIRED_STREAMS.map(({ name }) => { const v = views[name]; return { name, state: v.state, complete: v.complete,
      mode: v.legacy ? 'legacy-declared' : 'current-bound', pages: v.pages, eventCount: v.eventCount, observedEventCount: v.observedEventCount,
      invalidEventCount: v.invalidEventCount, reasons: [...v.reasons] }; }) };
  return roster.map((p) => {
    const m = measurements.get(p.id), components = {};
    const deathsComplete = views.Deaths.complete && !globalBad.Deaths && !m.invalidDeaths;
    const deathTimes = [...m.deaths].sort((a, b) => a - b);
    const deathObserved = deathsComplete || deathTimes.length > 0;
    const deathCount = deathObserved ? deathTimes.length : null;
    const firstDeathSec = deathTimes[0] ?? null;
    const fullExposure = deathsComplete && (deathCount === 0 || firstDeathSec === duration);
    components.survival = component(summaryState(views.Deaths, globalBad.Deaths || m.invalidDeaths, deathTimes.length), deathCount,
      { deathCount, firstDeathSec, firstDeathFraction: firstDeathSec === null ? null : firstDeathSec / duration,
        deathTimes, firstLifeSec: firstDeathSec ?? (deathsComplete ? duration : null),
        aliveTimeSec: deathsComplete && deathCount === 0 ? duration : null, complete: deathsComplete,
        basis: deathsComplete ? 'complete-native-deaths' : deathObserved ? 'observed-lower-bound' : 'unavailable' },
      { id: 'native-deaths-then-first-death-fraction-v1', unit: 'deaths', tieBreak: 'later-first-death-fraction' }, 'lower',
      [...(!deathsComplete ? ['death-source-incomplete'] : []), ...(deathCount > 0 ? ['alive-time-after-death-or-resurrection-not-inferred'] : [])]);
    const incoming = totalFields(views.DamageTaken, globalBad.DamageTaken || m.invalidDamage, m.damage, duration, ['amount']);
    const absorbed = m.damage.every((e) => amount(e.absorbed)) && incoming.complete ? finiteSum(m.damage.map((e) => e.absorbed)) : null;
    const mitigated = m.damage.every((e) => amount(e.mitigated)) && incoming.complete ? finiteSum(m.damage.map((e) => e.mitigated)) : null;
    const incomingDirection = ['lower', 'higher'].includes(rules.incomingDirection) && text(rules.incomingDirectionReason) ? rules.incomingDirection : null;
    components.incoming = component(incoming.state, rate(incoming.totals.amount, duration),
      { total: incoming.totals.amount, perSecond: rate(incoming.totals.amount, duration), eventCount: incoming.totals.amount !== null ? m.damage.length : null,
        absorbed, mitigated, complete: incoming.complete, basis: incoming.basis, exposure: fullExposure ? 'full-fight' : 'unreliable-after-death-or-missing-deaths' },
      { id: 'native-incoming-damage-per-fight-second-v1', unit: 'damage/second', direction: incomingDirection,
        directionReason: incomingDirection ? rules.incomingDirectionReason.trim() : null,
        rulesVersion: incomingDirection && text(rules.version) ? rules.version : null }, incomingDirection,
      ['incoming-damage-is-not-automatically-poor-skill-or-tank-performance', 'incoming-absorption-is-not-healer-provider-credit',
        ...(!incoming.complete ? ['incoming-source-incomplete'] : []), ...(!incomingDirection ? ['incoming-performance-direction-and-reason-unreviewed'] : [`incoming-direction-rationale: ${rules.incomingDirectionReason.trim()}`]),
        ...(!fullExposure ? ['reliable-full-fight-exposure-unavailable'] : [])], fullExposure);
    const avoidIDs = effectList(rules.avoidableAbilityIDs) ? rules.avoidableAbilityIDs : null;
    const avoidRecords = avoidIDs ? m.damage.filter((e) => avoidIDs.includes(e.abilityID)) : [];
    const avoidance = totalFields(views.DamageTaken, globalBad.DamageTaken || m.invalidAvoidance, avoidRecords, duration, ['amount']);
    components.avoidance = component(avoidIDs ? avoidance.state : 'unsupported', avoidIDs ? rate(avoidance.totals.amount, duration) : null,
      { total: avoidIDs ? avoidance.totals.amount : null, perSecond: avoidIDs ? rate(avoidance.totals.amount, duration) : null,
        hits: avoidIDs && avoidance.totals.amount !== null ? avoidRecords.length : null, incidents: avoidRecords,
        complete: !!avoidIDs && avoidance.complete, basis: avoidIDs ? avoidance.basis : 'unavailable',
        exposure: fullExposure ? 'full-fight' : 'unreliable-after-death-or-missing-deaths' },
      { id: 'reviewed-avoidable-damage-per-fight-second-v1', unit: 'damage/second',
        rulesVersion: text(rules.version) ? rules.version : null, abilityIDs: avoidIDs ? sorted(avoidIDs) : null }, 'lower',
      ['reviewed-damage-list-is-not-all-possible-mistakes-or-raid-assignments', ...(!avoidIDs ? ['reviewed-avoidable-ability-list-unavailable'] : []),
        ...(!avoidance.complete ? ['avoidable-damage-source-incomplete'] : []), ...(!fullExposure ? ['reliable-full-fight-exposure-unavailable'] : [])], fullExposure);
    components.defenses = measureDefenses(views.Casts, globalBad.Casts || m.invalidCasts, m.casts, p, fight, rules, duration, byID);
    components.output = outputs.get(p.id);
    const healingInvalid = globalBad.Healing || m.invalidHealing;
    const h = m.healing, healingComplete = views.Healing.complete && !healingInvalid;
    const healingObserved = healingComplete || h.length > 0;
    const sumHealing = (predicate) => healingObserved ? finiteSum(h.filter(predicate).map((e) => e.amount)) : null;
    const effective = sumHealing((e) => e.type === 'heal'), consumed = sumHealing((e) => e.type === 'absorbed');
    const total = amount(effective) && amount(consumed) ? finiteSum([effective, consumed]) : null;
    const healEvents = h.filter((e) => e.type === 'heal');
    const overheal = healingComplete && healEvents.every((e) => amount(e.overheal)) ? finiteSum(healEvents.map((e) => e.overheal)) : null;
    components.healing = component(summaryState(views.Healing, healingInvalid || total === null && healingObserved, h.length), rate(total, duration),
      { effective, consumed, total, perSecond: rate(total, duration), overheal,
        selfEffective: sumHealing((e) => e.type === 'heal' && e.self), otherEffective: sumHealing((e) => e.type === 'heal' && !e.self),
        selfConsumed: sumHealing((e) => e.type === 'absorbed' && e.self), otherConsumed: sumHealing((e) => e.type === 'absorbed' && !e.self),
        self: sumHealing((e) => e.self), other: sumHealing((e) => !e.self), petRecipient: sumHealing((e) => e.petTarget),
        selfDefinition: 'recipient-player-root-including-owned-pets', eventCount: healingObserved ? h.length : null,
        complete: healingComplete && total !== null, basis: healingComplete ? 'complete-native-effective-and-consumed-total' : healingObserved ? 'observed-lower-bound' : 'unavailable' },
      { id: 'native-effective-healing-plus-consumed-shields-per-fight-second-v1', unit: 'healing/second', self: 'included-and-separated' }, 'higher',
      ['effective-native-heal-amounts-only', 'consumed-shields-by-native-provider-root-not-capacity', 'healing-is-not-verified-benefit-or-healer-demand',
        ...(!healingComplete ? ['healing-source-incomplete-or-provider-unresolved'] : []), ...(overheal === null ? ['complete-overheal-total-unavailable'] : [])]);
    const piKnown = views.Buffs.complete && views.CombatantInfo.complete && !globalBad.Buffs && !globalBad.CombatantInfo && !m.invalidPI;
    return { version: STATISTICS_VERSION,
      identity: { code: candidate.code, fightID: fight.id, actorID: p.id, name: p.name, server: p.server, region: p.region,
        className: p.className, spec: p.spec, role: p.role, verified: true },
      scope: { zone: scope.zone, encounter: fight.encounterID, difficulty: fight.difficulty, size: fight.size,
        partition: playerID(scope.partition) ? scope.partition : null, patch: text(scope.patch) ? scope.patch : null },
      fight: { encounter: fight.encounterID, difficulty: fight.difficulty, size: fight.size, startTime: fight.startTime,
        endTime: fight.endTime, durationSec: duration, kill: fight.kill },
      provenance: { ...provenance, streams: provenance.streams.map((s) => ({ ...s, reasons: [...s.reasons] })) },
      support: { pi: m.pi ? true : piKnown ? false : null, state: m.pi || piKnown ? 'known' : 'incomplete',
        limitations: piKnown ? [] : ['PI-absence-needs-complete-initial-auras-and-buff-stream'] },
      components: Object.fromEntries(STATISTICS_COMPONENTS.map((k) => [k, components[k]])) };
  });
}

function sourceKey(o) {
  const i = o?.identity;
  return codeID(i?.code) && playerID(i?.fightID) && playerID(i?.actorID) ? canonical([i.code, i.fightID, i.actorID]) : null;
}
function validObservation(o) {
  const i = o?.identity, f = o?.fight, s = o?.scope;
  return o?.version === STATISTICS_VERSION && sourceKey(o) !== null && i.verified === true
    && [i.name, i.server, i.region, i.className, i.spec].every(text) && Object.hasOwn(STATISTICS_WEIGHTS, i.role)
    && object(f) && playerID(f.encounter) && playerID(f.difficulty) && playerID(f.size) && typeof f.kill === 'boolean'
    && amount(f.startTime) && amount(f.endTime) && f.endTime > f.startTime && positive(f.durationSec)
    && f.durationSec === (f.endTime - f.startTime) / 1000 && object(s) && playerID(s.zone)
    && s.encounter === f.encounter && s.difficulty === f.difficulty && s.size === f.size
    && (s.partition == null || playerID(s.partition)) && (s.patch == null || text(s.patch))
    && object(o.provenance) && ['current-bound', 'legacy-declared'].includes(o.provenance.mode)
    && (o.provenance.mode !== 'legacy-declared' || o.provenance.authenticated === false)
    && (o.provenance.code === undefined || o.provenance.code === i.code) && object(o.components);
}
function cohort(o, mode) {
  if (!validObservation(o)) return null;
  const { identity: i, fight: f, scope: s } = o;
  return { zone: s.zone, encounter: f.encounter, difficulty: f.difficulty, size: f.size,
    partition: playerID(s.partition) ? s.partition : null, patch: text(s.patch) ? s.patch : null,
    kill: f.kill, role: i.role, cohortMode: mode, ...(mode === 'spec' ? { className: i.className, spec: i.spec } : {}) };
}
function playerKey(o) { const i = o.identity; return canonical([norm(i.name), norm(i.server), norm(i.region)]); }
function fightKey(o) { return canonical([o.identity.code, o.identity.fightID]); }
function sourceComplete(o, name) {
  const receipts = Array.isArray(o?.provenance?.streams) ? o.provenance.streams.filter((s) => s?.name === name) : [];
  if (receipts.length !== 1) return false;
  const s = receipts[0];
  return s.state === 'known' && s.complete === true && count(s.pages) && s.pages > 0 && s.pages <= 20
    && count(s.eventCount) && s.eventCount <= 1_000_000 && count(s.observedEventCount) && s.observedEventCount <= s.eventCount
    && ['current-bound', 'legacy-declared'].includes(s.mode)
    && (s.mode !== 'legacy-declared' || o.provenance.mode === 'legacy-declared' && o.provenance.authenticated === false);
}
function metricValid(o, name) {
  const c = o?.components?.[name], m = c?.measurements, duration = o?.fight?.durationSec;
  if (!object(c) || c.state !== 'known' || c.scoreEligible !== true || !amount(c.value) || !object(m)
    || m.complete !== true || !object(c.definition) || !text(c.definition.id) || !text(c.definition.unit)
    || !['higher', 'lower'].includes(c.direction)) return false;
  const eq = (v) => amount(v) && c.value === v;
  const exposure = () => metricValid(o, 'survival') && (o.components.survival.value === 0 || o.components.survival.measurements.firstDeathFraction === 1);
  if (name === 'survival') return sourceComplete(o, 'Deaths') && count(c.value) && c.value === m.deathCount && Array.isArray(m.deathTimes)
    && m.deathTimes.length === m.deathCount && m.deathTimes.every((t) => amount(t) && t <= duration)
    && (m.deathCount === 0 ? m.firstDeathSec === null && m.firstDeathFraction === null
      : m.firstDeathSec === m.deathTimes.reduce((min, t) => Math.min(min, t), Infinity)
        && m.firstDeathFraction === m.firstDeathSec / duration)
    && c.direction === 'lower' && c.definition.id === 'native-deaths-then-first-death-fraction-v1'
    && c.definition.tieBreak === 'later-first-death-fraction';
  if (name === 'avoidance') return sourceComplete(o, 'DamageTaken') && exposure() && effectList(c.definition.abilityIDs)
    && c.direction === 'lower' && c.definition.id === 'reviewed-avoidable-damage-per-fight-second-v1'
    && eq(rate(m.total, duration)) && m.exposure === 'full-fight';
  if (name === 'incoming') return sourceComplete(o, 'DamageTaken') && exposure() && eq(rate(m.total, duration)) && m.exposure === 'full-fight'
    && c.definition.id === 'native-incoming-damage-per-fight-second-v1' && c.definition.direction === c.direction && text(c.definition.directionReason);
  if (name === 'defenses') {
    if (!sourceComplete(o, 'Casts') || c.direction !== 'higher' || c.definition.id !== 'bounded-personal-defensive-casts-per-minute-v1'
      || !count(m.rawUses) || !count(m.boundedUses) || !eq(rate(m.boundedUses, duration / 60)) || !Array.isArray(m.abilities) || !m.abilities.length) return false;
    if (!m.abilities.every((a) => a.supported === true && effectList(a.abilityIDs) && positive(a.minIntervalSec) && playerID(a.charges)
      && (a.maxUsesPerFight === null || playerID(a.maxUsesPerFight)) && personalTargetPolicies.includes(a.targetPolicy)
      && defensiveScopeValid(a) && defensiveScopeMatches(a, o.identity)
      && count(a.rawUses) && count(a.boundedUses) && a.boundedUses <= a.rawUses
      && count(a.allowedCount) && a.allowedCount === Math.min(a.maxUsesPerFight ?? Number.MAX_SAFE_INTEGER, a.charges + Math.floor(duration / a.minIntervalSec))
      && a.boundedUses <= a.allowedCount && Array.isArray(a.accepted) && a.accepted.length === a.boundedUses
      && a.accepted.every((e) => amount(e.time) && e.time <= duration && a.abilityIDs.includes(e.abilityID)))) return false;
    const definitions = m.abilities.map(defensiveDefinition).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return finiteSum(m.abilities.map((a) => a.boundedUses)) === m.boundedUses && finiteSum(m.abilities.map((a) => a.rawUses)) === m.rawUses
      && canonical(definitions) === canonical(c.definition.abilities);
  }
  if (name === 'output') {
    const nativeBoss = c.definition.id === 'native-boss-damage-per-fight-second-v1'
      && c.definition.filterExpression === NATIVE_BOSS_FILTER && c.definition.targets === 'provider-classified-bosses-only'
      && m.source === 'native-boss-filter-table-v1' && m.filterExpression === NATIVE_BOSS_FILTER;
    const reviewedTargets = c.definition.id === 'reviewed-useful-target-damage-per-fight-second-v1'
      && idList(c.definition.targetNPCIDs) && sameSet(m.usefulTargetNPCIDs, c.definition.targetNPCIDs)
      && ['native-target-tables-v1', 'native-target-events-v1'].includes(m.source);
    return c.direction === 'higher' && (nativeBoss || reviewedTargets) && eq(rate(m.usefulDamage, duration))
      && (m.allDamage === null || amount(m.allDamage) && m.usefulDamage <= m.allDamage);
  }
  if (name === 'healing') return sourceComplete(o, 'Healing') && c.direction === 'higher'
    && c.definition.id === 'native-effective-healing-plus-consumed-shields-per-fight-second-v1'
    && amount(m.effective) && amount(m.consumed) && finiteSum([m.effective, m.consumed]) === m.total && eq(rate(m.total, duration));
  return false;
}
function metricOrder(a, b, name) {
  if (a.value !== b.value) return (a.value > b.value ? 1 : -1) * (a.direction === 'higher' ? 1 : -1);
  if (name === 'survival' && a.value > 0 && a.measurements.firstDeathFraction !== b.measurements.firstDeathFraction)
    return a.measurements.firstDeathFraction > b.measurements.firstDeathFraction ? 1 : -1;
  return 0;
}
function observationSignature(o) {
  return canonical({ version: o?.version, identity: o?.identity, scope: o?.scope, fight: o?.fight,
    support: o?.support, provenance: o?.provenance, components: o?.components });
}
function sampleSummary(items, ownLegacy = false, limitedScope = false) {
  const players = new Map(), fights = new Map(), kills = new Set();
  for (const o of items) {
    const p = playerKey(o), f = fightKey(o);
    players.set(p, (players.get(p) ?? 0) + 1); fights.set(f, (fights.get(f) ?? 0) + 1);
    if (o.fight.kill === true) kills.add(f);
  }
  const observations = items.length, enough = observations >= 5 && players.size >= 3;
  const maximum = (values) => { let max = 0; for (const n of values) max = Math.max(max, n); return max; };
  const maxPlayerShare = observations ? maximum(players.values()) / observations : null;
  const maxFightShare = observations ? maximum(fights.values()) / observations : null;
  const legacyObservations = items.filter((o) => o.provenance.mode === 'legacy-declared').length;
  const caps = [];
  if (ownLegacy || legacyObservations > 0) caps.push('legacy-declared-evidence');
  if (limitedScope) caps.push('patch-or-partition-unknown');
  if (kills.size < 2) caps.push('fewer-than-two-distinct-kills');
  if (maxPlayerShare > 0.5 || maxFightShare > 0.5) caps.push('concentrated-sample');
  return { observations, players: players.size, kills: kills.size, fights: fights.size,
    minimumObservations: 5, minimumPlayers: 3, sufficient: enough,
    confidence: !enough ? 'insufficient' : caps.length || observations < 20 ? 'low' : observations < 50 ? 'moderate' : 'higher',
    confidenceCaps: caps, legacyObservations, maxPlayerShare, maxFightShare };
}

export function evaluateStatistics(observation, peers, { piPolicy = 'Any', cohortMode = 'spec' } = {}) {
  const validOptions = ['Any', 'Exclude'].includes(piPolicy) && ['spec', 'role'].includes(cohortMode);
  const valid = validObservation(observation), descriptor = validOptions ? cohort(observation, cohortMode) : null;
  const ownKey = sourceKey(observation), seen = new Map(), conflicts = new Set();
  let duplicateCount = 0, invalidCount = 0;
  for (const o of Array.isArray(peers) ? peers : []) {
    const key = sourceKey(o);
    if (!key) { invalidCount++; continue; }
    if (!validObservation(o)) invalidCount++;
    const signature = observationSignature(o);
    if (seen.has(key)) { duplicateCount++; if (seen.get(key).signature !== signature) conflicts.add(key); }
    else seen.set(key, { observation: o, signature });
    if (key === ownKey && signature !== observationSignature(observation)) conflicts.add(key);
  }
  const ownConflict = ownKey !== null && conflicts.has(ownKey);
  const limitedScope = !!descriptor && (descriptor.partition === null || descriptor.patch === null);
  const policyOK = piPolicy === 'Any' || observation?.support?.pi === false;
  const pool = descriptor ? [...seen.entries()].filter(([key, entry]) => !conflicts.has(key) && validObservation(entry.observation)
    && canonical(cohort(entry.observation, cohortMode)) === canonical(descriptor)
    && (piPolicy === 'Any' || entry.observation.support?.pi === false)).map(([, entry]) => entry.observation) : [];
  const role = valid ? observation.identity.role : null, weights = role ? { ...STATISTICS_WEIGHTS[role] } : null;
  const components = {}, definitions = {}, cohortSources = {};
  const baseLimitations = [...(!valid ? ['invalid-observation-identity-or-fight'] : []), ...(!validOptions ? ['invalid-statistics-policy'] : []),
    ...(limitedScope ? ['patch-or-partition-unknown-distinct-cohort-low-confidence'] : []), ...(!policyOK ? ['PI-policy-requires-known-false'] : []),
    ...(ownConflict ? ['conflicting-duplicate-observation'] : []), ...(cohortMode === 'role' ? ['explicit-role-wide-cohort'] : [])];
  for (const name of STATISTICS_COMPONENTS) {
    const c = observation?.components?.[name], definition = object(c?.definition) ? c.definition : null;
    const matching = definition ? pool.filter((o) => metricValid(o, name) && o.components[name].direction === c.direction
      && canonical(o.components[name].definition) === canonical(definition)) : [];
    const sample = sampleSummary(matching, observation?.provenance?.mode === 'legacy-declared', limitedScope);
    const ready = valid && validOptions && descriptor && policyOK && !ownConflict && metricValid(observation, name) && sample.sufficient;
    let score = null, percentile = null;
    if (ready) {
      let worse = 0, ties = 0, better = 0;
      for (const peer of matching) { const order = metricOrder(c, peer.components[name], name); if (order > 0) worse++; else if (order === 0) ties++; else better++; }
      score = 100 * (worse + ties / 2) / matching.length;
      percentile = { method: 'empirical-midrank', worse, ties, better, observations: matching.length, tieTreatment: 'half-weight',
        direction: c.direction, ...(name === 'survival' ? { ordering: 'fewer-deaths-then-later-first-death-fraction' } : {}) };
      definitions[name] = { definition, direction: c.direction };
      cohortSources[name] = matching.map((o) => ({ source: sourceKey(o), value: o.components[name].value,
        ...(name === 'survival' ? { firstDeathFraction: o.components[name].measurements.firstDeathFraction } : {}) }))
        .sort((a, b) => a.source.localeCompare(b.source));
    }
    components[name] = { ...(object(c) ? c : { state: 'missing', value: null, measurements: {}, definition: null, direction: null }),
      weight: weights ? weights[name] : null, score, sample, percentile,
      limitations: dedup([...(Array.isArray(c?.limitations) ? c.limitations.filter(text) : []), ...baseLimitations,
        ...(!metricValid(observation, name) ? ['component-metric-unavailable-for-performance-score'] : []),
        ...(!sample.sufficient ? ['matching-sample-needs-five-observations-and-three-players'] : [])]) };
  }
  const mask = STATISTICS_COMPONENTS.map((name) => components[name].score !== null ? '1' : '0').join('');
  const coverageWeight = weights ? STATISTICS_COMPONENTS.reduce((sum, name) => sum + (components[name].score !== null ? weights[name] : 0), 0) : 0;
  const score = coverageWeight > 0 ? STATISTICS_COMPONENTS.reduce((sum, name) => sum + (components[name].score ?? 0) * weights[name], 0) / coverageWeight : null;
  const status = score === null ? 'measurements-only' : mask === '111111' ? 'full' : 'partial';
  const sample = sampleSummary(pool, observation?.provenance?.mode === 'legacy-declared', limitedScope);
  const scoredSamples = STATISTICS_COMPONENTS.filter((name) => components[name].score !== null).map((name) => components[name].sample);
  const confidenceOrder = ['insufficient', 'low', 'moderate', 'higher'];
  sample.confidence = scoredSamples.length ? confidenceOrder[Math.min(...scoredSamples.map((s) => confidenceOrder.indexOf(s.confidence)))] : 'insufficient';
  Object.assign(sample, { duplicateCount, conflictingDuplicates: conflicts.size, invalidObservations: invalidCount,
    components: Object.fromEntries(STATISTICS_COMPONENTS.map((name) => [name, components[name].sample])) });
  const comparisonKey = score === null ? null : canonical({ version: STATISTICS_VERSION, descriptor, piPolicy, mask, weights, definitions, cohortSources });
  return { version: STATISTICS_VERSION, status, score, mask, coverageWeight, weights, components, sample,
    provenance: { ...(object(observation?.provenance) ? observation.provenance : {}), method: 'empirical-midrank', piPolicy, cohortMode,
      peerLegacyObservations: sample.legacyObservations, limitations: baseLimitations }, comparisonKey,
    identity: valid ? { ...observation.identity } : null, scope: valid ? { ...observation.scope, kill: observation.fight.kill } : null };
}

function validEvaluation(e) {
  if (e?.version !== STATISTICS_VERSION || !['partial', 'full'].includes(e.status) || !amount(e.score) || e.score > 100
    || typeof e.mask !== 'string' || !/^[01]{6}$/.test(e.mask) || e.mask === '000000' || !text(e.comparisonKey)
    || !codeID(e.identity?.code) || !playerID(e.identity?.fightID) || !playerID(e.identity?.actorID)
    || !object(e.components) || !object(e.weights) || !positive(e.coverageWeight)) return false;
  const roleWeights = STATISTICS_WEIGHTS[e.identity.role], s = e.scope, i = e.identity;
  if (!roleWeights || canonical(e.weights) !== canonical(roleWeights) || e.status !== (e.mask === '111111' ? 'full' : 'partial')
    || i.verified !== true || ![i.name, i.server, i.region, i.className, i.spec].every(text)
    || !object(s) || ![s.zone, s.encounter, s.difficulty, s.size].every(playerID) || typeof s.kill !== 'boolean'
    || !(s.partition === null || playerID(s.partition)) || !(s.patch === null || text(s.patch))) return false;
  let key;
  try { key = JSON.parse(e.comparisonKey); } catch { return false; }
  const mode = e.provenance?.cohortMode, policy = e.provenance?.piPolicy;
  const descriptor = { zone: s.zone, encounter: s.encounter, difficulty: s.difficulty, size: s.size, partition: s.partition, patch: s.patch,
    kill: s.kill, role: i.role, cohortMode: mode, ...(mode === 'spec' ? { className: i.className, spec: i.spec } : {}) };
  if (!object(key) || key.version !== STATISTICS_VERSION || key.mask !== e.mask || key.piPolicy !== policy
    || !['spec', 'role'].includes(mode) || !['Any', 'Exclude'].includes(policy) || canonical(key.descriptor) !== canonical(descriptor)
    || canonical(key.weights) !== canonical(e.weights) || !object(key.definitions) || !object(key.cohortSources)) return false;
  let weight = 0, weighted = 0;
  for (const [index, name] of STATISTICS_COMPONENTS.entries()) {
    const c = e.components[name], score = c?.score;
    if (e.mask[index] === '1') {
      const sources = key.cohortSources[name], p = c?.percentile, sample = c?.sample;
      if (!amount(score) || score > 100 || c.state !== 'known' || !amount(c.value) || c.scoreEligible !== true || c.measurements?.complete !== true
        || canonical(key.definitions[name]) !== canonical({ definition: c.definition, direction: c.direction })
        || !Array.isArray(sources) || sources.length < 5 || !unique(sources.map((v) => v?.source))
        || !object(sample) || sample.sufficient !== true || sample.observations !== sources.length || !count(sample.players) || sample.players < 3
        || !object(p) || p.method !== 'empirical-midrank' || p.observations !== sources.length || ![p.worse, p.ties, p.better].every(count)
        || p.worse + p.ties + p.better !== sources.length || 100 * (p.worse + p.ties / 2) / sources.length !== score) return false;
      let worse = 0, ties = 0, better = 0;
      for (const source of sources) {
        if (!object(source) || !text(source.source) || !amount(source.value)
          || name === 'survival' && (!count(source.value) || source.value > 0 && (!amount(source.firstDeathFraction) || source.firstDeathFraction > 1))) return false;
        const order = metricOrder(c, { value: source.value, measurements: { firstDeathFraction: source.firstDeathFraction } }, name);
        if (order > 0) worse++; else if (order === 0) ties++; else better++;
      }
      if (p.worse !== worse || p.ties !== ties || p.better !== better) return false;
      weight += e.weights[name]; weighted += e.weights[name] * score;
    } else if (score !== null || Object.hasOwn(key.definitions, name) || Object.hasOwn(key.cohortSources, name)) return false;
  }
  return weight === e.coverageWeight && weighted / weight === e.score;
}
export function compareStatistics(evaluationA, evaluationB) {
  if (!validEvaluation(evaluationA) || !validEvaluation(evaluationB)) return { comparable: false, reason: 'scored-statistics-evaluations-required', comparison: null };
  if (sourceKey(evaluationA) === sourceKey(evaluationB) && STATISTICS_COMPONENTS.some((name) =>
    evaluationA.components[name].value !== evaluationB.components[name].value
    || name === 'survival' && evaluationA.components[name].measurements?.firstDeathFraction !== evaluationB.components[name].measurements?.firstDeathFraction))
    return { comparable: false, reason: 'conflicting-copies-of-the-same-player-fight', comparison: null };
  if (evaluationA.status !== evaluationB.status || evaluationA.mask !== evaluationB.mask)
    return { comparable: false, reason: 'component-masks-or-full-partial-status-differ', comparison: null };
  if (evaluationA.comparisonKey !== evaluationB.comparisonKey)
    return { comparable: false, reason: 'metric-definitions-policies-or-peer-cohorts-differ', comparison: null };
  return { comparable: true, reason: null, comparison: evaluationA.score === evaluationB.score ? 0 : evaluationA.score < evaluationB.score ? -1 : 1 };
}
