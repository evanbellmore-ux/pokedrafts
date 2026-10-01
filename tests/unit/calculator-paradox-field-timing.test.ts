import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { applyIntimidate } from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, fieldItemChoice, fieldItemLabel, roomItemChoice } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, StatTable } from "@/app/lib/battle/types";

/**
 * Protosynthesis and Quark Drive with a sun or Electric Terrain that started after the holder entered
 * (the build's itemUsedBeforeField). Pinned Showdown c23d2e94: when the terrain or weather changes,
 * each Pokémon's ability runs before its item (runEvent subOrder: ability 7, item 8), so Quark Drive
 * picks its stat before an Electric Seed it has not used yet; Booster Energy acts only on entry while
 * its field is down, so with the field up it is used up only when the field started later. Level 50,
 * 31 IVs, no EVs and Serious unless stated, Singles. Every number is from real pinned-Showdown battles
 * that set the field with moves and switch-ins (audit gaps/terrain-later/v1.ts and v2.ts).
 */
let sv: BattleRuntime;
beforeAll(async () => {
  sv = await loadBattleRuntime("scarlet_violet");
});
type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; first?: boolean };
function build(id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, sv);
  if (base.game === "champions") throw new Error("native builds only");
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.first !== undefined ? { itemUsedBeforeField: spec.first } : {}),
    native: { ...base.native, evs: { ...zero, ...spec.evs } },
  } as BattleBuild;
}
const first = (value: BattleBuild, used: boolean): BattleBuild => ({ ...value, itemUsedBeforeField: used });
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, sv);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;
const electric = { terrain: "Electric" } as const;
const sun = { weather: "Sun" } as const;

describe("Quark Drive and an Electric Seed", () => {
  it("picks its stat before the Seed when Electric Terrain started after it entered", () => {
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed" });
    const pincurchin = build("pincurchin", { ability: "lightningrod" });
    // Pincurchin's Electric Terrain, then Iron Hands switches in: the Seed first, Quark Drive takes Defense.
    const lead = row("drainpunch", hands, pincurchin, electric);
    expect(range(lead)).toBe("58-70");
    expect(lead.assumptions).toContain("The attacker Iron Hands's Electric Seed was used before Quark Drive activated (assumes Electric Terrain was up when it entered).");
    // Iron Hands out first, then Pincurchin's Electric Terrain: Quark Drive takes Attack, then the Seed.
    const later = row("drainpunch", first(hands, false), pincurchin, electric);
    expect(range(later)).toBe("76-91");
    expect(later.assumptions).toContain("The attacker Iron Hands's Quark Drive boosts its Attack (its highest stat before its Seed), on Electric Terrain. Assumes no stage changes since it activated, other than its item's.");
    expect(later.assumptions).toContain("The attacker Iron Hands's Quark Drive activated before its Electric Seed was used.");
    // As the target: Garchomp's Electric Terrain then Iron Hands switches in, or Iron Hands's own Electric Terrain.
    const garchomp = build("garchomp");
    expect(range(row("dragonclaw", garchomp, hands, electric))).toBe("28-34");
    expect(range(row("dragonclaw", garchomp, first(hands, false), electric))).toBe("36-43");
    // Magic Room set after both: the Seed was still used after Quark Drive picked.
    expect(range(row("drainpunch", first(hands, false), pincurchin, { ...electric, magicRoom: true }))).toBe("76-91");
  });

  it("covers a partner's Electric Surge in Doubles, as they lead or when it switches in later", () => {
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed" });
    const snorlax = build("snorlax", { ability: "thickfat" });
    expect(range(row("drainpunch", hands, snorlax, { ...electric, gameType: "Doubles" }))).toBe("162-192");
    expect(range(row("drainpunch", first(hands, false), snorlax, { ...electric, gameType: "Doubles" }))).toBe("206-246");
  });

  it("keeps the foe's Electric Surge default and lets a holder that switched in later take the Seed first", () => {
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed" });
    const surge = build("pincurchin", { ability: "electricsurge" });
    // Both lead, or Pincurchin switches in later: Quark Drive first.
    expect(range(row("drainpunch", hands, surge, electric))).toBe("76-91");
    expect(range(row("drainpunch", first(hands, false), surge, electric))).toBe("76-91");
    // Iron Hands switches in after the terrain is up.
    expect(range(row("drainpunch", first(hands, true), surge, electric))).toBe("58-70");
  });

  it("counts an Intimidate drop from the lead in the later pick", () => {
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed", nature: "Adamant", evs: { atk: 252 } });
    const incineroar = build("incineroar", { ability: "intimidate" });
    const dropped = applyIntimidate(incineroar, hands, { magicRoom: false, terrain: "Electric", gameType: "Singles" }, sv).target;
    expect(dropped.boosts.atk).toBe(-1);
    expect(range(row("drainpunch", first(dropped, false), incineroar, electric))).toBe("140-168");
  });
});

describe("Booster Energy with its field up", () => {
  it("is used up on entry when the field started later, and still held otherwise", () => {
    const bundle = build("ironbundle", { ability: "quarkdrive", item: "boosterenergy" });
    const pincurchin = build("pincurchin", { ability: "lightningrod" });
    const held = row("acrobatics", bundle, pincurchin, electric);
    expect(range(held)).toBe("9-11");
    expect(held.assumptions).toContain("The attacker Iron Bundle's Booster Energy is still held (assumes Electric Terrain has been up since it entered).");
    const used = row("acrobatics", first(bundle, true), pincurchin, electric);
    expect(range(used)).toBe("18-22");
    expect(used.assumptions).toContain("The attacker Iron Bundle's Quark Drive boosts its Speed (its highest stat), from its Booster Energy (used up while Electric Terrain was down). Assumes no stage changes since it activated.");
    // The foe's Electric Surge: both lead (held) or it switched in later (used).
    const surge = build("pincurchin", { ability: "electricsurge" });
    expect(range(row("acrobatics", bundle, surge, electric))).toBe("9-11");
    expect(range(row("acrobatics", first(bundle, true), surge, electric))).toBe("18-22");
    // A partner's Electric Surge in Doubles: both lead (held) or it switched in later (used).
    const snorlax = build("snorlax", { ability: "thickfat" });
    expect(range(row("acrobatics", bundle, snorlax, { ...electric, gameType: "Doubles" }))).toBe("25-30");
    expect(range(row("acrobatics", first(bundle, true), snorlax, { ...electric, gameType: "Doubles" }))).toBe("49-58");
    // Magic Room up when it entered keeps it held; set after a Booster entry, it was used.
    expect(range(row("acrobatics", bundle, pincurchin, { ...electric, magicRoom: true }))).toBe("9-11");
    expect(range(row("acrobatics", first(bundle, true), pincurchin, { ...electric, magicRoom: true }))).toBe("18-22");
  });

  it("changes Knock Off, Poltergeist and Acrobatics for Protosynthesis and Quark Drive", () => {
    const weavile = build("weavile", { ability: "pressure" });
    const crown = build("ironcrown", { ability: "quarkdrive", item: "boosterenergy" });
    expect(range(row("knockoff", weavile, crown, electric))).toBe("128-152");
    expect(range(row("knockoff", weavile, first(crown, true), electric))).toBe("86-104");
    const bolt = build("ragingbolt", { ability: "protosynthesis", item: "boosterenergy" });
    expect(range(row("knockoff", weavile, bolt, sun))).toBe("69-82");
    expect(range(row("knockoff", weavile, first(bolt, true), sun))).toBe("48-57");
    const polteageist = build("polteageist", { ability: "cursedbody" });
    const flutter = build("fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    expect(range(row("poltergeist", polteageist, flutter, sun))).toBe("140-168");
    expect(row("poltergeist", polteageist, first(flutter, true), sun)).toMatchObject({ min: 0, max: 0 });
    const moon = build("roaringmoon", { ability: "protosynthesis", item: "boosterenergy" });
    const drought = build("torkoal", { ability: "drought" });
    expect(range(row("acrobatics", moon, drought, sun))).toBe("28-33");
    expect(range(row("acrobatics", first(moon, true), drought, sun))).toBe("54-64");
    expect(range(row("acrobatics", first(moon, true), build("torkoal", { ability: "shellarmor" }), sun))).toBe("54-64");
  });

  it("keeps the stat it picked on entry after the lead's Intimidate", () => {
    const valiant = build("ironvaliant", { ability: "quarkdrive", item: "boosterenergy" });
    const incineroar = build("incineroar", { ability: "intimidate" });
    const dropped = applyIntimidate(incineroar, valiant, { magicRoom: false, terrain: "Electric", gameType: "Singles" }, sv).target;
    const hit = row("moonblast", first(dropped, true), incineroar, electric);
    expect(range(hit)).toBe("90-106");
    expect(hit.assumptions.join(" ")).toContain("Quark Drive boosts its Sp. Atk (its highest stat), from its Booster Energy");
  });
});

describe("Protosynthesis and a terrain Seed", () => {
  it("counts the Seed only when it was used before the sun activated Protosynthesis", () => {
    // Great Tusk's Attack and Defense tie at 151: the Seed's Defense rise decides.
    const tusk = build("greattusk", { ability: "protosynthesis", item: "electricseed" });
    const pincurchin = build("pincurchin", { ability: "lightningrod" });
    const both = { ...electric, ...sun };
    // Terrain before the sun (at entry, or both after it): the Seed first.
    const seedFirst = row("closecombat", tusk, pincurchin, both);
    expect(range(seedFirst)).toBe("90-106");
    expect(seedFirst.assumptions).toContain("The attacker Great Tusk's Electric Seed was used before Protosynthesis activated (assumes Electric Terrain was up before the sun started, or both were up when it entered).");
    // The sun before the terrain: Protosynthesis first.
    expect(range(row("closecombat", first(tusk, false), pincurchin, both))).toBe("115-136");
    // The foe's Drought: replacements for fainted Pokémon enter together (Protosynthesis first);
    // Great Tusk out first, or switched in first in the same turn, used its Seed first.
    const drought = build("torkoal", { ability: "drought" });
    expect(range(row("closecombat", tusk, drought, both))).toBe("84-99");
    expect(range(row("closecombat", first(tusk, true), drought, both))).toBe("64-76");
  });
});

describe("Room Service and Quark Drive", () => {
  it("counts Room Service only when it lowered Speed before the terrain activated Quark Drive", () => {
    const bundle = build("ironbundle", { ability: "quarkdrive", item: "roomservice", nature: "Timid", evs: { spe: 252 } });
    const field = { ...electric, trickRoom: true };
    const surge = build("pincurchin", { ability: "electricsurge" });
    // Replacements for fainted Pokémon enter together: Electric Surge first.
    expect(range(row("hydropump", bundle, surge, field))).toBe("85-102");
    // Trick Room up when Iron Bundle entered and Pincurchin came in later (or switched in after it).
    expect(range(row("hydropump", first(bundle, true), surge, field))).toBe("111-132");
    const pincurchin = build("pincurchin", { ability: "lightningrod" });
    expect(range(row("hydropump", bundle, pincurchin, field))).toBe("111-132");
    // On the terrain first, Trick Room later: Quark Drive keeps Speed.
    expect(range(row("hydropump", first(bundle, false), pincurchin, field))).toBe("85-102");
  });
});

describe("the field timing switch", () => {
  const conditions = (field: Partial<BattleConditions>) => ({ ...createConditions(), ...field });
  it("is offered only when the order changes the result, with the default's state", () => {
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed" });
    const snorlax = build("snorlax");
    const surge = build("pincurchin", { ability: "electricsurge" });
    expect(fieldItemChoice(hands, snorlax, conditions(electric), sv)).toEqual({ itemId: "electricseed", abilityId: "quarkdrive", field: "terrain", checked: true });
    expect(fieldItemChoice(hands, surge, conditions(electric), sv)?.checked).toBe(false);
    expect(fieldItemChoice(first(hands, true), surge, conditions(electric), sv)?.checked).toBe(true);
    expect(fieldItemChoice(hands, snorlax, conditions({}), sv)).toBeNull();
    expect(fieldItemChoice(hands, build("weezinggalar", { ability: "neutralizinggas" }), conditions(electric), sv)).toBeNull();
    // A Seed Magic Room held back is never used.
    expect(fieldItemChoice({ ...hands, itemUsedBeforeRoom: false }, snorlax, conditions({ ...electric, magicRoom: true }), sv)).toBeNull();
    // Iron Moth's Sp. Atk stays highest either way, unless a choice was already made.
    const mothSeed = build("ironmoth", { ability: "quarkdrive", item: "electricseed" });
    expect(fieldItemChoice(mothSeed, snorlax, conditions(electric), sv)).toBeNull();
    expect(fieldItemChoice(first(mothSeed, false), snorlax, conditions(electric), sv)?.checked).toBe(false);
    // Booster Energy: offered whenever its field is up; the Magic Room switch is not.
    const bundle = build("ironbundle", { ability: "quarkdrive", item: "boosterenergy" });
    expect(fieldItemChoice(bundle, snorlax, conditions(electric), sv)?.checked).toBe(false);
    expect(fieldItemChoice(first(bundle, true), snorlax, conditions({ ...electric, magicRoom: true }), sv)?.checked).toBe(true);
    expect(roomItemChoice(first(bundle, true), snorlax, conditions({ ...electric, magicRoom: true }))).toBeNull();
    const flutter = build("fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    expect(fieldItemChoice(flutter, snorlax, conditions(sun), sv)?.field).toBe("sun");
    // The other Pokémon's Cloud Nine: whether the Booster Energy or the sun activated Protosynthesis.
    expect(fieldItemChoice(flutter, build("golduck", { ability: "cloudnine" }), conditions(sun), sv)).toMatchObject({ itemId: "boosterenergy", suppressor: "cloudnine", checked: true });
    expect(fieldItemChoice(first(flutter, false), build("golduck", { ability: "cloudnine" }), conditions(sun), sv)?.checked).toBe(false);
    // The outcome stays after a Magic Room is set or the sun ends; one that met the room on entry never acts.
    expect(fieldItemChoice(flutter, build("golduck", { ability: "cloudnine" }), conditions({ ...sun, magicRoom: true }), sv)).toMatchObject({ suppressor: "cloudnine" });
    expect(fieldItemChoice(flutter, build("golduck", { ability: "cloudnine" }), conditions(electric), sv)).toMatchObject({ suppressor: "cloudnine" });
    expect(fieldItemChoice({ ...flutter, itemUsedBeforeRoom: false }, build("golduck", { ability: "cloudnine" }), conditions({ ...sun, magicRoom: true }), sv)).toBeNull();
    // Room Service only under Trick Room.
    const service = build("ironbundle", { ability: "quarkdrive", item: "roomservice", nature: "Timid", evs: { spe: 252 } });
    expect(fieldItemChoice(service, surge, conditions({ ...electric, trickRoom: true }), sv)?.checked).toBe(false);
    expect(fieldItemChoice(service, surge, conditions(electric), sv)).toBeNull();
  });

  it("labels each item and renders under Held item", () => {
    const choice = (itemId: string, abilityId: "protosynthesis" | "quarkdrive", field: "sun" | "terrain") => ({ itemId, abilityId, field, checked: false });
    expect(fieldItemLabel(choice("electricseed", "quarkdrive", "terrain"), sv)).toBe("Its Electric Seed was used before Quark Drive activated");
    expect(fieldItemLabel(choice("roomservice", "quarkdrive", "terrain"), sv)).toBe("Its Room Service was used before Quark Drive activated");
    expect(fieldItemLabel(choice("boosterenergy", "quarkdrive", "terrain"), sv)).toBe("Its Booster Energy was used while Electric Terrain was down");
    expect(fieldItemLabel(choice("boosterenergy", "protosynthesis", "sun"), sv)).toBe("Its Booster Energy was used while the sun was down");
    const hands = build("ironhands", { ability: "quarkdrive", item: "electricseed" });
    const panel = (value: BattleBuild, fieldChoice: ReturnType<typeof fieldItemChoice>) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: value, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, runtime: sv, fieldItemChoice: fieldChoice,
    }));
    const on = panel(hands, fieldItemChoice(hands, build("snorlax"), conditions(electric), sv));
    expect(on).toContain("Its Electric Seed was used before Quark Drive activated");
    expect(on).toMatch(/id="[^"]*-field-item"[^>]*checked/);
    expect(panel(hands, fieldItemChoice(hands, build("pincurchin", { ability: "electricsurge" }), conditions(electric), sv))).not.toMatch(/id="[^"]*-field-item"[^>]*checked/);
    expect(panel(hands, null)).not.toContain("was used before Quark Drive activated");
  });
});

describe("Booster Energy and Room Service timelines", () => {
  const conditions = (field: Partial<BattleConditions>) => ({ ...createConditions(), ...field });
  // Real pinned-Showdown battles from the review (gaps/review/field-item-timing/verify f3.ts, f4.ts, f5.ts).
  it("uses up the Booster Energy with no effect when Cloud Nine or Air Lock comes in after the sun activated Protosynthesis", () => {
    const moon = build("roaringmoon", { ability: "protosynthesis", item: "boosterenergy" });
    const golduck = build("golduck", { ability: "cloudnine" });
    // Cloud Nine already out as it entered: the Booster Energy activates Protosynthesis.
    const boosted = row("acrobatics", moon, golduck, sun);
    expect(range(boosted)).toBe("88-104");
    expect(boosted.assumptions).toContain("Assumes the other Pokémon's Cloud Nine was out when Roaring Moon entered, or the sun was down at some point since.");
    // Golduck switched in after the sun: no item and no boost.
    const burned = row("acrobatics", first(moon, false), golduck, sun);
    expect(range(burned)).toBe("68-80");
    expect(burned.assumptions).toContain("The attacker Roaring Moon's Protosynthesis is not active: the sun activated it before the other Pokémon's Cloud Nine came in, and its Booster Energy was used up.");
    expect(range(row("acrobatics", first(moon, false), build("rayquaza"), sun))).toBe("60-71");
    // The same after a Magic Room is set afterwards, or after the sun ends (gaps/review2/field-items-hp-ivs c1.ts, c5.ts).
    expect(range(row("acrobatics", first(moon, false), golduck, { ...sun, magicRoom: true }))).toBe("68-80");
    expect(range(row("acrobatics", first(moon, false), build("rayquaza"), { ...sun, magicRoom: true }))).toBe("60-71");
    expect(range(row("acrobatics", first(moon, false), golduck))).toBe("68-80");
    expect(range(row("acrobatics", moon, golduck))).toBe("88-104");
  });

  it("never uses a Booster Energy that met Magic Room on entry, and shows that unticked under the field switch", () => {
    const bundle = { ...build("ironbundle", { ability: "quarkdrive", item: "boosterenergy" }), itemUsedBeforeRoom: false, itemUsedBeforeField: true };
    const pincurchin = build("pincurchin", { ability: "lightningrod" });
    const held = row("acrobatics", bundle, pincurchin, { ...electric, magicRoom: true });
    expect(range(held)).toBe("9-11");
    expect(held.assumptions).toContain("The attacker Iron Bundle's Booster Energy is still held: it entered under Magic Room.");
    expect(fieldItemChoice(bundle, pincurchin, conditions({ ...electric, magicRoom: true }), sv)).toMatchObject({ itemId: "boosterenergy", checked: false });
    expect(roomItemChoice(bundle, pincurchin, conditions({ ...electric, magicRoom: true }))).toBeNull();
    // Ticking the field switch also clears the room's hold (PokemonPanel), so the Booster Energy is used.
    expect(range(row("acrobatics", { ...bundle, itemUsedBeforeRoom: undefined }, pincurchin, { ...electric, magicRoom: true }))).toBe("18-22");
  });

  it("says when Room Service lowered its Speed after Quark Drive picked it", () => {
    const service = build("ironbundle", { ability: "quarkdrive", item: "roomservice", nature: "Timid", evs: { spe: 252 } });
    const later = row("hydropump", first(service, false), build("pincurchin", { ability: "lightningrod" }), { ...electric, trickRoom: true });
    expect(range(later)).toBe("85-102");
    expect(later.assumptions).toContain("The attacker Iron Bundle's Quark Drive boosts its Speed (its highest stat before Room Service), on Electric Terrain. Assumes no stage changes since it activated, other than its item's.");
  });
});
