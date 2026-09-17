import { describe, expect, it } from "vitest";
import report from "@/data/pokemon/report.json";
import {
  applyRules,
  bandsProblem,
  BUILDER_GAMES,
  DEFAULT_BANDS,
  defaultRules,
  describePreset,
  describeRules,
  FORM_KIND_LABELS,
  GAME_LABELS,
  isGameKey,
  isValidBands,
  parseFormatRules,
  parsePresets,
  presetDates,
  PRESETS,
  presetsForSource,
  priceByBands,
  rulesProblems,
  TAG_LABELS,
} from "@/app/lib/pokemon/rules";
import { GAME_KEYS } from "@/scripts/lib/pokemon-data/games.mjs";
import type {
  FormatRules,
  PokemonEntry,
  Preset,
  TagKey,
} from "@/app/types/pokemon";

/**
 * The Pool Builder's rule engine (docs/release-architecture.md 13.5 to
 * 13.8) on a hand-written dataset: every form kind and tag, a Champions
 * roster, the Scarlet/Violet filter rules, each format filter, the pricing
 * bands and the one-line descriptions.
 */

type Overrides = Partial<PokemonEntry> & { slug: string; display_name: string };

let nextId = 1;

function entry(overrides: Overrides): PokemonEntry {
  const id = overrides.id ?? nextId++;
  const stats = {
    hp: 80,
    attack: 80,
    defense: 80,
    special_attack: 80,
    special_defense: 80,
    speed: 80,
    ...overrides,
  };
  const bst =
    overrides.bst ??
    stats.hp +
      stats.attack +
      stats.defense +
      stats.special_attack +
      stats.special_defense +
      stats.speed;
  return {
    id,
    species_id: overrides.species_id ?? id,
    species_name: overrides.display_name,
    form_kind: "default",
    form_label: null,
    type1: "Normal",
    type2: null,
    generation: 1,
    tags: [],
    games: ["champions", "scarlet_violet"],
    dex_numbers: {},
    sprite_url: null,
    updated_at: null,
    ...overrides,
    hp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    special_attack: stats.special_attack,
    special_defense: stats.special_defense,
    speed: stats.speed,
    bst,
  };
}

const SV = ["scarlet_violet"];
const CH = ["champions"];
const BOTH = ["champions", "scarlet_violet"];

/** 42 rows: every form kind, every tag, both games, a Showdown-only pair. */
const dataset: PokemonEntry[] = [
  entry({ slug: "bulbasaur", display_name: "Bulbasaur", type1: "Grass", type2: "Poison", bst: 318, games: BOTH, dex_numbers: { paldea: 0 } }),
  entry({ slug: "venusaur", display_name: "Venusaur", type1: "Grass", type2: "Poison", bst: 525, games: BOTH }),
  entry({ slug: "venusaur-mega", display_name: "Mega Venusaur", species_name: "Venusaur", form_kind: "mega", form_label: "Mega", type1: "Grass", type2: "Poison", bst: 625, games: CH }),
  entry({ slug: "charizard", display_name: "Charizard", type1: "Fire", type2: "Flying", bst: 534, games: BOTH }),
  entry({ slug: "charizard-mega-x", display_name: "Mega Charizard X", species_name: "Charizard", form_kind: "mega", form_label: "Mega X", type1: "Fire", type2: "Dragon", bst: 634, games: CH }),
  entry({ slug: "charizard-mega-y", display_name: "Mega Charizard Y", species_name: "Charizard", form_kind: "mega", form_label: "Mega Y", type1: "Fire", type2: "Flying", bst: 634, games: CH }),
  entry({ slug: "pikachu", display_name: "Pikachu", type1: "Electric", bst: 320, games: BOTH, dex_numbers: { paldea: 74 } }),
  entry({ slug: "raichu", display_name: "Raichu", type1: "Electric", bst: 485, games: BOTH, dex_numbers: { paldea: 75 } }),
  entry({ slug: "raichu-alola", display_name: "Alolan Raichu", species_name: "Raichu", form_kind: "regional", form_label: "Alolan", type1: "Electric", type2: "Psychic", bst: 485, generation: 7, games: SV, dex_numbers: { paldea: 75 } }),
  entry({ slug: "gyarados", display_name: "Gyarados", type1: "Water", type2: "Flying", bst: 540, games: BOTH, dex_numbers: { paldea: 150 } }),
  // A Mega whose species is in the Paldea dex but which no SV game has.
  entry({ slug: "gyarados-mega", display_name: "Mega Gyarados", species_name: "Gyarados", form_kind: "mega", form_label: "Mega", type1: "Water", type2: "Dark", bst: 640, games: CH, dex_numbers: { paldea: 150 } }),
  entry({ slug: "mewtwo", display_name: "Mewtwo", type1: "Psychic", bst: 680, tags: ["legendary", "restricted"], games: CH }),
  entry({ slug: "mewtwo-mega-x", display_name: "Mega Mewtwo X", species_name: "Mewtwo", form_kind: "mega", form_label: "Mega X", type1: "Psychic", type2: "Fighting", bst: 780, tags: ["legendary", "restricted"], games: CH }),
  entry({ slug: "mew", display_name: "Mew", type1: "Psychic", bst: 600, tags: ["mythical"], games: CH }),
  entry({ slug: "articuno", display_name: "Articuno", type1: "Ice", type2: "Flying", bst: 580, tags: ["legendary", "sub_legendary"], games: SV }),
  entry({ slug: "articuno-galar", display_name: "Galarian Articuno", species_name: "Articuno", form_kind: "regional", form_label: "Galarian", type1: "Psychic", type2: "Flying", bst: 580, generation: 8, tags: ["legendary", "sub_legendary"], games: SV }),
  entry({ slug: "blissey", display_name: "Blissey", type1: "Normal", hp: 255, attack: 10, defense: 10, special_attack: 75, special_defense: 135, speed: 55, generation: 2, games: SV, dex_numbers: { paldea: 86 } }),
  entry({ slug: "rotom", display_name: "Rotom", type1: "Electric", type2: "Ghost", bst: 440, generation: 4, games: SV, dex_numbers: { paldea: 120 } }),
  entry({ slug: "rotom-wash", display_name: "Rotom (Wash)", species_name: "Rotom", form_kind: "other", form_label: "Wash", type1: "Electric", type2: "Water", bst: 520, generation: 4, games: SV, dex_numbers: { paldea: 120 } }),
  entry({ slug: "garchomp", display_name: "Garchomp", type1: "Dragon", type2: "Ground", bst: 600, generation: 4, games: BOTH, dex_numbers: { paldea: 306 } }),
  entry({ slug: "dragonite", display_name: "Dragonite", type1: "Dragon", type2: "Flying", bst: 600, games: BOTH, dex_numbers: { paldea: 380 } }),
  entry({ slug: "meowstic", display_name: "Meowstic", type1: "Psychic", bst: 466, generation: 6, games: SV, dex_numbers: { paldea: 179 } }),
  entry({ slug: "meowstic-female", display_name: "Meowstic (Female)", species_name: "Meowstic", form_kind: "gender", form_label: "Female", type1: "Psychic", bst: 466, generation: 6, games: SV, dex_numbers: { paldea: 179 } }),
  entry({ slug: "indeedee", display_name: "Indeedee", type1: "Psychic", type2: "Normal", bst: 475, generation: 8, games: SV, dex_numbers: { paldea: 288 } }),
  entry({ slug: "indeedee-female", display_name: "Indeedee (Female)", species_name: "Indeedee", form_kind: "gender", form_label: "Female", type1: "Psychic", type2: "Normal", bst: 475, generation: 8, games: SV, dex_numbers: { paldea: 288 } }),
  entry({ slug: "nihilego", display_name: "Nihilego", type1: "Rock", type2: "Poison", bst: 570, generation: 7, tags: ["ultra_beast"], games: SV }),
  entry({ slug: "tauros-paldea-combat-breed", display_name: "Paldean Tauros", species_name: "Tauros", form_kind: "regional", form_label: "Combat Breed", type1: "Fighting", bst: 490, generation: 9, games: SV, dex_numbers: { paldea: 223 } }),
  entry({ slug: "tauros-paldea-blaze-breed", display_name: "Paldean Tauros (Blaze Breed)", species_name: "Tauros", form_kind: "regional", form_label: "Blaze Breed", type1: "Fighting", type2: "Fire", bst: 490, generation: 9, games: SV, dex_numbers: { paldea: 223 } }),
  entry({ slug: "great-tusk", display_name: "Great Tusk", type1: "Ground", type2: "Fighting", bst: 570, generation: 9, tags: ["paradox"], games: SV, dex_numbers: { paldea: 377 } }),
  entry({ slug: "flutter-mane", display_name: "Flutter Mane", type1: "Ghost", type2: "Fairy", bst: 570, generation: 9, tags: ["paradox"], games: SV, dex_numbers: { paldea: 389 } }),
  entry({ slug: "iron-valiant", display_name: "Iron Valiant", type1: "Fairy", type2: "Fighting", bst: 590, generation: 9, tags: ["paradox"], games: SV, dex_numbers: { paldea: 397 } }),
  entry({ slug: "wo-chien", display_name: "Wo-Chien", type1: "Dark", type2: "Grass", bst: 570, generation: 9, tags: ["legendary", "sub_legendary"], games: SV, dex_numbers: { paldea: 393 } }),
  entry({ slug: "ting-lu", display_name: "Ting-Lu", type1: "Dark", type2: "Ground", bst: 570, generation: 9, tags: ["legendary", "sub_legendary"], games: SV, dex_numbers: { paldea: 394 } }),
  entry({ slug: "koraidon", display_name: "Koraidon", type1: "Fighting", type2: "Dragon", bst: 670, generation: 9, tags: ["legendary", "restricted"], games: SV, dex_numbers: { paldea: 399 } }),
  entry({ slug: "ogerpon", display_name: "Ogerpon", type1: "Grass", bst: 550, generation: 9, tags: ["legendary", "sub_legendary"], games: SV, dex_numbers: { kitakami: 196 } }),
  entry({ slug: "ogerpon-wellspring-mask", display_name: "Ogerpon (Wellspring Mask)", species_name: "Ogerpon", form_kind: "other", form_label: "Wellspring Mask", type1: "Grass", type2: "Water", bst: 550, generation: 9, tags: ["legendary", "sub_legendary"], games: SV, dex_numbers: { kitakami: 196 } }),
  entry({ slug: "ursaluna-bloodmoon", display_name: "Ursaluna (Bloodmoon)", species_name: "Ursaluna", form_kind: "other", form_label: "Bloodmoon", type1: "Ground", type2: "Normal", bst: 555, generation: 9, games: SV, dex_numbers: { kitakami: 194 } }),
  entry({ slug: "terapagos", display_name: "Terapagos", type1: "Normal", bst: 450, generation: 9, tags: ["legendary", "restricted"], games: SV, dex_numbers: { blueberry: 240 } }),
  entry({ slug: "urshifu-rapid-strike", display_name: "Urshifu (Rapid Strike)", species_name: "Urshifu", form_kind: "other", form_label: "Rapid Strike", type1: "Fighting", type2: "Water", bst: 550, generation: 8, tags: ["legendary", "sub_legendary"], games: SV }),
  // HOME transfers: in the game, in no regional dex.
  entry({ slug: "zoroark-hisui", display_name: "Hisuian Zoroark", species_name: "Zoroark", form_kind: "regional", form_label: "Hisuian", type1: "Normal", type2: "Ghost", bst: 510, generation: 8, games: SV }),
  // Showdown only: in no game the dataset knows.
  entry({ slug: "arceus", display_name: "Arceus", type1: "Normal", bst: 720, generation: 4, tags: ["mythical"], games: [] }),
  entry({ slug: "deoxys-speed", display_name: "Deoxys (Speed)", species_name: "Deoxys", form_kind: "other", form_label: "Speed", type1: "Psychic", hp: 50, attack: 95, defense: 90, special_attack: 95, special_defense: 90, speed: 180, generation: 3, tags: ["mythical"], games: [] }),
];

const filterPreset = (
  key: string,
  rule: Omit<Extract<Preset["rule"], { kind: "filter" }>, "kind">,
  name = key
): Preset => ({
  key,
  game: "scarlet_violet",
  name,
  starts: "2024-01-04",
  ends: "2024-04-30",
  source: "https://example.test/rules",
  rule: { kind: "filter", ...rule },
});

const presets: Preset[] = [
  {
    key: "champions-m-c",
    game: "champions",
    name: "Regulation Set M-C",
    starts: "2026-09-09",
    ends: "2026-12-02",
    source: "https://example.test/m-c",
    rule: { kind: "roster", slugs: ["venusaur", "venusaur-mega", "charizard", "mewtwo", "ghost-slug"] },
  },
  {
    key: "champions-empty",
    game: "champions",
    name: "Regulation Set M-Z",
    starts: "2027-01-01",
    ends: null,
    source: "",
    rule: { kind: "roster", slugs: [] },
  },
  filterPreset("sv-reg-a", { dexes: ["paldea"], dexRanges: { paldea: [[1, 375], [388, 392]] }, excludeTags: ["paradox", "legendary", "mythical"], restrictedPerTeam: 0 }, "Regulation Set A"),
  filterPreset("sv-reg-b", { dexes: ["paldea"], dexRanges: null, excludeTags: ["legendary", "mythical"], restrictedPerTeam: 0 }, "Regulation Set B"),
  filterPreset("sv-reg-c", { dexes: ["paldea"], dexRanges: null, excludeTags: ["restricted", "mythical"], restrictedPerTeam: 0 }, "Regulation Set C"),
  filterPreset("sv-reg-d", { dexes: null, dexRanges: null, excludeTags: ["restricted", "mythical"], restrictedPerTeam: 0 }, "Regulation Set D"),
  filterPreset("sv-reg-e", { dexes: ["paldea", "kitakami"], dexRanges: null, excludeTags: ["restricted", "mythical"], restrictedPerTeam: 0 }, "Regulation Set E"),
  filterPreset("sv-reg-g", { dexes: null, dexRanges: null, excludeTags: ["mythical"], restrictedPerTeam: 1 }, "Regulation Set G"),
  filterPreset("sv-reg-h", { dexes: null, dexRanges: null, excludeTags: ["legendary", "mythical", "paradox"], restrictedPerTeam: 0 }, "Regulation Set H"),
];

function rules(patch: Partial<FormatRules> = {}, filters: Partial<FormatRules["filters"]> = {}): FormatRules {
  const base = defaultRules({ kind: "all" });
  return { ...base, ...patch, filters: { ...base.filters, ...filters } };
}

function slugs(result: PokemonEntry[]): string[] {
  return result.map((row) => row.slug);
}

function names(result: PokemonEntry[]): string[] {
  return result.map((row) => row.display_name);
}

const svSlugs = slugs(dataset.filter((row) => row.games.includes("scarlet_violet")));

describe("fixture", () => {
  it("covers every form kind and tag, both games and rows in no game", () => {
    const kinds = new Set(dataset.map((row) => row.form_kind));
    expect([...kinds].sort()).toEqual(Object.keys(FORM_KIND_LABELS).sort());
    const tags = new Set(dataset.flatMap((row) => row.tags));
    expect([...tags].sort()).toEqual(Object.keys(TAG_LABELS).sort());
    expect(dataset.some((row) => row.games.length === 0)).toBe(true);
    expect(dataset.length).toBeGreaterThanOrEqual(40);
    expect(new Set(dataset.map((row) => row.slug)).size).toBe(dataset.length);
  });
});

describe("source", () => {
  it("All Pokémon is every row, sorted by stat total then name", () => {
    const result = applyRules(dataset, presets, rules());
    expect(result).toHaveLength(dataset.length);
    for (let index = 1; index < result.length; index += 1) {
      const previous = result[index - 1];
      const current = result[index];
      expect(previous.bst).toBeGreaterThanOrEqual(current.bst);
      if (previous.bst === current.bst) {
        expect(previous.display_name.localeCompare(current.display_name, "en")).toBeLessThanOrEqual(0);
      }
    }
    expect(names(result).slice(0, 3)).toEqual(["Mega Mewtwo X", "Arceus", "Mewtwo"]);
  });

  it("a game keeps only the rows available in it; several games union", () => {
    const champions = applyRules(dataset, presets, rules({ source: { kind: "games", games: ["champions"] } }));
    expect(slugs(champions).sort()).toEqual(
      slugs(dataset.filter((row) => row.games.includes("champions"))).sort()
    );
    expect(slugs(champions)).not.toContain("arceus");
    expect(slugs(champions)).not.toContain("koraidon");

    const both = applyRules(dataset, presets, rules({ source: { kind: "games", games: ["champions", "scarlet_violet"] } }));
    expect(both).toHaveLength(dataset.length - 2);
    expect(slugs(both)).not.toContain("arceus");
    expect(slugs(both)).not.toContain("deoxys-speed");
  });

  it("no game chosen matches nothing and is reported as a problem", () => {
    const empty = rules({ source: { kind: "games", games: [] } });
    expect(applyRules(dataset, presets, empty)).toEqual([]);
    expect(rulesProblems(empty)).toEqual(["Choose at least one game, or start from All Pokémon."]);
  });
});

describe("roster presets", () => {
  it("intersect the source with the roster on slug", () => {
    const result = applyRules(
      dataset,
      presets,
      rules({ source: { kind: "games", games: ["champions"] }, preset: "champions-m-c" })
    );
    expect(slugs(result)).toEqual(["mewtwo", "venusaur-mega", "charizard", "venusaur"]);
  });

  it("still respect the source: a roster slug outside the chosen game is not added", () => {
    const result = applyRules(
      dataset,
      presets,
      rules({ source: { kind: "games", games: ["scarlet_violet"] }, preset: "champions-m-c" })
    );
    expect(slugs(result)).toEqual(["charizard", "venusaur"]);
  });

  it("an empty roster matches nothing and says so", () => {
    expect(applyRules(dataset, presets, rules({ preset: "champions-empty" }))).toEqual([]);
    expect(describePreset(presets[1])).toBe("Roster not loaded yet");
    expect(describePreset(presets[0])).toBe("A fixed roster of 5 Pokémon");
  });

  it("an unknown preset key is ignored", () => {
    const unknown = applyRules(dataset, presets, rules({ preset: "sv-reg-zz" }));
    expect(unknown).toEqual(applyRules(dataset, presets, rules()));
    expect(rulesProblems(rules({ preset: "sv-reg-zz" }))).toEqual([]);
  });
});

describe("filter presets (docs 13.6)", () => {
  it("Reg A: Paldea dex 1-375 and 388-392, no Paradox, legendary or mythical", () => {
    const result = applyRules(dataset, presets, rules({ preset: "sv-reg-a" }));
    expect(slugs(result).sort()).toEqual(
      [
        "pikachu",
        "raichu",
        "raichu-alola",
        "gyarados",
        "blissey",
        "rotom",
        "rotom-wash",
        "garchomp",
        "meowstic",
        "meowstic-female",
        "indeedee",
        "indeedee-female",
        "tauros-paldea-combat-breed",
        "tauros-paldea-blaze-breed",
      ].sort()
    );
    // Entry 380 is outside both ranges; 389 is inside but Paradox; 0 is below 1.
    expect(slugs(result)).not.toContain("dragonite");
    expect(slugs(result)).not.toContain("flutter-mane");
    expect(slugs(result)).not.toContain("bulbasaur");
    // A Mega with a Paldea number is not in Scarlet/Violet.
    expect(slugs(result)).not.toContain("gyarados-mega");
  });

  it("Reg B and C: the whole Paldea dex, then the Treasures of Ruin", () => {
    const regB = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-b" })));
    expect(regB).toContain("great-tusk");
    expect(regB).toContain("flutter-mane");
    expect(regB).toContain("dragonite");
    expect(regB).not.toContain("wo-chien");
    expect(regB).not.toContain("koraidon");

    const regC = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-c" })));
    expect(regC).toContain("wo-chien");
    expect(regC).toContain("ting-lu");
    expect(regC).not.toContain("koraidon");
    expect(regC).not.toContain("ogerpon");
  });

  it("dexes null means every row available in the preset's game", () => {
    const regD = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-d" })));
    expect(regD).toContain("zoroark-hisui");
    expect(regD).toContain("articuno");
    expect(regD).toContain("nihilego");
    expect(regD).not.toContain("koraidon");
    expect(regD).not.toContain("terapagos");
    expect(regD).not.toContain("arceus");
    expect(regD).not.toContain("venusaur-mega");

    const regH = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-h" })));
    expect(regH).toContain("zoroark-hisui");
    expect(regH).toContain("nihilego");
    expect(regH).not.toContain("articuno");
    expect(regH).not.toContain("great-tusk");
    expect(regH).not.toContain("urshifu-rapid-strike");

    const regG = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-g" })));
    expect(regG.sort()).toEqual(svSlugs.filter((slug) => slug !== "mew").sort());
  });

  it("Reg E: Paldea and Kitakami dexes", () => {
    const regE = slugs(applyRules(dataset, presets, rules({ preset: "sv-reg-e" })));
    expect(regE).toContain("ogerpon");
    expect(regE).toContain("ogerpon-wellspring-mask");
    expect(regE).toContain("ursaluna-bloodmoon");
    expect(regE).not.toContain("terapagos");
    expect(regE).not.toContain("zoroark-hisui");
    expect(regE).not.toContain("articuno");
  });

  it("a filter preset with source All Pokémon still needs the game", () => {
    const result = applyRules(dataset, presets, rules({ source: { kind: "all" }, preset: "sv-reg-g" }));
    expect(slugs(result)).not.toContain("arceus");
    expect(slugs(result)).not.toContain("mewtwo");
  });
});

describe("format filters", () => {
  it("stat total minimum and maximum are inclusive", () => {
    const result = applyRules(dataset, presets, rules({}, { bst: { min: 600, max: 634 } }));
    expect(names(result)).toEqual([
      "Mega Charizard X",
      "Mega Charizard Y",
      "Mega Venusaur",
      "Deoxys (Speed)",
      "Dragonite",
      "Garchomp",
      "Mew",
    ]);
  });

  it("per-stat maximums apply to each stat", () => {
    const hp = applyRules(dataset, presets, rules({}, { stats: { ...defaultRules().filters.stats, hp: 200 } }));
    expect(slugs(hp)).not.toContain("blissey");
    expect(hp).toHaveLength(dataset.length - 1);

    const speed = applyRules(dataset, presets, rules({}, { stats: { ...defaultRules().filters.stats, speed: 100 } }));
    expect(slugs(speed)).not.toContain("deoxys-speed");
    expect(speed).toHaveLength(dataset.length - 1);
  });

  it("generation bounds are inclusive", () => {
    const result = applyRules(dataset, presets, rules({}, { generation: { min: 6, max: 8 } }));
    expect(slugs(result).sort()).toEqual(
      ["raichu-alola", "articuno-galar", "meowstic", "meowstic-female", "indeedee", "indeedee-female", "nihilego", "urshifu-rapid-strike", "zoroark-hisui"].sort()
    );
  });

  it("types match either of a Pokémon's types, ignoring case", () => {
    const result = applyRules(dataset, presets, rules({}, { types: ["dragon"] }));
    expect(slugs(result).sort()).toEqual(["charizard-mega-x", "garchomp", "dragonite", "koraidon"].sort());
    expect(applyRules(dataset, presets, rules({}, { types: [] }))).toHaveLength(dataset.length);
  });

  it("excluded categories drop rows carrying any of them", () => {
    const result = applyRules(dataset, presets, rules({}, { excludeTags: ["mythical", "ultra_beast"] }));
    expect(slugs(result)).not.toContain("mew");
    expect(slugs(result)).not.toContain("arceus");
    expect(slugs(result)).not.toContain("deoxys-speed");
    expect(slugs(result)).not.toContain("nihilego");
    expect(result).toHaveLength(dataset.length - 4);

    const subs = applyRules(dataset, presets, rules({}, { excludeTags: ["sub_legendary"] }));
    expect(slugs(subs)).toContain("mewtwo");
    expect(slugs(subs)).not.toContain("articuno");
  });

  it("form toggles remove one kind at a time; default rows always stay", () => {
    const noMegas = applyRules(dataset, presets, rules({}, { forms: { mega: false, regional: true, gender: true, other: true } }));
    expect(noMegas.every((row) => row.form_kind !== "mega")).toBe(true);
    expect(noMegas).toHaveLength(dataset.length - 5);

    const onlyDefault = applyRules(dataset, presets, rules({}, { forms: { mega: false, regional: false, gender: false, other: false } }));
    expect(onlyDefault.every((row) => row.form_kind === "default")).toBe(true);
    expect(onlyDefault).toHaveLength(dataset.filter((row) => row.form_kind === "default").length);

    const noGender = applyRules(dataset, presets, rules({}, { forms: { mega: true, regional: true, gender: false, other: true } }));
    expect(slugs(noGender)).toContain("meowstic");
    expect(slugs(noGender)).not.toContain("meowstic-female");
  });

  it("combines a preset with the format's own filters", () => {
    const result = applyRules(
      dataset,
      presets,
      rules({ source: { kind: "games", games: ["scarlet_violet"] }, preset: "sv-reg-c" }, { bst: { min: null, max: 500 }, types: ["Fighting"] })
    );
    // Equal totals sort by display name: "Paldean Tauros" before "Paldean Tauros (Blaze Breed)".
    expect(slugs(result)).toEqual(["tauros-paldea-combat-breed", "tauros-paldea-blaze-breed"]);
  });
});

describe("pricing bands", () => {
  it("map a stat total to the points of the first band it reaches", () => {
    expect(priceByBands(700, DEFAULT_BANDS)).toBe(20);
    expect(priceByBands(1000, DEFAULT_BANDS)).toBe(20);
    expect(priceByBands(699, DEFAULT_BANDS)).toBe(19);
    expect(priceByBands(680, DEFAULT_BANDS)).toBe(19);
    expect(priceByBands(600, DEFAULT_BANDS)).toBe(16);
    expect(priceByBands(599, DEFAULT_BANDS)).toBe(15);
    expect(priceByBands(280, DEFAULT_BANDS)).toBe(2);
    expect(priceByBands(279, DEFAULT_BANDS)).toBe(1);
    expect(priceByBands(0, DEFAULT_BANDS)).toBe(1);
  });

  it("never return less than 1 point, even for a list that does not end in 0", () => {
    expect(priceByBands(100, [700, 600])).toBe(1);
    expect(priceByBands(650, [700, 600])).toBe(19);
  });

  it("default bands are 20 descending integers ending in 0", () => {
    expect(DEFAULT_BANDS).toHaveLength(20);
    expect(bandsProblem([...DEFAULT_BANDS])).toBeNull();
    expect(isValidBands([...DEFAULT_BANDS])).toBe(true);
  });

  it.each([
    [[...DEFAULT_BANDS].slice(0, 19), /20 minimum totals/],
    [[...DEFAULT_BANDS, 0], /20 minimum totals/],
    [[...DEFAULT_BANDS.slice(0, 19), 5], /1 point must be 0/],
    [DEFAULT_BANDS.map((band, index) => (index === 3 ? 650 : band)), /17 points must be lower than the one for 18 points/],
    [DEFAULT_BANDS.map((band, index) => (index === 3 ? 660 : band)), /17 points must be lower than the one for 18 points/],
    [DEFAULT_BANDS.map((band, index) => (index === 0 ? 700.5 : band)), /20 points must be a whole number/],
    [DEFAULT_BANDS.map((band, index) => (index === 18 ? -1 : band)), /2 points cannot be negative/],
    ["nope", /20 minimum totals/],
  ])("rejects %j", (bands, message) => {
    expect(bandsProblem(bands)).toMatch(message);
    expect(isValidBands(bands)).toBe(false);
  });

  it("edge values: every threshold prices exactly at its own points", () => {
    DEFAULT_BANDS.forEach((band, index) => {
      expect(priceByBands(band, DEFAULT_BANDS)).toBe(20 - index);
    });
  });
});

describe("game keys", () => {
  it("spells every key the way the data build and the seeded table do", () => {
    // Adding a checkbox later is a one-line change only while the two lists
    // agree (13.1); a misspelt key is silently dropped from saved rules.
    expect([...Object.keys(GAME_LABELS)].sort()).toEqual([...GAME_KEYS].sort());
    for (const key of Object.keys(report.byGame)) {
      expect(isGameKey(key), key).toBe(true);
    }
    expect(
      parseFormatRules({ source: { kind: "games", games: ["firered_leafgreen", "heartgold_soulsilver"] } })?.source
    ).toEqual({ kind: "games", games: ["firered_leafgreen", "heartgold_soulsilver"] });
    expect(isGameKey("heart_gold_soul_silver")).toBe(false);
  });
});

describe("rulesProblems", () => {
  it("accepts the defaults for both sources", () => {
    expect(rulesProblems(defaultRules())).toEqual([]);
    expect(rulesProblems(defaultRules({ kind: "all" }))).toEqual([]);
    expect(defaultRules().source).toEqual({ kind: "games", games: ["champions"] });
    expect(BUILDER_GAMES).toEqual(["champions", "scarlet_violet"]);
  });

  it("reports stat, generation and band problems together", () => {
    const bad = rules(
      { pricing: { mode: "bands", bands: [...DEFAULT_BANDS.slice(0, 19), 1] } },
      {
        bst: { min: 700, max: 600 },
        stats: { ...defaultRules().filters.stats, hp: 300, speed: -1 },
        generation: { min: 0, max: 10 },
      }
    );
    expect(rulesProblems(bad)).toEqual([
      "Stat total minimum cannot be above the maximum.",
      "Maximum HP must be between 0 and 255.",
      "Maximum Speed must be between 0 and 255.",
      "Generation minimum must be between 1 and 9.",
      "Generation maximum must be between 1 and 9.",
      "The minimum total for 1 point must be 0 so every Pokémon gets a price.",
    ]);
  });

  it("does not check bands when pricing is manual", () => {
    expect(rulesProblems(rules({ pricing: { mode: "manual" } }))).toEqual([]);
  });
});

describe("parseFormatRules", () => {
  it("round-trips the defaults and ignores unknown keys", () => {
    const original = defaultRules({ kind: "games", games: ["scarlet_violet"] });
    const parsed = parseFormatRules({ ...original, extra: true, filters: { ...original.filters, bogus: 1 } });
    expect(parsed).toEqual(original);
  });

  it("returns null for documents without a source", () => {
    expect(parseFormatRules(null)).toBeNull();
    expect(parseFormatRules("rules")).toBeNull();
    expect(parseFormatRules({ preset: "sv-reg-a" })).toBeNull();
    expect(parseFormatRules({ source: { kind: "nope" } })).toBeNull();
  });

  it("falls back per field: bad bands, unknown games and tags, missing filters", () => {
    const parsed = parseFormatRules({
      version: "2.0",
      source: { kind: "games", games: ["champions", "pokemon_go"] },
      preset: "",
      filters: { bst: { max: "600" }, stats: { speed: 100 }, excludeTags: ["mythical", "shiny"], types: ["Fire"] },
      pricing: { mode: "bands", bands: [1, 2, 3] },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toEqual({ kind: "games", games: ["champions"] });
    expect(parsed?.preset).toBeNull();
    expect(parsed?.filters.bst).toEqual({ min: null, max: null });
    expect(parsed?.filters.stats.speed).toBe(100);
    expect(parsed?.filters.excludeTags).toEqual(["mythical"]);
    expect(parsed?.filters.types).toEqual(["Fire"]);
    expect(parsed?.filters.forms).toEqual({ mega: true, regional: true, gender: true, other: true });
    expect(parsed?.pricing).toEqual({ mode: "bands", bands: [...DEFAULT_BANDS] });
    expect(parseFormatRules({ source: { kind: "all" }, pricing: { mode: "manual" } })?.pricing).toEqual({ mode: "manual" });
  });
});

describe("presets", () => {
  it("parses the committed regulations.json: three rosters and Reg A to I", () => {
    expect(PRESETS.map((preset) => preset.key)).toEqual([
      "champions-m-a",
      "champions-m-b",
      "champions-m-c",
      "sv-reg-a",
      "sv-reg-b",
      "sv-reg-c",
      "sv-reg-d",
      "sv-reg-e",
      "sv-reg-f",
      "sv-reg-g",
      "sv-reg-h",
      "sv-reg-i",
    ]);
    const regA = PRESETS.find((preset) => preset.key === "sv-reg-a");
    expect(regA?.rule).toEqual({
      kind: "filter",
      dexes: ["paldea"],
      dexRanges: { paldea: [[1, 375], [388, 392]] },
      excludeTags: ["paradox", "legendary", "mythical"],
      restrictedPerTeam: 0,
    });
    expect(PRESETS.find((preset) => preset.key === "sv-reg-i")?.ends).toBeNull();
    for (const preset of PRESETS) {
      expect(Object.keys(GAME_LABELS)).toContain(preset.game);
    }
  });

  it("skips malformed entries and keeps the rest", () => {
    const parsed = parsePresets([
      { key: "ok", game: "champions", name: "OK", rule: { kind: "roster", slugs: ["a", 1] } },
      { key: "", game: "champions", name: "No key", rule: { kind: "roster", slugs: [] } },
      { key: "bad-rule", game: "champions", name: "Bad", rule: { kind: "list" } },
      "nope",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ key: "ok", starts: "", ends: null, rule: { kind: "roster", slugs: ["a"] } });
    expect(parsePresets({})).toEqual([]);
  });

  it("offers the presets of the chosen games, or all of them for All Pokémon", () => {
    expect(presetsForSource(presets, { kind: "games", games: ["champions"] }).map((preset) => preset.key)).toEqual([
      "champions-m-c",
      "champions-empty",
    ]);
    expect(presetsForSource(presets, { kind: "games", games: [] })).toEqual([]);
    expect(presetsForSource(presets, { kind: "all" })).toHaveLength(presets.length);
  });

  it("describes filter rules in words with their dates", () => {
    const byKey = (key: string) => presets.find((preset) => preset.key === key)!;
    expect(describePreset(byKey("sv-reg-a"))).toBe(
      "Paldea Pokédex, Paldea entries 1 to 375 and 388 to 392, no Paradox, legendary or mythical Pokémon"
    );
    expect(describePreset(byKey("sv-reg-e"))).toBe("Paldea and Kitakami Pokédexes, no restricted or mythical Pokémon");
    expect(describePreset(byKey("sv-reg-d"))).toBe("Everything transferable, no restricted or mythical Pokémon");
    expect(describePreset(byKey("sv-reg-g"))).toBe("Everything transferable, no mythical Pokémon, one restricted per team");
    expect(presetDates(byKey("sv-reg-a"))).toBe("Jan 4, 2024 to Apr 30, 2024");
    expect(presetDates(byKey("champions-empty"))).toBe("From Jan 1, 2027");
  });
});

describe("describeRules", () => {
  it("names the source, the preset and only the filters that departed from the defaults", () => {
    const withPreset = rules({ source: { kind: "games", games: ["champions"] }, preset: "champions-m-c" }, { bst: { min: null, max: 600 } });
    expect(describeRules(withPreset, presets)).toBe("Champions · Regulation Set M-C · max total 600");
    expect(describeRules(defaultRules(), presets)).toBe("Champions");
    expect(describeRules(defaultRules({ kind: "all" }), presets)).toBe("All Pokémon");
  });

  it("spells out every other kind of filter and manual pricing", () => {
    const busy = rules(
      { source: { kind: "games", games: ["champions", "scarlet_violet"] }, preset: "missing", pricing: { mode: "manual" } },
      {
        bst: { min: 400, max: 600 },
        stats: { ...defaultRules().filters.stats, hp: 150, speed: 110 },
        generation: { min: 1, max: 4 },
        types: ["Fire", "Water"],
        excludeTags: ["mythical", "paradox"] as TagKey[],
        forms: { mega: false, regional: true, gender: true, other: false },
      }
    );
    expect(describeRules(busy, presets)).toBe(
      "Champions and Scarlet and Violet · total 400 to 600 · max HP 150 · max speed 110 · gen 1 to 4 · Fire or Water types · no mythical or Paradox · no Megas or Other forms · manual prices"
    );
    expect(describeRules(rules({}, { generation: { min: 3, max: null } }), presets)).toBe("All Pokémon · gen 3 and up");
    expect(describeRules(rules({}, { generation: { min: 5, max: 5 } }), presets)).toBe("All Pokémon · gen 5");
    expect(describeRules(rules({}, { bst: { min: 500, max: null } }), presets)).toBe("All Pokémon · min total 500");
    expect(describeRules(rules({ source: { kind: "games", games: [] } }), presets)).toBe("No game chosen");
  });
});
