import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TeamSetup, { type TeamSetupProps } from "@/app/(app)/training/setup/TeamSetup";
import { FORMAT_FACTS } from "@/app/(app)/training/model/format-facts";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { SetupDraft, SuggestionState, TrainingSnapshot } from "@/app/(app)/training/model/view-types";
import { createSetupDraft, resolveSetup } from "@/app/(app)/training/setup/team-draft";
import { initialSnapshot } from "@/app/(app)/training/training-session";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState, runtime, suggestedSet } from "../fixtures/training";
import { positionalIn } from "../fixtures/naming";

// Real SSR and hooks while recording host handlers for DOM-free callback tests (as calculator-doubles-ui.test.ts does).
const host = vi.hoisted(() => ({ capture: false, buttons: [] as Record<string, unknown>[], inputs: [] as Record<string, unknown>[] }));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (!host.capture) return;
    if (type === "button") host.buttons.push(props as Record<string, unknown>);
    if (type === "input") host.inputs.push(props as Record<string, unknown>);
  };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { record(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { record(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (host.capture && args[0] === "button") host.buttons.push(args[1] as Record<string, unknown>);
      if (host.capture && args[0] === "input") host.inputs.push(args[1] as Record<string, unknown>);
      return actual.jsxDEV(...args);
    },
  };
});

const text = (props: Record<string, unknown>) => JSON.stringify(props.children ?? "");
const startTag = (html: string) => /<button[^>]*data-training-start[^>]*>/.exec(html)?.[0] ?? "";

function rosters(state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)): TeamSetupProps["rosters"] {
  return { state, selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() };
}

function suggestionsFor(draft: SetupDraft, state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)) {
  const idle: SuggestionState = { status: "idle" };
  const loading = resolveSetup(draft, state, { own: idle, opponent: idle }, runtime);
  const sets = (team: typeof loading.own): SuggestionState => ({
    status: "ready", key: team.suggestKey!,
    sets: Object.fromEntries(team.suggestMembers.map((member, index) => [member.key, suggestedSet(member.key, member.speciesId, ["protect", "earthquake"], {
      abilityId: runtime.speciesById.get(member.speciesId)!.abilities[0],
      ...(index === 0 ? { itemId: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, protectAdded: true } : {}),
    })])),
  });
  return { own: sets(loading.own), opponent: sets(loading.opponent) };
}

function snapshotWith(patch: Partial<TrainingSnapshot> = {}, draft: SetupDraft = createSetupDraft()): TrainingSnapshot {
  return { ...initialSnapshot(), engine: { status: "ready" }, draft, suggestions: suggestionsFor(draft), ...patch };
}

function session(): TeamSetupProps["session"] & Record<string, ReturnType<typeof vi.fn>> {
  return { updateDraft: vi.fn(), validate: vi.fn(), suggest: vi.fn(), loadMoveOptions: vi.fn(), start: vi.fn(), clearHabits: vi.fn(), setTrendsOpen: vi.fn(), retryEngine: vi.fn() };
}

function render(snapshot: TrainingSnapshot, actions = session(), state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)) {
  host.buttons = [];
  host.inputs = [];
  host.capture = true;
  try {
    const html = renderToStaticMarkup(createElement(TeamSetup, { runtime, rosters: rosters(state), snapshot, session: actions } satisfies ComponentProps<typeof TeamSetup>));
    return { html, buttons: host.buttons, inputs: host.inputs, actions };
  } finally {
    host.capture = false;
  }
}

function validFor(snapshot: TrainingSnapshot) {
  const resolved = resolveSetup(snapshot.draft, rosterState(OWN_ROSTER, OPPONENT_ROSTER), snapshot.suggestions, runtime);
  return { resolved, validation: { status: "ready" as const, key: resolved.key!, own: { team: [], members: {} }, opponent: { team: [], members: {} } } };
}

describe("Training setup", () => {
  it("renders both teams with source buttons, Choose 6 counts and suggested set facts", () => {
    const { html } = render(snapshotWith());
    expect(html.match(/data-training-team="(own|opponent)"/g)).toEqual(['data-training-team="own"', 'data-training-team="opponent"']);
    expect(html).toMatch(/aria-pressed="true"[^>]*>League team</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>PokéPaste</);
    expect(html).toContain("Choose 6 · 6 of 7 chosen");
    expect(html).toContain("6 chosen");
    expect(html).toContain("Suggested set");
    expect(html).toContain("Protect added");
    expect(html).toContain("Rough Skin · Life Orb · Jolly · 66 SP");
    expect(html).toContain("Protect · Earthquake");
    expect(html).toContain("Edit set");
  });

  it("shows the format facts, the AI radios, habits and the information lines", () => {
    const { html } = render(snapshotWith({ habits: { turns: 37, data: emptyHabits() } }));
    for (const fact of FORMAT_FACTS) expect(html).toContain(`>${fact.term}</dt>`);
    expect(html).toContain(">AI knows</dt><dd class=\"mb-1 min-w-0 wrap-anywhere text-text sm:mb-0\">Open: Natures · Items · Abilities · Moves · Closed: Stat Points");
    expect(html).toContain("Usage</dt><dd class=\"mb-1 min-w-0 wrap-anywhere text-text sm:mb-0\">Smogon 2026-08 VGC Reg M-B");
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(new Set(radios.map((radio) => /name="([^"]+)"/.exec(radio)?.[1])).size).toBe(1);
    expect(radios.find((radio) => radio.includes('value="safe"'))).toContain("checked");
    expect(html).toContain("Habits: 37 turns in this browser");
    expect(html).toContain("Show the AI&#x27;s read after each turn");
    expect(html).toContain("data-training-info");
  });

  it("shows Your trends right after the habits count: collapsed by default, the facts when open, empty once habits are cleared", () => {
    const data = { ...emptyHabits(), battles: 2, classes: { "*": { protect: 3, "attack-best": 7 } } };
    const closed = render(snapshotWith({ habits: { turns: 5, data } }));
    expect(closed.html).toMatch(/Habits: 5 turns in this browser<\/span><button[^>]*>Clear habits<\/button><\/div><div data-training-trends/);
    expect(closed.html).toMatch(/<button[^>]*data-training-trends-toggle[^>]*aria-expanded="false"/);
    expect(closed.html).not.toContain("3 of 10 actions");
    const toggle = closed.buttons.find((button) => button["data-training-trends-toggle"]);
    (toggle!.onClick as () => void)();
    expect(closed.actions.setTrendsOpen).toHaveBeenCalledWith(true);
    const open = render(snapshotWith({ habits: { turns: 5, data }, trendsOpen: true }));
    expect(open.html).toMatch(/<button[^>]*data-training-trends-toggle[^>]*aria-expanded="true"/);
    expect(open.html).toContain(">30% (3 of 10 actions)</dd>");
    const cleared = render(snapshotWith({ habits: { turns: 0, data: emptyHabits() }, trendsOpen: true }));
    expect(cleared.html).toContain(">No turns recorded</p>");
    // Your aimed moves: at a foe (either one) or at your partner, never a foe by its place.
    const aimed = render(snapshotWith({ habits: { turns: 5, data: { ...data, aims: { "attack-best": { left: 2, right: 1, ally: 1 } } } }, trendsOpen: true }));
    expect(aimed.html).toMatch(/A foe<\/dt><dd[^>]*>75% \(3 of 4 aimed moves\)<\/dd>/);
    expect(aimed.html).toMatch(/Your partner<\/dt><dd[^>]*>25% \(1 of 4 aimed moves\)<\/dd>/);
    expect(positionalIn(aimed.html)).toEqual([]);
  });

  it("keeps Start disabled with facts until Showdown's validator accepts the current key", () => {
    const loading = render({ ...snapshotWith(), engine: { status: "loading" } });
    expect(loading.html).toContain("Loading battle rules…");
    expect(startTag(loading.html)).toContain('disabled=""');
    const base = snapshotWith();
    const { resolved, validation } = validFor(base);
    const checking = render({ ...base, validation: { status: "checking", key: resolved.key! } });
    expect(checking.html).toContain("Checking teams with Showdown rules…");
    expect(startTag(checking.html)).toContain('disabled=""');
    const problem = render({ ...base, validation: { ...validation, own: { team: ["You are limited to 1 of each item by Item Clause."], members: { [resolved.own.chosen[1]]: ["Gyarados can't learn Spore."] } } } });
    expect(problem.html).toContain("You are limited to 1 of each item by Item Clause.");
    expect(problem.html).toContain("Gyarados can&#x27;t learn Spore.");
    expect(problem.html).toContain("Showdown rules: 2 problems.");
    const valid = render({ ...base, validation });
    expect(valid.html).toContain("Teams valid for VGC 2026 Reg M-C.");
    expect(startTag(valid.html)).not.toContain('disabled=""');
    const start = valid.buttons.find((button) => button["data-training-start"]);
    (start!.onClick as () => void)();
    const setup = vi.mocked(valid.actions.start).mock.calls[0][0];
    expect(setup.own.members).toHaveLength(6);
    expect(setup.opponent.members).toHaveLength(6);
    expect(setup.info).toEqual(DEFAULT_INFO);
  });

  it("states a missing team, opponent or league once per side, as a fact", () => {
    const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const count = (html: string, fact: string) => html.split(`>${fact}</p>`).length - 1;
    const none = render(snapshotWith(), session(), { ...base, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html;
    expect(count(none, "No team chosen.")).toBe(2);
    const empty = render(snapshotWith(), session(), { ...base, leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html;
    expect(count(empty, "No leagues.")).toBe(2);
    const noOpponent = render(snapshotWith(), session(), { ...base, opponentId: "" }).html;
    expect(count(noOpponent, "No opponent chosen.")).toBe(1);
    // Teams that failed to load: the picker's alert on each side, not the roster's "Could not load this league's teams." too.
    const failed = render(snapshotWith(), session(), { ...base, teamsStatus: "error", data: null }).html;
    expect(failed.split("League teams unavailable").length - 1).toBe(2);
    expect(failed).not.toContain("Could not load this league&#x27;s teams.");
    expect(none + empty + noOpponent).not.toMatch(/Choose (a|an|your)\b|manual|Join or create/);
    expect(positionalIn(none + empty + noOpponent + failed)).toEqual([]);
  });

  it("lists local blockers as facts", () => {
    const short = rosterState(OWN_ROSTER.slice(0, 5), OPPONENT_ROSTER);
    const draft = createSetupDraft();
    const snapshot = { ...snapshotWith({}, draft), suggestions: suggestionsFor(draft, short) };
    const { html } = render(snapshot, session(), short);
    expect(html).toMatch(/data-training-blocker="true">Your team: Choose 6 \(5 chosen\)\./);
  });

  it("hides the opponent's closed categories and its editor unless every category is open", () => {
    const draft = { ...createSetupDraft(), info: { ...DEFAULT_INFO, youSee: CLOSED_TEAM_SHEETS } };
    const { html } = render(snapshotWith({}, draft));
    const opponent = html.slice(html.indexOf('data-training-team="opponent"'));
    expect(opponent).toContain("Abilities: not shown · Items: not shown · Natures: not shown · Stat Points: not shown");
    expect(opponent).toContain("Moves: not shown");
    expect(opponent).not.toContain("Edit set");
    expect(opponent).not.toContain("Edit as PokéPaste");
    const own = html.slice(0, html.indexOf('data-training-team="opponent"'));
    expect(own).toContain("Edit as PokéPaste");
    const defaults = render(snapshotWith());
    expect(defaults.html.slice(defaults.html.indexOf('data-training-team="opponent"'))).not.toContain("Edit as PokéPaste");
    const allOpen = { ...createSetupDraft(), info: { ...DEFAULT_INFO, youSee: { ...PERFECT_INFORMATION, exactHP: false, brought: false } } };
    const open = render(snapshotWith({}, allOpen));
    const opponentOpen = open.html.slice(open.html.indexOf('data-training-team="opponent"'));
    expect(opponentOpen).toContain("Edit as PokéPaste");
    expect(opponentOpen).toContain("Edit set");
    expect(opponentOpen).toContain("Pressure · Life Orb · Jolly · 66 SP".replace("Pressure", "Justified"));
  });

  it("asks for suggestions again from the error's Retry and shows the PokéPaste importer in paste mode", () => {
    const draft = createSetupDraft();
    const base = snapshotWith({}, draft);
    const failed = { ...base, suggestions: { ...base.suggestions, own: { status: "error" as const, key: (base.suggestions.own as { key: string }).key, message: "Usage data missing." } } };
    const { html, buttons, actions } = render(failed);
    expect(html).toContain("Suggested sets unavailable");
    expect(html).toContain("Usage data missing.");
    (buttons.find((button) => text(button).includes("Retry"))!.onClick as () => void)();
    expect(actions.suggest).toHaveBeenCalledWith("own", expect.any(String), expect.any(Array), true);
    const paste = render(snapshotWith({}, { ...draft, own: { ...draft.own, mode: "paste" } }));
    expect(paste.html).toContain('data-paste-importer="own"');
  });

  it("Edit as PokéPaste exports the six into the importer's draft", () => {
    const { buttons, actions } = render(snapshotWith());
    (buttons.find((button) => text(button).includes("Edit as PokéPaste"))!.onClick as () => void)();
    const update = vi.mocked(actions.updateDraft).mock.calls[0][0];
    const next = update(createSetupDraft());
    expect(next.own.mode).toBe("paste");
    expect(next.own.epoch).toBe(1);
    expect(next.own.pasteDraft?.format).toBe("champions");
    expect(next.own.pasteDraft?.text.split("\n\n")).toHaveLength(6);
    expect(next.own.pasteDraft?.text.startsWith("Garchomp @ Life Orb\nAbility: Rough Skin\nLevel: 50\nSPs: 2 HP / 32 Atk / 32 Spe\nJolly Nature")).toBe(true);
  });

  it("opens a member's set editor and asks for its legal moves", () => {
    const { buttons, actions } = render(snapshotWith());
    const edit = buttons.find((button) => text(button).includes("Edit set"))!;
    expect(edit["aria-expanded"]).toBe(false);
    try { (edit.onClick as () => void)(); } catch { /* a server-rendered state setter */ }
    expect(actions.loadMoveOptions).toHaveBeenCalledWith("garchomp");
  });
});
