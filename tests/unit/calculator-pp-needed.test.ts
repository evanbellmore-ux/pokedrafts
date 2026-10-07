import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";
import { usesToKOText } from "@/app/(app)/calculator/uses-format";

/**
 * Uses to KO past the uses counted (ngas-pp N2): "Needs N uses, has M PP" (and Pressure's and the cap's lines) reports N, the
 * guaranteed count with the limit lifted, defined as `guaranteed` is: the first use after which no roll sequence is left, none
 * having fainted the attacker first. Crush Grip, Wring Out and Hard Press lose power with the target's HP, so a higher roll
 * early can leave more uses to go than the lowest rolls all through: the exact search runs on past the limit there.
 * Each count is pinned Showdown c23d2e94's (the exact multi-turn Uses oracle, scripts/.cache/calc-audit/ngas-pp/fix/u-oracle-pp.ts:
 * every roll of every use enumerated, the move's PP raised so the attacker never runs out; `ko` is the chance the target is
 * out within each number of uses). Singles, level 50, 31 IVs, 0 EVs.
 */
type Mon = { species: string; ability: string; nature: string; item?: string; hp?: number; mechanic?: BattleBuild["mechanic"] };
const runtimes = new Map<BattleGame, BattleRuntime>();
const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
async function row(game: BattleGame, move: string, a: Mon, d: Mon): Promise<MoveDamageResult> {
  const runtime = runtimes.get(game) ?? await loadBattleRuntime(game);
  runtimes.set(game, runtime);
  const build = (m: Mon) => {
    const abilityId = toID(m.ability);
    return { ...createBuild(toID(m.species), runtime), nature: m.nature, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toID(m.item ?? ""), currentHP: m.hp ?? null,
      ...(m.mechanic ? { mechanic: m.mechanic } : {}) } as BattleBuild;
  };
  const out = calculateMatchup(build(a), build(d), { ...createConditions(), gameType: "Singles" } as BattleConditions, {}, runtime);
  return out.results.find((entry) => entry.moveId === toID(move))!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
const counted = (value: UsesToKO | undefined): Counted => {
  expect(value?.kind).toBe("uses");
  return value as Counted;
};

describe("Needs N uses past the PP: the worst roll sequence's count", () => {
  it("Crush Grip into a Pressure Zapdos: 7 uses, where the lowest rolls all through need 6", async () => {
    // Showdown (sword_shield:8): ko 0, 0, 0, 0, 0, 0.981424, 1 within 1-7 uses; the lowest roll path is out on use 6.
    const value = await row("sword_shield", "Crush Grip", { species: "Regigigas", ability: "Slow Start", nature: "Impish", item: "Choice Band" },
      { species: "Zapdos", ability: "Pressure", nature: "Impish", item: "Figy Berry" });
    expect(counted(value.usesToKO)).toMatchObject({ guaranteed: null, limit: 4, limitReason: "pressure", needed: 7 });
    expect(usesToKOText(value, Infinity).details).toContain("Needs 7 uses; Pressure allows 4");
  });

  it("Wring Out into Wailord: 11 uses, where the lowest rolls need 9", async () => {
    // Showdown (ultra_sun_ultra_moon:54): out within 8 uses at 0.193238, 10 at 0.804734, 11 always; Life Orb never faints
    // Lickilicky before that.
    const value = await row("ultra_sun_ultra_moon", "Wring Out", { species: "Lickilicky", ability: "Oblivious", nature: "Adamant", item: "Life Orb" },
      { species: "Wailord", ability: "Oblivious", nature: "Adamant", item: "Figy Berry" });
    expect(counted(value.usesToKO)).toMatchObject({ guaranteed: null, fewest: 7, limit: 8, limitReason: "pp", needed: 11 });
    expect(usesToKOText(value, Infinity).details).toContain("Needs 11 uses, has 8 PP");
  });

  it("states the count past the limit where the lowest rolls are out within it", async () => {
    // Showdown (ultra_sun_ultra_moon:166): 0, 0.023438, 0.674072, 0.972534, 1 within 1-5 uses; the lowest roll path is out on
    // use 4, the most Pressure allows, so no count was given before.
    const absol = await row("ultra_sun_ultra_moon", "Crush Grip", { species: "Regigigas", ability: "Slow Start", nature: "Adamant", item: "Life Orb" },
      { species: "Absol", ability: "Pressure", nature: "Serious", item: "Oran Berry" });
    expect(counted(absol.usesToKO)).toMatchObject({ guaranteed: null, fewest: 2, limit: 4, limitReason: "pressure", needed: 5 });
    // Showdown (scarlet_violet:9): 0.315188 within 7 uses, 0.787639 within 8, 1 within 9; the lowest roll path is out on use 8.
    const snorlax = await row("scarlet_violet", "Crush Grip", { species: "Regigigas", ability: "Slow Start", nature: "Careful", item: "Life Orb" },
      { species: "Snorlax", ability: "Thick Fat", nature: "Bold", item: "Figy Berry", hp: 129 });
    expect(counted(snorlax.usesToKO)).toMatchObject({ guaranteed: null, fewest: 7, limit: 8, limitReason: "pp", needed: 9 });
  });

  it("gives no count where some sequence faints the attacker first once the limit is lifted", async () => {
    // Showdown (champions:7): no knockout within 11 uses, and Life Orb faints Metagross on use 11 (the lowest roll path alone
    // would need 18 uses).
    const value = await row("champions", "Hard Press", { species: "Metagross", ability: "Clear Body", nature: "Adamant", item: "Life Orb" },
      { species: "Kingambit", ability: "Pressure", nature: "Bold", item: "Sitrus Berry", hp: 96 });
    const uses = counted(value.usesToKO);
    expect(uses).toMatchObject({ guaranteed: null, fewest: null, limit: 6, limitReason: "pressure" });
    expect(uses.needed).toBeUndefined();
    expect(usesToKOText(value, Infinity)).toMatchObject({ label: "Runs out of PP", details: ["Pressure allows only 6 uses"] });
  });
});

/**
 * The ngas-pp verifier's rows (scripts/.cache/calc-audit/ngas-pp/verify/pp-needed.ts): each count is pinned Showdown c23d2e94's
 * with the PP lifted, read exactly (the first use after which no state of the walk is left, not a mass threshold: the lowest-roll
 * sequence of 40 uses has mass 16^-40), with the target's Splash given PP that never runs out (Champions gives it 20).
 */
describe("Needs N uses past the PP across move kinds (verifier rows)", () => {
  const cases: { title: string; game: BattleGame; move: string; a: Mon; d: Mon; expected: Partial<Counted>; line: string }[] = [
    { title: "Overheat lowers Sp. Atk each use, into a Sitrus Berry (P26)", game: "scarlet_violet", move: "Overheat",
      a: { species: "Charizard", ability: "Blaze", nature: "Serious" }, d: { species: "Blissey", ability: "Natural Cure", nature: "Serious", item: "Sitrus Berry" },
      expected: { limit: 8, limitReason: "pp", needed: 22 }, line: "Needs 22 uses, has 8 PP" },
    { title: "Dynamax: three Max Hailstorms, then Ice Beam (P88)", game: "sword_shield", move: "Ice Beam",
      a: { species: "Chansey", ability: "Natural Cure", nature: "Serious", mechanic: "dynamax" }, d: { species: "Corviknight", ability: "Pressure", nature: "Serious", item: "Leftovers" },
      expected: { limit: 8, limitReason: "pressure", fewest: 8, needed: 13 }, line: "Needs 13 uses; Pressure allows 8" },
    { title: "Hard Press in Champions, past the target's 20-PP Splash (P105)", game: "champions", move: "Hard Press",
      a: { species: "Snorlax", ability: "Thick Fat", nature: "Serious" }, d: { species: "Kingambit", ability: "Pressure", nature: "Serious", item: "Sitrus Berry" },
      expected: { limit: 6, limitReason: "pressure", needed: 42 }, line: "Needs 42 uses; Pressure allows 6" },
    { title: "Dual Wingbeat, a contact multi-hit move, by the exact search (P69)", game: "scarlet_violet", move: "Dual Wingbeat",
      a: { species: "Talonflame", ability: "Gale Wings", nature: "Serious" }, d: { species: "Kingambit", ability: "Pressure", nature: "Serious", item: "Leftovers", hp: 110 },
      expected: { limit: 8, limitReason: "pressure", needed: 17 }, line: "Needs 17 uses; Pressure allows 8" },
    { title: "Truant: one use every other turn, Leftovers on each (P98)", game: "scarlet_violet", move: "Body Slam",
      a: { species: "Slaking", ability: "Truant", nature: "Serious" }, d: { species: "Kingambit", ability: "Pressure", nature: "Serious", item: "Leftovers" },
      expected: { limit: 12, limitReason: "pressure", fewest: 10, needed: 15 }, line: "Needs 15 uses; Pressure allows 12" },
  ];
  it.each(cases)("$title", async ({ game, move, a, d, expected, line }) => {
    const value = await row(game, move, a, d);
    expect(counted(value.usesToKO)).toMatchObject({ guaranteed: null, ...expected });
    expect(usesToKOText(value, Infinity).details).toContain(line);
  });
});
