// Split Dragon Darts and the Tera 60-power floor, against real pinned-Showdown c23d2e94 Doubles battles (audit oos/darts-floor/testvals.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

let sv: BattleRuntime;
beforeAll(async () => { sv = await loadBattleRuntime("scarlet_violet"); });

function build(id: string, abilityId: string, extra: Record<string, unknown> = {}): BattleBuild {
  const base = createBuild(id, sv);
  if (base.game === "champions") throw new Error("native builds only");
  return { ...base, abilityId, native: { ...base.native, evs: { ...base.native.evs, atk: 252 } }, ...extra } as BattleBuild;
}
const tera = (id: string, abilityId: string, teraType: string) => build(id, abilityId, { mechanic: "tera", configuration: { teraType } });
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), ...field }, context ? { [moveId]: context } : {}, sv);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const DART = [78, 78, 80, 80, 80, 82, 82, 84, 84, 86, 86, 88, 88, 90, 90, 92];

describe("split Dragon Darts and the Tera 60-power floor", () => {
  it("keeps one dart at 50 power, as Showdown skips the floor for every multi-hit move", () => {
    const snorlax = { ...createBuild("snorlax", sv), abilityId: "thickfat" } as BattleBuild;
    const split = row("dragondarts", tera("dragapult", "clearbody", "Dragon"), snorlax);
    expect(split).toMatchObject({ kind: "calculated", min: 78, max: 92, hits: 1, effectivePower: 50, rolls: DART });
    expect(row("dragondarts", tera("dragapult", "clearbody", "Stellar"), snorlax, {}, { stellarFirstUse: true }))
      .toMatchObject({ min: 78, max: 92, hits: 1, effectivePower: 50 });
    expect(row("dragondarts", tera("dragapult", "clearbody", "Stellar"), snorlax, {}, { stellarFirstUse: false }))
      .toMatchObject({ min: 58, max: 69, hits: 1, effectivePower: 50 });
    expect(row("dragondarts", tera("smeargle", "owntempo", "Dragon"), snorlax)).toMatchObject({ min: 25, max: 30, effectivePower: 50 });
    // The KO chance reads the corrected rolls: 9 of 16 reach 84 HP (all 16 did at the floored 92-110).
    expect(row("dragondarts", tera("dragapult", "clearbody", "Dragon"), { ...snorlax, currentHP: 84 }).ohkoChance).toBe(9 / 16);
    // Both darts on the target (toggle off, or Singles) never had the floor.
    for (const field of [{ multipleTargets: false }, { gameType: "Singles" as const }]) {
      expect(row("dragondarts", tera("dragapult", "clearbody", "Dragon"), snorlax, field)).toMatchObject({ min: 156, max: 184, hits: 2, rolls: [DART, DART] });
    }
  });
});
