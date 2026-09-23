import { describe, expect, it } from "vitest";
import {
  availableSpecies,
  resolveChampionsLearnset,
  toID,
  transformChampionsCatalog,
  type EngineSnapshot,
  type ResolvedMove,
  type ResolvedSpecies,
  type ShowdownSnapshot,
} from "../../scripts/lib/champions-data/transform";

const sources = {
  engine: { revision: "fixture-engine", url: "https://example.test/engine" },
  showdown: { revision: "fixture-showdown", url: "https://example.test/showdown" },
};
const baseStats = { hp: 60, atk: 70, def: 80, spa: 90, spd: 100, spe: 110 };
const megaStats = { hp: 60, atk: 100, def: 100, spa: 140, spd: 80, spe: 130 };
const moveIDs = ["bulletseed", "doublehit", "fissure", "protect", "seismictoss"];

function species(overrides: Partial<ResolvedSpecies> & { tier?: string } = {}): ResolvedSpecies {
  return {
    id: "fixturemon", name: "Fixturemon", baseSpecies: "Fixturemon", exists: true,
    types: ["Water"], baseStats: { ...baseStats }, weightkg: 50,
    abilities: { 0: "Torrent" },
    learnset: {
      movePool: [...moveIDs],
      sources: [{
        speciesId: "fixturemon", origin: "champions",
        learnset: { bulletseed: ["9M"], doublehit: ["9M"], fissure: ["9M"], protect: ["9M"], seismictoss: ["9M"] },
      }],
    },
    ...overrides,
  };
}
function move(overrides: Partial<ResolvedMove> & Pick<ResolvedMove, "id" | "name">): ResolvedMove {
  return {
    exists: true, type: "Normal", category: "Physical", basePower: 0,
    accuracy: 100, priority: 0, target: "normal", description: "Fixture description.",
    ...overrides,
  };
}
function fixture(): { source: ShowdownSnapshot; engine: EngineSnapshot } {
  return {
    source: {
      species: [
        species(),
        species({
          id: "fixturemonmega", name: "Fixturemon-Mega", isMega: true,
          battleOnly: "Fixturemon", requiredItem: "Fixtureite",
          baseStats: { ...megaStats }, abilities: { 0: "Mega Power" },
        }),
      ],
      moves: [
        move({ id: "bulletseed", name: "Bullet Seed", type: "Grass", basePower: 25, multihit: [2, 5] }),
        move({ id: "doublehit", name: "Double Hit", basePower: 35, multihit: 2 }),
        move({ id: "fissure", name: "Fissure", type: "Ground", ohko: true, accuracy: 30 }),
        move({ id: "protect", name: "Protect", category: "Status", accuracy: true, priority: 4, target: "self" }),
        move({ id: "seismictoss", name: "Seismic Toss", type: "Fighting" }),
      ],
      abilities: [
        { id: "torrent", name: "Torrent", exists: true, description: "Fixture Torrent." },
        { id: "megapower", name: "Mega Power", exists: true, description: "Fixture Mega ability." },
      ],
      items: [{
        id: "fixtureite", name: "Fixtureite", exists: true, description: "Fixture Mega stone.",
        megaStone: { Fixturemon: "Fixturemon-Mega" },
      }],
    },
    // Deliberately authored independently of the transform output and raw rows.
    engine: {
      num: 0,
      species: [
        { id: "fixturemon", name: "Fixturemon", types: ["Water"], baseStats: { hp: 60, atk: 70, def: 80, spa: 90, spd: 100, spe: 110 }, weightkg: 50 },
        { id: "fixturemonmega", name: "Fixturemon-Mega", types: ["Water"], baseStats: { hp: 60, atk: 100, def: 100, spa: 140, spd: 80, spe: 130 }, weightkg: 50 },
      ],
      moves: [
        { id: "bulletseed", name: "Bullet Seed", type: "Grass", category: "Physical", basePower: 25 },
        { id: "doublehit", name: "Double Hit", type: "Normal", category: "Physical", basePower: 35 },
        { id: "fissure", name: "Fissure", type: "Ground", category: "Physical", basePower: 0 },
        { id: "protect", name: "Protect", type: "Normal", category: "Status", basePower: 0 },
        { id: "seismictoss", name: "Seismic Toss", type: "Fighting", category: "Physical", basePower: 0 },
      ],
      abilities: [{ id: "torrent", name: "Torrent" }, { id: "megapower", name: "Mega Power" }],
      items: [{ id: "fixtureite", name: "Fixtureite", megaStone: { Fixturemon: "Fixturemon-Mega" } }],
    },
  };
}

function transform(data = fixture()) {
  return transformChampionsCatalog(data.source, data.engine, sources);
}

describe("Champions catalog pure transformation", () => {
  it("uses stable Showdown IDs, not PokeAPI form or punctuation heuristics", () => {
    expect(["Mr. Mime", "Farfetch'd", "Charizard-Mega-X", "Meowstic-F-Mega"].map(toID))
      .toEqual(["mrmime", "farfetchd", "charizardmegax", "meowsticfmega"]);
    const catalog = transform();
    expect(catalog.species[1]).toMatchObject({
      id: "fixturemonmega", baseSpecies: "fixturemon", calcName: "Fixturemon-Mega",
      requiredItem: "fixtureite", abilities: ["megapower"], battleForm: true,
    });
    expect(catalog.species[0].moves).toEqual(moveIDs);
    expect(catalog.coverage).toMatchObject({ species: 2, moves: 5, unsupportedSpecies: 0, unsupportedMoves: 0 });
  });

  it("is byte-deterministic, ordering-independent and does not mutate its inputs", () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const expected = JSON.stringify(transform(data));
    expect(JSON.stringify(data)).toBe(before);
    data.source.species = [...data.source.species].reverse();
    data.source.moves = [...data.source.moves].reverse();
    data.source.abilities = [...data.source.abilities].reverse();
    data.engine.species = [...data.engine.species].reverse();
    data.source.species[0].learnset.movePool = [...moveIDs].reverse();
    expect(JSON.stringify(transform(data))).toBe(expected);
    expect(expected).not.toMatch(/generatedAt|timestamp/);
  });

  it("retains status, zero-power fixed/OHKO, fixed-hit and variable multihit moves", () => {
    const moves = new Map(transform().moves.map((row) => [row.id, row]));
    expect(moves.size).toBe(5);
    expect(moves.get("protect")).toMatchObject({ category: "Status", power: 0, accuracy: null, target: "self", priority: 4 });
    expect(moves.get("seismictoss")).toMatchObject({ category: "Physical", power: 0, ohko: false });
    expect(moves.get("fissure")).toMatchObject({ power: 0, ohko: true, accuracy: 30 });
    expect(moves.get("doublehit")?.multihit).toBe(2);
    expect(moves.get("bulletseed")?.multihit).toEqual([2, 5]);
  });

  it("uses nonstandard flags and entry forms, never an OU/Uber tier allowlist", () => {
    const data = fixture();
    data.source.species = [
      ...data.source.species,
      species({ id: "rankeduber", name: "Ranked Uber", baseSpecies: "Ranked Uber", tier: "Uber" }),
      species({ id: "rankednfe", name: "Ranked NFE", baseSpecies: "Ranked NFE", tier: "NFE" }),
      species({ id: "past", name: "Past", baseSpecies: "Past", isNonstandard: "Past" }),
      species({ id: "future", name: "Future", baseSpecies: "Future", isNonstandard: "Future" }),
      species({ id: "custom", name: "Custom", baseSpecies: "Custom", isNonstandard: "Custom" }),
      species({ id: "futureblade", name: "Future-Blade", baseSpecies: "Future", battleOnly: "Future" }),
    ];
    expect(transform(data).species.map((row) => row.id)).toEqual(["fixturemon", "fixturemonmega", "rankednfe", "rankeduber"]);
    expect(availableSpecies([species(), species({ id: "state", name: "State", battleOnly: ["Missing", "Fixturemon"] })]))
      .toHaveLength(2);
  });

  it("does not offer unavailable standalone moves/items or unassigned abilities", () => {
    const data = fixture();
    data.source.moves = [...data.source.moves, move({ id: "hiddenpower", name: "Hidden Power", isNonstandard: "Past" })];
    data.source.items = [...data.source.items, { id: "oldstone", name: "Old Stone", exists: true, isNonstandard: "Past", description: "Unavailable." }];
    data.source.abilities = [...data.source.abilities, { id: "unusedpower", name: "Unused Power", exists: true, description: "Unassigned." }];
    const catalog = transform(data);
    expect(catalog.moves.map((row) => row.id)).not.toContain("hiddenpower");
    expect(catalog.items.map((row) => row.id)).toEqual(["fixtureite"]);
    expect(catalog.abilities.map((row) => row.id)).toEqual(["megapower", "torrent"]);
  });

  it("flags missing engine species and moves without omitting or substituting them", () => {
    const data = fixture();
    data.engine.species = data.engine.species.filter((row) => row.id !== "fixturemonmega");
    data.engine.moves = data.engine.moves.filter((row) => row.id !== "seismictoss");
    const catalog = transform(data);
    expect(catalog.species).toHaveLength(2);
    expect(catalog.moves).toHaveLength(5);
    expect(catalog.species[1].calcName).toBe("Fixturemon-Mega");
    expect(catalog.species[1].unsupported).toContain("Engine species missing: Fixturemon-Mega.");
    expect(catalog.moves.find((row) => row.id === "seismictoss")?.unsupported).toContain("Engine move missing: Seismic Toss.");
    expect(catalog.species[0].unsupported).toEqual([]); // Only the affected move is blocked.
  });

  it.each([
    "Caramel-Swirl", "Lemon-Cream", "Matcha-Cream", "Mint-Cream", "Rainbow-Swirl", "Ruby-Cream", "Ruby-Swirl",
  ])("maps only the explicit Alcremie-%s cosmetic engine identity", (flavor) => {
    const data = fixture();
    const name = `Alcremie-${flavor}`;
    data.source.species = [...data.source.species, species({ id: toID(name), name, baseSpecies: "Alcremie" })];
    data.engine.species = [...data.engine.species, { ...data.engine.species[0], id: "alcremie", name: "Alcremie" }];
    const row = transform(data).species.find((entry) => entry.id === toID(name))!;
    expect(row).toMatchObject({ id: toID(name), name, calcName: "Alcremie", baseSpecies: "alcremie", unsupported: [] });
    expect(row.moves).toEqual(moveIDs);
    data.engine.species = data.engine.species.filter((entry) => entry.id !== "alcremie");
    expect(transform(data).species.find((entry) => entry.id === row.id)?.unsupported)
      .toContain(`Engine species missing: ${name}.`);
  });

  it("does not use baseSpecies or an Alcremie prefix as a generic engine fallback", () => {
    const data = fixture();
    data.source.species = [...data.source.species, ...["Alcremie-Unknown", "Alcremie-Salted-Cream", "Alcremie-Gmax"].map((name) =>
      species({ id: toID(name), name, baseSpecies: "Alcremie" }))];
    data.engine.species = [...data.engine.species, { ...data.engine.species[0], id: "alcremie", name: "Alcremie" }];
    for (const row of transform(data).species.filter((entry) => entry.baseSpecies === "alcremie")) {
      expect(row.calcName).toBe(row.name);
      expect(row.unsupported).toContain(`Engine species missing: ${row.name}.`);
    }
  });

  it("keeps mismatch and provenance gates active for mapped cosmetics", () => {
    const data = fixture();
    const cosmetic = species({ id: "alcremierubycream", name: "Alcremie-Ruby-Cream", baseSpecies: "Alcremie" });
    cosmetic.learnset = { movePool: [], sources: [] };
    data.source.species = [...data.source.species, cosmetic];
    data.engine.species = [...data.engine.species, {
      ...data.engine.species[0], id: "alcremie", name: "Alcremie",
      types: ["Fire"], baseStats: { ...baseStats, atk: 200 }, weightkg: 123,
    }];
    const row = transform(data).species.find((entry) => entry.id === cosmetic.id)!;
    expect(row).toMatchObject({ calcName: "Alcremie", baseStats, types: ["Water"], weightkg: 50, moves: [] });
    expect(row.unsupported).toEqual(expect.arrayContaining([
      "No proven Champions learnset.", "Engine base stat differs (atk): 200 vs 70.",
      "Engine species types differ: Fire vs Water.", "Engine weight differs: 123 vs 50 kg.",
    ]));
  });

  it("preserves source stats/types/weight and reports engine mismatches", () => {
    const data = fixture();
    data.engine.species = data.engine.species.map((row) => row.id !== "fixturemon" ? row : {
      ...row, types: ["Fire"], baseStats: { ...row.baseStats, atk: 200 }, weightkg: 123,
    });
    data.engine.moves = data.engine.moves.map((row) => row.id !== "bulletseed" ? row : { ...row, basePower: 99 });
    const row = transform(data).species[0];
    expect(row.baseStats.atk).toBe(70);
    expect(row.types).toEqual(["Water"]);
    expect(row.weightkg).toBe(50);
    expect(row.unsupported).toEqual(expect.arrayContaining([
      "Engine base stat differs (atk): 200 vs 70.",
      "Engine species types differ: Fire vs Water.",
      "Engine weight differs: 123 vs 50 kg.",
    ]));
    expect(transform(data).moves[0]).toMatchObject({ power: 25, unsupported: ["Engine move power differs: 99 vs 25."] });
  });

  it("keeps optional unsupported abilities from disabling supported builds", () => {
    const data = fixture();
    data.source.species[0].abilities.H = "Unverified Power";
    data.source.abilities = [...data.source.abilities, { id: "unverifiedpower", name: "Unverified Power", exists: true, description: "Fixture." }];
    const catalog = transform(data);
    expect(catalog.species[0].abilities).toEqual(["torrent", "unverifiedpower"]);
    expect(catalog.species[0].unsupported).toEqual([]);
    expect(catalog.abilities.find((row) => row.id === "unverifiedpower")?.unsupported).not.toEqual([]);
  });

  it("reports contradictory source ability availability without inventing an assignment", () => {
    const data = fixture();
    data.source.abilities[0].isNonstandard = "Future";
    const catalog = transform(data);
    expect(catalog.species[0].abilities).toEqual(["torrent"]);
    expect(catalog.species[0].unsupported).toContain("All assigned abilities unsupported: torrent.");
    expect(catalog.abilities.find((row) => row.id === "torrent")?.unsupported)
      .toContain("Assigned Champions ability is marked Future in the source.");
  });

  it("requires valid ability, move and required-stone references", () => {
    const invalidAbility = fixture();
    invalidAbility.source.species[0].abilities = { 0: "Typo" };
    expect(() => transform(invalidAbility)).toThrow("Invalid Champions ability assignment");
    const invalidMove = fixture();
    invalidMove.source.moves = invalidMove.source.moves.filter((row) => row.id !== "seismictoss");
    expect(() => transform(invalidMove)).toThrow("Invalid Champions learnset reference");
    const invalidStone = fixture();
    invalidStone.source.species[1].requiredItem = "Wrongite";
    expect(() => transform(invalidStone)).toThrow("Invalid required Champions item");
    const invalidPair = fixture();
    invalidPair.source.items[0].megaStone = { Fixturemon: "Wrong Form" };
    expect(() => transform(invalidPair)).toThrow("Invalid Mega stone/form relationship");
  });

  it("preserves multi-target stone pairs and each gender's proven movepool", () => {
    const data = fixture();
    const female = species({ id: "fixturemonf", name: "Fixturemon-F" });
    female.learnset = {
      movePool: ["seismictoss"],
      sources: [{ speciesId: "fixturemonf", origin: "champions", learnset: { seismictoss: ["9M"] } }],
    };
    data.source.species = [...data.source.species, female, {
      ...female, id: "fixturemonfmega", name: "Fixturemon-F-Mega", isMega: true,
      battleOnly: "Fixturemon-F", requiredItem: "Fixtureite",
    }];
    data.source.items[0].megaStone = { Fixturemon: "Fixturemon-Mega", "Fixturemon-F": "Fixturemon-F-Mega" };
    data.engine.items = [{ ...data.engine.items[0], megaStone: { Fixturemon: "Fixturemon-Mega", "Fixturemon-F": "Fixturemon-F-Mega" } }];
    const catalog = transform(data);
    expect(catalog.items[0]).toMatchObject({
      megaStone: null, megaEvolves: null,
      megaTargets: [
        { baseSpeciesId: "fixturemon", formId: "fixturemonmega" },
        { baseSpeciesId: "fixturemonf", formId: "fixturemonfmega" },
      ],
      unsupported: [],
    });
    expect(catalog.species.find((row) => row.id === "fixturemonfmega")?.moves).toEqual(["seismictoss"]);
    expect(catalog.species.find((row) => row.id === "fixturemonmega")?.moves).toEqual(moveIDs);
  });

  it("retains an available species with missing Champions data as explicitly unsupported", () => {
    const data = fixture();
    data.source.species[0].learnset = {
      movePool: ["protect"],
      sources: [{ speciesId: "fixturemon", origin: "unproven", learnset: { protect: ["9M"] } }],
    };
    const row = transform(data).species[0];
    expect(row.id).toBe("fixturemon");
    expect(row.moves).toEqual([]);
    expect(row.unsupported).toContain("No proven Champions learnset.");
  });

  it("rejects accidental Gen 9 engines, duplicate IDs and broken identities", () => {
    const wrongGeneration = fixture();
    wrongGeneration.engine.num = 9;
    expect(() => transform(wrongGeneration)).toThrow("generation 0");
    const duplicate = fixture();
    duplicate.source.species = [...duplicate.source.species, species()];
    expect(() => transform(duplicate)).toThrow("Duplicate species identity");
    const typo = fixture();
    typo.source.species[0].id = "fixturemon-mega";
    expect(() => transform(typo)).toThrow("Noncanonical species identity");
  });
});

describe("Champions learnset provenance", () => {
  it("accepts actual 9M mod data, including statuses and zero-power moves", () => {
    expect(resolveChampionsLearnset(species().learnset)).toEqual({ moves: moveIDs, unsupported: [] });
  });

  it("does not turn an inherited base Gen 9 learnset into a Champions legal list", () => {
    const result = resolveChampionsLearnset({
      movePool: ["protect", "tackle"],
      sources: [{ speciesId: "unknown", origin: "unproven", learnset: { protect: ["9M"], tackle: ["9L1"] } }],
    });
    expect(result.moves).toEqual([]);
    expect(result.unsupported).toContain("No proven Champions learnset.");
    expect(result.unsupported).toContain("Moves without Champions provenance withheld: protect, tackle.");
  });

  it("withholds unproven additions to an otherwise known form movepool", () => {
    const result = resolveChampionsLearnset({
      movePool: ["protect", "tackle"],
      sources: [
        { speciesId: "form", origin: "champions", learnset: { protect: ["9M"] } },
        { speciesId: "base", origin: "unproven", learnset: { tackle: ["9M"] } },
      ],
    });
    expect(result.moves).toEqual(["protect"]);
    expect(result.unsupported).toContain("Unproven Champions learnset: base is inherited from the base game.");
  });

  it("honors explicit inheritance without treating ordinary base inheritance as proof", () => {
    const result = resolveChampionsLearnset({
      movePool: ["protect"],
      sources: [{ speciesId: "base", origin: "explicit-inherit", learnset: { protect: ["9M"], oldmove: ["8M"] } }],
    });
    expect(result).toEqual({ moves: ["protect"], unsupported: [] });
    expect(resolveChampionsLearnset({ movePool: [], sources: [] }).unsupported).not.toEqual([]);
  });

  it("does not mistake a redundant raw ancestor for missing move data", () => {
    const result = resolveChampionsLearnset({
      movePool: ["protect"],
      sources: [
        { speciesId: "form", origin: "champions", learnset: { protect: ["9M"] } },
        { speciesId: "prevo", origin: "unproven", learnset: { protect: ["9M"], tackle: ["9M"] } },
      ],
    });
    // Actual Dex semantics excluded tackle; the emitted move has direct proof.
    expect(result).toEqual({ moves: ["protect"], unsupported: [] });
  });
});
