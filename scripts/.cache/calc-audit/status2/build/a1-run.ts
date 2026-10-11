// Track A1 (status2 wave 1a): run A1's own cases (a1-cases.ts) on both sides, the pinned Showdown oracle (sim-dfs.ts oracle())
// and the app (app-turn.ts), and compare them as compare.ts does (E2 included). The oracle side is stored in
// status2/build/a1-results/<id>.json (not V1's verify/results), and reused unless --oracle.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/a1-run.ts [<id or prefix>...] [--oracle] [--quiet] [--show]
import fs from "node:fs";
import path from "node:path";
import { A1_CASES } from "./a1-cases";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, loadRuntimes } from "../../2v2/verify/compare";
import { oracle, prepareAll, walkReplay } from "../../2v2/verify/sim-dfs";
import { SLOTS, type Case, type OracleResult, type SlotId, type SlotResult } from "../../2v2/verify/case-types";

const DIR = path.resolve("scripts/.cache/calc-audit/status2/build/a1-results");

/**
 * The oracle by whole-turn replays (sim-dfs.ts walkReplay: no state serialized between the actions), for the cases whose
 * battle Showdown's State cannot deserialize mid-turn (a transformed Pokémon's virtual move slots: sim/state.ts
 * deserializePokemon). The same OracleResult as oracle().
 */
function replayOracle(c: Case): OracleResult {
  const starts = prepareAll(c);
  const all = walkReplay(c, "all"), lowest = walkReplay(c, "lowest"), highest = walkReplay(c, "highest");
  const expectedOf = (a: Record<SlotId, SlotResult>, lo: Record<SlotId, SlotResult>, hi: Record<SlotId, SlotResult>) =>
    Object.fromEntries(SLOTS.map((slot) => {
      const x = a[slot];
      return [slot, { start: x.start, maximum: x.maximum, low: lo[slot].modeTieUp, high: hi[slot].modeTieDown, average: x.average, min: x.min, max: x.max, koChance: x.koChance, dist: x.dist }];
    })) as OracleResult["expected"];
  const expected = expectedOf(all.slots, lowest.slots, highest.slots);
  const whole = [all, lowest, highest].every((w) => w.afterTurn && w.afterTurn.noResidual === 0 && Object.keys(w.afterTurn.slots).length);
  const afterTurn = whole ? Object.fromEntries(Object.entries(expectedOf(all.afterTurn!.slots, lowest.afterTurn!.slots, highest.afterTurn!.slots))
    .map(([slot, e]) => [slot, { ...e, start: expected[slot as SlotId].start, maximum: expected[slot as SlotId].maximum }])) as OracleResult["afterTurn"] : null;
  return {
    id: c.id, title: c.title, game: c.game, format: starts[0].format, checks: c.checks, walks: { all, lowest, highest }, expected,
    warnings: [...new Set(starts.flatMap((s) => s.warnings))], afterTurn, residuals: all.afterTurn?.residuals ?? [],
  };
}
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
const runOracle = args.includes("--oracle"), quiet = args.includes("--quiet"), show = args.includes("--show");
(async () => {
  await loadRuntimes();
  fs.mkdirSync(DIR, { recursive: true });
  let bad = 0, total = 0;
  for (const c of A1_CASES) {
    if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(id))) continue;
    total++;
    const file = path.join(DIR, `${c.id}.json`);
    if (!c.notEstimated && (runOracle || !fs.existsSync(file))) {
      const t0 = Date.now();
      try {
        const replay = SLOTS.some((slot) => c.slots[slot].action.move === "Transform");
        const r = replay ? replayOracle(c) : oracle(c);
        fs.writeFileSync(file, JSON.stringify(r, null, 1));
        if (!quiet) console.log(`${c.id}: oracle ${Date.now() - t0} ms${r.warnings.length ? ` warnings: ${r.warnings.join(" | ")}` : ""}`);
      } catch (error) {
        bad++;
        console.log(`${c.id}: ORACLE FAILED ${(error as Error).message.split("\n").slice(0, 3).join(" | ")}`);
        continue;
      }
    }
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: APP ERROR ${app.error.split("\n").slice(0, 6).join(" | ")}`); continue; }
    if (app.preflight.length) console.log(`${c.id}: preflight ${app.preflight.join(" | ")}`);
    if (app.outcomesError) console.log(`${c.id}: E2 ERROR ${app.outcomesError.split("\n")[0]}`);
    const runtime = await runtimeFor(c);
    const stored = c.notEstimated ? null : JSON.parse(fs.readFileSync(file, "utf8"));
    const mismatches = compareCase(c, stored, app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    const status = app.result?.status === "not-estimated" ? `not-estimated (${app.result.reason})` : app.result?.status;
    const eot = app.result?.status === "ready" && app.result.endOfTurn.status === "not-estimated" ? ` [end: ${app.result.endOfTurn.reason}]` : "";
    if (show && app.result?.status === "ready") {
      for (const step of app.result.steps) console.log(`   step ${step.slot} ${step.moveId}: ${step.facts.map((f) => `${f.text} (${+f.chance.toFixed(3)})`).join(" | ")}`);
      for (const step of app.result.steps) for (const hit of step.hits) console.log(`     hit ${step.slot}→${hit.slot} ${hit.kind} ${hit.min ?? ""}-${hit.max ?? ""}: ${hit.facts.map((f) => `${f.text} (${+f.chance.toFixed(3)})`).join(" | ")}`);
      console.log(`   facts: ${app.result.facts.join(" | ")}`);
    }
    if (mismatches.length) {
      bad++;
      console.log(`${c.id}: ${status}${eot}: ${mismatches.length} mismatches`);
      for (const m of mismatches.slice(0, 25)) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    } else if (!quiet) console.log(`${c.id}: ${status}${eot}: match`);
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
