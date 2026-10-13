import { describe, expect, it } from "vitest";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame } from "@/app/lib/battle/types";

/**
 * status2 wave 1a, Track D (SPEC2 §4.5; guards.md §4.7, C12): spread heals. Per target in hit order its damage, then the
 * drain round(dealt × drain) into TryHeal (Liquid Ooze deals the raw amount, Big Root modifies each heal by itself, capped
 * at the maximum: PS/sim/battle.ts:2091-2186); the Substitutes' hits first; the retaliation and the Update after the hits;
 * Life Orb, then Shell Bell's one heal of trunc(Σ dealt / 8) (a Substitute's damage not counted). The user's HP is kept
 * joint with each target's. Every number is the pinned Showdown oracle's (scripts/.cache/calc-audit/status2/build/
 * w1a-d-cases.ts G4-SPH-…).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = { species: string; ability: string; item?: string; hp?: number; evs?: Partial<Record<Stat, number>>; move: string | null; substitute?: number };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = { nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: "" };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[]): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: null }, ...(m.substitute ? { carried: { substitute: m.substitute } } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null });
const sinistcha = (hp: number, item?: string): Mon => ({ species: "sinistcha", ability: "hospitality", hp, ...(item ? { item } : {}), move: "matchagotcha" });
const user = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  const hp = result.hp["own-left"]!;
  return { min: hp.min, max: hp.max, average: hp.average, koChance: hp.koChance };
};

describe("status2 D: spread heals (guards.md §4.7)", () => {
  it("G4-SPH-10-sv: Matcha Gotcha into two Snorlax from 20 HP: both drains (58–66)", async () => {
    const runtime = await game("scarlet_violet");
    const hp = user(turn(runtime, [sinistcha(20), lax(0), lax(4), lax(8)]));
    expect([hp.min, hp.max]).toEqual([58, 66]);
    expect(hp.average).toBeCloseTo(61.25, 9);
  });

  it("G4-SPH-11-sv: Big Root modifies each heal by itself (70–80)", async () => {
    const runtime = await game("scarlet_violet");
    const hp = user(turn(runtime, [sinistcha(20, "bigroot"), lax(0), lax(4), lax(8)]));
    expect([hp.min, hp.max]).toEqual([70, 80]);
    expect(hp.average).toBeCloseTo(73.75, 9);
  });

  it("G4-SPH-13-champions: the same in Champions (58–66)", async () => {
    const runtime = await game("champions");
    const hp = user(turn(runtime, [sinistcha(20), lax(0), lax(4), lax(8)]));
    expect([hp.min, hp.max]).toEqual([58, 66]);
    expect(hp.average).toBeCloseTo(61.25, 9);
  });

  it("G4-SPH-02-sv: a Liquid Ooze target after a healing one: the heal, then the raw drain lost (122–129)", async () => {
    const runtime = await game("scarlet_violet");
    const hp = user(turn(runtime, [sinistcha(120), lax(0), { species: "tentacruel", ability: "liquidooze", move: null }, { species: "garchomp", ability: "roughskin", move: null }]));
    expect([hp.min, hp.max]).toEqual([122, 129]);
    expect(hp.average).toBeCloseTo(125.9375, 9);
  });

  it("G4-SPH-03-sv: the Liquid Ooze target first, then the heal capped at the maximum (142–146)", async () => {
    const runtime = await game("scarlet_violet");
    const hp = user(turn(runtime, [sinistcha(140), lax(0), { species: "garchomp", ability: "roughskin", move: null }, { species: "tentacruel", ability: "liquidooze", move: null }]));
    expect([hp.min, hp.max]).toEqual([142, 146]);
    expect(hp.average).toBeCloseTo(145.3984375, 6);
  });

  it("G4-SPH-14-sv: from 15 HP the heal first, then Liquid Ooze (13–21, no faint)", async () => {
    const runtime = await game("scarlet_violet");
    const hp = user(turn(runtime, [sinistcha(15), lax(0), { species: "tentacruel", ability: "liquidooze", move: null }, lax(8)]));
    expect([hp.min, hp.max]).toEqual([13, 21]);
    expect(hp.average).toBeCloseTo(16.4375, 9);
    expect(hp.koChance).toBe(0);
  });

  it("G4-SPH-08-champions: a knocked-out target's drain is from the HP it had (83–88)", async () => {
    const runtime = await game("champions");
    const hp = user(turn(runtime, [sinistcha(50), lax(0), { species: "rhyperior", ability: "lightningrod", hp: 20, move: null }, { species: "garchomp", ability: "roughskin", move: null }]));
    expect([hp.min, hp.max]).toEqual([83, 88]);
    expect(hp.average).toBeCloseTo(85.375, 9);
  });

  it("G4-SPH-12-swsh: Shell Bell heals once from the summed damage (64–67)", async () => {
    const runtime = await game("sword_shield");
    const hp = user(turn(runtime, [{ species: "tyranitar", ability: "unnerve", item: "shellbell", hp: 50, move: "rockslide" }, lax(0), lax(4), lax(8)]));
    expect([hp.min, hp.max]).toEqual([64, 67]);
    expect(hp.average).toBeCloseTo(65.265625, 6);
  });

  it("G4-SPH-06-swsh: Shell Bell leaves a Substitute's damage out (140: trunc(160 / 8))", async () => {
    const runtime = await game("sword_shield");
    const hp = user(turn(runtime, [
      { species: "tyranitar", ability: "unnerve", item: "shellbell", hp: 120, move: "rockslide" }, lax(0),
      { species: "charizard", ability: "blaze", substitute: 39, move: null }, { species: "volcarona", ability: "flamebody", move: null },
    ]));
    expect([hp.min, hp.max]).toEqual([140, 140]);
  });

  it("G4-SPH-07-usum: Parabolic Charge drains from the user's ally too (to its maximum, 137)", async () => {
    const runtime = await game("ultra_sun_ultra_moon");
    const hp = user(turn(runtime, [
      { species: "heliolisk", ability: "dryskin", hp: 60, move: "paraboliccharge" }, lax(0),
      { species: "gyarados", ability: "intimidate", move: null }, { species: "pelipper", ability: "keeneye", move: null },
    ]));
    expect([hp.min, hp.max]).toEqual([137, 137]);
  });
});
