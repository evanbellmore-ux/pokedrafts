// FAMILY 4: catalog lookups the case list needs (read-only). npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-q-catalog.ts
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  for (const game of ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
    const R = await loadBattleRuntime(game);
    const sp = R.catalog.species as any[];
    const by = (ability: string) => sp.filter((s) => s.abilities.includes(ability)).map((s) => s.id).slice(0, 8).join(",") || "-";
    const learn = (move: string) => sp.filter((s) => s.moves.includes(move)).map((s) => s.id).slice(0, 8).join(",") || "-";
    console.log(`\n${game}: defiant ${by("defiant")} | competitive ${by("competitive")} | emergencyexit ${by("emergencyexit")} | harvest ${by("harvest")} | pickup ${by("pickup")} | spicyspray ${by("spicyspray")} | liquidooze ${by("liquidooze")}`);
    console.log(`  bulldoze ${learn("bulldoze")} | glaiverush ${learn("glaiverush")} | matchagotcha ${learn("matchagotcha")} | paraboliccharge ${learn("paraboliccharge")} | sheercold ${learn("sheercold")} | guillotine ${learn("guillotine")} | fling ${learn("fling")} | punishment ${learn("punishment")} | storedpower ${learn("storedpower")} | encore ${learn("encore")} | round ${learn("round")}`);
    console.log(`  items: ejectbutton ${R.itemsById.has("ejectbutton")} redcard ${R.itemsById.has("redcard")} ejectpack ${R.itemsById.has("ejectpack")} mirrorherb ${R.itemsById.has("mirrorherb")} shellbell ${R.itemsById.has("shellbell")} bigroot ${R.itemsById.has("bigroot")} flameorb ${R.itemsById.has("flameorb")} ironball ${R.itemsById.has("ironball")} focusband ${R.itemsById.has("focusband")} lifeorb ${R.itemsById.has("lifeorb")}`);
  }
})();
