// Actual consumed effects, never intended capacity or aura-overlap credit.
import { BENEFIT_VERSION, playerID, metadataID, abilityKey, effectKey, streamReceipts, validateStream, inspectOpportunityLedger } from './contracts.mjs';
import { validateObjectiveRule } from './opportunities.mjs';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const ids = (v) => Array.isArray(v) && v.length > 0 && v.every(playerID) && new Set(v).size === v.length;
const keys = (v) => Array.isArray(v) && v.length > 0 && v.every(abilityKey) && new Set(v).size === v.length;
const effectKeys = (v) => keys(v) && v.every(effectKey);
const strings = (v) => Array.isArray(v) && v.length > 0 && v.every(text) && new Set(v).size === v.length;
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const unavailable = (reason, state = 'unsupported') => ({ version: BENEFIT_VERSION, state, records: [], reasons: [reason] });

export function validateBenefitRule(r) {
  return only(r, ['id', 'version', 'reviewed', 'evidenceRefs', 'method', 'opportunityRuleIDs', 'abilityIDs', 'causeAbilityIDs', 'schools', 'classNames', 'specIDs', 'talentIDs', 'minimumBenefit'])
    && text(r.id) && text(r.version) && r.reviewed === true && strings(r.evidenceRefs) && r.method === 'wcl-consumed-shield-v1'
    && strings(r.opportunityRuleIDs) && effectKeys(r.abilityIDs) && effectKeys(r.causeAbilityIDs) && strings(r.schools) && strings(r.classNames) && ids(r.specIDs)
    && (r.talentIDs === undefined || ids(r.talentIDs)) && finite(r.minimumBenefit) && r.minimumBenefit > 0;
}

export function resolvePlayerRoot(actors, sourceID, rosterIDs) {
  const byID = actors instanceof Map ? actors : new Map((actors ?? []).map((a) => [a.id, a]));
  const roster = new Set(rosterIDs ?? []), seen = new Set();
  let actor = byID.get(sourceID);
  while (actor) {
    if (!metadataID(actor.id) || seen.has(actor.id)) return null;
    seen.add(actor.id);
    if (actor.petOwner == null || actor.petOwner === 0) return actor.type === 'Player' && playerID(actor.id) && roster.has(actor.id) ? actor.id : null;
    if (!metadataID(actor.petOwner) || actor.type === 'Player') return null;
    actor = byID.get(actor.petOwner);
  }
  return null;
}

export function buildDefensiveIntervals({ defenses, fight, code, streams, actors }) {
  const intervals = new Map((fight.friendlyPlayers ?? []).map((id) => [id, []]));
  const fail = (reason, state = 'unsupported') => ({ state, intervals, reasons: [reason] });
  for (const name of ['CombatantInfo', 'Buffs']) if (!validateStream(streams?.[name], name, code, fight).valid) return fail(`${name}: defensive usage unverified`, 'incomplete');
  if (!Array.isArray(defenses) || defenses.some((d) => !keys(d?.abilityIDs) || !strings(d.schools)
    || d.classNames !== undefined && !strings(d.classNames) || d.specIDs !== undefined && !ids(d.specIDs)
    || d.talentIDs !== undefined && !ids(d.talentIDs))) return fail('defensive_usage_definitions_unavailable');
  const abilityIDs = new Set(defenses.flatMap((d) => d.abilityIDs)), active = new Map();
  const durationSec = (fight.endTime - fight.startTime) / 1000;
  const close = (key, end, ref) => {
    const i = active.get(key);
    if (i) intervals.get(i.targetID).push({ ...i, end, personal: i.sourceID === i.targetID, evidenceRefs: ref ? [...i.evidenceRefs, ref] : i.evidenceRefs });
    active.delete(key);
  };
  const open = (source, target, abilityID, start, ref) => {
    if (!abilityIDs.has(abilityID) || !intervals.has(target)) return;
    const sourceID = resolvePlayerRoot(actors, source, fight.friendlyPlayers);
    if (sourceID === null) throw new Error('defensive_aura_ownership_unresolved');
    const key = `${target}:${abilityID}`, existing = active.get(key);
    if (existing && existing.sourceID !== sourceID) close(key, start, ref);
    const i = active.get(key);
    if (i) i.evidenceRefs.push(ref);
    else active.set(key, { sourceID, targetID: target, abilityID, start, evidenceRefs: [ref] });
  };
  try {
    for (const [index, e] of streams.CombatantInfo.events.entries()) if (e.type === 'combatantinfo' && intervals.has(e.sourceID)) {
      if (!Array.isArray(e.auras)) throw new Error('initial_defensive_auras_unavailable');
      for (const a of e.auras) open(a.source, e.sourceID, a.ability, 0, { stream: 'CombatantInfo', index });
    }
    const events = streams.Buffs.events.map((event, index) => ({ event, index })).sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index);
    for (const { event: e, index } of events) {
      const at = (e.timestamp - fight.startTime) / 1000, ref = { stream: 'Buffs', index };
      if (['applybuff', 'refreshbuff'].includes(e.type)) open(e.sourceID, e.targetID, e.abilityGameID, at, ref);
      if (e.type === 'removebuff' && abilityIDs.has(e.abilityGameID)) {
        const key = `${e.targetID}:${e.abilityGameID}`, i = active.get(key);
        if (i) {
          const owner = resolvePlayerRoot(actors, e.sourceID, fight.friendlyPlayers);
          if (owner === null || owner !== i.sourceID) throw new Error('defensive_removal_ownership_disagrees');
          close(key, at, ref);
        }
      }
    }
    for (const key of [...active.keys()]) close(key, durationSec);
  } catch (error) { return fail(error.message); }
  return { state: 'known', intervals, reasons: [] };
}

export function buildBenefitLedger({ rules, opportunityRules, defenses, player, combatant, opportunityLedger, fight, code, streams, actors }) {
  if (!Array.isArray(rules) || !rules.length || !rules.every(validateBenefitRule) || new Set(rules.map((r) => r.id)).size !== rules.length
    || !Array.isArray(opportunityRules) || !opportunityRules.every(validateObjectiveRule)) return unavailable('reviewed_actual_benefit_rules_unavailable');
  if (!playerID(player?.id) || !playerID(combatant?.specID) || !Array.isArray(combatant.talentTree)) return unavailable('defensive_class_spec_talents_unavailable');
  const loggedCI = streams?.CombatantInfo?.events?.filter((e) => e.type === 'combatantinfo' && e.sourceID === player.id);
  const actor = actors?.find((a) => a.id === player.id && a.type === 'Player');
  if (!actor || actor.subType !== player.className || loggedCI?.length !== 1 || loggedCI[0].specID !== combatant.specID
    || JSON.stringify(loggedCI[0].talentTree) !== JSON.stringify(combatant.talentTree)) return unavailable('defensive_identity_combatant_binding_unverified');
  const durationSec = (fight.endTime - fight.startTime) / 1000;
  const candidate = { identity: { actorID: player.id }, fight: { durationSec }, sourceProof: { streams: streamReceipts(streams, code, fight) } };
  const inspected = inspectOpportunityLedger(opportunityLedger, candidate);
  if (!inspected.valid) return unavailable('defensive_objective_opportunities_unavailable');
  for (const name of ['Healing', 'DamageTaken', 'Buffs', 'CombatantInfo']) if (!validateStream(streams?.[name], name, code, fight).valid)
    return unavailable(`${name}: actual benefit stream unverified`, 'incomplete');
  const usage = buildDefensiveIntervals({ defenses, fight, code, streams, actors });
  if (usage.state !== 'known') return unavailable(usage.reasons[0], usage.state);
  const byID = new Map((actors ?? []).map((a) => [a.id, a]));
  const objectiveByID = new Map(opportunityRules.map((r) => [r.id, r]));
  const eligible = opportunityLedger.records.filter((o) => o.eligibility.eligible);
  if (eligible.some((o) => objectiveByID.get(o.ruleID)?.version !== o.ruleVersion)) return unavailable('defensive_objective_rule_mismatch');
  if (rules.some((r) => r.opportunityRuleIDs.some((id) => !objectiveByID.has(id)))) return unavailable('benefit_references_unknown_objective_rule');
  const applies = (r) => r.classNames.includes(player.className) && r.specIDs.includes(combatant.specID)
    && (r.talentIDs ?? []).every((id) => combatant.talentTree.some((t) => t.id === id && t.rank > 0));
  const matchingEpisodes = (e) => eligible.filter((o) => {
    const rule = objectiveByID.get(o.ruleID), time = (e.timestamp - fight.startTime) / 1000;
    return rule.outcome.abilityIDs.includes(e.type === 'absorbed' ? e.extraAbilityGameID : e.abilityGameID) && time >= o.start && time <= o.end;
  });
  const consumed = streams.Healing.events.map((event, index) => ({ event, index })).filter(({ event: e }) => e.type === 'absorbed' && e.targetID === player.id);
  const records = [];
  try {
    // Aggregate mitigation has no provider/effect identity. Even if an aura is
    // active, it cannot resolve actual attribution. Native shield consumptions
    // can resolve an aggregate absorbed amount, but not aggregate mitigation.
    const absorbedGroups = new Map();
    for (const d of streams.DamageTaken.events) if (d.type === 'damage' && d.targetID === player.id && matchingEpisodes(d).length) {
      if (!finite(d.amount) || d.mitigated != null && !finite(d.mitigated) || d.absorbed != null && !finite(d.absorbed)) throw new Error('actual_benefit_damage_invalid');
      if (d.mitigated > 0) throw new Error('aggregate_mitigation_provider_unresolved');
      if (d.absorbed > 0) {
        const key = `${d.timestamp}:${d.sourceID}:${d.abilityGameID}`;
        absorbedGroups.set(key, (absorbedGroups.get(key) ?? 0) + d.absorbed);
      }
    }
    for (const [key, amount] of absorbedGroups) {
      const native = consumed.filter(({ event: e }) => `${e.timestamp}:${e.attackerID}:${e.extraAbilityGameID}` === key);
      if (!native.length || native.some(({ event: e }) => !finite(e.amount) || !effectKey(e.abilityGameID)
        || resolvePlayerRoot(byID, e.sourceID, fight.friendlyPlayers) === null)
        || native.reduce((sum, { event: e }) => sum + e.amount, 0) !== amount) throw new Error('aggregate_absorption_provider_unresolved');
    }
    for (const { event: e, index } of consumed) {
      const at = (e.timestamp - fight.startTime) / 1000;
      if (!effectKey(e.extraAbilityGameID) && eligible.some((o) => at >= o.start && at <= o.end)) throw new Error('consumed_shield_cause_unavailable');
      const opportunities = matchingEpisodes(e);
      if (!opportunities.length) continue;
      if (opportunities.length !== 1) throw new Error('actual_benefit_episode_ambiguous');
      const o = opportunities[0], objective = objectiveByID.get(o.ruleID), time = (e.timestamp - fight.startTime) / 1000;
      const providerID = resolvePlayerRoot(byID, e.sourceID, fight.friendlyPlayers), attacker = byID.get(e.attackerID);
      const anchor = streams[objective.anchor.stream].events[o.anchorRefs[0].index];
      if (!finite(e.amount) || !effectKey(e.abilityGameID) || !effectKey(e.extraAbilityGameID) || providerID === null
        || attacker?.type !== 'NPC' || attacker.id !== anchor?.sourceID || !objective.anchor.sourceNPCIDs.includes(attacker.gameID)) throw new Error('consumed_shield_native_attribution_unresolved');
      if (e.amount === 0 || providerID !== player.id) continue;
      const matches = rules.filter((r) => applies(r) && r.opportunityRuleIDs.includes(o.ruleID) && r.abilityIDs.includes(e.abilityGameID)
        && r.causeAbilityIDs.includes(e.extraAbilityGameID) && r.schools.includes(objective.outcome.school));
      if (!matches.length) {
        // A reviewed restriction proves inapplicability; an unrepresented
        // self effect or cause is unknown, not a guessed zero-benefit effect.
        const represented = rules.some((r) => r.opportunityRuleIDs.includes(o.ruleID) && r.abilityIDs.includes(e.abilityGameID) && r.causeAbilityIDs.includes(e.extraAbilityGameID));
        if (!represented) throw new Error('consumed_shield_applicability_unreviewed');
        continue;
      }
      if (matches.length !== 1) throw new Error('consumed_shield_rule_ambiguous');
      const rule = matches[0], intervals = (usage.intervals.get(player.id) ?? []).filter((i) => i.personal && i.abilityID === e.abilityGameID && i.start <= time && i.end > time);
      const definition = defenses.find((d) => d.abilityIDs.includes(e.abilityGameID));
      if (!definition?.schools?.includes(objective.outcome.school) || definition.classNames && !definition.classNames.includes(player.className)
        || definition.specIDs && !definition.specIDs.includes(combatant.specID)
        || definition.talentIDs && !definition.talentIDs.every((id) => combatant.talentTree.some((t) => t.id === id && t.rank > 0))) continue;
      if (intervals.length !== 1) throw new Error('consumed_shield_usage_timing_unverified');
      records.push({ id: `${rule.id}:${rule.version}:Healing:${index}:${player.id}`, opportunityID: o.id,
        opportunityRuleID: o.ruleID, opportunityRuleVersion: o.ruleVersion, ruleID: rule.id, ruleVersion: rule.version,
        attribution: 'source-native', method: 'wcl-consumed-shield-v1', effectKind: 'consumed-shield', providerID, targetID: e.targetID,
        abilityID: e.abilityGameID, causeAbilityID: e.extraAbilityGameID, amount: e.amount, minimumBenefit: rule.minimumBenefit,
        time, school: objective.outcome.school, evidenceRefs: [{ stream: 'Healing', index }, ...intervals[0].evidenceRefs, ...o.anchorRefs] });
    }
  } catch (error) { return unavailable(error.message); }
  return { version: BENEFIT_VERSION, state: 'known', records };
}
