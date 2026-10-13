import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Field, Generations, Move, Pokemon } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import { neutralEffectiveness, setTurnMarks, withTurnMarks } from "@/app/lib/battle/engine-corrections.cjs";
import { turnEffectiveness } from "@/app/lib/battle/uses-to-ko";

/**
 * status2 Track A2 (SPEC2 §3.6, §4.3; ADDENDUM2 §3.6): the 2v2 type markers reach the vendored engine
 * (@smogon/calc 0.11.0-champions.e7fd7e59.1) only because it reads util.getMoveEffectiveness and util.isGrounded off the
 * util exports object at each call, at the call sites engine-corrections.cjs names (its withTurnMarks multiplies an added
 * third type in at the first-type call). These pins fail when a vendored update moves or adds a call; then the
 * corrections' comments and calculate.ts turnRun need a look. The behaviour tests check the wrappers' arithmetic and that
 * uses-to-ko.ts turnEffectiveness (Enigma Berry, Weakness Policy) reads the same effectiveness as the engine's damage.
 * The end-to-end turns (Electro Drift into an added type, Tar Shot on a Tera type, Miracle Eye, Smack Down) are
 * tests/unit/doubles-family2.test.ts', against pinned Showdown c23d2e94.
 */
const ROOT = path.resolve(__dirname, "../..");
const MECHANICS = path.join(ROOT, "node_modules/@smogon/calc/dist/mechanics");
const source = (file: string) => fs.readFileSync(path.join(MECHANICS, file), "utf8").split(/\r?\n/);
const linesWith = (lines: string[], pattern: RegExp) => lines.flatMap((line, i) => (pattern.test(line) ? [i + 1] : []));
// The live util exports object (an ES namespace of a CommonJS module can be a snapshot taken before the corrections wrap it).
const util = createRequire(__filename)("@smogon/calc/dist/mechanics/util") as {
  getMoveEffectiveness: (gen: unknown, move: Move, type: string, ghostRevealed: boolean, gravity: boolean, ringTarget: boolean) => number;
  isGrounded: (pokemon: Pokemon, field: Field) => boolean;
  checkItem: (pokemon: Pokemon, magicRoom: boolean) => void;
};

describe("the vendored engine's type-effectiveness and grounding reads (source pins)", () => {
  it("is the vendored build the pins were taken on", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@smogon/calc/package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("0.11.0-champions.e7fd7e59.1");
  });

  it("gen789.js reads getMoveEffectiveness at lines 300, 302, 306 (types[0], types[1], the Tera type) and 839–840 (Electro Drift, Collision Course)", () => {
    const lines = source("gen789.js");
    expect(lines[13]).toBe('const util_2 = require("./util");');
    expect(linesWith(lines, /getMoveEffectiveness/)).toEqual([300, 302, 306, 839, 840]);
    for (const n of [300, 302, 306, 839, 840]) expect(lines[n - 1]).toContain("(0, util_2.getMoveEffectiveness)(gen, move, ");
    expect(lines[299]).toContain("defender.types[0]");
    expect(lines[301]).toContain("defender.types[1]");
    expect(lines[305]).toContain("defender.teraType");
    expect(lines[836]).toContain("const types = defender.teraType && defender.teraType !== 'Stellar'");
    expect(lines[837]).toContain("? [defender.teraType] : defender.types;");
    expect(lines[838]).toContain("types[0]");
    expect(lines[839]).toContain("types[1]");
  });

  it("champions.js reads it at lines 169 and 171 (types[0], types[1]; no Tera type)", () => {
    const lines = source("champions.js");
    expect(lines[13]).toBe('const util_2 = require("./util");');
    expect(linesWith(lines, /getMoveEffectiveness/)).toEqual([169, 171]);
    expect(lines[168]).toContain("(0, util_2.getMoveEffectiveness)(gen, move, defender.types[0], ");
    expect(lines[170]).toContain("(0, util_2.getMoveEffectiveness)(gen, move, defender.types[1], ");
  });

  it("every isGrounded read goes through util at call time (no local binding), and util.js calls neither function itself", () => {
    for (const file of ["gen789.js", "champions.js"]) {
      const lines = source(file);
      const reads = linesWith(lines, /isGrounded/);
      expect(reads.length, file).toBeGreaterThan(0);
      for (const n of reads) expect(lines[n - 1], `${file}:${n}`).toContain("(0, util_2.isGrounded)(");
    }
    const own = source("util.js");
    expect(linesWith(own, /isGrounded\(|getMoveEffectiveness\(/)).toEqual([48, 146]);
    expect(own[47]).toBe("function isGrounded(pokemon, field) {");
    expect(own[145]).toBe("function getMoveEffectiveness(gen, move, type, isGhostRevealed, isGravity, isRingTarget) {");
  });
});

const gen9 = Generations.get(9);
const field = new Field({ gameType: "Doubles" });
type Marks = { tarShot?: true; revealed?: "foresight" | "miracleeye"; grounding?: "pinned" | "floating" };
/** A defender as calculate.ts makePokemon builds it: world types (a two-type Pokémon's added type third), its markers. */
function defender(species: string, types: string[] | null, marks: Marks = {}, teraType?: string) {
  const pokemon = new Pokemon(gen9, species, teraType ? { teraType: teraType as never } : {});
  if (types) pokemon.types = types as never;
  return setTurnMarks(pokemon, marks);
}
/** calculate.ts turnRun's defender scope. */
function scope(pokemon: Pokemon, marks: Marks) {
  const added = pokemon.types.length > 2 ? (pokemon.types as readonly string[])[2] : undefined;
  const first = pokemon.teraType && pokemon.teraType !== "Stellar" ? pokemon.teraType : pokemon.types[0];
  return { first, ...(added ? { added } : {}), tarShot: !!marks.tarShot, miracleEye: marks.revealed === "miracleeye", pinned: marks.grounding === "pinned" };
}
/** gen789.js:297-307's read: the two types' product, or the Tera type's alone. */
function engineRead(pokemon: Pokemon, move: Move, marks: Marks) {
  return withTurnMarks({ defender: scope(pokemon, marks) }, () => {
    const one = util.getMoveEffectiveness(gen9, move, pokemon.types[0], false, false, false);
    const two = pokemon.types[1] ? util.getMoveEffectiveness(gen9, move, pokemon.types[1], false, false, false) : 1;
    return pokemon.teraType && pokemon.teraType !== "Stellar" ? util.getMoveEffectiveness(gen9, move, pokemon.teraType, false, false, false) : one * two;
  });
}

describe("engine-corrections.cjs withTurnMarks and turnEffectiveness: the same effectiveness", () => {
  const cases: [label: string, species: string, types: string[] | null, marks: Marks, tera: string | undefined, move: string, expected: number][] = [
    ["Lapras with an added Grass type: Thunderbolt", "Lapras", ["Water", "Ice", "Grass"], {}, undefined, "Thunderbolt", 1],
    ["Lapras with an added Grass type: Ice Beam", "Lapras", ["Water", "Ice", "Grass"], {}, undefined, "Ice Beam", 0.5],
    ["Lapras with an added Grass type: Flamethrower", "Lapras", ["Water", "Ice", "Grass"], {}, undefined, "Flamethrower", 2],
    ["Gyarados with an added Grass type: Ice Beam (2x)", "Gyarados", ["Water", "Flying", "Grass"], {}, undefined, "Ice Beam", 2],
    ["Snorlax with an added Ghost type (one type: its types[1]): Close Combat", "Snorlax", ["Normal", "Ghost"], {}, undefined, "Close Combat", 0],
    ["Ferrothorn with Tar Shot: Flamethrower (8x)", "Ferrothorn", null, { tarShot: true }, undefined, "Flamethrower", 8],
    ["Ferrothorn with Tar Shot: Earthquake (only Fire)", "Ferrothorn", null, { tarShot: true }, undefined, "Earthquake", 1],
    ["a Grass-Terastallized Garchomp with Tar Shot: Flamethrower (4x on the Tera type)", "Garchomp", null, { tarShot: true }, "Grass", "Flamethrower", 4],
    ["Umbreon with Miracle Eye: Psychic (neutral)", "Umbreon", null, { revealed: "miracleeye" }, undefined, "Psychic", 1],
    ["Scrafty with Miracle Eye: Psychic (its Fighting type, 2x)", "Scrafty", null, { revealed: "miracleeye" }, undefined, "Psychic", 2],
    ["Umbreon with Miracle Eye: Dark Pulse (only Psychic moves)", "Umbreon", null, { revealed: "miracleeye" }, undefined, "Dark Pulse", 0.5],
    ["a pinned Skarmory: Earthquake (its Flying type neutral)", "Skarmory", null, { grounding: "pinned" }, undefined, "Earthquake", 2],
    ["a Water-typed Garchomp: Thunderbolt", "Garchomp", ["Water"], {}, undefined, "Thunderbolt", 2],
  ];
  for (const [label, species, types, marks, tera, moveName, expected] of cases) {
    it(label, () => {
      const pokemon = defender(species, types, marks, tera);
      const move = new Move(gen9, moveName);
      expect(engineRead(pokemon, move, marks)).toBe(expected);
      expect(turnEffectiveness(gen9, { defender: pokemon, move, field } as never)).toBe(expected);
    });
  }

  it("outside a turn's scope the engine's own effectiveness: no marks read (1v1)", () => {
    const pokemon = defender("Ferrothorn", null, { tarShot: true });
    expect(util.getMoveEffectiveness(gen9, new Move(gen9, "Flamethrower"), "Steel", false, false, false)).toBe(2);
    expect(util.getMoveEffectiveness(gen9, new Move(gen9, "Flamethrower"), pokemon.types[0], false, false, false)).toBe(2);
  });

  it("an intact Ice Face or Disguise (neutralEffectiveness): Tar Shot's doubling is not applied either", () => {
    const pokemon = defender("Ferrothorn", null, { tarShot: true });
    const move = new Move(gen9, "Flamethrower");
    expect(neutralEffectiveness(() => engineRead(pokemon, move, { tarShot: true }))).toBe(1);
  });

  it("Electro Drift's super-effective check (gen789.js:837-841) reads the added type at the first-type call", () => {
    const lapras = defender("Lapras", ["Water", "Ice", "Grass"]);
    const move = new Move(gen9, "Electro Drift");
    const product = withTurnMarks({ defender: scope(lapras, {}) }, () => util.getMoveEffectiveness(gen9, move, lapras.types[0], false, false, false) * util.getMoveEffectiveness(gen9, move, lapras.types[1]!, false, false, false));
    expect(product).toBe(1);
    const plain = defender("Lapras", null);
    expect(util.getMoveEffectiveness(gen9, move, plain.types[0], false, false, false) * util.getMoveEffectiveness(gen9, move, plain.types[1]!, false, false, false)).toBe(2);
  });
});

describe("engine-corrections.cjs isGrounded and checkItem: the grounding and Embargo markers", () => {
  it("pinned (Ingrain, Smack Down) is grounded before the Flying check; floating (Magnet Rise, Telekinesis) is not, unless Gravity or an Iron Ball", () => {
    expect(util.isGrounded(defender("Skarmory", null), field)).toBe(false);
    expect(util.isGrounded(defender("Skarmory", null, { grounding: "pinned" }), field)).toBe(true);
    expect(util.isGrounded(defender("Snorlax", null), field)).toBe(true);
    expect(util.isGrounded(defender("Snorlax", null, { grounding: "floating" }), field)).toBe(false);
    expect(util.isGrounded(defender("Snorlax", null, { grounding: "floating" }), new Field({ gameType: "Doubles", isGravity: true }))).toBe(true);
    const ironBall = setTurnMarks(new Pokemon(gen9, "Snorlax", { item: "Iron Ball" as never }), { grounding: "floating" });
    expect(util.isGrounded(ironBall, field)).toBe(true);
  });

  it("an Embargoed item (itemSuppressed) is set aside as Magic Room sets it (disabledItem)", () => {
    const pokemon = setTurnMarks(new Pokemon(gen9, "Snorlax", { item: "Leftovers" as never }), { itemSuppressed: true });
    util.checkItem(pokemon, false);
    expect(pokemon.item).toBe("");
    expect(pokemon.disabledItem).toBe("Leftovers");
    const plain = new Pokemon(gen9, "Snorlax", { item: "Leftovers" as never });
    util.checkItem(plain, false);
    expect(plain.item).toBe("Leftovers");
  });
});
