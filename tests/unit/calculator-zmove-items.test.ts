import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { hitStep, ownMoveId, startHits, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Z-Moves and Max Moves of item moves, and the attacker's own Berry in the 2v2 heals, against pinned Showdown c23d2e94.
 * sim/battle-actions.ts getActiveZMove / getActiveMaxMove make a damaging move's Z-Move or Max Move the generic move of its
 * type (Black Hole Eclipse, Max Darkness...) with only the base move's power, so none of Knock Off's, Thief's or Covet's
 * handlers run (data/moves.ts knockoff onBasePower / onAfterHit, thief and covet onAfterHit). Singles values: the exact Uses
 * oracle scripts/.cache/calc-audit/bugbite/verify/u-oracle.ts (probes in scripts/.cache/calc-audit/zmove/fix/u-probe.ts).
 * 2v2 values: the exact oracle scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases ZI01-ZI08 and HL01-HL12 of
 * verify/cases.ts; the heal amounts from sim/pokemon.ts heal over every path (zmove/fix/heals-check.ts). Level 50, 31 IVs,
 * 0 EVs / Stat Points, Serious nature unless set.
 */

describe("the move whose own handlers a use runs (hit-loop.ts ownMoveId)", () => {
  it("is the move itself, and none for its Z-Move or Max Move", () => {
    expect(ownMoveId("knockoff", {})).toBe("knockoff");
    expect(ownMoveId("knockoff", { isZ: true })).toBe("");
    expect(ownMoveId("thief", { isMax: true })).toBe("");
    expect(ownMoveId("bugbite", { isZ: false, isMax: false })).toBe("bugbite");
  });
});

describe("the attacker's own Berry eaten at a hit's Update (hit-loop.ts hitStep)", () => {
  const input = (patch: Partial<HitLoopInput>): HitLoopInput => ({
    hp: 93, maxHP: 155, baseMaxHP: 155, attackerAbility: "swarm", attackerItem: "sitrusberry", targetAbility: "roughskin", targetItem: "",
    attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: true, category: "Physical", drain: null,
    takesBerry: false, targetGulping: false, generation: 9, ...patch,
  });
  const step = (loop: HitLoopInput) => hitStep(loop, startHits(loop), 0).state;

  it("records the Berry and what it healed", () => {
    // HL01: Heracross 93/155 - 19 (Rough Skin) = 74, then its Sitrus Berry +38: 112.
    expect(step(input({}))).toMatchObject({ hp: 112, attackerItem: "", ate: { item: "sitrusberry", heal: 38, pouch: 0 } });
    // HL04: Dedenne 80/142 - 17 = 63, Sitrus +35 = 98, Cheek Pouch +47 capped at the maximum: +44.
    expect(step(input({ hp: 80, maxHP: 142, baseMaxHP: 142, attackerAbility: "cheekpouch" }))).toMatchObject({ hp: 142, ate: { item: "sitrusberry", heal: 35, pouch: 44 } });
    // HL05: a pinch Berry heals nothing; Cheek Pouch +47.
    expect(step(input({ hp: 40, maxHP: 142, baseMaxHP: 142, attackerAbility: "cheekpouch", attackerItem: "liechiberry" }))).toMatchObject({ hp: 70, stages: { atk: 1 }, ate: { item: "liechiberry", heal: 0, pouch: 47 } });
    // The target's Unnerve stops it (HL09): 93 - 25 (Rocky Helmet) = 68, nothing eaten.
    expect(step(input({ targetAbility: "unnerve", targetItem: "rockyhelmet" }))).toMatchObject({ hp: 68, attackerItem: "sitrusberry" });
    expect(step(input({ targetAbility: "unnerve", targetItem: "rockyhelmet" })).ate).toBeUndefined();
  });
});

type Mon = { id: string; ability: string; item?: string; nature?: string; hp?: number; status?: BattleBuild["status"] };
function build(runtime: BattleRuntime, m: Mon, extra: Partial<BattleBuild> = {}): BattleBuild {
  return {
    ...createBuild(m.id, runtime), nature: m.nature ?? "Serious", abilityId: m.ability, itemId: m.item ?? "",
    ...(m.hp !== undefined ? { currentHP: m.hp } : {}), ...(m.status ? { status: m.status } : {}), ...extra,
  } as BattleBuild;
}
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, context?: MoveContext, extra: Partial<BattleBuild> = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const out = calculateMatchup(build(runtime, attacker, extra), build(runtime, defender), { ...createConditions(), gameType: "Singles" }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const weavileZ: Mon = { id: "weavile", ability: "pressure", item: "darkiniumz" };
const chomp = (item: string, hp?: number): Mon => ({ id: "garchomp", ability: "roughskin", item, ...(hp !== undefined ? { hp } : {}) });

describe("a Z-Move of an item move takes nothing in 1v1 (Ultra Sun / Ultra Moon)", () => {
  it("Z-Knock Off (Black Hole Eclipse): the target keeps and eats its Sitrus Berry", async () => {
    // u-oracle Z01: Garchomp 183 takes 84-99 and eats its Sitrus Berry at half HP or less (+45): 92-135, average 111.8125.
    const z = await row("ultra_sun_ultra_moon", "knockoff", weavileZ, chomp("sitrusberry"), { useZ: true });
    expect(z).toMatchObject({ effectiveName: "Black Hole Eclipse", min: 84, max: 99 });
    expect(z.usesToKO).toEqual({ kind: "single-use", reason: "Z-Moves are once per battle", koChance: 0 });
    expect(z.afterUse).toMatchObject({ start: 183, low: 99, high: 129, min: 92, max: 135, koChance: 0, heals: ["Sitrus Berry: +45 HP."] });
    expect(z.afterUse!.average).toBeCloseTo(111.8125, 12);
    // Z10: a Figy Berry at a quarter, a half of the maximum HP in generation 7 (+91): 120 → 112-127, average 120.125.
    const figy = await row("ultra_sun_ultra_moon", "knockoff", weavileZ, chomp("figyberry", 120), { useZ: true });
    expect(figy.afterUse).toMatchObject({ start: 120, low: 127, high: 112, min: 112, max: 127, koChance: 0, heals: ["Figy Berry: +91 HP."] });
    expect(figy.afterUse!.average).toBeCloseTo(120.125, 12);
  });

  it("Z-Thief: the target eats its Sitrus Berry; Knock Off itself still takes it", async () => {
    // Z03: as Z01.
    const thief = await row("ultra_sun_ultra_moon", "thief", weavileZ, chomp("sitrusberry"), { useZ: true });
    expect(thief.afterUse).toMatchObject({ start: 183, low: 99, high: 129, min: 92, max: 135, heals: ["Sitrus Berry: +45 HP."] });
    // Z02 (no Z): Knock Off at 97 power (1.5x) takes the Sitrus Berry before its holder can eat it: 104-116, average 110.4375.
    const plain = await row("ultra_sun_ultra_moon", "knockoff", weavileZ, chomp("sitrusberry"));
    expect(plain).toMatchObject({ min: 67, max: 79 });
    expect(plain.afterUse).toMatchObject({ low: 116, high: 104, min: 104, max: 116, heals: [] });
    expect(plain.afterUse!.average).toBeCloseTo(110.4375, 12);
    expect(plain.usesToKO).toMatchObject({ kind: "uses", guaranteed: 4, fewest: 3, carried: ["Knock Off takes the target's item."] });
  });

  it("Max Darkness from Knock Off takes nothing either; Knock Off does once Dynamax ends (Sword / Shield)", async () => {
    // u-oracle M01: 84-99, then the Sitrus Berry (+45): 92-135; out in 3 uses for certain, in 2 at 0.140625.
    const max = await row("sword_shield", "knockoff", { id: "weavile", ability: "pressure" }, chomp("sitrusberry"), undefined, { mechanic: "dynamax" });
    expect(max.afterUse).toMatchObject({ start: 183, low: 99, high: 129, min: 92, max: 135, heals: ["Sitrus Berry: +45 HP."] });
    expect(max.usesToKO).toMatchObject({ kind: "uses", guaranteed: 3, fewest: 2, fasterChance: 0.140625 });
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId; context?: MoveContext; evs?: Partial<Record<"spe", number>> };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}) {
  const runtime = game === "champions" ? championsRuntime : await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => {
    const base = build(runtime, m);
    const withSpeed = m.evs ? (base.game === "champions" ? { ...base, points: { ...base.points!, ...m.evs } } : { ...base, native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } }) : base;
    return [slot, {
      build: withSpeed as BattleBuild, contexts: m.context && m.move ? { [m.move]: m.context } : {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
    } satisfies DoublesPokemonInput];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
  const result = calculateDoublesTurn(input);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.status);
  return result;
}
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const blastoise: Slot = { id: "blastoise", ability: "torrent" };
const zKnockOff = (move = "knockoff"): Slot => ({ ...weavileZ, move, target: "opponent-left", context: { useZ: true } });

describe("a Z-Move of an item move takes nothing in the 2v2 turn (oracle cases ZI01-ZI08)", () => {
  it("leaves the target its Sitrus or Figy Berry, which it eats after the hit", async () => {
    // ZI01: 183 → 92-135 (+45). ZI06: Z-Thief alike. ZI02: Figy at 120 → 112-127 (+91).
    const z = await turn("ultra_sun_ultra_moon", { "own-left": zKnockOff(), "own-right": venusaur, "opponent-left": chomp("sitrusberry"), "opponent-right": blastoise });
    expect(z.hp["opponent-left"]).toMatchObject({ start: 183, low: 99, high: 129, min: 92, max: 135, average: 111.8125, koChance: 0, heals: ["Sitrus Berry: +45 HP."] });
    const thief = await turn("ultra_sun_ultra_moon", { "own-left": zKnockOff("thief"), "own-right": venusaur, "opponent-left": chomp("sitrusberry"), "opponent-right": blastoise });
    expect(thief.hp["opponent-left"]).toMatchObject({ low: 99, high: 129, min: 92, max: 135, average: 111.8125, heals: ["Sitrus Berry: +45 HP."] });
    const figy = await turn("ultra_sun_ultra_moon", { "own-left": zKnockOff(), "own-right": venusaur, "opponent-left": chomp("figyberry", 120), "opponent-right": blastoise });
    expect(figy.hp["opponent-left"]).toMatchObject({ start: 120, low: 127, high: 112, min: 112, max: 127, average: 120.125, heals: ["Figy Berry: +91 HP."] });
  });

  it("keeps the Berry's heal and the held Eviolite for the partner's later Dragon Claw", async () => {
    const partner: Slot = { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "opponent-left", evs: { spe: 4 } };
    // ZI03: Garchomp eats its Sitrus Berry before the Dragon Claw: knocked out at 0.71484375, average 2.40625, at most 19 left.
    const healed = await turn("ultra_sun_ultra_moon", { "own-left": zKnockOff(), "own-right": partner, "opponent-left": chomp("sitrusberry"), "opponent-right": blastoise });
    expect(healed.hp["opponent-left"]).toMatchObject({ low: 0, high: 0, min: 0, max: 19, heals: ["Sitrus Berry: +45 HP."] });
    expect(healed.hp["opponent-left"]!.koChance).toBeCloseTo(0.71484375, 12);
    expect(healed.hp["opponent-left"]!.average).toBeCloseTo(2.40625, 12);
    // ZI05: Munchlax keeps its Eviolite (1.5x Defense): 210 → 0-28, knocked out at 0.06640625, average 12.05859375.
    const vest = await turn("ultra_sun_ultra_moon", { "own-left": zKnockOff(), "own-right": partner, "opponent-left": { id: "munchlax", ability: "thickfat", item: "eviolite" }, "opponent-right": blastoise });
    expect(vest.hp["opponent-left"]).toMatchObject({ start: 210, low: 28, high: 0, min: 0, max: 28, average: 12.05859375 });
    expect(vest.hp["opponent-left"]!.koChance).toBeCloseTo(0.06640625, 12);
  });

  it("still takes the Sitrus Berry with Knock Off itself", async () => {
    // ZI07: Weavile 145 → 127 (Rough Skin), Garchomp 183 → 104-116 with no heal.
    const plain = await turn("ultra_sun_ultra_moon", { "own-left": { ...weavileZ, item: "", move: "knockoff", target: "opponent-left" }, "own-right": venusaur, "opponent-left": chomp("sitrusberry"), "opponent-right": blastoise });
    expect(plain.hp["opponent-left"]).toMatchObject({ low: 116, high: 104, min: 104, max: 116, average: 110.4375, heals: [] });
    expect(plain.hp["own-left"]).toMatchObject({ low: 127, high: 127 });
  });
});

describe("the 2v2 turn lists the Berry an attacker eats during or right after its own move (oracle cases HL01-HL12)", () => {
  const heracross = (hp = 93): Slot => ({ id: "heracross", ability: "swarm", item: "sitrusberry", hp, move: "closecombat", target: "opponent-left" });
  const garchomp: Slot = { id: "garchomp", ability: "roughskin" };

  it("after Rough Skin, on the knocking-out hit too, and not past a foe's Unnerve", async () => {
    // HL01: 93 - 19 = 74, Sitrus +38: 112. HL08: the same as Close Combat knocks Garchomp (60 HP) out.
    const cc = await turn("scarlet_violet", { "own-left": heracross(), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise });
    expect(cc.hp["own-left"]).toMatchObject({ start: 93, low: 112, high: 112, average: 112, koChance: 0, heals: ["Sitrus Berry: +38 HP."] });
    const ko = await turn("scarlet_violet", { "own-left": heracross(), "own-right": venusaur, "opponent-left": { ...garchomp, hp: 60 }, "opponent-right": blastoise });
    expect(ko.hp["own-left"]).toMatchObject({ low: 112, high: 112, heals: ["Sitrus Berry: +38 HP."] });
    expect(ko.hp["opponent-left"]).toMatchObject({ low: 0, koChance: 1 });
    // HL09: Tyranitar's Unnerve: 74, no heal.
    const unnerve = await turn("scarlet_violet", { "own-left": heracross(), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": { id: "tyranitar", ability: "unnerve" } });
    expect(unnerve.hp["own-left"]).toMatchObject({ low: 74, high: 74, heals: [] });
    // HL12: then Snorlax's Body Slam into it: 0-12, knocked out at 0.375; the heal still listed.
    const later = await turn("scarlet_violet", { "own-left": heracross(), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": { id: "snorlax", ability: "thickfat", move: "bodyslam", target: "own-left", evs: { spe: 4 } } });
    expect(later.hp["own-left"]).toMatchObject({ low: 12, high: 0, min: 0, max: 12, average: 4.375, koChance: 0.375, heals: ["Sitrus Berry: +38 HP."] });
  });

  it("between a multi-hit move's hits, also when the attacker then faints, and on the rolls a draining move leaves it low", async () => {
    // HL02: Weavile 80/145: 62 after the first hit, +36 = 98, then 80.
    const weavile = (item: string, hp: number): Slot => ({ id: "weavile", ability: "pressure", item, hp, move: "doublehit", target: "opponent-left" });
    const twice = await turn("scarlet_violet", { "own-left": weavile("sitrusberry", 80), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise });
    expect(twice.hp["own-left"]).toMatchObject({ low: 80, high: 80, heals: ["Sitrus Berry: +36 HP."] });
    // HL06: Rough Skin and Rocky Helmet: 73 → 31, Oran +10 = 41, knocked out by the second hit.
    const out = await turn("scarlet_violet", { "own-left": weavile("oranberry", 73), "own-right": venusaur, "opponent-left": { ...garchomp, item: "rockyhelmet" }, "opponent-right": blastoise });
    expect(out.hp["own-left"]).toMatchObject({ low: 0, high: 0, koChance: 1, heals: ["Oran Berry: +10 HP."] });
    // HL07: Breloom 75: Drain Punch heals first, then 38 back: the Sitrus Berry (+33) at 67 or less: 68-100, average 82.4375.
    const drain = await turn("scarlet_violet", { "own-left": { id: "breloom", ability: "technician", item: "sitrusberry", hp: 75, move: "drainpunch", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { ...garchomp, item: "rockyhelmet" }, "opponent-right": blastoise });
    expect(drain.hp["own-left"]).toMatchObject({ low: 99, high: 71, min: 68, max: 100, average: 82.4375, heals: ["Sitrus Berry: +33 HP."] });
  });

  it("with Cheek Pouch's heal capped at the maximum, a pinch Berry, Oran, the USUM Figy Berry and after recoil", async () => {
    const dedenne = (item: string, hp: number): Slot => ({ id: "dedenne", ability: "cheekpouch", item, hp, move: "playrough", target: "opponent-left" });
    // HL04: 80 - 17 = 63, Sitrus +35, Cheek Pouch +44 (47 capped): 142.
    const pouch = await turn("scarlet_violet", { "own-left": dedenne("sitrusberry", 80), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise });
    expect(pouch.hp["own-left"]).toMatchObject({ low: 142, high: 142, heals: ["Sitrus Berry: +35 HP.", "Cheek Pouch: +44 HP."] });
    // HL05: Liechi Berry at 23: Cheek Pouch +47: 70.
    const liechi = await turn("scarlet_violet", { "own-left": dedenne("liechiberry", 40), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise });
    expect(liechi.hp["own-left"]).toMatchObject({ low: 70, high: 70, heals: ["Cheek Pouch: +47 HP."] });
    // HL10 (Champions): Garchomp 98 - 22 = 76, Oran +10: 86.
    const oran = await turn("champions", {
      "own-left": { id: "garchomp", ability: "sandveil", item: "oranberry", hp: 98, move: "dragonclaw", target: "opponent-left", evs: { spe: 1 } }, "own-right": { id: "charizard", ability: "blaze" },
      "opponent-left": garchomp, "opponent-right": blastoise,
    });
    expect(oran.hp["own-left"]).toMatchObject({ low: 86, high: 86, heals: ["Oran Berry: +10 HP."] });
    // HL11 (USUM): Gluttony Snorlax 130 - 29 = 101 (half: 117), Figy +117: 218.
    const figy = await turn("ultra_sun_ultra_moon", { "own-left": { id: "snorlax", ability: "gluttony", item: "figyberry", hp: 130, move: "bodyslam", target: "opponent-left" }, "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise });
    expect(figy.hp["own-left"]).toMatchObject({ low: 218, high: 218, heals: ["Figy Berry: +117 HP."] });
    // HL03: Braviary 95, Brave Bird's recoil, then its Sitrus Berry +43: 106-111 (listed before this fix too).
    const recoil = await turn("scarlet_violet", { "own-left": { id: "braviary", ability: "keeneye", item: "sitrusberry", hp: 95, move: "bravebird", target: "opponent-left" }, "own-right": venusaur, "opponent-left": blastoise, "opponent-right": { id: "snorlax", ability: "thickfat", evs: { spe: 4 } } });
    expect(recoil.hp["own-left"]).toMatchObject({ low: 111, high: 106, min: 106, max: 111, average: 108.8125, heals: ["Sitrus Berry: +43 HP."] });
  });
});

describe("Cheek Pouch's heal on its own line where the attacker eats its Berry outside a single target's hits (zmove/verify d-cases H18-H32)", () => {
  const diggersby = (item: string, hp: number, move: string, target?: DoublesSlotId): Slot => ({ id: "diggersby", ability: "cheekpouch", item, hp, move, ...(target ? { target } : {}) });
  const spread = { "own-right": { id: "snorlax", ability: "thickfat" }, "opponent-left": { id: "garchomp", ability: "roughskin" }, "opponent-right": { id: "ferrothorn", ability: "ironbarbs" } } as const;

  it("after a spread move's Rough Skin and Iron Barbs", async () => {
    // H18: Brutal Swing: 96/160 - 20 - 20 = 56, Sitrus +40 = 96, Cheek Pouch +53: 149.
    const sitrus = await turn("ultra_sun_ultra_moon", { "own-left": diggersby("sitrusberry", 96, "brutalswing"), ...spread });
    expect(sitrus.hp["own-left"]).toMatchObject({ start: 96, low: 149, high: 149, average: 149, heals: ["Sitrus Berry: +40 HP.", "Cheek Pouch: +53 HP."] });
    // H19: a Liechi Berry at 12 heals nothing; Cheek Pouch +53: 65.
    const liechi = await turn("ultra_sun_ultra_moon", { "own-left": diggersby("liechiberry", 52, "brutalswing"), ...spread });
    expect(liechi.hp["own-left"]).toMatchObject({ start: 52, low: 65, high: 65, heals: ["Cheek Pouch: +53 HP."] });
  });

  it("once the foe whose Unnerve stopped it faints", async () => {
    // H31: Haxorus (Unnerve, 1 HP) knocked out by Quick Attack: 72/160, Sitrus +40 = 112, Cheek Pouch +53 capped: +48.
    const haxorus: Slot = { id: "haxorus", ability: "unnerve", hp: 1 };
    const out = await turn("ultra_sun_ultra_moon", { "own-left": diggersby("sitrusberry", 72, "quickattack", "opponent-left"), "own-right": venusaur, "opponent-left": haxorus, "opponent-right": blastoise });
    expect(out.hp["own-left"]).toMatchObject({ start: 72, low: 160, high: 160, heals: ["Sitrus Berry: +40 HP.", "Cheek Pouch: +48 HP."] });
    // H32 (Sword / Shield): Greedent 87/195, Body Slam: Sitrus +48, Cheek Pouch +60: 195.
    const greedent = await turn("sword_shield", {
      "own-left": { id: "greedent", ability: "cheekpouch", item: "sitrusberry", hp: 87, move: "bodyslam", target: "opponent-left" }, "own-right": venusaur, "opponent-left": haxorus, "opponent-right": blastoise,
    });
    expect(greedent.hp["own-left"]).toMatchObject({ start: 87, low: 195, high: 195, heals: ["Sitrus Berry: +48 HP.", "Cheek Pouch: +60 HP."] });
  });

  it("as it eats a Lum Berry outside the hits: a protecting move's status, and once a foe's Unnerve ends", async () => {
    const dedenne: Slot = { id: "dedenne", ability: "cheekpouch", item: "lumberry", hp: 85, move: "playrough", target: "opponent-left" };
    // H54: Baneful Bunker poisons the blocked Dedenne (85/142); its Lum Berry cures it and Cheek Pouch heals 47: 132.
    const bunker = await turn("scarlet_violet", { "own-left": dedenne, "own-right": venusaur, "opponent-left": { id: "toxapex", ability: "regenerator", move: "banefulbunker" }, "opponent-right": blastoise });
    expect(bunker.hp["own-left"]).toMatchObject({ start: 85, low: 132, high: 132, average: 132, heals: ["Cheek Pouch: +47 HP."] });
    // H56: a burned Dedenne knocks out Haxorus (Unnerve, 1 HP), then eats its Lum Berry: 132.
    const unnerve = await turn("scarlet_violet", { "own-left": { ...dedenne, status: "brn" }, "own-right": venusaur, "opponent-left": { id: "haxorus", ability: "unnerve", hp: 1 }, "opponent-right": blastoise });
    expect(unnerve.hp["own-left"]).toMatchObject({ start: 85, low: 132, high: 132, average: 132, heals: ["Cheek Pouch: +47 HP."] });
  });
});
