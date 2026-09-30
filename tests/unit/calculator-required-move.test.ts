import { createElement, type ChangeEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import {
  activateMoveSlot, createMatchup, equipRequiredMove, getAttackView, getMoveOwner, replaceMatchupMove, selectMatchupMove, swapMatchup,
  toggleMatchupMega, updateMatchupBuild, type PreparedMatchup,
} from "@/app/(app)/calculator/roster-prep";
import * as buttonControl from "@/app/components/ui/Button";
import * as selectControl from "@/app/components/ui/Select";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, validateBuild } from "@/app/lib/battle/model";
import { createMoveSlots, describeMoveSlot } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";

// Showdown requiredMove forms in the native catalogs; Champions has none.
const FORMS = [
  ["scarlet_violet", "keldeoresolute", "secretsword"],
  ["scarlet_violet", "meloettapirouette", "relicsong"],
  ["sword_shield", "keldeoresolute", "secretsword"],
  ["ultra_sun_ultra_moon", "keldeoresolute", "secretsword"],
  ["ultra_sun_ultra_moon", "meloettapirouette", "relicsong"],
  ["ultra_sun_ultra_moon", "rayquazamega", "dragonascent"],
] as const;

async function withForm(game: (typeof FORMS)[number][0], speciesId: string): Promise<{ runtime: BattleRuntime; matchup: PreparedMatchup }> {
  const runtime = await loadBattleRuntime(game);
  return { runtime, matchup: updateMatchupBuild(createMatchup(0, runtime), "attacker", createBuild(speciesId, runtime)) };
}

/** Replace the required move in slot 0 with another learnset move, as a user could. */
function withoutRequired(matchup: PreparedMatchup, runtime: BattleRuntime) {
  const slot = matchup.attacker;
  const other = runtime.speciesById.get(slot.build.speciesId)!.moves.find((id) => {
    const move = runtime.movesById.get(id);
    return move && move.category !== "Status" && !move.isZ && !move.isMax && !slot.moves.some((prepared) => prepared.moveId === id);
  })!;
  const active = activateMoveSlot(matchup, getMoveOwner(slot), 0);
  return replaceMatchupMove(active, active.replacement!, other);
}

describe("forms that need a prepared move", () => {
  it("lists exactly these forms, and none in Champions", async () => {
    expect(championsRuntime.catalog.species.filter((species) => species.requiredMove)).toEqual([]);
    for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const runtime = await loadBattleRuntime(game);
      const forms = runtime.catalog.species.filter((species) => species.requiredMove).map((species) => [game, species.id, species.requiredMove]);
      expect(forms).toEqual(FORMS.filter(([formGame]) => formGame === game).map((form) => [...form]));
    }
  });

  it.each(FORMS)("%s %s starts with %s and calculates", async (game, speciesId, requiredMove) => {
    const { runtime, matchup } = await withForm(game, speciesId);
    expect(createMoveSlots(speciesId, "Doubles", runtime)[0]).toEqual({ moveId: requiredMove, origin: "required", gameType: "Doubles" });
    expect(matchup.attacker.moves[0]).toMatchObject({ moveId: requiredMove, origin: "required" });
    expect(validateBuild(matchup.attacker.build, runtime)).toEqual([]);
    const view = getAttackView(matchup);
    const result = calculateMatchup(matchup.attacker.build, matchup.defender.build, view.field, {}, runtime);
    expect(result.results.find((row) => row.moveId === requiredMove)?.kind).toBe("calculated");
  });

  it.each(FORMS)("%s %s explains a missing %s and fixes it from Build settings", async (game, speciesId, requiredMove) => {
    const { runtime, matchup } = await withForm(game, speciesId);
    const missing = withoutRequired(matchup, runtime);
    const issues = validateBuild(missing.attacker.build, runtime);
    expect(issues).toEqual([expect.objectContaining({ field: "preparedMoves" })]);
    const moveName = runtime.movesById.get(requiredMove)!.name;
    const onEquip = vi.fn();
    const html = renderToStaticMarkup(createElement(PokemonPanel, {
      side: "attacker", build: missing.attacker.build, issues, onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(), runtime,
      requiredMove: { name: moveName, slots: missing.attacker.moves.map((slot) => runtime.movesById.get(slot.moveId!)!.name), onEquip },
    }));
    // The message is visible and its select is invalid, so Fix settings focuses it.
    expect(html).toContain(issues[0].message);
    expect(html).toContain(`Quick move to replace with ${moveName}`);
    expect(html.match(/<select\b[^>]*id="[^"]*-required-move"[^>]*>/)?.[0]).toContain('aria-invalid="true"');
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>Replace with ${moveName}</button>`));
    const replaced = runtime.movesById.get(missing.attacker.moves[2].moveId!)!.name;
    const fixed = equipRequiredMove(missing, missing.attacker.key, 2);
    expect(fixed.attacker.moves[2]).toEqual({ moveId: requiredMove, origin: "required", gameType: null });
    expect(fixed.notice).toBe(`${moveName} prepared in quick move 3, replacing ${replaced}.`);
    expect(validateBuild(fixed.attacker.build, runtime)).toEqual([]);
    // Already prepared: no change.
    expect(equipRequiredMove(fixed, fixed.attacker.key, 0)).toBe(fixed);
  });

  it("shows the reason in the summary instead of a generic prompt", async () => {
    const { runtime, matchup } = await withForm("scarlet_violet", "keldeoresolute");
    const missing = withoutRequired(matchup, runtime);
    const view = getAttackView(missing);
    const html = renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: missing.attacker, defender: missing.defender, attack: missing.attack, replacement: missing.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: undefined, rollMode: "average",
      issues: { attacker: validateBuild(missing.attacker.build, runtime), defender: validateBuild(missing.defender.build, runtime) },
      movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime,
    }));
    expect(html).toContain("Keldeo-Resolute requires Secret Sword in its prepared moves.");
    expect(html).not.toContain("Check build settings to show HP");
  });

  it("commits only from the Replace button, not while choosing a slot", async () => {
    const { runtime, matchup } = await withForm("scarlet_violet", "keldeoresolute");
    const missing = withoutRequired(matchup, runtime);
    const selects = vi.spyOn(selectControl, "default");
    const buttons = vi.spyOn(buttonControl, "default");
    try {
      const onEquip = vi.fn();
      renderToStaticMarkup(createElement(PokemonPanel, {
        side: "attacker", build: missing.attacker.build, issues: validateBuild(missing.attacker.build, runtime), onChange: vi.fn(),
        hpInput: "", onHPChange: vi.fn(), runtime, requiredMove: { name: "Secret Sword", slots: ["A", "B", "C", "D"], onEquip },
      }));
      const select = selects.mock.calls.map(([props]) => props).find((props) => String(props.value) === "" && props.children)!;
      select.onChange!({ target: { value: "0" } } as ChangeEvent<HTMLSelectElement>);
      expect(onEquip).not.toHaveBeenCalled();
      const replace = buttons.mock.calls.map(([props]) => props).find((props) => props.children === "Replace with Secret Sword")!;
      expect(replace.disabled).toBe(true);
    } finally {
      selects.mockRestore();
      buttons.mockRestore();
    }
  });

  it("follows the Pokémon by key on either side and only moves a selected attack it replaced", async () => {
    const { runtime, matchup } = await withForm("scarlet_violet", "keldeoresolute");
    const missing = withoutRequired(matchup, runtime);
    // After Swap, Keldeo-Resolute is the defender; its key still finds it.
    const swapped = swapMatchup(missing);
    const onDefender = equipRequiredMove(swapped, missing.attacker.key, 1);
    expect(onDefender.defender.moves[1]).toMatchObject({ moveId: "secretsword", origin: "required" });
    expect(validateBuild(onDefender.defender.build, runtime)).toEqual([]);
    // The replaced move was the selected attack, so the attack follows it.
    const selected = selectMatchupMove(missing, missing.attacker.moves[1].moveId, getMoveOwner(missing.attacker));
    expect(equipRequiredMove(selected, selected.attacker.key, 1).attack.moveId).toBe("secretsword");
    // An empty slot with no selected attack does not select the required move.
    const emptied = { ...missing, attacker: { ...missing.attacker, moves: [missing.attacker.moves[0], { moveId: null, origin: "empty", gameType: null }, missing.attacker.moves[2], missing.attacker.moves[3]] as PreparedMatchup["attacker"]["moves"] } };
    const idle = selectMatchupMove(emptied, null, getMoveOwner(emptied.attacker));
    const intoEmpty = equipRequiredMove(idle, idle.attacker.key, 1);
    expect(intoEmpty.attacker.moves[1].moveId).toBe("secretsword");
    expect(intoEmpty.attack.moveId).toBeNull();
    expect(intoEmpty.notice).toBe("Secret Sword prepared in quick move 2.");
  });

  it("drops the Required label when Rayquaza-Mega reverts to Rayquaza", async () => {
    const { matchup } = await withForm("ultra_sun_ultra_moon", "rayquazamega");
    expect(matchup.attacker.moves[0]).toMatchObject({ moveId: "dragonascent", origin: "required" });
    const reverted = toggleMatchupMega(matchup, getMoveOwner(matchup.attacker), "rayquazamega");
    expect(reverted.attacker.build.speciesId).toBe("rayquaza");
    expect(reverted.attacker.moves[0]).toMatchObject({ moveId: "dragonascent", origin: "manual" });
    // Dragon Ascent stays prepared, so Mega Evolution is still possible.
    expect(toggleMatchupMega(reverted, getMoveOwner(reverted.attacker), "rayquazamega").attacker.build.speciesId).toBe("rayquazamega");
  });

  it("labels the seeded move", async () => {
    const { runtime } = await withForm("scarlet_violet", "keldeoresolute");
    const [slot] = createMoveSlots("keldeoresolute", "Singles", runtime);
    expect(describeMoveSlot(slot)).toBe("Required for this form");
  });
});
