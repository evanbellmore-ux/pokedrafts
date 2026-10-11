// Track V2: a scan of the wave 1b oracle results for steps that may not test what the case means: a damaging move that
// dealt no damage anywhere, or that never moved; an immune hit.
import fs from "node:fs";
import path from "node:path";
import { WAVE1B_CASES } from "../cases-wave1b";
import { RESULTS_DIR } from "../sim-dfs";
import { toID } from "../case-types";
const cat = new Map<string, Map<string, string>>();
for (const [g, f] of [["sv", "data/battle/scarlet_violet/catalog.json"], ["swsh", "data/battle/sword_shield/catalog.json"], ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json"], ["champions", "data/champions/catalog.json"]]) {
  cat.set(g, new Map((JSON.parse(fs.readFileSync(f, "utf8")).moves as { id: string; category: string }[]).map((m) => [m.id, m.category])));
}
for (const c of WAVE1B_CASES) {
  if (c.notEstimated) continue;
  const file = path.join(RESULTS_DIR, `${c.id}.json`);
  if (!fs.existsSync(file)) continue;
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const notes: string[] = [];
  for (const [slot, st] of Object.entries(r.walks.all.steps) as [string, any][]) {
    const status = cat.get(c.game)!.get(st.moveId) === "Status";
    if (st.moved < 1e-9) notes.push(`${slot} ${st.moveId} never moves`);
    if (status) continue;
    const hits = Object.entries(st.hits) as [string, any][];
    const dealt = hits.some(([, h]) => h.dmgMax !== null && h.dmgMax > 0);
    if (!dealt && st.moved > 1e-9) notes.push(`${slot} ${st.moveId} deals no damage (${hits.map(([t, h]) => `${t}:${h.reached.toFixed(2)}/${h.landed.toFixed(2)}`).join(" ")})`);
    for (const [t, keys] of Object.entries(st.effects ?? {}) as [string, any][]) for (const k of Object.keys(keys)) if (k.startsWith("immune")) notes.push(`${slot} ${st.moveId} → ${t} ${k}`);
  }
  if (notes.length) console.log(`${c.id}: ${notes.join("; ")}`);
}
