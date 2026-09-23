import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Generations, Move } from "@smogon/calc";
import { Move as EngineMove } from "@smogon/calc/dist/move";
import { createBattleData } from "../../scripts/build-battle-data";
import { ROOT } from "../../scripts/lib/champions-data/sources.mjs";
import { toID } from "../../scripts/lib/champions-data/transform";
import { canonical, compact, readVerifiedArchive, sha256, sorted } from "../../scripts/lib/battle-data/sources";
import { engineSpeciesID, nativeSpecies, transformNativeCatalog } from "../../scripts/lib/battle-data/transform";
import { NATIVE_GAMES, type NativeGame } from "../../scripts/lib/battle-data/types";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn(original.spawnSync) };
});

type Generated = Awaited<ReturnType<typeof createBattleData>>[number];
let generated: Generated[];
let engineExtractionArgs: string[][];
const data = (game: NativeGame) => generated.find((entry) => entry.catalog.game === game)!;
const usum = () => data("ultra_sun_ultra_moon");
const swsh = () => data("sword_shield");
const sv = () => data("scarlet_violet");
const pokemon = (entry: Generated, id: string) => entry.catalog.species.find((row) => row.id === id)!;
const move = (entry: Generated, id: string) => entry.catalog.moves.find((row) => row.id === id)!;
const item = (entry: Generated, id: string) => entry.catalog.items.find((row) => row.id === id)!;

beforeAll(async () => {
  // This also proves every real generation is built without network access.
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in native generator tests"));
  try {
    generated = await createBattleData();
    engineExtractionArgs = vi.mocked(spawnSync).mock.calls.flatMap(([command, args]) =>
      command === "tar" && Array.isArray(args) && args.includes("../damage-calc.tar.gz") ? [args.map(String)] : []);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
}, 120_000);

describe("native deterministic source pipeline", () => {
  it("extracts only the engine's regular license target without requiring Windows symlinks", () => {
    expect(engineExtractionArgs).toHaveLength(1);
    expect(engineExtractionArgs[0]).toEqual([
      "-xzf", "../damage-calc.tar.gz", "--strip-components=1",
      "damage-calc-e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d/LICENSE",
    ]);
  });

  it("rejects missing/corrupt source caches offline before loading code", async () => {
    const cache = await mkdtemp(join(tmpdir(), "battle-source-test-"));
    try {
      const pin = { repo: "fixture", revision: "pinned", sha256: sha256("verified source") };
      await expect(readVerifiedArchive(pin, cache)).rejects.toThrow("Offline source archive missing");
      await writeFile(join(cache, "fixture-pinned.tar.gz"), "corrupt");
      await expect(readVerifiedArchive(pin, cache)).rejects.toThrow("checksum mismatch");
      await writeFile(join(cache, "fixture-pinned.tar.gz"), "verified source");
      expect((await readVerifiedArchive(pin, cache)).toString()).toBe("verified source");
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it.each(NATIVE_GAMES)("reproduces all committed $game assets, hashes and licenses", async (profile) => {
    const entry = data(profile.game);
    for (const [name, content] of entry.files) {
      expect(await readFile(join(ROOT, "data/battle", profile.game, name), "utf8"), name).toBe(content);
    }
    expect(entry.catalog).toMatchObject({ version: 1, game: profile.game, level: null });
    expect(entry.manifest.catalogSha256).toBe(sha256(compact(entry.catalog)));
    expect(entry.manifest.sources.engine).toMatchObject({
      generation: profile.gen, revision: "e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d",
      archiveSha256: "ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84",
    });
    expect(entry.manifest.sources.showdown).toMatchObject({
      mod: profile.mod, ancestry: [...profile.ancestry],
      revision: "c23d2e942c9c0daadb13a7162a385bf78e3c9353",
      archiveSha256: "640e41b11a4906d27ec435674ce2c667231d89de879f2a9cd7f81a7a280b41e2",
    });
    expect(entry.manifest.sources.showdown.compilerInputFiles.map((row) => row.path)).toEqual(expect.arrayContaining([
      "sim/dex.ts", "sim/dex-species.ts", "data/learnsets.ts", "data/pokedex.ts",
      "data/mods/gen7/scripts.ts", "data/mods/gen7/pokedex.ts", "data/mods/gen8/scripts.ts",
      "data/mods/gen8/pokedex.ts", "data/mods/gen8/learnsets.ts", "data/mods/gen8/typechart.ts",
    ]));
    expect(entry.manifest.sources.showdown.licenseSha256).toBe(sha256(entry.files.get("LICENSE.pokemon-showdown.txt")!));
    expect(entry.manifest.sources.engine.licenseSha256).toBe(sha256(entry.files.get("LICENSE.damage-calc.txt")!));
    expect(entry.files.get("LICENSE.pokemon-showdown.txt")).toContain("MIT License");
    expect(entry.files.get("LICENSE.damage-calc.txt")).toContain("MIT License");
    expect(compact(entry.manifest)).not.toMatch(/generatedAt|timestamp|C:\\\\Users|battle-data-[A-Za-z0-9]{6}/);
  });

  it.each(NATIVE_GAMES)("is byte deterministic under reordered $game inputs and never mutates them", (profile) => {
    const entry = data(profile.game);
    const source = structuredClone(entry.source);
    const engine = structuredClone(entry.engine);
    const before = canonical({ source, engine });
    expect(compact(transformNativeCatalog(source, engine, entry.catalog.sources))).toBe(compact(entry.catalog));
    expect(canonical({ source, engine })).toBe(before);
    for (const rows of [source.species, source.moves, source.abilities, source.items,
      engine.species, engine.moves]) rows.reverse();
    engine.abilities = [...engine.abilities].reverse();
    engine.items = [...engine.items].reverse();
    for (const row of source.species) {
      row.learnset.movePool.reverse();
      row.abilities = Object.fromEntries(Object.entries(row.abilities).reverse());
    }
    expect(compact(transformNativeCatalog(source, engine, entry.catalog.sources))).toBe(compact(entry.catalog));
  });

  it.each(NATIVE_GAMES)("keeps every $game identity, reference and table deterministically ordered", (profile) => {
    const { catalog, manifest, source } = data(profile.game);
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
    expect(nativeSpecies(source).map((row) => row.id)).toEqual([...species.keys()]);
    expect(manifest.learnsets.every((row) => row.sources.length && !row.error)).toBe(true);
  });
});

describe("historical native game data and actual Dex learnset semantics", () => {
  it("resolves patches through the entire gen7/gen8/gen9 ancestry", () => {
    expect(pokemon(usum(), "aegislash").baseStats).toMatchObject({ def: 150, spd: 150 });
    expect(pokemon(swsh(), "aegislash").baseStats).toMatchObject({ def: 140, spd: 140 });
    expect(pokemon(usum(), "cresselia").baseStats).toMatchObject({ def: 120, spd: 130 });
    expect(pokemon(swsh(), "cresselia").baseStats).toMatchObject({ def: 120, spd: 130 });
    expect(pokemon(sv(), "cresselia").baseStats).toMatchObject({ def: 110, spd: 120 });
    expect(pokemon(swsh(), "zaciancrowned").baseStats.atk).toBe(170);
    expect(pokemon(sv(), "zaciancrowned").baseStats.atk).toBe(150);
    expect(pokemon(usum(), "empoleon").abilities).toEqual(["defiant", "torrent"]);
    expect(pokemon(sv(), "empoleon").abilities).toEqual(["competitive", "torrent"]);
    expect(move(usum(), "rapidspin").power).toBe(20);
    expect(move(swsh(), "rapidspin").power).toBe(50);
    expect(move(usum(), "grassyglide")).toBeUndefined();
    expect(move(swsh(), "grassyglide").power).toBe(70);
    expect(move(sv(), "grassyglide").power).toBe(55);
  });

  it("excludes LGPE/Legends/Champions-only and later content without tier filtering", () => {
    for (const id of ["meltan", "melmetal", "pikachustarter", "eeveestarter", "magearnaoriginal", "floetteeternal", "floettemega", "dragonitemega", "zacian", "ogerpon"]) {
      expect(pokemon(usum(), id), id).toBeUndefined();
    }
    for (const id of ["growlithehisui", "kleavor", "enamorus", "eternatuseternamax", "charizardmegax", "ogerpon", "terapagos"]) {
      expect(pokemon(swsh(), id), id).toBeUndefined();
    }
    for (const id of ["charizardmegax", "rayquazamega", "necrozmaultra", "aegislash", "eternatuseternamax", "charizardgmax", "floettemega"]) {
      expect(pokemon(sv(), id), id).toBeUndefined();
    }
    expect(pokemon(usum(), "rayquazamega")).toBeDefined(); // AG is not unavailable.
    expect(pokemon(swsh(), "calyrexshadow")).toBeDefined();
    expect(pokemon(sv(), "terapagosstellar")).toBeDefined();
    expect(pokemon(sv(), "pecharunt")).toBeDefined();
    expect(item(usum(), "heavydutyboots")).toBeUndefined();
    expect(item(swsh(), "boosterenergy")).toBeUndefined();
    expect(item(sv(), "charizarditex")).toBeUndefined();
    expect(item(swsh(), "firiumz")).toBeUndefined();
    expect(move(swsh(), "terablast")).toBeUndefined();
  });

  it("retains gen7/gen8 transfer moves but applies gen9 HOME reset", () => {
    for (const entry of [usum(), swsh()]) {
      expect(pokemon(entry, "cresselia").moves).toContain("toxic");
      expect(pokemon(entry, "charizard").moves).toContain("defog");
      expect(pokemon(entry, "gengar").moves).toContain("counter");
      expect(entry.manifest.learnsets.find((row) => row.speciesId === "charizard")?.sources.map((row) => row.speciesId))
        .toEqual(["charizard", "charmeleon", "charmander"]);
    }
    expect(pokemon(sv(), "cresselia").moves).not.toContain("toxic");
    expect(pokemon(sv(), "charizard").moves).not.toContain("defog");
    expect(pokemon(sv(), "gengar").moves).not.toContain("counter");
    expect(pokemon(sv(), "empoleon").moves).toContain("haze");
    expect(pokemon(sv(), "empoleon").moves).not.toContain("scald");
    expect(pokemon(swsh(), "cresselia").moves).not.toContain("hiddenpower");
    expect(swsh().manifest.learnsets.find((row) => row.speciesId === "cresselia")?.unavailableMoves).toContain("hiddenpower");
    for (const entry of generated) {
      expect(entry.manifest.learnsets.flatMap((row) => row.sources).every((row) =>
        row.mod === "base" && row.file === "data/learnsets.ts" && /^[a-f0-9]{64}$/.test(row.sha256))).toBe(true);
    }
  });

  it.each(NATIVE_GAMES)("emits exactly the legal subset of pinned getMovePool for $game", (profile) => {
    const entry = data(profile.game);
    const selectable = new Set(entry.catalog.moves.filter((row) => !row.isZ && !row.isMax).map((row) => row.id));
    const hp = entry.catalog.moves.filter((row) => row.id !== "hiddenpower" && row.id.startsWith("hiddenpower")).map((row) => row.id);
    for (const raw of nativeSpecies(entry.source)) {
      const expected = raw.learnset.movePool.filter((id) => selectable.has(id));
      if (expected.includes("hiddenpower")) expected.push(...hp);
      expect(pokemon(entry, raw.id).moves, raw.id).toEqual(sorted(expected));
    }
    if (profile.gen !== 8) {
      const smeargle = pokemon(entry, "smeargle");
      expect(smeargle.moves).toContain("sketch");
      expect(smeargle.moves).toContain("spore");
      expect(smeargle.moves).not.toContain("struggle");
      expect(smeargle.moves).not.toContain("chatter");
    }
  });
});

describe("forms and source-verified native transformation metadata", () => {
  it("retains Mega, Primal and Ultra entry constraints and item alternatives", () => {
    expect(pokemon(usum(), "charizardmegax")).toMatchObject({ requiredItem: "charizarditex", battleOnly: ["charizard"], changesFrom: "charizard" });
    expect(item(usum(), "charizarditex")).toMatchObject({ megaStone: "charizardmegax", megaEvolves: "charizard", megaTargets: [{ baseSpeciesId: "charizard", formId: "charizardmegax" }] });
    expect(pokemon(usum(), "groudonprimal")).toMatchObject({ requiredItem: "redorb", battleOnly: ["groudon"] });
    expect(pokemon(usum(), "kyogreprimal")).toMatchObject({ requiredItem: "blueorb", battleOnly: ["kyogre"] });
    expect(pokemon(usum(), "rayquazamega")).toMatchObject({ requiredItem: null, requiredMove: "dragonascent", battleOnly: ["rayquaza"] });
    expect(pokemon(usum(), "necrozmaultra")).toMatchObject({ requiredItem: "ultranecroziumz", battleOnly: ["necrozmadawnwings", "necrozmaduskmane"] });
    expect(pokemon(usum(), "arceusbug")).toMatchObject({ requiredItem: null, requiredItems: ["buginiumz", "insectplate"] });
    expect(pokemon(sv(), "arceusbug")).toMatchObject({ requiredItem: "insectplate", requiredItems: ["insectplate"] });
    expect(sv().manifest.availability.omittedRequiredItems).toContainEqual({ speciesId: "arceusbug", itemIds: ["buginiumz"] });
  });

  it("preserves fixed genders and Tera requirements only where applicable", () => {
    expect(pokemon(usum(), "nidoranm").gender).toBe("M");
    expect(pokemon(usum(), "nidoranf").gender).toBe("F");
    expect(pokemon(usum(), "mewtwo").gender).toBe("N");
    expect(pokemon(usum(), "pikachu").gender).toBeUndefined();
    expect(pokemon(sv(), "ogerponwellspringtera")).toMatchObject({ requiredItem: "wellspringmask", requiredTeraType: "Water", battleOnly: ["ogerponwellspring"] });
    expect(pokemon(sv(), "terapagosstellar")).toMatchObject({ requiredTeraType: "Stellar", battleOnly: ["terapagos"] });
    for (const entry of [usum(), swsh()]) expect(entry.catalog.species.some((row) => row.requiredTeraType)).toBe(false);
  });

  it("emits source-proven cosmetics without a generic base-form fallback", () => {
    for (const entry of [swsh(), sv()]) {
      for (const flavor of ["Ruby-Cream", "Matcha-Cream", "Mint-Cream", "Lemon-Cream", "Salted-Cream", "Ruby-Swirl", "Caramel-Swirl", "Rainbow-Swirl"]) {
        const id = toID(`Alcremie-${flavor}`);
        expect(pokemon(entry, id)).toMatchObject({ name: `Alcremie-${flavor}`, calcName: "Alcremie", unsupported: [] });
        expect(pokemon(entry, id).moves).toEqual(pokemon(entry, "alcremie").moves);
        expect(entry.manifest.identity.engineAliases).toContainEqual({ speciesId: id, calcName: "Alcremie", proof: { isCosmeticForme: true, aliasTarget: "alcremie" } });
      }
      const raw = entry.source.species.find((row) => row.id === "alcremierubycream")!;
      expect(engineSpeciesID({ ...raw, isCosmeticForme: false }, new Set(["alcremie"]))).toBe(raw.id);
      expect(engineSpeciesID({ ...raw, cosmeticParent: undefined }, new Set(["alcremie"]))).toBe(raw.id);
      expect(engineSpeciesID(raw, new Set([raw.id, "alcremie"]))).toBe(raw.id);
    }
    expect(pokemon(usum(), "aegislash").calcName).toBe("Aegislash-Shield");
    expect(generated.some((entry) => pokemon(entry, "aegislashboth"))).toBe(false);
  });

  it("maps explicit Gmax factor names/signatures and Dynamax exclusions without 0kg placeholders", () => {
    expect(pokemon(swsh(), "charizard")).toMatchObject({ canGigantamax: "gmaxwildfire", gmaxNames: ["Charizard-Gmax"] });
    expect(pokemon(swsh(), "toxtricitylowkey")).toMatchObject({ canGigantamax: "gmaxstunshock", gmaxNames: ["Toxtricity-Low-Key-Gmax"] });
    expect(pokemon(swsh(), "urshifurapidstrike")).toMatchObject({ canGigantamax: "gmaxrapidflow", gmaxNames: ["Urshifu-Rapid-Strike-Gmax"] });
    expect(pokemon(swsh(), "alcremierubycream").canGigantamax).toBe("gmaxfinale");
    expect(pokemon(swsh(), "alcremierubycream").gmaxNames).toBeUndefined();
    expect(swsh().catalog.species.filter((row) => row.gmaxNames)).toHaveLength(34);
    for (const id of ["zacian", "zaciancrowned", "zamazenta", "zamazentacrowned", "eternatus"]) {
      expect(pokemon(swsh(), id).cannotDynamax).toBe(true);
    }
    for (const entry of generated) expect(entry.catalog.species.some((row) => row.id.endsWith("gmax"))).toBe(false);
    for (const entry of [usum(), sv()]) {
      expect(entry.catalog.species.some((row) => row.canGigantamax || row.gmaxNames || row.cannotDynamax)).toBe(false);
    }
  });

  it("preserves the pinned Butterfree signature mismatch instead of silently trusting engine metadata", () => {
    const butterfly = pokemon(swsh(), "butterfree");
    const engine = swsh().engine.species.find((row) => row.id === "butterfree")!;
    expect(engine.canGigantamax).toBe("G-Max Flutterby");
    expect(butterfly.canGigantamax).toBe("gmaxbefuddle");
    expect(butterfly.unsupported).toEqual([]);
    expect(swsh().manifest.coverage.engineHintDiscrepancies).toEqual([{
      speciesId: "butterfree", field: "canGigantamax", engineValue: "G-Max Flutterby", sourceValue: "G-Max Befuddle",
      verifiedSignatureOverride: true,
      resolution: "Use exact catalog signature with the tested dist/move overrideMove adapter; never the engine species hint.",
    }]);
    // Characterize the narrow, source-directed override; the generator does not
    // rewrite the engine or silently remove the recorded mismatch.
    const signature = [...Generations.get(8).moves].find((row) => row.id === butterfly.canGigantamax)!;
    expect(new EngineMove(Generations.get(8), "Bug Buzz", { useMax: true, overrideMove: signature.name }))
      .toMatchObject({ name: "G-Max Befuddle", type: "Bug", category: "Special", bp: 130, isMax: true });
    const changedEngine = structuredClone(swsh().engine);
    changedEngine.species.find((row) => row.id === "butterfree")!.canGigantamax = "G-Max Wildfire";
    const unverified = transformNativeCatalog(swsh().source, changedEngine, swsh().catalog.sources);
    expect(unverified.species.find((row) => row.id === "butterfree")?.unsupported)
      .toContain("Engine Gigantamax signature differs from native game data.");
  });

  it("emits generic/signature Z eligibility using exact move and species IDs", () => {
    expect(item(usum(), "firiumz")).toMatchObject({ zMoveType: "Fire" });
    expect(item(usum(), "firiumz").zMove).toBeUndefined();
    expect(item(usum(), "aloraichiumz")).toMatchObject({ zMove: "stokedsparksurfer", zMoveFrom: "thunderbolt", itemUser: ["raichualola"] });
    expect(item(usum(), "mimikiumz")).toMatchObject({ zMove: "letssnuggleforever", zMoveFrom: "playrough", itemUser: ["mimikyu", "mimikyubusted", "mimikyubustedtotem", "mimikyutotem"] });
    expect(item(usum(), "ultranecroziumz")).toMatchObject({ zMove: "lightthatburnsthesky", zMoveFrom: "photongeyser", itemUser: ["necrozmaultra"] });
    expect(item(usum(), "eeviumz")).toMatchObject({ zMove: "extremeevoboost", zMoveFrom: "lastresort", itemUser: ["eevee"] });
    expect(move(usum(), "extremeevoboost")).toMatchObject({ category: "Status", isZ: true });
    expect(usum().catalog.items.filter((row) => row.zMove || row.zMoveType)).toHaveLength(35);
    expect(move(usum(), "flamethrower").zMovePower).toBe(175);
    expect(move(swsh(), "flamethrower").maxMovePower).toBe(130);
    expect(move(swsh(), "closecombat").maxMovePower).toBe(95);
    expect(move(sv(), "flamethrower").zMovePower).toBeUndefined();
    expect(move(sv(), "flamethrower").maxMovePower).toBeUndefined();
  });

  it("uses explicit typed Hidden Power identities, exact engine parity and native availability", () => {
    const hp = usum().catalog.moves.filter((row) => row.id.startsWith("hiddenpower"));
    expect(hp).toHaveLength(17);
    expect(move(usum(), "hiddenpowerice")).toMatchObject({ name: "Hidden Power Ice", type: "Ice", category: "Special", power: 60, zMovePower: 120, unsupported: [] });
    expect(pokemon(usum(), "pikachu").moves).toEqual(expect.arrayContaining(hp.map((row) => row.id)));
    expect(pokemon(usum(), "magikarp").moves).not.toContain("hiddenpowerice");
    expect(move(usum(), "hiddenpowerfairy")).toBeUndefined();
    expect(move(usum(), "hiddenpowernormal")).toBeUndefined();
    for (const entry of [swsh(), sv()]) expect(entry.catalog.moves.some((row) => row.id.startsWith("hiddenpower"))).toBe(false);
    expect(new Move(Generations.get(7), "Hidden Power Ice", { useZ: true }))
      .toMatchObject({ name: "Breakneck Blitz", type: "Normal", category: "Special", bp: 120 });
  });
});

describe("native exact-engine coverage diagnostics", () => {
  it.each(NATIVE_GAMES)("checks every supported $game species/move against that exact engine generation", (profile) => {
    const { catalog } = data(profile.game);
    const engine = Generations.get(profile.gen);
    const species = new Map([...engine.species].map((row) => [row.name as string, row]));
    const moves = new Map([...engine.moves].map((row) => [row.id as string, row]));
    for (const row of catalog.species) {
      const calc = species.get(row.calcName)!;
      expect(calc.types, row.id).toEqual(row.types);
      expect(calc.baseStats, row.id).toEqual(row.baseStats);
      expect(calc.weightkg, row.id).toBe(row.weightkg);
    }
    for (const row of catalog.moves) {
      const calc = moves.get(row.id)!;
      expect(calc.type, row.id).toBe(row.type);
      expect(new Move(engine, calc.name).category, row.id).toBe(row.category);
      expect(calc.basePower, row.id).toBe(row.power);
      expect(row.unsupported, row.id).toEqual([]);
    }
    expect(catalog.coverage.unsupportedMoves).toBe(0);
    expect(catalog.coverage.unsupportedSpecies).toBe(0);
    expect(catalog.abilities.filter((row) => row.unsupported.length)).toEqual([]);
    expect(catalog.items.filter((row) => row.unsupported.length)).toEqual([]);
  });

  it("rejects accidental wrong-generation engines and malformed identities", () => {
    const entry = usum();
    expect(() => transformNativeCatalog(entry.source, sv().engine, entry.catalog.sources)).toThrow("generation 7");
    const source = structuredClone(entry.source);
    const raw = source.species.find((row) => row.id === "venusaur")!;
    raw.id = "Venusaur";
    expect(() => transformNativeCatalog(source, entry.engine, entry.catalog.sources)).toThrow("Noncanonical species");
  });

  it("flags missing/mismatched engine data and never substitutes source stats or a guessed base form", () => {
    const entry = usum();
    const engine = structuredClone(entry.engine);
    const raw = engine.species.find((row) => row.id === "venusaur")!;
    raw.baseStats = { ...raw.baseStats, atk: 200 };
    raw.types = ["Fire"];
    raw.weightkg = 123;
    engine.species = engine.species.filter((row) => row.id !== "charizardmegax");
    engine.moves = engine.moves.map((row) => row.id === "tackle" ? { ...row, basePower: 999 } : row);
    const catalog = transformNativeCatalog(entry.source, engine, entry.catalog.sources);
    expect(catalog.species.find((row) => row.id === "venusaur")).toMatchObject({
      baseStats: { atk: 82 }, types: ["Grass", "Poison"], weightkg: 100,
      unsupported: expect.arrayContaining([
        "Engine base stat differs (atk): 200 vs 82.",
        "Engine species types differ: Fire vs Grass/Poison.",
        "Engine weight differs: 123 vs 100 kg.",
      ]),
    });
    expect(catalog.species.find((row) => row.id === "charizardmegax")).toMatchObject({
      calcName: "Charizard-Mega-X", unsupported: ["Engine species missing: Charizard-Mega-X."],
    });
    expect(catalog.moves.find((row) => row.id === "tackle")).toMatchObject({ power: 40, unsupported: ["Engine move power differs: 999 vs 40."] });
  });
});
