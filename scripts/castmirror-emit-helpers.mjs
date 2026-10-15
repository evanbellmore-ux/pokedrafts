import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Emit original source text, not Function#toString: test loaders may transform
// functions in memory, which must never change generated release bytes.
export function emitHelpers(moduleURL, names) {
  const source = readFileSync(new URL(moduleURL), 'utf8').replace(/\r\n/g, '\n');
  const parsed = ts.createSourceFile('portable.mjs', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const functions = new Map();
  for (const node of parsed.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      if (functions.has(node.name.text)) throw new Error('Duplicate portable helper');
      functions.set(node.name.text, node.getText(parsed).replace(/^export /, ''));
    }
  }
  return names.map((name) => {
    if (!functions.has(name)) throw new Error('Missing portable helper: ' + name);
    return functions.get(name);
  }).join('\n');
}
