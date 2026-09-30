import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MoveResults from "@/app/(app)/calculator/MoveResults";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { EVENT_DOUBLING_MOVES } from "@/app/lib/battle/event-moves";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94 (champions mod), getDamage with the
 * real battle-state flag for each doubling condition (moveLastTurnResult,
 * statsLoweredThisTurn, newlySwitched, sourceEffect "round", attackedBy,
 * hurtThisTurn). Level 50, 0 Stat Points, Serious nature, no crit.
 */
const CASES: Record<string, { attacker: [string, string]; defender: [string, string]; normal: [number, number]; doubled: [number, number] }> = {
  stompingtantrum: { attacker: ["garchomp", "roughskin"], defender: ["snorlax", "thickfat"], normal: [76, 90], doubled: [150, 177] },
  temperflare: { attacker: ["skeledirge", "blaze"], defender: ["snorlax", "thickfat"], normal: [25, 30], doubled: [48, 57] },
  lashout: { attacker: ["gyaradosmega", "moldbreaker"], defender: ["snorlax", "thickfat"], normal: [87, 103], doubled: [174, 205] },
  payback: { attacker: ["umbreon", "synchronize"], defender: ["snorlax", "thickfat"], normal: [30, 36], doubled: [58, 69] },
  round: { attacker: ["snorlax", "thickfat"], defender: ["garchomp", "roughskin"], normal: [28, 34], doubled: [55, 66] },
  avalanche: { attacker: ["abomasnow", "snowwarning"], defender: ["snorlax", "thickfat"], normal: [24, 28], doubled: [45, 54] },
  assurance: { attacker: ["absol", "justified"], defender: ["snorlax", "thickfat"], normal: [60, 72], doubled: [120, 142] },
};

function result(moveId: string, attacker: [string, string], defender: [string, string], field: Partial<BattleConditions>, doubled: boolean) {
  const conditions = { ...createConditions(), multipleTargets: false, ...field };
  const out = calculateMatchup(
    { ...createBuild(attacker[0]), abilityId: attacker[1] },
    { ...createBuild(defender[0]), abilityId: defender[1] },
    conditions, { [moveId]: { doubled } },
  );
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((row) => row.moveId === moveId)!;
}

describe("moves that double after a turn event", () => {
  it.each(Object.entries(CASES))("%s: normal power by default, doubled when its event is ticked", (moveId, c) => {
    for (const gameType of ["Singles", "Doubles"] as const) {
      const normal = result(moveId, c.attacker, c.defender, { gameType }, false);
      expect(normal).toMatchObject({ kind: "calculated", min: c.normal[0], max: c.normal[1] });
      // Round doubles after any earlier Round this turn, a foe's included, so also in Singles.
      const doubled = result(moveId, c.attacker, c.defender, { gameType }, true);
      expect(doubled).toMatchObject({ kind: "calculated", min: c.doubled[0], max: c.doubled[1] });
      expect(normal.assumptions.some((line) => line.startsWith("Normal power: assumes"))).toBe(true);
      expect(doubled.assumptions.some((line) => line.startsWith("Doubled power:"))).toBe(true);
    }
  });

  it("follows the Payback context whatever the Speed order, not the engine's turn-order guess", () => {
    // Umbreon is slower than Garchomp, which the engine alone would read as "moved last".
    const slow = (doubled: boolean) => result("payback", ["umbreon", "synchronize"], ["garchomp", "roughskin"], { gameType: "Singles" }, doubled);
    expect(slow(false)).toMatchObject({ kind: "calculated", effectivePower: 50 });
    expect(slow(true)).toMatchObject({ kind: "calculated", effectivePower: 100 });
  });

  it("doubles Assurance's Parental Bond second strike, as Showdown does and the engine misses", () => {
    // Showdown: the first strike hurts the target, so the second strike's Assurance is 120 BP.
    // Kangaskhan-Mega into Snorlax: strike 1 39-47 (60 BP), strike 2 19-23 (120 BP x 0.25).
    const kanga: [string, string] = ["kangaskhanmega", "parentalbond"];
    for (const gameType of ["Singles", "Doubles"] as const) {
      const normal = result("assurance", kanga, ["snorlax", "thickfat"], { gameType }, false);
      expect(normal).toMatchObject({ kind: "calculated", min: 58, max: 70 });
      expect((normal.rolls as number[][]).map((strike) => [strike[0], strike[15]])).toEqual([[39, 47], [19, 23]]);
      expect(normal.assumptions.some((line) => line.startsWith("Parental Bond: the second strike doubles"))).toBe(true);
      // Doubled case: both strikes at 120 BP.
      expect(result("assurance", kanga, ["snorlax", "thickfat"], { gameType }, true)).toMatchObject({ kind: "calculated", min: 97, max: 115 });
    }
    // Round and Avalanche double both strikes in Showdown through the same power override.
    expect(result("avalanche", kanga, ["snorlax", "thickfat"], { gameType: "Singles" }, true).kind).toBe("calculated");
  });

  it("no longer returns needs-context for these moves", () => {
    for (const moveId of Object.keys(CASES)) {
      const c = CASES[moveId];
      expect(result(moveId, c.attacker, c.defender, { gameType: "Doubles" }, false).kind).not.toBe("needs-context");
    }
    expect(Object.keys(EVENT_DOUBLING_MOVES).sort()).toEqual(["assurance", "avalanche", "lashout", "payback", "revenge", "round", "stompingtantrum", "temperflare"]);
  });
});

describe("doubled-case toggle in the move list", () => {
  function row(moveId: string): MoveDamageResult {
    return { moveId, kind: "calculated", min: 20, max: 20, minPercent: null, maxPercent: null, rolls: 20,
      ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1 };
  }
  function render(moveId: string, overrides: Partial<ComponentProps<typeof MoveResults>> = {}) {
    const build = createBuild(moveId === "round" ? "snorlax" : "garchomp");
    return renderToStaticMarkup(createElement(MoveResults, {
      runtime: championsRuntime, sourceBuild: build, rows: [row(moveId)], moveIds: [moveId], ownerId: "1:1", sourcePosition: "left",
      selectedMoveId: moveId, onSelectMove: vi.fn(), contexts: {}, onContextChange: vi.fn(),
      abilityId: build.abilityId, itemId: build.itemId, attackerName: "Garchomp", defenderName: "Snorlax", defenderHP: 235,
      ...overrides,
    }));
  }
  const checkbox = (html: string) => html.match(/<input[^>]*id="[^"]*-event-doubled"[^>]*>/)?.[0];

  it("labels the event, starts unticked and reflects a ticked context", () => {
    const html = render("stompingtantrum");
    expect(html).toContain("The user&#x27;s previous move failed");
    expect(checkbox(html)).toBeDefined();
    expect(checkbox(html)).not.toContain('checked=""');
    expect(html).toContain("Unticked, it uses normal power (75)");
    expect(checkbox(render("stompingtantrum", { contexts: { stompingtantrum: { doubled: true } } }))).toContain('checked=""');
  });

  it("offers Round's toggle for any earlier Round this turn, a foe's included", () => {
    const html = render("round", { contexts: { round: { doubled: true } } });
    expect(html).toContain("Another Pokémon used Round earlier this turn");
    expect(checkbox(html)).toContain('checked=""');
    expect(checkbox(html)).not.toContain('disabled=""');
  });

  it("hides the toggle while the move is a Z-Move or Max Move, whose power is fixed", async () => {
    const renderIn = (runtime: BattleRuntime, build: ReturnType<typeof createBuild>, contexts: ComponentProps<typeof MoveResults>["contexts"]) =>
      renderToStaticMarkup(createElement(MoveResults, {
        runtime, sourceBuild: build, rows: [row("stompingtantrum")], moveIds: ["stompingtantrum"], ownerId: "1:1", sourcePosition: "left",
        selectedMoveId: "stompingtantrum", onSelectMove: vi.fn(), contexts, onContextChange: vi.fn(),
        abilityId: build.abilityId, itemId: build.itemId, attackerName: "Garchomp", defenderName: "Snorlax", defenderHP: 235,
      }));
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const zBuild = { ...createBuild("garchomp", usum), itemId: "groundiumz" };
    expect(checkbox(renderIn(usum, zBuild, { stompingtantrum: { useZ: true, doubled: true } }))).toBeUndefined();
    expect(checkbox(renderIn(usum, zBuild, { stompingtantrum: { doubled: true } }))).toContain('checked=""');
    const swsh = await loadBattleRuntime("sword_shield");
    expect(checkbox(renderIn(swsh, { ...createBuild("garchomp", swsh), mechanic: "dynamax" }, {}))).toBeUndefined();
  });

  it("does not show the toggle for other moves", () => {
    expect(checkbox(render("earthquake"))).toBeUndefined();
  });
});
