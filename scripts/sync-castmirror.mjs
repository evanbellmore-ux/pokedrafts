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
const REVISION = '862458f24ac1859b569813f57d104732117ef67c';
const ADAPTER = 'castmirror-vercel-v1';
const REPOSITORY = 'https://github.com/evanbellmore-ux/cast-mirror';
const DECLARATIONS = [
  'classes', 'ensureClasses', 'PI_SPELL', 'fightHasPI', 'HERO_SIG', 'heroOf',
  'heroCandCache', 'heroOfCandidate', 'heroBlocks', 'specFromFight', 'sideHead',
  'sideActor', 'fetchFightSide', 'recentKillFor', 'buildComparison',
];
const PATCHES = [
  'request-scoped-class-and-hero-memoization',
  'realm-aware-pi-and-hero-actor-resolution',
  'ambiguous-spec-summary-fails-closed',
  'hosted-api-base-and-source-markers',
  'supported-region-picker',
  'frozen-execution-capabilities-and-handler-guards',
  'honest-unsupported-execution-projection',
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

export function generateCore(snapshot) {
  let core = patch(snapshot, 'let classes = null;',
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
  const out = `// GENERATED by scripts/sync-castmirror.mjs; do not edit directly.\n// CastMirror ${REVISION}; hosted adapter ${ADAPTER}.\n// Client-keyed WeakMaps only memoize metadata during an invocation.\n\n` + core;
  validateCore(out);
  return out;
}

export function generatePage(snapshot) {
  let html = patch(snapshot, '<title>Cast Mirror</title>',
    `<title>Cast Mirror</title>\n<meta name="castmirror-source" content="${REVISION}">\n<meta name="castmirror-adapter" content="${ADAPTER}">\n<!-- GENERATED by scripts/sync-castmirror.mjs; edit the generator, not this file. -->`, 'source metadata');
  html = patch(html, '  <b>Execution</b> adds a reviewed, holistic reference when the required evidence is available.</p>',
    `  <b>Execution</b> is shown but unavailable: real encounter benchmarks are not yet score-ready.</p>
  <p class="hint" id="hostedReadiness" style="margin-top:10px">Overall and Boss damage references are available after you select a kill.
  Execution references and builds are disabled on this hosted site; no top-ten-per-boss benchmark set has been completed.</p>
  <p class="hint" id="castmirrorSource">CastMirror source ${REVISION.slice(0, 7)} · hosted adapter ${ADAPTER}</p>`, 'hosted readiness');
  html = patch(html, '<option>tw</option><option>cn</option>', '<option>tw</option>', 'supported regions');
  html = patch(html, '  .execution-status button { margin-top: 8px; padding: 6px 12px; font-size: 12px; }',
    '  .execution-status button { margin-top: 8px; padding: 6px 12px; font-size: 12px; }\n  .execution-status button:disabled { cursor: not-allowed; }', 'disabled build affordance');
  html = patch(html, '<script>\nconst $ = (id) => document.getElementById(id);',
    `<script>
window.MIRROR_API_BASE = '/api/castmirror';
window.MIRROR_SOURCE_VERSION = '${REVISION}';
window.MIRROR_EXECUTION_CAPABILITIES = Object.freeze({ build: false, reference: false });
</script>
<script>
const $ = (id) => document.getElementById(id);`, 'hosted configuration');
  html = patch(html, 'function referenceChoices() {',
    `// Both the release and service must explicitly support an Execution action.
function executionAllowed(capability) {
  return window.MIRROR_EXECUTION_CAPABILITIES?.[capability] === true &&
    comparison?.executionStatus?.capabilities?.[capability] === true;
}
function hostedExecutionStatus() {
  if (executionAllowed('reference') || executionAllowed('build')) return comparison.executionStatus;
  const status = comparison?.executionStatus?.state === 'unsupported' ? comparison.executionStatus : {};
  return { ...status, state: 'unsupported', capabilities: { build: false, reference: false },
    reason: status.reason || 'Execution references and builds are unavailable: encounter catalogs are not score-ready and this hosted site has no durable benchmark worker.',
    revision: null, scope: null, coverage: null, job: null, updatedAt: null };
}
function referenceChoices() {`, 'capability helpers');
  html = patch(html,
    "    ...(comparison.executionStatus || comparison.executionReference ? [{ mode: 'execution', label: 'Execution', available: !!comparison.executionReference, value: comparison.executionReference }] : []),",
    "    { mode: 'execution', label: 'Execution', available: executionAllowed('reference') && !!comparison.executionReference, value: executionAllowed('reference') ? comparison.executionReference : null },", 'Execution choice');
  html = patch(html, "function renderComparison() {\n  const choice = referenceChoices().find((c) => c.mode === referenceMode);",
    `function renderComparison() {
  if (!referenceChoices().find((c) => c.mode === referenceMode)?.available) {
    referenceMode = 'overall'; restoreExecution = false;
  }
  const choice = referenceChoices().find((c) => c.mode === referenceMode);`, 'unavailable projection');
  html = patch(html, '    if (data.executionReference && restoreExecution) {',
    "    if (executionAllowed('reference') && data.executionReference && restoreExecution) {", 'hero reload guard');
  html = patch(html, 'function renderExecutionStatus() {\n  const status = comparison.executionStatus;',
    'function renderExecutionStatus() {\n  const status = hostedExecutionStatus();', 'unsupported status projection');
  html = patch(html, "  $('executionBuild').disabled = ['building', 'queued'].includes(status.state) || !lastCtx?.zone;",
    "  $('executionBuild').disabled = !executionAllowed('build') || ['building', 'queued'].includes(status.state) || !lastCtx?.zone;", 'build button guard');
  html = patch(html, "  $('executionBuild').textContent = status.state === 'paused' ? 'Resume Execution build' : 'Build / refresh Execution references';",
    "  $('executionBuild').textContent = !executionAllowed('build') ? 'Execution builds unavailable on hosted site' : status.state === 'paused' ? 'Resume Execution build' : 'Build / refresh Execution references';", 'disabled build label');
  html = patch(html, 'async function watchExecution(generation, ctx, attempt = 0, fetchStatus = false) {',
    "async function watchExecution(generation, ctx, attempt = 0, fetchStatus = false) {\n  if (!executionAllowed('reference')) return;", 'poll and hydration guard');
  html = patch(html, 'async function buildExecution() {',
    "async function buildExecution() {\n  if (!executionAllowed('build')) return;", 'refresh handler guard');
  html = patch(html, "  const execution = D.rankingMetric === 'execution' ? D.execution : null;",
    "  const execution = executionAllowed('reference') && D.rankingMetric === 'execution' ? D.execution : null;", 'evidence guard');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 2) throw new Error('Unexpected inline-script layout in generated page');
  for (const [index, script] of scripts.entries()) new Script(script[1], { filename: `castmirror-inline-${index}.js` });
  return html;
}

function readSnapshot(manifest) {
  if (manifest.schemaVersion !== 1 || manifest.upstream?.repository !== REPOSITORY ||
      manifest.upstream?.revision !== REVISION || manifest.adapterVersion !== ADAPTER ||
      JSON.stringify(manifest.declarations) !== JSON.stringify(DECLARATIONS) ||
      JSON.stringify(manifest.patches) !== JSON.stringify(PATCHES)) {
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
  const snapshot = readSnapshot(manifest);
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
    manifest.generatedFiles = hashes;
    writeFileSync(MANIFEST, json(manifest));
  }
  console.log(`CastMirror ${check ? 'parity verified' : 'generated'}: ${REVISION.slice(0, 7)} / ${ADAPTER}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
