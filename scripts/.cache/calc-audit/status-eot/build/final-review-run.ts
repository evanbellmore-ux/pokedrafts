// FINAL: run the review regression candidates (2v2/verify/cases-review.ts REVIEW_ALL) in the pinned oracle (sim-dfs.ts) and
// the app (app-turn.ts), compare with compare.ts compareCase, one shard of N.
// Usage (repo root): npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/final-review-run.ts <shard> <N>
//   [--reuse] [--only=ID,ID] [--skip=ID,ID] [--out=dir]
// Oracle results go to build/final-results/<id>.json (or --out); one line per case on stdout.
import fs from "node:fs";
import path from "node:path";
import { oracle as runOracle } from "../../2v2/verify/sim-dfs";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import type { OracleResult } from "../../2v2/verify/case-types";
import { REVIEW_ALL } from "../../2v2/verify/cases-review";

const args = process.argv.slice(2);
const [shard = "0", n = "1"] = args.filter((a) => !a.startsWith("--"));
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = opt("only")?.split(",");
const skip = new Set(opt("skip")?.split(",") ?? []);
const reuse = args.includes("--reuse");
const OUT = path.resolve(opt("out") ?? "scripts/.cache/calc-audit/status-eot/build/final-results");
fs.mkdirSync(OUT, { recursive: true });

const seen = new Set<string>();
for (const c of REVIEW_ALL) {
  if (seen.has(c.id)) throw new Error(`duplicate id ${c.id}`);
  seen.add(c.id);
}

(async () => {
  const mine = REVIEW_ALL.filter((c, i) => (only ? only.includes(c.id) : i % Number(n) === Number(shard)) && !skip.has(c.id));
  for (const c of mine) {
    const t0 = Date.now();
    let o: OracleResult | null = null;
    let oerr = "";
    const file = path.join(OUT, `${c.id}.json`);
    if (!c.notEstimated) {
      if (reuse && fs.existsSync(file)) o = JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult;
      else {
        try { o = runOracle(c); fs.writeFileSync(file, JSON.stringify(o, null, 1)); } catch (e) { oerr = (e as Error).message.split("\n")[0]; }
      }
    }
    const app = await appTurn(c);
    if (app.error) { console.log(`${c.id}: APP ERROR ${app.error.split("\n")[0]}`); continue; }
    const runtime = await runtimeFor(c);
    const mm = compareCase(c, o, app.result, (id) => runtime.movesById.get(id)?.category === "Status", app.outcomes);
    const r = app.result!;
    const why = r.status === "not-estimated" ? ` (${r.reason})` : r.status === "issues" ? ` ${JSON.stringify(r.issues)}` : r.endOfTurn?.status === "not-estimated" ? ` [eot: ${r.endOfTurn.reason}]` : "";
    const e2 = app.outcomes ? ` E2 ${app.outcomes.status}${app.outcomes.status === "not-estimated" ? ` (${app.outcomes.reason})` : app.outcomes.status === "ready" ? ` ${app.outcomes.endOfTurn}` : ""}` : "";
    console.log(`${c.id}: ${r.status}${why}${e2}${oerr ? ` ORACLE FAILED ${oerr}` : ""} ${mm.length ? `${mm.length} mismatches` : "match"} (${Date.now() - t0} ms)`);
    for (const m of mm) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`.slice(0, 600));
  }
})();
