import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { createCompareHandler, COMPARE_DEADLINE_MS } from '../../app/api/castmirror/compare/service';
import { normalizeComparison, type ComparisonClient, type CompareParams } from '../../app/api/castmirror/compare/contracts';
import {
  createHostedComparisonBinder, getNativeExecutionAccess, openNativeExecutionRuntime,
  type NativeExecutionEnvironment, type NativeExecutionModules, type NativeExecutionRuntime, type NativeCompareOptions,
} from '../../app/api/castmirror/execution/runtime';
import {
  createComparisonPin, EXECUTION_ANALYTICAL_VERSION, EXECUTION_PIN_TTL_MS, freezePin, readComparisonPin,
  type PinnedComparison, type PinnedParams,
} from '../../app/api/castmirror/execution/pins';
import { createExecutionV3Handler, EXECUTION_DEADLINE_MS, EXECUTION_RESPONSE_BYTES } from '../../app/api/castmirror/execution/v3/service';
import { comparisonFixture, deferred } from '../helpers/castmirror-page.mjs';

vi.mock('server-only', () => ({}));

const UUID = '11111111-1111-4111-8111-111111111111';
const ENV: NativeExecutionEnvironment = {
  EXECUTION_DATABASE_URL: 'postgresql://execution_test:synthetic_password@db.example/fixture?sslmode=verify-full',
  EXECUTION_RUNTIME_VERIFIED: '1', EXECUTION_NATIVE_ENABLED: '1', EXECUTION_VERIFY_TOKEN: 'synthetic-private-verifier',
  WCL_CLIENT_ID: 'synthetic-test-client', WCL_CLIENT_SECRET: 'synthetic-test-secret',
};
const params: CompareParams = { name: 'You', server: 'Test Realm', region: 'us', encounter: 42, difficulty: 5,
  metric: 'dps', code: null, fightID: null, hero: null };
const scope = { zone: 99, encounter: 42, difficulty: 5, size: 20, partition: 7, patch: 'Synthetic current partition' };
const charDocument = `query($name: String!, $slug: String!, $region: String!, $enc: Int!, $diff: Int!, $metric: CharacterRankingMetricType!) {
  characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) { classID encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric) } }
}`;
const worldDocument = `query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!) {
  worldData { encounter(id: $enc) { name characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric) } }
}`;
const metadataDocument = 'query($enc:Int!) { worldData { encounter(id:$enc) { id name zone { id name partitions { id name default } } } } }';
function comparison() {
  const value = comparisonFixture();
  value.difficulty = 5;
  for (const side of [value.a, value.b, value.bossReference.b]) side.scope.difficulty = 5;
  return value;
}
function compareRequest(extra = '', init: RequestInit = {}) {
  return new Request('https://hosted.example/api/castmirror/compare?name=You&server=Test+Realm&region=us&encounter=42&difficulty=5&metric=dps&zone=99' + extra, init);
}
function executionRequest(query = `comparisonID=${UUID}&pi=Any`, init: RequestInit = {}) {
  return new Request('https://hosted.example/api/castmirror/execution/v3?' + query, init);
}
function fakeStore() {
  return {
    account: createHash('sha256').update('wcl-client:' + ENV.WCL_CLIENT_ID).digest('hex'),
    preflight: vi.fn(async () => {}), close: vi.fn(async () => {}),
    claim: vi.fn(async () => { throw new Error('Unexpected claim in a hosted protocol mock'); }),
    checkpoint: vi.fn(async () => ({ revision: 1 })), release: vi.fn(async () => {}),
    readHistory: vi.fn(async () => null), readPool: vi.fn(async () => null), savePool: vi.fn(async () => {}),
    putPin: vi.fn(async (base: Record<string, unknown>, bound: Record<string, unknown>) => { assert.ok(base.a && base.b); assert.ok(bound.name); return UUID; }),
    readPin: vi.fn(async (id: string) => { assert.equal(id, UUID); return createComparisonPin(comparison(), params); }),
  };
}
function nativeReference(base: PinnedComparison, policy: 'Any' | 'Exclude' = 'Any') {
  const evaluation = (pi: boolean | null) => ({
    version: EXECUTION_ANALYTICAL_VERSION, status: 'unavailable', score: null, mask: '000000', coverageWeight: 0,
    weights: {}, scope: null, identity: { name: 'Synthetic player', verified: false }, sample: { observations: 0 },
    support: { pi }, provenance: { mode: 'native', authenticated: true },
    components: Object.fromEntries(['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing'].map((name) =>
      [name, { state: 'unavailable', value: null, score: null, percentile: null, measurements: {}, limitations: ['Unknown synthetic evidence'] }])),
  });
  return {
    b: base.b, hero: base.hero, pi: { a: null, b: false, excluded: policy === 'Exclude' }, rankingMetric: 'execution',
    execution: { analyticalVersion: EXECUTION_ANALYTICAL_VERSION, status: 'unavailable', piPolicy: policy, cohortMode: 'spec',
      a: evaluation(null), b: evaluation(false), scope: null, comparable: false,
      comparison: { comparable: false, reason: 'scored-statistics-evaluations-required', comparison: null },
      coverage: { observations: 0, players: 0, kills: 0, pi: { present: 0, absent: 1, unknown: 1 }, excluded: policy === 'Exclude' ? 1 : 0,
        sampleSelection: 'ranking-selected bounded local cohort', acquisition: { state: 'limited', cached: false } },
      reasons: ['Unknown values stay visible', 'Defensive usage is not mitigation effectiveness'], globalWinner: null },
  };
}
function moduleFixture() {
  const captures: Array<ConstructorParameters<NativeExecutionModules['LiveExecutionService']>[0]> = [];
  const clientArgs: string[][] = [];
  const compare = vi.fn(async (base: PinnedComparison, _params: PinnedParams, options: NativeCompareOptions) => nativeReference(base, options.piPolicy));
  const budget = vi.fn(async (options: Parameters<NativeExecutionModules['createDurableLiveBudget']>[0]) => {
    assert.equal(typeof options.account, 'string'); return { budget: {}, release: async () => {}, ownership: {} };
  });
  const modules: NativeExecutionModules = {
    WclClient: class { constructor(id: string, secret: string) { clientArgs.push([id, secret]); } },
    LiveExecutionService: class {
      constructor(options: ConstructorParameters<NativeExecutionModules['LiveExecutionService']>[0]) { captures.push(options); }
      compare = compare;
    },
    createDurableLiveBudget: budget,
    resolveScope: vi.fn(async (client: ComparisonClient) => { await client.query(metadataDocument, { enc: 42 }); return scope; }),
  };
  return { modules, captures, clientArgs, compare, budget };
}
function binderFixture({ bCurrent = true, aCurrent = true, env = ENV, clock = () => 100 }: {
  bCurrent?: boolean; aCurrent?: boolean; env?: NativeExecutionEnvironment; clock?: () => number;
} = {}) {
  const store = fakeStore(), native = moduleFixture();
  const createStore = vi.fn(() => store), loadModules = vi.fn(async () => native.modules);
  const query = vi.fn<(document: string) => Promise<unknown>>(async (document: string) => {
    const out = comparison();
    if (document.includes('encounterRankings')) return { characterData: { character: { classID: 8, encounterRankings: {
      ranks: aCurrent ? [{ report: { code: out.a.code, fightID: out.a.fightID }, spec: 'Arcane', amount: 900 }] : [],
    } } } };
    if (document.includes('characterRankings')) return { worldData: { encounter: { name: 'Test Boss', characterRankings: {
      hasMorePages: false, rankings: bCurrent ? [{ name: out.b.name, server: { name: out.b.server }, report: { code: out.b.code, fightID: out.b.fightID }, amount: 2200 }] : [],
    } } } };
    if (document === metadataDocument) return { worldData: { encounter: { id: 42, name: 'Test Boss', zone: { id: 99 } } } };
    throw new Error('Unexpected synthetic query');
  });
  const builder = vi.fn(async (client: ComparisonClient) => {
    await client.query(charDocument, { name: 'You', slug: 'test-realm', region: 'us', enc: 42, diff: 5, metric: 'dps' });
    await client.query(worldDocument, { enc: 42, diff: 5, metric: 'dps', cls: 'Mage', spec: 'Arcane' });
    return comparison();
  });
  const handler = createCompareHandler({ builder, query, clock, admission: () => true,
    executionBinder: (request, context) => createHostedComparisonBinder(request, { ...context, env, createStore, loadModules }),
  });
  return { store, native, createStore, loadModules, query, builder, handler };
}
function runtimeFixture() {
  const store = fakeStore();
  const compare = vi.fn(async (base: PinnedComparison, _params: PinnedParams, options: NativeCompareOptions) => nativeReference(base, options.piPolicy));
  const close = vi.fn(async () => { await store.close(); });
  const runtime: NativeExecutionRuntime = { account: store.account, store, compare, close, resolveScope: async () => scope };
  const openRuntime = vi.fn(async () => runtime);
  return { store, runtime, compare, close, openRuntime };
}
function assertPrivate(response: Response) {
  assert.match(response.headers.get('Cache-Control') ?? '', /private.*no-store/);
  assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'no-store');
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Synthetic hosted tests must not acquire real WCL data'); }));
  vi.stubEnv('EXECUTION_RUNTIME_VERIFIED', '0');
  vi.stubEnv('EXECUTION_NATIVE_ENABLED', '0');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native hosted configuration and independent account preflight', () => {
  for (const change of [
    { EXECUTION_DATABASE_URL: undefined }, { WCL_CLIENT_ID: undefined }, { WCL_CLIENT_SECRET: undefined },
    { EXECUTION_NATIVE_ENABLED: '0' }, { EXECUTION_RUNTIME_VERIFIED: '0' },
  ]) {
    test(`missing/unverified gate ${JSON.stringify(change)} starts no provider or fallback`, async () => {
      const store = fakeStore(), createStore = vi.fn(() => store), loadModules = vi.fn(async () => moduleFixture().modules);
      const request = executionRequest();
      assert.equal(getNativeExecutionAccess(request, { ...ENV, ...change }), null);
      assert.equal(await openNativeExecutionRuntime(request, { env: { ...ENV, ...change }, createStore, loadModules }), null);
      assert.equal(createStore.mock.calls.length, 0); assert.equal(loadModules.mock.calls.length, 0);
      assert.equal(store.preflight.mock.calls.length, 0); assert.equal(store.putPin.mock.calls.length, 0);
      assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    });
  }
  test('private verification is constant-time bearer only and uses the same client-ID quota account', () => {
    const env = { ...ENV, EXECUTION_NATIVE_ENABLED: '0' };
    const authorized = executionRequest(undefined, { headers: { Authorization: `Bearer ${env.EXECUTION_VERIFY_TOKEN}` } });
    const access = getNativeExecutionAccess(authorized, env)!;
    assert.equal(access.mode, 'verification');
    assert.equal(access.account, createHash('sha256').update('wcl-client:' + ENV.WCL_CLIENT_ID).digest('hex'));
    assert.equal(access.account, getNativeExecutionAccess(executionRequest(), ENV)!.account);
    assert.equal(access.account, getNativeExecutionAccess(executionRequest(), { ...ENV, WCL_CLIENT_SECRET: 'different-synthetic-secret' })!.account);
    for (const header of ['', 'Basic synthetic-private-verifier', 'Bearer wrong', 'Bearer synthetic-private-verifier, Bearer synthetic-private-verifier']) {
      assert.equal(getNativeExecutionAccess(executionRequest(undefined, { headers: { Authorization: header } }), env), null);
    }
    assert.equal(getNativeExecutionAccess(executionRequest(`comparisonID=${UUID}&pi=Any&token=${env.EXECUTION_VERIFY_TOKEN}`), env), null);
    assert.equal(getNativeExecutionAccess(authorized, { ...env, EXECUTION_RUNTIME_VERIFIED: '0' }), null);
  });
  test('environment enablement cannot bypass disabled account/cutover preflight', async () => {
    const store = fakeStore(), native = moduleFixture(), loadModules = vi.fn(async () => native.modules);
    store.preflight.mockRejectedValueOnce(new Error('synthetic private DB diagnostic'));
    await assert.rejects(openNativeExecutionRuntime(executionRequest(), { env: ENV, createStore: () => store, loadModules }));
    assert.equal(store.preflight.mock.calls.length, 1); assert.equal(store.close.mock.calls.length, 1);
    assert.equal(loadModules.mock.calls.length, 0); assert.equal(native.clientArgs.length, 0);
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
  });
  test('runtime binds native client and async durable factory without a hosted retry adapter', async () => {
    const store = fakeStore(), native = moduleFixture(), controller = new AbortController(), now = () => 100;
    const runtime = await openNativeExecutionRuntime(executionRequest(), { env: ENV, signal: controller.signal, now,
      createStore: () => store, loadModules: async () => native.modules });
    assert.ok(runtime); assert.equal(native.clientArgs.length, 0);
    const pin = freezePin(createComparisonPin(comparison(), params));
    await runtime.compare(pin.base, pin.params, { piPolicy: 'Exclude', signal: controller.signal, waitForInflight: false });
    assert.equal(native.compare.mock.calls[0][2].piPolicy, 'Exclude');
    assert.equal((native.compare.mock.calls[0][2] as { signal?: AbortSignal }).signal, controller.signal);
    const configured = native.captures[0];
    assert.equal(configured.store, store); configured.client(); configured.client();
    assert.deepEqual(native.clientArgs, [[ENV.WCL_CLIENT_ID, ENV.WCL_CLIENT_SECRET]]);
    await configured.budgetFactory({ signal: controller.signal });
    const charged = native.budget.mock.calls[0][0];
    assert.equal(charged.store, store); assert.equal(charged.account, runtime.account); assert.equal(charged.signal, controller.signal); assert.equal(charged.now, now);
    await runtime.close(); await runtime.close(); assert.equal(store.close.mock.calls.length, 1);
  });
});

describe('off-mode protected projection matches the normalized throughput contract', () => {
  for (const shape of ['empty statistics', 'resource events without snapshots', 'snapshots without optional max/gains', 'signed resource gain', 'signed healing table', 'partial Boss']) {
    test(`${shape} remains HTTP200 without changing casts/resources/series/lust or optional side context`, async () => {
      const value = comparison(), sides = [value.a, value.b, value.bossReference.b];
      const input: CompareParams = { ...params };
      if (shape === 'empty statistics') {
        for (const side of sides) {
          side.casts = []; side.dmg = {}; side.resources = {}; side.lust = []; side.rankPercent = null;
          side.scope.zone = null; side.scope.size = null;
        }
        value.b.server = '?';
      } else if (shape === 'resource events without snapshots') {
        for (const side of sides) side.resources = { '-1': { max: 0, spentSnap: 0, gained: 50, waste: 5, series: [] } };
      } else if (shape === 'snapshots without optional max/gains') {
        // fetchFightSide's existing raw-field fallbacks materialize this aggregate.
        for (const side of sides) side.resources = { 0: { max: 0, spentSnap: 10, gained: 0, waste: 0, series: [[0, 100], [10, 90]] } };
      } else if (shape === 'signed resource gain') {
        for (const side of sides) side.resources = { '-2147483648': { max: 0, spentSnap: 0, gained: -10, waste: 0, series: [] } };
      } else if (shape === 'signed healing table') {
        input.metric = value.metric = 'hps'; value.className = 'Priest'; value.spec = 'Holy';
        for (const side of sides) side.dmg = { 'Synthetic healing': 60, 'Synthetic signed adjustment': -5 };
      } else { value.bossReference = null; value.bossReferenceError = 'incomplete synthetic Boss evidence'; }
      const before = structuredClone(value), expected = structuredClone(normalizeComparison(value, input).comparison);
      const url = new URL(compareRequest().url); url.searchParams.set('metric', input.metric);
      const response = await createCompareHandler({ builder: async () => value, admission: () => true, executionBinder: false,
        query: async () => { throw new Error('Projection fixture must not start transport'); },
      })(new Request(url));
      assert.equal(response.status, 200); const out = await response.json();
      assert.equal(out.executionStatus.state, 'unsupported'); assert.equal('executionV3Status' in out, false); assert.equal('comparisonID' in out, false);
      delete out.executionStatus; assert.deepEqual(out, expected); assert.deepEqual(value, before);
      assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    });
  }
});

describe('protected comparison pins and default-current partition provenance', () => {
  test('normalized server pin has immutable pair, compact headers, and independent A/B current proofs', async () => {
    const f = binderFixture();
    const response = await f.handler(compareRequest('&executionCurrentPartition=true&executionRankingScope=forged-browser-scope'));
    assert.equal(response.status, 200); assertPrivate(response);
    const out = await response.json();
    assert.equal(out.executionStatus.state, 'unsupported'); assert.equal(out.comparisonID, UUID);
    assert.deepEqual(out.executionV3Status, { state: 'available', available: true, backend: 'native', analyticalVersion: EXECUTION_ANALYTICAL_VERSION,
      capabilities: { build: false, reference: true }, expiresAt: 100 + EXECUTION_PIN_TTL_MS });
    const [base, bound] = f.store.putPin.mock.calls[0];
    assert.deepEqual(bound.executionRankingScope, scope); assert.equal(bound.executionCurrentPartition, true); assert.equal(bound.executionReferenceCurrentPartition, true);
    for (const side of [base.a, base.b] as Record<string, unknown>[]) {
      assert.equal(Object.isFrozen(side), true); assert.equal(Object.isFrozen(side.scope), true);
      for (const key of ['casts', 'resources', 'dmg', 'lust', 'events', 'execution', 'comparisonID']) assert.equal(key in side, false);
    }
    assert.equal(Object.isFrozen(base), true); assert.equal(Object.isFrozen(bound), true);
    assert.equal(f.query.mock.calls.length, 3, 'only one bounded scope query is added to existing throughput queries');
    assert.equal(f.store.close.mock.calls.length, 1);
  });
  for (const [aCurrent, bCurrent] of [[false, true], [true, false], [false, false]]) {
    test(`historic/unproven A=${aCurrent}/B=${bCurrent} is never relabeled current`, async () => {
      const f = binderFixture({ aCurrent, bCurrent });
      assert.equal((await f.handler(compareRequest('&code=Player0123456789&fightID=7&partition=999'))).status, 200);
      const bound = f.store.putPin.mock.calls[0][1];
      assert.equal(bound.executionCurrentPartition, aCurrent); assert.equal(bound.executionReferenceCurrentPartition, bCurrent);
      assert.equal((bound.executionRankingScope as { partition: number }).partition, 7);
    });
  }
  test('post-dispatch variable mutation cannot forge B current-row query context', async () => {
    const f = binderFixture();
    f.builder.mockImplementation(async (client) => {
      await client.query(charDocument, { name: 'You', slug: 'test-realm', region: 'us', enc: 42, diff: 5, metric: 'dps' });
      const variables = { enc: 42, diff: 5, metric: 'dps', cls: 'Warrior', spec: 'Arcane' };
      const pending = client.query(worldDocument, variables); variables.cls = 'Mage'; await pending;
      return comparison();
    });
    const response = await f.handler(compareRequest()); assert.equal(response.status, 200);
    assert.equal(f.store.putPin.mock.calls[0][1].executionCurrentPartition, true);
    assert.equal(f.store.putPin.mock.calls[0][1].executionReferenceCurrentPartition, false);
  });
  test('matching B namesake on a wrong realm cannot supply current-row proof', async () => {
    const f = binderFixture();
    f.query.mockImplementation(async (document) => {
      const out = comparison();
      if (document.includes('encounterRankings')) return { characterData: { character: { classID: 8, encounterRankings: { ranks: [] } } } };
      if (document.includes('characterRankings')) return { worldData: { encounter: { name: 'Test Boss', characterRankings: {
        hasMorePages: false, rankings: [{ name: out.b.name, server: { name: 'Wrong Realm' }, report: { code: out.b.code, fightID: out.b.fightID }, amount: 2200 }],
      } } } };
      return { worldData: { encounter: { id: 42 } } };
    });
    assert.equal((await f.handler(compareRequest())).status, 200);
    assert.equal(f.store.putPin.mock.calls[0][1].executionReferenceCurrentPartition, false);
  });
  test('compact WCL actor realms retain private pins and independent current A/B ranking proof', async () => {
    const f = binderFixture({ env: { ...ENV, EXECUTION_NATIVE_ENABLED: '0' } }), build = f.builder.getMockImplementation()!;
    f.builder.mockImplementation(async (client) => {
      const out = await build(client);
      out.a.server = 'TestRealm'; out.b.server = 'TestRealm';
      return out;
    });
    const response = await f.handler(compareRequest('', { headers: { Authorization: `Bearer ${ENV.EXECUTION_VERIFY_TOKEN}` } }));
    assert.equal(response.status, 200); assertPrivate(response);
    const out = await response.json(); assert.equal(out.comparisonID, UUID); assert.equal(out.executionV3Status.available, true);
    assert.equal(out.a.server, 'TestRealm'); assert.equal(out.b.server, 'TestRealm');
    const [base, bound] = f.store.putPin.mock.calls[0];
    assert.equal(bound.server, 'Test Realm'); assert.equal(bound.executionCurrentPartition, true); assert.equal(bound.executionReferenceCurrentPartition, true);
    assert.equal(readComparisonPin({ base, params: bound }).base.a.server, 'TestRealm');
    assert.equal(f.store.putPin.mock.calls.length, 1); assert.equal(f.store.close.mock.calls.length, 1);
    assert.equal(f.store.claim.mock.calls.length, 0); assert.equal(f.native.compare.mock.calls.length, 0);
  });
  test('realm formatting equivalence never accepts a different realm or changes retained actor identity', () => {
    for (const server of ['TestRealm', 'test-realm', 'Test Realm', 'TEST_REALM']) {
      const out = comparison(); out.a.server = server;
      const pin = createComparisonPin(out, params);
      assert.equal(pin.base.a.server, server); assert.equal(pin.params.server, params.server);
      assert.equal(readComparisonPin(pin).base.a.server, server);
    }
    for (const server of ['Different Realm', 'Test Realm Two', 'Test', '?']) {
      const out = comparison(); out.a.server = server;
      assert.throws(() => createComparisonPin(out, params));
      const pin = createComparisonPin(comparison(), params); pin.base.a.server = server;
      assert.throws(() => readComparisonPin(pin));
    }
  });
  test('unverified native scope remains unknown rather than trusting builder/browser partition', async () => {
    const f = binderFixture();
    vi.mocked(f.native.modules.resolveScope).mockRejectedValueOnce(new Error('synthetic unsupported metadata'));
    const response = await f.handler(compareRequest('&partition=7&executionCurrentPartition=true'));
    assert.equal(response.status, 200); assert.equal((await response.json()).comparisonID, UUID);
    const bound = f.store.putPin.mock.calls[0][1];
    assert.equal('executionRankingScope' in bound, false); assert.equal(bound.executionCurrentPartition, false); assert.equal(bound.executionReferenceCurrentPartition, false);
  });
  test('forged builder IDs/Execution fields are stripped before binding and mutation cannot change the pair', async () => {
    const observed: unknown[] = [];
    const builder = vi.fn(async (_client: ComparisonClient, input: CompareParams) => {
      assert.equal(Object.isFrozen(input), true);
      return { ...comparison(), comparisonID: 'forged-builder-id', executionV3Status: { available: true }, executionReference: { score: 100 },
        a: { ...comparison().a, execution: { score: 100 }, comparisonID: 'nested-forgery' } };
    });
    const handler = createCompareHandler({ builder, query: async () => { throw new Error('Unexpected query'); }, admission: () => true,
      executionBinder: () => ({ cacheKey: 'synthetic', observe() {}, async bind(base, input) {
        observed.push(base); assert.equal(Object.isFrozen(base), true); assert.equal(Object.isFrozen(base.a), true); assert.equal(Object.isFrozen(input), true);
        assert.throws(() => Reflect.set(base.a, 'actorID', 999) || (() => { throw new TypeError(); })(), TypeError);
        assert.equal('comparisonID' in base, false); assert.equal('execution' in base.a, false);
        return { comparisonID: UUID, createdAt: Date.now() };
      } }),
    });
    const response = await handler(compareRequest()); assert.equal(response.status, 200);
    const out = await response.json(); assert.equal(out.comparisonID, UUID); assert.equal(out.a.actorID, 123); assert.equal('execution' in out.a, false);
    assert.equal('executionReference' in out, false); assert.equal(observed.length, 1);
  });
  for (const failure of ['preflight', 'pin-write']) {
    test(`${failure} failure retains normal throughput HTTP200 with sanitized unavailable Execution`, async () => {
      const f = binderFixture();
      if (failure === 'preflight') f.store.preflight.mockRejectedValue(new Error('synthetic secret SQL/password'));
      else f.store.putPin.mockRejectedValue(new Error('synthetic secret SQL/password'));
      const response = await f.handler(compareRequest()); assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json(); assert.equal(out.a.actorID, 123); assert.equal(out.b.name, 'OverallWinner');
      assert.equal(out.executionV3Status.state, 'unavailable'); assert.equal('comparisonID' in out, false);
      assert.doesNotMatch(JSON.stringify(out), /SQL|password|synthetic secret/);
      assert.equal(f.store.close.mock.calls.length, 1);
      if (failure === 'preflight') assert.equal(f.query.mock.calls.length, 2, 'disabled cutover starts no extra WCL query');
    });
  }
  test('private verification pins cannot leak through the warm ordinary/off-mode cache', async () => {
    const f = binderFixture({ env: { ...ENV, EXECUTION_NATIVE_ENABLED: '0' } });
    const privateRequest = compareRequest('', { headers: { Authorization: `Bearer ${ENV.EXECUTION_VERIFY_TOKEN}` } });
    assert.equal((await (await f.handler(privateRequest)).json()).comparisonID, UUID);
    const off = await (await f.handler(compareRequest())).json(); assert.equal('comparisonID' in off, false); assert.equal('executionV3Status' in off, false);
    assert.equal(f.builder.mock.calls.length, 2); assert.equal(f.store.putPin.mock.calls.length, 1);
    assert.equal(f.query.mock.calls.length, 5, 'the off comparison adds no scope query');
  });
  test('delayed cache insertion never slides ten-minute DB pin TTL or reacquires expired cached pins', async () => {
    let now = 100;
    const f = binderFixture({ clock: () => now });
    f.store.close.mockImplementation(async () => { now = 200; });
    const first = await (await f.handler(compareRequest())).json();
    assert.equal(first.executionV3Status.expiresAt, 100 + EXECUTION_PIN_TTL_MS);
    now = 100 + EXECUTION_PIN_TTL_MS - 1;
    assert.equal((await (await f.handler(compareRequest())).json()).comparisonID, UUID);
    now = 100 + EXECUTION_PIN_TTL_MS;
    const expired = await (await f.handler(compareRequest())).json();
    assert.equal('comparisonID' in expired, false); assert.equal(expired.executionV3Status.available, false); assert.equal(expired.a.amount, first.a.amount);
    assert.equal(f.builder.mock.calls.length, 1); assert.equal(f.store.putPin.mock.calls.length, 1); assert.equal(f.store.readPin.mock.calls.length, 0);
    assert.equal(f.query.mock.calls.length, 3);
  });
  test('optional binding deadline preserves completed throughput and settles its started transport', async () => {
    vi.useFakeTimers();
    const begun = deferred(); let settled = false;
    const handler = createCompareHandler({ builder: async () => comparison(), admission: () => true, deadlineMs: 25,
      query: async (_document, _variables, options) => new Promise((_resolve, reject) => {
        begun.resolve(undefined); options!.signal!.addEventListener('abort', () => { settled = true; reject(options!.signal!.reason); }, { once: true });
      }), executionBinder: () => ({ cacheKey: 'synthetic', observe() {}, async bind(_base, _params, client) {
        await client.query('query SyntheticScope'); return { comparisonID: UUID, createdAt: Date.now() };
      } }),
    });
    const pending = handler(compareRequest()); await begun.promise; await vi.advanceTimersByTimeAsync(25);
    const response = await pending; assert.equal(response.status, 200); assert.equal(settled, true);
    const out = await response.json(); assert.equal(out.executionV3Status.available, false); assert.equal('comparisonID' in out, false);
    assert.equal(vi.getTimerCount(), 0); assert.equal(COMPARE_DEADLINE_MS, 55_000);
  });
  test('late throughput skips provider setup when full DB write and cleanup reserves do not fit', async () => {
    let now = 100;
    const f = binderFixture({ clock: () => now }), build = f.builder.getMockImplementation()!;
    f.builder.mockImplementation(async (client) => { const result = await build(client); now += 35_001; return result; });
    const response = await f.handler(compareRequest()); assert.equal(response.status, 200);
    const out = await response.json(); assert.equal(out.executionV3Status.available, false); assert.equal('comparisonID' in out, false);
    assert.equal(f.createStore.mock.calls.length, 0); assert.equal(f.query.mock.calls.length, 2);
  });
  test('slow optional scope settles its transport and bounded store close before the unchanged55s deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100);
    const f = binderFixture({ clock: Date.now }), query = f.query.getMockImplementation()!, begun = deferred();
    let active = 0, returned = false, closed = false;
    f.store.close.mockImplementation(async () => { assert.equal(active, 0); await new Promise((resolve) => setTimeout(resolve, 5000)); closed = true; });
    const handler = createCompareHandler({ builder: f.builder, admission: () => true, clock: Date.now,
      query: async (document, _variables, options) => {
        if (document !== metadataDocument) return query(document);
        active++; begun.resolve(undefined);
        return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => { active--; reject(options!.signal!.reason); }, { once: true }));
      },
      executionBinder: (request, context) => createHostedComparisonBinder(request, { ...context, env: ENV, createStore: f.createStore, loadModules: f.loadModules }),
    });
    const pending = handler(compareRequest()).then((response) => { returned = true; return response; });
    await begun.promise; await vi.advanceTimersByTimeAsync(44_000);
    assert.equal(active, 0); assert.equal(returned, false); assert.equal(closed, false);
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending; assert.equal(response.status, 200); assert.equal(closed, true);
    assert.equal(Date.now(), 49_100); assert.equal(f.store.putPin.mock.calls.length, 0); assert.equal(f.store.close.mock.calls.length, 1);
    const out = await response.json(); assert.equal(out.executionV3Status.available, false); assert.equal('comparisonID' in out, false);
    assert.equal(vi.getTimerCount(), 0);
  });
  test('retained pin reads reject tampering instead of replacing immutable pair or PI evidence', () => {
    const pin = createComparisonPin(comparison(), params);
    assert.equal(readComparisonPin(pin).base.a.actorID, 123);
    for (const mutated of [
      { ...pin, params: { ...pin.params, code: 'Other01234567890' } },
      { ...pin, base: { ...pin.base, pi: { a: null, b: false, excluded: true } } },
      { ...pin, params: { ...pin.params, executionCurrentPartition: true } },
    ]) assert.throws(() => readComparisonPin(mutated));
  });
});

describe('strict native v3 retained-ID route and bounded public projection', () => {
  test('actual Node route remains fail-closed without configuration and keeps 180s runtime envelope', async () => {
    const { GET, runtime, maxDuration } = await import('../../app/api/castmirror/execution/v3/route');
    assert.equal(runtime, 'nodejs'); assert.equal(maxDuration, 180);
    assert.equal(EXECUTION_DEADLINE_MS <= 150_000, true);
    const response = await GET(executionRequest()); assert.equal(response.status, 503); assertPrivate(response);
    const out = await response.json(); assert.equal(out.state, 'unsupported'); assert.equal('comparisonID' in out, false);
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
  });
  for (const query of ['', 'comparisonID=forged&pi=Any', `comparisonID=${UUID}&pi=any`, `comparisonID=${UUID}&pi=Exclude&pi=Any`,
    `comparisonID=${UUID}&comparisonID=${UUID}&pi=Any`, `comparisonID=${UUID}&pi=Any&revision=forged`, `comparisonID=${UUID}&pi=Any&executionRankingScope=forged`]) {
    test(`strict query rejection ${query} starts no runtime/storage/transport`, async () => {
      const f = runtimeFixture();
      assert.equal((await createExecutionV3Handler({ openRuntime: f.openRuntime })(executionRequest(query))).status, 400);
      assert.equal(f.openRuntime.mock.calls.length, 0); assert.equal(f.store.readPin.mock.calls.length, 0); assert.equal(f.compare.mock.calls.length, 0);
    });
  }
  test('unknown/expired pin returns409 without collection or sliding a pin', async () => {
    const f = runtimeFixture(); f.store.readPin.mockResolvedValueOnce(null as never);
    const response = await createExecutionV3Handler({ openRuntime: f.openRuntime })(executionRequest());
    assert.equal(response.status, 409); assertPrivate(response); assert.equal(f.compare.mock.calls.length, 0);
    assert.equal(f.store.putPin.mock.calls.length, 0); assert.equal(f.close.mock.calls.length, 1);
  });
  for (const pi of ['Any', 'Exclude'] as const) {
    test(`PI ${pi} preserves unknown/absent states and six categories with no Any fallback`, async () => {
      const f = runtimeFixture();
      const response = await createExecutionV3Handler({ openRuntime: f.openRuntime })(executionRequest(`comparisonID=${UUID}&pi=${pi}`));
      assert.equal(response.status, 200); assertPrivate(response);
      const out = await response.json(); assert.deepEqual(Object.keys(out).sort(), ['comparisonID', 'executionReference']);
      const [base, bound, options] = f.compare.mock.calls[0];
      assert.equal(Object.isFrozen(base), true); assert.equal(Object.isFrozen(bound), true); assert.equal(base.a.code, 'Player0123456789');
      for (const side of [base.a, base.b]) for (const key of ['casts', 'resources', 'dmg', 'lust']) assert.equal(key in side, false);
      assert.equal((options as { waitForInflight?: boolean }).waitForInflight, false);
      assert.ok((options as { signal?: AbortSignal }).signal instanceof AbortSignal);
      assert.deepEqual(out.executionReference.pi, { a: null, b: false, excluded: pi === 'Exclude' });
      const execution = out.executionReference.execution;
      assert.equal(execution.analyticalVersion, EXECUTION_ANALYTICAL_VERSION); assert.equal(execution.piPolicy, pi); assert.equal(execution.comparable, false);
      assert.deepEqual(Object.keys(execution.a.components), ['avoidance', 'survival', 'incoming', 'defenses', 'output', 'healing']);
      assert.equal(execution.a.score, null); assert.equal(execution.globalWinner, null);
      assert.equal(f.compare.mock.calls.length, 1); assert.equal(f.close.mock.calls.length, 1);
    });
  }
  test('response bound is1MiB, not an internal pool bound or a4.5MB platform assumption', async () => {
    assert.equal(EXECUTION_RESPONSE_BYTES, 1024 * 1024);
    const f = runtimeFixture();
    f.compare.mockImplementation(async (base, _params, options) => {
      const result = nativeReference(base, options.piPolicy);
      result.execution.a.components.avoidance.measurements = { syntheticBound: 'x'.repeat(EXECUTION_RESPONSE_BYTES) };
      return result;
    });
    const response = await createExecutionV3Handler({ openRuntime: f.openRuntime })(executionRequest());
    assert.equal(response.status, 503); assertPrivate(response);
    assert.deepEqual(Object.keys(await response.json()), ['error']); assert.equal(f.close.mock.calls.length, 1);
  });
  test('raw storage/provider diagnostics are sanitized and never trigger a replay', async () => {
    const f = runtimeFixture(); f.compare.mockRejectedValue(new Error('synthetic token/private SQL/raw provider response'));
    const response = await createExecutionV3Handler({ openRuntime: f.openRuntime })(executionRequest());
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /token|SQL|provider response/);
    assert.equal(f.compare.mock.calls.length, 1); assert.equal(f.close.mock.calls.length, 1); assert.equal(f.store.putPin.mock.calls.length, 0);
  });
  for (const kind of ['incoming-abort', 'deadline']) {
    test(`${kind} bridges native transport and waits for settlement/cleanup`, async () => {
      vi.useFakeTimers();
      const f = runtimeFixture(), begun = deferred(); let active = 0, settled = false;
      f.compare.mockImplementation(async (_base, _params, options) => {
        const signal = (options as { signal: AbortSignal }).signal;
        active++; begun.resolve(undefined);
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { active--; settled = true; reject(signal.reason); }, { once: true }));
      });
      f.close.mockImplementation(async () => { assert.equal(settled, true); assert.equal(active, 0); });
      const controller = new AbortController();
      const pending = createExecutionV3Handler({ openRuntime: f.openRuntime, deadlineMs: 25 })(executionRequest(undefined, { signal: controller.signal }));
      await begun.promise;
      if (kind === 'incoming-abort') controller.abort(); else await vi.advanceTimersByTimeAsync(25);
      const response = await pending; assert.equal(response.status, kind === 'incoming-abort' ? 499 : 504);
      assert.equal(active, 0); assert.equal(f.compare.mock.calls.length, 1); assert.equal(f.close.mock.calls.length, 1); assert.equal(vi.getTimerCount(), 0);
    });
  }
  test('pre-aborted/native non-GET requests start no work; Next owns automatic method dispatch', async () => {
    const f = runtimeFixture(), handler = createExecutionV3Handler({ openRuntime: f.openRuntime });
    const controller = new AbortController(); controller.abort();
    assert.equal((await handler(executionRequest(undefined, { signal: controller.signal }))).status, 499);
    assert.equal((await handler(executionRequest(undefined, { method: 'POST' }))).status, 405);
    assert.equal(f.openRuntime.mock.calls.length, 0);
  });
});
