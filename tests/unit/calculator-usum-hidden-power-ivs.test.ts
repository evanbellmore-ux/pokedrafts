import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { chosenBuild } from "@/app/(app)/calculator/PokemonChooser";
import {
  activateMoveSlot, applyTeamPaste, changeTeamSource, createMatchup, getMoveOwner, getRosterPanel, getTeamPanel, getTeamSourceOwner,
  reconcileRosters, replaceMatchupMove, selectRosterPokemon, toggleMatchupMega, updateMatchupBuild, type PreparedMatchup,
} from "@/app/(app)/calculator/roster-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { HIDDEN_POWER_IVS, HIDDEN_POWER_TYPES, hiddenPowerType } from "@/app/lib/battle/mechanics";
import { createBuild, getBuildStats, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility, withHiddenPowerIVs } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild, NativeBuild } from "@/app/lib/battle/types";

/**
 * A fresh USUM build whose Random Battle quick moves include a typed Hidden Power takes that type's IVs
 * (pinned Showdown data/typechart.ts HPivs, which its team validator fills in below level 100), so the
 * suggestion calculates. Expected ranges are real pinned-Showdown
 * gen 7 battles, 16 fixed rolls, Singles (audit gaps/usum-typed-hp real.ts, real.out).
 */
let us: BattleRuntime;
beforeAll(async () => { us = await loadBattleRuntime("ultra_sun_ultra_moon"); });
const singles = (m: PreparedMatchup): PreparedMatchup => ({ ...m, field: { ...m.field, gameType: "Singles", multipleTargets: false } });
const picked = (id: string) => updateMatchupBuild(singles(createMatchup(0, us)), "attacker", chosenBuild(id, us, "Singles"));
const foe = (id: string) => withUsualAbility(createBuild(id, us), usualAbility(id, "Singles", us));
const ivs = (build: BattleBuild) => (build as NativeBuild).native.ivs;
const range = (m: PreparedMatchup, moveId: string, defender: string, build = m.attacker.build) => {
  const row = calculateMatchup(build, foe(defender), m.field, {}, us).results.find((entry) => entry.moveId === moveId)!;
  return row.kind === "calculated" ? `${row.min}-${row.max}` : row.kind;
};

describe("Hidden Power IVs for USUM quick moves", () => {
  it("has each type's Showdown HPivs, which give that type", () => {
    for (const type of HIDDEN_POWER_TYPES) {
      expect(hiddenPowerType({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...HIDDEN_POWER_IVS[type] }), type).toBe(type);
    }
    expect(HIDDEN_POWER_IVS.Ground).toEqual({ spa: 30, spd: 30 });
    expect(HIDDEN_POWER_IVS.Ice).toEqual({ atk: 30, def: 30 });
    expect(HIDDEN_POWER_IVS.Fire).toEqual({ atk: 30, spa: 30, spe: 30 });
  });

  it("gives a hand-picked form its row's Hidden Power IVs, so the quick move calculates as in Showdown", () => {
    const magnezone = picked("magnezone");
    expect(magnezone.attacker.moves[3]).toMatchObject({ moveId: "hiddenpowerground", origin: "randomBattle" });
    expect(ivs(magnezone.attacker.build)).toEqual({ hp: 31, atk: 31, def: 31, spa: 30, spd: 30, spe: 31 });
    expect(magnezone.notice).toBe("Your Pokémon Magnezone: IVs set for its suggested Hidden Power Ground (30 Sp. Atk, Sp. Def).");
    // Level 50 with no EVs: no stat changes.
    expect(getBuildStats(magnezone.attacker.build, us)).toEqual(getBuildStats(chosenBuild("magnezone", us, "Singles"), us));
    // Its usual Analytic (from its Random Battle sets) boosts: Magnezone is slower than both targets.
    expect(magnezone.attacker.build.abilityId).toBe("analytic");
    expect(range(magnezone, "hiddenpowerground", "heatran")).toBe("140-168");
    expect(range(magnezone, "hiddenpowerground", "blastoise")).toBe("36-43");
    expect(range(picked("sceptile"), "hiddenpowerice", "garchomp")).toBe("112-132");
    expect(range(picked("latios"), "hiddenpowerfire", "scizor")).toBe("136-164");
    expect(range(picked("jolteon"), "hiddenpowerice", "garchomp")).toBe("112-136");
    expect(range(picked("persianalola"), "hiddenpowerfighting", "bisharp")).toBe("96-116");
    // Before the fix every one of these was Needs context.
    expect(range(singles(createMatchup(0, us)), "hiddenpowerground", "heatran", { ...chosenBuild("magnezone", us, "Singles"), preparedMoves: ["hiddenpowerground"] })).toBe("needs-context");
  });

  it("keeps the IVs through later edits, where a 30 IV costs a point as it does in Showdown", () => {
    let m = picked("magnezone");
    const build = m.attacker.build as NativeBuild;
    m = updateMatchupBuild(m, "attacker", { ...build, nature: "Modest", native: { ...build.native, evs: { ...build.native.evs, spa: 252, spe: 252 } } });
    expect(ivs(m.attacker.build)).toMatchObject({ spa: 30, spd: 30 });
    expect(getBuildStats(m.attacker.build, us)!.spa).toBe(199);
    expect(range(m, "hiddenpowerground", "heatran")).toBe("144-172");
    // Replacing the suggestion does not rewrite the IVs.
    m = activateMoveSlot(m, getMoveOwner(m.attacker), 3);
    m = replaceMatchupMove(m, m.replacement!, "discharge");
    expect(ivs(m.attacker.build)).toMatchObject({ spa: 30, spd: 30 });
  });

  it("gives a fresh league pick the IVs, and restores its session edits unchanged", () => {
    const state: CalculatorRosterState = {
      status: "ready", userId: "user", selectedLeagueId: "league", opponentId: "other",
      leagues: [{ id: "league", name: "L", memberId: "own", teamName: "Home", draftStarted: true, draftCompleted: true }],
      teamsStatus: "ready", message: null, teamsMessage: null,
      data: {
        leagueId: "league",
        members: [{ id: "own", role: "coach", team_name: "Home", draft_position: 1 }, { id: "other", role: "coach", team_name: "Away", draft_position: 2 }],
        teams: [
          { id: "t1", member_id: "own", total_points: 30, team_name: null, role: null, pokemon: [{ name: "Magnezone", points: 15, tier: 1, pick_number: 1, acquired: "draft" }, { name: "Garchomp", points: 15, tier: 1, pick_number: 2, acquired: "draft" }] },
          { id: "t2", member_id: "other", total_points: 15, team_name: null, role: null, pokemon: [{ name: "Heatran", points: 15, tier: 1, pick_number: 1, acquired: "draft" }] },
        ],
      },
    };
    const [magnezone, garchomp] = getRosterPanel(state, "own", us).choices;
    let m = selectRosterPokemon(reconcileRosters(singles(createMatchup(0, us)), state), "attacker", magnezone);
    expect(ivs(m.attacker.build)).toMatchObject({ spa: 30, spd: 30 });
    expect(m.notice).toContain("Default build loaded. IVs set for its suggested Hidden Power Ground (30 Sp. Atk, Sp. Def). Field settings are unchanged");
    const build = m.attacker.build as NativeBuild;
    m = updateMatchupBuild(m, "attacker", { ...build, native: { ...build.native, ivs: { ...build.native.ivs, spa: 31, spd: 31 } } });
    m = selectRosterPokemon(m, "attacker", garchomp);
    expect(ivs(m.attacker.build)).toEqual(ivs(createBuild("garchomp", us)));
    m = selectRosterPokemon(m, "attacker", magnezone);
    expect(ivs(m.attacker.build)).toMatchObject({ spa: 31, spd: 31 });
    expect(m.notice).toContain("Your session build edits were restored.");
  });

  it("never rewrites imported IVs", () => {
    const text = "Magnezone\nAbility: Magnet Pull\nLevel: 50\n- Thunderbolt\n- Hidden Power [Ground]";
    const team = parseTeamImport(text, "traditional", us);
    let m = changeTeamSource(singles(createMatchup(0, us)), getTeamSourceOwner(createMatchup(0, us), "own"), "paste");
    m = applyTeamPaste(m, getTeamSourceOwner(m, "own"), { text, title: "t", url: null, team });
    m = selectRosterPokemon(m, "attacker", getTeamPanel(m, { ...({} as CalculatorRosterState), status: "loading" } as CalculatorRosterState, "own").choices[0]);
    expect(m.attacker.moves.map((slot) => slot.origin)).toEqual(["imported", "imported", "empty", "empty"]);
    expect(ivs(m.attacker.build)).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  it("changes only a fresh USUM build below level 100 with all-31 IVs and a Random Battle typed Hidden Power", async () => {
    const moves = createMoveSlots("magnezone", "Singles", us);
    const fresh = chosenBuild("magnezone", us, "Singles") as NativeBuild;
    expect(ivs(withHiddenPowerIVs(fresh, moves, us))).toMatchObject({ spa: 30, spd: 30 });
    for (const build of [
      { ...fresh, native: { ...fresh.native, ivs: { ...fresh.native.ivs, spe: 0 } } },
      { ...fresh, native: { ...fresh.native, innateIVs: { ...fresh.native.ivs } } },
      { ...fresh, native: { ...fresh.native, level: 100 } },
      { ...fresh, configuration: { hiddenPowerType: "Dark" } },
    ]) expect(withHiddenPowerIVs(build, moves, us)).toBe(build);
    // Unown's last-resort Hidden Powers are not Random Battle rows; Garchomp has no Hidden Power.
    const unown = chosenBuild("unown", us, "Singles");
    expect(withHiddenPowerIVs(unown, createMoveSlots("unown", "Singles", us), us)).toBe(unown);
    const garchomp = chosenBuild("garchomp", us, "Singles");
    expect(withHiddenPowerIVs(garchomp, createMoveSlots("garchomp", "Singles", us), us)).toBe(garchomp);
    const ss = await loadBattleRuntime("sword_shield");
    const ssBuild = chosenBuild("magnezone", ss, "Singles");
    expect(withHiddenPowerIVs(ssBuild, moves, ss)).toBe(ssBuild);
    const champions = createBuild("charizard");
    expect(withHiddenPowerIVs(champions, moves, championsRuntime)).toBe(champions);
  });

  it("names the type the IVs give in the Hidden Power field", () => {
    const html = (build: BattleBuild) => renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build, runtime: us, issues: [], onChange: () => {}, hpInput: "", onHPChange: () => {}, editorRevision: 0,
    }));
    expect(html(picked("magnezone").attacker.build)).toContain("Determine from innate IVs (Ground)");
    expect(html(chosenBuild("garchomp", us, "Singles"))).toContain("Determine from innate IVs (Dark)");
  });

  it("keeps the IVs through Mega Evolution, with the quick moves", () => {
    let m = picked("manectric");
    expect(ivs(m.attacker.build)).toMatchObject({ atk: 30, def: 30 });
    m = updateMatchupBuild(m, "attacker", { ...m.attacker.build, itemId: "manectite" });
    m = toggleMatchupMega(m, getMoveOwner(m.attacker), "manectricmega");
    expect(m.attacker.build.speciesId).toBe("manectricmega");
    expect(ivs(m.attacker.build)).toMatchObject({ atk: 30, def: 30 });
    expect(range(m, "hiddenpowerice", "garchomp")).toBe("136-160");
  });

  it("gives every affected form a calculable Hidden Power slot on both formats", () => {
    const catalog = us.catalog;
    if (catalog.game === "champions") throw new Error("USUM catalog expected");
    const rows = catalog.randomBattle!.formats.Singles!.species;
    const affected = Object.entries(rows).filter(([, row]) => row.some((id) => id.startsWith("hiddenpower")));
    expect(affected.length).toBe(69);
    for (const gameType of ["Singles", "Doubles"] as const) {
      for (const [id] of affected) {
        let m = createMatchup(0, us);
        m = updateMatchupBuild({ ...m, field: { ...m.field, gameType } }, "attacker", chosenBuild(id, us, gameType));
        const slot = m.attacker.moves.find((entry) => entry.moveId?.startsWith("hiddenpower"))!;
        const row = calculateMatchup(m.attacker.build, m.defender.build, m.field, {}, us).results.find((entry) => entry.moveId === slot.moveId)!;
        // Analytic in Doubles (read from the Singles sets) asks for the turn order; that is not a Hidden Power gap.
        if (gameType === "Doubles" && m.attacker.build.abilityId === "analytic") expect(row.reason, id).toBe("Analytic: needs the Doubles turn order.");
        else expect(row.kind, `${gameType} ${id} ${slot.moveId}`).toBe("calculated");
        expect(getBuildStats(m.attacker.build, us), id).toEqual(getBuildStats(chosenBuild(id, us, gameType), us));
      }
    }
  });
});

describe("The Hidden Power IV notice", () => {
  it("names the team on every species change and clears when the new Pokémon gets no IVs", () => {
    let m = picked("magnezone");
    expect(m.notice).toMatch(/^Your Pokémon Magnezone: IVs set/);
    m = updateMatchupBuild(m, "defender", chosenBuild("magnezone", us, "Singles"));
    expect(m.notice).toMatch(/^The opponent's Pokémon Magnezone: IVs set/);
    m = updateMatchupBuild(m, "attacker", chosenBuild("garchomp", us, "Singles"));
    expect(m.notice).toBe("");
    // An edit that keeps the species leaves the notice alone.
    m = updateMatchupBuild(m, "defender", { ...m.defender.build, nature: "Modest" });
    expect(m.notice).toBe("");
  });
});

describe("Unown quick moves", () => {
  it("prepare base Hidden Power once, not typed copies a fresh build cannot use", () => {
    for (const id of ["unown", "unownb", "unownquestion"]) {
      expect(createMoveSlots(id, "Singles", us).map((slot) => `${slot.moveId}/${slot.origin}`)).toEqual(["hiddenpower/suggested", "null/empty", "null/empty", "null/empty"]);
    }
  });
});
