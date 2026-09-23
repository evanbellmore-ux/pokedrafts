import { describe, expect, it } from "vitest";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, getBuildStats, validateBuild } from "@/app/lib/battle/model";
import { createMoveSlots } from "@/app/lib/battle/move-defaults";
import { resolveRosterSpecies } from "@/app/lib/battle/species-identity";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import usage from "@/data/champions/move-usage.json";

// Independently enumerated from the pinned Showdown cosmetic declarations and
// Champions availability, not from the generator's engine mapping table.
const forms = [
  ["alcremiecaramelswirl", "Alcremie-Caramel-Swirl"],
  ["alcremielemoncream", "Alcremie-Lemon-Cream"],
  ["alcremiematchacream", "Alcremie-Matcha-Cream"],
  ["alcremiemintcream", "Alcremie-Mint-Cream"],
  ["alcremierainbowswirl", "Alcremie-Rainbow-Swirl"],
  ["alcremierubycream", "Alcremie-Ruby-Cream"],
  ["alcremierubyswirl", "Alcremie-Ruby-Swirl"],
] as const;
const base = speciesById.get("alcremie")!;

describe("Alcremie cosmetic engine identities", () => {
  it("keeps the exact available catalog without inventing absent forms", () => {
    expect(champions.species.filter((entry) => entry.baseSpecies === "alcremie").map((entry) => entry.id))
      .toEqual(["alcremie", ...forms.map(([id]) => id)]);
    expect(resolveRosterSpecies("Alcremie")).toEqual({ status: "resolved", speciesId: "alcremie" });
    for (const name of ["Alcremie-Salted-Cream", "Alcremie-Gmax", "Alcremie-Unknown"]) {
      expect(resolveRosterSpecies(name).status).toBe("unavailable");
    }
  });

  it.each(forms)("supports %s without changing its catalog identity or battle data", (id, name) => {
    const species = speciesById.get(id)!;
    expect(species).toEqual({ ...base, id, name });
    expect(species.calcName).toBe("Alcremie");
    expect(species.unsupported).toEqual([]);
    for (const alias of [id, name, name.replaceAll("-", " ").toUpperCase()]) {
      expect(resolveRosterSpecies(alias)).toEqual({ status: "resolved", speciesId: id });
    }
    expect(validateBuild(createBuild(id))).toEqual([]);
    expect(getBuildStats(createBuild(id))).toEqual(getBuildStats(createBuild("alcremie")));
  });

  it.each(forms)("imports %s with its exact form, preparation and ordered moves", (id, name) => {
    for (const format of ["champions", "traditional"] as const) {
      const text = `${name} @ Leftovers\nAbility: Sweet Veil\nEVs: ${format === "champions" ? "1 HP / 32 SpA / 32 Spe" : "4 HP / 252 SpA / 252 Spe"}\nModest Nature\n- Dazzling Gleam\n- Mystical Fire\n- Recover\n- Protect`;
      const team = parseTeamImport(text, format);
      expect(team.diagnostics).toEqual([]);
      expect(team.members).toHaveLength(1);
      const member = team.members[0];
      expect(member).toMatchObject({ name, speciesId: id, selectable: true });
      expect(member.build).toEqual({
        ...createBuild(id), abilityId: "sweetveil", itemId: "leftovers", nature: "Modest",
        points: { hp: 1, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      });
      expect(member.diagnostics.filter((entry) => entry.severity !== "info")).toEqual([]);
      expect(member.moves).toEqual(["dazzlinggleam", "mysticalfire", "recover", "protect"].map((moveId) => ({
        moveId, origin: "imported", gameType: null,
      })));
      const result = calculateMatchup(member.build!, createBuild("blastoise"), createConditions());
      expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
      expect(result.results.find((entry) => entry.moveId === "dazzlinggleam")?.kind).toBe("calculated");
    }
  });

  it.each(forms)("calculates %s identically to base in both directions without mutating preparation", (id) => {
    for (const abilityId of ["aromaveil", "sweetveil"]) {
      const prepared = {
        ...createBuild("alcremie"), abilityId, itemId: "leftovers", nature: "Modest",
        points: { hp: 32, atk: 0, def: 2, spa: 32, spd: 0, spe: 0 }, currentHP: 73,
      };
      prepared.boosts.spa = 1;
      prepared.boosts.spd = 1;
      const cosmetic = { ...structuredClone(prepared), speciesId: id };
      const before = structuredClone(cosmetic);
      for (const gameType of ["Singles", "Doubles"] as const) {
        const field = { ...createConditions(), gameType };
        const outgoing = calculateMatchup(cosmetic, createBuild("blastoise"), field);
        expect(outgoing.issues).toEqual({ attacker: [], defender: [], field: [] });
        expect(outgoing.results.find((entry) => entry.moveId === "dazzlinggleam")?.min).toBeGreaterThan(0);
        expect(outgoing).toEqual(calculateMatchup(prepared, createBuild("blastoise"), field));
        const incoming = calculateMatchup(createBuild("charizard"), cosmetic, field);
        expect(incoming.issues).toEqual({ attacker: [], defender: [], field: [] });
        expect(incoming.results.find((entry) => entry.moveId === "flamethrower")?.min).toBeGreaterThan(0);
        expect(incoming).toEqual(calculateMatchup(createBuild("charizard"), prepared, field));
      }
      expect(cosmetic).toEqual(before);
    }
  });

  it("does not inherit base-only species usage through a shared engine identity", () => {
    for (const gameType of ["Singles", "Doubles"] as const) {
      expect(usage.formats[gameType].species.alcremie).toHaveLength(4);
      expect(createMoveSlots("alcremie", gameType).every((slot) => slot.origin === "usage")).toBe(true);
      for (const [id] of forms) {
        expect(Object.hasOwn(usage.formats[gameType].species, id)).toBe(false);
        expect(createMoveSlots(id, gameType).every((slot) => slot.origin !== "usage")).toBe(true);
      }
    }
  });
});
