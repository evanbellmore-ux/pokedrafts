import { describe, expect, it } from "vitest";
import { filterMoveResults, moveMatchesQuery } from "@/app/(app)/calculator/MoveResults";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { MoveDamageResult } from "@/app/lib/battle/types";

const punctuated = championsRuntime.catalog.moves.filter((move) => /[^A-Za-z0-9 ]/.test(move.name));

function row(moveId: string): MoveDamageResult {
  return { moveId, kind: "calculated", min: 1, max: 2, minPercent: null, maxPercent: null, rolls: 1, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1 };
}

describe("move search", () => {
  it("covers the catalog's punctuated names", () => {
    expect(punctuated.map((move) => move.name)).toEqual(expect.arrayContaining(["U-turn", "Double-Edge", "King's Shield", "Will-O-Wisp", "Baby-Doll Eyes"]));
  });

  it.each(punctuated.map((move) => [move.name, move.id] as const))("finds %s without its punctuation or spacing", (name, id) => {
    const rows = [row(id), row("tackle")];
    const find = (query: string) => filterMoveResults(rows, query, "all").map((result) => result.moveId);
    expect(find(id)).toEqual([id]);
    expect(find(name.replace(/[^A-Za-z0-9]+/g, " "))).toEqual([id]);
    expect(find(name)).toEqual([id]);
    expect(find(name.toUpperCase())).toEqual([id]);
  });

  it("needs every word, in any order, and still rejects a non-match", () => {
    expect(moveMatchesQuery(["Double-Edge"], "edge double")).toBe(true);
    expect(moveMatchesQuery(["Double-Edge"], "  double   edge ")).toBe(true);
    expect(moveMatchesQuery(["Double-Edge"], "double kick")).toBe(false);
    expect(moveMatchesQuery(["U-turn"], "uturnx")).toBe(false);
    expect(moveMatchesQuery(["U-turn"], "")).toBe(true);
  });

  it("does not match across two names, including the repeated effective name", () => {
    // Real rows carry effectiveName = move.name; "Stun Spore" twice must not contain "rest".
    expect(moveMatchesQuery(["Stun Spore", "Stun Spore"], "rest")).toBe(false);
    expect(moveMatchesQuery(["Aqua Jet", "Aqua Jet"], "aqua ta")).toBe(false);
    expect(moveMatchesQuery(["Thunderbolt", "Gigavolt Havoc"], "boltgiga")).toBe(false);
    expect(moveMatchesQuery(["Stun Spore", "Stun Spore"], "stun")).toBe(true);
  });

  it("matches nothing for a query without letters or digits", () => {
    for (const query of ["-", "'", " - ", "とんぼがえり", "Ωμέγα"]) expect(moveMatchesQuery(["U-turn"], query)).toBe(false);
    expect(moveMatchesQuery(["Double-Edge"], "  ")).toBe(true);
  });

  it("also matches a Z-Move or Max Move name", () => {
    expect(moveMatchesQuery(["Tackle", "Breakneck Blitz"], "breakneckblitz")).toBe(true);
    expect(moveMatchesQuery(["Tackle", "Max Strike"], "max strike")).toBe(true);
  });
});
