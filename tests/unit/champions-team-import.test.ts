import { Pokemon } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import { abilitiesById, champions, itemsById, movesById, speciesById } from "@/app/lib/battle/catalog";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, getBuildStats, NATURES, STATS, validateBuild } from "@/app/lib/battle/model";
import { createMoveSlots, describeMoveSlot } from "@/app/lib/battle/move-defaults";
import { createSpeciesResolver, resolveRosterSpecies } from "@/app/lib/battle/species-identity";
import {
  MAX_TEAM_IMPORT_BYTES, MAX_TEAM_IMPORT_MEMBERS, parseTeamImport,
  type ImportFormat, type ImportedMember,
} from "@/app/lib/battle/team-import";
import type { BattleStat, StatTable } from "@/app/lib/battle/types";
import usage from "@/data/champions/move-usage.json";

function member(text: string, format: ImportFormat = "champions"): ImportedMember {
  const team = parseTeamImport(text, format);
  expect(team.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  expect(team.members).toHaveLength(1);
  return team.members[0];
}

function valid(text: string, format: ImportFormat = "champions"): ImportedMember {
  const result = member(text, format);
  expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  expect(result.selectable).toBe(true);
  expect(result.build).not.toBeNull();
  expect(result.stats).not.toBeNull();
  return result;
}

function invalid(text: string, format: ImportFormat = "champions"): ImportedMember {
  const result = member(text, format);
  expect(result.selectable).toBe(false);
  expect(result.stats).toBeNull();
  expect(result.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
  return result;
}

const pointsTeam = `Sparky (Raichu-Alola) (M) @ Focus Sash
Ability: Surge Surfer
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Fake Out
- Thunderbolt
- Psychic
- Protect`;

const zero: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const perfectIVs: StatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const labels: Record<BattleStat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const statLine = (stats: StatTable) => STATS.map((stat) => `${stats[stat]} ${labels[stat]}`).join(" / ");

// Independent main-series level-50 arithmetic: derive actual stats directly
// from base stats, EVs and IVs, not by repeating the parser's point conversion.
function traditionalStats(base: StatTable, evs: StatTable, ivs: StatTable, nature: typeof NATURES[number]): StatTable {
  const stats = {} as StatTable;
  for (const stat of STATS) {
    const trained = Math.floor(((2 * base[stat] + ivs[stat] + Math.floor(evs[stat] / 4)) * 50) / 100);
    const percentage = nature.plus === stat ? 110 : nature.minus === stat ? 90 : 100;
    stats[stat] = stat === "hp" ? (base.hp === 1 ? 1 : trained + 50 + 10) : Math.floor(((trained + 5) * percentage) / 100);
  }
  return stats;
}

describe("Champions plain-text team import", () => {
  it("imports a real four-move Champions export, including ordered Status moves", () => {
    const parsed = valid(pointsTeam);
    expect(parsed).toMatchObject({ index: 0, name: "Sparky", speciesId: "raichualola", nickname: "Sparky", gender: "M" });
    expect(parsed.build).toEqual({
      ...createBuild("raichualola"), nature: "Timid", itemId: "focussash",
      points: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
    });
    expect(parsed.moves).toEqual(["fakeout", "thunderbolt", "psychic", "protect"].map((moveId) => ({ moveId, origin: "imported", gameType: null })));
    expect(movesById.get(parsed.moves[3].moveId!)?.category).toBe("Status");
    expect(parsed.moves.map(describeMoveSlot)).toEqual(Array(4).fill("Imported from team paste"));
    expect(parsed.stats).toEqual(new Pokemon(0, "Raichu-Alola", { nature: "Timid", evs: { hp: 2, spa: 32, spe: 32 } }).rawStats);
  });

  it("supports CRLF, a leading BOM, blank lines, a title, and original 1-based line numbers", () => {
    const text = "﻿\r\n=== [gen9champions] Summer squad ===\r\n\r\nCharizard\r\nEVs: 2 HP\r\n- Protect\r\n\r\n\r\nBlastoise\r\nLevel: 100\r\n\r\n";
    const team = parseTeamImport(text, "champions");
    expect(team.title).toBe("Summer squad");
    expect(team.format).toBe("champions");
    expect(team.diagnostics).toEqual([]);
    expect(team.members.map((entry) => [entry.index, entry.speciesId, entry.selectable])).toEqual([[0, "charizard", true], [1, "blastoise", false]]);
    expect(team.members[1].diagnostics).toContainEqual(expect.objectContaining({ line: 10, severity: "error", message: expect.stringContaining("Level: 50") }));
    for (const entry of team.members.flatMap((entry) => entry.diagnostics)) expect(entry.line).toBeGreaterThan(0);
  });

  it.each(["EVs", "SPs", "Stat Points"])("reads %s as explicit Champions points without guessing", (label) => {
    const parsed = valid(`Charizard\n${label}: 32 SpA / 32 Spe / 2 HP`);
    expect(parsed.build?.points).toEqual({ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 });
    expect(validateBuild(parsed.build!)).toEqual([]);
  });

  it("uses the chosen mode, never EV magnitudes or the heading, to determine stat meaning", () => {
    const text = "Charizard\nEVs: 32 SpA / 32 Spe / 2 HP";
    expect(valid(text).build?.points).toEqual({ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 });
    expect(valid(text, "traditional").build?.points).toEqual({ hp: 0, atk: 0, def: 0, spa: 4, spd: 0, spe: 4 });
    expect(parseTeamImport(`=== [gen9ou] Not a mode switch ===\n${text}`, "champions").members[0].build?.points.spa).toBe(32);
    invalid("Charizard\nEVs: 252 SpA / 252 Spe / 4 HP", "champions");
  });

  it("does not generate moves for omitted slots or an omitted moveset", () => {
    const parsed = valid("Charizard\n- Roost\n- Flamethrower");
    expect(parsed.moves).toEqual([
      { moveId: "roost", origin: "imported", gameType: null },
      { moveId: "flamethrower", origin: "imported", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
    ]);
    expect(parsed.moves.map(describeMoveSlot)).toEqual(["Imported from team paste", "Imported from team paste", "Choose a move", "Choose a move"]);
    expect(valid("Charizard").moves.every((slot) => slot.moveId === null && slot.origin === "empty")).toBe(true);
    expect(valid("Charizard\n- Protect").moves[0].moveId).toBe("protect");
    expect(valid("Charizard").moves[0]).not.toBe(valid("Charizard").moves[1]);
  });

  it("reports defaults for omitted preparation instead of implying it was supplied", () => {
    const parsed = valid("Charizard");
    expect(parsed.build).toEqual(createBuild("charizard"));
    const info = parsed.diagnostics.filter((entry) => entry.severity === "info").map((entry) => entry.message).join("\n");
    for (const phrase of ["Ability omitted", "Blaze", "Nature omitted", "Serious", "Training omitted", "zero Stat Points", "Level omitted", "level 50", "Full HP", "healthy status", "zero stat stages", "Rivalry", "no held item"]) {
      expect(info).toContain(phrase);
    }
  });

  it("accepts exact normalized catalog items, abilities, natures and move names", () => {
    const parsed = valid("Raichu-Alola @ fOcUs-SaSh\nAbility: SURGE-SURFER\nNature: tImId\n- tHuNdEr-BoLt\n- Fake Out");
    expect(parsed.build).toMatchObject({ itemId: "focussash", abilityId: "surgesurfer", nature: "Timid" });
    expect(parsed.moves.map((entry) => entry.moveId)).toEqual(["thunderbolt", "fakeout", null, null]);
    expect(valid("Charizard\nItem: Leftovers").build?.itemId).toBe("leftovers");
  });

  it.each([
    ["Raichu-Alola", "raichualola"], ["Alolan Raichu", "raichualola"],
    ["Indeedee (Female)", "indeedeef"], ["Indeedee (F)", "indeedeef"], ["Indeedee♀", "indeedeef"], ["Indeedee-F", "indeedeef"],
    ["Meowstic Female Mega @ Meowsticite", "meowsticfmega"], ["Mega Meowstic-F @ Meowsticite", "meowsticfmega"],
    ["Mega Charizard X @ Charizardite X", "charizardmegax"], ["Charizard-Mega-X @ Charizardite X", "charizardmegax"],
  ])("preserves exact species/form identity in %s", (header, expected) => {
    expect(valid(header).speciesId).toBe(expected);
  });

  it("uses the extracted exact resolver, including honest ambiguity rather than fuzzy matching", () => {
    expect(resolveRosterSpecies("Meowstic Female Mega")).toEqual({ status: "resolved", speciesId: "meowsticfmega" });
    expect(resolveRosterSpecies("Indeedee (Female)")).toEqual({ status: "resolved", speciesId: "indeedeef" });
    const ambiguous = createSpeciesResolver([
      { id: "one", name: "Example-A", calcName: "Example A" },
      { id: "two", name: "Example.A", calcName: "Other" },
    ]);
    expect(ambiguous("Example A").status).toBe("ambiguous");
    for (const name of ["Indeedee#F", "Raichu/Alola", "Char", "Charizard-Gmax", "Imaginarymon"]) {
      const parsed = invalid(name);
      expect(parsed.speciesId).toBeNull();
      expect(parsed.build).toBeNull();
    }
  });

  it.each([
    ["Alice (F) (Indeedee (Female)) (F)", "indeedeef", "Alice (F)", "F"],
    ["Indeedee (Female) (Raichu-Alola) (M)", "raichualola", "Indeedee (Female)", "M"],
    ["Nido♀ (Charizard) (F)", "charizard", "Nido♀", "F"],
    ["Mega (Blastoise)", "blastoise", "Mega", undefined],
    ["Sparky (Raichu-Alola)", "raichualola", "Sparky", undefined],
  ])("keeps nickname and individual gender unambiguous in %s", (header, speciesId, nickname, gender) => {
    const parsed = valid(header);
    expect(parsed).toMatchObject({ name: nickname, speciesId, nickname });
    expect(parsed.gender).toBe(gender);
  });

  it("keeps a cosmetic gender suffix separate from forms and explains unmodeled Rivalry context", () => {
    const parsed = valid("Charizard (F)\nShiny: Yes");
    expect(parsed).toMatchObject({ speciesId: "charizard", gender: "F", shiny: true });
    expect(parsed.diagnostics.some((entry) => entry.severity === "info" && entry.message.includes("Rivalry"))).toBe(true);
    expect(valid("Indeedee-F (F)").speciesId).toBe("indeedeef");
    expect(valid("Indeedee (M)").speciesId).toBe("indeedee");
    expect(valid("Charizard\nGender: Female\nShiny: No")).toMatchObject({ gender: "F", shiny: false });
  });

  it("never Mega evolves from a held stone and never auto-equips a missing required stone", () => {
    expect(valid("Charizard @ Charizardite X").build).toMatchObject({ speciesId: "charizard", itemId: "charizarditex", abilityId: "blaze" });
    const missing = invalid("Charizard-Mega-X");
    expect(missing.build).toMatchObject({ speciesId: "charizardmegax", itemId: "" });
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: "Charizard-Mega-X requires Charizardite X." }));
    for (const item of ["Leftovers", "Charizardite Y"]) {
      const wrong = invalid(`Charizard-Mega-X @ ${item}`);
      expect(wrong.diagnostics.some((entry) => entry.message.includes("requires Charizardite X"))).toBe(true);
    }
    expect(valid("Meowstic Female Mega @ Meowsticite").build?.abilityId).toBe("trace");
  });

  it.each([
    ["Greninja", "Protean", true], ["Greninja", "Torrent", false],
    ["Cinderace", "Libero", true], ["Cinderace", "Blaze", false],
    ["Arcanine", "Flash Fire", false], ["Arcanine", "Intimidate", false],
  ])("recalculates activation for imported %s / %s", (name, ability, active) => {
    const parsed = valid(`${name}\nAbility: ${ability}`);
    expect(parsed.build?.abilityActive).toBe(active);
    expect(validateBuild(parsed.build!)).toEqual([]);
  });

  it("validates the ability against the exact form rather than the base species", () => {
    invalid("Meowstic-F\nAbility: Prankster");
    invalid("Charizard-Mega-X @ Charizardite X\nAbility: Blaze");
    expect(valid("Meowstic-F\nAbility: Competitive").build?.abilityId).toBe("competitive");
    expect(valid("Charizard-Mega-X @ Charizardite X\nAbility: Tough Claws").build?.abilityId).toBe("toughclaws");
  });

  it("retains independent duplicate-species sets without imposing Species Clause", () => {
    const team = parseTeamImport("Charizard\nTimid Nature\n- Flamethrower\n\nCharizard\nModest Nature\n- Roost", "champions");
    expect(team.members.map((entry) => [entry.index, entry.speciesId, entry.selectable])).toEqual([[0, "charizard", true], [1, "charizard", true]]);
    expect(team.members.map((entry) => entry.build?.nature)).toEqual(["Timid", "Modest"]);
    expect(team.members[0].build).not.toBe(team.members[1].build);
    expect(team.members[0].build?.points).not.toBe(team.members[1].build?.points);
    expect(team.members[0].moves).not.toBe(team.members[1].moves);
  });

  it("does not mutate catalog, move usage, source text, defaults or subsequent parses", () => {
    const beforeCatalog = JSON.stringify(champions);
    const beforeUsage = JSON.stringify(usage);
    const defaults = createMoveSlots("raichualola", "Doubles");
    const beforeDefaults = structuredClone(defaults);
    const text = pointsTeam;
    const parsed = valid(text);
    parsed.build!.points.hp = 31;
    parsed.moves[0].moveId = "surf";
    parsed.diagnostics.push({ line: 1, severity: "error", message: "Changed by caller" });
    const fresh = valid(text);
    expect(fresh.build?.points.hp).toBe(2);
    expect(fresh.moves[0].moveId).toBe("fakeout");
    expect(text).toBe(pointsTeam);
    expect(JSON.stringify(champions)).toBe(beforeCatalog);
    expect(JSON.stringify(usage)).toBe(beforeUsage);
    expect(defaults).toEqual(beforeDefaults);
    expect(createMoveSlots("raichualola", "Doubles")).toEqual(beforeDefaults);
  });
});

describe("Team import correction diagnostics", () => {
  it.each([
    "Ability: Blaze\nAbility: Blaze",
    "Timid Nature\nNature: Modest",
    "Level: 50\nLevel: 50",
    "EVs: 1 HP\nSPs: 1 Atk",
    "SPs: 1 HP\nStat Points: 1 Atk",
    "EVs: 1 HP / 2 HP",
    "EVs: 1 SpA / 2 Sp. Atk",
    "- Flamethrower\n- FLAME-THROWER",
    "Shiny: Yes\nShiny: No",
    "Gender: Male\nGender: Female",
  ])("rejects duplicate assignments instead of last-write-wins: %s", (lines) => {
    const parsed = invalid(`Charizard\n${lines}`);
    expect(parsed.diagnostics.some((entry) => entry.severity === "error" && entry.message.includes("Duplicate"))).toBe(true);
  });

  it("rejects item/gender duplicates against header metadata", () => {
    invalid("Charizard @ Leftovers\nItem: Focus Sash");
    invalid("Charizard (M)\nGender: Male");
    invalid("Charizard @ Leftovers @ Focus Sash");
    invalid("Charizard @");
  });

  it.each(["1.5", "1e1", "12oops", "Infinity", "NaN", "9007199254740992", "-1", "+1", "0x10", "33"])("rejects noninteger or out-of-range Champions value %s", (value) => {
    const parsed = invalid(`Charizard\nEVs: ${value} HP`);
    expect(parsed.build?.points.hp).toBeNull();
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ line: 2, severity: "error", message: expect.stringContaining("whole number from 0 to 32") }));
  });

  it.each(["100", "5e1", "50.0", "50x", "-50", "0", "", "+50"])("rejects explicit invalid/non-50 Level %s", (value) => {
    invalid(`Charizard\nLevel: ${value}`);
    invalid(`Charizard\nLevel: ${value}`, "traditional");
  });

  it.each([
    "EVs: 32 SpA / 32 Spe / 3 HP", "EVs:", "EVs: 2 Luck", "EVs: HP 2", "EVs: 2 HP /", "EVs: 2 HP / / 1 Atk",
    "IVs: 31 HP", "IVs: 0 Atk", "Nature: Unknown", "Shiny: true", "Gender: anything",
    "Ability: Levitate", "Ability: Fake Ability", "Item: Fake Item", "Item:", "Ability:",
    "- Imaginary Move", "- Thunderbolt", "-", "- Flamethrower\n- Air Slash\n- Protect\n- Roost\n- Helping Hand",
    "Tera Type: Fire", "Tera: Fire", "Gigantamax: Yes", "Dynamax Level: 10", "Happiness: 255", "Hidden Power: Ice", "Status: brn", "Unknown: value", "Unrecognized text",
  ])("requires correction for malformed, unavailable or unsupported input: %s", (line) => {
    invalid(`Charizard\n${line}`);
  });

  it("keeps a bad member in place while other members remain selectable", () => {
    const team = parseTeamImport("Charizard\n- Flamethrower\n\nNo Such Species\n- Protect\n\nBlastoise\nEVs: 32 HP / 32 Def / 2 SpD\n- Surf", "champions");
    expect(team.members.map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(team.members.map((entry) => entry.selectable)).toEqual([true, false, true]);
    expect(team.members[1]).toMatchObject({ speciesId: null, build: null, stats: null, name: "No Such Species" });
    expect(team.diagnostics).toEqual([]);
  });

  it("preserves known unsupported Lucario-Z without substituting its species, stone or ability", () => {
    const parsed = valid("Mega Lucario Z @ Lucarionite Z\nAbility: Aura Guard\nEVs: 2 HP / 32 SpA / 32 Spe\nTimid Nature\n- Aura Sphere\n- Protect");
    expect(parsed.build).toMatchObject({ speciesId: "lucariomegaz", abilityId: "auraguard", itemId: "lucarionitez" });
    expect(parsed.diagnostics.some((entry) => entry.severity === "warning" && entry.message.includes("Calculation paused"))).toBe(true);
    const result = calculateMatchup(parsed.build!, createBuild("blastoise"), createConditions());
    expect(result.results).toEqual([]);
    expect(result.issues.attacker).toEqual(validateBuild(parsed.build!));
    expect(result.issues.attacker.length).toBeGreaterThan(0);
    expect(invalid("Lucario-Mega-Z").diagnostics.some((entry) => entry.severity === "error" && entry.message.includes("requires Lucarionite Z"))).toBe(true);
  });

  it("warns for an exact supported-catalog ability gap but rejects an illegal assignment of that same ability", () => {
    const parsed = valid("Greninja\nAbility: Battle Bond\n- Surf");
    expect(abilitiesById.get("battlebond")?.unsupported.length).toBeGreaterThan(0);
    expect(parsed.build?.abilityId).toBe("battlebond");
    expect(parsed.diagnostics.some((entry) => entry.severity === "warning")).toBe(true);
    expect(calculateMatchup(parsed.build!, createBuild(), createConditions()).results).toEqual([]);
    invalid("Charizard\nAbility: Battle Bond");
  });

  it("keeps a catalog-valid unsupported move as an inspectable imported slot", () => {
    const parsed = valid("Abomasnow\n- Growth");
    expect(parsed.moves[0]).toEqual({ moveId: "growth", origin: "imported", gameType: null });
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ line: 2, severity: "warning", message: expect.stringContaining("Growth") }));
  });

  it("distinguishes item support warnings from required-stone errors on the same field", () => {
    // Current real catalog has no unsupported items. Simulate a future coverage
    // annotation on an existing exact item, without mutating the source record.
    const original = itemsById.get("leftovers")!;
    itemsById.set(original.id, { ...original, unsupported: ["Fixture: engine coverage is unavailable."] });
    try {
      const parsed = valid("Charizard @ Leftovers");
      expect(parsed.build?.itemId).toBe("leftovers");
      expect(parsed.diagnostics.some((entry) => entry.severity === "warning")).toBe(true);
      expect(calculateMatchup(parsed.build!, createBuild(), createConditions()).results).toEqual([]);
      const wrongStone = invalid("Charizard-Mega-X @ Leftovers");
      expect(wrongStone.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: "Charizard-Mega-X requires Charizardite X." }));
      expect(wrongStone.diagnostics.some((entry) => entry.severity === "warning")).toBe(true);
    } finally {
      itemsById.set(original.id, original);
    }
  });
});

describe("Traditional EV/IV conversion", () => {
  it("converts 252/252/4 to 32/32/1 rather than granting an extra point", () => {
    const parsed = valid("Charizard\nEVs: 252 SpA / 252 Spe / 4 HP\nTimid Nature", "traditional");
    expect(parsed.build?.points).toEqual({ hp: 1, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 });
    expect(parsed.stats).toEqual({ hp: 154, atk: 93, def: 98, spa: 161, spd: 105, spe: 167 });
    expect(parsed.stats).toEqual(new Pokemon(9, "Charizard", { level: 50, nature: "Timid", evs: { hp: 4, spa: 252, spe: 252 } }).rawStats);
    expect(parsed.diagnostics.some((entry) => entry.severity === "info" && entry.message.includes("IVs default to 31"))).toBe(true);
  });

  it.each(NATURES)("matches independent traditional formulas and both engines for every spread with $name nature", (nature) => {
    const spreads: { evs: StatTable; ivs: StatTable }[] = [
      { evs: zero, ivs: perfectIVs },
      { evs: { ...zero, hp: 4, spa: 252, spe: 252 }, ivs: perfectIVs },
      { evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 }, ivs: perfectIVs },
      { evs: { hp: 7, atk: 9, def: 101, spa: 117, spd: 124, spe: 150 }, ivs: perfectIVs },
      { evs: zero, ivs: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 } },
      { evs: { ...zero, atk: 120, spe: 120, spa: 252 }, ivs: { ...perfectIVs, atk: 0, spe: 0 } },
      { evs: { ...zero, hp: 4, atk: 8, def: 12, spa: 16, spd: 20, spe: 24 }, ivs: { hp: 29, atk: 28, def: 27, spa: 26, spd: 25, spe: 24 } },
    ];
    for (const speciesId of ["charizard", "blastoise", "indeedeef"]) {
      const species = speciesById.get(speciesId)!;
      for (const { evs, ivs } of spreads) {
        const parsed = valid(`${species.name}\nLevel: 50\nEVs: ${statLine(evs)}\nIVs: ${statLine(ivs)}\n${nature.name} Nature`, "traditional");
        expect(parsed.stats).toEqual(traditionalStats(species.baseStats, evs, ivs, nature));
        expect(parsed.stats).toEqual(new Pokemon(9, species.calcName, { level: 50, nature: nature.name, evs, ivs }).rawStats);
        expect(parsed.stats).toEqual(new Pokemon(0, species.calcName, { nature: nature.name, evs: parsed.build!.points as StatTable }).rawStats);
        expect(parsed.stats).toEqual(getBuildStats(parsed.build!));
      }
    }
  });

  it("allows representable low IVs but rejects sub-minimum stats without clamping", () => {
    expect(valid("Charizard\nEVs: 120 Atk\nIVs: 0 Atk", "traditional").build?.points.atk).toBe(0);
    expect(valid("Charizard\nIVs: 30 Atk", "traditional").build?.points.atk).toBe(0);
    const minimum = getBuildStats(createBuild("charizard"))!.atk;
    for (const [ev, iv, expectedPoints] of [[0, 0, -15], [119, 0, -1], [0, 29, -1]]) {
      const parsed = invalid(`Charizard\nEVs: ${ev} Atk\nIVs: ${iv} Atk`, "traditional");
      expect(parsed.build?.points.atk).toBe(expectedPoints);
      expect(new Pokemon(9, "Charizard", { level: 50, nature: "Serious", evs: { atk: ev }, ivs: { atk: iv } }).rawStats.atk).toBeLessThan(minimum);
      expect(parsed.diagnostics.some((entry) => entry.severity === "error" && entry.message.includes("no clamping"))).toBe(true);
    }
  });

  it.each([
    "EVs: 253 HP", "EVs: 252 SpA / 252 Spe / 8 HP", "EVs: -1 HP", "EVs: 1.5 HP", "EVs: 2e2 HP",
    "IVs: 32 HP", "IVs: -1 HP", "IVs: 30.5 HP", "IVs: 31x HP", "IVs: 31 HP / 30 HP", "IVs: 31 HP\nIVs: 30 Atk",
  ])("rejects traditional bounds, malformed values or duplicates: %s", (line) => {
    invalid(`Charizard\n${line}`, "traditional");
  });

  it.each(["SPs", "Stat Points"])("rejects explicitly labeled %s in traditional mode without reinterpreting them", (label) => {
    const parsed = invalid(`Charizard\n${label}: 32 SpA / 32 Spe / 2 HP`, "traditional");
    expect(parsed.build?.points).toEqual({ hp: null, atk: null, def: null, spa: null, spd: null, spe: null });
    expect(parsed.diagnostics.some((entry) => entry.severity === "error" && entry.message.includes("Choose Champions mode"))).toBe(true);
  });
});

describe("Plain-text import boundaries", () => {
  it.each(["", " \t\r\n\r\n", "﻿\n"])("requires at least one member for %j", (text) => {
    const team = parseTeamImport(text, "champions");
    expect(team.members).toEqual([]);
    expect(team.diagnostics).toContainEqual(expect.objectContaining({ line: 1, severity: "error" }));
  });

  it.each([
    '[{"species":"Charizard"}]', '{"team":["Charizard"]}', "Charizard||leftovers|blaze||||||||]Blastoise||",
    "```\nCharizard\n```", "Charizard\u0000\n- Protect", "Charizard\n\n{\"species\":\"Blastoise\"}",
  ])("rejects JSON, packed teams, code fences and control payloads globally: %j", (text) => {
    const team = parseTeamImport(text, "champions");
    expect(team.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
    expect(team.members.every((entry) => !entry.selectable)).toBe(true);
  });

  it("measures the 64 KiB bound in UTF-8 bytes rather than JavaScript string length", () => {
    const suffix = " (Charizard)";
    const boundary = "é".repeat((MAX_TEAM_IMPORT_BYTES - suffix.length) / 2) + suffix;
    expect(new TextEncoder().encode(boundary).byteLength).toBe(MAX_TEAM_IMPORT_BYTES);
    expect(valid(boundary).speciesId).toBe("charizard");
    const over = boundary + "é";
    expect(over.length).toBeLessThan(MAX_TEAM_IMPORT_BYTES);
    for (const text of [over, "x".repeat(MAX_TEAM_IMPORT_BYTES + 1)]) {
      const team = parseTeamImport(text, "champions");
      expect(team.members).toEqual([]);
      expect(team.diagnostics).toEqual([{ line: 1, severity: "error", message: expect.stringContaining("64 KiB UTF-8") }]);
    }
  });

  it("allows 24 independently indexed members, never silently truncates the 25th", () => {
    const team = parseTeamImport(Array(MAX_TEAM_IMPORT_MEMBERS).fill("Charizard").join("\n\n"), "champions");
    expect(team.members).toHaveLength(24);
    expect(team.members.every((entry, index) => entry.selectable && entry.index === index)).toBe(true);
    const over = parseTeamImport(Array(MAX_TEAM_IMPORT_MEMBERS + 1).fill("Charizard").join("\n\n"), "champions");
    expect(over.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", line: 49, message: expect.stringContaining("24 members") }));
    expect(over.members.every((entry) => !entry.selectable)).toBe(true);
  });

  it("makes every member unselectable after a global multiple-section error", () => {
    const team = parseTeamImport("=== First ===\nCharizard\n\n=== Second ===\nBlastoise", "champions");
    expect(team.members).toHaveLength(2);
    expect(team.members.map((entry) => entry.index)).toEqual([0, 1]);
    expect(team.members.every((entry) => !entry.selectable)).toBe(true);
    expect(team.diagnostics).toContainEqual(expect.objectContaining({ line: 4, severity: "error", message: expect.stringContaining("Multiple team sections") }));
    expect(team.title).toBe("First");
  });

  it.each(["Charizard\n\n=== Late ===\nBlastoise", "=== Broken\nCharizard", "=== [gen9] ===\nCharizard"])("rejects a late or malformed heading globally: %s", (text) => {
    const team = parseTeamImport(text, "champions");
    expect(team.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
    expect(team.members.every((entry) => !entry.selectable)).toBe(true);
  });

  it("does not fall through to a guessed runtime format", () => {
    const team = parseTeamImport("Charizard", "guess" as ImportFormat);
    expect(team.members).toEqual([]);
    expect(team.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
  });
});
