// A separate, reviewed native source pin. Ordinary generation never reads a
// sibling checkout or downloads code, credentials, reports, or cache evidence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { adaptNativeExecutionEvidence } from './castmirror-execution-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor/castmirror');
const MANIFEST = path.join(VENDOR, 'native-manifest.json');
// Updated only after the native changes have passed their standalone suite.
export const NATIVE_REVISION = '3373a335ea435d2885091c0c51046e42640f7fc6';
export const NATIVE_ADAPTER = 'castmirror-native-postgres-5';
const PREVIOUS_ADAPTER = 'castmirror-native-postgres-4';
export const NATIVE_ADAPTATIONS = Object.freeze(['unused-filesystem-tracing-ignore', 'reviewed-raid-contact-evidence']);
// Hosted callers use Postgres, never these legacy local-directory branches.
// Annotations affect bundler tracing only; the reviewed runtime behavior stays intact.
const tracingAnchors = Object.freeze({
  'execution/live-budget.mjs': [
    {
      from: '.map((p) => canonical(path.resolve(p)));',
      to: '.map((p) => canonical(path.resolve(/*turbopackIgnore: true*/ p)));',
    },
    {
      from: "const directoryFD = fs.openSync(root, 'r');",
      to: "const directoryFD = fs.openSync(/*turbopackIgnore: true*/ root, 'r');",
    },
  ],
  'execution/live.mjs': [
    {
      from: 'this.directory = directory ? path.resolve(directory) : undefined;',
      to: 'this.directory = directory ? path.resolve(/*turbopackIgnore: true*/ directory) : undefined;',
    },
  ],
});
export const NATIVE_FILES = Object.freeze([
  'execution/compact-statistics.mjs', 'execution/contracts.mjs',
  'execution/diagnostics.mjs', 'execution/effects.mjs', 'execution/live-budget.mjs',
  'execution/live.mjs', 'execution/maintenance.mjs', 'execution/opportunities.mjs',
  'execution/source.mjs', 'execution/statistics.mjs',
  'execution/statistics-v3-rules.json', 'wcl-client/wcl.ts',
]);
const normalize = (text) => text.replace(/\r\n/g, '\n');
const digest = (text) => createHash('sha256').update(normalize(text)).digest('hex');
const destination = (name) => name.replace(/\.ts$/, '.mjs');

export function generateNative(name, source) {
  if (!NATIVE_FILES.includes(name)) throw new Error('Unreviewed native source path');
  if (name.endsWith('.json')) { JSON.parse(source); return normalize(source); }
  let text = normalize(source);
  if (name.endsWith('.ts')) {
    text = ts.transpileModule(text, { compilerOptions: {
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
    }, reportDiagnostics: true }).outputText;
  }
  // The native transport is the same module for diagnostics and actual sends.
  text = text.replace(/(['"])\.\.\/wcl-client\/wcl\.ts\1/g, "$1../wcl-client/wcl.mjs$1");
  const parsed = ts.createSourceFile(destination(name), text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error('Invalid native JavaScript: ' + name);
  for (const statement of parsed.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
    const imported = statement.moduleSpecifier.text;
    if (imported.startsWith('node:')) continue;
    if (!imported.startsWith('.')) throw new Error('Unreviewed native dependency: ' + name);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(destination(name)), imported));
    if (!NATIVE_FILES.some((file) => destination(file) === resolved)) throw new Error('Native dependency outside the reviewed inventory: ' + imported);
  }
  if (/\b(?:createServer|ExecutionRegistry|process\.env|setInterval)\b/.test(text)) {
    throw new Error('Native snapshot contains an unrelated server or worker lifecycle: ' + name);
  }
  const anchors = tracingAnchors[name];
  if (anchors) {
    for (const anchor of anchors) {
      if (text.split(anchor.from).length !== 2) throw new Error('Native hosted tracing anchor missing or ambiguous: ' + name);
      text = text.replace(anchor.from, anchor.to);
    }
    const output = ts.createSourceFile(destination(name), text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    if (output.parseDiagnostics.length) throw new Error('Invalid adapted native JavaScript: ' + name);
  }
  text = adaptNativeExecutionEvidence(name, text);
  const adapted = ts.createSourceFile(destination(name), text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (adapted.parseDiagnostics.length) throw new Error('Invalid adapted native JavaScript: ' + name);
  return normalize(text);
}

export function syncNative({ check = false, source = null } = {}) {
  if (check && source) throw new Error('Check mode cannot import source');
  let manifest;
  const snapshots = {};
  if (source) {
    const clean = execFileSync('git', ['-C', source, 'diff', '--name-only', NATIVE_REVISION, '--', ...NATIVE_FILES], { encoding: 'utf8' }).trim();
    if (clean) throw new Error('Native source checkout differs from its reviewed commit');
    for (const name of NATIVE_FILES) snapshots[name] = normalize(execFileSync('git', ['-C', source, 'show', `${NATIVE_REVISION}:${name}`], {
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }));
    manifest = { schemaVersion: 1, repository: 'https://github.com/evanbellmore-ux/cast-mirror', revision: NATIVE_REVISION,
      adapter: NATIVE_ADAPTER, adaptations: [...NATIVE_ADAPTATIONS], sourceFiles: {}, generatedFiles: {} };
    for (const [name, text] of Object.entries(snapshots)) manifest.sourceFiles[name] = digest(text);
  } else {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const current = manifest.adapter === NATIVE_ADAPTER && JSON.stringify(manifest.adaptations) === JSON.stringify(NATIVE_ADAPTATIONS);
    const previous = !check && manifest.adapter === PREVIOUS_ADAPTER
      && JSON.stringify(manifest.adaptations) === JSON.stringify(['unused-filesystem-tracing-ignore', 'reviewed-lost-explorers-contact-evidence']);
    if (manifest.schemaVersion !== 1 || manifest.repository !== 'https://github.com/evanbellmore-ux/cast-mirror' ||
        manifest.revision !== NATIVE_REVISION || !current && !previous ||
        JSON.stringify(Object.keys(manifest.sourceFiles).sort()) !== JSON.stringify([...NATIVE_FILES].sort())) {
      throw new Error('Native provenance or inventory changed without review');
    }
    for (const name of NATIVE_FILES) {
      const text = normalize(readFileSync(path.join(VENDOR, 'native-upstream', name), 'utf8'));
      if (digest(text) !== manifest.sourceFiles[name]) throw new Error('Native source checksum drift: ' + name);
      snapshots[name] = text;
    }
  }
  const generated = Object.fromEntries(Object.entries(snapshots).map(([name, text]) => [destination(name), generateNative(name, text)]));
  const hashes = Object.fromEntries(Object.entries(generated).map(([name, text]) => [name, digest(text)]));
  if (check) {
    if (JSON.stringify(hashes) !== JSON.stringify(manifest.generatedFiles)) throw new Error('Native generated hashes drifted');
    for (const [name, text] of Object.entries(generated)) {
      const file = path.join(VENDOR, 'native', name);
      if (!existsSync(file) || normalize(readFileSync(file, 'utf8')) !== text) throw new Error('Native generated output drifted: ' + name);
    }
  } else {
    if (source) for (const [name, text] of Object.entries(snapshots)) {
      const file = path.join(VENDOR, 'native-upstream', name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text);
    }
    for (const [name, text] of Object.entries(generated)) {
      const file = path.join(VENDOR, 'native', name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text);
    }
    manifest.adapter = NATIVE_ADAPTER;
    manifest.adaptations = [...NATIVE_ADAPTATIONS];
    manifest.generatedFiles = hashes;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(`CastMirror native ${check ? 'parity verified' : 'generated'}: ${NATIVE_REVISION.slice(0, 7)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) syncNative();
    else if (args.length === 1 && args[0] === '--check') syncNative({ check: true });
    else if (args.length === 2 && args[0] === '--import-source') syncNative({ source: path.resolve(args[1]) });
    else throw new Error('Usage: sync-castmirror-native.mjs [--check | --import-source <local-checkout>]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
