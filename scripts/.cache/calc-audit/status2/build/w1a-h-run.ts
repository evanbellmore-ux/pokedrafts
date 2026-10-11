// Track H: runs w1a-h-cases.ts in pinned Showdown (sim-dfs.ts oracle, in memory) and in the app (app-turn.ts), and compares
// them with compare.ts's compareCase. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-h-run.ts [H-SI-01 ...] [--app-only]
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, loadRuntimes } from "../../2v2/verify/compare";
import { H_CASES } from "./w1a-h-cases";

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const appOnly = args.includes("--app-only");
(async () => {
  await loadRuntimes();
  let bad = 0, total = 0;
  for (const c of H_CASES) {
    if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
    total++;
    const app = await appTurn(c);
    if (app.preflight.length) console.log(`${c.id}: preflight ${app.preflight.join("; ")}`);
    if (app.error) { console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 3).join(" ")}`); bad++; continue; }
    const r = app.result!;
    const summary = r.status === "ready"
      ? Object.entries(r.hp).map(([slot, hp]) => hp ? `${slot} ${hp.min}-${hp.max} ko ${(hp.koChance * 100).toFixed(2)}%` : `${slot} -`).join(" | ")
      : r.status === "not-estimated" ? `not estimated: ${r.reason}` : `issues ${JSON.stringify(r.issues)}`;
    console.log(`${c.id}: app ${summary}`);
    if (r.status === "ready") {
      for (const step of r.steps) {
        const facts = [...step.facts, ...step.skipped.map((f) => ({ ...f, text: `skip: ${f.text}` })), ...step.hits.flatMap((h) => h.facts.map((f) => ({ ...f, text: `→${h.slot}: ${f.text}` })))];
        if (facts.length) console.log(`   ${step.slot} ${step.moveId}: ${facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`).join("; ")}`);
        if (args.includes("--hits")) for (const h of step.hits) console.log(`     hit ${step.slot}→${h.slot} ${h.kind} ${h.min}-${h.max} reached ${+h.reached.toFixed(4)} ko ${+h.koChance.toFixed(4)}`);
      }
      if (r.facts.length) console.log(`   facts: ${r.facts.join(" | ")}`);
      if (app.outcomes?.status === "ready") {
        const charging = app.outcomes.outcomes.flatMap((o) => Object.entries(o.mons).filter(([, m]) => m?.charging).map(([slot, m]) => `${slot}:${m!.charging}@${+o.chance.toFixed(4)}`));
        if (charging.length) console.log(`   E2 charging: ${charging.join(" ")}`);
      }
    }
    if (appOnly) continue;
    let o;
    try { o = oracle(c, { samples: 10_000 }); } catch (e) { console.log(`   ORACLE FAILED ${(e as Error).message.split("\n")[0]}`); bad++; continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, o, r, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    if (mismatches.length) bad++;
    console.log(`   ${mismatches.length ? `${mismatches.length} mismatches` : "match"}`);
    for (const m of mismatches) console.log(`     ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    for (const w of o.warnings) console.log(`   ! ${w}`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
