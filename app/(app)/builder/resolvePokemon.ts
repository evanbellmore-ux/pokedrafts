import {
  fetchPokeApiSprite,
  getBaseSpeciesName,
  loadDex,
  normalizePokemonName,
  type DexMap,
} from "@/app/lib/pokemon";
import { cleanName } from "./poolFormat";

/**
 * Checks that a typed name is a Pokémon the app knows and returns the name to
 * store in the pool, or null when nothing matches.
 *
 * The stored name is always a display name, never a PokeAPI slug: the dex's
 * own spelling when the dex has the species, otherwise the name the coach
 * typed (Mega and Primal forms of a dex species, and regional forms that only
 * PokeAPI knows). `toPokeApiSlug` is used inside `fetchPokeApiSprite` purely
 * for the existence check. Throws on a network failure so the caller can show
 * a connection message instead of "not found".
 */
export async function resolvePokemonName(typed: string): Promise<string | null> {
  const name = cleanName(typed);
  if (!name) return null;

  let dex: DexMap | null = null;
  try {
    dex = await loadDex();
  } catch {
    // The dex is unavailable; PokeAPI below is the only source left.
    dex = null;
  }

  if (dex) {
    const exact = dex.get(normalizePokemonName(name));
    if (exact) return exact.name;

    const base = getBaseSpeciesName(name);
    if (base !== name && dex.has(normalizePokemonName(base))) return name;
  }

  const sprite = await fetchPokeApiSprite(name);
  return sprite === null ? null : name;
}
