// Census of the status moves in the four games' catalogs and how the 2v2 turn treats them today, with pinned Showdown's
// move data (target, flags, boosts, status, volatile, side/slot/pseudo conditions, handlers present).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-census.ts > scripts/.cache/calc-audit/status-eot/design/status-census.out
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";
import { HP_STATUS_MOVES, MODELLED_STATUS_MOVES, NO_EFFECT_MOVES, PRESENCE_MOVES, CALLING_MOVES, SWITCH_MOVES, PENDING_MOVES } from "@/app/lib/battle/doubles-actions";

const { Dex } = sim as any;
const GAMES = [
  ["champions", "data/champions/catalog.json", "champions"],
  ["sv", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["swsh", "data/battle/sword_shield/catalog.json", "gen8"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
] as const;

type Row = { id: string; games: string[]; learners: Record<string, number>; handling: string; sd: string };
const rows = new Map<string, Row>();
for (const [game, file, mod] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const dex = Dex.mod(mod);
  const status = new Map<string, any>(catalog.moves.filter((m: any) => m.category === "Status").map((m: any) => [m.id, m]));
  const learners = new Map<string, number>();
  for (const species of catalog.species) for (const id of species.moves) if (status.has(id)) learners.set(id, (learners.get(id) ?? 0) + 1);
  for (const id of status.keys()) {
    const m = dex.moves.get(id);
    let row = rows.get(id);
    if (!row) {
      const handling = MODELLED_STATUS_MOVES.has(id) ? "modelled" : NO_EFFECT_MOVES.has(id) ? "no-effect" : HP_STATUS_MOVES.has(id) ? "hp-guard" : PRESENCE_MOVES.has(id) || PENDING_MOVES.has(id) ? "presence" : CALLING_MOVES.has(id) ? "calling" : SWITCH_MOVES.has(id) ? "switch" : "before-guard";
      const parts: string[] = [m.target, `p${m.priority}`];
      const flags = Object.keys(m.flags).filter((f) => ["protect", "reflectable", "powder", "sound", "bypasssub", "allyanim", "snatch", "heal", "dance", "wind"].includes(f));
      if (flags.length) parts.push(`flags:${flags.join(",")}`);
      if (m.boosts) parts.push(`boosts:${JSON.stringify(m.boosts)}`);
      if (m.status) parts.push(`status:${m.status}`);
      if (m.volatileStatus) parts.push(`volatile:${m.volatileStatus}`);
      if (m.sideCondition) parts.push(`side:${m.sideCondition}`);
      if (m.slotCondition) parts.push(`slot:${m.slotCondition}`);
      if (m.pseudoWeather) parts.push(`pseudo:${m.pseudoWeather}`);
      if (m.weather) parts.push(`weather:${m.weather}`);
      if (m.terrain) parts.push(`terrain:${m.terrain}`);
      if (m.heal) parts.push(`heal:${m.heal.join("/")}`);
      if (m.self?.boosts) parts.push(`self:${JSON.stringify(m.self.boosts)}`);
      if (m.selfSwitch) parts.push(`selfSwitch:${m.selfSwitch}`);
      if (m.forceSwitch) parts.push("forceSwitch");
      const handlers = ["onTry", "onTryHit", "onHit", "onHitField", "onHitSide", "onTryImmunity", "onPrepareHit", "onModifyMove", "beforeMoveCallback", "priorityChargeCallback"].filter((h) => typeof m[h] === "function");
      if (handlers.length) parts.push(`fn:${handlers.join(",")}`);
      if (m.condition) parts.push(`cond:${Object.keys(m.condition).filter((k) => k.startsWith("on") || k === "duration").join(",")}`);
      if (m.isZ || m.isMax) parts.push("z/max");
      row = { id, games: [], learners: {}, handling, sd: parts.join(" ") };
      rows.set(id, row);
    }
    row.games.push(game);
    row.learners[game] = learners.get(id) ?? 0;
  }
}
const sorted = [...rows.values()].sort((a, b) => a.handling.localeCompare(b.handling) || a.id.localeCompare(b.id));
const counts: Record<string, number> = {};
for (const row of sorted) counts[row.handling] = (counts[row.handling] ?? 0) + 1;
console.log("status moves:", sorted.length, JSON.stringify(counts));
for (const row of sorted) {
  console.log(`${row.handling.padEnd(12)} ${row.id.padEnd(18)} ${row.games.map((g) => `${g}:${row.learners[g]}`).join(" ").padEnd(44)} ${row.sd}`);
}
