// Case-design helper: species of a game's app catalog that meet every constraint, slowest first.
//   node scripts/.cache/calc-audit/2v2/verify/q.mjs <game> [ab:<ability>] [mv:<move>]... [type:<Type>] [notype:<Type>] [item:<item>] [check:<species>:<ability>:<move>,<move>]
// game: sv swsh usum champions. `check:` prints whether one set is legal instead.
import fs from "node:fs";
const files = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" };
const [game, ...args] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(files[game], "utf8"));
const id = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const a of args.filter((x) => x.startsWith("check:"))) {
  const [, sp, ab, mvs = ""] = a.split(":");
  const s = c.species.find((x) => x.id === id(sp));
  if (!s) { console.log(a, "NO SPECIES"); continue; }
  const bad = mvs.split(",").filter(Boolean).filter((m) => !s.moves.includes(id(m)));
  console.log(`${s.name} spe ${s.baseStats.spe} hp ${s.baseStats.hp} [${s.types}] [${s.abilities}] ability ${ab ? (s.abilities.includes(id(ab)) ? "ok" : "NO") : "-"} moves ${bad.length ? "MISSING " + bad.join(",") : "ok"}${s.unsupported.length ? " UNSUP " + s.unsupported : ""}`);
}
for (const a of args.filter((x) => x.startsWith("item:"))) {
  const it = c.items.find((x) => x.id === id(a.slice(5)));
  console.log(a, it ? (it.unsupported.length ? "UNSUP " + it.unsupported : "ok") : "NO ITEM");
}
for (const a of args.filter((x) => x.startsWith("move:"))) {
  const m = c.moves.find((x) => x.id === id(a.slice(5)));
  console.log(a, m ? `${m.category} ${m.type} ${m.power} pri ${m.priority} ${m.target}${m.unsupported.length ? " UNSUP " + m.unsupported : ""}` : "NO MOVE");
}
const filters = args.filter((x) => !/^(check|item|move):/.test(x));
if (filters.length) {
  const out = c.species.filter((s) => !s.unsupported.length && filters.every((f) => {
    const [k, v] = f.split(":");
    if (k === "ab") return s.abilities.includes(id(v));
    if (k === "mv") return s.moves.includes(id(v));
    if (k === "type") return s.types.includes(v);
    if (k === "notype") return !s.types.includes(v);
    return true;
  })).sort((a, b) => a.baseStats.spe - b.baseStats.spe);
  for (const s of out.slice(0, 40)) console.log(`${s.name} spe ${s.baseStats.spe} hp ${s.baseStats.hp} [${s.types}] [${s.abilities}]`);
  console.log(`${out.length} species`);
}
