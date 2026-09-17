import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBaseSpeciesName,
  getCachedDex,
  getPokemonTypes,
  getSpriteUrl,
  loadDex,
  normalizePokemonName,
  pokemonTypeOverrides,
  primeDexCache,
  toPokeApiSlug,
  type DexMap,
} from "@/app/lib/pokemon";
import {
  DATASET_COLUMNS,
  DATASET_PAGE_SIZE,
  findDatasetEntry,
  getCachedDataset,
  loadDataset,
  primeDatasetCache,
  toPokemonEntry,
} from "@/app/lib/pokemon/dataset";

/**
 * A fake Supabase client for the two loaders: `tables` holds the rows (or
 * the error) each table answers with, `calls` records every query so the
 * tests can assert the columns, ordering and page ranges the loaders send.
 */
type Row = Record<string, unknown>;
type TableSource = Row[] | { error: { code: string; message: string } };
type Call = { table: string; select: string; orders: string[]; range: [number, number] };

const fake = vi.hoisted(() => ({
  tables: {} as Record<string, TableSource>,
  calls: [] as Call[],
}));

vi.mock("@/app/lib/supabase/client", () => ({
  createClient: () => ({
    from(table: string) {
      const call: Call = { table, select: "", orders: [], range: [0, 0] };
      const builder = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        order(column: string) {
          call.orders.push(column);
          return builder;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          fake.calls.push(call);
          const source = fake.tables[table];
          if (!source) {
            return Promise.resolve({
              data: null,
              error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` },
            });
          }
          if (!Array.isArray(source)) {
            return Promise.resolve({ data: null, error: source.error });
          }
          return Promise.resolve({ data: source.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  }),
}));

function resetFake(tables: Record<string, TableSource>) {
  fake.tables = tables;
  fake.calls.length = 0;
  primeDexCache(null);
  primeDatasetCache(null);
}

describe("normalizePokemonName", () => {
  it.each([
    ["Mr. Mime", "mrmime"],
    ["mr-mime", "mrmime"],
    ["MrMime", "mrmime"],
    ["Farfetch'd", "farfetchd"],
    ["Farfetch’d", "farfetchd"],
    ["Nidoran♀", "nidoranf"],
    ["Nidoran-F", "nidoranf"],
    ["Nidoran F", "nidoranf"],
    ["Nidoran♂", "nidoranm"],
    ["Flabébé", "flabebe"],
    ["Ho-Oh", "hooh"],
    ["Type: Null", "typenull"],
    ["  Alolan   Raichu ", "alolanraichu"],
    // The dataset's prose convention and PokéAPI's slug share one key (13.4).
    ["Rotom (Wash)", "rotomwash"],
    ["rotom-wash", "rotomwash"],
    ["Urshifu (Rapid Strike)", "urshifurapidstrike"],
    ["urshifu-rapid-strike", "urshifurapidstrike"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePokemonName(input)).toBe(expected);
  });
});

describe("toPokeApiSlug", () => {
  it.each([
    ["Alolan Raichu", "raichu-alola"],
    ["raichu-alola", "raichu-alola"],
    ["Alola Raichu", "raichu-alola"],
    ["Galarian Slowbro", "slowbro-galar"],
    ["Hisuian Zoroark", "zoroark-hisui"],
    ["Paldean Wooper", "wooper-paldea"],
    ["Mega Charizard X", "charizard-mega-x"],
    ["Mega Charizard Y", "charizard-mega-y"],
    ["Mega Gyarados", "gyarados-mega"],
    ["Paldean Tauros Blaze", "tauros-paldea-blaze-breed"],
    ["Paldean Tauros Aqua", "tauros-paldea-aqua-breed"],
    ["Paldean Tauros", "tauros-paldea-combat-breed"],
    ["tauros-paldea-blaze", "tauros-paldea-blaze-breed"],
    ["Mr. Mime", "mr-mime"],
    ["Mime Jr.", "mime-jr"],
    ["Galarian Mr. Mime", "mr-mime-galar"],
    ["Nidoran♀", "nidoran-f"],
    ["Nidoran♂", "nidoran-m"],
    ["Nidoran F", "nidoran-f"],
    ["Nidoran-M", "nidoran-m"],
    ["Farfetch'd", "farfetchd"],
    ["Type: Null", "type-null"],
    ["Porygon-Z", "porygon-z"],
    ["Ho-Oh", "ho-oh"],
    ["Tapu Koko", "tapu-koko"],
    ["Flabébé", "flabebe"],
    ["Rotom Wash", "rotom-wash"],
    ["Pikachu", "pikachu"],
    // The dataset's prose convention (13.4): parentheses never reach the slug.
    ["Rotom (Wash)", "rotom-wash"],
    ["Urshifu (Rapid Strike)", "urshifu-rapid-strike"],
    ["Indeedee (Female)", "indeedee-female"],
    ["Toxtricity (Low Key)", "toxtricity-low-key"],
    ["Paldean Tauros (Blaze Breed)", "tauros-paldea-blaze-breed"],
    ["Paldean Tauros (Combat Breed)", "tauros-paldea-combat-breed"],
    ["Calyrex (Shadow Rider)", "calyrex-shadow"],
    ["Ogerpon (Wellspring Mask)", "ogerpon-wellspring-mask"],
    ["Necrozma (Dusk Mane)", "necrozma-dusk"],
    ["Giratina (Origin)", "giratina-origin"],
    ["Zygarde (10%)", "zygarde-10"],
    ["Mega Absol Z", "absol-mega-z"],
    ["Mega Garchomp Z", "garchomp-mega-z"],
    ["Mega Lucario Z", "lucario-mega-z"],
    // Megas of a default variety whose slug carries a suffix (13.4).
    ["Mega Meowstic", "meowstic-male-mega"],
    ["Mega Meowstic (Female)", "meowstic-female-mega"],
    ["Mega Tatsugiri", "tatsugiri-curly-mega"],
    ["Primal Groudon", "groudon-primal"],
    ["Paldean Tauros (Aqua Breed)", "tauros-paldea-aqua-breed"],
  ])("maps %s to %s", (input, expected) => {
    expect(toPokeApiSlug(input)).toBe(expected);
  });

  it("round-trips the committed dataset's display names for every form with a prose name", () => {
    const rows = JSON.parse(
      readFileSync(new URL("../../data/pokemon/pokemon.json", import.meta.url), "utf8")
    ) as Array<{ slug: string; display_name: string }>;
    expect(rows.length).toBeGreaterThan(1000);
    const failing = rows
      .filter((row) => row.display_name.includes("(") && toPokeApiSlug(row.display_name) !== row.slug)
      .map((row) => `${row.display_name} -> ${toPokeApiSlug(row.display_name)} (${row.slug})`);
    // The data track's own quirks (Minior cores, Floette's flower); anything
    // new here is a display name the slug helper cannot reach.
    expect(failing.length).toBeLessThanOrEqual(10);
  });
});

describe("getBaseSpeciesName", () => {
  it("strips Mega/Primal prefixes and X/Y suffixes", () => {
    expect(getBaseSpeciesName("Mega Charizard X")).toBe("Charizard");
    expect(getBaseSpeciesName("Mega Gyarados")).toBe("Gyarados");
    expect(getBaseSpeciesName("Primal Groudon")).toBe("Groudon");
    expect(getBaseSpeciesName("Raichu")).toBe("Raichu");
  });
});

const dex: DexMap = new Map([
  ["raichu", { name: "Raichu", sprite_url: "https://x/raichu.png", type1: "Electric", type2: null }],
  ["charizard", { name: "Charizard", sprite_url: "https://x/charizard.png", type1: "Fire", type2: "Flying" }],
  ["tauros", { name: "Tauros", sprite_url: "https://x/tauros.png", type1: "Normal", type2: null }],
  ["mrmime", { name: "Mr. Mime", sprite_url: "https://x/mr-mime.png", type1: "Psychic", type2: "Fairy" }],
  ["nidoranf", { name: "Nidoran♀", sprite_url: "https://x/nidoran-f.png", type1: "Poison", type2: null }],
]);

// A dataset-shaped dex: every form row under its normalized display name
// and its normalized slug, as `loadDex` keys the `pokemon` table (13.7).
// The types are deliberately not the override table's, so a test that gets
// them knows the dex answered rather than the fallback.
const female = { name: "Indeedee (Female)", sprite_url: "https://x/indeedee-female.png", type1: "Psychic", type2: "Fairy" };
const blaze = { name: "Paldean Tauros (Blaze Breed)", sprite_url: "https://x/tauros-blaze.png", type1: "Fighting", type2: "Flying" };
const formDex: DexMap = new Map([
  ...dex,
  ["indeedeefemale", female],
  ["paldeantaurosblazebreed", blaze],
  ["taurospaldeablazebreed", blaze],
]);

/** `loadDex`'s map for the committed dataset, so form spellings can be checked against real rows. */
function committedDex() {
  const rows = JSON.parse(
    readFileSync(new URL("../../data/pokemon/pokemon.json", import.meta.url), "utf8")
  ) as Array<{ slug: string; display_name: string; sprite_url: string | null; type1: string; type2: string | null }>;
  const map: DexMap = new Map();
  for (const row of rows) {
    const entry = { name: row.display_name, sprite_url: row.sprite_url, type1: row.type1, type2: row.type2 };
    map.set(normalizePokemonName(row.slug), entry);
    map.set(normalizePokemonName(row.display_name), entry);
  }
  return { rows, map };
}

/** Spellings the app already maps to a slug (SPECIAL_SLUGS, region prefixes) and the dataset row they mean. */
const legacySpellings: Array<[string, string]> = [
  ["Indeedee-F", "indeedee-female"],
  ["Paldean Tauros", "tauros-paldea-combat-breed"],
  ["Paldean Tauros Blaze", "tauros-paldea-blaze-breed"],
  ["Paldean Tauros Aqua", "tauros-paldea-aqua-breed"],
  ["Ogerpon Wellspring", "ogerpon-wellspring-mask"],
  ["Bloodmoon Ursaluna", "ursaluna-bloodmoon"],
  ["Galarian Darmanitan", "darmanitan-galar-standard"],
];

describe("getPokemonTypes", () => {
  it.each([
    ["Alolan Raichu", { type1: "Electric", type2: "Psychic" }],
    ["raichu-alola", { type1: "Electric", type2: "Psychic" }],
    ["Mega Charizard X", { type1: "Fire", type2: "Dragon" }],
    ["Mega Charizard Y", { type1: "Fire", type2: "Flying" }],
    ["Paldean Tauros Blaze", { type1: "Fighting", type2: "Fire" }],
    ["Paldean Tauros", { type1: "Fighting", type2: null }],
    ["Mr. Mime", { type1: "Psychic", type2: "Fairy" }],
    ["mr-mime", { type1: "Psychic", type2: "Fairy" }],
    ["Galarian Mr. Mime", { type1: "Ice", type2: "Psychic" }],
    ["Nidoran-F", { type1: "Poison", type2: null }],
    ["Raichu", { type1: "Electric", type2: null }],
  ])("resolves %s", (name, expected) => {
    expect(getPokemonTypes(name, dex)).toEqual(expected);
  });

  it("returns null for unknown names", () => {
    expect(getPokemonTypes("Missingno", dex)).toBeNull();
  });

  it("answers from the override table without a dex", () => {
    expect(getPokemonTypes("Hisuian Zoroark", null)).toEqual({
      type1: "Normal",
      type2: "Ghost",
    });
    expect(getPokemonTypes("Raichu", null)).toBeNull();
  });

  it.each([
    ["Rotom (Wash)", { type1: "Electric", type2: "Water" }],
    ["Urshifu (Rapid Strike)", { type1: "Fighting", type2: "Water" }],
    ["Calyrex (Shadow Rider)", { type1: "Psychic", type2: "Ghost" }],
    ["Paldean Tauros (Blaze Breed)", { type1: "Fighting", type2: "Fire" }],
    ["Alolan Sandshrew", { type1: "Ice", type2: "Steel" }],
  ])("reaches the override table for the prose form name %s (13.7 last fallback)", (name, expected) => {
    expect(getPokemonTypes(name, null)).toEqual(expected);
  });

  it("agrees with the committed dataset on every override it lists", () => {
    const rows = JSON.parse(
      readFileSync(new URL("../../data/pokemon/pokemon.json", import.meta.url), "utf8")
    ) as Array<{ slug: string; type1: string; type2: string | null }>;
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const drift: string[] = [];
    let checked = 0;
    for (const [slug, types] of Object.entries(pokemonTypeOverrides)) {
      const row = bySlug.get(slug);
      if (!row) continue;
      checked += 1;
      if (row.type1 !== types.type1 || row.type2 !== types.type2) {
        drift.push(`${slug}: override ${types.type1}/${types.type2}, dataset ${row.type1}/${row.type2}`);
      }
    }
    expect(checked).toBeGreaterThan(90);
    expect(drift).toEqual([]);
  });

  it("prefers the dex entry for the exact name; the override table is the fallback (13.7)", () => {
    // The dataset keys every row by display name and by slug (13.7).
    const alolan = { name: "Alolan Raichu", sprite_url: null, type1: "Electric", type2: "Fairy" };
    const withForms: DexMap = new Map([...dex, ["alolanraichu", alolan], ["raichualola", alolan]]);
    expect(getPokemonTypes("Alolan Raichu", withForms)).toEqual({ type1: "Electric", type2: "Fairy" });
    expect(getPokemonTypes("raichu-alola", withForms)).toEqual({ type1: "Electric", type2: "Fairy" });
    expect(getPokemonTypes("Galarian Mr. Mime", withForms)).toEqual({ type1: "Ice", type2: "Psychic" });
  });

  it("reaches a dataset row through the slug the app derives, before the override table", () => {
    // "Indeedee-F" and "Paldean Tauros Blaze" are not dataset keys, but the
    // slugs SPECIAL_SLUGS maps them to are (the match findDatasetEntry makes).
    expect(getPokemonTypes("Indeedee-F", formDex)).toEqual({ type1: "Psychic", type2: "Fairy" });
    expect(getPokemonTypes("indeedee female", formDex)).toEqual({ type1: "Psychic", type2: "Fairy" });
    expect(getPokemonTypes("Paldean Tauros Blaze", formDex)).toEqual({ type1: "Fighting", type2: "Flying" });
    expect(getPokemonTypes("tauros-paldea-blaze", formDex)).toEqual({ type1: "Fighting", type2: "Flying" });
    // A species-only dex has no slug keys: the override table still answers.
    expect(getPokemonTypes("Paldean Tauros Blaze", dex)).toEqual({ type1: "Fighting", type2: "Fire" });
    expect(getPokemonTypes("Indeedee-F", dex)).toBeNull();
  });

  it("answers every legacy spelling from the committed dataset's own row", () => {
    const { rows, map } = committedDex();
    for (const [name, slug] of legacySpellings) {
      const row = rows.find((candidate) => candidate.slug === slug);
      expect(row, slug).toBeDefined();
      expect(getPokemonTypes(name, map), name).toEqual({ type1: row!.type1, type2: row!.type2 });
    }
  });
});

describe("getSpriteUrl", () => {
  it("uses the exact entry, then the base species for Mega forms", () => {
    expect(getSpriteUrl("Raichu", dex)).toBe("https://x/raichu.png");
    expect(getSpriteUrl("Mega Charizard X", dex)).toBe("https://x/charizard.png");
    expect(getSpriteUrl("Nidoran♀", dex)).toBe("https://x/nidoran-f.png");
    expect(getSpriteUrl("Missingno", dex)).toBeNull();
    expect(getSpriteUrl("Raichu", null)).toBeNull();
  });

  it("reaches a dataset row through the derived slug instead of a network fetch", () => {
    expect(getSpriteUrl("Indeedee-F", formDex)).toBe("https://x/indeedee-female.png");
    expect(getSpriteUrl("Paldean Tauros Blaze", formDex)).toBe("https://x/tauros-blaze.png");
    expect(getSpriteUrl("Paldean Tauros (Blaze Breed)", formDex)).toBe("https://x/tauros-blaze.png");
    // Without the form row there is nothing to find (PokemonSprite then asks PokéAPI).
    expect(getSpriteUrl("Indeedee-F", dex)).toBeNull();
    expect(getSpriteUrl("Paldean Tauros Blaze", dex)).toBeNull();
  });

  it("finds the committed dataset's sprite for every legacy spelling", () => {
    const { rows, map } = committedDex();
    for (const [name, slug] of legacySpellings) {
      const row = rows.find((candidate) => candidate.slug === slug)!;
      expect(row.sprite_url, slug).toBeTruthy();
      expect(getSpriteUrl(name, map), name).toBe(row.sprite_url);
    }
  });
});

const datasetRows: Row[] = [
  { id: 6, species_id: 6, slug: "charizard", display_name: "Charizard", species_name: "Charizard", form_kind: "default", form_label: null, type1: "Fire", type2: "Flying", hp: 78, attack: 84, defense: 78, special_attack: 109, special_defense: 85, speed: 100, bst: 534, generation: 1, tags: [], games: ["champions", "scarlet_violet"], dex_numbers: { champions: 6 }, sprite_url: "https://x/6.png", updated_at: "2026-09-16T00:00:00Z" },
  { id: 10034, species_id: 6, slug: "charizard-mega-x", display_name: "Mega Charizard X", species_name: "Charizard", form_kind: "mega", form_label: "Mega X", type1: "Fire", type2: "Dragon", hp: 78, attack: 130, defense: 111, special_attack: 130, special_defense: 85, speed: 100, bst: 634, generation: 6, tags: [], games: ["champions"], dex_numbers: {}, sprite_url: "https://x/10034.png", updated_at: "2026-09-16T00:00:00Z" },
  { id: 10008, species_id: 479, slug: "rotom-wash", display_name: "Rotom (Wash)", species_name: "Rotom", form_kind: "other", form_label: "Wash", type1: "Electric", type2: "Water", hp: 50, attack: 65, defense: 107, special_attack: 105, special_defense: 107, speed: 86, bst: 520, generation: 4, tags: [], games: ["scarlet_violet"], dex_numbers: { paldea: 120 }, sprite_url: null, updated_at: null },
];

describe("loadDex", () => {
  beforeEach(() => {
    resetFake({});
  });

  it("reads the pokemon dataset keyed by display name and slug", async () => {
    resetFake({ pokemon: datasetRows });
    const map = await loadDex();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      table: "pokemon",
      select: "display_name, slug, sprite_url, type1, type2",
      orders: ["species_id", "id"],
      range: [0, 999],
    });

    // Both spellings reach the same entry; `name` is the display name.
    expect(map.get("charizardmegax")).toEqual({
      name: "Mega Charizard X",
      sprite_url: "https://x/10034.png",
      type1: "Fire",
      type2: "Dragon",
    });
    expect(map.get("megacharizardx")).toEqual(map.get("charizardmegax"));
    expect(map.get("rotomwash")?.name).toBe("Rotom (Wash)");
    expect(map.get("charizard")?.type2).toBe("Flying");
    // "Rotom (Wash)" and "rotom-wash" normalize to one key, so 4 keys, not 6.
    expect(map.size).toBe(4);
    expect(getCachedDex()).toBe(map);
    expect(getPokemonTypes("rotom-wash")).toEqual({ type1: "Electric", type2: "Water" });
    expect(getSpriteUrl("Mega Charizard X")).toBe("https://x/10034.png");
  });

  it("pages 1000 rows at a time until a short page", async () => {
    const many = Array.from({ length: 1003 }, (_, index) => ({
      display_name: `Mon ${index}`,
      slug: `mon-${index}`,
      sprite_url: null,
      type1: "Normal",
      type2: null,
    }));
    resetFake({ pokemon: many });
    const map = await loadDex();
    expect(fake.calls.map((call) => call.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(map.size).toBe(1003);
  });

  it("falls back to pokemon_dex when the dataset is empty", async () => {
    resetFake({
      pokemon: [],
      pokemon_dex: [
        { name: "Raichu", sprite_url: "https://x/raichu.png", type1: "Electric", type2: null },
        { name: "Raichu", sprite_url: null, type1: null, type2: null },
      ],
    });
    const map = await loadDex();
    expect(fake.calls.map((call) => call.table)).toEqual(["pokemon", "pokemon_dex"]);
    expect(fake.calls[1]).toMatchObject({
      select: "name, sprite_url, type1, type2",
      orders: ["dex_number", "id"],
      range: [0, 999],
    });
    // A later row without values keeps the earlier sprite and types.
    expect(map.get("raichu")).toEqual({
      name: "Raichu",
      sprite_url: "https://x/raichu.png",
      type1: "Electric",
      type2: null,
    });
  });

  it("falls back to pokemon_dex when the dataset table does not exist yet", async () => {
    resetFake({
      pokemon_dex: [{ name: "Pikachu", sprite_url: null, type1: "Electric", type2: null }],
    });
    const map = await loadDex();
    expect(fake.calls.map((call) => call.table)).toEqual(["pokemon", "pokemon_dex"]);
    expect(map.get("pikachu")?.type1).toBe("Electric");
  });

  it("rethrows other dataset errors and retries on the next call", async () => {
    resetFake({ pokemon: { error: { code: "PGRST301", message: "JWT expired" } } });
    await expect(loadDex()).rejects.toMatchObject({ code: "PGRST301" });
    expect(getCachedDex()).toBeNull();

    fake.tables = { pokemon: datasetRows };
    const map = await loadDex();
    expect(map.get("charizard")?.name).toBe("Charizard");
    expect(fake.calls.map((call) => call.table)).toEqual(["pokemon", "pokemon"]);
  });

  it("serves the cached map without another query", async () => {
    resetFake({ pokemon: datasetRows });
    const first = await loadDex();
    const second = await loadDex();
    expect(second).toBe(first);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("loadDataset", () => {
  beforeEach(() => {
    resetFake({});
  });

  it("reads every column of the dataset, ordered by species then id", async () => {
    resetFake({ pokemon: datasetRows });
    const entries = await loadDataset();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      table: "pokemon",
      select: DATASET_COLUMNS,
      orders: ["species_id", "id"],
      range: [0, DATASET_PAGE_SIZE - 1],
    });
    expect(DATASET_PAGE_SIZE).toBe(1000);
    expect(entries.map((entry) => entry.slug)).toEqual(["charizard", "charizard-mega-x", "rotom-wash"]);
    expect(entries[2]).toEqual({
      id: 10008,
      species_id: 479,
      slug: "rotom-wash",
      display_name: "Rotom (Wash)",
      species_name: "Rotom",
      form_kind: "other",
      form_label: "Wash",
      type1: "Electric",
      type2: "Water",
      hp: 50,
      attack: 65,
      defense: 107,
      special_attack: 105,
      special_defense: 107,
      speed: 86,
      bst: 520,
      generation: 4,
      tags: [],
      games: ["scarlet_violet"],
      dex_numbers: { paldea: 120 },
      sprite_url: null,
      updated_at: null,
    });
    expect(getCachedDataset()).toBe(entries);
    expect(await loadDataset()).toBe(entries);
    expect(fake.calls).toHaveLength(1);
  });

  it("returns an empty list for an unseeded table and clears the cache on an error", async () => {
    resetFake({ pokemon: [] });
    expect(await loadDataset()).toEqual([]);

    // The migration has not been applied yet: the fake answers PGRST205 for
    // a table it does not know, which is the unseeded state, not an error.
    resetFake({});
    expect(await loadDataset()).toEqual([]);
    expect(getCachedDataset()).toEqual([]);

    resetFake({ pokemon: { error: { code: "42501", message: "permission denied" } } });
    await expect(loadDataset()).rejects.toMatchObject({ code: "42501" });
    expect(getCachedDataset()).toBeNull();
  });

  it("pages like the dex", async () => {
    const many = Array.from({ length: 1001 }, (_, index) => ({
      ...datasetRows[0],
      id: index + 1,
      species_id: index + 1,
      slug: `mon-${index}`,
      display_name: `Mon ${index}`,
    }));
    resetFake({ pokemon: many });
    expect(await loadDataset()).toHaveLength(1001);
    expect(fake.calls.map((call) => call.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("coerces odd rows and drops rows without an identity", () => {
    expect(toPokemonEntry({ id: 1, slug: "x", display_name: "X", type1: "Bug", tags: "legendary", games: null, dex_numbers: [1], form_kind: "totem" })).toMatchObject({
      species_name: "X",
      form_kind: "other",
      tags: [],
      games: [],
      dex_numbers: {},
      bst: 0,
      generation: 1,
    });
    expect(toPokemonEntry({ id: 1, slug: "x", display_name: "X", type1: "Bug", hp: 10, attack: 10, defense: 10, special_attack: 10, special_defense: 10, speed: 10 })?.bst).toBe(60);
    expect(toPokemonEntry({ slug: "x", display_name: "X", type1: "Bug" })).toBeNull();
    expect(toPokemonEntry({ id: 1, slug: "x", display_name: "X" })).toBeNull();
    expect(toPokemonEntry(null)).toBeNull();
  });

  it("finds an entry by display name or slug, ignoring spelling", async () => {
    resetFake({ pokemon: datasetRows });
    const entries = await loadDataset();
    expect(findDatasetEntry(entries, "rotom-wash")?.display_name).toBe("Rotom (Wash)");
    expect(findDatasetEntry(entries, "ROTOM (wash)")?.slug).toBe("rotom-wash");
    expect(findDatasetEntry(entries, "mega charizard x")?.slug).toBe("charizard-mega-x");
    expect(findDatasetEntry(entries, "Charizard-Mega-X")?.display_name).toBe("Mega Charizard X");
    expect(findDatasetEntry(entries, "Missingno")).toBeNull();
    expect(findDatasetEntry(entries, "   ")).toBeNull();
  });

  it("falls back to the slug the app derives, so legacy spellings land on one row", () => {
    const tauros = (slug: string, displayName: string, formLabel: string, type2: string | null) =>
      toPokemonEntry({
        ...datasetRows[0],
        id: slug.length,
        species_id: 128,
        slug,
        display_name: displayName,
        species_name: "Tauros",
        form_kind: "regional",
        form_label: formLabel,
        type1: "Fighting",
        type2,
      })!;
    const entries = [
      ...datasetRows.map((row) => toPokemonEntry(row)!),
      tauros("tauros-paldea-combat-breed", "Paldean Tauros (Combat Breed)", "Combat Breed", null),
      tauros("tauros-paldea-blaze-breed", "Paldean Tauros (Blaze Breed)", "Blaze Breed", "Fire"),
      tauros("tauros-paldea-aqua-breed", "Paldean Tauros (Aqua Breed)", "Aqua Breed", "Water"),
    ];
    // The spellings SPECIAL_SLUGS already knows resolve to the dataset's name.
    expect(findDatasetEntry(entries, "Paldean Tauros")?.display_name).toBe("Paldean Tauros (Combat Breed)");
    expect(findDatasetEntry(entries, "Paldean Tauros Blaze")?.display_name).toBe("Paldean Tauros (Blaze Breed)");
    expect(findDatasetEntry(entries, "paldea tauros aqua")?.slug).toBe("tauros-paldea-aqua-breed");
    expect(findDatasetEntry(entries, "Paldean Tauros (Aqua Breed)")?.slug).toBe("tauros-paldea-aqua-breed");
    expect(findDatasetEntry(entries, "Rotom Wash")?.display_name).toBe("Rotom (Wash)");
    // A display-name match still wins over a derived slug.
    expect(findDatasetEntry(entries, "Mega Charizard X")?.slug).toBe("charizard-mega-x");
    expect(findDatasetEntry(entries, "Paldean Wooper")).toBeNull();
  });
});
