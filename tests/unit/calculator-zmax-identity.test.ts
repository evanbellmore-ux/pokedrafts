import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { usedMoveName } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Which Z-Move or Max Move a use is, and that move's own effects, against pinned Showdown c23d2e94: Z-Bide in Singles
 * (no target), Guardian of Alola's damageCallback on the target's current HP in the 2v2 turn, G-Max Volt Crash's
 * paralysis, a move typed before its conversion (a Refrigerate Weather Ball is Max Hailstorm, which sets hail) and G-Max
 * Chi Strike's critical-hit stages. Singles values: the exact Uses oracle (scripts/.cache/calc-audit/zmove-status/verify/
 * u-oracle2.ts through verify/run.ts); 2v2 values: the exact turn oracle (scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts,
 * cases ZV27-ZV30 and MV14 in zmove-status/verify/cases-zv.ts). Level 50, 31 IVs, 0 EVs, Serious nature.
 */

type Mon = { id: string; ability: string; item?: string; hp?: number };
type Runtime = Awaited<ReturnType<typeof loadBattleRuntime>>;
function build(runtime: Runtime, m: Mon, extra: Partial<BattleBuild> = {}): BattleBuild {
  return {
    ...createBuild(m.id, runtime), nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...(m.hp !== undefined ? { currentHP: m.hp } : {}), ...extra,
  } as BattleBuild;
}
const gmax: Partial<BattleBuild> = { mechanic: "gigantamax", configuration: { gigantamax: true } } as Partial<BattleBuild>;
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, options: { z?: boolean; extra?: Partial<BattleBuild>; field?: Partial<BattleConditions> } = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const contexts: Record<string, MoveContext> = options.z ? { [moveId]: { useZ: true } } : {};
  const out = calculateMatchup(build(runtime, attacker, options.extra), build(runtime, defender), { ...createConditions(), gameType: "Singles", ...options.field }, contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

type Slot = Mon & { move?: string; target?: DoublesSlotId; z?: boolean; dynamax?: boolean };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m, m.dynamax ? { mechanic: "dynamax" } : {}), contexts: m.z && m.move ? { [m.move]: { useZ: true } } : {}, charged: false,
    action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : ""}`);
  return result;
}
const step = (result: Awaited<ReturnType<typeof turn>>, from: DoublesSlotId) => result.steps.find((each) => each.slot === from)!;
const hit = (result: Awaited<ReturnType<typeof turn>>, from: DoublesSlotId, to: DoublesSlotId) => step(result, from).hits.find((each) => each.slot === to);
const U: BattleGame = "ultra_sun_ultra_moon", S: BattleGame = "sword_shield";
const snorlax: Slot = { id: "snorlax", ability: "thickfat" }, blissey: Slot = { id: "blissey", ability: "naturalcure" }, blastoise: Slot = { id: "blastoise", ability: "torrent" };

describe("Z-Bide (Normalium Z)", () => {
  it("fails in Singles: pinned Showdown aims it at its user, where Breakneck Blitz has no target", async () => {
    const z = await row(U, "bide", { id: "abra", ability: "innerfocus", item: "normaliumz" }, { id: "blissey", ability: "naturalcure" }, { z: true });
    expect(z).toMatchObject({ kind: "calculated", effectiveName: "Breakneck Blitz", min: 0, max: 0, description: "Breakneck Blitz fails: in Singles, Z-Bide is aimed at its user." });
    expect(z.usesToKO).toEqual({ kind: "no-damage" });
  });

  it("hits its chosen foe in Doubles (oracle ZV30: 21-25 into Snorlax)", async () => {
    const result = await turn(U, { "own-left": { ...blissey, item: "normaliumz", z: true, move: "bide", target: "opponent-left" }, "own-right": blastoise, "opponent-left": snorlax, "opponent-right": { id: "slowbro", ability: "oblivious" } });
    expect(hit(result, "own-left", "opponent-left")).toMatchObject({ min: 21, max: 25 });
  });
});

describe("Guardian of Alola's damageCallback in the 2v2 turn: 3/4 of the target's current HP", () => {
  const bulu: Slot = { id: "tapubulu", ability: "grassysurge", item: "tapuniumz", z: true, move: "naturesmadness", target: "opponent-left" };
  it("from the HP the target starts the turn at (oracle ZV27, ZV28: 112, and 28 through Protect)", async () => {
    const start = await turn(U, { "own-left": bulu, "own-right": blastoise, "opponent-left": { ...snorlax, hp: 150 }, "opponent-right": blissey }, { terrain: "Grassy" });
    expect(hit(start, "own-left", "opponent-left")).toMatchObject({ min: 112, max: 112 });
    expect(start.hp["opponent-left"]).toMatchObject({ min: 38, max: 38, koChance: 0 });
    const protect = await turn(U, { "own-left": bulu, "own-right": blastoise, "opponent-left": { ...snorlax, hp: 150, move: "protect" }, "opponent-right": blissey }, { terrain: "Grassy" });
    expect(hit(protect, "own-left", "opponent-left")).toMatchObject({ min: 28, max: 28 });
  });

  it("from the HP a faster partner's move left (oracle ZV29: 153-157 after Flamethrower, 51-53 left)", async () => {
    const result = await turn(U, {
      "own-left": { id: "typhlosion", ability: "blaze", move: "flamethrower", target: "opponent-left" }, "own-right": { ...bulu, id: "tapulele", ability: "psychicsurge" },
      "opponent-left": snorlax, "opponent-right": blastoise,
    }, { terrain: "Psychic" });
    expect(hit(result, "own-right", "opponent-left")).toMatchObject({ min: 153, max: 157 });
    expect(result.hp["opponent-left"]).toMatchObject({ min: 51, max: 53, koChance: 0 });
  });
});

describe("a Max Move's own effects (Sword / Shield)", () => {
  it("G-Max Volt Crash paralyses the target: Electro Ball reads the halved Speed once Dynamax ends", async () => {
    // Oracle: out by the 5th use 28.28%, the 6th certainly (Max Lightning's row, no paralysis: the same 6, 5 at 13.74%).
    const volt = await row(S, "electroball", { id: "pikachu", ability: "lightningrod" }, { id: "snorlax", ability: "thickfat" }, { extra: gmax });
    expect(volt.effectiveName).toBe("G-Max Volt Crash");
    expect(volt.usesToKO).toMatchObject({ kind: "uses", guaranteed: 6, fewest: 5 });
    expect((volt.usesToKO as { fasterChance?: number }).fasterChance).toBeCloseTo(0.2828330993652344, 12);
    // Shed Skin's random cure then changes Electro Ball's power.
    const shed = await row(S, "electroball", { id: "pikachu", ability: "lightningrod" }, { id: "scrafty", ability: "shedskin" }, { extra: gmax });
    expect(shed.usesToKO).toEqual({ kind: "not-estimated", reason: "Shed Skin may cure its status" });
  });

  it("a move typed before its conversion is that type's Max Move, with its effects: Refrigerate Weather Ball is Max Hailstorm", async () => {
    expect(usedMoveName("Weather Ball", { name: "Max Strike", type: "Ice", isMax: true })).toBe("Max Hailstorm");
    expect(usedMoveName("Weather Ball", { name: "Breakneck Blitz", type: "Fire", isZ: true })).toBe("Inferno Overdrive");
    expect(usedMoveName("Hyper Voice", { name: "Max Strike", type: "Normal", isMax: true })).toBe("Max Strike");
    // Oracle: hail from the first use; out by the 10th use 99.99998%, the 11th certainly (it was 16 with Max Strike's effects).
    const amaura = { id: "amaura", ability: "refrigerate" };
    const full = await row(S, "weatherball", amaura, { id: "snorlax", ability: "thickfat" }, { extra: { mechanic: "dynamax" } });
    expect(full.effectiveName).toBe("Max Hailstorm");
    expect(full.usesToKO).toMatchObject({ kind: "uses", guaranteed: 11, fewest: 8 });
    expect((full.usesToKO as { carried: string[] }).carried).toContain("Max Hailstorm changes the field.");
    expect((full.usesToKO as { fasterChance?: number }).fasterChance).toBeCloseTo(0.9999997513668859, 12);
    // At 27 HP the first use's hail finishes it (25-30, then 14).
    const low = await row(S, "weatherball", amaura, { id: "snorlax", ability: "thickfat", hp: 27 }, { extra: { mechanic: "dynamax" } });
    expect(low.usesToKO).toMatchObject({ kind: "uses", guaranteed: 1, fewest: 1 });
    // 2v2 (oracle MV14): the partner's later Weather Ball is Ice in the hail, 20-24 into Blissey; the step names Max Hailstorm.
    const result = await turn(S, {
      "own-left": { id: "aurorus", ability: "refrigerate", dynamax: true, move: "weatherball", target: "opponent-left" },
      "own-right": { id: "gigalith", ability: "sturdy", move: "weatherball", target: "opponent-left" }, "opponent-left": blissey, "opponent-right": snorlax,
    });
    expect(step(result, "own-left")).toMatchObject({ effectiveName: "Max Hailstorm", effectiveType: "Ice" });
    expect(hit(result, "own-right", "opponent-left")).toMatchObject({ min: 20, max: 24 });
  });

  it("G-Max Chi Strike: counted until a use's critical-hit ratio would make its hits critical", async () => {
    const machamp = { id: "machamp", ability: "guts" };
    // Oracle: out on the 2nd use, before any certain critical hit.
    const quick = await row(S, "closecombat", machamp, { id: "snorlax", ability: "thickfat" }, { extra: gmax });
    expect(quick.usesToKO).toMatchObject({ kind: "uses", guaranteed: 2, fewest: 2 });
    // The 4th use (the move itself, 3 layers) is always critical: a count certain by then is the same (oracle: 4, 3 at 53.78%).
    const fourth = await row(S, "focusblast", machamp, { id: "snorlax", ability: "thickfat" }, { extra: gmax });
    expect(fourth.usesToKO).toMatchObject({ kind: "uses", guaranteed: 4, fewest: 3, fasterChance: 0.537841796875 });
    // One that needs more (Vacuum Wave: 5 in the oracle, 6 without the critical hits) is not counted.
    const slow = await row(S, "vacuumwave", machamp, { id: "snorlax", ability: "thickfat" }, { extra: gmax });
    expect(slow.usesToKO).toEqual({ kind: "not-estimated", reason: "G-Max Chi Strike raises the critical-hit ratio" });
  });
});
