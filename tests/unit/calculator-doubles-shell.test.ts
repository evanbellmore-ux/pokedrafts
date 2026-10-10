import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDoubles, chooseDoublesMove, followShared, getDoublesTurnInput, setDoublesMovesInto, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import { createRosterState, type CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { createMatchup, getMoveOwner, reconcileRosters } from "@/app/(app)/calculator/roster-prep";
import { doublesIdentity, useDoublesCalculation, type DoublesEngine } from "@/app/(app)/calculator/useDoublesCalculation";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import type { MatchupResult } from "@/app/lib/battle/calculate";
import type { DoublesSlotId, DoublesTargetRule, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { positionalIn } from "../fixtures/naming";

// The target rules are the engine's (doubles-targets.ts); a fixed table here.
vi.mock("@/app/lib/battle/doubles-targets", async () => {
  const types = await import("@/app/lib/battle/doubles-types");
  return {
    doublesTargetRule: (_input: unknown, slot: DoublesSlotId, moveId: string): DoublesTargetRule => moveId === "earthquake"
      ? { kind: "auto", hits: [...types.foesOf(slot), types.allyOf(slot)] }
      : { kind: "choose", options: [...types.foesOf(slot), types.allyOf(slot)] },
    defaultDoublesTarget: (rule: DoublesTargetRule, current: DoublesSlotId | null, preferred: DoublesSlotId | null) => rule.kind !== "choose" ? null
      : current && rule.options.includes(current) ? current : preferred && rule.options.includes(preferred) ? preferred : rule.options[0],
  };
});
// SSR runs no effects, so the lazily imported engine never loads here; its module only has to resolve.
vi.mock("@/app/lib/battle/doubles-turn", () => ({
  calculateDoublesTurn: vi.fn(), calculateDoublesMoves: vi.fn(), doublesRepresentative: vi.fn(() => null), DOUBLES_REFERENCE: { on: false },
}));

const state = vi.hoisted(() => ({ doubles: null as DoublesMatchup | null, desktop: false, rosters: null as CalculatorRosterState | null }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => state.desktop }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({
  default: () => ({ state: state.rosters ?? createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/app/(app)/calculator/doubles-prep", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/doubles-prep")>();
  return { ...actual, createDoubles: (...args: Parameters<typeof actual.createDoubles>) => state.doubles ?? actual.createDoubles(...args) };
});
afterEach(() => {
  state.doubles = null;
  state.desktop = false;
  state.rosters = null;
});

function team(id: string, memberId: string, names: string[]): TeamRoster {
  return {
    id, member_id: memberId, total_points: names.length * 15, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })),
  };
}

function loaded(): CalculatorRosterState {
  return {
    status: "ready", userId: "user-account", selectedLeagueId: "league-a", opponentId: "member-other",
    leagues: [{ id: "league-a", name: "Alpha", memberId: "member-own", teamName: "Home", draftStarted: true, draftCompleted: true }],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-own", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-other", role: "coach", team_name: "Away", draft_position: 2 },
      ],
      teams: [team("team-own", "member-own", ["Garchomp", "Incineroar"]), team("team-other", "member-other", ["Gyarados", "Venusaur"])],
    },
  };
}

async function render(props: { initialMode?: "1v1" | "2v2" } = {}) {
  const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
  return renderToStaticMarkup(createElement(CalculatorClient, props));
}

const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

/** The opening tag of the first element carrying `attribute`. */
function tag(html: string, attribute: string) {
  return html.match(new RegExp(`<[a-z]+\\b[^>]*${attribute}[^>]*>`))?.[0] ?? "";
}

function assertReferences(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  for (const [, references] of html.matchAll(/\baria-(?:controls|describedby|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect(ids).toContain(id);
  }
}

describe("the 1v1 | 2v2 switch", () => {
  it("adds only the switch to the default 1v1 page", async () => {
    const html = await render();
    const group = html.match(/<div\b[^>]*role="group"[^>]*aria-label="Matchup"[^>]*>[\s\S]*?<\/div>/)![0];
    expect(group).toContain("data-calculator-mode-switch");
    const buttons = [...group.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)];
    expect(buttons.map(([button, label]) => [label, button.match(/aria-pressed="(\w+)"/)![1], button.match(/data-calculator-mode="([^"]+)"/)![1]]))
      .toEqual([["1v1", "true", "1v1"], ["2v2", "false", "2v2"]]);
    expect(html).not.toContain("role=\"tablist\" aria-label=\"Matchup\"");
    // Under the page header, above the Battle game.
    expect(html.indexOf("data-calculator-mode-switch")).toBeGreaterThan(html.indexOf("Damage Calculator"));
    expect(html.indexOf("data-calculator-mode-switch")).toBeLessThan(html.indexOf('aria-label="Battle game rules"'));
    expect(html).not.toMatch(/data-doubles-|data-calculator-mode-only="2v2"/);
    expect(count(html, /role="tab"/g)).toBe(3);
    expect(count(html, /role="tabpanel"/g)).toBe(3);
    expect(count(html, /data-calculator-hp="true"/g)).toBe(2);
    expect(count(html, /data-calculator-roster="/g)).toBe(2);
    expect(html).toContain("Swap</button>");
    expect(html).toContain("Reset</button>");
    expect(html.indexOf('role="tabpanel"')).toBeGreaterThan(html.indexOf('data-field-region="true"'));
    expect(tag(html, "data-calculator-workspace")).toContain('data-calculator-mode="1v1"');
    for (const marker of ["data-calculator-settings", "data-calculator-mode-only=\"1v1\""]) expect(tag(html, marker)).not.toContain('hidden=""');
    expect(count(html, /Loading the Champions engine/g)).toBe(1);
    assertReferences(html);
  });

  it("opens in 2v2 with the 1v1 view hidden and mounted, four cards and four Build settings", async () => {
    const html = await render({ initialMode: "2v2" });
    const group = html.match(/<div\b[^>]*aria-label="Matchup"[^>]*>[\s\S]*?<\/div>/)![0];
    expect(group).toMatch(/aria-pressed="false"[^>]*>1v1</);
    expect(group).toMatch(/aria-pressed="true"[^>]*>2v2</);
    expect(html).not.toContain("Swap</button>");
    expect(html).toContain("Reset</button>");
    expect(tag(html, "data-calculator-workspace")).toContain('data-calculator-mode="2v2"');
    const oneOnly = [...html.matchAll(/<div\b[^>]*data-calculator-mode-only="1v1"[^>]*>/g)].map(([element]) => element);
    // The summary's sticky box, the settings and the Moves list.
    expect(oneOnly).toHaveLength(3);
    for (const element of oneOnly) expect(element).toContain('hidden=""');
    expect(oneOnly[1]).toMatch(/^<div data-calculator-settings="true"/);
    const twoOnly = [...html.matchAll(/<div\b[^>]*data-calculator-mode-only="2v2"[^>]*>/g)].map(([element]) => element);
    expect(twoOnly).toHaveLength(3);
    for (const element of twoOnly) expect(element).not.toContain('hidden=""');
    expect([...html.matchAll(/data-doubles-slot="([^"]+)"/g)].map((match) => match[1])).toEqual(["own-left", "own-right", "opponent-left", "opponent-right"]);
    const toggles = [...html.matchAll(/<button\b[^>]*data-(build|field)-toggle="([^"]+)"[^>]*aria-expanded="(\w+)"/g)].map(([, kind, value, expanded]) => [kind, value, expanded]);
    expect(toggles).toEqual([
      ["build", "attacker", "false"], ["build", "defender", "false"], ["field", "true", "false"],
      ["build", "own-left", "false"], ["build", "own-right", "false"], ["build", "opponent-left", "false"], ["build", "opponent-right", "false"], ["field", "true", "false"],
    ]);
    // The engine loads after the first render: one feedback, the 2v2 one, and the paused turn.
    expect(count(html, /data-calculator-feedback="true"/g)).toBe(1);
    expect(count(html, /Loading the Champions engine/g)).toBe(1);
    expect(html.slice(html.indexOf("data-doubles-turn"))).toContain("HP preview paused while the calculator loads.");
    expect(count(html, /role="tab"/g)).toBe(3);
    expect(count(html, /role="tabpanel"/g)).toBe(3);
    // Compact layout: each slot's roster in its Build settings.
    expect([...html.matchAll(/data-calculator-roster="([^"]+)"/g)].map((match) => match[1])).toEqual(["attacker", "defender", "own-left", "own-right", "opponent-left", "opponent-right"]);
    for (const slot of ["own-left", "own-right", "opponent-left", "opponent-right"]) {
      const start = html.indexOf(`data-build-region="${slot}"`);
      const end = start + 1 + html.slice(start + 1).search(/data-(?:build|field)-section=/);
      const roster = html.indexOf(`data-calculator-roster="${slot}"`);
      expect(start).toBeGreaterThan(-1);
      expect(roster > start && roster < end).toBe(true);
    }
    expect(html).not.toContain("data-calculator-roster-rail");
    // The Moves pane: the 1v1 list (hidden), the 2v2 list, and Coverage once.
    const moves = html.slice(html.indexOf('data-calculator-panel="moves"'), html.indexOf('data-calculator-panel="opponent"'));
    expect(moves.indexOf('data-calculator-mode-only="1v1"')).toBeLessThan(moves.indexOf("data-doubles-moves"));
    expect(count(moves, /Coverage and sources/g)).toBe(1);
    // Both lists' headings are a fact (the menu's name), not an instruction.
    expect(count(moves, /Choose a move<\/h2>/g)).toBe(0);
    expect(count(moves, />Moves<\/h2>/g)).toBe(2);
    const twoMoves = moves.slice(moves.indexOf("data-doubles-moves"));
    expect(twoMoves).toMatch(/<h2 id="[^"]+" class="wrap-anywhere text-xl font-bold text-text">Moves<\/h2>/);
    expect(moves).toContain("Charizard → Blastoise");
    expect(positionalIn(html)).toEqual([]);
    // Each view's field summary once.
    expect(count(html, /Doubles · No weather · No terrain/g)).toBe(2);
    assertReferences(html);
  });

  it("puts each team's shortcuts on a rail with a button per slot at desktop width", async () => {
    state.desktop = true;
    state.rosters = loaded();
    const html = await render({ initialMode: "2v2" });
    const text = (value: string) => value.replaceAll("&#x27;", "'");
    const rails = [...html.matchAll(/<aside\b[^>]*data-calculator-roster-rail="([^"]+)"[^>]*>/g)].map(([element, side]) => [side, text(element.match(/aria-label="([^"]+)"/)![1])]);
    expect(rails).toEqual([["own", "Your team shortcuts"], ["opponent", "Opponent's team shortcuts"]]);
    expect(html).not.toMatch(/data-calculator-roster-rail="(?:attacker|defender)"/);
    const slots = [...html.matchAll(/<button\b[^>]*data-roster-slot="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*><span[^>]*>([^<]*)<\/span><\/button>/g)].map(([, slot, label, visible]) => [slot, text(label), text(visible)]);
    expect(slots.map(([slot, label]) => [slot, label])).toEqual([
      ["own-left", "Replace Charizard with Garchomp from your team"], ["own-right", "Replace Venusaur with Garchomp from your team"],
      ["own-left", "Replace Charizard with Incineroar from your team"], ["own-right", "Replace Venusaur with Incineroar from your team"],
      ["opponent-left", "Replace Blastoise with Gyarados from opponent's team"], ["opponent-right", "Replace Pikachu with Gyarados from opponent's team"],
      ["opponent-left", "Replace Blastoise with Venusaur from opponent's team"], ["opponent-right", "Replace Pikachu with Venusaur from opponent's team"],
    ]);
    // Each button shows "Replace {card}", inside its accessible name.
    expect(slots.map(([, , visible]) => visible)).toEqual(["Replace Charizard", "Replace Venusaur", "Replace Charizard", "Replace Venusaur", "Replace Blastoise", "Replace Pikachu", "Replace Blastoise", "Replace Pikachu"]);
    for (const [, label, visible] of slots) expect(label).toContain(visible);
    expect(html).not.toMatch(/data-calculator-roster="(?:own|opponent)-(?:left|right)"/);
    expect(positionalIn(html)).toEqual([]);
    assertReferences(html);
  });

  it("shows a chosen move pressed with its target, from injected 2v2 state", async () => {
    let doubles = createDoubles();
    const charizard = doubles.slots["own-left"];
    const moveId = charizard.moves.find((move) => move.moveId && move.moveId !== "protect")!.moveId!;
    const matchup = createMatchup();
    doubles = chooseDoublesMove({ matchup, doubles }, getMoveOwner(charizard), moveId).doubles;
    state.doubles = doubles;
    const html = await render({ initialMode: "2v2" });
    const card = html.slice(html.indexOf('data-doubles-slot="own-left"'), html.indexOf('data-doubles-slot="own-right"'));
    const pressed = [...card.matchAll(/<button\b[^>]*data-move-slot="(\d)"[^>]*aria-pressed="true"/g)].map((match) => Number(match[1]));
    expect(pressed).toEqual([charizard.moves.findIndex((move) => move.moveId === moveId)]);
    expect(card).toMatch(/data-doubles-no-move="own-left"[^>]*aria-pressed="false"/);
    const radios = [...card.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(([input]) => [input.match(/value="([^"]+)"/)![1], input.includes('checked=""')]);
    expect(radios).toEqual([["opponent-left", true], ["opponent-right", false], ["own-right", false]]);
    expect(card).toContain('data-doubles-action="own-left"');
    const other = html.slice(html.indexOf('data-doubles-slot="own-right"'), html.indexOf('data-doubles-slot="opponent-left"'));
    expect(other).toMatch(/data-doubles-no-move="own-right"[^>]*aria-pressed="true"/);
    expect(html.slice(html.indexOf("data-doubles-turn"))).toContain("HP preview paused while the calculator loads.");
    assertReferences(html);
  });
});

describe("useDoublesCalculation", () => {
  const ready: DoublesTurnResult = { status: "not-estimated", reason: "Too many cases to follow.", start: null, startRows: [], facts: [] };
  const rows: MatchupResult = { issues: { attacker: [], defender: [], field: [] }, results: [] };

  function Probe({ engine, doubles, enabled, out }: { engine: DoublesEngine | null; doubles: DoublesMatchup; enabled: boolean; out: { value: unknown } }) {
    out.value = useDoublesCalculation(engine, doubles, enabled);
    return null;
  }

  function run(engine: DoublesEngine | null, doubles: DoublesMatchup, enabled = true) {
    const out = { value: undefined as unknown };
    renderToStaticMarkup(createElement(Probe, { engine, doubles, enabled, out }));
    return out.value as ReturnType<typeof useDoublesCalculation>;
  }

  const engine = (overrides: Partial<DoublesEngine> = {}) => ({
    calculateDoublesTurn: vi.fn(() => ready), calculateDoublesMoves: vi.fn(() => rows), doublesRepresentative: vi.fn(() => null),
    DOUBLES_REFERENCE: { on: false }, ...overrides,
  }) as unknown as DoublesEngine & { calculateDoublesTurn: ReturnType<typeof vi.fn>; calculateDoublesMoves: ReturnType<typeof vi.fn> };

  it("calculates the turn and the Moves pane's rows from the 2v2 state", () => {
    const matchup = createMatchup();
    const doubles = setDoublesMovesInto({ matchup, doubles: createDoubles() }, "own-right").doubles;
    const mocked = engine();
    const result = run(mocked, doubles)!;
    expect(result).toEqual({ identity: doublesIdentity(doubles), turn: ready, turnError: null, moves: rows, movesError: null });
    expect(mocked.calculateDoublesTurn).toHaveBeenCalledWith(getDoublesTurnInput(doubles));
    expect(mocked.calculateDoublesMoves).toHaveBeenCalledWith(getDoublesTurnInput(doubles), "own-left", "own-right");
    expect(JSON.parse(result.identity)).toEqual([doubles.runtime.identity, ["0:0", "1:0", "2:0", "3:0"], "own-left", "own-right"]);
  });

  it("calculates nothing in 1v1 or before the engine loads, and reports engine errors", () => {
    const doubles = createDoubles();
    const mocked = engine();
    expect(run(mocked, doubles, false)).toBeNull();
    expect(run(null, doubles)).toBeNull();
    expect(mocked.calculateDoublesTurn).not.toHaveBeenCalled();
    const failing = engine({ calculateDoublesTurn: vi.fn(() => { throw new Error("Turn failed."); }) as unknown as DoublesEngine["calculateDoublesTurn"] });
    expect(run(failing, doubles)).toMatchObject({ turn: null, turnError: "Turn failed.", moves: rows, movesError: null });
  });

  it("keeps the identity of the four owners across a roster refresh that changes nothing", () => {
    const matchup = reconcileRosters(createMatchup(), loaded());
    const doubles = createDoubles();
    expect(doublesIdentity(followShared(doubles, matchup, reconcileRosters(matchup, loaded()), loaded()))).toBe(doublesIdentity(doubles));
  });
});
