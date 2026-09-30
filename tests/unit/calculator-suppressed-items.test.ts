import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * A held item that Magic Room or Klutz only suppresses, against pinned Showdown c23d2e94's useMove
 * pipeline: Acrobatics (basePowerCallback) and Poltergeist (onTry) look at the held item itself.
 * Level 50, 0 Stat Points/EVs, 31 IVs, Serious nature, Singles, no crit. fix22/verify.ts checks 224
 * cases across the four games.
 */
function build(id: string, abilityId: string, itemId = "", runtime: BattleRuntime = championsRuntime): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, itemId } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const garchomp = build("garchomp", "roughskin");

describe("items suppressed by Magic Room or Klutz", () => {
  it("keep Acrobatics at its usual power", () => {
    const klutz = row("acrobatics", build("lopunny", "klutz", "leftovers"), garchomp);
    expect(klutz).toMatchObject({ kind: "calculated", effectivePower: 55, min: 18, max: 22 });
    expect(klutz.assumptions).toContain("Klutz suppresses the attacker's Leftovers, but it is still held, so Acrobatics keeps its usual power.");
    expect(row("acrobatics", build("lopunny", "klutz"), garchomp)).toMatchObject({ effectivePower: 110, min: 35, max: 42 });
    expect(row("acrobatics", build("altaria", "naturalcure", "leftovers"), garchomp, { magicRoom: true })).toMatchObject({ effectivePower: 55, min: 25, max: 30 });
  });

  it("let Poltergeist hit", () => {
    const golurk = row("poltergeist", build("aegislash", "stancechange"), build("golurk", "klutz", "sitrusberry"));
    expect(golurk).toMatchObject({ min: 200, max: 236 });
    expect(golurk.assumptions).toContain("Klutz suppresses the target's Sitrus Berry, but it is still held, so Poltergeist hits.");
    expect(row("poltergeist", build("aegislash", "stancechange"), build("golurk", "klutz"))).toMatchObject({ min: 0, max: 0 });
    expect(row("poltergeist", build("aegislash", "stancechange"), build("garchomp", "roughskin", "leftovers"), { magicRoom: true })).toMatchObject({ min: 87, max: 103 });
  });

  it("keep the move's own name, so it is not shown as a Z-Move or Max Move", () => {
    expect(row("acrobatics", build("lopunny", "klutz", "leftovers"), garchomp).effectiveName).toBe("Acrobatics");
    expect(row("poltergeist", build("aegislash", "stancechange"), build("golurk", "klutz", "sitrusberry")).effectiveName).toBe("Poltergeist");
  });

  it("work normally when the other battler's Neutralizing Gas suppresses Klutz (Sword/Shield)", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const weezing = build("weezinggalar", "neutralizinggas", "", swsh);
    // Choice Band now applies, and Acrobatics keeps 55 power because the band is held.
    const band = row("acrobatics", build("lopunny", "klutz", "choiceband", swsh), weezing, {}, swsh);
    expect(band).toMatchObject({ effectivePower: 55, min: 22, max: 26 });
    expect(band.assumptions.join(" ")).not.toContain("Klutz suppresses");
    expect(row("bounce", build("lopunny", "klutz", "choiceband", swsh), weezing, {}, swsh)).toMatchObject({ min: 34, max: 40 });
    // A Seed on its terrain is used up, so Acrobatics doubles.
    expect(row("acrobatics", build("swoobat", "klutz", "grassyseed", swsh), weezing, { terrain: "Grassy" }, swsh)).toMatchObject({ effectivePower: 110, min: 34, max: 42 });
  });

  it("name only what suppresses the item", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    // Klutz never suppresses Macho Brace or the Power items.
    const brace = row("acrobatics", build("lopunny", "klutz", "machobrace", swsh), build("garchomp", "roughskin", "", swsh), {}, swsh);
    expect(brace).toMatchObject({ effectivePower: 55, min: 18, max: 22 });
    expect(brace.assumptions.join(" ")).not.toContain("suppresses");
    const sv = await loadBattleRuntime("scarlet_violet");
    const shield = row("poltergeist", build("banette", "insomnia", "", sv), build("golurk", "klutz", "abilityshield", sv), {}, sv);
    expect(shield).toMatchObject({ min: 168, max: 200 });
    expect(shield.assumptions).toContain("Klutz does not affect the target's Ability Shield, so Poltergeist hits.");
    // A Klutz holder's Seed never activates, whichever came first.
    const klutzSeed = row("acrobatics", build("lopunny", "klutz", "grassyseed"), garchomp, { terrain: "Grassy", magicRoom: true });
    expect(klutzSeed.assumptions.join(" ")).toContain("Magic Room and Klutz suppress the attacker's Grassy Seed");
    expect(klutzSeed.assumptions.join(" ")).not.toContain("otherwise the Seed was used up");
    // A Seed that does not match the terrain needs no order sentence.
    expect(row("acrobatics", build("altaria", "naturalcure", "electricseed"), garchomp, { terrain: "Grassy", magicRoom: true }).assumptions.join(" ")).not.toContain("otherwise the Seed");
  });

  it("treat a Seed on its terrain under Magic Room as used before the room unless its switch says otherwise", async () => {
    // Used on entry before the room (the default): no item, so Acrobatics doubles.
    expect(row("acrobatics", build("altaria", "naturalcure", "grassyseed"), garchomp, { terrain: "Grassy", magicRoom: true })).toMatchObject({ effectivePower: 110, min: 49, max: 58 });
    const seeded = row("acrobatics", { ...build("altaria", "naturalcure", "grassyseed"), itemUsedBeforeRoom: false }, garchomp, { terrain: "Grassy", magicRoom: true });
    expect(seeded).toMatchObject({ effectivePower: 55, min: 25, max: 30 });
    expect(seeded.assumptions).toContain("The attacker Altaria's Grassy Seed is not used: Magic Room was up when it entered or when Grassy Terrain started. Tick its Grassy Seed choice if it was used before the room was set.");
    // Without Magic Room the Seed is used up, so Acrobatics doubles.
    expect(row("acrobatics", build("altaria", "naturalcure", "grassyseed"), garchomp, { terrain: "Grassy" })).toMatchObject({ effectivePower: 110, min: 49, max: 58 });
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(row("poltergeist", build("banette", "insomnia", "", sv), build("garchomp", "roughskin", "leftovers", sv), { magicRoom: true }, sv)).toMatchObject({ min: 73, max: 87 });
  });
});
