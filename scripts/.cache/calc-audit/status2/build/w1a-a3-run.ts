// Track A3 (wave 1a): run Track A3's own verification cases (w1a-a3-cases.ts) on both sides and compare them, without
// touching Track V1's verify/results or app-results. The oracle side is pinned Showdown c23d2e94 (verify/sim-dfs.ts oracle()),
// stored in status2/build/w1a-a3-results/<id>.json; the report is verify/compare.ts's compareCase with E2's outcomes.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-a3-run.ts [<id or prefix> ...] [--oracle] [--quiet] [--facts]
// --oracle: run the oracle first (else the stored result is read); --facts: print the app's step and hit facts; --v1: V1's cases.
import fs from "node:fs";
import path from "node:path";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, loadRuntimes } from "../../2v2/verify/compare";
import { oracle } from "../../2v2/verify/sim-dfs";
import type { OracleResult } from "../../2v2/verify/case-types";
import { A3_CASES } from "./w1a-a3-cases";
import { CASES } from "../../2v2/verify/cases";

const OUT = path.resolve("scripts/.cache/calc-audit/status2/build/w1a-a3-results");
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const runOracle = args.includes("--oracle"), quiet = args.includes("--quiet"), facts = args.includes("--facts");
// --v1: Track V1's stored cases (verify/cases.ts) instead of A3's own, the oracle still run into w1a-a3-results/ (never verify/results).
// --drop-reason: a stored case whose not-estimated reason this build removes, run in full (the changed cases of SPEC2 §7.1).
const drop = args.includes("--drop-reason");
const LIST = (args.includes("--v1") ? CASES : A3_CASES).map((c) => (drop ? (({ notEstimated: _n, endNotEstimated: _e, ...rest }) => rest)(c) as typeof c : c));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await loadRuntimes();
  let bad = 0, total = 0;
  for (const c of LIST) {
    if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
    total++;
    const file = path.join(OUT, `${c.id}.json`);
    let o: OracleResult | null = null;
    if (!c.notEstimated) {
      if (runOracle || !fs.existsSync(file)) {
        try {
          o = oracle(c);
          fs.writeFileSync(file, JSON.stringify(o, null, 1));
          if (o.warnings.length && !quiet) console.log(`${c.id}: oracle warnings: ${o.warnings.join(" | ")}`);
        } catch (error) {
          bad++;
          console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n").slice(0, 3).join(" | ")}`);
          continue;
        }
      } else o = JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult;
    }
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 6).join(" | ")}`); continue; }
    if (app.preflight.length) console.log(`${c.id}: preflight ${app.preflight.join(" | ")}`);
    if (app.outcomesError) console.log(`${c.id}: E2 ERROR ${app.outcomesError.split("\n")[0]}`);
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, o, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status === "issues" ? `issues ${JSON.stringify(app.result)}` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (mismatches.length) {
      bad++;
      console.log(`${c.id}: ${status}${eot}: ${mismatches.length} mismatches`);
      for (const m of mismatches.slice(0, 25)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else if (!quiet) console.log(`${c.id}: ${status}${eot}: match`);
    if (facts && app.result?.status === "ready") {
      for (const step of app.result.steps) {
        console.log(`   step ${step.slot} ${step.moveId}: ${step.facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`).join(" / ")}${step.skipped.length ? ` skipped: ${step.skipped.map((f) => f.text).join(" / ")}` : ""}`);
        for (const hit of step.hits) console.log(`      hit ${hit.slot} ${hit.kind}: ${hit.facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`).join(" / ")}`);
      }
      console.log(`   turn facts: ${app.result.facts.join(" / ")}`);
    }
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
