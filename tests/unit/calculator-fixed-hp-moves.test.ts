import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";
import championsCatalog from "@/data/champions/catalog.json";
import svCatalog from "@/data/battle/scarlet_violet/catalog.json";
import swshCatalog from "@/data/battle/sword_shield/catalog.json";
import usumCatalog from "@/data/battle/ultra_sun_ultra_moon/catalog.json";

type Game = "champions" | "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon";
/** dl: Dynamax Level (default 10). */
type Mon = { id: string; ability: string; hp?: number; dynamax?: boolean; dl?: number; tera?: string; item?: string };

/**
 * HP lost in a real pinned Showdown c23d2e94 turn (champions, gen9, gen8 and gen7
 * custom games), so Endeavor's HP check, Wonder Guard, -ate retyping, Scrappy, Tera
 * and Dynamax HP all ran through the real hit steps. Level 50, 0 Stat Points/EVs,
 * 31 IVs, Serious nature. 0 means immune, failed or (Endeavor into Dynamax) no damage.
 */
const CASES: [Game, Mon, Mon, string, number][] = [
  ["champions", { id: "maushold", ability: "technician" }, { id: "snorlax", ability: "thickfat" }, "superfang", 117],
  ["champions", { id: "maushold", ability: "technician" }, { id: "snorlax", ability: "thickfat", hp: 101 }, "superfang", 50],
  ["champions", { id: "maushold", ability: "technician" }, { id: "snorlax", ability: "thickfat", hp: 1 }, "superfang", 1],
  ["champions", { id: "maushold", ability: "technician" }, { id: "gengar", ability: "cursedbody" }, "superfang", 0],
  ["champions", { id: "slurpuff", ability: "sweetveil", hp: 50 }, { id: "snorlax", ability: "thickfat" }, "endeavor", 185],
  ["champions", { id: "slurpuff", ability: "sweetveil" }, { id: "snorlax", ability: "thickfat", hp: 100 }, "endeavor", 0],
  ["champions", { id: "slurpuff", ability: "sweetveil", hp: 100 }, { id: "snorlax", ability: "thickfat", hp: 100 }, "endeavor", 0],
  ["champions", { id: "slurpuff", ability: "sweetveil", hp: 50 }, { id: "gengar", ability: "cursedbody" }, "endeavor", 0],
  ["champions", { id: "kangaskhan", ability: "scrappy", hp: 50 }, { id: "gengar", ability: "cursedbody" }, "endeavor", 85],
  ["champions", { id: "kangaskhanmega", ability: "parentalbond", hp: 50 }, { id: "snorlax", ability: "thickfat" }, "endeavor", 185],
  ["champions", { id: "altariamega", ability: "pixilate", hp: 50 }, { id: "gengar", ability: "cursedbody" }, "endeavor", 85],
  ["champions", { id: "feraligatrmega", ability: "dragonize", hp: 50 }, { id: "clefable", ability: "magicguard" }, "endeavor", 0],
  // Rivalry cannot change fixed damage, so no genders are needed.
  ["champions", { id: "pyroar", ability: "rivalry", hp: 50 }, { id: "snorlax", ability: "thickfat" }, "endeavor", 185],
  ["scarlet_violet", { id: "maushold", ability: "technician" }, { id: "snorlax", ability: "thickfat", tera: "Ghost" }, "superfang", 0],
  ["scarlet_violet", { id: "maushold", ability: "technician" }, { id: "gengar", ability: "cursedbody", tera: "Normal" }, "superfang", 67],
  ["scarlet_violet", { id: "maushold", ability: "technician" }, { id: "weezing", ability: "neutralizinggas", tera: "Ghost" }, "superfang", 0],
  // Neutralizing Gas switches Scrappy off; Klutz switches Ring Target off.
  ["scarlet_violet", { id: "flamigo", ability: "scrappy", hp: 50 }, { id: "weezing", ability: "neutralizinggas", tera: "Ghost" }, "endeavor", 0],
  ["scarlet_violet", { id: "flamigo", ability: "scrappy", hp: 50 }, { id: "weezing", ability: "levitate", tera: "Ghost" }, "endeavor", 90],
  ["scarlet_violet", { id: "maushold", ability: "technician" }, { id: "golurk", ability: "klutz", item: "ringtarget" }, "superfang", 0],
  ["scarlet_violet", { id: "maushold", ability: "technician" }, { id: "golurk", ability: "noguard", item: "ringtarget" }, "superfang", 82],
  ["scarlet_violet", { id: "chienpao", ability: "swordofruin" }, { id: "snorlax", ability: "thickfat", hp: 101 }, "ruination", 50],
  ["scarlet_violet", { id: "chienpao", ability: "swordofruin" }, { id: "gengar", ability: "cursedbody" }, "ruination", 67],
  ["sword_shield", { id: "diggersby", ability: "hugepower" }, { id: "snorlax", ability: "thickfat", dynamax: true }, "superfang", 117],
  ["sword_shield", { id: "diggersby", ability: "hugepower" }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, "superfang", 50],
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 50 }, { id: "snorlax", ability: "thickfat", dynamax: true }, "endeavor", 185],
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 150 }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, "endeavor", 1],
  // Endeavor's fail check uses Dynamax HP; an exact 0 stays 0, a negative result becomes 1.
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 101 }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, "endeavor", 0],
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 100 }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, "endeavor", 1],
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 102 }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, "endeavor", 1],
  // Below Dynamax Level 10 the HP scaled back from Dynamax is rounded up (102 becomes 103).
  ["sword_shield", { id: "diggersby", ability: "hugepower", hp: 50 }, { id: "snorlax", ability: "thickfat", hp: 102, dynamax: true, dl: 0 }, "endeavor", 53],
  ["sword_shield", { id: "diggersby", ability: "hugepower" }, { id: "snorlax", ability: "thickfat", hp: 103, dynamax: true, dl: 0 }, "superfang", 51],
  ["sword_shield", { id: "diggersby", ability: "hugepower" }, { id: "snorlax", ability: "thickfat", hp: 101, dynamax: true, dl: 5 }, "superfang", 50],
  ["sword_shield", { id: "tapukoko", ability: "electricsurge" }, { id: "snorlax", ability: "thickfat", hp: 101 }, "naturesmadness", 50],
  ["ultra_sun_ultra_moon", { id: "glaliemega", ability: "refrigerate" }, { id: "gengar", ability: "cursedbody" }, "superfang", 67],
  ["ultra_sun_ultra_moon", { id: "raticate", ability: "guts" }, { id: "shedinja", ability: "wonderguard" }, "superfang", 0],
  ["ultra_sun_ultra_moon", { id: "tapulele", ability: "psychicsurge" }, { id: "shedinja", ability: "wonderguard" }, "naturesmadness", 0],
  ["ultra_sun_ultra_moon", { id: "tapulele", ability: "psychicsurge" }, { id: "snorlax", ability: "thickfat", hp: 1 }, "naturesmadness", 1],
];

const runtimes = new Map<Game, BattleRuntime>([["champions", championsRuntime]]);
async function runtimeFor(game: Game) {
  if (!runtimes.has(game)) runtimes.set(game, await loadBattleRuntime(game as Exclude<Game, "champions">));
  return runtimes.get(game)!;
}

function build(mon: Mon, runtime: BattleRuntime): BattleBuild {
  return {
    ...createBuild(mon.id, runtime), abilityId: mon.ability, currentHP: mon.hp ?? null, ...(mon.item ? { itemId: mon.item } : {}),
    ...(mon.dynamax ? { mechanic: "dynamax" as const, configuration: { dynamaxLevel: mon.dl ?? 10 } } : {}),
    ...(mon.tera ? { mechanic: "tera" as const, configuration: { teraType: mon.tera } } : {}),
  };
}

function row(runtime: BattleRuntime, attacker: BattleBuild, defender: BattleBuild, moveId: string,
  field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field },
    context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

describe("HP-based fixed damage", () => {
  it.each(CASES)("%s: %o uses %s on %o like a Showdown turn", async (game, attacker, defender, moveId, expected) => {
    const runtime = await runtimeFor(game);
    for (const gameType of ["Singles", "Doubles"] as const) {
      const result = row(runtime, build(attacker, runtime), build(defender, runtime), moveId, { gameType });
      expect(result).toMatchObject({ kind: "calculated", min: expected, max: expected, rolls: expected, hits: 1 });
    }
  });

  it("ignores stats, stages, items, screens and critical hits", () => {
    const attacker = { ...build({ id: "maushold", ability: "technician" }, championsRuntime), itemId: "silkscarf", boosts: { ...createBuild("maushold").boosts, atk: 6 } };
    const conditions = { critical: true, defenderSide: { ...createConditions().defenderSide, reflect: true } };
    const result = row(championsRuntime, attacker, build({ id: "snorlax", ability: "thickfat" }, championsRuntime), "superfang", conditions);
    expect(result).toMatchObject({ kind: "calculated", min: 117, max: 117, effectivePower: 0, effectiveType: "Normal", ohkoChance: 0 });
    expect(result.description).toBe("Super Fang: 117–117 HP (49.8–49.8% of maximum HP).");
    expect(result.assumptions).toContain("Fixed damage: half the defender's current HP (235), rounded down, at least 1.");
  });

  it("explains Endeavor's rule, failure and the attacker HP it uses", () => {
    const snorlax = build({ id: "snorlax", ability: "thickfat" }, championsRuntime);
    const hurt = row(championsRuntime, build({ id: "slurpuff", ability: "sweetveil", hp: 50 }, championsRuntime), snorlax, "endeavor");
    expect(hurt.assumptions).toContain("Fixed damage: the defender's current HP (235) minus the attacker's current HP (50), at least 1.");
    expect(hurt.ohkoChance).toBe(0);
    const fails = row(championsRuntime, build({ id: "slurpuff", ability: "sweetveil" }, championsRuntime), { ...snorlax, currentHP: 100 }, "endeavor");
    expect(fails).toMatchObject({ kind: "calculated", min: 0, max: 0, ohkoChance: 0,
      description: "Endeavor fails because the attacker's HP (157) is not lower than the defender's (100)." });
  });

  it("names immunities, Dynamax HP and retyping", async () => {
    const gengar = build({ id: "gengar", ability: "cursedbody" }, championsRuntime);
    expect(row(championsRuntime, build({ id: "maushold", ability: "technician" }, championsRuntime), gengar, "superfang").description)
      .toBe("Super Fang does not affect the defender's type.");
    // A blocked row keeps the -ate type the move had.
    const dragonize = row(championsRuntime, build({ id: "feraligatrmega", ability: "dragonize", hp: 50 }, championsRuntime), build({ id: "clefable", ability: "magicguard" }, championsRuntime), "endeavor");
    expect(dragonize).toMatchObject({ min: 0, effectiveType: "Dragon", description: "Dragon-type Endeavor does not affect the defender's type." });
    const sv = await runtimeFor("scarlet_violet");
    // The engine reports Neutralizing Gas as applied, but the Ghost Tera type is what blocks.
    expect(row(sv, build({ id: "maushold", ability: "technician" }, sv), build({ id: "weezing", ability: "neutralizinggas", tera: "Ghost" }, sv), "superfang").description)
      .toBe("Super Fang does not affect the defender's type.");
    // Abilities that only switch another effect off are not named as the blocker.
    expect(row(sv, build({ id: "flamigo", ability: "scrappy", hp: 50 }, sv), build({ id: "weezing", ability: "neutralizinggas", tera: "Ghost" }, sv), "endeavor").description)
      .toBe("Endeavor does not affect the defender's type.");
    expect(row(sv, build({ id: "maushold", ability: "technician" }, sv), build({ id: "golurk", ability: "klutz", item: "ringtarget" }, sv), "superfang").description)
      .toBe("Super Fang does not affect the defender's type.");
    const pixilate = row(championsRuntime, build({ id: "altariamega", ability: "pixilate", hp: 50 }, championsRuntime), gengar, "endeavor");
    expect(pixilate).toMatchObject({ effectiveType: "Fairy", min: 85 });
    expect(pixilate.assumptions).toContain("Effective move type: Fairy.");
    const usum = await runtimeFor("ultra_sun_ultra_moon");
    expect(row(usum, build({ id: "tapulele", ability: "psychicsurge" }, usum), build({ id: "shedinja", ability: "wonderguard" }, usum), "naturesmadness").description)
      .toBe("Wonder Guard blocks Nature's Madness.");
    const swsh = await runtimeFor("sword_shield");
    const dynamaxed = row(swsh, build({ id: "diggersby", ability: "hugepower" }, swsh), build({ id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, swsh), "superfang");
    expect(dynamaxed.assumptions).toContain("Fixed damage: half the defender's current HP scaled back from Dynamax (101), rounded down, at least 1.");
    const level0 = row(swsh, build({ id: "diggersby", ability: "hugepower", hp: 50 }, swsh), build({ id: "snorlax", ability: "thickfat", hp: 102, dynamax: true, dl: 0 }, swsh), "endeavor");
    expect(level0.assumptions).toContain("Fixed damage: the defender's current HP scaled back from Dynamax (103) minus the attacker's current HP (50), at least 1.");
    const even = row(swsh, build({ id: "diggersby", ability: "hugepower", hp: 101 }, swsh), build({ id: "snorlax", ability: "thickfat", hp: 101, dynamax: true }, swsh), "endeavor");
    expect(even).toMatchObject({ kind: "calculated", min: 0, max: 0, ohkoChance: 0,
      description: "Endeavor deals no damage: the defender's HP scaled back from Dynamax (101) equals the attacker's HP." });
  });

  it("does not ask for Rivalry genders or Analytic turn order, which cannot change fixed damage", () => {
    const pyroar = build({ id: "pyroar", ability: "rivalry", hp: 50 }, championsRuntime);
    const snorlax = build({ id: "snorlax", ability: "thickfat" }, championsRuntime);
    expect(row(championsRuntime, pyroar, snorlax, "endeavor")).toMatchObject({ kind: "calculated", min: 185 });
    const watchog = build({ id: "watchog", ability: "analytic" }, championsRuntime);
    expect(row(championsRuntime, watchog, snorlax, "superfang", { gameType: "Doubles" })).toMatchObject({ kind: "calculated", min: 117 });
    // Ordinary attacks still ask in Doubles.
    expect(row(championsRuntime, watchog, snorlax, "crunch", { gameType: "Doubles" }).kind).toBe("needs-context");
  });

  it("gives the KO chance from remaining HP, and none with Focus Band", () => {
    const maushold = build({ id: "maushold", ability: "technician" }, championsRuntime);
    const lastHP = build({ id: "snorlax", ability: "thickfat", hp: 1 }, championsRuntime);
    expect(row(championsRuntime, maushold, lastHP, "superfang").ohkoChance).toBe(1);
    const band = row(championsRuntime, maushold, { ...lastHP, itemId: "focusband" }, "superfang");
    expect(band.ohkoChance).toBeNull();
    expect(band.assumptions).toContain("Focus Band is not modelled: no KO chance or Uses to KO.");
  });

  it("leaves Z-Move and Max Move conversions to the ordinary damage path", async () => {
    const usum = await runtimeFor("ultra_sun_ultra_moon");
    const raticate = { ...build({ id: "raticate", ability: "guts" }, usum), itemId: "normaliumz" };
    const z = row(usum, raticate, build({ id: "snorlax", ability: "thickfat" }, usum), "superfang", {}, { useZ: true });
    expect(z).toMatchObject({ kind: "calculated", effectiveName: "Breakneck Blitz", effectivePower: 100 });
    expect(z.min).toBeLessThan(z.max as number);
    const swsh = await runtimeFor("sword_shield");
    const max = row(swsh, build({ id: "diggersby", ability: "hugepower", dynamax: true }, swsh), build({ id: "snorlax", ability: "thickfat" }, swsh), "superfang");
    expect(max).toMatchObject({ kind: "calculated", effectiveName: "Max Strike" });
  });

  it("has no Parental Bond Pokémon that learns a half-HP move, which would strike twice", () => {
    for (const catalog of [championsCatalog, svCatalog, swshCatalog, usumCatalog] as { species: { id: string; abilities: string[]; moves: string[] }[] }[]) {
      const learners = catalog.species.filter((species) => species.abilities.includes("parentalbond")
        && ["superfang", "naturesmadness", "ruination"].some((move) => species.moves.includes(move)));
      expect(learners.map((species) => species.id)).toEqual([]);
    }
  });
});
