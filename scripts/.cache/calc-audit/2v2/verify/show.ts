// Compact view of oracle results for case review: per step the move, P(moved), cant reasons and the effect keys on each
// Pokémon; then the residuals and the after-the-turn HP. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/show.ts <id prefix>...
import fs from "node:fs";
import path from "node:path";
import { SLOTS, type OracleResult } from "./case-types";

const DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
const SHORT: Record<string, string> = { "own-left": "OL", "own-right": "OR", "opponent-left": "PL", "opponent-right": "PR" };
const p = (x: number) => (Math.abs(x - 1) < 1e-12 ? "1" : x.toFixed(4).replace(/0+$/, ""));
const prefixes = process.argv.slice(2);
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const id = file.slice(0, -5);
  if (prefixes.length && !prefixes.some((x) => id === x || id.startsWith(x))) continue;
  const r = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as OracleResult;
  if (!r.walks) continue;
  console.log(`== ${id}: ${r.title}${r.warnings.length ? `  [${r.warnings.join("; ")}]` : ""}`);
  const all = r.walks.all;
  for (const slot of SLOTS) {
    const s = all.steps[slot];
    if (!s) continue;
    const cant = Object.entries(s.cant).map(([k, v]) => `${k} ${p(v)}`).join(", ");
    const eff = Object.entries(s.effects ?? {}).map(([t, keys]) => `${SHORT[t]}{${Object.entries(keys).map(([k, v]) => `${k}${v < 1 - 1e-12 ? `@${p(v)}` : ""}`).join(" ")}}`).join(" ");
    const sides = Object.entries(s.sides ?? {}).map(([t, keys]) => `${t}{${Object.keys(keys).join(" ")}}`).join(" ");
    console.log(`  ${SHORT[slot]} ${s.moveId} moved ${p(s.moved)}${cant ? ` cant[${cant}]` : ""} ${eff} ${sides}`);
  }
  for (const res of r.residuals ?? []) {
    console.log(`  · ${SHORT[res.slot]} ${res.effect}${res.other ? ` (${SHORT[res.other]})` : ""} ${p(res.chance)} ${res.min === null ? "" : res.min === res.max ? res.min : `${res.min}..${res.max}`}${res.koChance ? ` ko ${p(res.koChance)}` : ""} ${Object.keys(res.facts).join(" ")}`);
  }
  const hp = SLOTS.map((slot) => {
    const e = r.expected[slot], t = r.afterTurn?.[slot];
    return `${SHORT[slot]} ${r.walks.all.slots[slot].species} ${e.start}→${e.min === e.max ? e.min : `${e.min}..${e.max}`}${t ? `→${t.min === t.max ? t.min : `${t.min}..${t.max}`}` : "→?"}`;
  }).join(" | ");
  console.log(`  ${hp}${r.afterTurn ? "" : `  (no end of turn: ${p(r.walks.all.afterTurn?.noResidual ?? 0)} switch)`}`);
}
