import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import catalog from '../../vendor/castmirror/reviews/venomous-abyss-mythic.json';
import { retainAvoidanceEvidence } from '../../scripts/castmirror-execution-evidence.mjs';
import { LiveExecutionService, liveStatisticsRules, publicStatisticsEvaluation } from '../../vendor/castmirror/native/execution/live.mjs';
import { measureStatisticsFight } from '../../vendor/castmirror/native/execution/statistics.mjs';
import { REQUIRED_STREAMS, streamBinding } from '../../vendor/castmirror/native/execution/contracts.mjs';
import { LIVE_LIMITS } from '../../vendor/castmirror/native/execution/live-budget.mjs';
import { MaintenanceBudget } from '../../vendor/castmirror/native/execution/maintenance.mjs';

// Independent expectations catch a missing boss or an accidental cast/soak ID in
// the compiled native adapter, even if the same change reaches the JSON source.
const EXPECTED = [
  { encounter: 3470, name: "Nek'zali the Soulcoiler", ids: [1288554, 1294846, 1300239], excludedID: 1292899 },
  { encounter: 3445, name: 'Entombed Sentinels', ids: [1284209], excludedID: 1284451 },
  { encounter: 3455, name: 'Vashnik the Malignant', ids: [1295798, 1286737], excludedID: 1281907 },
  { encounter: 3497, name: 'The Lost Explorers', ids: [1305844, 1297650, 1306127, 1292764], excludedID: 1310500 },
  { encounter: 3420, name: 'Sszorak', ids: [1287083, 1305998, 1300089], excludedID: 1297414 },
  { encounter: 3421, name: 'The Twin Fangs', ids: [1292807, 1294605, 1307363, 1306876, 1306925, 1309471], excludedID: 1313533 },
  { encounter: 3429, name: 'The Coiled Altar', ids: [1283840, 1285017, 1283290], excludedID: 1287722 },
  { encounter: 3492, name: "Ula'tek", ids: [1292403, 1286885, 1302982], excludedID: 1304012 },
  { encounter: 3379, name: 'Nymrissa Wavecaller', ids: [1258677], excludedID: 1257654 },
  { encounter: 3513, name: "Kith'ix", ids: [1303685], excludedID: 1308880 },
];
type Boss = typeof EXPECTED[number];
type DamageEvent = { type: string; fight: number; timestamp: number; targetID: number;
  abilityGameID: number; amount: number; absorbed: number; mitigated: number };
interface EvidenceRow { abilityID: number; name: string; hits: number; total: number; absorbed: number; mitigated: number }
interface TransportOptions {
  onAttempt: (event: { kind: string; attempt: number }) => unknown;
  onResponseBytes: (event: { bytes: number }) => unknown;
}

const NOW = 1_000_000, SELECTED = 'Selected01234567', REFERENCE = 'Reference0123456';
const scopeFor = (encounter: number) => ({ ...catalog.scope, encounter });

function nativeFight(boss: Boss) {
  const scope = scopeFor(boss.encounter);
  const rawRoster = Array.from({ length: 20 }, (_, index) => ({ id: index + 1,
    name: index === 0 ? 'Reviewer' : 'Raider' + index, server: 'Test Realm', region: 'us',
    specs: [{ spec: index === 0 ? 'Havoc' : 'Frost', count: 1 }] }));
  const actors = rawRoster.map((player) => ({ id: player.id, name: player.name, server: player.server,
    type: 'Player', subType: player.id === 1 ? 'DemonHunter' : 'Mage' }));
  const roster = rawRoster.map((player) => ({ ...player, className: player.id === 1 ? 'DemonHunter' : 'Mage',
    spec: player.specs[0].spec, role: 'dps' }));
  const fight = { id: 1, encounterID: boss.encounter, difficulty: 5, size: 20, kill: true,
    startTime: 0, endTime: 300_000, friendlyPlayers: roster.map((player) => player.id) };
  const foreignID = EXPECTED.find((entry) => entry.encounter !== boss.encounter)!.ids[0];
  const damage = (abilityGameID: number, amount: number, targetID = 1, timestamp = 1000): DamageEvent =>
    ({ type: 'damage', fight: 1, timestamp, targetID, abilityGameID, amount, absorbed: 4, mitigated: 2 });
  const damageEvents = [damage(boss.ids[0], 17), damage(boss.excludedID, 999, 1, 2000),
    damage(foreignID, 111, 1, 3000), damage(boss.ids[0], 41, 2, 4000)];
  const combatants = roster.map((player) => ({ type: 'combatantinfo', fight: 1, timestamp: 0, sourceID: player.id, auras: [] }));
  const streams = Object.fromEntries(REQUIRED_STREAMS.map(({ name }: { name: string }) => [name,
    { state: 'known', pages: 1, binding: streamBinding(name, SELECTED, fight, true),
      events: name === 'DamageTaken' ? damageEvents : name === 'CombatantInfo' ? combatants : [] }]));
  const input = { scope, candidate: { code: SELECTED, fightID: 1 }, fight, roster, streams,
    rep: { code: SELECTED, revision: 1, zone: { id: scope.zone }, masterData: { actors } } };
  return { scope, rawRoster, actors, fight, input, damageEvents, combatants, damage };
}

// Exercise the actual provider adapter, compaction, public response and retained
// pool. Only network responses, storage and budget ownership are offline.
function liveFixture(boss: Boss) {
  const f = nativeFight(boss), pools = new Map<string, unknown>();
  const calls: Array<{ code: string; stream: string }> = [];
  let requests = 0;
  const client = {
    async query(document: string, variables: Record<string, unknown>, options: TransportOptions) {
      await options.onAttempt({ kind: 'graphql', attempt: 1 });
      requests++;
      let data: Record<string, unknown>;
      if (document.includes('characterRankings(')) {
        data = { worldData: { encounter: { characterRankings: { rankings: [], hasMorePages: false, page: 1 } } } };
      } else if (document.includes('worldData')) {
        data = { worldData: { encounter: { id: boss.encounter, name: boss.name, zone: {
          id: f.scope.zone, name: 'Synthetic raid', difficulties: [{ id: 5, name: 'Mythic', sizes: [20] }],
          partitions: [{ id: 2, name: f.scope.patch, default: true }], encounters: [{ id: boss.encounter }],
        } } } };
      } else if (document.includes('masterData')) {
        data = { reportData: { report: { code: variables.code, visibility: 'public', startTime: 0,
          endTime: 300_000, revision: 1, zone: { id: f.scope.zone }, masterData: { actors: f.actors, abilities: [] }, fights: [f.fight] } } };
      } else if (document.includes('playerDetails(')) {
        const output = { data: { entries: f.rawRoster.map((player) => ({ id: player.id, total: 1000 })) } };
        data = { reportData: { report: { playerDetails: { data: { playerDetails: { dps: f.rawRoster, tanks: [], healers: [] } } },
          output, bossOutput: output } } };
      } else if (document.includes('events(dataType:')) {
        const stream = document.match(/events\(dataType: (\w+)/)?.[1];
        assert.ok(stream);
        const code = String(variables.code);
        calls.push({ code, stream });
        const events = stream === 'DamageTaken' ? code === SELECTED ? f.damageEvents : [f.damage(boss.excludedID, 999)]
          : stream === 'CombatantInfo' ? f.combatants : [];
        data = { reportData: { report: { events: { data: events, nextPageTimestamp: null } } } };
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
      ownership: { account: 'offline', owner: 'raid-rule-test', fence: 1 }, release: async () => {} }) };
  const service = new LiveExecutionService(serviceOptions);
  const side = (code: string) => ({ code, fightID: 1, actorID: 1, name: 'Reviewer', server: 'Test Realm', scope: f.scope });
  const base = { a: side(SELECTED), b: side(REFERENCE), encounter: { id: boss.encounter }, difficulty: 5,
    className: 'DemonHunter', spec: 'Havoc', hero: null };
  const params = { executionRankingScope: f.scope, executionCurrentPartition: true, executionReferenceCurrentPartition: true };
  return { service, calls, base, params };
}

describe('reviewed raid rules in the generated native runtime', () => {
  test('all ten named raid encounters have the independently reviewed native damage IDs', () => {
    assert.deepEqual(catalog.encounters.map(({ encounter, name }) => ({ encounter, name })),
      EXPECTED.map(({ encounter, name }) => ({ encounter, name })));
    for (const boss of EXPECTED) {
      const rules = liveStatisticsRules(scopeFor(boss.encounter));
      assert.deepEqual(rules.avoidableAbilityIDs, boss.ids, boss.name);
      assert.deepEqual(rules.usefulTargetNPCIDs, [], 'historical Nek target rules must not leak into the new patch');
      assert.equal(rules.incomingDirection, null, 'total incoming damage remains context');
      const entry = catalog.encounters.find(({ encounter }) => encounter === boss.encounter)!;
      for (const excluded of entry.excluded) {
        if ('abilityID' in excluded) assert.ok(!rules.avoidableAbilityIDs.includes(excluded.abilityID), excluded.name);
      }
      for (const other of EXPECTED.filter((entry) => entry.encounter !== boss.encounter)) {
        for (const id of other.ids) assert.ok(!rules.avoidableAbilityIDs.includes(id), `${other.name} must not leak into ${boss.name}`);
      }
    }
  });

  test('different and incomplete live scopes fail closed for every reviewed encounter', () => {
    for (const boss of EXPECTED) {
      const scope = scopeFor(boss.encounter);
      for (const key of Object.keys(scope) as Array<keyof typeof scope>) {
        const changed = { ...scope, [key]: typeof scope[key] === 'number' ? 999 : 'unreviewed' };
        assert.deepEqual(liveStatisticsRules(changed).avoidableAbilityIDs, [], `${boss.name}: mismatched ${key}`);
        const missing: Partial<typeof scope> = { ...scope };
        delete missing[key];
        assert.deepEqual(liveStatisticsRules(missing).avoidableAbilityIDs, [], `${boss.name}: missing ${key}`);
      }
    }
    assert.deepEqual(liveStatisticsRules({}).avoidableAbilityIDs, []);
  });

  test('retains the original Nekzali patch scope without granting it to other historical bosses', () => {
    const historical = { ...scopeFor(3470), partition: 1, patch: '12.1' };
    assert.deepEqual(liveStatisticsRules(historical).avoidableAbilityIDs, [1288554, 1294846, 1300239]);
    assert.deepEqual(liveStatisticsRules(historical).usefulTargetNPCIDs, [259927, 261509, 268204]);
    for (const boss of EXPECTED.filter(({ encounter }) => encounter !== 3470)) {
      assert.deepEqual(liveStatisticsRules({ ...historical, encounter: boss.encounter }).avoidableAbilityIDs, []);
    }
  });

  for (const boss of EXPECTED) {
    test(`${boss.name}: native statistics count reviewed contacts and retain named public evidence`, () => {
      const f = nativeFight(boss), entry = catalog.encounters.find(({ encounter }) => encounter === boss.encounter)!;
      const observations = measureStatisticsFight(f.input, { rules: liveStatisticsRules(f.scope) });
      const selected = observations.find((observation: { identity: { actorID: number } }) => observation.identity.actorID === 1);
      assert.ok(selected);
      const avoidance = selected.components.avoidance;
      assert.equal(avoidance.state, 'known');
      assert.equal(avoidance.measurements.complete, true);
      assert.equal(avoidance.measurements.exposure, 'full-fight');
      assert.equal(avoidance.measurements.total, 17, 'assigned, foreign-boss and other-player damage is excluded');
      assert.equal(avoidance.measurements.perSecond, 17 / 300);
      assert.equal(avoidance.measurements.hits, 1);
      assert.equal(selected.components.incoming.measurements.total, 1127, 'excluded damage remains in incoming context');
      retainAvoidanceEvidence(avoidance, entry);
      const publicResult = publicStatisticsEvaluation(selected), measurements = publicResult.components.avoidance.measurements;
      assert.deepEqual(measurements.byAbility.map((row: EvidenceRow) => [row.abilityID, row.name]),
        [...entry.abilities].sort((a, b) => a.abilityID - b.abilityID).map((ability) =>
          [ability.abilityID, 'label' in ability ? ability.label : ability.name]));
      assert.deepEqual(measurements.byAbility.find((row: EvidenceRow) => row.abilityID === boss.ids[0]),
        { abilityID: boss.ids[0], name: 'label' in entry.abilities[0] ? entry.abilities[0].label : entry.abilities[0].name,
          hits: 1, total: 17, absorbed: 4, mitigated: 2 });
      assert.deepEqual(measurements.incidents, [{ time: 1, abilityID: boss.ids[0], amount: 17, absorbed: 4, mitigated: 2 }]);
      assert.equal(measurements.incidentCount, 1);
      assert.equal(measurements.incidentListComplete, true);
      assert.ok(measurements.byAbility.filter((row: EvidenceRow) => row.abilityID !== boss.ids[0])
        .every((row: EvidenceRow) => row.hits === 0 && row.total === 0), 'unhit reviewed abilities are observed zero');
    });

    test(`${boss.name}: live service collects, labels and hydrates both logs with the reviewed rules`, async () => {
      const f = liveFixture(boss), entry = catalog.encounters.find(({ encounter }) => encounter === boss.encounter)!;
      const result = await f.service.compare(f.base, f.params);
      assert.deepEqual(f.calls.slice(0, 6), [
        { code: SELECTED, stream: 'Deaths' }, { code: SELECTED, stream: 'DamageTaken' }, { code: SELECTED, stream: 'Casts' },
        { code: REFERENCE, stream: 'Deaths' }, { code: REFERENCE, stream: 'DamageTaken' }, { code: REFERENCE, stream: 'Casts' },
      ]);
      const a = result.execution.a.components.avoidance, b = result.execution.b.components.avoidance;
      assert.equal((a as Record<string, unknown>).state, 'known');
      assert.equal(a.measurements.total, 17);
      assert.equal(a.measurements.hits, 1);
      assert.equal(a.measurements.complete, true);
      assert.equal(b.measurements.total, 0, 'reference assigned damage is observed zero avoidable damage');
      assert.equal(b.measurements.complete, true);
      const labels = new Map(entry.abilities.map((ability) => [ability.abilityID, 'label' in ability ? ability.label : ability.name]));
      for (const row of a.measurements.byAbility as EvidenceRow[]) assert.equal(row.name, labels.get(row.abilityID));
      const requests = f.calls.length;
      const hydrated = await f.service.compare(f.base, f.params);
      assert.equal((hydrated.execution.coverage.acquisition as Record<string, unknown>).cached, true);
      assert.deepEqual(hydrated.execution.a.components.avoidance.measurements, a.measurements);
      assert.deepEqual(hydrated.execution.b.components.avoidance.measurements, b.measurements);
      assert.equal(f.calls.length, requests, 'cache hydration does not replay provider requests');
    });
  }
});
