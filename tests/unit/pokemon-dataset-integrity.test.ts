import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { normalizePokemonName, toPokeApiSlug } from "@/app/lib/pokemon";
import { ROW_COLUMNS, validateRow } from "@/scripts/lib/pokemon-data/build.mjs";
import { GAME_KEYS } from "@/scripts/lib/pokemon-data/games.mjs";
import { checkRegulationAgreement, presetRows } from "@/scripts/lib/pokemon-data/presets.mjs";
import { EXPECTED_KIND_COUNTS, FORM_KINDS, KIND_COUNT_TOLERANCE, megaBaseSlug } from "@/scripts/lib/pokemon-data/rows.mjs";
import { SEREBII_REGULATIONS } from "@/scripts/lib/pokemon-data/serebii.mjs";
import { TAGS } from "@/scripts/lib/pokemon-data/tags.mjs";

type Row = Parameters<typeof validateRow>[0];
type Preset = Parameters<typeof presetRows>[1];
type Report = {
  rows: number;
  species: number;
  byFormKind: Record<string, number>;
  byGame: Record<string, number>;
  byTag: Record<string, number>;
  byPreset: Record<string, number>;
  skippedByReason: Record<string, number>;
  skipped: Array<{ slug: string; species: string; rule: number; reason: string; sameAs?: string }>;
  unmappedRosterNames: string[];
};
type Overrides = {
  tags: Record<"restricted" | "paradox" | "ultra_beast", string[]>;
  keep: Record<string, string>;
  rows: Record<string, Record<string, unknown>>;
};
type SerebiiSource = Array<{ dex: number; slug: string; name: string; suffix: string | null }>;

const DATA_DIR = fileURLToPath(new URL("../../data/pokemon/", import.meta.url));

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
}

const rows = readJson<Row[]>("pokemon.json");
const presets = readJson<Preset[]>("regulations.json");
const report = readJson<Report>("report.json");
const overrides = readJson<Overrides>("overrides.json");
const bySlug = new Map(rows.map((row) => [row.slug, row]));

function within(actual: number, expected: number, tolerance: number) {
  return Math.abs(actual - expected) <= expected * tolerance;
}

function roster(key: string) {
  const preset = presets.find((entry) => entry.key === key);
  if (!preset || preset.rule.kind !== "roster") throw new Error(`${key} is not a roster preset`);
  return preset.rule.slugs;
}

describe("data/pokemon/pokemon.json", () => {
  it("has about 1,230 rows for every species, sorted by species then id", () => {
    expect(rows.length).toBeGreaterThan(1200);
    expect(rows.length).toBeLessThan(1300);
    expect(new Set(rows.map((row) => row.species_id)).size).toBe(1025);
    const order = rows.map((row) => [row.species_id, row.id]);
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it("has unique ids, slugs, display names and normalized lookup keys", () => {
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.display_name)).size).toBe(rows.length);
    // loadDex keys the dataset by the normalized display name and slug; no
    // two rows may claim the same key.
    const keys = new Map<string, string>();
    for (const row of rows) {
      for (const key of [normalizePokemonName(row.display_name), normalizePokemonName(row.slug)]) {
        const owner = keys.get(key);
        expect(owner === undefined || owner === row.slug, `${key} claimed by ${owner} and ${row.slug}`).toBe(true);
        keys.set(key, row.slug);
      }
    }
  });

  it("gives every row the table's columns, six stats, a type and a valid generation", () => {
    for (const row of rows) {
      expect(Object.keys(row).sort(), row.slug).toEqual([...ROW_COLUMNS].sort());
      expect(validateRow(row), row.slug).toEqual([]);
      expect(FORM_KINDS).toContain(row.form_kind);
      expect(row.form_label === null, row.slug).toBe(row.form_kind === "default");
      expect(row.tags.every((tag) => (TAGS as readonly string[]).includes(tag)), row.slug).toBe(true);
      expect(row.games.every((game) => GAME_KEYS.includes(game)), row.slug).toBe(true);
      expect(row.sprite_url, row.slug).toMatch(/^https:\/\//);
      expect(row.type1).toMatch(/^[A-Z][a-z]+$/);
      if (row.type2 !== null) expect(row.type2).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("follows the app's naming conventions so existing lookups resolve", () => {
    const expectations: Array<[string, string]> = [
      ["raichu-alola", "Alolan Raichu"],
      ["mr-mime-galar", "Galarian Mr. Mime"],
      ["zoroark-hisui", "Hisuian Zoroark"],
      ["wooper-paldea", "Paldean Wooper"],
      ["tauros-paldea-combat-breed", "Paldean Tauros (Combat Breed)"],
      ["tauros-paldea-blaze-breed", "Paldean Tauros (Blaze Breed)"],
      ["tauros-paldea-aqua-breed", "Paldean Tauros (Aqua Breed)"],
      ["darmanitan-galar-standard", "Galarian Darmanitan"],
      ["venusaur-mega", "Mega Venusaur"],
      ["charizard-mega-x", "Mega Charizard X"],
      ["absol-mega-z", "Mega Absol Z"],
      ["garchomp-mega-z", "Mega Garchomp Z"],
      ["lucario-mega-z", "Mega Lucario Z"],
      ["groudon-primal", "Primal Groudon"],
      ["kyogre-primal", "Primal Kyogre"],
      ["indeedee-female", "Indeedee (Female)"],
      ["meowstic-female", "Meowstic (Female)"],
      ["rotom-wash", "Rotom (Wash)"],
      ["toxtricity-low-key", "Toxtricity (Low Key)"],
      ["urshifu-rapid-strike", "Urshifu (Rapid Strike)"],
      ["ogerpon-wellspring-mask", "Ogerpon (Wellspring Mask)"],
      ["calyrex-shadow", "Calyrex (Shadow Rider)"],
      ["giratina-origin", "Giratina (Origin)"],
      ["floette-eternal", "Floette (Eternal Flower)"],
      ["necrozma-dusk", "Necrozma (Dusk Mane)"],
      ["zacian-crowned", "Zacian (Crowned Sword)"],
    ];
    for (const [slug, display] of expectations) {
      expect(bySlug.get(slug)?.display_name, slug).toBe(display);
    }
    expect(normalizePokemonName("Rotom (Wash)")).toBe(normalizePokemonName("rotom-wash"));

    // Every regional and mega display name round-trips through toPokeApiSlug
    // (Z megas, Primals, Tauros breeds and the megas of a default variety
    // whose slug carries a suffix included), so a project that has not seeded
    // the dataset still reaches PokéAPI for those forms.
    for (const row of rows) {
      if (row.form_kind !== "regional" && row.form_kind !== "mega") continue;
      expect(toPokeApiSlug(row.display_name), row.display_name).toBe(row.slug);
    }
  });

  it("applies the curated tags to every row of the listed species", () => {
    for (const [tag, list] of Object.entries(overrides.tags)) {
      for (const speciesSlug of list) {
        // The default variety may carry a suffix (giratina-altered), so find
        // the species through any row whose slug starts with the species slug.
        const anyRow = rows.find((row) => row.slug === speciesSlug || row.slug.startsWith(`${speciesSlug}-`));
        expect(anyRow, speciesSlug).toBeDefined();
        const members = rows.filter((row) => row.species_id === anyRow?.species_id);
        expect(members.length, speciesSlug).toBeGreaterThan(0);
        for (const row of members) expect(row.tags, row.slug).toContain(tag);
      }
    }
    for (const row of rows) {
      const legendary = row.tags.includes("legendary");
      const restricted = row.tags.includes("restricted");
      expect(row.tags.includes("sub_legendary"), row.slug).toBe(legendary && !restricted);
    }
    expect(overrides.tags.paradox).toHaveLength(20);
    expect(overrides.tags.ultra_beast).toHaveLength(11);
    expect(new Set(rows.filter((row) => row.tags.includes("restricted")).map((row) => row.species_id)).size).toBe(
      overrides.tags.restricted.length
    );
  });

  it("never carries an in-battle-only transformation or a cosmetic duplicate of another row", () => {
    // Gigantamax, Eternamax and totem varieties are skipped by slug (13.1, 13.3 rule 2).
    for (const row of rows) {
      expect(row.slug, row.slug).not.toMatch(/-(gmax|eternamax|totem)(-|$)/);
    }
    expect(report.skipped.find((entry) => entry.slug === "eternatus-eternamax")).toMatchObject({ rule: 2, reason: "gigantamax" });

    // Two rows of one species may only share stats and types when they differ
    // by abilities, which the dataset does not carry. These are the species
    // whose forms differ by abilities alone; anything else sharing stats and
    // types within a species is a cosmetic duplicate rule 7 should have dropped.
    const abilityOnlyForms = new Set(["basculin", "greninja", "meowstic", "zygarde", "rockruff", "toxtricity", "squawkabilly"]);
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = [row.species_id, row.hp, row.attack, row.defense, row.special_attack, row.special_defense, row.speed, row.type1, row.type2].join("/");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const duplicates = [...groups.values()].filter((group) => group.length > 1);
    for (const group of duplicates) {
      const speciesSlug = group[0].slug.split("-")[0];
      expect(abilityOnlyForms.has(speciesSlug), group.map((row) => row.slug).join(", ")).toBe(true);
    }
    expect(duplicates.length).toBeGreaterThan(0);

    // The one Core row stands for every Minior colour.
    expect(rows.filter((row) => row.slug.startsWith("minior")).map((row) => row.display_name)).toEqual(["Minior", "Minior (Core)"]);

    // Every duplicate the report dropped names a kept row of its own species.
    // These ten are the rule-7 duplicate drop 13.3 does not describe (see
    // EXPECTED_KIND_COUNTS in rows.mjs), pinned so a change is reviewable.
    const dropped = report.skipped.filter((entry) => entry.sameAs !== undefined);
    expect(dropped.map((entry) => entry.slug).sort()).toEqual([
      "magearna-original-mega",
      "minior-blue",
      "minior-green",
      "minior-indigo",
      "minior-orange",
      "minior-violet",
      "minior-yellow",
      "squawkabilly-white-plumage",
      "tatsugiri-droopy-mega",
      "tatsugiri-stretchy-mega",
    ]);
    for (const entry of dropped) {
      expect(entry.rule, entry.slug).toBe(7);
      expect(bySlug.has(entry.slug), entry.slug).toBe(false);
      const original = bySlug.get(entry.sameAs!);
      expect(original, `${entry.slug} -> ${entry.sameAs}`).toBeDefined();
      expect(original?.slug.startsWith(entry.species), entry.slug).toBe(true);
    }
  });

  it("keeps the Crowned forms and the Champions overrides the roster needs", () => {
    for (const slug of Object.keys(overrides.keep)) expect(bySlug.has(slug), slug).toBe(true);
    for (const [slug, override] of Object.entries(overrides.rows)) {
      const row = bySlug.get(slug);
      expect(row, slug).toBeDefined();
      for (const game of (override.games as string[] | undefined) ?? []) expect(row?.games, slug).toContain(game);
      if (typeof override.display_name === "string") expect(row?.display_name).toBe(override.display_name);
    }
  });
});

describe("data/pokemon/regulations.json", () => {
  it("keeps the twelve presets with their dates, sources and rules", () => {
    expect(presets.map((preset) => preset.key)).toEqual([
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
    for (const preset of presets) {
      expect(preset.source).toMatch(/^https:\/\/www\.serebii\.net\//);
      expect(preset.starts).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(preset.game).toMatch(/^(champions|scarlet_violet)$/);
    }
    const regA = presets.find((preset) => preset.key === "sv-reg-a")!;
    expect(regA.rule).toEqual({
      kind: "filter",
      dexes: ["paldea"],
      dexRanges: { paldea: [[1, 375], [388, 392]] },
      excludeTags: ["paradox", "legendary", "mythical"],
      restrictedPerTeam: 0,
    });
  });

  it("resolves every roster slug to a Champions row, cumulatively", () => {
    const ma = roster("champions-m-a");
    const mb = roster("champions-m-b");
    const mc = roster("champions-m-c");
    expect(ma.length).toBeGreaterThan(200);
    expect(mb.length).toBeGreaterThan(ma.length);
    expect(mc.length).toBeGreaterThan(mb.length);
    expect(ma.every((slug) => mb.includes(slug))).toBe(true);
    expect(mb.every((slug) => mc.includes(slug))).toBe(true);
    for (const slug of mc) {
      const row = bySlug.get(slug);
      expect(row, slug).toBeDefined();
      expect(row?.games, slug).toContain("champions");
    }
    expect(new Set(mc).size).toBe(mc.length);
  });

  it("carries the forms a suffix-less Serebii row stands for", () => {
    // Serebii lists Rotom, Lycanroc, Gourgeist, Meowstic and Basculegion once
    // each; their forms with Champions learnsets join the roster, and so does
    // the Mega of such a form when Serebii's "m" icon named the species' Mega
    // (Mega Meowstic stands for Mega Meowstic (Female) too). Regionals and any
    // other Mega only join when Serebii's icon names them; plain Floette stays
    // off because Serebii lists only Eternal Flower Floette and Mega Floette.
    const ma = roster("champions-m-a");
    for (const slug of ["rotom", "rotom-wash", "rotom-heat", "lycanroc-dusk", "lycanroc-midnight", "gourgeist-super", "meowstic-female", "basculegion-female", "meowstic-male-mega", "meowstic-female-mega"]) {
      expect(ma, slug).toContain(slug);
    }
    expect(ma).not.toContain("floette");
    for (const key of SEREBII_REGULATIONS.map((regulation) => regulation.presetKey)) {
      const slugs = roster(key);
      const named = new Map(slugs.filter((slug) => bySlug.get(slug)?.form_kind === "default").map((slug) => [bySlug.get(slug)!.species_id, slug]));
      const megaNamed = new Set(
        slugs
          .filter((slug) => bySlug.get(slug)?.form_kind === "mega" && named.get(bySlug.get(slug)!.species_id) === megaBaseSlug(slug))
          .map((slug) => bySlug.get(slug)!.species_id)
      );
      const forms = new Set<string>();
      for (const row of rows) {
        if (!named.has(row.species_id) || !row.games.includes("champions")) continue;
        if (row.form_kind !== "other" && row.form_kind !== "gender") continue;
        expect(slugs, `${key} ${row.slug}`).toContain(row.slug);
        forms.add(row.slug);
      }
      for (const row of rows) {
        if (row.form_kind !== "mega" || !forms.has(megaBaseSlug(row.slug))) continue;
        expect(slugs.includes(row.slug), `${key} ${row.slug}`).toBe(megaNamed.has(row.species_id) && row.games.includes("champions"));
      }
    }
    // With that, every Champions row is on the M-C roster except plain Floette.
    const mc = new Set(roster("champions-m-c"));
    expect(rows.filter((row) => row.games.includes("champions") && !mc.has(row.slug)).map((row) => row.slug)).toEqual(["floette"]);
  });

  it("makes the Reg M-C additions available in champions", () => {
    const additions = roster("champions-m-c").filter((slug) => !roster("champions-m-b").includes(slug));
    expect(additions.length).toBe(32);
    for (const slug of ["persian-alola", "toxtricity-low-key", "indeedee-female", "salamence-mega", "golisopod-mega", "baxcalibur-mega", "absol-mega-z", "garchomp-mega-z", "lucario-mega-z", "cinderace", "farfetchd", "mr-mime", "pawmot"]) {
      expect(additions, slug).toContain(slug);
    }
    // 23 new species plus new megas for three species already on the roster.
    expect(additions.filter((slug) => bySlug.get(slug)?.form_kind === "default")).toHaveLength(23);
    const source = JSON.parse(readFileSync(path.join(DATA_DIR, "sources", "serebii-m-c.json"), "utf8")) as SerebiiSource;
    expect(source).toHaveLength(32);
    expect(new Set(source.map((row) => row.dex)).size).toBe(26);
  });

  it("derives Reg A to C to the same sets by ranges and by tags", () => {
    expect(checkRegulationAgreement(rows, presets)).toEqual([]);
  });

  it("commits the parsed Serebii rows for every regulation", () => {
    for (const regulation of SEREBII_REGULATIONS) {
      const source = JSON.parse(readFileSync(path.join(DATA_DIR, "sources", `serebii-${regulation.key}.json`), "utf8")) as SerebiiSource;
      expect(source.length).toBeGreaterThan(0);
      for (const row of source) {
        expect(Object.keys(row).sort()).toEqual(["dex", "name", "slug", "suffix"]);
        expect(row.suffix === null || /^[a-z]+$/.test(row.suffix)).toBe(true);
      }
    }
  });
});

describe("data/pokemon/report.json", () => {
  it("matches the committed dataset within 5% per game, preset and form kind", () => {
    expect(report.rows).toBe(rows.length);
    expect(report.species).toBe(1025);
    expect(report.unmappedRosterNames).toEqual([]);
    for (const kind of FORM_KINDS) {
      const actual = rows.filter((row) => row.form_kind === kind).length;
      expect(report.byFormKind[kind], kind).toBe(actual);
      expect(within(actual, EXPECTED_KIND_COUNTS[kind], KIND_COUNT_TOLERANCE), `${kind}: ${actual} vs ${EXPECTED_KIND_COUNTS[kind]}`).toBe(true);
    }
    for (const game of GAME_KEYS) {
      const actual = rows.filter((row) => row.games.includes(game)).length;
      expect(within(actual, report.byGame[game], 0.05), game).toBe(true);
    }
    for (const preset of presets) {
      const actual = presetRows(rows, preset).length;
      expect(within(actual, report.byPreset[preset.key], 0.05), preset.key).toBe(true);
    }
    expect(report.byGame.champions).toBeGreaterThan(300);
    expect(report.byGame.scarlet_violet).toBeGreaterThan(700);
  });

  it("reconciles EXPECTED_KIND_COUNTS with section 13.3's sizes through the documented drops", () => {
    // 13.3 prints 1025 default, 97 mega (PokéAPI's is_mega count), 59 regional
    // "before the cosmetic drop", 4 gender and 64 other; rows.mjs documents
    // why the crawl lands on 1025/96/57/4/55 and an amendment is requested.
    expect(EXPECTED_KIND_COUNTS.default).toBe(1025);
    expect(EXPECTED_KIND_COUNTS.gender).toBe(4);

    const droppedMegas = report.skipped.filter((entry) => entry.sameAs !== undefined && entry.slug.endsWith("-mega")).length;
    const primals = rows.filter((row) => row.form_kind === "mega" && row.slug.endsWith("-primal")).length;
    expect(primals).toBe(2);
    expect(droppedMegas).toBe(3);
    expect(EXPECTED_KIND_COUNTS.mega).toBe(97 + primals - droppedMegas);

    const regionalDrops = report.skipped
      .filter((entry) => entry.rule === 2 && /-(alola|galar|hisui|paldea)/.test(entry.slug) && !entry.slug.includes("-totem"))
      .map((entry) => entry.slug)
      .sort();
    expect(regionalDrops).toEqual(["darmanitan-galar-zen", "pikachu-alola-cap"]);
    expect(EXPECTED_KIND_COUNTS.regional).toBe(59 - regionalDrops.length);

    // Rules 1-6 read literally give 63 `other` rows on this crawl (one fewer
    // than 13.3 prints); rule 7 drops seven duplicates and rule 2 Eternamax.
    const droppedOthers = report.skipped.filter((entry) => entry.sameAs !== undefined && !entry.slug.endsWith("-mega")).length;
    expect(droppedOthers).toBe(7);
    expect(report.skipped.filter((entry) => entry.reason === "gigantamax").map((entry) => entry.slug)).toEqual(["eternatus-eternamax"]);
    expect(EXPECTED_KIND_COUNTS.other).toBe(63 - droppedOthers - 1);
  });

  it("lists every skipped variety with a reason and no skipped slug is a row", () => {
    expect(report.skipped.length).toBeGreaterThan(90);
    const reasons = new Set(report.skipped.map((entry) => entry.reason));
    expect(reasons.has("battle-only form")).toBe(true);
    expect(reasons.has("cosmetic pikachu")).toBe(true);
    for (const entry of report.skipped) {
      expect(bySlug.has(entry.slug), entry.slug).toBe(false);
      expect(report.skippedByReason[entry.reason]).toBeGreaterThan(0);
    }
    expect(Object.values(report.skippedByReason).reduce((sum, count) => sum + count, 0)).toBe(report.skipped.length);
  });
});
