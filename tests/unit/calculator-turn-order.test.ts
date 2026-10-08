import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults from "@/app/(app)/calculator/MoveResults";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { turnOrderQuestion } from "@/app/lib/battle/turn-order";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * Analytic, Bolt Beak and Fishious Rend against real pinned Showdown c23d2e94 turns (the target uses
 * Splash, a priority-0 move; queue.willMove decides): priority, fractional priority, Speed,
 * Trick Room and Tailwind. Level 50, 0 Stat Points/EVs, 31 IVs, Serious nature, no crit.
 * fix24/verify.ts checks 41 turns across the four games.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: ReturnType<typeof row>) => `${result.min}-${result.max}`;
const starmie = build("starmie", "analytic");
const snorlax = build("snorlax", "thickfat");
const dragapult = build("dragapult", "clearbody");

describe("Analytic's turn order in Singles", () => {
  it("boosts only when it moves after the target", () => {
    const slower = row("psychic", starmie, dragapult);
    expect(range(slower)).toBe("84-100");
    expect(slower.assumptions).toContain("Analytic: boosted, moves after the target (135 Speed against 162).");
    expect(slower.assumptions).toContain("Assumes the target uses a 0-priority move.");
    expect(range(row("psychic", starmie, snorlax))).toBe("48-57");
  });

  it("follows priority, Trick Room and Tailwind", () => {
    const aquaJet = row("aquajet", starmie, dragapult);
    expect(range(aquaJet)).toBe("12-14");
    expect(aquaJet.assumptions).toContain("Analytic: no boost, moves before the target (+1 priority).");
    expect(range(row("avalanche", starmie, dragapult))).toBe("60-72");
    expect(range(row("psychic", starmie, snorlax, { trickRoom: true }))).toBe("61-73");
    expect(range(row("psychic", starmie, dragapult, { trickRoom: true }))).toBe("66-78");
    expect(range(row("psychic", starmie, dragapult, { attackerSide: { ...createConditions().attackerSide, tailwind: true } }))).toBe("66-78");
  });

  it("follows Lagging Tail, Custap Berry and Stall", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const star = (itemId: string, extra: Partial<BattleBuild> = {}) => build("starmie", "analytic", swsh, { itemId, ...extra });
    expect(range(row("psychic", star("laggingtail"), build("snorlax", "thickfat", swsh), {}, swsh))).toBe("61-73");
    expect(range(row("psychic", star(""), build("snorlax", "thickfat", swsh, { itemId: "laggingtail" }), {}, swsh))).toBe("48-57");
    // Magic Room suppresses Lagging Tail, so Speed decides.
    expect(range(row("psychic", star("laggingtail"), build("snorlax", "thickfat", swsh), { magicRoom: true }, swsh))).toBe("48-57");
    const low = star("custapberry");
    const custap = row("psychic", { ...low, currentHP: Math.floor(getBuildStats(low, swsh)!.hp * 0.2) }, build("dragapult", "clearbody", swsh), {}, swsh);
    expect(range(custap)).toBe("66-78");
    expect(custap.assumptions).toContain("Analytic: no boost, moves before the target (the attacker's Custap Berry).");
    expect(range(row("surf", starmie, build("sableye", "stall")))).toBe("72-85");
  });

  it("asks on a Speed tie, and takes the move settings' choice", () => {
    const tie = row("psychic", starmie, build("starmie", "naturalcure"));
    expect(tie.kind).toBe("needs-context");
    expect(tie.reason).toBe("Analytic: needs the turn order (Speed tie at 135).");
    expect(range(row("psychic", starmie, build("starmie", "naturalcure"), {}, championsRuntime, { turnOrder: "last" }))).toBe("38-45");
    expect(range(row("psychic", starmie, build("starmie", "naturalcure"), {}, championsRuntime, { turnOrder: "first" }))).toBe("29-35");
  });
});

describe("the review's turn-order corrections", () => {
  it("orders negative-priority moves by their real priority", () => {
    const avalanche = row("avalanche", starmie, snorlax);
    expect(range(avalanche)).toBe("17-20");
    expect(avalanche.assumptions).toContain("Analytic: boosted, moves after the target (-4 priority).");
  });

  it("always boosts Future Sight, which lands after everyone has moved", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const future = row("futuresight", build("beheeyem", "analytic", swsh), build("snorlax", "thickfat", swsh), {}, swsh);
    expect(range(future)).toBe("99-117");
    expect(future.assumptions).toContain("Analytic: boosted, Future Sight lands after every Pokémon has moved (assumes the user is still in battle).");
  });

  it("uses Speed as Showdown does with Utility Umbrella and Neutralizing Gas", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const venusaur = (itemId: string) => build("venusaur", "chlorophyll", swsh, { itemId });
    expect(range(row("psychic", build("starmie", "analytic", swsh), venusaur("utilityumbrella"), { weather: "Sun" }, swsh))).toBe("102-122");
    expect(range(row("psychic", build("starmie", "analytic", swsh), venusaur(""), { weather: "Sun" }, swsh))).toBe("134-158");
    const weezing = build("weezinggalar", "neutralizinggas", swsh, { boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } });
    expect(range(row("boltbeak", build("dracozolt", "sandrush", swsh), weezing, { weather: "Sand" }, swsh))).toBe("42-51");
  });

  it("asks only where the choice matters", () => {
    const analytic = { abilityId: "analytic", abilityActive: false };
    const psychic = { id: "psychic", category: "Special" };
    expect(turnOrderQuestion(psychic, analytic, false)).toBe("analytic");
    expect(turnOrderQuestion(psychic, analytic, false, { opponentAbilityId: "neutralizinggas" })).toBeNull();
    expect(turnOrderQuestion({ id: "selfdestruct", category: "Physical" }, analytic, false, { opponentAbilityId: "damp" })).toBeNull();
    expect(turnOrderQuestion({ id: "futuresight", category: "Special" }, analytic, false)).toBeNull();
    expect(turnOrderQuestion({ id: "superfang", category: "Physical" }, analytic, false)).toBeNull();
    expect(turnOrderQuestion({ id: "superfang", category: "Physical" }, analytic, true)).toBe("analytic");
    expect(turnOrderQuestion(psychic, { ...analytic, abilityActive: true }, false, { gameType: "Singles" })).toBeNull();
    expect(turnOrderQuestion(psychic, { ...analytic, abilityActive: true }, false, { gameType: "Doubles" })).toBe("analytic");
  });
});

describe("Analytic in Doubles", () => {
  const doubles = { gameType: "Doubles" as const, multipleTargets: false };
  it("asks for the turn order unless its condition or a choice decides it", () => {
    const ask = row("psychic", starmie, snorlax, doubles);
    expect(ask.kind).toBe("needs-context");
    expect(ask.reason).toBe("Analytic: needs the Doubles turn order.");
    expect(range(row("psychic", starmie, snorlax, doubles, championsRuntime, { turnOrder: "last" }))).toBe("61-73");
    expect(range(row("psychic", starmie, snorlax, doubles, championsRuntime, { turnOrder: "first" }))).toBe("48-57");
    // Its "target switches" condition does not settle it in Doubles: the other two still decide it.
    const switched = build("starmie", "analytic", championsRuntime, { abilityActive: true });
    expect(row("psychic", switched, snorlax, doubles).kind).toBe("needs-context");
    expect(range(row("psychic", switched, snorlax, doubles, championsRuntime, { turnOrder: "last" }))).toBe("61-73");
    expect(range(row("psychic", switched, snorlax))).toBe("61-73");
    // No damage either way, so no question: Psychic into a Dark type, or Self-Destruct into Damp.
    expect(row("psychic", starmie, build("kingambit", "defiant"), doubles)).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    expect(row("selfdestruct", starmie, build("swampert", "damp"), doubles)).toMatchObject({ min: 0, max: 0 });
  });
});

describe("Bolt Beak and Fishious Rend", () => {
  it("double when the user moves before the target", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const dracozolt = build("dracozolt", "voltabsorb", swsh);
    const first = row("boltbeak", dracozolt, build("snorlax", "thickfat", swsh), {}, swsh);
    expect(first).toMatchObject({ effectiveName: "Bolt Beak", effectivePower: 170, min: 135, max: 160 });
    expect(first.assumptions).toContain("Bolt Beak: doubled power, moves before the target (95 Speed against 50).");
    expect(range(row("boltbeak", dracozolt, build("dragapult", "clearbody", swsh), {}, swsh))).toBe("30-36");
    expect(range(row("boltbeak", dracozolt, build("snorlax", "thickfat", swsh), { trickRoom: true }, swsh))).toBe("67-81");
    expect(range(row("boltbeak", dracozolt, build("dragapult", "clearbody", swsh), { trickRoom: true }, swsh))).toBe("60-72");
    expect(row("boltbeak", dracozolt, build("dracozolt", "hustle", swsh), {}, swsh).kind).toBe("needs-context");
    // Only the target matters, so Doubles is worked out too.
    expect(range(row("boltbeak", dracozolt, build("snorlax", "thickfat", swsh), { gameType: "Doubles", multipleTargets: false }, swsh))).toBe("135-160");
    const dracovish = build("dracovish", "waterabsorb", swsh);
    expect(range(row("fishiousrend", dracovish, build("garchomp", "roughskin", swsh), { attackerSide: { ...createConditions().attackerSide, tailwind: true } }, swsh))).toBe("93-109");
    expect(range(row("fishiousrend", dracovish, build("garchomp", "roughskin", swsh), {}, swsh, { turnOrder: "first" }))).toBe("93-109");
  });
});

describe("the turn-order setting", () => {
  it("is offered in the move settings and from the summary", () => {
    let matchup = createMatchup(0, championsRuntime);
    matchup = updateMatchupBuild(matchup, "attacker", starmie);
    matchup = updateMatchupBuild(matchup, "defender", snorlax);
    matchup = selectMatchupMove(matchup, "psychic");
    const result = row("psychic", starmie, snorlax, { gameType: "Doubles", multipleTargets: false });
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [result], moveIds: ["psychic"], ownerId: "0:0", selectedMoveId: "psychic", onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: "analytic", itemId: "", attackerName: "Starmie", defenderName: "Snorlax", defenderHP: 235, sourceBuild: starmie, gameType: "Doubles",
    }));
    expect(html).toContain("Turn order for Analytic");
    expect(html).toMatch(/-turn-order"[^>]*><option value="" selected="">—<\/option><option value="last">It moves last/);
    expect(html).toContain("It moves last this turn: Analytic boosts");
    const view = getAttackView(matchup);
    const summary = renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: result, rollMode: "average",
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime,
    }));
    expect(summary).toContain(">Set turn order</button>");
  });
});
