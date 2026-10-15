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
    raidReviewContext = null; raidReviewResults = []; raidReviewDone = new Set(); raidReviewMessage = '';
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
    ? 'Review the latest six public kills per boss, selected by date. Your damage ranking does not affect the grade.'
    : 'Raid execution grading is available for the current reviewed Mythic raid. Choose Mythic and find kills again.';
  renderRaidReview();
}
function raidReviewFriendlyReason(reason) {
  const text = String(reason || '').toLowerCase();
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
    try {
      const res = await fetch(API + 'execution/raid', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: context.name, server: context.server, region: context.region,
          zone: context.zone, difficulty: context.difficulty, encounter: boss.id }), signal: raidReviewController?.signal });
      const data = await res.json();
      if (!raidReviewCurrent(generation, context)) return;
      if (!res.ok || data.error) throw new Error(data.reason || data.error || 'unavailable');
      if (!raidReviewMatches(data.review, context, boss)) throw new Error('unavailable');
      raidReviewResults = raidReviewResults.filter((review) => review.boss.id !== boss.id).concat(data.review);
      const reason = data.review.acquisition?.reason || data.review.reason || '';
      if (/busy|quota|budget|rate.?limit|reserve|point-cap|account-background-cap/.test(reason)) {
        raidReviewMessage = raidReviewFriendlyReason(reason); break;
      }
      raidReviewDone.add(boss.id);
    } catch (error) {
      if (!raidReviewCurrent(generation, context)) return;
      raidReviewMessage = raidReviewFriendlyReason(error.message); break;
    }
  }
  if (!raidReviewCurrent(generation, context)) return;
  raidReviewRunning = false; raidReviewController = null;
  if (raidReviewDone.size === context.bosses.length)
    raidReviewMessage = 'Review complete · latest public kill sample. Bosses without enough evidence remain ungraded.';
  renderRaidReview();
}
function raidReviewNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'Unavailable';
}
function raidReviewUtility(utility) {
  const section = document.createElement('div'); section.className = 'raid-execution-utility';
  section.append(textNode('h4', 'Observed raid support'));
  section.append(textNode('p', raidReviewNumber(utility.successfulInterrupts) + ' successful interrupts · '
    + raidReviewNumber(utility.dispels) + ' dispels · ' + raidReviewNumber(utility.raidAbsorbed) + ' damage absorbed on teammates'));
  for (const ability of utility.absorbAbilities || [])
    section.append(textNode('p', ability.name + ': ' + raidReviewNumber(ability.amount) + ' absorbed', 'hint'));
  section.append(textNode('p', 'These are observed contributions. Assignments and opportunities are unknown, so utility totals do not raise or lower the letter grade.', 'hint'));
  if (utility.completeFights < utility.observedFights)
    section.append(textNode('p', 'Utility evidence is incomplete in some fights; the totals are observed lower bounds.', 'hint'));
  return section;
}
function raidReviewSource(fight) {
  if (!/^[A-Za-z0-9]{16}$/.test(fight.code || '') || !Number.isSafeInteger(fight.fightID) || fight.fightID < 1
    || !Number.isSafeInteger(fight.actorID) || fight.actorID < 1) return null;
  const link = textNode('a', new Date(fight.date).toLocaleDateString() + ' · ' + fight.spec + ' · ' + fight.role);
  link.href = 'https://www.warcraftlogs.com/reports/' + encodeURIComponent(fight.code) + '#fight=' + fight.fightID
    + '&type=damage-taken&source=' + fight.actorID;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function raidReviewFight(fight) {
  const item = document.createElement('li');
  const source = raidReviewSource(fight); if (source) item.append(source);
  const complete = fight.damage?.complete && fight.survival?.complete;
  const deaths = Array.isArray(fight.survival?.deaths) ? fight.survival.deaths.length : null;
  item.append(textNode('p', (fight.damage?.complete ? '' : 'Observed ≥ ') + raidReviewNumber(fight.damage?.avoidableHealth)
    + ' reviewed avoidable health damage · ' + (!fight.survival?.complete ? 'death evidence incomplete'
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
    card.append(textNode('p', raidReviewRunning ? 'Waiting for review.' : 'No evidence reviewed yet.', 'hint')); return card;
  }
  card.append(textNode('p', grade.summary));
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
    card.append(textNode('p', 'Observed support: ' + raidReviewNumber(grade.utility.successfulInterrupts) + ' successful interrupts · '
      + raidReviewNumber(grade.utility.dispels) + ' dispels · ' + raidReviewNumber(grade.utility.raidAbsorbed) + ' absorbed on teammates', 'hint'));
    for (const ability of grade.utility.absorbAbilities || [])
      card.append(textNode('p', ability.name + ': ' + raidReviewNumber(ability.amount) + ' absorbed', 'hint'));
  }
  if (review?.fights?.length) {
    const details = document.createElement('details'); details.className = 'raid-execution-sources';
    details.append(textNode('summary', 'Inspect ' + review.fights.length + ' source kills'));
    const list = document.createElement('ul');
    for (const fight of review.fights) list.append(raidReviewFight(fight));
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
  start.textContent = raidReviewRunning ? 'Reviewing raid…' : raidReviewDone.size === context.bosses.length
    ? 'Review raid again' : raidReviewDone.size || raidReviewResults.length ? 'Continue raid review' : 'Review raid execution';
  start.disabled = raidReviewRunning || context.zone !== RAID_REVIEW_SCOPE.zone || context.difficulty !== RAID_REVIEW_SCOPE.difficulty
    || window.MIRROR_EXECUTION_CAPABILITIES?.reference !== true;
  $('raidExecutionCancel').style.display = raidReviewRunning ? '' : 'none';
  $('raidExecutionProgress').textContent = raidReviewMessage;
  const root = $('raidExecutionResults'); root.innerHTML = '';
  if (!raidReviewResults.length) return;
  const overall = gradeRaid(raidReviewResults, context.bosses.length);
  const assessment = document.createElement('div'); assessment.className = 'raid-execution-overall';
  const title = document.createElement('div'); title.className = 'raid-execution-grade';
  title.append(textNode('strong', overall.letter || '—'));
  title.append(textNode('span', overall.status === 'graded' ? 'Provisional non-damage grade' : 'Not enough evidence to grade'));
  assessment.append(title);
  assessment.append(textNode('p', 'An automated coaching rubric, not an official execution percentile.', 'hint'));
  assessment.append(textNode('p', context.name + ' · ' + context.server + ' · ' + context.zoneName + ' ' + (DIFF[context.difficulty] || '')));
  assessment.append(textNode('p', overall.summary));
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
    raidReviewResults.find((review) => review.boss.id === boss.id)));
  root.append(grid);
  const rubric = document.createElement('details'); rubric.className = 'raid-execution-rubric';
  rubric.append(textNode('summary', 'How this grade works and what it cannot measure'));
  rubric.append(textNode('p', overall.rubric.label + ': ' + overall.rubric.description));
  rubric.append(textNode('p', 'Grade bands: ' + overall.rubric.thresholds.map((band) => band.letter + ' ≥ ' + band.minimum).join(' · '), 'hint'));
  for (const limit of overall.limitations || []) rubric.append(textNode('p', limit, 'hint'));
  root.append(rubric);
}
function bindRaidReview() {
  $('raidExecutionStart').onclick = startRaidReview;
  $('raidExecutionCancel').onclick = () => cancelRaidReview();
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
  const scope = { zone: catalog.scope.zone, difficulty: catalog.scope.difficulty,
    bosses: catalog.encounters.map((boss) => ({ id: boss.encounter, name: boss.name })) };
  const section = `
<section id="raidExecution" class="raid-execution" style="display:none" aria-labelledby="raidExecutionTitle">
  <h3 id="raidExecutionTitle">Raid execution</h3>
  <p class="hint">Review positioning, survival and observed raid support across the raid. Damage output is excluded.</p>
  <div class="raid-execution-actions"><button type="button" id="raidExecutionStart">Review raid execution</button><button type="button" id="raidExecutionCancel" style="display:none">Stop review</button></div>
  <p class="hint" id="raidExecutionProgress" role="status" aria-live="polite"></p>
  <div id="raidExecutionResults"></div>
</section>
`;
  html = replaceExactlyOnce(html, '<div id="out">', section + '\n<div id="out">', 'raid section');
  html = replaceExactlyOnce(html, '  e.preventDefault();\n  const go =', '  e.preventDefault();\n  const raidLookupContext = raidReviewCharacterRequest();\n  const go =', 'character lookup context');
  html = replaceExactlyOnce(html, '    renderKills(data);\n    say', '    renderKills(data);\n    prepareRaidReview(data, raidLookupContext);\n    say', 'character lookup result');
  const helpers = [raidReviewForm, raidReviewKey, raidReviewCurrent, cancelRaidReview, raidReviewCharacterRequest, prepareRaidReview,
    raidReviewFriendlyReason, raidReviewMatches, startRaidReview, raidReviewNumber, raidReviewUtility, raidReviewSource, raidReviewFight,
    raidReviewBoss, renderRaidReview, bindRaidReview];
  const emitted = '// BEGIN CASTMIRROR RAID REVIEW\nconst RAID_REVIEW_SCOPE = Object.freeze(' + JSON.stringify(scope) + ');\n'
    + 'let raidReviewContext = null, raidReviewGeneration = 0, raidReviewController = null, raidReviewRunning = false;\n'
    + 'let raidReviewResults = [], raidReviewDone = new Set(), raidReviewMessage = "";\n'
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
