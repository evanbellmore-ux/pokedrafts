// Track A1 (status2 wave 1a): the pinned dex's ability handlers per game (Start, SwitchIn, End, Update and their priorities),
// the input of the ability table's design notes. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/a1-ability-dump.ts > <out>
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";

const { Dex } = sim as any;
const GAMES = [
  ["sv", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["champions", "data/champions/catalog.json", "champions"],
  ["swsh", "data/battle/sword_shield/catalog.json", "gen8"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
] as const;
const HOOKS = ["onStart", "onSwitchIn", "onEnd", "onUpdate"];
const ids = new Set<string>();
for (const [, file] of GAMES) for (const a of JSON.parse(fs.readFileSync(file, "utf8")).abilities) ids.add(a.id);
for (const id of [...ids].sort()) {
  const bodies: Record<string, string[]> = {};
  for (const [game, file, mod] of GAMES) {
    const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!catalog.abilities.some((a: any) => a.id === id)) continue;
    const a = Dex.mod(mod).abilities.get(id);
    for (const hook of HOOKS) {
      if (typeof a[hook] !== "function") continue;
      const text = `${hook}${a[hook + "Priority"] !== undefined ? ` (priority ${a[hook + "Priority"]})` : ""}: ${String(a[hook])}`;
      (bodies[text] ??= []).push(game);
    }
  }
  if (!Object.keys(bodies).length) continue;
  console.log(`=== ${id}`);
  for (const [text, games] of Object.entries(bodies)) console.log(`[${games.join(" ")}] ${text}`);
}
