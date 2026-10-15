// Hosted adaptations keep the reviewed upstream snapshot immutable. These pure
// helpers are embedded in the generated native module, with no runtime imports.
import { emitHelpers } from './castmirror-emit-helpers.mjs';
export const LOST_EXPLORERS_REVIEW = Object.freeze({
  version: 'lost-explorers-mythic-contact-1',
  scope: { zone: 53, encounter: 3497, difficulty: 5, size: 20, partition: 2, patch: '12.1.5' },
  abilities: [
    { abilityID: 1305844, name: 'Blast Wave' },
    { abilityID: 1297650, name: 'Spreading Flames' },
    { abilityID: 1306127, name: 'Throw Junk' },
    { abilityID: 1292764, name: 'Evil Eyes' },
  ],
  sources: [
    'https://www.wowhead.com/spell=1305844/blast-wave',
    'https://www.wowhead.com/spell=1297650/spreading-flames',
    'https://www.wowhead.com/spell=1306127/throw-junk',
    'https://www.wowhead.com/spell=1292764/evil-eyes',
  ],
});

export function reviewedEncounterRules(scope, fallback, review) {
  if (!Object.entries(review.scope).every(([key, value]) => scope?.[key] === value)) return fallback;
  return { ...fallback, avoidableAbilityIDs: review.abilities.map((ability) => ability.abilityID) };
}

export function retainAvoidanceEvidence(component, review, original = component?.measurements) {
  const measurements = component?.measurements;
  const ids = component?.definition?.abilityIDs;
  if (!measurements || !Array.isArray(ids) || !ids.length || ids.length > 32
      || !Array.isArray(measurements.incidents)) return;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!finite(measurements.total) || !Number.isSafeInteger(measurements.hits) || measurements.hits < 0) {
    delete measurements.byAbility; delete measurements.incidents; return;
  }
  const names = new Map(review.abilities.map((ability) => [ability.abilityID, ability.name]));
  const byAbility = new Map(ids.map((abilityID) => [abilityID,
    { abilityID, name: names.get(abilityID) ?? 'Ability ' + abilityID, hits: 0, total: 0, absorbed: 0, mitigated: 0 }]));
  const saved = original?.byAbility;
  // Hydration compacts cached observations again. Keep reconciled full totals
  // instead of deriving new aggregates from the capped timestamp sample.
  if (saved !== undefined) {
    const valid = Array.isArray(saved) && saved.length === ids.length
      && new Set(saved.map((row) => row?.abilityID)).size === ids.length
      && saved.every((row) => byAbility.has(row?.abilityID) && Number.isSafeInteger(row.hits) && row.hits >= 0
        && ['total', 'absorbed', 'mitigated'].every((key) => finite(row[key])))
      && saved.reduce((sum, row) => sum + row.hits, 0) === measurements.hits
      && Math.abs(saved.reduce((sum, row) => sum + row.total, 0) - measurements.total) <= Math.max(0.001, measurements.total * 1e-9)
      && original.incidentCount === measurements.hits
      && original.incidentListComplete === (measurements.incidents.length === original.incidentCount);
    if (!valid) { delete measurements.byAbility; delete measurements.incidents; return; }
  }
  const incidents = [];
  for (const event of measurements.incidents) {
    const row = byAbility.get(event?.abilityID);
    if (!row || !['time', 'amount'].every((key) => typeof event[key] === 'number' && Number.isFinite(event[key]) && event[key] >= 0)) {
      // Never attach a complete-looking breakdown to malformed evidence.
      delete measurements.byAbility;
      delete measurements.incidents;
      return;
    }
    row.hits++; row.total += event.amount;
    for (const key of ['absorbed', 'mitigated']) {
      if (typeof event[key] === 'number' && Number.isFinite(event[key]) && event[key] >= 0) row[key] += event[key];
    }
    if (incidents.length < 60) incidents.push(Object.fromEntries(['time', 'abilityID', 'amount', 'absorbed', 'mitigated']
      .filter((key) => typeof event[key] === 'number' && Number.isFinite(event[key]) && event[key] >= 0)
      .map((key) => [key, event[key]])));
  }
  if ([...byAbility.values()].some((row) => !['total', 'absorbed', 'mitigated'].every((key) => Number.isFinite(row[key])))) {
    delete measurements.byAbility; delete measurements.incidents; return;
  }
  const rows = saved === undefined ? [...byAbility.values()] : saved.map((row) => ({
    abilityID: row.abilityID, name: names.get(row.abilityID) ?? 'Ability ' + row.abilityID,
    hits: row.hits, total: row.total, absorbed: row.absorbed, mitigated: row.mitigated,
  }));
  if (saved === undefined && (measurements.hits !== measurements.incidents.length
    || Math.abs(rows.reduce((sum, row) => sum + row.total, 0) - measurements.total) > Math.max(0.001, measurements.total * 1e-9))) {
    delete measurements.byAbility; delete measurements.incidents; return;
  }
  measurements.byAbility = rows;
  measurements.incidentCount = measurements.hits;
  measurements.incidentListComplete = incidents.length === measurements.hits;
  measurements.incidents = incidents;
}

export function adaptNativeExecutionEvidence(name, source) {
  if (name !== 'execution/live.mjs') return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Execution evidence anchor missing or ambiguous');
    source = source.replace(before, after);
  };
  replace("export const LIVE_RULES_VERSION = 'native-live-statistics-2';",
    `const LOST_EXPLORERS_REVIEW = ${JSON.stringify(LOST_EXPLORERS_REVIEW)};\n${emitHelpers(import.meta.url, ['reviewedEncounterRules', 'retainAvoidanceEvidence'])}\nexport const LIVE_RULES_VERSION = 'native-live-statistics-3';`);
  replace('  delete compact.components.avoidance.measurements.incidents;',
    '  retainAvoidanceEvidence(compact.components.avoidance, LOST_EXPLORERS_REVIEW, observation.components.avoidance.measurements);');
  replace('  // Aggregate avoidance and rejected-cast totals are sufficient for this UI.\n  // Do not retain potentially large incident/display lists in a live pool.',
    '  // Retain complete per-ability totals plus at most 60 safe incident markers.');
  replace('  return { version: LIVE_RULES_VERSION, defensives: structuredClone(reviewed.defensives),',
    '  return reviewedEncounterRules(scope, { version: LIVE_RULES_VERSION, defensives: structuredClone(reviewed.defensives),');
  replace('    nativeBossOutput: true };', '    nativeBossOutput: true }, LOST_EXPLORERS_REVIEW);');
  replace("            statisticsRules: liveStatisticsRules(boundScope), statisticsStreams: ['Deaths', 'Casts'], targetsFirst: true,",
    `            statisticsRules: liveStatisticsRules(boundScope),
            statisticsStreams: liveStatisticsRules(boundScope).avoidableAbilityIDs.length > 0
              && [base.a, base.b].some((side) => side.code === candidate.code && side.fightID === candidate.fightID)
              ? ['Deaths', 'DamageTaken', 'Casts'] : ['Deaths', 'Casts'], targetsFirst: true,`);
  replace('      for (const name of priority) for (const input of inputs.values()) {\n        try {',
    `      for (const name of priority) for (const input of inputs.values()) {
        // Selected reviewed damage is collected before optional cohort expansion.
        // Keep completed or capped initial streams; never replay their pages.
        if (input.streams[name]) continue;
        try {`);
  replace("const MEASUREMENT_FIELDS = ['total', 'perSecond', 'damage', 'hits', 'complete', 'basis', 'exposure', 'deathCount',",
    "const MEASUREMENT_FIELDS = ['byAbility', 'incidents', 'incidentCount', 'incidentListComplete', 'total', 'perSecond', 'damage', 'hits', 'complete', 'basis', 'exposure', 'deathCount',");
  return source;
}
