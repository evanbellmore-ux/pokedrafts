import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Knock Off's 1.5x needs an item it can remove. Pinned Showdown c23d2e94's Mega Stones refuse
 * TakeItem for the holder's whole family (data/items.ts onTakeItem), so a regional form holding its
 * family's stone gets no boost; the engine checks only the exact form. Champions, level 50,
 * 0 Stat Points, Serious nature, Singles. fix25/verify.ts and items/knockoff-stones.ts (167 cases).
 */
function build(id: string, itemId: string): BattleBuild {
  return { ...createBuild(id), itemId } as BattleBuild;
}
function row(defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup({ ...createBuild("absol"), abilityId: "pressure" } as BattleBuild, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, championsRuntime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === "knockoff")!;
}

describe("Knock Off into a Mega Stone", () => {
  it("gets no boost when the stone belongs to the target's family", () => {
    const raichu = row(build("raichualola", "raichunitex"));
    expect(raichu).toMatchObject({ effectiveName: "Knock Off", min: 158, max: 188 });
    expect(raichu.assumptions).toContain("Knock Off: no power boost (the target's Raichunite X cannot be removed).");
    expect(row(build("slowbrogalar", "slowbronite"))).toMatchObject({ min: 98, max: 116 });
    expect(row(build("slowbrogalar", "slowbronite"), { magicRoom: true })).toMatchObject({ min: 98, max: 116 });
    expect(row(build("charizard", "charizarditex"))).toMatchObject({ min: 57, max: 67 });
  });

  it("gets no boost into a Paradox Pokémon's Booster Energy (Scarlet/Violet)", async () => {
    const { loadBattleRuntime } = await import("@/app/lib/battle/load-runtime");
    const sv = await loadBattleRuntime("scarlet_violet");
    const weavile = { ...createBuild("weavile", sv), abilityId: "pressure" } as BattleBuild;
    const knock = (id: string, itemId: string, field: Partial<BattleConditions>) => calculateMatchup(weavile, { ...createBuild(id, sv), itemId } as BattleBuild,
      { ...createConditions(), gameType: "Singles", ...field }, {}, sv).results.find((result) => result.moveId === "knockoff")!;
    expect(knock("greattusk", "boosterenergy", { weather: "Sun" })).toMatchObject({ min: 17, max: 21 });
    expect(knock("greattusk", "leftovers", { weather: "Sun" })).toMatchObject({ min: 25, max: 30 });
    expect(knock("ironhands", "boosterenergy", { terrain: "Electric" })).toMatchObject({ min: 21, max: 24 });
  });

  it("is boosted into a transformed Ditto, which keeps its own species", () => {
    const ditto = (itemId: string) => ({ ...createBuild("ditto"), abilityId: "imposter", abilityActive: true, itemId }) as BattleBuild;
    const knock = (attacker: string, abilityId: string, itemId: string) => calculateMatchup({ ...createBuild(attacker), abilityId } as BattleBuild, ditto(itemId),
      { ...createConditions(), gameType: "Singles" }, {}, championsRuntime).results.find((result) => result.moveId === "knockoff")!;
    const raichu = knock("raichualola", "surgesurfer", "raichunitex");
    expect(raichu).toMatchObject({ min: 112, max: 132 });
    expect(raichu.assumptions).toContain("Knock Off: boosted power (the transformed target's Raichunite X can be removed).");
    expect(knock("absol", "pressure", "absolite")).toMatchObject({ min: 51, max: 61 });
  });

  it("is boosted when the stone can be removed", () => {
    const garchomp = row(build("garchomp", "charizarditex"));
    expect(garchomp).toMatchObject({ min: 72, max: 85 });
    expect(garchomp.assumptions.join(" ")).not.toContain("cannot be removed");
  });
});
