import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import {
  beforeMoveStart, destinyBondBefore, destinyBondPrepare, entryChanged, entryTie, moveTry, proteanUsed, stallPrepare, stallRaise,
} from "@/app/lib/battle/doubles-history";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel, type TurnMoveInfo } from "@/app/lib/battle/doubles-turn";
import { doublesNames, type DoublesCarried, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { pointFactor, type MonState, type PendingAction, type World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, ChampionsMove } from "@/app/lib/battle/types";

/**
 * status2 Track N (ADDENDUM2 §4.2 N, IN §4.2, T2E §4.7.1 and §4.7.3, C23, C34, C37): app/lib/battle/doubles-history.ts. The
 * numbers are pinned Showdown c23d2e94's, from scripts/.cache/calc-audit/status2/build/W1A-N-probes.ts (.out): the same
 * builds (level 50, 31 IVs, Serious, 0 EVs or Stat Points unless set; p1a own-left, p1b own-right, p2a opponent-right, p2b
 * opponent-left). The stall roll, a Destiny Bond from last turn, the entry order's ties, a used Protean, the recharge, Fake
 * Out and First Impression after the first turn; and each hook's readers rule on a hand-made world.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; carried?: DoublesCarried; build?: Partial<BattleBuild>; extra?: Partial<DoublesPokemonInput>;
  move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon", CHAMPIONS = "champions";
const GAMES = [SV, CHAMPIONS, USUM, SWSH] as const;

const mon = (species: string, ability: string, move: string | null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
/** The probes' lax(n): a Thick Fat Snorlax with 8n Speed EVs. */
const lax = (n: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", move, { evs: { spe: n * 8 }, ...extra });

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...trained, ...m.build } as BattleBuild;
}
/** The four Pokémon in slot order own-left, own-right, opponent-left, opponent-right. */
function turn(runtime: BattleRuntime, mons: [Mon, Mon, Mon, Mon], field: Partial<BattleConditions> = {}, more: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
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
const names = (input: DoublesTurnInput) => doublesNames(input.pokemon, input.runtime);
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const factChance = (facts: { text: string; chance: number }[], text: string) => facts.filter((fact) => fact.text === text).reduce((sum, fact) => sum + fact.chance, 0);
/** Showdown's HP distribution [hp, chance][] as the app's average. */
const mean = (dist: [number, number][]) => dist.reduce((sum, [hp, chance]) => sum + hp * chance, 0);

// ------------------------------------------------------------------------------------------------------------------
// The stall roll (stallPrepare)
// ------------------------------------------------------------------------------------------------------------------

/** Champions' Stat Points: at most 32 a stat (the probes' FAST); the other games' 252 EVs. */
const FAST = (runtime: BattleRuntime) => (runtime.profile.id === "champions" ? 32 : 252);
/** N01: Garchomp (Rough Skin, fast) protects; the slower Hitter Snorlax (0 EVs) uses Facade into it (p2a: opponent-right). */
const protectTurn = (runtime: BattleRuntime, move: string, carried?: DoublesCarried, extra: Partial<Mon> = {}, field: Partial<BattleConditions> = {}) => turn(runtime, [
  mon("garchomp", "roughskin", move, { evs: { spe: FAST(runtime) }, ...(carried ? { carried } : {}), ...extra }), lax(1),
  lax(2), mon("snorlax", "thickfat", "facade", { target: OL }),
], field);
/** Facade's hits into Garchomp (129–138: N01's distribution given a failed roll), lowest to highest roll. */
const N01_HIT: [number, number][] = [[129, 1 / 16], [131, 2 / 16], [132, 3 / 16], [134, 3 / 16], [135, 3 / 16], [137, 2 / 16], [138, 2 / 16]];

describe("the stall roll of a protecting move or Endure (PS/data/conditions.ts:439-462; IN-P01, CQ05)", () => {
  for (const id of GAMES) {
    it(`${id}: a carried counter 3 protects in 1/3 and fails in 2/3 (N01); 9 in 1/9 (N01)`, async () => {
      const runtime = await game(id);
      for (const [stall, pass] of [[3, 1 / 3], [9, 1 / 9]] as const) {
        const result = ready(protectTurn(runtime, "protect", { stall }));
        const chomp = result.hp[OL]!;
        // Showdown N01: Garchomp 183 (full) with the pass chance, else Facade's 129–138; Hitter 235 or 206 (Rough Skin).
        const failed = N01_HIT.map(([hp, p]) => [hp, p * (1 - pass)] as [number, number]);
        expect(chomp.average).toBeCloseTo(mean([...failed, [183, pass]]), 9);
        expect([chomp.min, chomp.max]).toEqual([129, 183]);
        expect(result.hp[PR]!.average).toBeCloseTo(206 * (1 - pass) + 235 * pass, 9);
        expect(factChance(stepOf(result, OL).facts, "Protect fails.")).toBeCloseTo(1 - pass, 12);
        // A failed Protect was used (Showdown: `|move|…|Protect||[still]` then `|-fail|`): it moved.
        expect(stepOf(result, OL).moves).toBeCloseTo(1, 12);
        expect(result.facts).not.toContain("Assumes no protecting move was used last turn.");
      }
    });
  }
  it("sv: the counter's cap 729 (N01)", async () => {
    const capped = ready(protectTurn(await game(SV), "protect", { stall: 729 }));
    expect(capped.hp[OL]!.average).toBeCloseTo(mean([...N01_HIT.map(([hp, p]) => [hp, p * 728 / 729] as [number, number]), [183, 1 / 729]]), 9);
    expect(factChance(stepOf(capped, OL).facts, "Protect fails.")).toBeCloseTo(728 / 729, 12);
  });
  it("C23: a counter of 1 is no protecting move last turn: it protects, with no assumption", async () => {
    const result = ready(protectTurn(await game(SV), "protect", { stall: 1 }));
    expect(result.hp[OL]).toMatchObject({ min: 183, max: 183 });
    expect(factChance(stepOf(result, OL).facts, "Protect fails.")).toBe(0);
    expect(result.facts).not.toContain("Assumes no protecting move was used last turn.");
    const assumed = ready(protectTurn(await game(SV), "protect"));
    expect(assumed.hp[OL]).toMatchObject({ min: 183, max: 183 });
    expect(assumed.facts).toContain("Assumes no protecting move was used last turn.");
  });
  for (const id of [SV, CHAMPIONS] as const) {
    it(`${id}: Endure with a counter 9 keeps 1 HP in 1/9 against a knocking-out hit (N02)`, async () => {
      const result = ready(protectTurn(await game(id), "endure", { stall: 9 }, { hp: 20 }));
      expect(result.hp[OL]).toMatchObject({ min: 0, max: 1 });
      expect(result.hp[OL]!.koChance).toBeCloseTo(8 / 9, 12);
      expect(factChance(stepOf(result, OL).facts, "Endure fails.")).toBeCloseTo(8 / 9, 12);
      // Rough Skin acts in every world (N02: Hitter 206).
      expect(result.hp[PR]).toMatchObject({ min: 206, max: 206 });
    });
  }
  it("sv: confused under Gravity, the self-hit (33/100) comes first, then the roll (N03, IN-P02, TR03)", async () => {
    const result = ready(protectTurn(await game(SV), "protect", { stall: 3, confusion: { attempts: 0 } }, {}, { gravity: true }));
    // N03: full HP 0.223333 (= 0.67 / 3); the failed Protect's Facade 0.446667; the self-hit's 0.33 (Facade after it): 105–138.
    expect(factChance(stepOf(result, OL).facts, "Protect fails.")).toBeCloseTo(0.67 * 2 / 3, 12);
    expect(result.hp[PR]!.average).toBeCloseTo(206 * (1 - 0.67 / 3) + 235 * 0.67 / 3, 9);
    expect([result.hp[OL]!.min, result.hp[OL]!.max]).toEqual([105, 183]);
  });
  // INTEGRATOR (needsFromIntegrator N-5: doubles-status.ts earlyBranch calls proteanGuard per passing world, after the roll): flip to it().
  it("N-5: an unused Protean changes its type only where the roll passes (N10: the failed 2/3 stay Water/Dark)", async () => {
    const input = turn(await game(SV), [
      mon("greninja", "protean", "protect", { carried: { stall: 3 } }), lax(1), lax(2), mon("jolteon", "voltabsorb", "thunderbolt", { target: OL }),
    ]);
    const greninja = ready(input).hp[OL]!;
    // N10: 0 HP in 7/12, 1 HP in 1/12 (the Thunderbolt super effective on Water/Dark), 147 (protected, Normal) in 1/3.
    expect(greninja.koChance).toBeCloseTo(7 / 12, 12);
    expect(greninja.average).toBeCloseTo(1 / 12 + 147 / 3, 9);
  });
  it("a protecting move with no later action fails before the roll: no branch (data/moves.ts:13973-13974)", async () => {
    // Four Protects (+4): the slowest (0 Speed IVs, Brave) is the last action: nothing is queued after it.
    const input = turn(await game(SV), [mon("snorlax", "thickfat", "protect", { ivs: { spe: 0 }, nature: "Brave", carried: { stall: 3 } }), lax(1, "protect"), lax(2, "protect"), lax(3, "protect")]);
    const result = ready(input);
    expect(factChance(stepOf(result, OL).facts, "Protect fails: no Pokémon moves after it.")).toBeCloseTo(1, 12);
    expect(factChance(stepOf(result, OL).facts, "Protect fails.")).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// A Destiny Bond from last turn (destinyBondBefore, destinyBondPrepare)
// ------------------------------------------------------------------------------------------------------------------

/** N05: Weavile (Night Slash) against Gengar (1 HP, Destiny Bond up, opponent-right). Fast: FAST Speed EVs (Gengar Timid); slow: 0 Speed IVs, Brave. */
const weavile = (runtime: BattleRuntime, fast: boolean): Mon => mon("weavile", "pressure", "nightslash", { target: PR, ...(fast ? { evs: { spe: FAST(runtime) } } : { ivs: { spe: 0 }, nature: "Brave" }) });
const gengar = (runtime: BattleRuntime, fast: boolean, move: string | null, asleep = false): Mon => mon("gengar", "cursedbody", move, {
  hp: 1, carried: { destinyBond: true, ...(asleep ? { sleep: { attempts: 0, rest: false } } : {}) }, ...(asleep ? { status: "slp" as const } : {}),
  ...(move === "shadowball" ? { target: OL } : {}), ...(fast ? { evs: { spe: FAST(runtime) }, nature: "Timid" } : { ivs: { spe: 0 }, nature: "Brave" }),
});
const bondTurn = (runtime: BattleRuntime, attacker: Mon, holder: Mon) => turn(runtime, [attacker, lax(1), lax(2), holder]);

describe("a Destiny Bond from last turn (PS/data/moves.ts:3483-3526; IN-P05, CQ06)", () => {
  for (const id of GAMES) {
    it(`${id}: a faster knockout before the holder acts faints the attacker (N05a); asleep too (N05e, CQ06a)`, async () => {
      const runtime = await game(id);
      for (const holder of [gengar(runtime, false, "shadowball"), gengar(runtime, false, "shadowball", true)]) {
        const input = bondTurn(runtime, weavile(runtime, true), holder);
        const result = ready(input);
        expect(result.hp[PR]!.koChance).toBeCloseTo(1, 12);
        expect(result.hp[OL]!.koChance).toBeCloseTo(1, 12);
        expect(factChance(stepOf(result, OL).facts, `Destiny Bond: ${names(input)[OL]} faints too.`)).toBeCloseTo(1, 12);
      }
    });
    it(`${id}: gone at the holder's own BeforeMove: No move (N05b) and a stopped action (asleep: N05d, CQ06b, IN-DBD-03)`, async () => {
      const runtime = await game(id);
      for (const holder of [gengar(runtime, true, null), gengar(runtime, true, "shadowball", true)]) {
        const result = ready(bondTurn(runtime, weavile(runtime, false), holder));
        expect(result.hp[PR]!.koChance).toBeCloseTo(1, 12);
        expect(result.hp[OL]!.koChance).toBe(0);
        expect(result.hp[OL]!.min).toBe(result.hp[OL]!.maximum);
      }
    });
  }
  it("the turn assumes nothing about last turn when the carried state is given", async () => {
    const runtime = await game(SV);
    const input = bondTurn(runtime, weavile(runtime, false), gengar(runtime, true, "destinybond"));
    expect(ready(input).facts).not.toContain(`Assumes ${names(input)[PR]} did not use Destiny Bond last turn.`);
  });
  // INTEGRATOR (needsFromIntegrator N-1: doubles-status.ts earlyBranch calls historyHooks.destinyBondPrepare): flip to it().
  it("N-1: Destiny Bond again while the one from last turn is up fails and leaves none (N05c, IN-P05b, IN-DBD-02)", async () => {
    for (const id of GAMES) {
      const runtime = await game(id);
      const result = ready(bondTurn(runtime, weavile(runtime, false), gengar(runtime, true, "destinybond")));
      expect(factChance(stepOf(result, PR).facts, "Destiny Bond fails: it was used last turn.")).toBeCloseTo(1, 12);
      expect(result.hp[OL]!.koChance).toBe(0);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The entry order (entryTie, entryChanged)
// ------------------------------------------------------------------------------------------------------------------

/** The leads' ability states are made p1a, p1b, p2a, p2b (CQ09): own-left, own-right, opponent-right, opponent-left. */
const LEADS: Partial<Record<DoublesSlotId, number>> = { [OL]: 0, [OR]: 1, [PR]: 2, [PL]: 3 };

describe("the entry order decides a redirection tie (PS/sim/battle.ts:413-419; IN-P08, CQ09, C37)", () => {
  /** N06: RodA (own-left) and RodB (opponent-left) Lightning Rod Raichu at one Speed; Jolteon (opponent-right) Thunderbolts the own-right Snorlax. */
  const rods = (runtime: BattleRuntime, entryOrder?: Partial<Record<DoublesSlotId, number>>) => turn(runtime, [
    mon("raichu", "lightningrod", null), lax(1), mon("raichu", "lightningrod", null), mon("jolteon", "voltabsorb", "thunderbolt", { target: OR }),
  ], {}, entryOrder ? { entryOrder } : {});
  const reached = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)?.reached ?? 0;
  for (const id of GAMES) {
    it(`${id}: at the leads the older rod (own-left, p1a) takes it, although the user's own ally holds the other (N06, CQ09)`, async () => {
      const result = ready(rods(await game(id), LEADS));
      expect(reached(result, PR, OL)).toBeCloseTo(1, 12);
      expect(reached(result, PR, OR)).toBe(0);
      expect(reached(result, PR, PL)).toBe(0);
    });
    it(`${id}: with own-left's ability state newer than the rest, the opponent's rod takes it (N06)`, async () => {
      const result = ready(rods(await game(id), { ...LEADS, [OL]: 4 }));
      expect(reached(result, PR, PL)).toBeCloseTo(1, 12);
      expect(reached(result, PR, OL)).toBe(0);
    });
  }
  for (const id of [SV, USUM] as const) {
    it(`${id}: two equal-Speed Follow Me users: the older takes the Facade aimed at the other (N07, IN-P08a)`, async () => {
      const runtime = await game(id);
      const clefairy = () => mon("clefairy", "magicguard", "followme");
      const follow = (entryOrder: Partial<Record<DoublesSlotId, number>>) => ready(turn(runtime, [
        mon("snorlax", "thickfat", "facade", { target: PL }), lax(1), clefairy(), clefairy(),
      ], {}, { entryOrder }));
      // Leads: A (opponent-right, p2a) older than B (opponent-left, p2b): A takes it (145 → 69 at the lowest roll).
      const leads = follow(LEADS);
      expect(reached(leads, OL, PR)).toBeCloseTo(1, 12);
      expect(stepOf(leads, OL).hits.find((hit) => hit.slot === PR)).toMatchObject({ min: 76 });
      expect(reached(leads, OL, PL)).toBe(0);
      // A's ability state re-made (newest): B takes it.
      const remade = follow({ ...LEADS, [PR]: 4 });
      expect(reached(remade, OL, PL)).toBeCloseTo(1, 12);
      expect(reached(remade, OL, PR)).toBe(0);
    });
  }
  it("an unknown order (a rank missing, or two equal) is not estimated", async () => {
    const runtime = await game(SV);
    for (const entryOrder of [undefined, { [OL]: 0 }, { [OL]: 1, [PL]: 1 }]) expect(calculateDoublesTurn(rods(runtime, entryOrder)).status).toBe("not-estimated");
  });
  // INTEGRATOR (needsFromIntegrator N-2: doubles-turn.ts redirect gives REASONS.needsEntryOrder): flip to it().
  it("N-2: the unknown order's reason names the redirection and the two holders", async () => {
    const runtime = await game(SV);
    const input = rods(runtime);
    const result = calculateDoublesTurn(input);
    const named = names(input);
    expect(result).toMatchObject({ status: "not-estimated", reason: REASONS.needsEntryOrder("Lightning Rod", named[OL], named[PL]) });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The recharge (beforeMoveStart) and the first-turn moves (moveTry)
// ------------------------------------------------------------------------------------------------------------------

describe("the recharge at BeforeMove priority 11 (PS/data/conditions.ts:364-378; TR01, TR11)", () => {
  for (const id of [CHAMPIONS, SV] as const) {
    it(`${id}: an asleep Pokémon that would wake now stays asleep (N08a); no sleep counter moves`, async () => {
      const runtime = await game(id);
      // Its sleep's last BeforeMove: Champions' sleep lasts 2 or 3 (3 after two), the other games' 2–4 (4 after three).
      const attempts = id === CHAMPIONS ? 2 : 3;
      const sleeper = (recharge: boolean) => calculateDoublesOutcomes(turn(runtime, [
        lax(4, null, { status: "slp", carried: { sleep: { attempts, rest: false }, ...(recharge ? { mustRecharge: true as const } : {}) } }), lax(1), lax(3), lax(2),
      ]));
      const asleep = (result: ReturnType<typeof sleeper>) => {
        if (result.status !== "ready") throw new Error(result.status);
        return result.outcomes.reduce((sum, outcome) => sum + (outcome.mons[OL]!.build.status === "slp" ? outcome.chance : 0), 0);
      };
      expect(asleep(sleeper(true))).toBeCloseTo(1, 12);
      expect(asleep(sleeper(false))).toBe(0);
      const facts = ready(turn(runtime, [lax(4, null, { status: "slp", carried: { sleep: { attempts, rest: false }, mustRecharge: true } }), lax(1), lax(3), lax(2)])).facts;
      expect(facts.some((fact) => fact.endsWith("must recharge."))).toBe(true);
    });
    it(`${id}: a confused Pokémon hurts itself in no world (N08b); its control hurts itself in 0.33`, async () => {
      const runtime = await game(id);
      const beamer = (recharge: boolean) => ready(turn(runtime, [
        lax(4, null, { carried: { confusion: { attempts: 0 }, ...(recharge ? { mustRecharge: true as const } : {}) } }), lax(1), lax(3), lax(2),
      ]));
      expect(beamer(true).hp[OL]).toMatchObject({ min: 235, max: 235 });
      expect(beamer(true).hp[OL]!.losses ?? []).toEqual([]);
      // N08b's control: 207–212 in 0.33.
      expect(beamer(false).hp[OL]).toMatchObject({ min: 207, max: 235 });
    });
  }
});

describe("Fake Out and First Impression after the first turn (PS/data/moves.ts:5097-5100, 5483-5486; TR07)", () => {
  for (const id of [CHAMPIONS, SV] as const) {
    it(`${id}: a confused Incineroar under Gravity hurts itself in 0.33, then Fake Out fails (N09a, TR07, IN-FO01)`, async () => {
      const runtime = await game(id);
      const input = turn(runtime, [
        mon("incineroar", "blaze", "fakeout", { target: PR, carried: { confusion: { attempts: 0 } }, extra: { firstTurn: false } }), lax(1), lax(4), lax(2),
      ], { gravity: true });
      const result = ready(input);
      expect(result.hp[OL]).toMatchObject({ min: 147, max: 170 });
      expect(factChance(stepOf(result, OL).facts, `Fake Out fails: it is not ${names(input)[OL]}'s first turn.`)).toBeCloseTo(0.67, 12);
      expect(result.hp[PR]).toMatchObject({ min: 235, max: 235 });
      expect(result.facts).not.toContain("Assumes the attacker's first turn in battle.");
    });
  }
  for (const id of [SV, USUM, SWSH] as const) {
    it(`${id}: Fake Out fails, so the slower Hitter is not flinched and hits (N09b); on the first turn it is (control)`, async () => {
      const runtime = await game(id);
      const fakeOut = (firstTurn?: boolean) => ready(turn(runtime, [
        mon("incineroar", "blaze", "fakeout", { target: PR, ...(firstTurn === undefined ? {} : { extra: { firstTurn } }) }), lax(1), lax(4), mon("snorlax", "thickfat", "facade", { target: OL }),
      ]));
      const late = fakeOut(false);
      expect(late.hp[OL]).toMatchObject({ min: 113, max: 122 });
      expect(late.hp[PR]).toMatchObject({ min: 235, max: 235 });
      const first = fakeOut(true);
      expect(first.hp[OL]).toMatchObject({ min: 170, max: 170 });
      expect(first.hp[PR]).toMatchObject({ min: 206, max: 211 });
      expect(first.facts).not.toContain("Assumes the attacker's first turn in battle.");
      expect(fakeOut().facts).toContain("Assumes the attacker's first turn in battle.");
    });
  }
  for (const id of [USUM, SWSH] as const) {
    it(`${id}: First Impression after the first turn fails (N09c)`, async () => {
      const runtime = await game(id);
      const input = turn(runtime, [mon("golisopod", "emergencyexit", "firstimpression", { target: PR, evs: { spe: 252 }, extra: { firstTurn: false } }), lax(1), lax(4), lax(2)]);
      const result = ready(input);
      expect(factChance(stepOf(result, OL).facts, `First Impression fails: it is not ${names(input)[OL]}'s first turn.`)).toBeCloseTo(1, 12);
      expect(result.hp[PR]).toMatchObject({ min: 235, max: 235 });
    });
  }
});

// ------------------------------------------------------------------------------------------------------------------
// A used Protean or Libero (proteanUsed)
// ------------------------------------------------------------------------------------------------------------------

describe("a used Protean or Libero whose type the input does not give (IN §4.2)", () => {
  // INTEGRATOR (needsFromIntegrator N-3: doubles-turn.ts validate lets a used Protean or Libero through in 2v2): flip to it().
  it("N-3: is not estimated with REASONS.typeUnknown (IN-PRT-01's second half)", async () => {
    const runtime = await game(SV);
    const input = turn(runtime, [mon("meowscarada", "protean", null, { build: { abilityActive: false } }), lax(1), lax(2), mon("snorlax", "thickfat", "facade", { target: OL })]);
    expect(calculateDoublesTurn(input)).toMatchObject({ status: "not-estimated", reason: REASONS.typeUnknown(names(input)[OL], "Protean") });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The hooks on a hand-made world: the readers rule and the cases no full turn reaches yet
// ------------------------------------------------------------------------------------------------------------------

const MONO = (build: BattleBuild, more: Partial<MonState> = {}): MonState => ({
  build, fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0,
  hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {}, ...more,
});
async function handMade(moves: Partial<Record<DoublesSlotId, string | null>> = {}, more: Partial<DoublesTurnInput> = {}, mons: Partial<Record<DoublesSlotId, Partial<MonState>>> = {}) {
  const runtime = await game(SV);
  const input = turn(runtime, [lax(1, moves[OL] ?? null), lax(2, moves[OR] ?? null), lax(3, moves[PL] ?? null), lax(4, moves[PR] ?? null)], {}, more);
  const facts: { text: string; mass: number }[] = [];
  const kernel = {
    input, runtime, names: names(input),
    abilityName: (id: string) => runtime.abilitiesById.get(id)?.name ?? id,
    stepFact: (_action: PendingAction, text: string, mass: number) => { facts.push({ text, mass }); },
    notEstimated: (reason: string): never => { throw new Error(reason); },
  } as unknown as TurnKernel;
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
  const w: World = {
    mass: 1, mons: Object.fromEntries(SLOTS.map((slot) => [slot, MONO(input.pokemon[slot]!.build, mons[slot])])), sides: { own: { ...side }, opponent: { ...side } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining: [], executed: 0, factors: SLOTS.map((slot) => pointFactor(slot, 235)),
  };
  return { kernel, w, facts, runtime };
}
const act = (slot: DoublesSlotId, moveId: string | null, more: Partial<PendingAction> = {}): PendingAction => ({ index: SLOTS.indexOf(slot), slot, moveId, target: null, fractional: 0, ...more });
const moveOf = (runtime: BattleRuntime, id: string) => runtime.movesById.get(id) as ChampionsMove;

describe("the readers rule and the hooks' own cases", () => {
  it("stallPrepare: no counter and no later reader: the world as it came, nothing written", async () => {
    const { kernel, w, facts, runtime } = await handMade({ [OL]: "protect" });
    const out = stallPrepare(kernel, w, act(OL, "protect"), moveOf(runtime, "protect"));
    expect(out).toEqual({ pass: [w], fail: [] });
    expect(w.mons[OL]!.vol).toEqual({});
    expect(facts).toEqual([]);
  });
  it("stallPrepare: a counter c splits 1/c and 1 − 1/c and is not kept after the use without a reader", async () => {
    const { kernel, w, facts, runtime } = await handMade({ [OL]: "protect" }, {}, { [OL]: { vol: { stall: 27 } } });
    const out = stallPrepare(kernel, w, act(OL, "protect"), moveOf(runtime, "protect"));
    expect(out.pass.map((world) => world.mass)).toEqual([1 / 27]);
    expect(out.fail[0].mass).toBeCloseTo(26 / 27, 15);
    expect(out.pass[0].mons[OL]!.vol.stall).toBeUndefined();
    expect(out.fail[0].mons[OL]!.vol.stall).toBeUndefined();
    expect(facts.map((fact) => fact.text)).toEqual(["Protect fails."]);
    expect(facts[0].mass).toBe(out.fail[0].mass);
  });
  it("stallPrepare and stallRaise with a later reader (an Instruct in the turn): 3 on a first use, ×3 to 729 on a pass", async () => {
    for (const [before, after] of [[undefined, 3], [3, 9], [243, 729], [729, 729]] as const) {
      const { kernel, w, runtime } = await handMade({ [OL]: "protect", [OR]: "instruct" }, {}, before === undefined ? {} : { [OL]: { vol: { stall: before } } });
      const out = stallPrepare(kernel, w, act(OL, "protect"), moveOf(runtime, "protect"));
      expect(out.pass[0].mons[OL]!.vol.stall).toBe(after);
      for (const world of out.fail) expect(world.mons[OL]!.vol.stall).toBeUndefined();
      const guard = await handMade({ [OL]: "quickguard", [OR]: "instruct" }, {}, before === undefined ? {} : { [OL]: { vol: { stall: before } } });
      stallRaise(guard.kernel, guard.w, act(OL, "quickguard"));
      expect(guard.w.mons[OL]!.vol.stall).toBe(after);
    }
    const lone = await handMade({ [OL]: "wideguard" }, {}, { [OL]: { vol: { stall: 3 } } });
    stallRaise(lone.kernel, lone.w, act(OL, "wideguard"));
    expect(lone.w.mons[OL]!.vol.stall).toBe(3);
  });
  it("destinyBondBefore: kept for its own Destiny Bond (not as Max Guard), gone for any other move, No move, or a stopped action", async () => {
    for (const [moveId, stopped, kept] of [["destinybond", false, true], ["destinybond", true, false], ["shadowball", false, false], [null, false, false]] as const) {
      const { kernel, w } = await handMade({}, {}, { [OL]: { destinyBond: true } });
      destinyBondBefore(kernel, w, act(OL, moveId), stopped);
      expect(!!w.mons[OL]!.destinyBond).toBe(kept);
    }
    const { kernel, w } = await handMade({}, {}, { [OL]: { destinyBond: true } });
    w.mons[OL]!.build = { ...w.mons[OL]!.build, mechanic: "dynamax" };
    destinyBondBefore(kernel, w, act(OL, "destinybond"), false);
    expect(w.mons[OL]!.destinyBond).toBeUndefined();
  });
  it("destinyBondPrepare: a Destiny Bond still up fails the move and goes; none up: the move goes on", async () => {
    const up = await handMade({}, {}, { [OL]: { destinyBond: true } });
    expect(destinyBondPrepare(up.kernel, up.w, act(OL, "destinybond"))).toBe(true);
    expect(up.w.mons[OL]!.destinyBond).toBeUndefined();
    expect(up.facts).toEqual([{ text: "Destiny Bond fails: it was used last turn.", mass: 1 }]);
    const none = await handMade();
    expect(destinyBondPrepare(none.kernel, none.w, act(OL, "destinybond"))).toBe(false);
    expect(none.facts).toEqual([]);
  });
  it("entryTie: the smaller rank; unknown with a rank missing or equal; a change this turn is newer than any Pokémon's without one", async () => {
    const ranked = await handMade({}, { entryOrder: { [OL]: 2, [OR]: 0, [PL]: 2 } });
    expect(entryTie(ranked.kernel, ranked.w, OL, OR)).toBe(OR);
    expect(entryTie(ranked.kernel, ranked.w, OR, OL)).toBe(OR);
    expect(entryTie(ranked.kernel, ranked.w, OL, PL)).toBeNull();
    expect(entryTie(ranked.kernel, ranked.w, OL, PR)).toBeNull();
    // Two Lightning Rod holders (a tie reader): own-left's ability state re-made this turn is newer than every other.
    const rods = await handMade({}, { entryOrder: { [OR]: 0, [PL]: 1 } });
    for (const slot of [OL, PR] as const) rods.w.mons[slot]!.build = { ...rods.w.mons[slot]!.build, abilityId: "lightningrod" };
    entryChanged(rods.kernel, rods.w, OL);
    expect(rods.w.mons[OL]!.entry).toBe(2);
    expect(entryTie(rods.kernel, rods.w, OL, OR)).toBe(OR);
    expect(entryTie(rods.kernel, rods.w, OL, PR)).toBe(PR);
    entryChanged(rods.kernel, rods.w, PR);
    expect(rods.w.mons[PR]!.entry).toBe(3);
    expect(entryTie(rods.kernel, rods.w, OL, PR)).toBe(OL);
  });
  it("entryChanged: nothing written without a tie reader", async () => {
    const { kernel, w } = await handMade();
    entryChanged(kernel, w, OL);
    expect(w.mons[OL]!.entry).toBeUndefined();
  });
  it("proteanUsed: a used Protean or Libero without types is not estimated; with types, unused, or Terastallized it is not", async () => {
    const runtime = await game(SV);
    const reason = REASONS.typeUnknown("Snorlax (yours, 1)", "Protean");
    const used = await handMade();
    used.w.mons[OL]!.build = { ...used.w.mons[OL]!.build, abilityId: "protean", abilityActive: false };
    expect(() => proteanUsed(used.kernel, used.w, OL)).toThrow(reason);
    used.w.mons[OL]!.build = { ...used.w.mons[OL]!.build, abilityId: "libero" };
    expect(() => proteanUsed(used.kernel, used.w, OL)).toThrow(REASONS.typeUnknown("Snorlax (yours, 1)", runtime.abilitiesById.get("libero")?.name ?? "Libero"));
    for (const change of [{ types: ["Dark"] }, { abilityActive: true }, { mechanic: "tera" as const, configuration: { teraType: "Fire" } }]) {
      const each = await handMade();
      each.w.mons[OL]!.build = { ...each.w.mons[OL]!.build, abilityId: "protean", abilityActive: false, ...change } as BattleBuild;
      expect(() => proteanUsed(each.kernel, each.w, OL)).not.toThrow();
    }
  });
  it("beforeMoveStart: only a recharging Pokémon stops (and its recharge ends); the others go on with no allocation", async () => {
    const { kernel, w } = await handMade({}, {}, { [OL]: { vol: { mustRecharge: true } } });
    expect(beforeMoveStart(kernel, w, act(OR, null))).toBeNull();
    expect(beforeMoveStart(kernel, w, act(OL, null))).toEqual({ go: [], stopped: [w] });
    expect(w.mons[OL]!.vol.mustRecharge).toBeUndefined();
  });
  it("moveTry: a second action of the turn (an instructed move, a Dancer's copy) is not its first; the Z-Move or Max Move is not Fake Out", async () => {
    const { kernel, w, runtime } = await handMade({ [OL]: "fakeout" });
    const info = { transformed: false } as TurnMoveInfo;
    const fake = moveOf(runtime, "fakeout");
    const text = "Fake Out fails: it is not Snorlax (yours, 1)'s first turn.";
    expect(moveTry(kernel, w, act(OL, "fakeout"), fake, PR, info)).toBeNull();
    expect(moveTry(kernel, w, act(OL, "fakeout", { source: "instruct" }), fake, PR, info)).toBe(text);
    expect(moveTry(kernel, w, act(OL, "fakeout", { external: true }), fake, PR, info)).toBe(text);
    expect(moveTry(kernel, w, act(OL, "fakeout", { source: "instruct" }), fake, PR, { transformed: true } as TurnMoveInfo)).toBeNull();
    expect(moveTry(kernel, w, act(OL, "tackle", { source: "instruct" }), moveOf(runtime, "tackle"), PR, info)).toBeNull();
  });
});

describe("review 2 (R6-3): a protecting move reached through Instruct or Sleep Talk rolls last turn's counter", () => {
  // Pinned stall lasts through this turn whatever the Pokémon uses (PS/data/conditions.ts stall, duration 2), and Instruct
  // re-runs lastMove and Sleep Talk a move slot: each through protect's onPrepareHit StallMove (PS/data/moves.ts).
  const instructTurn = async (id: BattleGame, carried?: DoublesCarried) => turn(await game(id), [
    mon("oranguru", "innerfocus", "instruct", { evs: { spe: FAST(await game(id)) }, target: OR }),
    lax(0, "bodyslam", { target: PL, ...(carried ? { carried } : {}), extra: { lastMove: "protect", moves: ["protect", "bodyslam"] } }),
    lax(20, "bodyslam", { target: OR }), lax(1),
  ]);
  for (const id of [SV, USUM] as const) {
    it(`${id}: an instructed Protect after one that worked last turn (stall 3) protects in 1/3 (RV2-R6-INS-PROT-STL3)`, async () => {
      const result = ready(await instructTurn(id, { stall: 3 }));
      expect([result.hp[OR]!.min, result.hp[OR]!.max]).toEqual([147, 235]);
      expect(result.hp[OR]!.average).toBeCloseTo(181.0417, 3);
      expect(factChance(result.steps.find((step) => step.slot === OR && step.moveId === "protect")!.facts, "Protect fails.")).toBeCloseTo(2 / 3, 12);
      expect(result.facts).not.toContain("Assumes no protecting move was used last turn.");
    });
  }
  it("sv: with no counter given it protects and states the assumption (RV2-R6-INS-PROT-NONE); none for an Instruct aimed elsewhere", async () => {
    const result = ready(await instructTurn(SV));
    expect(result.hp[OR]).toMatchObject({ min: 235, max: 235 });
    expect(result.facts).toContain("Assumes no protecting move was used last turn.");
    const elsewhere = await instructTurn(SV);
    elsewhere.pokemon[OL]!.action = { moveId: "instruct", target: PL };
    elsewhere.pokemon[PL] = { ...elsewhere.pokemon[PL]!, lastMove: "bodyslam", lastMoveTarget: OR };
    expect(ready(elsewhere).facts).not.toContain("Assumes no protecting move was used last turn.");
  });
  it("sv: Sleep Talk calling Protect with stall 3: the foe's Body Slam is blocked in 1/6 (RV2-R6-STALK-STL3); none given: the assumption", async () => {
    const runtime = await game(SV);
    const talk = (carried?: DoublesCarried) => turn(runtime, [
      lax(31, "sleeptalk", { status: "slp", ...(carried ? { carried } : {}), extra: { moves: ["sleeptalk", "protect", "bodyslam"] } }), lax(1),
      lax(0, "bodyslam", { target: OL }), lax(2),
    ]);
    const result = ready(talk({ stall: 3, sleep: { attempts: 0, rest: false } }));
    expect(result.hp[OL]!.average).toBeCloseTo(167.5521, 3);
    expect(factChance(result.steps.find((step) => step.slot === PL)!.hits[0].facts, "Protect blocks Body Slam.")).toBeCloseTo(1 / 6, 12);
    expect(ready(talk()).facts).toContain("Assumes no protecting move was used last turn.");
  });
  it("sv round 2 (R6-r2-2, RV2-R6R2-STALK-INS-STL3, -NONE): a Sleep Talk-called Instruct at the only foe re-runs its Protect with last turn's counter", async () => {
    const runtime = await game(SV);
    const make = (carried?: DoublesCarried) => {
      const input = turn(runtime, [
        lax(31, "sleeptalk", { status: "slp", evs: { spe: 252 }, extra: { moves: ["sleeptalk", "instruct"] } }),
        lax(0, "bodyslam", { nature: "Brave", ivs: { spe: 0 }, target: PL }),
        lax(1, null, { ...(carried ? { carried } : {}), extra: { lastMove: "protect", moves: ["protect", "bodyslam"] } }), lax(2),
      ]);
      input.pokemon[PR] = null;
      return input;
    };
    const result = ready(make({ stall: 3 }));
    expect([result.hp[PL]!.min, result.hp[PL]!.max]).toEqual([139, 235]);
    expect(result.hp[PL]!.average).toBeCloseTo(176.375, 9);
    expect(result.facts).not.toContain("Assumes no protecting move was used last turn.");
    expect(ready(make()).facts).toContain("Assumes no protecting move was used last turn.");
  });
});
