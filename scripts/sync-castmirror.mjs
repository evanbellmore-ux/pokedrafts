// Generate the hosted port from a reviewed, pinned source snapshot. No network
// access or standalone-server imports are used by generation or ordinary builds.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor/castmirror');
const MANIFEST = path.join(VENDOR, 'manifest.json');
const REVISION = 'af7d034354abcb4cc4d52719989900a0e0b1b455';
const ADAPTER = 'castmirror-vercel-v4';
const PREVIOUS_ADAPTER = 'castmirror-vercel-v3';
const REPOSITORY = 'https://github.com/evanbellmore-ux/cast-mirror';
const DECLARATIONS = [
  'classes', 'ensureClasses', 'PI_SPELL', 'fightHasPI', 'HERO_SIG', 'heroOf',
  'heroCandCache', 'heroOfCandidate', 'heroBlocks', 'specFromFight', 'sideHead',
  'sameRealm', 'sideActor', 'fetchFightSide', 'recentKillFor', 'buildComparison',
];
const PREVIOUS_PATCHES = [
  'request-scoped-class-and-hero-memoization',
  'realm-aware-pi-and-hero-actor-resolution',
  'ambiguous-spec-summary-fails-closed',
  'hosted-throughput-without-native-scope-acquisition',
  'hosted-actor-ambiguity-without-roster-narrowing',
  'hosted-api-base-and-source-markers',
  'supported-region-picker',
  'frozen-execution-capabilities-and-handler-guards',
  'honest-unsupported-execution-projection',
  'gated-durable-native-reference-capability',
  'compact-native-response-with-pinned-throughput-streams',
];
const PATCHES = [...PREVIOUS_PATCHES,
  'current-first-immediate-previous-patch-throughput',
  'escaped-per-side-ranking-patch-labels',
];
const normalize = (text) => text.replace(/\r\n/g, '\n');
const digest = (text) => createHash('sha256').update(normalize(text)).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function patch(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`CastMirror patch anchor changed or ambiguous: ${label}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

// These portable helpers are emitted with the core, not imported at runtime.
// Partition IDs are opaque. Only unambiguous numeric patch names establish order.
export function canonicalRankingPatch(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = /^(?:Patch\s+)?(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:\.(0|[1-9]\d{0,3}))?$/i.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).filter((part) => part !== undefined).map(Number);
  if (parts.length === 3 && parts[2] === 0) parts.pop();
  return parts.join('.');
}
function compareRankingPatches(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}
function rankingRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function rankingID(value) { return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647; }
export function previousRankingPartition(data, encounter) {
  if (!rankingID(encounter) || !rankingRecord(data) || data.error != null || data.errors != null || !rankingRecord(data.worldData)
    || data.worldData.error != null || data.worldData.errors != null) return null;
  const found = data.worldData.encounter, zone = found?.zone;
  if (!rankingRecord(found) || found.error != null || found.errors != null || found.id !== encounter
    || !rankingRecord(zone) || zone.error != null || zone.errors != null || !rankingID(zone.id)
    || !Array.isArray(zone.partitions) || zone.partitions.length < 2 || zone.partitions.length > 100) return null;
  const entries = [], ids = new Set(), versions = new Set();
  for (const entry of zone.partitions) {
    const version = canonicalRankingPatch(entry?.name);
    if (!rankingRecord(entry) || !rankingID(entry.id) || typeof entry.default !== 'boolean' || version === null
      || ids.has(entry.id) || versions.has(version)) return null;
    ids.add(entry.id); versions.add(version); entries.push({ id: entry.id, version, current: entry.default });
  }
  const defaults = entries.filter((entry) => entry.current);
  if (defaults.length !== 1) return null;
  const current = defaults[0];
  if (entries.some((entry) => entry !== current && compareRankingPatches(entry.version, current.version) >= 0)) return null;
  const previous = entries.filter((entry) => entry !== current)
    .sort((a, b) => compareRankingPatches(b.version, a.version))[0];
  return { partition: previous.id, label: { current: current.version, selected: previous.version, fallback: true } };
}
async function readPreviousRankingPartition(c, encounter) {
  const data = await c.query(`query($enc: Int!) {
    worldData { encounter(id: $enc) { id zone { id partitions { id name default } } } }
  }`, { enc: encounter });
  return previousRankingPartition(data, encounter);
}
function characterRankingPool(value) {
  if (!rankingRecord(value) || value.error != null || value.errors != null || !Array.isArray(value.ranks)
    || value.ranks.length > 10_000 || value.hasMorePages !== undefined && typeof value.hasMorePages !== 'boolean') return null;
  if (!value.ranks.every((rank) => rankingRecord(rank) && rankingRecord(rank.report)
    && typeof rank.report.code === 'string' && /^[A-Za-z0-9]{16}$/.test(rank.report.code) && rankingID(rank.report.fightID)
    && typeof rank.amount === 'number' && Number.isFinite(rank.amount) && rank.amount >= 0
    && typeof rank.spec === 'string' && rank.spec.trim().length > 0 && rank.spec.length <= 64)) return null;
  return { rows: value.ranks, exhausted: value.hasMorePages !== true };
}

/** Select complete top-level declarations, not fragile line ranges. */
export function extractDeclarations(text, names = DECLARATIONS) {
  const source = ts.createSourceFile('server.mjs', text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error('Upstream comparison source is not valid JavaScript');
  const selected = new Map();
  for (const statement of source.statements) {
    let name;
    if (ts.isFunctionDeclaration(statement)) name = statement.name?.text;
    else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const binding = statement.declarationList.declarations[0].name;
      if (ts.isIdentifier(binding)) name = binding.text;
    }
    if (!names.includes(name)) continue;
    if (selected.has(name)) throw new Error(`Duplicate upstream declaration: ${name}`);
    selected.set(name, statement.getFullText(source).trim());
  }
  for (const name of names) if (!selected.has(name)) throw new Error(`Missing upstream declaration: ${name}`);
  return names.map((name) => selected.get(name)).join('\n\n') + '\n';
}

/** Compiler name resolution prevents a newly introduced server dependency from
 * silently leaking into the extracted module. Only portable JS globals exist. */
export function validateCore(text) {
  const filename = path.join(ROOT, 'castmirror-generated-name-check.mjs');
  const options = {
    allowJs: true, checkJs: true, noEmit: true, strict: false,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    lib: ['lib.es2023.d.ts'], types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => path.resolve(name) === filename
    ? ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
    : originalGetSourceFile(name, ...args);
  const program = ts.createProgram([filename], options, host);
  const source = program.getSourceFile(filename);
  if (!source) throw new Error('Generated comparison module was not loaded for validation');
  const syntax = program.getSyntacticDiagnostics(source);
  if (syntax.length) throw new Error('Generated comparison module is not valid JavaScript: ' + syntax
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; '));
  if (source.statements.some((node) => ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node))) {
    throw new Error('Generated comparison module must not import the standalone lifecycle');
  }
  const unresolved = program.getSemanticDiagnostics(source)
    .filter((diagnostic) => [2304, 2552, 2503, 2663, 18004].includes(diagnostic.code));
  if (unresolved.length) {
    throw new Error('Unresolved extracted dependencies: ' + unresolved
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; '));
  }
  if (/\b(?:process|require|fetch|setTimeout|setInterval|ExecutionRegistry|createServer|apiCompare)\b/.test(text)) {
    throw new Error('Generated core contains a forbidden transport or server-lifecycle dependency');
  }
}

// Read helper declarations from this reviewed adapter's source, not Function
// stringification: test loaders and Windows line endings must not alter output.
function rankingHelpers(helpers) {
  return extractDeclarations(normalize(readFileSync(fileURLToPath(import.meta.url), 'utf8')), helpers.map((helper) => helper.name))
    .replace(/^export (?=(?:async )?function )/gm, '');
}

function adaptRankingPatchFallback(core) {
  const helpers = rankingHelpers([canonicalRankingPatch, compareRankingPatches, rankingRecord, rankingID, previousRankingPartition,
    readPreviousRankingPartition, characterRankingPool]);
  core = patch(core, 'export async function buildComparison(c, params) {',
    helpers + '\n\nexport async function buildComparison(c, params) {', 'portable previous-patch helpers');
  core = patch(core, '  const reg = region.toLowerCase();',
    `  const reg = region.toLowerCase();
  let previousPatch;
  const readPreviousPatch = () => previousPatch ??= readPreviousRankingPartition(c, encounter);
  let aRankingPatch = null;`, 'request-local previous-patch metadata');
  core = patch(core, '  const ranks = ch.encounterRankings?.ranks ?? [];',
    `  let ranks = ch.encounterRankings?.ranks ?? [];
  const currentPool = cd.error == null && cd.errors == null && cd.characterData.error == null && cd.characterData.errors == null
    && ch.error == null && ch.errors == null ? characterRankingPool(ch.encounterRankings) : null;
  if (!pin && rankingID(ch.classID) && currentPool?.exhausted && currentPool.rows.length === 0) {
    const previous = await readPreviousPatch();
    if (previous) {
      const data = await c.query(
        \`query($name: String!, $slug: String!, $region: String!, $enc: Int!, $diff: Int!, $metric: CharacterRankingMetricType!, $partition: Int!) {
          characterData { character(name: $name, serverSlug: $slug, serverRegion: $region) {
            classID encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric, partition: $partition)
          } }
        }\`, { name, slug, region: reg, enc: encounter, diff: difficulty, metric, partition: previous.partition });
      const selected = data?.characterData?.character, selectedPool = characterRankingPool(selected?.encounterRankings);
      if (!rankingRecord(data) || data.error != null || data.errors != null || !rankingRecord(data.characterData)
        || data.characterData.error != null || data.characterData.errors != null || !rankingRecord(selected)
        || selected.error != null || selected.errors != null || selected.classID !== ch.classID
        || !selectedPool?.exhausted) throw new Error('Incomplete previous-patch character rankings');
      ranks = selectedPool.rows;
      if (ranks.length) aRankingPatch = previous.label;
    }
  }`, 'empty unpinned character previous-patch selection');
  core = patch(core,
    `  const referenceFor = async (rankingMetric) => {
    let excluded = !aHasPI;
    let encName = null;
    // pages 1-3: deeper pages let hero clustering see the off-meta tree
    const fetchRankings = async (xb) => {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const wr = await c.query(
          \`query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $page: Int!, $xb: ExternalBuffRankFilter) {
             worldData { encounter(id: $enc) {
               name
               characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: $page, includeCombatantInfo: true, externalBuffs: $xb)
             } }
           }\`, { enc: encounter, cls: className, spec, diff: difficulty, metric: rankingMetric, page, xb });
        const encData = wr.worldData.encounter;
        encName = encData?.name ?? encName;
        const got = encData?.characterRankings?.rankings ?? [];
        out.push(...got);
        if (got.length < 100 || !encData?.characterRankings?.hasMorePages) break;
      }
      return out;
    };
    let rankings = await fetchRankings(excluded ? 'Exclude' : 'Any');
    if (!rankings.length && excluded) {
      excluded = false; // no externals-free parses ranked at all — fall back
      rankings = await fetchRankings('Any');
    }
    // Anonymous uploads can't be actor-matched. Damage #1 may be A's own parse.
    const usable = rankings.filter((r) =>
      r.name && r.name.toLowerCase() !== 'anonymous' && r.report?.code && !r.report.code.startsWith('a:') &&
      (metric === 'dps' || !(r.name.toLowerCase() === name.trim().toLowerCase() && r.report.code === best.report?.code)));
`,
    `  const referenceFor = async (rankingMetric) => {
    let encName = null, rankingPatch = null;
    // Each partition retains the existing three-page cap and its own PI policy.
    const fetchRankings = async (xb, selectedPartition) => {
      const out = [];
      let exhausted = false;
      for (let page = 1; page <= 3; page++) {
        const document = selectedPartition === null
          ? \`query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $page: Int!, $xb: ExternalBuffRankFilter) {
             worldData { encounter(id: $enc) {
               name
               characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: $page, includeCombatantInfo: true, externalBuffs: $xb)
             } }
           }\`
          : \`query($enc: Int!, $cls: String!, $spec: String!, $diff: Int!, $metric: CharacterRankingMetricType!, $page: Int!, $xb: ExternalBuffRankFilter, $partition: Int!) {
             worldData { encounter(id: $enc) {
               name
               characterRankings(className: $cls, specName: $spec, difficulty: $diff, metric: $metric, page: $page, includeCombatantInfo: true, externalBuffs: $xb, partition: $partition)
             } }
           }\`;
        const variables = { enc: encounter, cls: className, spec, diff: difficulty, metric: rankingMetric, page, xb };
        if (selectedPartition !== null) variables.partition = selectedPartition;
        const wr = await c.query(document, variables);
        const encData = wr?.worldData?.encounter, result = encData?.characterRankings;
        if (!rankingRecord(wr) || wr.error != null || wr.errors != null || !rankingRecord(wr.worldData)
          || wr.worldData.error != null || wr.worldData.errors != null || !rankingRecord(encData)
          || encData.error != null || encData.errors != null || typeof encData.name !== 'string' || !encData.name.trim()
          || !rankingRecord(result) || result.error != null || result.errors != null || !Array.isArray(result.rankings)
          || result.rankings.length > 100 || !result.rankings.every(rankingRecord)
          || typeof result.hasMorePages !== 'boolean') throw new Error('Incomplete world ranking search');
        encName = encData?.name ?? encName;
        const got = result.rankings;
        out.push(...got);
        if (!result.hasMorePages) { exhausted = true; break; }
        if (got.length < 100) break; // A short unexhausted response cannot authorize patch fallback.
      }
      return { rows: out, exhausted };
    };
    // Anonymous uploads can't be actor-matched. Damage #1 may be A's own parse.
    const eligible = (r) =>
      r.name && r.name.toLowerCase() !== 'anonymous' && r.report?.code && !r.report.code.startsWith('a:') &&
      (metric === 'dps' || !(r.name.toLowerCase() === name.trim().toLowerCase() && r.report.code === best.report?.code));
    const searchPool = async (selectedPartition = null) => {
      let excluded = !aHasPI;
      let result = await fetchRankings(excluded ? 'Exclude' : 'Any', selectedPartition);
      let exhausted = result.exhausted;
      let usable = result.rows.filter(eligible);
      if (!usable.length && excluded && exhausted) {
        excluded = false;
        result = await fetchRankings('Any', selectedPartition);
        exhausted = exhausted && result.exhausted;
        usable = result.rows.filter(eligible);
      }
      return { usable, excluded, exhausted };
    };
    let { usable, excluded, exhausted } = await searchPool();
    if (!usable.length && exhausted) {
      const previous = await readPreviousPatch();
      if (previous) {
        const selected = await searchPool(previous.partition);
        usable = selected.usable; excluded = selected.excluded;
        if (usable.length) rankingPatch = previous.label;
      }
    }
`, 'exhausted eligible world previous-patch selection');
  core = patch(core,
    '      b: { server: top.server?.name ?? \'?\', amount: Math.round(top.amount), code: top.report.code, fightID: top.report.fightID, rankPercent: 100, ...theirs },',
    '      b: { server: top.server?.name ?? \'?\', amount: Math.round(top.amount), code: top.report.code, fightID: top.report.fightID, rankPercent: 100, ...theirs, ...(rankingPatch ? { rankingPatch: { ...rankingPatch } } : {}) },', 'reference previous-patch label');
  core = patch(core,
    '    a: { server, amount: Math.round(best.amount), code: best.report.code, fightID: best.report.fightID, rankPercent: Math.round(best.rankPercent ?? 0), ...mine },',
    '    a: { server, amount: Math.round(best.amount), code: best.report.code, fightID: best.report.fightID, rankPercent: Math.round(best.rankPercent ?? 0), ...mine, ...(aRankingPatch ? { rankingPatch: { ...aRankingPatch } } : {}) },', 'player previous-patch label');
  return core;
}

export function generateCore(snapshot) {
  // Keep the existing hosted throughput queries. Native scope acquisition and
  // its provenance belong to the durable standalone service, not this adapter.
  let core = patch(snapshot,
    `  let executionScope = null;
  try {
    const scope = await resolveScope(c, { zone: params.zone, encounter, difficulty });
    executionScope = Object.fromEntries(['zone', 'encounter', 'difficulty', 'size', 'partition', 'patch'].map((k) => [k, scope[k]]));
  } catch { /* Throughput still works; unverified Execution partition stays unknown. */ }
  const partition = executionScope?.partition ?? null;
`, '', 'native scope acquisition isolation');
  core = patch(core,
    '$metric: CharacterRankingMetricType!, $partition: Int)',
    '$metric: CharacterRankingMetricType!)', 'hosted character ranking variables');
  core = patch(core,
    'encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric, partition: $partition)',
    'encounterRankings(encounterID: $enc, difficulty: $diff, metric: $metric)', 'hosted character ranking query');
  core = patch(core,
    '{ name, slug, region: reg, enc: encounter, diff: difficulty, metric, partition }',
    '{ name, slug, region: reg, enc: encounter, diff: difficulty, metric }', 'hosted character ranking values');
  core = patch(core,
    '$xb: ExternalBuffRankFilter, $partition: Int)',
    '$xb: ExternalBuffRankFilter)', 'hosted world ranking variables');
  core = patch(core,
    'externalBuffs: $xb, partition: $partition)',
    'externalBuffs: $xb)', 'hosted world ranking query');
  core = patch(core,
    '{ enc: encounter, cls: className, spec, diff: difficulty, metric: rankingMetric, page, xb, partition }',
    '{ enc: encounter, cls: className, spec, diff: difficulty, metric: rankingMetric, page, xb }', 'hosted world ranking values');
  core = patch(core,
    `  Object.defineProperty(out, 'executionRankingContext', { value: {
    currentPartition: executionScope !== null && ranks.some((r) => r.report?.code === best.report.code && r.report?.fightID === best.report.fightID),
    scope: executionScope,
  }, enumerable: false });
`, '', 'native scope provenance isolation');
  // Preserve hosted fail-closed ambiguity checks across the complete actor set.
  core = patch(core,
    '  const players = rep?.fights?.find((f) => f.id === fightID)?.friendlyPlayers;\n',
    '', 'hosted actor ambiguity roster binding');
  core = patch(core,
    '    (!Array.isArray(players) || players.includes(a.id)) &&\n',
    '', 'hosted actor ambiguity roster narrowing');
  core = patch(core, 'let classes = null;',
    'const classesByClient = new WeakMap();', 'classes cache');
  core = patch(core,
    `async function ensureClasses(c) {
  if (classes) return classes;
  const g = await c.query(\`query { gameData { classes { id name } } }\`);
  classes = new Map(g.gameData.classes.map((x) => [x.id, x.name.replace(/\\s+/g, '')]));
  return classes;
}`,
    `async function ensureClasses(c) {
  let pending = classesByClient.get(c);
  if (!pending) {
    pending = c.query(\`query { gameData { classes { id name } } }\`)
      .then((g) => new Map(g.gameData.classes.map((x) => [x.id, x.name.replace(/\\s+/g, '')])));
    classesByClient.set(c, pending);
  }
  return pending;
}`, 'request-scoped class reader');
  core = patch(core, '  await ensureClasses(c);',
    '  const classes = await ensureClasses(c);', 'comparison class binding');
  core = patch(core, 'const heroCandCache = new Map();',
    'const heroCachesByClient = new WeakMap();', 'hero cache');
  core = patch(core, 'async function heroOfCandidate(c, cand, metric) {',
    `async function heroOfCandidate(c, cand, metric) {
  let heroCandCache = heroCachesByClient.get(c);
  if (!heroCandCache) {
    heroCandCache = new Map();
    heroCachesByClient.set(c, heroCandCache);
  }`, 'request-scoped hero reader');
  core = patch(core, 'async function fightHasPI(c, code, fightID, playerName) {',
    'async function fightHasPI(c, code, fightID, who) {', 'PI actor identity parameter');
  core = patch(core, 'masterData { actors(type: "Player") { id name } }\n         events(',
    'masterData { actors(type: "Player") { id name server } }\n         events(', 'PI actor realm');
  core = patch(core,
    `  const wanted = playerName.trim().toLowerCase();
  const actor = rep?.masterData.actors.find((a) => a.name?.toLowerCase() === wanted);
  if (!actor) return false;`,
    '  const actor = sideActor(rep, fightID, who);', 'PI actor resolution');
  core = patch(core,
    '  const key = JSON.stringify([cand.report.code, cand.report.fightID, cand.name.trim().toLowerCase(), metric]);',
    '  const key = JSON.stringify([cand.report.code, cand.report.fightID, cand.name.trim().toLowerCase(), slugify(cand.server?.name ?? ""), metric]);', 'hero realm cache key');
  core = patch(core,
    '`query($code: String!) { reportData { report(code: $code) { masterData { actors(type: "Player") { id name } } } } }`,',
    '`query($code: String!) { reportData { report(code: $code) { masterData { actors(type: "Player") { id name server } } } } }`,', 'hero actor realm');
  core = patch(core,
    '  const actor = head.reportData.report?.masterData.actors.find((a) => a.name?.toLowerCase() === cand.name.toLowerCase());',
    '  const actor = sideActor(head.reportData.report, cand.report.fightID, { name: cand.name, server: cand.server?.name });', 'hero actor resolution');
  core = patch(core,
    `  const me = (sum.reportData.report?.table?.data?.composition ?? [])
    .find((p) => p.name?.toLowerCase() === name.trim().toLowerCase());
  return me?.specs?.[0]?.spec;`,
    `  const matches = (sum.reportData.report?.table?.data?.composition ?? [])
    .filter((p) => p.name?.toLowerCase() === name.trim().toLowerCase());
  if (matches.length !== 1) throw new Error('Spec identity missing or ambiguous on the selected fight');
  return matches[0].specs?.[0]?.spec;`, 'ambiguous spec summary');
  core = patch(core,
    "  const sideKey = (code, fid, who) => JSON.stringify([code, fid, typeof who === 'string' ? who.trim().toLowerCase() : who.actorID ?? who.name, metric]);",
    `  const sideKey = (code, fid, who) => {
    const identity = typeof who === 'string' ? { name: who } : who;
    return JSON.stringify([code, fid, identity.actorID ?? null, identity.name?.trim().toLowerCase() ?? null, identity.server ? slugify(identity.server) : null, metric]);
  };`, 'realm-aware invocation identity keys');
  core = patch(core,
    '  const readHero = (cand) => memo(heroChecks, sideKey(cand.report.code, cand.report.fightID, cand.name), () => heroOfCandidate(c, cand, metric));',
    '  const readHero = (cand) => memo(heroChecks, sideKey(cand.report.code, cand.report.fightID, { name: cand.name, server: cand.server?.name }), () => heroOfCandidate(c, cand, metric));', 'hero invocation realm key');
  core = patch(core,
    '  const aHasPI = await readPI(best.report.code, best.report.fightID, name);',
    '  const aHasPI = await readPI(best.report.code, best.report.fightID, { name, server });', 'player PI identity');
  core = patch(core,
    '    const bHasPI = excluded ? false : await readPI(top.report.code, top.report.fightID, top.name);',
    '    const bHasPI = excluded ? false : await readPI(top.report.code, top.report.fightID, { name: top.name, server: top.server?.name });', 'reference PI identity');
  core = adaptRankingPatchFallback(core);
  const out = `// GENERATED by scripts/sync-castmirror.mjs; do not edit directly.\n// CastMirror ${REVISION}; hosted adapter ${ADAPTER}.\n// Client-keyed WeakMaps only memoize metadata during an invocation.\n\n` + core;
  validateCore(out);
  return out;
}

export function generatePage(snapshot) {
  let html = patch(snapshot, '<title>Cast Mirror</title>',
    `<title>Cast Mirror</title>\n<meta name="castmirror-source" content="${REVISION}">\n<meta name="castmirror-adapter" content="${ADAPTER}">\n<!-- GENERATED by scripts/sync-castmirror.mjs; edit the generator, not this file. -->`, 'source metadata');
  html = patch(html,
    `  <b>Execution</b> compares observed combat statistics against a compatible local sample,
  with unavailable measurements and partial coverage shown explicitly.</p>`,
    `  <b>Execution</b> statistics are not connected on this site yet.</p>
  <p class="hint" id="castmirrorSource" hidden>CastMirror source ${REVISION.slice(0, 7)} · hosted adapter ${ADAPTER}</p>`, 'hosted readiness');
  html = patch(html, '<option>tw</option><option>cn</option>', '<option>tw</option>', 'supported regions');
  html = patch(html, '  .execution-status button { margin-top: 8px; padding: 6px 12px; font-size: 12px; }',
    `  .execution-status button { margin-top: 8px; padding: 6px 12px; font-size: 12px; }
  .execution-status button:disabled { cursor: not-allowed; }
  .execution-status.execution-hosted-unavailable { padding: 12px 16px; }
  .execution-hosted-unavailable p { margin: 0; }`, 'disabled build affordance');
  html = patch(html, '<script>\nconst $ = (id) => document.getElementById(id);',
    `<script>
window.MIRROR_API_BASE = '/api/castmirror';
window.MIRROR_SOURCE_VERSION = '${REVISION}';
window.MIRROR_EXECUTION_CAPABILITIES = Object.freeze({ build: false, reference: true });
</script>
<script>
const $ = (id) => document.getElementById(id);`, 'hosted configuration');
  html = patch(html, 'function referenceChoices() {',
    `// Both the release and service must explicitly support an Execution action.
function executionAllowed(capability) {
  const status = comparison?.executionV3Status;
  const pin = comparison?.comparisonID;
  return isExecutionV3() && status?.state === 'available' &&
    status?.available === true && status?.backend === 'native' &&
    status?.analyticalVersion === 'execution-statistical-3' &&
    typeof pin === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(pin) &&
    window.MIRROR_EXECUTION_CAPABILITIES?.[capability] === true &&
    status?.capabilities?.[capability] === true;
}
function hostedExecutionStatus() {
  if (executionAllowed('reference') || executionAllowed('build'))
    return isExecutionV3() ? comparison.executionV3Status : comparison.executionStatus;
  return { state: 'unsupported', capabilities: { build: false, reference: false },
    reason: 'Execution statistics are unavailable here until this site is connected.',
    revision: null, scope: null, coverage: null, job: null, updatedAt: null };
}
function referenceChoices() {`, 'capability helpers');
  html = patch(html,
    `    ...(isExecutionV3() ? [{ mode: 'execution', label: 'Execution', available: comparison.executionV3Status.state === 'available' && !!comparison.comparisonID, value: executionV3Reference }]
      : comparison.executionStatus || comparison.executionReference ? [{ mode: 'execution', label: 'Execution', available: !!comparison.executionReference, value: comparison.executionReference }] : []),`,
    `    { mode: 'execution', label: 'Execution', available: executionAllowed('reference') && (isExecutionV3()
      ? comparison.executionV3Status.state === 'available' && !!comparison.comparisonID : !!comparison.executionReference),
      value: executionAllowed('reference') ? (isExecutionV3() ? executionV3Reference : comparison.executionReference) : null },`, 'Execution choice');
  html = patch(html, "function renderComparison() {\n  const choice = referenceChoices().find((c) => c.mode === referenceMode);",
    `function renderComparison() {
  if (!referenceChoices().find((c) => c.mode === referenceMode)?.available) {
    referenceMode = 'overall'; restoreExecution = false;
  }
  const choice = referenceChoices().find((c) => c.mode === referenceMode);`, 'unavailable projection');
  html = patch(html, '    if (isExecutionV3()) D.a = comparison.a;',
    `    if (isExecutionV3()) {
      D.a = comparison.a;
      if (choice?.value?.rankingMetric === 'execution') D.b = comparison.b;
    }`, 'compact native response retains pinned throughput streams');
  html = patch(html, '    if (!isExecutionV3() && data.executionReference && restoreExecution) {',
    "    if (executionAllowed('reference') && !isExecutionV3() && data.executionReference && restoreExecution) {", 'hero reload guard');
  html = patch(html,
    "  const row = $('executionPiRow'), visible = isExecutionV3() && referenceMode === 'execution';",
    "  const row = $('executionPiRow'), visible = executionAllowed('reference') && isExecutionV3() && referenceMode === 'execution';", 'native PI control guard');
  html = patch(html, 'async function loadExecutionV3() {',
    "async function loadExecutionV3() {\n  if (!executionAllowed('reference')) return;", 'native statistics handler guard');
  html = patch(html, 'function executionV3Current(request, generation, ctx, policy) {\n  return request === executionV3Request',
    "function executionV3Current(request, generation, ctx, policy) {\n  return executionAllowed('reference') && request === executionV3Request", 'native response guard');
  html = patch(html, 'function renderExecutionStatus() {',
    `function renderExecutionStatus() {
  if (!executionAllowed('reference') && !executionAllowed('build')) {
    $('executionStatus').style.display = '';
    $('executionStatus').className = 'execution-status execution-hosted-unavailable';
    $('executionState').style.display = '';
    $('executionState').textContent = hostedExecutionStatus().reason;
    $('executionCoverage').textContent = '';
    $('executionCoverage').style.display = 'none';
    $('executionBuild').disabled = true;
    $('executionBuild').textContent = 'Execution unavailable';
    $('executionBuild').style.display = 'none';
    $('executionBuild').onclick = buildExecution;
    return;
  }
  $('executionCoverage').style.display = '';
  $('executionBuild').style.display = '';`, 'unsupported status projection');
  html = patch(html, "  $('executionBuild').disabled = ['building', 'queued'].includes(status.state) || !lastCtx?.zone;",
    "  $('executionBuild').disabled = !executionAllowed('build') || ['building', 'queued'].includes(status.state) || !lastCtx?.zone;", 'build button guard');
  html = patch(html, 'async function watchExecution(generation, ctx, attempt = 0, fetchStatus = false) {',
    "async function watchExecution(generation, ctx, attempt = 0, fetchStatus = false) {\n  if (!executionAllowed('reference')) return;", 'poll and hydration guard');
  html = patch(html, 'async function buildExecution() {',
    "async function buildExecution() {\n  if (!executionAllowed('build')) return;", 'refresh handler guard');
  html = patch(html, "  const execution = D.rankingMetric === 'execution' ? D.execution : null;",
    "  const execution = executionAllowed('reference') && D.rankingMetric === 'execution' ? D.execution : null;", 'evidence guard');
  html = patch(html, '  const rankingMetric = D.rankingMetric || D.metric;',
    "  const rankingMetric = D.rankingMetric === 'execution' && !executionAllowed('reference') ? D.metric : D.rankingMetric || D.metric;", 'rating guard');
  html = patch(html, 'function render(D) {',
    rankingHelpers([canonicalRankingPatch, compareRankingPatches]) + `
function rankingPatchMarkup(side) {
  const label = side?.rankingPatch;
  if (label?.fallback !== true || canonicalRankingPatch(label.current) !== label.current
    || canonicalRankingPatch(label.selected) !== label.selected || typeof label.current !== 'string'
    || typeof label.selected !== 'string' || compareRankingPatches(label.selected, label.current) >= 0) return '';
  return '<p class="hint ranking-patch">' + esc('Previous patch: ' + label.selected + ' (current ' + label.current + ')') + '</p>';
}
function render(D) {`, 'numeric escaped ranking patch markup');
  html = patch(html,
    "        '<h2>' + esc(s.name) + '</h2><p class=\"execution-player-meta\">' + esc(metadata) + '</p>' +",
    "        '<h2>' + esc(s.name) + '</h2><p class=\"execution-player-meta\">' + esc(metadata) + '</p>' + rankingPatchMarkup(s) +", 'statistical player patch label');
  html = patch(html,
    "    return '<div class=\"card ' + cls + '\"><h2>' + esc(s.name) + ' <span class=\"tag\">' + esc(tag) + '</span></h2>' +",
    "    return '<div class=\"card ' + cls + '\"><h2>' + esc(s.name) + ' <span class=\"tag\">' + esc(tag) + '</span></h2>' + rankingPatchMarkup(s) +", 'throughput per-side patch label');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 2) throw new Error('Unexpected inline-script layout in generated page');
  for (const [index, script] of scripts.entries()) new Script(script[1], { filename: `castmirror-inline-${index}.js` });
  return html;
}

function readSnapshot(manifest, upgrade = false) {
  const current = manifest.adapterVersion === ADAPTER && JSON.stringify(manifest.patches) === JSON.stringify(PATCHES);
  const previous = upgrade && manifest.adapterVersion === PREVIOUS_ADAPTER && JSON.stringify(manifest.patches) === JSON.stringify(PREVIOUS_PATCHES);
  if (manifest.schemaVersion !== 1 || manifest.upstream?.repository !== REPOSITORY ||
      manifest.upstream?.revision !== REVISION || !current && !previous ||
      JSON.stringify(manifest.declarations) !== JSON.stringify(DECLARATIONS)) {
    throw new Error('Unexpected CastMirror provenance; review the source pin and adapter explicitly');
  }
  const expected = ['upstream/index.html', 'upstream/throughput.mjs'];
  if (JSON.stringify(Object.keys(manifest.sourceFiles).sort()) !== JSON.stringify(expected.sort())) {
    throw new Error('Unexpected pinned source file inventory');
  }
  const snapshot = {};
  for (const name of expected) {
    const text = normalize(readFileSync(path.join(VENDOR, name), 'utf8'));
    if (digest(text) !== manifest.sourceFiles[name].sha256) throw new Error(`Pinned source checksum changed: ${name}`);
    snapshot[name] = text;
  }
  return snapshot;
}

function importSource(directory) {
  const gitRead = (name) => normalize(execFileSync('git', ['-C', directory, 'show', `${REVISION}:${name}`], {
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  }));
  const frontend = gitRead('web/index.html');
  const server = gitRead('server.mjs');
  const slug = gitRead('wcl-client/slug.ts');
  const slugJS = ts.transpileModule(slug, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
  const core = extractDeclarations(server) + '\n' + normalize(slugJS);
  // Validate all anchors and dependency resolution before changing any files.
  generateCore(core);
  generatePage(frontend);
  const sourceFiles = {
    'upstream/index.html': { origin: 'web/index.html', sha256: digest(frontend) },
    'upstream/throughput.mjs': { origin: 'server.mjs (allowlisted declarations) + wcl-client/slug.ts', sha256: digest(core) },
  };
  const manifest = {
    schemaVersion: 1, upstream: { repository: REPOSITORY, revision: REVISION }, adapterVersion: ADAPTER,
    declarations: DECLARATIONS, patches: PATCHES, hashFormat: 'sha256, UTF-8 with LF line endings',
    upstreamHashes: { 'web/index.html': digest(frontend), 'server.mjs': digest(server), 'wcl-client/slug.ts': digest(slug) },
    sourceFiles, generatedFiles: {},
  };
  mkdirSync(path.join(VENDOR, 'upstream'), { recursive: true });
  writeFileSync(path.join(VENDOR, 'upstream/index.html'), frontend);
  writeFileSync(path.join(VENDOR, 'upstream/throughput.mjs'), core);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  let check = false, source = null;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true;
    else if (args[index] === '--import-source' && args[index + 1]) source = path.resolve(args[++index]);
    else if (args[index] === '--help') {
      console.log('Usage: node scripts/sync-castmirror.mjs [--check | --import-source <local-castmirror-checkout>]');
      return;
    } else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  if (check && source) throw new Error('--check cannot import or modify the pinned snapshot');
  const manifest = source ? importSource(source) : JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const snapshot = readSnapshot(manifest, !check);
  const generated = {
    'public/castmirror.html': generatePage(snapshot['upstream/index.html']),
    'app/api/castmirror/compare/core.mjs': generateCore(snapshot['upstream/throughput.mjs']),
  };
  const hashes = Object.fromEntries(Object.entries(generated).map(([name, text]) => [name, digest(text)]));
  if (check) {
    if (JSON.stringify(manifest.generatedFiles) !== JSON.stringify(hashes)) throw new Error('Generated checksums drifted; run sync-castmirror.mjs and review the changes');
    for (const [name, text] of Object.entries(generated)) {
      const destination = path.join(ROOT, name);
      if (!existsSync(destination) || normalize(readFileSync(destination, 'utf8')) !== text) {
        throw new Error(`Generated CastMirror file drifted: ${name}`);
      }
    }
  } else {
    for (const [name, text] of Object.entries(generated)) {
      const destination = path.join(ROOT, name);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, text);
    }
    manifest.adapterVersion = ADAPTER;
    manifest.patches = PATCHES;
    manifest.generatedFiles = hashes;
    writeFileSync(MANIFEST, json(manifest));
  }
  console.log(`CastMirror ${check ? 'parity verified' : 'generated'}: ${REVISION.slice(0, 7)} / ${ADAPTER}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
