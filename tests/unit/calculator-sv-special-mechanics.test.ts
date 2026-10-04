import { beforeAll, describe, expect, it } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import { createBuild, createConditions, getBuildStats, roomItemChoice, validateBuild } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, StatTable } from "@/app/lib/battle/types";

/**
 * Scarlet/Violet mechanics the engine needs told about: Protosynthesis, Quark Drive and Booster
 * Energy; Intrepid Sword and Dauntless Shield's first-entry boost; Ogerpon's and Terapagos's Tera
 * forms. Level 50, 31 IVs, Serious nature unless stated, Singles. Every number matches pinned
 * Showdown c23d2e94 in real battles (audit native-games/repro.ts 1-2, fix32/paradox.ts sweep of
 * every Paradox holder, fix32/knock.ts, fix32/tera.ts, fix32/terapagos.ts).
 */
let sv: BattleRuntime;
let swsh: BattleRuntime;
beforeAll(async () => {
  sv = await loadBattleRuntime("scarlet_violet");
  swsh = await loadBattleRuntime("sword_shield");
});

type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; tera?: string; abilityActive?: boolean };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  if (base.game === "champions") throw new Error("native builds only");
  return {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.abilityActive !== undefined ? { abilityActive: spec.abilityActive } : {}),
    ...(spec.tera ? { mechanic: "tera" as const, configuration: { ...base.configuration, teraType: spec.tera as never } } : {}),
    native: { ...base.native, evs: { ...base.native.evs, ...spec.evs } },
  } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;

describe("Protosynthesis, Quark Drive and Booster Energy", () => {
  it("activates in sun, on Electric Terrain or from Booster Energy, which is then used up", () => {
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy", evs: { spa: 252 }, nature: "Timid" });
    const amoonguss = build(sv, "amoonguss", { evs: { hp: 252 } });
    const moonblast = row(sv, "moonblast", flutter, amoonguss);
    expect(range(moonblast)).toBe("65-77");
    expect(moonblast.assumptions).toContain("The attacker Flutter Mane's Protosynthesis boosts its Sp. Atk (its highest stat), from its Booster Energy (used up). Assumes no stage changes since it activated.");
    expect(range(row(sv, "headlongrush", build(sv, "greattusk", { ability: "protosynthesis", evs: { atk: 252 }, nature: "Jolly" }), build(sv, "gholdengo", { evs: { hp: 252 } }), { weather: "Sun" }))).toBe("282-332");
    expect(range(row(sv, "drainpunch", build(sv, "ironhands", { ability: "quarkdrive", evs: { atk: 252 }, nature: "Adamant" }), build(sv, "kingambit", { evs: { hp: 252 } }), { terrain: "Electric" }))).toBe("336-396");
    // The receiving Pokémon's boost applies too: Scream Tail's Sp. Def.
    expect(range(row(sv, "moonblast", { ...flutter, itemId: "" }, build(sv, "screamtail", { ability: "protosynthesis", item: "boosterenergy", evs: { hp: 252, spd: 252 } })))).toBe("48-57");
  });

  it("knows whether the Booster Energy is still held", () => {
    const meowscarada = build(sv, "meowscarada", { evs: { atk: 252 } });
    const valiant = build(sv, "ironvaliant", { ability: "quarkdrive", item: "boosterenergy" });
    // Used up, or held by a Paradox Pokémon it cannot be removed from: no Knock Off boost either way.
    expect(range(row(sv, "knockoff", meowscarada, valiant))).toBe("13-16");
    expect(range(row(sv, "knockoff", meowscarada, valiant, { terrain: "Electric" }))).toBe("13-16");
    const gholdengo = build(sv, "gholdengo", { ability: "goodasgold" });
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    expect(range(row(sv, "poltergeist", gholdengo, flutter))).toBe("0-0");
    expect(range(row(sv, "poltergeist", gholdengo, flutter, { weather: "Sun" }))).toBe("134-158");
    const roaringMoon = build(sv, "roaringmoon", { ability: "protosynthesis", item: "boosterenergy" });
    expect(range(row(sv, "acrobatics", roaringMoon, build(sv, "snorlax")))).toBe("101-119");
    expect(range(row(sv, "acrobatics", roaringMoon, build(sv, "snorlax"), { weather: "Sun" }))).toBe("51-60");
  });

  it("stays off under Magic Room or the foe's Neutralizing Gas, and without sun, terrain or the item (Scarlet/Violet has no Harsh Sunshine)", () => {
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy", evs: { spa: 252 }, nature: "Timid" });
    const amoonguss = build(sv, "amoonguss", { evs: { hp: 252 } });
    const plain = range(row(sv, "moonblast", { ...flutter, itemId: "" }, amoonguss));
    expect(plain).toBe("51-60");
    // Entering while Magic Room is already up keeps the Booster Energy unused.
    const room = row(sv, "moonblast", { ...flutter, itemUsedBeforeRoom: false }, amoonguss, { magicRoom: true });
    expect(range(room)).toBe(plain);
    expect(room.assumptions.join(" ")).not.toContain("Protosynthesis boosts");
    expect(room.assumptions).toContain("The attacker Flutter Mane's Booster Energy is not used: it entered under Magic Room.");
    const gas = row(sv, "moonblast", flutter, build(sv, "weezinggalar", { ability: "neutralizinggas", evs: { hp: 252 } }));
    expect(gas.assumptions.join(" ")).not.toContain("Protosynthesis boosts");
  });
});

describe("review follow-ups for Paradox holders, Tera forms and entry boosts", () => {
  // Real pinned-Showdown battles, both Pokémon leading (audit fix32/review r16.ts, v-knock-dlc.ts,
  // v-seed-order.ts, v-intrepid-foulplay.ts, v-starstorm-spread.ts, v-tpg-hp.ts, v-ng-notes.ts,
  // v-sturdy-ogerpon.ts).
  it("boosts Knock Off into a kept Booster Energy that is not the holder's own Paradox item", () => {
    const meowscarada = build(sv, "meowscarada");
    expect(range(row(sv, "knockoff", meowscarada, build(sv, "gougingfire", { ability: "protosynthesis", item: "boosterenergy" }), { weather: "Sun" }))).toBe("40-48");
    expect(range(row(sv, "knockoff", meowscarada, build(sv, "ironboulder", { ability: "quarkdrive", item: "boosterenergy" }), { terrain: "Electric" }))).toBe("144-170");
    expect(range(row(sv, "knockoff", meowscarada, build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy" }), { weather: "Sun" }))).toBe("64-76");
  });

  it("activates before the holder's Seed when the foe's ability sets the field at a shared lead", () => {
    const hands = build(sv, "ironhands", { ability: "quarkdrive", item: "electricseed" });
    const notes = (foeAbility: string) => row(sv, "drainpunch", hands, build(sv, "pincurchin", { ability: foeAbility }), { terrain: "Electric" }).assumptions.join(" ");
    expect(notes("electricsurge")).toContain("Quark Drive boosts its Attack (its highest stat before its Seed)");
    expect(notes("electricsurge")).toContain("The attacker Iron Hands's Quark Drive activated before its Electric Seed was used (assumes both entered together and the other Pokémon's Electric Surge set Electric Terrain first).");
    // Terrain already up when it enters: the Seed's Defense rise comes first.
    expect(notes("lightningrod")).toContain("Quark Drive boosts its Defense (its highest stat)");
  });

  it("shows the target's Intrepid Sword choice for Foul Play", () => {
    const zacian = build(sv, "zaciancrowned", { item: "rustedsword" });
    const on = row(sv, "foulplay", build(sv, "umbreon"), zacian);
    expect(range(on)).toBe("51-60");
    expect(on.assumptions).toContain("Target: Intrepid Sword has raised Attack — yes.");
    expect(range(row(sv, "foulplay", build(sv, "umbreon"), { ...zacian, abilityActive: false }))).toBe("33-40");
  });

  it("hits one foe with Tera Starstorm when multiple targets is unticked in Doubles", () => {
    const special = build(sv, "terapagos", { evs: { spa: 252 }, tera: "Stellar" });
    const amoonguss = build(sv, "amoonguss");
    expect(range(row(sv, "terastarstorm", special, amoonguss, { gameType: "Doubles", multipleTargets: false }))).toBe("100-118");
    expect(range(row(sv, "terastarstorm", special, amoonguss, { gameType: "Doubles", multipleTargets: true }))).toBe("74-88");
    const physical = build(sv, "terapagos", { evs: { atk: 252 }, nature: "Adamant", tera: "Stellar" });
    expect(range(row(sv, "terastarstorm", physical, amoonguss, { gameType: "Doubles", multipleTargets: false }))).toBe("103-122");
  });

  it("gives Terapagos the HP of the form it battles as", () => {
    const terapagos = build(sv, "terapagos");
    expect(getBuildStats(terapagos, sv)?.hp).toBe(170);
    expect(getBuildStats(build(sv, "terapagos", { tera: "Stellar" }), sv)?.hp).toBe(235);
    expect(validateBuild({ ...terapagos, currentHP: 200 }, sv)).toContainEqual(expect.objectContaining({ field: "currentHP" }));
    expect(validateBuild({ ...build(sv, "terapagos", { tera: "Stellar" }), currentHP: 200 }, sv)).toEqual([]);
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(sv, "earthquake", garchomp, { ...terapagos, currentHP: 165 }))).toBe("87-103");
  });

  it("words the Tera form notes for Neutralizing Gas", () => {
    const gas = build(sv, "weezinggalar", { ability: "neutralizinggas" });
    const stellar = row(sv, "weatherball", build(sv, "terapagos", { tera: "Stellar" }), gas, { weather: "Sun" });
    expect(stellar.assumptions).toContain("Terastallization: the attacker Terapagos is Terapagos-Stellar; Teraform Zero is suppressed by Neutralizing Gas.");
    const sunny = row(sv, "weatherball", build(sv, "terapagos", { tera: "Stellar" }), build(sv, "weezinggalar", { ability: "levitate" }), { weather: "Sun" });
    expect(sunny.assumptions).toContain("Terastallization: the attacker Terapagos is Terapagos-Stellar; Teraform Zero cleared the weather and terrain (assumes the set weather and terrain returned after).");
    const shell = row(sv, "sludgebomb", gas, build(sv, "terapagos"));
    expect(shell.assumptions).toContain("Tera Shift: the target Terapagos is Terapagos-Terastal; Tera Shell is suppressed by Neutralizing Gas.");
    const ogerpon = row(sv, "ivycudgel", build(sv, "ogerponhearthflame", { item: "hearthflamemask", tera: "Fire" }), gas);
    expect(ogerpon.assumptions).toContain("Terastallization: the attacker Ogerpon-Hearthflame is Ogerpon-Hearthflame-Tera; Embody Aspect (Hearthflame) is suppressed by Neutralizing Gas.");
  });

  it("previews remaining HP for a Tera'd Ogerpon-Cornerstone, whose Embody Aspect replaces Sturdy", () => {
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 } });
    const plain = build(sv, "ogerponcornerstone", { item: "cornerstonemask" });
    // 100–118 cannot knock out its 155 HP, so its Sturdy never acts; the exact first use previews it.
    const plainHit = row(sv, "earthquake", garchomp, plain);
    expect(range(plainHit)).toBe("100-118");
    expect(previewRemainingHP(plain, plainHit, "average", sv)).toMatchObject({ status: "ready", min: 37, max: 55, remaining: 46 });
    expect(previewRemainingHP(plain, { ...plainHit, afterUse: undefined }, "average", sv)).toMatchObject({ status: "unavailable" });
    const tera = build(sv, "ogerponcornerstone", { item: "cornerstonemask", tera: "Rock" });
    const hit = row(sv, "earthquake", garchomp, tera);
    expect(range(hit)).toBe("134-158");
    expect(previewRemainingHP(tera, hit, "average", sv)).toMatchObject({ status: "ready" });
  });
});

describe("Booster Energy and a later Magic Room", () => {
  // Pinned Showdown uses Booster Energy at once on entry; a Magic Room set afterwards suppresses the
  // held items but does not end the boost (audit fix32/review/v-mr-order.ts, real battles).
  it("keeps the boost by default, with the Booster Energy used up, and asks only under Magic Room", () => {
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    expect(flutter.itemUsedBeforeRoom).toBeUndefined();
    const snorlax = build(sv, "snorlax");
    const later = row(sv, "moonblast", flutter, snorlax, { magicRoom: true });
    expect(range(later)).toBe("84-99");
    expect(later.assumptions).toContain("The attacker Flutter Mane's Protosynthesis boosts its Sp. Atk (its highest stat), from its Booster Energy (used up before Magic Room). Assumes no stage changes since it activated.");
    expect(range(row(sv, "moonblast", { ...flutter, itemUsedBeforeRoom: false }, snorlax, { magicRoom: true }))).toBe("64-76");
    // The room still suppresses the other Pokémon's Assault Vest.
    expect(range(row(sv, "moonblast", flutter, build(sv, "snorlax", { item: "assaultvest" }), { magicRoom: true }))).toBe("84-99");
    // Knock Off keeps its boost into a held Eviolite, whose Defense boost the room suppresses.
    const tusk = build(sv, "greattusk", { ability: "protosynthesis", item: "boosterenergy", evs: { atk: 252 } });
    const dusclops = build(sv, "dusclops", { item: "eviolite" });
    expect(range(row(sv, "knockoff", tusk, dusclops, { magicRoom: true }))).toBe("116-138");
    expect(range(row(sv, "knockoff", { ...tusk, itemUsedBeforeRoom: false }, dusclops, { magicRoom: true }))).toBe("90-108");
    // A used-up Booster Energy leaves Acrobatics itemless; an unused one is still held.
    const jugulis = build(sv, "ironjugulis", { ability: "quarkdrive", item: "boosterenergy" });
    expect(range(row(sv, "acrobatics", jugulis, snorlax, { magicRoom: true }))).toBe("73-87");
    expect(range(row(sv, "acrobatics", { ...jugulis, itemUsedBeforeRoom: false }, snorlax, { magicRoom: true }))).toBe("37-45");
    const panel = (field: Partial<BattleConditions>, value = flutter, other = snorlax) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: value, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, runtime: sv,
      roomItemChoice: roomItemChoice(value, other, { ...createConditions(), ...field }),
    }));
    expect(panel({ magicRoom: true })).toContain("Its Booster Energy was used on entry, before Magic Room was set");
    expect(panel({})).not.toContain("before Magic Room was set");
    expect(panel({ magicRoom: true }, { ...flutter, itemId: "" })).not.toContain("before Magic Room was set");
    // Where the switch would change nothing it is not offered: its own field is up (the Booster Energy
    // was never needed), or the other Pokémon's Neutralizing Gas stops the ability.
    expect(panel({ magicRoom: true, weather: "Sun" })).not.toContain("before Magic Room was set");
    expect(panel({ magicRoom: true, weather: "Sun" }, flutter, build(sv, "golduck", { ability: "cloudnine" }))).toContain("before Magic Room was set");
    expect(panel({ magicRoom: true }, flutter, build(sv, "weezinggalar", { ability: "neutralizinggas" }))).not.toContain("before Magic Room was set");
    expect(roomItemChoice(jugulis, snorlax, { ...createConditions(), magicRoom: true, terrain: "Electric" })).toBeNull();
    expect(roomItemChoice(jugulis, snorlax, { ...createConditions(), magicRoom: true, weather: "Sun" })).toBe("boosterenergy");
  });
});

describe("Intrepid Sword and Dauntless Shield in Scarlet/Violet", () => {
  it("boost on the first entry by default, with a switch for later entries", () => {
    const zacian = build(sv, "zaciancrowned", { item: "rustedsword", evs: { atk: 252 }, nature: "Adamant" });
    expect(zacian.abilityActive).toBe(true);
    const incineroar = build(sv, "incineroar", { evs: { hp: 252 } });
    expect(range(row(sv, "behemothblade", zacian, incineroar))).toBe("85-101");
    expect(range(row(sv, "behemothblade", { ...zacian, abilityActive: false }, incineroar))).toBe("57-67");
    expect(range(row(sv, "earthquake", build(sv, "garchomp", { evs: { atk: 252 }, nature: "Jolly" }), build(sv, "zamazentacrowned", { item: "rustedshield", evs: { hp: 252 } })))).toBe("86-104");
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build: zacian, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, runtime: sv }));
    expect(html).toContain("Intrepid Sword has raised Attack");
  });

  it("has no switch in Sword/Shield, which raises them on every entry", () => {
    const zacian = build(swsh, "zaciancrowned", { item: "rustedsword", evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(swsh, "behemothblade", zacian, build(swsh, "incineroar", { evs: { hp: 252 } })))).toBe("93-111");
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build: zacian, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, runtime: swsh }));
    expect(html).not.toContain("Intrepid Sword has raised Attack");
  });
});

describe("Ogerpon's and Terapagos's Tera forms", () => {
  const evs = { atk: 252, spe: 252, hp: 4 };
  it.each([
    ["ogerponhearthflame", "hearthflamemask", "Fire", "568-672", "Ogerpon-Hearthflame-Tera", "Attack"],
    ["ogerponwellspring", "wellspringmask", "Water", "95-112", "Ogerpon-Wellspring-Tera", "Sp. Def"],
    ["ogerponcornerstone", "cornerstonemask", "Rock", "190-224", "Ogerpon-Cornerstone-Tera", "Defense"],
    ["ogerpon", "", "Grass", "39-47", "Ogerpon-Teal-Tera", "Speed"],
  ])("Terastallizes %s into its Tera form with Embody Aspect", (id, item, tera, damage, form, stat) => {
    const ogerpon = build(sv, id, { item, nature: "Adamant", evs, tera });
    const cudgel = row(sv, "ivycudgel", ogerpon, build(sv, "amoonguss", { evs: { hp: 252 } }));
    expect(range(cudgel)).toBe(damage);
    expect(cudgel.assumptions.join(" ")).toContain(`is ${form}; Embody Aspect`);
    expect(cudgel.assumptions.join(" ")).toContain(`gives +1 ${stat}.`);
  });

  it("defends as the Tera form and needs Terastallization for a Tera-only form", () => {
    const hearthflame = build(sv, "ogerponhearthflame", { item: "hearthflamemask", evs: { hp: 252 }, tera: "Fire" });
    expect(range(row(sv, "earthquake", build(sv, "garchomp", { evs: { atk: 252, spa: 252 } }), hearthflame))).toBe("200-236");
    const direct = build(sv, "ogerponhearthflametera", { item: "hearthflamemask" });
    expect(validateBuild(direct, sv)).toContainEqual({ field: "mechanic", message: "Ogerpon-Hearthflame-Tera exists only while Terastallized." });
    expect(validateBuild({ ...direct, mechanic: "tera", configuration: { ...direct.configuration, teraType: "Fire" } } as BattleBuild, sv)).toEqual([]);
  });

  it("makes Terapagos Terastal on entry and Stellar when Terastallized, whose boost is never used up", () => {
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 } });
    const intoShell = row(sv, "earthquake", garchomp, build(sv, "terapagos"));
    expect(range(intoShell)).toBe("39-47");
    expect(intoShell.assumptions).toContain("Tera Shift: the target Terapagos is Terapagos-Terastal, with Tera Shell.");
    const stellar = build(sv, "terapagos", { evs: { spa: 252 }, tera: "Stellar" });
    const starstorm = row(sv, "terastarstorm", stellar, build(sv, "amoonguss"));
    expect(starstorm).toMatchObject({ kind: "calculated", min: 100, max: 118, effectiveType: "Stellar" });
    expect(starstorm.assumptions).toContain("Terapagos-Stellar: Stellar boost on every use.");
    const doubles = calculateMatchup(stellar, build(sv, "amoonguss"), { ...createConditions(), gameType: "Doubles" }, {}, sv).results.find((result) => result.moveId === "terastarstorm")!;
    expect(range(doubles)).toBe("74-88");
    expect(range(row(sv, "rapidspin", build(sv, "terapagos", { evs: { atk: 252 }, tera: "Stellar" }), build(sv, "amoonguss")))).not.toBe("null-null");
    expect(range(row(sv, "earthquake", garchomp, build(sv, "terapagos", { tera: "Stellar" })))).toBe("79-94");
    expect(validateBuild(build(sv, "terapagosstellar"), sv)).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("exists only while Terastallized") }));
  });
});
