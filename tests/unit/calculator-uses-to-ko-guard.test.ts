import { describe, expect, it, vi } from "vitest";

// A Uses to KO count that throws must leave the row's one-use result standing.
vi.mock("@/app/lib/battle/uses-to-ko", async (original) => ({
  ...await original<typeof import("@/app/lib/battle/uses-to-ko")>(),
  estimateUsesToKO: () => { throw new Error("count failed"); },
}));

describe("Uses to KO guard", () => {
  it("marks the count not estimated and keeps the damage when counting throws", async () => {
    const { calculateMatchup } = await import("@/app/lib/battle/calculate");
    const { createBuild, createConditions } = await import("@/app/lib/battle/model");
    const out = calculateMatchup(createBuild("garchomp"), createBuild("incineroar"), createConditions());
    const row = out.results.find((entry) => entry.moveId === "earthquake")!;
    expect(row).toMatchObject({ kind: "calculated", usesToKO: { kind: "not-estimated", reason: "The uses could not be counted" } });
    expect(row.min).toBeGreaterThan(0);
  });
});
