import { describe, expect, it } from "vitest";
import { calculate, Field, Generations, Move, Pokemon, toID } from "@smogon/calc";

const gen = Generations.get(0);

/** Synthetic builds isolate the documented integer arithmetic from species balance. */
function neutralPair() {
  const attacker = new Pokemon(gen, "Blastoise", {
    ability: "",
    overrides: {
      types: ["Grass"],
      baseStats: { hp: 80, atk: 130, def: 80, spa: 130, spd: 80, spe: 100 },
    },
  });
  const defender = new Pokemon(gen, "Blastoise", {
    ability: "",
    overrides: {
      types: ["Normal"],
      baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 100 },
    },
  });
  return { attacker, defender };
}

function move(name = "Body Slam", extra: ConstructorParameters<typeof Move>[2] = {}) {
  expect(gen.moves.get(toID(name)), `${name} must actually exist in Champions`).toBeDefined();
  return new Move(gen, name, { ...extra, overrides: { basePower: 100, ...extra?.overrides } });
}

describe("pinned Champions engine", () => {
  it("uses generation 0, level 50 and direct Stat Points, not main-series EVs/IVs", () => {
    const pokemon = new Pokemon(gen, "Charizard", {
      level: 100,
      nature: "Timid",
      evs: { hp: 2, spa: 32, spe: 32 },
      ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    });
    expect(gen.num).toBe(0);
    expect(pokemon.level).toBe(50);
    expect(pokemon.rawStats).toEqual({ hp: 155, atk: 93, def: 98, spa: 161, spd: 105, spe: 167 });
  });

  it("retains every independently calculated neutral roll (150 offense / 100 defense)", () => {
    const { attacker, defender } = neutralPair();
    const result = calculate(gen, attacker, defender, move());
    // floor((22 * 100 * 150 / 100) / 50) + 2 = 68; floor(68*r/100).
    expect(result.damage).toEqual([57, 58, 59, 59, 60, 61, 61, 62, 63, 63, 64, 65, 65, 66, 67, 68]);
    expect(result.range()).toEqual([57, 68]);
  });

  it("uses the proper offensive category", () => {
    const { attacker, defender } = neutralPair();
    attacker.boosts.atk = -6;
    expect(calculate(gen, attacker, defender, move("Flamethrower")).range()).toEqual([57, 68]);
    expect(calculate(gen, attacker, defender, move()).range()[1]).toBeLessThan(68);
  });

  it("applies critical hits and burn with intermediate integer rounding", () => {
    const { attacker, defender } = neutralPair();
    expect(calculate(gen, attacker, defender, move("Body Slam", { isCrit: true })).range()).toEqual([86, 102]);
    attacker.status = "brn";
    expect(calculate(gen, attacker, defender, move()).range()).toEqual([28, 34]);
  });

  it("distinguishes STAB, resistance and true immunity", () => {
    const { attacker, defender } = neutralPair();
    expect(calculate(gen, attacker, defender, move("Energy Ball")).range()).toEqual([85, 102]);
    expect(calculate(gen, attacker, defender, move("Energy Ball", { overrides: { type: "Ghost" } })).range()).toEqual([0, 0]);
    const resistant = new Pokemon(gen, "Blastoise", {
      ability: "",
      overrides: { types: ["Rock"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 100 } },
    });
    expect(calculate(gen, attacker, resistant, move()).range()).toEqual([28, 34]);
  });

  it("uses Champions terrain and spread modifiers rather than old-generation fallthroughs", () => {
    const { attacker, defender } = neutralPair();
    // 100 power becomes 130; base damage is 87, not the older 150%-terrain result.
    expect(calculate(gen, attacker, defender, move("Thunderbolt"), new Field({ terrain: "Electric" })).range()).toEqual([73, 87]);
    expect(calculate(gen, attacker, defender, move("Surf"), new Field({ gameType: "Singles" })).range()).toEqual([57, 68]);
    expect(calculate(gen, attacker, defender, move("Surf"), new Field({ gameType: "Doubles" })).range()).toEqual([43, 51]);
  });

  it("applies weather and screens", () => {
    const { attacker, defender } = neutralPair();
    expect(calculate(gen, attacker, defender, move("Flamethrower"), new Field({ weather: "Sun" })).range()).toEqual([86, 102]);
    expect(calculate(gen, attacker, defender, move("Flamethrower"), new Field({ weather: "Rain" })).range()).toEqual([28, 34]);
    expect(calculate(gen, attacker, defender, move(), new Field({ gameType: "Singles", defenderSide: { isReflect: true } })).range()).toEqual([28, 34]);
  });

  it("applies one screen modifier and one Helping Hand power modifier", () => {
    const { attacker, defender } = neutralPair();
    // Doubles screen = 2732/4096, Singles screen = 1/2, both rounded half down.
    for (const [gameType, expected] of [["Singles", [28, 34]], ["Doubles", [38, 45]]] as const) {
      for (const attack of [move(), move("Flamethrower")]) {
        const field = new Field({ gameType, defenderSide: { isReflect: true, isLightScreen: true, isAuroraVeil: true } });
        expect(calculate(gen, attacker, defender, attack, field).range()).toEqual(expected);
      }
    }
    // Helping Hand raises power to 150: base damage = 101, not 68 * 1.5.
    expect(calculate(gen, attacker, defender, move(), new Field({ attackerSide: { isHelpingHand: true } })).range()).toEqual([85, 101]);
  });

  it("swaps Wonder Room's raw defenses before applying their own stages", () => {
    const { attacker } = neutralPair();
    const defender = new Pokemon(gen, "Blastoise", {
      ability: "", boosts: { def: 2, spd: -1 },
      overrides: { types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 180, spe: 100 } },
    });
    // Raw Def/SpD 100/200 become 200/100; +2 Def / -1 SpD then give 400/66.
    // 100 power, 150 offense: base damage 18 (physical) and 102 (special).
    const field = new Field({ isWonderRoom: true });
    expect(calculate(gen, attacker, defender, move(), field).range()).toEqual([15, 18]);
    expect(calculate(gen, attacker, defender, move("Flamethrower"), field).range()).toEqual([86, 102]);
    expect(defender.rawStats.def).toBe(100);
    expect(defender.rawStats.spd).toBe(200);
    expect(defender.boosts).toMatchObject({ def: 2, spd: -1 });
  });

  it("uses one Fairy Aura power modifier regardless of the number of sources", () => {
    const { attacker, defender } = neutralPair();
    expect(calculate(gen, attacker, defender, move("Moonblast")).range()).toEqual([57, 68]);
    // 100 * 5448/4096 rounds to power 133; base damage = 89, rolls 75–89.
    const aura = gen.abilities.get(toID("Fairy Aura"));
    expect(aura).toBeDefined();
    for (const [attackerAura, defenderAura, fieldAura] of [
      [false, false, true], [true, false, false], [false, true, false], [true, true, true],
    ]) {
      attacker.ability = attackerAura ? aura!.name : undefined;
      defender.ability = defenderAura ? aura!.name : undefined;
      expect(calculate(gen, attacker, defender, move("Moonblast"), new Field({ isFairyAura: fieldAura })).range()).toEqual([75, 89]);
    }
  });

  it("does not leak boosts or weather changes between calls", () => {
    const { attacker, defender } = neutralPair();
    const before = { stats: { ...attacker.rawStats }, boosts: { ...attacker.boosts } };
    const first = calculate(gen, attacker, defender, move()).damage;
    calculate(gen, attacker, defender, move("Meteor Beam"));
    expect(calculate(gen, attacker, defender, move()).damage).toEqual(first);
    expect(attacker.rawStats).toEqual(before.stats);
    expect(attacker.boosts).toEqual(before.boosts);
  });
});
