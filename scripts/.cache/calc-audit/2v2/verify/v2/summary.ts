// Track V2: a summary of v2/run.ts reports (merged), by owner: the failing ids with their status, reason and first mismatches.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/summary.ts <report name prefix> [--full]
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve("scripts/.cache/calc-audit/2v2/verify/v2/reports");
const prefix = process.argv[2] ?? "app-1";
const full = process.argv.includes("--full");
type Row = { id: string; owner: string; status: string; reason?: string; endReason?: string; mismatches: string[]; error?: string };
const rows: Row[] = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const bad = rows.filter((r) => r.mismatches.length || r.error || r.status === "app error" || r.status === "oracle failed");
const by = new Map<string, Row[]>();
for (const r of bad) (by.get(r.owner) ?? by.set(r.owner, []).get(r.owner)!).push(r);
console.log(`${rows.length - bad.length}/${rows.length} agree`);
for (const [owner, list] of [...by].sort()) {
  console.log(`\n## ${owner}: ${list.length}`);
  for (const r of list.sort((a, b) => a.id.localeCompare(b.id))) {
    const what = r.error ? `ERROR ${r.error}` : r.status === "not-estimated" ? `not estimated: ${r.reason}` : r.status === "issues" ? "issues" : `${r.status}${r.endReason ? ` [end: ${r.endReason}]` : ""}`;
    console.log(`- ${r.id}: ${what}${r.mismatches.length ? ` — ${r.mismatches.length} mismatches` : ""}`);
    for (const m of r.mismatches.slice(0, full ? 50 : 3)) console.log(`    ${m.slice(0, 300)}`);
  }
}
