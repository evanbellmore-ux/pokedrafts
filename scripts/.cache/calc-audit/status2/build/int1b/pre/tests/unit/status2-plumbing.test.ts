import { beforeAll, describe, expect, it } from "vitest";
import { calculateTurnMove, turnSpeed } from "@/app/lib/battle/calculate";
import { buildTypes } from "@/app/lib/battle/mechanics";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive, getBuildStats, validateBuild, validateConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

/**
 * status2 Step 0b (scripts/.cache/calc-audit/status2/design SPEC2.md §3.6; build/STEP0B.md): the shared calculation plumbing,
 * each field set on a synthetic build or condition as the 2v2 turn's calcBuild sets it, against pinned Showdown c23d2e94.
 * Every expected range is the one scripts/.cache/calc-audit/status2/build/step0b-probes.ts prints for the same scenario on
 * the pinned simulator (design/guards-sim.ts: the target's HP lost to the hit at the lowest and at the highest roll, no
 * critical hit unless certain). Level 50, 31 IVs, Serious, no EVs; doubles; the hit has one target unless it says spread.
 */
type Set = { species: string; ability: string; item?: string };
const GAMES = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" } as const satisfies Record<string, BattleGame>;
type Game = keyof typeof GAMES;
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const runtimes = {} as Record<Game, BattleRuntime>;
beforeAll(async () => {
  for (const game of Object.keys(GAMES) as Game[]) runtimes[game] = await loadBattleRuntime(GAMES[game]);
});

function build(game: Game, set: Set, extra: Partial<BattleBuild> = {}): BattleBuild {
  const runtime = runtimes[game];
  const abilityId = id(set.ability);
  return { ...createBuild(id(set.species), runtime), abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(set.item ?? ""), ...extra } as BattleBuild;
}
const LAX: Set = { species: "Snorlax", ability: "Thick Fat" };
function field(change: (c: BattleConditions) => BattleConditions = (c) => c, spread = false): BattleConditions {
  return change({ ...createConditions(), multipleTargets: spread, attackerSide: createSide(), defenderSide: createSide() });
}
function hit(game: Game, attacker: BattleBuild, defender: BattleBuild, move: string, conditions: BattleConditions, context?: MoveContext) {
  const runtime = runtimes[game];
  const row = calculateTurnMove(runtime.movesById.get(id(move))!, attacker, defender, conditions, context, runtime);
  return { row, range: [row.min, row.max] };
}

describe("status2 Step 0b: the calculation plumbing (SPEC2 §3.6)", () => {
  it("SA13 / CR10: Minimize's and Glaive Rush's final x2 (takenMods), behind Reflect", () => {
    const reflect = field((c) => ({ ...c, defenderSide: { ...c.defenderSide, reflect: true } }));
    expect(hit("sv", build("sv", LAX), build("sv", { species: "Jolteon", ability: "Volt Absorb" }, { takenMods: { minimize: true } }), "Body Slam", reflect).range).toEqual([104, 124]);
    expect(hit("sv", build("sv", LAX), build("sv", LAX, { takenMods: { minimize: true, glaiveRush: true } }), "Body Slam", reflect).range).toEqual([200, 235]);
    // Minimize doubles only the minimize-flag moves; Glaive Rush any move.
    const plain = hit("sv", build("sv", LAX), build("sv", LAX), "Double-Edge", field()).range;
    expect(hit("sv", build("sv", LAX), build("sv", LAX, { takenMods: { minimize: true } }), "Double-Edge", field()).range).toEqual(plain);
  });

  it("TV03 / TV11: an added third type and Tar Shot multiply the effectiveness", () => {
    expect(hit("sv", build("sv", { species: "Lapras", ability: "Water Absorb" }), build("sv", { species: "Swampert", ability: "Torrent" }, { addedType: "Grass" }), "Ice Beam", field()).range).toEqual([98, 116]);
    expect(hit("sv", build("sv", LAX), build("sv", { species: "Scizor", ability: "Technician" }, { tarShot: true }), "Ember", field()).range).toEqual([104, 128]);
  });

  it("TV12 / TV13: Foresight and Miracle Eye (revealed)", () => {
    expect(hit("usum", build("usum", LAX), build("usum", { species: "Gengar", ability: "Levitate" }, { revealed: "foresight" }), "Body Slam", field()).range).toEqual([78, 93]);
    expect(hit("usum", build("usum", { species: "Alakazam", ability: "Inner Focus" }), build("usum", { species: "Umbreon", ability: "Synchronize" }, { revealed: "miracleeye" }), "Psychic", field()).range).toEqual([52, 63]);
    // Without the marker the Ghost and the Dark type are immune.
    expect(hit("usum", build("usum", LAX), build("usum", { species: "Gengar", ability: "Levitate" }), "Body Slam", field()).range).toEqual([0, 0]);
  });

  it("CR07: grounding, pinned (through Levitate and the Flying type) and floating (no effect)", () => {
    const chomp = build("sv", { species: "Garchomp", ability: "Rough Skin" });
    const spread = field((c) => c, true);
    expect(hit("sv", chomp, build("sv", { species: "Skarmory", ability: "Sturdy" }, { grounding: "pinned" }), "Earthquake", spread).range).toEqual([80, 96]);
    expect(hit("sv", chomp, build("sv", { species: "Bronzong", ability: "Levitate" }, { grounding: "pinned" }), "Earthquake", spread).range).toEqual([92, 110]);
    const floating = hit("sv", chomp, build("sv", LAX, { grounding: "floating" }), "Earthquake", spread).row;
    expect([floating.min, floating.max]).toEqual([0, 0]);
    expect(floating.assumptions).toContain("Earthquake has no effect: the target is not grounded.");
  });

  it("TV15: Embargo (itemSuppressed) stops an Air Balloon", () => {
    const chomp = build("usum", { species: "Garchomp", ability: "Rough Skin" });
    expect(hit("usum", chomp, build("usum", { ...LAX, item: "Air Balloon" }, { itemSuppressed: true }), "Earthquake", field((c) => c, true)).range).toEqual([75, 88]);
    expect(hit("usum", chomp, build("usum", { ...LAX, item: "Air Balloon" }), "Earthquake", field((c) => c, true)).range).toEqual([0, 0]);
  });

  it("F75 / F35: Mud Sport after Galvanize; Lucky Chant stops an always-critical move", () => {
    expect(hit("usum", build("usum", { species: "Golem-Alola", ability: "Galvanize" }), build("usum", { species: "Lapras", ability: "Shell Armor" }), "Body Slam", field((c) => ({ ...c, mudSport: true }))).range).toEqual([54, 66]);
    const chant = hit("usum", build("usum", { species: "Lapras", ability: "Water Absorb" }), build("usum", LAX), "Frost Breath", field((c) => ({ ...c, defenderSide: { ...c.defenderSide, luckyChant: true } }))).row;
    expect([chant.min, chant.max]).toEqual([15, 18]);
    expect(chant.assumptions).toContain("Lucky Chant: no critical hit.");
  });

  it("SA06 / SA19c: stored stats (Guard Split under Wonder Room) and weight", () => {
    const runtime = runtimes.swsh;
    const own = getBuildStats(build("swsh", { species: "Shuckle", ability: "Sturdy" }), runtime)!;
    const jolteon = getBuildStats(build("swsh", { species: "Jolteon", ability: "Volt Absorb" }), runtime)!;
    const storedStats = { atk: own.atk, def: Math.floor((own.def + jolteon.def) / 2), spa: own.spa, spd: Math.floor((own.spd + jolteon.spd) / 2), spe: own.spe };
    const shuckle = build("swsh", { species: "Shuckle", ability: "Sturdy" }, { storedStats });
    expect(hit("swsh", build("swsh", { species: "Lapras", ability: "Water Absorb" }), shuckle, "Body Slam", field((c) => ({ ...c, wonderRoom: true }))).range).toEqual([9, 11]);
    // getBuildStats: the stored stats with its own HP.
    expect(getBuildStats(shuckle, runtime)).toEqual({ hp: own.hp, ...storedStats });
    expect(hit("sv", build("sv", LAX), build("sv", { species: "Rhyperior", ability: "Solid Rock" }, { weighthg: 1828 }), "Low Kick", field()).range).toEqual([51, 60]);
  });

  it("SA09 / D: Spit Up's layers and Stored Power's hidden stages", () => {
    const spit = hit("sv", build("sv", LAX, { boosts: { atk: 0, def: 3, spa: 0, spd: 3, spe: 0 } }), build("sv", { species: "Chansey", ability: "Natural Cure" }), "Spit Up", field(), { stockpile: 3 }).row;
    expect([spit.kind, spit.min, spit.max]).toEqual(["calculated", 115, 136]);
    expect(hit("sv", build("sv", LAX), build("sv", { species: "Chansey", ability: "Natural Cure" }), "Spit Up", field()).row.kind).toBe("needs-context");
    expect(hit("sv", build("sv", { species: "Espeon", ability: "Synchronize" }), build("sv", LAX), "Stored Power", field(), { hiddenStages: 2 }).range).toEqual([40, 48]);
  });

  it("K55 / TW02: Electrify and Ion Deluge keep the -ate and Normalize 1.2x", () => {
    const gyarados = build("swsh", { species: "Gyarados", ability: "Moxie" });
    const pixilate = hit("swsh", build("swsh", { species: "Sylveon", ability: "Pixilate" }), gyarados, "Hyper Voice", field((c) => c, true), { retype: "electrify" }).row;
    expect([pixilate.min, pixilate.max, pixilate.effectiveType]).toEqual([136, 160, "Electric"]);
    expect(pixilate.assumptions).toContain("Pixilate: 1.2x power (the move is Electric type).");
    expect(hit("swsh", build("swsh", { species: "Sylveon", ability: "Cute Charm" }), gyarados, "Hyper Voice", field((c) => c, true), { retype: "electrify" }).range).toEqual([112, 132]);
    const usumGyarados = build("usum", { species: "Gyarados", ability: "Moxie" });
    const deluge = field((c) => ({ ...c, ionDeluge: true }));
    expect(hit("usum", build("usum", { species: "Delcatty", ability: "Normalize" }), usumGyarados, "Body Slam", deluge, { retype: "iondeluge" }).range).toEqual([136, 160]);
    // Normalize makes Flamethrower Normal first, so Ion Deluge reaches it (with the boost).
    expect(hit("usum", build("usum", { species: "Delcatty", ability: "Normalize" }), usumGyarados, "Flamethrower", deluge, { retype: "iondeluge" }).range).toEqual([104, 124]);
  });

  it("the Pledges' swamp: Speed x0.25 (turnSpeed)", () => {
    const runtime = runtimes.sv;
    const jolteon = build("sv", { species: "Jolteon", ability: "Volt Absorb" });
    const conditions = field();
    expect(turnSpeed(jolteon, false, conditions, runtime)).toBe(150);
    expect(turnSpeed(jolteon, false, { ...conditions, attackerSide: { ...conditions.attackerSide, swamp: true } }, runtime)).toBe(37);
  });

  it("buildTypes: a Tera type, else the world types and the added type", () => {
    const runtime = runtimes.sv;
    expect(buildTypes(build("sv", { species: "Swampert", ability: "Torrent" }, { addedType: "Grass" }), runtime)).toEqual(["Water", "Ground", "Grass"]);
    expect(buildTypes(build("sv", LAX, { types: ["Water"] }), runtime)).toEqual(["Water"]);
    expect(buildTypes(build("sv", LAX, { mechanic: "tera", configuration: { teraType: "Fire" } }), runtime)).toEqual(["Fire"]);
  });

  it("validateBuild and validateConditions: the 2v2-only fields' issues", () => {
    const runtime = runtimes.sv;
    const messages = (b: BattleBuild) => validateBuild(b, runtime).map((issue) => issue.message);
    expect(messages(build("sv", LAX, { types: ["Water", "Water"] }))).toContain("Types are one or two of this game's types.");
    expect(messages(build("sv", LAX, { types: ["Stellar"] }))).toContain("Types are one or two of this game's types.");
    expect(messages(build("sv", LAX, { types: ["???"] }))).not.toContain("Types are one or two of this game's types.");
    expect(messages(build("sv", LAX, { addedType: "Fire" as never }))).toContain("An added type is Grass or Ghost.");
    expect(messages(build("sv", LAX, { addedType: "Grass", mechanic: "tera", configuration: { teraType: "Fire" } }))).toContain("A Terastallized Pokémon has no added type.");
    expect(messages(build("sv", LAX, { itemSuppressed: true }))).toContain("A suppressed item needs a held item.");
    expect(messages(build("sv", LAX, { weighthg: 0 }))).toContain("Weight is a whole number of hectograms from 1.");
    expect(messages(build("sv", LAX, { storedStats: { atk: 1, def: 0, spa: 1, spd: 1, spe: 1 } }))).toContain("Stored stats are whole numbers from 1.");
    expect(messages(build("sv", LAX, { abilityId: "levitate" })).some((message) => message.startsWith("Select an ability available to this Pokémon"))).toBe(true);
    expect(messages(build("sv", LAX, { abilityId: "levitate", abilityChanged: true }))).toEqual([]);
    // The game's moves decide the side and field keys: Lucky Chant and Ion Deluge are not in Scarlet/Violet.
    const sv = field((c) => ({ ...c, ionDeluge: true, defenderSide: { ...c.defenderSide, luckyChant: true, mist: true } }));
    expect(validateConditions(sv, runtime).map((issue) => issue.message)).toEqual(["Lucky Chant is not in this game.", "Ion Deluge is not in this game."]);
    expect(validateConditions(field((c) => ({ ...c, ionDeluge: true, mudSport: true, defenderSide: { ...c.defenderSide, luckyChant: true } })), runtimes.usum)).toEqual([]);
    // The 1v1 never sets them: its conditions keep today's issues.
    expect(validateConditions(field(), runtime)).toEqual([]);
  });
});
