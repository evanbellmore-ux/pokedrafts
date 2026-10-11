// Track V2: one line per wave 1b case: each step's moved share, hit ranges and effect keys; the residual lines; the start
// variants (a reading aid for the case authors and the tracks).
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/v2/brief.ts [id prefix ...]
import fs from "node:fs";
import path from "node:path";
import { WAVE1B_CASES } from "../cases-wave1b";
import { RESULTS_DIR } from "../sim-dfs";
const ids = process.argv.slice(2);
const short = (slot: string) => ({ "own-left": "OL", "own-right": "OR", "opponent-left": "PL", "opponent-right": "PR" } as Record<string, string>)[slot] ?? slot;
const r3 = (x: number) => +x.toFixed(3);
for (const c of WAVE1B_CASES) {
  if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
  if (c.notEstimated) { console.log(`${c.id}: not estimated: ${c.notEstimated}`); continue; }
  const file = path.join(RESULTS_DIR, `${c.id}.json`);
  if (!fs.existsSync(file)) { console.log(`${c.id}: no result`); continue; }
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const a = r.walks.all;
  const parts: string[] = [];
  for (const [slot, st] of Object.entries(a.steps) as [string, any][]) {
    const hits = Object.entries(st.hits).map(([t, h]: [string, any]) => `${short(t)}${h.dmgMax !== null ? `:${h.dmgMin}-${h.dmgMax}` : h.landed ? ":fx" : ":miss"}`).join(",");
    const fx = Object.entries(st.effects ?? {}).flatMap(([t, k]: [string, any]) => Object.entries(k).filter(([key]) => !/^damage:/.test(key)).map(([key, m]) => `${short(t)}.${key}${r3(m as number) !== 1 ? `@${r3(m as number)}` : ""}`)).slice(0, 6).join(" ");
    parts.push(`${short(slot)} ${st.moveId}${st.moved < 1 ? `(${r3(st.moved)})` : ""}[${hits}]${fx ? ` {${fx}}` : ""}`);
  }
  for (const [k, cp] of Object.entries(a.copies ?? {}) as [string, any][]) parts.push(`copy ${k}(${r3(cp.moved)})`);
  const res = (r.residuals ?? []).map((x: any) => `${short(x.slot)} ${x.effect}${x.min !== null ? ` ${x.min}..${x.max}` : ""}${r3(x.chance) !== 1 ? `@${r3(x.chance)}` : ""}`).join("; ");
  console.log(`${c.id}${r.hidden ? ` [${r.hidden.length} starts]` : ""}: ${parts.join(" | ")}${res ? ` || ${res}` : ""}`);
}
