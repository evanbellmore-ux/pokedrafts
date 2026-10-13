import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 wave 1a, Track D (SPEC2 §4.5; guards.md §4.8, Step 1 #2): the Berserk / Anger Shell lock. A locked healing Berry
 * (checkedBerserk / checkedAngerShell false: PS/data/abilities.ts:143-173, :414-444) reads as Leftovers in a later single
 * hit's step; the move's AfterMoveSecondary resets the lock and the action's Update eats the Berry at its line. A multi-hit
 * move's onDamage resets it at the first hit (the step eats it between hits); a status move reaching the holder resets it too;
 * a Champions Sheer Force hit runs no AfterMoveSecondary, so its lock stays. Every number is the pinned Showdown oracle's
 * (scripts/.cache/calc-audit/status2/build/w1a-d-cases.ts G4-SFL-01, G4-BZK-…).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; hp?: number; evs?: Partial<Record<Stat, number>>; boosts?: Partial<Record<CombatStat, number>>;
  carried?: DoublesCarried; move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts },
    currentHP: m.hp ?? null, status: "",
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[]): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null }, ...(m.carried ? { carried: m.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null });
const ready = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  return result;
};
const klawf = (hp: number, move: string | null, target?: DoublesSlotId): Mon => ({ species: "klawf", ability: "angershell", item: "sitrusberry", hp, carried: { berryLocked: true }, move, target });
const venusaur: Mon = { species: "venusaur", ability: "overgrow", evs: { spe: 4 }, move: null };

describe("status2 D: the Berserk / Anger Shell lock in later steps (guards.md §4.8)", () => {
  it("G4-SFL-01-champions: a Sheer Force Crunch locks Drampa's Sitrus; the later Body Slam's AfterMoveSecondary resets it (KO 5/256)", async () => {
    const runtime = await game("champions");
    const input = turn(runtime, [
      { species: "drampa", ability: "berserk", item: "sitrusberry", hp: 140, move: "dragonpulse", target: "opponent-right" }, venusaur,
      { species: "feraligatr", ability: "sheerforce", evs: { atk: 32, spe: 32 }, move: "crunch", target: "own-left" },
      { species: "snorlax", ability: "thickfat", move: "bodyslam", target: "own-left" },
    ]);
    const hp = ready(input).hp["own-left"]!;
    expect(hp.koChance).toBeCloseTo(0.01953125, 9);
    expect(hp.average).toBeCloseTo(47.20703125, 6);
    expect([hp.min, hp.max]).toEqual([0, 59]);
  });

  it("G4-BZK-01-sv: a carried lock: Body Slam takes Klawf under half, the Sitrus at the action's end; Anger Shell reads the HP before it", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [klawf(100, "crabhammer", "opponent-right"), venusaur, { species: "snorlax", ability: "thickfat", evs: { atk: 252, spe: 252 }, move: "bodyslam", target: "own-left" }, lax(0)]);
    const result = ready(input);
    expect([result.hp["own-left"]!.min, result.hp["own-left"]!.max]).toEqual([102, 107]);
    expect(result.hp["own-left"]!.average).toBeCloseTo(104.75, 9);
    const crab = result.steps.find((step) => step.slot === "own-left")!.hits.find((hit) => hit.slot === "opponent-right")!;
    expect([crab.min, crab.max]).toEqual([54, 64]);
    const out = calculateDoublesOutcomes(input);
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.outcomes.reduce((sum, o) => sum + (o.mons["own-left"]!.build.itemId === "" && o.mons["own-left"]!.build.boosts.atk === 1 ? o.chance : 0), 0)).toBeCloseTo(1, 9);
  });

  it("G4-BZK-02-sv: a carried lock: Bullet Seed's first hit resets it, the Sitrus is eaten between hits", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [klawf(80, null), venusaur, { species: "breloom", ability: "technician", evs: { atk: 252, spe: 252 }, move: "bulletseed", target: "own-left" }, lax(0)]);
    const hp = ready(input).hp["own-left"]!;
    expect(hp.koChance).toBeCloseTo(0.994531, 6);
    expect([hp.min, hp.max]).toEqual([0, 4]);
  });

  it("G4-BZK-03-sv: a carried lock under half: a foe's Thunder Wave reaches Klawf; the Sitrus is eaten at that action's Update", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [klawf(55, "crabhammer", "opponent-right"), venusaur, { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, move: "thunderwave", target: "own-left" }, lax(0)]);
    const result = ready(input);
    expect(result.endOfTurn.status).toBe("ready");
    if (result.endOfTurn.status !== "ready") return;
    expect([result.endOfTurn.hp["own-left"]!.min, result.endOfTurn.hp["own-left"]!.max]).toEqual([91, 91]);
  });
});

describe("review 2 (R3-1, R3-2): a carried lock at the turn's start; a move that takes the locked or heal-blocked Berry", () => {
  const PL: DoublesSlotId = "opponent-left";
  const zerk = (hp: number, move: string | null = null, target?: DoublesSlotId): Mon => ({ species: "moltresgalar", ability: "berserk", item: "sitrusberry", hp, carried: { berryLocked: true }, move, target });
  it("RD-BZK-START-sv: a carried lock at 70 HP: the turn's first Update does not eat the Sitrus (berserk onTryEatItem: checkedBerserk false), nor does its own attack", async () => {
    const result = ready(turn(await game("scarlet_violet"), [lax(8), lax(16), zerk(70, "airslash", "own-left"), lax(24)]));
    expect([result.hp[PL]!.min, result.hp[PL]!.max]).toEqual([70, 70]);
    expect(result.endOfTurn.status === "ready" && [result.endOfTurn.hp[PL]!.min, result.endOfTurn.hp[PL]!.max]).toEqual([70, 70]);
  });
  it("RD-BZK-THIEF2-sv / RD-BZK-BUGBITE2-sv / RD-HB-BUGBITE-sv: Thief takes and Bug Bite eats the real Sitrus (the lock and Heal Block stop only the holder's own TryEatItem and TryHeal)", async () => {
    const sv = await game("scarlet_violet");
    const thief = ready(turn(sv, [{ species: "sneasler", ability: "poisontouch", hp: 70, evs: { spe: 252 }, move: "thief", target: PL }, lax(8), zerk(120, "airslash", "own-right"), lax(24)]));
    expect([thief.hp["own-left"]!.min, thief.hp["own-left"]!.max]).toEqual([108, 108]);
    const scizor: Mon = { species: "scizor", ability: "technician", hp: 100, evs: { spe: 252 }, move: "bugbite", target: PL };
    const bugBite = ready(turn(sv, [scizor, lax(8), zerk(120, "airslash", "own-right"), lax(24)]));
    expect([bugBite.hp["own-left"]!.min, bugBite.hp["own-left"]!.max]).toEqual([136, 136]);
    expect([bugBite.hp[PL]!.min, bugBite.hp[PL]!.max]).toEqual([36, 50]);
    const healBlocked: Mon = { species: "snorlax", ability: "thickfat", item: "sitrusberry", hp: 100, evs: { spe: 16 }, carried: { healBlock: 2 }, move: null };
    const blocked = ready(turn(sv, [scizor, lax(8), healBlocked, lax(24)]));
    expect([blocked.hp["own-left"]!.min, blocked.hp["own-left"]!.max]).toEqual([136, 136]);
  });
  it("FX-MAGICIAN-LOCK-sv: Magician takes the item after the hit's Update, where the step holds Leftovers in its place: not estimated", async () => {
    const result = calculateDoublesTurn(turn(await game("scarlet_violet"), [{ species: "delphox", ability: "magician", evs: { spe: 252 }, move: "flamethrower", target: PL }, lax(8), zerk(120), lax(24)]));
    expect(result.status === "not-estimated" && result.reason).toBe("Magician with Moltres-Galar's Sitrus Berry is not modelled in 2v2.");
  });
});

describe("review 2 final pass: a lock under a suppressed Berserk stays and keeps nothing (PA-BZK-START-GAS)", () => {
  // The lock is Berserk's state (PS/data/abilities.ts berserk: effectState.checkedBerserk false); a suppressed ability runs
  // no onTryEatItem, onDamage or onAfterMoveSecondary, and pinned keeps abilityState, so the lock outlives the turn (E2).
  const PL: DoublesSlotId = "opponent-left";
  const zerk = (hp: number): Mon => ({ species: "moltresgalar", ability: "berserk", item: "sitrusberry", hp, carried: { berryLocked: true }, move: null });
  const gas: Mon = { species: "weezinggalar", ability: "neutralizinggas", move: null };
  const lockedIn = (input: DoublesTurnInput) => {
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    return out.outcomes.reduce((sum, o) => sum + (o.mons[PL]!.berryLocked ? o.chance : 0), 0);
  };
  it("RV2-PE-GAS-BZK-IDLE-sv: under Neutralizing Gas the idle holder keeps its lock (no AfterMoveSecondary handler)", async () => {
    const input = turn(await game("scarlet_violet"), [gas, lax(16), zerk(120), lax(24)]);
    expect([ready(input).hp[PL]!.min, ready(input).hp[PL]!.max]).toEqual([120, 120]);
    expect(lockedIn(input)).toBeCloseTo(1, 9);
  });
  it("RV2-PE-GAS-BZK-HIT-sv: a Body Slam under half: the Sitrus is eaten at the hit's Update, and the lock stays", async () => {
    const input = turn(await game("scarlet_violet"), [gas, { ...lax(16), move: "bodyslam", target: PL }, zerk(120), lax(24)]);
    const hp = ready(input).hp[PL]!;
    expect([hp.min, hp.max]).toEqual([92, 103]);
    expect(lockedIn(input)).toBeCloseTo(1, 9);
  });
  it("RV2-PE-GA-KLAWF-LOW-sv: Gastro Acid before a slower locked Klawf at 70 HP acts: Gastro Acid's Update eats the Sitrus; the lock stays", async () => {
    const swalot: Mon = { species: "swalot", ability: "stickyhold", evs: { spe: 252 }, move: "gastroacid", target: PL };
    const input = turn(await game("scarlet_violet"), [swalot, lax(16), { ...klawf(70, null) }, lax(24)]);
    expect([ready(input).hp[PL]!.min, ready(input).hp[PL]!.max]).toEqual([106, 106]);
    expect(lockedIn(input)).toBeCloseTo(1, 9);
    // A faster Moltres-Galar's own No move comes first: its working Berserk's AfterMoveSecondary ends the lock (RV2-PE-GA-BZK-LOW-sv).
    const first = turn(await game("scarlet_violet"), [swalot, lax(16), zerk(70), lax(24)]);
    expect([ready(first).hp[PL]!.min, ready(first).hp[PL]!.max]).toEqual([111, 111]);
    expect(lockedIn(first)).toBe(0);
  });
});

describe("review 2, round 2 (R3DEF-R2-3..-7): Pickpocket's real item and its Update, Thief into Gulp Missile, Gastro Acid at the start, Magician into Sticky Hold", () => {
  const OL: DoublesSlotId = "own-left", PL: DoublesSlotId = "opponent-left";
  const range = (hp: { min: number | null; max: number | null }) => [hp.min, hp.max];
  const weavile: Mon = { species: "weavile", ability: "pickpocket", hp: 120, move: null };
  const itemOf = (input: DoublesTurnInput, slot: DoublesSlotId) => {
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    return [...new Set(out.outcomes.map((o) => o.mons[slot]!.build.itemId))];
  };
  it("RV2-R2-PICKPOCKET-HB-sv, -PLAIN-2HIT-sv: Pickpocket takes a heal-blocked attacker's real Sitrus and eats it at the action's Update, before a later hit", async () => {
    const sv = await game("scarlet_violet");
    // Heal Block is the attacker's: Weavile eats the Sitrus it took (data/abilities.ts:3239-3255; sitrusberry onUpdate).
    const blocked = turn(sv, [{ species: "snorlax", ability: "thickfat", item: "sitrusberry", hp: 200, carried: { healBlock: 2 }, move: "bodyslam", target: PL }, lax(8), weavile, lax(24)]);
    expect(range(ready(blocked).hp[PL]!)).toEqual([68, 81]);
    expect(itemOf(blocked, PL)).toEqual([""]);
    // The plain case, then a slower Body Slam: the Sitrus is eaten before it (KO chance 0.84375, 0–6).
    const twice = ready(turn(sv, [{ species: "snorlax", ability: "thickfat", item: "sitrusberry", hp: 200, evs: { spe: 64 }, move: "bodyslam", target: PL },
      { ...lax(0), move: "bodyslam", target: PL }, weavile, lax(24)]));
    expect(range(twice.hp[PL]!)).toEqual([0, 6]);
    expect(twice.hp[PL]!.koChance).toBeCloseTo(0.84375, 12);
  });
  it("RV2-R2-THIEF-GULP-PLAIN-sv: Thief whose user Gulp Missile knocks out before AfterHit is not estimated; a user that survives it steals (-HB-SURVIVE)", async () => {
    const sv = await game("scarlet_violet");
    const cram: Mon = { species: "cramorantgulping", ability: "gulpmissile", item: "sitrusberry", hp: 90, move: null };
    const thief = (hp: number): Mon => ({ species: "sneasler", ability: "poisontouch", hp, evs: { spe: 252 }, move: "thief", target: PL });
    const low = calculateDoublesTurn(turn(sv, [thief(30), lax(8), cram, lax(24)]));
    expect(low.status === "not-estimated" && low.reason).toBe("Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.");
    // At 100 HP Sneasler survives Gulp Missile (62 left) and steals the Sitrus, which it eats at once under half.
    const survives = turn(sv, [thief(100), lax(8), cram, lax(24)]);
    expect(ready(survives).status).toBe("ready");
    expect([itemOf(survives, PL), itemOf(survives, OL)]).toEqual([[""], [""]]);
  });
  it("RV2-R2-GA-LOCK-START-sv: a carried lock with a carried Gastro Acid keeps nothing: the Sitrus is eaten at the turn's first Update", async () => {
    const zerk: Mon = { species: "moltresgalar", ability: "berserk", item: "sitrusberry", hp: 70, carried: { berryLocked: true, gastroAcid: true }, move: "airslash", target: OL };
    const result = ready(turn(await game("scarlet_violet"), [lax(8), lax(16), zerk, lax(24)]));
    expect(result.hp[PL]!.start).toBe(111);
  });
  it("RV2-R2-MAGICIAN-STICKY-HB-sv: Magician takes nothing from a Sticky Hold holder, so a heal-blocked one's stand-in is exact", async () => {
    const muk: Mon = { species: "muk", ability: "stickyhold", item: "sitrusberry", hp: 150, carried: { healBlock: 2 }, move: null };
    const input = turn(await game("scarlet_violet"), [{ species: "delphox", ability: "magician", evs: { spe: 252 }, move: "flamethrower", target: PL }, lax(8), muk, lax(24)]);
    expect(calculateDoublesTurn(input).status).toBe("ready");
    expect(itemOf(input, PL)).toEqual(["sitrusberry"]);
  });
});
