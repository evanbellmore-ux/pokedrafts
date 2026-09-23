import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Generations, Move, Pokemon, toID } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import type { ChampionsCatalog } from "../../app/lib/battle/types";
import reference from "../fixtures/champions-data-reference.json";
import manifest from "../../data/champions/manifest.json";

const raw = readFileSync(new URL("../../data/champions/catalog.json", import.meta.url), "utf8");
const catalog = JSON.parse(raw) as ChampionsCatalog;
const species = new Map(catalog.species.map((row) => [row.id, row]));
const moves = new Map(catalog.moves.map((row) => [row.id, row]));
const abilities = new Map(catalog.abilities.map((row) => [row.id, row]));
const items = new Map(catalog.items.map((row) => [row.id, row]));
const generation = Generations.get(0);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const idHash = (ids: string[]) => sha256([...ids].sort().join("\n"));

// The reference counts/hashes and Charizard list came directly from the pinned
// Showdown Dex/declarations, NOT from the transformation being tested. A missing
// species, status or learnset move must not be excused by regenerated summaries.
describe("generated Champions catalog integrity", () => {
  it("is compact, deterministic and records verified pinned provenance/licenses", () => {
    expect(raw).toBe(`${JSON.stringify(catalog)}\n`);
    expect(sha256(raw)).toBe(manifest.catalogSha256);
    expect(catalog).toMatchObject({ version: 1, game: "champions", level: 50 });
    expect(catalog.sources.showdown.revision).toBe(reference.showdownRevision);
    expect(catalog.sources.engine.revision).toBe("e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d");
    expect(manifest.sources.showdown.archiveSha256).toBe("640e41b11a4906d27ec435674ce2c667231d89de879f2a9cd7f81a7a280b41e2");
    expect(manifest.sources.engine.archiveSha256).toBe("ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84");
    expect(raw).not.toContain("generatedAt");
    for (const license of ["LICENSE.pokemon-showdown.txt", "LICENSE.damage-calc.txt"]) {
      const text = readFileSync(new URL(`../../data/champions/${license}`, import.meta.url), "utf8");
      expect(text).toContain("The MIT License (MIT)");
      expect(text).toContain("Copyright (c)");
      expect(text).toContain("Permission is hereby granted");
    }
  });

  it("has every available pinned-source species and move, not a filtered damage-only subset", () => {
    expect(catalog.species).toHaveLength(reference.speciesCount);
    expect(idHash(catalog.species.map((row) => row.id))).toBe(reference.speciesIdsSha256);
    expect(catalog.moves).toHaveLength(reference.moveCount);
    expect(idHash(catalog.moves.map((row) => row.id))).toBe(reference.moveIdsSha256);
    expect(catalog.moves.filter((row) => row.category === "Status")).toHaveLength(reference.statusCount);
    expect(catalog.abilities).toHaveLength(216);
    expect(catalog.items).toHaveLength(166);
  });

  it("has sorted, unique canonical IDs and valid species references", () => {
    for (const rows of [catalog.species, catalog.moves, catalog.abilities, catalog.items]) {
      const ids = rows.map((row) => row.id);
      expect(ids).toEqual([...new Set(ids)].sort());
      for (const row of rows) {
        expect(row.id).toMatch(/^[a-z0-9]+$/);
        expect(toID(row.name)).toBe(row.id);
      }
    }
    for (const row of catalog.species) {
      expect(row.baseSpecies).toMatch(/^[a-z0-9]+$/);
      expect(row.abilities.length).toBeGreaterThan(0);
      expect(row.moves.length).toBeGreaterThan(0);
      expect(row.moves).toEqual([...new Set(row.moves)].sort());
      for (const id of row.abilities) expect(abilities.has(id), `${row.id} ability ${id}`).toBe(true);
      for (const id of row.moves) expect(moves.has(id), `${row.id} move ${id}`).toBe(true);
      if (row.requiredItem) expect(items.has(row.requiredItem), `${row.id} item`).toBe(true);
    }
    // Taxonomic baseSpecies is NOT the entry form, and can itself be unavailable.
    expect([...new Set(catalog.species.filter((row) => !species.has(row.baseSpecies)).map((row) => row.baseSpecies))])
      .toEqual(["floette"]);
  });

  it("preserves all resolved Champions movepools and direct 9M source data", () => {
    expect(catalog.species.reduce((total, row) => total + row.moves.length, 0)).toBe(reference.learnsetEntries);
    expect(idHash(catalog.species.map((row) => `${row.id}:${row.moves.join(",")}`))).toBe(reference.learnsetsSha256);
    expect(species.get("charizard")?.moves).toEqual(reference.charizardMoves);
    expect(manifest.learnsets).toHaveLength(reference.speciesCount);
    for (const row of manifest.learnsets) {
      expect(row.sources.some((source) => source.origin === "champions"), row.speciesId).toBe(true);
      expect(row.emittedMoves, row.speciesId).toBe(row.resolvedMoves);
      expect(row.emittedMoves, row.speciesId).toBe(species.get(row.speciesId)?.moves.length);
    }
    // Flabebe is traversed by Dex, but adds nothing to the 41 directly proven moves.
    expect(species.get("floetteeternal")?.moves).toHaveLength(41);
    expect(species.get("floetteeternal")?.unsupported).toEqual([]);
    expect(species.get("floetteeternal")?.moves).not.toContain("tackle");
  });

  it("includes battle-only states and maps Aegislash to Shield, never hypothetical Both", () => {
    expect(species.get("aegislash")).toMatchObject({
      calcName: "Aegislash-Shield", battleForm: false,
      baseStats: { hp: 60, atk: 50, def: 140, spa: 50, spd: 140, spe: 60 },
      unsupported: [],
    });
    expect(species.get("aegislashblade")).toMatchObject({
      calcName: "Aegislash-Blade", baseSpecies: "aegislash", battleForm: true,
      baseStats: { hp: 60, atk: 140, def: 50, spa: 140, spd: 50, spe: 60 },
      unsupported: [],
    });
    expect(species.has("aegislashboth")).toBe(false);
    expect(species.get("aegislashblade")?.moves).toEqual(species.get("aegislash")?.moves);
    expect(species.get("aegislashblade")?.moves).toHaveLength(46);
    expect(species.get("palafinhero")).toMatchObject({
      battleForm: true, baseSpecies: "palafin", weightkg: 97.4,
      baseStats: { hp: 100, atk: 160, def: 97, spa: 106, spd: 87, spe: 100 },
    });
    expect(species.get("palafinhero")?.moves).toEqual(species.get("palafin")?.moves);
    expect(species.get("palafinhero")?.moves).toHaveLength(58);
  });

  it("includes new Mega content with raw game stats, correct abilities and stones", () => {
    expect(species.get("raichumegax")).toMatchObject({
      abilities: ["electricsurge"], requiredItem: "raichunitex", weightkg: 38,
      baseStats: { hp: 60, atk: 135, def: 95, spa: 90, spd: 95, spe: 110 },
    });
    expect(species.get("raichumegay")).toMatchObject({
      abilities: ["noguard"], requiredItem: "raichunitey",
      baseStats: { hp: 60, atk: 100, def: 55, spa: 160, spd: 80, spe: 130 },
    });
    expect(species.get("greninjamega")).toMatchObject({
      abilities: ["protean"], requiredItem: "greninjite",
      baseStats: { hp: 72, atk: 125, def: 77, spa: 133, spd: 81, spe: 142 },
    });
    expect(species.get("eelektrossmega")).toMatchObject({ abilities: ["eelevate"], requiredItem: "eelektrossite", weightkg: 180 });
    expect(species.get("froslassmega")).toMatchObject({ abilities: ["snowwarning"], requiredItem: "froslassite" });
    expect(species.get("lucariomegaz")).toMatchObject({
      abilities: ["auraguard"], requiredItem: "lucarionitez",
      baseStats: { hp: 70, atk: 100, def: 70, spa: 164, spd: 70, spe: 151 },
    });
  });

  it("preserves real Mega form/stone/learnset inheritance, including multiform stones", () => {
    for (const item of catalog.items) {
      for (const target of item.megaTargets) {
        expect(species.has(target.baseSpeciesId), `${item.id} base`).toBe(true);
        const form = species.get(target.formId)!;
        expect(form, `${item.id} form`).toBeDefined();
        expect(form.requiredItem).toBe(item.id);
        expect(form.battleForm).toBe(true);
        expect(form.moves, target.formId).toEqual(species.get(target.baseSpeciesId)!.moves);
      }
    }
    expect(items.get("charizarditex")).toMatchObject({ megaStone: "charizardmegax", megaEvolves: "charizard" });
    expect(species.get("floettemega")).toMatchObject({ baseSpecies: "floette", requiredItem: "floettite" });
    expect(items.get("floettite")?.megaTargets).toEqual([{ baseSpeciesId: "floetteeternal", formId: "floettemega" }]);
    expect(species.get("floettemega")?.moves).toEqual(species.get("floetteeternal")?.moves);
    expect(items.get("meowsticite")).toMatchObject({
      megaStone: null, megaEvolves: null, unsupported: [],
      megaTargets: [
        { baseSpeciesId: "meowstic", formId: "meowsticmmega" },
        { baseSpeciesId: "meowsticf", formId: "meowsticfmega" },
      ],
    });
    expect(species.get("meowsticmmega")?.moves).toHaveLength(59);
    expect(species.get("meowsticfmega")?.moves).toHaveLength(56);
    expect(species.get("meowsticfmega")?.moves).not.toEqual(species.get("meowsticmmega")?.moves);
  });

  it("uses resolved form extensions and explicit shared-learnset inheritance", () => {
    const baseRotom = species.get("rotom")!.moves;
    expect(species.get("rotomwash")?.moves).toEqual([...baseRotom, "hydropump"].sort());
    expect(species.get("gourgeistsuper")?.moves).toEqual(species.get("gourgeist")?.moves);
    expect(species.get("gourgeistsuper")?.moves).toHaveLength(60);
  });

  it("keeps statuses, fixed damage, OHKO, multihit and mod move changes", () => {
    expect(moves.get("protect")).toMatchObject({ category: "Status", power: 0, accuracy: null });
    expect(moves.get("trickroom")).toMatchObject({ category: "Status", power: 0, unsupported: [] });
    expect(moves.get("seismictoss")).toMatchObject({ category: "Physical", type: "Fighting", power: 0 });
    expect(moves.get("nightshade")).toMatchObject({ category: "Special", type: "Ghost", power: 0 });
    expect(moves.get("superfang")).toMatchObject({ power: 0, accuracy: 90 });
    expect(moves.get("fissure")).toMatchObject({ ohko: true, power: 0, accuracy: 30 });
    expect(moves.get("bulletseed")?.multihit).toEqual([2, 5]);
    expect(moves.get("doublehit")?.multihit).toBe(2);
    expect(moves.get("populationbomb")?.multihit).toBe(10);
    expect(moves.get("tripleaxel")?.multihit).toBe(3);
    expect(moves.get("beakblast")?.power).toBe(120);
    expect(moves.get("appleacid")?.power).toBe(90);
    // A fragment changes Anchor Shot's power but does not clear its inherited
    // Past flag. Only the resolved mod (not fragment parsing) gets this right.
    expect(moves.has("anchorshot")).toBe(false);
    expect(moves.get("spiritshackle")?.power).toBe(90);
  });

  it("excludes unavailable content without excluding available Ubers or NFEs", () => {
    for (const id of ["bulbasaur", "mewtwo", "heatranmega", "darkraimega", "greninjaash", "eiscuenoice", "ogerpontealtera", "terapagosterastal"]) {
      expect(species.has(id), id).toBe(false);
    }
    for (const id of ["absorb", "hiddenpower", "astralbarrage"]) expect(moves.has(id), id).toBe(false);
    for (const id of ["abilityshield", "assaultvest"]) expect(items.has(id), id).toBe(false);
    expect(species.has("pikachu")).toBe(true); // NFE
    expect(species.has("blastoisemega")).toBe(true); // Uber
    expect(species.has("raichualola")).toBe(true);
  });

  it("has exact gen0 engine lookups/stats/types/weight for every supported species", () => {
    expect(generation.num).toBe(0);
    for (const row of catalog.species.filter((entry) => !entry.unsupported.length)) {
      const engine = generation.species.get(toID(row.calcName));
      expect(engine, row.id).toBeDefined();
      expect(engine!.name, row.id).toBe(row.calcName);
      expect(engine!.baseStats, row.id).toEqual(row.baseStats);
      expect(engine!.types, row.id).toEqual(row.types);
      expect(engine!.weightkg, row.id).toBe(row.weightkg);
      expect(new Pokemon(generation, row.calcName).name, row.id).toBe(row.calcName);
    }
    for (const row of catalog.moves.filter((entry) => !entry.unsupported.length)) {
      const data = generation.moves.get(toID(row.name));
      expect(data, row.id).toBeDefined();
      expect(data!.type, row.id).toBe(row.type);
      expect(data!.basePower, row.id).toBe(row.power);
      const engine = new Move(generation, row.name);
      expect(engine.name, row.id).toBe(row.name);
      expect(engine.category, row.id).toBe(row.category);
      // Struggle is Normal in both raw datasets, deliberately typeless in battle.
      expect(engine.type, row.id).toBe(row.id === "struggle" ? "???" : row.type);
    }
    for (const row of catalog.abilities.filter((entry) => !entry.unsupported.length)) {
      expect(generation.abilities.get(toID(row.name))?.name, row.id).toBe(row.name);
    }
    for (const row of catalog.items.filter((entry) => !entry.unsupported.length)) {
      expect(generation.items.get(toID(row.name))?.name, row.id).toBe(row.name);
    }
  });

  it("exposes known engine/source gaps without silently removing game entries", () => {
    expect(moves.get("pound")).toMatchObject({ power: 40, category: "Physical", unsupported: ["Engine move missing: Pound."] });
    expect(moves.get("growth")).toMatchObject({ type: "Grass", unsupported: ["Engine move type differs: Normal vs Grass."] });
    expect(abilities.get("auraguard")?.unsupported).toContain("Assigned Champions ability is marked Future in the source.");
    expect(abilities.get("battlebond")?.unsupported).toContain("Engine ability missing: Battle Bond.");
    expect(species.get("greninja")?.unsupported).toEqual([]);
    expect(species.get("greninja")?.abilities).toContain("torrent");
    expect(species.get("vivillonarchipelago")?.unsupported).toContain("Engine species missing: Vivillon-Archipelago.");
    expect(catalog.coverage.unsupportedSpecies).toBe(18);
    expect(catalog.coverage.unsupportedMoves).toBe(2);
    expect(catalog.coverage.unsupportedSpecies).toBe(catalog.species.filter((row) => row.unsupported.length).length);
    expect(catalog.coverage.unsupportedMoves).toBe(catalog.moves.filter((row) => row.unsupported.length).length);
    expect(catalog.coverage.notes.some((note) => note.includes("not implementation of mechanics"))).toBe(true);
    expect(catalog.coverage.notes).toContain("Species with incomplete Champions learnsets (0): none.");
  });
});
