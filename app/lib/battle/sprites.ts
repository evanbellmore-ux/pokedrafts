import data from "@/data/battle/sprites.json";

/**
 * Sprites for the calculator's and Training's Pokémon slots: one PokeAPI sprite file for every species of the four battle
 * catalogs (data/battle/sprites.json, built by scripts/build-battle-sprites.ts: a league roster name's Pool Builder row,
 * else the PokeAPI Pokémon or form of the Showdown name). Bundled, so a slot shows its Pokémon, form or Mega without
 * reading the Pokémon dex or asking PokeAPI; the files come from raw.githubusercontent.com, which the
 * Content-Security-Policy allows (app/lib/content-security-policy.ts).
 */
const files = new Map(Object.entries(data.sprites));

/** The sprite URL for a battle catalog species id, or null for an id no catalog has. */
export function battleSpriteUrl(speciesId: string): string | null {
  const file = files.get(speciesId);
  return file ? `${data.base}${file}.png` : null;
}
