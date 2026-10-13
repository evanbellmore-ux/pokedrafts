import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 Step 1 #1 (guards.md F1; SPEC2 §8.2): a hit into the attacker's own ally in the pairwise step is an ally's drop.
 * Defiant and Competitive react only to a foe's drop (pinned Showdown c23d2e94 data/abilities.ts defiant / competitive
 * onAfterEachBoost: `if (!source || target.isAlly(source)) return`), and Opportunist copies only a foe's rise
 * (onFoeAfterBoost), so Bulldoze (−1 Speed) into the user's own Defiant partner leaves its Attack at +0 and Flame Charge's rise is not
 * copied by its own Opportunist partner. The numbers are the oracle's (scripts/.cache/calc-audit/2v2/verify cases
 * G4-ALY-01-sv … G4-ALY-04-sv, cases-status2-step1.ts). Level 50, 31 IVs, Serious, 0 EVs (Stat Points in Champions) unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = { species: string; ability: string; evs?: Partial<Record<Stat, number>>; boosts?: Partial<Record<CombatStat, number>>; move: string | null; target?: DoublesSlotId };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = { nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: null, status: "" };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[]): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null });
const hitRange = (input: DoublesTurnInput, slot: DoublesSlotId, target: DoublesSlotId) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status);
  const hit = result.steps.find((step) => step.slot === slot)!.hits.find((each) => each.slot === target)!;
  return [hit.min, hit.max];
};

describe("status2 Step 1 #1: a hit into the attacker's own ally (guards.md F1)", () => {
  it("G4-ALY-01-sv: Bulldoze into its own Defiant Kingambit: no Defiant, Kowtow Cleave at +0 Attack (88–105, not +2)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "garchomp", ability: "roughskin", evs: { spe: 252 }, move: "bulldoze" }, { species: "kingambit", ability: "defiant", move: "kowtowcleave", target: "opponent-left" },
      lax(4), lax(12),
    ]);
    expect(hitRange(input, "own-right", "opponent-left")).toEqual([88, 105]);
  });

  it("G4-ALY-02-swsh: Bulldoze into its own Competitive Milotic: Scald at +0 Sp. Atk (42–51)", async () => {
    const runtime = await game("sword_shield");
    const input = turn(runtime, [
      { species: "garchomp", ability: "roughskin", evs: { spe: 252 }, move: "bulldoze" }, { species: "milotic", ability: "competitive", move: "scald", target: "opponent-left" },
      lax(4), lax(12),
    ]);
    expect(hitRange(input, "own-right", "opponent-left")).toEqual([42, 51]);
  });

  it("G4-ALY-03-champions: Aerodactyl's Bulldoze into its Defiant Kingambit partner: Kowtow Cleave 88–105", async () => {
    const runtime = await game("champions");
    const input = turn(runtime, [
      { species: "aerodactyl", ability: "pressure", evs: { spe: 32 }, move: "bulldoze" }, { species: "kingambit", ability: "defiant", move: "kowtowcleave", target: "opponent-left" },
      lax(4), lax(12),
    ]);
    expect(hitRange(input, "own-right", "opponent-left")).toEqual([88, 105]);
  });

  it("G4-ALY-04-sv (E2): Flame Charge into its own Opportunist Espathra: Arcanine +1 Speed, Espathra keeps +0", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "arcanine", ability: "intimidate", evs: { spe: 252 }, move: "flamecharge", target: "own-right" }, { species: "espathra", ability: "opportunist", move: null },
      lax(4), lax(12),
    ]);
    const out = calculateDoublesOutcomes(input);
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    const stage = (slot: DoublesSlotId, value: number) => out.outcomes.reduce((sum, o) => sum + (o.mons[slot]?.build.boosts.spe === value ? o.chance : 0), 0);
    expect(stage("own-left", 1)).toBeCloseTo(1, 9);
    expect(stage("own-right", 0)).toBeCloseTo(1, 9);
  });

  it("control: a foe's Bulldoze into Defiant Kingambit sets Defiant off (+2 Attack, −1 Speed in E2)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "kingambit", ability: "defiant", move: null }, lax(28),
      { species: "garchomp", ability: "roughskin", evs: { spe: 252 }, move: "bulldoze" }, lax(12),
    ]);
    const out = calculateDoublesOutcomes(input);
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.outcomes.reduce((sum, o) => sum + (o.mons["own-left"]?.build.boosts.atk === 2 && o.mons["own-left"]?.build.boosts.spe === -1 ? o.chance : 0), 0)).toBeCloseTo(1, 9);
  });
});
