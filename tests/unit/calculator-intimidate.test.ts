import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { applyMatchupIntimidate, createMatchup, getMoveOwner, intimidateResult, toggleMatchupMega, updateMatchupBuild, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { applyIntimidate } from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, CombatStat } from "@/app/lib/battle/types";

/**
 * Intimidate as pinned Showdown c23d2e94 resolves it on a real switch-in (sim/battle.ts boost and the
 * switch-in White Herb / Mirror Herb). fix16/sweep.ts checks 3,889 switch-ins across the four games;
 * the damage cases are real turns: the Intimidate user enters, Megas evolve next turn, then the attack.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}
const stages = (values: Partial<Record<CombatStat, number>>) => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...values });
const intimidate = (target: BattleBuild, runtime: BattleRuntime = championsRuntime, source = build("incineroar", "intimidate", runtime), magicRoom = false) =>
  applyIntimidate(source, target, { magicRoom }, runtime);

describe("applyIntimidate", () => {
  it("lowers Attack, or reacts as each ability and item does", () => {
    expect(intimidate(build("garchomp", "roughskin")).target.boosts).toEqual(stages({ atk: -1 }));
    expect(intimidate(build("kingambit", "defiant")).target.boosts).toEqual(stages({ atk: 1 }));
    expect(intimidate(build("milotic", "competitive")).target.boosts).toEqual(stages({ atk: -1, spa: 2 }));
    expect(intimidate(build("persianalola", "rattled")).target.boosts).toEqual(stages({ atk: -1, spe: 1 }));
    expect(intimidate(build("metagross", "clearbody")).target.boosts).toEqual(stages({}));
    expect(intimidate(build("dragonite", "innerfocus")).target.boosts).toEqual(stages({}));
    const mirror = intimidate(build("corviknight", "mirrorarmor"));
    expect(mirror.target.boosts).toEqual(stages({}));
    expect(mirror.source.boosts).toEqual(stages({ atk: -1 }));
    expect(mirror.lines.join(" ")).toContain("Mirror Armor reflects the drop back to Incineroar");
  });

  it("stops the drop and every reaction at -6", () => {
    expect(intimidate(build("kingambit", "defiant", championsRuntime, { boosts: stages({ atk: -6 }) })).target.boosts).toEqual(stages({ atk: -6 }));
    expect(intimidate(build("milotic", "competitive", championsRuntime, { boosts: stages({ atk: -6 }) })).target.boosts).toEqual(stages({ atk: -6 }));
    const mirror = intimidate(build("corviknight", "mirrorarmor", championsRuntime, { boosts: stages({ atk: -6 }) }));
    expect(mirror.source.boosts).toEqual(stages({}));
    // The reflected drop fails at the Intimidate user's -6 too.
    const capped = intimidate(build("corviknight", "mirrorarmor"), championsRuntime, build("incineroar", "intimidate", championsRuntime, { boosts: stages({ atk: -6 }) }));
    expect(capped.source.boosts).toEqual(stages({ atk: -6 }));
    expect(capped.lines.join(" ")).toContain("Incineroar's Attack won't go lower, so nothing reacts.");
  });

  it("stops Adrenaline Orb, Rattled and Guard Dog at -6 (Scarlet/Violet)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const arcanine = build("arcanine", "intimidate", sv);
    const atCap = { boosts: stages({ atk: -6 }) };
    expect(intimidate(build("garchomp", "roughskin", sv, { ...atCap, itemId: "adrenalineorb" }), sv, arcanine).target).toMatchObject({ itemId: "adrenalineorb", boosts: stages({ atk: -6 }) });
    expect(intimidate(build("persianalola", "rattled", sv, atCap), sv, arcanine).target.boosts).toEqual(stages({ atk: -6 }));
    expect(intimidate(build("mabosstiff", "guarddog", sv, atCap), sv, arcanine).target.boosts).toEqual(stages({ atk: -6 }));
  });

  it("uses the Intimidate user's own White Herb after Mirror Armor, and turns Unburden on", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const herb = intimidate(build("corviknight", "mirrorarmor", sv), sv, build("arcanine", "intimidate", sv, { itemId: "whiteherb" }));
    expect(herb.source).toMatchObject({ itemId: "", boosts: stages({}) });
    const unburden = intimidate(build("hawlucha", "unburden", sv, { itemId: "whiteherb" }), sv, build("arcanine", "intimidate", sv));
    expect(unburden.target).toMatchObject({ itemId: "", abilityActive: true, boosts: stages({}) });
    expect(unburden.lines.join(" ")).toContain("Hawlucha's Unburden activates.");
  });

  it("is blocked by Flower Veil on a Tera Grass holder", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const gyarados = build("gyarados", "intimidate", sv);
    const tera = (id: string, teraType: string, itemId = "") => build(id, "flowerveil", sv, { itemId, mechanic: "tera", configuration: { teraType } } as Partial<BattleBuild>);
    const comfey = intimidate(tera("comfey", "Grass"), sv, gyarados);
    expect(comfey.target.boosts).toEqual(stages({}));
    expect(comfey.lines.join(" ")).toContain("Comfey's Flower Veil blocks the drop.");
    // Adrenaline Orb still activates when the drop is blocked.
    expect(intimidate(tera("florges", "Grass", "adrenalineorb"), sv, gyarados).target).toMatchObject({ itemId: "", boosts: stages({ spe: 1 }) });
    expect(intimidate(tera("comfey", "Fairy"), sv, gyarados).target.boosts).toEqual(stages({ atk: -1 }));
    expect(intimidate(build("comfey", "flowerveil", sv), sv, gyarados).target.boosts).toEqual(stages({ atk: -1 }));
  });

  it("counts the entry boosts the engine adds, then stores the stages without them", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    // Intrepid Sword's +1 is on Zacian when Intimidate lands, so it goes to 0 and keeps White Herb.
    const zacian = intimidate(build("zacian", "intrepidsword", swsh, { itemId: "whiteherb" }), swsh, build("incineroar", "intimidate", swsh));
    expect(zacian.target).toMatchObject({ itemId: "whiteherb", boosts: stages({ atk: -1 }) });
    expect(zacian.lines.join(" ")).toContain("Zacian's stages count its Intrepid Sword (+1 Attack), which the calculator adds when it calculates");
    // Its +1 is capped at +6, so Intimidate leaves +5: stored +4.
    expect(intimidate(build("zacian", "intrepidsword", swsh, { boosts: stages({ atk: 6 }) }), swsh, build("incineroar", "intimidate", swsh)).target.boosts).toEqual(stages({ atk: 4 }));
    // Dauntless Shield's +1 Defense cancels a stored -1, so White Herb clears only the Attack drop.
    const zamazenta = intimidate(build("zamazenta", "dauntlessshield", swsh, { itemId: "whiteherb", boosts: stages({ def: -1 }) }), swsh, build("incineroar", "intimidate", swsh));
    expect(zamazenta.target).toMatchObject({ itemId: "", boosts: stages({ def: -1 }) });
    // Wind Rider's +1 counts only under Tailwind on its own side.
    const sv = await loadBattleRuntime("scarlet_violet");
    const bramble = (tailwind: boolean) => applyIntimidate(build("gyarados", "intimidate", sv), build("brambleghast", "windrider", sv, { itemId: "whiteherb" }),
      { magicRoom: false, tailwind: { source: false, target: tailwind } }, sv);
    expect(bramble(true).target).toMatchObject({ itemId: "whiteherb", boosts: stages({ atk: -1 }) });
    expect(bramble(true).lines.join(" ")).toContain("This assumes Tailwind started before the Intimidate.");
    expect(bramble(false).target).toMatchObject({ itemId: "", boosts: stages({}) });
    // Download reads the Intimidate user's Defense and Sp. Def: Porygon-Z takes +1 Attack against Gyarados.
    expect(intimidate(build("porygonz", "download", sv, { itemId: "whiteherb" }), sv, build("gyarados", "intimidate", sv)).target)
      .toMatchObject({ itemId: "whiteherb", boosts: stages({ atk: -1 }) });
  });

  it("uses White Herb up, restoring every lowered stage", () => {
    const herb = intimidate(build("garchomp", "roughskin", championsRuntime, { itemId: "whiteherb", boosts: stages({ def: -1 }) }));
    expect(herb.target).toMatchObject({ itemId: "", boosts: stages({}) });
    expect(herb.lines.join(" ")).toContain("White Herb restores its lowered stats (used up)");
    // Magic Room suppresses it.
    expect(intimidate(build("garchomp", "roughskin", championsRuntime, { itemId: "whiteherb" }), championsRuntime, undefined, true).target)
      .toMatchObject({ itemId: "whiteherb", boosts: stages({ atk: -1 }) });
  });

  it("follows each game's rules", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Before Sword/Shield, Inner Focus does not block Intimidate and Rattled does not react.
    expect(intimidate(build("dragonite", "innerfocus", usum), usum).target.boosts).toEqual(stages({ atk: -1 }));
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(intimidate(build("mabosstiff", "guarddog", sv), sv, build("arcanine", "intimidate", sv)).target.boosts).toEqual(stages({ atk: 1 }));
    const orb = intimidate(build("dragonite", "innerfocus", sv, { itemId: "adrenalineorb" }), sv, build("arcanine", "intimidate", sv));
    expect(orb.target).toMatchObject({ itemId: "", boosts: stages({ spe: 1 }) });
    expect(intimidate(build("garchomp", "roughskin", sv, { itemId: "clearamulet" }), sv, build("arcanine", "intimidate", sv)).target.boosts).toEqual(stages({}));
    const herb = intimidate(build("kingambit", "defiant", sv), sv, build("arcanine", "intimidate", sv, { itemId: "mirrorherb" }));
    expect(herb.source).toMatchObject({ itemId: "", boosts: stages({ atk: 2 }) });
    const gas = intimidate(build("weezinggalar", "neutralizinggas", sv), sv, build("arcanine", "intimidate", sv));
    expect(gas.target.boosts).toEqual(stages({}));
    expect(gas.lines.join(" ")).toContain("Neutralizing Gas suppresses it");
  });
});

describe("Intimidate in the matchup", () => {
  function matchup(attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime = championsRuntime): PreparedMatchup {
    let current = createMatchup(0, runtime);
    current = updateMatchupBuild(current, "attacker", attacker);
    current = updateMatchupBuild(current, "defender", defender);
    return { ...current, field: { ...current.field, gameType: "Singles", multipleTargets: false } };
  }
  const damage = (current: PreparedMatchup, moveId: string) => {
    const row = calculateMatchup(current.attacker.build, current.defender.build, current.field, {}, current.runtime).results.find((result) => result.moveId === moveId)!;
    return Array.isArray((row.rolls as number[][])[0]) ? (row.rolls as number[][]).map((hit) => `${hit[0]}-${hit[15]}`) : [`${row.min}-${row.max}`];
  };

  it("stores the result on both Pokémon and matches Showdown's damage", () => {
    const mirror = applyMatchupIntimidate(matchup(build("corviknight", "mirrorarmor"), build("incineroar", "intimidate")), "defender");
    expect(damage(mirror, "bravebird")).toEqual(["67-79"]);
    expect(intimidateResult(mirror, "defender")).toContain("Mirror Armor reflects the drop back to Incineroar");
    const reflected = applyMatchupIntimidate(matchup(build("incineroar", "intimidate"), build("corviknight", "mirrorarmor")), "attacker");
    expect(damage(reflected, "flareblitz")).toEqual(["102-120"]);
    const herb = applyMatchupIntimidate(matchup(build("altaria", "naturalcure", championsRuntime, { itemId: "whiteherb" }), build("incineroar", "intimidate")), "defender");
    expect(damage(herb, "acrobatics")).toEqual(["51-61"]);
    expect(damage(applyMatchupIntimidate(matchup(build("kingambit", "defiant", championsRuntime, { boosts: stages({ atk: -6 }) }), build("incineroar", "intimidate")), "defender"), "ironhead")).toEqual(["8-10"]);
  });

  it("is never applied again by the engine, so Parental Bond's second strike stays at -1", () => {
    const current = applyMatchupIntimidate(matchup(build("kangaskhanmega", "parentalbond"), build("incineroar", "intimidate")), "defender");
    expect(damage(current, "doubleedge")).toEqual(["60-72", "15-18"]);
    // An Intimidate holder no longer changes the other Pokémon's stage until the button is used.
    expect(damage(matchup(build("garchomp", "roughskin"), build("incineroar", "intimidate", championsRuntime, { abilityActive: true })), "earthquake")).toEqual(["156-186"]);
  });

  it("keeps the stage through either Pokémon's Mega Evolution", () => {
    let gyarados = applyMatchupIntimidate(matchup(build("garchomp", "roughskin"), build("gyarados", "intimidate")), "defender");
    gyarados = toggleMatchupMega(gyarados, getMoveOwner(gyarados.defender), "gyaradosmega");
    expect(damage(gyarados, "dragonclaw")).toEqual(["36-43"]);
    let salamence = applyMatchupIntimidate(matchup(build("kingambit", "defiant"), build("salamence", "intimidate")), "defender");
    salamence = toggleMatchupMega(salamence, getMoveOwner(salamence.defender), "salamencemega");
    expect(damage(salamence, "ironhead")).toEqual(["70-84"]);
    // Intimidate resolved against the entry ability: Inner Focus blocked it before the Mega Evolution.
    let kangaskhan = applyMatchupIntimidate(matchup(build("kangaskhan", "innerfocus"), build("incineroar", "intimidate")), "defender");
    kangaskhan = toggleMatchupMega(kangaskhan, getMoveOwner(kangaskhan.attacker), "kangaskhanmega");
    expect(damage(kangaskhan, "doubleedge")).toEqual(["90-106", "22-27"]);
    let staraptor = applyMatchupIntimidate(matchup(build("staraptor", "reckless"), build("incineroar", "intimidate")), "defender");
    staraptor = toggleMatchupMega(staraptor, getMoveOwner(staraptor.attacker), "staraptormega");
    expect(damage(staraptor, "bravebird")).toEqual(["66-78"]);
  });

  it("fires again when Scrafty Mega Evolves", () => {
    let scrafty = applyMatchupIntimidate(matchup(build("garchomp", "roughskin"), build("scrafty", "intimidate")), "defender");
    scrafty = toggleMatchupMega(scrafty, getMoveOwner(scrafty.defender), "scraftymega");
    expect(scrafty.notice).toContain("Its Intimidate activates when it Mega Evolves: use Apply Intimidate");
    scrafty = applyMatchupIntimidate(scrafty, "defender");
    expect(damage(scrafty, "earthquake")).toEqual(["28-34"]);
  });

  it("matches Showdown with calc-time entry boosts", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const zacian = applyMatchupIntimidate(matchup(build("zacian", "intrepidsword", swsh, { itemId: "whiteherb" }), build("incineroar", "intimidate", swsh), swsh), "defender");
    expect(damage(zacian, "playrough")).toEqual(["70-84"]);
    const sv = await loadBattleRuntime("scarlet_violet");
    let bramble = matchup(build("brambleghast", "windrider", sv, { itemId: "whiteherb" }), build("gyarados", "intimidate", sv), sv);
    bramble = applyMatchupIntimidate({ ...bramble, field: { ...bramble.field, attackerSide: { ...bramble.field.attackerSide, tailwind: true } } }, "defender");
    expect(damage(bramble, "powerwhip")).toEqual(["93-111"]);
  });

  it("shows the result under the button until either build changes, counting repeats", () => {
    const start = matchup(build("incineroar", "intimidate"), build("incineroar", "intimidate"));
    const once = applyMatchupIntimidate(start, "attacker");
    expect(intimidateResult(once, "attacker")).toBe("Incineroar (left)'s Intimidate: Incineroar (right)'s Attack falls to -1.");
    expect(intimidateResult(once, "defender")).toBeNull();
    expect(intimidateResult(applyMatchupIntimidate(once, "attacker"), "attacker")).toMatch(/^Applied 2 times in a row\. .*falls to -2\.$/);
    // An edit to either build hides it, and the next application starts the count again.
    const edited = updateMatchupBuild(once, "defender", { ...once.defender.build, boosts: stages({}) });
    expect(intimidateResult(edited, "attacker")).toBeNull();
    expect(intimidateResult(applyMatchupIntimidate(edited, "attacker"), "attacker")).not.toContain("Applied");
  });

  it("warns about a Flower Veil partner in Doubles for a Grass-type target", () => {
    const venusaur = matchup(build("incineroar", "intimidate"), build("venusaur", "overgrow"));
    const doubles = applyMatchupIntimidate({ ...venusaur, field: { ...venusaur.field, gameType: "Doubles" } }, "attacker");
    expect(intimidateResult(doubles, "attacker")).toContain("Venusaur is Grass type: a partner with Flower Veil would block this drop in Doubles.");
    expect(intimidateResult(applyMatchupIntimidate(venusaur, "attacker"), "attacker")).not.toContain("Flower Veil");
  });

  it("offers the button only to Intimidate holders", () => {
    const panel = (abilityId: string) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: build("incineroar", abilityId), issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, onApplyIntimidate: () => undefined,
    }));
    const html = panel("intimidate");
    expect(html).toContain("Apply Intimidate to the right Pokémon");
    expect(html).toContain("not behind a Substitute");
    expect(html).toContain("select any used-up item again and clear Unburden");
    expect(renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: build("incineroar", "intimidate"), issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined,
      onApplyIntimidate: () => undefined, intimidateResult: "Incineroar's Intimidate: Garchomp's Attack falls to -1.",
    }))).toMatch(/<p role="status"[^>]*>Incineroar&#x27;s Intimidate: Garchomp&#x27;s Attack falls to -1\.<\/p>/);
    expect(html).not.toContain("Apply Intimidate on entry");
    expect(html).not.toMatch(/id="[^"]*-ability-active"/);
    expect(panel("blaze")).not.toContain("Apply Intimidate");
  });
});
