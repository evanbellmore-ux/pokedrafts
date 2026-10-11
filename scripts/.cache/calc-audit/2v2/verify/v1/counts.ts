// Track V1: wave 1a case counts per file and family, and per owner, with the latest report's agreement.
import fs from "node:fs";
import { WAVE1A_CASES, ownerOf } from "../cases-wave1a";
const report = process.argv[2] ? (JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as { id: string; mismatches: string[]; error?: string }[]) : [];
const ok = new Set(report.filter((r) => !r.mismatches.length && !r.error).map((r) => r.id));
const fam = new Map<string, [number, number]>(), own = new Map<string, [number, number]>();
for (const c of WAVE1A_CASES) {
  const f = c.id.replace(/-(sv|swsh|usum|champions)$/, "").replace(/-?\d+[a-z]?$/, "").replace(/\d+[a-z]?$/, "");
  const o = ownerOf(c.id);
  for (const [m, k] of [[fam, f], [own, o]] as const) { const v = m.get(k) ?? [0, 0]; v[0]++; if (ok.has(c.id)) v[1]++; m.set(k, v); }
}
console.log(`wave 1a cases: ${WAVE1A_CASES.length}, agreeing ${WAVE1A_CASES.filter((c) => ok.has(c.id)).length}`);
console.log("by family:", [...fam].map(([k, [n, a]]) => `${k} ${a}/${n}`).join(", "));
console.log("by owner:", [...own].map(([k, [n, a]]) => `${k} ${a}/${n}`).join(", "));
