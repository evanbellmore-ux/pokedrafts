import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  USAGE_SOURCES,
  buildMoveUsageSnapshot,
  deriveFormatUsage,
  parseUsageArchive,
} from "../../scripts/import-champions-move-usage.mjs";
import snapshot from "../../data/champions/move-usage.json";
import packageJSON from "../../package.json";

type GameType = "Singles" | "Doubles";
type Row = { Moves: Record<string, unknown>; usage?: number };
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const ids = ["alpha", "beta", "delta", "epsilon", "fixed", "gamma", "multi", "protect", "unsupported"];

function catalogFixture() {
  return {
    version: 1, game: "champions",
    species: [
      { id: "fixturemon", name: "Fixturemon", calcName: "Fixturemon-Exact", baseSpecies: "fixturemon", moves: [...ids] },
      { id: "fixturemonmega", name: "Fixturemon-Mega", calcName: "Fixturemon-Mega", baseSpecies: "fixturemon", moves: [...ids] },
      { id: "othermon", name: "Othermon", calcName: "Othermon", baseSpecies: "othermon", moves: [...ids] },
    ],
    moves: [...ids, "illegal"].map((id) => ({
      id, name: id, category: id === "protect" ? "Status" : "Physical",
      power: id === "fixed" || id === "protect" ? 0 : 40,
      multihit: id === "multi" ? [2, 5] : null,
      unsupported: id === "unsupported" ? ["Engine move missing."] : [],
    })),
  };
}

function usageFixture(gameType: GameType = "Doubles", rows: Record<string, Row> = {
  Fixturemon: { Moves: { alpha: 1000, beta: 900 } },
  Othermon: { Moves: { beta: 10 } },
}) {
  const pin = USAGE_SOURCES[gameType];
  const payload = {
    info: {
      metagame: pin.format, cutoff: pin.cutoff, "number of battles": 123,
      "cutoff deviation": 0, "team type": null,
    },
    data: rows,
  };
  const archive = gzipSync(JSON.stringify(payload));
  const source = {
    ...pin, battles: 123, speciesRows: Object.keys(rows).length,
    archiveBytes: archive.length, sha256: sha256(archive),
  };
  return { payload, archive, source };
}

/** Re-sign malformed fixtures so failures exercise schema/metadata, not just hashing. */
function repack(payload: unknown, source = usageFixture().source) {
  const archive = gzipSync(typeof payload === "string" ? payload : JSON.stringify(payload));
  return { archive, source: { ...source, archiveBytes: archive.length, sha256: sha256(archive) } };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No unit-test network is allowed."));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("Champions usage transformation (small offline fixtures)", () => {
  it("is reproducible, order-independent and nonmutating, with catalog digest and source provenance", () => {
    const catalog = catalogFixture();
    const doubles = usageFixture();
    const singles = usageFixture("Singles");
    const catalogJSON = `${JSON.stringify(catalog)}\n`;
    const before = JSON.stringify({ catalog, doubles, singles });
    const first = buildMoveUsageSnapshot(catalogJSON, [doubles, singles]);
    expect(buildMoveUsageSnapshot(catalogJSON, [singles, doubles])).toEqual(first);
    expect(JSON.stringify({ catalog, doubles, singles })).toBe(before);
    const reversedCatalog = {
      ...catalog,
      species: [...catalog.species].reverse().map((row) => ({ ...row, moves: [...row.moves].reverse() })),
      moves: [...catalog.moves].reverse(),
    };
    const reversedPayload = {
      ...doubles.payload,
      data: Object.fromEntries(Object.entries(doubles.payload.data).reverse().map(([name, row]) => [name, {
        ...row, Moves: Object.fromEntries(Object.entries(row.Moves).reverse()),
      }])),
    };
    expect(deriveFormatUsage(reversedCatalog, reversedPayload, doubles.source))
      .toEqual(deriveFormatUsage(catalog, doubles.payload, doubles.source));
    expect(first.catalogSha256).toBe(sha256(catalogJSON));
    expect(first.formats.Doubles.source).toEqual({
      url: doubles.source.url, format: doubles.source.format, month: "2026-08", cutoff: 1630,
      battles: 123, archiveBytes: doubles.archive.length, archiveSha256: sha256(doubles.archive),
    });
    expect(first.attribution.name).toContain("Smogon");
    expect(JSON.stringify(first)).not.toMatch(/generatedAt|timestamp/);
  });

  it("filters before taking four: invalid weights, unknown/illegal/status and empty IDs never rank", () => {
    const data = usageFixture("Doubles", {
      Fixturemon: { Moves: {
        "": 1e7, unknown: 1e7, illegal: 1e7, protect: 1e7,
        beta: 0, gamma: -3, delta: "999", epsilon: null,
        alpha: 1, fixed: 500, multi: 500, unsupported: 2,
      } },
      Othermon: { Moves: { alpha: Number.NaN, beta: Infinity, delta: -Infinity, gamma: undefined } },
    });
    const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
    expect(format.species.fixturemon).toEqual(["fixed", "multi", "unsupported", "alpha"]);
    expect(format.species.othermon).toEqual([]);
    expect(format.aggregate).toEqual(["fixed", "multi", "unsupported", "alpha"]);
    expect(format.coverage.filteredMoves).toEqual({ emptyId: 1, invalidWeight: 8, unknownId: 1, illegal: 1, status: 1 });
    expect(format.coverage.speciesWithRankedMoves).toBe(1);
    // Fixed damage and multihit survive; unsupported only means the engine warns elsewhere.
    expect(format.species.fixturemon).toContain("fixed");
    expect(format.species.fixturemon).toContain("multi");
    expect(format.species.fixturemon).toContain("unsupported");
  });

  it("retains sparse and empty rows without fabricating species moves", () => {
    const data = usageFixture("Doubles", {
      Fixturemon: { Moves: { alpha: 0.0000001, protect: 1000 } },
      Othermon: { Moves: {} },
    });
    const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
    expect(format.species).toEqual({ fixturemon: ["alpha"], othermon: [] });
    expect(format.coverage).toMatchObject({
      matchedSpecies: 2, speciesWithRankedMoves: 1, catalogSpeciesWithoutSourceRows: 1, catalogSpeciesWithoutRankedMoves: 2,
    });
  });

  it("sums raw weighted counts, not percentages or species usage rates", () => {
    const data = usageFixture("Doubles", {
      Fixturemon: { usage: 0.0001, Moves: { alpha: 1000, beta: 900 } },
      Othermon: { usage: 0.9, Moves: { beta: 10 } },
    });
    const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
    expect(format.aggregate).toEqual(["alpha", "beta"]); // 1000 > 910, no per-species normalization.
    expect(format.species.fixturemon).toEqual(["alpha", "beta"]);
    expect(buildMoveUsageSnapshot(JSON.stringify(catalogFixture()), [data, usageFixture("Singles")]).attribution.note)
      .toContain("raw weighted counts, not percentages");
  });

  it("sums the full filtered tables, including fifth-ranked species moves, with canonical ties", () => {
    const data = usageFixture("Doubles", {
      Fixturemon: { Moves: { alpha: 100, beta: 90, gamma: 80, delta: 70, epsilon: 60 } },
      Othermon: { Moves: { epsilon: 100, multi: 100, fixed: 100 } },
    });
    const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
    expect(format.species.fixturemon).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(format.aggregate).toEqual(["epsilon", "alpha", "fixed", "multi", "beta", "gamma", "delta"]);
  });

  it("retains the complete aggregate rank, including moves below rank 64", () => {
    const moveIds = Array.from({ length: 70 }, (_, index) => `move${String(index).padStart(2, "0")}`);
    const catalog = catalogFixture();
    catalog.moves = moveIds.map((id) => ({ id, name: id, category: "Physical", power: 40, multihit: null, unsupported: [] }));
    catalog.species = catalog.species.map((row) => ({ ...row, moves: moveIds }));
    const data = usageFixture("Doubles", { Fixturemon: { Moves: Object.fromEntries(moveIds.map((id) => [id, 1])) } });
    const format = deriveFormatUsage(catalog, data.payload, data.source);
    expect(format.aggregate).toEqual(moveIds);
    expect(format.aggregate[64]).toBe("move64");
    expect(format.coverage.aggregateDamagingMoves).toBe(70);
    expect(format.coverage).not.toHaveProperty("aggregateRankLimit");
  });

  it("accepts only exact catalog IDs, names and explicit calcName aliases, without form inheritance", () => {
    for (const identity of ["fixturemon", "Fixturemon", "Fixturemon-Exact"]) {
      const data = usageFixture("Doubles", { [identity]: { Moves: { alpha: 100 } } });
      const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
      expect(format.species).toEqual({ fixturemon: ["alpha"] });
      expect(Object.hasOwn(format.species, "fixturemonmega")).toBe(false);
    }
    const data = usageFixture("Doubles", {
      "Fixturemon-Mega": { Moves: { beta: 100 } },
      "Fixturemon-Other": { Moves: { alpha: 1e9 } },
      fixtureMon: { Moves: { alpha: 1e9 } },
    });
    const format = deriveFormatUsage(catalogFixture(), data.payload, data.source);
    expect(format.species).toEqual({ fixturemonmega: ["beta"] });
    expect(format.aggregate).toEqual(["beta"]);
    expect(format.coverage.unmatchedSpecies).toEqual(["Fixturemon-Other", "fixtureMon"]);
  });

  it("prefers exact catalog identities over shared engine aliases without copying form usage", () => {
    const catalog = catalogFixture();
    catalog.species[0].calcName = "Fixturemon";
    catalog.species[1].calcName = "Fixturemon";
    for (const species of [catalog.species, [...catalog.species].reverse()]) {
      const baseOnly = usageFixture("Doubles", { Fixturemon: { Moves: { alpha: 100 } } });
      expect(deriveFormatUsage({ ...catalog, species }, baseOnly.payload, baseOnly.source).species)
        .toEqual({ fixturemon: ["alpha"] });
      const both = usageFixture("Doubles", {
        Fixturemon: { Moves: { alpha: 100 } }, "Fixturemon-Mega": { Moves: { beta: 10 } },
      });
      expect(deriveFormatUsage({ ...catalog, species }, both.payload, both.source).species)
        .toEqual({ fixturemon: ["alpha"], fixturemonmega: ["beta"] });
    }
  });

  it("rejects ambiguous catalog-backed aliases and duplicate resolved source rows", () => {
    const catalog = catalogFixture();
    catalog.species[1].calcName = "Fixturemon-Exact";
    const data = usageFixture();
    expect(() => deriveFormatUsage(catalog, data.payload, data.source)).toThrow("Ambiguous catalog species alias");
    const canonicalCollision = catalogFixture();
    canonicalCollision.species[1].name = "Fixturemon";
    expect(() => deriveFormatUsage(canonicalCollision, data.payload, data.source)).toThrow("Ambiguous catalog species alias");
    const duplicate = usageFixture("Doubles", {
      Fixturemon: { Moves: { alpha: 1 } },
      "Fixturemon-Exact": { Moves: { beta: 2 } },
    });
    expect(() => deriveFormatUsage(catalogFixture(), duplicate.payload, duplicate.source))
      .toThrow("Multiple usage rows resolve to catalog species");
  });

  it("fails closed for invalid catalogs, duplicate IDs, unproven move references and numeric overflow", () => {
    const data = usageFixture();
    const badCatalogs = [
      {},
      { ...catalogFixture(), game: "gen9" },
      { ...catalogFixture(), moves: [{ category: "Physical" }] },
      { ...catalogFixture(), species: [{ ...catalogFixture().species[0], id: 123 }] },
      { ...catalogFixture(), moves: [...catalogFixture().moves, catalogFixture().moves[0]] },
      { ...catalogFixture(), species: [...catalogFixture().species, catalogFixture().species[0]] },
      { ...catalogFixture(), species: [{ ...catalogFixture().species[0], moves: ["unknown"] }] },
    ];
    for (const catalog of badCatalogs) expect(() => deriveFormatUsage(catalog, data.payload, data.source)).toThrow();
    const overflow = usageFixture("Doubles", {
      Fixturemon: { Moves: { alpha: Number.MAX_VALUE } },
      Othermon: { Moves: { alpha: Number.MAX_VALUE } },
    });
    expect(() => deriveFormatUsage(catalogFixture(), overflow.payload, overflow.source)).toThrow("weight overflow");
  });

  it("requires both distinct formats and never shares aggregate ranks between Singles and Doubles", () => {
    const doubles = usageFixture("Doubles", { Fixturemon: { Moves: { alpha: 10 } } });
    const singles = usageFixture("Singles", { Fixturemon: { Moves: { beta: 20 } } });
    const catalogJSON = JSON.stringify(catalogFixture());
    const built = buildMoveUsageSnapshot(catalogJSON, [doubles, singles]);
    expect(built.formats.Doubles.aggregate).toEqual(["alpha"]);
    expect(built.formats.Singles.aggregate).toEqual(["beta"]);
    expect(() => buildMoveUsageSnapshot(catalogJSON, [doubles])).toThrow("exactly one Singles and one Doubles");
    expect(() => buildMoveUsageSnapshot(catalogJSON, [doubles, doubles])).toThrow("exactly one Singles and one Doubles");
  });
});

describe("pinned usage archive guards (offline gzip fixtures)", () => {
  it("verifies source bytes and preserves raw numeric weights without fetching", () => {
    const fixture = usageFixture();
    expect(parseUsageArchive(fixture.archive, fixture.source)).toEqual(fixture.payload);
    expect(parseUsageArchive(fixture.archive, fixture.source).data.Fixturemon.Moves.alpha).toBe(1000);
  });

  it("rejects hash mismatch, wrong archive length, compressed overflow and decompression overflow", () => {
    const fixture = usageFixture();
    const changed = Buffer.from(fixture.archive);
    changed[changed.length - 1] ^= 1;
    expect(() => parseUsageArchive(changed, fixture.source)).toThrow("checksum mismatch");
    expect(() => parseUsageArchive(fixture.archive, { ...fixture.source, archiveBytes: fixture.archive.length + 1 })).toThrow("size mismatch");
    expect(() => parseUsageArchive(fixture.archive, fixture.source, { maxArchiveBytes: fixture.archive.length - 1 }))
      .toThrow("compressed byte limit");
    expect(() => parseUsageArchive(fixture.archive, fixture.source, { maxOutputBytes: 32 })).toThrow();
  });

  it("rejects malformed gzip/JSON even when its bytes match the supplied fixture hash", () => {
    const fixture = usageFixture();
    const garbage = Buffer.from("not a gzip file");
    expect(() => parseUsageArchive(garbage, { ...fixture.source, archiveBytes: garbage.length, sha256: sha256(garbage) })).toThrow();
    const invalidJSON = repack('{"info":', fixture.source);
    expect(() => parseUsageArchive(invalidJSON.archive, invalidJSON.source)).toThrow();
  });

  it("rejects wrong metagame, cutoff, battles, deviation, team type and row count", () => {
    const fixture = usageFixture();
    for (const overrides of [
      { metagame: "gen9vgc2026regmb" }, { cutoff: 1500 }, { "number of battles": 124 },
      { "cutoff deviation": 1 }, { "team type": "random" },
    ]) {
      const invalid = repack({ ...fixture.payload, info: { ...fixture.payload.info, ...overrides } }, fixture.source);
      expect(() => parseUsageArchive(invalid.archive, invalid.source)).toThrow("metadata mismatch");
    }
    const missingRow = repack({ ...fixture.payload, data: { Fixturemon: fixture.payload.data.Fixturemon } }, fixture.source);
    expect(() => parseUsageArchive(missingRow.archive, missingRow.source)).toThrow("row count mismatch");
  });

  it("rejects swapped source formats, invalid months, alternate URLs, hashes and counters", () => {
    const fixture = usageFixture();
    for (const overrides of [
      { gameType: "Singles" }, { month: "2026-13" }, { url: "https://example.test/stats.json.gz" },
      { sha256: "not-a-hash" }, { speciesRows: 0 }, { battles: -1 }, { archiveBytes: 1.5 },
    ]) {
      expect(() => parseUsageArchive(fixture.archive, { ...fixture.source, ...overrides })).toThrow("source pin");
    }
  });

  it("rejects missing/nonobject info, data, species rows and Moves maps", () => {
    const fixture = usageFixture();
    const invalidPayloads = [
      null, [], {}, { ...fixture.payload, info: [] }, { ...fixture.payload, data: [] },
      { ...fixture.payload, data: { Fixturemon: null, Othermon: fixture.payload.data.Othermon } },
      { ...fixture.payload, data: { Fixturemon: {}, Othermon: fixture.payload.data.Othermon } },
      { ...fixture.payload, data: { Fixturemon: { Moves: [] }, Othermon: fixture.payload.data.Othermon } },
    ];
    for (const payload of invalidPayloads) {
      const invalid = repack(payload, fixture.source);
      expect(() => parseUsageArchive(invalid.archive, invalid.source)).toThrow("schema");
    }
  });
});

describe("committed Champions move-usage snapshot", () => {
  it("is compact deterministic JSON tied to the current proven catalog and exact approved source hashes", () => {
    const raw = readFileSync(new URL("../../data/champions/move-usage.json", import.meta.url), "utf8");
    const catalog = readFileSync(new URL("../../data/champions/catalog.json", import.meta.url), "utf8");
    expect(raw).toBe(`${JSON.stringify(snapshot)}\n`);
    expect(Buffer.byteLength(raw)).toBeLessThan(64 * 1024);
    expect(snapshot.catalogSha256).toBe(sha256(catalog));
    expect(snapshot.formats.Doubles.source).toEqual({
      url: "https://www.smogon.com/stats/2026-08/chaos/gen9championsvgc2026regmb-1630.json.gz",
      format: "gen9championsvgc2026regmb", month: "2026-08", cutoff: 1630, battles: 1269250,
      archiveBytes: 5249390, archiveSha256: "14b3423c2bdee29ffaa01d21fca8a11f8988679ece87217dd11d21e350badced",
    });
    expect(snapshot.formats.Singles.source).toEqual({
      url: "https://www.smogon.com/stats/2026-08/chaos/gen9championsbssregmb-1630.json.gz",
      format: "gen9championsbssregmb", month: "2026-08", cutoff: 1630, battles: 66884,
      archiveBytes: 938621, archiveSha256: "6283ac265c2eedf6e5f84f84a86a16807634c02a1310f0e2ad00526f03abc01c",
    });
    for (const gameType of ["Singles", "Doubles"] as const) {
      expect(snapshot.formats[gameType].source.archiveSha256).toBe(USAGE_SOURCES[gameType].sha256);
      expect(snapshot.formats[gameType].coverage.unmatchedSpecies).toEqual([]);
      expect(snapshot.formats[gameType].species.ditto).toEqual([]);
      expect(snapshot.formats[gameType].aggregate).toHaveLength(snapshot.formats[gameType].coverage.aggregateDamagingMoves);
      expect(snapshot.formats[gameType].aggregate.length).toBeGreaterThan(64);
      expect(snapshot.formats[gameType].coverage).not.toHaveProperty("aggregateRankLimit");
    }
    expect(snapshot.formats.Doubles.coverage).toMatchObject({
      sourceSpeciesRows: 283, matchedSpecies: 283, catalogSpecies: 382, speciesWithRankedMoves: 282,
    });
    expect(snapshot.formats.Singles.coverage).toMatchObject({
      sourceSpeciesRows: 271, matchedSpecies: 271, catalogSpecies: 382, speciesWithRankedMoves: 270,
    });
  });

  it("is regenerated only by its explicit opt-in npm script", () => {
    expect(packageJSON.scripts["data:champions:move-usage"]).toBe("node scripts/import-champions-move-usage.mjs");
    for (const [name, command] of Object.entries(packageJSON.scripts)) {
      if (name !== "data:champions:move-usage") {
        expect(command).not.toMatch(/import-champions-move-usage|data:champions:move-usage/);
      }
    }
  });
});
