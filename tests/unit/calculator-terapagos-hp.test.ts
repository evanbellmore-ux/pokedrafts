// Terapagos's Tera toggle keeps the damage it has taken, as pinned Showdown c23d2e94 formeChange ->
// updateMaxHp does (real battles in audit oos/terapagos-hp/repro.ts, repro2.ts, fix-sim.ts).
import { beforeAll, describe, expect, it } from "vitest";
import * as rp from "@/app/(app)/calculator/roster-prep";
import { getBuildHealth, previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, validateBuild } from "@/app/lib/battle/model";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";

const { createMatchup, getMoveOwner, updateMatchupBuild, updateMatchupHP, toggleMatchupMechanic, swapMatchup, changeTeamSource, getTeamSourceOwner, applyTeamPaste, getTeamPanel, selectRosterPokemon } = rp;
let sv: BattleRuntime;
beforeAll(async () => { sv = await loadBattleRuntime("scarlet_violet"); });

function terapagos(spec: { id?: string; level?: number; hp?: number; hpIV?: number; nature?: string } = {}): BattleBuild {
  const b = createBuild(spec.id ?? "terapagos", sv);
  if (b.game === "champions") throw new Error("native");
  return { ...b, ...(spec.nature ? { nature: spec.nature } : {}), native: { ...b.native, level: spec.level ?? 50, evs: { ...b.native.evs, hp: spec.hp ?? 0 }, ivs: { ...b.native.ivs, hp: spec.hpIV ?? 31 } } } as BattleBuild;
}
function withHP(build: BattleBuild, text?: string) {
  let m = updateMatchupBuild(createMatchup(0, sv), "defender", build);
  if (text !== undefined) m = updateMatchupHP(m, "defender", text);
  return m;
}
const tera = (m: ReturnType<typeof createMatchup>, side: "attacker" | "defender" = "defender") => toggleMatchupMechanic(m, getMoveOwner(m[side]), "tera");

describe("Terapagos current HP across the Tera toggle (pinned Showdown updateMaxHp keeps the damage taken)", () => {
  it("keeps the damage taken when Terastallizing and back: 100/170 is 165/235", () => {
    const off = withHP(terapagos(), "100");
    const on = tera(off);
    expect(on.defender.build).toMatchObject({ mechanic: "tera", currentHP: 165 });
    expect(on.defender.hpInput).toBe("165");
    expect(getBuildHealth(on.defender.build, sv)).toEqual({ current: 165, maximum: 235 });
    // Showdown: Adamant 252 Atk Garchomp's Earthquake 87-103 into Terapagos-Stellar at 165/235 cannot KO.
    const garchomp = { ...createBuild("garchomp", sv), nature: "Adamant" } as BattleBuild;
    if (garchomp.game !== "champions") garchomp.native = { ...garchomp.native, evs: { ...garchomp.native.evs, atk: 252 } };
    const row = calculateMatchup(garchomp, on.defender.build, { ...createConditions(), gameType: "Singles" }, {}, sv).results.find((r) => r.moveId === "earthquake")!;
    expect([row.min, row.max, row.ohkoChance]).toEqual([87, 103, 0]);
    expect(previewRemainingHP(on.defender.build, row, "average", sv)).toMatchObject({ status: "ready", remaining: 70, maximum: 235 });
    expect(on.notice).toContain("165");
    const back = tera(on);
    expect(back.defender.build.mechanic).toBeUndefined();
    expect(back.defender.build.currentHP).toBe(100);
    expect(back.defender.hpInput).toBe("100");
  });

  it.each([
    ["", "", 235], ["170", "235", 235], ["169", "234", 234], ["1", "66", 66], ["00100", "165", 165],
  ])("Tera on from Terastal HP %j gives %j (Showdown %d/235)", (text, expected, hp) => {
    const on = tera(withHP(terapagos(), text));
    expect(on.defender.hpInput).toBe(expected);
    expect(getBuildHealth(on.defender.build, sv)).toEqual({ current: hp, maximum: 235 });
  });

  it.each([
    ["200", "135"], ["235", "170"], ["165", "100"], ["67", "2"], ["66", "1"], ["20", "1"], ["1", "1"],
  ])("Tera off from Stellar HP %j gives %j (Showdown formeChange to Terastal)", (text, expected) => {
    const stellar = updateMatchupHP(tera(withHP(terapagos())), "defender", text);
    const off = tera(stellar);
    expect(off.defender.hpInput).toBe(expected);
    expect(validateBuild(off.defender.build, sv)).toEqual([]);
  });

  it.each([
    [{ hp: 252, nature: "Bold" }, "150", 215, 267], [{ level: 100, hp: 252 }, "300", 430, 524],
    [{ level: 77, hp: 97, hpIV: 0 }, "123", 223, 351], [{ level: 1 }, "5", 6, 14], [{ id: "terapagosterastal" }, "100", 165, 235],
  ])("uses the build's own HP stats: %j at %s is %d/%d", (spec, text, hp, max) => {
    const on = tera(withHP(terapagos(spec), text));
    expect(getBuildHealth(on.defender.build, sv)).toEqual({ current: hp, maximum: max });
  });

  it.each(["abc", "12a", "1.5", "0", "-5", "200"])("leaves HP text %j that is not valid Terastal HP as typed", (text) => {
    const on = tera(withHP(terapagos(), text));
    expect(on.defender.hpInput).toBe(text);
  });

  it.each([["charizard", "00087"], ["ogerponhearthflame", "0100"], ["terapagosstellar", "200"]])("keeps the exact HP text of %s, whose maximum HP does not change", (id, text) => {
    const m = withHP(createBuild(id, sv), text);
    const on = tera(m);
    expect(on.defender.hpInput).toBe(text);
    expect(tera(on).defender.hpInput).toBe(text);
  });

  it("follows the Pokémon through Swap and its roster cache", () => {
    const swapped = swapMatchup(withHP(terapagos(), "100"));
    expect(tera(swapped, "attacker").attacker.hpInput).toBe("165");
    const text = "Terapagos\nAbility: Tera Shift\nLevel: 50\nTera Type: Stellar\n- Tera Starstorm\n\nGarchomp\nAbility: Rough Skin\n- Earthquake";
    let m = changeTeamSource(createMatchup(0, sv), getTeamSourceOwner(createMatchup(0, sv), "own"), "paste");
    m = applyTeamPaste(m, getTeamSourceOwner(m, "own"), { text, title: "t", url: null, team: parseTeamImport(text, "traditional", sv) });
    const state = createRosterState();
    const pick = (cur: typeof m, i: number) => selectRosterPokemon(cur, "attacker", getTeamPanel(cur, state, "own").choices[i]);
    m = updateMatchupHP(pick(m, 0), "attacker", "100");
    m = tera(m, "attacker");
    m = pick(pick(m, 1), 0);
    expect(m.attacker.build).toMatchObject({ speciesId: "terapagos", mechanic: "tera", currentHP: 165 });
    expect(m.attacker.hpInput).toBe("165");
  });
});
