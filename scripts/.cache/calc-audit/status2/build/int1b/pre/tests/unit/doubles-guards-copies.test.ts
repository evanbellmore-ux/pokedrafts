import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 wave 1a, Track D (SPEC2 §4.5; guards.md §4.1): Opportunist and Mirror Herb copy a foe's rise. The ledger adds the
 * positive parts of every boost() table a foe of the copier took (applyBoosts' and the pairwise step's, UsesEnv.report.rises),
 * and each copy is applied at the action's AfterMove in its holder's Speed order (PS/data/abilities.ts:3041-3082
 * opportunist; PS/data/items.ts:4146-4190 mirrorherb). Every number is the pinned Showdown oracle's
 * (scripts/.cache/calc-audit/status2/build/w1a-d-cases.ts G4-OPP-…, run by w1a-d-run.ts). Level 50, 31 IVs, Serious, 0 EVs
 * (Stat Points in Champions) unless set.
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
function turn(runtime: BattleRuntime, mons: Mon[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null }, ...(m.carried ? { carried: m.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null });
const ready = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  return result;
};
const hitRange = (input: DoublesTurnInput, slot: DoublesSlotId, target: DoublesSlotId) => {
  const hit = ready(input).steps.find((step) => step.slot === slot)!.hits.find((each) => each.slot === target)!;
  return [hit.min, hit.max];
};
/** E2: the chance the Pokémon's stages after the turn include `stages` (accuracy and evasion from DoublesOutcomeMon.stages). */
const stageChance = (input: DoublesTurnInput, slot: DoublesSlotId, stages: Partial<Record<CombatStat, number>>) => {
  const out = calculateDoublesOutcomes(input);
  if (out.status !== "ready") throw new Error(out.status);
  return out.outcomes.reduce((sum, o) => sum + ((Object.entries(stages) as [CombatStat, number][]).every(([stat, n]) => (o.mons[slot]?.build.boosts[stat] ?? 0) === n) ? o.chance : 0), 0);
};
const TR = { trickRoom: true };

describe("status2 D: Opportunist and Mirror Herb copy a foe's rise (guards.md §4.1)", () => {
  it("G4-OPP-01-sv: Shell Smash's positive parts are copied at its AfterMove: Espathra's Stored Power 147–174", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "cloyster", ability: "skilllink", move: "shellsmash" }, lax(0),
      { species: "espathra", ability: "opportunist", move: "storedpower", target: "own-right" }, lax(0),
    ], TR);
    expect(hitRange(input, "opponent-left", "own-right")).toEqual([147, 174]);
    const smash = ready(input).steps.find((step) => step.slot === "own-left")!;
    expect(smash.facts).toContainEqual({ text: "Opportunist: Espathra copies +2 Attack, +2 Sp. Atk, +2 Speed.", chance: 1 });
    expect(stageChance(input, "opponent-left", { atk: 2, spa: 2, spe: 2 })).toBeCloseTo(1, 9);
  });

  it("G4-OPP-02-sv: a foe's Defiant rise is copied (effect Defiant is not a copy): Stored Power 33–39", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "glalie", ability: "innerfocus", move: "icywind" }, { species: "espathra", ability: "opportunist", evs: { spe: 252 }, move: "storedpower", target: "opponent-right" },
      { species: "kingambit", ability: "defiant", evs: { spe: 252 }, move: null }, lax(252),
    ], TR);
    expect(hitRange(input, "own-right", "opponent-right")).toEqual([33, 39]);
    expect(stageChance(input, "own-right", { atk: 2 })).toBeCloseTo(1, 9);
  });

  it("G4-OPP-03-sv: the step reports its rises: Breaking Swipe's −1 then Weakness Policy's +2/+2 is a +2/+2 copy (Stored Power 105–124)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "garchomp", ability: "roughskin", move: "breakingswipe" }, { species: "espathra", ability: "opportunist", evs: { spe: 252 }, move: "storedpower", target: "opponent-right" },
      { species: "dragonite", ability: "innerfocus", item: "weaknesspolicy", evs: { spe: 252 }, move: null }, lax(252),
    ], TR);
    expect(hitRange(input, "own-right", "opponent-right")).toEqual([105, 124]);
    expect(stageChance(input, "own-right", { atk: 2, spa: 2 })).toBeCloseTo(1, 9);
    expect(stageChance(input, "opponent-left", { atk: 1, spa: 2 })).toBeCloseTo(1, 9);
  });

  it("G4-OPP-04-sv: Mirror Herb copies a foe's Swords Dance and is used up: Kowtow Cleave 175–207", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "scizor", ability: "technician", move: "swordsdance" }, lax(252),
      { species: "kingambit", ability: "pressure", item: "mirrorherb", evs: { spe: 252 }, move: "kowtowcleave", target: "own-right" }, lax(252),
    ], TR);
    expect(hitRange(input, "opponent-left", "own-right")).toEqual([175, 207]);
    const out = calculateDoublesOutcomes(input);
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.outcomes.reduce((sum, o) => sum + (o.mons["opponent-left"]!.build.itemId === "" && o.mons["opponent-left"]!.build.boosts.atk === 2 ? o.chance : 0), 0)).toBeCloseTo(1, 9);
  });

  it("G4-OPP-05-champions: Opportunist in Champions: Stored Power 33–39", async () => {
    const runtime = await game("champions");
    const input = turn(runtime, [
      { species: "scizor", ability: "technician", move: "swordsdance" }, lax(32),
      { species: "espathra", ability: "opportunist", evs: { spe: 32 }, move: "storedpower", target: "own-right" }, lax(32),
    ], TR);
    expect(hitRange(input, "opponent-left", "own-right")).toEqual([33, 39]);
  });

  it("G4-OPP-06-sv: a copy pending from last turn applies at the first AfterMove (another's): Stored Power 48–57", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "espathra", ability: "opportunist", carried: { copy: { spa: 1, spe: 1 } }, move: "storedpower", target: "opponent-right" }, lax(0),
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, move: null }, lax(0),
    ]);
    expect(hitRange(input, "own-left", "opponent-right")).toEqual([48, 57]);
    expect(stageChance(input, "own-left", { spa: 1, spe: 1 })).toBeCloseTo(1, 9);
  });

  it("G4-OPP-07-sv: a copy is not copied back by the other side's Opportunist (Stored Power 9–11 and 25–30)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "scizor", ability: "technician", move: "swordsdance" }, { species: "espathra", ability: "opportunist", evs: { spe: 252 }, move: "storedpower", target: "opponent-left" },
      { species: "espathra", ability: "opportunist", evs: { spe: 100 }, move: "storedpower", target: "own-right" }, lax(252),
    ], TR);
    expect(hitRange(input, "own-right", "opponent-left")).toEqual([9, 11]);
    expect(hitRange(input, "opponent-left", "own-right")).toEqual([25, 30]);
  });

  it("an ally's rise is not copied, and no copier means no copy fact", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "scizor", ability: "technician", move: "swordsdance" }, { species: "espathra", ability: "opportunist", move: null },
      lax(4), lax(8),
    ]);
    const result = ready(input);
    expect(result.steps.flatMap((step) => step.facts).some((fact) => fact.text.includes("copies"))).toBe(false);
    expect(stageChance(input, "own-right", { atk: 0 })).toBeCloseTo(1, 9);
  });
});
