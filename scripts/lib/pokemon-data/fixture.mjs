// The unit-test fixture: a handful of species with every variety and form
// they list, plus every Pokédex, version group and generation, all in the
// stripped shape. Pure; the build script's --write-fixture flag writes the
// result under tests/fixtures/pokeapi/ with the cache's file layout.

/**
 * Species the fixture carries, chosen so every selection rule, form kind,
 * tag and Serebii suffix has an example.
 */
export const FIXTURE_SPECIES = [
  "charizard", // megas X/Y, gigantamax skip
  "raichu", // Alolan regional, Champions megas X/Y
  "rotom", // appliance forms (rule 6, "Rotom (Wash)")
  "meowstic", // gender form whose stats match but abilities differ; gendered megas
  "indeedee", // gender form, Reg M-C override
  "tauros", // Paldean breeds
  "floette", // Eternal Flower, mega
  "toxtricity", // Low Key, gigantamax skips, Reg M-C override
  "pikachu", // cosmetic costumes, partner, gigantamax
  "vivillon", // single variety with many cosmetic forms
  "great-tusk", // paradox
  "koraidon", // restricted legendary, cosmetic builds
  "mew", // mythical
  "nihilego", // ultra beast
  "urshifu", // Rapid Strike style
  "persian", // Alolan regional, Reg M-C override
  "groudon", // Primal Reversion, restricted
  "minior", // cosmetic meteor colours (rule 7) and duplicate core colours (rule 7, sameAs)
  "squawkabilly", // plumage pairs that share abilities (rule 7, sameAs)
  "tatsugiri", // cosmetic varieties whose megas duplicate the kept mega
  "magearna", // Original Color and its duplicate mega; mythical
  "eternatus", // Eternamax skip (rule 2), restricted
];

/**
 * @param {import("./catalog.mjs").Catalog} catalog
 * @param {string[]} [speciesNames]
 * @returns {{
 *   species: import("./strip.mjs").StrippedSpecies[],
 *   pokemon: import("./strip.mjs").StrippedPokemon[],
 *   forms: import("./strip.mjs").StrippedForm[],
 *   pokedexes: import("./strip.mjs").StrippedPokedex[],
 *   versionGroups: import("./strip.mjs").StrippedVersionGroup[],
 *   generations: import("./strip.mjs").StrippedGeneration[],
 * }}
 */
export function selectFixture(catalog, speciesNames = FIXTURE_SPECIES) {
  const species = speciesNames.map((name) => {
    const record = catalog.speciesByName.get(name);
    if (!record) {
      throw new Error(`Fixture species "${name}" is not in the cache.`);
    }
    return record;
  });
  const pokemon = species.flatMap((record) =>
    record.varieties.map((variety) => {
      const found = catalog.pokemonByName.get(variety.pokemon.name);
      if (!found) {
        throw new Error(`Fixture variety "${variety.pokemon.name}" is not in the cache.`);
      }
      return found;
    })
  );
  const forms = pokemon.flatMap((record) =>
    record.forms
      .map((form) => catalog.formByName.get(form.name))
      .filter((form) => form !== undefined)
  );
  return {
    species: [...species].sort((a, b) => a.id - b.id),
    pokemon: [...pokemon].sort((a, b) => a.id - b.id),
    forms: [...forms].sort((a, b) => a.id - b.id),
    pokedexes: [...catalog.pokedexByName.values()].sort((a, b) => a.id - b.id),
    versionGroups: [...catalog.versionGroupByName.values()].sort((a, b) => a.id - b.id),
    generations: [...catalog.generationByName.values()].sort((a, b) => a.id - b.id),
  };
}
