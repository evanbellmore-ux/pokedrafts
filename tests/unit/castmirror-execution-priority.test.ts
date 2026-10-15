import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { LiveExecutionService } from '../../vendor/castmirror/native/execution/live.mjs';
import { LIVE_LIMITS } from '../../vendor/castmirror/native/execution/live-budget.mjs';
import { MaintenanceBudget } from '../../vendor/castmirror/native/execution/maintenance.mjs';

const NOW = 1_000_000;
const SCOPE = { zone: 53, encounter: 3497, difficulty: 5, size: 20, partition: 2, patch: '12.1.5' };
const SELECTED = 'Selected01234567', REFERENCE = 'Reference0123456';
type Mode = 'enrichment-abort' | 'complete-paged' | 'page-cap';
interface Call { code: string; stream: string; start: number }
interface TransportOptions {
  onAttempt: (event: { kind: string; attempt: number }) => unknown;
  onResponseBytes: (event: { bytes: number }) => unknown;
}

// The source, event pagination, statistics engine, compaction and live service
// are real. Only provider responses, shared storage and ownership are offline.
function fixture(mode: Mode) {
  const calls: Call[] = [], pools = new Map<string, unknown>();
  const roster = Array.from({ length: 20 }, (_, index) => ({ id: index + 1,
    name: index === 0 ? 'Reviewer' : 'Raider' + index, server: 'Test Realm', region: 'us',
    specs: [{ spec: index === 0 ? 'Havoc' : 'Frost', count: 1 }] }));
  const actors = roster.map((player) => ({ id: player.id, name: player.name, server: player.server,
    type: 'Player', subType: player.id === 1 ? 'DemonHunter' : 'Mage' }));
  const fight = { id: 1, encounterID: SCOPE.encounter, difficulty: 5, size: 20, kill: true,
    startTime: 0, endTime: 300_000, friendlyPlayers: roster.map((player) => player.id) };
  let requests = 0;
  const client = {
    async query(document: string, variables: Record<string, unknown>, options: TransportOptions) {
      await options.onAttempt({ kind: 'graphql', attempt: 1 });
      requests++;
      let data: Record<string, unknown>;
      if (document.includes('characterRankings(')) {
        data = { worldData: { encounter: { characterRankings: { rankings: [], hasMorePages: false, page: 1 } } } };
      } else if (document.includes('worldData')) {
        data = { worldData: { encounter: { id: SCOPE.encounter, name: 'The Lost Explorers', zone: {
          id: SCOPE.zone, name: 'Synthetic raid', difficulties: [{ id: 5, name: 'Mythic', sizes: [20] }],
          partitions: [{ id: 2, name: SCOPE.patch, default: true }], encounters: [{ id: SCOPE.encounter }],
        } } } };
      } else if (document.includes('masterData')) {
        data = { reportData: { report: { code: variables.code, visibility: 'public', startTime: 0,
          endTime: 300_000, revision: 1, zone: { id: SCOPE.zone }, masterData: { actors, abilities: [] }, fights: [fight] } } };
      } else if (document.includes('playerDetails(')) {
        const output = { data: { entries: roster.map((player) => ({ id: player.id, total: 1000 })) } };
        data = { reportData: { report: { playerDetails: { data: { playerDetails: { dps: roster, tanks: [], healers: [] } } },
          output, bossOutput: output } } };
      } else if (document.includes('events(dataType:')) {
        const stream = document.match(/events\(dataType: (\w+)/)?.[1];
        assert.ok(stream);
        const code = String(variables.code), start = Number(variables.s);
        calls.push({ code, stream, start });
        if (mode === 'enrichment-abort' && stream === 'Healing') {
          throw Object.assign(new Error('Synthetic optional enrichment stopped'), { code: 'synthetic-enrichment-stop' });
        }
        let events: Array<Record<string, unknown>> = [], next: number | null = null;
        if (stream === 'DamageTaken' && code === SELECTED) {
          events = [{ type: 'damage', fight: 1, timestamp: start + 1000, targetID: 1,
            abilityGameID: 1292764, amount: 10, absorbed: 2, mitigated: 1 }];
          if (mode === 'page-cap' || mode === 'complete-paged' && start === 0) next = start + 10_000;
        } else if (stream === 'Casts') {
          events = [{ type: 'cast', fight: 1, timestamp: 20_000, sourceID: 1, targetID: 1, abilityGameID: 198589 }];
        } else if (stream === 'CombatantInfo') {
          events = roster.map((player) => ({ type: 'combatantinfo', fight: 1, timestamp: 0, sourceID: player.id, auras: [] }));
        }
        data = { reportData: { report: { events: { data: events, nextPageTimestamp: next } } } };
      } else {
        assert.match(document, /__typename/);
        data = { __typename: 'Query' };
      }
      const result = { ...data, _executionMaintenanceQuota: {
        limitPerHour: 2000, pointsSpentThisHour: requests, pointsResetIn: 3600,
      } };
      await options.onResponseBytes({ bytes: Buffer.byteLength(JSON.stringify(result)) });
      return result;
    },
  };
  const store = {
    async readPool(key: string) { return structuredClone(pools.get(key) ?? null); },
    async savePool(pool: { key: string }) { pools.set(pool.key, structuredClone(pool)); },
  };
  const budgetOptions = { limits: LIVE_LIMITS, now: () => NOW };
  const serviceOptions = { client: async () => client, store, now: () => NOW,
    budgetFactory: async () => ({ budget: new MaintenanceBudget(budgetOptions),
      ownership: { account: 'offline', owner: 'offline-owner', fence: 1 }, release: async () => {} }) };
  const service = new LiveExecutionService(serviceOptions);
  const side = (code: string) => ({ code, fightID: 1, actorID: 1, name: 'Reviewer', server: 'Test Realm', scope: SCOPE });
  const base = { a: side(SELECTED), b: side(REFERENCE), encounter: { id: SCOPE.encounter }, difficulty: 5,
    className: 'DemonHunter', spec: 'Havoc', hero: null };
  const params = { executionRankingScope: SCOPE, executionCurrentPartition: true, executionReferenceCurrentPartition: true };
  return { service, calls, base, params };
}

describe('live execution prioritizes selected reviewed avoidance', () => {
  test('retains both logs before optional Healing failure and can serve the retained pool', async () => {
    const f = fixture('enrichment-abort');
    const result = await f.service.compare(f.base, f.params);
    assert.deepEqual(f.calls.slice(0, 6).map(({ code, stream }) => [code, stream]), [
      [SELECTED, 'Deaths'], [SELECTED, 'DamageTaken'], [SELECTED, 'Casts'],
      [REFERENCE, 'Deaths'], [REFERENCE, 'DamageTaken'], [REFERENCE, 'Casts'],
    ]);
    assert.equal((result.execution.coverage.acquisition as Record<string, unknown>).reason, 'synthetic-enrichment-stop');
    for (const key of ['a', 'b'] as const) {
      const components = result.execution[key].components;
      assert.equal((components.avoidance as Record<string, unknown>).state, 'known');
      assert.equal(components.avoidance.measurements.complete, true);
      assert.equal(components.avoidance.measurements.total, key === 'a' ? 10 : 0);
      assert.equal(components.avoidance.measurements.byAbility.find((row: { abilityID: number }) => row.abilityID === 1292764).hits, key === 'a' ? 1 : 0);
      assert.equal(components.survival.measurements.deathCount, 0);
      assert.equal(components.defenses.measurements.boundedUses, 1);
    }
    const count = f.calls.length;
    const cached = await f.service.compare(f.base, f.params);
    assert.equal((cached.execution.coverage.acquisition as Record<string, unknown>).cached, true);
    assert.equal(cached.execution.a.components.avoidance.measurements.total, 10);
    assert.equal(f.calls.length, count, 'retained evidence is hydrated without a provider replay');
  });

  test('complete paginated initial damage is not fetched again during successful enrichment', async () => {
    const f = fixture('complete-paged');
    const result = await f.service.compare(f.base, f.params);
    assert.equal((result.execution.coverage.acquisition as Record<string, unknown>).reason, null);
    assert.equal((result.execution.a.components.avoidance as Record<string, unknown>).state, 'known');
    assert.equal(result.execution.a.components.avoidance.measurements.total, 20);
    assert.equal(result.execution.a.components.avoidance.measurements.hits, 2);
    assert.deepEqual(f.calls.filter((call) => call.stream === 'DamageTaken'), [
      { code: SELECTED, stream: 'DamageTaken', start: 0 },
      { code: SELECTED, stream: 'DamageTaken', start: 10_000 },
      { code: REFERENCE, stream: 'DamageTaken', start: 0 },
    ]);
    assert.equal(f.calls.filter((call) => call.stream === 'Healing').length, 2, 'later enrichment actually completed');
  });

  test('capped initial damage stays an observed lower bound without replaying its admitted pages', async () => {
    const f = fixture('page-cap');
    const result = await f.service.compare(f.base, f.params);
    const avoidance = result.execution.a.components.avoidance;
    assert.equal((avoidance as Record<string, unknown>).state, 'incomplete');
    assert.equal(avoidance.measurements.complete, false);
    assert.equal(avoidance.measurements.basis, 'observed-lower-bound');
    assert.equal(avoidance.measurements.total, 30);
    assert.equal(avoidance.measurements.hits, 3);
    assert.deepEqual(f.calls.filter((call) => call.code === SELECTED && call.stream === 'DamageTaken').map((call) => call.start), [0, 10_000, 20_000]);
    assert.equal((result.execution.b.components.avoidance as Record<string, unknown>).state, 'known');
    assert.equal(result.execution.b.components.avoidance.measurements.total, 0);
    assert.equal(f.calls.filter((call) => call.stream === 'Healing').length, 2, 'capped optional data does not stop later categories');
  });
});
