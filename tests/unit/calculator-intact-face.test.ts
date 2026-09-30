import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, StatTable } from "@/app/lib/battle/types";

/**
 * An intact Ice Face or Disguise meets only a hit that connects (pinned Showdown c23d2e94 iceface and
 * disguise onDamage). Every case is a real Showdown turn with both Pokémon leading (oos/iceface-immune
 * repro.ts, edges.ts, prio.ts): "0" means Showdown logged -immune or -fail and the target kept its form,
 * "face" means it logged the ability's -activate. Level 50, 31 IVs, 0 EVs/Stat Points, Serious, Singles.
 */
const ICE_FACE = "Intact Ice Face takes the first physical hit. Select Eiscue-Noice for damage after the face breaks.";
const DISGUISE = "Intact Disguise absorbs a hit. Select Mimikyu-Busted for damage after the disguise breaks; shield loss is not simulated.";
let ss: BattleRuntime;
let us: BattleRuntime;
let sv: BattleRuntime;
beforeAll(async () => {
  [ss, us, sv] = await Promise.all([loadBattleRuntime("sword_shield"), loadBattleRuntime("ultra_sun_ultra_moon"), loadBattleRuntime("scarlet_violet")]);
});

type Spec = Partial<Pick<BattleBuild, "abilityId" | "itemId" | "mechanic" | "currentHP" | "status">> & { evs?: Partial<StatTable<number>>; tera?: string; dynamax?: boolean };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  const { evs, tera, dynamax, ...rest } = spec;
  const mechanic = tera ? { mechanic: "tera" as const, configuration: { ...base.configuration, teraType: tera as never } }
    : dynamax ? { mechanic: "dynamax" as const, configuration: { ...base.configuration, dynamaxLevel: 10 } } : {};
  if (base.game === "champions") return { ...base, ...rest, ...mechanic } as BattleBuild;
  return { ...base, ...rest, ...mechanic, native: { ...base.native, evs: { ...base.native.evs, ...evs } } } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const zero = (result: ReturnType<typeof row>, description?: string) => {
  expect(result).toMatchObject({ kind: "calculated", min: 0, max: 0, reason: null });
  if (description) expect(result.description).toBe(description);
};
const face = (result: ReturnType<typeof row>, reason: string) => expect(result).toMatchObject({ kind: "needs-context", reason });

describe("an intact Ice Face meets only a physical hit that connects", () => {
  it("lets an immune target keep its face (Air Balloon, Tera types) and grounds it as Showdown does", () => {
    for (const runtime of [sv, ss]) {
      const garchomp = build(runtime, "garchomp", { evs: { atk: 252 } });
      const balloon = build(runtime, "eiscue", { abilityId: "iceface", itemId: "airballoon" });
      zero(row(runtime, "earthquake", garchomp, balloon), "Earthquake: 0–0 HP (0.0–0.0% of maximum HP). Applied: Air Balloon.");
      face(row(runtime, "earthquake", garchomp, balloon, { magicRoom: true }), ICE_FACE);
      face(row(runtime, "earthquake", garchomp, balloon, { gravity: true }), ICE_FACE);
    }
    const snorlax = build(sv, "snorlax", { evs: { atk: 252 } });
    zero(row(sv, "bodyslam", snorlax, build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })));
    face(row(sv, "bodyslam", build(sv, "ursalunabloodmoon", { abilityId: "mindseye" }), build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })), ICE_FACE);
    face(row(sv, "bodyslam", build(sv, "sylveon", { abilityId: "pixilate" }), build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })), ICE_FACE);
    zero(row(sv, "bodyslam", build(sv, "golemalola", { abilityId: "galvanize" }), build(sv, "eiscue", { abilityId: "iceface", tera: "Ground" })));
    const ringTarget = build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost", itemId: "ringtarget" });
    face(row(sv, "bodyslam", snorlax, ringTarget), ICE_FACE);
    zero(row(sv, "bodyslam", snorlax, ringTarget, { magicRoom: true }));
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 } });
    zero(row(sv, "earthquake", garchomp, build(sv, "eiscue", { abilityId: "iceface", tera: "Flying" })));
    face(row(sv, "earthquake", garchomp, build(sv, "eiscue", { abilityId: "iceface", tera: "Flying", itemId: "ironball" })), ICE_FACE);
    zero(row(sv, "dragonclaw", garchomp, build(sv, "eiscue", { abilityId: "iceface", tera: "Fairy" })));
    zero(row(sv, "terablast", build(sv, "garchomp", { evs: { atk: 252 }, tera: "Normal" }), build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })));
    face(row(ss, "thousandarrows", build(ss, "zygarde", { abilityId: "aurabreak" }), build(ss, "eiscue", { abilityId: "iceface", itemId: "airballoon" })), ICE_FACE);
  });

  it("lets a move that fails leave the face intact", () => {
    for (const runtime of [sv, ss]) {
      const eiscue = build(runtime, "eiscue", { abilityId: "iceface" });
      zero(row(runtime, "aquajet", build(runtime, "azumarill", { abilityId: "hugepower" }), eiscue, { terrain: "Psychic" }), "Aqua Jet: 0–0 HP (0.0–0.0% of maximum HP). Applied: Psychic.");
      face(row(runtime, "aquajet", build(runtime, "azumarill", { abilityId: "hugepower" }), { ...eiscue, itemId: "airballoon" }, { terrain: "Psychic" }), ICE_FACE);
      // Gale Wings' +1 is set before the engine run, so Psychic Terrain blocks it; Flame Body's Brave Bird hits.
      zero(row(runtime, "bravebird", build(runtime, "talonflame", { abilityId: "galewings" }), eiscue, { terrain: "Psychic" }));
      face(row(runtime, "bravebird", build(runtime, "talonflame", { abilityId: "flamebody" }), eiscue, { terrain: "Psychic" }), ICE_FACE);
      const dusknoir = build(runtime, "dusknoir");
      zero(row(runtime, "poltergeist", dusknoir, { ...eiscue, itemId: "" }));
      face(row(runtime, "poltergeist", dusknoir, { ...eiscue, itemId: "leftovers" }, { magicRoom: true }), ICE_FACE);
    }
    const dynamaxed = build(ss, "eiscue", { abilityId: "iceface", dynamax: true });
    zero(row(ss, "lowkick", build(ss, "machoke", { abilityId: "guts" }), dynamaxed));
    zero(row(ss, "heavyslam", build(ss, "copperajah", { abilityId: "sheerforce" }), dynamaxed));
    zero(row(ss, "steelroller", build(ss, "melmetal"), build(ss, "eiscue", { abilityId: "iceface" })));
    face(row(ss, "steelroller", build(ss, "melmetal"), build(ss, "eiscue", { abilityId: "iceface" }), { terrain: "Electric" }), ICE_FACE);
    zero(row(ss, "earthquake", build(ss, "garchomp", { dynamax: true }), build(ss, "eiscue", { abilityId: "iceface", itemId: "airballoon" })));
  });

  it("checks fixed damage the same way, and lets Endeavor's 0 into a Dynamaxed target break the face", () => {
    const maushold = build(sv, "maushold", { abilityId: "technician" });
    zero(row(sv, "superfang", maushold, build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })), "Super Fang does not affect the defender's type.");
    face(row(sv, "superfang", maushold, build(sv, "eiscue", { abilityId: "iceface" })), ICE_FACE);
    zero(row(sv, "seismictoss", build(sv, "blissey", { abilityId: "naturalcure" }), build(sv, "eiscue", { abilityId: "iceface", tera: "Ghost" })));
    face(row(sv, "seismictoss", build(sv, "blissey", { abilityId: "naturalcure" }), build(sv, "eiscue", { abilityId: "iceface" })), ICE_FACE);
    const diggersby = build(ss, "diggersby", { abilityId: "hugepower" });
    zero(row(ss, "endeavor", diggersby, build(ss, "eiscue", { abilityId: "iceface", currentHP: 100 })),
      "Endeavor fails because the attacker's HP (160) is not lower than the defender's (100).");
    face(row(ss, "endeavor", { ...diggersby, currentHP: 50 }, build(ss, "eiscue", { abilityId: "iceface" })), ICE_FACE);
    // 150 HP against 300/300 scales back to 150: 0 damage, but Showdown's Damage event still runs for it.
    face(row(ss, "endeavor", { ...diggersby, currentHP: 150 }, build(ss, "eiscue", { abilityId: "iceface", dynamax: true })), ICE_FACE);
  });
});

describe("an intact Disguise meets only a hit that connects", () => {
  it("lets Mimikyu's own immunities keep the disguise in every game", async () => {
    for (const runtime of [championsRuntime, sv, ss, us]) {
      const mimikyu = build(runtime, "mimikyu", { abilityId: "disguise" });
      const garchomp = build(runtime, "garchomp");
      zero(row(runtime, "closecombat", build(runtime, "lucario"), mimikyu));
      zero(row(runtime, "dragonclaw", garchomp, mimikyu));
      zero(row(runtime, "dracometeor", build(runtime, "hydreigon", { abilityId: "levitate" }), mimikyu));
      zero(row(runtime, "earthquake", garchomp, { ...mimikyu, itemId: "airballoon" }));
      face(row(runtime, "earthquake", garchomp, mimikyu), DISGUISE);
      zero(row(runtime, "aquajet", build(runtime, "azumarill", { abilityId: "hugepower" }), mimikyu, { terrain: "Psychic" }));
      zero(row(runtime, "finalgambit", build(runtime, "lucario"), mimikyu));
      face(row(runtime, "nightshade", build(runtime, "gengar", { abilityId: "cursedbody" }), mimikyu), DISGUISE);
      zero(row(runtime, "snore", build(runtime, "snorlax"), mimikyu), "Snore fails because the attacker is not asleep.");
    }
    const mimikyu = build(championsRuntime, "mimikyu", { abilityId: "disguise" });
    zero(row(championsRuntime, "superfang", build(championsRuntime, "maushold", { abilityId: "technician" }), mimikyu), "Super Fang does not affect the defender's type.");
    zero(row(championsRuntime, "endeavor", build(championsRuntime, "slurpuff", { abilityId: "sweetveil", currentHP: 50 }), mimikyu), "Endeavor does not affect the defender's type.");
    zero(row(championsRuntime, "seismictoss", build(championsRuntime, "machamp", { abilityId: "guts" }), mimikyu));
    zero(row(championsRuntime, "poltergeist", build(championsRuntime, "banette"), { ...mimikyu, itemId: "" }));
    face(row(championsRuntime, "poltergeist", build(championsRuntime, "banette"), { ...mimikyu, itemId: "leftovers" }), DISGUISE);
    face(row(championsRuntime, "bodyslam", build(championsRuntime, "kangaskhan", { abilityId: "scrappy" }), mimikyu), DISGUISE);
    zero(row(championsRuntime, "bodyslam", build(championsRuntime, "kangaskhanmega", { abilityId: "parentalbond" }), mimikyu));
    zero(row(championsRuntime, "dragondarts", build(championsRuntime, "dragapult"), mimikyu));
  });

  it("follows Tera types, failing moves, Z-Moves and Max Moves", () => {
    const mimikyu = build(sv, "mimikyu", { abilityId: "disguise" });
    zero(row(sv, "dreameater", build(sv, "gengar", { abilityId: "cursedbody" }), mimikyu), "Dream Eater fails because the defender is not asleep.");
    face(row(sv, "dreameater", build(sv, "gengar", { abilityId: "cursedbody" }), { ...mimikyu, status: "slp" }), DISGUISE);
    const teraNormal = build(sv, "mimikyu", { abilityId: "disguise", tera: "Normal" });
    zero(row(sv, "shadowclaw", build(sv, "gengar", { abilityId: "cursedbody" }), teraNormal));
    face(row(sv, "closecombat", build(sv, "lucario"), teraNormal), DISGUISE);
    zero(row(sv, "snore", build(sv, "dedenne", { abilityId: "cheekpouch" }), teraNormal), "Snore fails because the attacker is not asleep.");
    face(row(sv, "snore", build(sv, "dedenne", { abilityId: "cheekpouch", status: "slp" }), teraNormal), DISGUISE);
    face(row(sv, "superfang", build(sv, "maushold", { abilityId: "technician" }), teraNormal), DISGUISE);
    // Stellar keeps Revelation Dance the user's own Ghost type (the engine would make it Stellar).
    zero(row(sv, "revelationdance", build(sv, "oricoriosensu", { tera: "Stellar" }), teraNormal, {}, { stellarFirstUse: true }));
    zero(row(us, "bodyslam", build(us, "snorlax", { itemId: "normaliumz" }), build(us, "mimikyu", { abilityId: "disguise" }), {}, { useZ: true }));
    zero(row(us, "closecombat", build(us, "lucario"), build(us, "mimikyutotem", { abilityId: "disguise" })));
    face(row(us, "earthquake", build(us, "garchomp"), build(us, "mimikyutotem", { abilityId: "disguise" })), DISGUISE);
    zero(row(ss, "bodyslam", build(ss, "snorlax", { dynamax: true }), build(ss, "mimikyu", { abilityId: "disguise" })));
    const protecting = { ...createConditions().defenderSide, protect: true };
    zero(row(ss, "closecombat", build(ss, "lucario", { dynamax: true }), build(ss, "mimikyu", { abilityId: "disguise" }), { defenderSide: protecting }));
  });
});

describe("a hit the face or disguise takes needs no other context", () => {
  it("does not ask for a hit count or turn order first, but still asks when the hit cannot connect", () => {
    face(row(sv, "rockblast", build(sv, "dugtrio", { abilityId: "arenatrap" }), build(sv, "eiscue", { abilityId: "iceface" })), ICE_FACE);
    const fairy = build(sv, "eiscue", { abilityId: "iceface", tera: "Fairy" });
    expect(row(sv, "scaleshot", build(sv, "garchomp"), fairy)).toMatchObject({ kind: "needs-context", reason: expect.stringContaining("Choose a hit count from 2 to 5") });
    zero(row(sv, "scaleshot", build(sv, "garchomp"), fairy, {}, { hits: 3 }));
    const mimikyu = build(championsRuntime, "mimikyu", { abilityId: "disguise" });
    face(row(championsRuntime, "bulletseed", build(championsRuntime, "meowscarada", { abilityId: "overgrow" }), mimikyu), DISGUISE);
    expect(row(championsRuntime, "scaleshot", build(championsRuntime, "garchomp"), mimikyu)).toMatchObject({ kind: "needs-context", reason: expect.stringContaining("Choose a hit count") });
    // 95 Speed each: a Speed tie, which Bolt Beak would otherwise ask about.
    face(row(ss, "boltbeak", build(ss, "dracozolt", { abilityId: "voltabsorb" }), build(ss, "eiscue", { abilityId: "iceface", evs: { spe: 200 } })), ICE_FACE);
    // Analytic in Doubles asks for the turn order only for a hit that can land and is not taken.
    const doubles = { gameType: "Doubles" as const };
    const magnezone = build(sv, "magnezone", { abilityId: "analytic" });
    face(row(sv, "bodypress", magnezone, build(sv, "eiscue", { abilityId: "iceface" }), doubles), ICE_FACE);
    zero(row(sv, "bodypress", magnezone, build(sv, "mimikyu", { abilityId: "disguise" }), doubles));
    face(row(sv, "flashcannon", magnezone, build(sv, "mimikyu", { abilityId: "disguise" }), doubles), DISGUISE);
    expect(row(sv, "flashcannon", magnezone, build(sv, "snorlax"), doubles).reason).toContain("In Doubles, Analytic boosts only if");
  });
});
