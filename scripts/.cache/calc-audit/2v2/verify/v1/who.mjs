// Track V1: case construction helper over the app catalogs (the 2v2 preflight's species.moves and abilities).
//   node scripts/.cache/calc-audit/2v2/verify/v1/who.mjs <game> <move>[,<move>...] [ability=<id>] [max=<n>]
//   node scripts/.cache/calc-audit/2v2/verify/v1/who.mjs <game>:<species>:<move>:<move>...   (does it learn them)
import fs from "node:fs";
const files = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" };
const id = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = {};
const cat = (g) => (cache[g] ??= JSON.parse(fs.readFileSync(files[g], "utf8")));
const args = process.argv.slice(2);
if (args[0]?.includes(":")) {
  for (const q of args) {
    const [g, sp, ...mv] = q.split(":");
    const s = cat(g).species.find((x) => x.id === id(sp));
    if (!s) { console.log(q, "NO SPECIES"); continue; }
    console.log(`${g} ${s.name} [${s.abilities.join("/")}] ${s.types.join("/")} spe ${s.baseStats.spe} wt ${s.weightkg ?? "?"}: ` + mv.map((m) => `${m}=${s.moves.includes(id(m)) ? "y" : "N"}`).join(" "));
  }
} else {
  const [g, moves, ...rest] = args;
  const opts = Object.fromEntries(rest.map((x) => x.split("=")));
  const want = (moves ?? "").split(",").filter(Boolean).map(id);
  const list = cat(g).species.filter((s) => want.every((m) => s.moves.includes(m)) && (!opts.ability || s.abilities.map(id).includes(id(opts.ability))) && (!opts.type || s.types.includes(opts.type)));
  console.log(list.slice(0, Number(opts.max ?? 60)).map((s) => `${s.name}[${s.abilities.join("/")}|${s.types.join("/")}|spe ${s.baseStats.spe}]`).join("\n"));
  console.log(`${list.length} species`);
}
