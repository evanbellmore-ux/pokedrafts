import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { hitStep, startHits, stolenEat, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";

/**
 * Bug Bite and Pluck eat the target's Berry for their user, against pinned Showdown c23d2e94 (data/moves.ts bugbite and pluck
 * onHit: `if (source.hp && item.isBerry && target.takeItem(source))`, singleEvent('Eat', item, ..., source), then
 * runEvent('EatItem', source)). Singles values: scripts/.cache/calc-audit/bugbite/fix/sd-probe.ts (one turn, every move hitting,
 * no crit) and uses-probe.ts (repeated turns at the lowest and the highest roll, each use's 16 getDamage rolls, the chance of
 * a KO within n uses by convolution of those rolls). 2v2 values: the exact oracle scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts
 * (cases BB01-BB18 in verify/cases.ts). Level 50, 31 IVs, 0 EVs / Stat Points, Serious nature unless set.
 */
const SCIZOR = { maxHP: 145, baseMaxHP: 145 };
const eater = (ability = "technician", ignoresItem = false) => ({ baseMaxHP: 145, ability, ignoresItem });

describe("what the eaten Berry gives the user (hit-loop.ts stolenEat)", () => {
  it("heals with Sitrus, Oran and the Figy family, doubled by Ripen, a half in generation 7", () => {
    // sd-probe sitrus60, oran60, figy60-*, ripen-sitrus, ripen-oran: Scizor 145 HP at 60 heals 36, 10, 48 (72 in USUM), 72, 20.
    expect(stolenEat("sitrusberry", eater(), 0).heal).toBe(36);
    expect(stolenEat("oranberry", eater(), 0).heal).toBe(10);
    expect(stolenEat("figyberry", eater(), 9)).toMatchObject({ heal: 48, confuses: "atk" });
    expect(stolenEat("figyberry", eater(), 7)).toMatchObject({ heal: 72, confuses: "atk" });
    expect(stolenEat("wikiberry", eater(), 0)).toMatchObject({ heal: 48, confuses: "spa" });
    expect(stolenEat("sitrusberry", eater("ripen"), 0).heal).toBe(72);
    expect(stolenEat("oranberry", eater("ripen"), 0).heal).toBe(20);
    // Enigma Berry's onEat does nothing (its heal is its own onHit's): sd-probe enigma60 stays at 60.
    expect(stolenEat("enigmaberry", eater(), 0).heal).toBe(0);
  });

  it("raises a stat with the pinch Berries, Kee and Maranga; Starf at random; Lansat's focus; Leppa's PP", () => {
    // sd-probe liechi, ganlon, salac, kee, maranga, ripen-liechi, starf, lansat, leppa, leppa-ripen.
    expect(stolenEat("liechiberry", eater(), 0).stages).toEqual({ atk: 1 });
    expect(stolenEat("ganlonberry", eater(), 0).stages).toEqual({ def: 1 });
    expect(stolenEat("salacberry", eater(), 0).stages).toEqual({ spe: 1 });
    expect(stolenEat("keeberry", eater(), 0).stages).toEqual({ def: 1 });
    expect(stolenEat("marangaberry", eater(), 0).stages).toEqual({ spd: 1 });
    expect(stolenEat("liechiberry", eater("ripen"), 0).stages).toEqual({ atk: 2 });
    expect(stolenEat("starfberry", eater(), 0)).toMatchObject({ starf: 2, stages: {} });
    expect(stolenEat("lansatberry", eater(), 0).focusEnergy).toBe(true);
    expect(stolenEat("leppaberry", eater(), 0).leppa).toBe(10);
    expect(stolenEat("leppaberry", eater("ripen"), 0).leppa).toBe(20);
    expect(stolenEat("micleberry", eater(), 0)).toEqual({ heal: 0, pouch: 0, stages: {}, cures: [], curesConfusion: false });
  });

  it("cures the user's status and confusion; resist, Jaboca, Custap and the flavour Berries do nothing", () => {
    // sd-probe lum-brn, rawst-brn, rawst-par, cheri-par, persim-conf, occa, jaboca, custap, pomeg.
    expect(stolenEat("lumberry", eater(), 0)).toMatchObject({ cures: ["brn", "par", "psn", "tox", "slp", "frz"], curesConfusion: true });
    expect(stolenEat("rawstberry", eater(), 0).cures).toEqual(["brn"]);
    expect(stolenEat("cheriberry", eater(), 0).cures).toEqual(["par"]);
    expect(stolenEat("persimberry", eater(), 0)).toMatchObject({ cures: [], curesConfusion: true });
    for (const item of ["occaberry", "jabocaberry", "custapberry", "pomegberry"]) {
      expect(stolenEat(item, eater(), 0)).toEqual({ heal: 0, pouch: 0, stages: {}, cures: [], curesConfusion: false });
    }
    // Ripen marks an eaten resist Berry (onEatItem berryWeaken; sd-probe ripen-occa).
    expect(stolenEat("occaberry", eater("ripen"), 0).weakens).toBe(true);
  });

  it("gives Cheek Pouch's third with any Berry whose Eat runs, and only that once the user ignores its items", () => {
    // sd-probe pouch-sitrus (30 → 114), pouch-occa (30 → 78), pouch-pomeg (stays 30), magicroom-pouch (Pomeg: 60 → 108),
    // klutz-user and magicroom (Sitrus: stays 60), klutz-user-macho (Macho Brace ignores Klutz: 96).
    expect(stolenEat("sitrusberry", eater("cheekpouch"), 0)).toMatchObject({ heal: 36, pouch: 48 });
    expect(stolenEat("occaberry", eater("cheekpouch"), 0)).toMatchObject({ heal: 0, pouch: 48 });
    expect(stolenEat("pomegberry", eater("cheekpouch"), 0)).toMatchObject({ heal: 0, pouch: 0 });
    expect(stolenEat("pomegberry", eater("cheekpouch", true), 0)).toMatchObject({ heal: 0, pouch: 48 });
    expect(stolenEat("sitrusberry", eater("klutz", true), 0)).toEqual({ heal: 0, pouch: 0, stages: {}, cures: [], curesConfusion: false });
    expect(stolenEat("liechiberry", eater("technician", true), 0).stages).toEqual({});
  });
});

describe("the eat in the hit (hit-loop.ts hitStep)", () => {
  const input = (patch: Partial<HitLoopInput> = {}): HitLoopInput => ({
    hp: 10, ...SCIZOR, attackerAbility: "technician", attackerItem: "", targetAbility: "roughskin", targetItem: "sitrusberry",
    attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: true, category: "Physical", drain: null,
    takesBerry: true, eats: { ignoresItem: false }, targetGulping: false, generation: 0, ...patch,
  });
  const step = (loop: HitLoopInput, knocked = false) => hitStep(loop, startHits(loop), 0, knocked).state;

  it("heals the user before the target's Rough Skin, and not past its maximum", () => {
    // sd-probe roughskin: Scizor 10 → 46 (Sitrus) → 28 (Rough Skin 18).
    expect(step(input())).toMatchObject({ hp: 28, targetItem: "", stolen: { item: "sitrusberry", heal: 36, pouch: 0 } });
    // sitrus144: 144 → 145; sitrusFull: no heal at full HP.
    expect(step(input({ hp: 144, targetAbility: "" }))).toMatchObject({ hp: 145, stolen: { heal: 1 } });
    expect(step(input({ hp: 145, targetAbility: "" }))).toMatchObject({ hp: 145, stolen: { heal: 0 } });
  });

  it("raises a stolen pinch Berry's stage in the hit, reversed by Contrary and doubled by Simple", () => {
    // sd-probe simple-liechi +2, contrary-liechi -1.
    const liechi = { hp: 145, targetAbility: "", targetItem: "liechiberry" };
    expect(step(input({ ...liechi })).stages).toEqual({ atk: 1 });
    expect(step(input({ ...liechi, attackerAbility: "simple" })).stages).toEqual({ atk: 2 });
    expect(step(input({ ...liechi, attackerAbility: "contrary" })).stages).toEqual({ atk: -1 });
  });

  it("takes nothing through Sticky Hold, unless the hit knocks its holder out", () => {
    // sd-probe stickyhold (kept, stays 60) and ko-stickyhold (60 → 96 as the Sticky Hold holder faints).
    const sticky = input({ hp: 60, targetAbility: "stickyhold", contact: false });
    expect(step(sticky)).toMatchObject({ hp: 60, targetItem: "sitrusberry" });
    expect(step(sticky).stolen).toBeUndefined();
    expect(step(sticky, true)).toMatchObject({ hp: 96, targetItem: "", stolen: { item: "sitrusberry", heal: 36 } });
  });

  it("finds a Berry that does not work for its holder, and Incinerate burns it without the eat", () => {
    // The target's Klutz or Magic Room: takeItem reads neither, so the held Berry is taken (and here eaten).
    expect(step(input({ hp: 60, targetAbility: "", targetItem: "", targetBerry: "sitrusberry" }))).toMatchObject({ hp: 96, stolen: { item: "sitrusberry" } });
    // A resist Berry the hit's damage ate is not there to take.
    expect(step(input({ hp: 60, targetAbility: "", targetItem: "tangaberry", targetBerry: "" })).stolen).toBeUndefined();
    // sd-probe incinerate: Charizard stays at 60.
    const incinerate = { ...input({ hp: 60, targetAbility: "" }), eats: undefined };
    expect(step(incinerate)).toMatchObject({ hp: 60, targetItem: "", stolen: { item: "sitrusberry", heal: 0 } });
  });
});

type Mon = { id: string; ability: string; item?: string; nature?: string; hp?: number; status?: BattleBuild["status"] };
function build(runtime: BattleRuntime, m: Mon): BattleBuild {
  return {
    ...createBuild(m.id, runtime), nature: m.nature ?? "Serious", abilityId: m.ability, itemId: m.item ?? "",
    ...(m.hp !== undefined ? { currentHP: m.hp } : {}), ...(m.status ? { status: m.status } : {}),
  } as BattleBuild;
}
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, field: Partial<BattleConditions> = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const out = calculateMatchup(build(runtime, attacker), build(runtime, defender), { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
const counted = (value: UsesToKO | undefined): Counted => {
  expect(value?.kind).toBe("uses");
  return value as Counted;
};

describe("Uses to KO follows the Berry the first use eats (uses-probe.ts)", () => {
  const scizor = (extra: Partial<Mon> = {}): Mon => ({ id: "scizor", ability: "technician", ...extra });

  it("heals the attacker before the target's Rough Skin, so it stands until the third use knocks out", async () => {
    // Showdown: Scizor 30 → 48, 30, 12 while Garchomp (183) takes 67–79 a use, out on the third (it would faint on the second without the heal).
    const bugBite = await row("champions", "bugbite", scizor({ hp: 30 }), { id: "garchomp", ability: "roughskin", item: "sitrusberry" });
    expect(counted(bugBite.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3, limit: 20 });
    expect(bugBite.usesToKO).not.toHaveProperty("faintsFirst");
    expect(counted(bugBite.usesToKO).carried).toContain("Bug Bite eats the target's Sitrus Berry on the first use: the attacker regains 36 HP.");
    // Ultra Sun / Ultra Moon: a Modest Scizor eats a Figy Berry for 72 (30 → 84, 66, 48, 30), confused by it from then on;
    // Garchomp takes 60–72 a use: out in 3 at 0.995361 (the convolution of Showdown's rolls), in 4 for certain.
    const figy = await row("ultra_sun_ultra_moon", "bugbite", scizor({ hp: 30, nature: "Modest" }), { id: "garchomp", ability: "roughskin", item: "figyberry" });
    expect(counted(figy.usesToKO)).toMatchObject({ guaranteed: 4, fewest: 3, notes: ["Assumes the confused attacker does not hit itself."] });
    expect(counted(figy.usesToKO).fasterChance).toBeCloseTo(0.995361328125, 12);
    expect(counted(figy.usesToKO).carried).toContain("Bug Bite eats the target's Figy Berry on the first use: the attacker regains 72 HP.");
  });

  it("gets nothing for a Klutz user, or under Magic Room: it faints on the second use", async () => {
    // Showdown: Swoobat 30 → 13 → 0 (Pluck into Rough Skin), Scizor 30 → 12 → 0 under Magic Room.
    const swsh = await row("sword_shield", "pluck", { id: "swoobat", ability: "klutz", hp: 30 }, { id: "garchomp", ability: "roughskin", item: "sitrusberry" });
    expect(counted(swsh.usesToKO)).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 2, highest: 2 } });
    const room = await row("champions", "bugbite", scizor({ hp: 30 }), { id: "garchomp", ability: "roughskin", item: "sitrusberry" }, { magicRoom: true });
    expect(counted(room.usesToKO)).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 2, highest: 2 } });
  });

  it("cures the attacker's burn on the first use, so the later uses hit at full power", async () => {
    // Showdown: 40–48 burned, then 81–96 a use into Politoed (165): out on the third use, in both games, with no burn damage.
    const lum = await row("champions", "bugbite", scizor({ status: "brn" }), { id: "politoed", ability: "waterabsorb", item: "lumberry" });
    expect(counted(lum.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    expect(counted(lum.usesToKO).carried).toContain("Bug Bite eats the target's Lum Berry on the first use: it cures the attacker's burn.");
    const rawst = await row("scarlet_violet", "bugbite", scizor({ hp: 30, status: "brn" }), { id: "politoed", ability: "waterabsorb", item: "rawstberry" });
    expect(counted(rawst.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
  });

  it("carries a stolen pinch Berry's stage and a Lansat Berry's critical hits", async () => {
    // Showdown: Contrary Malamar's Pluck 28–33, then 18–22 at -1 Attack into Politoed (165): 7 to 9 uses, 8 at 0.926059.
    const pluck = await row("scarlet_violet", "pluck", { id: "malamar", ability: "contrary" }, { id: "politoed", ability: "waterabsorb", item: "liechiberry" });
    expect(counted(pluck.usesToKO)).toMatchObject({ guaranteed: 9, fewest: 7 });
    expect(counted(pluck.usesToKO).fasterChance).toBeCloseTo(0.9260593457147479, 12);
    expect(counted(pluck.usesToKO).carried).toContain("Pluck eats the target's Liechi Berry on the first use: -1 Attack.");
    // Scope Lens + the stolen Lansat Berry: every later hit is critical (121–144), so 81–96 then out on the second use.
    const lansat = await row("scarlet_violet", "bugbite", scizor({ item: "scopelens" }), { id: "politoed", ability: "waterabsorb", item: "lansatberry" });
    expect(counted(lansat.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
    expect(counted(lansat.usesToKO).carried).toContain("Bug Bite eats the target's Lansat Berry on the first use: every later hit is critical.");
  });

  it("counts one more use for a stolen Leppa Berry, which gives back the PP the first use took", async () => {
    // Showdown: Bug Bite's PP 20 → 20 after the first use (19 + Leppa; 18 + 2 into Pressure), then 19 or 18 a use on.
    // Corviknight (173) takes 15–18: 10 to 12 uses, within 11 at 0.995551 (the convolution of Showdown's rolls).
    const unnerve = await row("champions", "bugbite", scizor(), { id: "corviknight", ability: "unnerve", item: "leppaberry" });
    expect(counted(unnerve.usesToKO)).toMatchObject({ guaranteed: 12, fewest: 10, limit: 21, limitReason: "pp" });
    expect(counted(unnerve.usesToKO).fasterChance).toBeCloseTo(0.9955505176082511, 12);
    expect(counted(unnerve.usesToKO).carried).toContain("Bug Bite eats the target's Leppa Berry on the first use: the PP that use took comes back.");
    const pressure = await row("champions", "bugbite", scizor(), { id: "corviknight", ability: "pressure", item: "leppaberry" });
    expect(counted(pressure.usesToKO)).toMatchObject({ guaranteed: null, fewest: 10, limit: 11, limitReason: "pressure", needed: 12 });
    // Sword/Shield, Dynamaxed: three Max Flutterbys, then Bug Bite eats it and gets back the 4 uses' PP (Showdown, dmax-leppa.ts:
    // 32 → 26 into Pressure, 32 again after the fourth use; 32 → 29, then 32, into Unnerve).
    for (const [ability, limit] of [["pressure", 20], ["unnerve", 36]] as const) {
      const dynamax = await row("sword_shield", "bugbite", scizor(), { id: "corviknight", ability, item: "leppaberry" });
      const scizorMax = await (async () => {
        const runtime = await loadBattleRuntime("sword_shield");
        const out = calculateMatchup({ ...build(runtime, scizor()), mechanic: "dynamax" }, build(runtime, { id: "corviknight", ability, item: "leppaberry" }), { ...createConditions(), gameType: "Singles" }, {}, runtime);
        return out.results.find((result) => result.moveId === "bugbite")!;
      })();
      expect(counted(dynamax.usesToKO).limit).toBe(limit === 20 ? 17 : 33);
      expect(counted(scizorMax.usesToKO)).toMatchObject({ limit });
      expect(counted(scizorMax.usesToKO).carried).toContain("After Dynamax ends, Bug Bite eats the target's Leppa Berry: the PP of 4 uses comes back.");
    }
  });

  it("eats the Berry on the use that knocks out too, so its cure counts at that turn's end (through Sticky Hold as its holder faints)", async () => {
    // Verifier oracle (scripts/.cache/calc-audit/bugbite/verify/u-oracle.ts, exact over every roll): Scizor at 4 HP, badly
    // poisoned, knocks Politoed (13 HP) out and eats its Lum Berry in the hit: cured, it stands at the end of the turn.
    const lum = await row("champions", "bugbite", scizor({ hp: 4, status: "tox" }), { id: "politoed", ability: "waterabsorb", item: "lumberry", hp: 13 });
    expect(counted(lum.usesToKO)).toMatchObject({ guaranteed: 1, fewest: 1 });
    expect(lum.usesToKO).not.toHaveProperty("attackerFaints");
    // Muk's Sticky Hold keeps its Berry until the hit that knocks it out: a poisoned Toucannon at 12 HP faints at the end of the
    // first turn on the lowest roll (Muk stands at 3), and stands on the highest (it eats the Pecha Berry as Muk faints).
    const pecha = await row("scarlet_violet", "pluck", { id: "toucannon", ability: "keeneye", hp: 12, status: "psn" }, { id: "muk", ability: "stickyhold", item: "pechaberry", hp: 54 });
    expect(counted(pecha.usesToKO)).toMatchObject({ guaranteed: null, fewest: 1, faintsFirst: true, attackerFaints: { lowest: 1 } });
    expect(counted(pecha.usesToKO).chance).toBeCloseTo(0.6875, 12);
    // Badly poisoned instead: 12 → 3 after the first turn, then the knockout's Lum Berry cures it: out in 2, the attacker standing.
    const tox = await row("scarlet_violet", "pluck", { id: "toucannon", ability: "keeneye", hp: 12, status: "tox" }, { id: "muk", ability: "stickyhold", item: "lumberry", hp: 54 });
    expect(counted(tox.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 1 });
    expect(tox.usesToKO).not.toHaveProperty("attackerFaints");
  });

  it("takes nothing with its Z-Move: the target eats its own Sitrus Berry after Savage Spin-Out", async () => {
    // Verifier oracle: Garchomp (183) takes 60–91 and eats its Sitrus Berry at half HP or less (+45): 92–135, average 120.5625.
    const z = await (async () => {
      const runtime = await loadBattleRuntime("ultra_sun_ultra_moon");
      const out = calculateMatchup(build(runtime, scizor({ hp: 17, item: "buginiumz" })), build(runtime, { id: "garchomp", ability: "roughskin", item: "sitrusberry" }),
        { ...createConditions(), gameType: "Singles" }, { bugbite: { useZ: true } }, runtime);
      return out.results.find((result) => result.moveId === "bugbite")!;
    })();
    expect(z.afterUse).toMatchObject({ start: 183, low: 95, high: 123, min: 92, max: 135, koChance: 0, heals: ["Sitrus Berry: +45 HP."] });
    expect(z.afterUse!.average).toBeCloseTo(120.5625, 12);
  });

  it("leaves the target's HP after one use as it was: the Berry goes before its holder could eat it", async () => {
    // Showdown (BB01): Politoed 165 → 69–84, no Sitrus heal; Scizor's own heal is not the target's.
    const bugBite = await row("champions", "bugbite", scizor({ hp: 60 }), { id: "politoed", ability: "waterabsorb", item: "sitrusberry" });
    expect(bugBite.afterUse).toMatchObject({ start: 165, low: 84, high: 69, min: 69, max: 84, koChance: 0, heals: [] });
    expect(bugBite.afterUse!.average).toBeCloseTo(77.0625, 12);
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId };
async function turnInput(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}): Promise<DoublesTurnInput> {
  const runtime = game === "champions" ? championsRuntime : await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const venusaur: Slot = { id: "venusaur", ability: "overgrow" };
const blastoise: Slot = { id: "blastoise", ability: "torrent" };
const toed = (item: string, extra: Partial<Slot> = {}): Slot => ({ id: "politoed", ability: "waterabsorb", item, ...extra });
const scizorAt = (extra: Partial<Slot> = {}): Slot => ({ id: "scizor", ability: "technician", move: "bugbite", target: "opponent-left", ...extra });

describe("the 2v2 turn gives the user its eaten Berry (oracle cases BB01-BB18)", () => {
  it("heals Scizor 60 → 96 eating a foe's or its ally's Sitrus Berry, also as the hit knocks the holder out", async () => {
    const foe = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 60 }), "own-right": venusaur, "opponent-left": toed("sitrusberry"), "opponent-right": blastoise }));
    expect(foe.status).toBe("ready");
    if (foe.status !== "ready") return;
    expect(foe.hp["own-left"]).toMatchObject({ start: 60, low: 96, high: 96, min: 96, max: 96, average: 96, heals: ["Scizor eats Politoed's Sitrus Berry: +36 HP."] });
    expect(foe.hp["opponent-left"]).toMatchObject({ low: 84, high: 69, min: 69, max: 84, heals: [] });
    const ally = calculateDoublesTurn(await turnInput("champions", {
      "own-left": scizorAt({ hp: 60, target: "own-right" }), "own-right": toed("sitrusberry"), "opponent-left": { id: "garchomp", ability: "roughskin" }, "opponent-right": blastoise,
    }));
    expect(ally.status === "ready" && ally.hp["own-left"]).toMatchObject({ low: 96, high: 96, average: 96 });
    // BB10: Politoed at 90 faints at 7 of 16 rolls (0.4375); Scizor eats the Berry either way.
    const ko = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 60 }), "own-right": venusaur, "opponent-left": toed("sitrusberry", { hp: 90 }), "opponent-right": blastoise }));
    expect(ko.status === "ready" && ko.hp["own-left"]).toMatchObject({ low: 96, high: 96, average: 96 });
    expect(ko.status === "ready" && ko.hp["opponent-left"]!.koChance).toBeCloseTo(0.4375, 12);
    const outcomes = calculateDoublesOutcomes(await turnInput("champions", { "own-left": scizorAt({ hp: 60 }), "own-right": venusaur, "opponent-left": toed("sitrusberry"), "opponent-right": blastoise }));
    expect(outcomes.status === "ready" && [...new Set(outcomes.outcomes.flatMap((outcome) => outcome.mons["own-left"]!.hp.map((entry) => entry.hp)))]).toEqual([96]);
  });

  it("heals before Rough Skin and Life Orb, and in Ultra Sun / Ultra Moon by half for a Figy Berry", async () => {
    const garchomp: Slot = { id: "garchomp", ability: "roughskin", item: "sitrusberry" };
    // BB03: 10 → 46 → 28. BB05: 20 → 56 → 38 → 24 (Life Orb).
    const rough = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 10 }), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise }));
    expect(rough.status === "ready" && rough.hp["own-left"]).toMatchObject({ low: 28, high: 28, koChance: 0, heals: ["Scizor eats Garchomp's Sitrus Berry: +36 HP."] });
    const orb = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 20, item: "lifeorb" }), "own-right": venusaur, "opponent-left": garchomp, "opponent-right": blastoise }));
    expect(orb.status === "ready" && orb.hp["own-left"]).toMatchObject({ low: 24, high: 24, koChance: 0 });
    // BB12: 60 → 132.
    const figy = calculateDoublesTurn(await turnInput("ultra_sun_ultra_moon", { "own-left": scizorAt({ hp: 60, nature: "Modest" }), "own-right": venusaur, "opponent-left": toed("figyberry"), "opponent-right": blastoise }));
    expect(figy.status === "ready" && figy.hp["own-left"]).toMatchObject({ low: 132, high: 132, heals: ["Scizor eats Politoed's Figy Berry: +72 HP."] });
    // BB13: the target's Unnerve stops nothing (no TryEatItem): 96.
    const unnerve = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 60 }), "own-right": venusaur, "opponent-left": { id: "corviknight", ability: "unnerve", item: "sitrusberry" }, "opponent-right": blastoise }));
    expect(unnerve.status === "ready" && unnerve.hp["own-left"]).toMatchObject({ low: 96, high: 96 });
  });

  it("gives nothing to a Klutz user, under Magic Room, or at full HP", async () => {
    // BB11 (Swoobat stays 60), BB14 (60), BB15 (145).
    const klutz = calculateDoublesTurn(await turnInput("sword_shield", { "own-left": { id: "swoobat", ability: "klutz", hp: 60, move: "pluck", target: "opponent-left" }, "own-right": venusaur, "opponent-left": toed("sitrusberry"), "opponent-right": blastoise }));
    expect(klutz.status === "ready" && klutz.hp["own-left"]).toMatchObject({ low: 60, high: 60, heals: [] });
    const room = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt({ hp: 60 }), "own-right": venusaur, "opponent-left": toed("sitrusberry"), "opponent-right": blastoise }, { magicRoom: true }));
    expect(room.status === "ready" && room.hp["own-left"]).toMatchObject({ low: 60, high: 60, heals: [] });
    const full = calculateDoublesTurn(await turnInput("champions", { "own-left": scizorAt(), "own-right": venusaur, "opponent-left": toed("sitrusberry"), "opponent-right": blastoise }));
    expect(full.status === "ready" && full.hp["own-left"]).toMatchObject({ low: 145, high: 145, heals: [] });
  });

  it("cures the user's burn and raises its Defense for a later move, through Sticky Hold only as its holder faints", async () => {
    // BB06 (Trick Room): Scizor's burn is cured, so Gengar's Hex is not doubled: 79–90, average 84.875.
    const hex = calculateDoublesTurn(await turnInput("champions", {
      "own-left": scizorAt({ status: "brn" }), "own-right": venusaur, "opponent-left": toed("lumberry"), "opponent-right": { id: "gengar", ability: "cursedbody", move: "hex", target: "own-left" },
    }, { trickRoom: true }));
    expect(hex.status === "ready" && hex.hp["own-left"]).toMatchObject({ low: 90, high: 79, min: 79, max: 90, average: 84.875 });
    expect(hex.status === "ready" && hex.steps[0].hits[0].facts.map((fact) => fact.text)).toContain("Scizor eats Politoed's Lum Berry: its burn is cured.");
    const claw: Slot = { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "own-left" };
    // BB07: the stolen Kee Berry's +1 Defense: 122–126. BB08: Sticky Hold keeps it: 111–116. BB09: it faints, so 122–126.
    const sv = (target: Slot) => turnInput("scarlet_violet", { "own-left": scizorAt(), "own-right": venusaur, "opponent-left": target, "opponent-right": claw }, { trickRoom: true });
    const kee = calculateDoublesTurn(await sv(toed("keeberry")));
    expect(kee.status === "ready" && kee.hp["own-left"]).toMatchObject({ low: 126, high: 122, average: 124.25 });
    const kept = calculateDoublesTurn(await sv({ id: "gastrodon", ability: "stickyhold", item: "keeberry" }));
    expect(kept.status === "ready" && kept.hp["own-left"]).toMatchObject({ low: 116, high: 111, average: 113.75 });
    const fainted = calculateDoublesTurn(await sv({ id: "gastrodon", ability: "stickyhold", item: "keeberry", hp: 1 }));
    expect(fainted.status === "ready" && fainted.hp["own-left"]).toMatchObject({ low: 126, high: 122, average: 124.25 });
    expect(fainted.status === "ready" && fainted.steps[0].hits[0].facts.map((fact) => fact.text)).toContain("Scizor eats Gastrodon's Kee Berry: +1 Defense.");
  });

  it("does not steal with Savage Spin-Out: the holder eats its own Sitrus Berry after the hit (Ultra Sun / Ultra Moon)", async () => {
    // Verifier oracle (2v2/verify/sim-dfs.ts, case E33 of scripts/.cache/calc-audit/bugbite/verify/d-extra.ts): 183 → 92–135.
    const z = calculateDoublesTurn(await turnInput("ultra_sun_ultra_moon", {
      "own-left": scizorAt({ hp: 17, item: "buginiumz" }), "own-right": venusaur, "opponent-left": { id: "garchomp", ability: "roughskin", item: "sitrusberry" }, "opponent-right": blastoise,
    }).then((input) => ({ ...input, pokemon: { ...input.pokemon, "own-left": { ...input.pokemon["own-left"]!, contexts: { bugbite: { useZ: true } } } } })));
    expect(z.status === "ready" && z.hp["opponent-left"]).toMatchObject({ low: 95, high: 123, min: 92, max: 135, average: 120.5625, heals: ["Sitrus Berry: +45 HP."] });
  });

  it("is not estimated for a stolen Starf Berry's random stat, or a rise a foe's Opportunist copies", async () => {
    const starf = calculateDoublesTurn(await turnInput("scarlet_violet", { "own-left": scizorAt(), "own-right": venusaur, "opponent-left": toed("starfberry"), "opponent-right": blastoise }));
    expect(starf).toMatchObject({ status: "not-estimated", reason: "Starf Berry raises a random stat" });
    const copied = calculateDoublesTurn(await turnInput("scarlet_violet", { "own-left": scizorAt(), "own-right": venusaur, "opponent-left": toed("liechiberry"), "opponent-right": { id: "espathra", ability: "opportunist" } }));
    expect(copied).toMatchObject({ status: "not-estimated", reason: "Opportunist copying a stat rise is not modelled in 2v2." });
  });
});
