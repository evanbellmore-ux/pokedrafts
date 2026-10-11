// Every Residual handler in pinned Showdown c23d2e94 per game (moves' conditions, statuses and volatiles, abilities,
// items, side and field conditions), with onResidualOrder / SubOrder, as fieldEvent('Residual') sorts them
// (sim/battle.ts fieldEvent + comparePriority: order, priority, speed, subOrder, effectOrder). Abilities and items are
// limited to those in the game's catalog.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-residual-census.ts > scripts/.cache/calc-audit/status-eot/design/status-residual-census.out
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";

const { Dex } = sim as any;
const GAMES = [
  ["champions", "data/champions/catalog.json", "champions"],
  ["sv", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["swsh", "data/battle/sword_shield/catalog.json", "gen8"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
] as const;

type Entry = { key: string; order: number | string; sub: number | string; kind: string; games: Set<string>; extra: string };
const entries = new Map<string, Entry>();
function note(game: string, kind: string, id: string, data: any, prefix = "") {
  for (const event of ["Residual", "SideResidual", "FieldResidual"]) {
    if (typeof data[`on${event}`] !== "function" && !(event === "Residual" && data.duration && kind !== "ability" && kind !== "item")) continue;
    if (typeof data[`on${event}`] !== "function" && event !== "Residual") continue;
    const order = data[`on${event}Order`] ?? (typeof data[`on${event}`] === "function" ? "-" : "dur");
    const sub = data[`on${event}SubOrder`] ?? "";
    const key = `${kind}:${prefix}${id}:${event}`;
    let entry = entries.get(key);
    if (!entry) entries.set(key, entry = { key, order, sub, kind, games: new Set(), extra: data.duration ? `duration ${data.duration}` : "" });
    if (entry.order !== order || entry.sub !== sub) entry.extra += ` [${game}: ${order}/${sub}]`;
    entry.games.add(game);
  }
}
for (const [game, file, mod] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const dex = Dex.mod(mod);
  const moveIds = new Set<string>(catalog.moves.map((m: any) => m.id));
  for (const move of dex.moves.all()) if (moveIds.has(move.id) && move.condition) note(game, "move", move.id, move.condition);
  for (const condition of Object.values(dex.data.Conditions) as any[]) note(game, "condition", condition.name ?? "?", dex.conditions.get(condition.name ?? ""));
  const abilities = new Set<string>(catalog.abilities.map((a: any) => a.id));
  for (const ability of dex.abilities.all()) if (abilities.has(ability.id)) note(game, "ability", ability.id, ability);
  const items = new Set<string>(catalog.items.map((i: any) => i.id));
  for (const item of dex.items.all()) if (items.has(item.id)) note(game, "item", item.id, item);
}
const num = (x: number | string) => (typeof x === "number" ? x : 999);
const sorted = [...entries.values()].sort((a, b) => num(a.order) - num(b.order) || num(a.sub) - num(b.sub) || a.key.localeCompare(b.key));
for (const e of sorted) console.log(`${String(e.order).padStart(4)} ${String(e.sub).padStart(3)}  ${e.key.padEnd(42)} ${[...e.games].join(",").padEnd(26)} ${e.extra}`);
