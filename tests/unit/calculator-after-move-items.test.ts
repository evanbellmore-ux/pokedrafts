import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * The engine's own multi-hit loop against pinned Showdown c23d2e94 (per-hit rolls, the target kept
 * alive): Kee Berry, Maranga Berry and White Herb act only after the whole move, and a Grassy Seed
 * reacts at once to Seed Sower's Grassy Terrain. Level 50, 0 Stat Points/EVs, 31 IVs, Serious
 * nature, Singles. fix17/multihit-sweep.ts checks 455 rows across the four games.
 */
function build(id: string, abilityId: string, itemId: string, runtime: BattleRuntime = championsRuntime): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, itemId } as BattleBuild;
}
function hits(defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(build("kangaskhanmega", "parentalbond", "kangaskhanite", runtime), defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  const row = out.results.find((result) => result.moveId === "doublehit")!;
  return (row.rolls as number[][]).map((hit) => `${hit[0]}-${hit[15]}`);
}

describe("multi-hit moves and items used after the move", () => {
  it("lets Weak Armor's drop land before White Herb acts", () => {
    expect(hits(build("skarmory", "weakarmor", "whiteherb"))).toEqual(["9-11", "14-17"]);
  });

  it("raises Defense only after the move for Kee Berry", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(hits(build("chansey", "naturalcure", "keeberry", usum), {}, usum)).toEqual(["115-136", "115-136"]);
  });

  it("uses a Grassy Seed as soon as Seed Sower sets Grassy Terrain", () => {
    const arboliva = build("arboliva", "seedsower", "grassyseed");
    expect(hits(arboliva)).toEqual(["27-33", "18-22"]);
    // Already on Grassy Terrain the Seed is used before the first hit; Magic Room stops it.
    expect(hits(arboliva, { terrain: "Grassy" })).toEqual(["18-22", "18-22"]);
    expect(hits(arboliva, { magicRoom: true })).toEqual(["27-33", "27-33"]);
  });
});
