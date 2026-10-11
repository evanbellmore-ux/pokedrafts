// CENSUS 1 citation check: every "PS/<file>:<a>[-<b>]" in census-moves-data.ts is resolved against the pinned source:
// for data/*.ts files, the top-level entry (move, item, ability, condition) each cited line belongs to; for sim/*.ts the
// enclosing method. Prints one line per citation; "MISMATCH" where a data/moves.ts citation falls outside the record's
// own move and outside any move the record names.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-cites.ts
import { readFileSync } from "node:fs";
import { RECORDS } from "./census-moves-data";

const PS = "node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353";
const cache = new Map<string, string[]>();
const lines = (file: string) => { if (!cache.has(file)) cache.set(file, readFileSync(`${PS}/${file}`, "utf8").split(/\r?\n/)); return cache.get(file)!; };

/** The data-file entry (one tab, "id: {") or the sim method (one tab, "name(") that line n (1-based) is in. */
function owner(file: string, n: number): string {
  const text = lines(file);
  if (n < 1 || n > text.length) return `(line ${n} beyond ${text.length})`;
  const entry = file.startsWith("data/") ? /^\t([a-z0-9]+): \{/ : /^\t(?:async |static |get |private |public )?([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\(/;
  for (let i = n - 1; i >= 0; i--) {
    const m = entry.exec(text[i]);
    if (m) return m[1];
  }
  return "(top)";
}

let bad = 0;
for (const record of RECORDS) {
  const text = Object.values(record).filter((v) => typeof v === "string").join(" ");
  for (const m of text.matchAll(/PS\/((?:data|sim)\/[A-Za-z0-9_/.-]+\.ts):(\d+)(?:-(\d+))?/g)) {
    const [, file, a, b] = m;
    const from = Number(a), to = Number(b ?? a);
    const owners = [...new Set([owner(file, from), owner(file, to)])];
    const named = owners.every((o) => o === record.id || text.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(o));
    const flag = file === "data/moves.ts" && !named ? "MISMATCH" : "ok";
    if (flag !== "ok" || to < from) bad++;
    console.log(`${flag.padEnd(8)} ${record.id.padEnd(14)} ${file}:${from}${b ? `-${to}` : ""} -> ${owners.join(" .. ")}${to < from ? " (range reversed)" : ""}`);
  }
}
console.log(`${bad} to check`);
