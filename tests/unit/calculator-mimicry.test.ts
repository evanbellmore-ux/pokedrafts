import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { createMatchup, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Mimicry (Galarian Stunfisk) against pinned Showdown c23d2e94, where setting the terrain fires
 * onTerrainChange. Level 50, 0 Stat Points/EVs, 31 IVs, Serious nature, Singles, no crit.
 * fix19/verify.ts checks 84 cases across Champions and Sword/Shield.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, itemId?: string): BattleBuild {
  const base = createBuild(id, runtime);
  return { ...base, abilityId, itemId: itemId ?? base.itemId } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, terrain: BattleConditions["terrain"], runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", terrain }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const stunfisk = build("stunfiskgalar", "mimicry");
const gallade = build("gallademega", "innerfocus");
const garchomp = build("garchomp", "roughskin");

describe("Mimicry", () => {
  it("gives the target the terrain's type", () => {
    expect(row("firepunch", gallade, stunfisk, "")).toMatchObject({ min: 90, max: 106 });
    const electric = row("firepunch", gallade, stunfisk, "Electric");
    expect(electric).toMatchObject({ min: 45, max: 53 });
    expect(electric.assumptions).toContain("Mimicry: on Electric Terrain the target is Electric type.");
    expect(row("closecombat", gallade, stunfisk, "Psychic")).toMatchObject({ min: 53, max: 63 });
    expect(row("earthquake", garchomp, stunfisk, "Grassy")).toMatchObject({ min: 18, max: 21 });
    // Fairy on Misty Terrain is immune to Dragon.
    expect(row("dragonclaw", garchomp, stunfisk, "Misty")).toMatchObject({ min: 0, max: 0 });
  });

  it("changes its own STAB", () => {
    expect(row("earthpower", stunfisk, garchomp, "")).toMatchObject({ min: 42, max: 51 });
    const earthPower = row("earthpower", stunfisk, garchomp, "Psychic");
    expect(earthPower).toMatchObject({ min: 28, max: 34 });
    expect(earthPower.assumptions).toContain("Mimicry: on Psychic Terrain the attacker is Psychic type.");
    expect(row("flashcannon", stunfisk, garchomp, "Grassy")).toMatchObject({ min: 25, max: 30 });
    expect(row("earthpower", stunfisk, stunfisk, "Electric")).toMatchObject({ min: 56, max: 68 });
  });

  it("shows the terrain's type in the summary, once above its Build settings", () => {
    let matchup = createMatchup(0, championsRuntime);
    matchup = updateMatchupBuild(matchup, "attacker", gallade);
    matchup = updateMatchupBuild(matchup, "defender", stunfisk);
    const summary = (terrain: BattleConditions["terrain"]) => renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      selectedRow: undefined, rollMode: "average", issues: { attacker: [], defender: [] }, movesControl: "moves",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(), onRollModeChange: vi.fn(),
      onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime, terrain,
    }));
    const electric = summary("Electric");
    expect(electric).toContain("Mimicry: Electric type on Electric Terrain (original types Ground / Steel).");
    expect(electric).toMatch(/Gallade[\s\S]*Stunfisk[\s\S]*>Electric<\/p>/);
    expect(summary("")).not.toContain("Mimicry:");
    const psychic = summary("Psychic");
    expect([...psychic.matchAll(/Mimicry: Psychic type on Psychic Terrain \(original types Ground \/ Steel\)\./g)]).toHaveLength(1);
    // The card shows it, so the Build settings under that card does not repeat it.
    const editor = renderToStaticMarkup(createElement(PokemonPanel, {
      side: "defender", build: matchup.defender.build, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined,
    }));
    expect(editor).not.toContain("Mimicry:");
  });

  it("is suppressed by the other battler's Neutralizing Gas in Sword/Shield", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const weezing = build("weezinggalar", "neutralizinggas", swsh);
    const gassed = row("sludgebomb", weezing, build("stunfiskgalar", "mimicry", swsh), "Electric", swsh);
    expect(gassed).toMatchObject({ min: 0, max: 0 });
    expect(gassed.assumptions).toContain("Mimicry: suppressed by Neutralizing Gas, so the target keeps its own types (assumes the gas was out when the terrain started or the target entered).");
    expect(row("earthpower", build("stunfiskgalar", "mimicry", swsh), weezing, "Grassy", swsh)).toMatchObject({ min: 98, max: 116 });
  });
});
