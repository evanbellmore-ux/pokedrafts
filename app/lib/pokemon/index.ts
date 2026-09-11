import { createClient } from "@/app/lib/supabase/client";

/**
 * Pokémon naming, dex loading and type lookup, shared by every page.
 *
 * - `normalizePokemonName` collapses spelling variants into one lookup key
 *   ("Mr. Mime", "mr-mime", "MrMime" -> "mrmime").
 * - `toPokeApiSlug` maps a display name to the PokeAPI slug used for sprite
 *   fallbacks ("Alolan Raichu" -> "raichu-alola").
 * - `loadDex` reads `pokemon_dex` once per session (paginated) into a map of
 *   normalized name -> { sprite_url, type1, type2 }.
 * - `getPokemonTypes` consults the regional/mega override table first, then
 *   the dex (falling back to the base species for Mega forms).
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

/** Lowercase key with punctuation, spaces, hyphens and accents removed. */
export function normalizePokemonName(name: string): string {
  return stripDiacritics(replaceGenderSymbols(name))
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[.:\s-]/g, "");
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
  "paldean tauros blaze": "tauros-paldea-blaze-breed",
  "paldea tauros blaze": "tauros-paldea-blaze-breed",
  "tauros-paldea-blaze": "tauros-paldea-blaze-breed",
  "tauros-paldea-blaze-breed": "tauros-paldea-blaze-breed",
  "paldean tauros aqua": "tauros-paldea-aqua-breed",
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
};

function slugify(value: string) {
  return stripDiacritics(replaceGenderSymbols(value))
    .toLowerCase()
    .replace(/[’'`.]/g, "")
    .replace(/:/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** PokeAPI `pokemon` endpoint slug for a display name. */
export function toPokeApiSlug(name: string): string {
  const clean = name.trim();
  const lower = clean.toLowerCase().replace(/\s+/g, " ");

  const special = SPECIAL_SLUGS[lower] ?? SPECIAL_SLUGS[slugify(lower)];
  if (special) return special;

  for (const [inputRegion, apiRegion] of Object.entries(REGION_ALIASES)) {
    const prefix = `${inputRegion} `;
    const suffix = `-${inputRegion}`;

    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      const restSpecial = SPECIAL_SLUGS[rest];
      const base = restSpecial ?? slugify(rest);
      return `${base}-${apiRegion}`;
    }

    if (lower.endsWith(suffix)) {
      const rest = lower.slice(0, -suffix.length);
      const restSpecial = SPECIAL_SLUGS[rest];
      const base = restSpecial ?? slugify(rest);
      return `${base}-${apiRegion}`;
    }
  }

  if (lower.startsWith("mega ")) {
    const base = slugify(lower.slice("mega ".length));

    if (base.endsWith("-x")) return base.replace(/-x$/, "-mega-x");
    if (base.endsWith("-y")) return base.replace(/-y$/, "-mega-y");

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
  "sandshrew-alola": { type1: "Ice", type2: null },
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

/**
 * Loads `pokemon_dex` once per session (paginated until exhausted). A failed
 * load clears the cache so the next call retries.
 */
export function loadDex(): Promise<DexMap> {
  if (dexPromise) return dexPromise;

  dexPromise = (async () => {
    const supabase = createClient();
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

      const rows = (data ?? []) as Array<{
        name: string | null;
        sprite_url: string | null;
        type1: string | null;
        type2: string | null;
      }>;

      for (const row of rows) {
        if (!row.name) continue;
        const key = normalizePokemonName(row.name);
        const existing = map.get(key);
        map.set(key, {
          name: row.name,
          sprite_url: row.sprite_url ?? existing?.sprite_url ?? null,
          type1: row.type1 ?? existing?.type1 ?? null,
          type2: row.type2 ?? existing?.type2 ?? null,
        });
      }

      if (rows.length < DEX_PAGE_SIZE) break;
    }

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
 * Types for a display name. Override table first, then the dex entry for
 * the exact name, then the base species (for Mega/Primal forms).
 */
export function getPokemonTypes(
  name: string,
  dex: DexMap | null = dexCache
): PokemonTypes | null {
  const override = lookupOverride(name);
  if (override) return override;

  if (!dex) return null;

  const direct = dex.get(normalizePokemonName(name));
  if (direct?.type1) return { type1: direct.type1, type2: direct.type2 };

  const base = dex.get(normalizePokemonName(getBaseSpeciesName(name)));
  if (base?.type1) return { type1: base.type1, type2: base.type2 };

  return null;
}

/** Sprite URL from the dex for a display name (exact, then base species). */
export function getSpriteUrl(
  name: string,
  dex: DexMap | null = dexCache
): string | null {
  if (!dex) return null;
  const direct = dex.get(normalizePokemonName(name));
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
