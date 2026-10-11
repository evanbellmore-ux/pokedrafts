// Track A3 helper: the berries (and a few items) of each game's catalog.
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
    const rt = await loadBattleRuntime(game);
    const ids = [...rt.itemsById.keys()];
    console.log(game, "berries:", ids.filter((id) => id.endsWith("berry")).join(" "));
    console.log(game, "has:", ["airballoon", "choicescarf", "lifeorb", "leftovers", "electricseed", "roomservice", "whiteherb", "mentalherb", "boosterenergy", "stickybarb", "utilityumbrella"].filter((id) => rt.itemsById.has(id)).join(" "));
  }
})();
