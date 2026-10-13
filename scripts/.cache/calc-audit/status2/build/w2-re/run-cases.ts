// Runs R-E's extra cases (cases-re.ts): pinned Showdown's exhaustive oracle (verify/sim-dfs.ts oracle, nothing written) and
// the app (verify/app-turn.ts appTurn) compared with verify/compare.ts compareCase. Args: id prefixes (default: all); -v.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w2-re/run-cases.ts [ids...] [-v]
import { appTurn, runtimeFor } from "../../../2v2/verify/app-turn";
import { compareCase, loadRuntimes } from "../../../2v2/verify/compare";
import { oracle } from "../../../2v2/verify/sim-dfs";
import { RE_CASES } from "./cases-re";
import { show } from "./kit";

(async () => {
  await loadRuntimes();
  const args = process.argv.slice(2);
  const verbose = args.includes("-v");
  const ids = args.filter((a) => !a.startsWith("-"));
  let bad = 0, total = 0;
  for (const c of RE_CASES) {
    if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
    total++;
    let r;
    try { r = oracle(c); } catch (error) { bad++; console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n")[0]}`); continue; }
    const app = await appTurn(c);
    if (app.error || !app.result) { bad++; console.log(`${c.id}: APP ERROR ${app.error?.split("\n").slice(0, 3).join(" | ")}`); continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, r, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result.status;
    const end = app.result.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (mismatches.length) bad++;
    console.log(`${c.id}: ${status}${end}: ${mismatches.length ? `${mismatches.length} mismatches` : "match"}${r.warnings.length ? ` (oracle warnings: ${r.warnings.join(" | ")})` : ""}`);
    for (const m of mismatches.slice(0, verbose ? 40 : 8)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    if (verbose) console.log(show(app.result).replace(/^/gm, "   | "));
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
