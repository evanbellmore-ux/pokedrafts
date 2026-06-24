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

  if (clean === "Paldean Tauros") return "tauros-paldea-combat-breed";
  if (clean === "Paldean Tauros Blaze") return "tauros-paldea-blaze-breed";
  if (clean === "Paldean Tauros Aqua") return "tauros-paldea-aqua-breed";

  if (clean.startsWith("Mega ")) {
    const base = clean.replace("Mega ", "").toLowerCase().replace(/\s+/g, "-");

    if (base.endsWith("-x")) return base.replace(/-x$/, "-mega-x");
    if (base.endsWith("-y")) return base.replace(/-y$/, "-mega-y");

    return `${base}-mega`;
  }

  if (clean.startsWith("Alolan ")) {
    return (
      clean.replace("Alolan ", "").toLowerCase().replace(/\s+/g, "-") +
      "-alola"
    );
  }

  if (clean.startsWith("Galarian ")) {
    return (
      clean.replace("Galarian ", "").toLowerCase().replace(/\s+/g, "-") +
      "-galar"
    );
  }

  if (clean.startsWith("Hisuian ")) {
    return (
      clean.replace("Hisuian ", "").toLowerCase().replace(/\s+/g, "-") +
      "-hisui"
    );
  }

  if (clean.startsWith("Paldean ")) {
    return (
      clean.replace("Paldean ", "").toLowerCase().replace(/\s+/g, "-") +
      "-paldea"
    );
  }

  return clean.toLowerCase().replace(/\s+/g, "-");
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