import { describe, expect, it } from "vitest";
import type { EngineWorld, MonKey } from "@/app/(app)/training/model/ai-view";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { createConditions, createSide, getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleBuild } from "@/app/lib/battle/types";
import { widenWithOutcome, type HpRanges } from "../../scripts/training/lib/engine-range";

/**
 * Integration 2 (status2): conformance gate 4b compares each Pokémon's HP after a real turn with the range E2's outcomes give
 * it. A bench Pokémon that comes in on some paths only must keep its bench HP in the range from the paths where it stays on
 * the bench (postFromOutcome keeps it as it was there). The cell is conformance-SVA's #48 (pool E, Champions): the AI's
 * Espeon uses Baton Pass and its partner Gengar Shadow Ball at Espeon, both Timid with 32 Speed points at −1 (a Speed tie).
 * When Espeon moves first, Sneasler comes in (Baton Pass passes the −1) and takes the Shadow Ball; when Gengar moves first,
 * Espeon faints and Sneasler stays on the bench at full HP. Before this, the range was the newcomer's only ([39, 54]) and the
 * real battle's Sneasler at 157 on the bench was counted outside (15 samples of 57310).
 */
const build = (speciesId: string, nature: string, abilityId: string, itemId: string, points: Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>,
  extra: Partial<BattleBuild> = {}): BattleBuild => ({
  speciesId, nature, abilityId, abilityActive: false, itemId, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: null, status: "",
  game: "champions", points, configuration: { gender: "M" }, ...extra,
} as BattleBuild);
const entry = (b: BattleBuild, moveId: string, target: DoublesSlotId | null, moves: string[]): DoublesPokemonInput =>
  ({ build: b, contexts: {}, charged: false, action: { moveId, target }, moves });
const slow = { atk: 0, def: 0, spa: 0, spd: 0, spe: -1 };
const sneasler = build("sneasler", "Jolly", "unburden", "choicescarf", { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
const input: DoublesTurnInput = {
  runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() },
  pokemon: {
    "own-left": entry(build("venusaur", "Bold", "overgrow", "bigroot", { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 }), "leechseed", "opponent-left", ["leechseed", "ingrain", "sludgebomb", "protect"]),
    "own-right": entry(build("milotic", "Bold", "competitive", "leftovers", { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 }), "scald", "opponent-right", ["aquaring", "scald", "icywind", "protect"]),
    "opponent-left": entry(build("espeon", "Timid", "magicbounce", "lightclay", { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, { currentHP: 124, boosts: slow }), "batonpass", null, ["batonpass", "psychic", "futuresight", "yawn"]),
    "opponent-right": entry(build("gengar", "Timid", "cursedbody", "focussash", { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, { currentHP: 114, boosts: slow }), "shadowball", "opponent-left", ["substitute", "shadowball", "sludgebomb", "perishsong"]),
  },
  canSwitch: { own: true, opponent: true },
  bench: { own: [], opponent: [{ id: "opponent:sneasler", build: sneasler, moves: ["switcheroo", "closecombat", "direclaw", "fakeout"] }] },
};
const world: Pick<EngineWorld, "keys" | "input"> = {
  input, keys: { "own-left": "own:venusaur", "own-right": "own:milotic", "opponent-left": "opponent:espeon", "opponent-right": "opponent:gengar" } as Record<DoublesSlotId, MonKey>,
};

describe("conformance 4b's ranges (scripts/training/lib/engine-range.ts)", () => {
  it("a bench Pokémon that comes in on some paths only keeps its bench HP in the range from the paths where it stays", () => {
    const result = calculateDoublesOutcomes(input);
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.endOfTurn).toBe("applied");
    const full = getBuildStats(sneasler, runtime)!.hp;
    const cameIn = result.outcomes.filter((each) => each.mons["opponent-left"]?.id === "opponent:sneasler");
    const stayed = result.outcomes.filter((each) => !Object.values(each.mons).some((mon) => mon?.id === "opponent:sneasler")
      && !(each.benched?.opponent ?? []).some((left) => left.id === "opponent:sneasler"));
    expect(cameIn.length).toBeGreaterThan(0);
    expect(stayed.length).toBeGreaterThan(0);
    // Where it came in it took the Shadow Ball: below full HP on every roll.
    const newcomer = cameIn.flatMap((each) => each.mons["opponent-left"]!.hp.map((hp) => hp.hp));
    expect(Math.max(...newcomer)).toBeLessThan(full);
    // Where Gengar moved first, Espeon fainted and stayed in its slot.
    for (const each of stayed) expect(each.mons["opponent-left"]!.hp.map((hp) => hp.hp)).toEqual([0]);
    const range: HpRanges = {};
    for (const each of result.outcomes) widenWithOutcome(range, each, world, runtime);
    expect(range["opponent:sneasler"]).toEqual([Math.min(...newcomer), full]);
    // The starting Pokémon: Espeon from 0 (fainted) to its HP as it left (benched by Baton Pass).
    expect(range["opponent:espeon"]).toEqual([0, 124]);
  });
  it("a bench Pokémon that never comes in has its bench HP (currentHP when set)", () => {
    const quiet: DoublesTurnInput = {
      ...input,
      pokemon: { ...input.pokemon, "opponent-left": { ...input.pokemon["opponent-left"]!, action: { moveId: "psychic", target: "own-left" } }, "opponent-right": { ...input.pokemon["opponent-right"]!, action: { moveId: "sludgebomb", target: "own-right" } } },
      bench: { own: [], opponent: [{ id: "opponent:sneasler", build: { ...sneasler, currentHP: 80 } }] },
    };
    const result = calculateDoublesOutcomes(quiet);
    if (result.status !== "ready") throw new Error(result.status);
    const range: HpRanges = {};
    for (const each of result.outcomes) widenWithOutcome(range, each, { ...world, input: quiet }, runtime);
    expect(range["opponent:sneasler"]).toEqual([80, 80]);
  });
});
