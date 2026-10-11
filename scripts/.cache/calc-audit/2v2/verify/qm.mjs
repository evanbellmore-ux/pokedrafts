// For each move: the fastest few and slowest few species of the game's catalog that learn it.
//   node scripts/.cache/calc-audit/2v2/verify/qm.mjs <game> <move> [<move>...]
import fs from "node:fs";
const files = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" };
const [game, ...moves] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(files[game], "utf8"));
const id = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const mv of moves) {
  const m = c.moves.find((x) => x.id === id(mv));
  const list = c.species.filter((s) => !s.unsupported.length && s.moves.includes(id(mv))).sort((a, b) => a.baseStats.spe - b.baseStats.spe);
  const show = (s) => `${s.name}(${s.baseStats.spe + 20};${s.types.join("/")};${s.abilities.join("/")})`;
  console.log(`${mv} [${m ? `${m.category} ${m.target} pri${m.priority}${m.unsupported.length ? " UNSUP" : ""}` : "NO MOVE"}] ${list.length}: ${list.length > 10 ? [...list.slice(0, 5), "…", ...list.slice(-5)].map((s) => (typeof s === "string" ? s : show(s))).join(" ") : list.map(show).join(" ")}`);
}
