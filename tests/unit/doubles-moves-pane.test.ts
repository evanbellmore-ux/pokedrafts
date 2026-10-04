import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesMoves, doublesRepresentative } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * The 2v2 Moves pane (SPEC §3.3, C8): every learnable move of one slot into another at the start of the turn, the 1v1 rows
 * (Uses to KO included) with the four-way start settle and the partners' abilities, and no move of this turn. With no partner
 * effect a row is the 1v1 Doubles row of that pair; each partner effect equals the 1v1 row with that field flag set.
 */
type P = { id: string; ability?: string; item?: string; hp?: number; move?: string | null; target?: DoublesSlotId; build?: Partial<BattleBuild>; contexts?: Record<string, MoveContext> };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
function build(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  return { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? base.itemId, currentHP: p.hp ?? null, ...p.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, slots: Record<DoublesSlotId, P | null>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = { build: build(runtime, p), contexts: p.contexts ?? {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
/** Moves whose 1v1 row depends on the turn order or an event of the turn (event-moves.ts, count-moves.ts, turn-order.ts). */
const TURN_DEPENDENT = new Set([
  "payback", "boltbeak", "fishiousrend", "analytic", "avalanche", "revenge", "assurance", "lashout", "round", "stompingtantrum", "temperflare",
  "lastrespects", "ragefist", "beatup", "suckerpunch", "thunderclap", "upperhand", "focuspunch", "fakeout", "firstimpression", "metalburst", "counter", "mirrorcoat", "comeuppance",
]);
const damage = (row: MoveDamageResult) => ({
  kind: row.kind, min: row.min, max: row.max, minPercent: row.minPercent, maxPercent: row.maxPercent, hits: row.hits, ohkoChance: row.ohkoChance,
  usesToKO: row.usesToKO, afterUse: row.afterUse && { start: row.afterUse.start, low: row.afterUse.low, high: row.afterUse.high, koChance: row.afterUse.koChance },
});
function expectSameRows(doubles: MoveDamageResult[], single: MoveDamageResult[]) {
  const byMove = new Map(single.map((row) => [row.moveId, row]));
  expect(doubles.map((row) => row.moveId).sort()).toEqual(single.map((row) => row.moveId).sort());
  let compared = 0;
  for (const row of doubles) {
    if (TURN_DEPENDENT.has(row.moveId)) continue;
    expect(damage(row), row.moveId).toEqual(damage(byMove.get(row.moveId)!));
    compared++;
  }
  expect(compared).toBeGreaterThan(20);
}
const doublesField = (extra: Partial<BattleConditions> = {}): BattleConditions => ({ ...createConditions(), gameType: "Doubles", multipleTargets: true, ...extra });
const base: Record<DoublesSlotId, P> = {
  "own-left": { id: "garchomp", ability: "sandveil" }, "own-right": { id: "charizard", ability: "blaze" },
  "opponent-left": { id: "venusaur", ability: "overgrow" }, "opponent-right": { id: "blastoise", ability: "torrent" },
};

describe("calculateDoublesMoves", () => {
  it("gives the 1v1 Doubles rows of the pair when no partner acts on it", () => {
    const input = turn(championsRuntime, base);
    const rows = calculateDoublesMoves(input, "own-left", "opponent-right");
    expect(rows.issues).toEqual({ attacker: [], defender: [], field: [] });
    const single = calculateMatchup(input.pokemon["own-left"]!.build, input.pokemon["opponent-right"]!.build, doublesField(), {}, championsRuntime);
    expectSameRows(rows.results, single.results);
    // Uses to KO is part of the row (SPEC C8).
    expect(rows.results.find((row) => row.moveId === "earthquake")?.usesToKO?.kind).toBe("uses");
  });

  it("orients the field to the slot's side", () => {
    // Your side has Reflect: the opponent's Blastoise attacks into your Garchomp through it.
    const field = { attackerSide: { ...createSide(), reflect: true } };
    const input = turn(championsRuntime, base, field);
    const rows = calculateDoublesMoves(input, "opponent-right", "own-left");
    const single = calculateMatchup(input.pokemon["opponent-right"]!.build, input.pokemon["own-left"]!.build, doublesField({ defenderSide: { ...createSide(), reflect: true } }), {}, championsRuntime);
    expectSameRows(rows.results, single.results);
  });

  it("applies the target's Friend Guard partner, unless the attacker's Mold Breaker ignores it", () => {
    const input = turn(championsRuntime, { ...base, "opponent-left": { id: "vivillon", ability: "friendguard" } });
    const rows = calculateDoublesMoves(input, "own-left", "opponent-right");
    const guarded = calculateMatchup(input.pokemon["own-left"]!.build, input.pokemon["opponent-right"]!.build, doublesField({ defenderSide: { ...createSide(), friendGuard: true } }), {}, championsRuntime);
    expectSameRows(rows.results, guarded.results);
    const moldBreaker = turn(championsRuntime, { ...base, "own-left": { id: "excadrill", ability: "moldbreaker" }, "opponent-left": { id: "vivillon", ability: "friendguard" } });
    const plain = calculateMatchup(moldBreaker.pokemon["own-left"]!.build, moldBreaker.pokemon["opponent-right"]!.build, doublesField(), {}, championsRuntime);
    expectSameRows(calculateDoublesMoves(moldBreaker, "own-left", "opponent-right").results, plain.results);
  });

  it("applies Plus or Minus from the partner, a Ruin from any other Pokémon, and Cloud Nine from any Pokémon", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Plusle with a Minun partner: Plus is active.
    const plus = turn(sv, { ...base, "own-left": { id: "plusle", ability: "plus" }, "own-right": { id: "minun", ability: "minus" } });
    const active = calculateMatchup({ ...plus.pokemon["own-left"]!.build, abilityActive: true }, plus.pokemon["opponent-right"]!.build, doublesField(), {}, sv);
    expectSameRows(calculateDoublesMoves(plus, "own-left", "opponent-right").results, active.results);
    // Chien-Pao's Sword of Ruin lowers the foes' Defense for its partner's moves (calculate.ts makeField ruin).
    const ruin = turn(sv, { ...base, "own-right": { id: "chienpao", ability: "swordofruin" } });
    const ruined = calculateMatchup(ruin.pokemon["own-left"]!.build, ruin.pokemon["opponent-right"]!.build, doublesField({ ruin: { sword: true } }), {}, sv);
    expectSameRows(calculateDoublesMoves(ruin, "own-left", "opponent-right").results, ruined.results);
    // Altaria's Cloud Nine on the far side: Charizard's moves into Blastoise ignore the sun.
    const cloud = turn(championsRuntime, { ...base, "opponent-left": { id: "altaria", ability: "cloudnine" } }, { weather: "Sun" });
    const noSun = calculateMatchup(cloud.pokemon["own-right"]!.build, cloud.pokemon["opponent-right"]!.build, doublesField({ weather: "" }), {}, championsRuntime);
    expectSameRows(calculateDoublesMoves(cloud, "own-right", "opponent-right").results, noSun.results);
  });

  it("leaves this turn's moves out: the partner's Helping Hand", () => {
    const helped = turn(championsRuntime, { ...base, "own-right": { id: "clefable", ability: "magicguard", move: "helpinghand" } });
    const alone = turn(championsRuntime, { ...base, "own-right": { id: "clefable", ability: "magicguard" } });
    expect(calculateDoublesMoves(helped, "own-left", "opponent-right").results.map(damage)).toEqual(calculateDoublesMoves(alone, "own-left", "opponent-right").results.map(damage));
  });

  it("settles the start four ways: a foe's Unnerve keeps the target's Sitrus Berry", () => {
    // Snorlax 100/235 eats its Sitrus Berry before the move (+58), unless a living foe has Unnerve.
    const sitrus = { id: "snorlax", ability: "thickfat", item: "sitrusberry", hp: 100 };
    const eaten = calculateDoublesMoves(turn(championsRuntime, { ...base, "opponent-right": sitrus }), "own-left", "opponent-right").results.find((row) => row.moveId === "dragonclaw")!;
    expect(eaten.afterUse?.start).toBe(158);
    const unnerved = calculateDoublesMoves(turn(championsRuntime, { ...base, "own-right": { id: "tyranitar", ability: "unnerve" }, "opponent-right": sitrus }), "own-left", "opponent-right").results.find((row) => row.moveId === "dragonclaw")!;
    expect(unnerved.afterUse?.start).toBe(100);
  });

  it("has no rows into its own slot or an empty slot", () => {
    const input = turn(championsRuntime, { ...base, "opponent-left": null });
    expect(calculateDoublesMoves(input, "own-left", "own-left").results).toEqual([]);
    expect(calculateDoublesMoves(input, "own-left", "opponent-left").results).toEqual([]);
    // The ally is a valid target of the pane.
    expect(calculateDoublesMoves(input, "own-left", "own-right").results.length).toBeGreaterThan(0);
  });
});

describe("doublesRepresentative", () => {
  it("is the foe across when nothing acts on the slot (SHOWDOWN_POSITION mirrors the far side)", () => {
    const input = turn(championsRuntime, base);
    expect(SLOTS.map((slot) => doublesRepresentative(input, slot))).toEqual(["opponent-left", "opponent-right", "own-left", "own-right"]);
  });

  it("is the Pokémon that acts on it as the turn starts, and null when two different ones do", async () => {
    const unnerve = turn(championsRuntime, { ...base, "own-left": { id: "snorlax", item: "sitrusberry", hp: 100 }, "opponent-right": { id: "tyranitar", ability: "unnerve" } });
    expect(doublesRepresentative(unnerve, "own-left")).toBe("opponent-right");
    const sv = await loadBattleRuntime("scarlet_violet");
    const two = turn(sv, {
      "own-left": { id: "fluttermane", item: "sitrusberry", hp: 50 }, "own-right": { id: "charizard" },
      "opponent-left": { id: "tyranitar", ability: "unnerve" }, "opponent-right": { id: "altaria", ability: "cloudnine" },
    }, { weather: "Sun" });
    expect(doublesRepresentative(two, "own-left")).toBeNull();
  });
});
