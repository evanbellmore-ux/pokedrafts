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
