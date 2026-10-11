// Track D (status2 wave 1a): run w1a-d-cases.ts on both sides and compare (as step1-run.ts, but the oracle results go to
// status2/build/w1a-d-results/, not verify/results, which V1 owns).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-d-run.ts [<id or prefix>...] [--oracle] [--quiet]
// --oracle: (re)run the pinned Showdown oracle (sim-dfs.ts oracle()) first; without it a stored w1a-d-results/<id>.json is
// read (and the oracle runs when there is none).
import fs from "node:fs";
import path from "node:path";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import { oracle } from "../../2v2/verify/sim-dfs";
import type { OracleResult } from "../../2v2/verify/case-types";
import { W1A_D_CASES } from "./w1a-d-cases";

const DIR = path.resolve("scripts/.cache/calc-audit/status2/build/w1a-d-results");
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const runOracle = args.includes("--oracle"), quiet = args.includes("--quiet"), show = args.includes("--show");
fs.mkdirSync(DIR, { recursive: true });
(async () => {
  let bad = 0, total = 0;
  for (const c of W1A_D_CASES) {
    if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
    total++;
    const file = path.join(DIR, `${c.id}.json`);
    let result: OracleResult | null = null;
    if (!c.notEstimated) {
      if (!runOracle && fs.existsSync(file)) result = JSON.parse(fs.readFileSync(file, "utf8"));
      else {
        const t0 = Date.now();
        try {
          result = oracle(c);
          fs.writeFileSync(file, JSON.stringify(result, null, 1));
          if (!quiet) console.log(`${c.id}: oracle ${Date.now() - t0} ms${result.warnings.length ? ` warnings: ${result.warnings.join(" | ")}` : ""}`);
        } catch (error) {
          bad++;
          console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n").slice(0, 3).join(" | ")}`);
          continue;
        }
      }
    }
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 6).join(" | ")}`); continue; }
    if (app.preflight.length) console.log(`${c.id}: preflight ${app.preflight.join(" | ")}`);
    if (app.outcomesError) console.log(`${c.id}: E2 ERROR ${app.outcomesError.split("\n")[0]}`);
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
      for (const m of mismatches.slice(0, 25)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else if (!quiet) console.log(`${c.id}: ${status}${eot}: match`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
