import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleConditions, { describeConditions } from "@/app/(app)/calculator/BattleConditions";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions as Conditions, MoveContext, SideConditions } from "@/app/lib/battle/types";
import { unmodelledBattleStates } from "@/app/lib/battle/unmodelled-states";

/**
 * Reference rolls from pinned Showdown c23d2e94's real useMove pipeline (field-core ref.ts) with
 * the target's protect volatile, the tailwind side condition or the user's charge volatile.
 * Level 50, 0 Stat Points/EVs, 31 IVs, Serious nature, Singles unless stated, no crit.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

type FieldOptions = { attacker?: Partial<SideConditions>; defender?: Partial<SideConditions>; doubles?: boolean; field?: Partial<Conditions> };
function field({ attacker = {}, defender = {}, doubles = false, field: extra = {} }: FieldOptions = {}): Conditions {
  const base = createConditions();
  return {
    ...base, gameType: doubles ? "Doubles" : "Singles", multipleTargets: false, ...extra,
    attackerSide: { ...base.attackerSide, ...attacker }, defenderSide: { ...base.defenderSide, ...defender },
  };
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, conditions: Conditions, runtime: BattleRuntime = championsRuntime, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, conditions, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const protecting = (extra: Partial<SideConditions> = {}) => field({ defender: { protect: true, ...extra } });
const golurk = build("golurkmega", "unseenfist", championsRuntime, { itemId: "golurkite" });
const excadrill = build("excadrillmega", "piercingdrill", championsRuntime, { itemId: "excadrite" });
const incineroar = build("incineroar", "blaze");

describe("Protecting target", () => {
  it("lets Champions' Unseen Fist and Piercing Drill contact moves through for a quarter, after every other modifier", () => {
    const drainPunch = row("drainpunch", golurk, incineroar, protecting());
    expect(drainPunch).toMatchObject({ kind: "calculated", min: 23, max: 27 });
    expect(drainPunch.assumptions).toContain("The target is protecting: Unseen Fist lets this contact move through for a quarter of the damage, after every other modifier.");
    expect(row("ironhead", excadrill, build("garchomp", "roughskin"), protecting())).toMatchObject({ min: 18, max: 22 });
    // The engine quarters before Reflect, Multiscale and resist berries; Showdown after them.
    expect(row("drainpunch", golurk, incineroar, protecting({ reflect: true }))).toMatchObject({ min: 11, max: 14 });
    expect(row("drainpunch", golurk, incineroar, field({ defender: { protect: true, reflect: true }, doubles: true }))).toMatchObject({ min: 15, max: 18 });
    expect(row("ironhead", excadrill, build("dragonite", "multiscale"), protecting())).toMatchObject({ min: 9, max: 11 });
    expect(row("icepunch", golurk, build("garchomp", "roughskin", championsRuntime, { itemId: "yacheberry" }), protecting())).toMatchObject({ min: 22, max: 26 });
  });

  it("blocks other moves, and never counts the attacker's own Protect", () => {
    const blocked = row("earthquake", excadrill, build("meganium", "overgrow"), protecting());
    expect(blocked).toMatchObject({ kind: "calculated", min: 0, max: 0, description: "The target is protecting, which blocks Earthquake." });
    expect(row("dragonclaw", build("garchomp", "roughskin"), incineroar, protecting()).max).toBe(0);
    expect(row("dragonclaw", build("garchomp", "roughskin"), incineroar, field({ attacker: { protect: true } }))).toMatchObject({ min: 63, max: 75 });
  });

  it("does not block moves without Showdown's protect flag", () => {
    const garchomp = build("garchomp", "sandveil");
    const feint = row("feint", build("absol", "pressure"), garchomp, protecting());
    expect(feint).toMatchObject({ min: 16, max: 19 });
    expect(feint.assumptions).toContain("The target is protecting, but Feint is not blocked by Protect.");
    expect(row("phantomforce", build("absol", "pressure"), garchomp, protecting())).toMatchObject({ min: 45, max: 53 });
    // Real turns: Future Sight used on turn 1 lands on turn 3, when the target uses Protect.
    const futureSight = row("futuresight", build("absol", "pressure"), garchomp, protecting());
    expect(futureSight).toMatchObject({ min: 41, max: 49 });
    expect(futureSight.assumptions).toContain("Future Sight lands at the end of a later turn, which the target's Protect does not block.");
  });

  it("lets the main games' Unseen Fist contact moves through in full", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const urshifu = (extra: Partial<BattleBuild> = {}) => build("urshifu", "unseenfist", sv, extra);
    const garchomp = build("garchomp", "roughskin", sv);
    const wickedBlow = row("wickedblow", urshifu(), garchomp, protecting(), sv);
    expect(wickedBlow).toMatchObject({ min: 84, max: 100 });
    expect(wickedBlow.assumptions).toContain("The target is protecting, but Unseen Fist lets this contact move through in full.");
    expect(row("surgingstrikes", build("urshifurapidstrike", "unseenfist", sv), garchomp, protecting(), sv)).toMatchObject({ min: 90, max: 108, hits: 3 });
    expect(row("rockslide", urshifu(), garchomp, protecting(), sv).max).toBe(0);
    // Punching Glove removes contact from punches, unless Magic Room suppresses it.
    expect(row("wickedblow", urshifu({ itemId: "punchingglove" }), garchomp, protecting(), sv).max).toBe(0);
    expect(row("wickedblow", urshifu({ itemId: "punchingglove" }), garchomp, field({ defender: { protect: true }, field: { magicRoom: true } }), sv)).toMatchObject({ min: 84, max: 100 });
    // The target's Neutralizing Gas suppresses Unseen Fist unless Ability Shield keeps it.
    const weezing = build("weezinggalar", "neutralizinggas", sv);
    expect(row("wickedblow", urshifu(), weezing, protecting(), sv).max).toBe(0);
    expect(row("wickedblow", urshifu({ itemId: "abilityshield" }), weezing, protecting(), sv)).toMatchObject({ min: 34, max: 41 });
    expect(row("mightycleave", build("ironboulder", "quarkdrive", sv), build("garchomp", "sandveil", sv), protecting(), sv)).toMatchObject({ min: 33, max: 39 });
  });

  it("keeps an immune target at 0 through a bypass", async () => {
    expect(row("shadowpunch", golurk, build("snorlax", "thickfat"), protecting())).toMatchObject({ min: 0, max: 0 });
    expect(row("drillrun", excadrill, build("corviknight", "pressure"), protecting())).toMatchObject({ min: 0, max: 0 });
    const swsh = await loadBattleRuntime("sword_shield");
    const shedinja = build("shedinja", "wonderguard", swsh);
    expect(row("closecombat", build("machamp", "guts", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>), shedinja, protecting(), swsh)).toMatchObject({ effectiveName: "Max Knuckle", min: 0, max: 0, ohkoChance: 0 });
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(row("naturesmadness", build("tapukoko", "electricsurge", usum, { itemId: "tapuniumz" }), build("shedinja", "wonderguard", usum), protecting(), usum, { useZ: true })).toMatchObject({ min: 0, max: 0, ohkoChance: 0 });
  });

  it("fails Sucker Punch, and doubles Payback, because a Protecting target has already moved", async () => {
    for (const game of ["scarlet_violet", "sword_shield"] as const) {
      const runtime = await loadBattleRuntime(game);
      expect(row("suckerpunch", build("urshifu", "unseenfist", runtime), build("snorlax", "thickfat", runtime), protecting(), runtime), game)
        .toMatchObject({ min: 0, max: 0, description: "Sucker Punch fails: a Pokémon protecting this turn has already used its move." });
    }
    const swsh = await loadBattleRuntime("sword_shield");
    const payback = row("payback", build("urshifu", "unseenfist", swsh), build("snorlax", "thickfat", swsh), protecting(), swsh);
    expect(payback).toMatchObject({ min: 100, max: 118 });
    expect(payback.assumptions).toContain("Doubled power: the target is protecting, so it has already moved this turn.");
  });

  it("gives Analytic its boost into a Protecting target in Singles, and asks in Doubles", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const havoc = row("thunderbolt", build("magnezone", "analytic", usum, { itemId: "electriumz" }), build("snorlax", "thickfat", usum), protecting(), usum, { useZ: true });
    expect(havoc).toMatchObject({ effectiveName: "Gigavolt Havoc", min: 37, max: 44 });
    expect(havoc.assumptions).toContain("The target protected before this attack, so Analytic boosts it.");
    const swsh = await loadBattleRuntime("sword_shield");
    const magnezone = build("magnezone", "analytic", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>);
    expect(row("thunderbolt", magnezone, build("snorlax", "thickfat", swsh), protecting(), swsh)).toMatchObject({ min: 27, max: 32 });
    expect(row("thunderbolt", magnezone, build("snorlax", "thickfat", swsh), field({ defender: { protect: true }, doubles: true }), swsh).kind).toBe("needs-context");
  });

  it("reports the failure Showdown checks before Protect", () => {
    const bellibolt = build("bellibolt", "damp");
    expect(row("selfdestruct", golurk, bellibolt, protecting()).description).toBe("Damp prevents Self-Destruct from being used.");
    expect(row("snore", golurk, bellibolt, protecting()).description).toBe("Snore fails because the attacker is not asleep.");
  });

  it("lets Z-Moves and Max Moves through for a quarter, and G-Max One Blow in full", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const snorlaxUM = build("snorlax", "thickfat", usum);
    const drake = row("dragonclaw", build("garchomp", "roughskin", usum, { itemId: "dragoniumz" }), snorlaxUM, protecting(), usum, { useZ: true });
    expect(drake).toMatchObject({ effectiveName: "Devastating Drake", min: 40, max: 47 });
    expect(row("dragonclaw", build("garchomp", "roughskin", usum, { itemId: "dragoniumz" }), build("dragonite", "multiscale", usum), protecting(), usum, { useZ: true })).toMatchObject({ min: 29, max: 35 });
    const guardian = row("naturesmadness", build("tapukoko", "electricsurge", usum, { itemId: "tapuniumz" }), snorlaxUM, protecting(), usum, { useZ: true });
    expect(guardian).toMatchObject({ effectiveName: "Guardian of Alola", min: 44, max: 44 });
    expect(row("seismictoss", build("machamp", "guts", usum), snorlaxUM, protecting(), usum).max).toBe(0);
    const swsh = await loadBattleRuntime("sword_shield");
    const snorlaxSS = build("snorlax", "thickfat", swsh);
    expect(row("dragonclaw", build("garchomp", "roughskin", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>), snorlaxSS, protecting(), swsh)).toMatchObject({ effectiveName: "Max Wyrmwind", min: 32, max: 38 });
    const oneBlow = row("wickedblow", build("urshifu", "unseenfist", swsh, { mechanic: "gigantamax", configuration: { gigantamax: true } } as Partial<BattleBuild>), build("garchomp", "roughskin", swsh), { ...protecting(), critical: true }, swsh);
    expect(oneBlow).toMatchObject({ effectiveName: "G-Max One Blow", min: 144, max: 171 });
    expect(row("dragonclaw", build("garchomp", "roughskin", swsh), build("snorlax", "thickfat", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>), protecting(), swsh))
      .toMatchObject({ kind: "unsupported", reason: "A Dynamaxed Pokémon protects with Max Guard, which is not modelled." });
  });
});

describe("Tailwind", () => {
  const ampharos = build("ampharos", "static");
  it("doubles Speed on its side for Electro Ball and Gyro Ball", () => {
    const own = row("electroball", ampharos, build("kingambit", "defiant"), field({ attacker: { tailwind: true } }));
    expect(own).toMatchObject({ min: 58, max: 70 });
    expect(own.assumptions).toContain("Tailwind doubles Speed on the attacking Pokémon's side, which sets this move's power.");
    expect(row("electroball", ampharos, build("snorlax", "thickfat"), field({ defender: { tailwind: true } }))).toMatchObject({ min: 25, max: 30 });
    expect(row("electroball", ampharos, build("snorlax", "thickfat"), field({ attacker: { tailwind: true }, defender: { tailwind: true } }))).toMatchObject({ min: 36, max: 43 });
    expect(row("gyroball", build("forretress", "sturdy"), build("dragapult", "clearbody"), field({ defender: { tailwind: true } }))).toMatchObject({ min: 90, max: 106 });
    expect(row("gyroball", build("forretress", "sturdy"), build("garchomp", "roughskin"), field({ attacker: { tailwind: true } }))).toMatchObject({ min: 15, max: 18 });
    const other = row("dragonclaw", build("garchomp", "roughskin"), build("snorlax", "thickfat"), field({ attacker: { tailwind: true } }));
    expect(other.assumptions.some((line) => line.includes("Tailwind"))).toBe(false);
  });

  it("gives Wind Rider +1 Attack on its side", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const brambleghast = row("powerwhip", build("brambleghast", "windrider", sv), build("snorlax", "thickfat", sv), field({ attacker: { tailwind: true } }), sv);
    expect(brambleghast).toMatchObject({ min: 160, max: 190 });
    expect(brambleghast.assumptions).toContain("Wind Rider: Tailwind on its side gave the attacker +1 Attack, added to the stages set here.");
    expect(row("foulplay", build("kingambit", "defiant", sv), build("brambleghast", "windrider", sv), field({ defender: { tailwind: true } }), sv)).toMatchObject({ min: 240, max: 284 });
    // The target's Neutralizing Gas suppresses Wind Rider, so it gets no boost (unless Ability Shield keeps it).
    const weezing = build("weezinggalar", "neutralizinggas", sv);
    const gassed = row("leafblade", build("shiftry", "windrider", sv), weezing, field({ attacker: { tailwind: true } }), sv);
    expect(gassed).toMatchObject({ min: 21, max: 26 });
    expect(gassed.assumptions).toContain("The target's Neutralizing Gas stops Wind Rider's Tailwind boost. Set +1 Attack only if the attacker gained it before Neutralizing Gas came in.");
    expect(row("leafblade", build("shiftry", "windrider", sv, { itemId: "abilityshield" }), weezing, field({ attacker: { tailwind: true } }), sv)).toMatchObject({ min: 33, max: 39 });
    // Tera Blast turned Physical carries the note too.
    const teraBlast = row("terablast", build("brambleghast", "windrider", sv, { mechanic: "tera", configuration: { teraType: "Grass" } } as Partial<BattleBuild>), build("snorlax", "thickfat", sv), field({ attacker: { tailwind: true } }), sv);
    expect(teraBlast).toMatchObject({ min: 144, max: 170 });
    expect(teraBlast.assumptions).toContain("Wind Rider: Tailwind on its side gave the attacker +1 Attack, added to the stages set here.");
  });

  it("does not credit Tailwind for Analytic when its condition is set", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const porygon = (abilityActive: boolean) => build("porygon2", "analytic", sv, { abilityActive });
    const on = row("triattack", porygon(true), build("snorlax", "thickfat", sv), field({ defender: { tailwind: true } }), sv);
    expect(on.assumptions.some((line) => line.includes("Tailwind"))).toBe(false);
    const off = row("triattack", porygon(false), build("snorlax", "thickfat", sv), field({ defender: { tailwind: true } }), sv);
    expect(off.assumptions).toContain("Tailwind doubles Speed on the receiving Pokémon's side, which sets the turn order.");
  });
});

describe("Charge", () => {
  const rotom = build("rotomwash", "levitate");
  it("doubles the charged Pokémon's next Electric attack", async () => {
    const thunderbolt = row("thunderbolt", rotom, incineroar, field({ attacker: { charge: true } }));
    expect(thunderbolt).toMatchObject({ min: 117, max: 138 });
    expect(thunderbolt.assumptions).toContain("Charge doubles this Electric attack's power.");
    expect(row("supercellslam", build("pawmot", "voltabsorb"), build("kingambit", "defiant"), field({ attacker: { charge: true } }))).toMatchObject({ min: 109, max: 129 });
    // Charge's exact 2x never changes the rounding of the other power modifiers.
    expect(row("thunderbolt", { ...rotom, itemId: "magnet" }, incineroar, field({ attacker: { charge: true, helpingHand: true }, doubles: true, field: { terrain: "Electric" } })))
      .toMatchObject({ min: 208, max: 246 });
    expect(row("hydropump", rotom, incineroar, field({ attacker: { charge: true } }))).toMatchObject({ min: 144, max: 170 });
    expect(row("thunderbolt", rotom, incineroar, field({ defender: { charge: true } }))).toMatchObject({ min: 58, max: 70 });
    expect(row("discharge", build("bellibolt", "electromorphosis", championsRuntime, { abilityActive: true }), incineroar, field({ attacker: { charge: true } }))).toMatchObject({ min: 102, max: 120 });
    for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const runtime = await loadBattleRuntime(game);
      expect(row("thunderbolt", build("rotomwash", "levitate", runtime), build("snorlax", "thickfat", runtime), field({ attacker: { charge: true } }), runtime), game).toMatchObject({ min: 99, max: 117 });
    }
  });
});

describe("Field conditions", () => {
  it("offers Protecting, Tailwind and Charge on each side, in Singles too", () => {
    const html = renderToStaticMarkup(createElement(BattleConditions, { value: field(), issues: [], onChange: () => undefined }));
    for (const side of ["attackerSide", "defenderSide"]) {
      for (const key of ["protect", "tailwind", "charge"]) {
        const input = html.match(new RegExp(`<input\\b[^>]*id="[^"]*-${side}-${key}"[^>]*>`))?.[0];
        expect(input, `${side} ${key}`).toBeDefined();
        expect(input).not.toContain('disabled=""');
      }
    }
    expect(html).toContain("Protecting");
    expect(describeConditions(field({ attacker: { tailwind: true, charge: true }, defender: { protect: true } }))).toContain("3 toggles on");
  });

  it("lists the battle states it cannot represent for the selected game", async () => {
    const champions = unmodelledBattleStates(championsRuntime);
    expect(champions).toContain("Wide Guard or Quick Guard protecting the whole side");
    // Only abilities and moves present in the game are named: Champions has Steely Spirit (Perrserker) alone.
    expect(champions).toContain("A partner's Steely Spirit");
    expect(champions).toContain("Grounding or lifting from Smack Down, Ingrain, Roost or Magnet Rise");
    expect(champions).not.toContain("Max Guard from a Dynamaxed Pokémon");
    const swsh = await loadBattleRuntime("sword_shield");
    expect(unmodelledBattleStates(swsh)).toContain("Max Guard from a Dynamaxed Pokémon");
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(unmodelledBattleStates(usum)).toEqual(expect.arrayContaining([
      "Foresight, Odor Sleuth or Miracle Eye on the target",
      "A partner's Battery or Flower Gift",
      "Dark Aura or Aura Break from a Pokémon other than the two shown",
      "A target in the middle of Dig, Dive, Fly, Bounce or Sky Drop, which some moves hit for double damage",
    ]));
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(unmodelledBattleStates(sv)).toContain("Sword of Ruin, Beads of Ruin, Tablets of Ruin, Vessel of Ruin or Neutralizing Gas from a Pokémon other than the two shown");
    // Every ability or move a list names belongs to that game.
    const named = ["Battery", "Power Spot", "Steely Spirit", "Flower Gift", "Thousand Arrows", "Telekinesis", "Sky Drop", "Doodle", "Core Enforcer", "Heart Swap", "Mat Block", "Crafty Shield", "Dark Aura", "Sword of Ruin"];
    for (const runtime of [championsRuntime, sv, swsh, usum]) {
      const names = new Set([...runtime.catalog.abilities.map((ability) => ability.name), ...runtime.catalog.moves.map((move) => move.name)]);
      for (const line of unmodelledBattleStates(runtime)) for (const name of named) if (line.includes(name)) expect(names.has(name), `${runtime.profile.id}: ${name}`).toBe(true);
    }
    const html = renderToStaticMarkup(createElement(BattleConditions, { value: field(), issues: [], onChange: () => undefined, runtime: swsh }));
    expect(html).toMatch(/<h3\b[^>]*>Battle states that cannot be set here<\/h3>/);
    expect(html).toContain("<li>Max Guard from a Dynamaxed Pokémon.</li>");
  });

  it("points setup and protection status moves to their toggle", () => {
    const protect = row("protect", build("garchomp", "roughskin"), incineroar, field());
    expect(protect).toMatchObject({ kind: "status", reason: expect.stringContaining("tick Protecting on its side under Field conditions") });
    expect(row("tailwind", build("talonflame", "galewings"), incineroar, field()).reason).toContain("Tick Tailwind on the user's side");
    expect(row("charge", build("rotomwash", "levitate"), incineroar, field()).reason).toContain("Tick Charge on the user's side");
  });

  it("describes Protect for each game's own mechanics", async () => {
    const help = async (game?: "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon") => {
      const runtime = game ? await loadBattleRuntime(game) : championsRuntime;
      const html = renderToStaticMarkup(createElement(BattleConditions, { value: field(), issues: [], onChange: () => undefined, runtime }));
      return html.match(/Protecting means[^.]*\./)?.[0] ?? "";
    };
    expect(await help()).toContain("Unseen Fist and Piercing Drill let contact moves through for a quarter of the damage");
    expect(await help("scarlet_violet")).toContain("Unseen Fist lets contact moves through");
    const usum = await help("ultra_sun_ultra_moon");
    expect(usum).toContain("Z-Moves break through for a quarter of the damage");
    expect(usum).not.toContain("Unseen Fist");
    expect(await help("sword_shield")).toContain("a Dynamaxed Pokémon protects with Max Guard, which is not modelled");
  });
});
