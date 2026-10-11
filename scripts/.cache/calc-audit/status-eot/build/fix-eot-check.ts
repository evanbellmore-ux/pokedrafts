// status-eot review (eot-training): run review cases in the pinned oracle (sim-dfs.ts) and the app (app-turn.ts), compare
// with Track D's compareCase, and print the after-turn rows and residuals side by side.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/review/eot-training/check.ts [ids...] [--verbose]
import fs from "node:fs";
import path from "node:path";
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import { SLOTS } from "../../2v2/verify/case-types";
import { FIX_CASES as REVIEW_CASES } from "./fix-eot-cases";

const OUT = path.resolve("scripts/.cache/calc-audit/status-eot/build/fix-eot-results/oracle");
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const verbose = args.includes("--verbose");
(async () => {
  let pass = 0, fail = 0;
  for (const c of REVIEW_CASES) {
    if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
    let r: ReturnType<typeof oracle> | null = null;
    let oerr = "";
    try { r = oracle(c); } catch (e) { oerr = (e as Error).stack ?? String(e); }
    const app = await appTurn(c);
    const runtime = await runtimeFor(c);
    fs.writeFileSync(path.join(OUT, `${c.id}.json`), JSON.stringify({ oracle: r, app }, null, 1));
    const mismatches = app.error ? [{ where: "app", field: "error", expected: "", got: app.error.split("\n")[0] }] : compareCase(c, r, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    if (oerr) mismatches.unshift({ where: "oracle", field: "error", expected: "", got: oerr.split("\n").slice(0, 2).join(" ") } as never);
    const res = app.result;
    if (mismatches.length) fail++; else pass++;
    console.log(`${mismatches.length ? "FAIL" : "ok  "} ${c.id} ${c.title}`);
    for (const m of mismatches) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`);
    if (r?.warnings.length) console.log(`   warnings: ${r.warnings.join(" | ")}`);
    if ((verbose || mismatches.length) && res && res.status === "ready") {
      console.log(`   end of turn: ${res.endOfTurn.status}${res.endOfTurn.status === "not-estimated" ? ` (${res.endOfTurn.reason})` : ""}; facts: ${res.facts.join(" | ")}`);
      if (res.endOfTurn.status === "ready") {
        for (const e of res.endOfTurn.residuals) console.log(`     app ${e.slot} ${e.effect}${e.other ? ` (${e.other})` : ""} ${(e.chance * 100).toFixed(3)}% ${e.min}..${e.max} ko ${(e.koChance * 100).toFixed(3)}% ${e.facts.map((f) => `${f.text}@${(f.chance * 100).toFixed(2)}`).join(" ")}`);
        console.log(`     app facts: ${res.endOfTurn.facts.join(" | ")}`);
      }
      for (const e of r?.residuals ?? []) console.log(`     orc ${e.slot} ${e.effect}${e.other ? ` (${e.other})` : ""} ${(e.chance * 100).toFixed(3)}% ${e.min}..${e.max} ko ${(e.koChance * 100).toFixed(3)}% ${Object.entries(e.facts).map(([k, v]) => `${k}@${(v * 100).toFixed(2)}`).join(" ")}`);
      for (const slot of SLOTS) {
        const a = res.endOfTurn.status === "ready" ? res.endOfTurn.hp[slot] : res.hp[slot];
        const o = r?.afterTurn?.[slot];
        if (a) console.log(`     ${slot}: app ${a.low}/${a.average.toFixed(4)}/${a.high} [${a.min}-${a.max}] ko ${(a.koChance * 100).toFixed(4)}% | orc ${o ? `${o.low}/${o.average.toFixed(4)}/${o.high} [${o.min}-${o.max}] ko ${(o.koChance * 100).toFixed(4)}%` : "-"}`);
      }
      if (app.outcomes) console.log(`     E2: ${app.outcomes.status}${app.outcomes.status === "ready" ? ` endOfTurn ${JSON.stringify(app.outcomes.endOfTurn)}, ${app.outcomes.outcomes.length} outcomes` : ""}`);
    } else if (res && res.status !== "ready") console.log(`   app: ${res.status} ${"reason" in res ? res.reason : ""}`);
  }
  console.log(`${pass} pass, ${fail} fail`);
})();
