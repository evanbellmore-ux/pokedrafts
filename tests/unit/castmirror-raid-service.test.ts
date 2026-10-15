import assert from 'node:assert/strict';
import { describe, test, vi } from 'vitest';
import { collectRaidBoss, isRetainedRaidReview, raidReviewKey, reviewedRaidAbilities, RAID_REVIEW_RULES_VERSION, type RaidReviewRequest, type RaidReviewRuntime } from '../../app/api/castmirror/execution/raid/collector';
import catalog from '../../vendor/castmirror/reviews/venomous-abyss-mythic.json';
import { createRaidExecutionHandler } from '../../app/api/castmirror/execution/raid/service';
import { gradeBoss } from '../../app/api/castmirror/execution/raid/grade';
import { MaintenanceBudget, MaintenanceStop } from '../../vendor/castmirror/native/execution/maintenance.mjs';
import { LIVE_LIMITS } from '../../vendor/castmirror/native/execution/live-budget.mjs';
import type { RaidBossReview } from '../../app/api/castmirror/execution/raid/types';

vi.mock('server-only', () => ({}));
const NOW = 1_792_100_000_000;
const REQUEST: RaidReviewRequest = { name: 'Reviewer', server: "Mal'Ganis", region: 'us', zone: 53, difficulty: 5, encounter: 3470 };
const CODE = 'AAAAAAAAAAAAAA01';
type Options = { onAttempt(event: { kind: string; attempt: number }): Promise<void>; onResponseBytes(event: { bytes: number }): Promise<void> };
type Row = Record<string, unknown>;
interface FixtureOptions { kills?: number; patch?: string; partition?: number; malformed?: string; mixedZone?: boolean; paginated?: boolean; endless?: boolean; failAt?: number; busy?: boolean; unavailableUtility?: boolean; moreRankings?: boolean; signedHeal?: boolean; participantIdentities?: number; partitionConflict?: boolean; wrongEnvelope?: boolean; encounter?: number; historicalOnly?: boolean }
function fixture(options: FixtureOptions = {}) {
  const kills = options.kills ?? 1;
  const encounter = options.encounter ?? 3470;
  const boss = catalog.encounters.find((b) => b.encounter === encounter)!;
  const firstAbility = boss.abilities[0].abilityID;
  const selected: number[] = [], documents: string[] = [], order: string[] = [];
  const cache = new Map<string, RaidBossReview>();
  const budgetOptions = { now: () => NOW, limits: LIVE_LIMITS };
  const budget = new MaintenanceBudget(budgetOptions);
  const players = Array.from({ length: options.participantIdentities ?? 20 }, (_, i) => i + 1);
  const actors = players.map((id) => ({ id, name: id === 1 ? 'Reviewer' : `Player ${id}`, server: "Mal'Ganis", type: 'Player', subType: 'DemonHunter' }));
  const reportStart = (id: number) => NOW - 1_000_000 + id * 10_000;
  const ranks = Array.from({ length: kills }, (_, index) => {
    const id = index + 1;
    return { report: { code: CODE, fightID: id }, spec: 'Havoc', startTime: reportStart(id) + 1000, rankPercent: 100 - id };
  });
  let dispatched = 0;
  const query = vi.fn(async (document: string, variables: Row = {}, transport?: Options) => {
    assert.ok(transport, 'all provider calls use the accounted native transport');
    await transport.onAttempt({ kind: 'graphql', attempt: 1 });
    await transport.onResponseBytes({ bytes: 100 });
    dispatched++;
    order.push('query'); documents.push(document);
    if (dispatched === options.failAt) throw new Error('synthetic-private-provider-diagnostic');
    const quota = { _executionMaintenanceQuota: { limitPerHour: 9000, pointsSpentThisHour: 100 + dispatched, pointsResetIn: 3600 } };
    if (document.includes('__typename')) return { ...quota, __typename: 'Query' };
    if (document.includes('worldData')) return { ...quota, worldData: { encounter: { id: encounter, name: boss.name, zone: { id: 53, name: 'The Venomous Abyss',
      difficulties: [{ id: 5, sizes: [20] }], partitions: [{ id: 1, name: '12.1', default: false }, { id: options.partition ?? 2, name: options.patch ?? '12.1.5', default: true }], encounters: [{ id: 3470, name: 'Nekzali' }] } } } };
    if (document.includes('encounterRankings')) {
      assert.equal(variables.enc, encounter); assert.ok(document.includes('partition:2,metric:dps'));
      assert.equal(document.includes('partition:1,metric:dps'), encounter !== 3513);
      assert.ok(!document.includes('rankPercent') && !document.includes('amount'), 'output values are not requested or graded');
      const envelope = (partition: number, rows: typeof ranks) => ({ ranks: rows, hasMorePages: options.moreRankings ?? false,
        partition: options.wrongEnvelope ? -1 : partition, zone: 53, difficulty: 5, metric: 'dps' });
      return { ...quota, gameData: { classes: [{ id: 12, name: 'Demon Hunter' }] }, characterData: { character: { name: 'Reviewer', classID: 12,
        p1: envelope(1, options.partitionConflict || options.historicalOnly ? ranks : ranks.slice(0, -1)), p2: envelope(2, options.historicalOnly ? [] : ranks.slice(-1)) } } };
    }
    if (document.includes('masterData')) {
      const outActors = structuredClone(actors);
      if (options.malformed === 'realm') outActors[0].server = 'Wrong Realm';
      if (options.malformed === 'duplicate-actor') outActors[1] = { ...outActors[0] };
      return { ...quota, reportData: { report: { code: CODE, startTime: NOW - 1_000_000, endTime: NOW, revision: 1,
        visibility: options.malformed === 'private' ? 'private' : 'public', zone: { id: options.mixedZone ? 99 : 53 },
        masterData: { actors: outActors, abilities: [...boss.abilities.map((a) => ({ gameID: a.abilityID, name: a.name })), { gameID: 209426, name: 'Darkness' }] },
        fights: ranks.map((r) => ({ id: r.report.fightID, encounterID: options.malformed === 'encounter' ? 99 : encounter, difficulty: 5, size: 20,
          kill: true, startTime: 1000 + r.report.fightID * 10_000, endTime: 301000 + r.report.fightID * 10_000,
          friendlyPlayers: options.malformed === 'roster' ? players.slice(1) : players })) } } };
    }
    assert.ok(document.includes('events('), 'unexpected query');
    const fightID = (variables.fid as number[])[0];
    if (document.includes('playerDetails')) selected.push(fightID);
    const start = 1000 + fightID * 10_000;
    const event = (type: string, at: number, extra: Row = {}) => ({ type, timestamp: start + at, fight: fightID, sourceID: 1, targetID: 1, ...extra });
    const data: Record<string, unknown> = {};
    const source: Record<string, Row[]> = {
      damage: [event('damage', 1000, { abilityGameID: firstAbility, amount: 100, absorbed: 20 }), event('damage', 3000, { abilityGameID: firstAbility, amount: 200 }),
        event('damage', 7000, { abilityGameID: encounter === 3497 ? 1297650 : 1300239, amount: 50 }), event('damage', 8000, { abilityGameID: 1, amount: 1000 })],
      casts: [event('cast', 2000, { abilityGameID: 198589 }), event('cast', 2500, { abilityGameID: 198589, fake: true })],
      deaths: [event('death', 20000, { targetID: 2, killingAbilityGameID: 1 }), event('death', 30000, { killingAbilityGameID: firstAbility })],
      interrupts: [event('interrupt', 4000, { targetID: 100, abilityGameID: 183752, extraAbilityGameID: 1300238 })],
      dispels: [event('dispel', 5000, { targetID: 2, abilityGameID: 278326, extraAbilityGameID: 999 })],
      healing: [event('absorbed', 6000, { targetID: 2, abilityGameID: 209426, amount: 500 }), event('absorbed', 6500, { targetID: 1, abilityGameID: 209426, amount: 700 }),
        event('absorbed', 7000, { targetID: 50, abilityGameID: 209426, amount: 900 }), event('heal', 7500, { targetID: 2, abilityGameID: 999, amount: 9000 })],
    };
    if (options.malformed === 'damage-target') source.damage[0].targetID = 2;
    if (options.malformed === 'damage-amount') delete source.damage[0].amount;
    if (options.malformed === 'damage-absorbed') source.damage[0].absorbed = 'unknown';
    if (options.malformed === 'bounds') source.damage[0].fight = 999;
    if (options.malformed === 'interrupt') delete source.interrupts[0].extraAbilityGameID;
    if (options.malformed === 'unknown-death') delete source.deaths[1].killingAbilityGameID;
    if (options.malformed === 'context-death') source.deaths[1].killingAbilityGameID = 1300239;
    if (options.malformed === 'death-target') delete source.deaths[1].targetID;
    if (options.signedHeal) source.healing.push(event('heal', 9000, { targetID: 2, abilityGameID: 98021, amount: -20000 }));
    for (const [name, rows] of Object.entries(source)) {
      if (!document.includes(`${name}:events(`)) continue;
      if (name === 'healing' && options.unavailableUtility) { data.healing = null; continue; }
      const cursor = variables[name + 'S'] as number;
      let events = rows, next: number | null = null;
      if (name === 'damage' && (options.paginated || options.endless)) {
        if (cursor === start) { events = rows.slice(0, 1); next = start + 2000; }
        else { events = rows.filter((e) => (e.timestamp as number) >= cursor); next = options.endless ? cursor + 1000 : null; }
      }
      data[name] = { data: events, nextPageTimestamp: next };
    }
    if (document.includes('playerDetails')) {
      const ps = players.map((id) => ({ id, name: id === 1 ? 'Reviewer' : `Player ${id}`, server: "Mal'Ganis", region: 'US', type: 'DemonHunter',
        specs: [{ spec: options.malformed === 'spec' && id === 1 ? 'Vengeance' : 'Havoc', count: 1 }] }));
      data.playerDetails = { data: { playerDetails: { dps: ps, tanks: [], healers: [] } } };
    }
    return { ...quota, reportData: { report: data } };
  });
  const release = vi.fn(async () => { order.push('release'); assert.equal(budget.closed, true, 'settle closes the budget before releasing ownership'); });
  const save = vi.fn(async (review: RaidBossReview) => { order.push('save'); assert.equal(budget.closed, true); cache.set(review.key, structuredClone(review)); });
  const runtime: RaidReviewRuntime = { account: 'fixture-account', client: { query },
    budgetFactory: vi.fn(async () => {
      order.push('claim'); if (options.busy) throw new MaintenanceStop('live-account-busy');
      return { budget, ownership: { account: 'fixture-account', owner: 'fixture-owner', fence: 1 }, release };
    }), store: { readRaidReview: vi.fn(async (key) => cache.get(key) ?? null), saveRaidReview: save }, close: vi.fn(async () => { order.push('close'); }) };
  return { runtime, query, budget, cache, save, release, selected, documents, order };
}
const collect = (f: ReturnType<typeof fixture>) => collectRaidBoss(f.runtime, REQUEST, { now: () => NOW });
function request(body: unknown = REQUEST, init: RequestInit = {}) { return new Request('https://hosted.example/api/castmirror/execution/raid', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init }); }

describe('raid Execution bounded public collector', () => {
  test('collects no output and retains reviewed damage, direct deaths and actual utility outcomes', async () => {
    const f = fixture(); const review = await collect(f);
    assert.equal(review.status, 'complete'); assert.equal(review.fights.length, 1);
    const fight = review.fights[0];
    assert.equal(fight.damage.total, 1350); assert.equal(fight.damage.avoidableHealth, 350); assert.equal(fight.damage.avoidableAbsorbed, 20);
    assert.equal(fight.damage.abilities.find((a) => a.abilityID === 1288554)?.clusters, 1);
    assert.equal(fight.damage.abilities.find((a) => a.abilityID === 1300239)?.contextual, true);
    assert.deepEqual(fight.survival.deaths, [{ at: 30, causeID: 1288554, causeName: 'Latent Cultist', reviewedAvoidable: true, raidDeathOrder: 2 }]);
    assert.equal(fight.utility.successfulInterrupts, 1); assert.equal(fight.utility.dispels, 1); assert.equal(fight.utility.raidAbsorbed, 500);
    assert.deepEqual(fight.scope, { partition: 2, patch: '12.1.5' });
    assert.deepEqual(review.reviewedScopes, [{ partition: 1, patch: '12.1' }, { partition: 2, patch: '12.1.5' }]);
    assert.deepEqual(fight.utility.absorbAbilities, [{ abilityID: 209426, name: 'Darkness', amount: 500 }]);
    assert.deepEqual(fight.utility.personalCasts, [{ abilityID: 198589, name: 'Blur', count: 1 }]);
    assert.equal(f.query.mock.calls.length, 5); assert.equal(f.release.mock.calls.length, 1);
    assert.ok(f.order.indexOf('save') < f.order.indexOf('release'));
    assert.equal(review.acquisition?.counters && (review.acquisition.counters as Row).graphql, 5);
  });
  test('latest six kills are selected by date independently of output rank and use one report head', async () => {
    const f = fixture({ kills: 8 }); const review = await collect(f);
    assert.deepEqual(f.selected, [8, 7, 6, 5, 4, 3]); assert.equal(review.availableKills, 8); assert.equal(review.fights.length, 6);
    assert.deepEqual(review.fights.map((f) => f.scope?.partition), [2, 1, 1, 1, 1, 1]);
    assert.equal(f.budget.snapshot().counters.reportHeads, 1); assert.equal(f.budget.snapshot().counters.kills, 6);
    assert.equal(f.budget.snapshot().counters.observations, 6); assert.equal(f.budget.snapshot().counters.graphql, 10);
  });
  test('cache reload preserves complete evidence and performs no additional acquisition', async () => {
    const f = fixture(); const first = await collect(f); const second = await collect(f);
    assert.deepEqual(second.fights, first.fights); assert.equal(second.acquisition?.cached, true);
    assert.equal(vi.mocked(f.runtime.budgetFactory).mock.calls.length, 1); assert.equal(f.query.mock.calls.length, 5);
    assert.equal(f.save.mock.calls.length, 1);
  });
  test('cache key binds normalized identity, account, exact scope and reviewed rubric', () => {
    const key = raidReviewKey(REQUEST, 'a');
    assert.equal(key, raidReviewKey({ ...REQUEST, name: 'reviewer', server: 'malganis' }, 'a'));
    for (const changed of [{ ...REQUEST, name: 'Other' }, { ...REQUEST, region: 'eu' as const }, { ...REQUEST, encounter: 3445 }]) assert.notEqual(key, raidReviewKey(changed, 'a'));
    assert.notEqual(key, raidReviewKey(REQUEST, 'b')); assert.ok(RAID_REVIEW_RULES_VERSION.startsWith('reviewed-contact-rubric-1-'));
  });
  test('stale or mismatched cache content is not hydrated', async () => {
    const f = fixture(); const review = await collect(f);
    assert.equal(isRetainedRaidReview(review, REQUEST, review.key, NOW), true);
    for (const changed of [{ ...review, at: NOW - 600_000 }, { ...review, rulesVersion: 'old' }, { ...review, identity: { ...review.identity, name: 'Other' } },
      { ...review, scope: { ...review.scope, partition: 1 } }, { ...review, fights: [{ ...review.fights[0], damage: {} }] },
      { ...review, fights: [{ ...review.fights[0], damage: { ...review.fights[0].damage, abilities: review.fights[0].damage.abilities.slice(1) } }] },
      { ...review, reviewedScopes: undefined }, { ...review, fights: [{ ...review.fights[0], scope: undefined }] },
      { ...review, fights: [{ ...review.fights[0], scope: { partition: 1, patch: '12.1.5' } }] }]) {
      assert.equal(isRetainedRaidReview(changed, REQUEST, review.key, NOW), false);
    }
  });
  for (const changed of [{ patch: '12.1.6' }, { partition: 3 }]) test(`unreviewed current scope stays unavailable: ${JSON.stringify(changed)}`, async () => {
    const f = fixture(changed); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'raid-scope-unreviewed'); assert.equal(review.fights.length, 0);
    assert.equal(f.query.mock.calls.length, 2); assert.equal(f.release.mock.calls.length, 1); assert.equal(gradeBoss(review).letter, null);
  });
  for (const malformed of ['realm', 'duplicate-actor', 'private', 'encounter', 'roster', 'spec']) test(`unverified public identity/scope is excluded: ${malformed}`, async () => {
    const f = fixture({ malformed }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.fights.length, 0); assert.equal(gradeBoss(review).letter, null);
    assert.equal(f.release.mock.calls.length, 1);
  });
  for (const malformed of ['damage-target', 'damage-amount', 'damage-absorbed', 'bounds']) test(`invalid damage remains incomplete rather than a clean zero: ${malformed}`, async () => {
    const f = fixture({ malformed }); const review = await collect(f);
    assert.equal(review.status, 'partial'); assert.equal(review.fights[0].damage.complete, false); assert.equal(gradeBoss(review).letter, null);
  });
  test('missing utility is explicit and does not invalidate independently complete damage/survival', async () => {
    const f = fixture({ unavailableUtility: true }); const review = await collect(f);
    assert.equal(review.status, 'partial'); assert.equal(review.fights[0].damage.complete, true); assert.equal(review.fights[0].utility.complete, false);
    assert.equal(gradeBoss(review).status, 'graded'); assert.ok(review.fights[0].limitations.some((s) => s.startsWith('healing:')));
  });
  test('signed healing adjustments do not invalidate independently logged consumed shields', async () => {
    const review = await collect(fixture({ signedHeal: true }));
    assert.equal(review.status, 'complete'); assert.equal(review.fights[0].utility.complete, true);
    assert.equal(review.fights[0].utility.raidAbsorbed, 500);
  });
  test('a death without an identified recipient is incomplete rather than a clean survival record', async () => {
    const review = await collect(fixture({ malformed: 'death-target' }));
    assert.equal(review.status, 'partial'); assert.equal(review.fights[0].survival.complete, false);
    assert.equal(gradeBoss(review).letter, null);
  });
  test('pagination collects advancing actor-filtered streams without replaying complete streams', async () => {
    const f = fixture({ paginated: true }); const review = await collect(f);
    assert.equal(review.status, 'complete'); assert.equal(review.fights[0].damage.avoidableHealth, 350);
    const followup = f.documents.filter((d) => d.includes('damage:events('))[1];
    assert.ok(!followup.includes('deaths:events(') && !followup.includes('casts:events(')); assert.equal(f.query.mock.calls.length, 6);
  });
  test('third page cursor stays incomplete and cannot become a zero-contact grade', async () => {
    const f = fixture({ endless: true }); const review = await collect(f);
    assert.equal(review.fights[0].damage.complete, false); assert.equal(review.status, 'partial'); assert.equal(gradeBoss(review).letter, null);
    assert.equal(f.query.mock.calls.length, 7);
  });
  test('unknown and contextual death causes never become confirmed avoidable deaths', async () => {
    for (const malformed of ['unknown-death', 'context-death']) {
      const review = await collect(fixture({ malformed }));
      assert.equal(review.fights[0].survival.deaths[0].reviewedAvoidable, false); assert.equal(gradeBoss(review).survival.confirmedAvoidableDeaths, 0);
    }
  });
  test('mixed report labels retain exact current-ranking fight scope and disclose the limitation', async () => {
    const review = await collect(fixture({ mixedZone: true })); assert.equal(review.status, 'complete');
    assert.ok(review.fights[0].limitations.some((s) => s.startsWith('Mixed report raid label')));
  });
  test('ranked 20-player kills may have extra verified participant identities without fabricating roster membership', async () => {
    const review = await collect(fixture({ participantIdentities: 21 }));
    assert.equal(review.status, 'complete'); assert.equal(review.scope.size, 20);
    assert.ok(review.fights[0].limitations.some((s) => s.startsWith('The provider lists 21 participant identities')));
    const capped = await collect(fixture({ participantIdentities: 41 }));
    assert.equal(capped.status, 'unavailable'); assert.equal(capped.fights.length, 0);
  });
  test('no current public kills is unavailable without a report crawl', async () => {
    const f = fixture({ kills: 0 }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'no-public-reviewed-kills'); assert.equal(gradeBoss(review).letter, null);
    assert.equal(f.query.mock.calls.length, 3); assert.equal(f.release.mock.calls.length, 1);
  });
  test('truncated character discovery cannot claim the latest six kills', async () => {
    const f = fixture({ moreRankings: true }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'character-ranking-incomplete');
    assert.equal(f.query.mock.calls.length, 3); assert.equal(review.fights.length, 0);
  });
  test('an unpartitioned or mismatched ranking envelope cannot label historical kills as current', async () => {
    const f = fixture({ wrongEnvelope: true }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'character-ranking-scope-unverified');
    assert.equal(f.query.mock.calls.length, 3); assert.equal(review.fights.length, 0);
  });
  test('a source kill appearing under conflicting explicit partitions is excluded', async () => {
    const f = fixture({ partitionConflict: true }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'character-ranking-conflict');
    assert.equal(f.query.mock.calls.length, 3); assert.equal(review.fights.length, 0);
  });
  test('historical subsets omit unreviewed mechanics rather than publishing observed zero contact rows', async () => {
    const f = fixture({ encounter: 3497, kills: 2 });
    const input = { ...REQUEST, encounter: 3497 };
    const review = await collectRaidBoss(f.runtime, input, { now: () => NOW });
    assert.equal(review.status, 'complete');
    const historical = review.fights.find((fight) => fight.scope?.partition === 1)!;
    const current = review.fights.find((fight) => fight.scope?.partition === 2)!;
    assert.equal(historical.damage.abilities.some((a) => a.abilityID === 1297650), false);
    assert.equal(historical.damage.avoidableHealth, 300);
    assert.equal(review.coverageLimited, true); assert.equal(gradeBoss(review).provisional, true);
    assert.equal(current.damage.abilities.find((a) => a.abilityID === 1297650)?.health, 50);
    assert.ok(historical.limitations.some((s) => s.includes('omitted abilities are unreviewed')));
    assert.equal(isRetainedRaidReview(review, input, review.key, NOW), true);
    const forged = structuredClone(review);
    const old = forged.fights.find((fight) => fight.scope?.partition === 1)!;
    old.damage.abilities.push({ abilityID: 1297650, name: 'Spreading Flames', health: 0, absorbed: 0, hits: 0, clusters: 0, contextual: false });
    assert.equal(isRetainedRaidReview(forged, input, review.key, NOW), false);
  });
  test('historical Kithix kills have no reviewed policy and cannot enter coverage or grading', async () => {
    const f = fixture({ encounter: 3513, historicalOnly: true });
    const review = await collectRaidBoss(f.runtime, { ...REQUEST, encounter: 3513 }, { now: () => NOW });
    assert.deepEqual(review.reviewedScopes, [{ partition: 2, patch: '12.1.5' }]);
    assert.equal(review.availableKills, 0); assert.equal(review.fights.length, 0); assert.equal(gradeBoss(review).letter, null);
    assert.equal(f.query.mock.calls.length, 3); assert.equal(f.documents.some((d) => d.includes('partition:1,metric:dps')), false);
  });
  test('all 27 current-patch mechanics remain available while historical policy narrows only declared bosses', () => {
    assert.equal(catalog.encounters.reduce((sum, b) => sum + reviewedRaidAbilities(b.encounter, { partition: 2, patch: '12.1.5' }).length, 0), 27);
    for (const boss of catalog.encounters) assert.deepEqual(reviewedRaidAbilities(boss.encounter, { partition: 2, patch: '12.1.5' }), boss.abilities);
    assert.deepEqual(reviewedRaidAbilities(3429, { partition: 1, patch: '12.1' }).map((a) => a.abilityID), [1285017, 1283290]);
    assert.deepEqual(reviewedRaidAbilities(3421, { partition: 1, patch: '12.1' }).map((a) => a.abilityID), [1292807, 1294605, 1307363, 1306876, 1306925]);
    assert.deepEqual(reviewedRaidAbilities(3513, { partition: 1, patch: '12.1' }), []);
  });
  test('busy account does not dispatch, save or release another owner', async () => {
    const f = fixture({ busy: true }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(review.reason, 'live-account-busy');
    assert.equal(f.query.mock.calls.length, 0); assert.equal(f.save.mock.calls.length, 0); assert.equal(f.release.mock.calls.length, 0);
  });
  test('provider failure settles and releases without publishing diagnostics or retrying a fresh job', async () => {
    const f = fixture({ failAt: 5 }); const review = await collect(f);
    assert.equal(review.status, 'unavailable'); assert.equal(f.release.mock.calls.length, 1); assert.equal(f.query.mock.calls.length, 5);
    assert.ok(!JSON.stringify(review).includes('synthetic-private-provider-diagnostic'));
  });
});

describe('raid Execution POST boundary', () => {
  test('returns the review and non-damage grade with private no-store headers', async () => {
    const f = fixture(); const handler = createRaidExecutionHandler({ now: () => NOW, admission: () => true, openRuntime: async () => f.runtime });
    const response = await handler(request()); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.review.version, 'raid-execution-review-1'); assert.equal(body.grade.boss.id, 3470);
    assert.ok(response.headers.get('cache-control')?.includes('no-store')); assert.equal(vi.mocked(f.runtime.close).mock.calls.length, 1);
  });
  for (const body of [{ ...REQUEST, code: CODE }, { ...REQUEST, encounter: 999 }, { ...REQUEST, difficulty: 4 }, { ...REQUEST, region: 'bad' },
    { ...REQUEST, name: '' }, { ...REQUEST, name: 'x\n' }, '{bad', 'x'.repeat(3000)]) test(`rejects invalid or caller-supplied evidence: ${JSON.stringify(body).slice(0, 65)}`, async () => {
    const openRuntime = vi.fn(async () => fixture().runtime); const handler = createRaidExecutionHandler({ openRuntime, admission: () => true });
    assert.equal((await handler(request(body))).status, 400); assert.equal(openRuntime.mock.calls.length, 0);
  });
  test('disabled runtime and admission limit start no acquisition', async () => {
    const disabled = createRaidExecutionHandler({ runtimeOptions: { env: {} } }); assert.equal((await disabled(request())).status, 503);
    const openRuntime = vi.fn(async () => fixture().runtime); const limited = createRaidExecutionHandler({ openRuntime, admission: () => false });
    assert.equal((await limited(request())).status, 429); assert.equal(openRuntime.mock.calls.length, 0);
  });
  test('aborted requests stop before opening the runtime', async () => {
    const controller = new AbortController(); controller.abort(); const openRuntime = vi.fn(async () => fixture().runtime);
    const handler = createRaidExecutionHandler({ openRuntime, admission: () => true });
    assert.equal((await handler(request(REQUEST, { signal: controller.signal }))).status, 499); assert.equal(openRuntime.mock.calls.length, 0);
  });
  test('a close failure is sanitized and never leaves a success response', async () => {
    const f = fixture(); f.runtime.close = async () => { throw new Error('synthetic-private-database-credential'); };
    const response = await createRaidExecutionHandler({ now: () => NOW, openRuntime: async () => f.runtime, admission: () => true })(request());
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('credential'));
  });
});
