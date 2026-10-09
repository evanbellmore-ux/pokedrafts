import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesFact, DoublesPokemonInput, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * The status-eot review's engine findings (scripts/.cache/calc-audit/status-eot/review/reviews.json; FIX-engine.md), each as
 * the review's or the fix's 2v2 oracle case (review/status-move/cases.ts RV*, review/track-e/cases.ts RE*, fix-engine/cases.ts
 * FX*): the expected numbers are pinned Showdown c23d2e94's, the texts the app's facts. Level 50, 31 IVs, 0 EVs (Stat Points in
 * Champions) and a Serious nature unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; hp?: number; status?: BattleStatus;
  boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; build?: Partial<BattleBuild>;
};
type Slot = (Mon & { move: string | null; target?: DoublesSlotId }) | null;
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";

const mon = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, ...extra });
const act = (m: Mon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const idle = (m: Mon): Slot => act(m, null);
// The oracle's stand-ins (2v2/verify/cases-s.ts): Snorlax and Venusaur with 4 Speed EVs.
const lax = (extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", { evs: { spe: 4 }, ...extra });
const saur = (extra: Partial<Mon> = {}) => mon("venusaur", "overgrow", { evs: { spe: 4 }, ...extra });
const toise = (extra: Partial<Mon> = {}) => mon("blastoise", "torrent", extra);
const chomp = (extra: Partial<Mon> = {}) => mon("garchomp", "roughskin", extra);
const jolt = (extra: Partial<Mon> = {}) => mon("jolteon", "voltabsorb", extra);
/** review/track-e/cases.ts fastSm: a Jolly 252-Speed Smeargle. */
const fastSm = (extra: Partial<Mon> = {}) => mon("smeargle", "technician", { nature: "Jolly", evs: { spe: 252 }, ...extra });

const runtimes: Partial<Record<BattleGame, BattleRuntime>> = { champions: championsRuntime };
const game = async (id: BattleGame) => runtimes[id] ??= await loadBattleRuntime(id);
const SV = "scarlet_violet" as const, SWSH = "sword_shield" as const, USUM = "ultra_sun_ultra_moon" as const;

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const build = (base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
  return { ...build, ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, slots: Slot[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, p), contexts: {}, charged: false, action: { moveId: p.move, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
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
const texts = (facts: DoublesFact[] | undefined) => (facts ?? []).map((fact) => fact.text);
/** The HP after the moves: least, most and average, as the oracle reports them (`near`: the average to 3 places). */
const hpOf = (result: Ready, slot: DoublesSlotId) => {
  const hp = result.hp[slot]!;
  return [hp.min, hp.max, hp.average];
};
const eotOf = (result: Ready, slot: DoublesSlotId) => {
  expect(result.endOfTurn.status).toBe("ready");
  const hp = (result.endOfTurn as Extract<Ready["endOfTurn"], { status: "ready" }>).hp[slot]!;
  return [hp.min, hp.max, hp.average];
};
function near(got: number[], want: [number, number, number]) {
  expect(got.slice(0, 2)).toEqual(want.slice(0, 2));
  expect(got[2]).toBeCloseTo(want[2], 3);
}

describe("stat-change events (status-eot review H2, H3, H8, M1, M3; FX05, FX09, FX10)", () => {
  it("sets off Eject Pack on an accuracy drop from Sand Attack and from Mud-Slap (H2, H8)", async () => {
    const sv = await game(SV);
    // RV03, RV17b: Showdown's log has -unboost accuracy, then -enditem Eject Pack and a switch request.
    expect(reason(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), act(lax({ item: "ejectpack" }), "bodyslam", OL), idle(toise())]))).toBe(REASONS.switchesOut("Snorlax"));
    expect(reason(turn(sv, [act(mon("excadrill", "sandrush"), "mudslap", PL), idle(saur()), act(lax({ item: "ejectpack" }), "bodyslam", OL), idle(toise())]))).toBe(REASONS.switchesOut("Snorlax"));
  });

  it("does not eject after Haze, which clears the stages with no boost event (M1, RV04)", async () => {
    const result = ready(turn(await game(SV), [act(mon("milotic", "marvelscale"), "haze"), idle(saur()), act(lax({ item: "ejectpack", boosts: { atk: 1 } }), "bodyslam", OL), idle(toise())]));
    expect(stepOf(result, PL).moves).toBe(1);
    near(hpOf(result, OL), [94, 106, 100.4375]);
  });

  it("guards Opportunist copying Defiant's rise when the stage ends where it started (H3, RV05)", async () => {
    const input = turn(await game(SV), [act(jolt(), "charm", PL), act(mon("espathra", "opportunist"), "storedpower", PR), idle(mon("kingambit", "defiant")), idle(lax())]);
    expect(reason(input)).toBe(REASONS.copiesRise("Opportunist"));
  });

  it("keeps an accuracy drop off an Illuminate holder from generation 9 (M3, RV06)", async () => {
    const result = ready(turn(await game(SV), [act(chomp(), "sandattack", PL), idle(saur()), idle(mon("lanturn", "illuminate")), idle(toise())]));
    expect(texts(hitOf(result, OL, PL).facts)).toEqual(["Illuminate: its accuracy is not lowered."]);
  });

  it("raises Defiant on Mud-Slap's accuracy drop before the holder attacks (H8, RV17)", async () => {
    const result = ready(turn(await game(SV), [act(mon("excadrill", "sandrush"), "mudslap", PL), idle(saur()), act(mon("kingambit", "defiant"), "ironhead", OL), idle(toise())]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 87, max: 103 });
    near(hpOf(result, OL), [82, 98, 90]);
  });

  it("sends Mud-Slap's drop back through Mirror Armor to a Competitive user (FX09)", async () => {
    // Gravity grounds the Flying-type Corviknight for the Ground-type Mud-Slap.
    const outcomes = calculateDoublesOutcomes(turn(await game(SV), [act(mon("empoleon", "competitive"), "mudslap", PL), idle(saur()), idle(mon("corviknight", "mirrorarmor")), idle(toise())], { gravity: true }));
    expect(outcomes.status).toBe("ready");
    if (outcomes.status !== "ready") return;
    expect(outcomes.outcomes.map((each) => each.mons[OL]!.build.boosts.spa)).toEqual([2]);
  });

  it("counts a drop Defiant then hid as the stats falling: Lash Out doubles (FX05)", async () => {
    const result = ready(turn(await game(SV), [act(mon("hitmonlee", "limber"), "lunge", PL), idle(saur()), act(mon("kingambit", "defiant"), "lashout", OL), idle(toise())]));
    expect(result.hp[OL]!.koChance).toBe(1);
    near(hpOf(result, PL), [138, 144, 141.25]);
  });

  it("lowers every foe's evasion with G-Max Tartness: Defiant rises (FX10)", async () => {
    const swsh = await game(SWSH);
    const flapple = mon("flapple", "hustle", { build: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } as Partial<BattleBuild> });
    const result = ready(turn(swsh, [act(flapple, "gravapple", PL), idle(saur()), act(mon("bisharp", "defiant"), "ironhead", OL), idle(toise())]));
    near(hpOf(result, OL), [134, 223, 182.1563]);
  });
});

describe("status moves (status-eot review H4-H7, M2, M4, L2; FX06-FX08)", () => {
  it("lets Mycelium Might's status moves pass breakable abilities (H4, RV12)", async () => {
    const result = ready(turn(await game(SV), [act(mon("toedscruel", "myceliummight"), "spore", PL), idle(saur()), idle(mon("azumarill", "sapsipper")), idle(toise())]));
    expect(texts(result.hp[PL]!.conditions)).toEqual(["Asleep."]);
  });

  it("cures the burns Sparkling Aria hit after the move (H5, RV13, RV13b; FX08, FX08b)", async () => {
    const sv = await game(SV);
    const primarina = mon("primarina", "torrent");
    const r13 = ready(turn(sv, [act(primarina, "sparklingaria"), idle(chomp()), act(lax({ status: "brn" }), "bodyslam", OL), idle(toise())]));
    near(hpOf(r13, OL), [76, 88, 82.4375]);
    near(eotOf(r13, PL), [184, 193, 188.9375]);
    expect(texts(hitOf(r13, OL, PL).facts)).toContain("Sparkling Aria: its burn is cured.");
    const r13b = ready(turn(sv, [act(primarina, "sparklingaria"), act(mon("gengar", "cursedbody"), "willowisp", PL), act(lax(), "bodyslam", OL), idle(toise())]));
    near(hpOf(r13b, OL), [76, 88, 82.4375]);
    // One target hit: Shield Dust keeps the secondary's volatile off, so the burn stays; with two hit it is cured anyway.
    const vivillon = mon("vivillon", "shielddust", { status: "brn" });
    const alone = ready(turn(sv, [act(primarina, "sparklingaria"), null, act(vivillon, "strugglebug"), null]));
    near(eotOf(alone, PL), [62, 76, 69.25]);
    const both = ready(turn(sv, [act(primarina, "sparklingaria"), idle(saur()), act(vivillon, "strugglebug"), idle(toise())]));
    near(eotOf(both, PL), [92, 103, 97.6875]);
  });

  it("aims Champions' Milk Drink at its user past a fainted ally, and at whoever stands at the aimed position (H6, RV15, RV15b, FX06)", async () => {
    const gogoat = mon("gogoat", "sapsipper", { hp: 100 });
    const alakazam = mon("alakazam", "magicguard", { hp: 100 });
    const fainted = ready(turn(championsRuntime, [act(gogoat, "milkdrink", OR), idle(lax({ hp: 1 })), act(mon("dragapult", "clearbody"), "dragonpulse", OR), idle(toise())]));
    near(hpOf(fainted, OL), [198, 198, 198]);
    expect(texts(stepOf(fainted, OL).facts)).toContain("Snorlax has fainted: Gogoat uses Milk Drink on itself.");
    const swapped = ready(turn(championsRuntime, [act(gogoat, "milkdrink", OR), act(alakazam, "allyswitch"), idle(lax()), idle(toise())]));
    near(hpOf(swapped, OL), [198, 198, 198]);
    const own = ready(turn(championsRuntime, [act(gogoat, "milkdrink", OL), act(alakazam, "allyswitch"), idle(lax()), idle(toise())]));
    near(hpOf(own, OL), [100, 100, 100]);
    near(hpOf(own, OR), [130, 130, 130]);
    expect(texts(stepOf(own, OL).facts)).toContain("Ally Switch: Milk Drink hits Alakazam in Gogoat's place.");
  });

  it("negates a Ground type's immunity to Thunder Wave with Ring Target (H7, RV19)", async () => {
    const result = ready(turn(await game(SV), [act(jolt(), "thunderwave", PL), idle(saur()), act(chomp({ item: "ringtarget" }), "dragonclaw", OL), idle(toise())]));
    expect(stepOf(result, PL).moves).toBe(0.75);
    near(hpOf(result, OL), [38, 140, 70.0625]);
  });

  it("fails Teleport in generation 7 (M2, RV11, RV11b)", async () => {
    const usum = await game(USUM);
    const alakazam = mon("alakazam", "magicguard");
    for (const field of [{}, { trickRoom: true }]) {
      const result = ready(turn(usum, [act(alakazam, "teleport"), idle(saur()), act(lax(), "bodyslam", OL), idle(toise())], field));
      expect(texts(stepOf(result, OL).facts)).toEqual(["Teleport fails."]);
      near(eotOf(result, OL), [16, 34, 25.5]);
    }
  });

  it("makes a Comatose target drowsy with Yawn (M4, RV07)", async () => {
    const result = ready(turn(await game(SV), [act(lax(), "yawn", PL), idle(saur()), idle(mon("komala", "comatose")), idle(toise())]));
    expect(texts(hitOf(result, OL, PL).facts)).toEqual(["Becomes drowsy."]);
  });

  it("fails Perish Song when every Pokémon already counts (L2, FX07)", async () => {
    const result = ready(turn(await game(SV), [
      act(mon("gengar", "cursedbody", { carried: { perish: 2 } }), "perishsong"), idle(saur({ carried: { perish: 2 } })), idle(lax({ carried: { perish: 3 } })), idle(toise({ carried: { perish: 3 } })),
    ]));
    expect(texts(stepOf(result, OL).facts)).toEqual(["Perish Song fails."]);
  });

  it("stops an Assault Vest holder choosing a status move (positions-items-sub F4, RE21)", async () => {
    const result = calculateDoublesTurn(turn(await game(SV), [act(fastSm({ item: "assaultvest" }), "trick", PL), act(mon("charizard", "blaze"), "flamethrower", PL), idle(lax()), idle(toise())]));
    expect(result.status).toBe("issues");
    if (result.status === "issues") expect(result.issues.actions).toEqual([{ slot: OL, message: "Assault Vest stops status moves." }]);
    // Klutz and Magic Room ignore the vest.
    expect(calculateDoublesTurn(turn(await game(SV), [act(fastSm({ item: "assaultvest" }), "trick", PL), idle(saur()), idle(lax()), idle(toise())], { magicRoom: true })).status).toBe("ready");
  });
});

describe("Berries and items at an Update (status-eot review H1; positions-items-sub F1-F3)", () => {
  it("keeps a Berserk or Anger Shell holder's Sitrus Berry after a confusion self-hit (H1, RV01, RV02)", async () => {
    const klawf = mon("klawf", "angershell", { item: "sitrusberry", hp: 80, carried: { confusion: { attempts: 0 } } });
    const sv = ready(turn(await game(SV), [act(klawf, "rockslide"), idle(lax()), idle(toise()), idle(saur())]));
    near(hpOf(sv, OL), [63, 80, 74.9881]);
    expect(sv.hp[OL]!.heals ?? []).toEqual([]);
    // Showdown's end of turn keeps it too: no residual damage resets the lock (doubles-eot.ts updateSlot; FN01-FN04 have
    // the residuals that do).
    near(eotOf(sv, OL), [63, 80, 74.9881]);
    expect(sv.endOfTurn.status === "ready" ? sv.endOfTurn.residuals.filter((each) => each.slot === OL) : null).toEqual([]);
    const drampa = mon("drampa", "berserk", { item: "sitrusberry", hp: 85, carried: { confusion: { attempts: 0 } } });
    const swsh = ready(turn(await game(SWSH), [idle(drampa), idle(lax()), idle(toise()), idle(saur())]));
    near(hpOf(swsh, OL), [70, 85, 80.5862]);
  });

  it("eats a received Lansat or Starf Berry at the Trick's Update (F1, RE60, RE61)", async () => {
    const sv = await game(SV);
    const lansat = ready(turn(sv, [act(fastSm({ item: "lansatberry" }), "trick", PL), act(lax(), "tackle", PL), idle(mon("dedenne", "cheekpouch", { hp: 30 })), idle(toise())]));
    near(hpOf(lansat, PL), [31, 38, 34.9375]);
    expect(lansat.hp[PL]!.koChance).toBe(0);
    expect(texts(hitOf(lansat, OL, PL).facts)).toEqual(["Lansat Berry: Focus Energy, +2 critical-hit stages."]);
    const starf = ready(turn(sv, [act(fastSm({ item: "starfberry" }), "trick", PL), idle(lax()), act(chomp({ hp: 40 }), "dragonclaw", OR), idle(toise())]));
    near(hpOf(starf, OR), [46, 154, 129.875]);
    expect(hitOf(starf, OL, PL).facts.map((fact) => [fact.text, fact.chance])).toEqual(["Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"].map((stat) => [`Starf Berry: +2 ${stat}.`, 0.2]));
  });

  it("eats a Lansat Berry after Substitute's cost and after recoil into a Substitute (F1, RE63, RE87)", async () => {
    const sv = await game(SV);
    const cost = ready(turn(sv, [idle(mon("smeargle", "technician")), act(lax(), "hypervoice"), act(mon("dedenne", "cheekpouch", { hp: 60, item: "lansatberry" }), "substitute"), idle(toise())]));
    near(hpOf(cost, PL), [27, 35, 31.3125]);
    const recoil = turn(sv, [act(mon("dedenne", "cheekpouch", { hp: 46, item: "lansatberry" }), "wildcharge", PL), idle(saur()), idle(lax()), act(toise(), "waterpulse", OL)]);
    recoil.pokemon[PL] = { ...recoil.pokemon[PL]!, carried: { substitute: 58 } };
    expect(hpOf(ready(recoil), OL)).toEqual([30, 39, 34.875]);
  });

  it("drinks a received Berry Juice beside a foe's Unnerve (F2, RE64b-swsh)", async () => {
    const result = ready(turn(await game(SWSH), [act(mon("klefki", "prankster", { item: "berryjuice" }), "switcheroo", PL), act(mon("tyranitar", "unnerve"), "crunch", PL), idle(chomp({ hp: 70 })), idle(toise())]));
    near(hpOf(result, PL), [17, 29, 22.75]);
  });

  it("keeps an Air Balloon its holder ignores (Klutz, Magic Room) when hit (F3, RE80, RE85)", async () => {
    const sv = await game(SV);
    const room = ready(turn(sv, [act(jolt(), "shadowball", PL), act(chomp(), "dragonclaw", PL), act(mon("drifblim", "unburden", { item: "airballoon" }), "shadowball", OR), idle(toise())], { magicRoom: true }));
    near(hpOf(room, OR), [126, 183, 171.2612]);
    const behind = turn(sv, [act(jolt(), "shadowball", PL), idle(saur()), idle(mon("golurk", "klutz", { item: "airballoon" })), idle(toise())]);
    behind.pokemon[PL] = { ...behind.pokemon[PL]!, carried: { substitute: 40 } };
    const outcomes = calculateDoublesOutcomes(behind);
    expect(outcomes.status).toBe("ready");
    if (outcomes.status === "ready") expect(outcomes.outcomes.map((each) => each.mons[PL]!.build.itemId)).toEqual(["airballoon"]);
  });
});

describe("the turn's first Update and facts (ui F1, F2; status-eot review L1, L3; FX01, FX01b, FX04)", () => {
  it("cures a start status the Pokémon's own ability cures, before its Berry (FX01b, FX04)", async () => {
    const sv = await game(SV);
    const immunity = ready(turn(sv, [act(lax({ ability: "immunity", status: "tox", carried: { toxic: 3 } }), "bodyslam", PL), idle(saur()), idle(chomp()), idle(toise())]));
    near(eotOf(immunity, OL), [206, 206, 206]);
    expect(immunity.facts).toContain("Immunity: Snorlax is cured of its bad poison as the turn starts.");
    const limber = turn(sv, [idle(saur()), idle(lax()), act(mon("hitmonlee", "limber", { item: "cheriberry", status: "par" }), "closecombat", OL), idle(toise())]);
    expect(stepOf(ready(limber), PL).moves).toBe(1);
    const outcomes = calculateDoublesOutcomes(limber);
    if (outcomes.status === "ready") expect(outcomes.outcomes.map((each) => [each.mons[PL]!.build.itemId, each.mons[PL]!.build.status])).toEqual([["cheriberry", ""]]);
    // Neutralizing Gas suppresses the ability from the turn's start: no cure.
    const gassed = ready(turn(sv, [act(lax({ ability: "immunity", status: "tox" }), "bodyslam", PL), idle(saur()), idle(mon("weezing", "neutralizinggas")), idle(toise())]));
    expect(gassed.facts.some((fact) => fact.startsWith("Immunity:"))).toBe(false);
  });

  it("wakes, thaws and calms a Pokémon its own ability cures as the turn starts (ui F1, F2)", async () => {
    const sv = await game(SV);
    const hypno = ready(turn(sv, [act(mon("hypno", "insomnia", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "psychic", PL), idle(mon("blissey", "naturalcure")), idle(chomp()), idle(mon("chansey", "naturalcure"))]));
    expect(stepOf(hypno, OL).moves).toBe(1);
    expect(hypno.facts).not.toContain("Assumes Hypno lost no turns to sleep before this one.");
    const slowbro = ready(turn(sv, [act(mon("slowbro", "owntempo", { carried: { confusion: { attempts: 1 } } }), "scald", PL), idle(saur()), idle(chomp()), idle(toise())]));
    expect(stepOf(slowbro, OL).moves).toBe(1);
    expect(slowbro.facts).toContain("Own Tempo: Slowbro is no longer confused.");
  });

  it("leaves the Berry to the breaker's in-move Update (FX01)", async () => {
    const outcomes = calculateDoublesOutcomes(turn(await game(SV), [act(mon("zekrom", "teravolt"), "thunderwave", PL), idle(saur()), idle(mon("hitmonlee", "limber", { item: "cheriberry" })), idle(toise())]));
    expect(outcomes.status).toBe("ready");
    if (outcomes.status === "ready") expect(outcomes.outcomes.map((each) => [each.mons[PL]!.build.itemId, each.mons[PL]!.build.status])).toEqual([["", ""]]);
  });

  it("says when a certain critical hit applies (L1, RV10c)", async () => {
    const result = ready(turn(await game(SV), [act(mon("honchkrow", "superluck", { item: "scopelens" }), "nightslash", PL), idle(saur()), idle(lax()), idle(toise())]));
    expect(result.facts[0]).toBe("Every move hits; critical hits only where certain; added effects below 100% do not happen.");
    expect(texts(hitOf(result, OL, PL).facts)).toEqual(["Every hit is a critical hit (critical-hit ratio +3: Night Slash, Super Luck and Scope Lens)."]);
    near(hpOf(result, PL), [114, 133, 123.5625]);
  });

  it("assumes a No-move sleeper lost no turns (L3)", async () => {
    const result = ready(turn(await game(SV), [idle(lax({ status: "slp" })), idle(saur()), idle(chomp()), idle(toise())]));
    expect(result.facts).toContain("Assumes Snorlax lost no turns to sleep before this one.");
  });
});
