import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CalculatorClient, { createMatchup, swapMatchup } from "@/app/(app)/calculator/CalculatorClient";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import PokemonPanel, { parseBuildInput } from "@/app/(app)/calculator/PokemonPanel";
import MoveResults, { filterMoveResults } from "@/app/(app)/calculator/MoveResults";
import { createBuild, createConditions, SHARED_FIELD_EFFECTS, validateBuild, validateConditions } from "@/app/lib/battle/model";
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
    for (const [, references] of html.matchAll(/\baria-describedby="([^"]+)"/g)) {
      for (const reference of references.split(" ")) expect(ids).toContain(reference);
    }
    expect(html).not.toMatch(/<main\b/);
    expect(html).toContain("Loading the Champions engine");
    expect(html).toContain("Damage Calculator");
    expect(html).toContain("Prepare a league matchup");
    expect(html).toContain("Loading your leagues");
    expect([...html.matchAll(/Manual build/g)]).toHaveLength(2);
    expect(html).toContain("Change attacker Pokémon");
    expect(html).toContain("Change defender Pokémon");
  });

  it("opens field controls initially and exposes all requested effects without duplicates", () => {
    const html = renderToStaticMarkup(createElement(BattleConditions, { value: createConditions(), issues: [], onChange: () => undefined }));
    expect(html).toMatch(/^<details\b[^>]*open=""/);
    expect(html).toContain("1 toggles on");
    for (const { key, label } of SHARED_FIELD_EFFECTS) {
      const inputs = [...html.matchAll(new RegExp(`<input\\b[^>]*id="[^"]*-${key}"[^>]*>`, "g"))];
      expect(inputs).toHaveLength(1);
      expect(inputs[0][0]).not.toContain('checked=""');
      expect(html).toContain(label);
    }
    for (const weather of ["Sun", "Rain", "Sand", "Snow"]) {
      expect(html).toContain(`<option value="${weather}">${weather}</option>`);
    }
    for (const side of ["attackerSide", "defenderSide"]) {
      for (const effect of ["reflect", "lightScreen", "auroraVeil", "helpingHand"]) {
        expect(html).toMatch(new RegExp(`id="[^"]*-${side}-${effect}"`));
      }
    }
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(15);
  });

  it("counts shared and side toggles and retains Aurora Veil without Snow", () => {
    const field = createConditions();
    for (const { key } of SHARED_FIELD_EFFECTS) field[key] = true;
    field.critical = true;
    field.attackerSide.helpingHand = true;
    field.defenderSide.auroraVeil = true;
    const render = () => renderToStaticMarkup(createElement(BattleConditions, { value: field, issues: [], onChange: () => undefined }));
    const html = render();
    expect(html).toContain("9 toggles on");
    expect(html).toContain("No weather");
    const veil = html.match(/<input\b[^>]*id="[^"]*-defenderSide-auroraVeil"[^>]*>/)?.[0];
    expect(veil).toContain('checked=""');
    expect(veil).not.toContain("disabled");
    field.gameType = "Singles";
    expect(render()).toContain("8 toggles on");
  });

  it("associates shared-effect help and validation errors with their checkbox", () => {
    const field = { ...createConditions(), gravity: "on" as unknown as boolean };
    const html = renderToStaticMarkup(createElement(BattleConditions, { value: field, issues: validateConditions(field), onChange: () => undefined }));
    const input = html.match(/<input\b[^>]*id="[^"]*-gravity"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).toContain('aria-invalid="true"');
    expect(input).not.toContain('checked=""');
    const describedBy = input!.match(/aria-describedby="([^"]+)"/)?.[1].split(" ");
    expect(describedBy).toHaveLength(2);
    for (const id of describedBy!) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Gravity must be on or off.");
    expect(html).toContain("Accuracy changes are not simulated");
  });

  it("swaps builds and side conditions while retaining shared effects and clearing hit counts", () => {
    const current = createMatchup(4);
    current.attacker.build.points.spa = 32;
    current.contexts = { bulletseed: { hits: 3 } };
    current.field.weather = "Snow";
    current.field.terrain = "Electric";
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.reflect = true;
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    const before = structuredClone(current);
    const swapped = swapMatchup(current);
    expect(swapped.attacker).toBe(current.defender);
    expect(swapped.defender).toBe(current.attacker);
    expect(swapped.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(swapped.contexts).toEqual({});
    expect(swapped.revision).toBe(current.revision);
    expect(current).toEqual(before);
    const restored = swapMatchup(swapped);
    expect(restored.attacker).toBe(current.attacker);
    expect(restored.defender).toBe(current.defender);
    expect(restored.field).toEqual(current.field);
  });

  it("resets all effects, builds and hit counts with new raw-input keys", () => {
    const current = createMatchup(4);
    current.attacker.build.points.spa = 32;
    current.contexts = { bulletseed: { hits: 3 } };
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.attackerSide.helpingHand = true;
    const reset = createMatchup(current.revision + 1);
    expect(reset.field).toEqual(createConditions());
    expect(reset.attacker.build).toEqual(createBuild("charizard"));
    expect(reset.defender.build).toEqual(createBuild("blastoise"));
    expect(reset.contexts).toEqual({});
    expect(reset.attacker.key).not.toBe(current.attacker.key);
    expect(reset.defender.key).not.toBe(current.defender.key);
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
