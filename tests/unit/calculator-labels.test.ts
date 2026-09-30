import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Result labels: the real base power, an accurate Applied list and notes, receiving-side ability
 * lines, and success conditions. Champions, level 50, 0 Stat Points, Serious nature, Singles. The
 * damage in each case matches pinned Showdown c23d2e94 (audit gap-claims-and-guards-ledger/copy-repro.ts,
 * moves/repro.ts moves-12 and moves-14).
 */
function build(id: string, abilityId: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id), abilityId, ...extra } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

describe("result labels", () => {
  it("shows the base power Showdown uses", () => {
    const knockOff = row("knockoff", build("absol", "pressure"), build("garchomp", "roughskin", { itemId: "leftovers" }));
    expect(knockOff.effectivePower).toBe(97);
    expect(knockOff.assumptions).toContain("Move power reported by the engine: 97.");
    const axel = row("tripleaxel", build("gallade", "sharpness"), build("garchomp", "roughskin"));
    expect(axel).toMatchObject({ effectivePower: 20, hits: 3 });
    expect(axel.assumptions).toContain("Power per hit: 20, 40, 60.");
  });

  it("lists what changed the damage and notes what the engine does silently", () => {
    const crit = row("dragonclaw", build("garchomp", "roughskin"), build("slowbromega", "shellarmor"), { critical: true });
    expect(crit).toMatchObject({ min: 34, max: 42 });
    expect(crit.assumptions).toContain("The target's Shell Armor prevents the critical hit.");
    const screen = row("shadowball", build("chandeluremega", "infiltrator"), build("garchomp", "roughskin"),
      { defenderSide: { ...createConditions().defenderSide, lightScreen: true } });
    expect(screen).toMatchObject({ min: 84, max: 100 });
    expect(screen.assumptions).toContain("Infiltrator ignores the target's Light Screen.");
    const seed = row("dragonclaw", build("garchomp", "roughskin"), build("baxcalibur", "thermalexchange", { itemId: "grassyseed" }), { terrain: "Grassy" });
    expect(seed).toMatchObject({ min: 84, max: 98 });
    expect(seed.assumptions).toContain("The target Baxcalibur's Grassy Seed is used up on Grassy Terrain, raising its Defense.");
    // Mold Breaker is listed only when ignoring the target's ability changed the damage or the KO chance.
    expect(row("brickbreak", build("tinkaton", "moldbreaker"), build("politoed", "waterabsorb")).description).not.toContain("Mold Breaker");
    const sturdy = row("earthquake", build("excadrill", "moldbreaker"), build("aggron", "sturdy"));
    expect(sturdy).toMatchObject({ min: 180, max: 216, ohkoChance: 1 });
    expect(sturdy.description).toContain("Applied: Mold Breaker.");
    expect(sturdy.assumptions).toContain("Mold Breaker ignores the target's Sturdy.");
    expect(row("earthquake", build("excadrill", "sandrush"), build("aggron", "sturdy")).ohkoChance).toBe(0);
    // An intact Disguise is checked by the calculator, so breaking through it is stated.
    const disguise = row("ironhead", build("excadrill", "moldbreaker"), build("mimikyu", "disguise"));
    expect(disguise).toMatchObject({ kind: "calculated", min: 140, max: 168 });
    expect(disguise.description).toContain("Applied: Mold Breaker.");
    expect(disguise.assumptions).toContain("Mold Breaker ignores the target's intact Disguise.");
  });

  it("respects Ability Shield on Disguise and never credits a move that cannot hit", async () => {
    // Ability Shield keeps Disguise working against Mold Breaker (Scarlet/Violet).
    const sv = await loadBattleRuntime("scarlet_violet");
    const mimikyu = { ...createBuild("mimikyu", sv), abilityId: "disguise", itemId: "abilityshield" } as BattleBuild;
    expect(row("ironhead", { ...createBuild("excadrill", sv), abilityId: "moldbreaker" } as BattleBuild, mimikyu, {}, sv).kind).toBe("needs-context");
    // A Normal move cannot hit Ghost-type Mimikyu, so Mold Breaker changed nothing.
    const slam = row("bodyslam", build("excadrill", "moldbreaker"), build("mimikyu", "disguise"));
    expect(slam).toMatchObject({ min: 0, max: 0 });
    expect(slam.description).not.toContain("Mold Breaker");
    expect(slam.assumptions.join(" ")).not.toContain("Disguise");
  });

  it("keeps Mold Breaker for a Friend Guard partner and drops an Ability Shield that changed nothing", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const svBuild = (id: string, abilityId: string, extra: Partial<BattleBuild> = {}) => ({ ...createBuild(id, sv), abilityId, ...extra } as BattleBuild);
    const guarded = row("brickbreak", svBuild("tinkaton", "moldbreaker"), svBuild("politoed", "waterabsorb"),
      { gameType: "Doubles", defenderSide: { ...createConditions().defenderSide, friendGuard: true } }, sv);
    expect(guarded).toMatchObject({ min: 29, max: 35 });
    expect(guarded.description).toContain("Applied: Mold Breaker.");
    const shield = row("brickbreak", svBuild("tinkaton", "moldbreaker"), svBuild("politoed", "waterabsorb", { itemId: "abilityshield" }), {}, sv);
    expect(shield).toMatchObject({ min: 29, max: 35 });
    expect(shield.description).not.toContain("Ability Shield");
    // It stays when the ability it kept mattered.
    expect(row("playrough", svBuild("tinkaton", "moldbreaker"), svBuild("dragonite", "multiscale", { itemId: "abilityshield" }), {}, sv).description)
      .toContain("Ability Shield");
    // Knock Off still sees the item: the shield's Water Absorb changed nothing.
    expect(row("knockoff", svBuild("tinkaton", "moldbreaker"), svBuild("politoed", "waterabsorb", { itemId: "abilityshield" }), {}, sv).description).not.toContain("Ability Shield");
    // Mold Breaker ignoring a Friend Guard partner of a target whose own ability it cannot break.
    const partner = row("ironhead", svBuild("excadrill", "moldbreaker"), svBuild("charizard", "blaze"),
      { gameType: "Doubles", defenderSide: { ...createConditions().defenderSide, friendGuard: true } }, sv);
    expect(partner.description).toContain("Applied: Mold Breaker.");
  });

  it("words ability conditions for the side they affect", () => {
    const stakeout = row("dragonclaw", build("garchomp", "roughskin"), build("mabosstiff", "stakeout", { abilityActive: true }));
    expect(stakeout.assumptions.join(" ")).not.toContain("switched in");
    const flashFire = row("flamethrower", build("arcanine", "flashfire", { abilityActive: true }), build("garchomp", "roughskin"));
    expect(flashFire.assumptions).toContain("Attacker: Flash Fire has been activated — yes.");
    const gyro = row("gyroball", build("avalugg", "owntempo"), build("hawlucha", "unburden", { itemId: "", abilityActive: true }));
    expect(gyro.assumptions).toContain("Target: Unburden has been activated — yes.");
  });

  it("states success conditions", () => {
    const upperHand = row("upperhand", build("lucario", "innerfocus"), build("garchomp", "roughskin"));
    expect(upperHand.assumptions).toContain("Assumes Upper Hand succeeds: the target is about to use a priority attacking move this turn.");
  });

  it("states Shell Trap's condition", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const shellTrap = row("shelltrap", { ...createBuild("turtonator", usum), abilityId: "shellarmor" } as BattleBuild, { ...createBuild("garchomp", usum), abilityId: "roughskin" } as BattleBuild, {}, usum);
    expect(shellTrap).toMatchObject({ min: 45, max: 53 });
    expect(shellTrap.assumptions).toContain("Assumes Shell Trap succeeds: an opposing Pokémon's physical move hits the user earlier this turn.");
  });
});
