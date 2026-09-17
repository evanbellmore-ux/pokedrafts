// Game availability (docs/release-architecture.md 13.4). A row is in a game
// when it has a learnset for one of the game's version groups, or its
// species is in one of the game's Pokédexes and the row is the default form,
// or an override says so. Pure.

/**
 * @typedef {{ key: string, name: string, versionGroups: string[], pokedexes: string[] }} GameSpec
 */

/**
 * Game keys and their PokéAPI sources, in the order they appear on a row.
 * Only `champions` and `scarlet_violet` get a control in the builder at
 * launch; the rest are carried so adding a checkbox is a one-line change.
 */
export const GAMES = /** @type {GameSpec[]} */ ([
  { key: "champions", name: "Pokémon Champions", versionGroups: ["champions"], pokedexes: ["champions"] },
  {
    key: "scarlet_violet",
    name: "Pokémon Scarlet and Violet",
    versionGroups: ["scarlet-violet", "the-teal-mask", "the-indigo-disk"],
    pokedexes: ["paldea", "kitakami", "blueberry"],
  },
  {
    key: "legends_za",
    name: "Pokémon Legends: Z-A",
    versionGroups: ["legends-za", "mega-dimension"],
    pokedexes: ["lumiose-city", "hyperspace"],
  },
  {
    key: "sword_shield",
    name: "Pokémon Sword and Shield",
    versionGroups: ["sword-shield", "the-isle-of-armor", "the-crown-tundra"],
    pokedexes: ["galar", "isle-of-armor", "crown-tundra"],
  },
  { key: "legends_arceus", name: "Pokémon Legends: Arceus", versionGroups: ["legends-arceus"], pokedexes: ["hisui"] },
  {
    key: "bdsp",
    name: "Pokémon Brilliant Diamond and Shining Pearl",
    versionGroups: ["brilliant-diamond-shining-pearl"],
    // PokéAPI files brilliant-diamond-shining-pearl under original-sinnoh (the
    // 151-entry Sinnoh Pokédex Diamond and Pearl use); extended-sinnoh is
    // Platinum's 210-entry dex.
    pokedexes: ["original-sinnoh"],
  },
  {
    key: "lets_go",
    name: "Pokémon: Let's Go, Pikachu! and Let's Go, Eevee!",
    versionGroups: ["lets-go-pikachu-lets-go-eevee"],
    pokedexes: ["letsgo-kanto"],
  },
  {
    key: "ultra_sun_ultra_moon",
    name: "Pokémon Ultra Sun and Ultra Moon",
    versionGroups: ["ultra-sun-ultra-moon"],
    pokedexes: ["updated-alola"],
  },
  { key: "sun_moon", name: "Pokémon Sun and Moon", versionGroups: ["sun-moon"], pokedexes: ["original-alola"] },
  {
    key: "oras",
    name: "Pokémon Omega Ruby and Alpha Sapphire",
    versionGroups: ["omega-ruby-alpha-sapphire"],
    pokedexes: ["updated-hoenn"],
  },
  {
    key: "x_y",
    name: "Pokémon X and Y",
    versionGroups: ["x-y"],
    pokedexes: ["kalos-central", "kalos-coastal", "kalos-mountain"],
  },
  {
    key: "black_2_white_2",
    name: "Pokémon Black 2 and White 2",
    versionGroups: ["black-2-white-2"],
    pokedexes: ["updated-unova"],
  },
  { key: "black_white", name: "Pokémon Black and White", versionGroups: ["black-white"], pokedexes: ["original-unova"] },
  {
    key: "heartgold_soulsilver",
    name: "Pokémon HeartGold and SoulSilver",
    versionGroups: ["heartgold-soulsilver"],
    pokedexes: ["updated-johto"],
  },
  { key: "platinum", name: "Pokémon Platinum", versionGroups: ["platinum"], pokedexes: ["extended-sinnoh"] },
  { key: "diamond_pearl", name: "Pokémon Diamond and Pearl", versionGroups: ["diamond-pearl"], pokedexes: ["original-sinnoh"] },
  { key: "emerald", name: "Pokémon Emerald", versionGroups: ["emerald"], pokedexes: ["hoenn"] },
  {
    key: "firered_leafgreen",
    name: "Pokémon FireRed and LeafGreen",
    versionGroups: ["firered-leafgreen"],
    pokedexes: ["kanto"],
  },
  { key: "ruby_sapphire", name: "Pokémon Ruby and Sapphire", versionGroups: ["ruby-sapphire"], pokedexes: ["hoenn"] },
  { key: "crystal", name: "Pokémon Crystal", versionGroups: ["crystal"], pokedexes: ["original-johto"] },
  { key: "gold_silver", name: "Pokémon Gold and Silver", versionGroups: ["gold-silver"], pokedexes: ["original-johto"] },
  { key: "yellow", name: "Pokémon Yellow", versionGroups: ["yellow"], pokedexes: ["kanto"] },
  { key: "red_blue", name: "Pokémon Red and Blue", versionGroups: ["red-blue"], pokedexes: ["kanto"] },
]);

export const GAME_KEYS = GAMES.map((game) => game.key);

/**
 * Entry numbers per Pokédex for the species: { paldea: 12, champions: 6 }.
 *
 * @param {import("./strip.mjs").StrippedSpecies} species
 * @returns {Record<string, number>}
 */
export function dexNumbersFor(species) {
  /** @type {Record<string, number>} */
  const numbers = {};
  const sorted = [...species.pokedex_numbers].sort((a, b) =>
    a.pokedex.name.localeCompare(b.pokedex.name)
  );
  for (const entry of sorted) {
    numbers[entry.pokedex.name] = entry.entry_number;
  }
  return numbers;
}

/**
 * @param {{
 *   pokemon: import("./strip.mjs").StrippedPokemon,
 *   species: import("./strip.mjs").StrippedSpecies,
 *   isDefault: boolean,
 *   overrideGames?: string[],
 * }} input
 * @returns {string[]} game keys in {@link GAMES} order
 */
export function gamesFor({ pokemon, species, isDefault, overrideGames = [] }) {
  const learnsets = new Set(pokemon.version_groups);
  const dexes = new Set(species.pokedex_numbers.map((entry) => entry.pokedex.name));
  const forced = new Set(overrideGames);
  /** @type {string[]} */
  const games = [];
  for (const game of GAMES) {
    const byLearnset = game.versionGroups.some((name) => learnsets.has(name));
    const byDex = isDefault && game.pokedexes.some((name) => dexes.has(name));
    if (byLearnset || byDex || forced.has(game.key)) {
      games.push(game.key);
    }
  }
  return games;
}

/**
 * Every version group and Pokédex the table names must exist in the crawl;
 * a renamed PokéAPI resource would otherwise silently empty a game.
 *
 * @param {import("./catalog.mjs").Catalog} catalog
 * @returns {string[]} problems, empty when valid
 */
export function validateGames(catalog) {
  /** @type {string[]} */
  const problems = [];
  if (catalog.versionGroupByName.size === 0 && catalog.pokedexByName.size === 0) {
    return problems;
  }
  for (const game of GAMES) {
    for (const name of game.versionGroups) {
      if (!catalog.versionGroupByName.has(name)) {
        problems.push(`Game ${game.key}: version group "${name}" is not in the cache.`);
      }
    }
    for (const name of game.pokedexes) {
      if (!catalog.pokedexByName.has(name)) {
        problems.push(`Game ${game.key}: pokedex "${name}" is not in the cache.`);
      }
    }
  }
  return problems;
}
