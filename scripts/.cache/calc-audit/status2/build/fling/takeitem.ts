// Track F (SPEC2 §4.7): Fling's TakeItem check (PS/data/moves.ts fling onPrepareHit: singleEvent('TakeItem', item, ..., source,
// source, move, item), so the item's onTakeItem(item, pokemon = source = the user)) against the app's rule (fling.ts flingFailure
// through uses-to-ko.ts itemTakeable), for every catalog item with an onTakeItem and every catalog species as its user, in each
// game's pinned mod. Read-only.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/fling/takeitem.ts
import * as sim from "../../../showdown/sim/index.ts";
import { usesHelpers } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { itemTakeable } from "@/app/lib/battle/uses-to-ko";
const { Dex } = sim as any;
const GAMES = [["scarlet_violet", "gen9"], ["champions", "champions"], ["sword_shield", "gen8"], ["ultra_sun_ultra_moon", "gen7"]] as const;
(async () => {
  let pairs = 0, differ = 0;
  for (const [game, mod] of GAMES) {
    const runtime = await loadBattleRuntime(game);
    const dex = Dex.mod(mod);
    const paradox = usesHelpers(runtime).paradox;
    const items = runtime.catalog.items.map((entry) => dex.items.get(entry.id)).filter((item: any) => item.exists && item.onTakeItem);
    const lines: string[] = [];
    for (const item of items) {
      const kept: string[] = [];
      for (const species of runtime.catalog.species) {
        const dexSpecies = dex.species.get(species.name);
        const pokemon = { baseSpecies: dexSpecies, species: dexSpecies };
        let showdown: boolean;
        try {
          const result = typeof item.onTakeItem === "function" ? item.onTakeItem.call({ effectState: {} }, item, pokemon, pokemon, dex.moves.get("fling")) : item.onTakeItem;
          showdown = result !== false;
        } catch (error) {
          lines.push(`  ERROR ${item.id} / ${species.id}: ${(error as Error).message}`);
          continue;
        }
        const app = itemTakeable(runtime, paradox, item.id, species.id, species.id, false);
        pairs++;
        if (app !== showdown) { differ++; lines.push(`  DIFF ${item.name} held by ${species.name}: Showdown ${showdown ? "takeable" : "kept"}, app ${app ? "takeable" : "kept"}`); }
        if (!showdown) kept.push(species.id);
      }
      lines.push(`  ${item.name}: kept by ${kept.length ? kept.join(", ") : "nobody"}`);
    }
    console.log(`== ${game}: ${items.length} items with onTakeItem`);
    for (const line of lines) console.log(line);
  }
  console.log(`TakeItem: ${pairs} item/species pairs, ${differ} differ`);
})();
