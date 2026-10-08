import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { MoveDetails } from "@/app/(app)/calculator/MoveResults";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";

/** Fickle Beam's 30% doubled power against pinned Showdown c23d2e94 with randomChance forced each way. */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}
function row(defender: BattleBuild, runtime: BattleRuntime = championsRuntime, attacker = build("hydrapple", "regenerator", runtime)) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles" }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === "ficklebeam")!;
}

describe("Fickle Beam", () => {
  it("shows the doubled range and weighs it into the KO chance", () => {
    const full = row(build("garchomp", "roughskin"));
    expect(full).toMatchObject({ min: 120, max: 144, ohkoChance: 0.3, alternate: { chance: 0.3, min: 240, max: 284 } });
    expect(full.description).toContain(", or 240–284 HP (131.1–155.2%) when its power doubles (30% chance).");
    expect(full.assumptions).toContain("Fickle Beam: doubled power 30% of the time, 240–284 HP (131.1–155.2%). The KO chance includes both cases.");
    // 9 of 16 normal rolls and every doubled roll KO at 130 HP: 0.7 × 9/16 + 0.3.
    expect(row(build("garchomp", "roughskin", championsRuntime, { currentHP: 130 })).ohkoChance).toBeCloseTo(0.69375, 10);
    expect(row(build("garchomp", "roughskin", championsRuntime, { currentHP: 150 })).ohkoChance).toBeCloseTo(0.3, 10);
    expect(row(build("snorlax", "thickfat"))).toMatchObject({ min: 49, max: 58, alternate: { min: 97, max: 115 }, ohkoChance: 0 });
  });

  it("previews the doubled case beside the usual one", () => {
    const garchomp = build("garchomp", "roughskin");
    const preview = previewRemainingHP(garchomp, row(garchomp), "high");
    expect(preview).toMatchObject({ status: "ready", damage: 144, remaining: 39, alternate: { chance: 0.3, damage: 284, remaining: 0 } });
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row(garchomp)], moveIds: ["ficklebeam"], ownerId: "0:0", selectedMoveId: null, onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: "regenerator", itemId: "", attackerName: "Hydrapple", defenderName: "Garchomp", defenderHP: 183,
    }));
    expect(html).toContain("30% chance of doubled power: 240–284 HP (131.15–155.19% of max HP)");
    // Low uses the lowest doubled roll, Average the mean of the doubled rolls (Incineroar: 125, not the 126 midpoint).
    expect(previewRemainingHP(garchomp, row(garchomp), "low")).toMatchObject({ damage: 120, alternate: { damage: 240 } });
    const incineroar = build("incineroar", "blaze");
    expect(row(incineroar).alternate).toMatchObject({ min: 115, max: 136 });
    expect(previewRemainingHP(incineroar, row(incineroar), "average")).toMatchObject({ alternate: { damage: 125 } });
    const details = renderToStaticMarkup(createElement(MoveDetails, { moveId: "ficklebeam", row: row(garchomp), id: "d", context: {}, abilityId: "regenerator", itemId: "", onContextChange: vi.fn() }));
    expect(details).toContain("Damage rolls (usual power): 120,");
    expect(details).toContain("Damage rolls with doubled power (30% chance): 240,");
  });

  it("gives the doubled case in the summary, after the usual remaining HP", () => {
    const hydrapple = build("hydrapple", "regenerator");
    const garchomp = build("garchomp", "roughskin");
    let matchup = createMatchup(0, championsRuntime);
    matchup = updateMatchupBuild(matchup, "attacker", hydrapple);
    matchup = updateMatchupBuild(matchup, "defender", garchomp);
    matchup = selectMatchupMove(matchup, "ficklebeam");
    const view = getAttackView(matchup);
    const html = renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: row(garchomp), rollMode: "low",
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime,
    })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(html).toContain("120–144 damage range, or 240–284 with doubled power (30% chance) · One-use KO: 30% (all rolls, both cases)");
    expect(html).toMatch(/Garchomp HP remaining: 63 \/ 183 With doubled power \(30% chance, same Low roll\): 240 damage, 0 \/ 183 HP remaining\./);
  });

  it("matches Showdown in Scarlet/Violet, Tera included", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(row(build("garchomp", "roughskin", sv), sv)).toMatchObject({ min: 120, max: 144, alternate: { min: 240, max: 284 } });
    const tera = build("hydrapple", "regenerator", sv, { mechanic: "tera", configuration: { teraType: "Dragon" } } as Partial<BattleBuild>);
    expect(row(build("garchomp", "roughskin", sv), sv, tera)).toMatchObject({ min: 160, max: 192, alternate: { min: 320, max: 380 } });
  });
});
