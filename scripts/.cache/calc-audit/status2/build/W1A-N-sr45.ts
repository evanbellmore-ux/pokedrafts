// Track N: tests/unit/doubles-start-rows.test.ts SR45 (two equal-Speed Lightning Rod holders, no entry order) through the
// engine the tsconfig maps (TSX_TSCONFIG_PATH): its reason today and with N-2 (W1A-N-int/tsconfig.c.json).
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";

(async () => {
  const runtime = await loadBattleRuntime("sword_shield");
  const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const build = (species: string, ability: string, spe: number): BattleBuild => ({
    ...createBuild(species, runtime), nature: "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: null, status: "", native: { level: 50, evs: { ...ZERO, spe }, ivs: IV31 },
  } as BattleBuild);
  const entry = (b: BattleBuild, moveId: string | null, target: DoublesSlotId | null = null): DoublesPokemonInput => ({ build: b, contexts: {}, charged: false, action: { moveId, target } });
  const result = calculateDoublesTurn({
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() },
    pokemon: {
      "own-left": entry(build("magnezone", "magnetpull", 0), "thunderbolt", "opponent-right"), "own-right": entry(build("manectric", "lightningrod", 40), null),
      "opponent-left": entry(build("raichu", "lightningrod", 0), null), "opponent-right": entry(build("snorlax", "thickfat", 4), null),
    },
  });
  console.log(result.status, "reason" in result ? result.reason : "");
})();
