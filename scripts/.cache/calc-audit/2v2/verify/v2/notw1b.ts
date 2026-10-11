// Track V2: the failing rows of a v2/run.ts report set that are not wave 1b cases (stored and wave 1a cases).
import fs from "node:fs";
import path from "node:path";
import { WAVE1B_CASES } from "../cases-wave1b";
const dir = path.resolve("scripts/.cache/calc-audit/2v2/verify/v2/reports");
const prefix = process.argv[2];
const w1b = new Set(WAVE1B_CASES.map((c) => c.id));
type Row = { id: string; owner: string; status: string; reason?: string; endReason?: string; mismatches: string[]; error?: string };
const rows: Row[] = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const bad = rows.filter((r) => !w1b.has(r.id) && (r.mismatches.length || r.error));
console.log(`${rows.filter((r) => !w1b.has(r.id)).length} cases before wave 1b, ${bad.length} failing`);
for (const r of bad) {
  console.log(`- ${r.id} [${r.owner}]: ${r.error ? `ERROR ${r.error}` : r.status === "not-estimated" ? `not estimated: ${r.reason}` : `${r.status}${r.endReason ? ` [end: ${r.endReason}]` : ""}`}`);
  for (const m of r.mismatches.slice(0, 3)) console.log(`    ${m.slice(0, 260)}`);
}
