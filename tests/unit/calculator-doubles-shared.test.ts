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
import { positionalIn } from "../fixtures/naming";

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

  it("names the Pokémon by its species without them", () => {
    const html = panel(usual("incineroar", "intimidate"), { onApplyIntimidate: vi.fn() });
    expect(html).toContain("Incineroar Attack Stat Points");
    expect(html).toContain('aria-label="Incineroar stats and Stat Points"');
    expect(positionalIn(html)).toEqual([]);
    // No side in the text: 1v1 passes the other Pokémon's name ("Apply Intimidate to Blastoise").
    expect(html).toContain(">Apply Intimidate</button>");
    expect(panel(usual("incineroar", "intimidate"), { side: "defender", onApplyIntimidate: vi.fn() })).toContain(">Apply Intimidate</button>");
    expect(panel(usual("gardevoir", "trace"))).toContain("<option value=\"\" selected=\"\">The other Pokémon’s ability</option>");
    // The props' 1v1 values give the same markup.
    expect(panel(usual("incineroar", "intimidate"), { onApplyIntimidate: vi.fn(), label: "Incineroar", intimidateLabel: "Apply Intimidate" })).toBe(html);
    expect(panel(usual("charizard", "plus"), { abilityActivationFact: null })).toBe(panel(usual("charizard", "plus")));
    expect(panel(usual("gardevoir", "trace"), { tracedUnsetLabel: "The other Pokémon’s ability" })).toBe(panel(usual("gardevoir", "trace")));
  });

  it("names the Pokémon by its full name, the Intimidate targets, the Trace choice and the ally's Plus / Minus", () => {
    const html = panel(usual("incineroar", "intimidate"), { label: "Incineroar (yours)", intimidateLabel: "Apply Intimidate to both foes", onApplyIntimidate: vi.fn() });
    expect(html).toContain("Incineroar (yours) Attack Stat Points");
    expect(html).toContain("Incineroar (yours) Speed stage");
    expect(html).toContain('aria-label="Incineroar (yours) stats and Stat Points"');
    expect(positionalIn(html)).toEqual([]);
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
    build: usual("charizard"), open: true, onClose: vi.fn(), onChange: vi.fn(), ...props,
  }));

  it("names the Pokémon in its title, and no side or place anywhere", () => {
    const html = chooser();
    expect(text(html)).toContain("Change Charizard");
    expect(text(html)).toContain("Find Pokémon");
    expect(text(html)).not.toMatch(/\b(left|right|Left|Right)\b/);
    expect(positionalIn(html)).toEqual([]);
    expect(html).toContain('aria-label="Pokémon choices"');
    expect(html).toContain('aria-label="Previous Pokémon page"');
    expect(html).toContain('aria-label="Next Pokémon page"');
    // 2v2 passes the full name for its change notice only (empty until a change): the dialog is the same.
    expect(chooser({ label: "Charizard (yours)" })).toBe(html);
  });

  it("labels the battle mechanics with the Pokémon's name", () => {
    const build = withUsualAbility(createBuild("garchomp", sv), usualAbility("garchomp", "Doubles", sv));
    const plain = render(createElement(MechanicControls, { build, runtime: sv, onToggle: vi.fn() }));
    expect(plain).toContain('aria-label="Garchomp Tera"');
    expect(plain).toContain('aria-label="Garchomp battle mechanics"');
    expect(render(createElement(MechanicControls, { build, runtime: sv, label: "Garchomp (opponent's)", onToggle: vi.fn() }))).toContain('aria-label="Garchomp (opponent&#x27;s) Tera"');
  });
});

describe("RosterPicker 2v2 props", () => {
  const state = loaded();
  const own = getRosterPanel(state, "own").choices;
  const picker = (props: Partial<ComponentProps<typeof RosterPicker>> = {}) => render(createElement(RosterPicker, {
    state, role: "own", side: "attacker", occupant: "Charizard", activeSource: own[0].source, onSelect: vi.fn(), ...props,
  } as ComponentProps<typeof RosterPicker>));

  it("names the Pokémon a pick replaces in 1v1", () => {
    const html = picker();
    expect(html).toContain('aria-label="Use Garchomp from your team in place of Charizard"');
    expect(html).toContain('aria-label="Charizard from your team, active"');
    expect(html).toContain("<span class=\"sr-only\"> · Charizard</span>");
    expect(html).toContain('aria-label="Your team roster for Charizard"');
    expect(html).toContain('data-calculator-roster="attacker"');
    expect(positionalIn(html)).toEqual([]);
    expect(picker({ isDisabled: () => null })).toBe(html);
    expect(picker({ variant: "rail", isDisabled: () => null })).toBe(picker({ variant: "rail" }));
  });

  it("names the Pokémon a 2v2 pick replaces and disables the ally's active choice with its reason", () => {
    const html = picker({ side: "own-right", occupant: "Venusaur", activeSource: own[2].source,
      isDisabled: (choice) => choice.source?.key === own[0].source?.key ? "Active as Venusaur's ally." : null });
    expect(html).toContain('data-calculator-roster="own-right"');
    expect(html).toContain('aria-label="Use Garchomp from your team in place of Venusaur"');
    expect(html).toContain('aria-label="Venusaur from your team, active"');
    expect(html).toContain("<span class=\"sr-only\"> · Venusaur</span>");
    expect(html).toContain('aria-label="Your team roster for Venusaur"');
    const charizard = html.match(/<button[^>]*data-roster-choice="[^"]+"[^>]*aria-label="Use Charizard[^"]*"[^>]*>/)?.[0];
    expect(charizard).toMatch(/disabled=""/);
    const reason = charizard?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<p id="${reason}" class="mt-1 wrap-anywhere text-xs text-muted">Active as Venusaur&#x27;s ally.</p>`);
    expect(html.match(/<button[^>]*aria-label="Use Garchomp[^"]*"[^>]*>/)?.[0]).not.toMatch(/disabled=""/);
    expect(positionalIn(html)).toEqual([]);
  });

  /** The rail's slot buttons: [choice, slot, accessible name, visible text, pressed, disabled]. */
  const railButtons = (html: string) => [...html.matchAll(/<button([^>]*)><span[^>]*>([^<]*)<\/span><\/button>/g)].map(([, tag, label]) => [
    tag.match(/data-roster-choice="own-([^"]+)"/)?.[1] ?? tag.match(/data-roster-choice="([^"]+)"/)?.[1], tag.match(/data-roster-slot="([^"]+)"/)?.[1],
    tag.match(/aria-label="([^"]+)"/)?.[1], label, /aria-pressed="true"/.test(tag), /disabled=""/.test(tag),
  ]);

  it("gives each choice one button per slot on the 2v2 rail, named by the card it replaces", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const html = picker({ variant: "rail", side: "own", pickerId: "own-rail", occupant: undefined, slots: [
      { id: "own-left", occupant: "Charizard", card: "Charizard", activeSource: own[0].source, onSelect: onLeft },
      { id: "own-right", occupant: "Venusaur", card: "Venusaur", activeSource: own[2].source, onSelect: onRight },
    ] });
    expect(html).toMatch(/^<div id="own-rail" data-calculator-roster="own"/);
    const buttons = railButtons(html);
    expect(buttons).toHaveLength(6);
    expect(buttons.map(([, slot, name, label, pressed, disabled]) => [slot, name, label, pressed, disabled])).toEqual([
      ["own-left", "Active: Charizard from your team", "Active", true, false],
      ["own-right", "Replace Venusaur with Charizard from your team", "Replace Venusaur", false, true],
      ["own-left", "Replace Charizard with Garchomp from your team", "Replace Charizard", false, false],
      ["own-right", "Replace Venusaur with Garchomp from your team", "Replace Venusaur", false, false],
      ["own-left", "Replace Charizard with Venusaur from your team", "Replace Charizard", false, true],
      ["own-right", "Active: Venusaur from your team", "Active", true, false],
    ]);
    // Label in name: each button's accessible name holds its visible text.
    for (const [, , name, label] of buttons) expect(String(name)).toContain(String(label));
    expect(buttons.every(([choice]) => !!choice)).toBe(true);
    // Each entry's group is named after its buttons, never by a bare species name a card or Field conditions group also has (review CALC-3).
    expect([...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(["Charizard from your team", "Garchomp from your team", "Venusaur from your team"]);
    expect(text(html)).not.toContain("Active as");
    expect(positionalIn(html)).toEqual([]);
    expect(html.match(/<span class="block wrap-anywhere font-medium text-text">Charizard<\/span>/g)).toHaveLength(1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    for (const [, id] of html.matchAll(/aria-(?:describedby|labelledby)="([^"]+)"/g)) expect(ids).toContain(id);
  });

  it("names a rail's buttons by the cards' numbers when one side shows a species twice", () => {
    const html = picker({ variant: "rail", side: "own", pickerId: "own-rail", occupant: undefined, slots: [
      { id: "own-left", occupant: "Garchomp (yours, 1)", card: "Garchomp (1)", activeSource: null, onSelect: vi.fn() },
      { id: "own-right", occupant: "Garchomp (yours, 2)", card: "Garchomp (2)", activeSource: null, onSelect: vi.fn() },
    ] });
    const charizard = railButtons(html).filter(([, , name]) => String(name).endsWith("with Charizard from your team"));
    expect(charizard.map(([, , name, label]) => [name, label])).toEqual([
      ["Replace Garchomp (1) with Charizard from your team", "Replace Garchomp (1)"],
      ["Replace Garchomp (2) with Charizard from your team", "Replace Garchomp (2)"],
    ]);
    // The rail is one team's: its buttons need no side word, and each still differs.
    const names = railButtons(html).map(([, , name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(positionalIn(html)).toEqual([]);
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
      // 1v1 names the two Pokémon only; a 1v1 mirror's full names (roster-prep matchupNames) carry their teams.
      expect(text(html)).toContain("Magnezone → Blastoise (154 current HP).");
      expect(text(html)).toContain("Turn order for Analytic");
      expect(results({ turnOrderFromTurn: false })).toBe(html);
      expect(text(results({ attackerName: "Magnezone (yours)", defenderName: "Magnezone (opponent's)" }))).toContain("Magnezone (yours) → Magnezone (opponent's) (154 current HP).");
    }
    viewport.wide = false;
  });

  it("names the 2v2 Pokémon by their full names and leaves the order to the turn", () => {
    expect(results({ heading: "Moves" })).toBe(results());
    const html = results({ attackerName: "Magnezone", defenderName: "Blastoise", turnOrderFromTurn: true, heading: "Moves" });
    expect(text(html)).toContain("Magnezone → Blastoise (154 current HP).");
    expect(text(results({ attackerName: "Magnezone (yours)", defenderName: "Magnezone (opponent's)", turnOrderFromTurn: true }))).toContain("Magnezone (yours) → Magnezone (opponent's) (154 current HP).");
    expect(positionalIn(html)).toEqual([]);
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

  it("names each 1v1 side after its Pokémon, with no position", () => {
    const legends = (html: string) => [...html.matchAll(/<legend class="px-1 text-xs font-semibold text-text">([^<]*)<\/legend>/g)].map((match) => match[1]);
    const named = conditions({ names: { attackerSide: "Charizard", defenderSide: "Blastoise" } });
    expect(legends(named)).toEqual(["Shared field effects", "Charizard’s side", "Blastoise’s side"]);
    expect(legends(conditions())).toEqual(["Shared field effects", "Pokémon’s side", "Pokémon’s side"]);
    // A mirror's legends come from CalculatorClient (sideLegends), which names each one's team.
    expect(legends(conditions({ names: { attackerSide: "Charizard", defenderSide: "Charizard" }, sideLegends: { attackerSide: "Charizard’s side (yours)", defenderSide: "Charizard’s side (opponent's)" } })))
      .toEqual(["Shared field effects", "Charizard’s side (yours)", "Charizard’s side (opponent&#x27;s)"]);
    expect(positionalIn(named)).toEqual([]);
    expect(positionalIn(conditions())).toEqual([]);
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
