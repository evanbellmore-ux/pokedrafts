import { describe, expect, it } from "vitest";
import { getBuildHealth, previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, getBuildStats } from "@/app/lib/battle/model";
import type { BattleBuild, MoveDamageResult } from "@/app/lib/battle/types";

function damage(overrides: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return {
    moveId: "flamethrower", kind: "calculated", min: 20, max: 35,
    minPercent: null, maxPercent: null, rolls: Array.from({ length: 16 }, (_, index) => 20 + index),
    ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1, ...overrides,
  };
}

function survivalBuild(effect: "focussash" | "focusband" | "sturdy"): BattleBuild {
  return effect === "sturdy" ? { ...createBuild("aggron"), abilityId: effect }
    : { ...createBuild("venusaur"), itemId: effect };
}

const zero = () => damage({ min: 0, max: 0, rolls: 0, ohkoChance: 0 });

describe("calculator build health", () => {
  it.each([[null, 155], [155, 155], [100, 100], [1, 1]])("reads current HP %s without changing the build", (currentHP, current) => {
    const build = { ...createBuild("venusaur"), currentHP };
    const before = structuredClone(build);
    expect(getBuildHealth(build)).toEqual({ current, maximum: 155 });
    expect(build).toEqual(before);
  });

  it("uses trained maximum HP rather than treating explicit HP as the maximum", () => {
    const build = createBuild("venusaur");
    build.points.hp = 32;
    expect(getBuildHealth(build)).toEqual({ current: 187, maximum: 187 });
    build.currentHP = 100;
    expect(getBuildHealth(build)).toEqual({ current: 100, maximum: 187 });
  });

  it.each([0, -1, 1.5, 156, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects explicit HP %s, even for zero damage", (currentHP) => {
    const build = { ...createBuild("venusaur"), currentHP };
    expect(getBuildHealth(build)).toBeNull();
    expect(previewRemainingHP(build, zero())).toMatchObject({ status: "unavailable", reason: expect.any(String) });
  });

  it.each([null, -1, 33, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid Stat Points %s", (value) => {
    const build = createBuild("venusaur");
    build.points.atk = value;
    expect(getBuildHealth(build)).toBeNull();
    expect(previewRemainingHP(build, zero()).status).toBe("unavailable");
  });

  it("requires the whole build to be valid, not just calculable HP stats", () => {
    const overBudget = createBuild("venusaur");
    overBudget.points = { hp: 3, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    expect(getBuildStats(overBudget)?.hp).toBe(158);
    const invalid = [
      overBudget, createBuild("madeupmon"), createBuild("lucariomegaz"),
      { ...createBuild("venusaur"), nature: "Unknown" },
      { ...createBuild("venusaur"), abilityId: "sturdy" },
      { ...createBuild("venusaur"), itemId: "madeupitem" },
      { ...createBuild("charizardmegax"), itemId: "" },
      { ...createBuild("venusaur"), boosts: { ...createBuild().boosts, def: 7 } },
      { ...createBuild("greninja"), abilityId: "protean", abilityActive: false },
    ];
    for (const build of invalid) {
      expect(getBuildHealth(build)).toBeNull();
      expect(previewRemainingHP(build, zero()).status).toBe("unavailable");
    }
  });
});

describe("remaining HP preview", () => {
  it.each([
    [null, 120, 135], [100, 65, 80], [30, 0, 10], [20, 0, 0], [1, 0, 0],
  ])("returns ascending inclusive remaining bounds at HP %s, clamping overkill", (currentHP, min, max) => {
    const defender = { ...createBuild("venusaur"), currentHP };
    const row = damage();
    const before = structuredClone({ defender, row });
    expect(previewRemainingHP(defender, row)).toEqual({ status: "ready", min, max, current: currentHP ?? 155, maximum: 155 });
    expect({ defender, row }).toEqual(before);
  });

  it("supports numeric fixed damage and always uses the latest HP and row", () => {
    const defender = createBuild("venusaur");
    expect(previewRemainingHP(defender, damage({ min: 50, max: 50, rolls: 50 }))).toEqual({ status: "ready", min: 105, max: 105, current: 155, maximum: 155 });
    const edited = { ...defender, currentHP: 70 };
    expect(previewRemainingHP(edited, damage())).toEqual({ status: "ready", min: 35, max: 50, current: 70, maximum: 155 });
    expect(previewRemainingHP(edited, undefined).status).toBe("unavailable");
    expect(defender.currentHP).toBeNull();
    expect(edited.currentHP).toBe(70);
  });

  it("preserves proven zero for flat or fixed rolls instead of fabricating damage", () => {
    const defender = { ...createBuild("venusaur"), currentHP: 83 };
    for (const rolls of [0, Array(16).fill(0)]) {
      expect(previewRemainingHP(defender, damage({ min: 0, max: 0, rolls }))).toEqual({ status: "ready", min: 83, max: 83, current: 83, maximum: 155 });
    }
  });

  it.each(["focussash", "focusband", "sturdy"] as const)("keeps true zero with %s even for multi-hit/null KO semantics", (effect) => {
    const defender = { ...survivalBuild(effect), currentHP: 83 };
    expect(previewRemainingHP(defender, { ...zero(), hits: 5, ohkoChance: null })).toEqual({
      status: "ready", min: 83, max: 83, current: 83, maximum: getBuildStats(defender)!.hp,
    });
  });

  it.each(["focussash", "focusband", "sturdy"] as const)("withholds nonzero damage with %s, including partial HP and claimed bypass", (effect) => {
    const defender = survivalBuild(effect);
    const row = damage({ description: "Survival effect suppressed.", assumptions: ["Mold Breaker bypasses the ability."] });
    for (const currentHP of [null, 100]) {
      expect(previewRemainingHP({ ...defender, currentHP }, row)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("survival") });
    }
  });

  it.each(["status", "needs-context", "unsupported"] as const)("does not reinterpret %s as calculated zero", (kind) => {
    expect(previewRemainingHP(createBuild(), { ...zero(), kind })).toMatchObject({ status: "unavailable", reason: expect.any(String) });
  });

  it.each([null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid damage bound %s", (value) => {
    for (const field of ["min", "max"] as const) {
      expect(previewRemainingHP(createBuild(), damage({ [field]: value })).status).toBe("unavailable");
    }
  });

  it("rejects reversed or contradictory damage bounds", () => {
    for (const row of [damage({ min: 36 }), damage({ min: 19 }), damage({ max: 36 }), damage({ rolls: 20 })]) {
      expect(previewRemainingHP(createBuild(), row).status).toBe("unavailable");
    }
  });

  it("rejects null, malformed, sparse, nested and incomplete rolls rather than assuming a range", () => {
    const invalidRolls: unknown[] = [
      null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "20",
      [], Array(15).fill(20), Array(17).fill(20), Array(16), [Array(16).fill(20), Array(16).fill(35)],
      [...Array(15).fill(20), [35]], [...Array(15).fill(20), "35"], [...Array(15).fill(20), null],
      [...Array(15).fill(20), Number.NaN], [...Array(15).fill(20), Number.POSITIVE_INFINITY],
      [...Array(15).fill(20), -1], [...Array(15).fill(20), 20.5], [...Array(15).fill(20), Number.MAX_SAFE_INTEGER + 1],
    ];
    for (const rolls of invalidRolls) {
      expect(previewRemainingHP(createBuild(), damage({ rolls: rolls as MoveDamageResult["rolls"] })).status).toBe("unavailable");
    }
    for (const rolls of [null, Number.NaN, [], Array(16).fill(1), Array(16).fill(null)]) {
      expect(previewRemainingHP(createBuild(), { ...zero(), rolls }).status).toBe("unavailable");
    }
  });

  it.each([null, 0, -1, 2, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("withholds nonzero damage with hit count %s", (hits) => {
    expect(previewRemainingHP(createBuild(), damage({ hits })).status).toBe("unavailable");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])("withholds unresolved or invalid KO semantics %s", (ohkoChance) => {
    expect(previewRemainingHP(createBuild(), damage({ ohkoChance })).status).toBe("unavailable");
  });

  it("keeps Champions raw damage and KO separate from a survival-limited preview", () => {
    const attacker = createBuild("charizard");
    attacker.nature = "Timid";
    attacker.points = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    const defender = createBuild("venusaur");
    const field = createConditions();
    const calculate = (build: BattleBuild) => {
      const result = calculateMatchup(attacker, build, field);
      expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
      return result.results.find((row) => row.moveId === "flamethrower")!;
    };
    const raw = calculate(defender);
    expect(raw).toMatchObject({ min: 138, max: 164, ohkoChance: 6 / 16 });
    expect(previewRemainingHP(defender, raw)).toEqual({ status: "ready", min: 0, max: 17, current: 155, maximum: 155 });
    const sash = { ...defender, itemId: "focussash" };
    const protectedRow = calculate(sash);
    expect(protectedRow).toMatchObject({ min: 138, max: 164, ohkoChance: 0 });
    const before = structuredClone({ sash, protectedRow });
    expect(previewRemainingHP(sash, protectedRow).status).toBe("unavailable");
    expect({ sash, protectedRow }).toEqual(before);
    const band = { ...defender, itemId: "focusband" };
    const bandRow = calculate(band);
    expect(bandRow.ohkoChance).toBeNull();
    expect(previewRemainingHP(band, bandRow).status).toBe("unavailable");
  });

  it("previews an actual immunity but withholds actual multi-hit damage", () => {
    const defender = createBuild("audino");
    const immune = calculateMatchup(createBuild("gengar"), defender, createConditions()).results.find((row) => row.moveId === "shadowball");
    expect(immune).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    const health = getBuildHealth(defender)!;
    expect(previewRemainingHP(defender, immune)).toEqual({ status: "ready", ...health, min: health.current, max: health.current });
    const multi = calculateMatchup(createBuild("heracrossmega"), defender, createConditions()).results.find((row) => row.moveId === "bulletseed");
    expect(multi).toMatchObject({ kind: "calculated", hits: 5, ohkoChance: null });
    expect(previewRemainingHP(defender, multi).status).toBe("unavailable");
  });
});
