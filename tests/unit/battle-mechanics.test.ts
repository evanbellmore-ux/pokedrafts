import { describe, expect, it } from "vitest";
import { calculate, Generations, Pokemon, toID } from "@smogon/calc";
import { Move } from "@smogon/calc/dist/move";
import usum from "@/data/battle/ultra_sun_ultra_moon/catalog.json";
import swsh from "@/data/battle/sword_shield/catalog.json";
import sv from "@/data/battle/scarlet_violet/catalog.json";
import { createBattleRuntime } from "@/app/lib/battle/runtime";
import { createBuild, createConditions, getBuildStats } from "@/app/lib/battle/model";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { resolveBattleMove } from "@/app/lib/battle/resolve-move";
import { getBuildHealth, withDynamaxHealth } from "@/app/lib/battle/health";
import type { BattleBuild, BattleConditions, MoveContext, NativeBattleGame, NativeCatalog } from "@/app/lib/battle/types";

const runtimes = {
  ultra_sun_ultra_moon: createBattleRuntime(usum as NativeCatalog, "1".repeat(64)),
  sword_shield: createBattleRuntime(swsh as NativeCatalog, "2".repeat(64)),
  scarlet_violet: createBattleRuntime(sv as NativeCatalog, "3".repeat(64)),
};
function build(game: NativeBattleGame, id = "charizard") {
  const result = createBuild(id, runtimes[game]);
  if (result.game === "champions") throw new Error("Native fixture required");
  return result;
}
function learner(game: NativeBattleGame, move: string) {
  const species = runtimes[game].catalog.species.find((entry) => !entry.unsupported.length && !entry.battleForm && entry.moves.includes(move));
  if (!species) throw new Error(`Missing native learner for ${move}`);
  return build(game, species.id);
}
function row(id: string, attacker: BattleBuild, defender?: BattleBuild, context?: MoveContext, field: BattleConditions = createConditions()) {
  if (attacker.game === "champions") throw new Error("Native row required");
  const runtime = runtimes[attacker.game];
  const result = calculateMatchup(attacker, defender ?? build(attacker.game, "blastoise"), field, context ? { [id]: context } : {}, runtime);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const damage = result.results.find((entry) => entry.moveId === id);
  expect(damage, `${attacker.speciesId} must learn ${id}`).toBeDefined();
  return damage!;
}

describe("game-aware calculation gates", () => {
  it("rejects forged cross-game builds and disallowed flags before the engine", () => {
    const runtime = runtimes.scarlet_violet;
    const result = calculateMatchup(build("sword_shield"), build("scarlet_violet"), createConditions(), {}, runtime);
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toContainEqual(expect.objectContaining({ field: "game" }));
    const champion = createBuild();
    champion.mechanic = "tera";
    champion.configuration = { teraType: "Fire" };
    expect(calculateMatchup(champion, createBuild(), createConditions()).results).toEqual([]);
    delete champion.mechanic;
    const z = calculateMatchup(champion, createBuild(), createConditions(), { flamethrower: { useZ: true } }).results.find((entry) => entry.moveId === "flamethrower");
    expect(z).toMatchObject({ kind: "unsupported", min: null, reason: expect.stringContaining("not available") });
    expect(row("flamethrower", build("sword_shield"), undefined, { useZ: true })).toMatchObject({ kind: "unsupported", min: null });
  });

  it("preserves inactive Tera/Gmax configuration without damage changes", () => {
    for (const game of ["ultra_sun_ultra_moon", "sword_shield", "scarlet_violet"] as const) {
      const attacker = build(game);
      const ordinary = row("flamethrower", attacker);
      attacker.configuration = { teraType: "Water", gigantamax: true, dynamaxLevel: 0 };
      expect(row("flamethrower", attacker).rolls).toEqual(ordinary.rolls);
    }
    const champion = createBuild();
    const baseline = calculateMatchup(champion, createBuild("blastoise"), createConditions());
    champion.configuration = { teraType: "Fighting" };
    expect(calculateMatchup(champion, createBuild("blastoise"), createConditions())).toEqual(baseline);
  });
});

describe("native Tera", () => {
  it("applies same-type STAB and defensive replacement using independently worked rolls", () => {
    const attacker = build("scarlet_violet");
    const defender = build("scarlet_violet", "blastoise");
    expect(row("flamethrower", attacker, defender)).toMatchObject({ min: 26, max: 31 });
    attacker.configuration = { teraType: "Fire" };
    attacker.mechanic = "tera";
    // Base damage 42, random 35..42, STAB 2, Water resistance 1/2.
    expect(row("flamethrower", attacker, defender)).toMatchObject({ min: 35, max: 42 });
    defender.configuration = { teraType: "Grass" };
    defender.mechanic = "tera";
    expect(row("flamethrower", attacker, defender)).toMatchObject({ min: 140, max: 168 });
  });

  it("changes Tera Blast's type and category only when explicitly active", () => {
    const attacker = build("scarlet_violet", "pikachu");
    attacker.configuration = { teraType: "Fighting" };
    attacker.boosts.atk = 6;
    expect(row("terablast", attacker)).toMatchObject({ effectiveType: "Normal", effectiveCategory: "Special", effectivePower: 80 });
    attacker.mechanic = "tera";
    expect(row("terablast", attacker)).toMatchObject({ kind: "calculated", effectiveType: "Fighting", effectiveCategory: "Physical", effectivePower: 80 });
  });

  it("requires explicit Stellar first-use state rather than silently omitting the boost", () => {
    const attacker = build("scarlet_violet");
    attacker.configuration = { teraType: "Stellar" };
    attacker.mechanic = "tera";
    expect(row("flamethrower", attacker)).toMatchObject({ kind: "needs-context", min: null });
    const first = row("flamethrower", attacker, undefined, { stellarFirstUse: true });
    const later = row("flamethrower", attacker, undefined, { stellarFirstUse: false });
    expect(first.min).toBeGreaterThan(later.min!);
    expect(row("terablast", attacker, undefined, { stellarFirstUse: true })).toMatchObject({ kind: "calculated", effectiveType: "Stellar", effectivePower: 100 });
  });

  it.each(["ogerpon", "ogerponhearthflame", "terapagos", "terapagosstellar"])("withholds unverified special Tera transition for %s", (id) => {
    const attacker = build("scarlet_violet", id);
    attacker.mechanic = "tera";
    const result = calculateMatchup(attacker, build("scarlet_violet"), createConditions(), {}, runtimes.scarlet_violet);
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("not verified") }));
  });
});

describe("verified Z-Move conversion", () => {
  it("requires the matching crystal and reports generic transformed metadata", () => {
    const attacker = build("ultra_sun_ultra_moon");
    expect(row("flamethrower", attacker, undefined, { useZ: true })).toMatchObject({ kind: "unsupported", min: null });
    attacker.itemId = "wateriumz";
    expect(row("flamethrower", attacker, undefined, { useZ: true }).kind).toBe("unsupported");
    attacker.itemId = "firiumz";
    expect(row("flamethrower", attacker, undefined, { useZ: true })).toMatchObject({ moveId: "flamethrower", kind: "calculated", effectiveName: "Inferno Overdrive", effectiveType: "Fire", effectivePower: 175, effectiveCategory: "Special", hits: 1 });
  });

  it("verifies signature crystal, exact species and base move", () => {
    const attacker = build("ultra_sun_ultra_moon", "kommoo");
    attacker.itemId = "kommoniumz";
    expect(row("clangingscales", attacker, undefined, { useZ: true })).toMatchObject({ kind: "calculated", effectiveName: "Clangorous Soulblaze", effectivePower: 185 });
    expect(row("dragonclaw", attacker, undefined, { useZ: true })).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Clanging Scales") });
    const wrongSpecies = build("ultra_sun_ultra_moon");
    wrongSpecies.itemId = "kommoniumz";
    expect(row("dragonclaw", wrongSpecies, undefined, { useZ: true })).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("not compatible") });
    const ultra = build("ultra_sun_ultra_moon", "necrozmaultra");
    expect(row("photongeyser", ultra, undefined, { useZ: true })).toMatchObject({ kind: "calculated", effectiveName: "Light That Burns the Sky", effectivePower: 200 });
  });

  it("supports Guardian of Alola's independently defined current-HP damage", () => {
    const attacker = build("ultra_sun_ultra_moon", "tapukoko");
    attacker.itemId = "tapuniumz";
    const defender = build("ultra_sun_ultra_moon", "blastoise");
    defender.currentHP = 101;
    expect(row("naturesmadness", attacker, defender, { useZ: true })).toMatchObject({ kind: "calculated", effectiveName: "Guardian of Alola", min: 75, max: 75, ohkoChance: 0 });
  });

  it("never substitutes ordinary damage for status Z bonuses", () => {
    const attacker = build("ultra_sun_ultra_moon");
    attacker.itemId = "normaliumz";
    expect(row("protect", attacker, undefined, { useZ: true })).toMatchObject({ kind: "unsupported", min: null, reason: expect.stringContaining("Status Z-Move") });
  });

  it("resolves transformation before multi-hit, history, variable-power and Gravity guards", () => {
    for (const move of ["bulletseed", "payback", "flail"] as const) {
      const attacker = learner("ultra_sun_ultra_moon", move);
      attacker.itemId = move === "bulletseed" ? "grassiumz" : move === "payback" ? "darkiniumz" : "normaliumz";
      expect(row(move, attacker, undefined, { useZ: true })).toMatchObject({ kind: "calculated", hits: 1 });
    }
    const flyer = build("ultra_sun_ultra_moon");
    flyer.itemId = "flyiniumz";
    expect(row("fly", flyer, undefined, { useZ: true }, { ...createConditions(), gravity: true })).toMatchObject({ kind: "calculated", effectiveName: "Supersonic Skystrike", effectivePower: 175 });
  });

  it("uses Normalium Z for Hidden Power regardless of its innate type", () => {
    const attacker = build("ultra_sun_ultra_moon");
    attacker.configuration = { hiddenPowerType: "Ice" };
    attacker.itemId = "iciumz";
    expect(row("hiddenpower", attacker, undefined, { useZ: true })).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Normalium Z") });
    attacker.itemId = "normaliumz";
    expect(row("hiddenpower", attacker, undefined, { useZ: true })).toMatchObject({ kind: "calculated", effectiveName: "Breakneck Blitz", effectiveType: "Normal", effectivePower: 120 });
  });
});

describe("native Hidden Power identities", () => {
  // Pinned data/moves.ts:8646–8885 defines exactly these sixteen placeholders.
  // Values are independent parity fixtures in hp/atk/def/spe/spa/spd bit order.
  const cases = [
    ["Fighting", 0], ["Flying", 5], ["Poison", 9], ["Ground", 13],
    ["Rock", 17], ["Bug", 21], ["Ghost", 26], ["Steel", 30],
    ["Fire", 34], ["Water", 38], ["Grass", 42], ["Electric", 47],
    ["Psychic", 51], ["Ice", 55], ["Dragon", 59], ["Dark", 63],
  ] as const;

  it.each(cases)("validates manually assigned Hidden Power %s against native IVs without changing its ID", (type, parity) => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const attacker = build("ultra_sun_ultra_moon", "unown");
    const id = `hiddenpower${type.toLowerCase()}`;
    attacker.preparedMoves = [id];
    attacker.native.ivs = {
      hp: 30 + (parity & 1), atk: 30 + ((parity >> 1) & 1),
      def: 30 + ((parity >> 2) & 1), spe: 30 + ((parity >> 3) & 1),
      spa: 30 + ((parity >> 4) & 1), spd: 30 + ((parity >> 5) & 1),
    };
    const before = structuredClone(attacker);
    const result = calculateMatchup(attacker, build("ultra_sun_ultra_moon", "blastoise"), createConditions(), {}, runtime);
    expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
    const typed = result.results.find((entry) => entry.moveId === id);
    expect(typed).toMatchObject({ moveId: id, kind: "calculated", effectiveName: `Hidden Power ${type}`, effectiveType: type, effectivePower: 60 });
    expect(typed?.rolls).toEqual(result.results.find((entry) => entry.moveId === "hiddenpower")?.rolls);
    for (const [other] of cases) {
      if (other === type) continue;
      expect(result.results.find((entry) => entry.moveId === `hiddenpower${other.toLowerCase()}`)).toMatchObject({ kind: "needs-context", min: null, reason: expect.stringContaining("innate IVs") });
    }
    expect(attacker).toEqual(before);
  });

  it("requires Normalium Z for every exact typed alias, never its displayed type's crystal", () => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const attacker = build("ultra_sun_ultra_moon", "unown");
    for (const [type] of cases) {
      const id = `hiddenpower${type.toLowerCase()}`;
      attacker.preparedMoves = [id];
      const crystal = runtime.catalog.items.find((item) => item.zMoveType === type);
      expect(crystal).toBeDefined();
      attacker.itemId = crystal!.id;
      expect(row(id, attacker, undefined, { useZ: true })).toMatchObject({ moveId: id, kind: "unsupported", min: null, reason: expect.stringContaining("Normalium Z") });
      attacker.itemId = "normaliumz";
      const before = structuredClone(attacker);
      // Z eligibility uses the Normal base move even when the ordinary move's
      // innate type is unresolved; no Hidden Power type rewrite is required.
      expect(row(id, attacker, undefined, { useZ: true })).toMatchObject({ moveId: id, kind: "calculated", effectiveName: "Breakneck Blitz", effectiveType: "Normal", effectivePower: 120 });
      expect(attacker).toEqual(before);
    }
  });

  it("checks both selected and configured types against explicit Hyper Training innate IVs", () => {
    const attacker = build("ultra_sun_ultra_moon", "unown");
    attacker.preparedMoves = ["hiddenpowerice"];
    attacker.native.level = 100;
    attacker.configuration = { hiddenPowerType: "Dark" };
    // Configuration matches the default innate Dark type, but the assigned Ice
    // variant cannot be silently changed to Dark to make the attack calculable.
    expect(row("hiddenpowerice", attacker)).toMatchObject({ moveId: "hiddenpowerice", kind: "needs-context", min: null });
    attacker.configuration.hiddenPowerType = "Ice";
    expect(row("hiddenpowerice", attacker).kind).toBe("needs-context");
    const stats = getBuildStats(attacker, runtimes.ultra_sun_ultra_moon);
    attacker.native.innateIVs = { hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 31 };
    const before = structuredClone(attacker);
    expect(row("hiddenpowerice", attacker)).toMatchObject({ moveId: "hiddenpowerice", kind: "calculated", effectiveType: "Ice", effectivePower: 60 });
    expect(getBuildStats(attacker, runtimes.ultra_sun_ultra_moon)).toEqual(stats);
    expect(attacker).toEqual(before);
    attacker.configuration.hiddenPowerType = "Dark";
    expect(row("hiddenpowerice", attacker).kind).toBe("needs-context");
  });

  it("guards direct typed-move resolution and preserves verified identity through engine clones", () => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const attacker = build("ultra_sun_ultra_moon", "unown");
    const pokemon = new Pokemon(Generations.get(7), "Unown", { level: 100 });
    const metadata = runtime.movesById.get("hiddenpowerice")!;
    const metadataBefore = structuredClone(metadata);
    const resolve = (context?: MoveContext) => resolveBattleMove(metadata, attacker, pokemon, context, runtime);
    expect(resolve()).toMatchObject({ kind: "needs-context", reason: expect.stringContaining("innate IVs") });
    attacker.itemId = "iciumz";
    expect(resolve({ useZ: true })).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Normalium Z") });
    attacker.itemId = "normaliumz";
    expect(resolve({ useZ: true }).move).toMatchObject({ name: "Breakneck Blitz", type: "Normal", bp: 120 });
    attacker.native.level = 100;
    attacker.native.innateIVs = { hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 31 };
    const before = structuredClone(attacker);
    const resolved = resolve();
    expect(resolved.effective).toMatchObject({ id: "hiddenpowerice", name: "Hidden Power Ice", type: "Ice", power: 60 });
    expect(resolved.move?.clone()).toMatchObject({ name: "Hidden Power Ice", type: "Ice", bp: 60 });
    expect(attacker).toEqual(before);
    attacker.native.innateIVs.atk = null;
    expect(resolve()).toMatchObject({ kind: "needs-context", reason: expect.stringContaining("innate IVs") });
    expect(metadata).toEqual(metadataBefore);
  });
});

describe("Dynamax and exact G-Max attacks", () => {
  it("synchronizes transformed Pokémon and moves, converts status moves, and removes base restrictions", () => {
    const attacker = build("sword_shield");
    attacker.mechanic = "dynamax";
    expect(row("flamethrower", attacker)).toMatchObject({ kind: "calculated", effectiveName: "Max Flare", effectivePower: 130 });
    expect(row("protect", attacker)).toMatchObject({ kind: "status", effectiveName: "Max Guard" });
    expect(row("scaleshot", attacker)).toMatchObject({ kind: "calculated", effectiveName: "Max Wyrmwind", hits: 1 });
    expect(row("fly", attacker, undefined, undefined, { ...createConditions(), gravity: true })).toMatchObject({ kind: "calculated", effectiveName: "Max Airstream" });
    const defender = build("sword_shield", "blastoise");
    defender.mechanic = "dynamax";
    expect(row("grassknot", learner("sword_shield", "grassknot"), defender)).toMatchObject({ min: 0, max: 0 });
  });

  it("resolves Gale Wings on the effective Flying Z/Max attack before terrain shields", () => {
    for (const game of ["ultra_sun_ultra_moon", "sword_shield"] as const) {
      const attacker = build(game, "talonflame");
      attacker.abilityId = "galewings";
      const defender = build(game, "venusaur");
      const context = game === "ultra_sun_ultra_moon" ? { useZ: true } : undefined;
      if (game === "ultra_sun_ultra_moon") attacker.itemId = "flyiniumz";
      else { attacker.mechanic = "dynamax"; attacker.configuration = { dynamaxLevel: 0 }; }
      const field = { ...createConditions(), terrain: "Psychic" as const };
      expect(row("bravebird", attacker, defender, context, field)).toMatchObject({ kind: "calculated", min: 0, max: 0 });
      attacker.currentHP = 50;
      expect(row("bravebird", attacker, defender, context, field).max).toBeGreaterThan(0);
    }
  });

  it("withholds unverified field-dependent transformations rather than mislabelling them", () => {
    const attacker = learner("sword_shield", "weatherball");
    attacker.mechanic = "dynamax";
    expect(row("weatherball", attacker, undefined, undefined, { ...createConditions(), weather: "Rain" })).toMatchObject({ kind: "unsupported", min: null, reason: expect.stringContaining("transformed type") });
    const z = learner("ultra_sun_ultra_moon", "weatherball");
    z.itemId = "normaliumz";
    expect(row("weatherball", z, undefined, { useZ: true }, { ...createConditions(), weather: "Sun" })).toMatchObject({ kind: "unsupported", min: null });
  });

  it("rejects ordinary Dynamax for a Gmax-factor build instead of silently changing the requested effect", () => {
    const attacker = build("sword_shield");
    attacker.configuration = { gigantamax: true };
    attacker.mechanic = "dynamax";
    const result = calculateMatchup(attacker, build("sword_shield", "blastoise"), createConditions(), {}, runtimes.sword_shield);
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("Gigantamax factor requires Gigantamax") }));
    expect(attacker.mechanic).toBe("dynamax");
    attacker.configuration.gigantamax = false;
    expect(row("flamethrower", attacker)).toMatchObject({ kind: "calculated", effectiveName: "Max Flare" });
  });

  it("requires factor and exact signature, using normal Max moves for other types", () => {
    const attacker = build("sword_shield");
    attacker.mechanic = "gigantamax";
    const invalid = calculateMatchup(attacker, build("sword_shield"), createConditions(), {}, runtimes.sword_shield);
    expect(invalid.results).toEqual([]);
    attacker.configuration = { gigantamax: true };
    expect(row("flamethrower", attacker)).toMatchObject({ kind: "calculated", effectiveName: "G-Max Wildfire", effectiveType: "Fire", effectivePower: 130 });
    expect(row("airslash", attacker)).toMatchObject({ kind: "calculated", effectiveName: "Max Airstream" });
  });

  it("overrides the pinned Butterfree hint without replacing its ordinary identity or move", () => {
    const gen = Generations.get(8);
    expect(gen.species.get(toID("Butterfree"))?.canGigantamax).toBe("G-Max Flutterby");
    const signature = gen.moves.get(toID("G-Max Befuddle"))!;
    const move = new Move(gen, "Bug Buzz", { useMax: "gmax", overrideMove: signature.name });
    expect(move).toMatchObject({ name: "G-Max Befuddle", bp: 130, type: "Bug", category: "Special", isMax: true });
    expect(move.clone()).toMatchObject({ name: "G-Max Befuddle", bp: 130, overrideMove: signature.name });
    const direct = calculate(gen, new Pokemon(gen, "Butterfree", { level: 50, ability: "Compound Eyes", isDynamaxed: true }), new Pokemon(gen, "Blastoise", { level: 50, ability: "Torrent" }), move);
    // Independent formula: floor(22*130*110/125/50)+2 = 52; Bug STAB -> 66..78.
    expect(direct.range()).toEqual([66, 78]);
    expect(direct.move.name).toBe("G-Max Befuddle");
    const attacker = build("sword_shield", "butterfree");
    expect(row("bugbuzz", attacker)).toMatchObject({ kind: "calculated", effectiveName: "Bug Buzz", effectivePower: 90 });
    attacker.configuration = { gigantamax: true };
    attacker.mechanic = "gigantamax";
    expect(row("bugbuzz", attacker)).toMatchObject({ kind: "calculated", effectiveName: "G-Max Befuddle", effectivePower: 130, min: 66, max: 78 });
  });

  it.each(["zacian", "zaciancrowned", "zamazenta", "zamazentacrowned", "eternatus"])("rejects Dynamax on %s", (id) => {
    const attacker = build("sword_shield", id);
    attacker.mechanic = "dynamax";
    const result = calculateMatchup(attacker, build("sword_shield"), createConditions(), {}, runtimes.sword_shield);
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("cannot Dynamax") }));
  });
});

describe("Dynamax HP independent of the engine rounding defect", () => {
  it("floors both values at every Dynamax level, including odd HP and partial HP, through clones", () => {
    // Pinned Showdown c23d2e9 data/conditions.ts:753–775 explicitly floors both.
    // Base 153 has fractional maxima at every level except 10; calc ceils current.
    for (let level = 0; level <= 10; level++) for (const hp of [1, 2, 51, 76, 152, 153]) {
      const attacker = build("sword_shield");
      attacker.mechanic = "dynamax";
      attacker.currentHP = hp;
      attacker.configuration = { dynamaxLevel: level };
      const health = getBuildHealth(attacker, runtimes.sword_shield)!;
      const multiplier = 150 + 5 * level;
      expect(health).toEqual({ baseMax: 153, baseCurrent: hp, max: Math.floor(153 * multiplier / 100), current: Math.floor(hp * multiplier / 100), reason: null });
      const raw = new Pokemon(8, "Charizard", { level: 50, curHP: hp, isDynamaxed: true, dynamaxLevel: level });
      const adapted = withDynamaxHealth(raw);
      for (const pokemon of [adapted, adapted.clone(), adapted.clone().clone()]) {
        expect(pokemon.maxHP()).toBe(health.max);
        expect(pokemon.curHP()).toBe(health.current);
        expect(pokemon.curHP(true)).toBe(hp);
      }
    }
    expect(new Pokemon(8, "Charizard", { level: 50, isDynamaxed: true, dynamaxLevel: 0 }).curHP()).toBe(230);
    expect(withDynamaxHealth(new Pokemon(8, "Charizard", { level: 50, isDynamaxed: true, dynamaxLevel: 0 })).curHP()).toBe(229);
    // No prototype/global engine patch.
    expect(new Pokemon(8, "Charizard", { level: 50, isDynamaxed: true, dynamaxLevel: 0 }).curHP()).toBe(230);
  });

  it("keeps Shedinja at one HP at every Dynamax level", () => {
    for (let level = 0; level <= 10; level++) {
      const attacker = build("sword_shield", "shedinja");
      attacker.mechanic = "dynamax";
      attacker.configuration = { dynamaxLevel: level };
      expect(getBuildHealth(attacker, runtimes.sword_shield)).toEqual({ baseMax: 1, baseCurrent: 1, max: 1, current: 1, reason: null });
      const pokemon = withDynamaxHealth(new Pokemon(8, "Shedinja", { isDynamaxed: true, dynamaxLevel: level }));
      expect(pokemon.clone().curHP()).toBe(1);
      expect(pokemon.clone().maxHP()).toBe(1);
    }
  });

  it("uses effective HP for damage percentages, KO rolls and full-HP survival", () => {
    const attacker = build("sword_shield", "blastoise");
    const defender = build("sword_shield");
    defender.mechanic = "dynamax";
    defender.configuration = { dynamaxLevel: 0 };
    defender.itemId = "focussash";
    attacker.boosts.spa = 6;
    const full = row("hydropump", attacker, defender);
    expect(full.kind).toBe("calculated");
    expect(full.maxPercent).toBeCloseTo(full.max! / 229 * 100);
    expect(full.ohkoChance).toBe(0);
    defender.currentHP = 100;
    const partial = row("hydropump", attacker, defender);
    expect(partial.maxPercent).toBeCloseTo(partial.max! / 229 * 100);
    expect(partial.ohkoChance).toBe(1);
    expect(defender.currentHP).toBe(100);
  });

  it("uses floor-scaled target HP in Brine rather than the engine ceil", () => {
    const attacker = build("sword_shield", "blastoise");
    const defender = build("sword_shield");
    defender.configuration = { dynamaxLevel: 0 };
    defender.mechanic = "dynamax";
    // 76/153 becomes 114/229 (below half). A near-full counterpart is unboosted.
    defender.currentHP = 76;
    const low = row("brine", attacker, defender);
    defender.currentHP = 77;
    const high = row("brine", attacker, defender);
    expect(low.max).toBeGreaterThan(high.max!);
    expect(low.effectivePower).toBe(130);
    expect(high.effectivePower).toBe(65);
  });
});

describe("native set metadata actually affects damage", () => {
  it.each([0, 1, 127, 254, 255])("uses exact Happiness %s for Return and Frustration, including minimum one power", (happiness) => {
    const attacker = build("ultra_sun_ultra_moon");
    attacker.configuration = { happiness };
    expect(row("return", attacker)).toMatchObject({ kind: "calculated", effectivePower: Math.max(1, Math.floor(happiness * 10 / 25)) });
    expect(row("frustration", attacker)).toMatchObject({ kind: "calculated", effectivePower: Math.max(1, Math.floor((255 - happiness) * 10 / 25)) });
    if (happiness === 255) {
      delete attacker.configuration;
      expect(row("return", attacker).effectivePower).toBe(102);
      expect(row("frustration", attacker).effectivePower).toBe(1);
    }
  });

  it("does not invent Rivalry gender; known same, opposite and genderless targets behave distinctly", () => {
    const attacker = build("ultra_sun_ultra_moon", "luxray");
    attacker.abilityId = "rivalry";
    const defender = build("ultra_sun_ultra_moon", "blastoise");
    expect(row("thunderbolt", attacker, defender).kind).toBe("needs-context");
    attacker.configuration = { gender: "M" };
    expect(row("thunderbolt", attacker, defender).kind).toBe("needs-context");
    defender.configuration = { gender: "M" };
    const same = row("thunderbolt", attacker, defender);
    defender.configuration.gender = "F";
    const opposite = row("thunderbolt", attacker, defender);
    attacker.abilityId = "intimidate";
    const neutral = row("thunderbolt", attacker, defender);
    expect(same.min).toBeGreaterThan(neutral.min!);
    expect(opposite.max).toBeLessThan(neutral.max!);
    attacker.abilityId = "rivalry";
    expect(row("thunderbolt", attacker, build("ultra_sun_ultra_moon", "mew")).kind).toBe("calculated");
  });

  it("reconciles Hidden Power with innate IVs without changing effective training stats", () => {
    const attacker = build("ultra_sun_ultra_moon");
    expect(row("hiddenpower", attacker)).toMatchObject({ kind: "calculated", effectiveType: "Dark", effectivePower: 60 });
    attacker.configuration = { hiddenPowerType: "Ice" };
    expect(row("hiddenpower", attacker)).toMatchObject({ kind: "needs-context", min: null });
    attacker.native.level = 100;
    const before = getBuildStats(attacker, runtimes.ultra_sun_ultra_moon);
    attacker.native.innateIVs = { hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 31 };
    expect(row("hiddenpower", attacker)).toMatchObject({ kind: "calculated", effectiveType: "Ice", effectivePower: 60 });
    expect(getBuildStats(attacker, runtimes.ultra_sun_ultra_moon)).toEqual(before);
    expect(attacker.native.ivs.atk).toBe(31);
  });
});
