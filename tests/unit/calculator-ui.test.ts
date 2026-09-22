import { createElement, type ChangeEvent, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalculatorClient, { createMatchup, swapMatchup } from "@/app/(app)/calculator/CalculatorClient";
import BattleConditions from "@/app/(app)/calculator/BattleConditions";
import PokemonPanel from "@/app/(app)/calculator/PokemonPanel";
import CurrentHPField from "@/app/(app)/calculator/CurrentHPField";
import { formatHPInput, parseBuildInput } from "@/app/(app)/calculator/build-input";
import MoveResults, { filterMoveResults, MoveDetails } from "@/app/(app)/calculator/MoveResults";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import type { DamageRollMode } from "@/app/(app)/calculator/hp-preview";
import { createRosterState, type CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { activateMoveSlot, getAttackView, getMoveOwner, replaceMatchupMove, selectMatchupMove, updateMatchupBuild, type BattleSide } from "@/app/(app)/calculator/roster-prep";
import * as buttonControl from "@/app/components/ui/Button";
import * as selectControl from "@/app/components/ui/Select";
import { createBuild, createConditions, rankResults, SHARED_FIELD_EFFECTS, validateBuild, validateConditions } from "@/app/lib/battle/model";
import { movesById, speciesById } from "@/app/lib/battle/catalog";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { MoveDamageResult } from "@/app/lib/battle/types";

const viewport = vi.hoisted(() => ({ wide: false, desktop: false }));
const roster = vi.hoisted(() => ({ state: null as CalculatorRosterState | null }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => viewport.wide }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => viewport.desktop }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({
  default: () => ({ state: roster.state ?? createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }),
}));
afterEach(() => { viewport.wide = false; viewport.desktop = false; roster.state = null; });

function loadedRosters(own = ["Charizard", "Blastoise"], opponent = ["Venusaur"]): CalculatorRosterState {
  return {
    ...createRosterState(), status: "ready", userId: "account", selectedLeagueId: "league", opponentId: "away", teamsStatus: "ready",
    leagues: [{ id: "league", name: "Fixture league", memberId: "home", teamName: "Home", draftStarted: true, draftCompleted: true }],
    data: {
      leagueId: "league",
      members: [{ id: "home", role: "coach", team_name: "Home", draft_position: 1 }, { id: "away", role: "coach", team_name: "Away", draft_position: 2 }],
      teams: [own, opponent].map((names, index) => ({
        id: `roster-${index}`, member_id: index ? "away" : "home", team_name: null, role: null, total_points: names.length * 15,
        pokemon: names.map((name, position) => ({ name, points: 15, tier: 1, pick_number: position + 1, acquired: "draft" as const })),
      })),
    },
  };
}

function controlTarget(html: string, label: string) {
  const target = html.match(new RegExp(`aria-label="${label}"[^>]*aria-controls="([^"]+)"`))?.[1];
  expect(target).toBeDefined();
  return target!;
}

function summaryHTML(matchup: ReturnType<typeof createMatchup>, selectedRow?: MoveDamageResult, blockedReason?: string, rollMode: DamageRollMode = "average", overrides: Partial<ComponentProps<typeof MatchupSummary>> = {}) {
  const view = getAttackView(matchup);
  return renderToStaticMarkup(createElement(MatchupSummary, {
    attacker: matchup.attacker, defender: matchup.defender,
    attack: matchup.attack, replacement: matchup.replacement,
    resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow, blockedReason, rollMode,
    issues: { attacker: validateBuild(matchup.attacker.build), defender: validateBuild(matchup.defender.build) },
    movesControl: "moves", onBuildChange: () => undefined, onHPChange: () => undefined, onRosterSelect: () => undefined,
    onShowMove: () => undefined, onRollModeChange: () => undefined, onActivateMove: () => undefined,
    ...overrides,
  }));
}

function position(side: BattleSide) {
  return side === "attacker" ? "left" : "right";
}

function meterHTML(html: string, side: BattleSide) {
  const meter = html.match(new RegExp(`<div role="meter" aria-label="[^"]* ${position(side)} [^"]*"[^>]*>[\\s\\S]*?</div>`))?.[0];
  expect(meter).toBeDefined();
  return meter!;
}

function assertControlLabels(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect(ids).toContain(id);
  }
}

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

  it.each(["", "00100", "abc", "2e1", " ", "0", "155"])("renders shared current HP text %j with maximum-HP help and associated validation", (text) => {
    const build = { ...createBuild("blastoise"), currentHP: parseBuildInput(text, true) };
    const issues = validateBuild(build);
    for (const compact of [false, true]) {
      const onTextChange = vi.fn();
      const html = renderToStaticMarkup(createElement(CurrentHPField, { build, issues, text, onTextChange, compact }));
      expect(html).toContain(`value="${text}"`);
      expect(html).toContain('type="text"');
      expect(html).toContain('inputMode="numeric"');
      expect(html).toContain("Blank means full HP (154).");
      expect(html).toContain('placeholder="Full HP (154)"');
      expect(html.includes('aria-invalid="true"')).toBe(issues.some((issue) => issue.field === "currentHP"));
      for (const issue of issues) expect(html).toContain(issue.message);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      for (const [, references] of html.matchAll(/\baria-describedby="([^"]+)"/g)) {
        for (const reference of references.split(" ")) expect(ids).toContain(reference);
      }
      expect(onTextChange).not.toHaveBeenCalled();
    }
  });

  it("keeps the HP control usable while an unrelated ability field is invalid", () => {
    const build = { ...createBuild("blastoise"), abilityId: "unknown", currentHP: 70 };
    const html = renderToStaticMarkup(createElement(CurrentHPField, { build, issues: validateBuild(build), text: "070", onTextChange: () => undefined, compact: true }));
    expect(html).toContain('value="070"');
    expect(html).toContain("Blank means full HP (154).");
    expect(html).not.toContain('aria-invalid="true"');
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
    expect(html).toContain("Choose your team and league for this matchup.");
    expect(html).toContain("Loading your leagues");
    expect([...html.matchAll(/Manual build/g)]).toHaveLength(2);
    expect(html).toContain("Change left Pokémon");
    expect(html).toContain("Change right Pokémon");
  });

  it.each(["attacker", "defender"] as const)("puts the %s change button after the types and keeps build controls outside the closed chooser", (side) => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side, build: createBuild("charizard"), issues: [], onChange, hpInput: "", onHPChange: vi.fn() }));
    const trigger = html.match(/<button\b[^>]*data-calculator-change="true"[^>]*>/)?.[0];
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain(`aria-label="Change ${position(side)} Pokémon manually"`);
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(/>Flying<\/span><button\b[^>]*data-calculator-change="true"[^>]*>Change Pokémon<\/button><\/div>/);
    expect(html.indexOf(">Charizard</h3>")).toBeLessThan(html.indexOf(">Fire</span>"));
    expect(html.indexOf(">Fire</span>")).toBeLessThan(html.indexOf(">Flying</span>"));

    const dialogs = [...html.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)].map(([dialog]) => dialog);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].match(/<dialog\b[^>]*>/)?.[0]).not.toContain("open=");
    expect(dialogs[0]).toContain(`Change ${position(side)} Pokémon`);
    expect(dialogs[0]).toContain(`Find ${position(side)} Pokémon`);
    expect([...dialogs[0].matchAll(/type="search"/g)]).toHaveLength(1);
    expect([...dialogs[0].matchAll(/<li\b/g)]).toHaveLength(8);
    expect(dialogs[0]).toContain(`aria-label="Next ${position(side)} Pokémon page"`);
    expect(dialogs[0]).toContain(">Cancel</button>");
    for (const [button] of dialogs[0].matchAll(/<button\b[^>]*>/g)) expect(button).toContain('type="button"');

    const controls = html.replace(dialogs[0], "");
    expect(controls).not.toMatch(/<(?:details|summary)\b|\shidden=|type="search"/);
    expect(controls).toContain('data-calculator-build-settings="true"');
    for (const label of ["Current HP", "Nature", "Ability", "Held item", "Status"]) expect(controls).toContain(`>${label}</label>`);
    expect([...controls.matchAll(/<input\b[^>]*id="[^"]*-points-[a-z]+"/g)]).toHaveLength(6);
    expect([...controls.matchAll(/<select\b[^>]*id="[^"]*-stage-[a-z]+"/g)]).toHaveLength(5);
    expect(controls).toContain("Stats at level 50");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([false, true])("renders each roster once in the right location (desktop=%s)", (desktop) => {
    viewport.desktop = desktop;
    roster.state = loadedRosters();
    const html = renderToStaticMarkup(createElement(CalculatorClient));
    expect(html).toContain(`data-calculator-layout="${desktop ? "desktop" : "compact"}"`);
    expect([...html.matchAll(/data-calculator-center="true"/g)]).toHaveLength(1);
    expect([...html.matchAll(/data-calculator-roster="/g)]).toHaveLength(2);
    expect([...html.matchAll(/data-roster-choice="/g)]).toHaveLength(3);
    expect([...html.matchAll(/data-calculator-roster-rail="/g)]).toHaveLength(desktop ? 2 : 0);
    expect([...html.matchAll(/data-calculator-hp="true"/g)]).toHaveLength(2);
    expect(html).not.toMatch(/<main\b/);
    expect(html).not.toMatch(/<button[^>]*data-roster-choice="[^"]*"[^>]*aria-pressed="true"/); // Loading a roster is not activation.
    for (const [tag] of html.matchAll(/<details\b[^>]*>/g)) expect(tag).not.toContain("open=");
    for (const side of ["attacker", "defender"] as const) {
      const change = html.match(new RegExp(`<button[^>]*aria-label="Change ${position(side)} Pokémon"[^>]*>`))?.[0];
      expect(change).toContain('aria-haspopup="dialog"');
      expect(change).not.toContain("aria-controls=");
      const hp = controlTarget(html, `Edit ${position(side)} HP`);
      expect(hp).not.toContain("-build-");
      expect(html).toContain(`<div id="${hp}" hidden="">`);
      const label = side === "attacker" ? "Left Pokémon" : "Right Pokémon";
      const build = html.match(new RegExp(`<section id="[^"]*-build-[^"]*"[^>]*><h2[^>]*>${label}</h2>[\\s\\S]*?</section>`))?.[0];
      expect(build).toContain('data-calculator-hp="true"');
      if (desktop) {
        expect(build).not.toContain("data-calculator-roster=");
        expect(html).toMatch(new RegExp(`<aside[^>]*data-calculator-roster-rail="${side}"[^>]*><div id="[^"]*"[^>]*data-calculator-roster="${side}"`));
      } else {
        expect(build).toContain(`data-calculator-roster="${side}"`);
      }
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, references] of html.matchAll(/\baria-(?:controls|describedby|labelledby)="([^"]+)"/g)) {
      for (const reference of references.split(" ")) expect(ids).toContain(reference);
    }
    for (const [, label] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(label);
  });

  it.each([
    ["loading", () => createRosterState(), false, false],
    ["signed out", () => ({ ...createRosterState(), status: "signed-out" as const }), false, false],
    ["read error", () => ({ ...loadedRosters(), teamsStatus: "error" as const }), false, false],
    ["empty rosters", () => loadedRosters([], []), false, false],
    ["disabled entries", () => loadedRosters(["Unknown form"], ["Unknown form"]), false, false],
    ["no opponent", () => ({ ...loadedRosters(), opponentId: "" }), true, false],
    ["unsupported but inspectable", () => loadedRosters(["Lucario-Mega-Z"], ["Venusaur"]), true, true],
  ] as const)("keeps summary manual selection available and offers usable team choices: %s", (_name, state, ownAvailable, opponentAvailable) => {
    viewport.desktop = true;
    roster.state = state();
    const html = renderToStaticMarkup(createElement(CalculatorClient));
    for (const [side, available] of [["attacker", ownAvailable], ["defender", opponentAvailable]] as const) {
      const card = html.match(new RegExp(`<div data-summary-combatant="${side}"[\\s\\S]*?</dialog>`))?.[0];
      expect(card).toContain(`aria-label="Change ${position(side)} Pokémon" aria-haspopup="dialog"`);
      expect(card).toContain(`Find ${position(side)} Pokémon`);
      expect(card?.includes(">Team Pokémon</button>")).toBe(available);
      const hp = controlTarget(card!, `Edit ${position(side)} HP`);
      expect(card).toContain(`<div id="${hp}" hidden="">`);
      expect(card).not.toContain("data-roster-choice="); // Team controls mount only when used in the open chooser.
    }
  });

  it("exposes field controls without a second disclosure and keeps each requested effect mounted once", () => {
    const html = renderToStaticMarkup(createElement(BattleConditions, { value: createConditions(), issues: [], onChange: () => undefined }));
    expect(html).toMatch(/^<section\b[^>]*aria-labelledby=/);
    expect(html).not.toMatch(/<details\b/);
    expect(html).toMatch(/<h2\b[^>]*tabindex="-1"/);
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
    current.attacker.contexts = { bulletseed: { hits: 3 } };
    current.defender.contexts = { bulletseed: { hits: 5 } };
    current.field.weather = "Snow";
    current.field.terrain = "Electric";
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.reflect = true;
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    const before = structuredClone(current);
    const swapped = swapMatchup(current);
    expect(swapped.attacker).toEqual({ ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 1 });
    expect(swapped.defender).toEqual({ ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 1 });
    expect(swapped.attacker.build).toBe(current.defender.build);
    expect(swapped.defender.build).toBe(current.attacker.build);
    expect(swapped.attacker.moves).toBe(current.defender.moves);
    expect(swapped.defender.moves).toBe(current.attacker.moves);
    expect(swapped.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(swapped.attacker.contexts).toEqual({});
    expect(swapped.defender.contexts).toEqual({});
    expect(swapped.revision).toBe(current.revision);
    expect(current).toEqual(before);
    const restored = swapMatchup(swapped);
    expect(restored.attacker).toEqual({ ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 2 });
    expect(restored.defender).toEqual({ ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 2 });
    expect(restored.field).toEqual(current.field);
  });

  it("resets all effects, builds and hit counts with new raw-input keys", () => {
    const current = createMatchup(4);
    current.attacker.build.points.spa = 32;
    current.attacker.contexts = { bulletseed: { hits: 3 } };
    current.defender.contexts = { bulletseed: { hits: 5 } };
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.attackerSide.helpingHand = true;
    const reset = createMatchup(current.revision + 1);
    expect(reset.field).toEqual(createConditions());
    expect(reset.attacker.build).toEqual(createBuild("charizard"));
    expect(reset.defender.build).toEqual(createBuild("blastoise"));
    expect(reset.attacker.contexts).toEqual({});
    expect(reset.defender.contexts).toEqual({});
    expect(reset.attack).toEqual({ owner: getMoveOwner(reset.attacker), moveId: null });
    expect(reset.replacement).toBeNull();
    expect(reset.attacker.key).not.toBe(current.attacker.key);
    expect(reset.defender.key).not.toBe(current.defender.key);
  });

  it("locks the required Mega Stone and shows unsupported species reasons", () => {
    const mega = createBuild("charizardmegax");
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build: mega, issues: validateBuild(mega), onChange: () => undefined, hpInput: "", onHPChange: () => undefined }));
    expect(html).toMatch(/<select\b[^>]*id="[^"]*-item"[^>]*disabled=""/);
    expect(html).toContain('value="charizarditex" selected=""');
    expect(html).toContain("required and locked for this form");

    const unsupported = createBuild("lucariomegaz");
    const unsupportedHTML = renderToStaticMarkup(createElement(PokemonPanel, { side: "defender", build: unsupported, issues: validateBuild(unsupported), onChange: () => undefined, hpInput: "", onHPChange: () => undefined }));
    expect(unsupportedHTML).toContain("Unsupported build:");
    expect(unsupportedHTML).toContain("Lucario-Mega-Z");
  });

  it("shows a conditional ability switch without implying all abilities can be disabled", () => {
    const build = { ...createBuild("incineroar"), abilityId: "intimidate", abilityActive: true };
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build, issues: [], onChange: () => undefined, hpInput: "", onHPChange: () => undefined }));
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
      moveIds: ["thunderbolt", "growth"], ownerId: "0:0", sourcePosition: "left",
      selectedMoveId: "thunderbolt", onSelectMove: () => undefined,
      contexts: {}, onContextChange: () => undefined,
      abilityId: "blaze", itemId: "",
      attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    }));
    expect(html).toContain('<ul aria-label="Move damage results"');
    expect(html).not.toMatch(/<table\b/);
    expect(html).toContain("0 HP");
    expect(html).toContain("Unranked · Unsupported");
    expect(html).not.toContain("Coverage not verified."); // Lengthy reasons live in Details.
    expect(html).toContain("Not estimated");
    expect(html).toContain("2 of 2 source-listed moves accounted for");
    expect(html).toContain("conditional on the move hitting");
    expect(html).not.toContain("Base power:");
    expect(html).not.toContain("Accuracy:");
    expect(html).toMatch(/type="radio"[^>]*value="thunderbolt"/);
    expect(html).toMatch(/type="radio"[^>]*aria-label="Select Thunderbolt to preview HP"[^>]*checked=""/);
    expect([...html.matchAll(/type="radio"/g)]).toHaveLength(2);
    expect(html).toContain("Selected");
  });

  it("keeps HP and feedback outside five mounted menu panes with only Moves initially visible", () => {
    const html = renderToStaticMarkup(createElement(CalculatorClient));
    const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tag]) => tag);
    const panels = [...html.matchAll(/<div\b[^>]*role="tabpanel"[^>]*>/g)].map(([tag]) => tag);
    const order = ["team", "moves", "builds", "field", "opponent"];
    expect(tabs).toHaveLength(5);
    expect(panels).toHaveLength(5);
    order.forEach((tab, index) => {
      expect(tabs[index]).toContain(`data-calculator-tab="${tab}"`);
      expect(tabs[index]).toContain(`aria-selected="${tab === "moves"}"`);
      expect(tabs[index]).toContain(`tabindex="${tab === "moves" ? 0 : -1}"`);
      expect(panels[index]).toContain(`data-calculator-panel="${tab}"`);
      expect(panels[index].includes('hidden=""')).toBe(tab !== "moves");
      const tabId = tabs[index].match(/\bid="([^"]+)"/)![1];
      const panelId = panels[index].match(/\bid="([^"]+)"/)![1];
      expect(tabs[index]).toContain(`aria-controls="${panelId}"`);
      expect(panels[index]).toContain(`aria-labelledby="${tabId}"`);
    });
    expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf("Active Pokémon and HP"));
    for (const text of ["Active Pokémon and HP", 'aria-valuenow="153"', 'aria-valuenow="154"', "Loading the Champions engine"]) {
      expect(html.indexOf(text)).toBeLessThan(html.indexOf(panels[0]));
    }
    expect([...html.matchAll(/data-calculator-feedback="true"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Loading the Champions engine/g)]).toHaveLength(1);
    expect(html.indexOf(">Current HP</label>")).toBeGreaterThan(html.indexOf(panels[2]));
    const builds = html.slice(html.indexOf(panels[2]), html.indexOf(panels[3]));
    expect(builds).not.toMatch(/<(?:details|summary)\b/);
    expect([...builds.matchAll(/data-calculator-build-settings="true"/g)]).toHaveLength(2);
    expect([...builds.matchAll(/data-calculator-change="true"/g)]).toHaveLength(2);
    for (const [tag] of html.matchAll(/<details\b[^>]*>/g)) expect(tag).not.toContain("open=");
    expect([...html.matchAll(/data-calculator-hp="true"/g)]).toHaveLength(2);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    for (const [, references] of html.matchAll(/\baria-controls="([^"]+)"/g)) {
      for (const reference of references.split(" ")) expect(ids).toContain(reference);
    }
    expect(html).toContain('aria-label="Edit left HP"');
    expect(html).toContain('aria-label="Edit right HP"');
    expect(html).toContain("Field conditions");
  });

  it("keeps HP ahead of visible build controls and exposes validation errors", () => {
    const build = { ...createBuild("charizard"), currentHP: 0, points: { ...createBuild().points, spa: 33 } };
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build, issues: validateBuild(build), onChange: () => undefined, hpInput: formatHPInput(build.currentHP), onHPChange: () => undefined }));
    const controls = html.slice(0, html.indexOf("<dialog"));
    expect(controls.indexOf(">Current HP</label>")).toBeLessThan(controls.indexOf(">Nature</label>"));
    expect(controls).not.toMatch(/<(?:details|summary)\b|\shidden=/);
    const hpInput = controls.match(/<input\b[^>]*data-calculator-hp="true"[^>]*>/)?.[0];
    expect(hpInput).toContain('aria-invalid="true"');
    const pointsInput = controls.match(/<input\b[^>]*id="[^"]*-points-spa"[^>]*>/)?.[0];
    expect(pointsInput).toContain('aria-invalid="true"');
    for (const issue of validateBuild(build)) expect(controls).toContain(issue.message);
    const field = { ...createConditions(), gravity: "bad" as unknown as boolean };
    const fieldHTML = renderToStaticMarkup(createElement(BattleConditions, { value: field, issues: validateConditions(field), onChange: () => undefined }));
    expect(fieldHTML).toMatch(/<h2\b[^>]*>[\s\S]*?1 settings to check<\/span><\/h2>/);
  });

  it.each([false, true])("renders one responsive move-selection branch (wide=%s) with unique labelled controls", (wide) => {
    viewport.wide = wide;
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row("flamethrower", "calculated"), row("bulletseed", "needs-context")],
      moveIds: ["flamethrower", "bulletseed"], ownerId: "0:0", sourcePosition: "left",
      selectedMoveId: "bulletseed", onSelectMove: () => undefined,
      contexts: {}, onContextChange: () => undefined,
      abilityId: "blaze", itemId: "",
      attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    }));
    expect([...html.matchAll(/type="radio"/g)]).toHaveLength(2);
    expect([...html.matchAll(/type="radio"[^>]*checked=""/g)]).toHaveLength(1);
    expect(html.includes('<table ')).toBe(wide);
    expect(html.includes('<ul aria-label="Move damage results"')).toBe(!wide);
    expect(html).toContain("Set hits");
    expect(html).not.toContain("Base power:");
    expect(html).not.toContain("Accuracy:");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, label] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(label);
    for (const [, references] of html.matchAll(/\baria-describedby="([^"]+)"/g)) {
      for (const reference of references.split(" ")) expect(ids).toContain(reference);
    }
  });

  it.each([false, true])("keeps catalog browsing available while withholding stale rows when blocked=%s", (blocked) => {
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row("flamethrower", "calculated")], selectedMoveId: "flamethrower", onSelectMove: () => undefined,
      moveIds: ["flamethrower"], ownerId: "0:0", sourcePosition: "left",
      contexts: {}, onContextChange: () => undefined, abilityId: "blaze", itemId: "",
      attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154, blocked,
    }));
    expect(html).toContain(">Choose a move</h2>");
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="search"');
    expect(html).toContain("Move damage results");
    expect(html.includes("Calculations are paused.")).toBe(blocked);
    expect(html.includes("Not calculated")).toBe(blocked);
    expect(html.includes("0 HP")).toBe(!blocked);
    expect(html).not.toContain('role="alert"');
  });

  it("offers explicit access to a selected move beyond the visible page", () => {
    const rows = speciesById.get("charizard")!.moves.map((moveId) => row(moveId, "calculated"));
    const selectedMoveId = rankResults(rows, "minimum").at(-1)!.moveId;
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows, moveIds: rows.map((row) => row.moveId), ownerId: "0:0", sourcePosition: "left", selectedMoveId, onSelectMove: () => undefined,
      contexts: {}, onContextChange: () => undefined,
      abilityId: "blaze", itemId: "",
      attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    }));
    expect(rows.length).toBeGreaterThan(30);
    expect([...html.matchAll(/type="radio"/g)]).toHaveLength(30);
    expect(html).toContain(">Show selected move</button>");
    expect(html).toContain(">Show more moves</button>");
    expect(html).not.toMatch(/type="radio"[^>]*checked=""/);
  });

  it("marks aggregate Stat Point and ability-condition errors on focusable controls", () => {
    const build = createBuild("greninja");
    build.abilityId = "protean";
    build.abilityActive = false;
    build.points = { hp: 3, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    const html = renderToStaticMarkup(createElement(PokemonPanel, { side: "attacker", build, issues: validateBuild(build), onChange: () => undefined, hpInput: formatHPInput(build.currentHP), onHPChange: () => undefined }));
    const ability = html.match(/<input\b[^>]*id="[^"]*-ability-active"[^>]*>/)?.[0];
    expect(ability).toContain('aria-invalid="true"');
    const descriptions = ability!.match(/aria-describedby="([^"]+)"/)![1].split(" ");
    expect(descriptions).toHaveLength(2);
    for (const id of descriptions) expect(html).toContain(`id="${id}"`);
    const points = [...html.matchAll(/<input\b[^>]*id="[^"]*-points-[a-z]+"[^>]*>/g)];
    expect(points).toHaveLength(6);
    for (const [input] of points) expect(input).toContain('aria-invalid="true"');
  });

  it("keeps power, accuracy, reasons, rolls and the single hit editor in Details", () => {
    const render = (abilityId: string, itemId = "") => renderToStaticMarkup(createElement(MoveDetails, {
      moveId: "bulletseed", row: { ...row("bulletseed", "needs-context"), reason: "Choose hits before calculating." },
      id: "bulletseed-details", context: undefined, abilityId, itemId, onContextChange: () => undefined,
    }));
    const html = render("overgrow");
    expect([...html.matchAll(/<select\b/g)]).toHaveLength(1);
    expect(html).toContain('id="bulletseed-details-hits"');
    expect(html).toContain('for="bulletseed-details-hits"');
    expect(html).toContain("Choose hits before calculating.");
    expect(html).toContain("Base power: 25");
    expect(html).toContain("Accuracy: 100%");
    expect(html).toContain("No damage rolls available.");
    expect(render("skilllink")).not.toMatch(/<select\b/);
    expect(render("skilllink")).toContain("Skill Link fixes this move at 5 hits");
    const dice = render("overgrow", "loadeddice");
    expect(dice).toContain('<option value="4">4 hits</option>');
    expect(dice).not.toContain('<option value="2">');
    const unsupported = renderToStaticMarkup(createElement(MoveDetails, {
      moveId: "growth", row: row("growth", "unsupported"), id: "growth-details", context: undefined,
      abilityId: "overgrow", itemId: "", onContextChange: () => undefined,
    }));
    expect(unsupported).toContain("Coverage not verified.");
    expect(unsupported).toContain("Variable / special");
  });
});

describe("quick-move replacement UI", () => {
  const preparedMoves = (): MoveSlots => [
    { moveId: "flamethrower", origin: "usage", gameType: "Doubles" },
    { moveId: "airslash", origin: "suggested", gameType: "Doubles" },
    { moveId: "heatwave", origin: "manual", gameType: null },
    { moveId: "weatherball", origin: "usage", gameType: "Singles" },
  ];

  it.each([[false, "left"], [true, "left"], [false, "right"], [true, "right"]] as const)("offers only unassigned replacement candidates (wide=%s, source=%s)", (wide, sourcePosition) => {
    viewport.wide = wide;
    const onSelectMove = vi.fn();
    const onReplace = vi.fn();
    const onDone = vi.fn();
    const moves = preparedMoves();
    const moveIds = [...moves.map((slot) => slot.moveId!), "protect"];
    const buttons = vi.spyOn(buttonControl, "default");
    try {
      const props = {
        rows: moveIds.map((id) => row(id, id === "protect" ? "status" : "calculated")),
        moveIds, ownerId: "7:4", sourcePosition,
        selectedMoveId: "flamethrower", onSelectMove, contexts: {}, onContextChange: vi.fn(),
        replacement: { slotIndex: 0, moves, onReplace, onDone },
        abilityId: "blaze", itemId: "", attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
      };
      const html = renderToStaticMarkup(createElement(MoveResults, props));
      expect(html).toContain("Replace Charizard’s move 1 — Flamethrower");
      expect(html).toContain(`Charizard (${sourcePosition}) → Blastoise (${sourcePosition === "left" ? "right" : "left"})`);
      expect(html).toContain('data-moves-owner="7:4"');
      expect(html).not.toContain('type="radio"');
      expect(html.includes('<table ')).toBe(wide);
      expect(html.includes('<ul aria-label="Move damage results"')).toBe(!wide);
      expect(html).toContain("Choosing a move finishes editing and clears the selection.");
      expect(html).toContain("Showing 1 of 1 matching moves.");
      expect(html).not.toContain("Current move");
      expect(html).not.toContain("Already in move");
      expect(html).not.toContain("Show selected move");
      for (const { moveId } of moves) {
        expect(html).not.toContain(`-${moveId}-damage`);
        expect(buttons.mock.calls.some(([props]) => props["aria-label"] === `Use ${movesById.get(moveId!)!.name} in move 1`)).toBe(false);
      }
      const candidate = html.match(/<button\b[^>]*aria-label="Use Protect in move 1"[^>]*>[\s\S]*?<\/button>/)?.[0];
      expect(candidate).toContain(">Use move</button>");
      expect(candidate).not.toContain('disabled=""');
      expect(onReplace).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      const action = (label: string) => buttons.mock.calls.map(([props]) => props).find((props) => props["aria-label"] === label)!;
      action("Use Protect in move 1").onClick!({} as MouseEvent<HTMLButtonElement>);
      expect(onReplace).toHaveBeenCalledExactlyOnceWith("protect");
      expect(onSelectMove).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      action("Done replacing move").onClick!({} as MouseEvent<HTMLButtonElement>);
      expect(onDone).toHaveBeenCalledOnce();
      assertControlLabels(html);
      const browsing = renderToStaticMarkup(createElement(MoveResults, { ...props, replacement: undefined }));
      expect(browsing).toContain("Showing 5 of 5 matching moves.");
      for (const moveId of moveIds) expect(browsing).toContain(`aria-label="Select ${movesById.get(moveId)!.name} to preview HP"`);
      expect(browsing).not.toContain("Done replacing move");
    } finally {
      buttons.mockRestore();
    }
  });

  it.each([false, true])("keeps blocked catalog candidates editable without fake or stale damage (wide=%s)", (wide) => {
    viewport.wide = wide;
    const moves: MoveSlots = [
      { moveId: "sludgebomb", origin: "manual", gameType: null },
      { moveId: "energyball", origin: "suggested", gameType: "Doubles" },
      { moveId: null, origin: "empty", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
    ];
    const onReplace = vi.fn();
    const onSelectMove = vi.fn();
    const buttons = vi.spyOn(buttonControl, "default");
    try {
      const html = renderToStaticMarkup(createElement(MoveResults, {
        rows: [{ ...row("sludgebomb", "calculated"), min: 12345, max: 12345, rolls: 12345 }, row("surf", "calculated")],
        moveIds: ["protect", "sludgebomb", "bulletseed", "energyball", "sludgebomb", "unknownmove"],
        ownerId: "3:8", sourcePosition: "right", selectedMoveId: "sludgebomb", onSelectMove,
        contexts: {}, onContextChange: vi.fn(), replacement: { slotIndex: 0, moves, onReplace, onDone: vi.fn() },
        abilityId: "overgrow", itemId: "", attackerName: "Venusaur", defenderName: "Blastoise", defenderHP: null, blocked: true,
      }));
      expect(html).toContain("Calculations are paused.");
      expect(html).toContain("Showing 2 of 2 matching moves.");
      expect(html).toContain("2 source-listed moves available; calculations paused.");
      expect(html).toContain('type="search"');
      expect(html).toContain('<option value="status">Status moves</option>');
      expect(html).toContain('<option value="damaging">Damaging moves</option>');
      for (const value of ["needs-context", "unsupported", "minimum", "maximum"]) {
        expect(html).toMatch(new RegExp(`<option\\b[^>]*value="${value}"[^>]*disabled=""`));
      }
      expect(html).toContain('<option value="name" selected="">');
      expect([...html.matchAll(/>Not calculated</g)]).toHaveLength(2);
      expect(html).not.toContain("12345");
      expect(html).not.toContain("0 HP");
      expect(html).not.toContain("Surf");
      expect(html).not.toContain("Unknownmove");
      expect(html).not.toContain("0% KO");
      expect(html).toContain("Not estimated");
      expect(html).toContain("Set hits");
      expect(html).toContain('aria-label="Use Bullet Seed in move 1"');
      expect(html).not.toContain("Already in move");
      expect(html).not.toContain("Energy Ball");
      expect(html).not.toContain("-sludgebomb-damage");
      const candidate = buttons.mock.calls.map(([props]) => props).find((props) => props["aria-label"] === "Use Protect in move 1")!;
      expect(candidate.disabled).toBeFalsy();
      candidate.onClick!({} as MouseEvent<HTMLButtonElement>);
      expect(onReplace).toHaveBeenCalledExactlyOnceWith("protect");
      expect(onSelectMove).not.toHaveBeenCalled();
      assertControlLabels(html);
    } finally {
      buttons.mockRestore();
    }
  });

  it.each([false, true])("shows no replacement candidates when the entire learnset is already assigned (wide=%s)", (wide) => {
    viewport.wide = wide;
    const props: ComponentProps<typeof MoveResults> = {
      rows: [row("transform", "status")], moveIds: ["transform"], ownerId: "1:0", sourcePosition: "right",
      selectedMoveId: null, onSelectMove: vi.fn(), contexts: {}, onContextChange: vi.fn(),
      replacement: {
        slotIndex: 1,
        moves: [{ moveId: "transform", origin: "manual", gameType: null }, ...Array.from({ length: 3 }, () => ({ moveId: null, origin: "empty" as const, gameType: null }))] as MoveSlots,
        onReplace: vi.fn(), onDone: vi.fn(),
      },
      abilityId: "limber", itemId: "", attackerName: "Ditto", defenderName: "Charizard", defenderHP: 153,
    };
    const html = renderToStaticMarkup(createElement(MoveResults, props));
    expect(html).toContain("Showing 0 of 0 matching moves.");
    expect(html).toContain("No matching moves");
    expect(html).toContain("Already assigned moves are hidden.");
    expect(html).not.toContain('aria-label="Move damage results"');
    expect(html).not.toContain("Use Transform");
    expect(html).not.toContain("Current move");
    expect(html).toContain("Done replacing move");
    const browsing = renderToStaticMarkup(createElement(MoveResults, { ...props, replacement: undefined }));
    expect(browsing).toContain("Showing 1 of 1 matching moves.");
    expect(browsing).toContain('aria-label="Select Transform to preview HP"');
    assertControlLabels(html);
  });

  it.each([false, true])("distinguishes an uncalculated catalog candidate from genuine zero outside replacement mode (wide=%s)", (wide) => {
    viewport.wide = wide;
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row("flamethrower", "calculated")], moveIds: ["flamethrower", "protect"], ownerId: "0:2", sourcePosition: "left",
      selectedMoveId: "protect", onSelectMove: vi.fn(), contexts: {}, onContextChange: vi.fn(),
      abilityId: "blaze", itemId: "", attackerName: "Charizard", defenderName: "Blastoise", defenderHP: 154,
    }));
    const entries = [...html.matchAll(wide ? /<tr\b[^>]*>[\s\S]*?<\/tr>/g : /<li\b[^>]*>[\s\S]*?<\/li>/g)].map(([entry]) => entry);
    const unknown = entries.find((entry) => entry.includes('aria-label="Select Protect to preview HP"'))!;
    const zero = entries.find((entry) => entry.includes('aria-label="Select Flamethrower to preview HP"'))!;
    expect(unknown).toContain("Not calculated");
    expect(unknown).toContain("Not estimated");
    expect(unknown).not.toContain("0 HP");
    expect(unknown).toContain('checked=""');
    expect(zero).toContain("0 HP");
    expect(zero).not.toContain("Not calculated");
    expect(html).toContain("1 of 2 source-listed moves accounted for");
    expect(html).not.toContain("Calculations are paused.");
  });

  it("shows metadata and an owned hit editor with no calculated row or fabricated rolls", () => {
    const onContextChange = vi.fn();
    const selects = vi.spyOn(selectControl, "default");
    try {
      const html = renderToStaticMarkup(createElement(MoveDetails, {
        moveId: "bulletseed", id: "catalog-bulletseed", context: { hits: 3 }, abilityId: "overgrow", itemId: "", onContextChange,
      }));
      expect(html).toContain('aria-label="Bullet Seed details"');
      expect(html).toContain("Base power: 25");
      expect(html).toContain("Accuracy: 100%");
      expect(html).toContain("Category: Physical");
      expect(html).toContain(renderToStaticMarkup(createElement("p", { className: "text-muted" }, movesById.get("bulletseed")!.description)));
      expect(html).toContain('<option value="3" selected="">3 hits</option>');
      expect(html).toContain("Move information and hit-count editing remain available.");
      expect(html).not.toContain("Damage rolls:");
      expect(html).not.toContain("Fixed damage:");
      expect(html).not.toContain("Assumptions for this result");
      expect(html).not.toContain("0 HP");
      expect(selects.mock.calls).toHaveLength(1);
      const [select] = selects.mock.calls[0];
      select.onChange!({ target: { value: "5" } } as ChangeEvent<HTMLSelectElement>);
      select.onChange!({ target: { value: "" } } as ChangeEvent<HTMLSelectElement>);
      expect(onContextChange.mock.calls).toEqual([[{ hits: 5 }], [{ hits: undefined }]]);
      assertControlLabels(html);
    } finally {
      selects.mockRestore();
    }
    const fixed = renderToStaticMarkup(createElement(MoveDetails, {
      moveId: "bulletseed", id: "skilllink-no-row", context: undefined, abilityId: "skilllink", itemId: "", onContextChange,
    }));
    expect(fixed).not.toContain("<select");
    expect(fixed).toContain("Skill Link fixes this move at 5 hits");
    const status = renderToStaticMarkup(createElement(MoveDetails, {
      moveId: "protect", id: "status-no-row", context: undefined, abilityId: "blaze", itemId: "", onContextChange,
    }));
    expect(status).toContain("Category: Status");
    expect(status).toContain("Damage is not available yet.");
    expect(status).not.toContain("<select");
  });
});

describe("active matchup and selected-move summary", () => {
  it("renders exactly eight labelled quick-move buttons with owner tokens and accessible provenance", () => {
    const matchup = createMatchup();
    const onActivateMove = vi.fn();
    const html = summaryHTML(matchup, undefined, undefined, "average", { onActivateMove });
    const buttons = [...html.matchAll(/<button\b[^>]*data-move-slot="\d+"[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    expect(buttons).toHaveLength(8);
    for (const [side, offset] of [["attacker", 0], ["defender", 4]] as const) {
      const slot = matchup[side];
      const name = speciesById.get(slot.build.speciesId)!.name;
      expect(html).toContain(`aria-label="${name} ${position(side)} quick moves"`);
      slot.moves.forEach((move, index) => {
        const button = buttons[offset + index];
        expect(button).toContain('type="button"');
        expect(button).toContain(`aria-label="${name} ${position(side)} move ${index + 1}: ${movesById.get(move.moveId!)?.name ?? "Choose move"}"`);
        expect(button).toContain(`data-move-owner="${slot.key}:${slot.moveEpoch}"`);
        expect(button).toContain(`data-move-slot="${index}"`);
        expect(button).toContain('aria-controls="moves"');
        expect(button).toContain('aria-pressed="false"');
        expect(button).toContain("min-h-12");
        expect(button).not.toContain('disabled=""');
        const description = button.match(/aria-describedby="([^"]+)"/)![1];
        expect(button).toContain(`id="${description}"`);
      });
    }
    expect(onActivateMove).not.toHaveBeenCalled();
    assertControlLabels(html);
    const client = renderToStaticMarkup(createElement(CalculatorClient));
    expect(client).toContain("Loading the Champions engine");
    expect([...client.matchAll(/<button\b[^>]*data-move-slot="\d+"[^>]*>/g)]).toHaveLength(8);
  });

  it("shows empty and Suggested slots honestly and marks the active empty replacement without choosing damage", () => {
    let matchup = updateMatchupBuild(createMatchup(), "defender", createBuild("ditto"));
    matchup.attacker.moves = [
      { moveId: "flamethrower", origin: "usage", gameType: "Doubles" },
      { moveId: "airslash", origin: "suggested", gameType: "Singles" },
      { moveId: "protect", origin: "manual", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
    ];
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 3);
    const before = structuredClone(matchup);
    const html = summaryHTML(matchup);
    const buttons = [...html.matchAll(/<button\b[^>]*data-move-slot="\d+"[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    expect(buttons).toHaveLength(8);
    expect(buttons[0]).toContain("Common Champions Doubles usage");
    expect(buttons[1]).toContain(">Suggested</span>");
    expect(buttons[1]).toContain("Suggested, per-species usage unavailable for this move");
    expect(buttons[1]).not.toContain("Common Champions");
    expect(buttons[2]).toContain("Manually chosen");
    for (const button of [buttons[3], ...buttons.slice(4)]) {
      expect(button).toContain("Choose move");
      expect(button).toContain("Choose a move");
      expect(button).toContain('aria-pressed="false"');
      expect(button).not.toContain('disabled=""');
    }
    expect(buttons[7]).toContain('aria-label="Ditto right move 4: Choose move"');
    expect(buttons[7]).toContain(`data-move-session="${matchup.replacement!.session}"`);
    expect(buttons[7]).toContain(">Editing</span>");
    expect(buttons.slice(0, 7).some((button) => button.includes("data-move-session"))).toBe(false);
    expect(html).not.toContain("projected HP");
    expect(html).not.toContain("HP remaining:");
    expect(matchup).toEqual(before);
    assertControlLabels(html);
  });

  it("selects only the owning side's slot when both Pokémon have the same species and move", () => {
    let matchup = updateMatchupBuild(createMatchup(), "defender", createBuild("charizard"));
    expect(matchup.attacker.moves[0].moveId).toBe(matchup.defender.moves[0].moveId);
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    const html = summaryHTML(matchup);
    const buttons = [...html.matchAll(/<button\b[^>]*data-move-slot="\d+"[^>]*>/g)].map(([button]) => button);
    expect(buttons.filter((button) => button.includes('aria-pressed="true"'))).toEqual([buttons[4]]);
    expect(buttons[4]).toContain(`data-move-owner="${matchup.defender.key}:${matchup.defender.moveEpoch}"`);
    expect(buttons[4]).toContain(`data-move-session="${matchup.replacement!.session}"`);
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(html.indexOf('data-summary-combatant="attacker"')).toBeLessThan(html.indexOf('data-summary-combatant="defender"'));
  });

  it.each(["attacker", "defender"] as const)("returns both summary cards to their unselected actual-HP state after a %s replacement", (side) => {
    let matchup = createMatchup();
    matchup = updateMatchupBuild(matchup, "attacker", { ...matchup.attacker.build, currentHP: 100 });
    matchup = updateMatchupBuild(matchup, "defender", { ...matchup.defender.build, currentHP: 100 });
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup[side]), 0);
    const previousRow = { ...row(matchup.attack.moveId!, "calculated"), min: 20, max: 20, rolls: 20 };
    expect(summaryHTML(matchup, previousRow)).toContain("projected HP");
    const next = replaceMatchupMove(matchup, matchup.replacement!, "protect");
    const html = summaryHTML(next, previousRow);
    const buttons = [...html.matchAll(/<button\b[^>]*data-move-slot="\d+"[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    expect(buttons).toHaveLength(8);
    expect(buttons.every((button) => button.includes('aria-pressed="false"'))).toBe(true);
    expect(buttons[side === "attacker" ? 0 : 4]).toContain("Protect");
    expect(html).not.toContain("data-move-session");
    expect(html).not.toContain(">Editing</span>");
    expect(html).not.toContain("projected HP");
    expect(html).not.toContain("HP remaining:");
    expect(html).toContain("Click either Pokémon’s quick move");
    for (const position of ["attacker", "defender"] as const) {
      expect(meterHTML(html, position)).toContain('aria-valuenow="100"');
      expect(next[position].build).toBe(matchup[position].build);
    }
    expect(getAttackView(next).sourceSide).toBe(side);
    expect(next.replacement).toBeNull();
    expect(next.attack.moveId).toBeNull();
    assertControlLabels(html);
  });

  it.each([["low", 20, 80], ["average", 28, 72], ["high", 35, 65]] as const)("projects %s reverse damage only on the physical left receiving card", (mode, damage, remaining) => {
    let matchup = updateMatchupBuild(createMatchup(), "attacker", { ...createBuild("charizard"), currentHP: 100 });
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "surf");
    const result = { ...row("surf", "calculated"), min: 20, max: 35, rolls: Array.from({ length: 16 }, (_, index) => 20 + index) };
    const before = structuredClone({ matchup, result });
    const html = summaryHTML(matchup, result, undefined, mode);
    const receiver = meterHTML(html, "attacker");
    expect(receiver).toContain('aria-label="Charizard left projected HP"');
    expect(receiver).toContain(`aria-valuenow="${remaining}"`);
    expect(receiver).toContain('aria-valuemax="153"');
    expect(receiver).toContain(`${remaining} of 153 HP after Surf`);
    expect(receiver).toContain(`width:${remaining / 153 * 100}%`);
    expect(meterHTML(html, "defender")).toContain('aria-label="Blastoise right current HP"');
    expect(meterHTML(html, "defender")).toContain('aria-valuenow="154"');
    expect(html).toContain("Blastoise (right) → Charizard (left)");
    expect(html).toContain("Left Pokémon HP remaining:");
    expect(html).toContain(`${remaining} / 153</strong>`);
    expect(html).toContain(`${damage} damage</strong>`);
    expect(html).toContain("Current HP: 100 / 153");
    expect(html).not.toContain("Right Pokémon HP remaining:");
    expect(html).toContain("Current HP is unchanged");
    expect({ matchup, result }).toEqual(before);
  });

  it.each(["previous direction", "source key", "source epoch", "receiver key", "receiver epoch", "missing identity"] as const)("withholds same-ID damage for a mismatched result batch: %s", (mismatch) => {
    let matchup = updateMatchupBuild(createMatchup(), "defender", createBuild("charizard"));
    matchup = updateMatchupBuild(matchup, "attacker", { ...matchup.attacker.build, currentHP: 100 });
    matchup = updateMatchupBuild(matchup, "defender", { ...matchup.defender.build, currentHP: 75 });
    matchup = activateMoveSlot(matchup, getMoveOwner(matchup.defender), 0);
    matchup = selectMatchupMove(matchup, "flamethrower");
    const view = getAttackView(matchup);
    let resultIdentity: ComponentProps<typeof MatchupSummary>["resultIdentity"] = { source: view.owner, receiver: view.receiverOwner };
    if (mismatch === "previous direction") resultIdentity = { source: view.receiverOwner, receiver: view.owner };
    if (mismatch === "source key") resultIdentity.source = { ...view.owner, key: 999 };
    if (mismatch === "source epoch") resultIdentity.source = { ...view.owner, epoch: view.owner.epoch - 1 };
    if (mismatch === "receiver key") resultIdentity.receiver = { ...view.receiverOwner, key: 999 };
    if (mismatch === "receiver epoch") resultIdentity.receiver = { ...view.receiverOwner, epoch: view.receiverOwner.epoch - 1 };
    if (mismatch === "missing identity") resultIdentity = undefined;
    const result = { ...row("flamethrower", "calculated"), min: 50, max: 50, rolls: 50 };
    const html = summaryHTML(matchup, result, undefined, "average", { resultIdentity });
    expect(html).toContain("Charizard (right) → Charizard (left)");
    expect(html).toContain("Flamethrower");
    expect(html).not.toContain("50 damage");
    expect(html).not.toContain("damage range");
    expect(html).not.toContain("One-use KO:");
    expect(html).not.toContain("HP remaining:");
    expect(html).not.toContain("projected HP");
    expect(html).not.toContain(">Show move</button>");
    expect(meterHTML(html, "attacker")).toContain('aria-valuenow="100"');
    expect(meterHTML(html, "defender")).toContain('aria-valuenow="75"');
    expect(summaryHTML(matchup, result)).toContain("50 / 153</strong>");
  });

  it("withholds projection if the attack itself refers to an expired owner", () => {
    const matchup = selectMatchupMove(createMatchup(), "flamethrower");
    const result = { ...row("flamethrower", "calculated"), min: 50, max: 50, rolls: 50 };
    const html = summaryHTML(matchup, result, undefined, "average", {
      attack: { ...matchup.attack, owner: { ...matchup.attack.owner, epoch: matchup.attack.owner.epoch + 1 } },
    });
    expect(html).not.toContain("50 damage");
    expect(html).not.toContain("projected HP");
    expect(html).not.toContain("HP remaining:");
    expect(meterHTML(html, "attacker")).toContain('aria-valuenow="153"');
    expect(meterHTML(html, "defender")).toContain('aria-valuenow="154"');
  });

  it("starts with current HP, accessible bars, editor shortcuts and Average selected", () => {
    const matchup = createMatchup();
    const html = summaryHTML(matchup);
    expect(html).toContain("Charizard");
    expect(html).toContain("Blastoise");
    expect(html).toContain('aria-label="Charizard left current HP"');
    expect(html).toContain('aria-valuenow="153"');
    expect(html).toContain('aria-valuemax="154"');
    expect(html).toContain("Click either Pokémon’s quick move to calculate and edit that slot, or browse all moves below.");
    expect(html).not.toContain("Right Pokémon HP remaining:");
    for (const side of ["attacker", "defender"] as const) {
      expect(html).toContain(`aria-label="Change ${position(side)} Pokémon" aria-haspopup="dialog"`);
      expect(html).toContain(`aria-label="Edit ${position(side)} HP" aria-expanded="false"`);
      expect(html).toContain(`<div id="${controlTarget(html, `Edit ${position(side)} HP`)}" hidden="">`);
    }
    expect([...html.matchAll(/<fieldset\b/g)]).toHaveLength(1);
    expect(html).toContain('>Damage roll</legend>');
    const inputs = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(([input]) => input);
    expect(inputs).toHaveLength(3);
    expect([...html.matchAll(/<dialog\b/g)]).toHaveLength(2);
    expect(html).not.toContain("data-summary-hp=");
    const names = inputs.map((input) => input.match(/name="([^"]+)"/)?.[1]);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toContain("damage-roll");
    expect(inputs.filter((input) => input.includes('checked=""'))).toEqual([expect.stringContaining('value="average"')]);
    expect(meterHTML(html, "defender")).toContain('aria-label="Blastoise right current HP"');
  });

  it.each([
    ["low", 20, 80, "bg-success"], ["average", 28, 72, "bg-warning"], ["high", 35, 65, "bg-warning"],
  ] as const)("reflects %s damage in the defender number, bar and accessible values without applying it", (mode, damage, remaining, color) => {
    let matchup = selectMatchupMove(createMatchup(), "flamethrower");
    matchup = updateMatchupBuild(matchup, "defender", { ...matchup.defender.build, currentHP: 100 });
    const result = { ...row("flamethrower", "calculated"), min: 20, max: 35, rolls: Array.from({ length: 16 }, (_, i) => 20 + i), ohkoChance: 0.375 };
    const before = structuredClone({ matchup, result });
    const html = summaryHTML(matchup, result, undefined, mode);
    const defenderMeter = meterHTML(html, "defender");
    expect(defenderMeter).toContain('aria-label="Blastoise right projected HP"');
    expect(defenderMeter).toContain(`aria-valuenow="${remaining}"`);
    expect(defenderMeter).toContain('aria-valuemax="154"');
    expect(defenderMeter).toContain(`${remaining} of 154 HP after Flamethrower`);
    expect(defenderMeter).toContain(`width:${remaining / 154 * 100}%`);
    expect(defenderMeter).toContain(color);
    expect(meterHTML(html, "attacker")).toContain('aria-valuenow="153"');
    expect(meterHTML(html, "attacker")).toContain('left current HP');
    expect(html).toContain(`>${remaining}</span>`);
    expect(html).toContain(`${damage} damage</strong>`);
    expect(html).toContain("20–35 damage range");
    expect(html).toContain(`<strong class="whitespace-nowrap text-lg tabular-nums">${remaining} / 154</strong>`);
    expect(html).toContain("Current HP: 100 / 154");
    expect(html).toContain("After Flamethrower");
    expect(html).toContain("One-use KO: 37.5% (all rolls)");
    expect(html).toContain("Current HP is unchanged");
    expect(html).toContain("if it connects");
    expect(html).toContain('aria-live="polite" aria-atomic="true"');
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([input]) => input);
    expect(inputs.filter((input) => input.includes('checked=""'))).toEqual([expect.stringContaining(`value="${mode}"`)]);
    if (mode === "average") expect(html).toContain("Average damage is the mean of all rolls, rounded to whole HP.");
    const edited = updateMatchupBuild(matchup, "defender", { ...matchup.defender.build, currentHP: 40 });
    expect(summaryHTML(edited, result, undefined, mode)).toContain(`${40 - damage} / 154</strong>`);
    const overkill = summaryHTML(edited, { ...result, min: 50, max: 50, rolls: 50 }, undefined, mode);
    expect(overkill).toContain("0 / 154</strong>");
    expect(meterHTML(overkill, "defender")).toContain('aria-valuenow="0"');
    expect(meterHTML(overkill, "defender")).toContain('width:0%');
    expect(meterHTML(overkill, "defender")).toContain('bg-danger');
    expect({ matchup, result }).toEqual(before);
  });

  it("does not project an unselected, mismatched or missing damage result", () => {
    const matchup = selectMatchupMove(createMatchup(), "flamethrower");
    const result = { ...row("flamethrower", "calculated"), min: 50, max: 50, rolls: 50 };
    for (const html of [summaryHTML(createMatchup(), result), summaryHTML(matchup, { ...result, moveId: "surf" }), summaryHTML(matchup)]) {
      expect(html).not.toContain("Right Pokémon HP remaining:");
      expect(html).not.toContain("50 damage");
      expect(meterHTML(html, "defender")).toContain("right current HP");
      expect(meterHTML(html, "defender")).toContain('aria-valuenow="154"');
    }
  });

  it.each(["Loading the calculator.", "Retry the calculator.", "Fix invalid settings."])("withholds stale damage and projected HP while blocked: %s", (reason) => {
    const matchup = selectMatchupMove(createMatchup(), "flamethrower");
    for (const mode of ["low", "average", "high"] as const) {
      const html = summaryHTML(matchup, { ...row("flamethrower", "calculated"), min: 50, max: 50, rolls: 50 }, reason, mode);
      expect(html).toContain("Flamethrower");
      expect(html).toContain(reason);
      expect(html).not.toContain("Right Pokémon HP remaining:");
      expect(html).not.toContain("50 damage");
      expect(html).not.toContain("One-use KO:");
      expect(html).not.toContain(">Show move</button>");
      expect(meterHTML(html, "defender")).toContain("right current HP");
      expect(meterHTML(html, "defender")).toContain('aria-valuenow="154"');
    }
  });

  it.each([0, Number.NaN, 1.5, 155])("does not turn invalid defender HP %s into a full-health bar", (currentHP) => {
    const matchup = updateMatchupBuild(selectMatchupMove(createMatchup(), "flamethrower"), "defender", { ...createBuild("blastoise"), currentHP });
    const html = summaryHTML(matchup, undefined, "Fix invalid settings.");
    expect([...html.matchAll(/role="meter"/g)]).toHaveLength(1);
    expect(html).toContain("Edit HP to fix the current value");
    expect(html).not.toContain("Right Pokémon HP remaining:");
    expect(html).not.toContain('aria-valuenow="154"');
  });

  it("keeps true zero distinct from unknown, missing and noncalculated results", () => {
    const matchup = selectMatchupMove(createMatchup(), "flamethrower");
    const zero = summaryHTML(matchup, row("flamethrower", "calculated"));
    expect(zero).toContain("0 damage");
    expect(zero).toContain("154 / 154");
    for (const kind of ["status", "needs-context", "unsupported"] as const) {
      const html = summaryHTML(matchup, row("flamethrower", kind));
      expect(html).not.toContain("0 damage");
      expect(html).not.toContain("Right Pokémon HP remaining:");
    }
    expect(summaryHTML(matchup)).not.toContain("Right Pokémon HP remaining:");
  });

  it("retains raw damage and supplied KO while withholding survival-sensitive HP", () => {
    let matchup = selectMatchupMove(createMatchup(), "flamethrower");
    matchup = updateMatchupBuild(matchup, "defender", { ...createBuild("venusaur"), itemId: "focussash" });
    // A defender species change deliberately clears selection.
    matchup = selectMatchupMove(matchup, "flamethrower");
    const damage = { ...row("flamethrower", "calculated"), min: 138, max: 164, rolls: [138, ...Array(14).fill(150), 164] };
    const html = summaryHTML(matchup, damage);
    expect(html).toContain("138–164 damage");
    expect(html).toContain("One-use KO: 0%");
    expect(html).toContain("Remaining HP is withheld for Focus Sash");
    expect(html).not.toContain("Right Pokémon HP remaining:");
  });

  it("keeps the selected summary independent of filtering and offers one Set hits action", () => {
    const matchup = selectMatchupMove(updateMatchupBuild(createMatchup(), "attacker", createBuild("venusaur")), "bulletseed");
    const result = row("bulletseed", "needs-context");
    expect(filterMoveResults([result], "surf", "all")).toEqual([]);
    const html = summaryHTML(matchup, result);
    expect(html).toContain("Bullet Seed");
    expect(html).toContain(">Set hits</button>");
    expect(html).not.toMatch(/<select\b/);
    expect(html).not.toContain("Right Pokémon HP remaining:");
  });

  it("shows ownership independently of attacker/defender and keeps it correct after Swap", () => {
    const matchup = createMatchup();
    matchup.attacker.source = { key: "own", leagueId: "league", memberId: "own", rosterId: "own-roster", name: "Charizard", speciesId: "charizard" };
    matchup.defender.source = { key: "opponent", leagueId: "league", memberId: "opponent", rosterId: "other-roster", name: "Blastoise", speciesId: "blastoise" };
    const html = summaryHTML(swapMatchup(matchup)).replace(/&#x27;/g, "'");
    expect(html).toContain("Left Pokémon · Opponent's team");
    expect(html).toContain("Right Pokémon · Your team");
    expect(html).toContain('aria-label="Blastoise left current HP"');
    expect(html).toContain('aria-label="Charizard right current HP"');
  });
});
