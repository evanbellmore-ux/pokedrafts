// Census 1 helper: dex facts per game for the 73 kind-L status moves (status2 design), from the pinned dex (runnable copy
// scripts/.cache/calc-audit/showdown, the four mods) and the app's catalogs:
//  - learners of each L move in each game's catalog;
//  - the move's handlers as the mod resolves them (onHit, onTry, ..., condition handlers), so per-game differences show;
//  - the ability flags the ability-changing moves read (cantsuppress, failroleplay, failskillswap, noentrain, notrace,
//    notransform), restricted to each catalog's abilities, and the catalog abilities with Start / SwitchIn / End handlers;
//  - the catalog items with Start / End / Update / TakeItem handlers, and the Berries (Bestow, Corrosive Gas, Recycle,
//    Embargo, Magic Room, Stuff Cheeks, Teatime).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-dex.ts > scripts/.cache/calc-audit/status2/design/census-moves-dex.out
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";
import { STATUS_MOVE_TABLE } from "../../../../../app/lib/battle/status-table";

const { Dex } = sim as any;
const GAMES = [
  ["sv", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["champions", "data/champions/catalog.json", "champions"],
  ["swsh", "data/battle/sword_shield/catalog.json", "gen8"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
] as const;
const L = Object.entries(STATUS_MOVE_TABLE).filter(([, e]) => e.kind === "L").map(([id]) => id);
const MOVE_HANDLERS = ["onTry", "onTryHit", "onTryImmunity", "onPrepareHit", "onHit", "onHitField", "onHitSide", "onTryMove", "onModifyMove", "onAfterMove", "onDisableMove", "durationCallback"];
const handlersOf = (o: any) => (o ? Object.keys(o).filter((k) => typeof o[k] === "function" || (k.startsWith("on") && o[k] !== undefined)) : []);

const out: any = { learners: {}, handlers: {}, abilities: {}, items: {} };
for (const [game, file, mod] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const dex = Dex.mod(mod);
  const learners: Record<string, number> = {};
  for (const species of catalog.species) for (const id of species.moves) if (L.includes(id)) learners[id] = (learners[id] ?? 0) + 1;
  out.learners[game] = learners;
  for (const id of L) {
    const m = dex.moves.get(id);
    if (!STATUS_MOVE_TABLE[id].games[({ sv: "scarlet_violet", champions: "champions", swsh: "sword_shield", usum: "ultra_sun_ultra_moon" } as const)[game]]) continue;
    const own = MOVE_HANDLERS.filter((k) => m[k] !== undefined);
    const self = m.self ? handlersOf(m.self).map((k) => `self.${k}`) : [];
    const cond = m.condition ? handlersOf(m.condition).map((k) => `condition.${k}`) : [];
    const sig = [...own, ...self, ...cond].join(" ");
    // A short source fingerprint of each handler, so a mod's different body shows (the text length and its first line).
    const prints = [...own.map((k) => [k, m[k]]), ...(m.condition ? handlersOf(m.condition).map((k) => [`condition.${k}`, m.condition[k]]) : [])]
      .filter(([, f]) => typeof f === "function").map(([k, f]) => `${k}:${String(f).length}`);
    (out.handlers[id] ??= {})[game] = { sig, prints: prints.join(" "), pp: m.pp, isNonstandard: m.isNonstandard ?? null, zMove: m.zMove ?? null };
  }
  const abilityIds: string[] = catalog.abilities.map((a: any) => a.id);
  const flagSets: Record<string, string[]> = {};
  for (const flag of ["cantsuppress", "failroleplay", "failskillswap", "noentrain", "notrace", "notransform", "breakable"]) {
    flagSets[flag] = abilityIds.filter((id) => dex.abilities.get(id).flags?.[flag]).sort();
  }
  const acts = (hook: string) => abilityIds.filter((id) => typeof dex.abilities.get(id)[hook] === "function").sort();
  out.abilities[game] = { count: abilityIds.length, flags: flagSets, onStart: acts("onStart"), onSwitchIn: acts("onSwitchIn"), onEnd: acts("onEnd"), onUpdate: acts("onUpdate") };
  const itemIds: string[] = catalog.items.map((i: any) => i.id);
  const itemActs = (hook: string) => itemIds.filter((id) => typeof dex.items.get(id)[hook] === "function").sort();
  out.items[game] = {
    count: itemIds.length, onStart: itemActs("onStart"), onEnd: itemActs("onEnd"), onUpdate: itemActs("onUpdate"), onTakeItem: itemActs("onTakeItem"),
    berries: itemIds.filter((id) => dex.items.get(id).isBerry).sort(),
  };
}
console.log(JSON.stringify(out, null, 1));
