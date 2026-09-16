import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CalculatorClient from "@/app/(app)/calculator/CalculatorClient";
import PokemonPanel, { parseBuildInput } from "@/app/(app)/calculator/PokemonPanel";
import MoveResults, { filterMoveResults } from "@/app/(app)/calculator/MoveResults";
import { createBuild, validateBuild } from "@/app/lib/battle/model";
import type { MoveDamageResult } from "@/app/lib/battle/types";

function row(moveId: string, kind: MoveDamageResult["kind"]): MoveDamageResult {
  return {
    moveId, kind,
    min: kind === "calculated" ? 0 : null,
    max: kind === "calculated" ? 0 : null,
    minPercent: kind === "calculated" ? 0 : null,
    maxPercent: kind === "calculated" ? 0 : null,
    ohkoChance: kind === "calculated" ? 0 : null,
    rolls: kind === "calculated" ? 0 : null,
    description: "", assumptions: [],
    reason: kind === "unsupported" ? "Coverage not verified." : null,
    hits: kind === "calculated" ? 1 : null,
  };
}

describe("Champions calculator UI", () => {
  it("does not turn fractions or nonempty invalid HP into valid numbers/full HP", () => {
    expect(parseBuildInput("32")).toBe(32);
    expect(parseBuildInput("")).toBeNull();
    expect(parseBuildInput("", true)).toBeNull();
    for (const text of ["1.5", "2e1", "abc", " ", "9007199254740992"]) {
      expect(parseBuildInput(text)).toBeNull();
      expect(parseBuildInput(text, true)).toBeNaN();
      expect(validateBuild({ ...createBuild(), currentHP: parseBuildInput(text, true) }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ field: "currentHP" })]));
    }
  });

  it("server-renders uniquely labelled build controls without another main or loading the engine", () => {
    const html = renderToStaticMarkup(createElement(CalculatorClient));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const labels = [...html.matchAll(/\bfor="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of labels) expect(ids).toContain(label);
    expect(html).not.toMatch(/<main\b/);
    expect(html).toContain("Loading the Champions engine");
    expect(html).toContain("Damage Calculator");
  });

  it("locks the required Mega Stone and shows unsupported species reasons", () => {
    const mega = createBuild("charizardmegax");
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build: mega, issues: validateBuild(mega), onChange: () => undefined }));
    expect(html).toMatch(/<select\b[^>]*id="[^"]*-item"[^>]*disabled=""/);
    expect(html).toContain('value="charizarditex" selected=""');
    expect(html).toContain("required and locked for this form");

    const unsupported = createBuild("lucariomegaz");
    const unsupportedHTML = renderToStaticMarkup(createElement(PokemonPanel, { side: "defender", build: unsupported, issues: validateBuild(unsupported), onChange: () => undefined }));
    expect(unsupportedHTML).toContain("Unsupported build:");
    expect(unsupportedHTML).toContain("Lucario-Mega-Z");
  });

  it("shows a conditional ability switch without implying all abilities can be disabled", () => {
    const build = { ...createBuild("incineroar"), abilityId: "intimidate", abilityActive: true };
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build, issues: [], onChange: () => undefined }));
    expect(html).toContain("Apply Intimidate on entry");
    expect(html).toContain("Do not manually apply the same entry-stage change twice");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it("keeps unsupported status moves in the status view and accounts for all kinds", () => {
    const rows = [row("growth", "unsupported"), row("thunderbolt", "calculated"), row("swordsdance", "status")];
    expect(filterMoveResults(rows, "", "status").map((result) => result.moveId)).toEqual(["growth", "swordsdance"]);
    expect(filterMoveResults(rows, "", "damaging").map((result) => result.moveId)).toEqual(["thunderbolt"]);
    expect(filterMoveResults(rows, " GROWTH ", "all").map((result) => result.moveId)).toEqual(["growth"]);
    expect(filterMoveResults(rows, "", "all")).toHaveLength(3);
  });

  it("uses only mobile cards for SSR, distinguishing known zero damage from unsupported", () => {
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row("thunderbolt", "calculated"), row("growth", "unsupported")],
      contexts: {}, onContextChange: () => undefined,
      sourceMoveCount: 2, abilityId: "blaze", itemId: "",
      attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    }));
    expect(html).toContain('<ul aria-label="Move damage results"');
    expect(html).not.toMatch(/<table\b/);
    expect(html).toContain("0 HP");
    expect(html).toContain("Unranked · Unsupported");
    expect(html).toContain("Coverage not verified.");
    expect(html).toContain("Not estimated");
    expect(html).toContain("2 of 2 source-listed moves accounted for");
    expect(html).toContain("conditional on the move hitting");
    expect(html).toContain("Variable / special");
  });
});
