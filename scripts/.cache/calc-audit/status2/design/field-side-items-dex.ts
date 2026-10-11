// FAMILY 3 dex facts per game (status2 design: field, side, reflection and items), from the pinned dex (the runnable copy
// scripts/.cache/calc-audit/showdown with the four mods) and the app's catalogs:
//  - learners of the family's moves in each catalog;
//  - the catalog status moves with flags.snatch (status-table.ts has no snatch flag today) and their status-table kind;
//  - the catalog items with onUpdate / onAnyAfterMove handlers (what wakes up when Magic Room ends mid-turn), the Berries
//    (Teatime, Stuff Cheeks) and whether hit-loop.ts stolenEat knows each;
//  - the catalog abilities the family's handlers read (Soundproof, Good as Gold, Sap Sipper, Mirror Armor, Cheek Pouch,
//    Ripen, Cud Chew, Harvest, Pickup, Symbiosis, Unburden, Sticky Hold, Infiltrator, Prankster, Klutz, Persistent).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/field-side-items-dex.ts > scripts/.cache/calc-audit/status2/design/field-side-items-dex.out
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";
import { STATUS_MOVE_TABLE } from "../../../../../app/lib/battle/status-table";
import { knownStolenBerry } from "../../../../../app/lib/battle/hit-loop";

const { Dex } = sim as any;
const GAMES = [
  ["sv", "data/battle/scarlet_violet/catalog.json", "gen9", "scarlet_violet"],
  ["champions", "data/champions/catalog.json", "champions", "champions"],
  ["swsh", "data/battle/sword_shield/catalog.json", "gen8", "sword_shield"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7", "ultra_sun_ultra_moon"],
] as const;
const FAMILY = [
  "magiccoat", "snatch", "craftyshield", "matblock", "luckychant", "mist", "mudsport", "watersport", "magicroom", "wonderroom", "courtchange", "defog",
  "corrosivegas", "bestow", "recycle", "teatime", "stuffcheeks", "embargo", "aromatherapy", "healbell", "purify", "psychoshift", "swallow",
];
const ABILITIES = ["soundproof", "goodasgold", "sapsipper", "mirrorarmor", "cheekpouch", "ripen", "cudchew", "harvest", "pickup", "symbiosis", "unburden", "stickyhold",
  "infiltrator", "prankster", "klutz", "persistent", "magicbounce", "neutralizinggas", "moldbreaker", "teravolt", "turboblaze", "merciless", "galvanize", "contrary"];

const out: any = { learners: {}, snatch: {}, items: {}, berries: {}, abilities: {} };
for (const [game, file, mod, tableGame] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const dex = Dex.mod(mod);
  const learners: Record<string, number> = {};
  for (const species of catalog.species) for (const id of species.moves) if (FAMILY.includes(id)) learners[id] = (learners[id] ?? 0) + 1;
  out.learners[game] = Object.fromEntries(FAMILY.filter((id) => (STATUS_MOVE_TABLE as any)[id]?.games[tableGame]).map((id) => [id, learners[id] ?? 0]));
  const statusIds = Object.entries(STATUS_MOVE_TABLE).filter(([, entry]) => (entry.games as any)[tableGame]).map(([id]) => id);
  out.snatch[game] = statusIds.filter((id) => dex.moves.get(id).flags?.snatch).map((id) => `${id}:${(STATUS_MOVE_TABLE as any)[id].kind}:${dex.moves.get(id).target}`);
  const itemIds: string[] = catalog.items.map((i: any) => i.id);
  const has = (id: string, hook: string) => typeof dex.items.get(id)[hook] === "function";
  out.items[game] = {
    onUpdate: itemIds.filter((id) => has(id, "onUpdate")).sort(),
    onAnyAfterMove: itemIds.filter((id) => has(id, "onAnyAfterMove")).sort(),
    onEnd: itemIds.filter((id) => has(id, "onEnd")).sort(),
    ignoreKlutz: itemIds.filter((id) => dex.items.get(id).ignoreKlutz).sort(),
    primalOrb: itemIds.filter((id) => dex.items.get(id).isPrimalOrb).sort(),
  };
  const berries = itemIds.filter((id) => dex.items.get(id).isBerry).sort();
  out.berries[game] = { count: berries.length, unknownToStolenEat: berries.filter((id) => !knownStolenBerry(id)), list: berries };
  const abilityIds: string[] = catalog.abilities.map((a: any) => a.id);
  out.abilities[game] = ABILITIES.filter((id) => abilityIds.includes(id));
}
console.log(JSON.stringify(out, null, 1));
