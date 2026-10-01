import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions as Conditions, MoveContext } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94's real useMove pipeline (field-core ref.ts),
 * Doubles, with the target's partner given Friend Guard. Level 50, 0 Stat Points/EVs, 31 IVs,
 * Serious nature, no crit unless stated.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, ...extra } as BattleBuild;
}

function field(options: { gameType?: Conditions["gameType"]; spread?: boolean; crit?: boolean; lightScreen?: boolean; reflect?: boolean; friendGuard?: boolean; attackerFriendGuard?: boolean } = {}): Conditions {
  const base = createConditions();
  return {
    ...base, gameType: options.gameType ?? "Doubles", multipleTargets: !!options.spread, critical: !!options.crit,
    attackerSide: { ...base.attackerSide, friendGuard: !!options.attackerFriendGuard },
    defenderSide: { ...base.defenderSide, friendGuard: options.friendGuard ?? true, lightScreen: !!options.lightScreen, reflect: !!options.reflect },
  };
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, conditions: Conditions, runtime: BattleRuntime = championsRuntime, contexts: Record<string, MoveContext> = {}) {
  const out = calculateMatchup(attacker, defender, conditions, contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const APPLIED = "Friend Guard: 75% damage.";
const garchomp = build("garchomp", "roughskin");
const incineroar = build("incineroar", "blaze");

describe("Friend Guard partner", () => {
  it.each<[string, BattleBuild, BattleBuild, string, Parameters<typeof field>[0], number, number]>([
    ["single target", garchomp, incineroar, "dragonclaw", {}, 47, 56],
    ["off", garchomp, incineroar, "dragonclaw", { friendGuard: false }, 63, 75],
    ["with a crit", garchomp, incineroar, "dragonclaw", { crit: true }, 70, 84],
    ["spread move", build("charizardmegay", "drought"), build("kingambit", "defiant"), "heatwave", { spread: true }, 103, 123],
    ["spread move with Light Screen", build("charizardmegay", "drought"), build("kingambit", "defiant"), "heatwave", { spread: true, lightScreen: true }, 69, 82],
  ])("%s matches Showdown", (_label, attacker, defender, moveId, options, min, max) => {
    const result = row(moveId, attacker, defender, field(options));
    expect(result).toMatchObject({ kind: "calculated", min, max });
    expect(result.assumptions.includes(APPLIED)).toBe(options?.friendGuard !== false);
  });

  it("is ignored by Mold Breaker and suppressed by Neutralizing Gas", async () => {
    const moldBreaker = row("ironhead", build("excadrill", "moldbreaker"), incineroar, field());
    expect(moldBreaker).toMatchObject({ min: 32, max: 38 });
    expect(moldBreaker.assumptions).toContain("Mold Breaker ignores the partner's Friend Guard.");
    const sv = await loadBattleRuntime("scarlet_violet");
    const intoGas = row("ironhead", build("garchomp", "roughskin", sv), build("weezinggalar", "neutralizinggas", sv), field(), sv);
    expect(intoGas).toMatchObject({ min: 66, max: 78 });
    expect(intoGas.assumptions).toContain("Neutralizing Gas suppresses the partner's Friend Guard.");
    expect(row("sludgebomb", build("weezinggalar", "neutralizinggas", sv), build("garchomp", "roughskin", sv), field(), sv)).toMatchObject({ min: 25, max: 30 });
  });

  it("names Neutralizing Gas, not Mold Breaker, against a gas defender", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const intoGas = row("ironhead", build("excadrill", "moldbreaker", sv), build("weezinggalar", "neutralizinggas", sv), field(), sv);
    expect(intoGas).toMatchObject({ min: 102, max: 120 });
    expect(intoGas.assumptions).toContain("Neutralizing Gas suppresses the partner's Friend Guard.");
    expect(intoGas.assumptions).not.toContain("Mold Breaker ignores the partner's Friend Guard.");
  });

  it("is ignored by moves that ignore abilities, including their Z-Moves and G-Max Moves", async () => {
    const snorlaxOf = (runtime: BattleRuntime) => build("snorlax", "thickfat", runtime);
    for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const runtime = await loadBattleRuntime(game);
      const solgaleo = build("solgaleo", "fullmetalbody", runtime);
      const sunsteel = row("sunsteelstrike", solgaleo, snorlaxOf(runtime), field(), runtime);
      expect(sunsteel, game).toMatchObject({ min: 105, max: 124 });
      expect(sunsteel.assumptions).toContain("Sunsteel Strike ignores the partner's Friend Guard.");
      expect(sunsteel.assumptions).not.toContain(APPLIED);
      expect(row("zenheadbutt", solgaleo, snorlaxOf(runtime), field(), runtime), game).toMatchObject({ min: 63, max: 75, assumptions: expect.arrayContaining([APPLIED]) });
    }
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const zMove = row("sunsteelstrike", build("solgaleo", "fullmetalbody", usum, { itemId: "solganiumz" }), snorlaxOf(usum), field(), usum, { sunsteelstrike: { useZ: true } });
    expect(zMove).toMatchObject({ effectiveName: "Searing Sunraze Smash", min: 208, max: 246 });
    const swsh = await loadBattleRuntime("sword_shield");
    const drumSolo = row("woodhammer", build("rillaboom", "overgrow", swsh, { mechanic: "gigantamax", configuration: { gigantamax: true } } as Partial<BattleBuild>), snorlaxOf(swsh), field(), swsh);
    expect(drumSolo).toMatchObject({ effectiveName: "G-Max Drum Solo", min: 154, max: 183 });
    // A Max Move does not keep the base move's ignoreAbility.
    const steelspike = row("sunsteelstrike", build("solgaleo", "fullmetalbody", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>), snorlaxOf(swsh), field(), swsh);
    expect(steelspike).toMatchObject({ effectiveName: "Max Steelspike", min: 101, max: 120, assumptions: expect.arrayContaining([APPLIED]) });
  });

  it("gives fixed damage no note, including a Z-Move's", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const guardian = row("naturesmadness", build("tapukoko", "electricsurge", usum, { itemId: "tapuniumz" }), build("snorlax", "thickfat", usum), field(), usum, { naturesmadness: { useZ: true } });
    expect(guardian).toMatchObject({ effectiveName: "Guardian of Alola", min: 176, max: 176 });
    expect(guardian.assumptions.filter((line) => line.includes("Friend Guard"))).toEqual([]);
  });

  it("is withheld with two or more other damage modifiers, which Showdown orders by Speed", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const kyogre = build("kyogre", "drizzle", sv);
    const rhyperior = build("rhyperior", "solidrock", sv, { itemId: "passhoberry" });
    expect(row("hydropump", kyogre, rhyperior, field({ lightScreen: true }), sv)).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("Friend Guard with 3 other damage modifiers") });
    expect(row("hydropump", kyogre, rhyperior, field(), sv).kind).toBe("unsupported");
    expect(row("glaiverush", build("baxcalibur", "thermalexchange", sv, { itemId: "expertbelt" }), build("dragonite", "innerfocus", sv, { itemId: "habanberry" }), field(), sv).kind).toBe("unsupported");
    // With one other modifier the order cannot matter.
    expect(row("hydropump", kyogre, build("snorlax", "thickfat", sv), field({ lightScreen: true }), sv)).toMatchObject({ kind: "calculated", min: 41, max: 49 });
    expect(row("dragonclaw", build("garchomp", "roughskin", sv, { itemId: "lifeorb" }), build("snorlax", "thickfat", sv), field(), sv)).toMatchObject({ kind: "calculated", min: 79, max: 94 });
    expect(row("dragonclaw", build("garchomp", "roughskin", sv), build("dragonite", "multiscale", sv), field(), sv)).toMatchObject({ kind: "calculated", min: 43, max: 52 });
    expect(row("dragonclaw", build("garchomp", "roughskin", sv, { itemId: "lifeorb" }), build("dragonite", "multiscale", sv), field(), sv).kind).toBe("unsupported");
  });

  it("protects only the receiving side, never fixed damage, and needs Doubles", () => {
    const outgoing = row("dragonclaw", garchomp, incineroar, field({ friendGuard: false, attackerFriendGuard: true }));
    expect(outgoing).toMatchObject({ min: 63, max: 75 });
    expect(outgoing.assumptions).not.toContain(APPLIED);
    const toss = row("seismictoss", build("machamp", "guts"), garchomp, field());
    expect(toss).toMatchObject({ min: 50, max: 50 });
    expect(toss.assumptions).not.toContain(APPLIED);
    const singles = row("dragonclaw", garchomp, incineroar, field({ gameType: "Singles" }));
    expect(singles).toMatchObject({ min: 63, max: 75 });
    expect(singles.assumptions).toContain("Singles: the Friend Guard partner is ignored.");
  });

  it("matches Showdown in the native games", async () => {
    for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const runtime = await loadBattleRuntime(game);
      expect(row("dragonclaw", build("garchomp", "roughskin", runtime), build("snorlax", "thickfat", runtime), field(), runtime), game).toMatchObject({ min: 61, max: 72 });
    }
  });

  it("has a toggle on each side, disabled in Singles", () => {
    const render = (gameType: Conditions["gameType"]) => renderToStaticMarkup(createElement(BattleConditions, { value: field({ gameType }), issues: [], onChange: () => undefined }));
    const doubles = render("Doubles");
    for (const side of ["attackerSide", "defenderSide"]) {
      const input = doubles.match(new RegExp(`<input\\b[^>]*id="[^"]*-${side}-friendGuard"[^>]*>`))?.[0];
      expect(input).toBeDefined();
      expect(input).not.toContain('disabled=""');
    }
    expect(doubles).toContain("Partner has Friend Guard");
    expect(render("Singles").match(/<input\b[^>]*id="[^"]*-defenderSide-friendGuard"[^>]*>/)?.[0]).toContain('disabled=""');
  });
});
