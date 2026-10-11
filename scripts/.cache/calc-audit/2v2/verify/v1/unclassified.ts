// Track V1: stored cases' reasons that status2-removed.ts does not classify (each kept by default).
import { CASES } from "../cases";
import { WAVE1A_CASES } from "../cases-wave1a";
import { removalOf } from "../status2-removed";
const w = new Set(WAVE1A_CASES.map((c) => c.id));
const seen = new Map<string, string[]>();
for (const c of CASES) {
  if (w.has(c.id)) continue;
  for (const t of [c.notEstimated, c.endNotEstimated]) if (t && !removalOf(t)) (seen.get(t) ?? seen.set(t, []).get(t)!).push(c.id);
}
for (const [t, ids] of seen) console.log(`${t}  <- ${ids.join(" ")}`);
