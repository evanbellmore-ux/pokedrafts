import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import PokemonChooser from "@/app/(app)/calculator/PokemonChooser";
import MechanicControls from "@/app/(app)/calculator/MechanicControls";
import { RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import MoveResults from "@/app/(app)/calculator/MoveResults";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import { createRosterState, type CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { getRosterPanel } from "@/app/(app)/calculator/roster-prep";
import { createBuild, createConditions, validateBuild, withUsualAbility } from "@/app/lib/battle/model";
import { usualAbility } from "@/app/lib/battle/move-defaults";
import { createBattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveDamageResult, NativeCatalog } from "@/app/lib/battle/types";
import svCatalog from "@/data/battle/scarlet_violet/catalog.json";

// The shared components' 2v2 props: each is optional, so 1v1 (which passes none) renders exactly as before.

const viewport = vi.hoisted(() => ({ wide: false }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => viewport.wide }));

const sv = createBattleRuntime(svCatalog as NativeCatalog, "3".repeat(64));
const usual = (id: string, abilityId?: string): BattleBuild => {
  const build = withUsualAbility(createBuild(id), usualAbility(id, "Doubles"));
  return abilityId ? { ...build, abilityId, abilityActive: false } : build;
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

function loaded(): CalculatorRosterState {
  return {
    ...createRosterState(), status: "ready", userId: "account", selectedLeagueId: "league", opponentId: "away", teamsStatus: "ready",
    leagues: [{ id: "league", name: "Fixture league", memberId: "home", teamName: "Home", draftStarted: true, draftCompleted: true }],
    data: {
      leagueId: "league",
      members: [{ id: "home", role: "coach", team_name: "Home", draft_position: 1 }, { id: "away", role: "coach", team_name: "Away", draft_position: 2 }],
      teams: [["Charizard", "Garchomp", "Venusaur"], ["Blastoise"]].map((names, index) => ({
        id: `roster-${index}`, member_id: index ? "away" : "home", team_name: null, role: null, total_points: names.length * 15,
        pokemon: names.map((name, position) => ({ name, points: 15, tier: 1, pick_number: position + 1, acquired: "draft" as const })),
      })),
    },
  };
}

describe("PokemonPanel 2v2 props", () => {
  const panel = (build: BattleBuild, props: Partial<ComponentProps<typeof PokemonPanel>> = {}) => render(createElement(PokemonPanel, {
    side: "attacker", build, issues: validateBuild(build), onChange: vi.fn(), hpInput: "", onHPChange: vi.fn(), ...props,
  }));

  it("keeps the 1v1 labels without them", () => {
    const html = panel(usual("incineroar", "intimidate"), { onApplyIntimidate: vi.fn() });
    expect(html).toContain("left Attack Stat Points");
    expect(html).toContain('aria-label="Left Pokémon stats and Stat Points"');
    // No side in the text: 1v1 passes the other Pokémon's name ("Apply Intimidate to Blastoise").
    expect(html).toContain(">Apply Intimidate</button>");
    expect(panel(usual("incineroar", "intimidate"), { side: "defender", onApplyIntimidate: vi.fn() })).toContain(">Apply Intimidate</button>");
    expect(panel(usual("gardevoir", "trace"))).toContain("<option value=\"\" selected=\"\">The other Pokémon’s ability</option>");
    // The props' 1v1 values give the same markup.
    expect(panel(usual("incineroar", "intimidate"), { onApplyIntimidate: vi.fn(), position: "left", intimidateLabel: "Apply Intimidate" })).toBe(html);
    expect(panel(usual("charizard", "plus"), { abilityActivationFact: null })).toBe(panel(usual("charizard", "plus")));
    expect(panel(usual("gardevoir", "trace"), { tracedUnsetLabel: "The other Pokémon’s ability" })).toBe(panel(usual("gardevoir", "trace")));
  });

  it("names the slot, the Intimidate targets, the Trace choice and the ally's Plus / Minus", () => {
    const html = panel(usual("incineroar", "intimidate"), { position: "your left", intimidateLabel: "Apply Intimidate to both foes", onApplyIntimidate: vi.fn() });
    expect(html).toContain("your left Attack Stat Points");
    expect(html).toContain("your left Speed stage");
    expect(html).toContain('aria-label="Your left Pokémon stats and Stat Points"');
    expect(html).toContain("Apply Intimidate to both foes");
    expect(html).not.toContain("Apply Intimidate to the");
    expect(panel(usual("gardevoir", "trace"), { tracedUnsetLabel: "Not chosen" })).toContain("<option value=\"\" selected=\"\">Not chosen</option>");
    const plus = panel(usual("charizard", "plus"));
    expect(plus).toMatch(/-ability-active" type="checkbox"/);
    const fact = panel(usual("charizard", "plus"), { abilityActivationFact: "Ally Minun has Minus." });
    expect(fact).not.toMatch(/-ability-active/);
    expect(fact).toContain('<p data-ability-activation-fact="true" class="text-xs text-muted">Ally Minun has Minus.</p>');
  });
});

describe("PokemonChooser and MechanicControls 2v2 props", () => {
  const chooser = (props: Partial<ComponentProps<typeof PokemonChooser>> = {}) => render(createElement(PokemonChooser, {
    side: "attacker", build: usual("charizard"), open: true, onClose: vi.fn(), onChange: vi.fn(), ...props,
  }));

  it("names the Pokémon, not its side, in 1v1 visible text, keeps the side in accessible names, and names the slot with the props", () => {
    const html = chooser();
    expect(text(html)).toContain("Change Charizard");
    expect(text(html)).toContain("Find Pokémon");
    expect(text(html)).not.toMatch(/\b(left|right|Left|Right)\b/);
    expect(html).toContain('aria-label="Left Pokémon choices"');
    expect(html).toContain('aria-label="Next left Pokémon page"');
    expect(chooser({ label: "Left Pokémon" })).toBe(html);
    const right = chooser({ side: "defender" });
    expect(text(right)).toContain("Change Charizard");
    expect(right).toContain('aria-label="Right Pokémon choices"');
    const slot = chooser({ position: "opponent's right", label: "Opponent's right Pokémon" });
    expect(text(slot)).toContain("Change opponent's right Pokémon");
    expect(text(slot)).toContain("Find opponent's right Pokémon");
    expect(slot).toContain('aria-label="Opponent&#x27;s right Pokémon choices"');
    expect(slot).toContain('aria-label="Next opponent&#x27;s right Pokémon page"');
  });

  it("labels the battle mechanics with the slot", () => {
    const build = withUsualAbility(createBuild("garchomp", sv), usualAbility("garchomp", "Doubles", sv));
    expect(render(createElement(MechanicControls, { build, runtime: sv, position: "your left", onToggle: vi.fn() }))).toContain('aria-label="Garchomp your left Tera"');
    expect(render(createElement(MechanicControls, { build, runtime: sv, position: "right", onToggle: vi.fn() }))).toContain('aria-label="Garchomp right Tera"');
  });
});

describe("RosterPicker 2v2 props", () => {
  const state = loaded();
  const own = getRosterPanel(state, "own").choices;
  const picker = (props: Partial<ComponentProps<typeof RosterPicker>> = {}) => render(createElement(RosterPicker, {
    state, role: "own", side: "attacker", activeSource: own[0].source, onSelect: vi.fn(), ...props,
  }));

  it("keeps the 1v1 labels without them", () => {
    const html = picker();
    expect(html).toContain('aria-label="Use Garchomp as the left Pokémon from your team"');
    expect(html).toContain("<span class=\"sr-only\"> · Left Pokémon</span>");
    expect(html).toContain('aria-label="Your team left roster"');
    expect(html).toContain('data-calculator-roster="attacker"');
    expect(picker({ isDisabled: () => null })).toBe(html);
    expect(picker({ variant: "rail", isDisabled: () => null })).toBe(picker({ variant: "rail" }));
  });

  it("names a 2v2 slot and disables the ally's active choice with its reason", () => {
    const html = picker({ side: "own-right", position: "your right", label: "Your right Pokémon", activeSource: own[1].source,
      isDisabled: (choice) => choice.source?.key === own[0].source?.key ? "Active as your left Pokémon." : null });
    expect(html).toContain('data-calculator-roster="own-right"');
    expect(html).toContain('aria-label="Use Garchomp as your right Pokémon from your team"');
    expect(html).toContain("<span class=\"sr-only\"> · Your right Pokémon</span>");
    expect(html).toContain('aria-label="Your team roster for your right"');
    const charizard = html.match(/<button[^>]*data-roster-choice="[^"]+"[^>]*aria-label="Use Charizard[^"]*"[^>]*>/)?.[0];
    expect(charizard).toMatch(/disabled=""/);
    const reason = charizard?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<p id="${reason}" class="mt-1 wrap-anywhere text-xs text-muted">Active as your left Pokémon.</p>`);
    expect(html.match(/<button[^>]*aria-label="Use Garchomp[^"]*"[^>]*>/)?.[0]).not.toMatch(/disabled=""/);
  });

  it("gives each choice one button per slot on the 2v2 rail", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const html = picker({ variant: "rail", side: "own", pickerId: "own-rail", slots: [
      { id: "own-left", position: "your left", activeSource: own[0].source, onSelect: onLeft },
      { id: "own-right", position: "your right", activeSource: own[1].source, onSelect: onRight },
    ] });
    expect(html).toMatch(/^<div id="own-rail" data-calculator-roster="own"/);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(6);
    expect(buttons.map((tag) => [tag.match(/aria-label="Use (\w+) as ([^"]+) Pokémon from your team"/)?.slice(1), tag.match(/data-roster-slot="([^"]+)"/)?.[1], /aria-pressed="true"/.test(tag), /disabled=""/.test(tag)]))
      .toEqual([
        [["Charizard", "your left"], "own-left", true, false], [["Charizard", "your right"], "own-right", false, true],
        [["Garchomp", "your left"], "own-left", false, true], [["Garchomp", "your right"], "own-right", true, false],
        [["Venusaur", "your left"], "own-left", false, false], [["Venusaur", "your right"], "own-right", false, false],
      ]);
    expect(buttons.every((tag) => /data-roster-choice="[^"]+"/.test(tag))).toBe(true);
    expect(text(html)).toContain("Active as your left Pokémon.");
    expect(text(html)).toContain("Active as your right Pokémon.");
    expect(html.match(/<span class="block wrap-anywhere font-medium text-text">Charizard<\/span>/g)).toHaveLength(1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    for (const [, id] of html.matchAll(/aria-(?:describedby|labelledby)="([^"]+)"/g)) expect(ids).toContain(id);
  });
});

describe("MoveResults 2v2 props", () => {
  const needsOrder: MoveDamageResult = { moveId: "flashcannon", kind: "needs-context", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: "", assumptions: [], reason: "Analytic: needs the Doubles turn order.", hits: null };
  const results = (props: Partial<ComponentProps<typeof MoveResults>> = {}) => {
    const sourceBuild = usual("magnezone", "analytic");
    return render(createElement(MoveResults, {
      rows: [needsOrder], moveIds: ["flashcannon"], ownerId: "0:0", selectedMoveId: "flashcannon", onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: sourceBuild.abilityId, itemId: sourceBuild.itemId, attackerName: "Magnezone", defenderName: "Blastoise", defenderHP: 154,
      sourceBuild, gameType: "Doubles", ...props,
    }));
  };

  it("keeps the 1v1 heading and the turn-order choice without them", () => {
    for (const wide of [false, true]) {
      viewport.wide = wide;
      const html = results();
      // 1v1 names the two Pokémon only (no left/right); positions (2v2 slots, a 1v1 mirror's teams) follow the names.
      expect(text(html)).toContain("Magnezone → Blastoise (154 current HP).");
      expect(text(html)).toContain("Turn order for Analytic");
      expect(results({ turnOrderFromTurn: false })).toBe(html);
      expect(text(results({ positions: { source: "yours", receiver: "opponent's" } }))).toContain("Magnezone (yours) → Blastoise (opponent's) (154 current HP).");
    }
    viewport.wide = false;
  });

  it("names the 2v2 slots and leaves the order to the turn", () => {
    expect(results({ heading: "Moves" })).toBe(results());
    const html = results({ positions: { source: "your left", receiver: "left foe" }, turnOrderFromTurn: true, heading: "Moves" });
    expect(text(html)).toContain("Magnezone (your left) → Blastoise (left foe) (154 current HP).");
    expect(html).toMatch(/<h2 id="[^"]+-heading"[^>]*>Moves<\/h2>/);
    expect(html).not.toContain("Turn order for Analytic");
    expect(html).not.toMatch(/-turn-order"/);
  });
});

describe("BattleConditions 2v2 variant", () => {
  const field = createConditions();
  const conditions = (props: Partial<ComponentProps<typeof BattleConditions>> = {}) => render(createElement(BattleConditions, { value: field, issues: [], onChange: vi.fn(), ...props }));
  const note = (html: string) => html.slice(html.indexOf('<div role="note"'));

  it("keeps the 1v1 editor without it", () => {
    const html = conditions();
    expect(conditions({ variant: "matchup" })).toBe(html);
    for (const key of ["game-type", "spread", "fairyAura", "attackerSide-helpingHand", "defenderSide-friendGuard", "attackerSide-priorityShield", "defenderSide-protect", "attackerSide-charge"]) {
      expect(html).toMatch(new RegExp(`id="[^"]+-${key}"`));
    }
  });

  it("leaves out what the four Pokémon and their moves decide, with a Charge per Pokémon in its side", () => {
    const onCharge = vi.fn();
    const html = conditions({ variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" }, charge: [
      { slot: "own-left", side: "attackerSide", name: "Charizard", checked: true, onChange: onCharge },
      { slot: "own-right", side: "attackerSide", name: "Venusaur", checked: false, onChange: onCharge },
      { slot: "opponent-left", side: "defenderSide", name: "Blastoise", checked: false, onChange: onCharge },
      { slot: "opponent-right", side: "defenderSide", name: "Pikachu", checked: false, onChange: onCharge },
    ] });
    for (const key of ["game-type", "spread", "fairyAura", "helpingHand", "friendGuard", "priorityShield", "protect", "charge"]) {
      expect(html).not.toMatch(new RegExp(`id="[^"]+-(?:attackerSide-|defenderSide-)?${key}"`));
    }
    for (const side of ["attackerSide", "defenderSide"]) {
      for (const key of ["reflect", "lightScreen", "auroraVeil", "tailwind"]) expect(html).toMatch(new RegExp(`id="[^"]+-${side}-${key}"`));
    }
    for (const key of ["weather", "terrain", "critical", "gravity", "trickRoom", "wonderRoom", "magicRoom"]) expect(html).toMatch(new RegExp(`id="[^"]+-${key}"`));
    const sides = html.split("<fieldset").slice(-2);
    expect(sides[0]).toMatch(/^[^>]*><legend[^>]*>Your side<\/legend>[\s\S]*Charge: Charizard[\s\S]*Charge: Venusaur/);
    expect(sides[0]).not.toContain("Charge: Blastoise");
    expect(sides[1]).toMatch(/^[^>]*><legend[^>]*>Opponent&#x27;s side<\/legend>[\s\S]*Charge: Blastoise[\s\S]*Charge: Pikachu/);
    expect(html).toMatch(/data-doubles-charge="own-left"[^>]*checked=""/);
    expect(note(html)).toBe(note(conditions()));
    expect(note(html)).toContain("Battle states that cannot be set here");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  });
});
