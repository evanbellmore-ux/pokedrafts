import { describe, expect, it } from "vitest";
import { champions, movesById } from "@/app/lib/battle/catalog";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, SHARED_FIELD_EFFECTS } from "@/app/lib/battle/model";

function row(moveId: string, attacker = createBuild(), defender = createBuild("blastoise"), field = createConditions()) {
  const result = calculateMatchup(attacker, defender, field);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const move = result.results.find((entry) => entry.moveId === moveId);
  expect(move, `${attacker.speciesId} must learn ${moveId} in Champions`).toBeDefined();
  return move!;
}

function learns(moveId: string) {
  const species = champions.species.find((entry) => !entry.unsupported.length && entry.moves.includes(moveId));
  expect(species, `A supported Pokémon must learn ${moveId}`).toBeDefined();
  return createBuild(species!.id);
}

describe("Champions weather and side effects", () => {
  it("applies Sun and Rain to Fire and Water damage", () => {
    const attacker = createBuild("charizard");
    attacker.nature = "Timid";
    attacker.points = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    const defender = createBuild("venusaur");
    const field = createConditions();
    // Base damage 55; weather rounds before random rolls, STAB and Grass weakness.
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ min: 138, max: 164 });
    field.weather = "Sun";
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ min: 206, max: 246 });
    field.weather = "Rain";
    expect(row("flamethrower", attacker, defender, field)).toMatchObject({ min: 66, max: 80 });

    const water = createBuild("blastoise");
    const ordinary = row("surf", water, attacker);
    expect(row("surf", water, attacker, field).min).toBeGreaterThan(ordinary.min!);
    field.weather = "Sun";
    expect(row("surf", water, attacker, field).max).toBeLessThan(ordinary.max!);
  });

  it("boosts Rock special defense in Sand, not physical defense or non-Rock defense", () => {
    const attacker = createBuild();
    const rock = createBuild("aggron");
    const field = createConditions();
    const physical = row("bodyslam", attacker, rock);
    const nonRock = row("flamethrower", attacker);
    // Aggron's SpD 80 becomes 120; Fire is neutral against Rock/Steel.
    expect(row("flamethrower", attacker, rock)).toMatchObject({ min: 82, max: 97 });
    field.weather = "Sand";
    expect(row("flamethrower", attacker, rock, field)).toMatchObject({ min: 55, max: 66 });
    expect(row("bodyslam", attacker, rock, field).rolls).toEqual(physical.rolls);
    expect(row("flamethrower", attacker, createBuild("blastoise"), field).rolls).toEqual(nonRock.rolls);
  });

  it("boosts Ice physical defense in Snow without changing special or non-Ice defense", () => {
    const attacker = createBuild();
    const ice = createBuild("avalugg");
    const field = createConditions();
    const special = row("flamethrower", attacker, ice);
    const nonIce = row("bodyslam", attacker);
    // Avalugg's Def 204 becomes 306: neutral 85-power Body Slam base damage 21 → 14.
    expect(row("bodyslam", attacker, ice)).toMatchObject({ min: 17, max: 21 });
    field.weather = "Snow";
    expect(row("bodyslam", attacker, ice, field)).toMatchObject({ min: 11, max: 14 });
    expect(row("flamethrower", attacker, ice, field).rolls).toEqual(special.rolls);
    expect(row("bodyslam", attacker, createBuild("blastoise"), field).rolls).toEqual(nonIce.rolls);
  });

  it.each(["Singles", "Doubles"] as const)("applies the right screen category, Veil non-stacking and critical bypass in %s", (gameType) => {
    for (const [moveId, screen, otherScreen] of [["bodyslam", "reflect", "lightScreen"], ["flamethrower", "lightScreen", "reflect"]] as const) {
      const attacker = createBuild();
      const defender = createBuild("blastoise");
      const field = { ...createConditions(), gameType };
      const normal = row(moveId, attacker, defender, field);
      field.defenderSide[otherScreen] = true;
      expect(row(moveId, attacker, defender, field).rolls).toEqual(normal.rolls);
      field.defenderSide[otherScreen] = false;
      field.defenderSide[screen] = true;
      const screened = row(moveId, attacker, defender, field);
      expect(screened.max).toBeLessThan(normal.max!);
      field.defenderSide[screen] = false;
      field.defenderSide.auroraVeil = true;
      expect(row(moveId, attacker, defender, field).rolls).toEqual(screened.rolls);
      field.defenderSide.reflect = true;
      field.defenderSide.lightScreen = true;
      expect(row(moveId, attacker, defender, field).rolls).toEqual(screened.rolls);
      field.critical = true;
      const unshieldedCrit = { ...createConditions(), gameType, critical: true };
      expect(row(moveId, attacker, defender, field).rolls).toEqual(row(moveId, attacker, defender, unshieldedCrit).rolls);
    }
  });

  it("uses Helping Hand only on the attacker and screens only on the defender", () => {
    const attacker = createBuild();
    const defender = createBuild("blastoise");
    const field = createConditions();
    const normal = row("flamethrower", attacker, defender);
    field.defenderSide.helpingHand = true;
    field.attackerSide.lightScreen = true;
    field.attackerSide.reflect = true;
    field.attackerSide.auroraVeil = true;
    expect(row("flamethrower", attacker, defender, field).rolls).toEqual(normal.rolls);
    field.attackerSide.helpingHand = true;
    const helped = row("flamethrower", attacker, defender, field);
    expect(helped.min).toBeGreaterThan(normal.min!);
    field.defenderSide.helpingHand = false;
    expect(row("flamethrower", attacker, defender, field).rolls).toEqual(helped.rolls);
  });
});

describe("Champions Gravity", () => {
  it.each(["Flying", "Levitate", "Air Balloon"])("removes %s Ground immunity", (source) => {
    const attacker = { ...createBuild("excadrill"), abilityId: "sandrush" };
    const defender = createBuild(source === "Flying" ? "charizard" : source === "Levitate" ? "rotom" : "blastoise");
    if (source === "Air Balloon") defender.itemId = "airballoon";
    const field = createConditions();
    expect(row("earthquake", attacker, defender, field)).toMatchObject({ min: 0, max: 0 });
    field.gravity = true;
    expect(row("earthquake", attacker, defender, field).min).toBeGreaterThan(0);
  });

  it.each(["bounce", "fly", "flyingpress", "highjumpkick"])("reports %s as a known failure before other context guards", (moveId) => {
    const attacker = learns(moveId);
    expect(row(moveId, attacker).min).toBeGreaterThan(0);
    const field = { ...createConditions(), gravity: true };
    for (const defender of [createBuild("blastoise"), createBuild("mimikyu")]) {
      const blocked = row(moveId, attacker, defender, field);
      expect(blocked).toMatchObject({ kind: "calculated", min: 0, max: 0, rolls: 0, ohkoChance: 0, reason: null });
      expect(blocked.description).toBe(`Gravity prevents ${movesById.get(moveId)!.name} from being used.`);
    }
  });

  it("grounds airborne terrain users and targets without claiming an adjusted hit chance", () => {
    const attacker = createBuild("rotom");
    const defender = createBuild("blastoise");
    const field = createConditions();
    field.terrain = "Electric";
    const airborne = row("thunderbolt", attacker, defender, field);
    field.gravity = true;
    const grounded = row("thunderbolt", attacker, defender, field);
    expect(grounded.min).toBeGreaterThan(airborne.min!);
    expect(grounded.assumptions.join(" ")).toContain("accuracy remains the catalog value");

    const priority = { ...createBuild("talonflame"), abilityId: "galewings" };
    field.terrain = "Psychic";
    field.gravity = false;
    expect(row("bravebird", priority, createBuild("charizard"), field).min).toBeGreaterThan(0);
    field.gravity = true;
    expect(row("bravebird", priority, createBuild("charizard"), field)).toMatchObject({ min: 0, max: 0 });
  });

  it("increases Grav Apple power", () => {
    const attacker = createBuild("flapple");
    const ordinary = row("gravapple", attacker);
    const gravity = row("gravapple", attacker, createBuild("blastoise"), { ...createConditions(), gravity: true });
    expect(gravity.min).toBeGreaterThan(ordinary.max!);
  });
});

describe("Champions rooms", () => {
  it("changes both defensive categories under Wonder Room", () => {
    const attacker = createBuild();
    const defender = createBuild("avalugg");
    const field = createConditions();
    const physical = row("bodyslam", attacker, defender);
    const special = row("flamethrower", attacker, defender);
    field.wonderRoom = true;
    expect(row("bodyslam", attacker, defender, field).min).toBeGreaterThan(physical.min!);
    expect(row("flamethrower", attacker, defender, field).max).toBeLessThan(special.max!);
  });

  it.each([-2, 0, 2])("withholds unverified Wonder Room Body Press at Defense stage %s", (stage) => {
    const attacker = createBuild("blastoise");
    attacker.boosts.def = stage;
    attacker.boosts.spd = -stage;
    expect(row("bodypress", attacker).kind).toBe("calculated");
    const damage = row("bodypress", attacker, createBuild("blastoise"), { ...createConditions(), wonderRoom: true });
    expect(damage).toMatchObject({ kind: "unsupported", min: null, max: null, rolls: null, ohkoChance: null });
    expect(damage.reason).toContain("attacking Defense stages");
  });

  it("suppresses offensive items and defensive berries without removing them", () => {
    const attacker = createBuild();
    const defender = createBuild("venusaur");
    const ordinary = row("flamethrower", attacker, defender);
    attacker.itemId = "charcoal";
    expect(row("flamethrower", attacker, defender).min).toBeGreaterThan(ordinary.min!);
    const field = { ...createConditions(), magicRoom: true };
    expect(row("flamethrower", attacker, defender, field).rolls).toEqual(ordinary.rolls);
    attacker.itemId = "";
    defender.itemId = "occaberry";
    expect(row("flamethrower", attacker, defender).max).toBeLessThan(ordinary.max!);
    expect(row("flamethrower", attacker, defender, field).rolls).toEqual(ordinary.rolls);
    expect(defender.itemId).toBe("occaberry");
  });

  it.each(["electroball", "gyroball"])("uses item-suppressed actual Speed for %s under Magic Room", (moveId) => {
    const attacker = createBuild(moveId === "electroball" ? "jolteon" : "blastoise");
    const defender = createBuild(moveId === "electroball" ? "blastoise" : "jolteon");
    const ordinary = row(moveId, attacker, defender);
    attacker.itemId = "choicescarf";
    expect(row(moveId, attacker, defender).rolls).not.toEqual(ordinary.rolls);
    expect(row(moveId, attacker, defender, { ...createConditions(), magicRoom: true }).rolls).toEqual(ordinary.rolls);
    expect(attacker.itemId).toBe("choicescarf");
  });

  it.each(["focussash", "focusband"])("uses the effective, not selected, %s for KO estimates", (itemId) => {
    const attacker = createBuild();
    attacker.boosts.spa = 6;
    const defender = createBuild("venusaur");
    defender.itemId = itemId;
    expect(row("flamethrower", attacker, defender).ohkoChance).toBe(itemId === "focussash" ? 0 : null);
    const damage = row("flamethrower", attacker, defender, { ...createConditions(), magicRoom: true });
    expect(damage.ohkoChance).toBe(1);
    expect(damage.assumptions.join(" ")).not.toMatch(/Focus Sash|Focus Band/);
    expect(defender.itemId).toBe(itemId);
  });

  it("keeps Sturdy under Magic Room, but allows Mold Breaker to bypass it", () => {
    const attacker = createBuild("excadrill");
    attacker.boosts.atk = 6;
    attacker.abilityId = "sandrush";
    const defender = { ...createBuild("aggron"), abilityId: "sturdy", itemId: "focussash" };
    const field = { ...createConditions(), magicRoom: true };
    expect(row("earthquake", attacker, defender, field).ohkoChance).toBe(0);
    attacker.abilityId = "moldbreaker";
    expect(row("earthquake", attacker, defender, field).ohkoChance).toBe(1);
    field.magicRoom = false;
    expect(row("earthquake", attacker, defender, field).ohkoChance).toBe(0);
  });

  it("suppresses Air Balloon without Gravity and keeps the selected Mega form", () => {
    const attacker = { ...createBuild("excadrill"), abilityId: "sandrush" };
    const defender = { ...createBuild("blastoise"), itemId: "airballoon" };
    const field = { ...createConditions(), magicRoom: true };
    expect(row("earthquake", attacker, defender).max).toBe(0);
    expect(row("earthquake", attacker, defender, field).min).toBeGreaterThan(0);
    const mega = createBuild("charizardmegax");
    const before = structuredClone(mega);
    expect(row("bodyslam", mega, createBuild("blastoise"), field).rolls).toEqual(row("bodyslam", mega).rolls);
    expect(mega).toEqual(before);
    expect(mega.itemId).toBe("charizarditex");
  });

  it("withholds held-item Acrobatics under Magic Room but supports itemless Acrobatics", () => {
    const attacker = { ...createBuild(), itemId: "charcoal" };
    const defender = createBuild("blastoise");
    expect(row("acrobatics", attacker, defender).kind).toBe("calculated");
    const field = { ...createConditions(), magicRoom: true };
    expect(row("acrobatics", attacker, defender, field)).toMatchObject({ kind: "unsupported", min: null, ohkoChance: null, reason: expect.stringContaining("suppressed, not absent") });
    attacker.itemId = "";
    expect(row("acrobatics", attacker, defender, field).rolls).toEqual(row("acrobatics", attacker, defender).rolls);
  });

  it.each([
    ["flamethrower", "charizard", "blastoise"],
    ["electroball", "jolteon", "blastoise"],
    ["gyroball", "blastoise", "jolteon"],
  ])("does not invert Speed or ordinary damage for %s under Trick Room", (moveId, attackerId, defenderId) => {
    const attacker = { ...createBuild(attackerId), itemId: "choicescarf" };
    const defender = createBuild(defenderId);
    const ordinary = row(moveId, attacker, defender);
    const room = row(moveId, attacker, defender, { ...createConditions(), trickRoom: true });
    expect(room.rolls).toEqual(ordinary.rolls);
    expect(room.assumptions.join(" ")).toContain("Trick Room changes turn order, not Speed stats");
  });

  it.each([-6, 0, 6])("requires Analytic turn order under Trick Room at Speed stage %s", (stage) => {
    const attacker = { ...createBuild("starmie"), abilityId: "analytic", abilityActive: false };
    attacker.boosts.spe = stage;
    const defender = createBuild("blastoise");
    const field = { ...createConditions(), trickRoom: true };
    expect(row("thunderbolt", attacker, defender, field)).toMatchObject({ kind: "needs-context", min: null, reason: expect.stringContaining("actual turn order") });
    expect(row("protect", attacker, defender, field).kind).toBe("status");
    attacker.abilityActive = true;
    const switching = row("thunderbolt", attacker, defender, field);
    expect(switching.kind).toBe("calculated");
    expect(switching.rolls).toEqual(row("thunderbolt", attacker, defender).rolls);
    expect(switching.assumptions.join(" ")).toContain("the target switches before this attack — yes");
  });

  it("does not invent Payback turn order when Trick Room is selected", () => {
    const damage = row("payback", learns("payback"), createBuild("blastoise"), { ...createConditions(), trickRoom: true });
    expect(damage).toMatchObject({ kind: "needs-context", min: null, reason: expect.stringContaining("actual move order") });
  });
});

describe("Champions Fairy Aura and field isolation", () => {
  it("boosts Fairy attacks, including Pixilate, but not other move types", () => {
    const attacker = { ...createBuild("sylveon"), abilityId: "cutecharm" };
    const defender = createBuild("blastoise");
    const field = { ...createConditions(), fairyAura: true };
    expect(row("moonblast", attacker, defender, field).min).toBeGreaterThan(row("moonblast", attacker, defender).min!);
    expect(row("bodyslam", attacker, defender, field).rolls).toEqual(row("bodyslam", attacker, defender).rolls);
    attacker.abilityId = "pixilate";
    expect(row("hypervoice", attacker, defender, field).min).toBeGreaterThan(row("hypervoice", attacker, defender).min!);
  });

  it.each([
    ["floettemega", "blastoise"], ["sylveon", "floettemega"], ["floettemega", "floettemega"],
  ])("does not stack the additional aura with %s versus %s's existing source", (attackerId, defenderId) => {
    const attacker = createBuild(attackerId);
    const defender = createBuild(defenderId);
    const ordinary = row("moonblast", attacker, defender);
    expect(ordinary.min).toBeGreaterThan(0);
    const extra = row("moonblast", attacker, defender, { ...createConditions(), fairyAura: true });
    expect(extra.rolls).toEqual(ordinary.rolls);
    expect(extra.assumptions.join(" ")).toContain("aura sources do not stack");
  });

  it("pauses calculation for every malformed shared-effect flag", () => {
    for (const { key } of SHARED_FIELD_EFFECTS) {
      const field = createConditions();
      field[key] = "false" as unknown as boolean;
      const result = calculateMatchup(createBuild(), createBuild("blastoise"), field);
      expect(result.results).toEqual([]);
      expect(result.issues.field).toContainEqual(expect.objectContaining({ field: key }));
    }
  });

  it("does not mutate builds, fields or catalog data or leak effects between calculations", () => {
    const attacker = { ...createBuild(), itemId: "charcoal" };
    const defender = { ...createBuild("avalugg"), itemId: "focusband" };
    const ordinary = row("flamethrower", attacker, defender);
    const field = createConditions();
    for (const { key } of SHARED_FIELD_EFFECTS) field[key] = true;
    field.weather = "Snow";
    field.terrain = "Psychic";
    field.attackerSide.helpingHand = true;
    field.defenderSide.lightScreen = true;
    const before = structuredClone({ attacker, defender, field });
    const accuracy = movesById.get("flamethrower")!.accuracy;
    const first = calculateMatchup(attacker, defender, field);
    expect(first.issues).toEqual({ attacker: [], defender: [], field: [] });
    expect(calculateMatchup(attacker, defender, field)).toEqual(first);
    expect({ attacker, defender, field }).toEqual(before);
    expect(row("flamethrower", attacker, defender).rolls).toEqual(ordinary.rolls);
    expect(movesById.get("flamethrower")!.accuracy).toBe(accuracy);
    const assumptions = first.results.find((entry) => entry.moveId === "flamethrower")!.assumptions.join(" ");
    for (const name of ["Gravity", "Trick Room", "Wonder Room", "Magic Room", "Fairy Aura"]) expect(assumptions).toContain(name);
  });
});
