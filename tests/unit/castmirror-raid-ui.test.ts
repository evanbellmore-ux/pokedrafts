import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, test } from 'vitest';
import { adaptRaidReview, emitRaidGradeModel } from '../../scripts/castmirror-raid-review.mjs';
import { gradeRaid } from '../../app/api/castmirror/execution/raid/grade';
import type { RaidBossReview } from '../../app/api/castmirror/execution/raid/types';
import { deferred, pageFixture, settlePage } from '../helpers/castmirror-page.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../vendor/castmirror/reviews/venomous-abyss-mythic.json', import.meta.url), 'utf8'));
const bosses = catalog.encounters.map((entry: { encounter: number; name: string }) => ({ id: entry.encounter, name: entry.name }));
function review(encounter: number): RaidBossReview {
  return {
    version: 'raid-execution-review-1', key: 'review-' + encounter, at: 1_800_000_000_000, rulesVersion: 'reviewed-test',
    identity: { name: 'You', server: 'Test Realm', region: 'us', className: 'Mage' },
    scope: { zone: 53, encounter, difficulty: 5, size: 20, partition: 2, patch: '12.1.5' },
    boss: bosses.find((boss: { id: number }) => boss.id === encounter), status: 'complete', reason: null, availableKills: 1, sampleLimit: 6,
    fights: [{ code: 'Player0123456789', fightID: 7, actorID: 123, spec: 'Arcane', role: 'dps', kill: true,
      date: 1_800_000_000_000, durationSec: 300,
      damage: { complete: true, total: 10000, avoidableHealth: 10, avoidableAbsorbed: 2,
        abilities: [{ abilityID: 1, name: 'Reviewed pool', health: 10, absorbed: 2, hits: 3, clusters: 1, contextual: false }] },
      survival: { complete: true, deaths: [] },
      utility: { complete: true, successfulInterrupts: 2, dispels: 1, raidAbsorbed: 250,
        absorbAbilities: [{ abilityID: 2, name: 'Raid shield', amount: 250 }], personalCasts: [] }, limitations: [] }],
  };
}
function ready(page: Awaited<ReturnType<typeof pageFixture>>) {
  page.nodes.get('zone').value = '53'; page.nodes.get('difficulty').value = '5';
  page.evaluate(`prepareRaidReview({name:'You',zone:{id:53,name:'The Venomous Abyss'}}, raidReviewCharacterRequest())`);
}
function raidRequests(page: Awaited<ReturnType<typeof pageFixture>>) {
  return page.requests.filter((url: string) => url.endsWith('/execution/raid'));
}

describe('CastMirror raid execution review UI', () => {
  test('uses the actual shared grade model in the generated page', async () => {
    new Script(emitRaidGradeModel());
    const page = await pageFixture();
    const reviews = [review(bosses[0].id), review(bosses[1].id)];
    const actual = JSON.parse(page.evaluate(`JSON.stringify(gradeRaid(${JSON.stringify(reviews)},10))`));
    assert.deepEqual(actual, gradeRaid(reviews, 10));
    assert.match(page.html, /raid-execution-bosses.*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(page.html, /max-width: 650px[\s\S]*raid-execution-bosses.*grid-template-columns: minmax\(0, 1fr\)/);
  });

  test('makes raid review available after character lookup without a selected damage log, and waits for an explicit click', async () => {
    const page = await pageFixture(); ready(page);
    assert.equal(page.nodes.get('raidExecution').style.display, '');
    assert.equal(page.nodes.get('raidExecutionStart').disabled, false);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /latest six public kills.*selected by date/);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /across reviewed patches 12\.1 and 12\.1\.5/);
    assert.equal(raidRequests(page).length, 0);
    assert.equal(page.evaluate('comparison'), null);
  });

  test('reviews bosses sequentially and presents a non-damage grade, utility and source evidence', async () => {
    const first = deferred(); let count = 0;
    const page = await pageFixture((_url, options) => {
      const params = JSON.parse(String(options.body));
      count++;
      if (count === 1) return first.promise;
      return { review: review(params.encounter) };
    }); ready(page);
    const pending = page.nodes.get('raidExecutionStart').click();
    await settlePage();
    assert.equal(raidRequests(page).length, 1);
    assert.equal(page.nodes.get('raidExecutionStart').disabled, true);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /Reviewing Nek/);
    first.resolve({ review: review(bosses[0].id) }); await pending;
    assert.equal(raidRequests(page).length, 10);
    const html = page.nodes.get('raidExecutionResults').htmlTree();
    assert.match(html, /Provisional non-damage grade/);
    assert.match(html, /10 of 10 bosses graded.*10 sampled kills/);
    assert.match(html, /20 successful interrupts.*10 dispels.*2,500 damage absorbed on teammates/);
    assert.match(html, /Raid shield: 2,500 absorbed/);
    assert.match(html, /utility totals do not raise or lower the letter grade/);
    assert.match(html, /Reviewed pool: 3 hits \/ ticks in 1 contact cluster/);
    assert.match(html, /How this grade works/);
    assert.match(html, /dps: A \(provisional\)/);
    assert.match(html, /1 independently reviewed mechanic · narrow coverage/);
    assert.match(html, /Coverage and limitations/);
    assert.match(html, /Patch 12\.1\.5 · current patch only/);
    assert.match(html, /Sample dates:.*2027/);
    const links = page.nodes.get('raidExecutionResults').querySelectorAll('a');
    assert.equal(links.length, 10);
    assert.match(links[0].href, /^https:\/\/www\.warcraftlogs\.com\/reports\/Player0123456789#fight=7&type=damage-taken&source=123$/);
    for (const options of page.requestOptions.filter((option: RequestInit) => option.method === 'POST')) {
      const request = JSON.parse(String(options.body));
      assert.deepEqual(Object.keys(request).sort(), ['difficulty', 'encounter', 'name', 'region', 'server', 'zone']);
      assert.equal(request.name, 'You');
    }
    assert.equal(page.requests.some((url: string) => url.includes('/compare?')), false);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /Review complete/);
  });

  test('stops an in-flight review on character changes and suppresses late results', async () => {
    const first = deferred();
    const page = await pageFixture(() => first.promise); ready(page);
    page.evaluate(`globalThis.AbortController = class { constructor(){ this.signal={aborted:false}; } abort(){this.signal.aborted=true;} }`);
    const pending = page.nodes.get('raidExecutionStart').click(); await settlePage();
    const options = page.requestOptions.find((option: RequestInit) => option.method === 'POST');
    page.nodes.get('name').value = 'Someone Else'; page.nodes.get('name').oninput();
    assert.equal(options.signal.aborted, true);
    first.resolve({ review: review(bosses[0].id) }); await pending;
    assert.equal(raidRequests(page).length, 1);
    assert.equal(page.nodes.get('raidExecution').style.display, 'none');
    assert.equal(page.nodes.get('raidExecutionResults').htmlTree(), '');
  });

  test('keeps partial results after stop and continues only on another click', async () => {
    const second = deferred(); let count = 0;
    const page = await pageFixture((_url, options) => {
      const params = JSON.parse(String(options.body)); count++;
      return count === 2 ? second.promise : { review: review(params.encounter) };
    }); ready(page);
    const pending = page.nodes.get('raidExecutionStart').click(); await settlePage();
    assert.equal(raidRequests(page).length, 2);
    page.nodes.get('raidExecutionCancel').click();
    second.resolve({ review: review(bosses[1].id) }); await pending;
    assert.equal(raidRequests(page).length, 2);
    assert.match(page.nodes.get('raidExecutionResults').htmlTree(), /1 of 10 bosses graded/);
    assert.equal(page.nodes.get('raidExecutionStart').textContent, 'Continue raid review');
    await page.nodes.get('raidExecutionStart').click();
    assert.equal(raidRequests(page).length, 11);
    assert.match(page.nodes.get('raidExecutionResults').htmlTree(), /10 of 10 bosses graded/);
  });

  test('stops on account busy without automatically retrying or inventing a clean boss', async () => {
    let count = 0;
    const page = await pageFixture((_url, options) => {
      count++;
      const params = JSON.parse(String(options.body)), result = review(params.encounter);
      result.status = 'unavailable'; result.reason = 'live-account-busy'; result.fights = [];
      return { review: result };
    }); ready(page);
    await page.nodes.get('raidExecutionStart').click(); await settlePage();
    assert.equal(count, 1);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /Another execution review is running/);
    const html = page.nodes.get('raidExecutionResults').htmlTree();
    assert.match(html, /Not enough evidence to grade/);
    assert.match(html, /0 of 10 bosses graded/);
    assert.doesNotMatch(html, /Provisional non-damage grade/);
  });

  for (const reason of ['point-cap', 'account-background-cap']) test(`stops the queue on native quota limit ${reason}`, async () => {
    const page = await pageFixture((_url, options) => {
      const result = review(JSON.parse(String(options.body)).encounter);
      result.status = 'partial'; result.reason = reason;
      return { review: result };
    }); ready(page);
    await page.nodes.get('raidExecutionStart').click();
    assert.equal(raidRequests(page).length, 1);
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /allowance is temporarily exhausted/);
    assert.equal(page.nodes.get('raidExecutionStart').textContent, 'Continue raid review');
  });

  test('blocks unsupported difficulty and disabled hosted capability even through the direct handler', async () => {
    const page = await pageFixture(); ready(page);
    page.nodes.get('difficulty').value = '4';
    page.evaluate(`prepareRaidReview({name:'You',zone:{id:53,name:'Raid'}}, raidReviewCharacterRequest())`);
    await page.evaluate('startRaidReview()');
    assert.equal(raidRequests(page).length, 0);
    assert.equal(page.nodes.get('raidExecutionStart').disabled, true);
    ready(page); page.evaluate('window.MIRROR_EXECUTION_CAPABILITIES = Object.freeze({reference:false});');
    await page.evaluate('startRaidReview()');
    assert.equal(raidRequests(page).length, 0);
  });

  test('rejects mismatched identity rather than attributing another player’s grade', async () => {
    const result = review(bosses[0].id); result.identity.name = 'Someone Else';
    const page = await pageFixture(() => ({ review: result })); ready(page);
    await page.nodes.get('raidExecutionStart').click();
    assert.equal(raidRequests(page).length, 1);
    assert.equal(page.nodes.get('raidExecutionResults').htmlTree(), '');
    assert.match(page.nodes.get('raidExecutionProgress').textContent, /Evidence is unavailable/);
  });

  test('does not build source links from unverified report identities', async () => {
    const page = await pageFixture();
    assert.equal(page.evaluate(`raidReviewSource({code:'javascript:bad',fightID:1,actorID:2})`), null);
    assert.equal(page.evaluate(`raidReviewSource({code:'Player0123456789',fightID:0,actorID:2})`), null);
  });

  test('labels incomplete zero observations as lower bounds rather than a clean kill', async () => {
    const page = await pageFixture();
    const fight = review(bosses[0].id).fights[0];
    fight.damage.complete = false; fight.damage.avoidableHealth = 0;
    fight.survival.complete = false;
    page.evaluate(`$('raidExecutionResults').append(raidReviewFight(${JSON.stringify(fight)}))`);
    const html = page.nodes.get('raidExecutionResults').htmlTree();
    assert.match(html, /Observed ≥ 0 reviewed mechanic health damage.*death evidence incomplete.*partial evidence/);
    assert.doesNotMatch(html, /· 0 deaths/);
  });

  test('labels date ranges and historical patch scope without presenting them as current', async () => {
    const page = await pageFixture();
    assert.equal(page.evaluate(`raidReviewScopeLabel({patch:'12.1'})`), 'Patch 12.1 · historical patch sample');
    assert.equal(page.evaluate(`raidReviewDateRange([{date:null},{date:0}])`), null);
    const range = page.evaluate(`raidReviewDateRange([{date:Date.UTC(2026,9,15)},{date:Date.UTC(2026,9,1)}])`);
    assert.match(range, /^Sample dates:.*2026.*–.*2026$/);
    const single = page.evaluate(`raidReviewDateRange([{date:Date.UTC(2026,9,15)}])`);
    assert.doesNotMatch(single, /–/);
  });

  test('shows actual historical and current sample patches separately from reviewed coverage', async () => {
    const result = review(bosses[0].id);
    result.reviewedScopes = [{ partition: 1, patch: '12.1' }, { partition: 2, patch: '12.1.5' }];
    result.fights[0].scope = { partition: 1, patch: '12.1' };
    result.fights.push({ ...structuredClone(result.fights[0]), fightID: 8, date: result.fights[0].date + 86_400_000,
      scope: { partition: 2, patch: '12.1.5' } });
    const page = await pageFixture((_url, options) => ({ review: JSON.parse(String(options.body)).encounter === bosses[0].id
      ? result : review(JSON.parse(String(options.body)).encounter) })); ready(page);
    await page.nodes.get('raidExecutionStart').click();
    const html = page.nodes.get('raidExecutionResults').htmlTree();
    assert.match(html, /Reviewed patches: 12\.1, 12\.1\.5/);
    assert.match(html, /Sample patches: 12\.1, 12\.1\.5 · includes historical kills/);
    const card = page.nodes.get('raidExecutionResults').querySelectorAll('article').find((item: { dataset: { boss: number } }) => item.dataset.boss === bosses[0].id);
    assert.doesNotMatch(card.htmlTree(), /current patch only/);
    const links = card.querySelectorAll('a');
    assert.match(links[0].textContent, /· Patch 12\.1$/);
    assert.match(links[1].textContent, /· Patch 12\.1\.5$/);
  });

  test('refuses changed character lookup integration anchors', () => {
    const source = readFileSync(new URL('../../vendor/castmirror/upstream/index.html', import.meta.url), 'utf8');
    assert.throws(() => adaptRaidReview(source.replace('    renderKills(data);', '    renderDifferentKills(data);')), /anchor changed/);
  });
});
