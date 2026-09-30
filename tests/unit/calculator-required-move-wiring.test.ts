import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import type { PreparedMatchup } from "@/app/(app)/calculator/roster-prep";

const state = vi.hoisted(() => ({ matchup: null as PreparedMatchup | null }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => false }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({
  default: () => ({ state: createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/app/(app)/calculator/roster-prep", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/roster-prep")>();
  return { ...actual, createMatchup: (...args: Parameters<typeof actual.createMatchup>) => state.matchup ?? actual.createMatchup(...args) };
});

// The full calculator gives Build settings the required-move control for the right Pokémon.
it("shows the required-move fix for a Scarlet/Violet Keldeo-Resolute missing Secret Sword", async () => {
  const { loadBattleRuntime } = await import("@/app/lib/battle/load-runtime");
  const { createBuild } = await import("@/app/lib/battle/model");
  const prep = await import("@/app/(app)/calculator/roster-prep");
  const sv = await loadBattleRuntime("scarlet_violet");
  let matchup = prep.updateMatchupBuild(prep.createMatchup(0, sv), "attacker", createBuild("keldeoresolute", sv));
  const active = prep.activateMoveSlot(matchup, prep.getMoveOwner(matchup.attacker), 0);
  matchup = prep.replaceMatchupMove(active, active.replacement!, "aquatail");
  state.matchup = matchup;
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  const html = renderToStaticMarkup(createElement(CalculatorClient));
  expect(html.match(/<select\b[^>]*id="attacker-[^"]*-required-move"[^>]*>/)?.[0]).toContain('aria-invalid="true"');
  expect(html).toContain("Quick move 1: Aqua Tail");
  expect(html).toContain(">Replace with Secret Sword</button>");
  expect(html).toContain("Keldeo-Resolute requires Secret Sword in its prepared moves.");
  expect(html.match(/<select\b[^>]*id="defender-[^"]*-required-move"[^>]*>/)).toBeNull();
});
