// Track A3 helper: for the stored cases that now differ (w1a-a3-allcases.out), their moves, items and expected reasons, to find A3's.
import fs from "node:fs";
import { CASES } from "../../2v2/verify/cases";
const A3_MOVES = new Set(["magiccoat", "snatch", "craftyshield", "matblock", "luckychant", "mist", "mudsport", "watersport", "magicroom", "wonderroom", "courtchange", "defog",
  "corrosivegas", "bestow", "recycle", "teatime", "stuffcheeks", "aromatherapy", "healbell", "purify", "psychoshift", "trick", "switcheroo", "safeguard", "tailwind", "reflect", "lightscreen", "auroraveil", "trickroom", "gravity"]);
const out = fs.readFileSync("scripts/.cache/calc-audit/status2/build/w1a-a3-allcases.out", "utf8");
const bad = new Set([...out.matchAll(/^([A-Za-z0-9-]+): .*mismatches$/gm)].map((m) => m[1]));
const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const c of CASES) {
  if (!bad.has(c.id)) continue;
  const moves = Object.values(c.slots).map((m) => (m.action.move ? id(m.action.move) : "-"));
  const items = Object.values(c.slots).map((m) => id(m.item ?? "")).filter(Boolean);
  const mine = moves.some((m) => A3_MOVES.has(m)) || items.some((i) => ["electricseed", "grassyseed", "mistyseed", "psychicseed", "roomservice"].includes(i));
  if (mine) console.log(`${c.id} [${c.game}] moves ${moves.join(",")} items ${items.join(",")} reason ${c.notEstimated ?? "-"} | end ${c.endNotEstimated ?? "-"}`);
}
