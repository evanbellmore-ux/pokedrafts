// Track D: stored cases (verify/cases.ts) against V1's stored oracle results (verify/results/<id>.json), app side only.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-d-stored.ts <id or prefix>... [--show]
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import type { OracleResult } from "../../2v2/verify/case-types";

const DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const show = args.includes("--show");
(async () => {
  let bad = 0, total = 0;
  for (const c of CASES) {
    if (!ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
    total++;
    const file = path.join(DIR, `${c.id}.json`);
    const result: OracleResult | null = !c.notEstimated && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (!c.notEstimated && !result) { console.log(`${c.id}: no stored result`); bad++; continue; }
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 4).join(" | ")}`); continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, result, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (show && app.result?.status === "ready") {
      for (const step of app.result.steps) console.log(`   step ${step.slot} ${step.moveId}: facts ${JSON.stringify(step.facts)} hits ${JSON.stringify(step.hits.map((h) => [h.slot, h.kind, h.min, h.max, h.facts]))}`);
    }
    if (mismatches.length) {
      bad++;
      console.log(`${c.id}: ${status}${eot}: ${mismatches.length} mismatches`);
      for (const m of mismatches.slice(0, 20)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else console.log(`${c.id}: ${status}${eot}: match`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
