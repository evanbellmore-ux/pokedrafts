import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { afterSetStatus, cannotLeave, invulnerable, onFaint, outcomeVolatiles, rootActions, stepReport, tracksHits } from "@/app/lib/battle/doubles-presence";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import { type DoublesCarried, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { pointFactor, type MonState, type World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";

/**
 * status2 Track PR (ADDENDUM2 §4.3 PR; T2P §2, §3.1–§3.8, §3.17, §6.1; C30, C41): app/lib/battle/doubles-presence.ts. Every
 * number is pinned Showdown c23d2e94's: the builds are status2/build/w1b-pr/cases.ts's (level 50, 31 IVs, Serious, 0 EVs
 * unless set; the oracle and the app agreed on each through w1b-pr/run.ts), or the T2P- / CQ- cases V2 stores. The tests
 * marked `it.fails` need the integrator's lines of status2/build/W1B-PR.md (w1b-pr/integrator.py): they agree with the
 * oracle on a tree with those lines (w1b-pr/tree.sh), and integrator.py flips each to `it` with its group (and deletes the
 * two interim reason tests that say so).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; evs?: Partial<Record<Stat, number>>; hp?: number; status?: BattleStatus;
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; carried?: DoublesCarried; extra?: Partial<DoublesPokemonInput>;
  context?: MoveContext; move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", USUM = "ultra_sun_ultra_moon";

const mon = (species: string, ability: string, move: string | null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
/** A Thick Fat Snorlax with 8n Speed EVs (the cases' lax(k(game, n))). */
const lax = (n: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", move, { evs: { spe: n * 8 }, ...extra });
const FAST = { evs: { spe: 252 } };

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31 } } }) as BattleBuild;
}
/** The four Pokémon in slot order own-left, own-right, opponent-left, opponent-right. */
function turn(runtime: BattleRuntime, mons: [Mon, Mon, Mon, Mon], field: Partial<BattleConditions> = {}, more: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: m.move && m.context ? { [m.move]: m.context } : {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}), ...m.extra,
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true }, ...more };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
const reasonOf = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  return result.status === "not-estimated" ? result.reason : `${result.status}`;
};
const stepOf = (result: Ready, slot: DoublesSlotId, copied?: string) => result.steps.find((step) => step.slot === slot && step.copied === copied)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId, copied?: string) => stepOf(result, slot, copied).hits.find((hit) => hit.slot === target)!;
const range = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId, copied?: string) => { const hit = hitOf(result, slot, target, copied); return [hit.min, hit.max]; };
const factChance = (facts: { text: string; chance: number }[], text: string) => facts.filter((fact) => fact.text === text).reduce((sum, fact) => sum + fact.chance, 0);

// ------------------------------------------------------------------------------------------------------------------
// Round, Echoed Voice, the history rows' inputs
// ------------------------------------------------------------------------------------------------------------------

describe("Round (PS/data/moves.ts round onTry, basePowerCallback)", () => {
  it("pulls the next queued Round to move next at 120 power (an ally's: PR-RND-01; a foe's: PR-RND-02)", async () => {
    const sv = await game(SV);
    const own = ready(turn(sv, [mon("altaria", "naturalcure", "round", { ...FAST, target: PL }), mon("jigglypuff", "competitive", "round", { target: PR }), lax(2), lax(4)]));
    expect(factChance(stepOf(own, OL).facts, "Round: Jigglypuff moves next.")).toBeCloseTo(1, 12);
    expect(range(own, OL, PL)).toEqual([17, 20]);
    expect(range(own, OR, PR)).toEqual([34, 42]);
    expect(stepOf(own, OR).order).toEqual([{ position: 2, chance: 1 }]);
    const foe = ready(turn(sv, [mon("altaria", "naturalcure", "round", { ...FAST, target: PL }), lax(2), lax(4), mon("skeledirge", "unaware", "round", { target: OR })]));
    expect(factChance(stepOf(foe, OL).facts, "Round: Skeledirge moves next.")).toBeCloseTo(1, 12);
    expect(stepOf(foe, PR).order).toEqual([{ position: 2, chance: 1 }]);
  });
});

describe("Echoed Voice (C25: the multiplier after last turn)", () => {
  it("gives every use this turn 40 x min(5, m + 1), 40 with none last turn, and the row's reason while unknown", async () => {
    const sv = await game(SV);
    const mons: [Mon, Mon, Mon, Mon] = [mon("chansey", "naturalcure", "echoedvoice", { ...FAST, target: PL }), mon("jigglypuff", "competitive", "echoedvoice", { ...FAST, target: PR }), lax(2), lax(4)];
    const twice = ready(turn(sv, mons, {}, { echoedVoice: 1 }));
    expect(range(twice, OL, PL)).toEqual([19, 24]);
    expect(range(twice, OR, PR)).toEqual([24, 28]);
    const fresh = ready(turn(sv, [mons[0], lax(1), lax(2), lax(4)], {}, { echoedVoice: 0 }));
    expect(range(fresh, OL, PL)).toEqual([10, 13]);
    expect(reasonOf(turn(sv, mons))).toBe("Needs the consecutive-turn use count.");
  });
});

describe("the history rows' 2v2 contexts (T2P §6.1)", () => {
  it("Fury Cutter: 40 x min(4, 2^uses), at most 160 (PR-FCT-01/02)", async () => {
    const sv = await game(SV);
    const cutter = (uses?: 0 | 1 | 2) => turn(sv, [mon("gallade", "justified", "furycutter", { ...FAST, target: PL, ...(uses !== undefined ? { carried: { furyCutter: uses } } : {}) }), lax(1), lax(2), lax(4)]);
    expect(range(ready(cutter(2)), OL, PL)).toEqual([103, 122]);
    expect(range(ready(cutter(1)), OL, PL)).toEqual([52, 62]);
    expect(reasonOf(cutter())).toBe("Needs the consecutive-use count.");
  });
  it("Rollout: 30 x 2^hits, x2 after Defense Curl (PR-ROL-01)", async () => {
    const sv = await game(SV);
    const rolled = ready(turn(sv, [mon("copperajah", "sheerforce", "rollout", { ...FAST, target: PL, carried: { rollout: 2, defenseCurl: true } }), lax(1), lax(2), lax(4)]));
    expect(range(rolled, OL, PL)).toEqual([159, 188]);
  });
  it("Retaliate: x2 after a faint on its side last turn (PR-RTL-01/02, IN-RTL); unknown: the row's reason", async () => {
    const sv = await game(SV);
    const mons: [Mon, Mon, Mon, Mon] = [mon("arcanine", "intimidate", "retaliate", { ...FAST, target: PL }), lax(1), lax(2), lax(4)];
    expect(range(ready(turn(sv, mons, {}, { faintedLastTurn: { own: true } })), OL, PL)).toEqual([81, 96]);
    expect(range(ready(turn(sv, mons, {}, { faintedLastTurn: { own: false } })), OL, PL)).toEqual([41, 49]);
    expect(reasonOf(turn(sv, mons))).toBe("Needs whether an ally fainted last turn.");
  });
  it("Trump Card: the PP left after this use (2 before: 80, PR-TMP-01); none left: it fails; unknown: the row's reason", async () => {
    const usum = await game(USUM);
    const trump = (left?: number) => turn(usum, [mon("jolteon", "voltabsorb", "trumpcard", { ...FAST, target: PL, ...(left !== undefined ? { carried: { ppLeft: { trumpcard: left } } } : {}) }), lax(1), lax(2), lax(4)]);
    expect(range(ready(trump(2)), OL, PL)).toEqual([31, 37]);
    expect(factChance(stepOf(ready(trump(0)), OL).facts, "Trump Card fails: Jolteon has no PP left for it.")).toBeCloseTo(1, 12);
    expect(reasonOf(trump())).toBe("Needs the move's remaining PP.");
  });
  it("Pursuit: 40 with no switch (PR-PUR-02, CQ-PUR-02); a foe that switched in this turn: not followed (C30, CQ-PUR-01)", async () => {
    const usum = await game(USUM);
    const pursuit = ready(turn(usum, [mon("tyranitar", "sandstream", "pursuit", { ...FAST, target: PL }), lax(1), lax(2), lax(4)], { weather: "Sand" }));
    expect(range(pursuit, OL, PL)).toEqual([42, 49]);
    const switched = turn(usum, [mon("houndoom", "flashfire", "pursuit", { target: PR }), lax(1), lax(3), lax(2, null, { extra: { switchedIn: true } })]);
    expect(reasonOf(switched)).toBe(REASONS.combo("Pursuit", "a Pokémon that switched in this turn"));
  });
  it("Present: heal 2/10 (fails at full HP), 40, 80, 120 (PR-PRS-01/02)", async () => {
    const sv = await game(SV);
    const hurt = ready(turn(sv, [mon("delibird", "hustle", "present", { ...FAST, target: PL }), lax(1), lax(2, null, { hp: 150 }), lax(4)]));
    expect(range(hurt, OL, PL)).toEqual([21, 71]);
    expect(factChance(hitOf(hurt, OL, PL).facts, "Present: Snorlax (opponent's, 1) regains HP.")).toBeCloseTo(0.2, 12);
    const full = ready(turn(sv, [mon("delibird", "hustle", "present", { ...FAST, target: PL }), lax(1), lax(2), lax(4)]));
    expect(factChance(hitOf(full, OL, PL).facts, "Present fails: Snorlax (opponent's, 1) is at full HP.")).toBeCloseTo(0.2, 12);
  });
  it("Magnitude: seven powers at 5/10/20/30/20/10/5 % into all three (PR-MAG-01)", async () => {
    const usum = await game(USUM);
    const quake = ready(turn(usum, [mon("golem", "sturdy", "magnitude", FAST), lax(1), lax(2), lax(4)]));
    for (const target of [OR, PL, PR]) expect(range(quake, OL, target)).toEqual([7, 123]);
  });
  it("a history row its user's ability retypes is not followed beside an absorber of the new type (Liquid Voice's Water)", async () => {
    const swsh = await game("sword_shield");
    const voice = (foe: Mon) => turn(swsh, [mon("primarina", "liquidvoice", "echoedvoice", { target: PL }), lax(1), lax(2), foe], {}, { echoedVoice: 0 });
    expect(hitOf(ready(voice(lax(4))), OL, PL).kind).toBe("calculated");
    expect(reasonOf(voice(mon("vaporeon", "waterabsorb", null)))).toBe(REASONS.combo("Echoed Voice", "Liquid Voice"));
    // Galvanize changes Normal moves only: Rollout stays Rock (PR-ATE-01: exact).
    const sv = await game(SV);
    expect(range(ready(turn(sv, [mon("golemalola", "galvanize", "rollout", { ...FAST, target: PL, carried: { rollout: 0 } }), lax(1), lax(2), mon("jolteon", "voltabsorb", null)])), OL, PL)).toEqual([28, 34]);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Fusion Bolt and Fusion Flare
// ------------------------------------------------------------------------------------------------------------------

describe("Fusion Bolt after Fusion Flare (lastSuccessfulMoveThisTurn)", () => {
  const fusion = async (third: Mon) => {
    const sv = await game(SV);
    return ready(turn(sv, [mon("reshiram", "turboblaze", "fusionflare", { ...FAST, target: PL }), mon("zekrom", "teravolt", "fusionbolt", { evs: { spe: 100 }, target: PR }), third, lax(4)]));
  };
  it("doubles after a Flare that did something (PR-FUS-01)", async () => {
    const result = await fusion(lax(2));
    expect(range(result, OL, PL)).toEqual([75, 88]);
    expect(range(result, OR, PR)).toEqual([226, 267]);
  });
  it("does not after a Flare into Protect (PR-FUS-02)", async () => {
    expect(range(await fusion(lax(2, "protect")), OR, PR)).toEqual([114, 135]);
  });
  it("does not after another move between them (PR-FUS-03: a Dragon Claw)", async () => {
    const sv = await game(SV);
    const between = ready(turn(sv, [mon("reshiram", "turboblaze", "fusionflare", { ...FAST, target: PL }), mon("zekrom", "teravolt", "fusionbolt", { target: PR }), mon("garchomp", "roughskin", "dragonclaw", { target: OL }), lax(1)]));
    expect(range(between, OR, PR)).toEqual([114, 135]);
  });
  it("does not after a No move between them (Splash: the integrator's executeUsed line; PR-FUS-04)", async () => {
    const sv = await game(SV);
    const between = ready(turn(sv, [mon("reshiram", "turboblaze", "fusionflare", { ...FAST, target: PL }), mon("zekrom", "teravolt", "fusionbolt", { target: PR }), mon("garchomp", "roughskin", null), lax(1)]));
    expect(range(between, OR, PR)).toEqual([114, 135]);
  });
  it("a No move before the Flare leaves it; one between them that paralysis may stop is not estimated", async () => {
    const sv = await game(SV);
    const before = ready(turn(sv, [mon("reshiram", "turboblaze", "fusionflare", { ...FAST, target: PL }), mon("zekrom", "teravolt", "fusionbolt", { target: PR }), mon("garchomp", "roughskin", null, FAST), lax(1)]));
    expect(range(before, OR, PR)).toEqual([226, 267]);
    const paralysed = mon("garchomp", "roughskin", null, { status: "par", boosts: { spe: 2 } });
    expect(reasonOf(turn(sv, [mon("reshiram", "turboblaze", "fusionflare", { ...FAST, target: PL }), mon("zekrom", "teravolt", "fusionbolt", { target: PR }), paralysed, lax(1)])))
      .toBe(REASONS.combo("Fusion Bolt", "No move"));
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Beak Blast, Shell Trap, Flame Burst
// ------------------------------------------------------------------------------------------------------------------

describe("Beak Blast, Shell Trap and Flame Burst", () => {
  it("Beak Blast's heat burns a contact attacker (PR-BKB-01); a multi-hit contact move whose burn lands between its hits is not followed", async () => {
    const sv = await game(SV);
    const heated = ready(turn(sv, [mon("toucannon", "keeneye", "beakblast", { target: PL }), lax(1), lax(2, "bodyslam", { target: OL }), lax(4)]));
    expect(factChance(hitOf(heated, PL, OL).facts, "Beak Blast: Snorlax (opponent's, 1) is burned.")).toBeCloseTo(1, 12);
    expect(range(heated, PL, OL)).toEqual([67, 79]);
    expect(range(heated, OL, PL)).toEqual([93, 111]);
    const twice = turn(sv, [mon("toucannon", "keeneye", "beakblast", { target: PR }), lax(1), mon("braviary", "keeneye", "dualwingbeat", { ...FAST, target: OL }), lax(2)]);
    expect(reasonOf(twice)).toBe(REASONS.intoBeakBlast("Dual Wingbeat", "Toucannon"));
  });
  it("Shell Trap moves next after a foe's physical hit (PR-STP-01) and fails without one (PR-STP-02)", async () => {
    const usum = await game(USUM);
    const trapped = ready(turn(usum, [mon("turtonator", "shellarmor", "shelltrap"), lax(1), lax(2, "bodyslam", { target: OL }), lax(4)]));
    expect(factChance(stepOf(trapped, PL).facts, "Shell Trap: Turtonator moves next.")).toBeCloseTo(1, 12);
    expect(range(trapped, OL, PL)).toEqual([27, 33]);
    const idle = ready(turn(usum, [mon("turtonator", "shellarmor", "shelltrap"), lax(1), lax(2), lax(4)]));
    expect(factChance(stepOf(idle, OL).facts, "Shell Trap fails: Turtonator took no physical hit.")).toBeCloseTo(1, 12);
    expect(stepOf(idle, OL).hits).toEqual([]);
  });
  it("Flame Burst's splash: the target's partner loses 1/16 of its base maximum HP (PR-FLB-01)", async () => {
    const usum = await game(USUM);
    const result = ready(turn(usum, [mon("arcanine", "flashfire", "flameburst", { ...FAST, target: PL }), lax(1), lax(2), lax(4)]));
    expect(range(result, OL, PL)).toEqual([19, 24]);
    expect(result.hp[PR]!.losses?.some((loss) => loss.text === "Snorlax (opponent's, 2) loses 14 HP (Flame Burst).")).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The Pledges
// ------------------------------------------------------------------------------------------------------------------

describe("the Pledges (PS/data/moves.ts firepledge, grasspledge, waterpledge)", () => {
  it("the first waits; its ally's Pledge moves next at 150 with the pair's type and side condition (PR-PLG-01, R09)", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("charizard", "blaze", "firepledge", { ...FAST, target: PL }), mon("venusaur", "overgrow", "grasspledge", { target: PR }), lax(2), lax(4)]);
    const result = ready(input);
    expect(factChance(stepOf(result, OL).facts, "Fire Pledge waits for Venusaur's Grass Pledge.")).toBeCloseTo(1, 12);
    expect(stepOf(result, OL).hits).toEqual([]);
    expect(factChance(stepOf(result, OR).facts, "Fire Pledge and Grass Pledge combine: Fire, 150 power.")).toBeCloseTo(1, 12);
    expect(factChance(stepOf(result, OR).facts, "The sea of fire starts on the opponent's side.")).toBeCloseTo(1, 12);
    expect(range(result, OR, PR)).toEqual([40, 48]);
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes.every((outcome) => outcome.sides.opponent.pledge?.fire !== undefined)).toBe(true);
  });
  it("Grass and Water: a swamp on the target's side (PR-PLG-02)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("venusaur", "overgrow", "grasspledge", { ...FAST, target: PL }), mon("blastoise", "torrent", "waterpledge", { target: PR }), lax(31, "tackle", { target: OL }), lax(29, "tackle", { target: OR })]));
    expect(factChance(stepOf(result, OR).facts, "A swamp starts on the opponent's side.")).toBeCloseTo(1, 12);
    expect(range(result, OR, PR)).toEqual([69, 82]);
  });
  it("two of the same Pledge do not combine", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("charizard", "blaze", "firepledge", { ...FAST, target: PL }), mon("charizard", "blaze", "firepledge", { target: PR }), lax(2), lax(4)]));
    expect(stepOf(result, OL).facts).toEqual([]);
    expect(hitOf(result, OL, PL).kind).toBe("calculated");
  });
  it("Water and Fire: a rainbow on the user's own side, which the foes' later moves do not read", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("blastoise", "torrent", "waterpledge", { ...FAST, target: PL }), mon("charizard", "blaze", "firepledge", { target: PR }), lax(2), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]);
    const result = ready(input);
    expect(factChance(stepOf(result, OR).facts, "A rainbow starts on your side.")).toBeCloseTo(1, 12);
    expect(factChance(stepOf(result, OR).facts, "Water Pledge and Fire Pledge combine: Water, 150 power.")).toBeCloseTo(1, 12);
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes.every((outcome) => outcome.sides.own.pledge?.water !== undefined && outcome.sides.opponent.pledge === undefined)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Commander, Poison Puppeteer, Dancer
// ------------------------------------------------------------------------------------------------------------------

const dozo = (move: string | null, target?: DoublesSlotId) => mon("dondozo", "unaware", move, { boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 }, ...(target ? { target } : {}) });

describe("Commander (SV)", () => {
  it("a commanding Tatsugiri is missed and takes no action; Order Up raises Dondozo (PR-CMD-01, T2P-CMD-01)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("tatsugiri", "commander", null, FAST), dozo("orderup", PL), mon("garchomp", "roughskin", "dragonclaw", { ...FAST, target: OL }), mon("garchomp", "roughskin", "earthquake")]));
    expect(result.facts).toContain("Assumes Tatsugiri went inside Dondozo as they came in.");
    expect(factChance(hitOf(result, PL, OL).facts, "Dragon Claw misses Tatsugiri (Commander).")).toBeCloseTo(1, 12);
    expect(factChance(hitOf(result, PR, OL).facts, "Earthquake misses Tatsugiri (Commander).")).toBeCloseTo(1, 12);
    expect(range(result, PR, OR)).toEqual([24, 28]);
    expect(factChance(stepOf(result, OR).facts, "Order Up: Dondozo +1 Attack.")).toBeCloseTo(1, 12);
  });
  it("its chosen move is skipped; a Dondozo knocked out first ends the command (T2P-CMD-01b, T2P-CMD-02)", async () => {
    const sv = await game(SV);
    const chosen = ready(turn(sv, [mon("tatsugiri", "commander", "dragonpulse", { ...FAST, target: PR }), dozo(null), lax(2), lax(4)]));
    expect(factChance(stepOf(chosen, OL).skipped, "Inside Dondozo (Commander).")).toBeCloseTo(1, 12);
    const fallen = ready(turn(sv, [mon("tatsugiri", "commander", null, FAST), { ...dozo(null), hp: 1 }, mon("garchomp", "roughskin", "dragonclaw", { target: OL }), mon("garchomp", "roughskin", "dragonclaw", { ...FAST, target: OR })]));
    expect(hitOf(fallen, PL, OL).kind).toBe("calculated");
  });
  it("never activates under Neutralizing Gas from the lead (PS/sim/pokemon.ts ignoringAbility; PR-CMD-02)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("tatsugiri", "commander", null), dozo(null), mon("weezinggalar", "neutralizinggas", null), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]));
    expect(result.facts).not.toContain("Assumes Tatsugiri went inside Dondozo as they came in.");
    expect(range(result, PR, OL)).toEqual([170, 204]);
  });
  it("the hooks: the pair is out of reach, cannot leave, and ends with Dondozo's faint", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("tatsugiri", "commander", null), dozo(null), lax(2), lax(4)]);
    const kernel = { input, runtime: sv, gas: null } as unknown as TurnKernel;
    expect(rootActions(kernel, [{ slot: OL }, { slot: OR }, { slot: PL }, { slot: PR }]).map((action) => action.slot)).toEqual([OR, PL, PR]);
    const pair = (): World => ({
      mass: 1, mons: { [OL]: { build: input.pokemon[OL]!.build, fainted: false, commanding: OR } as MonState, [OR]: { build: input.pokemon[OR]!.build, fainted: false, commanded: OL } as MonState },
      sides: {} as World["sides"], field: {} as World["field"], remaining: [], executed: 0, factors: [pointFactor(OL, 100)],
    });
    const w = pair();
    expect(invulnerable(kernel, w, PL, OL)).toBe("Commander");
    expect(invulnerable(kernel, w, PL, OR)).toBeNull();
    expect(cannotLeave(kernel, w, OL) && cannotLeave(kernel, w, OR)).toBe(true);
    expect(outcomeVolatiles(kernel, w, OL)).toEqual(["commanding"]);
    expect(outcomeVolatiles(kernel, w, OR)).toEqual(["commanded"]);
    w.mons[OR]!.fainted = true;
    onFaint(kernel, w, OR);
    expect(invulnerable(kernel, w, PL, OL)).toBeNull();
    expect(cannotLeave(kernel, w, OL)).toBe(false);
  });
  it("E2 carries commanding and commanded (the integrator's outcomeOf line; T2P-CMD-03)", async () => {
    const sv = await game(SV);
    const outcomes = calculateDoublesOutcomes(turn(sv, [mon("tatsugiri", "commander", null), dozo(null), lax(2), lax(4)]));
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes[0].mons[OL]!.volatiles).toContain("commanding");
  });
});

describe("Poison Puppeteer (SV)", () => {
  it("Pecharunt's Toxic confuses the target: its later Dragon Claw meets the confusion (PR-PUP-01)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("pecharunt", "poisonpuppeteer", "toxic", { ...FAST, target: PL }), lax(1), mon("garchomp", "roughskin", "dragonclaw", { target: OL }), lax(4)]));
    expect(stepOf(result, PL).moves).toBeCloseTo(0.67, 2);
    expect(factChance(stepOf(result, PL).skipped, "Hurts itself in confusion: 20–24 HP.")).toBeCloseTo(0.33, 2);
  });
  it("not its own status, not one on itself, not a status other than poison, not past Own Tempo", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("pecharunt", "poisonpuppeteer", null), lax(1), lax(2), mon("slowbro", "owntempo", null)]);
    const kernel = { input, runtime: sv, abilityName: () => "Poison Puppeteer", names: { [PL]: "Snorlax", [PR]: "Slowbro" }, alive: (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted } as unknown as TurnKernel;
    const world = (): World => ({
      mass: 1, mons: Object.fromEntries(SLOTS.map((slot) => [slot, { build: input.pokemon[slot]!.build, fainted: false, vol: {}, eot: {} } as unknown as MonState])),
      sides: {} as World["sides"], field: {} as World["field"], remaining: [], executed: 0, factors: [],
    });
    const w = world();
    afterSetStatus(kernel, w, PL, "tox", OL);
    expect(w.mons[PL]!.vol.confusion).toEqual({ attempts: 0, min: 2 });
    afterSetStatus(kernel, w, PR, "psn", OL);
    expect(w.mons[PR]!.vol.confusion).toBeUndefined();
    afterSetStatus(kernel, w, OR, "par", OL);
    afterSetStatus(kernel, w, OR, "psn", OR);
    afterSetStatus(kernel, w, OL, "psn", OL);
    expect(w.mons[OR]!.vol.confusion).toBeUndefined();
    expect(w.mons[OL]!.vol.confusion).toBeUndefined();
  });
  it("the confusion's hit fact (the integrator's setStatus line passes the use; T2P-PUP-01)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("pecharunt", "poisonpuppeteer", "toxic", { ...FAST, target: PL }), lax(1), mon("garchomp", "roughskin", "dragonclaw", { target: OL }), lax(4)]));
    expect(factChance(hitOf(result, OL, PL).facts, "Poison Puppeteer: Garchomp becomes confused.")).toBeCloseTo(1, 12);
  });
});

describe("Dancer (PS/sim/battle-actions.ts:317-345)", () => {
  it("copies a foe's Swords Dance at once as its own step (PR-DAN-01)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("oricorio", "dancer", null), lax(1), mon("garchomp", "roughskin", "swordsdance", FAST), lax(2)]));
    const copy = stepOf(result, OL, "Dancer");
    expect(copy.moveId).toBe("swordsdance");
    expect(copy.moves).toBeCloseTo(1, 12);
    expect(factChance(copy.facts, "Dancer: Oricorio copies Swords Dance.")).toBeCloseTo(1, 12);
    expect(factChance(hitOf(result, OL, OL, "Dancer").facts, "+2 Attack.")).toBeCloseTo(1, 12);
  });
  it("copies its ally's Fiery Dance at the same foe (PR-DAN-02)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("oricorio", "dancer", null), mon("volcarona", "flamebody", "fierydance", { ...FAST, target: PL }), lax(1), lax(2)]));
    expect(range(result, OL, PL, "Dancer")).toEqual([21, 25]);
    expect(range(result, OR, PL)).toEqual([27, 33]);
  });
  it("two dances copied by one Dancer are two steps (the integrator's copies lines; T2P-DAN-04)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("oricorio", "dancer", null), mon("volcarona", "flamebody", "fierydance", { ...FAST, target: PR }), mon("volcarona", "flamebody", "fierydance", { evs: { spe: 200 }, target: OR }), lax(1)]));
    const copies = result.steps.filter((step) => step.slot === OL && step.copied === "Dancer");
    expect(copies.length).toBe(2);
    expect(copies.map((step) => step.hits.map((hit) => hit.slot))).toEqual([[PR], [PL]]);
  });
  it("does not copy a dance that did nothing (Swords Dance at +6)", async () => {
    const sv = await game(SV);
    const result = ready(turn(sv, [mon("oricorio", "dancer", null), lax(1), mon("garchomp", "roughskin", "swordsdance", { ...FAST, boosts: { atk: 6 } }), lax(2)]));
    expect(result.steps.some((step) => step.copied === "Dancer")).toBe(false);
  });
  it("two Dancers at one stored Speed need the entry order (T2P-DAN-10b)", async () => {
    const sv = await game(SV);
    const tie = turn(sv, [mon("oricorio", "dancer", null), mon("oricorio", "dancer", null), mon("garchomp", "roughskin", "swordsdance", FAST), lax(2)]);
    expect(reasonOf(tie)).toBe(REASONS.needsEntryOrder("Dancer", "Oricorio (1)", "Oricorio (2)"));
    expect(ready({ ...tie, entryOrder: { [OL]: 0, [OR]: 1 } }).steps.filter((step) => step.copied === "Dancer").length).toBe(2);
  });
});

describe("review 2 (R5-1, R5-2, R5-3): a Dancer's copy (PS/sim/battle-actions.ts:304-345)", () => {
  it("R5-1 (RV2-R5-DAN-SUB): a damaging dance into a Substitute: its ally Dancer copies it at that foe (activeTarget, :693), not at the dance's user", async () => {
    for (const id of [SV, USUM] as const) {
      const runtime = await game(id);
      const result = ready(turn(runtime, [mon("oricorio", "dancer", null), mon("volcarona", "flamebody", "fierydance", { target: PL }), lax(0, null, { carried: { substitute: 58 } }), lax(1)]));
      const copy = stepOf(result, OL, "Dancer");
      expect(copy.hits.map((hit) => hit.slot)).toEqual([PL]);
      expect(result.hp[OR]!.min).toBe(result.hp[OR]!.start);
    }
  });
  it("R5-2 (RV2-R5-DAN-WH): a Feather Dance whose drop White Herb restores at AfterMove did something: the copy lowers again (Body Slam 36-43)", async () => {
    for (const id of [SV, USUM] as const) {
      const runtime = await game(id);
      const result = ready(turn(runtime, [mon("oricorio", "dancer", null), mon("oricoriopompom", "dancer", "featherdance", { ...FAST, target: PL }),
        lax(0, "bodyslam", { item: "whiteherb", target: OL }), lax(1)]));
      expect(stepOf(result, OL, "Dancer").moveId).toBe("featherdance");
      expect(range(result, PL, OL)).toEqual([36, 43]);
    }
  });
  it("R5-2 (RV2-R5-DAN-DEF, RV2-R5-DAN-TEETER): Defiant's rise and a Persim Berry's cure leave the dance a success; Mirror Armor or −6 Attack apply nothing (no copy)", async () => {
    const sv = await game(SV);
    const defiant = ready(turn(sv, [mon("oricorio", "dancer", null), mon("oricoriopompom", "dancer", "featherdance", { ...FAST, target: PL }), mon("kingambit", "defiant", "ironhead", { target: OL }), lax(1)]));
    expect(stepOf(defiant, OL, "Dancer").moveId).toBe("featherdance");
    const persim = { item: "persimberry" };
    const teeter = ready(turn(sv, [mon("oricorio", "dancer", null, persim), mon("oricoriopompom", "dancer", "teeterdance", { ...FAST, ...persim }),
      lax(0, "bodyslam", { ...persim, target: OL }), lax(1, "bodyslam", { ...persim, target: OL })]));
    expect(stepOf(teeter, OL, "Dancer").moveId).toBe("teeterdance");
    const mirror = ready(turn(sv, [mon("oricorio", "dancer", null), mon("oricoriopompom", "dancer", "featherdance", { ...FAST, target: PL }), mon("corviknight", "mirrorarmor", "bravebird", { target: OL }), lax(1)]));
    expect(mirror.steps.some((step) => step.copied === "Dancer")).toBe(false);
    const capped = ready(turn(sv, [mon("oricorio", "dancer", null), mon("oricoriopompom", "dancer", "featherdance", { ...FAST, target: PL }), lax(0, "bodyslam", { boosts: { atk: -6 }, target: OL }), lax(1)]));
    expect(capped.steps.some((step) => step.copied === "Dancer")).toBe(false);
  });
  it("R5-3 (RV2-R5-DAN-SCARF, -SCARF2): a Choice Scarf Dancer is locked by its first move this turn, its copy included (data/conditions.ts choicelock)", async () => {
    const sv = await game(SV);
    // The copy of Quiver Dance first (the Scarf holder at −1 Speed moves after the Pom-Pom Oricorio): its own Hurricane fails
    // (used, then failing), the foe untouched.
    const copied = ready(turn(sv, [mon("oricorio", "dancer", "hurricane", { item: "choicescarf", boosts: { spe: -1 }, target: PL }), mon("oricoriopompom", "dancer", "quiverdance", FAST), lax(0), lax(1)]));
    expect(stepOf(copied, OL, "Dancer").moveId).toBe("quiverdance");
    expect(stepOf(copied, OL).moves).toBeCloseTo(1, 12);
    expect(factChance(stepOf(copied, OL).facts, "Hurricane fails: Oricorio is locked into Quiver Dance by Choice Scarf.")).toBeCloseTo(1, 12);
    expect(copied.hp[PL]!.min).toBe(copied.hp[PL]!.start);
    // Its own Hurricane first: the later copy fails.
    const own = ready(turn(sv, [mon("oricorio", "dancer", "hurricane", { item: "choicescarf", ...FAST, target: PL }), mon("oricoriopompom", "dancer", "quiverdance"), lax(0), lax(1)]));
    expect(factChance(stepOf(own, OL, "Dancer").facts, "Quiver Dance fails: Oricorio is locked into Hurricane by Choice Scarf.")).toBeCloseTo(1, 12);
    expect(stepOf(own, OL, "Dancer").hits.some((hit) => hit.facts.some((fact) => fact.text.includes("Sp. Atk")))).toBe(false);
  });
  it("R5-3: a lock from an earlier turn: not known with a last move (the reason), assumed none with neither last move nor firstTurn (a fact)", async () => {
    const sv = await game(SV);
    const make = (extra: Partial<DoublesPokemonInput>) => {
      const input = turn(sv, [mon("garchomp", "roughskin", "swordsdance", FAST), mon("oricorio", "dancer", "airslash", { item: "choicescarf", boosts: { spe: -1 }, target: PL }), lax(0), lax(1)]);
      input.pokemon[OR] = { ...input.pokemon[OR]!, ...extra };
      return input;
    };
    expect(reasonOf(make({ lastMove: "airslash" }))).toBe(REASONS.needsChoiceLock("Dancer", "Oricorio", "Choice Scarf"));
    expect(reasonOf(make({ firstTurn: false }))).toBe(REASONS.needsChoiceLock("Dancer", "Oricorio", "Choice Scarf"));
    for (const extra of [{ lastMove: "hurricane" }, { lastMove: null }]) {
      expect(factChance(stepOf(ready(make(extra)), OR).facts, "Air Slash fails: Oricorio is locked into Swords Dance by Choice Scarf.")).toBeCloseTo(1, 12);
    }
    expect(ready(make({})).facts).toContain("Assumes Oricorio is not locked into a move by Choice Scarf from an earlier turn.");
    // Magic Room: the item is ignored, no lock (RV2-PC-DAN-SCARF-MR).
    const room = make({});
    room.field = { ...room.field, magicRoom: true };
    expect(stepOf(ready(room), OR).hits.find((hit) => hit.slot === PL)!.kind).toBe("calculated");
  });
  it("review 2 round 2 (R2-A2A3-H-r2-1, R5r2-1: RV2-RB-TRICK-LOCK, -TRICK-CARRIED, -VT-COPY-THEN-TRICK): a Choice item received ends the lock (data/items.ts choice onStart)", async () => {
    const sv = await game(SV);
    // (i) Scarf Oricorio's Air Slash locks it; Gardevoir Tricks it Choice Specs (setItem's Start removes choicelock); the later
    // Swords Dance's copy goes: +2 Attack, no failure.
    const trick = ready(turn(sv, [mon("oricorio", "dancer", "airslash", { item: "choicescarf", ...FAST, target: PL }), lax(0),
      mon("gardevoir", "synchronize", "trick", { item: "choicespecs", target: OL }), mon("garchomp", "roughskin", "swordsdance", { boosts: { spe: -1 } })]));
    expect(stepOf(trick, OL, "Dancer").moveId).toBe("swordsdance");
    expect(stepOf(trick, OL, "Dancer").facts.some((fact) => fact.text.includes("is locked into"))).toBe(false);
    expect(stepOf(trick, OL, "Dancer").hits.some((hit) => hit.facts.some((fact) => fact.text.includes("Attack")))).toBe(true);
    // (ii) Band Oricorio copies Quiver Dance (locked into it), then a Trick of Choice Specs: its own Air Slash lands.
    const copyThenTrick = ready(turn(sv, [mon("oricorio", "dancer", "airslash", { item: "choiceband", boosts: { spe: -2 }, target: PL }), mon("lilligant", "owntempo", "quiverdance", FAST),
      lax(0), mon("gardevoir", "synchronize", "trick", { item: "choicespecs", target: OL })]));
    expect(stepOf(copyThenTrick, OL).facts.some((fact) => fact.text.includes("is locked into"))).toBe(false);
    expect(hitOf(copyThenTrick, OL, PL).kind).toBe("calculated");
    // (iii) A last move and not its first turn (an earlier lock not known), but Tricked a Choice item before the copy: none.
    const carried = turn(sv, [mon("garchomp", "roughskin", "swordsdance"), mon("oricorio", "dancer", "airslash", { item: "choicescarf", boosts: { spe: -2 }, target: PL }),
      mon("gardevoir", "synchronize", "trick", { item: "choicespecs", ...FAST, target: OR }), lax(1)]);
    carried.pokemon[OR] = { ...carried.pokemon[OR]!, lastMove: "airslash", firstTurn: false };
    const after = ready(carried);
    expect(stepOf(after, OR, "Dancer").moveId).toBe("swordsdance");
    expect(factChance(stepOf(after, OR).facts, "Air Slash fails: Oricorio is locked into Swords Dance by Choice Specs.")).toBeCloseTo(1, 12);
    expect(after.facts.some((fact) => fact.includes("from an earlier turn"))).toBe(false);
  });
  it("review 2 round 2 (R5r2-2: RV2-R2-DAN-ROLEPLAY): a Choice holder that becomes a Dancer after its own move is locked into it; its copy fails", async () => {
    const sv = await game(SV);
    const roleplay = ready(turn(sv, [mon("greninja", "protean", "roleplay", { item: "choicescarf", target: OR }), mon("oricorio", "dancer", null),
      mon("garchomp", "roughskin", "swordsdance", { boosts: { spe: -1 } }), lax(1)]));
    expect(factChance(stepOf(roleplay, OL, "Dancer").facts, "Swords Dance fails: Greninja is locked into Role Play by Choice Scarf.")).toBeCloseTo(1, 12);
    expect(roleplay.facts.some((fact) => fact.includes("from an earlier turn"))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Beat Up, Bide
// ------------------------------------------------------------------------------------------------------------------

describe("Beat Up's party at the use (T2P §3.5)", () => {
  it("a user at Showdown position 1 behind a partner that hits with a different power is not followed", async () => {
    const sv = await game(SV);
    const behind = turn(sv, [mon("garchomp", "roughskin", null), mon("houndoom", "flashfire", "beatup", { target: PL, context: { party: ["garchomp", "snorlax"] } }), lax(2), lax(4)]);
    expect(reasonOf(behind)).toBe(REASONS.combo("Beat Up", "Garchomp's hit first"));
    const first = ready(turn(sv, [mon("houndoom", "flashfire", "beatup", { target: PL, context: { party: ["garchomp", "snorlax"] } }), mon("garchomp", "roughskin", null), lax(2), lax(4)]));
    expect(hitOf(first, OL, PL).kind).toBe("calculated");
  });
});

describe("Bide (USUM; C41)", () => {
  it("a first use stores, with its turn fact; a storing turn uses no move", async () => {
    const usum = await game(USUM);
    const first = ready(turn(usum, [lax(1, "bide"), lax(2), lax(4), lax(3)]));
    expect(first.facts).toContain("Assumes Snorlax (yours, 1) did not use Bide on an earlier turn.");
    expect(factChance(stepOf(first, OL).facts, "Snorlax (yours, 1) stores energy (Bide).")).toBeCloseTo(1, 12);
    const storing = ready(turn(usum, [lax(1, "bide", { carried: { bide: { stored: 30, source: PR, release: false } } }), lax(2), lax(4), lax(3, "bodyslam", { target: OL })]));
    expect(stepOf(storing, OL).moves).toBe(0);
    expect(factChance(stepOf(storing, OL).skipped, "Snorlax (yours, 1) stores energy (Bide).")).toBeCloseTo(1, 12);
  });
  it("a release with nothing stored, or no Pokémon that damaged it, fails as its use (bide onBeforeMove: -end, then -fail)", async () => {
    const usum = await game(USUM);
    const release = (stored: number, source: DoublesSlotId | null) => ready(turn(usum, [lax(1, "bide", { carried: { bide: { stored, source, release: true } } }), lax(2), lax(4), lax(3)]));
    const empty = release(0, PR);
    expect(stepOf(empty, OL).moves).toBe(1);
    expect(factChance(stepOf(empty, OL).facts, "Bide fails: Snorlax (yours, 1) stored no damage.")).toBeCloseTo(1, 12);
    expect(empty.hp[PR]!.max).toBe(empty.hp[PR]!.start);
    expect(factChance(stepOf(release(50, null), OL).facts, "Bide fails: no Pokémon damaged Snorlax (yours, 1).")).toBeCloseTo(1, 12);
  });
  it("a release: twice the damage stored at its source, through Protect, as its use (the integrator's fixed hit; CQ-BID-01, 03)", async () => {
    const usum = await game(USUM);
    const release = (move: string | null) => ready(turn(usum, [lax(1, "bide", { carried: { bide: { stored: 50, source: PR, release: true } } }), lax(2), lax(4), lax(3, move)]));
    const plain = release(null);
    expect(plain.hp[PR]!.max).toBe(135);
    expect(release("protect").hp[PR]!.max).toBe(135);
    expect(stepOf(plain, OL).moves).toBe(1);
    expect(stepOf(plain, OL).skipped).toEqual([]);
    expect(hitOf(plain, OL, PR).reached).toBe(1);
    expect(factChance(stepOf(plain, OL).facts, "Snorlax (yours, 1) unleashes the energy (Bide): twice the 50 HP stored.")).toBeCloseTo(1, 12);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The Counter family (the integrator's fixed hit and last-hit lines), Spotlight (the status pipeline's)
// ------------------------------------------------------------------------------------------------------------------

describe("the Counter family's reads", () => {
  it("asks the step for the last hit only for a foe's hit into a user with one queued (the readers rule)", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("bastiodon", "soundproof", "counter"), lax(1), lax(2), lax(4)]);
    const kernel = { input, runtime: sv, isFoe: (a: string, b: string) => a.startsWith("own") !== b.startsWith("own"), alive: (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted } as unknown as TurnKernel;
    const w: World = {
      mass: 1, mons: Object.fromEntries(SLOTS.map((slot) => [slot, { build: input.pokemon[slot]!.build, fainted: false, vol: {}, eot: {} } as unknown as MonState])),
      sides: {} as World["sides"], field: {} as World["field"], remaining: [{ index: 0, slot: OL, moveId: "counter", target: null, fractional: 0 }], executed: 0, factors: [],
    };
    expect(stepReport(kernel, w, PL, OL, "tackle")).toEqual({ lastHit: true });
    expect(stepReport(kernel, w, OR, OL, "tackle")).toBeNull();
    expect(stepReport(kernel, w, OL, PL, "tackle")).toBeNull();
    expect(tracksHits(kernel)).toBe(true);
    w.remaining = [];
    expect(stepReport(kernel, w, PL, OL, "tackle")).toBeNull();
  });
  it("Counter returns twice the hit it took; Metal Burst 1.5 times, rounded down (PR-CTR-01, 03; T2P-CTR)", async () => {
    const sv = await game(SV);
    const counter = ready(turn(sv, [mon("bastiodon", "soundproof", "counter"), lax(1), mon("garchomp", "roughskin", "dragonclaw", { ...FAST, target: OL }), lax(2)]));
    expect(range(counter, OL, PL)).toEqual([36, 44]);
    const burst = ready(turn(sv, [mon("orthworm", "eartheater", "metalburst"), lax(1), mon("garchomp", "roughskin", "dragonclaw", { ...FAST, target: OL }), lax(2)]));
    expect(range(burst, OL, PL)).toEqual([31, 37]);
  });
});

describe("Spotlight (USUM)", () => {
  it("makes its target the centre of attention for its foes' moves (the integrator's lines; PR-SPL-01)", async () => {
    const usum = await game(USUM);
    const result = ready(turn(usum, [mon("clefable", "magicguard", "spotlight", { target: PL }), lax(30, "bodyslam", { target: PR }), lax(2), lax(4)]));
    expect(factChance(stepOf(result, OR).facts, "Spotlight: Snorlax (opponent's, 1) takes Body Slam.")).toBeCloseTo(1, 12);
  });
});

describe("Echoed Voice's pseudo-weather and Room Service (status2 integration 1b; FC's probe RS3)", () => {
  it("a new echoedvoice pseudo-weather under Trick Room uses a held Room Service; one from last turn restarts and uses none", async () => {
    const sv = await game(SV);
    // Trick Room and Magic Room up (Room Service unused under the room: itemUsedBeforeRoom false); the slower Smeargle's Magic
    // Room ends the room first (Trick Room: the slower first), then Chansey's Echoed Voice adds its pseudo-weather (sim/field.ts
    // addPseudoWeather: PseudoWeatherChange).
    const holder = lax(31, null, { item: "roomservice" });
    const mons = (): [Mon, Mon, Mon, Mon] => [mon("smeargle", "owntempo", "magicroom"), mon("chansey", "naturalcure", "echoedvoice", { ...FAST, target: PL }), holder, lax(1)];
    const input = (echoedVoice: 0 | 1) => {
      const made = turn(sv, mons(), { trickRoom: true, magicRoom: true }, { echoedVoice });
      made.pokemon[PL] = { ...made.pokemon[PL]!, build: { ...made.pokemon[PL]!.build, itemUsedBeforeRoom: false } };
      return made;
    };
    const used = (echoedVoice: 0 | 1) => {
      const out = calculateDoublesOutcomes(input(echoedVoice));
      if (out.status !== "ready") throw new Error(`${out.status}: ${JSON.stringify("issues" in out ? out.issues : out)}`);
      return out.outcomes.reduce((sum, o) => sum + (o.mons[PL]!.build.itemId === "" && o.mons[PL]!.build.boosts.spe === -1 ? o.chance : 0), 0);
    };
    expect(used(0)).toBeCloseTo(1, 12);
    expect(stepOf(ready(input(0)), OR).facts.map((fact) => fact.text).some((text) => text.includes("Room Service is used up under Trick Room: −1 Speed."))).toBe(true);
    expect(used(1)).toBeCloseTo(0, 12);
  });
});
