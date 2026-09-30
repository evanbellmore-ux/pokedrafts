import { describe, expect, it } from "vitest";
import { applyTeamPaste, changeTeamSource, createMatchup, getMoveOwner, getTeamPanel, getTeamSourceOwner, selectRosterPokemon, toggleMatchupMega, updateMatchupBuild, type PreparedMatchup, type RosterRole } from "@/app/(app)/calculator/roster-prep";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Ability and item states the battle has already settled, against pinned Showdown c23d2e94 (real
 * battles where entry effects fire): Unburden and used-up items, status berries, Castform's
 * Forecast, fixed genders for Rivalry, Trace and Imposter. Champions, level 50, 0 Stat Points,
 * Serious nature, Singles, no crit. fix27/imposter.ts and the audit scripts (items/unburden.ts,
 * items/status-berry.ts, species-stats/castform.ts, species-stats/gender.ts) check them.
 */
function build(id: string, abilityId: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id), abilityId, ...extra } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, championsRuntime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: ReturnType<typeof row>) => `${result.min}-${result.max}`;

describe("Unburden and used-up items", () => {
  it("cannot be active while its item is held", () => {
    expect(validateBuild(build("hawlucha", "unburden", { itemId: "sitrusberry", abilityActive: true }))).toContainEqual(expect.objectContaining({ field: "abilityActive" }));
    expect(validateBuild(build("hawlucha", "unburden", { itemId: "", abilityActive: true }))).toEqual([]);
  });

  it("activates when a terrain Seed is used up", () => {
    const hawlucha = build("hawlucha", "unburden", { itemId: "psychicseed", abilityActive: false });
    const gyro = row("gyroball", build("avalugg", "owntempo"), hawlucha, { terrain: "Psychic" });
    expect(range(gyro)).toBe("79-93");
    expect(gyro.assumptions).toContain("The target Hawlucha's Unburden activates once its Psychic Seed is used up, doubling its Speed.");
  });

  it("cures a status at once with a matching berry", () => {
    const burned = build("garchomp", "roughskin", { status: "brn", itemId: "rawstberry" });
    const snorlax = build("snorlax", "thickfat");
    const cured = row("dragonclaw", burned, snorlax);
    expect(cured.rolls).toEqual(row("dragonclaw", build("garchomp", "roughskin"), snorlax).rolls);
    expect(cured.assumptions).toContain("The attacker Garchomp's Rawst Berry cures its burn at once and is used up.");
    // Magic Room keeps the berry from working, so the burn stays.
    expect(row("dragonclaw", burned, snorlax, { magicRoom: true }).rolls).toEqual(row("dragonclaw", build("garchomp", "roughskin", { status: "brn" }), snorlax, { magicRoom: true }).rolls);
  });
});

describe("Castform's Forecast", () => {
  it("takes its form from the weather, whatever form is selected", () => {
    expect(range(row("weatherball", build("castformsunny", "forecast"), build("garchomp", "roughskin")))).toBe("25-30");
    const rainy = row("thunderbolt", build("jolteon", "voltabsorb"), build("castformrainy", "forecast"));
    expect(range(rainy)).toBe("75-88");
    expect(rainy.assumptions).toContain("Forecast: without sun, rain or snow, so the target Castform-Rainy is Castform (Normal type).");
    expect(range(row("closecombat", build("lucario", "innerfocus"), build("castformsnowy", "forecast"), { weather: "Sun" }))).toBe("99-117");
    expect(range(row("weatherball", build("castform", "forecast"), build("garchomp", "roughskin"), { weather: "Sun" }))).toBe("36-43");
  });
});

describe("fixed genders", () => {
  it("supply Rivalry's context and reject impossible genders", () => {
    const luxray = build("luxray", "rivalry", { configuration: { gender: "M" } });
    expect(range(row("wildcharge", luxray, build("gallade", "sharpness")))).toBe("105-124");
    expect(range(row("wildcharge", luxray, build("metagross", "clearbody")))).toBe("48-57");
    expect(validateBuild(build("gallade", "sharpness", { configuration: { gender: "F" } }))).toContainEqual({ field: "configuration.gender", message: "Gallade has fixed gender M." });
    // Showdown's validator never lets a male-or-female species be genderless.
    expect(validateBuild(build("luxray", "rivalry", { configuration: { gender: "N" } }))).toContainEqual({ field: "configuration.gender", message: "Luxray is always male or female, never genderless." });
    expect(validateBuild(build("metagross", "clearbody", { configuration: { gender: "N" } }))).toEqual([]);
  });
});

describe("Trace and Imposter", () => {
  it("Trace copies the other Pokémon's ability, or the chosen one", () => {
    const alakazam = build("alakazammega", "trace");
    const psychic = row("psychic", alakazam, build("lucariomega", "adaptability"));
    expect(range(psychic)).toBe("146-174");
    expect(psychic.assumptions).toContain("Trace: the attacker Alakazam-Mega copied Adaptability from Lucario-Mega.");
    const chosen = row("psychic", { ...alakazam, tracedAbility: "levitate" } as BattleBuild, build("lucariomega", "adaptability"));
    expect(range(chosen)).toBe("109-130");
    expect(chosen.assumptions).toContain("Trace: the attacker Alakazam-Mega copied Levitate (chosen in Build settings).");
    expect(validateBuild({ ...alakazam, tracedAbility: "imposter" } as BattleBuild)).toContainEqual(expect.objectContaining({ field: "tracedAbility" }));
  });

  it("Imposter transforms Ditto into the other Pokémon, keeping its own HP", () => {
    const ditto = build("ditto", "imposter");
    expect(ditto.abilityActive).toBe(true);
    const garchomp = build("garchomp", "roughskin");
    const hit = row("dragonclaw", garchomp, ditto);
    expect(range(hit)).toBe("116-140");
    expect(hit.assumptions.join(" ")).toContain("Imposter: the target Ditto transformed into Garchomp");
    // Ditto attacks with Garchomp's moves and stats.
    const out = calculateMatchup(ditto, garchomp, { ...createConditions(), gameType: "Singles" }, {}, championsRuntime);
    expect(range(out.results.find((result) => result.moveId === "earthquake")!)).toBe("75-88");
    // Untransformed, it stays a Normal-type Ditto.
    expect(range(row("dragonclaw", garchomp, { ...ditto, abilityActive: false }))).toBe("100-118");
  });
});

/** A native-game build at level 50 (the default), 0 EVs, 31 IVs, Serious nature. */
function nativeBuild(runtime: BattleRuntime, id: string, abilityId: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}
function nativeRow(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

describe("copied abilities and transformed Pokémon", () => {
  it("applies an Intimidate copied by Imposter or Trace", () => {
    const incineroar = build("incineroar", "intimidate");
    const intoDitto = row("flareblitz", incineroar, build("ditto", "imposter"));
    expect(range(intoDitto)).toBe("28-33");
    expect(intoDitto.assumptions).toContain("The target Ditto's Intimidate (copied by Imposter) acts when it enters, and this calculation applies it, so do not change the stages for it by hand.");
    expect(intoDitto.assumptions).toContain("The attacker Incineroar's Attack falls to -1.");
    expect(range(row("flareblitz", incineroar, build("gardevoir", "trace")))).toBe("72-85");
    // Ditto copied Incineroar's stages before its own Intimidate lowered Incineroar's Attack.
    expect(range(row("flareblitz", build("ditto", "imposter"), incineroar))).toBe("42-49");
  });

  it("adds the Imposter user's own stages as changes after it transformed", async () => {
    // A Choice Scarf Ditto transformed first, then Incineroar's Intimidate lowered it (Clear Amulet
    // kept Incineroar's own Attack).
    const sv = await loadBattleRuntime("scarlet_violet");
    const scarfDitto = nativeBuild(sv, "ditto", "imposter", { itemId: "choicescarf", boosts: { ...createBuild().boosts, atk: -1 } });
    expect(range(nativeRow(sv, "flareblitz", scarfDitto, nativeBuild(sv, "incineroar", "intimidate", { itemId: "clearamulet" })))).toBe("28-33");
  });

  it("switches off a copied Disguise on a transformed Pokémon", () => {
    const hit = row("playrough", build("mimikyu", "disguise", { itemId: "" }), build("ditto", "imposter"));
    expect(hit).toMatchObject({ kind: "calculated", min: 57, max: 67 });
    expect(hit.assumptions.join(" ")).toContain("Disguise (which does nothing on a transformed Pokémon)");
  });

  it("settles items from the copied ability, including a transformed Pokémon's berry", () => {
    const burnedDitto = build("ditto", "imposter", { status: "brn", itemId: "lumberry" });
    const hex = row("hex", build("gengar", "cursedbody"), burnedDitto);
    expect(range(hex)).toBe("116-140");
    expect(hex.assumptions).toContain("The target Ditto's Lum Berry cures its burn at once and is used up.");
    // A traced Unnerve keeps the target's Lum Berry from curing its burn; a traced Klutz stops its own.
    expect(range(row("knockoff", build("gardevoir", "trace"), build("tyranitar", "unnerve", { status: "brn", itemId: "lumberry" })))).toBe("12-14");
    expect(range(row("knockoff", build("gardevoir", "trace", { status: "brn", itemId: "lumberry" }), build("golurk", "klutz")))).toBe("22-26");
  });

  it("follows Ability Shield, As One and Neutralizing Gas in Scarlet/Violet", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const shielded = nativeRow(sv, "psychic", nativeBuild(sv, "gardevoir", "trace", { itemId: "abilityshield" }), nativeBuild(sv, "porygonz", "adaptability"));
    expect(range(shielded)).toBe("78-93");
    expect(shielded.assumptions).toContain("Trace: the attacker Gardevoir copies nothing (its Ability Shield blocks Trace).");
    const weezing = nativeBuild(sv, "weezinggalar", "neutralizinggas", { status: "brn", itemId: "lumberry" });
    // Neutralizing Gas cannot suppress As One, or Unnerve behind an Ability Shield: the berry stays.
    expect(range(nativeRow(sv, "hex", nativeBuild(sv, "calyrexshadow", "asonespectrier"), weezing))).toBe("151-178");
    expect(range(nativeRow(sv, "hex", nativeBuild(sv, "mewtwo", "unnerve", { itemId: "abilityshield" }), weezing))).toBe("95-112");
    expect(range(nativeRow(sv, "hex", nativeBuild(sv, "mewtwo", "unnerve"), weezing))).toBe("48-57");
    // Suppressed Unburden and Contrary: no notes that they act.
    const gas = nativeBuild(sv, "weezinggalar", "neutralizinggas");
    const gyro = nativeRow(sv, "gyroball", gas, nativeBuild(sv, "hawlucha", "unburden", { itemId: "grassyseed", abilityActive: false }), { terrain: "Grassy" });
    expect(range(gyro)).toBe("13-16");
    expect(gyro.assumptions.join(" ")).not.toContain("Unburden");
    const slam = nativeRow(sv, "bodyslam", gas, nativeBuild(sv, "serperior", "contrary", { itemId: "grassyseed" }), { terrain: "Grassy" });
    expect(range(slam)).toBe("21-25");
    expect(slam.assumptions).toContain("The target Serperior's Grassy Seed is used up on Grassy Terrain, raising its Defense.");
  });

  it("copies the target's entry boosts and gives the copied ability its own", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const intoZacian = nativeRow(swsh, "playrough", nativeBuild(swsh, "ditto", "imposter"), nativeBuild(swsh, "zacian", "intrepidsword"));
    expect(range(intoZacian)).toBe("114-135");
    expect(intoZacian.assumptions.join(" ")).toContain("stat stages (with its Intrepid Sword +1 Attack)");
    expect(range(nativeRow(swsh, "closecombat", nativeBuild(swsh, "zamazenta", "dauntlessshield"), nativeBuild(swsh, "ditto", "imposter")))).toBe("39-46");
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(range(nativeRow(sv, "playrough", nativeBuild(sv, "ditto", "imposter"), nativeBuild(sv, "zacian", "intrepidsword", { abilityActive: true })))).toBe("106-126");
    // Porygon-Z's Download read the untransformed Ditto (Sp. Atk); Ditto's copied one reads Porygon-Z (Attack).
    const download = nativeRow(sv, "triattack", nativeBuild(sv, "ditto", "imposter", { itemId: "choicescarf" }), nativeBuild(sv, "porygonz", "download"));
    expect(range(download)).toBe("109-130");
    expect(download.assumptions).toContain("The target Porygon-Z's Download read Ditto's Defense and Sp. Def before it transformed, raising its Sp. Atk.");
  });
});

describe("what a transformed Pokémon keeps and loses", () => {
  it("keeps Ditto's own gender, even Genderless, after it transforms", () => {
    const ditto = build("ditto", "imposter", { configuration: { gender: "N" } });
    expect(range(row("flareblitz", build("incineroar", "intimidate"), ditto))).toBe("28-33");
    expect(range(row("flareblitz", ditto, build("incineroar", "intimidate")))).toBe("42-49");
  });

  it("switches off the form abilities Showdown denies a transformed Pokémon", async () => {
    // Stance Change: Ditto stays in Aegislash's Shield Forme for its attacks.
    const ironHead = row("ironhead", build("ditto", "imposter"), build("aegislash", "stancechange"));
    expect(range(ironHead)).toBe("10-12");
    expect(ironHead.assumptions.join(" ")).toContain("Stance Change (which does nothing on a transformed Pokémon)");
    expect(ironHead.assumptions.join(" ")).not.toContain("Blade Forme");
    expect(range(row("shadowball", build("ditto", "imposter"), build("aegislash", "stancechange")))).toBe("42-50");
    // Flower Gift gives a transformed Cherrim no boost in the sun (Sword/Shield).
    const swsh = await loadBattleRuntime("sword_shield");
    const b = (id: string, abilityId: string) => ({ ...createBuild(id, swsh), abilityId } as BattleBuild);
    const facade = calculateMatchup(b("ditto", "imposter"), b("cherrim", "flowergift"), { ...createConditions(), gameType: "Singles", weather: "Sun" }, {}, swsh);
    expect(range(facade.results.find((result) => result.moveId === "facade")!)).toBe("24-29");
    const energyBall = calculateMatchup(b("cherrim", "flowergift"), b("ditto", "imposter"), { ...createConditions(), gameType: "Singles", weather: "Sun" }, {}, swsh);
    expect(range(energyBall.results.find((result) => result.moveId === "energyball")!)).toBe("28-33");
  });

  it("copies the target before its Seed is used when both enter together", () => {
    const garchomp = build("garchomp", "roughskin", { itemId: "electricseed" });
    const slam = row("bodyslam", garchomp, build("ditto", "imposter"), { terrain: "Electric" });
    expect(range(slam)).toBe("42-50");
    expect(slam.assumptions.join(" ")).toContain("Seeds, Forecast, Flower Gift, Shields Down and Schooling come after");
  });

  it("copies Minior and Wishiwashi before Shields Down or Schooling changes their form", async () => {
    // Real battles: Imposter copies the core Minior and the Solo Wishiwashi (fix32/review/v-imp-hpforms.ts).
    const native = async (game: "ultra_sun_ultra_moon" | "sword_shield") => {
      const runtime = await loadBattleRuntime(game);
      const make = (id: string, abilityId: string) => {
        const base = createBuild(id, runtime);
        return { ...base, abilityId, abilityActive: abilityId === "imposter", itemId: "", native: base.game === "champions" ? undefined : { ...base.native, level: 50 } } as BattleBuild;
      };
      const calc = (moveId: string, attacker: BattleBuild, defender: BattleBuild) =>
        calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles" }, {}, runtime).results.find((result) => result.moveId === moveId)!;
      return { make, calc };
    };
    const usum = await native("ultra_sun_ultra_moon");
    const ditto = usum.make("ditto", "imposter");
    const minior = usum.make("miniormeteor", "shieldsdown");
    const intoMinior = usum.calc("rockslide", ditto, minior);
    expect(range(intoMinior)).toBe("86-104");
    expect(intoMinior.assumptions.join(" ")).toContain("Imposter: the attacker Ditto transformed into Minior,");
    expect(range(usum.calc("rockslide", minior, ditto))).toBe("86-104");
    const swsh = await native("sword_shield");
    const school = swsh.make("wishiwashischool", "schooling");
    expect(range(swsh.calc("liquidation", swsh.make("ditto", "imposter"), school))).toBe("6-8");
    expect(range(swsh.calc("liquidation", school, swsh.make("ditto", "imposter")))).toBe("96-113");
  });

  it("keeps a transformed Ditto's own gender, so Rivalry does nothing", async () => {
    // Real battles: an ungendered Ditto copying Nidoking or Nidoqueen (fix32/review/v-imp-gender-refute.ts).
    const swsh = await loadBattleRuntime("sword_shield");
    const make = (id: string, abilityId: string) => ({ ...createBuild(id, swsh), abilityId, abilityActive: abilityId === "imposter", itemId: "" } as BattleBuild);
    const earthPower = (foe: string) => range(calculateMatchup(make(foe, "rivalry"), make("ditto", "imposter"), { ...createConditions(), gameType: "Singles" }, {}, swsh)
      .results.find((result) => result.moveId === "earthpower")!);
    expect(earthPower("nidoking")).toBe("114-134");
    expect(earthPower("nidoqueen")).toBe("92-110");
  });
});

describe("a Trace holder that Mega Evolves", () => {
  it("keeps the stored copy with the Pokémon that took it across roster reselects", () => {
    // Paste rosters, whose session cache restores each Pokémon's build (fix35/review/intimidate-cache.ts).
    const own = ["Gardevoir @ Gardevoirite", "Ability: Trace", "- Moonblast", "", "Garchomp", "Ability: Rough Skin", "- Earthquake"].join("\n");
    const opponent = ["Gyarados", "Ability: Intimidate", "- Waterfall", "", "Incineroar", "Ability: Intimidate", "- Flare Blitz"].join("\n");
    const state = createRosterState();
    const install = (current: PreparedMatchup, role: RosterRole, text: string) => {
      const next = changeTeamSource(current, getTeamSourceOwner(current, role), "paste");
      return applyTeamPaste(next, getTeamSourceOwner(next, role), { text, title: role, url: null, team: parseTeamImport(text, "champions", championsRuntime) });
    };
    const choose = (current: PreparedMatchup, role: RosterRole, index: number) =>
      selectRosterPokemon(current, current.attacker.role === role ? "attacker" : "defender", getTeamPanel(current, state, role).choices[index]);
    // The opponent (right) attacks Gardevoir (left).
    const hit = (current: PreparedMatchup, moveId: string) => range(calculateMatchup(current.defender.build, current.attacker.build, { ...current.field, gameType: "Singles" }, {}, championsRuntime)
      .results.find((result) => result.moveId === moveId)!);
    let start = install(install(createMatchup(0, championsRuntime), "own", own), "opponent", opponent);
    start = choose(choose(start, "own", 0), "opponent", 0);
    const fresh = { waterfall: hit(start, "waterfall"), flareBlitz: hit(choose(start, "opponent", 1), "flareblitz") };
    const mega = toggleMatchupMega(start, getMoveOwner(start.attacker), "gardevoirmega");
    const revert = (current: PreparedMatchup) => toggleMatchupMega(current, getMoveOwner(current.attacker), "gardevoirmega");
    const incineroar = choose(mega, "opponent", 1);
    // Incineroar took no drop: reverting to Trace copies its Intimidate, at once or after Gardevoir
    // comes back from the cache.
    expect(hit(revert(incineroar), "flareblitz")).toBe(fresh.flareBlitz);
    expect(hit(revert(choose(choose(incineroar, "own", 1), "own", 0)), "flareblitz")).toBe(fresh.flareBlitz);
    // Gyarados comes back from the cache holding its stored drop, which is not applied a second time.
    expect(hit(revert(choose(incineroar, "opponent", 0)), "waterfall")).toBe(fresh.waterfall);
  });

  it("keeps the Intimidate it copied on entry, stored in both builds", () => {
    let matchup = createMatchup();
    matchup = updateMatchupBuild(matchup, "attacker", build("incineroar", "intimidate"));
    matchup = updateMatchupBuild(matchup, "defender", build("gardevoir", "trace", { itemId: "gardevoirite" }));
    const flareBlitz = (current: typeof matchup) => {
      const out = calculateMatchup(current.attacker.build, current.defender.build, { ...current.field, gameType: "Singles" }, {}, championsRuntime);
      return range(out.results.find((result) => result.moveId === "flareblitz")!);
    };
    expect(flareBlitz(matchup)).toBe("72-85");
    const mega = toggleMatchupMega(matchup, getMoveOwner(matchup.defender), "gardevoirmega");
    expect(mega.defender.build).toMatchObject({ speciesId: "gardevoirmega", abilityId: "pixilate", copiedIntimidateStored: "incineroar" });
    expect(mega.attacker.build.boosts.atk).toBe(-1);
    expect(mega.notice).toContain("The Intimidate it copied with Trace on entry still counts");
    // Showdown: Incineroar stays at -1 after Gardevoir Mega Evolves.
    expect(flareBlitz(mega)).toBe("72-85");
    // Back to the Trace form: the stored drop is not applied a second time.
    const back = toggleMatchupMega(mega, getMoveOwner(mega.defender), "gardevoirmega");
    expect(back.defender.build.abilityId).toBe("trace");
    expect(flareBlitz(back)).toBe("72-85");
  });

  it("applies the copy to a Pokémon that replaced the Intimidated one", () => {
    let matchup = createMatchup();
    matchup = updateMatchupBuild(matchup, "attacker", build("incineroar", "intimidate"));
    matchup = updateMatchupBuild(matchup, "defender", build("gardevoir", "trace", { itemId: "gardevoirite" }));
    const mega = toggleMatchupMega(matchup, getMoveOwner(matchup.defender), "gardevoirmega");
    expect(mega.defender.build.copiedIntimidateStored).toBe("incineroar");
    const replaced = updateMatchupBuild(mega, "attacker", build("gyarados", "intimidate"));
    // Trace now copies the new Pokémon's Intimidate on entry, as a fresh matchup does.
    const back = toggleMatchupMega(replaced, getMoveOwner(replaced.defender), "gardevoirmega");
    const waterfall = (current: typeof matchup) => range(calculateMatchup(current.attacker.build, current.defender.build, { ...current.field, gameType: "Singles" }, {}, championsRuntime)
      .results.find((result) => result.moveId === "waterfall")!);
    let fresh = updateMatchupBuild(createMatchup(), "attacker", build("gyarados", "intimidate"));
    fresh = updateMatchupBuild(fresh, "defender", build("gardevoir", "trace", { itemId: "gardevoirite" }));
    expect(waterfall(back)).toBe(waterfall(fresh));
    expect(calculateMatchup(back.attacker.build, back.defender.build, { ...back.field, gameType: "Singles" }, {}, championsRuntime)
      .results.find((result) => result.moveId === "waterfall")!.assumptions.join(" ")).toContain("copied Intimidate from Gyarados");
  });
});
