import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { megaEntries } from "@/app/lib/battle/mega-forms";
import { defaultAbilityActive } from "@/app/lib/battle/model";
import { sheetFromTeam } from "@/app/(app)/training/model/sheet";
import { suggestedMember } from "@/app/(app)/training/usage/suggested-member";
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import {
  PROTECT_ADDED_FACT, SUGGESTION_LABEL,
  type SetLegality, type SuggestedSet, type SuggestMember, type TrainingUsageData, type UsageDeps,
} from "@/app/(app)/training/model/usage";
import { editorMoveOptions } from "@/app/(app)/training/usage/move-options";
import { CHOICE_ITEMS, PROTECT_MOVES, PROTECT_RULE_EXCLUDED_ITEMS, suggestTrainingSets } from "@/app/(app)/training/usage/suggested-sets";
import { loadTrainingUsage, speciesUsage } from "@/app/(app)/training/usage/training-usage";

// Addendum A1.2 (Training suggested sets, Protect rule) and A1.3 (the set editor's move list).

type SetFields = Parameters<SetLegality["problems"]>[0];
const usage = loadTrainingUsage();
const NATURES = new Set(["Adamant", "Bashful", "Bold", "Brave", "Calm", "Careful", "Docile", "Gentle", "Hardy", "Hasty", "Impish", "Jolly", "Lax",
  "Lonely", "Mild", "Modest", "Naive", "Naughty", "Quiet", "Quirky", "Rash", "Relaxed", "Sassy", "Serious", "Timid"]);

/**
 * A stand-in for the worker's validator-backed SetLegality: the catalog's proven learnset (equal to the pinned validator's
 * one-move checks for all 389 forms a roster can name: scripts/.cache/training/build/data/validator-probe.ts) and the
 * validator's per-set rules in its own words. `extra` adds combination rules.
 */
function catalogLegality(extra: (set: SetFields, name: string) => string[] = () => []): SetLegality & { calls: number } {
  const legality = {
    calls: 0,
    legalMoves: (speciesId: string) => runtime.speciesById.get(speciesId)?.moves ?? [],
    problems(set: SetFields) {
      legality.calls++;
      const species = runtime.speciesById.get(set.speciesId)!;
      const name = species.name;
      const moveName = (id: string) => runtime.movesById.get(id)?.name ?? id;
      const problems: string[] = [];
      if (!set.moves.length) problems.push(`${name} has no moves (it must have at least one to be usable).`);
      for (const [index, id] of set.moves.entries()) {
        if (set.moves.indexOf(id) !== index) problems.push(`${name} has multiple copies of ${moveName(id)}.`);
        else if (!species.moves.includes(id)) problems.push(`${name} can't learn ${moveName(id)}.`);
      }
      if (!species.abilities.includes(set.abilityId)) problems.push(`${name} can't have ${set.abilityId}.`);
      if (set.itemId && !runtime.itemsById.has(set.itemId)) problems.push(`${name}'s item ${set.itemId} does not exist in Gen 9.`);
      if (!NATURES.has(set.nature)) problems.push(`${name}'s nature is invalid.`);
      const total = Object.values(set.points).reduce((sum, value) => sum + value, 0);
      for (const [stat, value] of Object.entries(set.points)) if (value > 32) problems.push(`${name} has more than 32 Stat Points in ${stat}.`);
      if (total > 66) problems.push(`${name} has ${total} total Stat Points, which is more than this format's limit of 66.`);
      if (total === 0 && set.nature === "Serious") problems.push(`${name} has exactly 0 Stat Points - did you forget to invest it?`);
      return [...problems, ...extra(set, name)];
    },
  };
  return legality;
}
const deps = (legality: SetLegality = catalogLegality(), data: TrainingUsageData = usage): UsageDeps => ({ usage: data, legality, runtime });
const member = (speciesId: string, abilityId: string | null = null): SuggestMember => ({ key: `league:${speciesId}`, speciesId, abilityId });
const suggestOne = (speciesId: string, abilityId: string | null = null, legality?: SetLegality, data?: TrainingUsageData) =>
  suggestTrainingSets([member(speciesId, abilityId)], deps(legality, data))[0];
/** Every catalog form a league row can name: the battle-only forms other than Megas are reached in battle, never drafted. */
const FORMS = runtime.catalog.species.filter((species) => !species.battleForm || megaEntries(species.id, runtime).length > 0).map((species) => species.id);
/** Teams of six from FORMS, forwards then backwards, never two members with the same `clause` key (Species Clause). */
function teamsOfSix(clause: (speciesId: string) => string | number): string[][] {
  const teams: string[][] = [];
  for (const order of [FORMS, [...FORMS].reverse()]) {
    let team: string[] = [];
    for (const id of order) {
      if (team.some((other) => clause(other) === clause(id))) continue;
      team.push(id);
      if (team.length === 6) {
        teams.push(team);
        team = [];
      }
    }
  }
  return teams;
}

describe("Training suggested sets from usage (A1.2)", () => {
  it("Incineroar: Fake Out, Parting Shot, Flare Blitz, and Protect in place of Throat Chop, its lowest-weight move", () => {
    const set = suggestOne("incineroar");
    expect(set).toEqual({
      key: "league:incineroar", speciesId: "incineroar", source: "usage",
      moves: ["fakeout", "partingshot", "flareblitz", "protect"],
      itemId: "sitrusberry", abilityId: "intimidate", nature: "Impish",
      points: { hp: 32, atk: 0, def: 21, spa: 0, spd: 10, spe: 3 },
      protectAdded: true,
    } satisfies SuggestedSet);
    // The usage four before the rule: Throat Chop (0.4119) is the lowest-weight of them.
    expect(usage.species.incineroar.moves.slice(0, 4).map((move) => move.id)).toEqual(["fakeout", "partingshot", "flareblitz", "throatchop"]);
    expect(SUGGESTION_LABEL[set.source]).toBe("Suggested set");
    expect(PROTECT_ADDED_FACT).toBe("Protect added");
  });

  it("keeps a usage Protect where it ranks and adds nothing (Garchomp)", () => {
    const set = suggestOne("garchomp");
    expect(set.moves).toEqual(["dragonclaw", "earthquake", "rockslide", "protect"]);
    expect(set.protectAdded).toBe(false);
    expect(set).toMatchObject({ itemId: "lifeorb", abilityId: "roughskin", nature: "Jolly", points: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } });
  });

  it("gives a Choice Scarf set no Protect: none added, and a usage Protect is skipped (Basculegion)", () => {
    expect(usage.species.basculegion.moves.slice(0, 4).map((move) => move.id)).toContain("protect");
    const set = suggestOne("basculegion");
    expect(set.itemId).toBe("choicescarf");
    expect(set.moves).toEqual(["lastrespects", "aquajet", "wavecrash", "flipturn"]);
    expect(set.protectAdded).toBe(false);
    expect([...CHOICE_ITEMS].sort()).toEqual(["choiceband", "choicescarf", "choicespecs"]);
    expect([...PROTECT_RULE_EXCLUDED_ITEMS].sort()).toEqual(["assaultvest", "choiceband", "choicescarf", "choicespecs"]);
    for (const id of FORMS) {
      const each = suggestOne(id);
      if (PROTECT_RULE_EXCLUDED_ITEMS.has(each.itemId)) expect(each.moves.some((move) => PROTECT_MOVES.has(move)), id).toBe(false);
    }
  });

  it("treats Protect's family as Protect: King's Shield, Spiky Shield and Detect sets get no second one", () => {
    for (const [id, shield] of [["aegislash", "kingsshield"], ["chesnaughtmega", "spikyshield"], ["leafeon", "detect"]] as const) {
      const set = suggestOne(id);
      expect(set.moves, id).toContain(shield);
      expect(set.moves, id).not.toContain("protect");
      expect(set.protectAdded, id).toBe(false);
    }
  });

  it("Item Clause: an item an earlier member took goes to the next-highest item, in member order", () => {
    expect(usage.species.arcanine.items[0].id).toBe("sitrusberry");
    expect(usage.species.aromatisse.items[0].id).toBe("sitrusberry");
    const [arcanine, aromatisse] = suggestTrainingSets([member("arcanine"), member("aromatisse")], deps());
    expect(arcanine.itemId).toBe("sitrusberry");
    expect(aromatisse.itemId).toBe(usage.species.aromatisse.items[1].id);
    const [second, first] = suggestTrainingSets([member("aromatisse"), member("arcanine")], deps());
    expect(second.itemId).toBe("sitrusberry");
    expect(first.itemId).toBe(usage.species.arcanine.items.find((item) => item.id !== "sitrusberry")!.id);
  });

  it("a Mega form holds its stone, which no earlier member may take (Charizard-Mega-Y)", () => {
    const set = suggestOne("charizardmegay");
    expect(set).toMatchObject({ source: "usage", itemId: "charizarditey", abilityId: "drought", nature: "Timid" });
    expect(set.moves).toEqual(["heatwave", "protect", "weatherball", "solarbeam"]);
    const stoneFirst: TrainingUsageData = {
      ...usage,
      species: { ...usage.species, garchomp: { ...usage.species.garchomp, items: [{ id: "charizarditey", weight: 0.9 }, { id: "lifeorb", weight: 0.1 }] } },
    };
    const [garchomp, charizard] = suggestTrainingSets([member("garchomp"), member("charizardmegay")], deps(catalogLegality(), stoneFirst));
    expect(garchomp.itemId).toBe("lifeorb");
    expect(charizard.itemId).toBe("charizarditey");
  });

  it("keeps the Pool Builder row's ability when the form has it, else the highest-weight legal one", () => {
    expect(suggestOne("garchomp", "sandveil").abilityId).toBe("sandveil");
    expect(suggestOne("garchomp", "intimidate").abilityId).toBe("roughskin");
    expect(suggestOne("cinderace", "libero").abilityId).toBe("libero");
  });

  it("only keeps moves the validator accepts together, and puts Protect at the next-lowest place when the lowest is rejected", () => {
    const apart = catalogLegality((set, name) => set.moves.includes("fakeout") && set.moves.includes("partingshot")
      ? [`${name}'s move Parting Shot is incompatible with Fake Out.`] : []);
    expect(suggestOne("incineroar", null, apart).moves).toEqual(["fakeout", "flareblitz", "throatchop", "protect"]);
    const placed = catalogLegality((set, name) => set.moves.includes("protect") && set.moves.includes("flareblitz")
      ? [`${name}'s move Protect is incompatible with Flare Blitz.`] : []);
    const set = suggestOne("incineroar", null, placed);
    expect(set.moves).toEqual(["fakeout", "partingshot", "protect", "throatchop"]);
    expect(set.protectAdded).toBe(true);
    const never = catalogLegality((each, name) => each.moves.includes("protect") ? [`${name} can't learn Protect.`] : []);
    expect(suggestOne("incineroar", null, never)).toMatchObject({ moves: ["fakeout", "partingshot", "flareblitz", "throatchop"], protectAdded: false });
    const noProtect = { ...catalogLegality(), legalMoves: (id: string) => runtime.speciesById.get(id)!.moves.filter((move) => move !== "protect") };
    expect(suggestOne("incineroar", null, noProtect).protectAdded).toBe(false);
    // An item the validator rejects for the set gives way to the next one; with every item rejected, no item.
    const noSitrus = catalogLegality((each, name) => each.itemId === "sitrusberry" ? [`${name}'s item Sitrus Berry is banned.`] : []);
    expect(suggestOne("incineroar", null, noSitrus).itemId).toBe(usage.species.incineroar.items[1].id);
    const noItems = catalogLegality((each, name) => each.itemId ? [`${name}'s item is banned.`] : []);
    expect(suggestOne("incineroar", null, noItems)).toMatchObject({ itemId: "", moves: ["fakeout", "partingshot", "flareblitz", "protect"] });
  });

  it("a cosmetic form reads its family's row; Maushold-Four reads Maushold's", () => {
    const jungle = suggestOne("vivillonjungle");
    const family = suggestOne("vivillon");
    expect(jungle.source).toBe("usage");
    expect({ ...jungle, key: "", speciesId: "" }).toEqual({ ...family, key: "", speciesId: "" });
    expect(suggestOne("mausholdfour").moves).toEqual(suggestOne("maushold").moves);
  });
});

describe("Training suggested sets without usage data (A1.2, SPEC C15)", () => {
  it("the calculator's damaging moves with Protect in the last suggested move's place, Hardy, 0 Stat Points", () => {
    expect(speciesUsage(usage, "absolmegaz", runtime)).toBeNull();
    const calculator = createMoveSlots("absolmegaz", "Doubles", runtime).flatMap((slot) => slot.moveId ?? []);
    expect(calculator).toHaveLength(4);
    const set = suggestOne("absolmegaz");
    expect(set).toEqual({
      key: "league:absolmegaz", speciesId: "absolmegaz", source: "no-usage",
      moves: [...calculator.slice(0, 3), "protect"], itemId: "absolitez", abilityId: "sharpness",
      nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, protectAdded: true,
    } satisfies SuggestedSet);
    expect(SUGGESTION_LABEL[set.source]).toBe("Suggested set (no usage data)");
    const arbok = suggestOne("arbok");
    expect(arbok).toMatchObject({ source: "no-usage", itemId: "", abilityId: usualAbility("arbok", "Doubles", runtime), nature: "Hardy" });
    expect(arbok.moves.filter((id) => id !== "protect")).toEqual(createMoveSlots("arbok", "Doubles", runtime).map((slot) => slot.moveId).filter((id) => id).slice(0, 3));
  });
});

describe("every suggested set", () => {
  const all = FORMS.map((id) => suggestOne(id));

  it("is legal alone, has 1–4 distinct moves, and is never Serious with 0 Stat Points", () => {
    const legality = catalogLegality();
    expect(all).toHaveLength(389);
    for (const set of all) {
      expect(legality.problems(set), set.speciesId).toEqual([]);
      expect(set.moves.length, set.speciesId).toBeGreaterThanOrEqual(1);
      expect(set.moves.length).toBeLessThanOrEqual(4);
      expect(new Set(set.moves).size).toBe(set.moves.length);
      expect(set.nature === "Serious" && Object.values(set.points).every((value) => value === 0), set.speciesId).toBe(false);
      expect(set.source).toBe(speciesUsage(usage, set.speciesId, runtime) ? "usage" : "no-usage");
    }
    expect(all.filter((set) => set.source === "usage")).toHaveLength(313);
    // Ditto learns only Transform; every other form has four moves.
    expect(all.filter((set) => set.moves.length < 4).map((set) => set.speciesId)).toEqual(["ditto"]);
    // Every form that learns Protect and holds no Choice item ends with a move of the Protect family.
    for (const set of all) {
      if (runtime.speciesById.get(set.speciesId)!.moves.includes("protect") && !PROTECT_RULE_EXCLUDED_ITEMS.has(set.itemId)) {
        expect(set.moves.some((move) => PROTECT_MOVES.has(move)), set.speciesId).toBe(true);
      }
    }
    expect(all.filter((set) => set.moves.some((move) => runtime.movesById.get(move)!.category === "Status")).length).toBeGreaterThan(350);
  });

  it("teams never share an item (Item Clause), and the same members always get the same sets without changing the data", () => {
    const before = JSON.stringify(usage);
    // Meowstic-M-Mega and Meowstic-F-Mega share Meowsticite; both are Meowstic for Species Clause.
    const teams = teamsOfSix((id) => runtime.speciesById.get(id)!.name.split("-")[0]);
    for (const team of teams) {
      const sets = suggestTrainingSets(team.map((each) => member(each)), deps());
      const items = sets.map((set) => set.itemId).filter(Boolean);
      expect(new Set(items).size, team.join(",")).toBe(items.length);
      expect(sets.map((set) => set.key)).toEqual(team.map((each) => `league:${each}`));
      expect(suggestTrainingSets(team.map((each) => member(each)), deps())).toEqual(sets);
    }
    expect(teams.length).toBeGreaterThanOrEqual(75);
    expect(JSON.stringify(usage)).toBe(before);
  });
});

describe("a suggested set as a TrainingMember", () => {
  it("is the calculator's build shape with the set's fields, and its sheet is the set", () => {
    const set = suggestOne("incineroar");
    const memberRow = suggestedMember(set, { name: "Incineroar", spriteName: "Incineroar" });
    expect(memberRow).toMatchObject({
      key: set.key, name: "Incineroar", speciesId: "incineroar", origin: "suggested", spriteName: "Incineroar",
      suggestion: { source: "usage", protectAdded: true },
      build: { game: "champions", speciesId: "incineroar", abilityId: "intimidate", abilityActive: defaultAbilityActive("intimidate"), itemId: "sitrusberry", nature: "Impish", points: set.points },
    });
    expect(memberRow.moves).toEqual([
      { moveId: "fakeout", origin: "usage", gameType: "Doubles" }, { moveId: "partingshot", origin: "usage", gameType: "Doubles" },
      { moveId: "flareblitz", origin: "usage", gameType: "Doubles" }, { moveId: "protect", origin: "suggested", gameType: "Doubles" },
    ]);
    for (const id of FORMS) {
      const each = suggestOne(id);
      const [sheet] = sheetFromTeam({ label: "", members: [suggestedMember(each, { name: id })] });
      expect({ ...sheet, gender: null }, id).toEqual({
        key: each.key, speciesId: id, name: id, gender: null, nature: each.nature, itemId: each.itemId, abilityId: each.abilityId, moves: each.moves, points: each.points,
      });
    }
    expect(suggestedMember(suggestOne("ditto"), { name: "Ditto" }).moves.slice(1)).toEqual(Array(3).fill({ moveId: null, origin: "empty", gameType: null }));
    expect(suggestedMember(suggestOne("absolmegaz"), { name: "Absol" }).moves.every((slot) => slot.origin === "suggested")).toBe(true);
  });
});

describe("the set editor's move list (A1.3)", () => {
  it("lists every legal move of any category: usage order with weights first, then A–Z by name", () => {
    const options = editorMoveOptions("incineroar", deps());
    const learnset = runtime.speciesById.get("incineroar")!.moves;
    expect(options.map((option) => option.id).sort()).toEqual([...learnset].sort());
    const used = usage.species.incineroar.moves;
    expect(options.slice(0, used.length)).toEqual(used.map((move) => ({ id: move.id, weight: move.weight })));
    const rest = options.slice(used.length);
    expect(rest.every((option) => option.weight === null)).toBe(true);
    const names = rest.map((option) => runtime.movesById.get(option.id)!.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    for (const id of ["protect", "fakeout", "partingshot", "helpinghand", "willowisp", "taunt", "snarl", "roar"]) {
      expect(options.some((option) => option.id === id), id).toBe(true);
    }
    expect(editorMoveOptions("whimsicott", deps())[0]).toEqual({ id: "tailwind", weight: usage.species.whimsicott.moves[0].weight });
    expect(editorMoveOptions("clefable", deps()).slice(0, 1).map((option) => option.id)).toEqual(["followme"]);
  });

  it("leaves out what the validator does not allow and moves the catalog does not know; no usage row reads A–Z", () => {
    const legality = { ...catalogLegality(), legalMoves: (id: string) => [...runtime.speciesById.get(id)!.moves.filter((move) => move !== "throatchop"), "notamove", "protect"] };
    const options = editorMoveOptions("incineroar", deps(legality));
    expect(options.some((option) => option.id === "throatchop" || option.id === "notamove")).toBe(false);
    expect(options.filter((option) => option.id === "protect")).toHaveLength(1);
    const arbok = editorMoveOptions("arbok", deps());
    expect(arbok.every((option) => option.weight === null)).toBe(true);
    const names = arbok.map((option) => runtime.movesById.get(option.id)!.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(arbok.length).toBe(runtime.speciesById.get("arbok")!.moves.length);
  });
});

// ---------- The pinned Showdown validator (the SIM package once installed; until then the design probe bundle, when present) ----------
type Sim = {
  TeamValidator: new (format: string) => { validateTeam(team: unknown[]): string[] | null };
  Dex: { forFormat(format: string): { species: { get(name: string): { id: string; num: number; gender: string; abilities: Record<string, string> }; getMovePool(id: string): Iterable<string> } } };
};
const ROOT = new URL("../../", import.meta.url);
async function loadSimulator(): Promise<Sim | null> {
  const packageName = "@pokedrafts/showdown-sim";
  if (existsSync(new URL(`node_modules/${packageName}/package.json`, ROOT))) return (await import(/* @vite-ignore */ packageName)) as Sim;
  const probe = new URL("scripts/.cache/training/design/probe/out/showdown-sim.lite.min.mjs", ROOT);
  return existsSync(probe) ? (await import(/* @vite-ignore */ probe.href)) as Sim : null;
}
const sim = await loadSimulator();

describe.skipIf(!sim)("with the pinned Reg M-C TeamValidator", () => {
  const FORMAT = "gen9championsvgc2026regmc";
  const ignoreTeamSize = (problem: string) => !/at least 6|Min Team Size|You must bring/i.test(problem);
  const validator = sim ? new sim.TeamValidator(FORMAT) : null!;
  const dex = sim ? sim.Dex.forFormat(FORMAT) : null!;
  /** SPEC 7.5's adapter: a Mega form is sent as its base species holding its stone with the base's usual ability; gender fixed. */
  function toShowdownSet(set: SetFields) {
    const species = runtime.speciesById.get(set.speciesId)!;
    let name = species.name, itemId = set.itemId, abilityId = set.abilityId;
    const mega = megaEntries(set.speciesId, runtime)[0];
    if (mega) {
      const base = runtime.speciesById.get(mega.baseSpeciesId)!;
      name = base.name; itemId = mega.itemId; abilityId = usualAbility(base.id, "Doubles", runtime) ?? base.abilities[0];
    }
    const gender = dex.species.get(name).gender;
    return {
      name, species: name, item: itemId ? runtime.itemsById.get(itemId)!.name : "", ability: runtime.abilitiesById.get(abilityId)?.name ?? abilityId,
      moves: set.moves.map((id) => runtime.movesById.get(id)!.name), nature: set.nature, evs: { ...set.points },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: ["M", "F", "N"].includes(gender) ? gender : "M",
    };
  }
  const legal = new Map<string, string[]>();
  const legality: SetLegality = {
    legalMoves(speciesId) {
      if (!legal.has(speciesId)) {
        const sent = toShowdownSet({ speciesId, moves: [], itemId: runtime.speciesById.get(speciesId)!.requiredItem ?? "", abilityId: "", nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
        const shown = dex.species.get(sent.species);
        // One-move sets with Showdown's ability slot 0 (the gate's checks), so an ability never hides a learnable move.
        legal.set(speciesId, [...dex.species.getMovePool(shown.id)].filter((move) =>
          !(validator.validateTeam([{ ...sent, ability: Object.values(shown.abilities)[0], moves: [move] }]) ?? []).filter(ignoreTeamSize).length));
      }
      return legal.get(speciesId)!;
    },
    problems: (set) => (validator.validateTeam([toShowdownSet(set)]) ?? []).filter(ignoreTeamSize),
  };

  it("its legal moves are the catalog's proven learnset, and every form's suggested set validates alone", () => {
    const failures: string[] = [];
    for (const id of FORMS) {
      expect([...legality.legalMoves(id)].sort(), id).toEqual([...runtime.speciesById.get(id)!.moves].sort());
      const set = suggestTrainingSets([member(id)], deps(legality))[0];
      const problems = legality.problems(set);
      if (problems.length) failures.push(`${id}: ${problems.join(" ")}`);
    }
    expect(failures).toEqual([]);
    expect(suggestTrainingSets([member("incineroar")], deps(legality))[0]).toEqual(suggestOne("incineroar"));
  }, 60_000);

  it("teams of six suggested sets validate as teams (Species Clause, Item Clause)", () => {
    const failures: string[] = [];
    const num = (each: string) => dex.species.get(toShowdownSet({ speciesId: each, moves: [], itemId: "", abilityId: "", nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }).species).num;
    const teams = teamsOfSix(num);
    for (const team of teams) {
      const problems = validator.validateTeam(suggestTrainingSets(team.map((each) => member(each)), deps(legality)).map(toShowdownSet)) ?? [];
      if (problems.length) failures.push(`${team.join(",")}: ${problems.join(" ")}`);
    }
    expect(teams.length).toBeGreaterThanOrEqual(75);
    expect(failures).toEqual([]);
  }, 60_000);
});
