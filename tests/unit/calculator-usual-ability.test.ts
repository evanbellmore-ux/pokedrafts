import { describe, expect, it } from "vitest";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { chosenBuild } from "@/app/(app)/calculator/PokemonChooser";
import { createMatchup, getMoveOwner, toggleMatchupMega, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { createBuild, validateBuild, withUsualAbility } from "@/app/lib/battle/model";
import { usualAbility } from "@/app/lib/battle/move-defaults";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import { championsRuntime } from "@/app/lib/battle/runtime";

/**
 * A fresh build's usual ability: Champions usage (data/champions/move-usage.json abilities, per
 * format), a native game's pinned Random Battle sets (catalog randomBattle abilities, per format),
 * otherwise Showdown's first ability slot (catalog abilityOrder), never the sorted first.
 * League selection is covered in calculator-rosters.test.ts (a species-only Charizard row).
 */
describe("usualAbility", () => {
  it("follows Champions usage for each format", () => {
    expect(createBuild("arcanine").abilityId).toBe("flashfire");
    expect(usualAbility("arcanine", "Doubles")).toBe("intimidate");
    expect(usualAbility("arcanine", "Singles")).toBe("intimidate");
    expect(usualAbility("scizor", "Doubles")).toBe("technician");
    expect(usualAbility("kingambit", "Singles")).toBe("supremeoverlord");
    expect(usualAbility("kingambit", "Doubles")).toBe("defiant");
  });

  it("falls back to Showdown's first slot without usage", async () => {
    // Vivillon-Fancy has its own engine entry and no usage row of its own.
    expect(usualAbility("vivillonfancy", "Doubles")).toBe("shielddust");
    // A cosmetic form reads its family's row, as Smogon's statistics count it there.
    expect(usualAbility("alcremiecaramelswirl", "Doubles")).toBe(usualAbility("alcremie", "Doubles"));
    expect(usualAbility("garchomp", "Doubles", championsRuntime, { usage: false })).toBe("sandveil");
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(usualAbility("arcanine", "Doubles", sv)).toBe("intimidate");
    // A native form the Random Battle sets leave out (Litten, Axew), or with usage off, takes the first slot.
    expect(usualAbility("litten", "Singles", sv)).toBe("blaze");
    expect(usualAbility("axew", "Doubles", sv)).toBe("rivalry");
    expect(usualAbility("incineroar", "Singles", sv, { usage: false })).toBe("blaze");
  });

  it("follows a native game's Random Battle sets for each format", async () => {
    const [usum, swsh, sv] = await Promise.all((["ultra_sun_ultra_moon", "sword_shield", "scarlet_violet"] as const).map((game) => loadBattleRuntime(game)));
    // The generator's ability, not the first slot (Shell Armor, Rivalry, Swarm, Thick Fat, Blaze, Limber).
    expect(createBuild("cloyster", usum).abilityId).toBe("overcoat");
    expect(usualAbility("cloyster", "Singles", usum)).toBe("skilllink");
    expect(usualAbility("haxorus", "Singles", sv)).toBe("moldbreaker");
    expect(usualAbility("scizor", "Singles", swsh)).toBe("technician");
    expect(usualAbility("azumarill", "Doubles", sv)).toBe("hugepower");
    expect(usualAbility("incineroar", "Singles", sv)).toBe("intimidate");
    expect(usualAbility("ditto", "Singles", swsh)).toBe("imposter");
    // Scarlet/Violet Doubles reads its own sets; Gen 7 and 8 Doubles read their Singles sets.
    expect(usualAbility("haxorus", "Doubles", sv)).toBe("unnerve");
    expect(usualAbility("cloyster", "Doubles", usum)).toBe("skilllink");
    // A form one Scarlet/Violet file leaves out reads the other's, as its quick moves do.
    expect(usualAbility("greninja", "Doubles", sv)).toBe("protean");
    // Most generated wins (Magnezone: Analytic in 76% of USUM sets); a tie keeps the earlier slot (Sword/Shield
    // Inteleon's two keys give Torrent and Sniper equally).
    expect(usualAbility("magnezone", "Singles", usum)).toBe("analytic");
    expect(usualAbility("inteleon", "Singles", swsh)).toBe("torrent");
    // A Mega key's sets name its base form's ability, so the Mega keeps its only one.
    expect(usualAbility("charizardmegax", "Singles", usum)).toBe("toughclaws");
    // What a hand pick and the default pair get.
    expect(chosenBuild("cloyster", usum, "Doubles")).toMatchObject({ abilityId: "skilllink", abilityActive: false });
    expect(createMatchup(0, sv).attacker.build.abilityId).toBe(usualAbility("charizard", "Doubles", sv));
  });

  it("has every catalog form's abilities in slot order", async () => {
    for (const runtime of [championsRuntime, ...await Promise.all((["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const).map((game) => loadBattleRuntime(game)))]) {
      for (const species of runtime.catalog.species) {
        expect([...(species.abilityOrder ?? [])].sort(), `${runtime.profile.id} ${species.id}`).toEqual(species.abilities);
      }
    }
  });

  it("is what a hand pick, a Mega's return to base and the default pair get", async () => {
    expect(chosenBuild("charizard", championsRuntime, "Doubles").abilityId).toBe("solarpower");
    expect(chosenBuild("charizard", championsRuntime, "Singles").abilityId).toBe("blaze");
    expect(chosenBuild("kingambit", championsRuntime, "Singles").abilityId).toBe("supremeoverlord");
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(createBuild("blastoise", usum).abilityId).toBe("raindish");
    expect(chosenBuild("blastoise", usum, "Doubles").abilityId).toBe("torrent");
    // A Mega chosen directly returns to its base with the usual ability.
    let current = updateMatchupBuild(createMatchup(0), "attacker", chosenBuild("charizardmegay", championsRuntime, "Doubles"));
    current = toggleMatchupMega(current, getMoveOwner(current.attacker), "charizardmegay");
    expect(current.attacker.build).toMatchObject({ speciesId: "charizard", abilityId: "solarpower" });
    let native = updateMatchupBuild(createMatchup(0, usum), "attacker", chosenBuild("blastoisemega", usum, "Doubles"));
    native = toggleMatchupMega(native, getMoveOwner(native.attacker), "blastoisemega");
    expect(native.attacker.build).toMatchObject({ speciesId: "blastoise", abilityId: "torrent" });
    // The default pair follows the same rule.
    expect(createMatchup(0).attacker.build.abilityId).toBe("solarpower");
    expect(createMatchup(0, usum).defender.build.abilityId).toBe("torrent");
  });

  it("keeps Protean's activation and Maushold-Four's shared usage row", () => {
    const meowscarada = withUsualAbility(createBuild("meowscarada"), usualAbility("meowscarada", "Singles"));
    expect(meowscarada).toMatchObject({ abilityId: "protean", abilityActive: true });
    expect(validateBuild(meowscarada).filter((issue) => issue.field === "abilityActive")).toEqual([]);
    expect(usualAbility("mausholdfour", "Singles")).toBe("technician");
  });

  it("fills an omitted ability in a paste with Showdown's first slot", () => {
    const team = parseTeamImport("Garchomp\n- Earthquake", "champions");
    expect(team.members[0].build?.abilityId).toBe("sandveil");
    expect(team.members[0].diagnostics.some((entry) => entry.message.includes("Ability omitted: using Sand Veil, the form's first ability"))).toBe(true);
  });
});
