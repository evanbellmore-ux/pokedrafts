// Step 1 (status2 SPEC2 §8.2, ADDENDUM2 §8.2): run cases of the oracle set on both sides and compare them.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-run.ts <id or prefix>... [--oracle] [--store] [--exact] [--quiet]
// --oracle: run the pinned Showdown oracle (sim-dfs.ts oracle()) and write results/<id>.json first (the cases' oracle side);
//           without it the stored results/<id>.json is read.
// --store:  write the app side to verify/app-results/<id>.json (what compare.ts writes).
// The report is compare.ts's compareCase with E2's outcomes, as step0a-compare.ts runs it.
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { appTurn, APP_RESULTS_DIR, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, readOracle } from "../../2v2/verify/compare";
import { oracle, RESULTS_DIR } from "../../2v2/verify/sim-dfs";

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const runOracle = args.includes("--oracle"), store = args.includes("--store"), exact = args.includes("--exact"), quiet = args.includes("--quiet");
(async () => {
  let bad = 0, total = 0;
  for (const c of CASES) {
    if (ids.length && !ids.some((id) => (exact ? c.id === id : c.id === id || c.id.startsWith(id)))) continue;
    total++;
    if (runOracle && !c.notEstimated) {
      const t0 = Date.now();
      try {
        const r = oracle(c);
        fs.writeFileSync(path.join(RESULTS_DIR, `${c.id}.json`), JSON.stringify(r, null, 1));
        if (!quiet) console.log(`${c.id}: oracle ${Date.now() - t0} ms${r.warnings.length ? ` warnings: ${r.warnings.join(" | ")}` : ""}`);
      } catch (error) {
        bad++;
        console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n")[0]}`);
        continue;
      }
    }
    const app = await appTurn(c);
    if (store) fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 4).join(" | ")}`); continue; }
    if (app.preflight.length) console.log(`${c.id}: preflight ${app.preflight.join(" | ")}`);
    if (app.outcomesError) console.log(`${c.id}: E2 ERROR ${app.outcomesError.split("\n")[0]}`);
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, readOracle(c.id), app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (mismatches.length) {
      bad++;
      console.log(`${c.id}: ${status}${eot}: ${mismatches.length} mismatches`);
      for (const m of mismatches.slice(0, 25)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else if (!quiet) console.log(`${c.id}: ${status}${eot}: match`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
void APP_RESULTS_DIR;
