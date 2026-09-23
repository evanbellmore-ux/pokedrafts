import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { getBuildHealth, previewRemainingHP, type DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { activateMoveSlot, createMatchup, getAttackView, getMoveOwner, selectMatchupMove, updateMatchupBuild, updateMatchupHP } from "@/app/(app)/calculator/roster-prep";
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
const modes: DamageRollMode[] = ["low", "average", "high"];

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
    for (const mode of modes) expect(previewRemainingHP(build, zero(), mode)).toMatchObject({ status: "unavailable", reason: expect.any(String) });
  });

  it.each([null, -1, 33, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid Stat Points %s", (value) => {
    const build = createBuild("venusaur");
    build.points.atk = value;
    expect(getBuildHealth(build)).toBeNull();
    for (const mode of modes) expect(previewRemainingHP(build, zero(), mode).status).toBe("unavailable");
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
      for (const mode of modes) expect(previewRemainingHP(build, zero(), mode).status).toBe("unavailable");
    }
  });

  it("defaults to average damage, rounded once to whole HP", () => {
    const build = { ...createBuild("venusaur"), currentHP: 100 };
    expect(previewRemainingHP(build, damage())).toMatchObject({ status: "ready", damage: 28, remaining: 72 });
    expect(previewRemainingHP(build, damage())).toEqual(previewRemainingHP(build, damage(), "average"));
  });
});

describe.each(modes)("remaining HP preview (%s roll)", (mode) => {
  const preview = (defender: BattleBuild, row: MoveDamageResult | undefined) => previewRemainingHP(defender, row, mode);
  const chosen = mode === "low" ? 20 : mode === "high" ? 35 : 28;

  it.each([
    [null, 120, 135], [100, 65, 80], [30, 0, 10], [20, 0, 0], [1, 0, 0],
  ])("returns remaining bounds and the chosen outcome at HP %s, clamping overkill", (currentHP, min, max) => {
    const defender = { ...createBuild("venusaur"), currentHP };
    const row = damage();
    const before = structuredClone({ defender, row });
    expect(preview(defender, row)).toEqual({
      status: "ready", min, max, current: currentHP ?? 155, maximum: 155,
      damage: chosen, remaining: Math.max(0, (currentHP ?? 155) - chosen),
    });
    expect({ defender, row }).toEqual(before);
  });

  it.each([[91, 24], [92, 25]])("retains repeated roll weights and rounds the mean for maximum damage %s", (max, average) => {
    const defender = { ...createBuild("venusaur"), currentHP: 100 };
    const row = damage({ min: 20, max, rolls: [...Array(15).fill(20), max] });
    const selectedDamage = mode === "low" ? 20 : mode === "high" ? max : average;
    expect(preview(defender, row)).toMatchObject({ status: "ready", damage: selectedDamage, remaining: 100 - selectedDamage });
    expect(average).not.toBe(Math.round((20 + max) / 2));
  });

  it("subtracts chosen damage before clamping rather than averaging clamped HP outcomes", () => {
    const row = damage({ min: 20, max: 92, rolls: [...Array(15).fill(20), 92] });
    const selectedDamage = mode === "low" ? 20 : mode === "high" ? 92 : 25;
    expect(preview({ ...createBuild("venusaur"), currentHP: 30 }, row)).toMatchObject({
      status: "ready", damage: selectedDamage, remaining: Math.max(0, 30 - selectedDamage),
    });
  });

  it("uses trained maximum HP while subtracting from explicit current HP", () => {
    const defender = { ...createBuild("venusaur"), currentHP: 100 };
    defender.points.hp = 32;
    expect(preview(defender, damage())).toMatchObject({ status: "ready", current: 100, maximum: 187, damage: chosen, remaining: 100 - chosen });
  });

  it("supports numeric fixed damage and always uses the latest HP and row", () => {
    const defender = createBuild("venusaur");
    expect(preview(defender, damage({ min: 50, max: 50, rolls: 50 }))).toEqual({ status: "ready", min: 105, max: 105, current: 155, maximum: 155, damage: 50, remaining: 105 });
    const edited = { ...defender, currentHP: 70 };
    expect(preview(edited, damage())).toEqual({ status: "ready", min: 35, max: 50, current: 70, maximum: 155, damage: chosen, remaining: 70 - chosen });
    expect(preview(edited, undefined).status).toBe("unavailable");
    expect(defender.currentHP).toBeNull();
    expect(edited.currentHP).toBe(70);
  });

  it("preserves proven zero for flat or fixed rolls instead of fabricating damage", () => {
    const defender = { ...createBuild("venusaur"), currentHP: 83 };
    for (const rolls of [0, Array(16).fill(0)]) {
      expect(preview(defender, damage({ min: 0, max: 0, rolls }))).toEqual({ status: "ready", min: 83, max: 83, current: 83, maximum: 155, damage: 0, remaining: 83 });
    }
  });

  it.each(["focussash", "focusband", "sturdy"] as const)("keeps true zero with %s even for multi-hit/null KO semantics", (effect) => {
    const defender = { ...survivalBuild(effect), currentHP: 83 };
    expect(preview(defender, { ...zero(), hits: 5, ohkoChance: null })).toEqual({
      status: "ready", min: 83, max: 83, current: 83, maximum: getBuildStats(defender)!.hp, damage: 0, remaining: 83,
    });
  });

  it.each(["focussash", "focusband", "sturdy"] as const)("withholds nonzero damage with %s, including partial HP and claimed bypass", (effect) => {
    const defender = survivalBuild(effect);
    const row = damage({ description: "Survival effect suppressed.", assumptions: ["Mold Breaker bypasses the ability."] });
    for (const currentHP of [null, 100]) {
      expect(preview({ ...defender, currentHP }, row)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("survival") });
    }
  });

  it.each(["status", "needs-context", "unsupported"] as const)("does not reinterpret %s as calculated zero", (kind) => {
    expect(preview(createBuild(), { ...zero(), kind })).toMatchObject({ status: "unavailable", reason: expect.any(String) });
  });

  it.each([null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid damage bound %s", (value) => {
    for (const field of ["min", "max"] as const) {
      expect(preview(createBuild(), damage({ [field]: value })).status).toBe("unavailable");
    }
  });

  it("rejects reversed or contradictory damage bounds", () => {
    for (const row of [damage({ min: 36 }), damage({ min: 19 }), damage({ max: 36 }), damage({ rolls: 20 })]) {
      expect(preview(createBuild(), row).status).toBe("unavailable");
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
      expect(preview(createBuild(), damage({ rolls: rolls as MoveDamageResult["rolls"] })).status).toBe("unavailable");
    }
    for (const rolls of [null, Number.NaN, [], Array(16).fill(1), Array(16).fill(null)]) {
      expect(preview(createBuild(), { ...zero(), rolls }).status).toBe("unavailable");
    }
  });

  it.each([null, 0, -1, 2, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("withholds nonzero damage with hit count %s", (hits) => {
    expect(preview(createBuild(), damage({ hits })).status).toBe("unavailable");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])("withholds unresolved or invalid KO semantics %s", (ohkoChance) => {
    expect(preview(createBuild(), damage({ ohkoChance })).status).toBe("unavailable");
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
    const selectedDamage = mode === "low" ? 138 : mode === "high" ? 164 : 151;
    expect(raw).toMatchObject({ min: 138, max: 164, ohkoChance: 6 / 16 });
    expect(preview(defender, raw)).toEqual({ status: "ready", min: 0, max: 17, current: 155, maximum: 155, damage: selectedDamage, remaining: Math.max(0, 155 - selectedDamage) });
    const sash = { ...defender, itemId: "focussash" };
    const protectedRow = calculate(sash);
    expect(protectedRow).toMatchObject({ min: 138, max: 164, ohkoChance: 0 });
    const before = structuredClone({ sash, protectedRow });
    expect(preview(sash, protectedRow).status).toBe("unavailable");
    expect({ sash, protectedRow }).toEqual(before);
    const band = { ...defender, itemId: "focusband" };
    const bandRow = calculate(band);
    expect(bandRow.ohkoChance).toBeNull();
    expect(preview(band, bandRow).status).toBe("unavailable");
  });

  it("previews an actual immunity but withholds actual multi-hit damage", () => {
    const defender = createBuild("audino");
    const immune = calculateMatchup(createBuild("gengar"), defender, createConditions()).results.find((row) => row.moveId === "shadowball");
    expect(immune).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    const health = getBuildHealth(defender)!;
    expect(preview(defender, immune)).toEqual({ status: "ready", ...health, min: health.current, max: health.current, damage: 0, remaining: health.current });
    const multi = calculateMatchup(createBuild("heracrossmega"), defender, createConditions()).results.find((row) => row.moveId === "bulletseed");
    expect(multi).toMatchObject({ kind: "calculated", hits: 5, ohkoChance: null });
    expect(preview(defender, multi).status).toBe("unavailable");
  });
});

describe.each(modes)("directional receiving-HP preview (%s roll)", (mode) => {
  it("uses the left receiving build, its trained maximum and actual reverse engine rolls without changing either HP", () => {
    let matchup = createMatchup();
    assert(matchup.attacker.build.game === "champions");
    matchup = updateMatchupBuild(matchup, "attacker", {
      ...matchup.attacker.build, currentHP: 120, points: { ...matchup.attacker.build.points, hp: 32 },
    });
    matchup = updateMatchupHP(matchup, "defender", "60");
    matchup = { ...matchup, field: { ...matchup.field, attackerSide: { ...matchup.field.attackerSide, lightScreen: true } } };
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "surf");
    const before = structuredClone(matchup);
    const view = getAttackView(matchup);
    expect(view.source).toBe(matchup.defender);
    expect(view.receiver).toBe(matchup.attacker);
    expect(view.receiverOwner).toEqual(getMoveOwner(matchup.attacker));
    const actual = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts);
    const expected = calculateMatchup(matchup.defender.build, matchup.attacker.build, {
      ...matchup.field, attackerSide: matchup.field.defenderSide, defenderSide: matchup.field.attackerSide,
    }, matchup.defender.contexts);
    expect(actual).toEqual(expected);
    expect(actual.issues).toEqual({ attacker: [], defender: [], field: [] });
    const row = actual.results.find((row) => row.moveId === view.moveId)!;
    expect(row).toMatchObject({ kind: "calculated", hits: 1 });
    expect(Array.isArray(row.rolls)).toBe(true);
    const rolls = row.rolls as number[];
    const chosen = mode === "low" ? row.min! : mode === "high" ? row.max! : Math.round(rolls.reduce((sum, roll) => sum + roll, 0) / rolls.length);
    expect(previewRemainingHP(view.receiver.build, row, mode)).toEqual({
      status: "ready", current: 120, maximum: 185,
      min: Math.max(0, 120 - row.max!), max: Math.max(0, 120 - row.min!),
      damage: chosen, remaining: Math.max(0, 120 - chosen),
    });
    expect(matchup).toEqual(before);
    expect(matchup.attacker.build.currentHP).toBe(120);
    expect(matchup.defender.build.currentHP).toBe(60);
    const edited = updateMatchupHP(matchup, "attacker", "0010");
    const latestView = getAttackView(edited);
    const latestRow = calculateMatchup(latestView.source.build, latestView.receiver.build, latestView.field, latestView.contexts).results.find((entry) => entry.moveId === "surf")!;
    expect(previewRemainingHP(latestView.receiver.build, latestRow, mode)).toMatchObject({ status: "ready", current: 10, maximum: 185, remaining: 0 });
    expect(edited.attack).toBe(matchup.attack);
    expect(edited.attacker.hpInput).toBe("0010");
    expect(edited.attacker.build.currentHP).toBe(10);
    expect(edited.defender.build.currentHP).toBe(60);
    expect(matchup).toEqual(before);
  });

  it.each(["focussash", "focusband", "sturdy"] as const)("uses survival safety on the reverse receiving Pokémon with %s", (effect) => {
    let matchup = updateMatchupBuild(createMatchup(), "attacker", survivalBuild(effect));
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "surf");
    const view = getAttackView(matchup);
    const row = damage({ moveId: "surf", min: 50, max: 50, rolls: 50 });
    expect(previewRemainingHP(view.receiver.build, row, mode)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("survival") });
    expect(previewRemainingHP(view.source.build, row, mode).status).toBe("ready");
    expect(matchup.attacker.build.currentHP).toBeNull();
    expect(matchup.defender.build.currentHP).toBeNull();
  });

  it("does not withhold receiving HP because the source holds a survival item", () => {
    let matchup = updateMatchupHP(createMatchup(), "attacker", "100");
    matchup = updateMatchupBuild(matchup, "defender", { ...matchup.defender.build, itemId: "focusband" });
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "surf");
    const view = getAttackView(matchup);
    const row = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts).results.find((entry) => entry.moveId === "surf")!;
    expect(previewRemainingHP(view.receiver.build, row, mode)).toMatchObject({ status: "ready", current: 100, maximum: 153 });
    expect(matchup.attacker.build.currentHP).toBe(100);
    expect(matchup.defender.build.currentHP).toBeNull();
  });

  it("preserves a proven reverse immunity rather than inventing damage or changing current HP", () => {
    let matchup = updateMatchupBuild(createMatchup(), "attacker", { ...createBuild("audino"), currentHP: 83 });
    matchup = updateMatchupBuild(matchup, "defender", createBuild("gengar"));
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "shadowball");
    const view = getAttackView(matchup);
    const before = structuredClone(matchup);
    const row = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts).results.find((entry) => entry.moveId === "shadowball")!;
    expect(row).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    expect(previewRemainingHP(view.receiver.build, row, mode)).toEqual({
      status: "ready", current: 83, maximum: getBuildStats(matchup.attacker.build)!.hp, min: 83, max: 83, damage: 0, remaining: 83,
    });
    expect(matchup).toEqual(before);
  });
});
