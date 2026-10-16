// Hosted raid review. The grade is emitted from the same pure TypeScript model
// used by the service; this adapter only collects and presents that evidence.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { emitHelpers } from './castmirror-emit-helpers.mjs';

function raidReviewForm() {
  return { name: $('name').value.trim(), server: $('server').value.trim(), region: $('region').value,
    selectedZone: $('zone').value, difficulty: +$('difficulty').value };
}
function raidReviewKey(context) {
  return JSON.stringify(context && [context.name.toLowerCase(), context.server.toLowerCase(), context.region,
    context.selectedZone, context.difficulty]);
}
function raidReviewCurrent(generation, context) {
  return generation === raidReviewGeneration && context === raidReviewContext
    && raidReviewKey(context) === raidReviewKey(raidReviewForm());
}
function cancelRaidReview(clear = false) {
  raidReviewGeneration++;
  raidReviewController?.abort(); raidReviewController = null; raidReviewRunning = false;
  if (clear) {
    raidReviewContext = null; raidReviewResults = []; raidReviewDone = new Set(); raidReviewUncertain = new Set(); raidReviewMessage = '';
    $('raidExecution').style.display = 'none';
    $('raidExecutionResults').innerHTML = '';
  } else {
    raidReviewMessage = 'Review stopped. Collected evidence is kept; continue when you are ready.';
    renderRaidReview();
  }
}
function raidReviewCharacterRequest() {
  cancelRaidReview(true);
  return { ...raidReviewForm(), generation: raidReviewGeneration };
}
function prepareRaidReview(character, request) {
  if (request.generation !== raidReviewGeneration || raidReviewKey(request) !== raidReviewKey(raidReviewForm())) return;
  const bosses = RAID_REVIEW_SCOPE.bosses;
  raidReviewContext = { ...request, name: character.name || request.name, zone: character.zone?.id,
    zoneName: character.zone?.name || 'Selected raid', bosses };
  // A canonical returned character name may differ in case, never in identity.
  if (raidReviewKey(raidReviewContext) !== raidReviewKey(raidReviewForm())) { cancelRaidReview(true); return; }
  $('raidExecution').style.display = '';
  const supported = raidReviewContext.zone === RAID_REVIEW_SCOPE.zone
    && raidReviewContext.difficulty === RAID_REVIEW_SCOPE.difficulty
    && window.MIRROR_EXECUTION_CAPABILITIES?.reference === true;
  $('raidExecutionStart').disabled = !supported;
  raidReviewMessage = supported
    ? 'Review the latest six public kills per boss across reviewed patches ' + RAID_REVIEW_SCOPE.reviewedScopes.map((scope) => scope.patch).join(' and ')
      + ', selected by date. Your damage ranking does not affect the grade.'
    : 'Raid execution grading is available for the current reviewed Mythic raid. Choose Mythic and find kills again.';
  renderRaidReview();
}
function raidReviewFriendlyReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (/live-window-incompatible|accounting-unavailable|live-(?:claim-(?:failed|timeout|invalid)|checkpoint|release|lock-lost|ledger-changed|store|lease-expired)/.test(text)) return 'The log service could not verify this request. Collected results are kept; you can continue with any remaining bosses later.';
  if (/busy|lease|already.*running/.test(text)) return 'Another execution review is running. Continue this review after it finishes.';
  if (/quota|budget|rate.?limit|reserve|point-cap|account-background-cap/.test(text)) return 'The log service allowance is temporarily exhausted. Collected results are kept; continue later.';
  if (/hidden|private/.test(text)) return 'Public log evidence is unavailable for this character.';
  if (/no.?kills|no.?public|no.?rank|empty/.test(text)) return 'No eligible public kills were found.';
  if (/scope|patch|partition|unsupported|not.?reviewed/.test(text)) return 'These logs do not match the reviewed Mythic encounter rules.';
  if (/deadline|timeout|incomplete|limited/.test(text)) return 'Only part of the evidence was collected. Missing evidence receives no favorable credit.';
  return 'Evidence is unavailable. Collected results are kept; continue the review later.';
}
function raidReviewMatches(review, context, boss) {
  const identity = review?.identity, scope = review?.scope;
  const realm = (value) => typeof value === 'string' ? value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
  return review?.version === 'raid-execution-review-1' && review.boss?.id === boss.id
    && identity?.name?.toLowerCase() === context.name.toLowerCase()
    && realm(identity.server) === realm(context.server) && identity.region?.toLowerCase() === context.region.toLowerCase()
    && scope?.zone === context.zone && scope?.difficulty === context.difficulty && scope?.encounter === boss.id
    && Array.isArray(review.fights) && review.fights.length <= 6;
}
async function startRaidReview() {
  const context = raidReviewContext;
  if (!context || raidReviewRunning || $('raidExecutionStart').disabled
    || context.zone !== RAID_REVIEW_SCOPE.zone || context.difficulty !== RAID_REVIEW_SCOPE.difficulty
    || window.MIRROR_EXECUTION_CAPABILITIES?.reference !== true
    || raidReviewKey(context) !== raidReviewKey(raidReviewForm())) return;
  if (raidReviewDone.size === context.bosses.length) { raidReviewResults = []; raidReviewDone = new Set(); }
  const generation = ++raidReviewGeneration;
  raidReviewRunning = true;
  raidReviewController = typeof AbortController === 'function' ? new AbortController() : null;
  for (const boss of context.bosses) {
    if (raidReviewDone.has(boss.id)) continue;
    if (!raidReviewCurrent(generation, context)) return;
    raidReviewMessage = 'Reviewing ' + boss.name + ' · ' + raidReviewDone.size + ' of ' + context.bosses.length + ' bosses checked…';
    renderRaidReview();
    let retrySafe = false;
    try {
      const res = await fetch(API + 'execution/raid', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: context.name, server: context.server, region: context.region,
          zone: context.zone, difficulty: context.difficulty, encounter: boss.id }), signal: raidReviewController?.signal });
      retrySafe = res.status === 429;
      const data = await res.json();
      if (!raidReviewCurrent(generation, context)) return;
      retrySafe ||= res.ok && /live-account-busy|native-account-busy/.test(String(data.reason || data.error || ''));
      if (!res.ok || data.error) throw new Error(data.reason || data.error || 'unavailable');
      if (!raidReviewMatches(data.review, context, boss)) throw new Error('unavailable');
      raidReviewResults = raidReviewResults.filter((review) => review.boss.id !== boss.id).concat(data.review);
      const acquisition = data.review.acquisition;
      const reasons = [acquisition?.reason, data.review.reason, acquisition?.accountingReason, acquisition?.cacheReason].filter(Boolean);
      const reason = reasons.join(' ');
      const uncertain = acquisition?.accountingPersistence === 'unavailable' || acquisition?.cachePersistence === 'unavailable'
        || reasons.some((code) => code === 'timeout' || code === 'response-too-large')
        || /live-window-incompatible|live-(?:claim-(?:failed|timeout|invalid)|checkpoint|release|lock-lost|ledger-changed|store|lease-expired)/.test(reason);
      if (uncertain) {
        // A failed accounting or transport attempt is retained, never replayed by Continue.
        raidReviewDone.add(boss.id); raidReviewUncertain.add(boss.id);
        if (data.review.status === 'complete') raidReviewResults = raidReviewResults.map((review) => review.boss.id === boss.id
          ? { ...review, status: 'partial', reason: reason || 'accounting-unavailable' } : review);
        raidReviewMessage = raidReviewFriendlyReason('accounting-unavailable'); break;
      }
      if (/busy|quota|budget|rate.?limit|reserve|point-cap|account-background-cap/.test(reason)) {
        raidReviewMessage = raidReviewFriendlyReason(reason); break;
      }
      raidReviewDone.add(boss.id);
    } catch (error) {
      if (!raidReviewCurrent(generation, context)) return;
      if (!retrySafe) {
        raidReviewDone.add(boss.id); raidReviewUncertain.add(boss.id);
        raidReviewMessage = raidReviewFriendlyReason('accounting-unavailable');
      } else raidReviewMessage = raidReviewFriendlyReason(retrySafe && /json|token/i.test(error.message) ? 'rate-limit' : error.message);
      break;
    }
  }
  if (!raidReviewCurrent(generation, context)) return;
  raidReviewRunning = false; raidReviewController = null;
  if (raidReviewDone.size === context.bosses.length)
    raidReviewMessage = raidReviewUncertain.size ? raidReviewFriendlyReason('accounting-unavailable')
      : 'Review complete · public kills from the reviewed patches. Bosses without enough evidence remain ungraded.';
  renderRaidReview();
}
function raidReviewNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'Unavailable';
}
function raidReviewScopeLabel(scope) {
  if (typeof scope?.patch !== 'string' || !scope.patch.trim()) return 'Patch scope unavailable';
  return 'Patch ' + scope.patch + (scope.patch === RAID_REVIEW_SCOPE.patch ? ' · current patch only' : ' · historical patch sample');
}
function raidReviewPatchLabels(reviews) {
  const sampled = [], reviewed = [];
  for (const review of reviews) {
    for (const scope of review.reviewedScopes || [review.scope])
      if (typeof scope?.patch === 'string' && scope.patch.trim()) reviewed.push(scope.patch);
    for (const fight of review.fights || []) {
      const patch = fight.scope?.patch || review.scope?.patch;
      if (typeof patch === 'string' && patch.trim()) sampled.push(patch);
    }
  }
  const ordered = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const samples = ordered(sampled), coverage = ordered(reviewed);
  return { reviewed: 'Reviewed patches: ' + (coverage.join(', ') || 'Unavailable'),
    sampled: samples.length > 1 ? 'Sample patches: ' + samples.join(', ') + ' · includes historical kills'
      : samples.length === 1 ? 'Sample scope: ' + raidReviewScopeLabel({ patch: samples[0] }) : 'No eligible kills sampled.' };
}
function raidReviewDateRange(fights) {
  const dates = fights.map((fight) => fight.date).filter((date) => typeof date === 'number' && Number.isFinite(date) && date > 0);
  if (!dates.length) return null;
  const first = Math.min(...dates), last = Math.max(...dates);
  const format = (date) => new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return 'Sample dates: ' + format(first) + (first === last ? '' : ' – ' + format(last));
}
function raidReviewSupportNumber(utility, value) {
  const complete = utility.observedFights > 0 && utility.completeFights === utility.observedFights;
  return !complete && !(value > 0) ? 'Unverified' : (complete ? '' : 'Observed ≥ ') + raidReviewNumber(value);
}
function raidReviewUtility(utility) {
  const section = document.createElement('div'); section.className = 'raid-execution-utility';
  section.append(textNode('h4', 'Observed raid support'));
  const observed = (value) => raidReviewSupportNumber(utility, value);
  section.append(textNode('p', observed(utility.successfulInterrupts) + ' successful interrupts · '
    + observed(utility.dispels) + ' dispels · ' + observed(utility.raidAbsorbed) + ' damage absorbed on teammates'));
  for (const ability of utility.absorbAbilities || [])
    section.append(textNode('p', ability.name + ': ' + raidReviewNumber(ability.amount) + ' absorbed', 'hint'));
  section.append(textNode('p', 'These are observed contributions. Assignments and opportunities are unknown, so utility totals do not raise or lower the letter grade.', 'hint'));
  if (utility.completeFights < utility.observedFights)
    section.append(textNode('p', 'Utility evidence is incomplete in some fights; the totals are observed lower bounds.', 'hint'));
  return section;
}
function raidReviewSource(fight, fallbackScope) {
  if (!/^[A-Za-z0-9]{16}$/.test(fight.code || '') || !Number.isSafeInteger(fight.fightID) || fight.fightID < 1
    || !Number.isSafeInteger(fight.actorID) || fight.actorID < 1) return null;
  const patch = fight.scope?.patch || fallbackScope?.patch;
  const link = textNode('a', new Date(fight.date).toLocaleDateString() + ' · ' + fight.spec + ' · ' + fight.role
    + (typeof patch === 'string' && patch.trim() ? ' · Patch ' + patch : ''));
  link.href = 'https://www.warcraftlogs.com/reports/' + encodeURIComponent(fight.code) + '#fight=' + fight.fightID
    + '&type=damage-taken&source=' + fight.actorID;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function raidReviewFight(fight, fallbackScope) {
  const item = document.createElement('li');
  const source = raidReviewSource(fight, fallbackScope); if (source) item.append(source);
  const complete = fight.damage?.complete && fight.survival?.complete;
  const deaths = Array.isArray(fight.survival?.deaths) ? fight.survival.deaths.length : null;
  item.append(textNode('p', (fight.damage?.complete ? '' : 'Observed ≥ ') + raidReviewNumber(fight.damage?.avoidableHealth)
    + ' reviewed mechanic health damage · ' + (!fight.survival?.complete ? 'death evidence incomplete'
      : deaths === null ? 'deaths unavailable' : deaths + ' deaths') + (complete ? '' : ' · partial evidence'), 'hint'));
  for (const ability of fight.damage?.abilities || []) {
    if (!(ability.hits > 0)) continue;
    item.append(textNode('p', ability.name + ': ' + (fight.damage?.complete ? '' : 'observed ≥ ') + raidReviewNumber(ability.hits) + ' hits / ticks in '
      + raidReviewNumber(ability.clusters) + ' contact ' + (ability.clusters === 1 ? 'cluster' : 'clusters')
      + (ability.contextual ? ' · assignment context needed' : ''), 'hint'));
  }
  for (const death of fight.survival?.deaths || [])
    item.append(textNode('p', fmtT(death.at) + ' death · ' + death.causeName
      + (death.reviewedAvoidable ? ' · reviewed avoidable cause' : ' · responsibility unverified'), 'hint'));
  for (const limitation of fight.limitations || []) item.append(textNode('p', limitation, 'hint'));
  return item;
}
function raidReviewBoss(boss, grade, review) {
  const card = document.createElement('article'); card.className = 'raid-execution-boss'; card.dataset.boss = boss.id;
  const heading = document.createElement('div'); heading.className = 'raid-execution-boss-heading';
  heading.append(textNode('h4', boss.name));
  heading.append(textNode('strong', grade?.letter || 'Ungraded', 'raid-execution-boss-letter'));
  card.append(heading);
  if (!grade) {
    card.append(textNode('p', raidReviewDone.has(boss.id) ? 'No eligible evidence for this role and patch.' : raidReviewRunning ? 'Waiting for review.' : 'No evidence reviewed yet.', 'hint')); return card;
  }
  card.append(textNode('p', grade.summary));
  const patches = raidReviewPatchLabels(review ? [review] : []);
  card.append(textNode('p', patches.reviewed, 'hint'), textNode('p', patches.sampled, 'hint'));
  const dates = raidReviewDateRange(review?.fights || []);
  if (dates) card.append(textNode('p', dates, 'hint'));
  card.append(textNode('p', grade.sample.kills + ' sampled kills · ' + grade.sample.gradedFights + ' gradeable fights · '
    + grade.sample.survivedKills + ' kills survived', 'hint'));
  card.append(textNode('p', (grade.provisional ? 'Provisional · ' : '') + grade.survival.confirmedAvoidableDeaths
    + ' reviewed avoidable deaths · ' + grade.survival.contextDeaths + ' deaths needing context', 'hint'));
  const reviewedMechanics = new Set((review?.fights || []).flatMap((fight) => (fight.damage?.abilities || [])
    .filter((ability) => !ability.contextual).map((ability) => ability.abilityID))).size;
  if (reviewedMechanics) card.append(textNode('p', reviewedMechanics + ' independently reviewed '
    + (reviewedMechanics === 1 ? 'mechanic · narrow coverage' : 'mechanics'), 'hint'));
  for (const reason of grade.reasons || []) card.append(textNode('p', reason, 'raid-execution-reason'));
  if (review?.reason) card.append(textNode('p', raidReviewFriendlyReason(review.reason), 'hint'));
  for (const role of grade.roles || [])
    card.append(textNode('p', role.role + ': ' + (role.letter || 'Ungraded') + (role.provisional ? ' (provisional)' : '')
      + ' · ' + role.sample.kills + ' kills', 'hint'));
  if (grade.utility.observedFights > 0) {
    card.append(textNode('p', 'Observed support: ' + raidReviewSupportNumber(grade.utility, grade.utility.successfulInterrupts) + ' successful interrupts · '
      + raidReviewSupportNumber(grade.utility, grade.utility.dispels) + ' dispels · ' + raidReviewSupportNumber(grade.utility, grade.utility.raidAbsorbed) + ' absorbed on teammates', 'hint'));
    for (const ability of grade.utility.absorbAbilities || [])
      card.append(textNode('p', ability.name + ': ' + raidReviewNumber(ability.amount) + ' absorbed', 'hint'));
  }
  if (review?.fights?.length) {
    const details = document.createElement('details'); details.className = 'raid-execution-sources';
    details.append(textNode('summary', 'Inspect ' + review.fights.length + ' source kills'));
    const list = document.createElement('ul');
    for (const fight of review.fights) list.append(raidReviewFight(fight, review.scope));
    details.append(list); card.append(details);
  }
  const limitations = (grade.limitations || []).filter((limit) => !/^(?:damage|casts|deaths|interrupts|dispels|healing):|^Boss review is /.test(limit));
  if (limitations.length) {
    const coverage = document.createElement('details'); coverage.className = 'raid-execution-sources';
    coverage.append(textNode('summary', 'Coverage and limitations'));
    for (const limit of limitations) coverage.append(textNode('p', limit, 'hint'));
    card.append(coverage);
  }
  return card;
}
function renderRaidReview() {
  const context = raidReviewContext; if (!context) return;
  const start = $('raidExecutionStart');
  start.textContent = raidReviewRunning ? 'Reviewing raid…' : raidReviewDone.size === context.bosses.length && raidReviewUncertain.size
    ? 'Review stopped' : raidReviewDone.size === context.bosses.length
    ? 'Review raid again' : raidReviewDone.size || raidReviewResults.length ? 'Continue raid review' : 'Review raid execution';
  start.disabled = raidReviewRunning || (raidReviewDone.size === context.bosses.length && raidReviewUncertain.size > 0)
    || context.zone !== RAID_REVIEW_SCOPE.zone || context.difficulty !== RAID_REVIEW_SCOPE.difficulty
    || window.MIRROR_EXECUTION_CAPABILITIES?.reference !== true;
  $('raidExecutionCancel').style.display = raidReviewRunning ? '' : 'none';
  $('raidExecutionProgress').textContent = raidReviewMessage;
  const root = $('raidExecutionResults'); root.innerHTML = '';
  if (!raidReviewResults.length) return;
  const options = { role: $('raidExecutionRole').value || 'primary', patch: $('raidExecutionPatch').value || 'all', currentPatch: RAID_REVIEW_SCOPE.patch };
  const ranking = assessRaidRanking(raidReviewResults, options);
  const selected = selectRaidRankingReviews(raidReviewResults, options);
  const overall = gradeRaid(selected.reviews, context.bosses.length);
  const legacyOverall = gradeRaid(raidReviewResults, context.bosses.length);
  const assessment = document.createElement('div'); assessment.className = 'raid-execution-overall';
  const title = document.createElement('div'); title.className = 'raid-execution-grade';
  title.append(textNode('strong', ranking.letter || '—'));
  title.append(textNode('span', ranking.score !== null ? 'Provisional non-damage grade · ' + ranking.role : 'Not enough evidence to grade'));
  assessment.append(title);
  assessment.append(textNode('p', 'Evidence-adjusted execution · ' + (ranking.score === null ? 'Ungraded' : ranking.score + ' / 100')
    + ' · ' + ranking.sampleLabel, 'raid-ranking-summary'));
  assessment.append(textNode('p', ranking.primaryRoleAmbiguous && options.role === 'primary'
    ? 'Primary role is tied; choose a role explicitly before comparison.' : ranking.rankEligible ? 'Enough repeated boss evidence for a supported comparison.'
      : 'Limited evidence: score shown for coaching, without an authoritative placement.', 'hint'));
  assessment.append(textNode('p', ranking.patchLabel + ' · primary role: ' + (ranking.primaryRole || 'unavailable'), 'hint'));
  for (const exclusion of ranking.exclusions.filter((reason) => options.role === 'primary' || !reason.startsWith('Primary role tie')))
    assessment.append(textNode('p', exclusion, 'hint'));
  assessment.append(textNode('p', 'An automated coaching rubric, not an official execution percentile.', 'hint'));
  assessment.append(textNode('p', context.name + ' · ' + context.server + ' · ' + context.zoneName + ' ' + (DIFF[context.difficulty] || '')));
  const compatibleReviews = selected.reviews.filter((review) => overall.bosses.some((boss) => boss.key === review.key));
  const patches = raidReviewPatchLabels(compatibleReviews);
  assessment.append(textNode('p', patches.reviewed, 'hint'), textNode('p', patches.sampled, 'hint'));
  const dates = raidReviewDateRange(compatibleReviews.flatMap((review) => review.fights));
  if (dates) assessment.append(textNode('p', dates, 'hint'));
  assessment.append(textNode('p', overall.summary));
  assessment.append(textNode('p', ranking.summary, 'hint'));
  assessment.append(textNode('p', overall.gradedBosses + ' of ' + overall.totalBosses + ' bosses graded · '
    + overall.bosses.reduce((sum, boss) => sum + boss.sample.kills, 0) + ' sampled kills', 'hint'));
  assessment.append(textNode('p', overall.bosses.reduce((sum, boss) => sum + boss.survival.confirmedAvoidableDeaths, 0)
    + ' reviewed avoidable deaths · ' + overall.bosses.reduce((sum, boss) => sum + boss.survival.contextDeaths, 0)
    + ' deaths needing context', 'hint'));
  for (const role of overall.roles || [])
    assessment.append(textNode('p', role.role + ': ' + (role.letter || 'Ungraded') + (role.provisional ? ' (provisional)' : '')
      + ' across ' + role.bosses
      + (role.bosses === 1 ? ' boss' : ' bosses'), 'hint'));
  root.append(assessment, raidReviewUtility(overall.utility));
  const grid = document.createElement('div'); grid.className = 'raid-execution-bosses';
  for (const boss of context.bosses) grid.append(raidReviewBoss(boss, overall.bosses.find((entry) => entry.boss.id === boss.id),
    selected.reviews.find((review) => review.boss.id === boss.id)));
  root.append(grid);
  const legacy = document.createElement('details'); legacy.className = 'raid-execution-rubric';
  legacy.append(textNode('summary', 'Legacy overall score · all reviewed roles and patches'));
  legacy.append(textNode('p', (legacyOverall.letter || 'Ungraded') + (legacyOverall.score === null ? '' : ' · ' + legacyOverall.score + ' / 100')
    + ' · equal boss weighting before evidence adjustment'));
  legacy.append(textNode('p', legacyOverall.gradedBosses + ' of ' + legacyOverall.totalBosses + ' bosses graded · '
    + legacyOverall.bosses.reduce((sum, boss) => sum + boss.sample.kills, 0) + ' sampled kills', 'hint'));
  legacy.append(textNode('p', 'This retained score can blend roles. The headline, boss evidence and support above use your selected role and patch.', 'hint'));
  root.append(legacy);
  const rubric = document.createElement('details'); rubric.className = 'raid-execution-rubric';
  rubric.append(textNode('summary', 'How this grade works and what it cannot measure'));
  rubric.append(textNode('p', 'Headline ranking: one selected role and patch view. Each boss is weighted by its gradeable kill count, capped at three. '
    + 'A supported comparison needs at least four bosses with three gradeable kills each; this is a sample heuristic, not statistical confidence.'));
  rubric.append(textNode('p', 'Underlying per-kill penalties and retained legacy aggregation · ' + overall.rubric.label + ': ' + overall.rubric.description));
  rubric.append(textNode('p', 'Grade bands: ' + overall.rubric.thresholds.map((band) => band.letter + ' ≥ ' + band.minimum).join(' · '), 'hint'));
  for (const limit of overall.limitations || []) rubric.append(textNode('p', limit, 'hint'));
  root.append(rubric);
}
function bindRaidReview() {
  $('raidExecutionStart').onclick = startRaidReview;
  $('raidExecutionCancel').onclick = () => cancelRaidReview();
  $('raidExecutionRole').onchange = renderRaidReview;
  $('raidExecutionPatch').onchange = renderRaidReview;
  for (const id of ['name', 'server', 'region', 'zone', 'difficulty']) {
    const input = $(id), previous = input.onchange;
    input.onchange = (event) => { previous?.(event); cancelRaidReview(true); };
    input.oninput = () => cancelRaidReview(true);
  }
}

function replaceExactlyOnce(html, before, after, label) {
  const first = html.indexOf(before);
  if (first < 0 || html.indexOf(before, first + before.length) >= 0)
    throw new Error('CastMirror raid review anchor changed or ambiguous: ' + label);
  return html.slice(0, first) + after + html.slice(first + before.length);
}
export function emitRaidGradeModel() {
  const filename = new URL('../app/api/castmirror/execution/raid/grade.ts', import.meta.url);
  const source = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  const parsed = ts.createSourceFile('grade.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length || parsed.statements.some((node) => ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly))
    throw new Error('Raid grade model must remain a portable pure module');
  const portable = parsed.statements.filter((node) => !ts.isImportDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node))
    .map((node) => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
  const emitted = ts.transpileModule(portable, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: false } }).outputText;
  if (/\b(?:import|require|process|fetch|document|window)\b/.test(emitted) || !/function gradeRaid\(/.test(emitted))
    throw new Error('Raid grade model contains a browser-external dependency');
  return emitted;
}
export function adaptRaidReview(html) {
  const catalog = JSON.parse(readFileSync(new URL('../vendor/castmirror/reviews/venomous-abyss-mythic.json', import.meta.url), 'utf8'));
  const reviewed = JSON.parse(readFileSync(new URL('../vendor/castmirror/reviews/raid-execution-scopes.json', import.meta.url), 'utf8'));
  if (reviewed.zone !== catalog.scope.zone || reviewed.difficulty !== catalog.scope.difficulty || reviewed.size !== catalog.scope.size
    || !Array.isArray(reviewed.scopes) || !reviewed.scopes.length || reviewed.scopes.some((scope) => !Number.isSafeInteger(scope.partition)
      || scope.partition < 1 || typeof scope.patch !== 'string' || !scope.patch.trim())) throw new Error('Raid review patch scopes are invalid');
  const scope = { zone: catalog.scope.zone, difficulty: catalog.scope.difficulty, patch: catalog.scope.patch,
    reviewedScopes: reviewed.scopes,
    bosses: catalog.encounters.map((boss) => ({ id: boss.encounter, name: boss.name })) };
  const section = `
<section id="raidExecution" class="raid-execution" style="display:none" aria-labelledby="raidExecutionTitle">
  <h3 id="raidExecutionTitle">Raid execution</h3>
  <p class="hint">Review positioning, survival and observed raid support across the raid. Damage output is excluded.</p>
  <p><a href="/castmirror/guild-execution">Open the saved Nothing But Trouble execution board →</a></p>
  <div class="raid-execution-filters"><label>Role <select id="raidExecutionRole"><option value="primary">Primary role</option><option value="dps">DPS</option><option value="tank">Tank</option><option value="healer">Healer</option></select></label>
    <label>Patch <select id="raidExecutionPatch"><option value="all">All reviewed patches</option><option value="current">${scope.patch} · current only</option>${scope.reviewedScopes.filter((entry) => entry.patch !== scope.patch).map((entry) => '<option value="' + entry.patch + '">' + entry.patch + ' · historical only</option>').join('')}</select></label></div>
  <div class="raid-execution-actions"><button type="button" id="raidExecutionStart">Review raid execution</button><button type="button" id="raidExecutionCancel" style="display:none">Stop review</button></div>
  <p class="hint" id="raidExecutionProgress" role="status" aria-live="polite"></p>
  <div id="raidExecutionResults"></div>
</section>
`;
  html = replaceExactlyOnce(html, '<div id="out">', section + '\n<div id="out">', 'raid section');
  html = replaceExactlyOnce(html, '  e.preventDefault();\n  const go =', '  e.preventDefault();\n  const raidLookupContext = raidReviewCharacterRequest();\n  const go =', 'character lookup context');
  html = replaceExactlyOnce(html, '    renderKills(data);\n    say', '    renderKills(data);\n    prepareRaidReview(data, raidLookupContext);\n    say', 'character lookup result');
  const helpers = [raidReviewForm, raidReviewKey, raidReviewCurrent, cancelRaidReview, raidReviewCharacterRequest, prepareRaidReview,
    raidReviewFriendlyReason, raidReviewMatches, startRaidReview, raidReviewNumber, raidReviewScopeLabel, raidReviewPatchLabels, raidReviewDateRange,
    raidReviewSupportNumber, raidReviewUtility, raidReviewSource, raidReviewFight,
    raidReviewBoss, renderRaidReview, bindRaidReview];
  const emitted = '// BEGIN CASTMIRROR RAID REVIEW\nconst RAID_REVIEW_SCOPE = Object.freeze(' + JSON.stringify(scope) + ');\n'
    + 'let raidReviewContext = null, raidReviewGeneration = 0, raidReviewController = null, raidReviewRunning = false;\n'
    + 'let raidReviewResults = [], raidReviewDone = new Set(), raidReviewUncertain = new Set(), raidReviewMessage = "";\n'
    + emitRaidGradeModel() + '\n' + emitHelpers(import.meta.url, helpers.map((fn) => fn.name))
    + '\nbindRaidReview();\n// END CASTMIRROR RAID REVIEW\n';
  // The hosted page has two scripts: configuration, then the one application.
  const scriptEnd = html.lastIndexOf('</script>');
  if (scriptEnd < 0) throw new Error('CastMirror raid review anchor changed: application script');
  html = html.slice(0, scriptEnd) + emitted + html.slice(scriptEnd);
  const css = `
  .raid-execution { margin: 26px 0; padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); min-width: 0; }
  .raid-execution h3 { margin: 0 0 8px; } .raid-execution p { line-height: 1.6; overflow-wrap: anywhere; }
  .raid-execution .hint { color: var(--dim); font-size: 12px; }
  .raid-execution-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 15px 0 8px; }
  .raid-execution-filters { display: flex; flex-wrap: wrap; gap: 16px; margin: 16px 0; } .raid-execution-filters label { display: grid; gap: 6px; font-size: 13px; } .raid-execution-filters select { padding: 8px; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
  .raid-execution-actions button { padding: 9px 14px; } .raid-execution-actions button:disabled { cursor: not-allowed; opacity: .65; }
  .raid-execution-overall { border-top: 1px solid var(--line); margin-top: 18px; padding-top: 18px; }
  .raid-execution-grade { display: flex; gap: 18px; align-items: center; } .raid-execution-grade strong { font-size: 48px; line-height: 1.2; color: var(--text); }
  .raid-execution-grade span { font-size: 15px; } .raid-execution-utility { margin: 20px 0; } .raid-execution-utility h4 { margin: 0 0 7px; }
  .raid-execution-bosses { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .raid-execution-boss { min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .raid-execution-boss-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .raid-execution-boss h4 { margin: 0; font-size: 15px; overflow-wrap: anywhere; } .raid-execution-boss-letter { white-space: nowrap; font-size: 19px; }
  .raid-execution-reason { font-size: 13px; } .raid-execution-sources, .raid-execution-rubric { font-size: 13px; margin-top: 16px; }
  .raid-execution summary { cursor: pointer; line-height: 1.6; } .raid-execution a { color: var(--text); text-decoration: underline; overflow-wrap: anywhere; }
  .raid-execution-sources ul { padding-left: 18px; } .raid-execution-sources li { margin: 12px 0; }
  @media (max-width: 650px) { .raid-execution { padding: 14px; } .raid-execution-bosses { grid-template-columns: minmax(0, 1fr); } .raid-execution-grade strong { font-size: 40px; } }
`;
  return replaceExactlyOnce(html, '</style>', css + '</style>', 'responsive raid styles');
}
