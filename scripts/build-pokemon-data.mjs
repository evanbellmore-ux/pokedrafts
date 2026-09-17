#!/usr/bin/env node
// Builds the Pokémon dataset (docs/release-architecture.md section 13):
//
//   node scripts/build-pokemon-data.mjs [--refresh-serebii] [--write-fixture DIR]
//
// Reads the PokéAPI crawl cached under POKEAPI_CACHE_DIR (default
// scripts/.cache/pokeapi/), fetching whatever is missing with a descriptive
// User-Agent, at most 6 requests in flight and retry with backoff; reads the
// Serebii Champions regulation pages from scripts/.cache/serebii/ (or the
// committed data/pokemon/sources/*.json, or the network with
// --refresh-serebii); applies data/pokemon/overrides.json; then writes
//
//   data/pokemon/pokemon.json       the dataset rows (13.4), sorted by species then id
//   data/pokemon/regulations.json   the presets with the Champions rosters filled in
//   data/pokemon/report.json        counts, skipped varieties, unmapped names
//   data/pokemon/sources/*.json     the parsed Serebii rows
//
// Exit 1 on an unmapped roster name, an unknown icon suffix, a Reg A/B/C
// range-versus-tag disagreement, a duplicate display name, or per-kind row
// counts outside 5% of the expected sizes. --write-fixture DIR writes the
// stripped unit-test fixture (tests/fixtures/pokeapi/) instead of the data
// files. The pure logic lives in scripts/lib/pokemon-data/.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDataset } from "./lib/pokemon-data/build.mjs";
import { buildCatalog } from "./lib/pokemon-data/catalog.mjs";
import {
  MAX_IN_FLIGHT,
  createJsonFetcher,
  createTextFetcher,
  mapLimit,
} from "./lib/pokemon-data/fetch.mjs";
import { selectFixture } from "./lib/pokemon-data/fixture.mjs";
import { SEREBII_REGULATIONS, parseSerebiiPage } from "./lib/pokemon-data/serebii.mjs";
import { STRIPPERS, cacheFileName } from "./lib/pokemon-data/strip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://pokeapi.co/api/v2";
const DATA_DIR = path.join(ROOT, "data", "pokemon");
const SOURCES_DIR = path.join(DATA_DIR, "sources");
const SEREBII_CACHE_DIR = path.join(ROOT, "scripts", ".cache", "serebii");
const DEFAULT_CACHE_DIR = path.join(ROOT, "scripts", ".cache", "pokeapi");
const DEFAULT_SPECIES_MAX = 1025;

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { refreshSerebii: false, writeFixture: /** @type {string | null} */ (null), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--refresh-serebii") {
      options.refreshSerebii = true;
    } else if (arg === "--write-fixture") {
      const dir = argv[index + 1];
      if (!dir) {
        throw new Error("--write-fixture needs a directory.");
      }
      options.writeFixture = path.resolve(ROOT, dir);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }
  return options;
}

/** @param {string} message */
function log(message) {
  console.log(message);
}

/**
 * Raw PokéAPI responses on disk, fetched on a miss.
 */
class RawCache {
  /**
   * @param {string} dir
   * @param {(url: string) => Promise<any>} fetchJson
   */
  constructor(dir, fetchJson) {
    this.dir = dir;
    this.fetchJson = fetchJson;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {keyof typeof import("./lib/pokemon-data/strip.mjs").CACHE_KINDS} kind
   * @param {string | number} key
   * @returns {Promise<any>}
   */
  async get(kind, key) {
    const file = path.join(this.dir, kind, `${key}.json`);
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      this.hits += 1;
      return raw;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    const raw = await this.fetchJson(`${API}/${kind}/${key}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(raw), "utf8");
    this.misses += 1;
    return raw;
  }
}

/**
 * Crawls species 1..max and everything they reference, and returns the
 * stripped catalog.
 *
 * @param {RawCache} cache
 * @param {number} speciesMax
 */
async function loadCatalog(cache, speciesMax) {
  /**
   * @template T
   * @param {keyof typeof import("./lib/pokemon-data/strip.mjs").CACHE_KINDS} kind
   * @param {Array<string | number>} keys
   * @returns {Promise<T[]>}
   */
  const load = async (kind, keys) => {
    let done = 0;
    const strip = STRIPPERS[kind];
    const records = await mapLimit(keys, MAX_IN_FLIGHT, async (key) => {
      const stripped = strip(await cache.get(kind, key));
      done += 1;
      if (done % 250 === 0) {
        log(`  ${kind}: ${done}/${keys.length}`);
      }
      return stripped;
    });
    log(`  ${kind}: ${records.length} records`);
    return /** @type {T[]} */ (records);
  };
  /** @param {Iterable<string>} values */
  const unique = (values) => [...new Set(values)].sort();

  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedSpecies[]} */
  const species = await load(
    "pokemon-species",
    Array.from({ length: speciesMax }, (_, index) => index + 1)
  );
  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedPokemon[]} */
  const pokemon = await load(
    "pokemon",
    unique(species.flatMap((entry) => entry.varieties.map((variety) => variety.pokemon.name)))
  );
  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedForm[]} */
  const forms = await load(
    "pokemon-form",
    unique(pokemon.flatMap((entry) => entry.forms.map((form) => form.name)))
  );
  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedGeneration[]} */
  const generations = await load(
    "generation",
    unique(species.map((entry) => entry.generation.name).filter(Boolean))
  );
  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedVersionGroup[]} */
  const versionGroups = await load(
    "version-group",
    unique(generations.flatMap((entry) => entry.version_groups))
  );
  /** @type {import("./lib/pokemon-data/strip.mjs").StrippedPokedex[]} */
  const pokedexes = await load(
    "pokedex",
    unique(species.flatMap((entry) => entry.pokedex_numbers.map((number) => number.pokedex.name)))
  );
  return buildCatalog({ species, pokemon, forms, pokedexes, versionGroups, generations });
}

/**
 * Serebii rows per regulation key, from the network (--refresh-serebii), the
 * cached HTML, or the committed sources, in that order of preference.
 *
 * @param {{ refresh: boolean, fetchText: (url: string) => Promise<string> }} options
 * @returns {Promise<Record<string, import("./lib/pokemon-data/serebii.mjs").SerebiiRow[]>>}
 */
async function loadSerebii({ refresh, fetchText }) {
  /** @type {Record<string, import("./lib/pokemon-data/serebii.mjs").SerebiiRow[]>} */
  const pages = {};
  for (const regulation of SEREBII_REGULATIONS) {
    const htmlPath = path.join(SEREBII_CACHE_DIR, `serebii-${regulation.key}.html`);
    const sourcePath = path.join(SOURCES_DIR, `serebii-${regulation.key}.json`);
    if (refresh) {
      log(`Fetching ${regulation.url}`);
      const html = await fetchText(regulation.url);
      await fs.mkdir(SEREBII_CACHE_DIR, { recursive: true });
      await fs.writeFile(htmlPath, html, "utf8");
    }
    if (existsSync(htmlPath)) {
      const { rows, problems } = parseSerebiiPage(await fs.readFile(htmlPath, "utf8"));
      if (problems.length > 0) {
        throw new Error(`Serebii ${regulation.key}: ${problems.join(" ")}`);
      }
      await fs.mkdir(SOURCES_DIR, { recursive: true });
      await fs.writeFile(sourcePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
      log(`Serebii ${regulation.key}: ${rows.length} rows from ${path.relative(ROOT, htmlPath)}`);
      pages[regulation.key] = rows;
    } else if (existsSync(sourcePath)) {
      pages[regulation.key] = JSON.parse(await fs.readFile(sourcePath, "utf8"));
      log(`Serebii ${regulation.key}: ${pages[regulation.key].length} rows from ${path.relative(ROOT, sourcePath)}`);
    } else {
      throw new Error(
        `Serebii ${regulation.key}: neither ${path.relative(ROOT, htmlPath)} nor ${path.relative(ROOT, sourcePath)} exists; run with --refresh-serebii.`
      );
    }
  }
  return pages;
}

/**
 * JSON on one line with the spacing regulations.json is written in:
 * `{ "kind": "filter", "dexes": ["paldea"], "dexRanges": { "paldea": [[1, 375]] } }`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function inlineJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(inlineJson).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${inlineJson(entry)}`);
    return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

/**
 * regulations.json in a review-friendly layout: one preset per block,
 * filter rules on one line, roster slugs wrapped a few per line.
 *
 * @param {import("./lib/pokemon-data/presets.mjs").Preset[]} presets
 */
function formatRegulations(presets) {
  const blocks = presets.map((preset) => {
    const lines = [];
    for (const [key, value] of Object.entries(preset)) {
      if (key === "rule" && value && typeof value === "object" && "slugs" in value) {
        const slugs = /** @type {string[]} */ (value.slugs);
        const wrapped = [];
        for (let index = 0; index < slugs.length; index += 6) {
          wrapped.push(`      ${slugs.slice(index, index + 6).map((slug) => JSON.stringify(slug)).join(", ")}`);
        }
        const body = wrapped.length > 0 ? `[\n${wrapped.join(",\n")}\n    ]` : "[]";
        lines.push(`    "rule": { "kind": "roster", "slugs": ${body} }`);
      } else {
        lines.push(`    ${JSON.stringify(key)}: ${inlineJson(value)}`);
      }
    }
    return `  {\n${lines.join(",\n")}\n  }`;
  });
  return `[\n${blocks.join(",\n")}\n]\n`;
}

/**
 * @param {string} dir
 * @param {import("./lib/pokemon-data/catalog.mjs").Catalog} catalog
 */
async function writeFixture(dir, catalog) {
  const fixture = selectFixture(catalog);
  /** @type {Array<[keyof typeof import("./lib/pokemon-data/strip.mjs").CACHE_KINDS, Array<{ id: number, name: string }>]>} */
  const groups = [
    ["pokemon-species", fixture.species],
    ["pokemon", fixture.pokemon],
    ["pokemon-form", fixture.forms],
    ["pokedex", fixture.pokedexes],
    ["version-group", fixture.versionGroups],
    ["generation", fixture.generations],
  ];
  for (const [kind, records] of groups) {
    const kindDir = path.join(dir, kind);
    await fs.rm(kindDir, { recursive: true, force: true });
    await fs.mkdir(kindDir, { recursive: true });
    for (const record of records) {
      await fs.writeFile(
        path.join(kindDir, cacheFileName(kind, record)),
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8"
      );
    }
    log(`  ${kind}: ${records.length} fixture records`);
  }
  log(`Fixture written to ${path.relative(ROOT, dir)}`);
}

/** @param {string} file */
async function readJsonIfExists(file) {
  if (!existsSync(file)) {
    return null;
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/**
 * @param {Record<string, number>} counts
 * @param {string[]} [keys]
 */
function formatCounts(counts, keys = Object.keys(counts)) {
  return keys.map((key) => `${key} ${counts[key] ?? 0}`).join(", ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    log("Usage: node scripts/build-pokemon-data.mjs [--refresh-serebii] [--write-fixture DIR]");
    return;
  }
  const cacheDir = path.resolve(ROOT, process.env.POKEAPI_CACHE_DIR ?? DEFAULT_CACHE_DIR);
  const speciesMax = Number.parseInt(process.env.POKEAPI_SPECIES_MAX ?? "", 10) || DEFAULT_SPECIES_MAX;
  const fetchJson = createJsonFetcher();
  const fetchText = createTextFetcher({ accept: "text/html" });

  log(`Loading the PokéAPI crawl from ${path.relative(ROOT, cacheDir) || "."} (species 1..${speciesMax})`);
  const cache = new RawCache(cacheDir, fetchJson);
  const catalog = await loadCatalog(cache, speciesMax);
  log(`Cache: ${cache.hits} hits, ${cache.misses} fetched`);

  if (options.writeFixture) {
    await writeFixture(options.writeFixture, catalog);
    return;
  }

  const serebiiPages = await loadSerebii({ refresh: options.refreshSerebii, fetchText });
  const overrides = await readJsonIfExists(path.join(DATA_DIR, "overrides.json"));
  if (!overrides) {
    throw new Error("data/pokemon/overrides.json is missing.");
  }
  const presets = await readJsonIfExists(path.join(DATA_DIR, "regulations.json"));
  if (!Array.isArray(presets)) {
    throw new Error("data/pokemon/regulations.json is missing or not an array.");
  }
  const previousReport = await readJsonIfExists(path.join(DATA_DIR, "report.json"));

  const result = buildDataset({ catalog, overrides, presets, serebiiPages, previousReport });

  for (const warning of result.warnings) {
    console.warn(`WARNING: ${warning}`);
  }
  if (result.problems.length > 0) {
    console.error(`Build failed with ${result.problems.length} problem(s):`);
    for (const problem of result.problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "pokemon.json"), `${JSON.stringify(result.rows, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(DATA_DIR, "regulations.json"), formatRegulations(result.regulations), "utf8");
  await fs.writeFile(path.join(DATA_DIR, "report.json"), `${JSON.stringify(result.report, null, 2)}\n`, "utf8");

  const { report } = result;
  log("");
  log(`Wrote ${report.rows} rows for ${report.species} species to data/pokemon/pokemon.json`);
  log(`Form kinds: ${formatCounts(report.byFormKind)}`);
  log(`Expected:   ${formatCounts(report.expectedByFormKind)}`);
  log(`Games:      ${formatCounts(report.byGame)}`);
  log(`Tags:       ${formatCounts(report.byTag)}`);
  log(`Presets:    ${formatCounts(report.byPreset)}`);
  log(`Skipped:    ${formatCounts(report.skippedByReason)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
