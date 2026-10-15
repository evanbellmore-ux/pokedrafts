import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, test } from 'vitest';
import { adaptExecutionReview, executionReviewAbilities, executionReviewPair } from '../../scripts/castmirror-execution-review.mjs';
import { pageFixture } from '../helpers/castmirror-page.mjs';

const source = readFileSync(new URL('../../vendor/castmirror/upstream/index.html', import.meta.url), 'utf8');
const adapted = adaptExecutionReview(source);
const emitted = adapted.split('// BEGIN CASTMIRROR EXECUTION REVIEW\n')[1].split('// END CASTMIRROR EXECUTION REVIEW')[0];
function evidence() {
  const side = (hits: number, total: number, casts: number) => ({
    score: 99,
    scope: { zone: 53, encounter: 3480, difficulty: 5, size: 20, partition: 1, patch: '12.1', kill: true },
    components: {
      avoidance: {
        state: 'known', value: total / 300, score: 99,
        definition: { id: 'reviewed-avoidable-damage-per-fight-second-v1', abilityIDs: [1305844, 1297650], rulesVersion: 'explorers-review' },
        measurements: { complete: true, basis: 'complete-native-total', exposure: 'full-fight', hits, total, perSecond: total / 300,
          byAbility: [{ abilityID: 1305844, name: 'Evil Eyes', hits, total }, { abilityID: 1297650, name: 'Reviewed ground effect', hits: 0, total: 0 }] },
      },
      survival: { state: 'known', value: 0, measurements: { complete: true, deathCount: 0, firstDeathSec: null, aliveTimeSec: 300 } },
      defenses: { state: 'known', value: casts / 5, measurements: { complete: true, boundedUses: casts,
        abilities: [{ name: 'Blur', boundedUses: casts }] } },
      incoming: { state: 'missing', measurements: {} },
      output: { state: 'known', value: 999999, score: 100, measurements: { complete: true, perSecond: 999999 } },
      healing: { state: 'incomplete', value: 100, measurements: { complete: false, basis: 'observed-lower-bound', perSecond: 100 } },
    },
  });
  return { a: side(4, 920753, 3), b: side(0, 0, 4) };
}

describe('CastMirror focused execution review', () => {
  test('compares reviewed rates directly without requiring a cohort or inventing a zero-reference percent', () => {
    const pair = executionReviewPair(evidence());
    assert.equal(pair.comparable, true);
    assert.equal(pair.delta, 920753 / 300);
    assert.equal(pair.percent, null);
  });

  test('requires matching complete definitions, scope and full-fight exposure', () => {
    for (const change of ['incomplete', 'definition', 'scope', 'exposure']) {
      const execution = evidence();
      if (change === 'incomplete') execution.b.components.avoidance.measurements.complete = false;
      if (change === 'definition') execution.b.components.avoidance.definition.rulesVersion = 'other-review';
      if (change === 'scope') execution.b.scope.difficulty = 4;
      if (change === 'exposure') execution.b.components.avoidance.measurements.exposure = 'unreliable-after-death-or-missing-deaths';
      assert.equal(executionReviewPair(execution).comparable, false, change);
    }
  });

  test('treats unsupported avoidance as unreviewed evidence rather than zero mistakes', () => {
    const execution = evidence(); execution.a.components.avoidance.state = 'unsupported';
    const pair = executionReviewPair(execution);
    assert.equal(pair.comparable, false);
    assert.match(pair.reason ?? '', /not been reviewed.*not zero mistakes/);
  });

  test('accepts an identical reviewed ability set regardless of ID order', () => {
    const execution = evidence(); execution.b.components.avoidance.definition.abilityIDs.reverse();
    assert.equal(executionReviewPair(execution).comparable, true);
  });

  test('reconciles per-ability totals before comparing and preserves absent breakdowns', () => {
    const component = evidence().a.components.avoidance;
    assert.equal(executionReviewAbilities(component)?.complete, true);
    component.measurements.byAbility[0].total = 1;
    assert.equal(executionReviewAbilities(component)?.complete, false);
    assert.equal(executionReviewAbilities({ state: 'known', measurements: { complete: true, total: 0 } }), null);
    assert.equal(executionReviewAbilities({ state: 'incomplete', definition: { abilityIDs: [1292764] },
      measurements: { complete: false, basis: 'unavailable', total: null, hits: null, incidents: [] } }), null);
  });

  test('groups repeated incident ticks and retains timestamps without inferring mechanic opportunities', () => {
    const component = { state: 'known', definition: { abilityIDs: [123] },
      measurements: { complete: true, hits: 2, total: 30,
        incidents: [{ abilityID: 123, amount: 10, time: 20 }, { abilityID: 123, amount: 20, time: 21 }] } };
    const detail = executionReviewAbilities(component);
    assert.equal(detail?.complete, true);
    assert.deepEqual(detail?.groups[0], { abilityID: 123, name: 'Spell 123', hits: 2, total: 30, times: [20, 21] });
  });

  test('retains incident samples beside complete per-ability aggregates', () => {
    const component = { ...evidence().a.components.avoidance, measurements: {
      ...evidence().a.components.avoidance.measurements,
      incidents: [{ abilityID: 1305844, amount: 1, time: 12.5 }], incidentListComplete: false,
    } };
    const details = executionReviewAbilities(component);
    assert.equal(details?.complete, true);
    assert.deepEqual(details?.groups[0].times, [12.5]);
    assert.equal(details?.groups[0].total, 920753);
  });

  test('shows precise incident times without presenting a volley as separate mistakes', async () => {
    const p = await pageFixture(); p.evaluate(emitted);
    assert.equal(p.evaluate('executionReviewTime(59.453)'), '00:59.5');
    assert.equal(p.evaluate('executionReviewTime(60.710)'), '01:00.7');
    assert.equal(p.evaluate('executionReviewTime(59.999)'), '01:00.0');
    assert.match(emitted, /Hits \/ ticks do not count distinct mistakes/);
  });

  test('emits valid portable browser code and refuses changed anchors', () => {
    new Script(emitted);
    assert.match(adapted, /executionReviewBoard\(D\.execution\[key\]\)/);
    assert.doesNotMatch(adapted, /<span>Execution rating<\/span>/);
    assert.throws(() => adaptExecutionReview(source.replace('function renderExecutionStatistics(D, execution)', 'function renamedStatistics(D, execution)')), /anchor changed/);
  });

  test('renders the real-log pattern as a limited mechanics review with named evidence and all six categories', async () => {
    const p = await pageFixture();
    p.evaluate(emitted);
    const execution = evidence();
    const D = { a: { name: 'Bstay', code: 'Player0123456789', fightID: 7, actorID: 123, durSec: 300 },
      b: { name: 'Bladecrazy', code: 'Overall012345678', fightID: 8, actorID: 234, durSec: 300 } };
    p.evaluate(`renderExecutionStatistics(${JSON.stringify(D)}, ${JSON.stringify(execution)})`);
    const html = p.nodes.get('executionBreakdown').htmlTree();
    assert.match(p.nodes.get('executionSummary').textContent, /Mechanics: Needs review.*reference took zero/);
    assert.match(html, /920,753 health damage/);
    assert.match(html, /4 hits \/ ticks/);
    assert.match(html, /Evil Eyes/);
    assert.match(html, /Blur: 3/);
    assert.match(html, /Blur: 4/);
    assert.match(html, /excluded from non-damage assessment/);
    assert.match(html, /Incomplete observations are lower bounds/);
    assert.doesNotMatch(html, /99 \/ 100|Execution rating|Infinity/);
    const categories = p.nodes.get('executionBreakdown').querySelectorAll('tr').map((row: { dataset: { category?: string } }) => row.dataset.category).filter(Boolean);
    assert.deepEqual(categories, ['avoidance', 'survival', 'defenses', 'incoming', 'output', 'healing']);
    const links = p.nodes.get('executionBreakdown').querySelectorAll('a');
    assert.equal(links.length, 2);
    assert.match(links[0].href, /warcraftlogs\.com\/reports\/Player0123456789#fight=7&type=damage-taken&source=123/);
    assert.match(p.evaluate(`executionReviewBoard(${JSON.stringify(execution.a)})`), /Mechanics: Needs review.*4 reviewed avoidable hits/);
    assert.match(html, /Main reviewed issue: Evil Eyes.*reference 0 hits/);
    assert.match(html, /Personal defensive casts: Blur: 3 vs 4/);
    assert.match(adapted, /execution-mechanics-table-scroll.*max-width: 100%; overflow-x: auto/);
  });

  test('per-ability gaps use exact full-alive durations instead of rounded board durations', async () => {
    const p = await pageFixture(); p.evaluate(emitted);
    const execution = evidence();
    execution.a.components.survival.measurements = { complete: true, deathCount: 0, firstDeathSec: null, aliveTimeSec: 363.498 };
    execution.b.components.survival.measurements = { complete: true, deathCount: 0, firstDeathSec: null, aliveTimeSec: 331.201 };
    execution.a.components.avoidance.measurements.perSecond = 920753 / 363.498;
    const D = { a: { name: 'Selected', durSec: 363 }, b: { name: 'Reference', durSec: 331 } };
    p.evaluate(`renderExecutionStatistics(${JSON.stringify(D)}, ${JSON.stringify(execution)})`);
    assert.match(p.nodes.get('executionBreakdown').htmlTree(), /2,533 more/);
  });

  test('rounds observed lower bounds down so formatting cannot inflate incomplete damage', async () => {
    const p = await pageFixture(); p.evaluate(emitted);
    p.evaluate(`$('executionBreakdown').append(executionReviewCell('avoidance', { state: 'incomplete', measurements: {
      complete: false, basis: 'observed-lower-bound', total: 15.9, hits: 1, perSecond: 1.99
    } }))`);
    const html = p.nodes.get('executionBreakdown').htmlTree();
    assert.match(html, /≥ 15 health damage/);
    assert.match(html, /≥ 1.9 damage \/ sec/);
    assert.doesNotMatch(html, /≥ 16 health damage|≥ 2 damage/);
  });
});
