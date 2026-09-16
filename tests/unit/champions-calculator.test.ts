import { describe, expect, it } from "vitest";
import { champions, movesById, speciesById } from "@/app/lib/battle/catalog";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

function row(
  moveId: string,
  attacker = createBuild(),
  defender = createBuild("blastoise"),
  field = createConditions(),
  contexts: Record<string, MoveContext> = {},
) {
  const result = calculateMatchup(attacker, defender, field, contexts);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const move = result.results.find((entry) => entry.moveId === moveId);
  expect(move, `${attacker.speciesId} must have ${moveId} in its Champions learnset`).toBeDefined();
  return move!;
}

function fireMatchup(): [BattleBuild, BattleBuild, BattleConditions] {
  const attacker = createBuild("charizard");
  attacker.nature = "Timid";
  attacker.points = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
  return [attacker, createBuild("venusaur"), createConditions()];
}

function learns(moveId: string) {
  const species = champions.species.find((entry) => !entry.unsupported.length && entry.moves.includes(moveId));
  expect(species, `A supported species must learn ${moveId}`).toBeDefined();
  return createBuild(species!.id);
}

describe("Champions calculation adapter", () => {
  it("matches independently worked STAB/type rolls and counts single-hit KO rolls", () => {
    // Level 50, power 90, SpA 161, SpD 120: base damage 55.
    // Apply each 85–100 random roll, Fire STAB (half down), then Grass weakness.
    const damage = row("flamethrower", ...fireMatchup());
    expect(damage.kind).toBe("calculated");
    expect(damage.rolls).toEqual([138, 140, 140, 144, 144, 146, 150, 150, 152, 152, 156, 156, 158, 158, 162, 164]);
    expect([damage.min, damage.max]).toEqual([138, 164]);
    expect(damage.minPercent).toBeCloseTo(138 / 155 * 100);
    expect(damage.ohkoChance).toBe(6 / 16);
  });

  it("uses current HP for KO but maximum HP for percentages; ignores end-of-turn damage", () => {
    const [attacker, defender, field] = fireMatchup();
    defender.currentHP = 140;
    defender.status = "tox";
    const damage = row("flamethrower", attacker, defender, field);
    expect(damage.ohkoChance).toBe(15 / 16);
    expect(damage.minPercent).toBeCloseTo(138 / 155 * 100);
    defender.currentHP = null;
    expect(row("flamethrower", attacker, defender, field).ohkoChance).toBe(6 / 16);
  });

  it("respects full-HP Focus Sash without capping potential damage", () => {
    const [attacker, defender, field] = fireMatchup();
    defender.itemId = "focussash";
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ max: 164, ohkoChance: 0 });
    defender.currentHP = 140;
    expect(row("flamethrower", attacker, defender, field).ohkoChance).toBe(15 / 16);
  });

  it("respects Sturdy and its Mold Breaker bypass", () => {
    const attacker = createBuild("excadrill");
    attacker.boosts.atk = 6;
    attacker.abilityId = "sandrush";
    const defender = createBuild("aggron");
    defender.abilityId = "sturdy";
    expect(row("earthquake", attacker, defender).ohkoChance).toBe(0);
    attacker.abilityId = "moldbreaker";
    expect(row("earthquake", attacker, defender).ohkoChance).toBe(1);
  });

  it("withholds Focus Band KO probability instead of claiming certainty", () => {
    const [attacker, defender, field] = fireMatchup();
    defender.itemId = "focusband";
    expect(row("flamethrower", attacker, defender, field).ohkoChance).toBeNull();
  });

  it("maps weather, screens, crits and Helping Hand to the engine", () => {
    const [attacker, defender, field] = fireMatchup();
    field.weather = "Rain";
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ min: 66, max: 80 });
    field.weather = "";
    field.gameType = "Singles";
    field.defenderSide.lightScreen = true;
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ min: 69, max: 82 });
    field.critical = true;
    expect(row("flamethrower", attacker, defender, field).min).toBeGreaterThan(138);
    field.critical = false;
    field.defenderSide.lightScreen = false;
    field.gameType = "Doubles";
    field.attackerSide.helpingHand = true;
    expect(row("flamethrower", attacker, defender, field).min).toBeGreaterThan(138);
  });

  it("keeps doubles screen rules when disabling the spread damage reduction", () => {
    const attacker = createBuild("blastoise");
    const defender = createBuild("charizard");
    const field = createConditions();
    const spread = row("surf", attacker, defender, field);
    field.multipleTargets = false;
    const oneTarget = row("surf", attacker, defender, field);
    expect(oneTarget.min).toBeGreaterThan(spread.min!);
    field.defenderSide.lightScreen = true;
    const doublesScreen = row("surf", attacker, defender, field);
    field.gameType = "Singles";
    expect(doublesScreen.min).toBeGreaterThan(row("surf", attacker, defender, field).min!);
  });

  it("distinguishes a genuine immunity from an unimplemented or status move", () => {
    const attacker = createBuild("gengar");
    const damage = row("shadowball", attacker, createBuild("audino"));
    expect(damage).toMatchObject({ kind: "calculated", min: 0, max: 0, ohkoChance: 0 });
    const status = row("protect", attacker);
    expect(status).toMatchObject({ kind: "status", min: null, max: null });
    const history = row("ragefist", learns("ragefist"));
    expect(history).toMatchObject({ kind: "needs-context", min: null, max: null });
    expect(row("growth", learns("growth"))).toMatchObject({ kind: "unsupported", min: null });
  });

  it("handles fixed damage and the target's type immunity", () => {
    const attacker = createBuild("gengar");
    const defender = createBuild("charizard");
    expect(row("nightshade", attacker, defender)).toMatchObject({ min: 50, max: 50, rolls: 50, ohkoChance: 0 });
    defender.currentHP = 50;
    expect(row("nightshade", attacker, defender).ohkoChance).toBe(1);
    expect(row("nightshade", attacker, createBuild("audino"))).toMatchObject({ min: 0, max: 0 });
  });

  it("does not assume a hidden hit count or claim multi-hit KO probabilities", () => {
    const attacker = createBuild("chesnaught");
    const defender = createBuild("blastoise");
    expect(row("bulletseed", attacker, defender).kind).toBe("needs-context");
    const two = row("bulletseed", attacker, defender, createConditions(), { bulletseed: { hits: 2 } });
    const five = row("bulletseed", attacker, defender, createConditions(), { bulletseed: { hits: 5 } });
    expect(two.kind).toBe("calculated");
    expect(five.min).toBeGreaterThan(two.max!);
    expect(five.ohkoChance).toBeNull();
    expect(five.rolls).not.toBeNull();
    for (const hits of [0, 1, 6, 2.5, Number.NaN]) {
      expect(row("bulletseed", attacker, defender, createConditions(), { bulletseed: { hits } }).kind).toBe("needs-context");
    }
    // Loaded Dice is not available in this pinned Champions snapshot.
    attacker.itemId = "loadeddice";
    const unavailableItem = calculateMatchup(attacker, defender, createConditions());
    expect(unavailableItem.results).toEqual([]);
    expect(unavailableItem.issues.attacker).toContainEqual(expect.objectContaining({ field: "itemId" }));
  });

  it("uses Skill Link's fixed maximum hit count", () => {
    const attacker = createBuild("heracrossmega");
    expect(row("bulletseed", attacker)).toMatchObject({ kind: "calculated", hits: 5, ohkoChance: null });
  });

  it("uses the named ability activation rather than disabling the whole ability", () => {
    const attacker = createBuild("arcanine");
    attacker.abilityId = "flashfire";
    const inactive = row("flamethrower", attacker);
    attacker.abilityActive = true;
    expect(row("flamethrower", attacker).min).toBeGreaterThan(inactive.min!);
  });

  it("uses Blade stats for a Stance Change attack without mutating the selected build", () => {
    const shield = createBuild("aegislash");
    const blade = createBuild("aegislashblade");
    const before = structuredClone(shield);
    const damage = row("shadowball", shield);
    expect(damage.kind).toBe("calculated");
    expect(damage.rolls).toEqual(row("shadowball", blade).rolls);
    expect(damage.assumptions).toContain("Stance Change uses Blade Forme for this damaging attack.");
    expect(shield).toEqual(before);
  });

  it("does not silently ignore intact Disguise or unsupported targeting context", () => {
    expect(row("flamethrower", createBuild(), createBuild("mimikyu")).kind).toBe("needs-context");
    expect(row("flamethrower", createBuild(), createBuild("mimikyubusted")).kind).toBe("calculated");
    const field = createConditions();
    field.terrain = "Psychic";
    field.multipleTargets = false;
    expect(row("expandingforce", learns("expandingforce"), createBuild("blastoise"), field).kind).toBe("unsupported");
  });

  it("reports Snore's known failure as zero and can calculate it while asleep", () => {
    const attacker = createBuild("charizard");
    expect(row("snore", attacker)).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    attacker.status = "slp";
    expect(row("snore", attacker).min).toBeGreaterThan(0);
  });

  it("accounts for every learnset entry exactly once and never mutates its inputs", () => {
    const [attacker, defender, field] = fireMatchup();
    const before = structuredClone({ attacker, defender, field });
    const first = calculateMatchup(attacker, defender, field);
    const second = calculateMatchup(attacker, defender, field);
    expect(second).toEqual(first);
    expect({ attacker, defender, field }).toEqual(before);
    expect(first.results.map((entry) => entry.moveId)).toEqual(speciesById.get(attacker.speciesId)?.moves);
    for (const damage of first.results) {
      expect(movesById.has(damage.moveId)).toBe(true);
      if (damage.kind !== "calculated") expect([damage.min, damage.max, damage.rolls, damage.ohkoChance]).toEqual([null, null, null, null]);
    }
  });

  it("does not invent genders or fainted-party history for damage-modifying abilities", () => {
    const rivalry = createBuild("luxray");
    rivalry.abilityId = "rivalry";
    expect(row("thunderbolt", rivalry)).toMatchObject({ kind: "needs-context", min: null, ohkoChance: null });
    const overlord = createBuild("kingambit");
    overlord.abilityId = "supremeoverlord";
    expect(row("kowtowcleave", overlord)).toMatchObject({ kind: "needs-context", min: null, ohkoChance: null });
  });

  it("requires unused Protean/Libero and unchanged typing on either side", () => {
    for (const speciesId of ["greninja", "cinderace"]) {
      const build = createBuild(speciesId);
      build.abilityId = speciesId === "greninja" ? "protean" : "libero";
      build.abilityActive = false;
      const attacking = calculateMatchup(build, createBuild(), createConditions());
      const defending = calculateMatchup(createBuild(), build, createConditions());
      expect(attacking.results).toEqual([]);
      expect(defending.results).toEqual([]);
      expect(attacking.issues.attacker).toContainEqual(expect.objectContaining({ field: "abilityActive" }));
      expect(defending.issues.defender).toContainEqual(expect.objectContaining({ field: "abilityActive" }));
      build.abilityActive = true;
      expect(calculateMatchup(build, createBuild(), createConditions()).issues.attacker).toEqual([]);
    }
  });

  it("resolves Gale Wings priority before grounded terrain and Armor Tail immunities", () => {
    const attacker = createBuild("talonflame");
    attacker.abilityId = "galewings";
    const defender = createBuild("venusaur");
    defender.currentHP = 50;
    const field = createConditions();
    field.terrain = "Psychic";
    expect(row("bravebird", attacker, defender, field)).toMatchObject({ min: 0, max: 0, ohkoChance: 0 });
    // Flying targets are not protected by Psychic Terrain.
    expect(row("bravebird", attacker, createBuild("charizard"), field).min).toBeGreaterThan(0);
    field.terrain = "";
    const armorTail = createBuild("farigiraf");
    armorTail.abilityId = "armortail";
    expect(row("bravebird", attacker, armorTail, field)).toMatchObject({ min: 0, max: 0, ohkoChance: 0 });
    attacker.currentHP = 100;
    expect(row("bravebird", attacker, armorTail, field).min).toBeGreaterThan(0);
    field.terrain = "Psychic";
    expect(row("bravebird", attacker, defender, field).min).toBeGreaterThan(0);
  });

  it("does not claim explosion damage or a KO through Damp", () => {
    const attacker = createBuild("forretress");
    const defender = createBuild("swampert");
    defender.abilityId = "damp";
    defender.currentHP = 50;
    expect(row("explosion", attacker, defender)).toMatchObject({ kind: "calculated", min: 0, max: 0, ohkoChance: 0 });
    expect(row("selfdestruct", createBuild("starmie"), defender)).toMatchObject({ min: 0, max: 0, ohkoChance: 0 });
    defender.abilityId = "torrent";
    expect(row("explosion", attacker, defender).min).toBeGreaterThan(0);
  });

  it("suspends results for invalid inputs rather than retaining a prior damage value", () => {
    const [attacker, defender, field] = fireMatchup();
    attacker.points.spa = null;
    defender.currentHP = Number.NaN;
    const result = calculateMatchup(attacker, defender, field);
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toContainEqual(expect.objectContaining({ field: "points.spa" }));
    expect(result.issues.defender).toContainEqual(expect.objectContaining({ field: "currentHP" }));
  });
});
