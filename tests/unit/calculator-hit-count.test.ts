import { createElement, type ChangeEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { MoveDetails } from "@/app/(app)/calculator/MoveResults";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import * as selectControl from "@/app/components/ui/Select";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { checksAccuracyPerHit, hitCountRule } from "@/app/lib/battle/hit-count";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94's real move pipeline (field-core ref.ts with
 * the hit count forced), level 50, 0 Stat Points/EVs, 31 IVs, Serious nature, Singles, no crit.
 * Each hit after the first normally checks accuracy again and stops the move on a miss.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, context?: MoveContext, runtime: BattleRuntime = championsRuntime, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const garchomp = build("garchomp", "sandveil");

describe("moves that check accuracy for every hit", () => {
  it("marks exactly Triple Kick, Triple Axel and Population Bomb in every game", async () => {
    for (const runtime of [championsRuntime, ...await Promise.all((["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const).map((game) => loadBattleRuntime(game)))]) {
      const marked = [...runtime.movesById.values()].filter((move) => checksAccuracyPerHit(move, runtime)).map((move) => move.id).sort();
      const expected = ["populationbomb", "tripleaxel", "triplekick"].filter((id) => runtime.movesById.has(id));
      expect(marked, runtime.profile.id).toEqual(expected);
    }
  });

  it.each<[number | undefined, number, number, number]>([
    [undefined, 10, 150, 180],
    [1, 1, 15, 18],
    [5, 5, 75, 90],
    [9, 9, 135, 162],
    [10, 10, 150, 180],
  ])("Population Bomb with hits %s: %s hits, %s-%s", (hits, count, min, max) => {
    const maushold = build("mausholdfour", "technician");
    expect(row("populationbomb", maushold, garchomp, hits === undefined ? undefined : { hits })).toMatchObject({ kind: "calculated", hits: count, min, max });
  });

  it.each<[number | undefined, number, number, number]>([
    [undefined, 3, 340, 412],
    [1, 1, 60, 72],
    [2, 2, 172, 208],
    [3, 3, 340, 412],
  ])("Triple Axel with hits %s follows its 20/40/60 power: %s hits, %s-%s", (hits, count, min, max) => {
    expect(row("tripleaxel", build("weavile", "pressure"), garchomp, hits === undefined ? undefined : { hits })).toMatchObject({ kind: "calculated", hits: count, min, max });
  });

  it("explains the assumed count and gives one hit an ordinary KO chance", () => {
    const weavile = build("weavile", "pressure");
    expect(row("tripleaxel", weavile, garchomp).assumptions)
      .toContain("Triple Axel: all 3 hits land.");
    const one = row("tripleaxel", weavile, garchomp, { hits: 1 });
    expect(one.assumptions).toContain("Triple Axel: 1 of 3 hits land.");
    expect(one.ohkoChance).toBe(0);
    expect(row("tripleaxel", weavile, garchomp).ohkoChance).toBeNull();
  });

  it("asks again for a count outside 1 to the maximum", () => {
    expect(row("tripleaxel", build("weavile", "pressure"), garchomp, { hits: 4 })).toMatchObject({ kind: "needs-context", reason: "Needs the hit count (1–3)." });
  });

  it("fixes all hits with Skill Link, and with Loaded Dice except Population Bomb", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const svGarchomp = build("garchomp", "sandveil", sv);
    const cinccino = build("cinccino", "skilllink", sv);
    const skillLink = row("tripleaxel", cinccino, svGarchomp, { hits: 1 }, sv);
    expect(skillLink).toMatchObject({ kind: "calculated", hits: 3, min: 188, max: 228 });
    expect(skillLink.assumptions).toContain("Skill Link: all 3 hits land.");
    const diceAxel = row("tripleaxel", build("weavile", "pressure", sv, { itemId: "loadeddice" }), svGarchomp, { hits: 1 }, sv);
    expect(diceAxel).toMatchObject({ kind: "calculated", hits: 3, min: 340, max: 412 });
    // Loaded Dice makes Population Bomb hit 4-10 times at random, so a count must be chosen.
    const diceMaushold = build("maushold", "technician", sv, { itemId: "loadeddice" });
    expect(row("populationbomb", diceMaushold, svGarchomp, undefined, sv)).toMatchObject({ kind: "needs-context", reason: "Needs the hit count (4–10)." });
    expect(row("populationbomb", diceMaushold, svGarchomp, { hits: 3 }, sv).kind).toBe("needs-context");
    expect(row("populationbomb", diceMaushold, svGarchomp, { hits: 6 }, sv)).toMatchObject({ kind: "calculated", hits: 6, min: 90, max: 108 });
    expect(hitCountRule(sv.movesById.get("populationbomb")!, { abilityId: "skilllink", itemId: "loadeddice" }, sv)).toMatchObject({ kind: "choose", min: 4, max: 10 });
  });

  it("switches Loaded Dice off under Magic Room and Skill Link off under Neutralizing Gas", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const svGarchomp = build("garchomp", "sandveil", sv);
    const magicRoom = { magicRoom: true };
    // Suppressed Loaded Dice: Population Bomb is back to 1-10 hits with all 10 by default.
    const diceMaushold = build("maushold", "technician", sv, { itemId: "loadeddice" });
    const bomb = row("populationbomb", diceMaushold, svGarchomp, undefined, sv, magicRoom);
    expect(bomb).toMatchObject({ kind: "calculated", hits: 10, min: 150, max: 180 });
    expect(bomb.assumptions.some((line) => line.includes("Loaded Dice"))).toBe(false);
    expect(row("populationbomb", diceMaushold, svGarchomp, { hits: 1 }, sv, magicRoom)).toMatchObject({ kind: "calculated", hits: 1, min: 15, max: 18 });
    expect(row("tripleaxel", build("weavile", "pressure", sv, { itemId: "loadeddice" }), svGarchomp, { hits: 1 }, sv, magicRoom)).toMatchObject({ kind: "calculated", hits: 1, min: 60, max: 72 });
    // 2-5 hit moves too: suppressed Loaded Dice allows 2 hits again.
    const diceBreloom = build("breloom", "technician", sv, { itemId: "loadeddice" });
    expect(row("bulletseed", diceBreloom, svGarchomp, { hits: 2 }, sv).kind).toBe("needs-context");
    expect(row("bulletseed", diceBreloom, svGarchomp, { hits: 2 }, sv, magicRoom)).toMatchObject({ kind: "calculated", hits: 2 });
    // Neutralizing Gas suppresses Skill Link unless Ability Shield protects it.
    const weezing = build("weezing", "neutralizinggas", sv);
    expect(row("tripleaxel", build("cinccino", "skilllink", sv), weezing, { hits: 1 }, sv)).toMatchObject({ kind: "calculated", hits: 1 });
    expect(row("tripleaxel", build("cinccino", "skilllink", sv, { itemId: "abilityshield" }), weezing, { hits: 1 }, sv)).toMatchObject({ kind: "calculated", hits: 3 });
  });

  it("matches Triple Kick in the older games", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const hitmontop = build("hitmontop", "technician", usum);
    const snorlax = build("snorlax", "thickfat", usum);
    const one = row("triplekick", hitmontop, snorlax, { hits: 1 }, usum);
    const three = row("triplekick", hitmontop, snorlax, undefined, usum);
    expect(one).toMatchObject({ kind: "calculated", hits: 1 });
    expect(three).toMatchObject({ kind: "calculated", hits: 3 });
    expect(three.min!).toBeGreaterThan(one.min! * 3);
  });
});

describe("hit-count editor for these moves", () => {
  const render = (moveId: string, abilityId: string, itemId = "", context?: MoveContext, runtime: BattleRuntime = championsRuntime) =>
    renderToStaticMarkup(createElement(MoveDetails, { runtime, moveId, id: "details", context, abilityId, itemId, onContextChange: vi.fn() }));

  it("offers 1 hit to the maximum with every hit selected by default", () => {
    const html = render("populationbomb", "technician");
    expect(html).toContain('id="details-hits"');
    expect(html).toContain('<option value="1">1 hit</option>');
    expect(html).toMatch(/<option value="10" selected="">10 hits \(all\)<\/option>/);
    expect(html).not.toContain("Choose hit count");
    expect(render("tripleaxel", "pressure", "", { hits: 2 })).toMatch(/<option value="2" selected="">2 hits<\/option>/);
  });

  it("explains fixed counts and the Loaded Dice Population Bomb choice", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const skillLink = render("tripleaxel", "skilllink", "", undefined, sv);
    expect(skillLink).not.toContain("<select");
    expect(skillLink).toContain("Skill Link: all 3 hits land.");
    const dice = render("populationbomb", "technician", "loadeddice", undefined, sv);
    expect(dice).toContain("Choose hit count");
    expect(dice).toContain('<option value="4">4 hits</option>');
    expect(dice).not.toContain('<option value="3">');
    expect(dice).toContain("Loaded Dice limits this choice to 4–10 hits.");
  });

  it("keeps the default count implicit when it is picked", () => {
    const selects = vi.spyOn(selectControl, "default");
    try {
      const onContextChange = vi.fn();
      renderToStaticMarkup(createElement(MoveDetails, { runtime: championsRuntime, moveId: "tripleaxel", id: "details", context: undefined, abilityId: "pressure", itemId: "", onContextChange }));
      const [select] = selects.mock.calls[0];
      select.onChange!({ target: { value: "2" } } as ChangeEvent<HTMLSelectElement>);
      select.onChange!({ target: { value: "3" } } as ChangeEvent<HTMLSelectElement>);
      expect(onContextChange.mock.calls).toEqual([[{ hits: 2 }], [{ hits: undefined }]]);
    } finally {
      selects.mockRestore();
    }
  });

  it("follows the suppression in the editor", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const html = renderToStaticMarkup(createElement(MoveDetails, { runtime: sv, moveId: "populationbomb", id: "details", context: undefined, abilityId: "technician", itemId: "loadeddice", onContextChange: vi.fn(), hitBattle: { magicRoom: true } }));
    expect(html).toMatch(/<option value="10" selected="">10 hits \(all\)<\/option>/);
    expect(html).not.toContain("Loaded Dice limits");
    const gas = renderToStaticMarkup(createElement(MoveDetails, { runtime: sv, moveId: "tripleaxel", id: "details", context: undefined, abilityId: "skilllink", itemId: "", onContextChange: vi.fn(), hitBattle: { opponentAbilityId: "neutralizinggas" } }));
    expect(gas).toContain('<option value="1">1 hit</option>');
    expect(gas).not.toContain("Skill Link: all");
  });

  it("does not offer a count for fixed multi-hit moves", () => {
    expect(render("dragondarts", "clearbody")).not.toContain("<select");
    expect(render("doublehit", "technician")).not.toContain("<select");
  });
});

describe("Set hits prompts", () => {
  function results(runtime: BattleRuntime, attacker: BattleBuild, moveId: string, result: MoveDamageResult) {
    return renderToStaticMarkup(createElement(MoveResults, {
      rows: [result], moveIds: [moveId], ownerId: "0:0", sourcePosition: "left", selectedMoveId: null, onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: attacker.abilityId, itemId: attacker.itemId, attackerName: "Attacker", defenderName: "Defender",
      defenderHP: 100, runtime, sourceBuild: attacker,
    }));
  }
  function summary(runtime: BattleRuntime, attacker: BattleBuild, defender: BattleBuild, moveId: string, result: MoveDamageResult) {
    let matchup = createMatchup(0, runtime);
    matchup = updateMatchupBuild(matchup, "attacker", attacker);
    matchup = updateMatchupBuild(matchup, "defender", defender);
    matchup = selectMatchupMove(matchup, moveId);
    const view = getAttackView(matchup);
    return renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: result, rollMode: "average",
      issues: { attacker: validateBuild(matchup.attacker.build, runtime), defender: validateBuild(matchup.defender.build, runtime) },
      movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime,
    }));
  }

  it("asks for hits for Loaded Dice Population Bomb", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const maushold = build("maushold", "technician", sv, { itemId: "loadeddice" });
    const garchompSV = build("garchomp", "sandveil", sv);
    const result = row("populationbomb", maushold, garchompSV, undefined, sv);
    expect(result.kind).toBe("needs-context");
    expect(results(sv, maushold, "populationbomb", result)).toContain("Set hits");
    expect(summary(sv, maushold, garchompSV, "populationbomb", result)).toContain(">Set hits</button>");
  });

  it("does not ask for hits when a per-hit-accuracy move needs other context", () => {
    const weavile = build("weavile", "pressure");
    const mimikyu = build("mimikyu", "disguise");
    const result = row("tripleaxel", weavile, mimikyu);
    expect(result).toMatchObject({ kind: "needs-context", reason: "Intact Disguise takes the first hit." });
    expect(results(championsRuntime, weavile, "tripleaxel", result)).not.toContain("Set hits");
    const html = summary(championsRuntime, weavile, mimikyu, "tripleaxel", result);
    expect(html).not.toContain(">Set hits</button>");
    expect(html).toContain(">Show move</button>");
  });
});
