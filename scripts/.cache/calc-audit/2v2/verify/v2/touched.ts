// Track V2: the cases before wave 1b that the 1b harness changes can reach (sim-dfs.ts: Magnitude's bands, G-Max Replenish's
// chance, a Dancer's copies, an instructed move, a commanding Tatsugiri, a random-target move's choice).
import { CASES } from "../cases";
import { WAVE1B_CASES } from "../cases-wave1b";
import { SLOTS, toID } from "../case-types";
const w1b = new Set(WAVE1B_CASES.map((c) => c.id));
for (const c of CASES) {
  if (w1b.has(c.id)) continue;
  const hit: string[] = [];
  for (const s of SLOTS) {
    const m = c.slots[s];
    if (m.absent) continue;
    const move = toID(m.action.move ?? "");
    if (move === "magnitude") hit.push("Magnitude");
    if (m.gigantamax && toID(m.species).startsWith("snorlax")) hit.push("G-Max Replenish");
    if (toID(m.ability) === "dancer") hit.push("Dancer");
    if (move === "instruct") hit.push("Instruct");
    if (toID(m.ability) === "commander") hit.push("Commander");
  }
  if (hit.length) console.log(`${c.id}${c.notEstimated ? " (not estimated)" : ""}: ${[...new Set(hit)].join(", ")}`);
}
