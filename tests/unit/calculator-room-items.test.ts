import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { applyIntimidate, entryBoosts } from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { createBuild, createConditions, roomItemChoice, roomItemLabel } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, StatTable } from "@/app/lib/battle/types";

/**
 * Magic Room and items used before it was set: a terrain Seed on its terrain (used on entry, or when
 * the terrain starts) and Booster Energy (used on entry). Pinned Showdown c23d2e94 uses both at once
 * unless the room is already up, and a room set later does not undo them. The build's
 * itemUsedBeforeRoom (unset = used, a lead) chooses the timeline. Level 50, 31 IVs, Serious unless
 * stated, Singles. Every number is from real pinned-Showdown battles: "used" = terrain up, both lead,
 * then Magic Room; "unused" = terrain and Magic Room up before entry (audit oos/mr-seeds/r6.ts).
 */
let sv: BattleRuntime;
let swsh: BattleRuntime;
let usum: BattleRuntime;
const champions = championsRuntime;
beforeAll(async () => {
  sv = await loadBattleRuntime("scarlet_violet");
  swsh = await loadBattleRuntime("sword_shield");
  usum = await loadBattleRuntime("ultra_sun_ultra_moon");
});
type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; unused?: boolean };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.unused ? { itemUsedBeforeRoom: false } : {}),
    ...(base.game === "champions" ? { points: { ...zero, ...spec.evs } } : { native: { ...base.native, evs: { ...zero, ...spec.evs } } }),
  } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", magicRoom: true, ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;
const unused = (value: BattleBuild): BattleBuild => ({ ...value, itemUsedBeforeRoom: false });

describe("a terrain Seed and a later Magic Room", () => {
  it("keeps the Seed's rise by default, with the Seed used up, for each Seed", () => {
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" });
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed", evs: { hp: 252 } });
    const used = row(sv, "dragonclaw", garchomp, amoonguss, { terrain: "Grassy" });
    expect(range(used)).toBe("67-81");
    expect(used.assumptions).toContain("The target Amoonguss's Grassy Seed is used up on Grassy Terrain before Magic Room was set, raising its Defense.");
    const held = row(sv, "dragonclaw", garchomp, unused(amoonguss), { terrain: "Grassy" });
    expect(range(held)).toBe("102-120");
    expect(held.assumptions).toContain("The target Amoonguss's Grassy Seed is not used: Magic Room was up when it entered or when Grassy Terrain started. Tick its Grassy Seed choice if it was used before the room was set.");
    // Without the room the default uses the Seed; an unticked one stayed held when the room ended.
    expect(range(row(sv, "dragonclaw", garchomp, amoonguss, { terrain: "Grassy", magicRoom: false }))).toBe("67-81");
    expect(range(row(sv, "dragonclaw", garchomp, unused(amoonguss), { terrain: "Grassy", magicRoom: false }))).toBe("102-120");
    const tusk = build(sv, "greattusk", { ability: "protosynthesis", evs: { atk: 252 }, nature: "Adamant" });
    const pincurchin = build(sv, "pincurchin", { ability: "lightningrod", item: "electricseed" });
    expect(range(row(sv, "headlongrush", tusk, pincurchin, { terrain: "Electric" }))).toBe("158-188");
    expect(range(row(sv, "headlongrush", tusk, unused(pincurchin), { terrain: "Electric" }))).toBe("236-282");
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", evs: { spa: 252 }, nature: "Modest" });
    const indeedee = build(sv, "indeedee", { ability: "innerfocus", item: "psychicseed" });
    expect(range(row(sv, "moonblast", flutter, indeedee, { terrain: "Psychic" }))).toBe("64-76");
    expect(range(row(sv, "moonblast", flutter, unused(indeedee), { terrain: "Psychic" }))).toBe("96-114");
    const gholdengo = build(sv, "gholdengo", { evs: { spa: 252 }, nature: "Modest" });
    const hatterene = build(sv, "hatterene", { item: "mistyseed", evs: { hp: 252 } });
    expect(range(row(sv, "shadowball", gholdengo, hatterene, { terrain: "Misty" }))).toBe("102-120");
    expect(range(row(sv, "shadowball", gholdengo, unused(hatterene), { terrain: "Misty" }))).toBe("152-180");
    // Wonder Room: the Sp. Def stage stays on Sp. Def.
    const bulky = build(sv, "indeedee", { ability: "innerfocus", item: "psychicseed", evs: { hp: 252, def: 252 } });
    expect(range(row(sv, "moonblast", flutter, bulky, { terrain: "Psychic", wonderRoom: true }))).toBe("69-82");
    expect(range(row(sv, "moonblast", flutter, unused(bulky), { terrain: "Psychic", wonderRoom: true }))).toBe("103-123");
  });

  it("follows the same timeline for a Booster Energy holder and its foe's Seed", () => {
    const tusk = build(sv, "greattusk", { ability: "protosynthesis", item: "boosterenergy", evs: { atk: 252 }, nature: "Adamant" });
    const pincurchin = build(sv, "pincurchin", { ability: "lightningrod", item: "electricseed" });
    expect(range(row(sv, "headlongrush", tusk, pincurchin, { terrain: "Electric" }))).toBe("206-246");
    expect(range(row(sv, "headlongrush", unused(tusk), unused(pincurchin), { terrain: "Electric" }))).toBe("236-282");
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy", evs: { spa: 252 }, nature: "Modest" });
    const indeedee = build(sv, "indeedee", { ability: "innerfocus", item: "psychicseed" });
    expect(range(row(sv, "moonblast", flutter, indeedee, { terrain: "Psychic" }))).toBe("84-99");
    expect(range(row(sv, "moonblast", unused(flutter), unused(indeedee), { terrain: "Psychic" }))).toBe("96-114");
    // The Booster Energy switch is the item timing now, not the ability condition.
    const snorlax = build(sv, "snorlax", { evs: { hp: 252 } });
    expect(range(row(sv, "moonblast", { ...flutter, abilityActive: false }, snorlax))).toBe("109-130");
    expect(range(row(sv, "moonblast", unused(flutter), snorlax))).toBe("84-100");
  });

  it("leaves no held item after a Seed used before the room", () => {
    const snorlax = build(sv, "snorlax", { evs: { hp: 252 } });
    // Acrobatics doubles, and Unburden activates.
    const hawlucha = build(sv, "hawlucha", { ability: "unburden", item: "electricseed", evs: { atk: 252 }, nature: "Adamant" });
    const acrobatics = row(sv, "acrobatics", hawlucha, snorlax, { terrain: "Electric" });
    expect(acrobatics).toMatchObject({ effectivePower: 110, min: 115, max: 136 });
    expect(acrobatics.assumptions).toContain("The attacker Hawlucha's Unburden activates once its Electric Seed is used up, doubling its Speed.");
    expect(row(sv, "acrobatics", unused(hawlucha), snorlax, { terrain: "Electric" })).toMatchObject({ effectivePower: 55, min: 58, max: 69 });
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed", evs: { hp: 252 } });
    // Poltergeist fails; Knock Off has nothing to remove.
    const banette = build(sv, "banette", { evs: { atk: 252 }, nature: "Adamant" });
    expect(row(sv, "poltergeist", banette, amoonguss, { terrain: "Grassy" })).toMatchObject({ min: 0, max: 0 });
    expect(range(row(sv, "poltergeist", banette, unused(amoonguss), { terrain: "Grassy" }))).toBe("127-150");
    const incineroar = build(sv, "incineroar", { ability: "blaze", evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(sv, "knockoff", incineroar, amoonguss, { terrain: "Grassy" }))).toBe("51-60");
    expect(range(row(sv, "knockoff", incineroar, unused(amoonguss), { terrain: "Grassy" }))).toBe("111-132");
    // Body Press uses the raised Defense; Gyro Ball the Unburden Speed.
    const corviknight = build(sv, "corviknight", { item: "electricseed", evs: { def: 252 }, nature: "Impish" });
    expect(range(row(sv, "bodypress", corviknight, snorlax, { terrain: "Electric" }))).toBe("182-216");
    expect(range(row(sv, "bodypress", unused(corviknight), snorlax, { terrain: "Electric" }))).toBe("124-146");
    const bronzong = build(sv, "bronzong", { ability: "levitate", evs: { atk: 252 }, nature: "Brave" });
    const fast = build(sv, "hawlucha", { ability: "unburden", item: "electricseed", evs: { hp: 252, spe: 252 }, nature: "Jolly" });
    expect(range(row(sv, "gyroball", bronzong, fast, { terrain: "Electric" }))).toBe("93-111");
    expect(range(row(sv, "gyroball", bronzong, unused(fast), { terrain: "Electric" }))).toBe("93-109");
  });

  it("follows Contrary, unless Neutralizing Gas suppressed it", () => {
    const malamar = build(sv, "malamar", { ability: "contrary", item: "psychicseed", evs: { hp: 252 } });
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", evs: { spa: 252 }, nature: "Modest" });
    const lowered = row(sv, "moonblast", flutter, malamar, { terrain: "Psychic" });
    expect(range(lowered)).toBe("350-414");
    expect(lowered.assumptions).toContain("The target Malamar's Psychic Seed is used up on Psychic Terrain before Magic Room was set, raising its Sp. Def (lowering it, with Contrary).");
    expect(range(row(sv, "moonblast", flutter, unused(malamar), { terrain: "Psychic" }))).toBe("234-276");
    const weezing = build(sv, "weezinggalar", { ability: "neutralizinggas", evs: { spa: 252 }, nature: "Modest" });
    expect(range(row(sv, "sludgebomb", weezing, malamar, { terrain: "Psychic" }))).toBe("54-64");
    expect(range(row(sv, "sludgebomb", weezing, unused(malamar), { terrain: "Psychic" }))).toBe("81-96");
  });

  it("counts the Seed in Quark Drive's highest stat, except when the foe set the terrain at a shared lead", () => {
    const hands = build(sv, "ironhands", { ability: "quarkdrive", item: "electricseed" });
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(sv, "dragonclaw", garchomp, hands, { terrain: "Electric" }))).toBe("37-45");
    expect(range(row(sv, "dragonclaw", garchomp, unused(hands), { terrain: "Electric" }))).toBe("72-85");
    const snorlax = build(sv, "snorlax", { evs: { hp: 252 } });
    expect(range(row(sv, "drainpunch", hands, snorlax, { terrain: "Electric" }))).toBe("162-192");
    expect(range(row(sv, "drainpunch", unused(hands), snorlax, { terrain: "Electric" }))).toBe("206-246");
    // Electric Surge sets the terrain as both lead: Quark Drive takes Attack, then the Seed raises Defense.
    const pincurchin = build(sv, "pincurchin", { ability: "electricsurge", evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(sv, "zingzap", pincurchin, hands, { terrain: "Electric" }))).toBe("26-31");
  });

  it("applies once with Parental Bond and Seed Sower, in every game with Seeds", () => {
    expect(range(row(swsh, "dragonclaw", build(swsh, "garchomp", { evs: { atk: 252 }, nature: "Adamant" }), build(swsh, "amoonguss", { item: "grassyseed", evs: { hp: 252 } }), { terrain: "Grassy" }))).toBe("67-81");
    const amoonguss = build(usum, "amoonguss", { item: "grassyseed", evs: { hp: 252 } });
    expect(range(row(usum, "dragonclaw", build(usum, "garchomp", { evs: { atk: 252 }, nature: "Adamant" }), amoonguss, { terrain: "Grassy" }))).toBe("67-81");
    const kangaskhan = build(usum, "kangaskhanmega", { item: "kangaskhanite", evs: { atk: 252 }, nature: "Adamant" });
    expect(range(row(usum, "doubleedge", kangaskhan, amoonguss, { terrain: "Grassy" }))).toBe("121-143");
    expect(range(row(usum, "doubleedge", kangaskhan, unused(amoonguss), { terrain: "Grassy" }))).toBe("181-215");
    const snorlax = build(champions, "snorlax", { item: "grassyseed", evs: { hp: 32 } });
    expect(range(row(champions, "dragonclaw", build(champions, "garchomp", { evs: { atk: 32 }, nature: "Adamant" }), snorlax, { terrain: "Grassy" }))).toBe("72-85");
    expect(range(row(champions, "dragonclaw", build(champions, "garchomp", { evs: { atk: 32 }, nature: "Adamant" }), unused(snorlax), { terrain: "Grassy" }))).toBe("106-126");
    const mega = build(champions, "kangaskhanmega", { item: "kangaskhanite", evs: { atk: 32 }, nature: "Adamant" });
    expect(range(row(champions, "doubleedge", mega, snorlax, { terrain: "Grassy" }))).toBe("128-153");
    const arboliva = build(champions, "arboliva", { ability: "seedsower", item: "grassyseed", evs: { hp: 32 } });
    expect(range(row(champions, "doubleedge", mega, arboliva, { terrain: "Grassy" }))).toBe("100-120");
    expect(range(row(champions, "doubleedge", mega, unused(arboliva), { terrain: "Grassy" }))).toBe("150-178");
    const hawlucha = build(champions, "hawlucha", { ability: "unburden", item: "grassyseed", evs: { atk: 32 }, nature: "Adamant" });
    expect(range(row(champions, "acrobatics", hawlucha, build(champions, "snorlax", { evs: { hp: 32 } }), { terrain: "Grassy" }))).toBe("115-136");
  });

  it("keeps a transformed Imposter user's own item timing", () => {
    // Imposter copies the target's build but keeps its own item: and its own switch (audit r8.ts).
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" });
    const ditto = { ...build(sv, "ditto", { ability: "imposter", item: "grassyseed", evs: { hp: 252 } }), abilityActive: true };
    expect(range(row(sv, "dragonclaw", garchomp, ditto, { terrain: "Grassy" }))).toBe("104-126");
    expect(range(row(sv, "dragonclaw", garchomp, unused(ditto), { terrain: "Grassy" }))).toBe("158-188");
    expect(range(row(sv, "dragonclaw", unused(garchomp), ditto, { terrain: "Grassy" }))).toBe("104-126");
  });

  it("never uses a Klutz holder's Seed", () => {
    const golurk = build(sv, "golurk", { ability: "klutz", item: "grassyseed", evs: { hp: 252 } });
    const garchomp = build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" });
    const result = row(sv, "dragonclaw", garchomp, golurk, { terrain: "Grassy" });
    expect(range(result)).toBe("91-108");
    expect(result.assumptions.join(" ")).not.toContain("Grassy Seed");
    expect(roomItemChoice(golurk, garchomp, { ...createConditions(), magicRoom: true, terrain: "Grassy" })).toBeNull();
  });
});

describe("the Magic Room item switch", () => {
  const conditions = (field: Partial<BattleConditions>) => ({ ...createConditions(), ...field });
  it("is offered only when the item's timing changes the result", () => {
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed" });
    const snorlax = build(sv, "snorlax");
    expect(roomItemChoice(amoonguss, snorlax, conditions({ magicRoom: true, terrain: "Grassy" }))).toBe("grassyseed");
    expect(roomItemChoice(amoonguss, snorlax, conditions({ magicRoom: true, terrain: "Psychic" }))).toBeNull();
    expect(roomItemChoice(amoonguss, snorlax, conditions({ terrain: "Grassy" }))).toBeNull();
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    expect(roomItemChoice(flutter, snorlax, conditions({ magicRoom: true }))).toBe("boosterenergy");
    expect(roomItemChoice(flutter, snorlax, conditions({ magicRoom: true, weather: "Sun" }))).toBeNull();
    expect(roomItemChoice(flutter, build(sv, "golduck", { ability: "cloudnine" }), conditions({ magicRoom: true, weather: "Sun" }))).toBe("boosterenergy");
    expect(roomItemChoice(flutter, build(sv, "weezinggalar", { ability: "neutralizinggas" }), conditions({ magicRoom: true }))).toBeNull();
    const jugulis = build(sv, "ironjugulis", { ability: "quarkdrive", item: "boosterenergy" });
    expect(roomItemChoice(jugulis, snorlax, conditions({ magicRoom: true, terrain: "Electric" }))).toBeNull();
    expect(roomItemChoice(jugulis, snorlax, conditions({ magicRoom: true, weather: "Sun" }))).toBe("boosterenergy");
    expect(roomItemLabel("grassyseed", sv)).toBe("Its Grassy Seed was used on Grassy Terrain before Magic Room was set");
    expect(roomItemLabel("boosterenergy", sv)).toBe("Its Booster Energy was used on entry, before Magic Room was set");
  });

  it("renders under Held item, ticked unless the build says otherwise", () => {
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed" });
    const panel = (value: BattleBuild, choice: string | null) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "defender", build: value, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined, runtime: sv, roomItemChoice: choice,
    }));
    const html = panel(amoonguss, "grassyseed");
    expect(html).toContain("Its Grassy Seed was used on Grassy Terrain before Magic Room was set");
    expect(html).toMatch(/id="[^"]*-room-item"[^>]*checked/);
    expect(panel(unused(amoonguss), "grassyseed")).not.toMatch(/id="[^"]*-room-item"[^>]*checked/);
    expect(panel(amoonguss, null)).not.toContain("before Magic Room was set");
    // Protosynthesis has no ability switch of its own any more.
    const flutter = build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy" });
    const booster = panel(flutter, "boosterenergy");
    expect(booster).toContain("Its Booster Energy was used on entry, before Magic Room was set");
    expect(booster).not.toMatch(/id="[^"]*-ability-active"/);
  });
});

describe("Intimidate under Magic Room", () => {
  it("counts a Seed used before the room among the target's entry stages", () => {
    const incineroar = build(sv, "incineroar", { ability: "intimidate" });
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed" });
    const battle = { magicRoom: true, terrain: "Grassy" as const, gameType: "Singles" as const, tailwind: { source: false, target: false } };
    const used = applyIntimidate(incineroar, amoonguss, battle, sv);
    expect(used.lines).toContain("Amoonguss's stages count its Grassy Seed (+1 Defense), which the calculator adds when it calculates, so the stored stages leave it out.");
    expect(used.target.boosts).toMatchObject({ atk: -1, def: 0 });
    const held = applyIntimidate(incineroar, unused(amoonguss), battle, sv);
    expect(held.lines.join(" ")).not.toContain("Grassy Seed");
    expect(held.target).toMatchObject({ itemId: "grassyseed", boosts: { atk: -1, def: 0 } });
  });
});

describe("entry items the engine does not order as Showdown does", () => {
  // Real battles (audit oos/mr-seeds/r3.ts, rerun as r3-after.ts against the app).
  it("uses Room Service under Trick Room, with the same Magic Room timing", () => {
    const incineroar = build(sv, "incineroar", { ability: "blaze", evs: { atk: 252 }, nature: "Adamant" });
    const hatterene = build(sv, "hatterene", { item: "roomservice", evs: { hp: 252 } });
    const noRoom = row(sv, "knockoff", incineroar, hatterene, { magicRoom: false, trickRoom: true });
    expect(range(noRoom)).toBe("58-70");
    expect(noRoom.assumptions).toContain("The target Hatterene's Room Service is used up under Trick Room, lowering its Speed.");
    expect(range(row(sv, "knockoff", incineroar, hatterene, { trickRoom: true }))).toBe("58-70");
    const held = row(sv, "knockoff", incineroar, unused(hatterene), { trickRoom: true });
    expect(range(held)).toBe("87-103");
    expect(held.assumptions).toContain("The target Hatterene's Room Service is not used: Magic Room was up when it entered or when Trick Room started. Tick its Room Service choice if it was used before the room was set.");
    // Without Trick Room it waits (Knock Off still boosted into the held item).
    expect(range(row(sv, "knockoff", incineroar, hatterene, { magicRoom: false }))).toBe("87-103");
    const bronzong = build(sv, "bronzong", { ability: "levitate", evs: { atk: 252 }, nature: "Brave" });
    expect(range(row(sv, "gyroball", bronzong, build(sv, "hatterene", { item: "roomservice", evs: { hp: 252, spe: 252 } }), { magicRoom: false, trickRoom: true }))).toBe("48-56");
    expect(roomItemChoice(hatterene, incineroar, { ...createConditions(), magicRoom: true, trickRoom: true })).toBe("roomservice");
    expect(roomItemChoice(hatterene, incineroar, { ...createConditions(), magicRoom: true })).toBeNull();
    expect(roomItemLabel("roomservice", sv)).toBe("Its Room Service was used under Trick Room before Magic Room was set");
  });

  it("doubles a Seed's rise for Simple (Sword/Shield)", () => {
    const hydreigon = build(swsh, "hydreigon", { evs: { spa: 252 }, nature: "Modest" });
    const swoobat = build(swsh, "swoobat", { ability: "simple", item: "psychicseed", evs: { hp: 252 } });
    const hit = row(swsh, "darkpulse", hydreigon, swoobat, { magicRoom: false, terrain: "Psychic" });
    expect(range(hit)).toBe("116-140");
    expect(hit.assumptions).toContain("The target Swoobat's Psychic Seed is used up on Psychic Terrain, raising its Sp. Def by 2 stages, with Simple.");
  });

  it("lets Download read the foe before its Seed at a shared lead", () => {
    const porygonz = build(sv, "porygonz", { ability: "download", evs: { spa: 252 }, nature: "Modest" });
    const amoonguss = build(sv, "amoonguss", { item: "grassyseed", evs: { hp: 252 } });
    const hit = row(sv, "triattack", porygonz, amoonguss, { magicRoom: false, terrain: "Grassy" });
    expect(range(hit)).toBe("93-111");
    expect(hit.assumptions).toContain("The attacker Porygon-Z's Download read Amoonguss's Defense and Sp. Def before its Grassy Seed was used, raising its Attack. This assumes both entered together; if it entered later, Download counted the Seed's rise.");
  });

  it("counts a Klutz holder's Seed when the foe's Neutralizing Gas suppresses Klutz", () => {
    const golurk = build(sv, "golurk", { ability: "klutz", item: "grassyseed" });
    const battle = { magicRoom: false, wonderRoom: false, terrain: "Grassy" as const, gameType: "Singles" as const };
    expect(entryBoosts(golurk, build(sv, "weezinggalar", { ability: "neutralizinggas" }), null, false, battle, sv).map((entry) => entry.id)).toContain("grassyseed");
    expect(entryBoosts(golurk, build(sv, "garchomp"), null, false, battle, sv)).toEqual([]);
  });
});

describe("entry order and room timing follow-ups", () => {
  // Real battles (audit oos/review/mr5 t9.ts, t12.ts, t12b.ts, t14.ts, t15-unticked.ts).
  it("lowers Room Service's Speed before Quark Drive picks its stat when Trick Room was up at entry", () => {
    const bundle = build(sv, "ironbundle", { ability: "quarkdrive", item: "roomservice", evs: { spe: 252 }, nature: "Timid" });
    const hit = row(sv, "hydropump", bundle, build(sv, "snorlax", { evs: { hp: 252 } }), { magicRoom: false, trickRoom: true, terrain: "Electric" });
    expect(range(hit)).toBe("90-106");
    expect(hit.assumptions).toContain("The attacker Iron Bundle's Room Service lowered its Speed before Quark Drive activated: this assumes Trick Room was up when it entered. If Quark Drive activated first, it raises its Speed: untick its Room Service choice.");
    const treads = build(sv, "irontreads", { ability: "quarkdrive", item: "roomservice", evs: { spe: 252 }, nature: "Jolly" });
    expect(range(row(sv, "dragonclaw", build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" }), treads, { magicRoom: false, trickRoom: true, terrain: "Electric" }))).toBe("25-30");
  });

  it("allows a ticked Unburden with Room Service, which the calculation uses up under Trick Room", () => {
    const hawlucha = { ...build(sv, "hawlucha", { ability: "unburden", item: "roomservice" }), abilityActive: true } as BattleBuild;
    expect(range(row(sv, "gyroball", build(sv, "bronzong", { ability: "levitate", evs: { atk: 252 }, nature: "Brave" }), hawlucha, { magicRoom: false, trickRoom: true }))).toBe("91-108");
  });

  it("keeps an item Magic Room held back held after the room ends", () => {
    const amoonguss = unused(build(sv, "amoonguss", { item: "grassyseed", evs: { hp: 252 } }));
    const held = row(sv, "dragonclaw", build(sv, "garchomp", { evs: { atk: 252 }, nature: "Adamant" }), amoonguss, { magicRoom: false, terrain: "Grassy" });
    expect(range(held)).toBe("102-120");
    expect(held.assumptions).toContain("The target Amoonguss's Grassy Seed is still held: Magic Room was up when it entered or when Grassy Terrain started, and the room ending does not use it. Tick its Grassy Seed choice if it was used.");
    const hatterene = unused(build(sv, "hatterene", { item: "roomservice", evs: { hp: 252 } }));
    expect(range(row(sv, "knockoff", build(sv, "incineroar", { ability: "blaze", evs: { atk: 252 }, nature: "Adamant" }), hatterene, { magicRoom: false, trickRoom: true }))).toBe("87-103");
    // Without the room the switch shows only once unticked, with its own label.
    const noRoom = { ...createConditions(), terrain: "Grassy" as const };
    expect(roomItemChoice(amoonguss, build(sv, "garchomp"), noRoom)).toBe("grassyseed");
    expect(roomItemChoice({ ...amoonguss, itemUsedBeforeRoom: undefined }, build(sv, "garchomp"), noRoom)).toBeNull();
    expect(roomItemLabel("grassyseed", sv, false)).toBe("Its Grassy Seed was used on Grassy Terrain (Magic Room did not hold it back)");
  });

  it("offers no switch when a copied Klutz stops the item anyway", () => {
    const golurk = build(sv, "golurk", { ability: "klutz" });
    const field = { ...createConditions(), magicRoom: true, terrain: "Grassy" as const };
    expect(roomItemChoice(build(sv, "porygon2", { ability: "trace", item: "grassyseed" }), golurk, field)).toBeNull();
    expect(roomItemChoice({ ...build(sv, "ditto", { ability: "imposter", item: "grassyseed" }), abilityActive: true } as BattleBuild, golurk, field)).toBeNull();
    expect(roomItemChoice(build(sv, "porygon2", { ability: "trace", item: "grassyseed" }), build(sv, "garchomp"), field)).toBe("grassyseed");
  });
});

describe("final follow-ups", () => {
  // Real battles (audit oos/final-review booster-end.ts, and oos/review/mr5 t12b.ts for the shared lead).
  it("keeps a Booster Energy that met Magic Room on entry unused after the room ends", () => {
    const flutter = unused(build(sv, "fluttermane", { ability: "protosynthesis", item: "boosterenergy", evs: { spa: 252 }, nature: "Modest" }));
    const hatterene = build(sv, "hatterene", { ability: "magicbounce", evs: { hp: 252 } });
    const held = row(sv, "moonblast", flutter, hatterene, { magicRoom: false });
    expect(range(held)).toBe("90-106");
    expect(held.assumptions).toContain("The attacker Flutter Mane's Booster Energy is still held: it entered while Magic Room was up, and the room ending does not use it. Tick its Booster Energy choice if it was used on entry.");
    expect(roomItemChoice(flutter, hatterene, createConditions())).toBe("boosterenergy");
    expect(roomItemChoice({ ...flutter, itemUsedBeforeRoom: undefined }, hatterene, createConditions())).toBeNull();
  });

  it("names the stat a late Room Service holder would take when the foe's ability set the field", () => {
    const bundle = build(sv, "ironbundle", { ability: "quarkdrive", item: "roomservice", evs: { spe: 252 }, nature: "Timid" });
    const hit = row(sv, "hydropump", bundle, build(sv, "pincurchin", { ability: "electricsurge" }), { magicRoom: false, trickRoom: true, terrain: "Electric" });
    expect(range(hit)).toBe("85-102");
    expect(hit.assumptions.join(" ")).toContain("The attacker Iron Bundle's Quark Drive activated before Room Service lowered its Speed: this assumes both entered together, so the other Pokémon's Electric Surge set Electric Terrain first. If Room Service came first, Quark Drive raises its Sp. Atk: tick its Room Service choice.");
  });

  it("fails a transformed Imposter user's Double Shock before the target's Protect", () => {
    const ditto = { ...build(sv, "ditto", { ability: "imposter" }), abilityActive: true } as BattleBuild;
    const out = calculateMatchup(ditto, build(sv, "smeargle"), { ...createConditions(), gameType: "Singles", defenderSide: { ...createConditions().defenderSide, protect: true } }, {}, sv);
    expect(out.results.find((result) => result.moveId === "doubleshock")).toMatchObject({ min: 0, max: 0, description: "Double Shock fails because the attacker is not Electric type." });
  });
});
