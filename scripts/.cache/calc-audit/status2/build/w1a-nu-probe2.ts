import { loadBattleRuntime } from "../../../../../app/lib/battle/load-runtime";
import { unmodelledBattleStates, unmodelledDoublesStates } from "../../../../../app/lib/battle/unmodelled-states";
(async () => {
  for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
    const r = await loadBattleRuntime(game);
    console.log(game, "\n 1v1:", unmodelledBattleStates(r), "\n 2v2:", unmodelledDoublesStates(r));
  }
})();
