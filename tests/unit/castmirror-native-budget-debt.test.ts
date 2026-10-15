import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { LIVE_LIMITS, stageLiveJob, validateLiveLedger } from '../../vendor/castmirror/native/execution/live-budget.mjs';
import { stageLiveJob as stagePinnedSourceJob } from '../../vendor/castmirror/native-upstream/execution/live-budget.mjs';
import { MaintenanceBudget } from '../../vendor/castmirror/native/execution/maintenance.mjs';

const NOW = 1_000_000;
const JOB = '11111111-1111-4111-8111-111111111111';
type Stage = (ledger: unknown, options: {
  state: unknown; jobID: string; accountingFailure?: string | null;
}) => { ledger: ReturnType<typeof stageLiveJob>['ledger']; accountingFailure: string | null };
// JS defaults underdescribe optional state/limits and non-null failure codes.
const stageJob = stageLiveJob as unknown as Stage;
const stageSourceJob = stagePinnedSourceJob as unknown as Stage;
const Budget = MaintenanceBudget as unknown as new (options: {
  state?: unknown; limits: typeof LIVE_LIMITS; now: () => number;
}) => InstanceType<typeof MaintenanceBudget>;

// Synthetic quota clocks reproduce the two accepted observations whose combined
// drift exceeds the canonical window. No character, report or account is retained.
function driftFixture() {
  const clock = NOW - 1_000;
  const budget = new Budget({ limits: LIVE_LIMITS, now: () => clock });
  const before = budget.snapshot(); budget.close();
  const canonicalReset = NOW + 100_000;
  before.lastObservedAt = NOW;
  before.counters.graphql = before.counters.network = 2;
  before.unmeasuredGraphql = 1;
  before.points = { limit: 2_000, spent: 10, resetIn: (canonicalReset + 1_427 - NOW) / 1_000,
    measuredAt: NOW, allowance: 150, jobSpent: 4 };
  const window = { limit: 2_000, resetAt: canonicalReset, pointEstimate: 8,
    native: { spent: 10, measuredAt: NOW }, legacy: null };
  const ledger = { version: 'execution-v3-live-account-1', updatedAt: NOW, windows: [window], jobs: [{
    id: JOB, window: JSON.stringify([window.limit, window.resetAt]), charged: 4, pending: 8,
    terminal: false, accountingFailure: null, uncertainUntil: null, budget: before,
  }] };
  const measuredAt = NOW + 1_000;
  const inner = new Budget({ state: before, limits: LIVE_LIMITS, now: () => measuredAt });
  inner.observeQuota({ limitPerHour: 2_000, pointsSpentThisHour: 11,
    pointsResetIn: (canonicalReset + 1_427 + 9_000 - measuredAt) / 1_000 });
  const incoming = inner.snapshot(); inner.close();
  assert.equal(incoming.unmeasuredGraphql, 0); // Inner measurement accepted the 9s drift.
  return { ledger, incoming, canonicalReset };
}

describe('source-pinned hosted quota failure debt preservation', () => {
  test('canonical reset drift preserves unresolved dispatch debt instead of publishing a refund', () => {
    const { ledger, incoming, canonicalReset } = driftFixture();
    const original = structuredClone(ledger), observed = structuredClone(incoming);
    const points = incoming.points, priorPoints = ledger.jobs[0].budget.points;
    assert.ok(points); assert.ok(priorPoints);
    validateLiveLedger(ledger, NOW);
    assert.equal(points.measuredAt + points.resetIn * 1_000 - canonicalReset, 10_427);
    assert.equal(points.measuredAt + points.resetIn * 1_000 -
      (priorPoints.measuredAt + priorPoints.resetIn * 1_000), 9_000);

    const staged = stageJob(ledger, { state: incoming, jobID: JOB });
    const retained = staged.ledger.jobs[0];
    assert.equal(staged.accountingFailure, 'live-window-incompatible');
    assert.equal(retained.accountingFailure, staged.accountingFailure);
    assert.equal(retained.budget.unmeasuredGraphql, 1);
    assert.equal(retained.pending, 8);
    assert.equal(retained.charged, 4);
    assert.equal(retained.window, original.jobs[0].window);
    assert.equal(retained.uncertainUntil, canonicalReset + 10_427);
    assert.deepEqual(staged.ledger.windows, original.windows);
    validateLiveLedger(staged.ledger, incoming.lastObservedAt);
    assert.deepEqual(stageSourceJob(ledger, { state: incoming, jobID: JOB }), staged);
    assert.deepEqual(ledger, original); assert.deepEqual(incoming, observed);
  });

  test('a later stop keeps the original failure, debt and finite uncertainty boundary', () => {
    const { ledger, incoming } = driftFixture();
    const failed = stageJob(ledger, { state: incoming, jobID: JOB });
    const closed = { ...structuredClone(incoming), lastObservedAt: NOW + 2_000, stop: 'closed' };
    const staged = stageJob(failed.ledger, { state: closed, jobID: JOB, accountingFailure: failed.accountingFailure });
    assert.equal(staged.accountingFailure, failed.accountingFailure);
    assert.equal(staged.ledger.jobs[0].budget.unmeasuredGraphql, 1);
    assert.equal(staged.ledger.jobs[0].pending, 8);
    assert.equal(staged.ledger.jobs[0].charged, 4);
    assert.equal(staged.ledger.jobs[0].uncertainUntil, failed.ledger.jobs[0].uncertainUntil);
    assert.equal(staged.ledger.jobs[0].terminal, true);
    validateLiveLedger(staged.ledger, closed.lastObservedAt);
    assert.deepEqual(stageSourceJob(failed.ledger, { state: closed, jobID: JOB, accountingFailure: failed.accountingFailure }), staged);
  });

  test('failure debt includes a newly learned cost and applicable unbound legacy cost', () => {
    for (const legacyCost of [0, 20]) {
      const { ledger, incoming } = driftFixture();
      const withLegacy = { ...ledger, ...(legacyCost ? { legacyUnknown: {
        charged: 20, pending: 20, estimatedRequestCost: legacyCost, boundWindow: null,
      } } : {}) };
      incoming.pointEstimate = 12;
      const staged = stageJob(withLegacy, { state: incoming, jobID: JOB });
      assert.equal(staged.ledger.jobs[0].budget.unmeasuredGraphql, 1);
      assert.equal(staged.ledger.jobs[0].budget.pointEstimate, 12);
      assert.equal(staged.ledger.jobs[0].pending, Math.max(12, legacyCost));
      assert.equal(staged.ledger.jobs[0].charged, 4);
      validateLiveLedger(staged.ledger, incoming.lastObservedAt);
      assert.deepEqual(stageSourceJob(withLegacy, { state: incoming, jobID: JOB }), staged);
    }
  });

  test('latched failure and indefinite uncertainty cannot be replaced by a later finite observation', () => {
    const { ledger, incoming } = driftFixture();
    const failed = stageJob(ledger, { state: incoming, jobID: JOB });
    const indefinite = structuredClone(failed.ledger);
    indefinite.jobs[0].uncertainUntil = null;
    const staged = stageJob(indefinite, { state: { ...incoming, lastObservedAt: NOW + 2_000 },
      jobID: JOB, accountingFailure: 'quota-window-changed' });
    assert.equal(staged.accountingFailure, 'live-window-incompatible');
    assert.equal(staged.ledger.jobs[0].accountingFailure, 'live-window-incompatible');
    assert.equal(staged.ledger.jobs[0].uncertainUntil, null);
    assert.equal(staged.ledger.jobs[0].budget.unmeasuredGraphql, 1);
    assert.equal(staged.ledger.jobs[0].pending, 8);
    assert.deepEqual(stageSourceJob(indefinite, { state: { ...incoming, lastObservedAt: NOW + 2_000 },
      jobID: JOB, accountingFailure: 'quota-window-changed' }), staged);
  });
});
