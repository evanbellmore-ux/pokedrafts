// Track F: the stored case RE43 (Fling a Flame Orb into a Substitute) without its "not verified" expectation: the app's turn
// against the stored oracle result (compare.ts compareCase), to show what remains for Track D's flingAfter.
import { CASES } from "../../../2v2/verify/cases";
import { compareCase, loadRuntimes, readOracle } from "../../../2v2/verify/compare";
import { appTurn } from "../../../2v2/verify/app-turn";
(async () => {
  await loadRuntimes();
  for (const id of process.argv.slice(2)) {
    const c = CASES.find((x) => x.id === id)!;
    const plain = { ...c, notEstimated: undefined } as typeof c;
    const app = await appTurn(plain);
    const mismatches = compareCase(plain, readOracle(id), app.result, () => false, app.outcomes);
    console.log(id, mismatches.length, "mismatches");
    for (const m of mismatches) console.log("  ", m.where, m.field, JSON.stringify(m.expected), "->", JSON.stringify(m.got));
  }
})();
