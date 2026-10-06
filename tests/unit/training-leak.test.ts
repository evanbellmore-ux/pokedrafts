import { describe, expect, it } from "vitest";
import type { WorkBudget } from "@/app/(app)/training/model/decision";
import { l1Fields, runL1Field } from "@/scripts/training/lib/leak-l1";

// SPEC §14.4 L1 at unit scale (scripts/training/leak.ts runs the full gate): the engine AI's inputs and decisions do not
// change with a hidden field of your side while its channel history is the same; the two test settings do change them.
const SMALL: WorkBudget = { engineCalls: 40, rolloutSamples: 16, stageASamples: 1, stageBSamples: 2, worlds: 2 };
const field = (id: string) => l1Fields().find((each) => each.id === id)!;

describe("training leak L1 (unit scale)", () => {
  it.each(["sp", "hp", "dice", "choice"])("L1-%s: no difference at any compared AI decision", async (id) => {
    const result = await runL1Field(field(id), { battles: 1, seat: "safe", budget: SMALL });
    expect(result.compared, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.differences, result.notes.join("\n")).toBe(0);
  }, 300_000);

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
