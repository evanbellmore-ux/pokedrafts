// Track V1: for each game:move, the learners in the app catalog (base Speed, abilities, types), Megas and formes left out.
//   node scripts/.cache/calc-audit/2v2/verify/v1/pick.mjs sv:acupressure usum:psychup ... [n=8]
import fs from "node:fs";
const files = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" };
const id = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = {};
const cat = (g) => (cache[g] ??= JSON.parse(fs.readFileSync(files[g], "utf8")));
const n = Number(process.argv.find((a) => a.startsWith("n="))?.slice(2) ?? 8);
for (const q of process.argv.slice(2).filter((a) => a.includes(":"))) {
  const [g, ...moves] = q.split(":");
  const list = cat(g).species.filter((s) => moves.every((m) => s.moves.includes(id(m))) && !/-Mega|-Gmax|-Totem/.test(s.name));
  console.log(`${q} (${list.length}): ${list.slice(0, n).map((s) => `${s.name}[${s.abilities.join("/")}|${s.types.join("/")}|${s.baseStats.spe}]`).join(" ")}`);
}
