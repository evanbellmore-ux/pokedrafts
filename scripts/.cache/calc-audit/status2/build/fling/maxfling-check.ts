// Track F: the replacement expectations for calculator-max-fling.test.ts's first test (needsFromIntegrator).
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";
(async () => {
  const R = await loadBattleRuntime("sword_shield");
  const b = (id: string, ability: string, item: string, hp: number | null, dyn?: boolean) => ({ ...createBuild(id, R), nature: "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: item, currentHP: hp, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...(dyn ? { mechanic: "dynamax" } : {}) } as BattleBuild);
  for (const [id, ab] of [["weavile", "pressure"], ["bisharp", "defiant"]]) {
    const r = calculateMatchup(b(id, ab, "ironball", null, true), b("hawlucha", "limber", "figyberry", 84), { ...createConditions(), gameType: "Singles" }, {}, R).results.find((x) => x.moveId === "fling")!;
    console.log(id, r.effectiveName, r.min, r.max, JSON.stringify(r.usesToKO), JSON.stringify({ ...r.afterUse, paths: undefined }));
  }
})();
