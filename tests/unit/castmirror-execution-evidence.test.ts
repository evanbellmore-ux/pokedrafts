import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { LOST_EXPLORERS_REVIEW, reviewedEncounterRules, retainAvoidanceEvidence } from '../../scripts/castmirror-execution-evidence.mjs';
import { liveStatisticsRules, publicStatisticsEvaluation } from '../../vendor/castmirror/native/execution/live.mjs';

describe('reviewed Lost Explorers damage evidence', () => {
  test('only the reviewed Mythic patch scope enables the four contact abilities', () => {
    const scope = { ...LOST_EXPLORERS_REVIEW.scope };
    const expected = LOST_EXPLORERS_REVIEW.abilities.map((ability: { abilityID: number }) => ability.abilityID);
    assert.deepEqual(liveStatisticsRules(scope).avoidableAbilityIDs, expected);
    for (const key of Object.keys(scope)) {
      const changed = { ...scope, [key]: typeof scope[key as keyof typeof scope] === 'number' ? 999 : 'unverified' };
      assert.deepEqual(liveStatisticsRules(changed).avoidableAbilityIDs, []);
    }
    const fallback = { avoidableAbilityIDs: [], defensives: [{ abilityID: 198589 }] };
    assert.equal(reviewedEncounterRules({}, fallback, LOST_EXPLORERS_REVIEW), fallback);
    assert.deepEqual(reviewedEncounterRules(scope, fallback, LOST_EXPLORERS_REVIEW).defensives, fallback.defensives);
    for (const id of [1310500, 1312853, 1300237, 1297648, 1310662, 1294334]) assert.ok(!expected.includes(id));
  });

  test('bounded incident details retain complete per-ability totals and distinguish zero from missing', () => {
    const component = { definition: { abilityIDs: LOST_EXPLORERS_REVIEW.abilities.map((a: { abilityID: number }) => a.abilityID) },
      measurements: { total: 960, hits: 80, incidents: Array.from({ length: 80 }, (_, time) => ({ time, abilityID: 1292764, amount: 12, absorbed: 3, mitigated: 2, sourceID: 'private' })) } };
    retainAvoidanceEvidence(component, LOST_EXPLORERS_REVIEW);
    const m = component.measurements as unknown as {
      incidents: Array<{ time: number; abilityID: number; amount: number; absorbed: number; mitigated: number }>;
      incidentCount: number;
      incidentListComplete: boolean;
      byAbility: Array<{ abilityID: number; name: string; hits: number; total: number; absorbed: number; mitigated: number }>;
    };
    assert.equal(m.incidents.length, 60); assert.equal(m.incidentCount, 80); assert.equal(m.incidentListComplete, false);
    assert.deepEqual(m.byAbility.find((a: { abilityID: number }) => a.abilityID === 1292764),
      { abilityID: 1292764, name: 'Evil Eyes', hits: 80, total: 960, absorbed: 240, mitigated: 160 });
    assert.deepEqual(Object.keys(m.incidents[0]), ['time', 'abilityID', 'amount', 'absorbed', 'mitigated']);
    assert.ok(m.byAbility.filter((a: { abilityID: number }) => a.abilityID !== 1292764).every((a: { hits: number; total: number }) => a.hits === 0 && a.total === 0));
    const hydrated = { definition: component.definition, measurements: { total: 960, hits: 80, incidents: structuredClone(m.incidents) } };
    retainAvoidanceEvidence(hydrated, LOST_EXPLORERS_REVIEW, m);
    assert.deepEqual(hydrated.measurements, component.measurements, 'cache hydration keeps full totals and truncated timestamp samples');
    const corrupted = { ...structuredClone(m), incidentCount: 60, incidentListComplete: true };
    const invalid = { definition: component.definition, measurements: { total: 960, hits: 80, incidents: structuredClone(m.incidents) } };
    retainAvoidanceEvidence(invalid, LOST_EXPLORERS_REVIEW, corrupted);
    assert.equal('byAbility' in invalid.measurements, false, 'inconsistent cached metadata cannot invent a complete breakdown');
    const unavailable = { definition: { abilityIDs: [1292764] }, measurements: {} };
    retainAvoidanceEvidence(unavailable, LOST_EXPLORERS_REVIEW);
    assert.deepEqual(unavailable.measurements, {});
  });

  test('malformed events do not produce a complete-looking breakdown', () => {
    for (const incident of [{ time: 1, abilityID: 999, amount: 3 }, { time: 1, abilityID: 1292764, amount: NaN }]) {
      const component = { definition: { abilityIDs: [1292764] }, measurements: { total: 3, hits: 1, incidents: [incident] } };
      retainAvoidanceEvidence(component, LOST_EXPLORERS_REVIEW);
      assert.equal('byAbility' in component.measurements, false);
      assert.equal('incidents' in component.measurements, false);
    }
  });

  test('public projection retains safe evidence and excludes arbitrary measurement properties', () => {
    const components = Object.fromEntries(['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing'].map((name) => [name,
      { measurements: { byAbility: [{ abilityID: 1292764, name: 'Evil Eyes', hits: 1, total: 12 }], incidents: [{ time: 1, abilityID: 1292764, amount: 12 }], incidentCount: 1, incidentListComplete: true, secret: 'excluded' } }]));
    const result = publicStatisticsEvaluation({ components });
    assert.equal(result.components.avoidance.measurements.byAbility[0].name, 'Evil Eyes');
    assert.equal(result.components.avoidance.measurements.incidents[0].time, 1);
    assert.equal('secret' in result.components.avoidance.measurements, false);
  });

  test('an empty incomplete stream cannot become observed zero mechanics', () => {
    const component = { definition: { abilityIDs: [1292764] }, measurements: { total: null, hits: null, incidents: [] } };
    retainAvoidanceEvidence(component, LOST_EXPLORERS_REVIEW);
    assert.equal('byAbility' in component.measurements, false);
    assert.equal('incidents' in component.measurements, false);
  });
});
