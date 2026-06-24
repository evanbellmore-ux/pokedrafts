import { createClient } from "@/app/lib/supabase/client";

export type PokemonSpriteMap = Record<string, string>;

export function normalizePokemonName(name: string) {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[.\s-]/g, "");
}

export function toPokeApiSlug(name: string) {
  const clean = name.trim();
  const lower = clean.toLowerCase();

  // Paldean Tauros exceptions first
  if (lower === "paldean tauros") return "tauros-paldea-combat-breed";
  if (lower === "paldea tauros") return "tauros-paldea-combat-breed";
  if (lower === "tauros-paldea") return "tauros-paldea-combat-breed";
  if (lower === "tauros-paldea-combat") return "tauros-paldea-combat-breed";
  if (lower === "tauros-paldea-combat-breed") return "tauros-paldea-combat-breed";

  if (lower === "paldean tauros blaze") return "tauros-paldea-blaze-breed";
  if (lower === "paldea tauros blaze") return "tauros-paldea-blaze-breed";
  if (lower === "tauros-paldea-blaze") return "tauros-paldea-blaze-breed";
  if (lower === "tauros-paldea-blaze-breed") return "tauros-paldea-blaze-breed";

  if (lower === "paldean tauros aqua") return "tauros-paldea-aqua-breed";
  if (lower === "paldea tauros aqua") return "tauros-paldea-aqua-breed";
  if (lower === "tauros-paldea-aqua") return "tauros-paldea-aqua-breed";
  if (lower === "tauros-paldea-aqua-breed") return "tauros-paldea-aqua-breed";

  const regionAliases: Record<string, string> = {
    alolan: "alola",
    alola: "alola",
    galarian: "galar",
    galar: "galar",
    hisuian: "hisui",
    hisui: "hisui",
    paldean: "paldea",
    paldea: "paldea",
  };

  for (const [inputRegion, apiRegion] of Object.entries(regionAliases)) {
    const prefix = `${inputRegion} `;
    const suffix = `-${inputRegion}`;

    if (lower.startsWith(prefix)) {
      const base = lower.slice(prefix.length).replace(/\s+/g, "-");
      return `${base}-${apiRegion}`;
    }

    if (lower.endsWith(suffix)) {
      const base = lower.slice(0, -suffix.length).replace(/\s+/g, "-");
      return `${base}-${apiRegion}`;
    }
  }

  if (lower.startsWith("mega ")) {
    const base = lower.replace("mega ", "").replace(/\s+/g, "-");

    if (base.endsWith("-x")) return base.replace(/-x$/, "-mega-x");
    if (base.endsWith("-y")) return base.replace(/-y$/, "-mega-y");

    return `${base}-mega`;
  }

  return lower.replace(/\s+/g, "-");
}

export async function loadLocalSpriteMap() {
  const supabase = createClient();

  const first = await supabase
    .from("pokemon_dex")
    .select("name, sprite_url")
    .order("dex_number", { ascending: true })
    .range(0, 999);

  const second = await supabase
    .from("pokemon_dex")
    .select("name, sprite_url")
    .order("dex_number", { ascending: true })
    .range(1000, 1024);

  const map: PokemonSpriteMap = {};

  [...(first.data ?? []), ...(second.data ?? [])].forEach((entry) => {
    if (entry.name && entry.sprite_url) {
      map[normalizePokemonName(entry.name)] = entry.sprite_url;
    }
  });

  return map;
}

export async function getPokeApiSprite(name: string) {
  const slug = toPokeApiSlug(name);

  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);

  if (!res.ok) return null;

  const data = await res.json();

  return (
    data.sprites?.front_default ??
    data.sprites?.other?.["official-artwork"]?.front_default ??
    null
  );
}