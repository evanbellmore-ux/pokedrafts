import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { BATTLE_GAMES } from "@/app/lib/battle/profiles";
import { resolveRosterName } from "@/app/lib/battle/roster-identity";
import { championsRuntime, resolveRuntimeSpecies, type BattleRuntime } from "@/app/lib/battle/runtime";
import { createSpeciesSearch } from "@/app/lib/battle/species-search";
import type { BattleGame } from "@/app/lib/battle/types";

type Row = { display_name: string };
const rows = JSON.parse(readFileSync(join(process.cwd(), "data/pokemon/pokemon.json"), "utf8")) as Row[];

const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of BATTLE_GAMES) runtimes[game] = await loadBattleRuntime(game);
});

const ids = (runtime: BattleRuntime, query: string) => createSpeciesSearch(runtime)(query).map((entry) => entry.id);

describe("roster spellings in the chooser", () => {
  it("finds any spelling the roster lookup accepts, that form first", () => {
    const search = createSpeciesSearch(championsRuntime);
    expect(search("Ninetales-Alolan")[0]?.id).toBe("ninetalesalola");
    expect(search("lycanroc-midday")[0]?.id).toBe("lycanroc");
    expect(search("Tauros-Paldea-Blaze-Breed")[0]?.id).toBe("taurospaldeablaze");
  });
});

describe("Change Pokémon search", () => {
  it.each(BATTLE_GAMES)("finds every Pool Builder name the %s roster lookup accepts", (game) => {
    const runtime = runtimes[game];
    const search = createSpeciesSearch(runtime);
    const missed: string[] = [];
    for (const row of rows) {
      const resolved = resolveRosterName(runtime, row.display_name);
      if (resolved.status !== "resolved") continue;
      if (!search(row.display_name).some((entry) => entry.id === resolved.speciesId)) missed.push(`${row.display_name} -> ${resolved.speciesId}`);
    }
    expect(missed).toEqual([]);
  });

  it("finds every exact catalog name and alias", () => {
    for (const game of BATTLE_GAMES) {
      const runtime = runtimes[game];
      const search = createSpeciesSearch(runtime);
      for (const entry of runtime.catalog.species) {
        expect(search(entry.name).some((match) => match.id === entry.id), `${game}: ${entry.name}`).toBe(true);
      }
    }
  });

  it("finds the 20 Reg M-C names the audit could not find", () => {
    const cases: [string, string][] = [
      ["Alolan Raichu", "raichualola"], ["Alolan Persian", "persianalola"],
      ["Galarian Slowbro", "slowbrogalar"], ["Galarian Slowking", "slowkinggalar"], ["Galarian Stunfisk", "stunfiskgalar"],
      ["Hisuian Arcanine", "arcaninehisui"], ["Hisuian Typhlosion", "typhlosionhisui"], ["Hisuian Samurott", "samurotthisui"],
      ["Hisuian Zoroark", "zoroarkhisui"], ["Hisuian Goodra", "goodrahisui"], ["Hisuian Avalugg", "avalugghisui"],
      ["Hisuian Decidueye", "decidueyehisui"],
      ["Paldean Tauros (Combat Breed)", "taurospaldeacombat"], ["Paldean Tauros (Blaze Breed)", "taurospaldeablaze"],
      ["Paldean Tauros (Aqua Breed)", "taurospaldeaaqua"], ["Floette (Eternal Flower)", "floetteeternal"],
      ["Meowstic (Female)", "meowsticf"], ["Mega Meowstic (Female)", "meowsticfmega"],
      ["Indeedee (Female)", "indeedeef"], ["Basculegion (Female)", "basculegionf"],
    ];
    for (const [query, id] of cases) expect(ids(championsRuntime, query), query).toContain(id);
  });

  it("keeps search a filter: words narrow results and never add unrelated forms", () => {
    expect(ids(championsRuntime, "Alolan Raichu")).toEqual(["raichualola"]);
    expect(ids(championsRuntime, "raichu")).toEqual(["raichu", "raichualola", "raichumegax", "raichumegay"]);
    expect(ids(championsRuntime, "Charizard Mega")).toEqual(["charizardmegax", "charizardmegay"]);
    expect(ids(championsRuntime, "breed")).toEqual(["taurospaldeaaqua", "taurospaldeablaze", "taurospaldeacombat"]);
    const alolan = ids(championsRuntime, "Alolan");
    expect(alolan.length).toBeGreaterThan(0);
    expect(alolan.every((id) => id.includes("alola"))).toBe(true);
    const female = ids(championsRuntime, "female");
    expect(female).toEqual(expect.arrayContaining(["meowsticf", "meowsticfmega", "indeedeef", "basculegionf"]));
    expect(female.every((id) => championsRuntime.speciesById.get(id)!.name.match(/-F(?:-|$)/))).toBe(true);
    expect(ids(championsRuntime, "   ")).toHaveLength(championsRuntime.catalog.species.length);
    expect(ids(championsRuntime, "zzzz")).toEqual([]);
    // Only punctuation or a non-Latin script leaves no word to match.
    for (const query of ["-", "(", "ピカチュウ"]) expect(ids(championsRuntime, query)).toEqual([]);
  });

  it("separates male and female forms, although \"male\" is inside \"female\"", () => {
    expect(ids(championsRuntime, "Meowstic Male")).toEqual(["meowstic", "meowsticmmega"]);
    expect(ids(championsRuntime, "Meowstic (Male)")).toEqual(["meowstic", "meowsticmmega"]);
    expect(ids(championsRuntime, "Mega Meowstic Male")).toEqual(["meowsticmmega"]);
    expect(ids(championsRuntime, "Indeedee Male")).toEqual(["indeedee"]);
    expect(ids(championsRuntime, "Basculegion Male")).toEqual(["basculegion"]);
    expect(ids(championsRuntime, "Meowstic Female")).toEqual(["meowsticf", "meowsticfmega"]);
    expect(ids(runtimes.scarlet_violet, "Oinkologne Male")).toEqual(["oinkologne"]);
    expect(ids(runtimes.ultra_sun_ultra_moon, "Nidoran Male")).toEqual(["nidoranm"]);
    expect(ids(runtimes.ultra_sun_ultra_moon, "Nidoran Female")).toEqual(["nidoranf"]);
  });

  it("finds the Pool Builder's Minior and Maushold forms without hiding Showdown's", () => {
    const sv = runtimes.scarlet_violet;
    expect(ids(sv, "Minior")).toEqual(expect.arrayContaining(["minior", "miniormeteor"]));
    expect(ids(championsRuntime, "Maushold")).toEqual(["maushold", "mausholdfour"]);
    // Search results are not identities: the resolvers still decide what a name means.
    expect(resolveRuntimeSpecies(sv, "Minior")).toEqual({ status: "resolved", speciesId: "minior" });
  });
});
