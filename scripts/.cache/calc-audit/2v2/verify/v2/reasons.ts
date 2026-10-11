// Track V2: every expected reason among the cases, with its REMOVED entry (status2-removed.ts) and how many cases give it.
import { CASES } from "../cases";
import { WAVE1B_CASES } from "../cases-wave1b";
import { removalOf } from "../status2-removed";
const w1b = new Set(WAVE1B_CASES.map((c) => c.id));
const by = new Map<string, string[]>();
for (const c of CASES) for (const k of ["notEstimated", "endNotEstimated"] as const) {
  const t = c[k];
  if (!t) continue;
  const key = `${k === "notEstimated" ? "turn" : "end "} | ${t}`;
  (by.get(key) ?? by.set(key, []).get(key)!).push(c.id + (w1b.has(c.id) ? "*" : ""));
}
for (const [k, ids] of [...by].sort()) {
  const r = removalOf(k.split(" | ")[1]);
  console.log(`${r ? `${r.wave.padEnd(4)} ${r.owner.padEnd(10)}` : "---- ----------"} ${k}  [${ids.length}: ${ids.slice(0, 6).join(" ")}${ids.length > 6 ? " …" : ""}]`);
}
