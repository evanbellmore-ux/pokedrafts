import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { sleepPrior, sleepTurnsLeft, snapChance, wakeChance } from "@/app/lib/battle/doubles-status";
import { calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type {
  DoublesCarried, DoublesFact, DoublesPokemonInput, DoublesSideId, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";
import { USES_REFERENCE } from "@/app/lib/battle/uses-to-ko";

/**
 * Track A of status-eot (SPEC §4.2-4.6, §9): BeforeMove, the status-move pipeline and its helpers. Every turn here is one
 * of the 2v2 oracle's cases (scripts/.cache/calc-audit/2v2/verify cases-s.ts S*, status-eot/build/track-a-cases.ts TA*),
 * whose numbers pinned Showdown c23d2e94 gave: the expected values are the oracle's, the texts the app's facts. Level 50,
 * 31 IVs, 0 EVs (Stat Points in Champions) and a Serious nature unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; level?: number; hp?: number;
  status?: BattleStatus; boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; lastMove?: string | null; moves?: string[];
};
type Slot = Mon & { move: string | null; target?: DoublesSlotId };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";

const mon = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, ...extra });
const act = (m: Mon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const idle = (m: Mon): Slot => act(m, null);
// The oracle's stand-ins (cases-s.ts): Speeds with 0 EVs are base + 20 (Snorlax and Venusaur 4 EVs: 51, 101).
const lax = (extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", { evs: { spe: 4 }, ...extra });
const saur = (extra: Partial<Mon> = {}) => mon("venusaur", "overgrow", { evs: { spe: 4 }, ...extra });
const toise = (extra: Partial<Mon> = {}) => mon("blastoise", "torrent", extra);
const chomp = (extra: Partial<Mon> = {}) => mon("garchomp", "roughskin", extra);
const zard = (extra: Partial<Mon> = {}) => mon("charizard", "blaze", extra);
const gengar = (extra: Partial<Mon> = {}) => mon("gengar", "cursedbody", extra);
const jolt = (extra: Partial<Mon> = {}) => mon("jolteon", "voltabsorb", extra);
const clef = (extra: Partial<Mon> = {}) => mon("clefable", "magicguard", extra);
const sm = (spe = 0, extra: Partial<Mon> = {}) => mon("smeargle", "technician", { evs: { spe }, ...extra });
const kingambit = (extra: Partial<Mon> = {}) => mon("kingambit", "defiant", extra);

const runtimes: Partial<Record<BattleGame, BattleRuntime>> = { champions: championsRuntime };
async function game(id: BattleGame) {
  return runtimes[id] ??= await loadBattleRuntime(id);
}
const SV = "scarlet_violet" as const;

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  return (base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, slots: (Slot | null)[], field: Partial<BattleConditions> = {}, extra: { canSwitch?: Partial<Record<DoublesSideId, boolean>> } = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, p), contexts: {}, charged: false, action: { moveId: p.move, target: p.target ?? null },
      ...(p.carried ? { carried: p.carried } : {}), ...(p.lastMove !== undefined ? { lastMove: p.lastMove } : {}), ...(p.moves ? { moves: p.moves } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon, ...extra };
}

type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "not-estimated" ? result.reason : result.status === "issues" ? result.issues : "")).toBe("ready");
  return result as Ready;
}
function reason(input: DoublesTurnInput): string {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "issues" ? result.issues : "")).toBe("not-estimated");
  return result.status === "not-estimated" ? result.reason : "";
}
const stepOf = (result: Ready, slot: DoublesSlotId): DoublesStep => {
  const step = result.steps.find((each) => each.slot === slot);
  expect(step, `a step for ${slot}`).toBeDefined();
  return step!;
};
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => {
  const hit = stepOf(result, slot).hits.find((each) => each.slot === target);
  expect(hit, `${slot}'s hit on ${target}`).toBeDefined();
  return hit!;
};
const texts = (facts: DoublesFact[]) => facts.map((fact) => fact.text);
/** The facts with their chances, rounded to 12 places (the chances are sums of float masses). */
const withChance = (facts: DoublesFact[]) => facts.map((fact) => [fact.text, Math.round(fact.chance * 1e12) / 1e12] as const);
const hitTexts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => texts(hitOf(result, slot, target).facts);

describe("the posteriors of sleep, freeze and confusion (SPEC §4.2)", () => {
  it("draws a sleep's length as pinned Showdown does", () => {
    // data/conditions.ts slp onStart: random(2, 5) (SV, SwSh, USUM); data/mods/champions: sample([2, 3, 3]); Rest: 3.
    expect(sleepPrior(false, false)).toEqual([[2, 1 / 3], [3, 1 / 3], [4, 1 / 3]]);
    expect(sleepPrior(true, false)).toEqual([[2, 1 / 3], [3, 2 / 3]]);
    expect(sleepPrior(false, true)).toEqual([[3, 1]]);
    expect(sleepPrior(true, true)).toEqual([[3, 1]]);
  });

  it("wakes by P(e < S <= e + d) / P(S > e), Early Bird counting each turn twice", () => {
    const rows: [boolean, boolean, number, number, number][] = [
      // champions, rest, elapsed, step, chance
      [false, false, 0, 1, 0], [false, false, 1, 1, 1 / 3], [false, false, 2, 1, 1 / 2], [false, false, 3, 1, 1],
      [true, false, 0, 1, 0], [true, false, 1, 1, 1 / 3], [true, false, 2, 1, 1],
      [false, true, 0, 1, 0], [false, true, 1, 1, 0], [false, true, 2, 1, 1],
      [false, false, 0, 2, 1 / 3], [false, false, 2, 2, 1], [true, false, 0, 2, 1 / 3], [false, true, 0, 2, 0], [false, true, 2, 2, 1],
    ];
    for (const [champions, rest, elapsed, step, chance] of rows) expect(wakeChance(champions, rest, elapsed, step), `${champions} ${rest} ${elapsed} ${step}`).toBeCloseTo(chance, 12);
  });

  it("expects the sleep turns left as E[ceil((S - e) / d) | S > e]", () => {
    expect(sleepTurnsLeft(false, false, 0, 1)).toBeCloseTo(3, 12);
    expect(sleepTurnsLeft(false, false, 1, 1)).toBeCloseTo(2, 12);
    expect(sleepTurnsLeft(true, false, 0, 1)).toBeCloseTo(8 / 3, 12);
    expect(sleepTurnsLeft(false, false, 0, 2)).toBeCloseTo(5 / 3, 12);
    expect(sleepTurnsLeft(false, true, 0, 1)).toBeCloseTo(3, 12);
    expect(sleepTurnsLeft(false, true, 2, 1)).toBeCloseTo(1, 12);
  });

  it("snaps out of confusion by P(T = a) / P(T >= a), T uniform on 2..5 (Axe Kick's on 3..5)", () => {
    expect([1, 2, 3, 4, 5].map((a) => snapChance(a, 2))).toEqual([0, 1 / 4, 1 / 3, 1 / 2, 1]);
    expect([1, 2, 3, 4, 5].map((a) => snapChance(a, 3))).toEqual([0, 0, 1 / 3, 1 / 2, 1]);
  });

  it("wakes a sleeper after one lost turn 1/3 of the time, an Early Bird one at once, and keeps Rest's", async () => {
    for (const id of [SV, "champions"] as const) {
      // S41a1: S in {2, 3, 4} (Champions {2: 1/3, 3: 2/3}) after one BeforeMove asleep.
      const result = ready(turn(await game(id), [act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
      expect(withChance(stepOf(result, OL).skipped)).toEqual([["Asleep.", Math.round(2 / 3 * 1e12) / 1e12]]);
      expect(withChance(stepOf(result, OL).facts)).toEqual([["Wakes up.", Math.round(1 / 3 * 1e12) / 1e12]]);
      expect(result.hp[OL]!.conditions?.map((fact) => fact.text)).toEqual(["Status cured."]);
    }
    const sv = await game(SV);
    // S41b: Early Bird: elapsed 2 after one attempt; S in {3, 4} both end at this BeforeMove.
    const early = ready(turn(sv, [act(mon("houndoom", "earlybird", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "darkpulse", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(early, OL).facts)).toEqual([["Wakes up.", 1]]);
    // S41c: Rest: S = 3, one attempt gone, still asleep.
    const rest = ready(turn(sv, [act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: true } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(rest, OL).skipped)).toEqual([["Asleep.", 1]]);
    expect(stepOf(rest, OL).moves).toBe(0);
  });

  it("thaws 1/5 in Scarlet/Violet and 1/4 after one lost turn in Champions", async () => {
    const sv = ready(turn(await game(SV), [act(lax({ status: "frz" }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(sv, OL).skipped)).toEqual([["Frozen.", 0.8]]);
    expect(withChance(stepOf(sv, OL).facts)).toEqual([["Thaws.", 0.2]]);
    const champions = ready(turn(championsRuntime, [act(lax({ status: "frz", carried: { freeze: { attempts: 1 } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(champions, OL).skipped)).toEqual([["Frozen.", 0.75]]);
    expect(withChance(stepOf(champions, OL).facts)).toEqual([["Thaws.", 0.25]]);
  });

  it("snaps out of a carried confusion 1/4 after one BeforeMove, 1/3 for Axe Kick's after two, and self-hits 33% otherwise", async () => {
    const sv = await game(SV);
    const one = ready(turn(sv, [act(chomp({ carried: { confusion: { attempts: 1 } } }), "dragonclaw", PL), idle(lax()), idle(toise()), idle(saur())]));
    expect(withChance(stepOf(one, OL).facts)).toEqual([["Snaps out of confusion.", 0.25]]);
    expect(withChance(stepOf(one, OL).skipped)).toEqual([["Hurts itself in confusion: 20–24 HP.", 0.2475]]);
    expect(withChance(one.hp[OL]!.conditions!)).toEqual([["Confused.", 0.75]]);
    const axe = ready(turn(sv, [act(chomp({ carried: { confusion: { attempts: 2, axeKick: true } } }), "dragonclaw", PL), idle(lax()), idle(toise()), idle(saur())]));
    expect(withChance(stepOf(axe, OL).facts)).toEqual([["Snaps out of confusion.", Math.round(1 / 3 * 1e12) / 1e12]]);
    expect(stepOf(axe, OL).skipped[0].chance).toBeCloseTo(0.33 * 2 / 3, 12);
  });
});

describe("BeforeMove order and facts (SPEC §4.2)", () => {
  it("stops a sleeper before its confusion: no self-hit, still confused", async () => {
    const result = ready(turn(await game(SV), [act(lax({ status: "slp", carried: { sleep: { attempts: 0, rest: false }, confusion: { attempts: 0 } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(result, OL).skipped)).toEqual([["Asleep.", 1]]);
    expect(result.hp[OL]!.min).toBe(235);
    expect(texts(result.hp[OL]!.conditions!)).toEqual(["Confused."]);
  });

  it("stops a flinch before confusion (TA49)", async () => {
    const result = ready(turn(await game(SV), [act(mon("incineroar", "blaze", { evs: { spe: 252 } }), "fakeout", PL), idle(toise()), act(chomp({ carried: { confusion: { attempts: 0 } } }), "dragonclaw", OR), idle(saur())]));
    expect(withChance(stepOf(result, PL).skipped)).toEqual([["Flinches (Fake Out).", 1]]);
  });

  it("rolls confusion before paralysis (TA48)", async () => {
    const result = ready(turn(await game(SV), [act(lax({ status: "par", carried: { confusion: { attempts: 0 } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]));
    expect(withChance(stepOf(result, OL).skipped)).toEqual([["Hurts itself in confusion: 23–28 HP.", 0.33], ["Fully paralysed.", 0.1675]]);
  });

  it("stops a move Disable or Imprison names, and nothing else", async () => {
    for (const id of [SV, "champions"] as const) {
      const runtime = await game(id);
      // S44a: Garchomp still to act, its last move Dragon Claw = its queued move.
      const disable = ready(turn(runtime, [act(gengar(), "disable", PL), idle(lax()), act(chomp({ lastMove: "dragonclaw" }), "dragonclaw", OR), idle(toise())]));
      expect(hitTexts(disable, OL, PL)).toEqual(["Disable: Dragon Claw is disabled."]);
      expect(withChance(stepOf(disable, PL).skipped)).toEqual([["Disable: Dragon Claw cannot be used.", 1]]);
      expect(texts(disable.hp[PL]!.conditions!)).toEqual(["Disabled: Dragon Claw."]);
      // S45: Gengar imprisons first: Poison Jab is one of its moves, Water Pulse is not.
      const imprison = ready(turn(runtime, [act(gengar({ moves: ["poisonjab", "shadowball", "imprison"] }), "imprison"), idle(lax()), act(chomp(), "poisonjab", OR), act(toise(), "waterpulse", OR)]));
      expect(withChance(stepOf(imprison, PL).skipped)).toEqual([["Imprison: Poison Jab cannot be used.", 1]]);
      expect(stepOf(imprison, PR).skipped).toEqual([]);
    }
  });

  it("stops No move under Gravity and under Taunt before its confusion, which hurts an untaunted one", async () => {
    const sv = await game(SV);
    // TA50: Splash has the gravity flag (Gravity 6, confusion 3).
    const gravity = ready(turn(sv, [idle(lax({ carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(saur())], { gravity: true }));
    expect(gravity.hp[OL]!.losses ?? []).toEqual([]);
    expect(gravity.hp[OL]!.min).toBe(235);
    // Without Gravity the same No move hurts itself (Champions: 23–28, 0.33).
    const plain = ready(turn(championsRuntime, [idle(lax({ carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(clef())]));
    expect(withChance(plain.hp[OL]!.losses!)).toEqual([["Snorlax hurts itself in confusion: 23–28 HP.", 0.33]]);
    // S13b: under Gravity, no No move confused by Lilligant's Teeter Dance hurts itself.
    const dance = ready(turn(sv, [act(mon("lilligant", "chlorophyll"), "teeterdance"), idle(lax()), idle(toise()), idle(saur())], { gravity: true }));
    for (const slot of [OR, PL, PR]) {
      expect(texts(dance.hp[slot]!.conditions!)).toEqual(["Confused."]);
      expect(dance.hp[slot]!.losses ?? []).toEqual([]);
    }
    // S13c: Grimmsnarl's Prankster Taunt on Snorlax, then Lilligant's Teeter Dance confuses all three: Snorlax's No move is
    // a status move (Taunt 5) and stops before confusion; Blastoise's is not taunted and hurts itself.
    const taunt = ready(turn(sv, [act(mon("lilligant", "chlorophyll"), "teeterdance"), idle(lax()), act(mon("grimmsnarl", "prankster", { evs: { spe: 4 } }), "taunt", OR), idle(toise())]));
    expect(taunt.hp[OR]!.losses ?? []).toEqual([]);
    expect(texts(taunt.hp[OR]!.conditions!)).toEqual(["Confused.", "Taunted."]);
    expect(withChance(taunt.hp[PR]!.losses!)).toEqual([["Blastoise hurts itself in confusion: 14–17 HP.", 0.33]]);
  });

  it("confuses a holder whose Figy Berry it eats as the turn starts: a fresh confusion before its move (INT01)", async () => {
    // Timid Charizard (153 HP) at 30: the Figy Berry is eaten at the turn's first Update (+51, confused: Timid lowers Attack).
    const result = ready(turn(await game(SV), [act(zard({ nature: "Timid", item: "figyberry", hp: 30 }), "flamethrower", PL), idle(toise()), idle(chomp()), idle(saur())]));
    const skipped = withChance(stepOf(result, OL).skipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0][0]).toMatch(/^Hurts itself in confusion: \d+–\d+ HP\.$/);
    expect(skipped[0][1]).toBe(0.33);
    expect(texts(result.hp[OL]!.conditions!)).toEqual(["Confused."]);
    expect(result.hp[OL]!.start).toBe(81);
  });

  it("uses Snore while asleep and fails it once awake (S47a)", async () => {
    const result = ready(turn(await game(SV), [act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "snore", PL), idle(toise()), idle(chomp()), idle(saur())]));
    const step = stepOf(result, OL);
    expect(step.skipped).toEqual([]);
    expect(withChance(step.facts)).toEqual([
      ["Wakes up.", Math.round(1 / 3 * 1e12) / 1e12], ["Asleep.", Math.round(2 / 3 * 1e12) / 1e12], ["Snore fails: Snorlax is awake.", Math.round(1 / 3 * 1e12) / 1e12],
    ]);
  });
});

describe("canStatus: one row per blocker (SPEC §4.4)", () => {
  type Row = { title: string; game?: BattleGame; slots: Slot[]; field?: Partial<BattleConditions>; user: DoublesSlotId; target: DoublesSlotId; fact: string };
  const rows: Row[] = [
    { title: "an existing status (S35b)", slots: [act(mon("whimsicott", "infiltrator"), "stunspore", PR), act(clef(), "thunderwave", PR), act(mon("milotic", "competitive", { evs: { spe: 252 }, nature: "Timid" }), "safeguard"), idle(toise())], user: OR, target: PR, fact: "Thunder Wave fails: Blastoise is already paralysed." },
    { title: "Safeguard, which an Infiltrator foe passes (S35b)", slots: [act(mon("whimsicott", "infiltrator"), "stunspore", PR), act(clef(), "thunderwave", PR), act(mon("milotic", "competitive", { evs: { spe: 252 }, nature: "Timid" }), "safeguard"), idle(toise())], user: OL, target: PR, fact: "Is paralysed." },
    { title: "Safeguard (TA54)", slots: [act(clef(), "thunderwave", PR), idle(lax()), act(mon("milotic", "competitive", { evs: { spe: 252 }, nature: "Timid" }), "safeguard"), idle(toise())], user: OL, target: PR, fact: "Safeguard: Blastoise is not affected." },
    { title: "Comatose (TA39)", slots: [act(mon("breloom", "technician"), "spore", PL), act(mon("dragapult", "clearbody"), "thunderwave", PR), idle(lax()), idle(mon("komala", "comatose"))], user: OR, target: PR, fact: "Comatose: Komala is not affected." },
    { title: "a Fire type and burn (TA53)", slots: [act(gengar(), "willowisp", PL), act(chomp({ boosts: { atk: 6 } }), "swordsdance"), idle(zard()), idle(toise())], user: OL, target: PL, fact: "Charizard is immune." },
    { title: "an Electric type and paralysis (TA38)", slots: [act(gengar(), "toxic", PL), act(mon("arbok", "intimidate"), "glare", PR), idle(mon("snorlax", "immunity")), idle(jolt())], user: OR, target: PR, fact: "Jolteon is immune." },
    // Champions (profile generation 0) runs generation 9's rules (TA56).
    { title: "an Electric type and paralysis in Champions (TA56)", game: "champions", slots: [act(mon("klefki", "prankster"), "thunderwave", PL), act(mon("arbok", "intimidate"), "glare", PR), idle(kingambit()), idle(jolt())], user: OR, target: PR, fact: "Jolteon is immune." },
    { title: "Prankster into a Dark type in Champions (TA56)", game: "champions", slots: [act(mon("klefki", "prankster"), "thunderwave", PL), act(mon("arbok", "intimidate"), "glare", PR), idle(kingambit()), idle(jolt())], user: OL, target: PL, fact: "Prankster: Kingambit is not affected." },
    { title: "Immunity (TA38)", slots: [act(gengar(), "toxic", PL), act(mon("arbok", "intimidate"), "glare", PR), idle(mon("snorlax", "immunity")), idle(jolt())], user: OL, target: PL, fact: "Immunity: Snorlax is not affected." },
    { title: "a Steel type and poison (S07b)", slots: [act(mon("vileplume", "chlorophyll"), "poisonpowder", PL), act(mon("salazzle", "corrosion"), "toxic", PR), idle(mon("magnezone", "sturdy")), idle(kingambit({ evs: { spe: 4 } }))], user: OL, target: PL, fact: "Magnezone is immune." },
    { title: "Corrosion into a Steel type (S07b)", slots: [act(mon("vileplume", "chlorophyll"), "poisonpowder", PL), act(mon("salazzle", "corrosion"), "toxic", PR), idle(mon("magnezone", "sturdy")), idle(kingambit({ evs: { spe: 4 } }))], user: OR, target: PR, fact: "Is badly poisoned." },
    { title: "Misty Terrain under a grounded target (S02d)", field: { terrain: "Misty" }, slots: [act(mon("amoonguss", "regenerator"), "spore", PL), act(mon("breloom", "technician"), "spore", PR), act(mon("dragonite", "innerfocus"), "dragonclaw", OL), idle(toise())], user: OR, target: PR, fact: "Misty Terrain: Blastoise is not affected." },
    { title: "Misty Terrain, not under a Flying target (S02d)", field: { terrain: "Misty" }, slots: [act(mon("amoonguss", "regenerator"), "spore", PL), act(mon("breloom", "technician"), "spore", PR), act(mon("dragonite", "innerfocus"), "dragonclaw", OL), idle(toise())], user: OL, target: PL, fact: "Falls asleep." },
    { title: "Electric Terrain and sleep (S02b)", field: { terrain: "Electric" }, slots: [act(mon("amoonguss", "regenerator"), "spore", PL), act(mon("breloom", "technician"), "spore", PR), idle(lax({ item: "safetygoggles" })), idle(toise())], user: OR, target: PR, fact: "Electric Terrain: Blastoise is not affected." },
    { title: "Leaf Guard in sun (TA41)", field: { weather: "Sun" }, slots: [act(mon("dragapult", "clearbody"), "thunderwave", PL), act(gengar(), "toxic", PR), idle(mon("leafeon", "leafguard")), idle(mon("miniormeteor", "shieldsdown"))], user: OL, target: PL, fact: "Leaf Guard: Leafeon is not affected." },
    { title: "Shields Down in Meteor Form (TA41)", field: { weather: "Sun" }, slots: [act(mon("dragapult", "clearbody"), "thunderwave", PL), act(gengar(), "toxic", PR), idle(mon("leafeon", "leafguard")), idle(mon("miniormeteor", "shieldsdown"))], user: OR, target: PR, fact: "Shields Down: Minior-Meteor is not affected." },
    { title: "Purifying Salt (S09b)", slots: [act(sm(), "poisongas"), idle(saur()), idle(mon("garganacl", "purifyingsalt")), idle(mon("snorlax", "immunity", { evs: { spe: 12 } }))], user: OL, target: PL, fact: "Purifying Salt: Garganacl is not affected." },
    { title: "Insomnia (TA36)", slots: [act(mon("amoonguss", "regenerator"), "spore", PL), act(mon("breloom", "technician"), "spore", PR), idle(mon("honchkrow", "insomnia")), idle(mon("annihilape", "vitalspirit"))], user: OL, target: PL, fact: "Insomnia: Honchkrow is not affected." },
    { title: "Vital Spirit (TA36)", slots: [act(mon("amoonguss", "regenerator"), "spore", PL), act(mon("breloom", "technician"), "spore", PR), idle(mon("honchkrow", "insomnia")), idle(mon("annihilape", "vitalspirit"))], user: OR, target: PR, fact: "Vital Spirit: Annihilape is not affected." },
    { title: "Limber (S06b)", slots: [act(clef(), "thunderwave", PL), act(mon("magnezone", "sturdy", { evs: { spe: 12 } }), "thunderwave", PR), idle(mon("hawlucha", "limber")), idle(jolt({ hp: 100 }))], user: OL, target: PL, fact: "Limber: Hawlucha is not affected." },
    { title: "Mold Breaker passes Limber (TA03)", slots: [act(mon("tinkaton", "moldbreaker"), "thunderwave", PL), idle(lax()), idle(mon("hawlucha", "limber")), idle(toise())], user: OL, target: PL, fact: "Is paralysed." },
    { title: "Ability Shield keeps Mold Breaker off Limber (TA42)", slots: [act(mon("tinkaton", "moldbreaker"), "thunderwave", PL), idle(lax()), idle(mon("hawlucha", "limber", { item: "abilityshield" })), idle(toise())], user: OL, target: PL, fact: "Limber: Hawlucha is not affected." },
    { title: "Water Veil (S08d)", slots: [act(gengar(), "willowisp", PL), idle(lax()), idle(mon("floatzel", "waterveil")), idle(toise())], user: OL, target: PL, fact: "Water Veil: Floatzel is not affected." },
    { title: "Thermal Exchange (TA37)", slots: [act(mon("dragapult", "clearbody"), "willowisp", PL), act(gengar(), "willowisp", PR), idle(mon("baxcalibur", "thermalexchange")), idle(mon("araquanid", "waterbubble"))], user: OL, target: PL, fact: "Thermal Exchange: Baxcalibur is not affected." },
    { title: "Water Bubble (TA37)", slots: [act(mon("dragapult", "clearbody"), "willowisp", PL), act(gengar(), "willowisp", PR), idle(mon("baxcalibur", "thermalexchange")), idle(mon("araquanid", "waterbubble"))], user: OR, target: PR, fact: "Water Bubble: Araquanid is not affected." },
    { title: "Sweet Veil on the side (TA51)", slots: [act(mon("breloom", "technician"), "spore", PL), idle(toise()), idle(lax()), idle(mon("alcremie", "sweetveil"))], user: OL, target: PL, fact: "Sweet Veil: Snorlax is not affected." },
    { title: "Pastel Veil on the side (TA52)", game: "sword_shield", slots: [act(gengar(), "toxic", PL), idle(toise()), idle(lax()), idle(mon("rapidashgalar", "pastelveil"))], user: OL, target: PL, fact: "Pastel Veil: Snorlax is not affected." },
    { title: "Flower Veil, for a Grass type on its side (TA40)", slots: [act(mon("dragapult", "clearbody"), "thunderwave", PL), act(jolt(), "thunderwave", PR), idle(saur()), idle(mon("florges", "flowerveil"))], user: OL, target: PL, fact: "Flower Veil: Venusaur is not affected." },
    { title: "Flower Veil, not for its Fairy holder (TA40)", slots: [act(mon("dragapult", "clearbody"), "thunderwave", PL), act(jolt(), "thunderwave", PR), idle(saur()), idle(mon("florges", "flowerveil"))], user: OR, target: PR, fact: "Is paralysed." },
  ];
  for (const row of rows) {
    it(row.title, async () => {
      const result = ready(turn(await game(row.game ?? SV), row.slots, row.field));
      expect(hitTexts(result, row.user, row.target)).toContain(row.fact);
    });
  }

  it("cures what a Mold Breaker gave at the action's Update (Limber onUpdate, TA03)", async () => {
    const result = ready(turn(await game(SV), [act(mon("tinkaton", "moldbreaker"), "thunderwave", PL), idle(lax()), idle(mon("hawlucha", "limber")), idle(toise())]));
    expect(result.hp[PL]!.conditions ?? []).toEqual([]);
  });

  it("passes a status back with Synchronize, as a fact about the user (TA07)", async () => {
    const result = ready(turn(await game(SV), [act(clef({ item: "lumberry" }), "thunderwave", PL), idle(lax()), idle(mon("espeon", "synchronize")), idle(toise())]));
    expect(hitTexts(result, OL, PL)).toEqual(["Is paralysed.", "Synchronize: the status goes back to Clefable."]);
    expect(texts(stepOf(result, OL).facts)).toEqual(["Clefable is paralysed."]);
    // Its Lum Berry cures it at the Update.
    expect((result.hp[OL]!.conditions ?? []).some((fact) => fact.text === "Paralysed.")).toBe(false);
  });
});

describe("the action's Update after Trick (ADDENDUM §4.12)", () => {
  const fastSm = (extra: Partial<Mon> = {}) => sm(252, { nature: "Jolly", ...extra });
  it("eats a received Sitrus Berry at its line (E16a), a Figy Berry and its confusion (E16e)", async () => {
    const sv = await game(SV);
    const sitrus = ready(turn(sv, [act(fastSm({ item: "sitrusberry" }), "trick", PL), idle(lax()), act(chomp({ hp: 80 }), "dragonclaw", OR), idle(toise())]));
    expect(sitrus.hp[PL]!.min).toBe(125);
    expect(sitrus.hp[PL]!.heals).toEqual(["Sitrus Berry: +45 HP."]);
    const figy = ready(turn(sv, [act(fastSm({ item: "figyberry" }), "trick", PL), idle(lax()), act(chomp({ hp: 40, nature: "Modest" }), "dragonclaw", OR), idle(toise())]));
    expect(hitTexts(figy, OL, PL)).toContain("Figy Berry: it becomes confused.");
    expect(withChance(stepOf(figy, PL).skipped)).toEqual([["Hurts itself in confusion: 18–22 HP.", 0.33]]); // Modest: Attack ×0.9
  });

  it("uses a received Mental Herb on a Taunt from before the Trick (E16d)", async () => {
    const result = ready(turn(await game(SV), [
      act(mon("grimmsnarl", "prankster", { evs: { spe: 4 } }), "taunt", PL), act(sm(252, { nature: "Jolly", item: "mentalherb" }), "trick", PL), act(clef(), "thunderwave", OR), idle(toise()),
    ]));
    expect(stepOf(result, PL).skipped).toEqual([]);
    expect(hitTexts(result, PL, OR)).toEqual(["Is paralysed."]);
  });
});

describe("applyBoosts (SPEC §4.4)", () => {
  it("Clear Body keeps its stats; Defiant answers a foe's drop, after it (S15a)", async () => {
    const result = ready(turn(await game(SV), [act(clef(), "charm", PL), act(mon("whimsicott", "infiltrator"), "charm", PR), idle(mon("dragapult", "clearbody")), idle(kingambit())]));
    expect(hitTexts(result, OL, PL)).toEqual(["Clear Body: its stats are not lowered."]);
    expect(hitTexts(result, OR, PR)).toEqual(["−2 Attack.", "Defiant: +2 Attack."]);
  });

  it("Defiant once per stat a foe lowered (TA01), and not for an ally's drop (TA44)", async () => {
    const sv = await game(SV);
    const tickle = ready(turn(sv, [act(clef(), "tickle", PL), idle(lax()), idle(kingambit()), idle(toise())]));
    expect(hitTexts(tickle, OL, PL)).toEqual(["−1 Attack.", "−1 Defense.", "Defiant: +2 Attack."]);
    const ally = ready(turn(sv, [act(clef(), "charm", OR), idle(kingambit()), idle(chomp()), idle(toise())]));
    expect(hitTexts(ally, OL, OR)).toEqual(["−2 Attack."]);
  });

  it("Mirror Armor sends a drop back to its user, a fact about the user; Competitive (S15b, TA06)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [act(clef(), "charm", PL), act(mon("whimsicott", "infiltrator"), "faketears", PR), idle(mon("corviknight", "mirrorarmor")), idle(mon("milotic", "competitive", { evs: { spe: 8 } }))]));
    expect(hitTexts(result, OL, PL)).toEqual(["Mirror Armor: the drop goes back to Clefable."]);
    expect(texts(stepOf(result, OL).facts)).toEqual(["Clefable: −2 Attack."]);
    expect(stepOf(result, OL).hits.map((hit) => hit.slot)).toEqual([PL]);
    expect(hitTexts(result, OR, PR)).toEqual(["−2 Sp. Def.", "Competitive: +2 Sp. Atk."]);
    const defiant = ready(turn(sv, [act(kingambit(), "scaryface", PL), idle(lax()), idle(mon("corviknight", "mirrorarmor")), idle(toise())]));
    expect(texts(stepOf(defiant, OL).facts)).toEqual(["Kingambit: −2 Speed.", "Kingambit's Defiant: +2 Attack."]);
  });

  it("Contrary, Simple, the cap, accuracy and evasion (TA17, TA43, TA53)", async () => {
    const sv = await game(SV);
    const contrary = ready(turn(sv, [act(mon("serperior", "contrary"), "coil"), idle(lax()), idle(chomp()), idle(toise())]));
    expect(hitTexts(contrary, OL, OL)).toEqual(["−1 Attack.", "−1 Defense.", "−1 accuracy."]);
    const mixed = ready(turn(sv, [act(chomp({ boosts: { atk: 5 } }), "swordsdance"), act(mon("numel", "simple"), "amnesia"), act(mon("sandaconda", "shedskin"), "sandattack", OL), act(sm(), "doubleteam")]));
    expect(hitTexts(mixed, OL, OL)).toEqual(["+1 Attack."]);
    expect(hitTexts(mixed, OR, OR)).toEqual(["+4 Sp. Def."]);
    expect(hitTexts(mixed, PL, OL)).toEqual(["−1 accuracy."]);
    expect(hitTexts(mixed, PR, PR)).toEqual(["+1 evasion."]);
    const capped = ready(turn(sv, [act(gengar(), "willowisp", PL), act(chomp({ boosts: { atk: 6 } }), "swordsdance"), idle(zard()), idle(toise())]));
    expect(hitTexts(capped, OR, OR)).toEqual(["Its Attack cannot go higher."]);
  });
});

describe("heals at an odd maximum HP (SPEC §4.4)", () => {
  it("Moonlight's modify by weather, Heal Pulse's ceil and Mega Launcher's modify, Roost's round", async () => {
    const sv = await game(SV);
    // Clefable with 4 HP EVs: 171 HP, at 1 HP.
    const low = () => clef({ evs: { hp: 4 }, hp: 1 });
    const neutral = ready(turn(sv, [act(low(), "moonlight"), idle(lax()), act(mon("clawitzer", "megalauncher"), "healpulse", PR), idle(low())]));
    expect(hitOf(neutral, OL, OL).change).toEqual({ min: 85, max: 85 }); // modify(171, 0.5)
    expect(hitOf(neutral, PL, PR).change).toEqual({ min: 128, max: 128 }); // modify(171, 0.75)
    const sun = ready(turn(sv, [act(low(), "moonlight"), idle(lax()), act(sm(), "healpulse", PR), idle(low())], { weather: "Sun" }));
    expect(hitOf(sun, OL, OL).change).toEqual({ min: 114, max: 114 }); // modify(171, 0.667)
    expect(hitOf(sun, PL, PR).change).toEqual({ min: 86, max: 86 }); // ceil(171 / 2)
    const rain = ready(turn(sv, [act(low(), "moonlight"), act(mon("corviknight", "pressure", { hp: 1 }), "roost"), idle(chomp()), idle(toise())], { weather: "Rain" }));
    expect(hitOf(rain, OL, OL).change).toEqual({ min: 43, max: 43 }); // modify(171, 0.25)
    expect(hitOf(rain, OR, OR).change).toEqual({ min: 87, max: 87 }); // round(173 / 2)
    expect(rain.hp[OR]!.min).toBe(88);
  });

  it("Shore Up in sand, Floral Healing in Grassy Terrain, Lunar Blessing on both and its cure (TA35)", async () => {
    const result = ready(turn(await game(SV), [
      act(mon("palossand", "watercompaction", { evs: { hp: 4 }, hp: 1 }), "shoreup"), act(mon("cresselia", "levitate", { hp: 1, status: "brn" }), "lunarblessing"),
      act(mon("comfey", "triage"), "floralhealing", PR), idle(clef({ evs: { hp: 4 }, hp: 2 })),
    ], { weather: "Sand", terrain: "Grassy" }));
    // Triage: Floral Healing first; then Lunar Blessing (105), Shore Up (55).
    expect(result.steps.map((step) => step.slot)).toEqual([PL, OR, OL]);
    expect(hitOf(result, PL, PR).change).toEqual({ min: 114, max: 114 }); // modify(171, 0.667)
    expect(hitOf(result, OR, OL).change).toEqual({ min: 40, max: 40 }); // modify(161, 0.25)
    expect(hitOf(result, OR, OR).change).toEqual({ min: 49, max: 49 }); // modify(195, 0.25)
    expect(hitTexts(result, OR, OR)).toEqual(["Its burn is cured."]);
    expect(hitOf(result, OL, OL).change).toEqual({ min: 107, max: 107 }); // modify(161, 0.667)
    expect([result.hp[OL]!.min, result.hp[OR]!.min, result.hp[PR]!.min]).toEqual([148, 50, 116]);
  });
});

describe("confusion damage (SPEC §4.4)", () => {
  const confused = (extra: Partial<Mon> = {}) => idle(lax({ carried: { confusion: { attempts: 0 } }, ...extra }));
  it("Snorlax 23–28, at +2 Attack 46–55, under Wonder Room 16–19 (Champions, TA28-TA30)", () => {
    const rows: [Partial<Mon>, Partial<BattleConditions>, string, number][] = [
      [{}, {}, "23–28", 207], [{ boosts: { atk: 2 } }, {}, "46–55", 180], [{}, { wonderRoom: true }, "16–19", 216],
    ];
    for (const [extra, field, range, least] of rows) {
      const result = ready(turn(championsRuntime, [confused(extra), idle(toise()), idle(chomp()), idle(clef())], field));
      expect(withChance(result.hp[OL]!.losses!)).toEqual([[`Snorlax hurts itself in confusion: ${range} HP.`, 0.33]]);
      expect(result.hp[OL]!.min).toBe(least);
    }
  });
});

describe("costs", () => {
  it("Clangorous Soul at maxhp 301: 100 HP pays floor(99.33) = 99, 99 HP fails (TA31)", async () => {
    const kommo = (hp: number) => mon("kommoo", "bulletproof", { level: 100, evs: { hp: 40 }, hp });
    const result = ready(turn(await game(SV), [act(kommo(100), "clangoroussoul"), act(kommo(99), "clangoroussoul"), idle(chomp()), idle(toise())]));
    expect(result.hp[OL]!.maximum).toBe(301);
    expect(hitOf(result, OL, OL).change).toEqual({ min: -99, max: -99 });
    expect(hitTexts(result, OL, OL)).toEqual(["+1 Attack.", "+1 Defense.", "+1 Sp. Atk.", "+1 Sp. Def.", "+1 Speed."]);
    expect(result.hp[OL]!.min).toBe(1);
    expect(texts(stepOf(result, OR).facts)).toEqual(["Clangorous Soul fails: Kommo-o (your right) has too little HP."]);
    expect(result.hp[OR]!.min).toBe(99);
  });
});

describe("the order After You and Quash give", () => {
  it("re-sorts by Speed from generation 8 and keeps the order of the Quashes in generation 7 (TA45, TA46)", async () => {
    const slots = [act(mon("murkrow", "prankster"), "quash", PR), act(mon("sableye", "prankster"), "quash", PL), act(jolt(), "thunderbolt", OL), act(chomp(), "dragonclaw", OR)];
    const sv = ready(turn(await game(SV), slots));
    expect(sv.steps.map((step) => step.slot)).toEqual([OL, OR, PL, PR]);
    expect(texts(stepOf(sv, OL).facts)).toEqual(["Quash: Garchomp moves last."]);
    const usum = ready(turn(await game("ultra_sun_ultra_moon"), slots));
    expect(usum.steps.map((step) => step.slot)).toEqual([OL, OR, PR, PL]);
  });

  it("After You moves its target next (S21a)", async () => {
    for (const id of [SV, "ultra_sun_ultra_moon"] as const) {
      const result = ready(turn(await game(id), [act(clef(), "afteryou", OR), act(lax(), "bodyslam", PL), act(toise(), "waterpulse", OL), act(saur(), "gigadrain", OL)]));
      expect(result.steps.map((step) => step.slot)).toEqual([PR, PL, OL, OR]);
      expect(texts(stepOf(result, OL).facts)).toEqual(["After You: Snorlax moves next."]);
    }
  });
});

describe("not estimated: Track A's reasons (SPEC §2.4)", () => {
  it("has the exact texts", () => {
    expect(REASONS.needsLastMove("Encore", "Garchomp")).toBe("Encore needs Garchomp's move from the last turn.");
    expect(REASONS.encoreChange("Garchomp")).toBe("Encore changes Garchomp's move: not modelled.");
    expect(REASONS.needsMoves("Gengar")).toBe("Imprison needs Gengar's moves.");
    expect(REASONS.groundingChange("Magnet Rise", "Magnezone")).toBe("Magnet Rise changes whether Magnezone is grounded: later moves are not modelled.");
    expect(REASONS.withDynamax("Pain Split")).toBe("Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.");
    expect(REASONS.faceSelfHit("Disguise")).toBe("Disguise against a confusion self-hit is not modelled in 2v2.");
    expect(REASONS.landing("Future Sight")).toBe("Future Sight landing is not modelled in 2v2.");
    expect(REASONS.formChange("Zen Mode", "Darmanitan")).toBe("Zen Mode changing Darmanitan's form is not modelled in 2v2.");
    expect(REASONS.overTime("Salt Cure")).toBe("Salt Cure's damage over time is not modelled in 2v2.");
  });

  it("gives each where its turn meets it", async () => {
    const sv = await game(SV);
    const rows: [string, DoublesTurnInput][] = [
      ["Encore needs Garchomp's move from the last turn.", turn(sv, [act(mon("whimsicott", "prankster"), "encore", PL), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())])],
      ["Disable needs Garchomp's move from the last turn.", turn(sv, [act(gengar(), "disable", PL), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())])],
      ["Encore changes Garchomp's move: not modelled.", turn(sv, [act(mon("whimsicott", "prankster"), "encore", PL), idle(lax()), act(chomp({ lastMove: "earthquake" }), "dragonclaw", OR), idle(toise())])],
      ["Imprison needs Gengar's moves.", turn(sv, [act(gengar(), "imprison"), idle(lax()), act(chomp(), "poisonjab", OR), act(toise(), "waterpulse", OR)])],
      ["Disguise against a confusion self-hit is not modelled in 2v2.", turn(sv, [act(gengar(), "confuseray", PL), idle(lax()), act(mon("mimikyu", "disguise"), "playrough", OR), idle(toise())])],
      ["Roost changes Dragonite's type: later moves are not modelled.", turn(sv, [act(mon("dragonite", "multiscale", { hp: 100, nature: "Jolly", evs: { spe: 252 } }), "roost"), idle(lax()), act(chomp(), "earthquake"), idle(toise())])],
      ["Sleep Talk is not modelled in 2v2.", turn(sv, [act(lax({ status: "slp" }), "sleeptalk"), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())])],
      ["Uproar is not modelled in 2v2.", turn(sv, [act(mon("noivern", "infiltrator"), "uproar"), idle(toise()), idle(lax({ status: "slp" })), idle(saur())])],
      ["Grimmsnarl switches out: the replacement is not known.", turn(sv, [act(mon("grimmsnarl", "prankster", { evs: { spe: 4 } }), "partingshot", PL), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())])],
    ];
    for (const [text, input] of rows) expect(reason(input)).toBe(text);
    const swsh = await game("sword_shield");
    const dynamax = turn(swsh, [act(gengar({ hp: 40 }), "painsplit", PL), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())]);
    dynamax.pokemon[PL] = { ...dynamax.pokemon[PL]!, build: { ...dynamax.pokemon[PL]!.build, mechanic: "dynamax" } as BattleBuild };
    expect(reason(dynamax)).toBe("Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.");
  });

  it("keeps a switching move with no Pokémon to switch in, and one into Clear Body, estimated", async () => {
    const sv = await game(SV);
    ready(turn(sv, [act(sm(), "teleport"), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())], {}, { canSwitch: { own: false } }));
    const clearBody = ready(turn(sv, [act(mon("grimmsnarl", "prankster", { evs: { spe: 4 } }), "partingshot", PL), idle(lax()), act(mon("dragapult", "clearbody"), "dragondarts", OR), idle(toise())]));
    expect(hitTexts(clearBody, OL, PL)).toEqual(["Clear Body: its stats are not lowered."]);
  });
});

describe("the reference turn equals the optimised one on status turns", () => {
  /** Equal, numbers within 1e-12 (relative above 1). */
  function expectClose(a: unknown, b: unknown, path: string) {
    if (typeof a === "number" && typeof b === "number") {
      expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      expect(a.length, `${path}.length`).toBe(b.length);
      a.forEach((value, i) => expectClose(value, b[i], `${path}[${i}]`));
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) expectClose((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      return;
    }
    expect(a, path).toEqual(b);
  }
  function reference(input: DoublesTurnInput): DoublesTurnResult {
    DOUBLES_REFERENCE.on = true;
    USES_REFERENCE.on = true;
    try {
      return calculateDoublesTurn(input);
    } finally {
      DOUBLES_REFERENCE.on = false;
      USES_REFERENCE.on = false;
    }
  }
  it("on 20 turns", async () => {
    const sv = await game(SV), usum = await game("ultra_sun_ultra_moon");
    const inputs: DoublesTurnInput[] = [
      turn(sv, [act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]),
      turn(championsRuntime, [act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "bodyslam", PL), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())]),
      turn(sv, [act(lax({ status: "frz" }), "bodyslam", PL), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())]),
      turn(sv, [act(chomp({ carried: { confusion: { attempts: 1 } } }), "dragonclaw", PL), idle(lax()), act(toise(), "waterpulse", OL), idle(saur())]),
      turn(sv, [act(lax({ status: "par", carried: { confusion: { attempts: 0 } } }), "bodyslam", PL), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())]),
      turn(sv, [act(mon("bellossom", "chlorophyll"), "teeterdance"), idle(lax()), act(clef({ evs: { spe: 252 }, nature: "Jolly" }), "taunt", OR), idle(toise())]),
      turn(sv, [act(gengar(), "confuseray", PL), idle(lax()), act(chomp(), "dragonclaw", OR), idle(toise())]),
      turn(sv, [act(sm(252, { nature: "Jolly" }), "swagger", PL), idle(lax()), act(chomp({ item: "persimberry" }), "dragonclaw", OR), idle(toise())]),
      turn(sv, [act(gengar(), "disable", PL), idle(lax()), act(chomp({ lastMove: "dragonclaw" }), "dragonclaw", OR), idle(toise())]),
      turn(sv, [act(gengar({ moves: ["poisonjab", "shadowball", "imprison"] }), "imprison"), idle(lax()), act(chomp(), "poisonjab", OR), act(toise(), "waterpulse", OR)]),
      turn(sv, [act(clef(), "charm", PL), act(mon("whimsicott", "infiltrator"), "faketears", PR), idle(mon("corviknight", "mirrorarmor")), idle(mon("milotic", "competitive", { evs: { spe: 8 } }))]),
      turn(sv, [act(clef({ item: "lumberry" }), "thunderwave", PL), idle(lax()), act(mon("espeon", "synchronize"), "psychic", OL), idle(toise())]),
      turn(sv, [act(clef({ evs: { hp: 4 }, hp: 1 }), "moonlight"), act(mon("corviknight", "pressure", { hp: 1 }), "roost"), act(chomp(), "dragonclaw", OL), idle(toise())], { weather: "Rain" }),
      turn(sv, [act(gengar({ hp: 60 }), "painsplit", PL), idle(lax()), act(chomp({ item: "sitrusberry", hp: 100 }), "dragonclaw", OR), idle(toise())]),
      turn(sv, [act(mon("azumarill", "hugepower", { item: "sitrusberry" }), "bellydrum"), idle(lax()), act(chomp(), "dragonclaw", OL), idle(toise())]),
      turn(sv, [act(mon("bellossom", "chlorophyll"), "strengthsap", PL), idle(lax()), act(chomp({ boosts: { atk: 2 } }), "dragonclaw", OL), idle(toise())]),
      turn(sv, [act(gengar(), "curse", PL), idle(lax()), act(chomp(), "dragonclaw", OL), idle(toise())]),
      turn(sv, [act(mon("murkrow", "prankster"), "quash", PR), act(mon("sableye", "prankster"), "quash", PL), act(jolt(), "thunderbolt", OL), act(chomp(), "dragonclaw", OR)]),
      turn(usum, [act(mon("murkrow", "prankster"), "quash", PR), act(mon("sableye", "prankster"), "quash", PL), act(jolt(), "thunderbolt", OL), act(chomp(), "dragonclaw", OR)]),
      turn(sv, [act(gengar(), "perishsong"), act(mon("hatterene", "magicbounce"), "dazzlinggleam"), act(mon("breloom", "technician"), "spore", OR), idle(mon("kommoo", "soundproof"))]),
    ];
    let estimated = 0;
    for (const [index, input] of inputs.entries()) {
      const fast = calculateDoublesTurn(input);
      expectClose(fast, reference(input), `turn ${index}`);
      if (fast.status === "ready") estimated++;
    }
    expect(estimated).toBeGreaterThanOrEqual(18);
  }, 240_000);
});

describe("the contract's validation of earlier turns (SPEC §3.1)", () => {
  it("names each impossible carried state", async () => {
    const sv = await game(SV);
    const issuesOf = (input: DoublesTurnInput, slot: DoublesSlotId) => {
      const result = calculateDoublesTurn(input);
      expect(result.status).toBe("issues");
      return result.status === "issues" ? (result.issues.pokemon[slot] ?? []).map((issue) => `${issue.field}: ${issue.message}`) : [];
    };
    const at = (m: Mon, runtime = sv) => turn(runtime, [act(m, "bodyslam", PL), idle(toise()), idle(chomp()), idle(saur())]);
    expect(issuesOf(at(lax({ carried: { sleep: { attempts: 0, rest: false } } })), OL)).toEqual(["carried.sleep: turns lost to sleep need the Asleep status."]);
    expect(issuesOf(at(lax({ status: "slp", carried: { sleep: { attempts: 4, rest: false } } })), OL)).toEqual(["carried.sleep: it cannot have lost 4 turns to sleep."]);
    expect(issuesOf(at(lax({ status: "slp", carried: { sleep: { attempts: 3, rest: true } } })), OL)).toEqual(["carried.sleep: it cannot have lost 3 turns to sleep."]);
    expect(issuesOf(at(lax({ status: "frz", carried: { freeze: { attempts: 0 } } })), OL)).toEqual(["carried.freeze: turns lost to freeze are counted in Champions only."]);
    expect(issuesOf(at(lax({ carried: { confusion: { attempts: 5 } } })), OL)).toEqual(["carried.confusion: confusion turns so far are 0 to 4."]);
    expect(issuesOf(at(lax({ lastMove: "notamove" })), OL)).toEqual(["lastMove: its last move is not in this game."]);
    expect(issuesOf(at(lax({ moves: ["bodyslam", "bodyslam"] })), OL)).toEqual(["moves: its moves list a move twice."]);
    // Early Bird counts each lost turn twice: two lost turns are the most a 2–4 turn sleep allows... and 2 × 2 = 4 is too many.
    expect(issuesOf(at(mon("houndoom", "earlybird", { status: "slp", carried: { sleep: { attempts: 2, rest: false } } })), OL)).toEqual(["carried.sleep: it cannot have lost 2 turns to sleep."]);
  });
});
