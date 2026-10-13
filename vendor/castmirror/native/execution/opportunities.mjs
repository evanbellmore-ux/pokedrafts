// Pure, reviewed mechanic episodes. Player actions never create denominators.
import { OPPORTUNITY_VERSION, playerID, metadataID, abilityKey, validateStream } from './contracts.mjs';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const keys = (v) => Array.isArray(v) && v.length > 0 && v.every(abilityKey) && new Set(v).size === v.length;
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const unavailable = (reason, state = 'unsupported') => ({ version: OPPORTUNITY_VERSION, state, records: [], reasons: [reason] });

export function validateObjectiveRule(r) {
  if (!only(r, ['id', 'version', 'reviewed', 'evidenceRefs', 'components', 'anchor', 'window', 'eligibility', 'applicability', 'outcome'])
    || !text(r.id) || !text(r.version) || r.reviewed !== true || !Array.isArray(r.evidenceRefs) || !r.evidenceRefs.length || !r.evidenceRefs.every(text)
    || !Array.isArray(r.components) || !r.components.length || !r.components.every((c) => ['avoidance', 'defenses'].includes(c)) || new Set(r.components).size !== r.components.length
    || !only(r.anchor, ['stream', 'abilityIDs', 'sourceNPCIDs', 'mode', 'link']) || !keys(r.anchor.abilityIDs) || !keys(r.anchor.sourceNPCIDs)
    || !only(r.window, ['offsetSec', 'durationSec']) || !finite(r.window.offsetSec) || !finite(r.window.durationSec) || r.window.durationSec <= 0
    || !only(r.eligibility, ['basis']) || !['raidwide', 'explicit-target'].includes(r.eligibility.basis)
    || !only(r.applicability, ['method'])
    || !only(r.outcome, ['method', 'abilityIDs', 'school', 'necessaryPressure']) || r.outcome.method !== 'damage-absence-v1'
    || !keys(r.outcome.abilityIDs) || !text(r.outcome.school) || r.outcome.necessaryPressure !== undefined && r.outcome.necessaryPressure !== true) return false;
  const a = r.anchor;
  if (a.stream === 'EnemyCasts') {
    if (!['cast-attempt', 'cast-complete'].includes(a.mode) || !only(a.link, ['method', 'maxCastMs'])
      || a.link.method !== 'source-ability-target-window-v1' || !finite(a.link.maxCastMs) || a.link.maxCastMs <= 0) return false;
    return a.mode === 'cast-complete' ? r.applicability.method === 'anchor-emits-v1'
      : ['attempt-emits-v1', 'completion-or-native-interrupt-v1'].includes(r.applicability.method);
  }
  return a.stream === 'Debuffs' && a.mode === 'debuff-episode' && only(a.link, ['method'])
    && a.link.method === 'debuff-lifecycle-v1' && r.applicability.method === 'anchor-emits-v1';
}

function castEpisodes(rule, events) {
  const episodes = [], active = new Map();
  for (const { event: e, index } of events) {
    if (!['begincast', 'cast'].includes(e.type)) throw new Error('hostile_cast_transition_unreviewed');
    // A source cannot have two concurrent copies of the same cast. A missing
    // target on one half may link only when there is a single compatible half.
    const key = `${e.sourceID}:${e.abilityGameID}`;
    if (e.targetID != null && !metadataID(e.targetID)) throw new Error('invalid_cast_target');
    const begin = active.get(key);
    if (e.type === 'begincast') {
      if (begin && e.timestamp - begin.event.timestamp <= rule.anchor.link.maxCastMs) throw new Error('ambiguous_cast_attempt_link');
      const episode = { event: e, refs: [{ stream: 'EnemyCasts', index }], completed: false };
      active.set(key, episode);
      if (rule.anchor.mode === 'cast-attempt') episodes.push(episode);
    } else {
      if (begin && e.timestamp - begin.event.timestamp <= rule.anchor.link.maxCastMs) {
        if (begin.event.targetID != null && e.targetID != null && begin.event.targetID !== e.targetID) throw new Error('cast_target_changed');
        begin.refs.push({ stream: 'EnemyCasts', index });
        begin.completed = true;
        begin.targetID = e.targetID ?? begin.event.targetID;
        begin.completionTime = e.timestamp;
        if (rule.anchor.mode === 'cast-complete') episodes.push({ ...begin, event: e });
        active.delete(key);
      } else {
        if (rule.anchor.mode === 'cast-attempt') throw new Error('cast_attempt_begin_missing');
        episodes.push({ event: e, refs: [{ stream: 'EnemyCasts', index }], completed: true, targetID: e.targetID, completionTime: e.timestamp });
      }
    }
  }
  if (rule.anchor.mode === 'cast-complete' && active.size) throw new Error('unresolved_cast_attempt');
  return episodes;
}

function debuffEpisodes(events) {
  const episodes = [], active = new Map();
  for (const { event: e, index } of events) {
    if (!['applydebuff', 'refreshdebuff', 'removedebuff'].includes(e.type)) throw new Error('debuff_transition_unreviewed');
    if (!playerID(e.targetID)) throw new Error('invalid_debuff_target');
    const key = `${e.sourceID}:${e.targetID}:${e.abilityGameID}`;
    if (e.type === 'applydebuff') {
      if (active.has(key)) throw new Error('ambiguous_debuff_episode');
      const episode = { event: e, targetID: e.targetID, refs: [{ stream: 'Debuffs', index }], completed: true };
      active.set(key, episode); episodes.push(episode);
    } else {
      const episode = active.get(key);
      if (!episode) throw new Error('debuff_application_missing');
      episode.refs.push({ stream: 'Debuffs', index });
      if (e.type === 'removedebuff') active.delete(key);
    }
  }
  return episodes;
}

export function buildOpportunityLedger({ rules, actorID, fight, code, streams, actors }) {
  if (!Array.isArray(rules) || !rules.length || !rules.every(validateObjectiveRule) || new Set(rules.map((r) => r.id)).size !== rules.length)
    return unavailable('reviewed_objective_rules_unavailable');
  const roster = fight?.friendlyPlayers;
  if (!playerID(actorID) || !Array.isArray(roster) || !roster.includes(actorID) || roster.length !== fight.size
    || !roster.every(playerID) || new Set(roster).size !== roster.length || !finite(fight.startTime) || !finite(fight.endTime) || fight.endTime <= fight.startTime)
    return unavailable('objective_roster_or_fight_unverified');
  if (!Array.isArray(actors) || actors.some((a) => !metadataID(a?.id)) || new Set(actors.map((a) => a.id)).size !== actors.length)
    return unavailable('objective_actor_identities_unavailable');
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  if (roster.some((id) => actorMap.get(id)?.type !== 'Player')) return unavailable('objective_friendly_roster_unverified');
  const required = new Set(['DamageTaken', ...rules.map((r) => r.anchor.stream)]);
  if (rules.some((r) => r.anchor.stream === 'Debuffs')) required.add('CombatantInfo');
  if (rules.some((r) => r.applicability.method === 'completion-or-native-interrupt-v1')) required.add('Interrupts');
  for (const name of required) if (!validateStream(streams?.[name], name, code, fight).valid)
    return unavailable(`${name}: objective stream unverified`, streams?.[name]?.state === 'missing' ? 'missing' : 'incomplete');
  const records = [], matchedDamage = new Set();
  try {
    for (const rule of rules) {
      const events = streams[rule.anchor.stream].events.map((event, index) => ({ event, index })).filter(({ event: e }) => {
        const source = actorMap.get(e.sourceID);
        if (!abilityKey(e.abilityGameID) && source?.type === 'NPC' && rule.anchor.sourceNPCIDs.includes(source.gameID)) throw new Error('hostile_anchor_ability_unavailable');
        if (!rule.anchor.abilityIDs.includes(e.abilityGameID)) return false;
        if (!source || source.type !== 'NPC' || !abilityKey(source.gameID)) throw new Error('hostile_anchor_source_unverified');
        return rule.anchor.sourceNPCIDs.includes(source.gameID);
      }).sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index);
      if (rule.anchor.stream === 'Debuffs') for (const id of roster) {
        const ci = streams.CombatantInfo.events.filter((e) => e.type === 'combatantinfo' && e.sourceID === id);
        if (ci.length !== 1 || !Array.isArray(ci[0].auras)) throw new Error('debuff_initial_game_state_unavailable');
        for (const aura of ci[0].auras) if (rule.anchor.abilityIDs.includes(aura.ability)
          && !events.some(({ event: e }) => e.type === 'applydebuff' && e.timestamp === fight.startTime && e.sourceID === aura.source && e.targetID === id && e.abilityGameID === aura.ability))
          throw new Error('initial_debuff_has_no_independent_application_anchor');
      }
      const episodes = rule.anchor.stream === 'EnemyCasts' ? castEpisodes(rule, events) : debuffEpisodes(events);
      for (const episode of episodes) {
        const e = episode.event, targetID = episode.targetID ?? e.targetID;
        let applicability = true, applicabilityRefs = episode.refs;
        if (rule.applicability.method === 'completion-or-native-interrupt-v1') {
          const cancellations = streams.Interrupts.events.map((event, index) => ({ event, index })).filter(({ event: i }) => i.type === 'interrupt'
            && i.targetID === e.sourceID && i.extraAbilityGameID === e.abilityGameID && i.timestamp >= e.timestamp
            && i.timestamp <= e.timestamp + rule.anchor.link.maxCastMs);
          if (cancellations.length > 1 || episode.completed && cancellations.some(({ event: i }) => i.timestamp <= episode.completionTime)) throw new Error('ambiguous_attempt_cancellation');
          if (!episode.completed) {
            if (cancellations.length !== 1) throw new Error('attempt_applicability_unavailable');
            const cancel = cancellations[0];
            if (!roster.includes(cancel.event.sourceID)) throw new Error('interrupt_source_unverified');
            applicability = false;
            applicabilityRefs = [...episode.refs, { stream: 'Interrupts', index: cancel.index }];
          }
        }
        if (rule.eligibility.basis === 'explicit-target' && !roster.includes(targetID)) throw new Error('explicit_anchor_target_unverified');
        const anchorTime = applicability && rule.applicability.method === 'completion-or-native-interrupt-v1' ? episode.completionTime : e.timestamp;
        const start = (anchorTime - fight.startTime) / 1000 + rule.window.offsetSec;
        const end = start + rule.window.durationSec;
        if (start < 0 || end > (fight.endTime - fight.startTime) / 1000) throw new Error('objective_window_truncated');
        const eligible = applicability && (rule.eligibility.basis === 'raidwide' || targetID === actorID);
        const inWindow = streams.DamageTaken.events.map((event, index) => ({ event, index })).filter(({ event: d }) => d.type === 'damage'
          && d.targetID === actorID && (d.timestamp - fight.startTime) / 1000 >= start && (d.timestamp - fight.startTime) / 1000 <= end);
        if (inWindow.some(({ event: d }) => !abilityKey(d.abilityGameID))) throw new Error('objective_damage_ability_unavailable');
        const hits = inWindow.filter(({ event: d }) => rule.outcome.abilityIDs.includes(d.abilityGameID));
        if (!eligible && hits.length) throw new Error('damage_conflicts_with_objective_eligibility');
        for (const { event: d, index } of hits) {
          if (!finite(d.amount) || d.sourceID !== e.sourceID || !actorMap.has(d.sourceID) || actorMap.get(d.sourceID).type !== 'NPC'
            || !rule.anchor.sourceNPCIDs.includes(actorMap.get(d.sourceID).gameID)) throw new Error('objective_damage_attribution_unverified');
          if (matchedDamage.has(index)) throw new Error('ambiguous_damage_episode_link');
          matchedDamage.add(index);
        }
        records.push({ id: `${rule.id}:${rule.version}:${rule.anchor.stream}:${episode.refs[0].index}:${actorID}`,
          ruleID: rule.id, ruleVersion: rule.version, unit: 'mechanic-episode', actorID, start, end, anchorRefs: episode.refs,
          eligibility: { state: 'known', eligible, basis: rule.eligibility.basis, evidenceRefs: applicabilityRefs },
          outcome: { state: 'known', result: eligible ? hits.length ? 'fail' : 'pass' : 'not-applicable',
            evidenceRefs: hits.length ? hits.map(({ index }) => ({ stream: 'DamageTaken', index }))
              : !applicability ? applicabilityRefs : [{ stream: 'DamageTaken', complete: true }] } });
      }
    }
  } catch (error) { return unavailable(error.message); }
  return { version: OPPORTUNITY_VERSION, state: 'known', records };
}
