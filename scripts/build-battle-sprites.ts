// Builds data/battle/sprites.json: one sprite file for every species of the four battle catalogs, which the calculator
// and Training show in their Pokémon slots (app/lib/battle/sprites.ts) without reading the Pokémon dex.
//
//   npx --no-install tsx scripts/build-battle-sprites.ts [--check]
//
// Each Showdown species id gets a PokeAPI sprite (sprites/pokemon/<file>.png on raw.githubusercontent.com):
// 1. the sprite of the first Pool Builder row (data/pokemon/pokemon.json) whose name resolves to it as a league roster
//    name does (resolveRosterName), so a league entry looks the same in the calculator as in its league;
// 2. else the sprite of the PokeAPI Pokémon or form its Showdown name names (battle-only forms such as Aegislash-Blade,
//    cosmetic forms such as Vivillon-Fancy, Arceus' types, Minior's cores), read from the PokeAPI crawl that
//    `npm run data:pokemon` caches (POKEAPI_CACHE_DIR, default scripts/.cache/pokeapi); POKEAPI_SLUGS names the ones
//    whose PokeAPI name cannot be derived;
// 3. else the sprite of the form it changes from (Ogerpon's Tera forms have none of their own), then its base species.
// --check rebuilds in memory and fails when the committed file differs.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { BATTLE_GAMES } from "@/app/lib/battle/profiles";
import { resolveRosterName } from "@/app/lib/battle/roster-identity";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { ChampionsSpecies } from "@/app/lib/battle/types";
import { normalizePokemonName, toPokeApiSlug } from "@/app/lib/pokemon";
import { ROOT } from "./lib/champions-data/sources.mjs";

export const SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";
const OUTPUT = join(ROOT, "data/battle/sprites.json");
const CACHE_DIR = process.env.POKEAPI_CACHE_DIR ? resolve(process.env.POKEAPI_CACHE_DIR) : join(ROOT, "scripts/.cache/pokeapi");

/**
 * Showdown species whose PokeAPI Pokémon or form name differs from the one toPokeApiSlug derives: Showdown's plain
 * Maushold is Family of Three, Alcremie's flavours are PokeAPI's Strawberry Sweet forms, and Pikachu's caps, the Totem
 * forms and Squawkabilly's plumages carry other words there.
 */
export const POKEAPI_SLUGS: Readonly<Record<string, string>> = {
  alcremiecaramelswirl: "alcremie-caramel-swirl-strawberry-sweet",
  alcremielemoncream: "alcremie-lemon-cream-strawberry-sweet",
  alcremiematchacream: "alcremie-matcha-cream-strawberry-sweet",
  alcremiemintcream: "alcremie-mint-cream-strawberry-sweet",
  alcremierainbowswirl: "alcremie-rainbow-swirl-strawberry-sweet",
  alcremierubycream: "alcremie-ruby-cream-strawberry-sweet",
  alcremierubyswirl: "alcremie-ruby-swirl-strawberry-sweet",
  alcremiesaltedcream: "alcremie-salted-cream-strawberry-sweet",
  marowakalolatotem: "marowak-totem",
  maushold: "maushold-family-of-three",
  mimikyubustedtotem: "mimikyu-totem-busted",
  mimikyutotem: "mimikyu-totem-disguised",
  pikachualola: "pikachu-alola-cap",
  pikachuhoenn: "pikachu-hoenn-cap",
  pikachukalos: "pikachu-kalos-cap",
  pikachuoriginal: "pikachu-original-cap",
  pikachupartner: "pikachu-partner-cap",
  pikachusinnoh: "pikachu-sinnoh-cap",
  pikachuunova: "pikachu-unova-cap",
  pikachuworld: "pikachu-world-cap",
  raticatealolatotem: "raticate-totem-alola",
  squawkabillyblue: "squawkabilly-blue-plumage",
  squawkabillywhite: "squawkabilly-white-plumage",
};

type PoolRow = { id: number; slug: string; display_name: string; sprite_url: string | null };
type CrawlKind = "pokemon" | "pokemon-form";
type CrawlEntry = { sprites?: { front_default?: string | null; other?: { "official-artwork"?: { front_default?: string | null } } } };
export type SpriteSource = "pool" | "pokeapi" | "changes-from" | "base";

/** A sprite URL's file under SPRITE_BASE, without ".png" ("25", "666-fancy", "other/official-artwork/10301"). */
function spriteFile(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith(SPRITE_BASE) || !url.endsWith(".png")) throw new Error(`Unexpected sprite URL ${url}.`);
  return url.slice(SPRITE_BASE.length, -".png".length);
}

/** The cached PokeAPI crawl: Pokémon and forms by name, and by name without separators ("vivillon-poke-ball"). */
async function loadCrawl() {
  const names = new Map<CrawlKind, Set<string>>();
  for (const kind of ["pokemon", "pokemon-form"] as const) {
    const files = await readdir(join(CACHE_DIR, kind)).catch(() => {
      throw new Error(`No PokeAPI crawl at ${CACHE_DIR}; run npm run data:pokemon (or set POKEAPI_CACHE_DIR) first.`);
    });
    names.set(kind, new Set(files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -".json".length))));
  }
  const byKey = new Map<string, { kind: CrawlKind; name: string }>();
  for (const kind of ["pokemon-form", "pokemon"] as const) {
    for (const name of names.get(kind)!) byKey.set(normalizePokemonName(name), { kind, name });
  }
  async function sprite(kind: CrawlKind, name: string): Promise<string | null> {
    if (!names.get(kind)!.has(name)) return null;
    const entry = JSON.parse(await readFile(join(CACHE_DIR, kind, `${name}.json`), "utf8")) as CrawlEntry;
    return spriteFile(entry.sprites?.front_default ?? entry.sprites?.other?.["official-artwork"]?.front_default);
  }
  /** The sprite of the PokeAPI Pokémon (else form) a Showdown species names, or null. */
  return async function crawlSprite(species: ChampionsSpecies): Promise<string | null> {
    const slugs = [POKEAPI_SLUGS[species.id], toPokeApiSlug(species.name)].filter((slug): slug is string => !!slug);
    for (const slug of slugs) {
      const file = await sprite("pokemon", slug) ?? await sprite("pokemon-form", slug);
      if (file) return file;
    }
    const keyed = byKey.get(normalizePokemonName(species.name));
    return keyed ? sprite(keyed.kind, keyed.name) : null;
  };
}

/** Every species of the four catalogs, mapped to its sprite file and the step that found it. */
export async function createBattleSprites() {
  const runtimes: BattleRuntime[] = await Promise.all(BATTLE_GAMES.map((game) => loadBattleRuntime(game)));
  const rows = JSON.parse(await readFile(join(ROOT, "data/pokemon/pokemon.json"), "utf8")) as PoolRow[];
  const species = new Map<string, ChampionsSpecies>();
  for (const runtime of runtimes) for (const entry of runtime.catalog.species) if (!species.has(entry.id)) species.set(entry.id, entry);

  const found = new Map<string, { file: string; source: SpriteSource }>();
  // 1. Pool Builder rows, in dataset order (species, then PokeAPI id): the first row a species' roster names reach.
  for (const row of rows) {
    const file = spriteFile(row.sprite_url);
    if (!file) continue;
    for (const runtime of runtimes) {
      const resolved = resolveRosterName(runtime, row.display_name);
      if (resolved.status === "resolved" && !found.has(resolved.speciesId)) found.set(resolved.speciesId, { file, source: "pool" });
    }
  }
  // 2. The PokeAPI Pokémon or form of the Showdown name.
  const crawlSprite = await loadCrawl();
  for (const entry of species.values()) {
    if (found.has(entry.id)) continue;
    const file = await crawlSprite(entry);
    if (file) found.set(entry.id, { file, source: "pokeapi" });
  }
  // 3. The form it changes from, then its base species.
  for (const entry of species.values()) {
    if (found.has(entry.id)) continue;
    const from = entry.changesFrom ? found.get(entry.changesFrom) : undefined;
    const base = found.get(entry.baseSpecies);
    if (from) found.set(entry.id, { file: from.file, source: "changes-from" });
    else if (base) found.set(entry.id, { file: base.file, source: "base" });
    else throw new Error(`No sprite for ${entry.name} (${entry.id}).`);
  }

  const ids = [...species.keys()].sort();
  const data = {
    version: 1,
    rebuild: "npx --no-install tsx scripts/build-battle-sprites.ts",
    base: SPRITE_BASE,
    sprites: Object.fromEntries(ids.map((id) => [id, found.get(id)!.file])),
  };
  return { contents: `${JSON.stringify(data, null, 2)}\n`, found, species };
}

export async function buildBattleSprites(check = false): Promise<void> {
  const { contents, found, species } = await createBattleSprites();
  if (check) {
    if (await readFile(OUTPUT, "utf8") !== contents) throw new Error("data/battle/sprites.json is stale; run npx --no-install tsx scripts/build-battle-sprites.ts.");
  } else {
    await writeFile(OUTPUT, contents);
  }
  const counts: Record<SpriteSource, number> = { pool: 0, pokeapi: 0, "changes-from": 0, base: 0 };
  for (const { source } of found.values()) counts[source] += 1;
  console.log(`${check ? "Verified" : "Generated"} data/battle/sprites.json: ${species.size} species (${counts.pool} Pool Builder rows, ${counts.pokeapi} PokeAPI names, ${counts["changes-from"]} the form they change from, ${counts.base} their base species).`);
  for (const [id, { file, source }] of found) if (source === "changes-from" || source === "base") console.log(`  ${species.get(id)!.name}: ${file} (${source})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: tsx scripts/build-battle-sprites.ts [--check]");
  buildBattleSprites(args.includes("--check")).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
