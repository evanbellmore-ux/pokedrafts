import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Generations, Move } from "@smogon/calc";
import { Move as EngineMove } from "@smogon/calc/dist/move";
import { createBattleData } from "../../scripts/build-battle-data";
import { ROOT } from "../../scripts/lib/champions-data/sources.mjs";
import { toID } from "../../scripts/lib/champions-data/transform";
import { canonical, compact, loadModule, readVerifiedArchive, sha256, sorted, withVerifiedSources } from "../../scripts/lib/battle-data/sources";
import { engineSpeciesID, nativeSpecies, transformNativeCatalog } from "../../scripts/lib/battle-data/transform";
import { NATIVE_GAMES, type NativeGame } from "../../scripts/lib/battle-data/types";
import { randomBattleCatalog } from "../../scripts/lib/battle-data/random-battle";
import { CHARGE_MOVES, NOT_TWICE_MOVES, RECHARGE_MOVES, STAT_MOVES, STATUS_MOVES, statMove, type StatMove } from "../../app/lib/battle/stat-moves";
import { HIT_ABILITIES, HIT_ITEMS, itemOwner, OWNED_ITEMS, STAT_GUARDS, UNBREAKABLE } from "../../app/lib/battle/uses-to-ko";

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
    // The builder adds the Random Battle block to the transformed catalog.
    const build = (files = entry.randomBattleFiles, generated = entry.randomBattleGenerated) => {
      const catalog = transformNativeCatalog(source, engine, entry.catalog.sources);
      return { ...catalog, randomBattle: randomBattleCatalog(catalog, source, profile, files, generated).block };
    };
    expect(compact(build())).toBe(compact(entry.catalog));
    expect(canonical({ source, engine })).toBe(before);
    for (const rows of [source.species, source.moves, source.abilities, source.items,
      engine.species, engine.moves]) rows.reverse();
    engine.abilities = [...engine.abilities].reverse();
    engine.items = [...engine.items].reverse();
    for (const row of source.species) {
      row.learnset.movePool.reverse();
      row.abilities = Object.fromEntries(Object.entries(row.abilities).reverse());
    }
    // Reordered set keys and generated counts give the same ranking.
    const shuffled = entry.randomBattleFiles.map((file) => ({ ...file, sets: Object.fromEntries(Object.entries(structuredClone(file.sets)).reverse()) }));
    const reversed = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).reverse());
    const regenerated = entry.randomBattleGenerated.map((run) => ({ ...run, keys: Object.fromEntries(Object.entries(run.keys).reverse().map(([key, value]) => [key, {
      n: value.n, moves: reversed(value.moves), sets: reversed(value.sets),
    }])) }));
    expect(compact(build(shuffled, regenerated))).toBe(compact(entry.catalog));
  });

  it.each(NATIVE_GAMES)("ranks $game quick-move defaults from the pinned Random Battle sets", (profile) => {
    const entry = data(profile.game);
    const block = entry.catalog.randomBattle!;
    expect(Object.keys(block.formats).sort()).toEqual(profile.game === "scarlet_violet" ? ["Doubles", "Singles"] : ["Singles"]);
    const rows = { ultra_sun_ultra_moon: { Singles: 625 }, sword_shield: { Singles: 471 }, scarlet_violet: { Singles: 576, Doubles: 571 } }[profile.game] as Record<string, number>;
    const abilities = { ultra_sun_ultra_moon: { Singles: 582 }, sword_shield: { Singles: 472 }, scarlet_violet: { Singles: 571, Doubles: 566 } }[profile.game] as Record<string, number>;
    for (const [format, table] of Object.entries(block.formats)) {
      expect(table!.file).toBe((profile.randomBattleSets as Record<string, string>)[format]);
      expect(Object.keys(table!.species).length, format).toBe(rows[format]);
      for (const [speciesId, moves] of Object.entries(table!.species)) {
        const species = pokemon(entry, speciesId);
        expect(new Set(moves).size, speciesId).toBe(moves.length);
        expect(moves.length, speciesId).toBeLessThanOrEqual(4);
        for (const id of moves) {
          expect(species.moves, `${speciesId} ${id}`).toContain(id);
          expect(move(entry, id).category, `${speciesId} ${id}`).not.toBe("Status");
        }
      }
      expect(table!.aggregate.every((id) => move(entry, id).category !== "Status")).toBe(true);
      expect(entry.manifest.randomBattleSets.formats[format].rows).toBe(rows[format]);
      // Each form's most generated ability is one of its own that the engine supports.
      expect(Object.keys(table!.abilities).length, format).toBe(abilities[format]);
      expect(entry.manifest.randomBattleSets.formats[format].abilities).toBe(abilities[format]);
      for (const [speciesId, ability] of Object.entries(table!.abilities)) {
        expect(pokemon(entry, speciesId).abilities, speciesId).toContain(ability);
        expect(entry.catalog.abilities.find((row) => row.id === ability)?.unsupported, speciesId).toEqual([]);
      }
    }
    for (const file of entry.manifest.randomBattleSets.files) {
      expect(entry.randomBattleFiles.find((row) => row.path === file.path)?.sha256).toBe(file.sha256);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(entry.manifest.randomBattleSets.getFormeSources.map((file) => file.path)).toContain("data/random-battles/gen9/teams.ts");
    // The pinned generator's seeded output ranks them (preferred types, forced moves and banned pairs included).
    const garchomp = { ultra_sun_ultra_moon: ["earthquake", "outrage", "stoneedge", "firefang"], sword_shield: ["earthquake", "outrage", "scaleshot", "dragontail"], scarlet_violet: ["earthquake", "scaleshot", "outrage", "dragontail"] }[profile.game];
    expect(block.formats.Singles!.species.garchomp).toEqual(garchomp);
    for (const table of Object.values(block.formats)) {
      for (const [speciesId, moves] of Object.entries(table!.species)) expect(moves.filter((id) => id.startsWith("hiddenpower")).length, speciesId).toBeLessThanOrEqual(1);
    }
    expect(entry.manifest.randomBattleSets.formats.Singles.generator).toBe(`${profile.randomBattleFormats.Singles}, seed 1,2,3,4, 10000 teams (0 failed)`);
    if (profile.game === "ultra_sun_ultra_moon") {
      // A battle-only form takes only the sets that reach it (Relic Song for Meloetta-Pirouette), and a
      // gen 7 set's preferred type is always added (Nidoking's Ice Beam, Komala's Knock Off).
      expect(block.formats.Singles!.species.meloettapirouette).toEqual(["closecombat", "relicsong", "return", "knockoff"]);
      expect(block.formats.Singles!.species.nidoking).toContain("icebeam");
      expect(block.formats.Singles!.species.komala).toContain("knockoff");
      expect(entry.manifest.randomBattleSets.formats.Singles.mapping).toEqual({ battleOnly: 12, exact: 573, getForme: 42 });
      // The sets' ability, not Showdown's first slot; a Mega key's sets name its base form's ability, which the Mega lacks.
      expect(block.formats.Singles!.abilities).toMatchObject({ cloyster: "skilllink", haxorus: "moldbreaker", magnezone: "analytic", ditto: "imposter" });
      expect(block.formats.Singles!.abilities.charizardmegax).toBeUndefined();
    }
    if (profile.game === "sword_shield") {
      // Inteleon's two keys (Torrent, and Sniper for Inteleon-Gmax) tie; the earlier slot wins.
      expect(block.formats.Singles!.abilities).toMatchObject({ inteleon: "torrent", scizor: "technician", zygarde: "powerconstruct" });
    }
    if (profile.game === "scarlet_violet") {
      expect(block.formats.Doubles!.species.meloettapirouette).toEqual(["closecombat", "terablast", "relicsong", "psychic"]);
      expect(entry.manifest.randomBattleSets.formats.Doubles.mapping).toEqual({ battleOnly: 14, exact: 504, getForme: 54 });
      // Per format, and a 78/78 tie keeps the earlier slot (Venusaur's Overgrow over Chlorophyll).
      expect(block.formats.Singles!.abilities).toMatchObject({ haxorus: "moldbreaker", venusaur: "overgrow", azumarill: "hugepower" });
      expect(block.formats.Doubles!.abilities).toMatchObject({ haxorus: "unnerve", perrserker: "toughclaws" });
      // A Tera form's sets name the entry form's ability (Ogerpon's Sturdy), which the form lacks.
      expect(block.formats.Singles!.abilities.ogerponcornerstonetera).toBeUndefined();
    }
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
    const rejectedPairs: string[] = [];
    for (const raw of nativeSpecies(entry.source)) {
      // The snapshot keeps pinned getMovePool whole; only USUM's validator withholds moves from it.
      const rejected = raw.learnset.validatorRejected ?? [];
      expect(rejected.every((id) => raw.learnset.movePool.includes(id)), raw.id).toBe(true);
      if (profile.game !== "ultra_sun_ultra_moon") expect(rejected, raw.id).toEqual([]);
      expect(entry.manifest.learnsets.find((row) => row.speciesId === raw.id)?.validatorRejectedMoves ?? [], raw.id).toEqual(rejected);
      rejectedPairs.push(...rejected.map((id) => `${raw.id}:${id}`));
      const expected = raw.learnset.movePool.filter((id) => selectable.has(id) && !rejected.includes(id));
      if (expected.includes("hiddenpower")) expected.push(...hp);
      expect(pokemon(entry, raw.id).moves, raw.id).toEqual(sorted(expected));
    }
    // Every one of these 80 fails pinned validateSet for every one-move set, and the catalog's other
    // USUM pairs fail only set-level checks (audit fix35/review/verify80.ts, fullsweep.ts). Pinning the
    // exact pairs catches a filter that withholds legal moves, or keeps illegal ones.
    if (profile.game !== "ultra_sun_ultra_moon") expect(rejectedPairs).toEqual([]);
    if (profile.game === "ultra_sun_ultra_moon") {
      const perSpecies = Object.fromEntries([...new Set(rejectedPairs.map((pair) => pair.split(":")[0]))].map((id) => [id, rejectedPairs.filter((pair) => pair.startsWith(`${id}:`)).length]));
      expect(perSpecies).toEqual({
        araquanidtotem: 4, greninjaash: 4, greninjabond: 4, gumshoostotem: 3, kommoototem: 2, pikachualola: 7, pikachuhoenn: 7, pikachukalos: 7,
        pikachuoriginal: 7, pikachupartner: 7, pikachusinnoh: 7, pikachuunova: 7, ribombeetotem: 3, salazzletotem: 4, vikavolttotem: 2,
        vivillonfancy: 1, vivillonpokeball: 1, zygarde10: 3,
      });
      expect(createHash("sha256").update(JSON.stringify(rejectedPairs.sort())).digest("hex")).toBe("f2f0240e75793a82f893d785470c486dc044d104a20779a31a3d5970b5f994ec");
      expect(pokemon(entry, "zygarde10").moves).not.toContain("strength");
      expect(pokemon(entry, "zygarde").moves).toContain("strength");
      expect(pokemon(entry, "necrozmaultra").moves).toEqual(expect.arrayContaining(["moongeistbeam", "sunsteelstrike"]));
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

type DexStages = Partial<Record<string, number>>;
type DexMove = {
  id: string; category: string; pp: number; noPPBoosts?: boolean; isZ?: unknown; isMax?: unknown; flags: Record<string, number | undefined>;
  self?: { boosts?: DexStages; chance?: number; volatileStatus?: string; onHit?: unknown }; selfBoost?: { boosts?: DexStages };
  secondaries?: { chance?: number; boosts?: DexStages; self?: { boosts?: DexStages }; status?: string }[] | null;
  onTryMove?: unknown; condition?: DexResidual;
};
type DexResidual = { onResidualOrder?: number; onResidualSubOrder?: number; onFieldResidualOrder?: number; onResidualPriority?: number; duration?: number; durationCallback?: unknown };
type DexHandlers = DexResidual & {
  id: string; boosts?: DexStages; onDamagingHit?: unknown; onAfterMoveSecondary?: unknown; onEat?: unknown; onDamage?: unknown; onWeather?: unknown;
  onResidual?: unknown; isNonstandard?: string | null; onTryBoost?: unknown; onTakeItem?: unknown; flags?: Record<string, number | undefined>;
  zMove?: unknown; megaStone?: unknown;
};
type UsesDex = {
  moves: { get(id: string): DexMove };
  abilities: { all(): DexHandlers[]; get(id: string): DexHandlers };
  items: { all(): DexHandlers[]; get(id: string): DexHandlers };
  conditions: { get(id: string): DexResidual };
  species: { get(id: string): { num: number; name: string } };
};
/** How a pinned onTryBoost handler treats a foe's drop of the combat stats: deletes all, deletes some, turns it back, or none (accuracy, Intimidate alone). */
function guarded(handler: unknown): "all" | string[] | "bounces" | null {
  const text = String(handler);
  if (/Intimidate/.test(text)) return null;
  if (/this\.boost\(/.test(text)) return "bounces";
  if (/for \((const |let )?\w+ in boost\)/.test(text) && /< 0/.test(text)) return "all";
  const stats = ["atk", "def", "spa", "spd", "spe"].filter((stat) => new RegExp(`boost\\.${stat} && boost\\.${stat} < 0`).test(text));
  return stats.length ? stats : null;
}
/** What sets off a hit trigger in its pinned handler: its stages, the move types it names, and the category, contact or effectiveness it checks. */
type Trigger = { stages: DexStages; types: string[]; physical: boolean; special: boolean; contact: boolean; superEffective: boolean };
type UsesFacts = {
  moves: Record<string, Pick<DexMove, "pp" | "noPPBoosts">>;
  stats: Record<string, StatMove>; statuses: Record<string, string>; zStatuses: Record<string, string>; maxStatuses: string[];
  charge: string[]; recharge: string[]; notTwice: string[];
  hitAbilities: Record<string, Trigger>; hitItems: Record<string, Trigger>; residuals: Record<string, DexResidual>; residualHandlers: string[];
  /** Every ability and item with an onResidual handler. */
  endOfTurn: { abilities: string[]; items: string[] };
  /** How long a weather or terrain a move or ability sets lasts, and the item that extends it. */
  durations: Record<string, { turns?: number; extendedBy?: string }>;
  /** Every ability and item with an onTryBoost handler and what it does to a foe's drop; the breakable flag of the abilities boost() reads. */
  guards: { abilities: Record<string, ReturnType<typeof guarded>>; items: Record<string, ReturnType<typeof guarded>>; breakable: Record<string, boolean> };
  /** The hit items acting after the whole move (onAfterMoveSecondary, which Sheer Force skips). */
  afterMove: string[];
  /** Every catalog item with an onTakeItem handler: never taken, a Mega Stone's, Booster Energy's, or the Pokédex numbers and names it reads and whether it reads the taker. */
  takeItems: Record<string, "never" | "mega" | "paradox" | { names: (number | string)[]; taker: boolean }>;
  /** The Pokédex number and name of each family OWNED_ITEMS names. */
  families: Record<string, (number | string)[]>;
};

const TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];
/** Stage changes without accuracy and evasion (every use is assumed to hit), or undefined. */
function combatStages(stages: DexStages | undefined): DexStages | undefined {
  const kept = Object.entries(stages ?? {}).filter(([stat]) => stat !== "accuracy" && stat !== "evasion");
  return kept.length ? Object.fromEntries(kept) : undefined;
}
/** The first this.boost({ ... }) literal in a pinned handler's compiled source, or undefined. */
function boostLiteral(handler: unknown): DexStages | undefined {
  const literal = /boost\(\s*\{([^}]*)\}/.exec(String(handler))?.[1];
  return literal ? Object.fromEntries([...literal.matchAll(/(\w+):\s*(-?\d+)/g)].map(([, stat, amount]) => [stat, Number(amount)])) : undefined;
}
function trigger(handler: unknown, stages: DexStages): Trigger {
  const text = String(handler);
  return {
    stages, types: TYPES.filter((type) => text.includes(`'${type}'`)), physical: text.includes("'Physical'"), special: text.includes("'Special'"),
    contact: text.includes("checkMoveMakesContact"), superEffective: text.includes("typeMod > 0"),
  };
}
/** What the app's `when` accepts, in a Trigger's terms (its third argument is contact or super effectiveness). */
function accepted(when: (type: string, physical: boolean, flag: boolean) => boolean, flag: "contact" | "superEffective") {
  const types = TYPES.filter((type) => when(type, true, true) || when(type, false, true));
  const needsFlag = !TYPES.some((type) => when(type, true, false) || when(type, false, false));
  return {
    types: types.length === TYPES.length ? [] : types, physical: !TYPES.some((type) => when(type, false, true)), special: !TYPES.some((type) => when(type, true, true)),
    contact: flag === "contact" && needsFlag, superEffective: flag === "superEffective" && needsFlag,
  };
}

describe("Uses to KO tables against the pinned Dex", () => {
  const facts = {} as Record<NativeGame, UsesFacts>;
  beforeAll(async () => {
    await withVerifiedSources(async ({ runtime }) => {
      const { Dex } = loadModule(join(runtime, "sim/dex.js")) as { Dex: { mod(name: string): UsesDex } };
      for (const profile of NATIVE_GAMES) {
        // Everything is read here: Dex loads its data lazily, and the compiled runtime is removed afterwards.
        const dex = Dex.mod(profile.mod);
        const fact: UsesFacts = {
          moves: {}, stats: {}, statuses: {}, zStatuses: {}, maxStatuses: [], charge: [], recharge: [], notTwice: [],
          hitAbilities: {}, hitItems: {}, residuals: {}, residualHandlers: [], endOfTurn: { abilities: [], items: [] }, durations: {},
          guards: { abilities: {}, items: {}, breakable: {} }, afterMove: [], takeItems: {}, families: {},
        };
        for (const row of data(profile.game).catalog.moves) {
          const dexMove = dex.moves.get(row.id);
          fact.moves[row.id] = { pp: dexMove.pp, ...(dexMove.noPPBoosts ? { noPPBoosts: true } : {}) };
          if (dexMove.category === "Status") continue;
          const sure = (dexMove.secondaries ?? []).filter((secondary) => secondary.chance === undefined || secondary.chance === 100);
          const status = sure.find((secondary) => secondary.status)?.status;
          if (dexMove.isZ) {
            if (status) fact.zStatuses[row.id] = status;
            continue;
          }
          if (dexMove.isMax) {
            const onHit = String(dexMove.self?.onHit);
            if (/trySetStatus\('psn'/.test(onHit) && !/random/.test(onHit)) fact.maxStatuses.push(row.id);
            continue;
          }
          const stat = Object.fromEntries(Object.entries({
            self: combatStages(dexMove.self && !dexMove.self.chance ? dexMove.self.boosts : dexMove.selfBoost?.boosts),
            userSecondary: combatStages(sure.find((secondary) => secondary.self?.boosts)?.self?.boosts),
            target: combatStages(sure.find((secondary) => secondary.boosts)?.boosts),
            preHit: dexMove.flags.charge ? boostLiteral(dexMove.onTryMove) : undefined,
          }).filter(([, stages]) => stages)) as StatMove;
          if (Object.keys(stat).length) fact.stats[row.id] = stat;
          if (status) fact.statuses[row.id] = status;
          if (dexMove.flags.charge) fact.charge.push(row.id);
          if (dexMove.self?.volatileStatus === "mustrecharge") fact.recharge.push(row.id);
          if (dexMove.flags.cantusetwice) fact.notTwice.push(row.id);
        }
        for (const ability of dex.abilities.all()) {
          const stages = /boost\(/.test(String(ability.onDamagingHit)) ? boostLiteral(ability.onDamagingHit) : undefined;
          if (stages) fact.hitAbilities[ability.id] = trigger(ability.onDamagingHit, stages);
        }
        for (const dexItem of dex.items.all()) {
          const handler = dexItem.onDamagingHit ?? dexItem.onAfterMoveSecondary;
          const stages = handler && /useItem|eatItem/.test(String(handler)) ? dexItem.boosts ?? boostLiteral(dexItem.onEat) : undefined;
          if (stages) fact.hitItems[dexItem.id] = trigger(handler, stages);
          if (stages && dexItem.onAfterMoveSecondary) fact.afterMove.push(dexItem.id);
        }
        for (const entry of dex.abilities.all()) if (entry.onTryBoost && !entry.isNonstandard) fact.guards.abilities[entry.id] = guarded(entry.onTryBoost);
        for (const entry of dex.items.all()) if (entry.onTryBoost && !entry.isNonstandard) fact.guards.items[entry.id] = guarded(entry.onTryBoost);
        for (const id of ["contrary", "simple", "mirrorarmor", ...Object.keys(STAT_GUARDS)]) fact.guards.breakable[id] = !!dex.abilities.get(id).flags?.breakable;
        for (const row of data(profile.game).catalog.items) {
          const { onTakeItem, zMove, megaStone } = dex.items.get(row.id);
          if (onTakeItem === undefined) continue;
          const text = String(onTakeItem);
          fact.takeItems[row.id] = onTakeItem === false && zMove ? "never" : megaStone && /megaStone/.test(text) ? "mega" : /Paradox/.test(text) ? "paradox" : {
            names: [...[...text.matchAll(/num === (-?\d+)/g)].map(([, num]) => Number(num)), ...[...text.matchAll(/baseSpecies === '(\w+)'/g)].map(([, name]) => name)],
            taker: /^\w*\s*\(\s*item,\s*pokemon,\s*source\s*\)/.test(text),
          };
        }
        for (const [family] of Object.values(OWNED_ITEMS)) fact.families[family] = [dex.species.get(family).num, dex.species.get(family).name];
        const residual = ({ onResidualOrder, onResidualSubOrder, onFieldResidualOrder, onResidualPriority }: DexResidual) =>
          Object.fromEntries(Object.entries({ onResidualOrder, onResidualSubOrder, onFieldResidualOrder, onResidualPriority }).filter(([, value]) => value !== undefined));
        for (const id of ["leftovers", "blacksludge", "stickybarb", "flameorb", "toxicorb"]) fact.residuals[id] = residual(dex.items.get(id));
        for (const id of ["speedboost", "slowstart", "hydration", "shedskin", "baddreams", "powerconstruct"]) fact.residuals[id] = residual(dex.abilities.get(id));
        const handled = (entry: DexHandlers) => !!entry.onResidual && !entry.isNonstandard;
        fact.endOfTurn = { abilities: dex.abilities.all().filter(handled).map(({ id }) => id).sort(), items: dex.items.all().filter(handled).map(({ id }) => id).sort() };
        for (const id of ["sunnyday", "raindance", "sandstorm", "hail", "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain"]) {
          const { duration, durationCallback } = dex.conditions.get(id);
          fact.durations[id] = { turns: duration, extendedBy: /hasItem\(["'](\w+)["']\)/.exec(String(durationCallback))?.[1] };
        }
        for (const id of ["sandstorm", "hail", "snowscape", "grassyterrain", "psn", "tox", "brn", "dynamax"]) fact.residuals[id] = residual(dex.conditions.get(id));
        fact.residuals.saltcure = residual(dex.moves.get("saltcure").condition!);
        fact.residualHandlers = [
          ...["raindish", "dryskin", "icebody", "solarpower"].filter((id) => dex.abilities.get(id).onWeather).map((id) => `${id} onWeather`),
          ...(dex.abilities.get("poisonheal").onDamage ? ["poisonheal onDamage"] : []),
        ];
        facts[profile.game] = fact;
      }
    });
  }, 120_000);

  it.each(NATIVE_GAMES)("carries the pinned base PP and noPPBoosts of every $game move", (profile) => {
    const entry = data(profile.game);
    expect(Object.fromEntries(entry.catalog.moves.map((row) => [row.id, { pp: row.pp, ...(row.noPPBoosts ? { noPPBoosts: true } : {}) }])))
      .toEqual(facts[profile.game].moves);
    expect(["dracometeor", "earthquake", "flamethrower", "struggle"].map((id) => [move(entry, id).pp, move(entry, id).noPPBoosts]))
      .toEqual([[5, undefined], [10, undefined], [15, undefined], [1, true]]);
    // The simulator itself gives Trump Card no PP Ups (sim/pokemon.ts); its data has no noPPBoosts.
    if (profile.game === "ultra_sun_ultra_moon") expect([move(entry, "trumpcard").pp, move(entry, "trumpcard").noPPBoosts]).toEqual([5, undefined]);
    if (profile.gen !== 8) expect(move(entry, "sketch")).toMatchObject({ pp: 1, noPPBoosts: true });
  });

  it("carries Champions PP from its mod: base PP capped at 20, and the mod's own changes", async () => {
    // data:champions -- --check rebuilds these from the pinned Champions mod, whose Scripts.init caps base PP at 20.
    const champions = JSON.parse(await readFile(join(ROOT, "data/champions/catalog.json"), "utf8")) as { moves: { id: string; pp?: number; noPPBoosts?: true }[] };
    const pp = Object.fromEntries(champions.moves.map((row) => [row.id, row.pp]));
    expect(champions.moves.every((row) => row.pp !== undefined && row.pp <= 20)).toBe(true);
    expect(["quickattack", "bite", "protect", "nightslash", "dracometeor", "flamethrower"].map((id) => pp[id])).toEqual([20, 20, 5, 20, 5, 15]);
    expect(champions.moves.find((row) => row.id === "revivalblessing")).toMatchObject({ pp: 1, noPPBoosts: true });
  });

  it.each(NATIVE_GAMES)("lists every damaging $game move whose every use changes a stat", (profile) => {
    const table = Object.fromEntries(data(profile.game).catalog.moves.flatMap((row) => {
      const entry = statMove(row.id, profile.game);
      if (!entry || row.isZ || row.isMax) return [];
      const { self, userSecondary, target, preHit } = entry;
      return [[row.id, Object.fromEntries(Object.entries({ self, userSecondary, target, preHit }).filter(([, stages]) => stages))]];
    }));
    expect(table).toEqual(facts[profile.game].stats);
  });

  it("keeps no stat move that no native game has (Make It Rain's Champions -2 is checked in a Champions battle)", () => {
    expect(Object.keys(STAT_MOVES).filter((id) => !NATIVE_GAMES.some(({ game }) => facts[game].stats[id]))).toEqual([]);
  });

  it.each(NATIVE_GAMES)("lists every $game move that gives a status every use, charges, recharges or cannot be used twice", (profile) => {
    const fact = facts[profile.game];
    const ids = new Set(data(profile.game).catalog.moves.map((row) => row.id));
    const inGame = (table: Iterable<string>) => [...table].filter((id) => ids.has(id)).sort();
    expect(Object.fromEntries(inGame(Object.keys(STATUS_MOVES)).map((id) => [id, STATUS_MOVES[id].status])))
      .toEqual({ ...fact.statuses, ...fact.zStatuses, ...Object.fromEntries(fact.maxStatuses.map((id) => [id, "psn"])) });
    expect(inGame(Object.keys(STATUS_MOVES)).filter((id) => !STATUS_MOVES[id].secondary)).toEqual(fact.maxStatuses);
    expect(inGame(CHARGE_MOVES)).toEqual(fact.charge.sort());
    expect(inGame(RECHARGE_MOVES)).toEqual(fact.recharge.sort());
    expect(inGame(NOT_TWICE_MOVES)).toEqual(fact.notTwice.sort());
  });

  it.each(NATIVE_GAMES)("triggers the $game abilities and items a hit sets off as their pinned handlers do", (profile) => {
    const fact = facts[profile.game];
    // Gulp Missile's boost needs Cramorant's gulping form, which no calculated row has.
    const { gulpmissile, ...abilities } = fact.hitAbilities;
    expect(gulpmissile).toBeDefined();
    expect(Object.fromEntries(Object.entries(HIT_ABILITIES).map(([id, entry]) => [id, { stages: entry.stages, ...accepted(entry.when, "contact") }])))
      .toEqual(Object.fromEntries(Object.entries(abilities).map(([id, found]) => [id, { ...found, superEffective: false }])));
    expect(Object.fromEntries(Object.entries(HIT_ITEMS).map(([id, entry]) => [id, { stages: entry.stages, ...accepted(entry.when, "superEffective") }])))
      .toEqual(Object.fromEntries(Object.entries(fact.hitItems).map(([id, found]) => [id, { ...found, contact: false }])));
  });

  it.each(NATIVE_GAMES)("ends each $game turn in the residual order the search follows", (profile) => {
    expect(facts[profile.game].residuals).toEqual({
      sandstorm: { onFieldResidualOrder: 1 }, hail: { onFieldResidualOrder: 1 }, snowscape: { onFieldResidualOrder: 1 },
      grassyterrain: { onResidualOrder: 5, onResidualSubOrder: 2, onFieldResidualOrder: 27 },
      leftovers: { onResidualOrder: 5, onResidualSubOrder: 4 }, blacksludge: { onResidualOrder: 5, onResidualSubOrder: 4 },
      psn: { onResidualOrder: 9 }, tox: { onResidualOrder: 9 }, brn: { onResidualOrder: 10 }, saltcure: { onResidualOrder: 13 },
      speedboost: { onResidualOrder: 28, onResidualSubOrder: 2 }, slowstart: { onResidualOrder: 28, onResidualSubOrder: 2 },
      stickybarb: { onResidualOrder: 28, onResidualSubOrder: 3 }, flameorb: { onResidualOrder: 28, onResidualSubOrder: 3 },
      toxicorb: { onResidualOrder: 28, onResidualSubOrder: 3 }, dynamax: { onResidualPriority: -100 },
      // Hydration cures a status at 5.3, before poison and burn (Shed Skin's random cure there is not estimated);
      // Bad Dreams damages at 28.2, before Sticky Barb; Power Construct changes the form at 29.
      hydration: { onResidualOrder: 5, onResidualSubOrder: 3 }, shedskin: { onResidualOrder: 5, onResidualSubOrder: 3 },
      baddreams: { onResidualOrder: 28, onResidualSubOrder: 2 }, powerconstruct: { onResidualOrder: 29 },
    });
    expect(facts[profile.game].residualHandlers).toEqual(["raindish onWeather", "dryskin onWeather", "icebody onWeather", "solarpower onWeather", "poisonheal onDamage"]);
  });

  it.each(NATIVE_GAMES)("accounts for every $game ability and item that acts at the end of a turn", (profile) => {
    // Followed by the count: Bad Dreams, Hydration, Opportunist (it copies a rise at once), the forms that follow
    // HP, Slow Start, Speed Boost, and the items in the residual order above (White Herb and Mirror Herb act
    // after the move). Not estimated: Cud Chew, Harvest, Moody, Power Construct, Shed Skin. Left out, as no
    // count here reads them: Healer (a partner's status), Hunger Switch (Aura Wheel alone, not estimated),
    // Pickup (an item the attacker used that turn), Eject Pack (a switch) and Micle Berry (accuracy).
    const abilities = ["baddreams", "harvest", "healer", "hydration", "moody", "pickup", "powerconstruct", "schooling", "shedskin", "shieldsdown", "slowstart", "speedboost", "zenmode",
      ...(profile.gen >= 8 ? ["hungerswitch"] : []), ...(profile.gen >= 9 ? ["cudchew", "opportunist"] : [])];
    const items = ["blacksludge", "flameorb", "leftovers", "micleberry", "stickybarb", "toxicorb", "whiteherb", ...(profile.gen >= 8 ? ["ejectpack"] : []), ...(profile.gen >= 9 ? ["mirrorherb"] : [])];
    expect(facts[profile.game].endOfTurn).toEqual({ abilities: abilities.sort(), items: items.sort() });
  });

  it.each(NATIVE_GAMES)("blocks a foe's drops in $game with the abilities and items whose pinned onTryBoost deletes them", (profile) => {
    // Accuracy guards (Keen Eye, Mind's Eye, Illuminate) and the Intimidate-only ones change no damage; Mirror
    // Armor turns the drop back on the foe (boost()); Flower Veil guards Grass-type allies only (not modelled).
    const { abilities, items, breakable } = facts[profile.game].guards;
    expect(Object.fromEntries(Object.entries(abilities).filter(([, kind]) => kind))).toEqual({ ...STAT_GUARDS, ...(profile.gen >= 8 ? { mirrorarmor: "bounces" } : {}) });
    expect(items).toEqual(profile.gen >= 9 ? { clearamulet: "all" } : {});
    expect(Object.keys(breakable).filter((id) => !breakable[id])).toEqual([...UNBREAKABLE]);
  });

  it.each(NATIVE_GAMES)("skips the $game items acting after the whole move under Sheer Force, and takes only the items pinned Showdown lets go", (profile) => {
    const fact = facts[profile.game];
    // Kee and Maranga Berry act in AfterMoveSecondary, which Sheer Force skips; the others in DamagingHit.
    expect(Object.keys(HIT_ITEMS).filter((id) => HIT_ITEMS[id].berry).sort()).toEqual(fact.afterMove.filter((id) => HIT_ITEMS[id]).sort());
    // uses-to-ko.ts takeable(): Z-Crystals never, Mega Stones from their family, Booster Energy from a Paradox
    // Pokémon, and OWNED_ITEMS from (and, where the handler reads it, to) the family whose number or name it names.
    const entry = data(profile.game);
    const owner = (id: string) => itemOwner(id, profile.game);
    const app = Object.fromEntries(entry.catalog.items.filter((row) => row.zMoveType || row.zMove || row.megaTargets.length || row.id === "boosterenergy" || owner(row.id))
      .map((row) => [row.id, row.zMoveType || row.zMove ? "never" : row.megaTargets.length ? "mega" : row.id === "boosterenergy" ? "paradox"
        : { names: fact.families[owner(row.id)![0]], taker: owner(row.id)![1] }]));
    const pinned = Object.fromEntries(Object.entries(fact.takeItems).map(([id, kind]) => {
      if (typeof kind === "string") return [id, kind];
      const family = owner(id) && fact.families[owner(id)![0]];
      return [id, { names: family && kind.names.length && kind.names.every((name) => family.includes(name)) ? family : kind.names, taker: kind.taker }];
    }));
    expect(app).toEqual(pinned);
  });

  it.each(NATIVE_GAMES)("lasts a weather or terrain a use sets for the $game turns and items the search counts", (profile) => {
    // uses-to-ko.ts fieldTurns: 5 turns, 8 with the setter's rock or Terrain Extender.
    expect(facts[profile.game].durations).toEqual({
      sunnyday: { turns: 5, extendedBy: "heatrock" }, raindance: { turns: 5, extendedBy: "damprock" }, sandstorm: { turns: 5, extendedBy: "smoothrock" },
      hail: { turns: 5, extendedBy: "icyrock" }, electricterrain: { turns: 5, extendedBy: "terrainextender" }, grassyterrain: { turns: 5, extendedBy: "terrainextender" },
      mistyterrain: { turns: 5, extendedBy: "terrainextender" }, psychicterrain: { turns: 5, extendedBy: "terrainextender" },
    });
  });
});
