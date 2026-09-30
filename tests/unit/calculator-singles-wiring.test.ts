import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import type { PreparedMatchup } from "@/app/(app)/calculator/roster-prep";

const state = vi.hoisted(() => ({ mutate: null as null | ((matchup: PreparedMatchup) => PreparedMatchup) }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => false }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({
  default: () => ({ state: createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/app/(app)/calculator/roster-prep", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/roster-prep")>();
  return {
    ...actual,
    createMatchup: (...args: Parameters<typeof actual.createMatchup>) => {
      const matchup = actual.createMatchup(...args);
      return state.mutate ? state.mutate(matchup) : matchup;
    },
  };
});

// The calculator passes the battle format to each Pokémon panel, so the Plus/Minus condition
// control matches the calculation, which ignores that condition in Singles.
it("disables the Plus/Minus condition of a Singles matchup in the full calculator", async () => {
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  state.mutate = (matchup) => ({
    ...matchup,
    attacker: { ...matchup.attacker, build: { ...matchup.attacker.build, speciesId: "ampharos", abilityId: "plus", abilityActive: true } },
    field: { ...matchup.field, gameType: "Singles" },
  });
  const html = renderToStaticMarkup(createElement(CalculatorClient));
  const checkbox = html.match(/<input [^>]*id="[^"]*-ability-active"[^>]*>/)?.[0];
  const help = html.match(/<p id="[^"]*-ability-help"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  expect(checkbox).toContain('disabled=""');
  expect(help).toContain("Singles has no ally");
});
