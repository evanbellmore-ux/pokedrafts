import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { createCompareHandler } from '../../app/api/castmirror/compare/service';
import { createHostedComparisonBinder } from '../../app/api/castmirror/execution/runtime';
import type { Comparison, CompareParams } from '../../app/api/castmirror/compare/contracts';
import { comparisonFixture } from '../helpers/castmirror-page.mjs';

vi.mock('server-only', () => ({}));
const patch = { current: '12.1.5', selected: '12.1', fallback: true as const };
const UUID = '11111111-1111-4111-8111-111111111111';
function request(metric = 'dps') {
  return new Request('https://hosted.example/api/castmirror/compare?name=You&server=Test+Realm&region=us&encounter=42&difficulty=4&metric=' + metric);
}
function comparison(params?: CompareParams): Comparison {
  const value = comparisonFixture() as Comparison;
  if (params?.metric === 'hps') {
    value.metric = 'hps'; value.className = 'Priest'; value.spec = 'Holy';
    delete value.bossReference;
  }
  return value;
}
const noQuery = async () => { throw new Error('Response fixture must not dispatch transport'); };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Patch service tests must not acquire real data'); }));
  vi.stubEnv('EXECUTION_RUNTIME_VERIFIED', '0'); vi.stubEnv('EXECUTION_NATIVE_ENABLED', '0');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('previous-patch display metadata and fresh current-patch selection', () => {
  for (const side of ['a', 'b', 'boss'] as const) {
    test(`${side} fallback is projected narrowly and never retained in the warm cache`, async () => {
      const builder = vi.fn(async () => {
        const value = comparison();
        const target = side === 'boss' ? value.bossReference!.b : value[side];
        Object.assign(target, { rankingPatch: { ...patch, partition: 999, diagnostic: 'must-not-be-projected' } });
        return value;
      });
      const handler = createCompareHandler({ builder, query: noQuery, admission: () => true, executionBinder: false });
      for (let i = 0; i < 2; i++) {
        const response = await handler(request());
        assert.equal(response.status, 200);
        const value = await response.json();
        const target = side === 'boss' ? value.bossReference.b : value[side];
        assert.deepEqual(target.rankingPatch, patch);
        assert.equal('comparisonID' in value, false);
      }
      assert.equal(builder.mock.calls.length, 2);
      assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    });
  }

  test('new current-patch rankings replace a fallback immediately and then use the ordinary cache', async () => {
    const builder = vi.fn(async () => {
      const value = comparison();
      if (builder.mock.calls.length === 1) value.b.rankingPatch = { ...patch };
      return value;
    });
    const admission = vi.fn(() => true);
    const handler = createCompareHandler({ builder, query: noQuery, admission, executionBinder: false });
    const old = await (await handler(request())).json();
    assert.deepEqual(old.b.rankingPatch, patch);
    const current = await (await handler(request())).json();
    assert.equal('rankingPatch' in current.b, false);
    const cached = await (await handler(request())).json();
    assert.deepEqual(cached, current);
    assert.equal(builder.mock.calls.length, 2); assert.equal(admission.mock.calls.length, 2);
  });

  test('Healing retains previous-patch labels and signed healing without adding a Boss reference', async () => {
    const value = comparison({ metric: 'hps' } as CompareParams);
    value.a.rankingPatch = { ...patch }; value.b.rankingPatch = { ...patch };
    value.b.dmg['Synthetic signed adjustment'] = -50;
    const response = await createCompareHandler({ builder: async () => value, query: noQuery, admission: () => true, executionBinder: false })(request('hps'));
    assert.equal(response.status, 200);
    const out = await response.json();
    assert.deepEqual(out.a.rankingPatch, patch); assert.deepEqual(out.b.rankingPatch, patch);
    assert.equal(out.b.dmg['Synthetic signed adjustment'], -50); assert.equal('bossReference' in out, false);
  });

  for (const malformed of [
    null, { ...patch, fallback: false }, { ...patch, selected: '12.1.10' },
    { ...patch, current: '12.1.0', selected: '12.1' }, { ...patch, selected: '13.0' },
    { ...patch, selected: 12.1 }, { ...patch, current: '12.1.5\nprivate' },
    { ...patch, selected: '012.1' }, { ...patch, selected: '<script>' },
    { selected: '12.1', fallback: true },
  ]) {
    test(`invalid fallback metadata ${JSON.stringify(malformed)} cannot become a successful reference`, async () => {
      const value = comparison(); Object.assign(value.b, { rankingPatch: malformed });
      const response = await createCompareHandler({ builder: async () => value, query: noQuery, admission: () => true, executionBinder: false })(request());
      assert.equal(response.status, 502);
      const body = await response.json(); assert.equal(body.diagnostic, 'normalized.overall.ranking');
      assert.equal('b' in body, false); assert.equal('comparisonID' in body, false);
    });
  }
});

describe('previous-patch throughput is not native current-partition proof', () => {
  for (const side of ['a', 'b'] as const) {
    test(`${side} fallback opens no native store, mints no pin and starts no acquisition`, async () => {
      const value = comparison(); value[side].rankingPatch = { ...patch };
      const createStore = vi.fn(() => { throw new Error('Historical display metadata must not open native persistence'); });
      const loadModules = vi.fn(async () => { throw new Error('Historical display metadata must not load a native collector'); });
      const env = { EXECUTION_RUNTIME_VERIFIED: '1', EXECUTION_NATIVE_ENABLED: '1',
        EXECUTION_DATABASE_URL: 'postgresql://execution_test:synthetic@db.example/fixture?sslmode=verify-full',
        WCL_CLIENT_ID: 'synthetic-patch-client', WCL_CLIENT_SECRET: 'synthetic-patch-secret' };
      const handler = createCompareHandler({ builder: async () => value, query: noQuery, admission: () => true,
        executionBinder: (req, context) => createHostedComparisonBinder(req, { ...context, env, createStore, loadModules }),
      });
      const response = await handler(request()); assert.equal(response.status, 200);
      const out = await response.json(); assert.equal('comparisonID' in out, false);
      assert.equal(out.executionV3Status.available, false); assert.equal(out.executionV3Status.state, 'unavailable');
      assert.equal(createStore.mock.calls.length, 0); assert.equal(loadModules.mock.calls.length, 0);
      assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    });
  }

  test('an independent previous-patch Boss reference does not disable the current Overall native pair', async () => {
    const value = comparison(); value.bossReference!.b.rankingPatch = { ...patch };
    const bind = vi.fn(async () => ({ comparisonID: UUID, createdAt: 100 }));
    const handler = createCompareHandler({ builder: async () => value, query: noQuery, admission: () => true, clock: () => 100,
      executionBinder: () => ({ cacheKey: 'synthetic-patch-account', observe() {}, bind }),
    });
    const response = await handler(request()); assert.equal(response.status, 200);
    const out = await response.json(); assert.equal(out.comparisonID, UUID); assert.equal(out.executionV3Status.available, true);
    assert.deepEqual(out.bossReference.b.rankingPatch, patch); assert.equal(bind.mock.calls.length, 1);
  });
});
