import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Generations, Move } from "@smogon/calc";
import {
  CACHE,
  CALC_SOURCE,
  ROOT,
  SHOWDOWN_SOURCE,
  ensureSource,
} from "./lib/champions-data/sources.mjs";
import {
  availableSpecies,
  isAvailable,
  transformChampionsCatalog,
  type AvailableData,
  type EngineSnapshot,
  type LearnsetSource,
  type ResolvedAbility,
  type ResolvedItem,
  type ResolvedLearnset,
  type ResolvedMove,
  type ResolvedSpecies,
  type ShowdownSnapshot,
} from "./lib/champions-data/transform";

const loadModule = createRequire(import.meta.url);
const OUTPUT = join(ROOT, "data/champions");
const compact = (value: unknown) => `${JSON.stringify(value)}\n`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type DexSpecies = Omit<ResolvedSpecies, "learnset">;
type DexMove = Omit<ResolvedMove, "description">;
type DexAbility = Omit<ResolvedAbility, "description">;
type DexItem = Omit<ResolvedItem, "description">;
type RawLearnset = { inherit?: boolean; learnset?: Record<string, string[]> } | null;
type DexAPI = {
  gen: number;
  currentMod: string;
  parentMod: string;
  mod(name: string): DexAPI;
  species: {
    all(): DexSpecies[];
    getFullLearnset(id: string): { species: DexSpecies; learnset: Record<string, string[]> }[];
    getMovePool(id: string): Set<string>;
  };
  moves: { all(): DexMove[] };
  abilities: { all(): DexAbility[] };
  items: { all(): DexItem[] };
  text: { get(row: AvailableData): { desc?: string; shortDesc?: string } };
};

/**
 * Node does not transpile TS beneath node_modules. Compile only Dex's data-loading
 * graph to a separate, disposable cache tree, retaining relative require paths.
 * Never alter either verified extraction, vendor simulator TS into app/, or ship
 * this build-time runtime. No server/simulator dependencies or install are needed.
 */
async function compileShowdownDex(source: string): Promise<string> {
  const output = join(CACHE, `showdown-dex-${SHOWDOWN_SOURCE.revision}`);
  const files = ["lib/utils.ts", "config/formats.ts"];
  for (const directory of ["sim", "data", "data/text", "data/mods/champions"]) {
    const names = await readdir(join(source, directory));
    for (const name of names.sort()) {
      if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
      if (directory === "sim" && !/^dex(?:-.*)?\.ts$/.test(name)) continue;
      files.push(`${directory}/${name}`);
    }
  }
  await mkdir(output, { recursive: true });
  // Dex.includeMods discovers directory names before loading the global formats
  // list. Preserve that discovery without compiling/loading unrelated mods.
  for (const entry of await readdir(join(source, "data/mods"), { withFileTypes: true })) {
    if (entry.isDirectory()) await mkdir(join(output, "data/mods", entry.name), { recursive: true });
  }
  await writeFile(join(output, "package.json"), '{"type":"commonjs"}\n');
  for (const file of files.sort()) {
    const code = await readFile(join(source, file), "utf8");
    const result = ts.transpileModule(code, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        sourceMap: false,
        removeComments: true,
      },
    });
    const destination = join(output, file.replace(/\.ts$/, ".js"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, result.outputText);
  }
  // A second build in the same process must capture unmerged declarations again.
  for (const path of Object.keys(loadModule.cache)) {
    if (path.startsWith(`${output}${sep}`)) delete loadModule.cache[path];
  }
  return output;
}

export async function loadChampionsSnapshot(source: string): Promise<ShowdownSnapshot> {
  const runtime = await compileShowdownDex(source);
  const raw = loadModule(join(runtime, "data/mods/champions/learnsets.js")) as {
    Learnsets: Record<string, RawLearnset>;
  };
  // Dex.loadData appends base-game entries into this same object. Snapshot the
  // declaration and its exact move markers BEFORE calling Dex.mod('champions').
  const declarations = JSON.parse(JSON.stringify(raw.Learnsets)) as Record<string, RawLearnset>;
  const { Dex } = loadModule(join(runtime, "sim/dex.js")) as { Dex: DexAPI };
  const dex = Dex.mod("champions");
  if (dex.currentMod !== "champions" || dex.gen !== 9 || dex.parentMod !== "base") {
    throw new Error("Pinned Champions mod ancestry changed; review learnset provenance before regenerating.");
  }
  const describe = (row: AvailableData) => {
    const text = dex.text.get(row);
    return text.desc || text.shortDesc || "";
  };
  const species = dex.species.all().map((row): ResolvedSpecies => {
    let learnset: ResolvedLearnset = { movePool: [], sources: [] };
    if (isAvailable(row)) {
      try {
        const lineage = dex.species.getFullLearnset(row.id);
        const sources = lineage.map((entry): LearnsetSource => {
          const declared = declarations[entry.species.id];
          const origin = declared?.learnset ? "champions" : declared?.inherit ? "explicit-inherit" : "unproven";
          if (declared?.learnset && JSON.stringify(declared.learnset) !== JSON.stringify(entry.learnset)) {
            throw new Error(`Resolved learnset differs from its Champions declaration: ${entry.species.id}`);
          }
          return { speciesId: entry.species.id, origin, learnset: entry.learnset };
        });
        learnset = { movePool: [...dex.species.getMovePool(row.id)], sources };
      } catch (error) {
        learnset.error = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      id: row.id,
      name: row.name,
      exists: row.exists,
      isNonstandard: row.isNonstandard,
      baseSpecies: row.baseSpecies,
      types: row.types,
      baseStats: row.baseStats,
      weightkg: row.weightkg,
      abilities: row.abilities,
      battleOnly: row.battleOnly,
      changesFrom: row.changesFrom,
      isMega: row.isMega,
      requiredItem: row.requiredItem,
      requiredItems: row.requiredItems,
      learnset,
    };
  });
  return {
    species,
    moves: dex.moves.all().map((row) => ({
      id: row.id, name: row.name, exists: row.exists, isNonstandard: row.isNonstandard,
      type: row.type, category: row.category, basePower: row.basePower,
      accuracy: row.accuracy, priority: row.priority, target: row.target,
      multihit: row.multihit, ohko: row.ohko, description: describe(row),
    })),
    abilities: dex.abilities.all().map((row) => ({
      id: row.id, name: row.name, exists: row.exists, isNonstandard: row.isNonstandard,
      description: describe(row),
    })),
    items: dex.items.all().map((row) => ({
      id: row.id, name: row.name, exists: row.exists, isNonstandard: row.isNonstandard,
      megaStone: row.megaStone, description: describe(row),
    })),
  };
}

export async function buildChampionsData(check = false): Promise<void> {
  const [showdownSource, calcSource] = await Promise.all([
    ensureSource(SHOWDOWN_SOURCE), ensureSource(CALC_SOURCE),
  ]);
  const engineProvenance = JSON.parse(await readFile(loadModule.resolve("@smogon/calc/PROVENANCE.json"), "utf8")) as {
    revision: string; sourceArchiveSha256: string; version: string;
  };
  if (engineProvenance.revision !== CALC_SOURCE.revision || engineProvenance.sourceArchiveSha256 !== CALC_SOURCE.sha256) {
    throw new Error("Installed calculation engine does not match the pinned Champions source.");
  }
  const generation = Generations.get(0);
  const engine: EngineSnapshot = {
    num: generation.num,
    species: [...generation.species],
    // Gen 0's raw data omits category on many statuses; the engine Move
    // constructor supplies Status. Compare its real API semantics, not absence.
    moves: [...generation.moves].map((move) => ({
      ...move, category: new Move(generation, move.name).category,
    })),
    abilities: [...generation.abilities],
    items: [...generation.items],
  };
  // A published 0.11.0 or an empty generation 0 must never silently pass coverage.
  if (!engine.species.some((row) => row.id === "venusaur") || !engine.moves.some((row) => row.id === "protect")) {
    throw new Error("The installed engine has no Champions data. Build/install the pinned local engine first.");
  }
  const snapshot = await loadChampionsSnapshot(showdownSource);
  const catalog = transformChampionsCatalog(snapshot, engine, {
    engine: { revision: CALC_SOURCE.revision, url: `https://github.com/smogon/damage-calc/tree/${CALC_SOURCE.revision}/calc` },
    showdown: { revision: SHOWDOWN_SOURCE.revision, url: `https://github.com/smogon/pokemon-showdown/tree/${SHOWDOWN_SOURCE.revision}/data/mods/champions` },
  });
  const catalogJSON = compact(catalog);
  const manifest = {
    version: 1,
    game: "champions",
    rebuild: "npm run data:champions",
    verify: "npm run data:champions -- --check",
    catalogSha256: sha256(catalogJSON),
    sources: {
      engine: { ...catalog.sources.engine, archiveSha256: CALC_SOURCE.sha256, packageVersion: engineProvenance.version, license: "LICENSE.damage-calc.txt" },
      showdown: { ...catalog.sources.showdown, archiveSha256: SHOWDOWN_SOURCE.sha256, license: "LICENSE.pokemon-showdown.txt" },
    },
    identity: {
      ids: "Showdown toID: lowercase ASCII alphanumerics, no PokeAPI identity inference.",
      species: "name is the resolved Showdown name; calcName is the exact engine name when present. Aegislash maps explicitly to Aegislash-Shield; all other species use exact IDs, not guessed base forms. Stats, types and weight are the resolved Showdown values.",
      baseSpecies: "Taxonomic Showdown baseSpecies ID, not changesFrom or a guaranteed available catalog row. Floette-Mega has baseSpecies=floette but inherits from floetteeternal.",
      references: "Species abilities/moves/requiredItem and item megaStone/megaEvolves/megaTargets use IDs. Scalar Mega fields are null for multi-target stones; megaTargets preserves all pairs.",
    },
    availability: "Resolved Champions isNonstandard flags plus battleOnly entry-form availability. Competitive rankings are not game availability. Only abilities assigned to available species are offered.",
    learnsetPolicy: "Run pinned Dex.mod('champions').species.getFullLearnset/getMovePool, then require explicit Champions declaration/inherit provenance for every contributing table. Source markers such as 9M alone are insufficient. Missing proof is reported, never replaced by a Gen 9 movepool.",
    coverage: { ...catalog.coverage, abilities: catalog.abilities.length, items: catalog.items.length },
    learnsets: availableSpecies(snapshot.species).map((row) => ({
      speciesId: row.id,
      sources: row.learnset.sources.map((entry) => ({ speciesId: entry.speciesId, origin: entry.origin })),
      resolvedMoves: row.learnset.movePool.length,
      emittedMoves: catalog.species.find((species) => species.id === row.id)!.moves.length,
      ...(row.learnset.error ? { error: row.learnset.error } : {}),
    })),
  };
  const output = new Map([
    ["catalog.json", catalogJSON],
    ["manifest.json", compact(manifest)],
    ["LICENSE.pokemon-showdown.txt", await readFile(join(showdownSource, "LICENSE"), "utf8")],
    ["LICENSE.damage-calc.txt", await readFile(join(calcSource, "calc/LICENSE"), "utf8")],
  ]);
  if (!check) await mkdir(OUTPUT, { recursive: true });
  for (const [name, contents] of output) {
    const path = join(OUTPUT, name);
    if (check) {
      if (await readFile(path, "utf8") !== contents) throw new Error(`${name} is stale; run npm run data:champions.`);
    } else {
      await writeFile(path, contents);
    }
  }
  console.log(`${check ? "Verified" : "Generated"} Champions catalog: ${catalog.species.length} species, ${catalog.moves.length} moves, ${catalog.abilities.length} abilities, ${catalog.items.length} items.`);
  console.log(`Coverage gaps: ${catalog.coverage.unsupportedSpecies} species, ${catalog.coverage.unsupportedMoves} moves. See catalog coverage and per-entry unsupported reasons.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: tsx scripts/build-champions-data.ts [--check]");
  buildChampionsData(args.includes("--check")).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
