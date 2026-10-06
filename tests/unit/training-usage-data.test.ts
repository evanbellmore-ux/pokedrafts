import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRAINING_USAGE_LIMITS,
  USAGE_SOURCES,
  buildTrainingUsageSnapshot,
  deriveTrainingUsage,
  parseTrainingSpread,
  parseUsageArchive,
} from "../../scripts/import-champions-move-usage.mjs";
import moveUsage from "../../data/champions/move-usage.json";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { TrainingUsageData } from "@/app/(app)/training/model/usage";
import { loadTrainingUsage, speciesUsage, usageRowId } from "@/app/(app)/training/usage/training-usage";
import { parseTrainingUsage } from "@/app/(app)/training/usage/species-usage";

// Addendum A1.1: data/champions/training-usage.json, written by npm run data:champions:move-usage from the hash-checked Doubles archive.

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const ROOT = new URL("../../", import.meta.url);
const raw = readFileSync(new URL("data/champions/training-usage.json", ROOT), "utf8");
const catalogJSON = readFileSync(new URL("data/champions/catalog.json", ROOT), "utf8");
const usage = loadTrainingUsage();
const ARCHIVE = new URL("node_modules/.cache/champions/2026-08-gen9championsvgc2026regmb-1630.json.gz", ROOT);
const NATURES = new Set(["Adamant", "Bashful", "Bold", "Brave", "Calm", "Careful", "Docile", "Gentle", "Hardy", "Hasty", "Impish", "Jolly", "Lax",
  "Lonely", "Mild", "Modest", "Naive", "Naughty", "Quiet", "Quirky", "Rash", "Relaxed", "Sassy", "Serious", "Timid"]);

type Row = Record<string, unknown>;
function catalogFixture() {
  const ids = ["alpha", "beta", "gamma", "delta", "guard", "boost", "illegal"];
  return {
    version: 1, game: "champions",
    species: [
      { id: "fixturemon", name: "Fixturemon", calcName: "Fixturemon-Exact", baseSpecies: "fixturemon", abilities: ["aaa", "bbb"], moves: ids.filter((id) => id !== "illegal") },
      { id: "fixturemonmega", name: "Fixturemon-Mega", calcName: "Fixturemon-Mega", baseSpecies: "fixturemon", abilities: ["ccc"], moves: ["alpha"] },
      { id: "othermon", name: "Othermon", calcName: "Othermon", baseSpecies: "othermon", abilities: ["zzz"], moves: ["alpha", "beta"] },
    ],
    moves: ids.map((id) => ({ id, name: id, category: ["guard", "boost"].includes(id) ? "Status" : "Physical" })),
    items: [{ id: "sitrusberry" }, { id: "lifeorb" }, { id: "choicescarf" }],
  };
}
function archiveFixture(rows: Record<string, Row>) {
  const pin = USAGE_SOURCES.Doubles;
  const payload = {
    info: { metagame: pin.format, cutoff: pin.cutoff, "number of battles": 50, "cutoff deviation": 0, "team type": null },
    data: rows,
  };
  const archive = gzipSync(JSON.stringify(payload));
  return { payload, archive, source: { ...pin, battles: 50, speciesRows: Object.keys(rows).length, archiveBytes: archive.length, sha256: sha256(archive) } };
}
const fixtureRow = (extra: Row = {}): Row => ({
  Abilities: { aaa: 75, bbb: 25 },
  Moves: { alpha: 90, beta: 60, guard: 80, boost: 10, "": 30 },
  Items: { sitrusberry: 50, nothing: 30, lifeorb: 20 },
  Spreads: { "Adamant:32/32/0/0/2/0": 60, "Hardy:0/0/0/0/0/0": 40 },
  ...extra,
});

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No unit-test network is allowed."));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("training usage transformation (small offline fixtures)", () => {
  it("keeps moves of every category, items, spreads and abilities as shares of the species' sets", () => {
    const { payload, source } = archiveFixture({ Fixturemon: fixtureRow() });
    const format = deriveTrainingUsage(catalogFixture(), payload, source);
    // 100 weighted sets (the summed ability weight): every weight is raw ÷ 100.
    expect(format.species.fixturemon).toEqual({
      sets: 100,
      moves: [{ id: "alpha", weight: 0.9 }, { id: "guard", weight: 0.8 }, { id: "beta", weight: 0.6 }, { id: "boost", weight: 0.1 }],
      items: [{ id: "sitrusberry", weight: 0.5 }, { id: "", weight: 0.3 }, { id: "lifeorb", weight: 0.2 }],
      spreads: [
        { nature: "Adamant", points: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 }, weight: 0.6 },
        { nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, weight: 0.4 },
      ],
      abilities: [{ id: "aaa", weight: 0.75 }, { id: "bbb", weight: 0.25 }],
    });
    expect(format.coverage.filtered.moves.emptyId).toBe(1);
  });

  it("filters empty, invalid, unknown and illegal entries and counts them", () => {
    const { payload, source } = archiveFixture({
      Fixturemon: fixtureRow({
        Abilities: { aaa: 50, bbb: 0, ccc: 50, bad: Number.NaN },
        Moves: { alpha: 10, illegal: 99, unknown: 99, beta: -1, gamma: "5", "": 1 },
        Items: { sitrusberry: 10, masterball: 99, lifeorb: 0, "": 5 },
        Spreads: {
          "Adamant:33/32/0/0/1/0": 99, "Jolly:32/32/2/0/0/1": 99, "Sturdy:32/32/0/0/2/0": 99, "Serious:0/0/0/0/0/0": 99, "Bold:32/32": 99,
          "Bold:32/0/32/0/2/0": 5, "Calm:32/0/0/0/32/0": 0,
        },
      }),
    });
    const format = deriveTrainingUsage(catalogFixture(), payload, source);
    // ccc belongs to the Mega form, not this one; its sets still count toward the total (100).
    expect(format.species.fixturemon.abilities).toEqual([{ id: "aaa", weight: 0.5 }]);
    expect(format.species.fixturemon.moves).toEqual([{ id: "alpha", weight: 0.1 }]);
    expect(format.species.fixturemon.items).toEqual([{ id: "sitrusberry", weight: 0.1 }]);
    expect(format.species.fixturemon.spreads).toEqual([{ nature: "Bold", points: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 }, weight: 0.05 }]);
    expect(format.coverage.filtered).toEqual({
      moves: { emptyId: 1, invalidWeight: 2, unknownId: 1, illegal: 1 },
      items: { invalidWeight: 1, unknownId: 2 },
      spreads: { invalidWeight: 1, invalid: 5 },
      abilities: { invalidWeight: 2, illegal: 1 },
    });
  });

  it("keeps the top 24 moves and every further move above 0.5% of the sets", () => {
    const moveIds = Array.from({ length: 40 }, (_, index) => `move${String(index).padStart(2, "0")}`);
    const catalog = catalogFixture();
    catalog.moves = moveIds.map((id) => ({ id, name: id, category: "Special" }));
    catalog.species = catalog.species.map((row) => ({ ...row, moves: moveIds }));
    // 1000 sets. Fixturemon: move00..move29 far above 0.5%, move30..move39 at 0.1%. Othermon: only move00..move09 above it.
    const moves = Object.fromEntries(moveIds.map((id, index) => [id, index < 30 ? 1000 - index : 1]));
    const sparse = Object.fromEntries(moveIds.map((id, index) => [id, index < 10 ? 1000 - index : 1]));
    const { payload, source } = archiveFixture({
      Fixturemon: { Abilities: { aaa: 1000 }, Moves: moves, Items: {}, Spreads: {} },
      Othermon: { Abilities: { zzz: 1000 }, Moves: sparse, Items: {}, Spreads: {} },
    });
    const format = deriveTrainingUsage(catalog, payload, source);
    expect(TRAINING_USAGE_LIMITS).toEqual({ moves: 24, moveShare: 0.005, items: 12, spreads: 12 });
    expect(format.species.fixturemon.moves.map((move: { id: string }) => move.id)).toEqual(moveIds.slice(0, 30));
    expect(format.species.othermon.moves.map((move: { id: string }) => move.id)).toEqual([...moveIds.slice(0, 10), ...moveIds.slice(10).sort().slice(0, 14)]);
    expect(format.coverage.truncated.moves).toBe(10 + 16);
  });

  it("keeps the top 12 items and spreads, with the canonical id or spread key breaking ties", () => {
    const catalog = catalogFixture();
    const itemIds = Array.from({ length: 14 }, (_, index) => `item${String(index).padStart(2, "0")}`);
    catalog.items = itemIds.map((id) => ({ id }));
    const spreads = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`Timid:${index}/0/0/32/0/2`, 1]));
    const { payload, source } = archiveFixture({
      Fixturemon: { Abilities: { aaa: 14 }, Moves: {}, Items: Object.fromEntries([...itemIds].reverse().map((id) => [id, 1])), Spreads: spreads },
    });
    const format = deriveTrainingUsage(catalog, payload, source);
    expect(format.species.fixturemon.items.map((item: { id: string }) => item.id)).toEqual(itemIds.slice(0, 12));
    expect(format.species.fixturemon.spreads.map((spread: { points: { hp: number } }) => spread.points.hp)).toEqual([0, 1, 10, 11, 12, 13, 2, 3, 4, 5, 6, 7]);
    expect(format.coverage.truncated).toMatchObject({ items: 2, spreads: 2 });
  });

  it("uses move-usage's identity rules: exact id, name or unique calcName; duplicates fail; no inheritance", () => {
    for (const identity of ["fixturemon", "Fixturemon", "Fixturemon-Exact"]) {
      const { payload, source } = archiveFixture({ [identity]: fixtureRow() });
      expect(Object.keys(deriveTrainingUsage(catalogFixture(), payload, source).species)).toEqual(["fixturemon"]);
    }
    const unmatched = archiveFixture({ "Fixturemon-Mega": { Abilities: { ccc: 1 }, Moves: { alpha: 1 } }, "Fixturemon-Other": fixtureRow() });
    const format = deriveTrainingUsage(catalogFixture(), unmatched.payload, unmatched.source);
    expect(Object.keys(format.species)).toEqual(["fixturemonmega"]);
    expect(format.coverage.unmatchedSpecies).toEqual(["Fixturemon-Other"]);
    const duplicate = archiveFixture({ Fixturemon: fixtureRow(), "Fixturemon-Exact": fixtureRow() });
    expect(() => deriveTrainingUsage(catalogFixture(), duplicate.payload, duplicate.source)).toThrow("Multiple usage rows resolve to catalog species");
    const noSets = archiveFixture({ Fixturemon: { Abilities: {}, Moves: { alpha: 1 } } });
    const empty = deriveTrainingUsage(catalogFixture(), noSets.payload, noSets.source);
    expect(empty.species).toEqual({});
    expect(empty.coverage).toMatchObject({ matchedSpecies: 1, species: 0, speciesWithoutSets: ["fixturemon"] });
  });

  it("is order-independent and nonmutating, fails closed on bad catalogs, and requires the Doubles source", () => {
    const fixture = archiveFixture({ Fixturemon: fixtureRow(), Othermon: { Abilities: { zzz: 2 }, Moves: { beta: 1, alpha: 2 } } });
    const catalog = catalogFixture();
    const before = JSON.stringify({ catalog, fixture: fixture.payload });
    const first = deriveTrainingUsage(catalog, fixture.payload, fixture.source);
    const reversed = {
      ...fixture.payload,
      data: Object.fromEntries(Object.entries(fixture.payload.data).reverse().map(([name, row]) => [name, Object.fromEntries(
        Object.entries(row).map(([key, table]) => [key, Object.fromEntries(Object.entries(table as Row).reverse())]),
      )])),
    };
    expect(deriveTrainingUsage({ ...catalog, species: [...catalog.species].reverse(), items: [...catalog.items].reverse() }, reversed, fixture.source)).toEqual(first);
    expect(JSON.stringify({ catalog, fixture: fixture.payload })).toBe(before);
    for (const items of [undefined, [], [{ id: "Bad Id" }], [{ id: "lifeorb" }, { id: "lifeorb" }]]) {
      expect(() => deriveTrainingUsage({ ...catalogFixture(), items }, fixture.payload, fixture.source)).toThrow(/catalog item/);
    }
    const catalogText = `${JSON.stringify(catalogFixture())}\n`;
    const snapshot = buildTrainingUsageSnapshot(catalogText, fixture);
    expect(Object.keys(snapshot)).toEqual(["version", "game", "catalogSha256", "attribution", "policy", "source", "coverage", "species"]);
    expect(snapshot.catalogSha256).toBe(sha256(catalogText));
    expect(snapshot.source).toEqual({
      url: fixture.source.url, format: "gen9championsvgc2026regmb", month: "2026-08", cutoff: 1630,
      battles: 50, archiveBytes: fixture.archive.length, archiveSha256: sha256(fixture.archive),
    });
    expect(() => buildTrainingUsageSnapshot(catalogText, { ...fixture, source: { ...fixture.source, gameType: "Singles" } })).toThrow("Doubles source");
    expect(JSON.stringify(snapshot)).not.toMatch(/generatedAt|timestamp/);
  });

  it("accepts exactly the spreads the Champions validator accepts (PS/sim/team-validator.ts:1306-1311, 1332-1335, 1350-1355)", () => {
    expect(parseTrainingSpread("Impish:32/0/21/0/10/3")).toEqual({ nature: "Impish", points: { hp: 32, atk: 0, def: 21, spa: 0, spd: 10, spe: 3 } });
    expect(parseTrainingSpread("Hardy:0/0/0/0/0/0")).not.toBeNull();
    expect(parseTrainingSpread("Bold:32/0/32/0/2/0")).not.toBeNull();
    for (const key of ["Serious:0/0/0/0/0/0", "Bold:33/0/31/0/2/0", "Bold:32/0/32/0/2/1", "bold:32/0/32/0/2/0", "Bold:32/0/32/0/2", "Bold:32/0/32/0/2/-1", "Bold:1.5/0/0/0/0/0", "", 5]) {
      expect(parseTrainingSpread(key), String(key)).toBeNull();
    }
  });
});

describe("committed training usage snapshot", () => {
  it("is compact deterministic JSON tied to the proven catalog and move-usage.json's Doubles archive", () => {
    expect(raw).toBe(`${JSON.stringify(JSON.parse(raw))}\n`);
    expect(Buffer.byteLength(raw)).toBeLessThan(1024 * 1024);
    expect(usage.version).toBe(1);
    expect(usage.game).toBe("champions");
    expect(usage.catalogSha256).toBe(sha256(catalogJSON));
    expect(usage.source).toEqual(moveUsage.formats.Doubles.source);
    expect(usage.source.archiveSha256).toBe(USAGE_SOURCES.Doubles.sha256);
    expect(usage.attribution.name).toBe(moveUsage.attribution.name);
    expect(usage.attribution.url).toBe(moveUsage.attribution.url);
    expect(usage.coverage).toMatchObject({ sourceSpeciesRows: 283, matchedSpecies: 283, unmatchedSpecies: [], species: 283, catalogSpecies: 396 });
    expect(Object.keys(usage.species)).toEqual(Object.keys(usage.species).sort());
  });

  it("names only catalog forms, their proven learnset moves, Reg M-C items, their abilities and valid spreads, heaviest first", () => {
    for (const [id, row] of Object.entries(usage.species)) {
      const species = runtime.speciesById.get(id)!;
      expect(species, id).toBeDefined();
      for (const list of [row.moves, row.items, row.spreads, row.abilities]) {
        expect(list.every((entry) => entry.weight > 0), id).toBe(true);
        expect(list.map((entry) => entry.weight), id).toEqual(list.map((entry) => entry.weight).sort((a, b) => b - a));
      }
      expect(row.moves.every((move) => species.moves.includes(move.id)), id).toBe(true);
      expect(new Set(row.moves.map((move) => move.id)).size).toBe(row.moves.length);
      expect(row.moves.reduce((sum, move) => sum + move.weight, 0), id).toBeLessThanOrEqual(4.001);
      expect(row.items.length).toBeLessThanOrEqual(12);
      expect(row.items.every((item) => item.id === "" || runtime.itemsById.has(item.id)), id).toBe(true);
      expect(row.spreads.length).toBeLessThanOrEqual(12);
      for (const spread of row.spreads) {
        const values = Object.values(spread.points);
        expect(NATURES.has(spread.nature), `${id} ${spread.nature}`).toBe(true);
        expect(values.every((value) => Number.isInteger(value) && value >= 0 && value <= 32), id).toBe(true);
        expect(values.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(66);
        expect(spread.nature === "Serious" && values.every((value) => value === 0)).toBe(false);
      }
      expect(row.abilities.length).toBeGreaterThan(0);
      expect(row.abilities.every((ability) => species.abilities.includes(ability.id)), id).toBe(true);
    }
  });

  it("agrees with move-usage.json: the same rows, its top-four damaging moves in order, and its usual ability", () => {
    const doubles = moveUsage.formats.Doubles as { species: Record<string, string[]>; abilities: Record<string, string> };
    expect(Object.keys(usage.species)).toEqual(Object.keys(doubles.species));
    for (const [id, row] of Object.entries(usage.species)) {
      const damaging = row.moves.filter((move) => runtime.movesById.get(move.id)!.category !== "Status").map((move) => move.id);
      const shared = Math.min(4, damaging.length, doubles.species[id].length);
      expect(damaging.slice(0, shared), id).toEqual(doubles.species[id].slice(0, shared));
      if (doubles.abilities[id]) expect(row.abilities[0].id, id).toBe(doubles.abilities[id]);
    }
  });

  it("carries status moves and real VGC sets (Incineroar)", () => {
    const incineroar = usage.species.incineroar;
    expect(incineroar.moves.slice(0, 6)).toEqual([
      { id: "fakeout", weight: 0.9981 }, { id: "partingshot", weight: 0.9379 }, { id: "flareblitz", weight: 0.8877 },
      { id: "throatchop", weight: 0.4119 }, { id: "darkestlariat", weight: 0.3522 }, { id: "protect", weight: 0.1433 },
    ]);
    expect(incineroar.items[0]).toEqual({ id: "sitrusberry", weight: 0.6152 });
    expect(incineroar.spreads[0]).toEqual({ nature: "Impish", points: { hp: 32, atk: 0, def: 21, spa: 0, spd: 10, spe: 3 }, weight: 0.03912 });
    expect(incineroar.abilities.map((ability) => ability.id)).toEqual(["intimidate", "blaze"]);
    // The row's weighted set count (the summed ability weight): a base form's row and its Megas' mix by it (ai/belief/usage.ts).
    const sets = (row: object) => (row as { sets?: number }).sets;
    expect(sets(incineroar)).toBe(52277.5);
    expect(Object.values(usage.species).every((row) => sets(row)! > 0)).toBe(true);
    const statusMoves = new Set(Object.values(usage.species).flatMap((row) => row.moves.map((move) => move.id)).filter((id) => runtime.movesById.get(id)!.category === "Status"));
    for (const id of ["protect", "tailwind", "trickroom", "followme", "ragepowder", "helpinghand", "sleeppowder", "willowisp", "thunderwave", "partingshot", "taunt", "encore"]) {
      expect(statusMoves.has(id), id).toBe(true);
    }
    expect(usage.species.charizardmegay.items).toEqual([{ id: "charizarditey", weight: 1 }]);
  });

  it.skipIf(!existsSync(ARCHIVE))("is exactly what the importer derives from the cached hash-checked archive", () => {
    const source = USAGE_SOURCES.Doubles;
    const payload = parseUsageArchive(readFileSync(ARCHIVE), source);
    expect(`${JSON.stringify(buildTrainingUsageSnapshot(catalogJSON, { source, payload }))}\n`).toBe(raw);
  });
});

describe("the worker's loader and row lookup", () => {
  it("shape-checks the file once and rejects another shape", () => {
    expect(loadTrainingUsage()).toBe(usage);
    expect(parseTrainingUsage(JSON.parse(raw))).toEqual(usage);
    for (const bad of [null, {}, { ...JSON.parse(raw), version: 2 }, { ...JSON.parse(raw), species: { x: { moves: [{ id: "a", weight: 0 }], items: [], spreads: [], abilities: [] } } }]) {
      expect(() => parseTrainingUsage(bad)).toThrow("unexpected shape");
    }
  });

  it("reads a form's own row, a cosmetic form's family row and Maushold's row for Maushold-Four (move-defaults.ts usageRow)", () => {
    expect(speciesUsage(usage, "incineroar", runtime)).toBe(usage.species.incineroar);
    expect(usageRowId("vivillonjungle", runtime)).toBe("vivillon");
    expect(speciesUsage(usage, "vivillonjungle", runtime)).toBe(usage.species.vivillon);
    // Vivillon-Fancy has an engine entry of its own: no family row (cosmeticFamily).
    expect(speciesUsage(usage, "vivillonfancy", runtime)).toBeNull();
    expect(speciesUsage(usage, "mausholdfour", runtime)).toBe(usage.species.maushold);
    expect(speciesUsage(usage, "absolmegaz", runtime)).toBeNull();
    expect(speciesUsage(usage, "constructor", runtime)).toBeNull();
    const other: TrainingUsageData = { ...usage, species: { garchomp: usage.species.incineroar } };
    expect(speciesUsage(other, "garchomp", runtime)).toBe(usage.species.incineroar);
  });
});
