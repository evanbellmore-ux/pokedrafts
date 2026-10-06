import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Battle } from "@pokedrafts/showdown-sim";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld, TestReveals } from "@/app/(app)/training/model/ai-inputs";
import type { TurnServices } from "@/app/(app)/training/model/ai-view";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { PublicMon } from "@/app/(app)/training/model/public-state";
import type { SheetMember } from "@/app/(app)/training/model/sheet";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch } from "@/scripts/training/lib/match";
import { createRandomSeat } from "@/scripts/training/lib/random-provider";
import { teamPair } from "@/scripts/training/lib/teams";

// SPEC §14.6 S1 (types) and S3 (runtime): the AI's only inputs are plain AiInputs; under the default settings they carry no
// closed Stat Points, no exact HP of the other side and no test reveals, and no test oracle exists.
const oracles = vi.hoisted(() => ({ made: 0 }));
vi.mock("@/app/(app)/training/sim/inputs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/(app)/training/sim/inputs")>();
  return { ...original, createTestOracle: (...args: Parameters<typeof original.createTestOracle>) => { oracles.made++; return original.createTestOracle(...args); } };
});

describe("S1: the AI's input types (SPEC §14.6)", () => {
  it("createTurnServices takes AiInputs, never a Battle", () => {
    expectTypeOf(createTurnServices).parameter(0).toEqualTypeOf<AiInputs>();
    expectTypeOf(createTurnServices).returns.toEqualTypeOf<TurnServices>();
    const never = (battle: Battle, worlds: BeliefWorld[]) => {
      // @ts-expect-error a Battle is not AiInputs
      createTurnServices(battle, worlds, { runtime, keys: { keyOf: () => "", speciesOf: () => "" }, seedBase: "" });
    };
    expect(typeof never).toBe("function");
  });

  it("PublicMon, AiInputs and SheetMember have exactly the allowed fields", () => {
    expectTypeOf<keyof AiInputs>().toEqualTypeOf<"perspective" | "requestId" | "request" | "own" | "sheet" | "public" | "observations" | "reveals" | "info">();
    expectTypeOf<keyof TestReveals>().toEqualTypeOf<"exactHP" | "brought">();
    expectTypeOf<keyof SheetMember>().toEqualTypeOf<"key" | "speciesId" | "name" | "gender" | "nature" | "itemId" | "abilityId" | "moves" | "points">();
    expectTypeOf<keyof PublicMon>().toEqualTypeOf<"key" | "side" | "position" | "speciesId" | "mega" | "hp" | "exact" | "fainted" | "status" | "statusElapsed"
      | "boosts" | "volatiles" | "item" | "ability" | "movesUsed" | "lastMove" | "lastMoveTarget" | "lastResult" | "actions" | "activeTurns" | "timesHit"
      | "switchIns" | "protectStreak" | "lock" | "transformedInto">();
  });
});

describe("S3: AiInputs at run time under the default settings (SPEC §14.6)", () => {
  it("over 200 decisions: closed Stat Points null, no exact HP of the other side, no test reveals, no oracle, plain JSON", async () => {
    const usage = loadTrainingUsage();
    const seen: AiInputs[] = [];
    oracles.made = 0;
    for (let index = 0; seen.length < 200 && index < 60; index++) {
      const pair = teamPair("structure", index, ["S", "V", "U", "A"], runtime);
      await runMatch({
        seats: { p1: { provider: createRandomSeat(), difficulty: "safe" }, p2: { provider: createRandomSeat(), difficulty: "safe" } },
        teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: "structure", index,
        observer: { inputs: (side, _kind, inputs) => { if (inputs && side === "p2") seen.push(inputs); } },
      });
    }
    expect(seen.length).toBeGreaterThanOrEqual(200);
    for (const inputs of seen) {
      expect(inputs.perspective).toBe("p2");
      expect(inputs.sheet.members.every((member) => member.points === null)).toBe(true);
      expect(Object.values(inputs.public.mons).filter((mon) => mon.side === "p1").every((mon) => mon.exact === null)).toBe(true);
      expect(inputs.reveals).toEqual({ exactHP: null, brought: null });
      expect(structuredClone(inputs)).toEqual(inputs);
      expect(JSON.parse(JSON.stringify(inputs))).toEqual(inputs);
    }
    expect(oracles.made).toBe(0);
  }, 300_000);
});
