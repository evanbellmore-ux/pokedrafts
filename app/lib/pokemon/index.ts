import { createClient } from "@/app/lib/supabase/client";

/**
 * Pokémon naming, dex loading and type lookup, shared by every page.
 *
 * - `normalizePokemonName` collapses spelling variants into one lookup key
 *   ("Mr. Mime", "mr-mime", "MrMime" -> "mrmime").
 * - `toPokeApiSlug` maps a display name to the PokeAPI slug used for sprite
 *   fallbacks ("Alolan Raichu" -> "raichu-alola").
 * - `loadDex` reads the `pokemon` dataset once per session (paginated) into
 *   a map of normalized display name and normalized slug -> { name,
 *   sprite_url, type1, type2 }, so every form resolves by either spelling;
 *   it falls back to `pokemon_dex` when the dataset has not been seeded
 *   (docs/release-architecture.md 13.7).
 * - `getPokemonTypes` answers from the dex entry for the exact name, then
 *   the regional/mega override table, then the base species (Mega forms).
 */

export type PokemonTypes = {
  type1: string | null;
  type2: string | null;
};

export type DexEntry = PokemonTypes & {
  name: string;
  sprite_url: string | null;
};

export type DexMap = Map<string, DexEntry>;

const DEX_PAGE_SIZE = 1000;
const DEX_MAX_PAGES = 20;

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function replaceGenderSymbols(value: string) {
  return value.replace(/♀/g, " f").replace(/♂/g, " m");
}

/**
 * Lowercase key with punctuation, spaces, hyphens, parentheses and accents
 * removed, so the dataset's prose form names and PokéAPI's slugs share one
 * key: "Rotom (Wash)" and "rotom-wash" both become "rotomwash" (13.4).
 */
export function normalizePokemonName(name: string): string {
  return stripDiacritics(replaceGenderSymbols(name))
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[.:()\s-]/g, "");
}

const REGION_ALIASES: Record<string, string> = {
  alolan: "alola",
  alola: "alola",
  galarian: "galar",
  galar: "galar",
  hisuian: "hisui",
  hisui: "hisui",
  paldean: "paldea",
  paldea: "paldea",
};

/** Names whose PokeAPI slug cannot be derived mechanically. */
const SPECIAL_SLUGS: Record<string, string> = {
  "nidoran f": "nidoran-f",
  "nidoran-f": "nidoran-f",
  "nidoran female": "nidoran-f",
  "nidoran m": "nidoran-m",
  "nidoran-m": "nidoran-m",
  "nidoran male": "nidoran-m",
  "mr mime": "mr-mime",
  "mr. mime": "mr-mime",
  "mime jr": "mime-jr",
  "mime jr.": "mime-jr",
  "mr rime": "mr-rime",
  "mr. rime": "mr-rime",
  "galarian mr mime": "mr-mime-galar",
  "galarian mr. mime": "mr-mime-galar",
  "type null": "type-null",
  "type: null": "type-null",
  farfetchd: "farfetchd",
  "farfetch'd": "farfetchd",
  sirfetchd: "sirfetchd",
  "sirfetch'd": "sirfetchd",
  "galarian farfetch'd": "farfetchd-galar",
  "galarian farfetchd": "farfetchd-galar",
  "ho-oh": "ho-oh",
  "porygon-z": "porygon-z",
  "porygon z": "porygon-z",
  "jangmo-o": "jangmo-o",
  "hakamo-o": "hakamo-o",
  "kommo-o": "kommo-o",
  flabebe: "flabebe",
  "flabébé": "flabebe",
  "paldean tauros": "tauros-paldea-combat-breed",
  "paldea tauros": "tauros-paldea-combat-breed",
  "tauros-paldea": "tauros-paldea-combat-breed",
  "tauros-paldea-combat": "tauros-paldea-combat-breed",
  "tauros-paldea-combat-breed": "tauros-paldea-combat-breed",
  "paldean tauros combat": "tauros-paldea-combat-breed",
  "paldean tauros combat breed": "tauros-paldea-combat-breed",
  "paldean tauros blaze": "tauros-paldea-blaze-breed",
  "paldean tauros blaze breed": "tauros-paldea-blaze-breed",
  "paldea tauros blaze": "tauros-paldea-blaze-breed",
  "tauros-paldea-blaze": "tauros-paldea-blaze-breed",
  "tauros-paldea-blaze-breed": "tauros-paldea-blaze-breed",
  "paldean tauros aqua": "tauros-paldea-aqua-breed",
  "paldean tauros aqua breed": "tauros-paldea-aqua-breed",
  "paldea tauros aqua": "tauros-paldea-aqua-breed",
  "tauros-paldea-aqua": "tauros-paldea-aqua-breed",
  "tauros-paldea-aqua-breed": "tauros-paldea-aqua-breed",
  "giratina origin": "giratina-origin",
  "giratina-origin": "giratina-origin",
  "giratina altered": "giratina-altered",
  "shaymin sky": "shaymin-sky",
  "deoxys attack": "deoxys-attack",
  "deoxys defense": "deoxys-defense",
  "deoxys speed": "deoxys-speed",
  "wormadam plant": "wormadam-plant",
  "wormadam sandy": "wormadam-sandy",
  "wormadam trash": "wormadam-trash",
  "basculin blue-striped": "basculin-blue-striped",
  "basculin white-striped": "basculin-white-striped",
  "darmanitan zen": "darmanitan-zen",
  "galarian darmanitan": "darmanitan-galar-standard",
  "keldeo resolute": "keldeo-resolute",
  "meloetta pirouette": "meloetta-pirouette",
  "aegislash blade": "aegislash-blade",
  "hoopa unbound": "hoopa-unbound",
  "oricorio pom-pom": "oricorio-pom-pom",
  "oricorio pau": "oricorio-pau",
  "oricorio sensu": "oricorio-sensu",
  "lycanroc midnight": "lycanroc-midnight",
  "lycanroc dusk": "lycanroc-dusk",
  "wishiwashi school": "wishiwashi-school",
  "minior meteor": "minior-red-meteor",
  "necrozma dusk mane": "necrozma-dusk",
  "necrozma dawn wings": "necrozma-dawn",
  "necrozma ultra": "necrozma-ultra",
  "toxtricity low key": "toxtricity-low-key",
  "eiscue noice": "eiscue-noice",
  "indeedee female": "indeedee-female",
  "indeedee-f": "indeedee-female",
  "morpeko hangry": "morpeko-hangry",
  "zacian crowned": "zacian-crowned",
  "zamazenta crowned": "zamazenta-crowned",
  "eternatus eternamax": "eternatus-eternamax",
  "urshifu rapid strike": "urshifu-rapid-strike",
  "urshifu single strike": "urshifu-single-strike",
  "calyrex ice rider": "calyrex-ice",
  "calyrex shadow rider": "calyrex-shadow",
  "enamorus therian": "enamorus-therian",
  "tornadus therian": "tornadus-therian",
  "thundurus therian": "thundurus-therian",
  "landorus therian": "landorus-therian",
  "oinkologne female": "oinkologne-female",
  "palafin hero": "palafin-hero",
  "gimmighoul roaming": "gimmighoul-roaming",
  "ogerpon wellspring": "ogerpon-wellspring-mask",
  "ogerpon hearthflame": "ogerpon-hearthflame-mask",
  "ogerpon cornerstone": "ogerpon-cornerstone-mask",
  "terapagos terastal": "terapagos-terastal",
  "ursaluna bloodmoon": "ursaluna-bloodmoon",
  "bloodmoon ursaluna": "ursaluna-bloodmoon",
  // Megas of a species whose default variety carries a suffix in PokéAPI
  // (meowstic-male, tatsugiri-curly): "<species>-mega" does not exist.
  "mega meowstic": "meowstic-male-mega",
  "mega tatsugiri": "tatsugiri-curly-mega",
};

/**
 * Hyphenated lowercase form of a name. Parentheses are dropped so the
 * dataset's prose convention (13.4) slugs like PokéAPI: "Rotom (Wash)" ->
 * "rotom-wash", "Urshifu (Rapid Strike)" -> "urshifu-rapid-strike".
 */
function slugify(value: string) {
  return stripDiacritics(replaceGenderSymbols(value))
    .toLowerCase()
    .replace(/[’'`.()%]/g, "")
    .replace(/:/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * The special-slug entry for a name, tried as typed, hyphenated and with
 * the hyphens turned back into spaces, so "Calyrex (Shadow Rider)",
 * "calyrex-shadow-rider" and "Calyrex Shadow Rider" all reach one key.
 */
function lookupSpecialSlug(lower: string): string | undefined {
  const hyphenated = slugify(lower);
  return (
    SPECIAL_SLUGS[lower] ??
    SPECIAL_SLUGS[hyphenated] ??
    SPECIAL_SLUGS[hyphenated.replace(/-/g, " ")]
  );
}

/** PokeAPI `pokemon` endpoint slug for a display name. */
export function toPokeApiSlug(name: string): string {
  const clean = name.trim();
  const lower = clean.toLowerCase().replace(/\s+/g, " ");

  const special = lookupSpecialSlug(lower);
  if (special) return special;

  for (const [inputRegion, apiRegion] of Object.entries(REGION_ALIASES)) {
    const prefix = `${inputRegion} `;
    const suffix = `-${inputRegion}`;

    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      const base = lookupSpecialSlug(rest) ?? slugify(rest);
      return `${base}-${apiRegion}`;
    }

    if (lower.endsWith(suffix)) {
      const rest = lower.slice(0, -suffix.length);
      const base = lookupSpecialSlug(rest) ?? slugify(rest);
      return `${base}-${apiRegion}`;
    }
  }

  if (lower.startsWith("mega ")) {
    const base = slugify(lower.slice("mega ".length));

    if (base.endsWith("-x")) return base.replace(/-x$/, "-mega-x");
    if (base.endsWith("-y")) return base.replace(/-y$/, "-mega-y");
    // Legends Z-A's "Mega Absol Z" is absol-mega-z (13.4).
    if (base.endsWith("-z")) return base.replace(/-z$/, "-mega-z");

    return `${base}-mega`;
  }

  if (lower.startsWith("primal ")) {
    return `${slugify(lower.slice("primal ".length))}-primal`;
  }

  return slugify(lower);
}

/**
 * Regional forms and Mega Evolutions whose typing differs from the base
 * species. Keys are lowercase prose ("Alolan Raichu") and slug style
 * ("raichu-alola"); lookups try the raw lowercase name and the slug.
 */
const TYPE_OVERRIDES: Record<string, PokemonTypes> = {
  // Alola
  "raichu-alola": { type1: "Electric", type2: "Psychic" },
  "sandshrew-alola": { type1: "Ice", type2: "Steel" },
  "sandslash-alola": { type1: "Ice", type2: "Steel" },
  "vulpix-alola": { type1: "Ice", type2: null },
  "ninetales-alola": { type1: "Ice", type2: "Fairy" },
  "diglett-alola": { type1: "Ground", type2: "Steel" },
  "dugtrio-alola": { type1: "Ground", type2: "Steel" },
  "meowth-alola": { type1: "Dark", type2: null },
  "persian-alola": { type1: "Dark", type2: null },
  "geodude-alola": { type1: "Rock", type2: "Electric" },
  "graveler-alola": { type1: "Rock", type2: "Electric" },
  "golem-alola": { type1: "Rock", type2: "Electric" },
  "grimer-alola": { type1: "Poison", type2: "Dark" },
  "muk-alola": { type1: "Poison", type2: "Dark" },
  "exeggutor-alola": { type1: "Grass", type2: "Dragon" },
  "marowak-alola": { type1: "Fire", type2: "Ghost" },
  "rattata-alola": { type1: "Dark", type2: "Normal" },
  "raticate-alola": { type1: "Dark", type2: "Normal" },
  // Galar
  "meowth-galar": { type1: "Steel", type2: null },
  "ponyta-galar": { type1: "Psychic", type2: null },
  "rapidash-galar": { type1: "Psychic", type2: "Fairy" },
  "slowpoke-galar": { type1: "Psychic", type2: null },
  "slowbro-galar": { type1: "Poison", type2: "Psychic" },
  "slowking-galar": { type1: "Poison", type2: "Psychic" },
  "farfetchd-galar": { type1: "Fighting", type2: null },
  "weezing-galar": { type1: "Poison", type2: "Fairy" },
  "mr-mime-galar": { type1: "Ice", type2: "Psychic" },
  "articuno-galar": { type1: "Psychic", type2: "Flying" },
  "zapdos-galar": { type1: "Fighting", type2: "Flying" },
  "moltres-galar": { type1: "Dark", type2: "Flying" },
  "corsola-galar": { type1: "Ghost", type2: null },
  "zigzagoon-galar": { type1: "Dark", type2: "Normal" },
  "linoone-galar": { type1: "Dark", type2: "Normal" },
  "darumaka-galar": { type1: "Ice", type2: null },
  "darmanitan-galar": { type1: "Ice", type2: null },
  "darmanitan-galar-standard": { type1: "Ice", type2: null },
  "yamask-galar": { type1: "Ground", type2: "Ghost" },
  "stunfisk-galar": { type1: "Ground", type2: "Steel" },
  // Hisui
  "growlithe-hisui": { type1: "Fire", type2: "Rock" },
  "arcanine-hisui": { type1: "Fire", type2: "Rock" },
  "voltorb-hisui": { type1: "Electric", type2: "Grass" },
  "electrode-hisui": { type1: "Electric", type2: "Grass" },
  "typhlosion-hisui": { type1: "Fire", type2: "Ghost" },
  "qwilfish-hisui": { type1: "Dark", type2: "Poison" },
  "sneasel-hisui": { type1: "Fighting", type2: "Poison" },
  "samurott-hisui": { type1: "Water", type2: "Dark" },
  "lilligant-hisui": { type1: "Grass", type2: "Fighting" },
  "zorua-hisui": { type1: "Normal", type2: "Ghost" },
  "zoroark-hisui": { type1: "Normal", type2: "Ghost" },
  "braviary-hisui": { type1: "Psychic", type2: "Flying" },
  "sliggoo-hisui": { type1: "Steel", type2: "Dragon" },
  "goodra-hisui": { type1: "Steel", type2: "Dragon" },
  "avalugg-hisui": { type1: "Ice", type2: "Rock" },
  "decidueye-hisui": { type1: "Grass", type2: "Fighting" },
  // Paldea
  "tauros-paldea-combat-breed": { type1: "Fighting", type2: null },
  "tauros-paldea-blaze-breed": { type1: "Fighting", type2: "Fire" },
  "tauros-paldea-aqua-breed": { type1: "Fighting", type2: "Water" },
  "wooper-paldea": { type1: "Poison", type2: "Ground" },
  // Rotom and other forms
  "rotom-wash": { type1: "Electric", type2: "Water" },
  "rotom-mow": { type1: "Electric", type2: "Grass" },
  "rotom-heat": { type1: "Electric", type2: "Fire" },
  "rotom-fan": { type1: "Electric", type2: "Flying" },
  "rotom-frost": { type1: "Electric", type2: "Ice" },
  "lycanroc-dusk": { type1: "Rock", type2: null },
  "lycanroc-midnight": { type1: "Rock", type2: null },
  "shaymin-sky": { type1: "Grass", type2: "Flying" },
  "giratina-origin": { type1: "Ghost", type2: "Dragon" },
  "darmanitan-zen": { type1: "Fire", type2: "Psychic" },
  "meloetta-pirouette": { type1: "Normal", type2: "Fighting" },
  "hoopa-unbound": { type1: "Psychic", type2: "Dark" },
  "oricorio-pom-pom": { type1: "Electric", type2: "Flying" },
  "oricorio-pau": { type1: "Psychic", type2: "Flying" },
  "oricorio-sensu": { type1: "Ghost", type2: "Flying" },
  "necrozma-dusk": { type1: "Psychic", type2: "Steel" },
  "necrozma-dawn": { type1: "Psychic", type2: "Ghost" },
  "necrozma-ultra": { type1: "Psychic", type2: "Dragon" },
  "zacian-crowned": { type1: "Fairy", type2: "Steel" },
  "zamazenta-crowned": { type1: "Fighting", type2: "Steel" },
  "urshifu-rapid-strike": { type1: "Fighting", type2: "Water" },
  "calyrex-ice": { type1: "Psychic", type2: "Ice" },
  "calyrex-shadow": { type1: "Psychic", type2: "Ghost" },
  "ogerpon-wellspring-mask": { type1: "Grass", type2: "Water" },
  "ogerpon-hearthflame-mask": { type1: "Grass", type2: "Fire" },
  "ogerpon-cornerstone-mask": { type1: "Grass", type2: "Rock" },
  "ursaluna-bloodmoon": { type1: "Ground", type2: "Normal" },
  // Megas whose typing changes from the base species
  "charizard-mega-x": { type1: "Fire", type2: "Dragon" },
  "mewtwo-mega-x": { type1: "Psychic", type2: "Fighting" },
  "pinsir-mega": { type1: "Bug", type2: "Flying" },
  "gyarados-mega": { type1: "Water", type2: "Dark" },
  "aggron-mega": { type1: "Steel", type2: null },
  "ampharos-mega": { type1: "Electric", type2: "Dragon" },
  "sceptile-mega": { type1: "Grass", type2: "Dragon" },
  "altaria-mega": { type1: "Dragon", type2: "Fairy" },
  "lopunny-mega": { type1: "Normal", type2: "Fighting" },
  "audino-mega": { type1: "Normal", type2: "Fairy" },
  // Primal
  "groudon-primal": { type1: "Ground", type2: "Fire" },
};

/** Exported for tests and for the pool builder's validation. */
export const pokemonTypeOverrides: Readonly<Record<string, PokemonTypes>> =
  TYPE_OVERRIDES;

/** Base species name used for dex lookups of Mega/Primal forms. */
export function getBaseSpeciesName(name: string): string {
  return name
    .replace(/^(mega|primal)\s+/i, "")
    .replace(/\s+[XY]$/i, "")
    .trim();
}

let dexPromise: Promise<DexMap> | null = null;
let dexCache: DexMap | null = null;

/** Synchronously returns the dex if it has already been loaded. */
export function getCachedDex(): DexMap | null {
  return dexCache;
}

type SupabaseLike = ReturnType<typeof createClient>;

type DexRow = {
  name: string | null;
  slug?: string | null;
  sprite_url: string | null;
  type1: string | null;
  type2: string | null;
};

/** Adds a row under `key`, keeping earlier sprite/type values when the row lacks them. */
function putDexRow(map: DexMap, key: string, row: DexRow & { name: string }) {
  if (!key) return;
  const existing = map.get(key);
  map.set(key, {
    name: row.name,
    sprite_url: row.sprite_url ?? existing?.sprite_url ?? null,
    type1: row.type1 ?? existing?.type1 ?? null,
    type2: row.type2 ?? existing?.type2 ?? null,
  });
}

/** PostgREST's "table not in the schema cache" and Postgres' "relation does not exist". */
export function isMissingTable(error: { code?: string | null } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/**
 * Reads the `pokemon` dataset (13.4) page by page. Returns null when the
 * table is empty or does not exist yet, so the caller can fall back.
 */
async function readDataset(supabase: SupabaseLike): Promise<DexMap | null> {
  const map: DexMap = new Map();
  let rowsSeen = 0;

  for (let page = 0; page < DEX_MAX_PAGES; page += 1) {
    const from = page * DEX_PAGE_SIZE;
    const { data, error } = await supabase
      .from("pokemon")
      .select("display_name, slug, sprite_url, type1, type2")
      .order("species_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + DEX_PAGE_SIZE - 1);

    if (error) {
      if (page === 0 && isMissingTable(error)) return null;
      throw error;
    }

    const rows = (data ?? []) as Array<{
      display_name: string | null;
      slug: string | null;
      sprite_url: string | null;
      type1: string | null;
      type2: string | null;
    }>;
    rowsSeen += rows.length;

    for (const row of rows) {
      if (!row.display_name) continue;
      const entry = { ...row, name: row.display_name };
      // Slug first, display name second, so a display name wins when two
      // rows normalize to the same key.
      if (row.slug) putDexRow(map, normalizePokemonName(row.slug), entry);
      putDexRow(map, normalizePokemonName(row.display_name), entry);
    }

    if (rows.length < DEX_PAGE_SIZE) break;
  }

  return rowsSeen === 0 ? null : map;
}

/** The pre-dataset `pokemon_dex` species table (one row per species). */
async function readLegacyDex(supabase: SupabaseLike): Promise<DexMap> {
  const map: DexMap = new Map();

  for (let page = 0; page < DEX_MAX_PAGES; page += 1) {
    const from = page * DEX_PAGE_SIZE;
    const { data, error } = await supabase
      .from("pokemon_dex")
      .select("name, sprite_url, type1, type2")
      .order("dex_number", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + DEX_PAGE_SIZE - 1);

    if (error) throw error;

    const rows = (data ?? []) as DexRow[];
    for (const row of rows) {
      if (!row.name) continue;
      putDexRow(map, normalizePokemonName(row.name), { ...row, name: row.name });
    }

    if (rows.length < DEX_PAGE_SIZE) break;
  }

  return map;
}

/**
 * Loads the dex once per session (paginated until exhausted): the `pokemon`
 * dataset keyed by normalized display name and normalized slug, or
 * `pokemon_dex` when the dataset is empty or missing (a project that has not
 * run the seed yet). A failed load clears the cache so the next call retries.
 */
export function loadDex(): Promise<DexMap> {
  if (dexPromise) return dexPromise;

  dexPromise = (async () => {
    const supabase = createClient();
    const map = (await readDataset(supabase)) ?? (await readLegacyDex(supabase));
    dexCache = map;
    return map;
  })().catch((error) => {
    dexPromise = null;
    throw error;
  });

  return dexPromise;
}

/** Test hook: replaces the module cache. */
export function primeDexCache(map: DexMap | null) {
  dexCache = map;
  dexPromise = map ? Promise.resolve(map) : null;
}

function lookupOverride(name: string): PokemonTypes | null {
  const lower = name.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    TYPE_OVERRIDES[lower] ??
    TYPE_OVERRIDES[toPokeApiSlug(lower)] ??
    TYPE_OVERRIDES[slugify(lower)] ??
    null
  );
}

/**
 * The dex entry for a name: the exact key, then the key of the PokéAPI slug
 * the app derives from it, so the spellings `SPECIAL_SLUGS` and the region
 * prefixes already map ("Indeedee-F", "Paldean Tauros Blaze") reach the
 * dataset row keyed by its slug ("indeedee-female") the way
 * `findDatasetEntry` does. A species-only dex has no slug keys, so for it
 * the second lookup misses and the callers fall through as before.
 */
function lookupDex(dex: DexMap, name: string): DexEntry | undefined {
  return (
    dex.get(normalizePokemonName(name)) ??
    dex.get(normalizePokemonName(toPokeApiSlug(name)))
  );
}

/**
 * Types for a display name: the dex entry for the exact name or its derived
 * slug (the dataset carries every form), then the override table, then the
 * base species (for Mega/Primal forms a species-only dex does not list).
 */
export function getPokemonTypes(
  name: string,
  dex: DexMap | null = dexCache
): PokemonTypes | null {
  const direct = dex ? lookupDex(dex, name) : undefined;
  if (direct?.type1) return { type1: direct.type1, type2: direct.type2 };

  const override = lookupOverride(name);
  if (override) return override;

  if (!dex) return null;

  const base = dex.get(normalizePokemonName(getBaseSpeciesName(name)));
  if (base?.type1) return { type1: base.type1, type2: base.type2 };

  return null;
}

/** Sprite URL from the dex for a display name (exact or derived slug, then base species). */
export function getSpriteUrl(
  name: string,
  dex: DexMap | null = dexCache
): string | null {
  if (!dex) return null;
  const direct = lookupDex(dex, name);
  if (direct?.sprite_url) return direct.sprite_url;
  const base = dex.get(normalizePokemonName(getBaseSpeciesName(name)));
  return base?.sprite_url ?? null;
}

/** PokeAPI fallback for names missing from the dex. Returns null on 404. */
export async function fetchPokeApiSprite(name: string): Promise<string | null> {
  const slug = toPokeApiSlug(name);
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    sprites?: {
      front_default?: string | null;
      other?: { "official-artwork"?: { front_default?: string | null } };
    };
  };

  return (
    data.sprites?.front_default ??
    data.sprites?.other?.["official-artwork"]?.front_default ??
    null
  );
}
