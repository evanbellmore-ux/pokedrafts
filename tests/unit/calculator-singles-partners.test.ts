import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions, withoutSinglesPartners } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Reference rolls from pinned Showdown c23d2e94's real move pipeline (field-core ref.ts),
 * level 50, 0 Stat Points, Serious nature. In Singles, Helping Hand fails with [notarget] and
 * no ally or third Pokémon can supply Plus/Minus or Fairy Aura; Doubles used real allies.
 */
function conditions(gameType: BattleConditions["gameType"], extra: { helpingHand?: boolean; fairyAura?: boolean } = {}): BattleConditions {
  const base = createConditions();
  return { ...base, gameType, multipleTargets: false, fairyAura: !!extra.fairyAura, attackerSide: { ...base.attackerSide, helpingHand: !!extra.helpingHand } };
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: BattleConditions) {
  const out = calculateMatchup(attacker, defender, field);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const garchomp = createBuild("garchomp");
const ampharos = (active: boolean) => ({ ...createBuild("ampharos"), abilityId: "plus", abilityActive: active });

describe("ally-only settings in Singles", () => {
  it.each<[string, string, BattleBuild, BattleBuild, { helpingHand?: boolean; fairyAura?: boolean }, number, number, string]>([
    ["Helping Hand", "earthquake", garchomp, createBuild("incineroar"), { helpingHand: true }, 156, 186, "Helping Hand"],
    ["Additional Fairy Aura", "moonblast", createBuild("clefable"), garchomp, { fairyAura: true }, 116, 140, "Additional Fairy Aura on the field"],
    ["a Plus partner", "thunderbolt", ampharos(true), createBuild("meganium"), {}, 29, 34, "the Plus/Minus partner"],
  ])("ignores %s and says so", (_label, moveId, attacker, defender, extra, min, max, name) => {
    const ignored = row(moveId, attacker, defender, conditions("Singles", extra));
    expect(ignored).toMatchObject({ kind: "calculated", min, max });
    expect(ignored.assumptions).toContain(`Singles: ${name} is ignored.`);
    const plain = row(moveId, { ...attacker, abilityActive: false }, defender, conditions("Singles"));
    expect(plain.rolls).toEqual(ignored.rolls);
    expect(plain.assumptions.some((line) => line.startsWith("Singles:"))).toBe(false);
  });

  it.each<[string, string, BattleBuild, BattleBuild, { helpingHand?: boolean; fairyAura?: boolean }, number, number]>([
    ["Helping Hand", "dragonclaw", garchomp, createBuild("incineroar"), { helpingHand: true }, 93, 111],
    ["a Fairy Aura partner", "moonblast", createBuild("clefable"), garchomp, { fairyAura: true }, 156, 186],
    ["a Plus partner", "thunderbolt", ampharos(true), createBuild("meganium"), {}, 42, 51],
  ])("still applies %s in Doubles", (_label, moveId, attacker, defender, extra, min, max) => {
    const applied = row(moveId, attacker, defender, conditions("Doubles", extra));
    expect(applied).toMatchObject({ kind: "calculated", min, max });
    expect(applied.assumptions.some((line) => line.startsWith("Singles:"))).toBe(false);
  });

  it("lists every ignored setting once and leaves Doubles untouched", () => {
    const field = { ...conditions("Singles", { helpingHand: true, fairyAura: true }), defenderSide: { ...createConditions().defenderSide, helpingHand: true } };
    const result = withoutSinglesPartners(field, ampharos(true), createBuild("meganium"));
    expect(result.ignored).toEqual(["Helping Hand", "Additional Fairy Aura on the field", "the Plus/Minus partner"]);
    expect(result.field).toMatchObject({ fairyAura: false, attackerSide: { helpingHand: false }, defenderSide: { helpingHand: false } });
    expect(result.attacker.abilityActive).toBe(false);
    expect(row("thunderbolt", ampharos(true), createBuild("meganium"), field).assumptions)
      .toContain("Singles: Helping Hand, Additional Fairy Aura on the field and the Plus/Minus partner are ignored.");
    const doubles = conditions("Doubles", { helpingHand: true });
    const attacker = ampharos(true);
    expect(withoutSinglesPartners(doubles, attacker, garchomp)).toMatchObject({ field: doubles, attacker, ignored: [] });
  });
});

describe("Plus/Minus condition control", () => {
  const render = (gameType: "Singles" | "Doubles") => renderToStaticMarkup(createElement(PokemonPanel, {
    side: "attacker", build: ampharos(true), issues: [], onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(), gameType,
  }));
  const checkbox = (html: string) => html.match(/<input\b[^>]*id="[^"]*-ability-active"[^>]*>/)?.[0];

  it("is disabled with an explanation in Singles", () => {
    const html = render("Singles");
    expect(checkbox(html)).toContain('disabled=""');
    expect(html).toContain("Singles has no ally, so this condition is ignored.");
  });

  it("stays available in Doubles", () => {
    const html = render("Doubles");
    expect(checkbox(html)).not.toContain('disabled=""');
    expect(html).not.toContain("Singles has no ally");
  });
});
