// Track V2: the app's catalog preflight (app-turn.ts preflight: species, ability, item, learnset) over the wave 1b cases.
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/preflight.ts [id prefix ...]
import { WAVE1B_CASES } from "../cases-wave1b";
import { preflight, runtimeFor } from "../app-turn";
(async () => {
  const ids = process.argv.slice(2);
  let bad = 0;
  for (const c of WAVE1B_CASES) {
    if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
    const pre = preflight(c, await runtimeFor(c));
    if (pre.length) { bad++; console.log(`${c.id}: ${pre.join(" | ")}`); }
  }
  console.log(`${bad} cases with preflight issues`);
})();
