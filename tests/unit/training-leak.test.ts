import { describe, expect, it } from "vitest";
import type { WorkBudget } from "@/app/(app)/training/model/decision";
import { l1Fields, runL1Field } from "@/scripts/training/lib/leak-l1";
import { seatBattle } from "./training-sim-fixtures";

// SPEC §14.4 L1 at unit scale (scripts/training/leak.ts runs the full gate): the engine AI's inputs and decisions do not
// change with a hidden field of your side while its channel history is the same; the two test settings do change them.
const SMALL: WorkBudget = { engineCalls: 40, rolloutSamples: 16, stageASamples: 1, stageBSamples: 2, worlds: 2 };
const field = (id: string) => l1Fields().find((each) => each.id === id)!;

describe("training leak L1 (unit scale)", () => {
  it.each(["sp", "hp", "dice", "dice-eot", "choice"])("L1-%s: no difference at any compared AI decision", async (id) => {
    const result = await runL1Field(field(id), { battles: 1, seat: "safe", budget: SMALL });
    expect(result.compared, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.differences, result.notes.join("\n")).toBe(0);
  }, 300_000);

  it("redraws a Substitute's HP, a partial trap's turns left and Champions freeze turns (status-eot EOT-5)", () => {
    const seat = seatBattle([1, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    type Writable = { hp: number; maxhp: number; status: string; statusState: { time?: number }; volatiles: Record<string, { hp?: number; duration?: number }>; addVolatile(id: string, source?: unknown): boolean; setStatus(id: string): boolean };
    const [a, b] = seat.battle.p1.active as unknown as Writable[];
    const foe = seat.battle.p2.active[0] as unknown as Writable;
    a.addVolatile("substitute");
    a.volatiles.substitute.hp = 20;
    b.addVolatile("partiallytrapped", foe);
    b.volatiles.partiallytrapped.duration = 4;
    foe.setStatus("frz");
    const time = foe.statusState.time;
    expect(field("dice-eot").mutate!(seat.battle as never, 1)).toBe(true);
    expect([a.volatiles.substitute.hp, b.volatiles.partiallytrapped.duration, foe.statusState.time]).toEqual([19, 3, time === 1 ? 2 : 1]);
  });

  it("with aiKnows.exactHP on, the same change does reach the AI's inputs", async () => {
    const result = await runL1Field(field("hp-exact"), { battles: 2, seat: "safe", budget: SMALL });
    expect(result.compared).toBeGreaterThan(0);
    expect(result.inputDifferences).toBeGreaterThan(0);
  }, 300_000);

  it("with Stat Points open to the AI, another spread reaches its inputs at the first decision", async () => {
    const result = await runL1Field(field("sp-open"), { battles: 1, seat: "safe", budget: SMALL });
    expect(result.inputDifferences).toBeGreaterThan(0);
  }, 300_000);
});
