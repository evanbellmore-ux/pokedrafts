// Track R-V: bench names as the app gives them (doublesBenchNames), for the expected reason texts.
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import { doublesBenchNames, doublesNames } from "@/app/lib/battle/doubles-types";
(async () => {
  for (const [game, ids] of [["scarlet_violet", ["weezinggalar", "tatsugiri", "ditto", "incineroar"]], ["sword_shield", ["weezinggalar"]]] as const) {
    const rt = await loadBattleRuntime(game);
    const lax = { build: createBuild("snorlax", rt) };
    const pokemon = { "own-left": lax, "own-right": lax, "opponent-left": lax, "opponent-right": lax };
    const bench = { own: ids.map((id) => ({ id, build: createBuild(id, rt) })) };
    console.log(game, JSON.stringify(doublesBenchNames(pokemon as any, bench, rt)), JSON.stringify(doublesNames(pokemon as any, rt)));
  }
})();
