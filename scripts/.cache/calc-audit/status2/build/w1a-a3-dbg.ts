// Track A3 scratch: print the app's hits and HP for A3 cases (the numbers the unit tests pin).
import { appTurn } from "../../2v2/verify/app-turn";
import { A3_CASES } from "./w1a-a3-cases";
(async () => {
  for (const id of process.argv.slice(2)) {
    const c = A3_CASES.find((x) => x.id === id)!;
    const { result } = await appTurn(c);
    if (result?.status !== "ready") { console.log(id, JSON.stringify(result).slice(0, 300)); continue; }
    for (const step of result.steps) for (const hit of step.hits) console.log(id, step.slot, "->", hit.slot, hit.kind, hit.min, hit.max);
    for (const [slot, hp] of Object.entries(result.hp)) if (hp) console.log(id, slot, hp.min, hp.max, JSON.stringify(hp.heals));
  }
})();
