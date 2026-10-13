// Inspect build inventories, never the contents of traced credentials or reports.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slash = (value) => value.replaceAll('\\', '/');
const required = [
  '.next/server/app/api/castmirror/compare/route.js.nft.json',
  '.next/server/app/api/castmirror/execution/v3/route.js.nft.json',
];

export function validateTrace(trace, tracePath, root = ROOT) {
  if (trace?.version !== 1 || !Array.isArray(trace.files) || trace.files.some((file) => typeof file !== 'string' || !file || file.includes('\0'))) {
    throw new Error('Invalid build trace inventory');
  }
  const castmirror = slash(path.relative(root, tracePath)).includes('/api/castmirror/');
  for (const file of trace.files) {
    const relative = slash(path.relative(root, path.resolve(path.dirname(tracePath), file)));
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Traced file outside the project');
    if (/(^|\/)(?:\.env[^/]*|\.git|\.claude)(?:\/|$)/i.test(relative) ||
        /^\.cache\/execution(?:-|\/)/i.test(relative) ||
        /(^|\/)(?:tokens?|credentials)\.(?:json|env|txt)$/i.test(relative)) {
      throw new Error('Private file in build trace inventory');
    }
    // All CastMirror runtime modules are bundled. No source tree or local evidence is needed.
    if (castmirror && !['.next', 'node_modules'].includes(relative.split('/')[0])) {
      throw new Error('Unreviewed CastMirror trace root: ' + relative.split('/')[0]);
    }
  }
  return trace.files.length;
}

export async function auditTraces(root = ROOT) {
  const traces = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.nft.json')) traces.push(file);
    }
  }
  await walk(path.join(root, '.next'));
  const paths = new Set(traces.map((file) => slash(path.relative(root, file))));
  if (!required.every((file) => paths.has(file))) throw new Error('Required CastMirror build traces missing');
  const castmirror = [];
  for (const file of traces) {
    const count = validateTrace(JSON.parse(await readFile(file, 'utf8')), file, root);
    const relative = slash(path.relative(root, file));
    if (relative.includes('/api/castmirror/')) castmirror.push({ trace: relative, files: count });
  }
  return { traces: traces.length, castmirror };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-castmirror-traces.mjs');
    console.log(JSON.stringify(await auditTraces(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
