import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { createBattleData } from "../../scripts/build-battle-data";
import { ROOT } from "../../scripts/lib/champions-data/sources.mjs";
import { toID } from "../../scripts/lib/champions-data/transform";
import { loadNativeEngine } from "../../scripts/lib/battle-data/snapshot";
import {
  CALC_SOURCE, SHOWDOWN_SOURCE, canonical, compact, loadModule, readVerifiedArchive, sha256, sorted,
} from "../../scripts/lib/battle-data/sources";
import { engineSpeciesID, nativeSpecies, transformNativeCatalog } from "../../scripts/lib/battle-data/transform";
import {
  NATIVE_GAMES, type NativeCatalog, type NativeEngineSnapshot, type NativeProfile,
  type NativeResolvedMove, type NativeResolvedSpecies, type NativeSnapshot,
} from "../../scripts/lib/battle-data/types";

type Manifest = Awaited<ReturnType<typeof createBattleData>>[number]["manifest"];
type Committed = { catalog: NativeCatalog; manifest: Manifest; engine: NativeEngineSnapshot; files: Map<string, string> };
const filenames = ["catalog.json", "manifest.json", "LICENSE.pokemon-showdown.txt", "LICENSE.damage-calc.txt"];
let committed: Committed[];
const data = (profile: NativeProfile) => committed.find((entry) => entry.catalog.game === profile.game)!;

beforeAll(async () => {
  // Only committed assets and the installed, vendored engine are read here.
  // Actual source extraction/regeneration lives in tests/source/battle-data.test.ts.
  committed = await Promise.all(NATIVE_GAMES.map(async (profile) => {
    const files = new Map(await Promise.all(filenames.map(async (name) =>
      [name, await readFile(join(ROOT, "data/battle", profile.game, name), "utf8")] as const)));
    return {
      catalog: JSON.parse(files.get("catalog.json")!) as NativeCatalog,
      manifest: JSON.parse(files.get("manifest.json")!) as Manifest,
      engine: loadNativeEngine(profile), files,
    };
  }));
});

describe("portable committed native data integrity", () => {
  it.each(NATIVE_GAMES)("checks $game catalog, license, manifest and installed-engine hashes", async (profile) => {
    const { catalog, manifest, engine, files } = data(profile);
    const provenance = JSON.parse(await readFile(loadModule.resolve("@smogon/calc/PROVENANCE.json"), "utf8"));
    expect(catalog).toMatchObject({ version: 1, game: profile.game, level: null });
    expect(manifest).toMatchObject({ version: 1, game: profile.game });
    expect(files.get("catalog.json")).toBe(compact(catalog));
    expect(files.get("manifest.json")).toBe(compact(manifest));
    expect(manifest.catalogSha256).toBe(sha256(files.get("catalog.json")!));
    expect(catalog.sources.engine.revision).toBe(CALC_SOURCE.revision);
    expect(catalog.sources.showdown.revision).toBe(SHOWDOWN_SOURCE.revision);
    expect(manifest.sources.engine).toMatchObject({
      ...catalog.sources.engine, generation: profile.gen,
      archiveSha256: CALC_SOURCE.sha256, packageVersion: provenance.version,
      snapshotSha256: sha256(canonical(engine)),
    });
    expect(provenance).toMatchObject({ revision: CALC_SOURCE.revision, sourceArchiveSha256: CALC_SOURCE.sha256 });
    expect(manifest.sources.showdown).toMatchObject({
      ...catalog.sources.showdown, mod: profile.mod, resolvedMod: profile.ancestry[0],
      ancestry: [...profile.ancestry], archiveSha256: SHOWDOWN_SOURCE.sha256,
    });
    for (const source of [manifest.sources.engine, manifest.sources.showdown]) {
      expect(source.licenseSha256).toBe(sha256(files.get(source.license)!));
      expect(files.get(source.license)).toContain("MIT License");
    }
    const inputs = manifest.sources.showdown.compilerInputFiles;
    expect(inputs.map((row) => row.path)).toEqual(sorted(inputs.map((row) => row.path)));
    expect(inputs.map((row) => row.path)).toEqual(expect.arrayContaining([
      "sim/dex.ts", "sim/dex-species.ts", "data/learnsets.ts", "data/pokedex.ts",
      "data/mods/gen7/scripts.ts", "data/mods/gen7/pokedex.ts", "data/mods/gen8/scripts.ts",
      "data/mods/gen8/pokedex.ts", "data/mods/gen8/learnsets.ts", "data/mods/gen8/typechart.ts",
    ]));
    for (const input of inputs) expect(input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(compact(manifest)).not.toMatch(/generatedAt|timestamp|C:\\\\Users|battle-data-[A-Za-z0-9]{6}/);
    expect(manifest.coverage).toMatchObject({ ...catalog.coverage, abilities: catalog.abilities.length, items: catalog.items.length });
    // These prove internal committed integrity, not fresh upstream provenance;
    // the explicit source gate recomputes the compiler/provider hashes from source.
    expect(manifest.learnsets.map((row) => row.speciesId)).toEqual(catalog.species.map((row) => row.id));
    for (const row of manifest.learnsets) {
      const pokemon = catalog.species.find((entry) => entry.id === row.speciesId)!;
      expect(row.emittedMoves, row.speciesId).toBe(pokemon.moves.length);
      expect(row.emittedMovePoolSha256, row.speciesId).toBe(sha256(compact(pokemon.moves)));
      expect(row.resolvedMovePoolSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.sources.length, row.speciesId).toBeGreaterThan(0);
      expect(row.error, row.speciesId).toBeUndefined();
      for (const provider of row.sources) {
        expect(manifest.sources.showdown.ancestry).toContain(provider.mod);
        expect(inputs.some((input) => input.path === provider.file)).toBe(true);
        expect(provider.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it.each(NATIVE_GAMES)("keeps all $game identities and references canonical, unique and ordered", (profile) => {
    const { catalog } = data(profile);
    const species = new Map(catalog.species.map((row) => [row.id, row]));
    const moves = new Map(catalog.moves.map((row) => [row.id, row]));
    const abilities = new Set(catalog.abilities.map((row) => row.id));
    const items = new Set(catalog.items.map((row) => row.id));
    for (const rows of [catalog.species, catalog.moves, catalog.abilities, catalog.items]) {
      expect(rows.map((row) => row.id)).toEqual(sorted(rows.map((row) => row.id)));
      for (const row of rows) expect(toID(row.name)).toBe(row.id);
    }
    for (const row of catalog.species) {
      expect(row.weightkg).toBeGreaterThan(0);
      expect(row.moves).toEqual(sorted(row.moves));
      expect(row.abilities).toEqual(sorted(row.abilities));
      for (const id of row.moves) {
        expect(moves.has(id), `${row.id} move ${id}`).toBe(true);
        expect(moves.get(id)?.isZ || moves.get(id)?.isMax).toBeFalsy();
      }
      for (const id of row.abilities) expect(abilities.has(id), `${row.id} ability ${id}`).toBe(true);
      for (const id of row.requiredItems ?? []) expect(items.has(id), `${row.id} required item ${id}`).toBe(true);
      if (row.requiredItem) expect(row.requiredItems).toEqual([row.requiredItem]);
      if (row.changesFrom) expect(species.has(row.changesFrom), row.id).toBe(true);
      for (const id of row.battleOnly ?? []) expect(species.has(id), row.id).toBe(true);
      if (row.requiredMove) expect(moves.has(row.requiredMove), row.id).toBe(true);
      if (row.canGigantamax) expect(moves.get(row.canGigantamax)?.isMax, row.id).toBe(true);
    }
    for (const row of catalog.items) {
      for (const target of row.megaTargets) {
        expect(species.has(target.baseSpeciesId)).toBe(true);
        expect(species.get(target.formId)?.requiredItem).toBe(row.id);
      }
      if (row.zMove) expect(moves.get(row.zMove)?.isZ, row.id).toBe(true);
      if (row.zMoveFrom) expect(moves.has(row.zMoveFrom), row.id).toBe(true);
      for (const id of row.itemUser ?? []) expect(species.has(id), row.id).toBe(true);
    }
  });

  it.each(NATIVE_GAMES)("matches every $game species, move, ability and item to the exact installed generation", (profile) => {
    const { catalog, engine } = data(profile);
    const species = new Map(engine.species.map((row) => [row.name, row]));
    const moves = new Map(engine.moves.map((row) => [row.id, row]));
    const abilities = new Set(engine.abilities.map((row) => row.id));
    const items = new Map(engine.items.map((row) => [row.id, row]));
    expect(engine.num).toBe(profile.gen);
    for (const row of catalog.species) {
      const calc = species.get(row.calcName)!;
      expect(calc, row.id).toBeDefined();
      expect(calc.types, row.id).toEqual(row.types);
      expect(calc.baseStats, row.id).toEqual(row.baseStats);
      expect(calc.weightkg, row.id).toBe(row.weightkg);
      if (calc.gender && row.gender) expect(calc.gender, row.id).toBe(row.gender);
      expect(row.unsupported, row.id).toEqual([]);
    }
    for (const row of catalog.moves) {
      const calc = moves.get(row.id)!;
      expect(calc, row.id).toBeDefined();
      expect(calc.type, row.id).toBe(row.type);
      expect(calc.category, row.id).toBe(row.category);
      expect(calc.basePower, row.id).toBe(row.power);
      expect(Boolean(calc.isZ), row.id).toBe(Boolean(row.isZ));
      expect(Boolean(calc.isMax), row.id).toBe(Boolean(row.isMax));
      if (row.zMovePower) expect(calc.zMove?.basePower, row.id).toBe(row.zMovePower);
      if (row.maxMovePower) expect(calc.maxMove?.basePower, row.id).toBe(row.maxMovePower);
      expect(row.unsupported, row.id).toEqual([]);
    }
    for (const row of catalog.abilities) {
      expect(abilities.has(row.id), row.id).toBe(true);
      expect(row.unsupported, row.id).toEqual([]);
    }
    for (const row of catalog.items) {
      const calc = items.get(row.id)!;
      expect(calc, row.id).toBeDefined();
      expect(row.megaTargets).toEqual(Object.entries(calc.megaStone ?? {}).map(([base, form]) => ({
        baseSpeciesId: toID(base), formId: toID(form),
      })).sort((a, b) => a.baseSpeciesId < b.baseSpeciesId ? -1 : a.baseSpeciesId > b.baseSpeciesId ? 1 : 0));
      expect(row.unsupported, row.id).toEqual([]);
    }
    expect(catalog.coverage).toMatchObject({
      species: catalog.species.length, moves: catalog.moves.length, unsupportedSpecies: 0, unsupportedMoves: 0,
    });
  });
});

const fixtureSources = {
  engine: { revision: "fixture-engine", url: "https://example.test/engine" },
  showdown: { revision: "fixture-showdown", url: "https://example.test/showdown" },
};
const fixtureStats = { hp: 60, atk: 70, def: 80, spa: 90, spd: 100, spe: 110 };
function fixtureSpecies(overrides: Partial<NativeResolvedSpecies> = {}): NativeResolvedSpecies {
  return {
    id: "fixturemon", name: "Fixturemon", baseSpecies: "Fixturemon", baseForme: "", gen: 1, exists: true,
    types: ["Water"], baseStats: { ...fixtureStats }, weightkg: 50, abilities: { 0: "Torrent" },
    learnset: {
      movePool: ["tackle", "protect", "oldmove", "missingmove"],
      sources: [{ speciesId: "fixturemon", mod: "base", file: "data/learnsets.ts", declarationSpeciesId: "fixturemon", sha256: sha256("fixture table"), markerGenerations: [3, 7] }],
    },
    ...overrides,
  };
}
function fixtureMove(overrides: Partial<NativeResolvedMove> & Pick<NativeResolvedMove, "id" | "name">): NativeResolvedMove {
  return { exists: true, gen: 1, type: "Normal", category: "Physical", basePower: 40, accuracy: 100, priority: 0, target: "normal", description: "Fixture move.", ...overrides };
}
function fixture(profile: NativeProfile = NATIVE_GAMES[0]): { source: NativeSnapshot; engine: NativeEngineSnapshot } {
  return {
    source: {
      profile, ancestry: [...profile.ancestry],
      species: [fixtureSpecies(), fixtureSpecies({ id: "fixturemonblue", name: "Fixturemon-Blue", isCosmeticForme: true, cosmeticParent: "fixturemon" })],
      moves: [
        fixtureMove({ id: "tackle", name: "Tackle" }),
        fixtureMove({ id: "protect", name: "Protect", category: "Status", basePower: 0, accuracy: true, target: "self", priority: 4 }),
        fixtureMove({ id: "oldmove", name: "Old Move", isNonstandard: "Past" }),
      ],
      abilities: [
        { id: "torrent", name: "Torrent", exists: true, description: "Fixture ability." },
        { id: "unused", name: "Unused", exists: true, description: "Unassigned ability." },
      ],
      items: [{ id: "leftovers", name: "Leftovers", exists: true, description: "Fixture item." }],
    },
    // Independent expected engine rows, not derived from transform output/source.
    engine: {
      num: profile.gen,
      species: [{ id: "fixturemon", name: "Fixturemon", types: ["Water"], baseStats: { hp: 60, atk: 70, def: 80, spa: 90, spd: 100, spe: 110 }, weightkg: 50 }],
      moves: [
        { id: "tackle", name: "Tackle", type: "Normal", category: "Physical", basePower: 40 },
        { id: "protect", name: "Protect", type: "Normal", category: "Status", basePower: 0 },
      ],
      abilities: [{ id: "torrent", name: "Torrent" }],
      items: [{ id: "leftovers", name: "Leftovers" }],
    },
  };
}
const transform = ({ source, engine } = fixture()) => transformNativeCatalog(source, engine, fixtureSources);

describe("portable native transform fixtures", () => {
  it.each(NATIVE_GAMES)("accepts native inherited provenance and deterministically transforms $game without mutation", (profile) => {
    const input = fixture(profile);
    const before = canonical(input);
    const catalog = transform(input);
    expect(canonical(input)).toBe(before);
    expect(catalog).toMatchObject({ game: profile.game, level: null, coverage: { species: 2, moves: 2, unsupportedSpecies: 0, unsupportedMoves: 0 } });
    expect(catalog.species[0].moves).toEqual(["protect", "tackle"]);
    expect(catalog.abilities.map((row) => row.id)).toEqual(["torrent"]);
    expect(catalog.moves[0]).toMatchObject({ id: "protect", category: "Status", power: 0, accuracy: null, target: "self", priority: 4 });
    for (const rows of [input.source.species, input.source.moves, input.source.abilities, input.source.items, input.engine.species, input.engine.moves]) rows.reverse();
    input.engine.abilities = [...input.engine.abilities].reverse();
    input.engine.items = [...input.engine.items].reverse();
    for (const row of input.source.species) row.learnset.movePool.reverse();
    expect(compact(transform(input))).toBe(compact(catalog));
  });

  it("requires explicit cosmetic proof and prefers exact engine identity to any alias", () => {
    const input = fixture();
    const raw = input.source.species[1];
    expect(transform(input).species[1]).toMatchObject({ id: "fixturemonblue", name: "Fixturemon-Blue", calcName: "Fixturemon", unsupported: [] });
    expect(engineSpeciesID({ ...raw, isCosmeticForme: false }, new Set(["fixturemon"]))).toBe(raw.id);
    expect(engineSpeciesID({ ...raw, cosmeticParent: undefined }, new Set(["fixturemon"]))).toBe(raw.id);
    expect(engineSpeciesID(raw, new Set([raw.id, "fixturemon"]))).toBe(raw.id);
    raw.isCosmeticForme = false;
    expect(transform(input).species[1]).toMatchObject({ calcName: "Fixturemon-Blue", unsupported: ["Engine species missing: Fixturemon-Blue."] });
    const shield = fixtureSpecies({ id: "aegislash", name: "Aegislash", baseForme: "Shield" });
    expect(engineSpeciesID(shield, new Set(["aegislashshield"]))).toBe("aegislashshield");
    expect(engineSpeciesID({ ...shield, baseForme: "" }, new Set(["aegislashshield"]))).toBe("aegislash");
  });

  it("rejects wrong engine generations, noncanonical IDs and duplicate identities", () => {
    const input = fixture();
    expect(() => transform({ ...input, engine: { ...input.engine, num: 9 } })).toThrow("generation 7");
    input.source.species[0].id = "Fixturemon";
    expect(() => transform(input)).toThrow("Noncanonical species");
    input.source.species[0].id = "fixturemon";
    input.source.moves.push({ ...input.source.moves[0] });
    expect(() => transform(input)).toThrow("Duplicate move");
  });

  it("preserves source values and reports missing or mismatched engine data", () => {
    const input = fixture();
    const calc = input.engine.species[0];
    calc.baseStats = { ...calc.baseStats, atk: 200 };
    calc.types = ["Fire"];
    calc.weightkg = 123;
    input.engine.moves[0].basePower = 999;
    input.engine.moves = input.engine.moves.filter((row) => row.id !== "protect");
    const catalog = transform(input);
    expect(catalog.species[0]).toMatchObject({
      baseStats: fixtureStats, types: ["Water"], weightkg: 50,
      unsupported: expect.arrayContaining([
        "Engine base stat differs (atk): 200 vs 70.", "Engine species types differ: Fire vs Water.", "Engine weight differs: 123 vs 50 kg.",
      ]),
    });
    expect(catalog.moves[0]).toMatchObject({ id: "protect", power: 0, unsupported: ["Engine move missing: Protect."] });
    expect(catalog.moves[1]).toMatchObject({ id: "tackle", power: 40, unsupported: ["Engine move power differs: 999 vs 40."] });
  });

  it("retains explicit diagnostics for unresolved native learnsets", () => {
    const input = fixture();
    input.source.species[0].learnset = { sources: [], movePool: [], error: "Fixture resolution failed" };
    expect(transform(input).species[0]).toMatchObject({
      moves: [], unsupported: ["Native learnset resolution failed: Fixture resolution failed", "No resolved native learnset sources."],
    });
  });

  it("excludes unavailable parent forms and refuses cyclic relationships", () => {
    const { source } = fixture();
    source.species.push(fixtureSpecies({ id: "future", name: "Future", isNonstandard: "Future" }));
    source.species.push(fixtureSpecies({ id: "futureform", name: "Future-Form", battleOnly: "Future" }));
    expect(nativeSpecies(source).map((row) => row.id)).toEqual(["fixturemon", "fixturemonblue"]);
    source.species[0].battleOnly = "Fixturemon-Blue";
    source.species[1].battleOnly = "Fixturemon";
    expect(() => nativeSpecies(source)).toThrow("Cyclic battle form relationship");
  });
});

describe("portable offline archive boundary", () => {
  it("fails on missing/corrupt fixture archives without any download fallback", async () => {
    const cache = await mkdtemp(join(tmpdir(), "battle-source-unit-"));
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in unit tests"));
    try {
      const pin = { repo: "fixture", revision: "pinned", sha256: sha256("verified source") };
      await expect(readVerifiedArchive(pin, cache)).rejects.toThrow("Offline source archive missing");
      await writeFile(join(cache, "fixture-pinned.tar.gz"), "corrupt");
      await expect(readVerifiedArchive(pin, cache)).rejects.toThrow("checksum mismatch");
      await writeFile(join(cache, "fixture-pinned.tar.gz"), "verified source");
      expect((await readVerifiedArchive(pin, cache)).toString()).toBe("verified source");
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      await rm(cache, { recursive: true, force: true });
    }
  });
});
