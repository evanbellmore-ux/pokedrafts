import { beforeAll, describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import { subPrefix } from "@/app/lib/battle/doubles-substitute";
import type { DoublesCarried, DoublesHit, DoublesOutcomesResult, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";

/**
 * Damaging hits into a Substitute in the 2v2 turn (status-eot ADDENDUM §4.13, doubles-substitute.ts) against pinned
 * Showdown c23d2e94, with the values of the design probes (scripts/.cache/calc-audit/status-eot/design
 * addendum-probes-3.out U1-U17, critic-probes-1.out K1-K8). The probes' Pokémon are level 50, 31 IVs, 0 EVs, Serious; a
 * probe that took the lowest rolls is compared with the turn's lowest walk (DoublesHP.low) and the "all" walk's least.
 * Showdown's p1a, p1b, p2a, p2b are own-left, own-right, opponent-right, opponent-left here.
 */
type P = {
  id: string; ability?: string; item?: string; nature?: string; level?: number; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  status?: BattleStatus; hp?: number; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried; context?: MoveContext; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon", "champions"] as const) runtimes[game] = await loadBattleRuntime(game);
});

function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  const shared = {
    nature: p.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", currentHP: p.hp ?? null, status: p.status ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p.boosts },
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...p.evs } }
    : { ...base, ...shared, native: { level: p.level ?? 50, evs: { ...ZERO, ...p.evs }, ivs: IV31 } }) as BattleBuild;
}
function input(game: BattleGame, slots: Partial<Record<DoublesSlotId, P>>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const runtime = runtimes[game];
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, p), contexts: p.move && p.context ? { [p.move]: p.context } : {}, charged: false,
      action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
const sub = (hp: number): { carried: DoublesCarried } => ({ carried: { substitute: hp } });
/** The probes' p2a (the defender): opponent-right. */
const T: DoublesSlotId = "opponent-right";
/** Attacker at p1a, Blissey at p1b, the defender at p2a and a slow Torkoal at p2b (the probes' Shuckle is not in SV). */
const pair = (attacker: P, target: P, game: BattleGame = "scarlet_violet", field: Partial<BattleConditions> = {}) =>
  input(game, { "own-left": { target: T, ...attacker }, "own-right": idle("blissey"), [T]: target, "opponent-left": idle(game === "scarlet_violet" ? "torkoal" : "shuckle") }, field);

function ready(result: DoublesTurnResult): Extract<DoublesTurnResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 300)}`);
  return result;
}
function outcomes(result: DoublesOutcomesResult) {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 300)}`);
  return result.outcomes;
}
const hitOn = (result: Extract<DoublesTurnResult, { status: "ready" }>, attacker: DoublesSlotId, target: DoublesSlotId): DoublesHit =>
  result.steps.find((step) => step.slot === attacker)!.hits.find((hit) => hit.slot === target)!;
/** A slot's Substitute HP mixture over the outcomes (none: 0). */
function subMix(list: ReturnType<typeof outcomes>, slot: DoublesSlotId): Record<number, number> {
  const out: Record<number, number> = {};
  for (const outcome of list) {
    const mon = outcome.mons[slot]!;
    for (const { hp, chance } of mon.substitute ?? [{ hp: 0, chance: 1 }]) out[hp] = (out[hp] ?? 0) + chance * outcome.chance;
  }
  return out;
}
const items = (list: ReturnType<typeof outcomes>, slot: DoublesSlotId) => [...new Set(list.map((outcome) => outcome.mons[slot]!.build.itemId))];
const close = (actual: Record<number, number>, expected: Record<number, number>) => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) expect(actual[Number(key)]).toBeCloseTo(value, 12);
};

const sorted = (classes: ReturnType<typeof subPrefix>) => [...classes].sort((a, b) => a.caseIndex - b.caseIndex || a.skip - b.skip || a.left - b.left);
describe("the prefix walk over the rolls (ADDENDUM §4.13.5)", () => {
  it("caps each hit at the Substitute's HP and stops at 0 with the hits left to continue", () => {
    expect(sorted(subPrefix([{ chance: 1, hits: [{ values: [10, 12], weights: [0.5, 0.5] }] }], 11))).toEqual([
      { caseIndex: 0, skip: 1, left: 0, mass: 0.5 }, { caseIndex: 0, skip: 1, left: 1, mass: 0.5 },
    ]);
    const three = (start: number) => subPrefix([{ chance: 1, hits: [0, 1, 2].map(() => ({ values: [10], weights: [1] })) }], start);
    expect(three(25)).toEqual([{ caseIndex: 0, skip: 3, left: 0, mass: 1 }]);
    expect(three(15)).toEqual([{ caseIndex: 0, skip: 2, left: 0, mass: 1 }]);
    expect(three(31)).toEqual([{ caseIndex: 0, skip: 3, left: 1, mass: 1 }]);
  });
  it("walks each case of a random hit count apart, merging equal (case, hits, HP left)", () => {
    const hit = { values: [20, 25], weights: [0.5, 0.5] };
    const classes = subPrefix([{ chance: 0.5, hits: [hit, hit] }, { chance: 0.5, hits: [hit, hit, hit] }], 50);
    // Two hits: 40 (1/4), 45 (1/2), 50 breaks on the second (1/4). Three: the third breaks every path left at 5 or 10.
    expect(sorted(classes)).toEqual([
      { caseIndex: 0, skip: 2, left: 0, mass: 0.125 }, { caseIndex: 0, skip: 2, left: 5, mass: 0.25 }, { caseIndex: 0, skip: 2, left: 10, mass: 0.125 },
      { caseIndex: 1, skip: 2, left: 0, mass: 0.125 }, { caseIndex: 1, skip: 3, left: 0, mass: 0.375 },
    ]);
    expect(classes.reduce((sum, each) => sum + each.mass, 0)).toBeCloseTo(1, 15);
  });
});

describe("a single hit into a Substitute (U1, U16)", () => {
  it("Lapras Ice Beam into Snorlax's 40-HP Substitute: its HP after every roll, Snorlax untouched", () => {
    for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const attacker: P = game === "champions" ? { id: "garchomp", move: "dragonclaw" } : { id: "lapras", ability: "shellarmor", move: "icebeam" };
      const turn = game === "champions"
        ? input(game, { "own-left": { target: T, ...attacker }, "own-right": idle("venusaur"), [T]: idle("snorlax", { ability: "thickfat", ...sub(200) }), "opponent-left": idle("torkoal") })
        : pair(attacker, idle("snorlax", { ability: "thickfat", ...sub(40) }), game);
      const result = ready(calculateDoublesTurn(turn));
      const hit = hitOn(result, "own-left", T);
      expect(hit.kind, game).toBe("substitute");
      expect(hit).toMatchObject({ reached: 1, min: null, max: null, koChance: 0, substitute: { chance: 1, breaks: 0 } });
      expect(hit.row?.moveId).toBe(attacker.move);
      expect(result.hp[T]).toMatchObject({ start: 235, min: 235, max: 235, koChance: 0 });
      if (game === "scarlet_violet") {
        expect(hit.substitute).toEqual({ chance: 1, min: 21, max: 25, breaks: 0 });
        close(subMix(outcomes(calculateDoublesOutcomes(turn)), T), { 18: 0.375, 16: 0.3125, 19: 0.25, 15: 0.0625 });
        expect(result.hp[T]!.conditions).toEqual([
          { text: "Substitute: 19 HP.", chance: 0.25 }, { text: "Substitute: 18 HP.", chance: 0.375 }, { text: "Substitute: 16 HP.", chance: 0.3125 }, { text: "Substitute: 15 HP.", chance: 0.0625 },
        ]);
      }
      const list = outcomes(calculateDoublesOutcomes(turn));
      expect(list.every((outcome) => outcome.mons[T]!.volatiles?.includes("substitute"))).toBe(true);
    }
  });

  it("a Substitute it breaks: the share, the fact, no Substitute after; a Shed Tail one of more than a quarter is any Substitute (K3)", () => {
    const result = ready(calculateDoublesTurn(pair({ id: "lapras", ability: "shellarmor", move: "icebeam" }, idle("snorlax", { ability: "thickfat", ...sub(23) }))));
    const hit = hitOn(result, "own-left", T);
    // Rolls 21 and 22 (10/16) leave it standing; 24 and 25 break it.
    expect(hit.substitute).toEqual({ chance: 1, min: 21, max: 23, breaks: 0.375 });
    expect(hit.facts).toContainEqual({ text: "Its Substitute breaks.", chance: 0.375 });
    // Hatterene's quarter is 32: a 44-HP Substitute from Shed Tail is taken as it is.
    const big = calculateDoublesOutcomes(pair({ id: "lapras", ability: "shellarmor", move: "icebeam" }, idle("hatterene", { ability: "magicbounce", ...sub(44) })));
    expect(Math.max(...Object.keys(subMix(outcomes(big), T)).map(Number))).toBeLessThan(44);
  });
});

describe("the attacker through the hit (U2, U3, K2, K7)", () => {
  const snorlax = (hp: number, extra: Partial<P> = {}) => idle("snorlax", { ability: "thickfat", ...sub(hp), ...extra });
  it("recoil from the damage the Substitute took (U2: 153 → 143; U2b: 126 at the lowest roll)", () => {
    const capped = ready(calculateDoublesTurn(pair({ id: "talonflame", move: "bravebird" }, snorlax(30))));
    expect(capped.hp["own-left"]).toMatchObject({ min: 143, max: 143 });
    const whole = ready(calculateDoublesTurn(pair({ id: "talonflame", move: "bravebird" }, snorlax(200))));
    expect(whole.hp["own-left"]).toMatchObject({ low: 126, max: 126 });
  });
  it("drain ceil(taken × 3/4) (U2c: 40 → 58, Big Root 63); Liquid Ooze deals the raw amount, at full HP too (U2d, K2)", () => {
    const kiss = (extra: Partial<P>, target: P) => ready(calculateDoublesTurn(pair({ id: "sylveon", ability: "pixilate", move: "drainingkiss", ...extra }, target)));
    expect(kiss({ hp: 40 }, snorlax(23)).hp["own-left"]).toMatchObject({ min: 58, max: 58 });
    expect(kiss({ hp: 40, item: "bigroot" }, snorlax(23)).hp["own-left"]).toMatchObject({ min: 63, max: 63 });
    const ooze = idle("tentacruel", { ability: "liquidooze", ...sub(23) });
    expect(kiss({ hp: 40 }, ooze).hp["own-left"]).toMatchObject({ low: 30 });
    expect(kiss({ hp: 40, item: "bigroot" }, ooze).hp["own-left"]).toMatchObject({ low: 30 });
    expect(kiss({}, ooze).hp["own-left"]).toMatchObject({ low: 160 });
    expect(kiss({ item: "bigroot" }, ooze).hp["own-left"]).toMatchObject({ low: 160 });
  });
  it("a draining contact move into a Substitute meets no Rough Skin (E25b)", () => {
    // Alcremie (Sweet Veil) at 60 HP: Draining Kiss into a 23-HP Substitute heals ceil(23 × 3/4) = 18; Rough Skin does not act.
    const kiss = (ability: string) => ready(calculateDoublesTurn(pair({ id: "alcremie", ability: "sweetveil", hp: 60, move: "drainingkiss" },
      idle("garchomp", { ability, ...sub(23) })))).hp["own-left"]!.min;
    expect(kiss("sandveil")).toBe(78);
    expect(kiss("roughskin")).toBe(78);
  });
  it("Life Orb costs a tenth once; Shell Bell heals nothing; a Gem is spent (U3)", () => {
    const body = (item: string) => pair({ id: "snorlax", ability: "thickfat", hp: 100, item, move: "bodyslam" }, idle("chansey", { ability: "naturalcure", ...sub(80) }));
    expect(ready(calculateDoublesTurn(body("lifeorb"))).hp["own-left"]).toMatchObject({ min: 77, max: 77 });
    expect(ready(calculateDoublesTurn(body("shellbell"))).hp["own-left"]).toMatchObject({ min: 100, max: 100 });
    expect(items(outcomes(calculateDoublesOutcomes(body("normalgem"))), "own-left")).toEqual([""]);
  });
  it("Steel Beam costs half once; Brave Bird with Shell Bell: recoil only (K7)", () => {
    const beam = ready(calculateDoublesTurn(pair({ id: "metagross", move: "steelbeam" }, snorlax(300))));
    const max = beam.start["own-left"]!.maximum;
    expect(beam.hp["own-left"]).toMatchObject({ min: max - Math.round(max / 2), max: max - Math.round(max / 2) });
    const bell = ready(calculateDoublesTurn(pair({ id: "talonflame", item: "shellbell", move: "bravebird" }, snorlax(300))));
    expect(bell.hp["own-left"]!.low).toBe(126);
    expect(bell.hp["own-left"]!.heals).toEqual([]);
  });
  it("an attacker its recoil faints: no step, the faint, and the target's Air Balloon still pops", () => {
    const turn = pair({ id: "talonflame", hp: 5, move: "bravebird" }, idle("snorlax", { ability: "thickfat", item: "airballoon", ...sub(300) }));
    const result = ready(calculateDoublesTurn(turn));
    expect(result.hp["own-left"]).toMatchObject({ min: 0, max: 0, koChance: 1 });
    expect(result.steps[0].facts.map((fact) => fact.text)).toContain("Talonflame faints (recoil).");
    expect(items(outcomes(calculateDoublesOutcomes(turn)), T)).toEqual([""]);
    // Behind the Substitute, Rough Skin does not act: the fact names the recoil alone.
    const skin = ready(calculateDoublesTurn(pair({ id: "talonflame", hp: 5, move: "bravebird" }, idle("garchomp", { ability: "roughskin", ...sub(300) }))));
    expect(skin.steps[0].facts.map((fact) => fact.text)).toContain("Talonflame faints (recoil).");
  });
  it("a Berry the prefix's Update ate: in the world, with its heal", () => {
    // Talonflame (153) at 90 HP: recoil 27–32 takes it to half or less; Sitrus +38 at the hit's Update.
    const turn = pair({ id: "talonflame", hp: 90, item: "sitrusberry", move: "bravebird" }, idle("snorlax", { ability: "thickfat", ...sub(300) }));
    const result = ready(calculateDoublesTurn(turn));
    expect(result.hp["own-left"]).toMatchObject({ low: 90 - 27 + 38, min: 90 - 32 + 38, max: 90 - 27 + 38 });
    expect(result.hp["own-left"]!.heals).toEqual(["Sitrus Berry: +38 HP."]);
    expect(items(outcomes(calculateDoublesOutcomes(turn)), "own-left")).toEqual([""]);
  });
});

describe("a multi-hit move continues into the Pokémon (U4, U4b, U4c, U4d, K1, K8)", () => {
  it("Icicle Spear (Skill Link) into a 30-HP Substitute: the rest into Snorlax (U4: 215 at the lowest rolls)", () => {
    const result = ready(calculateDoublesTurn(pair({ id: "cloyster", ability: "skilllink", move: "iciclespear" }, idle("snorlax", { ability: "thickfat", item: "rockyhelmet", ...sub(30) }))));
    const hit = hitOn(result, "own-left", T);
    expect(hit.kind).toBe("calculated");
    expect(hit.substitute).toEqual({ chance: 1, min: 30, max: 30, breaks: 1 });
    // min and max are the hits that reached the Pokémon: two of 10–13 (the whole move's 50–65 went partly into the Substitute).
    expect([hit.min, hit.max]).toEqual([20, 26]);
    expect(hit.facts.map((fact) => fact.text)).toEqual(["Its Substitute breaks.", "Icicle Spear hits Snorlax after its Substitute breaks."]);
    expect(result.hp[T]!.low).toBe(215);
    // Icicle Spear makes no contact: no Rocky Helmet.
    expect(result.hp["own-left"]).toMatchObject({ min: 125, max: 125 });
  });
  it("Triple Axel keeps its absolute powers after a break (U4c: 188 at the lowest rolls)", () => {
    const result = ready(calculateDoublesTurn(pair({ id: "weavile", move: "tripleaxel" }, idle("snorlax", { ability: "thickfat", ...sub(10) }))));
    expect(result.hp[T]!.low).toBe(188);
  });
  it("a Focus Sash at full HP saves on the first hit into the Pokémon (U4d)", () => {
    const turn = pair({ id: "cloyster", ability: "skilllink", level: 100, evs: { atk: 252 }, move: "iciclespear" }, idle("snorlax", { ability: "thickfat", item: "focussash", level: 5, ...sub(10) }));
    const result = ready(calculateDoublesTurn(turn));
    expect(result.hp[T]).toMatchObject({ min: 0, max: 0, koChance: 1 });
    expect(items(outcomes(calculateDoublesOutcomes(turn)), T)).toEqual([""]);
  });
  it("Bullet Seed 2–5 into a 50-HP Substitute: two hits break it, the rest continue (U4b: 235, 198, 161, 124 at the lowest rolls)", () => {
    const turn = pair({ id: "breloom", ability: "technician", move: "bulletseed" }, idle("snorlax", { ability: "thickfat", ...sub(50) }));
    const result = ready(calculateDoublesTurn(turn));
    const hit = hitOn(result, "own-left", T);
    expect(hit.kind).toBe("calculated");
    expect(hit.substitute).toMatchObject({ chance: 1, max: 50, breaks: 1 });
    expect(result.hp[T]).toMatchObject({ low: 235, max: 235 });
    // The 2-hit share (0.35) leaves Snorlax untouched.
    let untouched = 0;
    for (const outcome of outcomes(calculateDoublesOutcomes(turn))) for (const { hp, chance } of outcome.mons[T]!.hp) if (hp === 235) untouched += chance * outcome.chance;
    expect(untouched).toBeCloseTo(0.35, 12);
  });
  it("Rage Fist counts every hit of the move once a hit reached the Pokémon, none while all met the Substitute (K1)", () => {
    const fist = (hp: number | null) => {
      const target = idle("annihilape", { move: "ragefist", target: "opponent-left", ...(hp ? sub(hp) : {}) });
      const result = ready(calculateDoublesTurn(input("scarlet_violet", {
        "own-left": { id: "cloyster", ability: "skilllink", move: "iciclespear", target: T, evs: { spe: 252 } }, "own-right": idle("blissey"), [T]: target, "opponent-left": idle("hatterene"),
      })));
      return hitOn(result, T, "opponent-left").row!.effectivePower;
    };
    expect(fist(30)).toBe(fist(null));
    expect(fist(30)).toBe(300);
    expect(fist(300)).toBe(50);
  });
  it("Dual Wingbeat into Rocky Helmet after a break on hit 1: Rocky Helmet once (K8)", () => {
    const result = ready(calculateDoublesTurn(pair({ id: "scizor", ability: "technician", move: "dualwingbeat" }, idle("snorlax", { ability: "thickfat", item: "rockyhelmet", ...sub(10) }))));
    const max = result.start["own-left"]!.maximum;
    expect(result.hp["own-left"]).toMatchObject({ min: max - Math.floor(max / 6), max: max - Math.floor(max / 6) });
  });
});

describe("spread moves, passing moves (U5, U6)", () => {
  it("Rock Slide hits the Substitute with the spread modifier: the twin's damage (U5: 162 and 197 at the lowest roll)", () => {
    const turn = input("scarlet_violet", {
      "own-left": { id: "garchomp", move: "rockslide" }, "own-right": idle("blissey"), [T]: idle("snorlax", { ability: "thickfat", ...sub(200) }), "opponent-left": idle("snorlax", { ability: "thickfat" }),
    });
    const result = ready(calculateDoublesTurn(turn));
    const behind = hitOn(result, "own-left", T), twin = hitOn(result, "own-left", "opponent-left");
    expect(behind.kind).toBe("substitute");
    expect([behind.substitute!.min, behind.substitute!.max]).toEqual([twin.min, twin.max]);
    expect(result.hp["opponent-left"]!.low).toBe(197);
    expect(Math.max(...Object.keys(subMix(outcomes(calculateDoublesOutcomes(turn)), T)).map(Number))).toBe(162);
  });
  it("Hyper Voice (sound) and Infiltrator pass it (U6)", () => {
    const voice = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "sylveon", move: "hypervoice" }, "own-right": idle("blissey"), [T]: idle("snorlax", sub(30)), "opponent-left": idle("torkoal"),
    })));
    expect(hitOn(voice, "own-left", T)).toMatchObject({ kind: "calculated" });
    expect(hitOn(voice, "own-left", T).substitute).toBeUndefined();
    const infiltrator = ready(calculateDoublesTurn(pair({ id: "dragapult", ability: "infiltrator", move: "dragonclaw" }, idle("snorlax", sub(30)))));
    expect(hitOn(infiltrator, "own-left", T).kind).toBe("calculated");
  });
  it("a Pokémon that faints loses its Substitute (clearVolatile): no substitute volatile in its outcome", () => {
    const list = outcomes(calculateDoublesOutcomes(input("scarlet_violet", {
      "own-left": { id: "sylveon", ability: "pixilate", move: "hypervoice" }, "own-right": idle("blissey"), [T]: idle("garchomp", { hp: 1, ...sub(40) }), "opponent-left": idle("torkoal"),
    })));
    for (const outcome of list) {
      const mon = outcome.mons[T]!;
      expect(mon.hp).toEqual([{ hp: 0, chance: 1 }]);
      expect(mon.volatiles).toBeUndefined();
      expect(mon.substitute).toBeUndefined();
    }
  });
});

describe("nothing of the Pokémon behind it reacts (U7, U8, U9, K6)", () => {
  const behind = (attacker: P, target: P) => pair(attacker, { ...target, ...sub(300) });
  it("Rough Skin, Rocky Helmet: the attacker keeps its HP; Weakness Policy and Stamina do not act", () => {
    const rough = ready(calculateDoublesTurn(behind({ id: "garchomp", move: "dragonclaw" }, idle("garchomp", { ability: "roughskin" }))));
    expect(rough.hp["own-left"]).toMatchObject({ min: rough.start["own-left"]!.hp, max: rough.start["own-left"]!.hp });
    const helmet = ready(calculateDoublesTurn(behind({ id: "snorlax", move: "bodyslam" }, idle("chansey", { item: "rockyhelmet" }))));
    expect(helmet.hp["own-left"]!.min).toBe(helmet.start["own-left"]!.hp);
    const policy = calculateDoublesOutcomes(behind({ id: "lapras", move: "icebeam" }, idle("garchomp", { item: "weaknesspolicy" })));
    expect(outcomes(policy).every((outcome) => outcome.mons[T]!.build.itemId === "weaknesspolicy" && outcome.mons[T]!.build.boosts.atk === 0)).toBe(true);
    const stamina = calculateDoublesOutcomes(behind({ id: "snorlax", move: "bodyslam" }, idle("mudsdale", { ability: "stamina" })));
    expect(outcomes(stamina).every((outcome) => outcome.mons[T]!.build.boosts.def === 0)).toBe(true);
  });
  it("a resist Berry is neither eaten nor halves, and is put back after the step (U7: Occa = no Berry)", () => {
    const flame = (item: string) => ready(calculateDoublesTurn(behind({ id: "charizard", move: "flamethrower" }, idle("kingambit", { item }))));
    const occa = hitOn(flame("occaberry"), "own-left", T).substitute!, none = hitOn(flame(""), "own-left", T).substitute!;
    expect([occa.min, occa.max]).toEqual([none.min, none.max]);
    expect(items(outcomes(calculateDoublesOutcomes(behind({ id: "charizard", move: "flamethrower" }, idle("kingambit", { item: "occaberry" })))), T)).toEqual(["occaberry"]);
  });
  it("Knock Off keeps its 1.5× for any removable item, the Berry included, and takes nothing (U7, K6)", () => {
    const knock = (item: string) => hitOn(ready(calculateDoublesTurn(behind({ id: "incineroar", move: "knockoff" }, idle("gengar", { item })))), "own-left", T).substitute!;
    expect(knock("colburberry")).toEqual(knock("leftovers"));
    expect(knock("leftovers").min).toBeGreaterThan(knock("").min);
    expect(items(outcomes(calculateDoublesOutcomes(behind({ id: "incineroar", move: "knockoff" }, idle("gengar", { item: "colburberry" })))), T)).toEqual(["colburberry"]);
  });
  it("an Air Balloon pops (U7)", () => {
    expect(items(outcomes(calculateDoublesOutcomes(behind({ id: "snorlax", move: "bodyslam" }, idle("chansey", { item: "airballoon" })))), T)).toEqual([""]);
  });
  it("the user's own effects happen, the target's do not (U8)", () => {
    const after = (attacker: P, target: P = idle("snorlax")) => outcomes(calculateDoublesOutcomes(behind(attacker, target)));
    expect(after({ id: "breloom", move: "closecombat" }).map((outcome) => [outcome.mons["own-left"]!.build.boosts.def, outcome.mons["own-left"]!.build.boosts.spd])).toEqual([[-1, -1]]);
    expect(after({ id: "talonflame", move: "flamecharge" }).map((outcome) => outcome.mons["own-left"]!.build.boosts.spe)).toEqual([1]);
    expect(after({ id: "pawmot", move: "nuzzle" }).map((outcome) => outcome.mons[T]!.build.status)).toEqual([""]);
    const fake = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "incineroar", move: "fakeout", target: T }, "own-right": idle("blissey"), [T]: { id: "snorlax", move: "bodyslam", target: "own-left", ...sub(300) }, "opponent-left": idle("torkoal"),
    })));
    expect(fake.steps.find((step) => step.slot === T)!.moves).toBe(1);
    const spinner = calculateDoublesOutcomes(pair({ id: "weavile", move: "icespinner" }, idle("snorlax", sub(300)), "scarlet_violet", { terrain: "Psychic" }));
    expect(outcomes(spinner).map((outcome) => outcome.field.terrain)).toEqual([""]);
  });
  it("Dragon Tail drags nothing out of a Substitute; Focus Punch behind one keeps its focus (U8, U14)", () => {
    const tail = calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "garchomp", move: "dragontail", target: T, evs: { spe: 252 } }, "own-right": idle("blissey"), [T]: { id: "snorlax", move: "bodyslam", target: "own-right", ...sub(300) }, "opponent-left": idle("torkoal"),
    }));
    expect(tail.status).toBe("ready");
    const punch = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "lapras", move: "icebeam", target: T }, "own-right": idle("blissey"), [T]: { id: "breloom", move: "focuspunch", target: "own-right", ...sub(300) }, "opponent-left": idle("torkoal"),
    })));
    expect(punch.steps.find((step) => step.slot === T)).toMatchObject({ moves: 1, skipped: [] });
  });
  it("U-turn into a Substitute switches its user out: with a later action, not estimated (U8)", () => {
    const later = calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "talonflame", move: "uturn", target: T, evs: { spe: 252 } }, "own-right": idle("blissey"), [T]: { id: "snorlax", move: "bodyslam", target: "own-right", ...sub(300) }, "opponent-left": idle("torkoal"),
    }));
    expect(later).toMatchObject({ status: "not-estimated", reason: "Talonflame switches out: the replacement is not known." });
  });
  it("an intact Disguise behind it: the Substitute takes the full damage, Mimikyu stays disguised (U9)", () => {
    const turn = behind({ id: "gengar", move: "shadowball" }, idle("mimikyu", { ability: "disguise" }));
    const hit = hitOn(ready(calculateDoublesTurn(turn)), "own-left", T);
    expect(hit.kind).toBe("substitute");
    expect(hit.substitute!.min).toBeGreaterThan(0);
    expect(outcomes(calculateDoublesOutcomes(turn)).map((outcome) => [outcome.mons[T]!.build.speciesId, outcome.mons[T]!.build.abilityId])).toEqual([["mimikyu", "disguise"]]);
  });
});

describe("the Pokémon's HP read through a Substitute (U11, U12)", () => {
  it("Super Fang deals half the Pokémon's HP, capped at the Substitute's; Seismic Toss its level (U12)", () => {
    const fang = (subHP: number) => outcomes(calculateDoublesOutcomes(pair({ id: "cinccino", move: "superfang" }, idle("snorlax", { hp: 200, ...sub(subHP) }))));
    close(subMix(fang(300), T), { 200: 1 });
    close(subMix(fang(30), T), { 0: 1 });
    close(subMix(outcomes(calculateDoublesOutcomes(pair({ id: "chansey", move: "seismictoss" }, idle("snorlax", { hp: 200, ...sub(300) })))), T), { 250: 1 });
  });
  it("a certain critical hit crits the Substitute (U11: Flower Trick)", () => {
    const crit = hitOn(ready(calculateDoublesTurn(pair({ id: "meowscarada", move: "flowertrick" }, idle("snorlax", sub(300))))), "own-left", T);
    const plain = hitOn(ready(calculateDoublesTurn(pair({ id: "meowscarada", move: "flowertrick" }, idle("snorlax")))), "own-left", T);
    expect([crit.substitute!.min, crit.substitute!.max]).toEqual([plain.min, plain.max]);
  });
});

describe("the narrow guards (ADDENDUM §4.13.2, §4.13.6)", () => {
  const reason = (turn: DoublesTurnInput) => {
    const result = calculateDoublesTurn(turn);
    return result.status === "not-estimated" ? result.reason : result.status;
  };
  it("a multi-hit move in front of the per-hit effects the engine reads, and an intact Disguise", () => {
    const spear = (target: P) => reason(pair({ id: "cloyster", ability: "skilllink", move: "iciclespear" }, { ...target, ...sub(30) }));
    expect(spear(idle("dragonite", { ability: "multiscale" }))).toBe("Icicle Spear into Dragonite's Substitute with Multiscale is not modelled in 2v2.");
    expect(spear(idle("mudsdale", { ability: "stamina" }))).toBe("Icicle Spear into Mudsdale's Substitute with Stamina is not modelled in 2v2.");
    expect(spear(idle("garchomp", { item: "yacheberry" }))).toBe("Icicle Spear into Garchomp's Substitute with Yache Berry is not modelled in 2v2.");
    expect(spear(idle("mimikyu", { ability: "disguise" }))).toBe("Disguise against a multi-hit move is not modelled in 2v2.");
    // Multiscale below full HP and a Berry for another type read nothing per hit.
    expect(spear(idle("dragonite", { ability: "multiscale", hp: 100 }))).toBe("ready");
    expect(spear(idle("garchomp", { item: "occaberry" }))).toBe("ready");
    // A single hit is exact in front of each.
    expect(reason(pair({ id: "lapras", move: "icebeam" }, idle("dragonite", { ability: "multiscale", ...sub(30) })))).toBe("ready");
    expect(reason(pair({ id: "scizor", move: "dualwingbeat" }, idle("oinkologne", { ability: "lingeringaroma", ...sub(30) }))))
      .toBe("Dual Wingbeat into Oinkologne's Substitute with Lingering Aroma is not modelled in 2v2.");
  });
  it("Magician with an item to take; Max Moves; Mind Blown; a signature Z-Move with an effect of its own", () => {
    expect(reason(pair({ id: "delphox", ability: "magician", move: "flamethrower" }, idle("snorlax", { item: "leftovers", ...sub(300) }))))
      .toBe("Magician into a Substitute is not modelled in 2v2.");
    expect(reason(pair({ id: "delphox", ability: "magician", move: "flamethrower" }, idle("snorlax", sub(300))))).toBe("ready");
    const max = pair({ id: "lapras", move: "icebeam" }, idle("snorlax", sub(300)), "sword_shield");
    max.pokemon["own-left"]!.build = { ...max.pokemon["own-left"]!.build, mechanic: "dynamax" };
    expect(reason(max)).toBe("Max Moves into a Substitute is not modelled in 2v2.");
    expect(reason(pair({ id: "blacephalon", move: "mindblown", target: null }, idle("snorlax", sub(300)), "ultra_sun_ultra_moon"))).toBe("Mind Blown into a Substitute is not modelled in 2v2.");
    expect(reason(pair({ id: "lycanroc", item: "lycaniumz", move: "stoneedge", context: { useZ: true } }, idle("snorlax", sub(300)), "ultra_sun_ultra_moon")))
      .toBe("Splintered Stormshards into a Substitute is not modelled in 2v2.");
    // A type Z-Move is modelled (U16b).
    expect(reason(pair({ id: "lapras", item: "iciumz", move: "icebeam", context: { useZ: true } }, idle("snorlax", sub(300)), "ultra_sun_ultra_moon"))).toBe("ready");
  });
});

describe("reference mode equals the normal mode on Substitute turns", () => {
  it("ten turns", () => {
    const turns: DoublesTurnInput[] = [
      pair({ id: "lapras", ability: "shellarmor", move: "icebeam" }, idle("snorlax", sub(40))),
      pair({ id: "talonflame", move: "bravebird" }, idle("snorlax", sub(200))),
      pair({ id: "sylveon", ability: "pixilate", hp: 40, move: "drainingkiss" }, idle("tentacruel", { ability: "liquidooze", ...sub(23) })),
      pair({ id: "cloyster", ability: "skilllink", move: "iciclespear" }, idle("snorlax", { item: "rockyhelmet", ...sub(30) })),
      pair({ id: "breloom", ability: "technician", move: "bulletseed" }, idle("snorlax", { item: "sitrusberry", ...sub(50) })),
      pair({ id: "scizor", ability: "technician", move: "dualwingbeat" }, idle("snorlax", { item: "rockyhelmet", ...sub(10) })),
      pair({ id: "talonflame", hp: 90, item: "sitrusberry", move: "bravebird" }, idle("snorlax", sub(300))),
      pair({ id: "cinccino", move: "superfang" }, idle("snorlax", { hp: 200, ...sub(30) })),
      input("scarlet_violet", { "own-left": { id: "garchomp", move: "rockslide" }, "own-right": idle("blissey"), [T]: idle("snorlax", sub(40)), "opponent-left": idle("snorlax", sub(39)) }),
      input("scarlet_violet", {
        "own-left": { id: "cloyster", ability: "skilllink", move: "iciclespear", target: T }, "own-right": { id: "garchomp", move: "rockslide" },
        [T]: { id: "snorlax", move: "bodyslam", target: "own-left", ...sub(45) }, "opponent-left": idle("torkoal"),
      }),
    ];
    for (const [index, turn] of turns.entries()) {
      const normal = calculateDoublesTurn(turn), normalOut = calculateDoublesOutcomes(turn);
      DOUBLES_REFERENCE.on = true;
      try {
        const reference = calculateDoublesTurn(turn), referenceOut = calculateDoublesOutcomes(turn);
        expect(ready(reference).hp, `turn ${index}`).toEqual(ready(normal).hp);
        expect(ready(reference).steps.map((step) => step.hits.map((hit) => [hit.kind, hit.substitute, hit.koChance])), `turn ${index}`)
          .toEqual(ready(normal).steps.map((step) => step.hits.map((hit) => [hit.kind, hit.substitute, hit.koChance])));
        for (const slot of SLOTS) expect(subMix(outcomes(referenceOut), slot), `turn ${index} ${slot}`).toEqual(subMix(outcomes(normalOut), slot));
      } finally {
        DOUBLES_REFERENCE.on = false;
      }
    }
  });
});
