import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CACHE, ROOT } from "./lib/champions-data/sources.mjs";

const STATS_URL = "https://www.smogon.com/stats";
const FORMAT_IDS = { Singles: "gen9championsbssregmb", Doubles: "gen9championsvgc2026regmb" };
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const OUTPUT = join(ROOT, "data/champions/move-usage.json");
const TRAINING_OUTPUT = join(ROOT, "data/champions/training-usage.json");
const compact = (value) => `${JSON.stringify(value)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rank = (entries) => [...entries].sort(([a, x], [b, y]) => y - x || compareIds(a, b));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Explicit opt-in imports only. Pins are hashes of the original compressed bytes. */
export const USAGE_SOURCES = Object.freeze({
  Singles: Object.freeze({
    gameType: "Singles", month: "2026-08", format: FORMAT_IDS.Singles, cutoff: 1630,
    battles: 66884, speciesRows: 271, archiveBytes: 938621,
    sha256: "6283ac265c2eedf6e5f84f84a86a16807634c02a1310f0e2ad00526f03abc01c",
    url: `${STATS_URL}/2026-08/chaos/gen9championsbssregmb-1630.json.gz`,
  }),
  Doubles: Object.freeze({
    gameType: "Doubles", month: "2026-08", format: FORMAT_IDS.Doubles, cutoff: 1630,
    battles: 1269250, speciesRows: 283, archiveBytes: 5249390,
    sha256: "14b3423c2bdee29ffaa01d21fca8a11f8988679ece87217dd11d21e350badced",
    url: `${STATS_URL}/2026-08/chaos/gen9championsvgc2026regmb-1630.json.gz`,
  }),
});

function validateSource(source) {
  if (!isRecord(source) || !Object.hasOwn(FORMAT_IDS, source.gameType) ||
      source.format !== FORMAT_IDS[source.gameType] || !/^\d{4}-(0[1-9]|1[0-2])$/.test(source.month) ||
      source.cutoff !== 1630 || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      ![source.battles, source.speciesRows, source.archiveBytes].every((value) => Number.isSafeInteger(value) && value > 0) ||
      source.url !== `${STATS_URL}/${source.month}/chaos/${source.format}-${source.cutoff}.json.gz`) {
    throw new Error("Invalid Champions usage source pin or format mapping.");
  }
}

function verifyArchive(archive, source, maxArchiveBytes = MAX_ARCHIVE_BYTES) {
  validateSource(source);
  if (!Buffer.isBuffer(archive) || archive.length > maxArchiveBytes) {
    throw new Error(`Usage archive exceeds compressed byte limit: ${source.format}.`);
  }
  if (sha256(archive) !== source.sha256) throw new Error(`Usage source checksum mismatch: ${source.format}.`);
  if (archive.length !== source.archiveBytes) throw new Error(`Usage archive size mismatch: ${source.format}.`);
}

function validatePayload(payload, source) {
  validateSource(source);
  if (!isRecord(payload) || !isRecord(payload.info) || !isRecord(payload.data)) {
    throw new Error("Usage schema requires info and data objects.");
  }
  const info = payload.info;
  if (info.metagame !== source.format || info.cutoff !== source.cutoff ||
      info["number of battles"] !== source.battles || info["cutoff deviation"] !== 0 || info["team type"] !== null) {
    throw new Error(`Usage metadata mismatch: ${source.format}.`);
  }
  if (Object.keys(payload.data).length !== source.speciesRows) {
    throw new Error(`Usage species row count mismatch: ${source.format}.`);
  }
  for (const [name, row] of Object.entries(payload.data)) {
    if (!name || !isRecord(row) || !isRecord(row.Moves)) {
      throw new Error(`Usage schema requires a Moves object for ${name || "(empty species)"}.`);
    }
  }
}

/** Byte limits apply before parsing; gzip output is bounded even for a gzip bomb. */
export function parseUsageArchive(archive, source, limits = {}) {
  verifyArchive(archive, source, limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES);
  const text = gunzipSync(archive, { maxOutputLength: limits.maxOutputBytes ?? MAX_OUTPUT_BYTES });
  const payload = JSON.parse(text.toString("utf8"));
  validatePayload(payload, source);
  return payload;
}

/** Exact catalog-backed aliases only: id, display name and explicit calcName. */
function indexCatalog(catalog) {
  if (!isRecord(catalog) || catalog.version !== 1 || catalog.game !== "champions" ||
      !Array.isArray(catalog.species) || !Array.isArray(catalog.moves) || !catalog.species.length || !catalog.moves.length) {
    throw new Error("Invalid Champions catalog schema.");
  }
  const moves = new Map();
  for (const row of catalog.moves) {
    if (!isRecord(row) || typeof row.id !== "string" || !/^[a-z0-9]+$/.test(row.id) || moves.has(row.id) ||
        !["Physical", "Special", "Status"].includes(row.category)) {
      throw new Error("Invalid or duplicate catalog move identity/category.");
    }
    moves.set(row.id, row);
  }
  const identities = new Map();
  const species = new Map();
  for (const row of catalog.species) {
    if (!isRecord(row) || typeof row.id !== "string" || !/^[a-z0-9]+$/.test(row.id) || species.has(row.id) ||
        typeof row.name !== "string" || !row.name || typeof row.calcName !== "string" || !row.calcName ||
        !Array.isArray(row.moves) || row.moves.some((id) => !moves.has(id)) || new Set(row.moves).size !== row.moves.length) {
      throw new Error("Invalid or duplicate catalog species identity/learnset.");
    }
    species.set(row.id, row);
    for (const name of new Set([row.id, row.name])) {
      const previous = identities.get(name);
      if (previous && previous.id !== row.id) throw new Error(`Ambiguous catalog species alias: ${name}.`);
      identities.set(name, row);
    }
  }
  // Catalog IDs/names own their usage even when cosmetics share that engine name.
  // Only otherwise-unclaimed, unique engine aliases can identify a species.
  const canonical = new Set(identities.keys());
  for (const row of species.values()) {
    if (canonical.has(row.calcName)) continue;
    const previous = identities.get(row.calcName);
    if (previous && previous.id !== row.id) throw new Error(`Ambiguous catalog species alias: ${row.calcName}.`);
    identities.set(row.calcName, row);
  }
  return { moves, species, identities };
}

/** Filter the full weight table BEFORE top-four selection; never normalize to percentages. */
export function deriveFormatUsage(catalog, payload, source) {
  validatePayload(payload, source);
  const { moves, species, identities } = indexCatalog(catalog);
  const rankedSpecies = new Map();
  const topAbilities = new Map();
  const aggregate = new Map();
  const unmatchedSpecies = [];
  const filteredMoves = { emptyId: 0, invalidWeight: 0, unknownId: 0, illegal: 0, status: 0 };
  // Sorting input identities and IDs also stabilizes floating-point summation.
  for (const name of Object.keys(payload.data).sort(compareIds)) {
    const row = identities.get(name);
    if (!row) {
      unmatchedSpecies.push(name);
      continue;
    }
    if (rankedSpecies.has(row.id)) throw new Error(`Multiple usage rows resolve to catalog species: ${row.id}.`);
    const legal = new Set(row.moves);
    const weightedMoves = [];
    for (const [id, weight] of Object.entries(payload.data[name].Moves).sort(([a], [b]) => compareIds(a, b))) {
      if (!id) { filteredMoves.emptyId++; continue; }
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) { filteredMoves.invalidWeight++; continue; }
      const move = moves.get(id);
      if (!move) { filteredMoves.unknownId++; continue; }
      if (!legal.has(id)) { filteredMoves.illegal++; continue; }
      if (move.category === "Status") { filteredMoves.status++; continue; }
      weightedMoves.push([id, weight]);
      const total = (aggregate.get(id) ?? 0) + weight;
      if (!Number.isFinite(total)) throw new Error(`Aggregate usage weight overflow: ${id}.`);
      aggregate.set(id, total);
    }
    rankedSpecies.set(row.id, rank(weightedMoves).slice(0, 4).map(([id]) => id));
    // The most-used ability the exact catalog form can have (positive finite raw weight).
    const legalAbilities = new Set(Array.isArray(row.abilities) ? row.abilities : []);
    const weightedAbilities = Object.entries(isRecord(payload.data[name].Abilities) ? payload.data[name].Abilities : {})
      .filter(([id, weight]) => legalAbilities.has(id) && typeof weight === "number" && Number.isFinite(weight) && weight > 0);
    if (weightedAbilities.length) topAbilities.set(row.id, rank(weightedAbilities)[0][0]);
  }
  const withUsage = [...rankedSpecies.values()].filter((ids) => ids.length > 0).length;
  return {
    source: {
      url: source.url, format: source.format, month: source.month, cutoff: source.cutoff,
      battles: source.battles, archiveBytes: source.archiveBytes, archiveSha256: source.sha256,
    },
    species: Object.fromEntries([...rankedSpecies].sort(([a], [b]) => compareIds(a, b))),
    abilities: Object.fromEntries([...topAbilities].sort(([a], [b]) => compareIds(a, b))),
    aggregate: rank(aggregate).map(([id]) => id),
    coverage: {
      sourceSpeciesRows: source.speciesRows,
      matchedSpecies: rankedSpecies.size,
      unmatchedSpecies,
      catalogSpecies: species.size,
      speciesWithRankedMoves: withUsage,
      catalogSpeciesWithoutSourceRows: species.size - rankedSpecies.size,
      catalogSpeciesWithoutRankedMoves: species.size - withUsage,
      aggregateDamagingMoves: aggregate.size,
      filteredMoves,
    },
  };
}

/** Pure transformation exposed for offline fixtures; the CLI alone performs I/O. */
export function buildMoveUsageSnapshot(catalogJSON, inputs) {
  const catalog = JSON.parse(catalogJSON);
  if (!Array.isArray(inputs) || inputs.length !== 2 ||
      new Set(inputs.map(({ source }) => source.gameType)).size !== 2 ||
      !inputs.every(({ source }) => Object.hasOwn(FORMAT_IDS, source.gameType))) {
    throw new Error("Usage snapshot requires exactly one Singles and one Doubles source.");
  }
  return {
    version: 1,
    game: "champions",
    catalogSha256: sha256(catalogJSON),
    attribution: {
      name: "Smogon usage statistics / Pokemon Showdown",
      url: STATS_URL,
      note: "Community battle usage, not an official Pokemon Champions recommendation. Moves values are raw weighted counts, not percentages.",
    },
    policy: {
      identities: "Exact catalog id/name take precedence over calcName; otherwise only unique engine aliases resolve. Ambiguous aliases and duplicate resolved rows fail. No fuzzy matches or base-form usage inheritance in the snapshot; the app reads a cosmetic form's family row and Maushold-Four's Maushold row, where Smogon's statistics count them.",
      species: "Top four positive finite raw move weights, filtered first to catalog-known non-Status moves in the exact proven Champions learnset. Canonical ID breaks ties; zero power and engine warnings do not exclude moves.",
      aggregate: "Complete damaging-move rank by sum of positive finite legal raw weights across exact-matched species in the same format, including moves outside species top fours. Canonical ID breaks ties. No aggregate truncation before exact-learnset intersection.",
      fallback: "Fill unused slots in three suggested tiers: first, for each of the form's types the slots lack, one legal damaging attack of that type in its stronger attacking category (Attack doubled for Huge Power or Pure Power; both on a tie) with positive numeric power and no unsupported reason, ranked by same-format aggregate rank, then power x accuracy, then canonical ID; then same-format aggregate rank; then canonical ID order. None is per-species usage; pad to four with empty slots.",
      abilities: "The highest positive finite raw weight among the exact catalog form's abilities; canonical ID breaks ties. Species without a legal weighted ability are omitted.",
    },
    formats: Object.fromEntries(["Singles", "Doubles"].map((gameType) => {
      const { payload, source } = inputs.find((input) => input.source.gameType === gameType);
      return [gameType, deriveFormatUsage(catalog, payload, source)];
    })),
  };
}

// ---------- Training usage (SPEC addendum A1.1): data/champions/training-usage.json ----------
// The same hash-checked Doubles archive and catalog identities as above, keeping what Training needs and move-usage.json
// drops: moves of every category, items, spreads and abilities, each as a share of the species' weighted sets.

/** Moves: the top 24, or more while above 0.5% of the species' sets; items and spreads: the top 12. */
export const TRAINING_USAGE_LIMITS = Object.freeze({ moves: 24, moveShare: 0.005, items: 12, spreads: 12 });
const STAT_IDS = ["hp", "atk", "def", "spa", "spd", "spe"];
/** The 25 natures as Showdown spells them (PS/data/natures.ts). */
const NATURES = new Set([
  "Adamant", "Bashful", "Bold", "Brave", "Calm", "Careful", "Docile", "Gentle", "Hardy", "Hasty", "Impish", "Jolly", "Lax",
  "Lonely", "Mild", "Modest", "Naive", "Naughty", "Quiet", "Quirky", "Rash", "Relaxed", "Sassy", "Serious", "Timid",
]);
/** Champions Stat Points (PS/sim/team-validator.ts:1306-1311 per stat; PS/sim/dex-formats.ts:343-345 evLimit 66, enforced at team-validator.ts:1350-1355). */
const MAX_STAT_POINTS = 32;
const STAT_POINT_LIMIT = 66;
const positiveWeight = (weight) => typeof weight === "number" && Number.isFinite(weight) && weight > 0;
/** A share of the species' weighted sets, to four significant digits (stays > 0). */
const share = (weight, total) => Number((weight / total).toPrecision(4));
const sortedEntries = (value) => (isRecord(value) ? Object.entries(value) : []).sort(([a], [b]) => compareIds(a, b));

/**
 * A Smogon `Spreads` key `Nature:hp/atk/def/spa/spd/spe` (Stat Points in Champions) the Champions validator accepts:
 * integers 0-32 each, at most 66 in total, and not Serious with 0 points (PS/sim/team-validator.ts:1332-1335). Else null.
 */
export function parseTrainingSpread(key) {
  const match = typeof key === "string" ? /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(key) : null;
  if (!match || !NATURES.has(match[1])) return null;
  const values = match.slice(2).map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (values.some((value) => !Number.isSafeInteger(value) || value > MAX_STAT_POINTS) || total > STAT_POINT_LIMIT) return null;
  if (match[1] === "Serious" && total === 0) return null;
  return { nature: match[1], points: Object.fromEntries(STAT_IDS.map((stat, index) => [stat, values[index]])) };
}

/** Per exact-matched catalog species: moves, items, spreads and abilities with weights (shares of the species' sets). */
export function deriveTrainingUsage(catalog, payload, source) {
  validatePayload(payload, source);
  const { moves, species, identities } = indexCatalog(catalog);
  if (!Array.isArray(catalog.items) || !catalog.items.length ||
      catalog.items.some((row) => !isRecord(row) || typeof row.id !== "string" || !/^[a-z0-9]+$/.test(row.id))) {
    throw new Error("Invalid Champions catalog items.");
  }
  const items = new Set(catalog.items.map((row) => row.id));
  if (items.size !== catalog.items.length) throw new Error("Duplicate catalog item identity.");
  const rows = new Map();
  const unmatchedSpecies = [];
  const withoutSets = [];
  const filtered = {
    moves: { emptyId: 0, invalidWeight: 0, unknownId: 0, illegal: 0 },
    items: { invalidWeight: 0, unknownId: 0 },
    spreads: { invalidWeight: 0, invalid: 0 },
    abilities: { invalidWeight: 0, illegal: 0 },
  };
  const truncated = { moves: 0, items: 0, spreads: 0 };
  // Sorting input identities and IDs also stabilizes floating-point summation.
  for (const name of Object.keys(payload.data).sort(compareIds)) {
    const row = identities.get(name);
    if (!row) {
      unmatchedSpecies.push(name);
      continue;
    }
    if (rows.has(row.id) || withoutSets.includes(row.id)) throw new Error(`Multiple usage rows resolve to catalog species: ${row.id}.`);
    const data = payload.data[name];
    // Every set has exactly one ability, so the summed ability weight is the species' weighted set count.
    const abilityEntries = sortedEntries(data.Abilities);
    let total = 0;
    for (const [, weight] of abilityEntries) if (positiveWeight(weight)) total += weight;
    if (!Number.isFinite(total)) throw new Error(`Usage set weight overflow: ${row.id}.`);
    if (!(total > 0)) {
      withoutSets.push(row.id);
      continue;
    }
    const legalMoves = new Set(row.moves);
    const weightedMoves = [];
    for (const [id, weight] of sortedEntries(data.Moves)) {
      if (!id) { filtered.moves.emptyId++; continue; }
      if (!positiveWeight(weight)) { filtered.moves.invalidWeight++; continue; }
      if (!moves.has(id)) { filtered.moves.unknownId++; continue; }
      if (!legalMoves.has(id)) { filtered.moves.illegal++; continue; }
      weightedMoves.push([id, weight]);
    }
    const rankedMoves = rank(weightedMoves);
    const keptMoves = rankedMoves.filter(([, weight], index) => index < TRAINING_USAGE_LIMITS.moves || weight / total > TRAINING_USAGE_LIMITS.moveShare);
    truncated.moves += rankedMoves.length - keptMoves.length;
    const weightedItems = [];
    for (const [key, weight] of sortedEntries(data.Items)) {
      if (!positiveWeight(weight)) { filtered.items.invalidWeight++; continue; }
      // The archive's "nothing" is no item, written "" as BattleBuild.itemId.
      const id = key === "nothing" ? "" : key;
      if ((!id && key !== "nothing") || (id && !items.has(id))) { filtered.items.unknownId++; continue; }
      weightedItems.push([id, weight]);
    }
    const rankedItems = rank(weightedItems);
    truncated.items += Math.max(0, rankedItems.length - TRAINING_USAGE_LIMITS.items);
    const weightedSpreads = [];
    for (const [key, weight] of sortedEntries(data.Spreads)) {
      if (!positiveWeight(weight)) { filtered.spreads.invalidWeight++; continue; }
      if (!parseTrainingSpread(key)) { filtered.spreads.invalid++; continue; }
      weightedSpreads.push([key, weight]);
    }
    const rankedSpreads = rank(weightedSpreads);
    truncated.spreads += Math.max(0, rankedSpreads.length - TRAINING_USAGE_LIMITS.spreads);
    const legalAbilities = new Set(Array.isArray(row.abilities) ? row.abilities : []);
    const weightedAbilities = [];
    for (const [id, weight] of abilityEntries) {
      if (!positiveWeight(weight)) { filtered.abilities.invalidWeight++; continue; }
      if (!legalAbilities.has(id)) { filtered.abilities.illegal++; continue; }
      weightedAbilities.push([id, weight]);
    }
    rows.set(row.id, {
      // The species' weighted set count, so a reader can mix rows (a base form and its Megas) by how often each was used.
      sets: Number(total.toPrecision(6)),
      moves: keptMoves.map(([id, weight]) => ({ id, weight: share(weight, total) })),
      items: rankedItems.slice(0, TRAINING_USAGE_LIMITS.items).map(([id, weight]) => ({ id, weight: share(weight, total) })),
      spreads: rankedSpreads.slice(0, TRAINING_USAGE_LIMITS.spreads).map(([key, weight]) => ({ ...parseTrainingSpread(key), weight: share(weight, total) })),
      abilities: rank(weightedAbilities).map(([id, weight]) => ({ id, weight: share(weight, total) })),
    });
  }
  const count = (key) => [...rows.values()].filter((row) => row[key].length > 0).length;
  return {
    source: {
      url: source.url, format: source.format, month: source.month, cutoff: source.cutoff,
      battles: source.battles, archiveBytes: source.archiveBytes, archiveSha256: source.sha256,
    },
    coverage: {
      sourceSpeciesRows: source.speciesRows,
      matchedSpecies: rows.size + withoutSets.length,
      unmatchedSpecies,
      speciesWithoutSets: withoutSets.sort(compareIds),
      catalogSpecies: species.size,
      species: rows.size,
      speciesWithMoves: count("moves"),
      speciesWithItems: count("items"),
      speciesWithSpreads: count("spreads"),
      speciesWithAbilities: count("abilities"),
      filtered,
      truncated,
    },
    species: Object.fromEntries([...rows].sort(([a], [b]) => compareIds(a, b))),
  };
}

/** Pure transformation of the Doubles input (the CLI alone performs I/O). Key order is TrainingUsageData's. */
export function buildTrainingUsageSnapshot(catalogJSON, input) {
  if (!isRecord(input) || !isRecord(input.source) || input.source.gameType !== "Doubles") {
    throw new Error("Training usage requires the Doubles source.");
  }
  const { source, coverage, species } = deriveTrainingUsage(JSON.parse(catalogJSON), input.payload, input.source);
  return {
    version: 1,
    game: "champions",
    catalogSha256: sha256(catalogJSON),
    attribution: {
      name: "Smogon usage statistics / Pokemon Showdown",
      url: STATS_URL,
      note: "Community battle usage, not an official Pokemon Champions recommendation. Weights are shares of the species' weighted sets: raw weight divided by the species' summed ability weight.",
    },
    policy: {
      identities: "As move-usage.json: exact catalog id/name take precedence over calcName; otherwise only unique engine aliases resolve. Ambiguous aliases and duplicate resolved rows fail. No fuzzy matches or base-form usage inheritance in the snapshot; the app reads a cosmetic form's family row and Maushold-Four's Maushold row.",
      weights: "Raw archive weight divided by the sum of the species' positive finite Abilities weights (every set has one ability), to four significant digits; that sum, to six, is the row's sets. Lists are in descending raw weight; canonical ID (spread key) breaks ties.",
      moves: "Moves of every category in the exact proven Champions learnset with positive finite raw weights: the top 24, and every further move above 0.5% of the species' sets.",
      items: "Catalog (Reg M-C legal) items with positive finite raw weights, the top 12; the archive's \"nothing\" is the item \"\".",
      spreads: "Nature:hp/atk/def/spa/spd/spe Stat Point spreads the Champions validator accepts (a Showdown nature; integers 0-32; at most 66 in total; not Serious with 0), the top 12.",
      abilities: "Every ability the exact catalog form can have with a positive finite raw weight.",
    },
    source,
    coverage,
    species,
  };
}

async function readBoundedArchive(path) {
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > MAX_ARCHIVE_BYTES) throw new Error("Cached usage archive exceeds compressed byte limit.");
    // Also bound the read itself if a cached file changes between stat and read.
    const buffer = Buffer.alloc(MAX_ARCHIVE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_ARCHIVE_BYTES) throw new Error("Cached usage archive exceeds compressed byte limit.");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

async function ensureUsageArchive(source) {
  validateSource(source);
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, `${source.month}-${source.format}-${source.cutoff}.json.gz`);
  try {
    const archive = await readBoundedArchive(path);
    verifyArchive(archive, source); // Never silently replace a corrupt cached source.
    return archive;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let archive;
  try {
    // No redirects or alternate sources. Bound headers and streamed body before buffering.
    const response = await fetch(source.url, { signal: controller.signal, redirect: "error" });
    if (!response.ok || !response.body) throw new Error(`Usage download failed: ${response.status} ${source.url}`);
    const declaredBytes = Number(response.headers.get("content-length"));
    if (declaredBytes > MAX_ARCHIVE_BYTES) throw new Error("Usage download exceeds compressed byte limit.");
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_ARCHIVE_BYTES) throw new Error("Usage download exceeds compressed byte limit.");
      chunks.push(chunk);
    }
    archive = Buffer.concat(chunks, length);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  verifyArchive(archive, source);
  // Validate gzip, metadata and schema before retaining downloaded bytes.
  parseUsageArchive(archive, source);
  await writeFile(path, archive);
  return archive;
}

export async function importChampionsMoveUsage(check = false) {
  const catalogJSON = await readFile(join(ROOT, "data/champions/catalog.json"), "utf8");
  const manifest = JSON.parse(await readFile(join(ROOT, "data/champions/manifest.json"), "utf8"));
  if (sha256(catalogJSON) !== manifest.catalogSha256) throw new Error("Catalog digest differs from its proven Champions manifest.");
  const inputs = [];
  for (const source of Object.values(USAGE_SOURCES)) {
    inputs.push({ source, payload: parseUsageArchive(await ensureUsageArchive(source), source) });
  }
  const snapshot = buildMoveUsageSnapshot(catalogJSON, inputs);
  const contents = compact(snapshot);
  if (check) {
    if (await readFile(OUTPUT, "utf8") !== contents) throw new Error("move-usage.json is stale; run npm run data:champions:move-usage.");
  } else {
    await writeFile(OUTPUT, contents);
  }
  console.log(`${check ? "Verified" : "Generated"} Champions move usage (${Buffer.byteLength(contents)} bytes).`);
  for (const [gameType, { source, coverage }] of Object.entries(snapshot.formats)) {
    console.log(`${gameType} ${source.month}: ${coverage.matchedSpecies}/${coverage.sourceSpeciesRows} source species matched; ${coverage.speciesWithRankedMoves}/${coverage.catalogSpecies} catalog species with ranked moves.`);
    console.log(`Unmatched ${gameType} species: ${coverage.unmatchedSpecies.join(", ") || "none"}.`);
  }
  // Training (SPEC addendum A1.1) reads the same parsed, hash-checked Doubles archive.
  const training = buildTrainingUsageSnapshot(catalogJSON, inputs.find((input) => input.source.gameType === "Doubles"));
  const trainingContents = compact(training);
  if (check) {
    const current = await readFile(TRAINING_OUTPUT, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current !== trainingContents) throw new Error("training-usage.json is stale; run npm run data:champions:move-usage.");
  } else {
    await writeFile(TRAINING_OUTPUT, trainingContents);
  }
  console.log(`${check ? "Verified" : "Generated"} Champions training usage (${Buffer.byteLength(trainingContents)} bytes): ${training.coverage.species}/${training.coverage.sourceSpeciesRows} Doubles species with sets.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/import-champions-move-usage.mjs [--check]");
  importChampionsMoveUsage(args.includes("--check")).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
