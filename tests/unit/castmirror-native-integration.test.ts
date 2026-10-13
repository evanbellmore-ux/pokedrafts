import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { createComparisonPin, EXECUTION_ANALYTICAL_VERSION, freezePin } from '../../app/api/castmirror/execution/pins';
import { openNativeExecutionRuntime, type NativeExecutionEnvironment, type NativeExecutionStore } from '../../app/api/castmirror/execution/runtime';
import { createExecutionV3Handler, projectExecutionReference } from '../../app/api/castmirror/execution/v3/service';
import type { ExecutionCheckpoint, ExecutionOwnership, ExecutionRelease } from '../../app/api/castmirror/execution/store-types';
import type { CompareParams } from '../../app/api/castmirror/compare/contracts';
import { comparisonFixture } from '../helpers/castmirror-page.mjs';

vi.mock('server-only', () => ({}));

// These exercise the source-pinned native loader, WclClient, LiveExecutionService
// and durable budget. Only transport and storage authority are synthetic.
const ENV: NativeExecutionEnvironment = {
  EXECUTION_DATABASE_URL: 'postgresql://synthetic_executor:synthetic_password@db.example/offline',
  EXECUTION_RUNTIME_VERIFIED: '1', EXECUTION_NATIVE_ENABLED: '0', EXECUTION_VERIFY_TOKEN: 'synthetic-private-verifier',
  WCL_CLIENT_ID: 'synthetic-integration-client', WCL_CLIENT_SECRET: 'synthetic-integration-secret',
};
const ACCOUNT = createHash('sha256').update('wcl-client:' + ENV.WCL_CLIENT_ID).digest('hex');
const UUID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_000_000;
const COMPONENTS = ['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing'];
const params: CompareParams = { name: 'You', server: 'Test Realm', region: 'us', encounter: 42, difficulty: 5,
  metric: 'dps', code: null, fightID: null, hero: null };
function pinFixture() {
  const comparison = comparisonFixture();
  comparison.difficulty = 5;
  comparison.a.scope.difficulty = comparison.b.scope.difficulty = 5;
  return freezePin(createComparisonPin(comparison, params));
}
function request(policy: 'Any' | 'Exclude' = 'Any', signal?: AbortSignal) {
  return new Request(`https://hosted.example/api/castmirror/execution/v3?comparisonID=${UUID}&pi=${policy}`, {
    signal, headers: { Authorization: `Bearer ${ENV.EXECUTION_VERIFY_TOKEN}` },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
interface SyntheticJob {
  id: string;
  terminal: boolean;
  pending: number;
  charged: number;
  budget: { stop: string | null; counters: Record<string, number>; limits: Record<string, number> };
}
interface SyntheticLedger { jobs: SyntheticJob[]; windows: unknown[] }
function storeFixture() {
  let ledger = JSON.stringify({ version: 'execution-v3-live-account-1', updatedAt: NOW, jobs: [], windows: [] }) + '\n';
  let revision = 0, fence = 0, owner: string | null = null, leaseUntil = 0;
  const pools = new Map<string, Record<string, unknown>>();
  const trace: string[] = [], checkpoints: ExecutionCheckpoint[] = [];
  const controls: { beforeCheckpoint?: (input: ExecutionCheckpoint) => Promise<void>; beforeClose?: () => void } = {};
  const snapshot = (): SyntheticLedger => JSON.parse(ledger);
  function assertOwner(ownership: ExecutionOwnership, expectedRevision?: number) {
    assert.equal(ownership.account, ACCOUNT); assert.equal(ownership.owner, owner); assert.equal(ownership.fence, fence);
    assert.ok(NOW < leaseUntil);
    if (expectedRevision !== undefined) assert.equal(expectedRevision, revision);
  }
  const store = {
    preflight: vi.fn(async () => { trace.push('preflight'); }),
    close: vi.fn(async () => { controls.beforeClose?.(); trace.push('close'); }),
    claim: vi.fn(async (account: string, proposedOwner: string, leaseMs: number) => {
      trace.push('claim'); assert.equal(account, ACCOUNT); assert.equal(owner, null); assert.equal(leaseMs, 150_000);
      owner = proposedOwner; fence++; leaseUntil = NOW + leaseMs;
      return { ledger, revision, fence, leaseUntil };
    }),
    checkpoint: vi.fn(async (input: ExecutionCheckpoint) => {
      trace.push('checkpoint-start'); checkpoints.push(structuredClone(input));
      await Promise.resolve(); await controls.beforeCheckpoint?.(input);
      assertOwner(input, input.revision); assert.equal(input.history, undefined);
      ledger = input.ledger; revision++; trace.push('checkpoint-commit'); return { revision };
    }),
    release: vi.fn(async (input: ExecutionRelease) => {
      assertOwner(input, input.revision); trace.push('release'); owner = null; leaseUntil = 0;
    }),
    readHistory: vi.fn(async () => null),
    readPool: vi.fn(async (key: string) => { trace.push('pool-read'); return structuredClone(pools.get(key) ?? null); }),
    savePool: vi.fn(async (pool: Record<string, unknown>, ownership?: ExecutionOwnership) => {
      assert.ok(ownership); assertOwner(ownership); assert.equal(typeof pool.key, 'string');
      trace.push('pool-save'); pools.set(pool.key as string, structuredClone(pool));
    }),
    putPin: vi.fn(async () => { throw new Error('Integration GET must never mint or renew a pin'); }),
    readPin: vi.fn(async (id: string) => { assert.equal(id, UUID); trace.push('pin-read'); return pinFixture(); }),
  } satisfies NativeExecutionStore;
  return { store, trace, checkpoints, snapshot, controls };
}
function successfulFetch(f: ReturnType<typeof storeFixture>) {
  let dispatched = 0, graphql = 0, bytes = 0;
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const oauth = url === 'https://www.warcraftlogs.com/oauth/token';
    assert.ok(oauth || url === 'https://www.warcraftlogs.com/api/v2/client', 'Only synthetic known WCL endpoints are accepted');
    const job = f.snapshot().jobs.at(-1)!;
    assert.ok(job, 'The fresh job must already be durably checkpointed');
    assert.equal(job.budget.counters.network, ++dispatched, 'Each actual dispatch must have an acknowledged native attempt');
    if (!oauth) assert.equal(job.budget.counters.graphql, ++graphql);
    assert.equal(job.budget.counters.evidenceBytes, bytes, 'Byte observers must commit the previous response before dispatch');
    assert.ok(init?.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
    f.trace.push(oauth ? 'fetch-oauth' : 'fetch-graphql');
    let value: unknown;
    if (oauth) value = { access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 };
    else {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      const quota = { limitPerHour: 2000, pointsSpentThisHour: graphql, pointsResetIn: 3600 };
      assert.match(body.query, /_executionMaintenanceQuota: rateLimitData/);
      if (body.query.includes('worldData')) value = { data: { _executionMaintenanceQuota: quota, worldData: { encounter: {
        id: 42, name: 'Synthetic Mythic boss', zone: { id: 99, name: 'Synthetic raid', difficulties: [{ id: 5, name: 'Mythic', sizes: [20] }],
          partitions: [{ id: 7, name: 'Synthetic current partition', default: true }], encounters: [{ id: 42, name: 'Synthetic Mythic boss' }] },
      } } } };
      else if (body.query.includes('reportData')) value = { data: { _executionMaintenanceQuota: quota, reportData: { report: null } } };
      else { assert.match(body.query, /__typename/); value = { data: { _executionMaintenanceQuota: quota, __typename: 'Query' } }; }
    }
    const text = JSON.stringify(value); bytes += Buffer.byteLength(text, 'utf8');
    return new Response(text, { headers: { 'Content-Type': 'application/json' } });
  });
  return { mock, bytes: () => bytes };
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Native integration must never acquire real provider data'); }));
  vi.stubEnv('EXECUTION_NATIVE_ENABLED', '0'); vi.stubEnv('EXECUTION_RUNTIME_VERIFIED', '0');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('real source-pinned hosted native runtime with offline provider authority', () => {
  for (const policy of ['Any', 'Exclude'] as const) {
    test(`private ${policy} uses native asynchronous attempts/bytes and shared retained cache without acquiring unknown PI`, async () => {
      const f = storeFixture(), transport = successfulFetch(f); vi.stubGlobal('fetch', transport.mock);
      const handler = createExecutionV3Handler({ now: () => NOW, runtimeOptions: { env: ENV, createStore: () => f.store } });
      const response = await handler(request(policy)); assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control')!, /private.*no-store/);
      const text = await response.text(), output = JSON.parse(text);
      assert.deepEqual(Object.keys(output).sort(), ['comparisonID', 'executionReference']);
      assert.equal(output.comparisonID, UUID); assert.equal(output.executionReference.execution.analyticalVersion, EXECUTION_ANALYTICAL_VERSION);
      assert.deepEqual(output.executionReference.pi, { a: null, b: null, excluded: policy === 'Exclude' });
      assert.equal(output.executionReference.execution.piPolicy, policy); assert.equal(output.executionReference.execution.comparable, false);
      for (const side of ['a', 'b']) {
        assert.deepEqual(Object.keys(output.executionReference.execution[side].components), COMPONENTS);
        assert.equal(output.executionReference.execution[side].score, null);
      }
      for (const forbidden of ['casts', 'resources', 'dmg', 'lust']) assert.equal(forbidden in output.executionReference.b, false);
      assert.doesNotMatch(text, /synthetic-integration-secret|synthetic-access-token|postgresql:/);
      assert.equal(transport.mock.mock.calls.length, 4, 'OAuth, quota measurement, scope, and one inaccessible public report');
      const job = f.snapshot().jobs[0]; assert.equal(job.terminal, true); assert.equal(job.budget.counters.network, 4);
      assert.equal(job.budget.counters.graphql, 3); assert.equal(job.budget.counters.evidenceBytes, transport.bytes());
      assert.equal(job.budget.limits.maxAttempts, 2); assert.equal(job.pending, 0);
      assert.equal(f.store.claim.mock.calls.length, 1); assert.equal(f.store.release.mock.calls.length, 1);
      assert.ok(f.trace.indexOf('checkpoint-commit') < f.trace.indexOf('fetch-oauth'));
      assert.ok(f.trace.indexOf('pool-save') < f.trace.indexOf('release')); assert.ok(f.trace.indexOf('release') < f.trace.indexOf('close'));
      assert.equal(f.store.putPin.mock.calls.length, 0);
      // A fresh route/runtime reads durable shared authority, not instance memory.
      const next = await handler(request(policy)); assert.equal(next.status, 200);
      const cached = await next.json(); assert.equal(cached.executionReference.execution.coverage.acquisition.cached, true);
      assert.equal(transport.mock.mock.calls.length, 4); assert.equal(f.store.claim.mock.calls.length, 1);
      assert.equal(f.store.readPin.mock.calls.length, 2); assert.equal(f.store.readPool.mock.calls.length, 2);
    });
  }
  test('actual native transport permits two retry rounds, not the hosted three-round adapter', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = storeFixture(), firstGraphql = deferred(); let graphCalls = 0;
    const transport = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      const snapshot = f.snapshot().jobs[0]; assert.ok(snapshot); assert.equal(snapshot.budget.counters.network, transport.mock.calls.length);
      if (url === 'https://www.warcraftlogs.com/oauth/token') return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      assert.equal(url, 'https://www.warcraftlogs.com/api/v2/client'); graphCalls++; firstGraphql.resolve();
      return new Response('synthetic provider/private payload', { status: 503 });
    });
    vi.stubGlobal('fetch', transport);
    const pending = createExecutionV3Handler({ now: () => NOW, runtimeOptions: { env: ENV, createStore: () => f.store } })(request());
    await firstGraphql.promise; await vi.advanceTimersByTimeAsync(1000);
    const response = await pending; assert.equal(response.status, 200); assert.equal(graphCalls, 2);
    assert.equal(transport.mock.calls.length, 3); assert.equal(f.snapshot().jobs[0].budget.counters.graphql, 2);
    assert.doesNotMatch(await response.text(), /private payload|synthetic-token/);
    assert.equal(f.store.release.mock.calls.length, 1); assert.equal(vi.getTimerCount(), 0);
  });
  test('failed actual attempt checkpoint stops before OAuth and is never replayed or refunded', async () => {
    const f = storeFixture();
    f.controls.beforeCheckpoint = async (input) => {
      const ledger: SyntheticLedger = JSON.parse(input.ledger);
      if (ledger.jobs[0].budget.counters.network > 0) throw new Error('synthetic raw SQL/credential/account diagnostic');
    };
    const response = await createExecutionV3Handler({ now: () => NOW, runtimeOptions: { env: ENV, createStore: () => f.store } })(request());
    assert.equal(response.status, 200); const text = await response.text();
    assert.doesNotMatch(text, /raw SQL|credential|account diagnostic/); assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    assert.equal(f.store.claim.mock.calls.length, 1); assert.equal(f.store.release.mock.calls.length, 1);
    assert.equal(f.checkpoints.filter((input) => (JSON.parse(input.ledger) as SyntheticLedger).jobs[0].budget.counters.network > 0).length, 1);
    assert.equal(JSON.parse(text).executionReference.execution.coverage.acquisition.accountingPersistence, 'unavailable');
  });
  test('actual incoming abort settles fetch before fenced release and provider close; retains pending debt', async () => {
    vi.useFakeTimers();
    const f = storeFixture(), begun = deferred(), aborted = deferred(), allowSettlement = deferred(); let active = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === 'https://www.warcraftlogs.com/oauth/token') return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      assert.equal(url, 'https://www.warcraftlogs.com/api/v2/client'); assert.ok(init?.signal instanceof AbortSignal);
      const signal = init.signal; active++; begun.resolve();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
      await allowSettlement.promise; active--; f.trace.push('fetch-settled'); throw signal.reason;
    }));
    f.controls.beforeClose = () => assert.equal(active, 0);
    const controller = new AbortController(); let returned = false;
    const pending = createExecutionV3Handler({ now: () => NOW, runtimeOptions: { env: ENV, createStore: () => f.store } })(request('Exclude', controller.signal))
      .then((response) => { returned = true; return response; });
    await begun.promise; controller.abort(); await aborted.promise;
    assert.equal(returned, false); assert.equal(f.store.release.mock.calls.length, 0); assert.equal(f.store.close.mock.calls.length, 0);
    allowSettlement.resolve(); const response = await pending; assert.equal(response.status, 499);
    assert.equal(active, 0); assert.ok(f.trace.indexOf('fetch-settled') < f.trace.indexOf('release'));
    assert.ok(f.trace.indexOf('release') < f.trace.indexOf('close'));
    const job = f.snapshot().jobs[0]; assert.equal(job.terminal, true); assert.equal(job.budget.counters.network, 2);
    assert.equal(job.budget.counters.graphql, 1); assert.ok(job.pending > 0, 'Canceled unmeasured dispatch debt remains charged');
    assert.equal(f.store.claim.mock.calls.length, 1); assert.equal(f.store.release.mock.calls.length, 1); assert.equal(vi.getTimerCount(), 0);
  });
  test('actual warm service cannot serve its map as authority when shared pool reads fail', async () => {
    const f = storeFixture(), transport = successfulFetch(f); vi.stubGlobal('fetch', transport.mock);
    const runtime = await openNativeExecutionRuntime(request(), { env: ENV, now: () => NOW, createStore: () => f.store }); assert.ok(runtime);
    try {
      const pin = pinFixture(); await runtime.compare(pin.base, pin.params, { piPolicy: 'Any', waitForInflight: false });
      assert.equal(transport.mock.mock.calls.length, 4);
      f.store.readPool.mockRejectedValueOnce(new Error('synthetic private pool/driver diagnostic'));
      const result = await runtime.compare(pin.base, pin.params, { piPolicy: 'Exclude', waitForInflight: false });
      const output = projectExecutionReference(result, pin.base, 'Exclude');
      assert.equal(output.execution.coverage.acquisition.cachePersistence, 'unavailable');
      assert.equal(output.execution.coverage.acquisition.cached, false); assert.equal((output.execution as Record<string, unknown>).piPolicy, 'Exclude');
      assert.equal(transport.mock.mock.calls.length, 4); assert.equal(f.store.claim.mock.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(output), /private pool|driver diagnostic/);
    } finally { await runtime.close(); }
  });
});
