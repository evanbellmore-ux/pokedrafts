import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/** Grassy Glide's +1 priority on Grassy Terrain against pinned Showdown c23d2e94 (ModifyPriority, then the blocking abilities). */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}
function row(attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions>, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === "grassyglide")!;
}
const NOTE = "Grassy Glide has +1 priority on Grassy Terrain because the user is grounded.";

describe("Grassy Glide", () => {
  const rillaboom = build("rillaboom", "overgrow");
  it("is blocked by Armor Tail and Queenly Majesty on Grassy Terrain", () => {
    const armorTail = row(rillaboom, build("farigiraf", "armortail"), { terrain: "Grassy" });
    expect(armorTail).toMatchObject({ min: 0, max: 0 });
    expect(armorTail.assumptions).toContain(NOTE);
    expect(row(rillaboom, build("tsareena", "queenlymajesty"), { terrain: "Grassy" })).toMatchObject({ min: 0, max: 0 });
    expect(row(rillaboom, build("tsareena", "queenlymajesty"), { terrain: "Grassy", gameType: "Doubles", multipleTargets: false })).toMatchObject({ min: 0, max: 0 });
    expect(row(rillaboom, build("farigiraf", "armortail"), { terrain: "" })).toMatchObject({ min: 51, max: 60 });
    expect(row(rillaboom, build("snorlax", "thickfat"), { terrain: "Grassy" })).toMatchObject({ min: 70, max: 84 });
  });

  it("needs a grounded user and blocks Dazzling in Scarlet/Violet", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(row(build("rillaboom", "overgrow", sv), build("bruxish", "dazzling", sv), { terrain: "Grassy" }, sv)).toMatchObject({ min: 0, max: 0 });
    const dartrix = build("dartrix", "overgrow", sv);
    const airborne = row(dartrix, build("tsareena", "queenlymajesty", sv), { terrain: "Grassy" }, sv);
    expect(airborne).toMatchObject({ min: 12, max: 15 });
    expect(airborne.assumptions).not.toContain(NOTE);
    expect(row(dartrix, build("tsareena", "queenlymajesty", sv), { terrain: "Grassy", gravity: true }, sv)).toMatchObject({ min: 0, max: 0 });
  });

  it("ignores Iron Ball and Air Balloon under Magic Room or Klutz, as Showdown's isGrounded does", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const tsareena = build("tsareena", "queenlymajesty", sv);
    const balloon = build("rillaboom", "overgrow", sv, { itemId: "airballoon" });
    expect(row(balloon, tsareena, { terrain: "Grassy" }, sv)).toMatchObject({ min: 19, max: 23 });
    const grounded = row(balloon, tsareena, { terrain: "Grassy", magicRoom: true }, sv);
    expect(grounded).toMatchObject({ min: 0, max: 0 });
    expect(grounded.assumptions).toContain(NOTE);
    const ironBall = build("dartrix", "overgrow", sv, { itemId: "ironball" });
    expect(row(ironBall, tsareena, { terrain: "Grassy" }, sv)).toMatchObject({ min: 0, max: 0 });
    const airborne = row(ironBall, tsareena, { terrain: "Grassy", magicRoom: true }, sv);
    expect(airborne).toMatchObject({ min: 12, max: 15 });
    expect(airborne.assumptions).not.toContain(NOTE);
    expect(row(build("capsakid", "klutz", sv, { itemId: "airballoon" }), tsareena, { terrain: "Grassy" }, sv)).toMatchObject({ min: 0, max: 0 });
    expect(row(build("capsakid", "chlorophyll", sv, { itemId: "airballoon" }), tsareena, { terrain: "Grassy" }, sv)).toMatchObject({ min: 11, max: 13 });
  });

  it("is not blocked for a Mold Breaker user", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ogerpon = build("ogerponhearthflame", "moldbreaker", sv);
    const farigiraf = row(ogerpon, build("farigiraf", "armortail", sv), { terrain: "Grassy" }, sv);
    expect(farigiraf).toMatchObject({ min: 76, max: 90 });
    expect(farigiraf.assumptions).toContain(NOTE);
  });

  it("leaves a Max Move made from it at priority 0 (Sword/Shield)", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const tsareena = build("tsareena", "queenlymajesty", swsh);
    const base = createBuild("rillaboom", swsh);
    const max = row({ ...base, abilityId: "overgrow", mechanic: "dynamax" } as BattleBuild, tsareena, { terrain: "Grassy" }, swsh);
    expect(max).toMatchObject({ effectiveName: "Max Overgrowth", min: 54, max: 64 });
    expect(max.assumptions).not.toContain(NOTE);
    const gmax = row({ ...base, abilityId: "overgrow", mechanic: "gigantamax", configuration: { ...base.configuration, gigantamax: true } } as BattleBuild, tsareena, { terrain: "Grassy" }, swsh);
    expect(gmax).toMatchObject({ effectiveName: "G-Max Drum Solo", min: 72, max: 85 });
    expect(gmax.assumptions).not.toContain(NOTE);
  });
});
