import { describe, expect, it } from "vitest";
import { rosterChoices } from "@/app/(app)/calculator/roster-prep";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, validateBuild } from "@/app/lib/battle/model";
import { resolveRosterSpecies } from "@/app/lib/battle/species-identity";
import { parseTeamImport } from "@/app/lib/battle/team-import";

/**
 * Cosmetic forms are their base Pokémon in battle: Vivillon patterns, Florges colours, Furfrou trims
 * and Alcremie-Salted-Cream (Alcremie's other forms are covered in champions-alcremie-forms). Champions,
 * level 50, 0 Stat Points, Serious nature, Singles, usual abilities. Damage matches pinned Showdown
 * c23d2e94 with the exact cosmetic species name (audit fix29/pins.ts; fix29/verify.ts sweeps every
 * cosmetic form in both directions).
 */
const cosmetic = (base: string) => champions.species.filter((row) => row.baseSpecies === base && row.id !== base);
const battleData = (row: object) => Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "name", "calcName"].includes(key)));

describe("cosmetic forms", () => {
  it("lists every source-declared pattern, colour and trim", () => {
    expect(cosmetic("vivillon")).toHaveLength(19);
    expect(cosmetic("florges").map((row) => row.name)).toEqual(["Florges-Blue", "Florges-Orange", "Florges-White", "Florges-Yellow"]);
    expect(cosmetic("furfrou").map((row) => row.id)).toEqual([
      "furfroudandy", "furfroudebutante", "furfroudiamond", "furfrouheart", "furfroukabuki", "furfroulareine", "furfroumatron", "furfroupharaoh", "furfroustar",
    ]);
    expect(speciesById.get("alcremiesaltedcream")?.name).toBe("Alcremie-Salted-Cream");
  });

  it.each(["vivillon", "florges", "furfrou", "alcremie"])("gives each %s form its base's battle data and calculations", (base) => {
    const parent = speciesById.get(base)!;
    const foe = createBuild("garchomp");
    for (const row of cosmetic(base)) {
      const { id, name, calcName } = row;
      expect(battleData(row), id).toEqual(battleData(parent));
      // Vivillon-Fancy and Vivillon-Pokeball have engine entries of their own; the rest use the base's.
      expect(calcName, id).toBe(["vivillonfancy", "vivillonpokeball"].includes(id) ? name : parent.calcName);
      expect(validateBuild(createBuild(id))).toEqual([]);
      const field = { ...createConditions(), gameType: "Singles" as const };
      const same = (build: ReturnType<typeof createBuild>) => ({ ...build, speciesId: base });
      expect(calculateMatchup(createBuild(id), foe, field).results).toEqual(calculateMatchup(same(createBuild(id)), foe, field).results);
      expect(calculateMatchup(foe, createBuild(id), field).results).toEqual(calculateMatchup(foe, same(createBuild(id)), field).results);
      expect(resolveRosterSpecies(name)).toEqual({ status: "resolved", speciesId: id });
    }
  });

  it("matches Showdown for the exact cosmetic identity", () => {
    const field = { ...createConditions(), gameType: "Singles" as const };
    const row = (attacker: string, defender: string, moveId: string) =>
      calculateMatchup(createBuild(attacker), createBuild(defender), field).results.find((result) => result.moveId === moveId);
    expect(row("vivillonjungle", "garchomp", "hurricane")).toMatchObject({ kind: "calculated", min: 66, max: 78 });
    expect(row("florgeswhite", "garchomp", "moonblast")).toMatchObject({ kind: "calculated", min: 134, max: 162 });
    // Furfrou-Heart keeps Fur Coat.
    expect(row("garchomp", "furfrouheart", "dragonclaw")).toMatchObject({ kind: "calculated", min: 43, max: 52 });
    expect(row("alcremiesaltedcream", "garchomp", "dazzlinggleam")).toMatchObject({ kind: "calculated", min: 114, max: 134 });
  });

  it("selects the exact form from roster names and pastes", () => {
    const [choice] = rosterChoices("league-a", {
      id: "team", member_id: "member", total_points: 15, team_name: null, role: null,
      pokemon: [{ name: "Furfrou Heart", points: 15, tier: 1, pick_number: 1, acquired: "draft" }],
    });
    expect(choice).toMatchObject({ speciesId: "furfrouheart", reason: null });
    const team = parseTeamImport("Florges-White @ Leftovers\nAbility: Flower Veil\nModest Nature\n- Moonblast\n- Protect", "champions");
    expect(team.diagnostics).toEqual([]);
    expect(team.members[0]).toMatchObject({ speciesId: "florgeswhite", selectable: true });
    expect(team.members[0].diagnostics.filter((entry) => entry.severity !== "info")).toEqual([]);
  });
});
