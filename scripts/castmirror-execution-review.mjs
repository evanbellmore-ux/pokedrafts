// Portable browser helpers for the hosted page. These functions are emitted
// together; they do not change the native statistical index or its contract.
import { emitHelpers } from './castmirror-emit-helpers.mjs';

function executionReviewNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function executionReviewComplete(component) {
  return component?.state === 'known' && component.measurements?.complete === true
    && component.measurements.basis !== 'observed-lower-bound';
}
function executionReviewCanonical(value) {
  if (Array.isArray(value)) return value.map(executionReviewCanonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, key === 'abilityIDs' && Array.isArray(value[key])
      ? [...value[key]].sort((a, b) => a - b) : executionReviewCanonical(value[key])]));
  return value;
}
export function executionReviewPair(execution) {
  const a = execution?.a, b = execution?.b, left = a?.components?.avoidance, right = b?.components?.avoidance;
  const result = { comparable: false, reason: '', a: null, b: null, delta: null, percent: null };
  if (!executionReviewComplete(left) || !executionReviewComplete(right)) {
    result.reason = [left, right].some((c) => c?.state === 'unsupported')
      ? 'Avoidable mechanics have not been reviewed for this encounter. Missing review is not zero mistakes.'
      : 'Both logs need complete reviewed avoidable-damage data before a fair gap can be shown.';
    return result;
  }
  const definition = left.definition;
  if (!definition?.id || !Array.isArray(definition.abilityIDs) || !definition.abilityIDs.length
    || JSON.stringify(executionReviewCanonical(definition)) !== JSON.stringify(executionReviewCanonical(right.definition))) {
    result.reason = 'The logs use different or unavailable reviewed mechanic definitions; their avoidable totals are not comparable.';
    return result;
  }
  if (!a.scope || !b.scope || !['zone', 'encounter', 'difficulty', 'size'].every((key) =>
    Number.isSafeInteger(a.scope[key]) && a.scope[key] > 0 && a.scope[key] === b.scope[key])
    || !['partition', 'patch', 'kill'].every((key) => (a.scope[key] ?? null) === (b.scope[key] ?? null))) {
    result.reason = 'The logs do not share a verified encounter, difficulty and fight scope.';
    return result;
  }
  if (![left, right].every((c) => c.measurements.exposure === 'full-fight')) {
    result.reason = 'A death or missing survival data shortens exposure. Lower damage taken cannot establish better avoidance.';
    return result;
  }
  const values = [left, right].map((c) => c.measurements.perSecond ?? c.value);
  if (!values.every(executionReviewNumber)) {
    result.reason = 'Complete avoidable-damage rates are unavailable.';
    return result;
  }
  const delta = values[0] - values[1];
  return { comparable: true, reason: null, a: values[0], b: values[1], delta,
    percent: values[1] > 0 ? 100 * delta / values[1] : null };
}
function executionReviewFormat(value, digits = value >= 100 ? 0 : 1) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function executionReviewObserved(value, complete, digits = value >= 100 ? 0 : 1) {
  return executionReviewFormat(complete ? value : Math.floor(value * 10 ** digits) / 10 ** digits, digits);
}
function executionReviewTime(value) {
  const tenths = Math.round(value * 10);
  return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' + ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
}
function executionReviewGap(pair) {
  if (!pair.comparable) return pair.reason;
  if (pair.a === 0 && pair.b === 0) return 'Neither log shows damage from the reviewed avoidable mechanics.';
  if (pair.delta === 0) return 'Both logs took the same reviewed avoidable damage per second.';
  const direction = pair.delta < 0 ? 'less' : 'more';
  return 'Selected player took ' + executionReviewFormat(Math.abs(pair.delta)) + ' ' + direction + ' avoidable health damage / sec'
    + (pair.percent === null ? '; the reference took zero.'
      : ' (' + executionReviewFormat(Math.abs(pair.percent)) + '% ' + direction + ' than the reference).');
}
function executionReviewCell(name, component = {}) {
  if (name !== 'avoidance' && name !== 'defenses') return renderStatisticsCell(name, component);
  const cell = document.createElement('td'), m = component.measurements || {}, complete = executionReviewComplete(component);
  if (['missing', 'unsupported', 'unknown', 'unavailable'].includes(component.state)) {
    cell.append(textNode('span', component.state === 'unsupported' ? 'Not reviewed' : 'Unavailable', 'execution-unavailable'));
    return cell;
  }
  const prefix = complete ? '' : m.basis === 'observed-lower-bound' ? '≥ ' : 'Observed ';
  if (name === 'avoidance') {
    if (!executionReviewNumber(m.total)) return renderStatisticsCell(name, component);
    cell.append(textNode('span', prefix + executionReviewObserved(m.total, complete, 0) + ' health damage', 'execution-value'));
    if (executionReviewNumber(m.hits)) cell.append(textNode('span', prefix + m.hits + ' hits / ticks', 'execution-value-detail'));
    const rate = m.perSecond ?? component.value;
    if (executionReviewNumber(rate)) cell.append(textNode('span', prefix + executionReviewObserved(rate, complete) + ' damage / sec', 'execution-value-detail'));
    const abilities = Array.isArray(m.byAbility) ? m.byAbility : [];
    if (abilities.length && abilities.every((ability) => executionReviewNumber(ability.absorbed))) {
      const absorbed = abilities.reduce((sum, ability) => sum + ability.absorbed, 0);
      if (Number.isFinite(absorbed) && absorbed > 0) cell.append(textNode('span', prefix + executionReviewObserved(absorbed, complete, 0) + ' absorbed by shields', 'execution-value-detail'));
    }
    if (m.exposure !== 'full-fight') cell.append(textNode('span', 'Exposure shortened or unknown', 'execution-incomplete'));
  } else {
    if (!executionReviewNumber(m.boundedUses)) return renderStatisticsCell(name, component);
    cell.append(textNode('span', prefix + m.boundedUses + ' reviewed personal casts', 'execution-value'));
    for (const ability of Array.isArray(m.abilities) ? m.abilities : []) {
      if (typeof ability?.name !== 'string' || !executionReviewNumber(ability.boundedUses)) continue;
      cell.append(textNode('span', ability.name + ': ' + prefix + ability.boundedUses, 'execution-value-detail'));
    }
  }
  if (!complete) cell.append(textNode('span', 'Incomplete', 'execution-incomplete'));
  return cell;
}
export function executionReviewAbilities(component = {}) {
  if (['missing', 'unsupported', 'unknown', 'unavailable'].includes(component.state)) return null;
  const m = component.measurements || {}, supplied = Array.isArray(m.byAbility) ? m.byAbility : null;
  if (!executionReviewNumber(m.total) || !Number.isSafeInteger(m.hits) || m.hits < 0) return null;
  const incidents = supplied ? null : Array.isArray(m.incidents) ? m.incidents : null;
  if (!supplied && !incidents) return null;
  const groups = new Map();
  for (const id of component.definition?.abilityIDs || []) if (Number.isSafeInteger(id) && id > 0)
    groups.set(id, { abilityID: id, name: 'Spell ' + id, total: 0, hits: 0, times: [] });
  let valid = true;
  for (const item of supplied || incidents) {
    const id = item?.abilityID, total = supplied ? item?.total ?? item?.amount : item?.amount;
    const hits = supplied ? item?.hits : 1;
    if (!groups.has(id) || !executionReviewNumber(total) || !Number.isSafeInteger(hits) || hits < 0) { valid = false; continue; }
    const group = groups.get(id);
    group.total += total; group.hits += hits;
    if (typeof item.name === 'string' && item.name.trim()) group.name = item.name;
    else if (typeof item.abilityName === 'string' && item.abilityName.trim()) group.name = item.abilityName;
    if (executionReviewNumber(item.time)) group.times.push(item.time);
  }
  // Aggregate rows may cover the full log while the incident sample is capped.
  // Timestamps remain useful examples; they never change aggregate hit totals.
  if (supplied && Array.isArray(m.incidents)) for (const item of m.incidents) {
    if (groups.has(item?.abilityID) && executionReviewNumber(item.time)) groups.get(item.abilityID).times.push(item.time);
  }
  const values = [...groups.values()], total = values.reduce((sum, item) => sum + item.total, 0), hits = values.reduce((sum, item) => sum + item.hits, 0);
  const reconciled = valid && executionReviewNumber(m.total) && Math.abs(total - m.total) <= Math.max(0.001, m.total * 1e-9)
    && (!executionReviewNumber(m.hits) || hits === m.hits);
  return { groups: values, complete: executionReviewComplete(component) && reconciled };
}
function executionReviewDuration(D, execution, key) {
  const survival = execution[key]?.components?.survival;
  const alive = survival?.measurements?.aliveTimeSec;
  return executionReviewComplete(survival) && survival.measurements.deathCount === 0 && executionReviewNumber(alive) && alive > 0
    ? alive : D[key]?.durSec;
}
function renderExecutionReviewAbilities(D, execution, breakdown, pair) {
  const details = ['a', 'b'].map((key) => executionReviewAbilities(execution[key]?.components?.avoidance));
  if (!details.some(Boolean)) return;
  const section = document.createElement('section'); section.className = 'execution-mechanics';
  section.append(textNode('h3', 'Which avoidable mechanics caused the gap?'));
  const table = document.createElement('table'); table.className = 'execution-table';
  const head = document.createElement('thead'), heading = document.createElement('tr');
  for (const label of ['Reviewed mechanic', D.a?.name || 'Selected player', D.b?.name || 'Reference player', 'Damage / sec gap']) {
    const cell = textNode('th', label); cell.setAttribute('scope', 'col'); heading.append(cell);
  }
  head.append(heading); table.append(head);
  const body = document.createElement('tbody'), ids = [...new Set(details.flatMap((d) => d?.groups.map((g) => g.abilityID) || []))];
  for (const id of ids) {
    const groups = details.map((d) => d?.groups.find((g) => g.abilityID === id)), row = document.createElement('tr');
    const label = groups.find((g) => g?.name && !g.name.startsWith('Spell '))?.name || groups.find(Boolean)?.name || 'Spell ' + id;
    const title = textNode('th', label); title.setAttribute('scope', 'row'); row.append(title);
    for (let index = 0; index < 2; index++) {
      const cell = document.createElement('td'), group = groups[index];
      if (!group) cell.append(textNode('span', 'Unavailable', 'execution-unavailable'));
      else {
        cell.append(textNode('span', (details[index].complete ? '' : 'Observed ') + group.hits + ' hits / ticks', 'execution-value'));
        cell.append(textNode('span', executionReviewObserved(group.total, details[index].complete, 0) + ' health damage', 'execution-value-detail'));
        if (group.times.length) cell.append(textNode('span', group.times.slice(0, 8).map(executionReviewTime).join(' · ')
          + (group.times.length > 8 ? ' · +' + (group.times.length - 8) + ' more' : ''), 'execution-value-detail'));
      }
      row.append(cell);
    }
    const cell = document.createElement('td'), durations = ['a', 'b'].map((key) => executionReviewDuration(D, execution, key));
    if (pair.comparable && details.every((d) => d?.complete) && groups.every(Boolean)
      && durations.every((value) => executionReviewNumber(value) && value > 0)) {
      const delta = groups[0].total / durations[0] - groups[1].total / durations[1];
      cell.append(textNode('span', delta === 0 ? 'Same' : executionReviewFormat(Math.abs(delta)) + (delta < 0 ? ' less' : ' more'), 'execution-value'));
    } else cell.append(textNode('span', 'Not comparable', 'execution-unavailable'));
    row.append(cell); body.append(row);
  }
  table.append(body);
  const scroll = document.createElement('div'); scroll.className = 'execution-mechanics-table-scroll';
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Avoidable mechanic comparison'); scroll.setAttribute('tabindex', '0');
  scroll.append(table); section.append(scroll);
  section.append(textNode('p', 'Hits / ticks do not count distinct mistakes; several may belong to one brief mechanic event.', 'execution-table-note'));
  if (['a', 'b'].some((key) => execution[key]?.components?.avoidance?.measurements?.incidentListComplete === false))
    section.append(textNode('p', 'Timestamps show a sample of incidents; totals above cover the full collected log.', 'execution-table-note'));
  breakdown.append(section);
}
function executionReviewBoard(evaluation) {
  const components = evaluation?.components || {}, avoidance = components.avoidance, survival = components.survival;
  const facts = [];
  if (executionReviewComplete(avoidance) && executionReviewNumber(avoidance.measurements?.hits)) {
    facts.push(avoidance.measurements.hits > 0 ? 'Mechanics: Needs review' : 'Mechanics: No reviewed hits');
    facts.push(avoidance.measurements.hits + ' reviewed avoidable hits / ticks');
  }
  else facts.push(avoidance?.state === 'unsupported' ? 'Avoidable mechanics not reviewed' : 'Avoidance evidence incomplete');
  if (executionReviewComplete(survival) && executionReviewNumber(survival.measurements?.deathCount)) facts.push(survival.measurements.deathCount + (survival.measurements.deathCount === 1 ? ' death' : ' deaths'));
  return '<div class="execution-review-facts"><span>' + facts.map((fact) => esc(fact)).join(' · ') + '</span></div>';
}
function renderExecutionStatistics(D, execution) {
  const breakdown = $('executionBreakdown'), pair = executionReviewPair(execution);
  breakdown.className = 'execution-comparison';
  const selectedAvoidance = execution.a?.components?.avoidance;
  const reviewedHits = executionReviewComplete(selectedAvoidance) ? selectedAvoidance.measurements?.hits : null;
  $('executionSummary').textContent = (executionReviewNumber(reviewedHits)
    ? reviewedHits > 0 ? 'Mechanics: Needs review. ' : 'Mechanics: No reviewed hits. ' : '') + executionReviewGap(pair);
  const summary = document.createElement('section'); summary.className = 'execution-assessment';
  summary.append(textNode('h3', 'Mechanics and survival'));
  const selectedDetails = executionReviewAbilities(selectedAvoidance), referenceDetails = executionReviewAbilities(execution.b?.components?.avoidance);
  const main = selectedDetails?.complete ? selectedDetails.groups.filter((group) => group.hits > 0).sort((a, b) => b.total - a.total)[0] : null;
  if (main) {
    const reference = referenceDetails?.groups.find((group) => group.abilityID === main.abilityID);
    summary.append(textNode('p', 'Main reviewed issue: ' + main.name + ' — ' + main.hits + ' hits / ticks, '
      + executionReviewFormat(main.total, 0) + ' health damage'
      + (reference && pair.comparable && selectedDetails.complete && referenceDetails.complete ? '; reference ' + reference.hits + ' hits / ticks.' : '.')));
  }
  const deaths = ['a', 'b'].map((key) => execution[key]?.components?.survival);
  if (deaths.every(executionReviewComplete)) summary.append(textNode('p', [D.a?.name || 'Selected player', D.b?.name || 'Reference player']
    .map((name, index) => name + ': ' + deaths[index].measurements.deathCount + ' deaths'
      + (executionReviewNumber(deaths[index].measurements.firstDeathSec) ? ', first at ' + fmtT(deaths[index].measurements.firstDeathSec) : ''))
    .join(' · ')));
  const defenses = ['a', 'b'].map((key) => execution[key]?.components?.defenses);
  const defensiveNames = [...new Set(defenses.flatMap((component) => Array.isArray(component?.measurements?.abilities)
    ? component.measurements.abilities.filter((ability) => typeof ability?.name === 'string').map((ability) => ability.name) : []))];
  const uses = defensiveNames.slice(0, 4).map((name) => name + ': ' + defenses.map((component) => {
    const ability = component?.measurements?.abilities?.find((item) => item.name === name);
    return executionReviewComplete(component) && executionReviewNumber(ability?.boundedUses) ? ability.boundedUses : 'unavailable';
  }).join(' vs '));
  if (uses.length) summary.append(textNode('p', 'Personal defensive casts: ' + uses.join(' · ') + '. Use does not prove effective protection.'));
  summary.append(textNode('p', 'Reviewed mechanics are a subset. Assignments, interrupts, dispels and raid utility remain unverified; damage output is excluded from this assessment.', 'execution-table-note'));
  const sources = document.createElement('p'); sources.className = 'execution-table-note';
  for (const key of ['a', 'b']) {
    const side = D[key];
    if (typeof side?.code !== 'string' || !/^[A-Za-z0-9]{16}$/.test(side.code) || !Number.isSafeInteger(side.fightID) || side.fightID < 1) continue;
    if (sources.children.length) sources.append(textNode('span', ' · '));
    const link = textNode('a', 'Open ' + (side.name || (key === 'a' ? 'selected' : 'reference')) + ' source log');
    link.href = 'https://www.warcraftlogs.com/reports/' + encodeURIComponent(side.code) + '#fight=' + side.fightID
      + '&type=damage-taken' + (Number.isSafeInteger(side.actorID) && side.actorID > 0 ? '&source=' + side.actorID : '');
    link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
  }
  summary.append(sources);
  breakdown.append(summary);
  const notes = {
    avoidance: ['Avoidable damage', 'Reviewed mechanics only · totals, hits / ticks and fight-length-adjusted rate'],
    survival: ['Survival', 'Deaths and first-death timing · cause and responsibility unverified'],
    defenses: ['Personal defensives', 'Reviewed completed casts · use does not prove mitigation or good timing'],
    incoming: ['Incoming damage', 'Context only · assignments and unavoidable damage affect this'],
    output: ['Damage output', 'Context only · excluded from non-damage assessment'],
    healing: ['Healing', 'Context only · demand and useful benefit are unverified'],
  };
  const table = document.createElement('table'); table.className = 'execution-table';
  table.append(textNode('caption', 'Non-damage evidence compared with the other log'));
  const head = document.createElement('thead'), heading = document.createElement('tr');
  for (const label of ['Category', D.a?.name || 'Selected player', D.b?.name || 'Reference player']) {
    const cell = textNode('th', label); cell.setAttribute('scope', 'col'); heading.append(cell);
  }
  head.append(heading); table.append(head);
  const body = document.createElement('tbody'); let incomplete = false;
  for (const name of ['avoidance', 'survival', 'defenses', 'incoming', 'output', 'healing']) {
    const row = document.createElement('tr'); row.dataset.category = name;
    const [label, note] = notes[name], title = textNode('th', label); title.setAttribute('scope', 'row');
    title.append(textNode('span', note, 'execution-category-note')); row.append(title);
    for (const key of ['a', 'b']) {
      const data = execution[key]?.components?.[name] || {};
      if (data.state === 'incomplete') incomplete = true;
      row.append(executionReviewCell(name, data));
    }
    body.append(row);
  }
  table.append(body); breakdown.append(table);
  renderExecutionReviewAbilities(D, execution, breakdown, pair);
  if (incomplete) breakdown.append(textNode('p', 'Incomplete observations are lower bounds. Missing data is not zero and does not support a favorable comparison.', 'execution-table-note'));
  if (pair.comparable) breakdown.append(textNode('p', 'Rates adjust for fight length. Phase exposure, assignments and mitigation can still explain differences.', 'execution-table-note'));
  if (!isExecutionV3()) breakdown.append(textNode('p', executionV3Coverage(execution), 'execution-table-note'));
}

function replaceExactlyOnce(html, before, after, label) {
  const index = html.indexOf(before);
  if (index < 0 || html.indexOf(before, index + before.length) >= 0) throw new Error('CastMirror execution review anchor changed or ambiguous: ' + label);
  return html.slice(0, index) + after + html.slice(index + before.length);
}
export function adaptExecutionReview(html) {
  const start = html.indexOf('function renderExecutionStatistics(D, execution) {');
  const end = html.indexOf('\nfunction renderExecutionEvidence(D, zoomTo) {', start);
  if (start < 0 || end < start || html.indexOf('function renderExecutionStatistics(D, execution) {', start + 1) >= 0)
    throw new Error('CastMirror execution review anchor changed or ambiguous: statistics renderer');
  const helpers = [executionReviewNumber, executionReviewComplete, executionReviewCanonical, executionReviewPair,
    executionReviewFormat, executionReviewObserved, executionReviewTime, executionReviewGap, executionReviewCell, executionReviewAbilities,
    executionReviewDuration, renderExecutionReviewAbilities, executionReviewBoard, renderExecutionStatistics];
  const emitted = '// BEGIN CASTMIRROR EXECUTION REVIEW\n' + emitHelpers(import.meta.url, helpers.map((fn) => fn.name)) + '\n// END CASTMIRROR EXECUTION REVIEW\n';
  let out = html.slice(0, start) + emitted + html.slice(end);
  const rating = "(comparableRating ? '<div class=\"execution-rating\"><b>' + statisticsNumber(D.execution[key].score, 1) + '<span> / 100</span></b><span>Execution rating</span></div>' : '')";
  out = replaceExactlyOnce(out, rating, 'executionReviewBoard(D.execution[key])', 'statistical board composite');
  out = replaceExactlyOnce(out, "statistics ? 'Combat statistics' : 'Execution evidence'", "statistics ? 'Non-damage execution' : 'Execution evidence'", 'panel title');
  const css = `\n  .execution-assessment { margin: 12px 0 20px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  .execution-assessment h3 { margin: 0 0 8px; } .execution-assessment p { margin: 7px 0; }
  .execution-review-facts { margin-top: 12px; color: var(--text); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
  .execution-comparison { min-width: 0; } .execution-comparison > .execution-table { width: 100%; table-layout: fixed; }
  .execution-comparison .execution-table th, .execution-comparison .execution-table td { overflow-wrap: anywhere; }
  .execution-mechanics { min-width: 0; margin-top: 20px; } .execution-mechanics h3 { margin-bottom: 10px; }
  .execution-mechanics-table-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; }
  .execution-mechanics-table-scroll .execution-table { min-width: 540px; width: 100%; }
  .execution-mechanics-table-scroll:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  @media (max-width: 520px) { .execution-assessment { padding: 12px; } .execution-comparison > .execution-table th, .execution-comparison > .execution-table td { padding: 8px 6px; } }\n`;
  out = replaceExactlyOnce(out, '</style>', css + '</style>', 'responsive execution review styles');
  return out;
}
