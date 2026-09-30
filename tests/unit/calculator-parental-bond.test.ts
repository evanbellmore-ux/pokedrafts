import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * Parental Bond's second strike against pinned Showdown c23d2e94's real useMove pipeline (per-hit
 * rolls, the target kept alive for the second strike). Mega Kangaskhan, level 50, 0 Stat Points/EVs,
 * 31 IVs, Serious nature, Singles unless stated, no crit. fix17/verify.ts also sweeps all 144 of its
 * calculated Champions rows into three targets.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, itemId?: string): BattleBuild {
  const base = createBuild(id, runtime);
  return { ...base, abilityId, itemId: itemId ?? base.itemId } as BattleBuild;
}

function strikes(moveId: string, defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime, context?: MoveContext) {
  const attacker = build("kangaskhanmega", "parentalbond", runtime);
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  const row = out.results.find((result) => result.moveId === moveId)!;
  expect(row.kind).toBe("calculated");
  const rolls = row.rolls as number[] | number[][];
  return { row, strikes: Array.isArray(rolls[0]) ? (rolls as number[][]).map((hit) => `${hit[0]}-${hit[15]}`) : [`${row.min}-${row.max}`] };
}

describe("Parental Bond's second strike", () => {
  it("keeps its quarter when Mummy or Wandering Spirit replaces Parental Bond", () => {
    expect(strikes("crunch", build("cofagrigus", "mummy")).strikes).toEqual(["54-64", "12-16"]);
    expect(strikes("crunch", build("runerigus", "wanderingspirit")).strikes).toEqual(["54-64", "12-16"]);
  });

  it("is not halved by a resist berry the first strike ate", () => {
    expect(strikes("crunch", build("gengar", "cursedbody", championsRuntime, "colburberry")).strikes).toEqual(["55-65", "26-32"]);
    expect(strikes("icebeam", build("garchomp", "roughskin", championsRuntime, "yacheberry")).strikes).toEqual(["54-64", "24-32"]);
    expect(strikes("bodyslam", build("alakazam", "synchronize", championsRuntime, "chilanberry")).strikes).toEqual(["54-63", "25-31"]);
    expect(strikes("terrainpulse", build("machamp", "guts", championsRuntime, "payapaberry"), { terrain: "Psychic" }).strikes).toEqual(["38-45", "18-22"]);
  });

  it("uses White Herb only after the whole move, so Weak Armor's drop lands first", async () => {
    const skarmory = build("skarmory", "weakarmor", championsRuntime, "whiteherb");
    expect(strikes("bodyslam", skarmory).strikes).toEqual(["21-26", "8-9"]);
    expect(strikes("bodyslam", skarmory, { critical: true }).strikes).toEqual(["33-39", "12-14"]);
    expect(strikes("bodyslam", skarmory, { magicRoom: true }).strikes).toEqual(["21-26", "8-9"]);
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(strikes("bodyslam", build("crustle", "weakarmor", usum, "whiteherb"), {}, usum).strikes).toEqual(["24-29", "8-10"]);
  });

  it("keeps Terrain Pulse's type and power, and a used-up Seed's rise, after Seed Sower", () => {
    const arboliva = build("arboliva", "seedsower");
    expect(strikes("terrainpulse", arboliva).strikes).toEqual(["18-22", "4-6"]);
    expect(strikes("terrainpulse", arboliva, { terrain: "Psychic" }).strikes).toEqual(["31-37", "5-7"]);
    expect(strikes("terrainpulse", arboliva, { terrain: "Electric" }).strikes).toEqual(["15-18", "2-3"]);
    expect(strikes("terrainpulse", arboliva, { terrain: "Grassy" }).strikes).toEqual(["15-18", "3-4"]);
    expect(strikes("bodyslam", build("arboliva", "seedsower", championsRuntime, "electricseed"), { terrain: "Electric" }).strikes).toEqual(["42-51", "9-12"]);
    expect(strikes("icebeam", build("arboliva", "seedsower", championsRuntime, "psychicseed"), { terrain: "Psychic" }).strikes).toEqual(["30-36", "6-8"]);
  });

  it("stops Luminous Moss under Magic Room or Klutz", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const chansey = build("chansey", "naturalcure", usum, "luminousmoss");
    expect(strikes("surf", chansey, {}, usum).strikes).toEqual(["22-27", "3-4"]);
    expect(strikes("surf", chansey, { magicRoom: true }, usum).strikes).toEqual(["22-27", "5-7"]);
    expect(strikes("surf", build("audino", "klutz", usum, "luminousmoss"), {}, usum).strikes).toEqual(["26-31", "6-8"]);
  });

  it("adds no strike to a multi-hit move, and names no Parental Bond", () => {
    const doubleHit = strikes("doublehit", build("snorlax", "thickfat"));
    expect(doubleHit.strikes).toEqual(["34-42", "34-42"]);
    expect(doubleHit.row.assumptions).toContain("Parental Bond adds no second strike here: Double Hit already hits more than once.");
    expect(doubleHit.row.description).not.toContain("Parental Bond");
  });

  it("is skipped for charge moves and spread hits", () => {
    const dig = strikes("dig", build("meganium", "overgrow"));
    expect(dig.strikes).toEqual(["18-22"]);
    expect(dig.row.assumptions).toContain("Parental Bond adds no second strike here: Dig is never doubled by Parental Bond.");
    expect(strikes("solarbeam", build("garchomp", "roughskin"), { weather: "Sun" }).strikes).toEqual(["35-42"]);
    const spread = strikes("rockslide", build("snorlax", "thickfat"), { gameType: "Doubles", multipleTargets: true });
    expect(spread.strikes).toEqual(["36-43"]);
    expect(spread.row.assumptions).toContain("Parental Bond adds no second strike here: a spread hit is never doubled.");
    expect(strikes("doubleedge", build("snorlax", "thickfat"), { gameType: "Doubles", multipleTargets: false }).strikes).toEqual(["117-138", "28-34"]);
  });

  it("applies Wonder Room's swap and a terrain Seed once", () => {
    expect(strikes("bodyslam", build("snorlax", "thickfat"), { wonderRoom: true }).strikes).toEqual(["54-64", "13-16"]);
    expect(strikes("firepunch", build("skarmory", "sturdy"), { wonderRoom: true }).strikes).toEqual(["92-110", "22-28"]);
    expect(strikes("crunch", build("snorlax", "thickfat", championsRuntime, "electricseed"), { terrain: "Electric" }).strikes).toEqual(["35-42", "8-10"]);
  });

  it("keeps the between-strike effects Showdown applies", () => {
    expect(strikes("bodyslam", build("skarmory", "weakarmor")).strikes).toEqual(["21-26", "8-9"]);
    expect(strikes("earthquake", build("arboliva", "seedsower")).strikes).toEqual(["25-30", "3-4"]);
    expect(strikes("earthquake", build("arboliva", "seedsower", championsRuntime, "grassyseed")).strikes).toEqual(["25-30", "2-2"]);
    expect(strikes("doubleedge", build("dragonite", "multiscale")).strikes).toEqual(["42-51", "21-25"]);
    const assurance = strikes("assurance", build("snorlax", "thickfat"));
    expect(assurance.strikes).toEqual(["39-47", "19-23"]);
    expect(assurance.row.assumptions).toContain("Parental Bond: the second strike doubles Assurance's power because the first strike hurt the target.");
  });

  it("matches Showdown in Ultra Sun and Ultra Moon", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Fixed damage is dealt in full by both strikes.
    expect(strikes("seismictoss", build("snorlax", "thickfat", usum), {}, usum).strikes).toEqual(["50-50", "50-50"]);
    // Kee and Maranga Berry act only after the whole move.
    expect(strikes("bodyslam", build("snorlax", "thickfat", usum, "keeberry"), {}, usum).strikes).toEqual(["82-97", "19-24"]);
    expect(strikes("surf", build("snorlax", "thickfat", usum, "marangaberry"), {}, usum).strikes).toEqual(["22-26", "5-6"]);
    // Luminous Moss and Power-Up Punch act between the strikes.
    expect(strikes("surf", build("chansey", "naturalcure", usum, "luminousmoss"), {}, usum).strikes).toEqual(["22-27", "3-4"]);
    expect(strikes("poweruppunch", build("snorlax", "thickfat", usum), {}, usum).strikes).toEqual(["54-64", "18-22"]);
    expect(strikes("bodyslam", build("snorlax", "thickfat", usum), { wonderRoom: true }, usum).strikes).toEqual(["54-64", "13-16"]);
  });
});
