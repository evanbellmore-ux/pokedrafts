import { afterEach, describe, expect, it, vi } from "vitest";
import { champions, movesById } from "../../app/lib/battle/catalog";
import { createMoveSlots, describeMoveSlot, type MoveSlot } from "../../app/lib/battle/move-defaults";
import snapshot from "../../data/champions/move-usage.json";

const gameTypes = ["Singles", "Doubles"] as const;
const ids = (slots: MoveSlot[]) => slots.map((slot) => slot.moveId);
const empty = { moveId: null, origin: "empty", gameType: null };

// Importing defaults must never initialize the calculation engine.
vi.mock("@smogon/calc", () => { throw new Error("Move defaults must be engine-independent."); });

afterEach(() => {
  vi.doUnmock("../../app/lib/battle/catalog");
  vi.doUnmock("../../data/champions/move-usage.json");
  vi.resetModules();
});

async function fixtureDefaults(aggregate = ["unknown", "status", "fixed", "unsupported"]) {
  const moves = [
    ...Array.from({ length: 64 }, (_, index) => ({ id: `rank${index}`, category: "Physical", power: 40 })),
    { id: "alpha", category: "Physical", power: 40 },
    { id: "beta", category: "Special", power: 50 },
    { id: "fixed", category: "Physical", power: 0 },
    { id: "multi", category: "Physical", power: 20, multihit: [2, 5] },
    { id: "status", category: "Status", power: 0 },
    { id: "unsupported", category: "Physical", power: 40, unsupported: ["Engine move missing."] },
    { id: "zeta", category: "Special", power: 80 },
    // Typed moves for the same-type fill.
    { id: "stabranked", type: "Normal", category: "Physical", power: 80, accuracy: 100, unsupported: ["Engine move missing."] },
    { id: "stabzero", type: "Normal", category: "Physical", power: 0, accuracy: 100, unsupported: [] },
    { id: "stabspecial", type: "Normal", category: "Special", power: 60, accuracy: 100, unsupported: [] },
    { id: "stabphysical", type: "Normal", category: "Physical", power: 90, accuracy: 80, unsupported: [] },
  ];
  // Typeless rows: the same-type fill adds nothing, so these check the usage and aggregate order.
  const typeless = { types: [], baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } };
  const species = [
    { id: "sparse", moves: ["zeta", "unsupported", "multi", "fixed", "beta", "alpha", "status"], ...typeless },
    { id: "missing", moves: ["zeta", "unsupported", "multi", "fixed", "beta", "alpha", "status"], ...typeless },
    { id: "few", moves: ["status", "multi", "fixed"], ...typeless },
    { id: "unproven", moves: [], unsupported: ["No proven Champions learnset."], ...typeless },
    // Equal Attack and Sp. Atk: both categories count.
    { id: "balanced", types: ["Normal"], baseStats: { hp: 1, atk: 50, def: 1, spa: 50, spd: 1, spe: 1 }, abilities: [], moves: ["stabranked", "stabzero", "stabspecial", "stabphysical"] },
    { id: "special", types: ["Normal"], baseStats: { hp: 1, atk: 40, def: 1, spa: 50, spd: 1, spe: 1 }, abilities: [], moves: ["stabranked", "stabzero", "stabspecial", "stabphysical"] },
  ];
  const formats = {
    Singles: { source: { month: "2026-08" }, species: {}, aggregate: ["zeta", "unsupported"] },
    Doubles: {
      source: { month: "2026-08" },
      species: { sparse: ["status", "unknown", "fixed", "fixed"], few: ["alpha", "multi"] },
      aggregate,
    },
  };
  vi.doMock("../../app/lib/battle/catalog", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../app/lib/battle/catalog")>(),
    movesById: new Map(moves.map((move) => [move.id, move])),
    speciesById: new Map(species.map((row) => [row.id, row])),
  }));
  vi.doMock("../../data/champions/move-usage.json", () => ({ default: { formats } }));
  return import("../../app/lib/battle/move-defaults");
}

describe("Champions quick-move defaults", () => {
  it("is catalog-wide legal, damaging, unique, max-four, deterministic and freshly allocated", () => {
    const before = JSON.stringify({ champions, snapshot });
    for (const gameType of gameTypes) {
      for (const species of champions.species) {
        const first = createMoveSlots(species.id, gameType);
        const second = createMoveSlots(species.id, gameType);
        expect(first, `${species.id} ${gameType}`).toEqual(second);
        expect(first).toHaveLength(4);
        expect(first).not.toBe(second);
        expect(new Set(first).size).toBe(4);
        const selected = first.filter((slot) => slot.moveId !== null);
        const legal = species.moves.filter((id) => movesById.get(id)?.category !== "Status");
        expect(selected).toHaveLength(Math.min(4, legal.length));
        expect(new Set(selected.map((slot) => slot.moveId)).size).toBe(selected.length);
        for (const [index, slot] of first.entries()) {
          expect(slot).not.toBe(second[index]);
          if (slot.moveId === null) {
            expect(slot).toEqual(empty);
          } else {
            expect(legal).toContain(slot.moveId);
            expect(movesById.has(slot.moveId)).toBe(true);
            expect(movesById.get(slot.moveId)?.category).not.toBe("Status");
            expect(["usage", "suggested"]).toContain(slot.origin);
            expect(slot.gameType).toBe(gameType);
          }
        }
        first[0].moveId = "mutated-output";
        expect(createMoveSlots(species.id, gameType)).toEqual(second);
      }
    }
    expect(JSON.stringify({ champions, snapshot })).toBe(before);
  });

  it("preserves independently observed August VGC raw-weight rankings after removing statuses", () => {
    expect(ids(createMoveSlots("kingambit", "Doubles")))
      .toEqual(["suckerpunch", "kowtowcleave", "ironhead", "lowkick"]);
    expect(ids(createMoveSlots("garchomp", "Doubles")))
      .toEqual(["dragonclaw", "earthquake", "rockslide", "stompingtantrum"]);
    expect(ids(createMoveSlots("charizardmegay", "Doubles")))
      .toEqual(["heatwave", "weatherball", "solarbeam", "ancientpower"]);
    expect(createMoveSlots("kingambit", "Doubles").every((slot) => slot.origin === "usage")).toBe(true);
  });

  it("uses BSS instead of VGC for Singles", () => {
    expect(ids(createMoveSlots("garchomp", "Singles")))
      .toEqual(["earthquake", "scaleshot", "dragontail", "rocktomb"]);
    expect(ids(createMoveSlots("charizardmegay", "Singles")))
      .toEqual(["solarbeam", "flamethrower", "airslash", "overheat"]);
    expect(createMoveSlots("garchomp", "Singles")).not.toEqual(createMoveSlots("garchomp", "Doubles"));
    expect(createMoveSlots("garchomp", "Singles").every((slot) => slot.gameType === "Singles")).toBe(true);
  });

  it("does not label a different exact form with base-form usage", () => {
    for (const gameType of gameTypes) {
      expect(createMoveSlots("palafin", gameType).every((slot) => slot.origin === "usage")).toBe(true);
      expect(createMoveSlots("palafinhero", gameType).every((slot) => slot.origin === "suggested")).toBe(true);
      expect(createMoveSlots("aegislash", gameType).every((slot) => slot.origin === "usage")).toBe(true);
      expect(createMoveSlots("aegislashblade", gameType).every((slot) => slot.origin === "suggested")).toBe(true);
    }
    expect(ids(createMoveSlots("charizard", "Doubles")))
      .toEqual(["heatwave", "solarbeam", "weatherball", "ancientpower"]);
    expect(ids(createMoveSlots("charizardmegay", "Doubles")))
      .not.toEqual(ids(createMoveSlots("charizard", "Doubles")));
  });

  it("gives a form without usage a same-type attack for each type, the format's most-used one", () => {
    // Reg M-C newcomers have no M-B usage: the stronger attacking category, ranked by format usage.
    expect(createMoveSlots("rillaboom", "Doubles")[0]).toEqual({ moveId: "woodhammer", origin: "suggested", gameType: "Doubles" });
    expect(ids(createMoveSlots("salamence", "Doubles")).slice(0, 2)).toEqual(["dragonclaw", "dualwingbeat"]);
    expect(ids(createMoveSlots("persianalola", "Doubles"))[0]).toBe("darkpulse");
    expect(ids(createMoveSlots("meganium", "Singles"))[0]).toBe("gigadrain");
    for (const gameType of gameTypes) {
      for (const species of champions.species) {
        const created = createMoveSlots(species.id, gameType);
        // Four usage moves leave no slot to fill.
        if (created.every((slot) => slot.origin === "usage")) continue;
        const slots = created.flatMap((slot) => slot.moveId ? [movesById.get(slot.moveId)!] : []);
        const learnsStab = species.moves.some((id) => { const move = movesById.get(id)!; return species.types.includes(move.type) && move.category !== "Status" && typeof move.power === "number" && move.power > 0; });
        if (learnsStab) expect(slots.some((move) => species.types.includes(move.type)), `${species.id} ${gameType}`).toBe(true);
      }
    }
  });

  it("fills the same-type attack from positive-power, supported moves, by rank then power x accuracy", async () => {
    const fixture = await fixtureDefaults(["stabranked", "unknown"]);
    // The ranked move is unsupported and the zero-power one is skipped; 90 x 80% beats 60 x 100%.
    expect(fixture.createMoveSlots("balanced", "Doubles")[0]).toEqual({ moveId: "stabphysical", origin: "suggested", gameType: "Doubles" });
    // Stronger Sp. Atk: only special attacks count.
    expect(fixture.createMoveSlots("special", "Doubles")[0]).toEqual({ moveId: "stabspecial", origin: "suggested", gameType: "Doubles" });
  });

  it("counts Pure Power's doubled Attack when choosing the category", () => {
    const medicham = ids(createMoveSlots("medicham", "Singles"));
    expect(medicham).not.toContain("psychic");
    expect(medicham.some((id) => ["psychocut", "zenheadbutt"].includes(id!))).toBe(true);
  });

  it("keeps zero-power damaging and multihit moves", () => {
    expect(ids(createMoveSlots("maushold", "Doubles")))
      .toEqual(["populationbomb", "superfang", "feint", "beatup"]);
    expect(movesById.get("superfang")).toMatchObject({ power: 0, category: "Physical" });
    expect(movesById.get("populationbomb")?.multihit).toBe(10);
  });

  it("gives Ditto, unknown IDs and noncanonical display names four distinct empty slots", () => {
    for (const gameType of gameTypes) {
      for (const speciesId of ["ditto", "not-a-species", "Charizard", "constructor", "__proto__", ""]) {
        const slots = createMoveSlots(speciesId, gameType);
        expect(slots).toEqual([empty, empty, empty, empty]);
        expect(new Set(slots).size).toBe(4);
      }
    }
  });

  it("fills sparse or missing usage via aggregate rank then canonical ID, marking both suggested", async () => {
    const fixture = await fixtureDefaults();
    expect(fixture.createMoveSlots("sparse", "Doubles")).toEqual([
      { moveId: "fixed", origin: "usage", gameType: "Doubles" },
      { moveId: "unsupported", origin: "suggested", gameType: "Doubles" },
      { moveId: "alpha", origin: "suggested", gameType: "Doubles" },
      { moveId: "beta", origin: "suggested", gameType: "Doubles" },
    ]);
    expect(ids(fixture.createMoveSlots("missing", "Doubles"))).toEqual(["fixed", "unsupported", "alpha", "beta"]);
    expect(fixture.createMoveSlots("missing", "Doubles").every((slot) => slot.origin === "suggested")).toBe(true);
    expect(ids(fixture.createMoveSlots("missing", "Singles"))).toEqual(["zeta", "unsupported", "alpha", "beta"]);
  });

  it("uses a legal aggregate move ranked 65 before any unused canonical-ID suggestion", async () => {
    // The first 64 aggregate moves are catalog-known but illegal for this exact species.
    const fixture = await fixtureDefaults([...Array.from({ length: 64 }, (_, index) => `rank${index}`), "zeta"]);
    expect(fixture.createMoveSlots("missing", "Doubles")).toEqual([
      { moveId: "zeta", origin: "suggested", gameType: "Doubles" },
      { moveId: "alpha", origin: "suggested", gameType: "Doubles" },
      { moveId: "beta", origin: "suggested", gameType: "Doubles" },
      { moveId: "fixed", origin: "suggested", gameType: "Doubles" },
    ]);
  });

  it("rejects stale illegal/unknown/status snapshot entries, pads scarce pools and never invents proof", async () => {
    const fixture = await fixtureDefaults();
    expect(fixture.createMoveSlots("few", "Doubles")).toEqual([
      { moveId: "multi", origin: "usage", gameType: "Doubles" },
      { moveId: "fixed", origin: "suggested", gameType: "Doubles" },
      empty,
      empty,
    ]);
    expect(fixture.createMoveSlots("unproven", "Doubles")).toEqual([empty, empty, empty, empty]);
  });

  it("describes format/month usage, suggestions, manual choices and empty slots accessibly", () => {
    expect(describeMoveSlot(createMoveSlots("garchomp", "Doubles")[0]))
      .toBe("Common Champions Doubles usage, Aug 2026");
    expect(describeMoveSlot(createMoveSlots("garchomp", "Singles")[0]))
      .toBe("Common Champions Singles usage, Aug 2026");
    expect(describeMoveSlot(createMoveSlots("palafinhero", "Doubles")[0]))
      .toBe("Suggested, per-species usage unavailable for this move");
    expect(describeMoveSlot({ moveId: "tackle", origin: "manual", gameType: null })).toBe("Manually chosen");
    expect(describeMoveSlot({ moveId: null, origin: "empty", gameType: null })).toBe("Choose a move");
  });
});
