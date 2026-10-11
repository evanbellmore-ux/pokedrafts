// Track D: stored cases whose expected reason D's model removes (no stored oracle result), re-run in the oracle with the
// expectation taken off (into status2/build/w1a-d-results/stored-<id>.json) and compared with the app.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-d-rerun.ts <id>... [--oracle]
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import { oracle } from "../../2v2/verify/sim-dfs";
import type { OracleResult } from "../../2v2/verify/case-types";

const DIR = path.resolve("scripts/.cache/calc-audit/status2/build/w1a-d-results");
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const rerun = args.includes("--oracle");
(async () => {
  let bad = 0, total = 0;
  for (const stored of CASES) {
    if (!ids.includes(stored.id)) continue;
    total++;
    const c = { ...stored };
    delete c.notEstimated; delete c.endNotEstimated;
    const file = path.join(DIR, `stored-${c.id}.json`);
    let result: OracleResult;
    if (!rerun && fs.existsSync(file)) result = JSON.parse(fs.readFileSync(file, "utf8"));
    else {
      try { result = oracle(c); fs.writeFileSync(file, JSON.stringify(result, null, 1)); }
      catch (error) { bad++; console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n")[0]}`); continue; }
    }
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n")[0]}`); continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, result, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (mismatches.length) {
      bad++;
      console.log(`${c.id}: ${status}${eot}: ${mismatches.length} mismatches${result.warnings.length ? ` (oracle warnings: ${result.warnings.join(" | ")})` : ""}`);
      for (const m of mismatches.slice(0, 20)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else console.log(`${c.id}: ${status}${eot}: match`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
