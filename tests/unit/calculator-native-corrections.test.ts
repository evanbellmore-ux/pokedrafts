import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { abilityActivationLabel, createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveContext, StatTable } from "@/app/lib/battle/types";

/**
 * Engine corrections for native games: G-Max Fireball ignoring abilities (the engine misspells it),
 * Normalize leaving Hidden Power's type, Revelation Dance's type under Stellar and as a Z-Move, and
 * Adaptability under Stellar. Level 50, 31 IVs, Serious nature, Singles. Every number matches pinned
 * Showdown c23d2e94 (audit native-games/repro.ts 4, 8, 9 and 10; fix33/sweep.ts, 132 cases).
 */
let ss: BattleRuntime;
let us: BattleRuntime;
let sv: BattleRuntime;
beforeAll(async () => {
  [ss, us, sv] = await Promise.all([loadBattleRuntime("sword_shield"), loadBattleRuntime("ultra_sun_ultra_moon"), loadBattleRuntime("scarlet_violet")]);
});

type Spec = Partial<Pick<BattleBuild, "abilityId" | "abilityActive" | "itemId" | "mechanic" | "currentHP" | "boosts">> & { evs?: Partial<StatTable<number>>; teraType?: string; gigantamax?: boolean; level?: number };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  if (base.game === "champions") throw new Error("native builds only");
  const { evs, teraType, gigantamax, level, ...rest } = spec;
  return {
    ...base, ...rest,
    configuration: { ...base.configuration, ...(teraType ? { teraType: teraType as never } : {}), ...(gigantamax ? { gigantamax } : {}) },
    native: { ...base.native, evs: { ...base.native.evs, ...evs }, ...(level ? { level } : {}) },
  } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, context?: MoveContext, weather = "", terrain = "") {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", weather: weather as never, terrain: terrain as never }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;

describe("native-game engine corrections", () => {
  it("lets G-Max Fireball ignore the target's ability (Sword/Shield)", () => {
    const cinderace = build(ss, "cinderace", { mechanic: "gigantamax", gigantamax: true, evs: { atk: 252 } });
    const intoHeatran = row(ss, "pyroball", cinderace, build(ss, "heatran", { abilityId: "flashfire", evs: { hp: 252 } }));
    expect(intoHeatran).toMatchObject({ effectiveName: "G-Max Fireball", min: 120, max: 142 });
    expect(intoHeatran.assumptions).toContain("G-Max Fireball ignores the target's Flash Fire.");
    expect(range(row(ss, "pyroball", cinderace, build(ss, "dubwool", { abilityId: "fluffy", evs: { hp: 252 } })))).toBe("127-150");
    expect(range(row(ss, "pyroball", cinderace, build(ss, "snorlax", { abilityId: "thickfat", evs: { hp: 252 } })))).toBe("178-211");
    // Damp does nothing to it, so nothing is noted.
    const damp = row(ss, "pyroball", cinderace, build(ss, "frillish", { abilityId: "damp" }));
    expect(range(damp)).toBe("108-127");
    expect(damp.assumptions.join(" ")).not.toContain("ignores the target's");
  });

  it("keeps a Normalize user's Hidden Power its own type, without the boost (Ultra Sun/Ultra Moon)", () => {
    const delcatty = build(us, "delcatty", { abilityId: "normalize" });
    const intoGengar = row(us, "hiddenpower", delcatty, build(us, "gengar"));
    expect(intoGengar).toMatchObject({ effectiveType: "Dark", min: 36, max: 44 });
    expect(range(row(us, "hiddenpower", delcatty, build(us, "golem")))).toBe("21-25");
  });

  it("types Revelation Dance by the user's own type under Stellar, and a Z-Revelation Dance as Normal", () => {
    const pomPom = build(sv, "oricoriopompom", { mechanic: "tera", teraType: "Stellar", evs: { spa: 252 } });
    expect(row(sv, "revelationdance", pomPom, build(sv, "garchomp"), { stellarFirstUse: true })).toMatchObject({ effectiveType: "Electric", min: 0, max: 0 });
    const first = row(sv, "revelationdance", pomPom, build(sv, "snorlax"), { stellarFirstUse: true });
    expect(range(first)).toBe("78-94");
    expect(first.description).not.toContain("Adaptability");
    expect(range(row(sv, "revelationdance", pomPom, build(sv, "snorlax"), { stellarFirstUse: false }))).toBe("58-70");
    // The target's Neutralizing Gas does not touch Stellar's boost.
    expect(range(row(sv, "revelationdance", pomPom, build(sv, "weezinggalar", { abilityId: "neutralizinggas" }), { stellarFirstUse: true }))).toBe("114-136");
    const baile = build(us, "oricorio", { itemId: "normaliumz", evs: { spa: 252 } });
    expect(row(us, "revelationdance", baile, build(us, "heatran"), { useZ: true })).toMatchObject({ effectiveName: "Breakneck Blitz", effectiveType: "Normal", min: 39, max: 46 });
    expect(range(row(us, "revelationdance", build(us, "oricoriopompom", { itemId: "normaliumz", evs: { spa: 252 } }), build(us, "sawsbuck"), { useZ: true }))).toBe("110-130");
  });

  it("drops Adaptability while Stellar-Terastallized (Scarlet/Violet)", () => {
    const porygonZ = build(sv, "porygonz", { abilityId: "adaptability", mechanic: "tera", teraType: "Stellar", evs: { spa: 252 } });
    expect(range(row(sv, "hyperbeam", porygonZ, build(sv, "amoonguss"), { stellarFirstUse: true }))).toBe("212-250");
    expect(range(row(sv, "hyperbeam", porygonZ, build(sv, "amoonguss"), { stellarFirstUse: false }))).toBe("159-187");
    expect(range(row(sv, "wavecrash", build(sv, "basculegion", { abilityId: "adaptability", mechanic: "tera", teraType: "Stellar", evs: { atk: 252 } }), build(sv, "amoonguss"), { stellarFirstUse: false }))).toBe("62-73");
  });
});

const natured = (value: BattleBuild, nature: string) => ({ ...value, nature }) as BattleBuild;

describe("native forms and restricted moves", () => {
  it("takes Minior's and Wishiwashi's form from HP, as Shields Down and Schooling do on entry", () => {
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 } });
    const meteor = row(sv, "ironhead", garchomp, build(sv, "minior", { abilityId: "shieldsdown" }));
    expect(range(meteor)).toBe("92-110");
    expect(meteor.assumptions.join(" ")).toContain("Shields Down: the target Minior is Minior-Meteor above half its HP.");
    // 50 of 135 HP is under half: the selected core colour.
    expect(range(row(sv, "ironhead", garchomp, build(sv, "miniorblue", { abilityId: "shieldsdown", currentHP: 50 })))).toBe("138-164");
    const eq = (spec: Spec) => range(row(ss, "earthquake", build(ss, "garchomp", { evs: { atk: 252 } }), build(ss, "wishiwashi", { abilityId: "schooling", ...spec })));
    expect(eq({})).toBe("69-82");
    expect(eq({ currentHP: 30 })).toBe("256-303");
    expect(eq({ level: 15 })).toBe("681-802");
  });

  it("keeps the form until the end of the turn when the HP crossed the line this turn", () => {
    // Real Doubles battle: Seismic Toss takes Minior-Meteor to 60/135, then Iron Head still hits the
    // Meteor Form; it becomes a core only after the turn (fix34/review/t-meteor-midturn.ts).
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 } });
    const kept = row(sv, "ironhead", garchomp, build(sv, "miniormeteor", { abilityId: "shieldsdown", currentHP: 60, abilityActive: true }));
    expect(range(kept)).toBe("92-110");
    expect(kept.assumptions).toContain("Shields Down: the target Minior-Meteor stays Minior-Meteor until the end of the turn (Minior at half its HP or less).");
    expect(range(row(sv, "ironhead", garchomp, build(sv, "miniormeteor", { abilityId: "shieldsdown", currentHP: 60 })))).toBe("138-164");
    expect(abilityActivationLabel("shieldsdown", "scarlet_violet")).toBe("Its HP crossed half this turn");
    expect(abilityActivationLabel("schooling", "sword_shield", { level: 50 })).toBe("Its HP crossed a quarter this turn");
    // Below level 20 Wishiwashi never schools, whatever the switch says, so it is not offered.
    expect(abilityActivationLabel("schooling", "sword_shield", { level: 15 })).toBeUndefined();
    expect(range(row(ss, "earthquake", build(ss, "garchomp", { evs: { atk: 252 } }), build(ss, "wishiwashischool", { abilityId: "schooling", level: 15, abilityActive: true })))).toBe("681-802");
  });

  it("lets an intact Ice Face take the first physical hit, and keeps a face that broke in snow broken", () => {
    const garchomp = build(sv, "garchomp", { evs: { atk: 252, spa: 252 } });
    expect(row(sv, "earthquake", garchomp, build(sv, "eiscue", { abilityId: "iceface" })).kind).toBe("needs-context");
    expect(range(row(sv, "earthpower", garchomp, build(sv, "eiscue", { abilityId: "iceface" })))).toBe("61-73");
    const noice = build(sv, "eiscuenoice", { abilityId: "iceface" });
    expect(range(row(sv, "earthquake", garchomp, noice))).toBe("114-135");
    // Real two-turn battles: the face broke with snow or hail up and stays broken (fix34/review/t-noice-snow*.ts).
    const snowy = row(sv, "earthquake", garchomp, noice, undefined, "Snow");
    expect(range(snowy)).toBe("76-91");
    expect(snowy.assumptions).toContain("Ice Face: assumes the target Eiscue-Noice's face broke while the snow was up.");
    expect(range(row(sv, "earthpower", garchomp, noice, undefined, "Snow"))).toBe("96-114");
    expect(range(row(ss, "earthquake", build(ss, "garchomp", { evs: { atk: 252 } }), build(ss, "eiscuenoice", { abilityId: "iceface" }), undefined, "Hail"))).toBe("114-135");
    expect(range(row(sv, "earthquake", build(sv, "excadrill", { abilityId: "moldbreaker", evs: { atk: 252 } }), build(sv, "eiscue", { abilityId: "iceface" })))).toBe("82-97");
  });

  it("checks Ice Face with the category the engine gives Shell Side Arm, Tera Blast and Tera Starstorm", () => {
    // Real battles (fix34/review/t-iceface.ts, t-iceface2.ts).
    const eiscue = build(sv, "eiscue", { abilityId: "iceface" });
    const physical = (runtime: BattleRuntime, moveId: string, attacker: BattleBuild) => row(runtime, moveId, attacker, build(runtime, "eiscue", { abilityId: "iceface" })).kind;
    expect(physical(sv, "shellsidearm", natured(build(sv, "slowbrogalar", { evs: { atk: 252 } }), "Adamant"))).toBe("needs-context");
    expect(physical(ss, "shellsidearm", natured(build(ss, "slowbrogalar", { evs: { atk: 252 } }), "Adamant"))).toBe("needs-context");
    const teraBlast = build(sv, "garchomp", { evs: { atk: 252 }, mechanic: "tera", teraType: "Normal" });
    expect(row(sv, "terablast", teraBlast, eiscue).kind).toBe("needs-context");
    expect(range(row(sv, "terablast", teraBlast, build(sv, "eiscuenoice", { abilityId: "iceface" })))).toBe("93-109");
    expect(physical(sv, "terastarstorm", natured(build(sv, "terapagos", { evs: { atk: 252 }, mechanic: "tera", teraType: "Stellar" }), "Adamant"))).toBe("needs-context");
    expect(range(row(sv, "terastarstorm", natured(build(sv, "terapagos", { evs: { spa: 252 }, mechanic: "tera", teraType: "Stellar" }), "Modest"), eiscue))).toBe("100-118");
  });

  it("fails Double Shock and Burn Up for a user without the Electric or Fire type", () => {
    // Real lead battles (oos/iceface-immune/dshock.ts, burnup.ts): Showdown's onTryMove reads the Tera type.
    const snorlax = build(sv, "snorlax");
    const pawmot = (teraType?: string) => build(sv, "pawmot", { abilityId: "ironfist", ...(teraType ? { mechanic: "tera", teraType } : {}) });
    expect(row(sv, "doubleshock", pawmot("Fighting"), snorlax)).toMatchObject({ min: 0, max: 0, description: "Double Shock fails because the attacker is not Electric type." });
    expect(range(row(sv, "doubleshock", pawmot("Electric"), snorlax))).toBe("144-170");
    expect(range(row(sv, "doubleshock", pawmot(), snorlax))).toBe("108-127");
    expect(row(sv, "doubleshock", build(sv, "smeargle"), snorlax)).toMatchObject({ min: 0, max: 0 });
    expect(row(us, "burnup", build(us, "smeargle"), build(us, "snorlax"))).toMatchObject({ min: 0, max: 0, description: "Burn Up fails because the attacker is not Fire type." });
    // It fails in onTryMove, before a Stellar first-use question or the target's Protect (oos/review/gate-refute/g.ts).
    expect(row(sv, "doubleshock", build(sv, "smeargle", { mechanic: "tera", teraType: "Stellar" }), snorlax)).toMatchObject({ kind: "calculated", min: 0, max: 0, description: "Double Shock fails because the attacker is not Electric type." });
    const protecting = calculateMatchup(pawmot("Fighting"), snorlax, { ...createConditions(), gameType: "Singles", defenderSide: { ...createConditions().defenderSide, protect: true } }, {}, sv)
      .results.find((result) => result.moveId === "doubleshock")!;
    expect(protecting.description).toBe("Double Shock fails because the attacker is not Electric type.");
  });

  it("hits 3 times with Greninja-Ash's Water Shuriken, as Battle Bond makes it (Ultra Sun/Ultra Moon)", () => {
    // Real battle (oos/greninja/ash.ts): 18-22 per hit at 20 power; Greninja-Bond still chooses 2-5.
    const ash = row(us, "watershuriken", build(us, "greninjaash", { abilityId: "battlebond", evs: { spa: 252 } }), build(us, "snorlax"));
    expect(ash).toMatchObject({ kind: "calculated", hits: 3, min: 54, max: 66, effectivePower: 20 });
    const bond = calculateMatchup(build(us, "greninjabond", { abilityId: "battlebond", evs: { spa: 252 } }), build(us, "snorlax"), { ...createConditions(), gameType: "Singles" }, {}, us)
      .results.find((result) => result.moveId === "watershuriken")!;
    // Greninja-Bond keeps the random 2-5 hits (pinned Showdown hitStepMoveHitLoop), shown as their range.
    expect(bond).toMatchObject({ kind: "calculated", hits: 5, effectivePower: 15 });
    expect(bond.hitChances?.map(({ hits }) => hits)).toEqual([2, 3, 4, 5]);
  });

  it("fails Hyperspace Fury and Aura Wheel for any other user", () => {
    const fury = row(sv, "hyperspacefury", build(sv, "hoopa"), build(sv, "snorlax"));
    expect(fury).toMatchObject({ min: 0, max: 0, description: "Hyperspace Fury fails: only Hoopa-Unbound can use it." });
    expect(range(row(sv, "hyperspacefury", build(sv, "hoopaunbound"), build(sv, "snorlax")))).toBe("120-142");
    expect(range(row(sv, "aurawheel", build(sv, "smeargle"), build(sv, "amoonguss")))).toBe("0-0");
    expect(range(row(sv, "aurawheel", build(sv, "morpeko"), build(sv, "amoonguss")))).toBe("39-47");
  });

  it("offers USUM forms only the moves pinned Showdown's validator lets them know", () => {
    const moves = (id: string) => us.speciesById.get(id)!.moves;
    expect(moves("pikachuoriginal")).not.toContain("fakeout");
    expect(moves("pikachu")).toContain("fakeout");
    expect(moves("greninjaash")).not.toContain("counter");
    expect(moves("necrozmaultra")).toContain("sunsteelstrike");
    // Event-only Zygarde-10% (gen 7 events) cannot know Zygarde's gen-6-only TMs; Zygarde (50%) can.
    expect(moves("zygarde10")).not.toContain("strength");
    expect(moves("zygarde")).toContain("strength");
  });
});

describe("moves the engine calculates as Showdown does", () => {
  it("calculates HP-, boost- and berry-based power", () => {
    const regigigas = build(ss, "regigigas", { evs: { atk: 252 } });
    expect(range(row(ss, "crushgrip", regigigas, build(ss, "snorlax")))).toBe("84-100");
    expect(range(row(ss, "crushgrip", regigigas, build(ss, "snorlax", { currentHP: 117 })))).toBe("42-51");
    expect(range(row(us, "wringout", build(us, "tentacruel", { evs: { spa: 252 } }), build(us, "snorlax")))).toBe("46-55");
    const boosted = build(us, "snorlax");
    expect(range(row(us, "punishment", build(us, "absol", { evs: { atk: 252 } }), { ...boosted, boosts: { ...boosted.boosts, atk: 2, spe: 1 } } as BattleBuild))).toBe("145-172");
    expect(row(us, "naturalgift", build(us, "snorlax", { itemId: "sitrusberry" }), build(us, "garchomp"))).toMatchObject({ effectiveType: "Psychic", effectivePower: 80, min: 34, max: 41 });
    expect(range(row(us, "naturalgift", build(us, "snorlax", { itemId: "" }), build(us, "garchomp")))).toBe("0-0");
  });

  it("converts type-changing moves to their own type's Max Move or Z-Move", () => {
    const snorlax = build(ss, "snorlax");
    expect(row(ss, "weatherball", build(ss, "charizard", { mechanic: "dynamax", evs: { spa: 252 } }), snorlax, undefined, "Rain")).toMatchObject({ effectiveName: "Max Geyser", effectiveType: "Water", min: 91, max: 108 });
    expect(row(ss, "terrainpulse", build(ss, "indeedee", { mechanic: "dynamax", evs: { spa: 252 } }), snorlax, undefined, "", "Electric")).toMatchObject({ effectiveName: "Max Lightning", min: 77, max: 91 });
    expect(row(ss, "multiattack", build(ss, "silvallyfire", { itemId: "firememory", mechanic: "dynamax", evs: { atk: 252 } }), snorlax)).toMatchObject({ effectiveName: "Max Flare", min: 93, max: 111 });
    expect(row(ss, "aurawheel", build(ss, "morpeko", { mechanic: "dynamax", evs: { atk: 252 } }), snorlax)).toMatchObject({ effectiveName: "Max Lightning", min: 136, max: 162 });
    expect(row(ss, "hypervoice", build(ss, "primarina", { abilityId: "liquidvoice", mechanic: "dynamax", evs: { spa: 252 } }), snorlax)).toMatchObject({ effectiveName: "Max Strike", min: 68, max: 80 });
    // Gigantamax: the converted type picks the G-Max move only when it is the signature's (real battles,
    // fix35/review/realmax.ts); G-Max Hydrosnipe has a fixed 160 power and ignores the target's ability.
    const gmax = (id: string) => build(ss, id, { mechanic: "gigantamax", gigantamax: true, evs: { spa: 252 } });
    const hydrosnipe = row(ss, "weatherball", gmax("inteleon"), snorlax, undefined, "Rain");
    expect(hydrosnipe).toMatchObject({ effectiveName: "G-Max Hydrosnipe", effectiveType: "Water", effectivePower: 160, min: 184, max: 217 });
    expect(hydrosnipe.assumptions).toContain("Weather Ball is Water type, so it becomes G-Max Hydrosnipe.");
    expect(range(row(ss, "weatherball", gmax("inteleon"), build(ss, "lapras", { abilityId: "waterabsorb" }), undefined, "Rain"))).toBe("105-123");
    expect(row(ss, "weatherball", gmax("blastoise"), snorlax, undefined, "Rain")).toMatchObject({ effectiveName: "G-Max Cannonade", min: 118, max: 139 });
    expect(row(ss, "weatherball", gmax("eevee"), snorlax, undefined, "Rain")).toMatchObject({ effectiveName: "Max Geyser", min: 56, max: 66 });
    expect(row(ss, "terrainpulse", gmax("snorlax"), snorlax, undefined, "", "Electric")).toMatchObject({ effectiveName: "Max Lightning", min: 57, max: 68 });
    const zBall = row(us, "weatherball", build(us, "castform", { itemId: "normaliumz", evs: { spa: 252 } }), build(us, "snorlax"), { useZ: true }, "Sun");
    expect(zBall).toMatchObject({ effectiveName: "Inferno Overdrive", effectiveType: "Fire", min: 129, max: 153 });
    expect(zBall.assumptions).toContain("Weather Ball is Fire type, so it becomes Inferno Overdrive.");
  });
});

describe("the Protosynthesis and Quark Drive defense boost", () => {
  // Pinned Showdown boosts a defending Paradox Pokémon's Defense or Sp. Def by 5325/4096; the engine's
  // 5324 left some stats a point low (audit fix32/review/v-qp-def5325.ts).
  it("matches Showdown for Booster Energy, terrain and sun", () => {
    const gholdengo = natured(build(sv, "gholdengo", { abilityId: "goodasgold", evs: { spa: 252 } }), "Modest");
    expect(range(row(sv, "makeitrain", gholdengo, build(sv, "screamtail", { abilityId: "protosynthesis", itemId: "boosterenergy" })))).toBe("156-186");
    expect(range(row(sv, "makeitrain", gholdengo, build(sv, "screamtail", { abilityId: "protosynthesis", itemId: "" })))).toBe("204-242");
    const garchomp = natured(build(sv, "garchomp", { evs: { atk: 252 } }), "Adamant");
    expect(range(row(sv, "earthquake", garchomp, build(sv, "irontreads", { abilityId: "quarkdrive", evs: { def: 196 } }), undefined, "", "Electric"))).toBe("104-126");
    const flutterMane = natured(build(sv, "fluttermane", { abilityId: "protosynthesis", evs: { spa: 252 } }), "Timid");
    expect(range(row(sv, "moonblast", flutterMane, build(sv, "screamtail", { abilityId: "protosynthesis", itemId: "" }), undefined, "Sun"))).toBe("75-88");
  });
});
