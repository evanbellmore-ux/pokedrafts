import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyRowOverride, buildDataset, buildRow, normalizeOverrides, validateRow } from "@/scripts/lib/pokemon-data/build.mjs";
import { buildCatalog, defaultVarietyOf, englishName, formOf, generationNumber, titleCaseSlug } from "@/scripts/lib/pokemon-data/catalog.mjs";
import { createJsonFetcher, mapLimit } from "@/scripts/lib/pokemon-data/fetch.mjs";
import { FIXTURE_SPECIES } from "@/scripts/lib/pokemon-data/fixture.mjs";
import { GAMES, dexNumbersFor, gamesFor } from "@/scripts/lib/pokemon-data/games.mjs";
import { cleanFormName, nameVariety, slugRemainder, typeName } from "@/scripts/lib/pokemon-data/names.mjs";
import { REGULATION_RANGES, applyFilterRule, checkRegulationAgreement, fillRosters } from "@/scripts/lib/pokemon-data/presets.mjs";
import { kindCountProblems, presetDriftWarnings } from "@/scripts/lib/pokemon-data/report.mjs";
import { DUPLICATE_REASON, battleKey, classifyVariety, differsFromDefault, duplicateOf, megaBaseSlug, selectVarieties } from "@/scripts/lib/pokemon-data/rows.mjs";
import { SUFFIX_TABLE, buildRosters, expandRosterForms, parseSerebiiPage, resolveSerebiiRow } from "@/scripts/lib/pokemon-data/serebii.mjs";
import { stripForm, stripPokemon, stripSpecies } from "@/scripts/lib/pokemon-data/strip.mjs";
import { tagsFor } from "@/scripts/lib/pokemon-data/tags.mjs";

type Catalog = ReturnType<typeof buildCatalog>;
type RuleRow = Parameters<typeof checkRegulationAgreement>[0][number];
type Preset = Parameters<typeof fillRosters>[0][number];
type SerebiiRow = Parameters<typeof resolveSerebiiRow>[0];

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/pokeapi/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function loadKind<T>(kind: string): T[] {
  const dir = path.join(FIXTURE_DIR, kind);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T);
}

const catalog: Catalog = buildCatalog({
  species: loadKind("pokemon-species"),
  pokemon: loadKind("pokemon"),
  forms: loadKind("pokemon-form"),
  pokedexes: loadKind("pokedex"),
  versionGroups: loadKind("version-group"),
  generations: loadKind("generation"),
});

function species(name: string) {
  const record = catalog.speciesByName.get(name);
  if (!record) throw new Error(`fixture species ${name} missing`);
  return record;
}

function pokemon(name: string) {
  const record = catalog.pokemonByName.get(name);
  if (!record) throw new Error(`fixture pokemon ${name} missing`);
  return record;
}

function classify(slug: string, keep?: Set<string>) {
  const record = pokemon(slug);
  return classifyVariety(catalog, species(record.species.name), record, { keep });
}

/** Overrides that only reference fixture species. */
const FIXTURE_OVERRIDES = {
  tags: {
    restricted: ["koraidon", "groudon", "eternatus"],
    paradox: ["great-tusk"],
    ultra_beast: ["nihilego"],
  },
  keep: {},
  rows: {
    "persian-alola": { games: ["champions"], notes: "Reg M-C addition" },
    "toxtricity-low-key": { games: ["champions"] },
    "indeedee-female": { games: ["champions"] },
    "minior-red": { display_name: "Minior (Core)", form_label: "Core" },
  },
};

const PRESETS: Preset[] = (
  JSON.parse(readFileSync(path.join(ROOT, "data/pokemon/regulations.json"), "utf8")) as Preset[]
).map((preset) =>
  preset.rule.kind === "roster" ? { ...preset, rule: { kind: "roster", slugs: [] } } : preset
);

/** A tiny Serebii page in the real markup: nested icon table, `<br  />`, a row without the Japanese name, an apostrophe slug. */
const SEREBII_PAGE = `
<table>
<tr><td align="center" class="fooinfo">#0006</td>
<td align="center" class="fooinfo"><table><tr><td class="pkmn"><a href="/pokedex-champions/charizard/"><img src="/pokedex-champions/icon/006-mx.png" height="40" class="sprite" loading="lazy" /></a></td></tr></table></td>
<td align="center" class="fooinfo"><a href="/pokedex-champions/charizard/">Mega Charizard X<br  />&#12513;&#12460;&#12522;&#12470;&#12540;&#12489;&#12531;X</a></td>
<td align="center" class="fooinfo"><a href="/pokedex-champions/fire.shtml"><img src="/pokedex-bw/type/fire.gif" border="0" loading="lazy" /></a></td></tr>
<tr><td align="center" class="fooinfo">#0083</td>
<td align="center" class="fooinfo"><table><tr><td class="pkmn"><a href="/pokedex-champions/farfetch'd/"><img src="/pokedex-champions/icon/083.png" height="40" loading="lazy" /></a></td></tr></table></td>
<td align="center" class="fooinfo"><a href="/pokedex-champions/farfetch'd/">Farfetch'd<br  />&#12459;&#12514;&#12493;&#12462;</a></td></tr>
<tr><td align="center" class="fooinfo">#0128</td>
<td align="center" class="fooinfo"><table><tr><td class="pkmn"><a href="/pokedex-champions/tauros/"><img src="/pokedex-champions/icon/128-b.png"  loading="lazy" class="sprite"/></a></td></tr></table></td>
<td align="center" class="fooinfo"><a href="/pokedex-champions/tauros/">Tauros</a></td></tr>
<tr><td align="center" class="fooinfo">#0026</td>
<td align="center" class="fooinfo"><table><tr><td class="pkmn"><a href="/pokedex-champions/raichu/"><img src="/pokedex-champions/icon/026-a.png" class="sprite" loading="lazy" /></a></td></tr></table></td>
<td align="center" class="fooinfo"><a href="/pokedex-champions/raichu/">Raichu<br  />&#12521;&#12452;&#12481;&#12517;&#12454;</a></td></tr>
</table>`;

function serebiiRow(dex: number, name: string, suffix: string | null = null, slug = name.toLowerCase()): SerebiiRow {
  return { dex, slug, name, suffix };
}

describe("fixture", () => {
  it("carries every species the build test relies on, in the stripped shape", () => {
    for (const name of FIXTURE_SPECIES) {
      expect(catalog.speciesByName.has(name), name).toBe(true);
    }
    const charizard = pokemon("charizard-mega-x");
    expect(Object.keys(charizard).sort()).toEqual(
      ["abilities", "forms", "id", "is_default", "name", "species", "sprites", "stats", "types", "version_groups"].sort()
    );
    expect(charizard.version_groups).toContain("champions");
    expect(catalog.pokedexByName.has("paldea")).toBe(true);
    expect(catalog.versionGroupByName.has("champions")).toBe(true);
    expect(catalog.generationByName.get("generation-ix")?.id).toBe(9);
  });
});

describe("strip", () => {
  it("keeps only the fields the pipeline reads", () => {
    const raw = {
      id: 1,
      name: "testmon",
      is_default: true,
      species: { name: "testmon", url: "x" },
      forms: [{ name: "testmon", url: "x" }],
      stats: [{ base_stat: 45, effort: 0, stat: { name: "hp", url: "x" } }],
      types: [{ slot: 1, type: { name: "grass", url: "x" } }],
      abilities: [{ is_hidden: false, slot: 1, ability: { name: "overgrow", url: "x" } }],
      moves: [
        {
          move: { name: "tackle" },
          version_group_details: [
            { version_group: { name: "champions" } },
            { version_group: { name: "scarlet-violet" } },
            { version_group: { name: "champions" } },
          ],
        },
      ],
      sprites: { front_default: "front.png", other: { "official-artwork": { front_default: "art.png" } } },
      height: 7,
      weight: 69,
    };
    expect(stripPokemon(raw)).toEqual({
      id: 1,
      name: "testmon",
      is_default: true,
      species: { name: "testmon" },
      forms: [{ name: "testmon" }],
      stats: [{ base_stat: 45, stat: { name: "hp" } }],
      types: [{ slot: 1, type: { name: "grass" } }],
      abilities: [{ is_hidden: false, slot: 1, ability: { name: "overgrow" } }],
      version_groups: ["champions", "scarlet-violet"],
      sprites: { front_default: "front.png", official_artwork: "art.png" },
    });
    const form = stripForm({
      id: 2,
      name: "testmon-x",
      form_name: "x",
      is_default: true,
      is_battle_only: false,
      is_mega: true,
      pokemon: { name: "testmon-x" },
      form_names: [
        { name: "Forme X", language: { name: "fr" } },
        { name: "X Form", language: { name: "en" } },
      ],
      names: [{ name: "Testmon X", language: { name: "en" } }],
    });
    expect(form.form_names).toEqual([{ name: "X Form", language: { name: "en" } }]);
    expect(form.is_mega).toBe(true);
    const sp = stripSpecies({
      id: 3,
      name: "testmon",
      is_legendary: 1,
      is_mythical: false,
      generation: { name: "generation-i" },
      names: [{ name: "Testmon", language: { name: "en" } }],
      varieties: [{ is_default: true, pokemon: { name: "testmon", url: "x" } }],
      pokedex_numbers: [{ entry_number: 4, pokedex: { name: "national", url: "x" } }],
      flavor_text_entries: [],
    });
    expect(sp).toEqual({
      id: 3,
      name: "testmon",
      is_legendary: true,
      is_mythical: false,
      generation: { name: "generation-i" },
      names: [{ name: "Testmon", language: { name: "en" } }],
      varieties: [{ is_default: true, pokemon: { name: "testmon" } }],
      pokedex_numbers: [{ entry_number: 4, pokedex: { name: "national" } }],
    });
  });
});

describe("catalog helpers", () => {
  it("reads English names, generations and default varieties", () => {
    expect(englishName(species("great-tusk"))).toBe("Great Tusk");
    expect(englishName({ name: "made-up-mon" })).toBe("Made Up Mon");
    expect(titleCaseSlug("rapid-strike")).toBe("Rapid Strike");
    expect(generationNumber(catalog, species("koraidon"))).toBe(9);
    expect(generationNumber(buildCatalog({ species: [], pokemon: [], forms: [] }), species("charizard"))).toBe(1);
    expect(defaultVarietyOf(catalog, species("meowstic")).name).toBe("meowstic-male");
    expect(formOf(catalog, pokemon("koraidon"))?.name).toBe("koraidon-apex-build");
  });
});

describe("row selection rules 1-7", () => {
  it("rule 1: every species' default variety is a default row", () => {
    expect(classify("charizard")).toEqual({ kind: "default", rule: 1 });
    expect(classify("meowstic-male")).toEqual({ kind: "default", rule: 1 });
    expect(classify("toxtricity-amped")).toEqual({ kind: "default", rule: 1 });
    expect(classify("urshifu-single-strike")).toEqual({ kind: "default", rule: 1 });
  });

  it("rule 2: battle-only, gigantamax, totem, costume Pikachu and partner Eevee are skipped", () => {
    expect(classify("charizard-gmax")).toMatchObject({ kind: "skip", rule: 2 });
    expect(classify("toxtricity-low-key-gmax")).toMatchObject({ kind: "skip", rule: 2 });
    for (const suffix of ["cosplay", "rock-star", "belle", "pop-star", "phd", "libre", "original-cap", "hoenn-cap", "sinnoh-cap", "unova-cap", "kalos-cap", "alola-cap", "partner-cap", "world-cap", "starter"]) {
      expect(classify(`pikachu-${suffix}`), suffix).toEqual({ kind: "skip", rule: 2, reason: "cosmetic pikachu" });
    }
    // "-alola-cap" is a costume, not a regional form, because rule 2 runs first.
    expect(classify("pikachu-alola-cap").kind).toBe("skip");
    expect(classify("pikachu-gmax")).toMatchObject({ kind: "skip", rule: 2 });
    // Eternamax is Eternatus's Dynamax form; PokéAPI does not flag it
    // battle-only, so the slug check catches it like the Gigantamax forms.
    expect(formOf(catalog, pokemon("eternatus-eternamax"))?.is_battle_only).toBe(false);
    expect(classify("eternatus-eternamax")).toEqual({ kind: "skip", rule: 2, reason: "gigantamax" });
    expect(classify("eternatus")).toEqual({ kind: "default", rule: 1 });
  });

  it("rule 2 lets megas and primals through even though PokéAPI flags them battle-only", () => {
    expect(formOf(catalog, pokemon("charizard-mega-x"))?.is_battle_only).toBe(true);
    expect(classify("charizard-mega-x")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("groudon-primal")).toEqual({ kind: "mega", rule: 3 });
  });

  it("rule 2's keep list only lifts the battle-only skip, never the gigantamax one", () => {
    // Gigantamax forms are battle-only too; keeping one still stops at the gmax check.
    expect(classify("charizard-gmax", new Set(["charizard-gmax"]))).toEqual({ kind: "skip", rule: 2, reason: "gigantamax" });
    // A kept battle-only variety falls through to the later rules: this
    // stand-in reuses the gigantamax form record (battle-only) under a
    // different slug with different stats, like Crowned Zacian.
    const gmax = pokemon("charizard-gmax");
    expect(formOf(catalog, gmax)?.is_battle_only).toBe(true);
    const crowned = {
      ...gmax,
      name: "charizard-crowned",
      forms: [{ name: "charizard-gmax" }],
      stats: gmax.stats.map((entry) => ({ ...entry, base_stat: entry.base_stat + 10 })),
    };
    expect(classifyVariety(catalog, species("charizard"), crowned)).toEqual({ kind: "skip", rule: 2, reason: "battle-only form" });
    expect(classifyVariety(catalog, species("charizard"), crowned, { keep: new Set(["charizard-crowned"]) })).toEqual({ kind: "other", rule: 6 });
  });

  it("rule 3: is_mega varieties are mega rows, including gendered and Z megas", () => {
    expect(classify("raichu-mega-x")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("raichu-mega-y")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("meowstic-female-mega")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("floette-mega")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("tatsugiri-curly-mega")).toEqual({ kind: "mega", rule: 3 });
    expect(classify("magearna-mega")).toEqual({ kind: "mega", rule: 3 });
  });

  it("rule 4: regional markers, Paldean Tauros breeds included", () => {
    expect(classify("raichu-alola")).toEqual({ kind: "regional", rule: 4, region: "alola" });
    expect(classify("persian-alola")).toEqual({ kind: "regional", rule: 4, region: "alola" });
    expect(classify("tauros-paldea-combat-breed")).toEqual({ kind: "regional", rule: 4, region: "paldea" });
    expect(classify("tauros-paldea-blaze-breed")).toEqual({ kind: "regional", rule: 4, region: "paldea" });
    expect(classify("tauros-paldea-aqua-breed")).toEqual({ kind: "regional", rule: 4, region: "paldea" });
  });

  it("rule 5: -female and -male varieties are gender rows", () => {
    expect(classify("meowstic-female")).toEqual({ kind: "gender", rule: 5 });
    expect(classify("indeedee-female")).toEqual({ kind: "gender", rule: 5 });
  });

  it("rule 6: stats, types or ability names differing from the default variety make an other row", () => {
    expect(classify("rotom-wash")).toEqual({ kind: "other", rule: 6 });
    expect(classify("toxtricity-low-key")).toEqual({ kind: "other", rule: 6 });
    expect(classify("urshifu-rapid-strike")).toEqual({ kind: "other", rule: 6 });
    expect(classify("floette-eternal")).toEqual({ kind: "other", rule: 6 });
    // Minior's core differs from its Meteor form by stats; Squawkabilly's
    // yellow plumage differs from green by abilities only.
    expect(classify("minior-red")).toEqual({ kind: "other", rule: 6 });
    expect(classify("squawkabilly-yellow-plumage")).toEqual({ kind: "other", rule: 6 });
    // Meowstic-F matches the male's stats and types but not its abilities.
    const female = pokemon("meowstic-female");
    const male = pokemon("meowstic-male");
    expect(female.stats.map((s) => s.base_stat)).toEqual(male.stats.map((s) => s.base_stat));
    expect(differsFromDefault(female, male)).toBe(true);
    expect(differsFromDefault({ ...female, abilities: male.abilities }, male)).toBe(false);
  });

  it("rule 7: cosmetic varieties are skipped with a reason", () => {
    for (const build of ["gliding", "limited", "sprinting", "swimming"]) {
      expect(classify(`koraidon-${build}-build`)).toMatchObject({ kind: "skip", rule: 7 });
    }
    for (const colour of ["orange", "yellow", "green", "blue", "indigo", "violet"]) {
      expect(classify(`minior-${colour}-meteor`)).toMatchObject({ kind: "skip", rule: 7 });
    }
    expect(classify("magearna-original")).toMatchObject({ kind: "skip", rule: 7 });
    expect(classify("squawkabilly-blue-plumage")).toMatchObject({ kind: "skip", rule: 7 });
    expect(classify("tatsugiri-droopy")).toMatchObject({ kind: "skip", rule: 7 });
    const { kept, skipped } = selectVarieties(catalog);
    const sameAsDefault = skipped.filter((entry) => entry.rule === 7 && entry.sameAs === undefined);
    expect(sameAsDefault.map((entry) => entry.slug).sort()).toEqual([
      "koraidon-gliding-build",
      "koraidon-limited-build",
      "koraidon-sprinting-build",
      "koraidon-swimming-build",
      "magearna-original",
      "minior-blue-meteor",
      "minior-green-meteor",
      "minior-indigo-meteor",
      "minior-orange-meteor",
      "minior-violet-meteor",
      "minior-yellow-meteor",
      "squawkabilly-blue-plumage",
      "tatsugiri-droopy",
      "tatsugiri-stretchy",
    ]);
    const kinds = kept.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.classification.kind] = (acc[entry.classification.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds).toEqual({ default: 22, mega: 10, regional: 5, gender: 2, other: 10 });
    expect(kept.length + skipped.length).toBe(catalog.pokemonByName.size);
  });

  it("rule 7 also drops a variety that duplicates a kept variety of its species, naming the original", () => {
    const { kept, skipped } = selectVarieties(catalog);
    const duplicates = skipped
      .filter((entry) => entry.sameAs !== undefined)
      .map((entry) => [entry.slug, entry.sameAs, entry.rule, entry.reason]);
    expect(duplicates.sort()).toEqual(
      [
        ["magearna-original-mega", "magearna-mega", 7, DUPLICATE_REASON],
        ["minior-blue", "minior-red", 7, DUPLICATE_REASON],
        ["minior-green", "minior-red", 7, DUPLICATE_REASON],
        ["minior-indigo", "minior-red", 7, DUPLICATE_REASON],
        ["minior-orange", "minior-red", 7, DUPLICATE_REASON],
        ["minior-violet", "minior-red", 7, DUPLICATE_REASON],
        ["minior-yellow", "minior-red", 7, DUPLICATE_REASON],
        ["squawkabilly-white-plumage", "squawkabilly-yellow-plumage", 7, DUPLICATE_REASON],
        ["tatsugiri-droopy-mega", "tatsugiri-curly-mega", 7, DUPLICATE_REASON],
        ["tatsugiri-stretchy-mega", "tatsugiri-curly-mega", 7, DUPLICATE_REASON],
      ].sort()
    );
    // Every original is a kept row of the same species.
    const keptSlugs = new Set(kept.map((entry) => entry.pokemon.name));
    for (const entry of skipped) {
      if (entry.sameAs === undefined) continue;
      expect(keptSlugs.has(entry.sameAs), entry.slug).toBe(true);
      expect(pokemon(entry.sameAs).species.name).toBe(entry.species);
      expect(battleKey(pokemon(entry.slug))).toBe(battleKey(pokemon(entry.sameAs)));
    }
    // The first variety PokéAPI lists is the one that stays.
    expect(keptSlugs.has("minior-red")).toBe(true);
    expect(keptSlugs.has("squawkabilly-yellow-plumage")).toBe(true);
    expect(keptSlugs.has("tatsugiri-curly-mega")).toBe(true);
    expect(keptSlugs.has("magearna-mega")).toBe(true);
    // Mega Meowstic (Female) has the male mega's data but evolves from a kept
    // gender row, so both megas stay.
    expect(battleKey(pokemon("meowstic-female-mega"))).toBe(battleKey(pokemon("meowstic-male-mega")));
    expect(keptSlugs.has("meowstic-female-mega")).toBe(true);
    expect(keptSlugs.has("meowstic-male-mega")).toBe(true);
  });

  it("duplicateOf keeps regional and gender rows and megas of kept rows, and drops the rest", () => {
    expect(megaBaseSlug("meowstic-female-mega")).toBe("meowstic-female");
    expect(megaBaseSlug("charizard-mega-x")).toBe("charizard");
    expect(megaBaseSlug("groudon-primal")).toBe("groudon");
    expect(megaBaseSlug("rotom-wash")).toBe("rotom-wash");

    const orange = pokemon("minior-orange");
    const seen = { keySlugs: new Map([[battleKey(orange), "minior-red"]]), slugs: new Set(["minior-red"]) };
    expect(duplicateOf(orange, { kind: "other", rule: 6 }, seen)).toBe("minior-red");
    expect(duplicateOf(orange, { kind: "regional", rule: 4 }, seen)).toBeNull();
    expect(duplicateOf(orange, { kind: "gender", rule: 5 }, seen)).toBeNull();
    expect(duplicateOf(orange, { kind: "default", rule: 1 }, seen)).toBeNull();
    expect(duplicateOf(orange, { kind: "other", rule: 6 }, { keySlugs: new Map(), slugs: new Set() })).toBeNull();

    const femaleMega = pokemon("meowstic-female-mega");
    const megaSeen = { keySlugs: new Map([[battleKey(femaleMega), "meowstic-male-mega"]]), slugs: new Set(["meowstic-male", "meowstic-male-mega"]) };
    expect(duplicateOf(femaleMega, { kind: "mega", rule: 3 }, megaSeen)).toBe("meowstic-male-mega");
    megaSeen.slugs.add("meowstic-female");
    expect(duplicateOf(femaleMega, { kind: "mega", rule: 3 }, megaSeen)).toBeNull();
  });
});

describe("display names", () => {
  function name(slug: string) {
    const record = pokemon(slug);
    const sp = species(record.species.name);
    const classification = classifyVariety(catalog, sp, record);
    if (classification.kind === "skip") throw new Error(`${slug} is skipped`);
    return nameVariety({
      kind: classification.kind,
      species: sp,
      pokemon: record,
      form: formOf(catalog, record),
      defaultVariety: defaultVarietyOf(catalog, sp),
    });
  }

  it.each([
    ["charizard", "Charizard", null],
    ["charizard-mega-x", "Mega Charizard X", "Mega X"],
    ["charizard-mega-y", "Mega Charizard Y", "Mega Y"],
    ["raichu-alola", "Alolan Raichu", "Alolan"],
    ["raichu-mega-x", "Mega Raichu X", "Mega X"],
    ["persian-alola", "Alolan Persian", "Alolan"],
    ["tauros-paldea-combat-breed", "Paldean Tauros (Combat Breed)", "Paldean Combat Breed"],
    ["tauros-paldea-blaze-breed", "Paldean Tauros (Blaze Breed)", "Paldean Blaze Breed"],
    ["tauros-paldea-aqua-breed", "Paldean Tauros (Aqua Breed)", "Paldean Aqua Breed"],
    ["groudon-primal", "Primal Groudon", "Primal"],
    ["meowstic-male", "Meowstic", null],
    ["meowstic-female", "Meowstic (Female)", "Female"],
    ["meowstic-male-mega", "Mega Meowstic", "Mega"],
    ["meowstic-female-mega", "Mega Meowstic (Female)", "Mega (Female)"],
    ["indeedee-male", "Indeedee", null],
    ["indeedee-female", "Indeedee (Female)", "Female"],
    ["rotom-wash", "Rotom (Wash)", "Wash"],
    ["rotom-heat", "Rotom (Heat)", "Heat"],
    ["toxtricity-amped", "Toxtricity", null],
    ["toxtricity-low-key", "Toxtricity (Low Key)", "Low Key"],
    ["urshifu-rapid-strike", "Urshifu (Rapid Strike)", "Rapid Strike"],
    ["floette-eternal", "Floette (Eternal Flower)", "Eternal Flower"],
    ["floette-mega", "Mega Floette", "Mega"],
    ["great-tusk", "Great Tusk", null],
    ["minior-red-meteor", "Minior", null],
    ["minior-red", "Minior (Red Core)", "Red Core"],
    ["squawkabilly-yellow-plumage", "Squawkabilly (Yellow Plumage)", "Yellow Plumage"],
    ["tatsugiri-curly-mega", "Mega Tatsugiri", "Mega"],
    ["magearna-mega", "Mega Magearna", "Mega"],
    ["eternatus", "Eternatus", null],
  ])("%s -> %s", (slug, display, label) => {
    expect(name(slug)).toEqual({ display_name: display, form_label: label });
  });

  it("cleans PokéAPI form names to the app's prose", () => {
    expect(cleanFormName("Wash Rotom", "Rotom")).toBe("Wash");
    expect(cleanFormName("Origin Forme", "Giratina")).toBe("Origin");
    expect(cleanFormName("Low Key Form", "Toxtricity")).toBe("Low Key");
    expect(cleanFormName("Rapid Strike Style", "Urshifu")).toBe("Rapid Strike");
    expect(cleanFormName("Sandy Cloak", "Wormadam")).toBe("Sandy");
    expect(cleanFormName("Shadow Rider", "Calyrex")).toBe("Shadow Rider");
    expect(cleanFormName("Eternal Flower", "Floette")).toBe("Eternal Flower");
    expect(cleanFormName("Pikachu Rock Star", "Pikachu")).toBe("Rock Star");
    expect(cleanFormName("", "Rockruff")).toBe("");
  });

  it("falls back to the title-cased slug remainder when a form has no English name", () => {
    const record = pokemon("urshifu-rapid-strike");
    const sp = species("urshifu");
    const naming = nameVariety({
      kind: "other",
      species: sp,
      pokemon: record,
      form: null,
      defaultVariety: defaultVarietyOf(catalog, sp),
    });
    expect(naming).toEqual({ display_name: "Urshifu (Rapid Strike)", form_label: "Rapid Strike" });
    expect(slugRemainder("charizard-mega-x", "charizard")).toBe("-mega-x");
    expect(slugRemainder("charizard", "charizard")).toBe("");
    expect(typeName("fire")).toBe("Fire");
  });

  it("spells Legends Z-A megas with a Z suffix", () => {
    const absol = buildCatalog({
      species: [
        {
          id: 359,
          name: "absol",
          is_legendary: false,
          is_mythical: false,
          generation: { name: "generation-iii" },
          names: [{ name: "Absol", language: { name: "en" } }],
          varieties: [
            { is_default: true, pokemon: { name: "absol" } },
            { is_default: false, pokemon: { name: "absol-mega-z" } },
          ],
          pokedex_numbers: [],
        },
      ],
      pokemon: [
        { ...pokemon("charizard"), id: 359, name: "absol", species: { name: "absol" }, forms: [] },
        { ...pokemon("charizard-mega-x"), id: 10307, name: "absol-mega-z", species: { name: "absol" }, forms: [] },
      ],
      forms: [],
    });
    const sp = absol.speciesByName.get("absol")!;
    const naming = nameVariety({
      kind: "mega",
      species: sp,
      pokemon: absol.pokemonByName.get("absol-mega-z")!,
      form: null,
      defaultVariety: absol.pokemonByName.get("absol")!,
    });
    expect(naming).toEqual({ display_name: "Mega Absol Z", form_label: "Mega Z" });
  });
});

describe("tags", () => {
  const curated = FIXTURE_OVERRIDES.tags;
  it.each([
    ["koraidon", ["legendary", "restricted"]],
    ["groudon", ["legendary", "restricted"]],
    ["great-tusk", ["paradox"]],
    ["mew", ["mythical"]],
    ["magearna", ["mythical"]],
    ["nihilego", ["ultra_beast"]],
    ["eternatus", ["legendary", "restricted"]],
    ["raichu", []],
  ])("%s -> %j", (slug, tags) => {
    expect(tagsFor(species(slug), curated)).toEqual(tags);
  });

  it("marks a legendary that is not restricted as sub_legendary", () => {
    expect(tagsFor(species("groudon"), { restricted: [], paradox: [], ultra_beast: [] })).toEqual([
      "legendary",
      "sub_legendary",
    ]);
  });

  it("rejects curated slugs that are not species", () => {
    const { problems } = normalizeOverrides(
      { tags: { restricted: ["not-a-mon"], paradox: ["great-tusk", "great-tusk"] } },
      catalog
    );
    expect(problems.some((problem) => problem.includes("not-a-mon"))).toBe(true);
    expect(problems.some((problem) => problem.includes("twice"))).toBe(true);
  });
});

describe("games", () => {
  it("names champions and scarlet_violet with their PokéAPI sources", () => {
    expect(GAMES[0]).toEqual({
      key: "champions",
      name: "Pokémon Champions",
      versionGroups: ["champions"],
      pokedexes: ["champions"],
    });
    expect(GAMES[1].versionGroups).toEqual(["scarlet-violet", "the-teal-mask", "the-indigo-disk"]);
    expect(GAMES[1].pokedexes).toEqual(["paldea", "kitakami", "blueberry"]);
  });

  it("uses learnsets, then the Pokédex for default forms, then overrides", () => {
    const charizardMegaX = gamesFor({ pokemon: pokemon("charizard-mega-x"), species: species("charizard"), isDefault: false });
    expect(charizardMegaX).toContain("champions");
    expect(charizardMegaX).not.toContain("scarlet_violet");

    // Persian is in the champions Pokédex without a champions learnset: the default form gets it.
    expect(pokemon("persian").version_groups).not.toContain("champions");
    expect(gamesFor({ pokemon: pokemon("persian"), species: species("persian"), isDefault: true })).toContain("champions");
    // Alolan Persian is not the default form, so only an override adds it.
    expect(gamesFor({ pokemon: pokemon("persian-alola"), species: species("persian"), isDefault: false })).not.toContain("champions");
    expect(
      gamesFor({ pokemon: pokemon("persian-alola"), species: species("persian"), isDefault: false, overrideGames: ["champions"] })
    ).toEqual(expect.arrayContaining(["champions", "scarlet_violet", "sword_shield"]));

    // Games keep table order.
    const games = gamesFor({ pokemon: pokemon("raichu-alola"), species: species("raichu"), isDefault: false });
    const order = GAMES.map((game) => game.key);
    expect(games).toEqual([...games].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it("collects dex numbers per Pokédex for the species", () => {
    const numbers = dexNumbersFor(species("tauros"));
    expect(numbers).toMatchObject({ national: 128, paldea: 223, champions: 128, blueberry: 22 });
  });
});

describe("rows", () => {
  it("builds a row with every table column and the app's type spelling", () => {
    const row = buildRow({
      catalog,
      species: species("charizard"),
      pokemon: pokemon("charizard-mega-x"),
      kind: "mega",
      curated: FIXTURE_OVERRIDES.tags,
    });
    expect(row).toEqual({
      id: 10034,
      species_id: 6,
      slug: "charizard-mega-x",
      display_name: "Mega Charizard X",
      species_name: "Charizard",
      form_kind: "mega",
      form_label: "Mega X",
      type1: "Fire",
      type2: "Dragon",
      hp: 78,
      attack: 130,
      defense: 111,
      special_attack: 130,
      special_defense: 85,
      speed: 100,
      generation: 1,
      tags: [],
      games: expect.arrayContaining(["champions", "x_y", "oras"]),
      dex_numbers: expect.objectContaining({ national: 6, champions: 6 }),
      sprite_url: pokemon("charizard-mega-x").sprites.official_artwork,
    });
    expect(validateRow(row)).toEqual([]);
  });

  it("falls back to the species sprite when a form has none", () => {
    const bare = { ...pokemon("rotom-wash"), sprites: { front_default: null, official_artwork: null } };
    const row = buildRow({ catalog, species: species("rotom"), pokemon: bare, kind: "other", curated: FIXTURE_OVERRIDES.tags });
    expect(row.sprite_url).toBe(pokemon("rotom").sprites.official_artwork);
  });

  it("unions games and tags from an override and replaces other columns", () => {
    const row = buildRow({ catalog, species: species("persian"), pokemon: pokemon("persian-alola"), kind: "regional", curated: FIXTURE_OVERRIDES.tags });
    const patched = applyRowOverride(row, { games: ["champions"], tags: ["paradox"], display_name: "Persian (Alolan)", notes: "x" });
    expect(patched.games[0]).toBe("champions");
    expect(patched.games).toEqual(expect.arrayContaining(row.games));
    expect(patched.tags).toEqual(["paradox"]);
    expect(patched.display_name).toBe("Persian (Alolan)");
    expect(patched.slug).toBe("persian-alola");
    expect("notes" in patched).toBe(false);
  });

  it("flags rows that break the table's constraints", () => {
    const row = buildRow({ catalog, species: species("mew"), pokemon: pokemon("mew"), kind: "default", curated: FIXTURE_OVERRIDES.tags });
    const broken = { ...row, hp: 0, type1: "", generation: 12, games: ["nope"], form_kind: "weird" as never };
    const problems = validateRow(broken);
    expect(problems.length).toBe(5);
  });
});

describe("Serebii parsing", () => {
  it("reads dex, suffix, slug and name from the page markup", () => {
    const { rows, problems } = parseSerebiiPage(SEREBII_PAGE);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { dex: 6, suffix: "mx", slug: "charizard", name: "Mega Charizard X" },
      { dex: 83, suffix: null, slug: "farfetch'd", name: "Farfetch'd" },
      { dex: 128, suffix: "b", slug: "tauros", name: "Tauros" },
      { dex: 26, suffix: "a", slug: "raichu", name: "Raichu" },
    ]);
  });

  it("reports an icon without a name anchor", () => {
    const { rows, problems } = parseSerebiiPage(
      '<img src="/pokedex-champions/icon/006.png" /><img src="/pokedex-champions/icon/009.png" /><a href="/pokedex-champions/blastoise/">Blastoise</a>'
    );
    expect(rows).toEqual([{ dex: 9, suffix: null, slug: "blastoise", name: "Blastoise" }]);
    expect(problems).toEqual(["Icon #0006 has no name anchor after it."]);
  });

  it("resolves every suffix in the table against the species' varieties", () => {
    expect(Object.keys(SUFFIX_TABLE).sort()).toEqual(["a", "b", "e", "f", "g", "h", "l", "m", "mx", "my", "mz", "p"]);
    const cases: Array<[number, string, string | null, string]> = [
      [6, "Charizard", null, "charizard"],
      [6, "Mega Charizard X", "mx", "charizard-mega-x"],
      [6, "Mega Charizard Y", "my", "charizard-mega-y"],
      [26, "Raichu", "a", "raichu-alola"],
      [26, "Mega Raichu X", "mx", "raichu-mega-x"],
      [53, "Persian", "a", "persian-alola"],
      [128, "Tauros", "p", "tauros-paldea-combat-breed"],
      [128, "Tauros", "b", "tauros-paldea-blaze-breed"],
      [128, "Tauros", "a", "tauros-paldea-aqua-breed"],
      [670, "Floette", "e", "floette-eternal"],
      [670, "Mega Floette", "m", "floette-mega"],
      [678, "Mega Meowstic", "m", "meowstic-male-mega"],
      [678, "Meowstic", null, "meowstic-male"],
      [849, "Toxtricity", "l", "toxtricity-low-key"],
      [876, "Indeedee", "f", "indeedee-female"],
      [383, "Groudon", null, "groudon"],
    ];
    for (const [dex, name, suffix, slug] of cases) {
      expect(resolveSerebiiRow(serebiiRow(dex, name, suffix), catalog), `${dex}-${suffix}`).toEqual({ ok: true, slug });
    }
  });

  it("fails on an unknown suffix, an unmatched suffix, a wrong name and a missing species", () => {
    const unknown = resolveSerebiiRow(serebiiRow(6, "Charizard", "q"), catalog);
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.ok ? "" : unknown.error).toContain('unknown icon suffix "q"');

    const none = resolveSerebiiRow(serebiiRow(6, "Charizard", "g"), catalog);
    expect(none.ok ? "" : none.error).toContain("matches 0 varieties");

    const wrongName = resolveSerebiiRow(serebiiRow(6, "Blastoise", null), catalog);
    expect(wrongName.ok ? "" : wrongName.error).toContain("does not match species Charizard");

    const missing = resolveSerebiiRow(serebiiRow(9999, "Nobody", null), catalog);
    expect(missing.ok ? "" : missing.error).toContain("no species has dex number 9999");
  });

  it("fails when a suffix matches more than one variety", () => {
    const synthetic = buildCatalog({
      species: [
        {
          id: 9001,
          name: "twinmon",
          is_legendary: false,
          is_mythical: false,
          generation: { name: "generation-i" },
          names: [{ name: "Twinmon", language: { name: "en" } }],
          varieties: [
            { is_default: true, pokemon: { name: "twinmon-a" } },
            { is_default: false, pokemon: { name: "twinmon-mega" } },
            { is_default: false, pokemon: { name: "twinmon-a-mega" } },
          ],
          pokedex_numbers: [],
        },
      ],
      pokemon: [],
      forms: [],
    });
    const result = resolveSerebiiRow(serebiiRow(9001, "Mega Twinmon", "m"), synthetic);
    expect(result.ok ? "" : result.error).toContain("matches 2 varieties");
  });

  it("builds cumulative rosters and lists every unmapped row", () => {
    const { rosters, unmapped } = buildRosters(
      {
        "m-a": [serebiiRow(6, "Charizard"), serebiiRow(6, "Mega Charizard X", "mx"), serebiiRow(6, "Charizard")],
        "m-b": [serebiiRow(26, "Mega Raichu X", "mx")],
        "m-c": [serebiiRow(53, "Persian", "a"), serebiiRow(53, "Persian", "zz")],
      },
      catalog
    );
    expect(rosters).toEqual({
      "champions-m-a": ["charizard", "charizard-mega-x"],
      "champions-m-b": ["charizard", "charizard-mega-x", "raichu-mega-x"],
      "champions-m-c": ["charizard", "charizard-mega-x", "raichu-mega-x", "persian-alola"],
    });
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toContain('unknown icon suffix "zz"');
  });

  it("expands a suffix-less row to the species' other and gender rows that are in champions", () => {
    const rows = [
      { slug: "rotom", species_id: 479, form_kind: "default", games: ["champions", "scarlet_violet"] },
      { slug: "rotom-heat", species_id: 479, form_kind: "other", games: ["champions"] },
      { slug: "rotom-wash", species_id: 479, form_kind: "other", games: ["champions"] },
      { slug: "rotom-mow", species_id: 479, form_kind: "other", games: ["scarlet_violet"] },
      { slug: "meowstic-male", species_id: 678, form_kind: "default", games: ["champions"] },
      { slug: "meowstic-female", species_id: 678, form_kind: "gender", games: ["champions"] },
      { slug: "meowstic-male-mega", species_id: 678, form_kind: "mega", games: ["champions"] },
      { slug: "meowstic-female-mega", species_id: 678, form_kind: "mega", games: ["champions"] },
      { slug: "persian", species_id: 53, form_kind: "default", games: ["champions"] },
      { slug: "persian-alola", species_id: 53, form_kind: "regional", games: ["champions"] },
      { slug: "raichu", species_id: 26, form_kind: "default", games: ["champions"] },
      { slug: "raichu-alola", species_id: 26, form_kind: "regional", games: ["champions"] },
      { slug: "lycanroc-midday", species_id: 745, form_kind: "default", games: ["champions"] },
      { slug: "lycanroc-dusk", species_id: 745, form_kind: "other", games: ["champions"] },
    ];
    // Rotom and Meowstic are named by their default rows (a suffix-less
    // Serebii row); Raichu only by its Alolan icon; Persian by both. Mega
    // Meowstic on the roster stands for Meowstic (Female)'s Mega too.
    expect(expandRosterForms(["rotom", "meowstic-male", "meowstic-male-mega", "raichu-alola", "persian", "persian-alola"], rows)).toEqual([
      "rotom",
      "meowstic-male",
      "meowstic-male-mega",
      "raichu-alola",
      "persian",
      "persian-alola",
      "rotom-heat",
      "rotom-wash",
      "meowstic-female",
      "meowstic-female-mega",
    ]);
    // Rotom (Mow) is not in champions, Raichu's default row is not on the
    // roster, and Lycanroc is not named.
    expect(expandRosterForms([], rows)).toEqual([]);
    expect(expandRosterForms(["lycanroc-dusk"], rows)).toEqual(["lycanroc-dusk"]);
    expect(expandRosterForms(["unknown-slug"], rows)).toEqual(["unknown-slug"]);
  });

  it("adds a form's Mega only when the roster carries the default variety's Mega and both are in champions", () => {
    const rows = [
      { slug: "meowstic-male", species_id: 678, form_kind: "default", games: ["champions"] },
      { slug: "meowstic-female", species_id: 678, form_kind: "gender", games: ["champions"] },
      { slug: "meowstic-male-mega", species_id: 678, form_kind: "mega", games: ["champions"] },
      { slug: "meowstic-female-mega", species_id: 678, form_kind: "mega", games: ["champions"] },
    ];
    // Serebii lists Meowstic without Mega Meowstic: no Mega joins.
    expect(expandRosterForms(["meowstic-male"], rows)).toEqual(["meowstic-male", "meowstic-female"]);
    // Mega Meowstic without the plain Meowstic row names only itself.
    expect(expandRosterForms(["meowstic-male-mega"], rows)).toEqual(["meowstic-male-mega"]);
    // Mega Meowstic (Female) without a champions learnset stays off.
    const megaWithoutLearnset = rows.map((row) => (row.slug === "meowstic-female-mega" ? { ...row, games: [] } : row));
    expect(expandRosterForms(["meowstic-male", "meowstic-male-mega"], megaWithoutLearnset)).toEqual([
      "meowstic-male",
      "meowstic-male-mega",
      "meowstic-female",
    ]);
    // A Mega whose base form is not itself in champions does not join either.
    const formWithoutLearnset = rows.map((row) => (row.slug === "meowstic-female" ? { ...row, games: [] } : row));
    expect(expandRosterForms(["meowstic-male", "meowstic-male-mega"], formWithoutLearnset)).toEqual(["meowstic-male", "meowstic-male-mega"]);
  });
});

describe("presets", () => {
  const rows: RuleRow[] = [
    { slug: "a", games: ["scarlet_violet"], tags: [], dex_numbers: { paldea: 10 } },
    { slug: "b", games: ["scarlet_violet"], tags: ["paradox"], dex_numbers: { paldea: 380 } },
    { slug: "c", games: ["scarlet_violet"], tags: ["legendary", "sub_legendary"], dex_numbers: { paldea: 394 } },
    { slug: "d", games: ["scarlet_violet"], tags: ["legendary", "restricted"], dex_numbers: { paldea: 399 } },
    { slug: "e", games: ["scarlet_violet"], tags: [], dex_numbers: { kitakami: 3 } },
    { slug: "f", games: ["champions"], tags: [], dex_numbers: { paldea: 11 } },
    { slug: "g", games: ["scarlet_violet"], tags: ["mythical"], dex_numbers: { national: 151 } },
  ];

  it("applies dexes, dex ranges, tags and game availability", () => {
    const slugs = (list: typeof rows) => list.map((row) => row.slug);
    expect(slugs(applyFilterRule(rows, "scarlet_violet", { dexes: ["paldea"], dexRanges: null, excludeTags: [] }))).toEqual(["a", "b", "c", "d"]);
    expect(slugs(applyFilterRule(rows, "scarlet_violet", { dexes: ["paldea"], dexRanges: REGULATION_RANGES["sv-reg-a"], excludeTags: [] }))).toEqual(["a"]);
    expect(slugs(applyFilterRule(rows, "scarlet_violet", { dexes: ["paldea"], dexRanges: null, excludeTags: ["paradox", "legendary", "mythical"] }))).toEqual(["a"]);
    expect(slugs(applyFilterRule(rows, "scarlet_violet", { dexes: ["paldea", "kitakami"], dexRanges: null, excludeTags: ["restricted", "mythical"] }))).toEqual(["a", "b", "c", "e"]);
    expect(slugs(applyFilterRule(rows, "scarlet_violet", { dexes: null, dexRanges: null, excludeTags: ["mythical"] }))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("agrees between ranges and tags for Reg A to C, and reports a disagreement", () => {
    expect(checkRegulationAgreement(rows, PRESETS)).toEqual([]);
    const mistagged = rows.map((row) => (row.slug === "b" ? { ...row, tags: [] } : row));
    const problems = checkRegulationAgreement(mistagged, PRESETS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sv-reg-a");
    expect(problems[0]).toContain("Only by tags: [b]");
  });

  it("fills roster presets and leaves every other field alone", () => {
    const filled = fillRosters(PRESETS, { "champions-m-a": ["charizard"] });
    const ma = filled.find((preset) => preset.key === "champions-m-a")!;
    expect(ma.rule).toEqual({ kind: "roster", slugs: ["charizard"] });
    expect(ma.starts).toBe("2026-04-08");
    expect(filled.find((preset) => preset.key === "sv-reg-h")).toEqual(PRESETS.find((preset) => preset.key === "sv-reg-h"));
  });
});

describe("report checks", () => {
  it("asserts per-kind counts within 5% and warns on preset drift over 20%", () => {
    expect(kindCountProblems({ default: 1025, mega: 99 }, { default: 1025, mega: 97 })).toEqual([]);
    expect(kindCountProblems({ default: 900 }, { default: 1025 })).toHaveLength(1);
    expect(presetDriftWarnings({ byPreset: { "champions-m-a": 260 } }, { "champions-m-a": 262 })).toEqual([]);
    expect(presetDriftWarnings({ byPreset: { "champions-m-a": 260 } }, { "champions-m-a": 100 })).toHaveLength(1);
    expect(presetDriftWarnings(null, { "champions-m-a": 100 })).toEqual([]);
  });
});

describe("buildDataset on the fixture", () => {
  const serebiiPages = {
    "m-a": [
      serebiiRow(6, "Charizard"),
      serebiiRow(6, "Mega Charizard X", "mx"),
      serebiiRow(26, "Raichu", "a"),
      serebiiRow(128, "Tauros", "p"),
      serebiiRow(479, "Rotom"),
      serebiiRow(678, "Meowstic"),
      serebiiRow(678, "Mega Meowstic", "m"),
    ],
    "m-b": [serebiiRow(26, "Mega Raichu X", "mx")],
    "m-c": [serebiiRow(53, "Persian", "a"), serebiiRow(849, "Toxtricity", "l"), serebiiRow(876, "Indeedee", "f")],
  };

  it("produces rows, filled presets and a report without problems", () => {
    const result = buildDataset({
      catalog,
      overrides: FIXTURE_OVERRIDES,
      presets: PRESETS,
      serebiiPages,
      expectedKindCounts: null,
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(49);
    expect(result.report.byFormKind).toEqual({ default: 22, mega: 10, regional: 5, gender: 2, other: 10 });
    expect(result.report.unmappedRosterNames).toEqual([]);
    expect(result.report.skippedByReason["cosmetic pikachu"]).toBe(15);
    expect(result.report.skippedByReason["gigantamax"]).toBe(1);
    expect(result.report.skippedByReason[DUPLICATE_REASON]).toBe(10);
    expect(result.rows.some((row) => row.slug.endsWith("-eternamax"))).toBe(false);
    expect(result.report.skipped.find((entry) => entry.slug === "minior-orange")).toEqual({
      slug: "minior-orange",
      species: "minior",
      rule: 7,
      reason: DUPLICATE_REASON,
      sameAs: "minior-red",
    });
    expect(result.rows.find((row) => row.slug === "minior-red")?.display_name).toBe("Minior (Core)");

    // Sorted by species then id, ids and names unique.
    const order = result.rows.map((row) => [row.species_id, row.id]);
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(new Set(result.rows.map((row) => row.display_name)).size).toBe(result.rows.length);

    // Overrides applied.
    const persianAlola = result.rows.find((row) => row.slug === "persian-alola")!;
    expect(persianAlola.games).toContain("champions");
    expect(result.rows.find((row) => row.slug === "koraidon")!.tags).toEqual(["legendary", "restricted"]);

    // Rosters are cumulative and in dataset order; the suffix-less Rotom and
    // Meowstic rows bring in the appliance forms and Meowstic (Female) that
    // carry champions, and Mega Meowstic on the roster brings in Mega
    // Meowstic (Female).
    const mc = result.regulations.find((preset) => preset.key === "champions-m-c")!;
    expect(mc.rule).toEqual({
      kind: "roster",
      slugs: [
        "charizard",
        "charizard-mega-x",
        "raichu-alola",
        "raichu-mega-x",
        "persian-alola",
        "tauros-paldea-combat-breed",
        "rotom",
        "rotom-heat",
        "rotom-wash",
        "rotom-frost",
        "rotom-fan",
        "rotom-mow",
        "meowstic-male",
        "meowstic-female",
        "meowstic-male-mega",
        "meowstic-female-mega",
        "toxtricity-low-key",
        "indeedee-female",
      ],
    });
    expect(result.report.byPreset["champions-m-a"]).toBe(14);
    expect(result.report.byPreset["champions-m-b"]).toBe(15);
    expect(result.report.byPreset["champions-m-c"]).toBe(18);
    // Reg A keeps Paldea-dex rows that are not Paradox or legendary.
    expect(result.report.byPreset["sv-reg-a"]).toBeGreaterThan(0);
    expect(result.rows.filter((row) => row.games.includes("scarlet_violet") && row.dex_numbers.paldea === 399)).toHaveLength(1);
  });

  it("fails when a roster slug has no champions availability", () => {
    const result = buildDataset({
      catalog,
      overrides: { ...FIXTURE_OVERRIDES, rows: {} },
      presets: PRESETS,
      serebiiPages,
      expectedKindCounts: null,
    });
    expect(result.problems.some((problem) => problem.includes('"persian-alola" is not available in champions'))).toBe(true);
  });

  it("fails on an unmapped roster name, a duplicate display name and a mistagged Reg A", () => {
    const result = buildDataset({
      catalog,
      overrides: {
        ...FIXTURE_OVERRIDES,
        tags: { ...FIXTURE_OVERRIDES.tags, paradox: [] },
        rows: { ...FIXTURE_OVERRIDES.rows, "rotom-wash": { display_name: "Rotom (Heat)" } },
      },
      presets: PRESETS,
      serebiiPages: { ...serebiiPages, "m-c": [serebiiRow(53, "Persian", "x")] },
      expectedKindCounts: null,
    });
    expect(result.problems.some((problem) => problem.includes('unknown icon suffix "x"'))).toBe(true);
    expect(result.problems.some((problem) => problem.includes('display_name "Rotom (Heat)" is shared by rotom-heat, rotom-wash'))).toBe(true);
    expect(result.problems.some((problem) => problem.includes("sv-reg-a") && problem.includes("great-tusk"))).toBe(true);
  });

  it("fails when the per-kind counts leave the expected window", () => {
    const result = buildDataset({
      catalog,
      overrides: FIXTURE_OVERRIDES,
      presets: PRESETS,
      serebiiPages,
      expectedKindCounts: { default: 1025 },
    });
    expect(result.problems.some((problem) => problem.includes('Form kind "default": 22 rows, expected 1025'))).toBe(true);
  });

  it("rejects an override for a skipped variety and an unknown column", () => {
    const result = buildDataset({
      catalog,
      overrides: { ...FIXTURE_OVERRIDES, rows: { ...FIXTURE_OVERRIDES.rows, "charizard-gmax": { games: ["champions"] }, mew: { colour: "pink" } } },
      presets: PRESETS,
      serebiiPages,
      expectedKindCounts: null,
    });
    expect(result.problems.some((problem) => problem.includes("charizard-gmax") && problem.includes("keep"))).toBe(true);
    expect(result.problems.some((problem) => problem.includes('"colour" is not a dataset column'))).toBe(true);
  });
});

describe("fetch helpers", () => {
  it("sends a User-Agent, retries 5xx with backoff and gives up on 404", async () => {
    const calls: Array<{ url: string; agent: string | undefined }> = [];
    const statuses = [503, 200];
    const sleeps: number[] = [];
    const fetchJson = createJsonFetcher({
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        calls.push({ url: String(url), agent: headers?.["user-agent"] });
        const status = statuses.shift() ?? 200;
        return new Response(status === 200 ? '{"ok":true}' : "nope", { status });
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      baseDelayMs: 100,
    });
    await expect(fetchJson("https://example.test/a")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].agent).toContain("pokedrafts");
    expect(sleeps).toEqual([100]);

    const notFound = createJsonFetcher({
      fetch: (async () => new Response("missing", { status: 404 })) as typeof fetch,
      sleep: async () => {},
    });
    await expect(notFound("https://example.test/b")).rejects.toThrow("HTTP 404");
  });

  it("caps requests in flight and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, value));
      inFlight -= 1;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    await expect(
      mapLimit([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error("boom");
        return value;
      })
    ).rejects.toThrow("boom");
  });
});
