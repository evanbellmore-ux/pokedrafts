import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyTeamPicker, OpponentPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import PokePasteImporter from "@/app/(app)/calculator/PokePasteImporter";
import TeamSetup, { type TeamSetupProps } from "@/app/(app)/training/setup/TeamSetup";
import { FORMAT_FACTS } from "@/app/(app)/training/model/format-facts";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { SetupDraft, TrainingSnapshot } from "@/app/(app)/training/model/view-types";
import { createSetupDraft, resolveSetup } from "@/app/(app)/training/setup/team-draft";
import setupStyles from "@/app/(app)/training/setup/setup.module.css";
import { MIRROR_ROSTER, OPPONENT_ROSTER, OWN_ROSTER, rosterState, runtime, snapshotWith, suggestionsFor } from "../fixtures/training";
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
const startTag = (html: string) => /<button[^>]*data-training-start="true"[^>]*>/.exec(html)?.[0] ?? "";
/** The status region Start is described by (no nested div), and the team panels above the Battle settings card. */
const readiness = (html: string) => /<div[^>]*data-training-readiness[^>]*>([^]*?)<\/div>/.exec(html)?.[1] ?? "";
const panels = (html: string) => html.slice(0, html.indexOf(">Battle settings</h2>"));
/** The league rosters' row above the two teams (one Refresh teams, the rosters' status). */
const rostersRow = (html: string) => html.includes("data-training-rosters") ? html.slice(html.indexOf("<div data-training-rosters"), html.indexOf('data-training-team="own"')) : "";
/** One side's team panel. */
const panelOf = (html: string, role: "own" | "opponent") => role === "own"
  ? html.slice(html.indexOf('data-training-team="own"'), html.indexOf('data-training-team="opponent"'))
  : html.slice(html.indexOf('data-training-team="opponent"'), html.indexOf(">Battle settings</h2>"));
/** Markup without its tags (the text a sighted reader sees, screen-reader text included). */
const plain = (html: string) => html.replace(/<[^>]+>/g, "");
/** The sticky Start bar: the setup's last child. */
const startBar = (html: string) => html.slice(html.indexOf("<div data-training-start-bar"));

function rosters(state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)): TeamSetupProps["rosters"] {
  return { state, selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() };
}

function session(): TeamSetupProps["session"] & Record<string, ReturnType<typeof vi.fn>> {
  return { updateDraft: vi.fn(), validate: vi.fn(), suggest: vi.fn(), loadMoveOptions: vi.fn(), start: vi.fn(), clearHabits: vi.fn(), setTrendsOpen: vi.fn(), retryEngine: vi.fn() };
}

function render(snapshot: TrainingSnapshot, actions = session(), state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)) {
  host.buttons = [];
  host.inputs = [];
  host.capture = true;
  try {
    const value = rosters(state);
    const html = renderToStaticMarkup(createElement(TeamSetup, { runtime, rosters: value, snapshot, session: actions } satisfies ComponentProps<typeof TeamSetup>));
    return { html, buttons: host.buttons, inputs: host.inputs, actions, rosters: value };
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
    // "AI knows" / "You see" are stated once, under the Information panel's presets (not among the format facts).
    expect(html).not.toContain(">AI knows</dt>");
    expect(html).toMatch(/data-training-info-fact="aiKnows"[^>]*>Open: Natures · Items · Abilities · Moves · Closed: Stat Points<\/p>/);
    expect(html).toContain("Usage</dt><dd class=\"mb-1 min-w-0 wrap-anywhere text-text sm:mb-0\">Smogon 2026-08 VGC Reg M-B");
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(new Set(radios.map((radio) => /name="([^"]+)"/.exec(radio)?.[1])).size).toBe(1);
    expect(radios.find((radio) => radio.includes('value="safe"'))).toContain("checked");
    expect(html).toContain("Habits: 37 turns in this browser");
    expect(html).toContain("Show the AI&#x27;s read after each turn");
    expect(html).toContain("data-training-info");
  });

  it("orders Battle settings: AI difficulty, the read, habits and trends, Information, then the format facts closed behind Format and rules", () => {
    const { html } = render(snapshotWith({ habits: { turns: 37, data: emptyHabits() } }));
    expect(html).toContain(">Battle settings</h2>");
    expect(html).not.toMatch(/>Battle<\/h2>/);
    const at = (text: string) => {
      const index = html.indexOf(text);
      expect(index, text).toBeGreaterThan(0);
      return index;
    };
    expect(at(">AI difficulty</legend>")).toBeLessThan(at("Show the AI&#x27;s read after each turn"));
    expect(at("Show the AI&#x27;s read after each turn")).toBeLessThan(at("Habits: 37 turns in this browser"));
    expect(at("Habits: 37 turns in this browser")).toBeLessThan(at("data-training-trends"));
    expect(at("data-training-trends")).toBeLessThan(at("<fieldset data-training-info"));
    expect(at("<fieldset data-training-info")).toBeLessThan(at("<details data-training-format"));
    expect(at("<details data-training-format")).toBeLessThan(at("data-training-readiness"));
    // Every format fact stays in the markup inside the closed disclosure; its summary states the format in short.
    const format = /<details data-training-format([^>]*)>([^]*?)<\/details>/.exec(html)!;
    expect(format[1]).not.toMatch(/\bopen\b/);
    expect(format[2]).toMatch(/^<summary[^>]*><span class="font-semibold text-text">Format and rules<\/span> <span class="text-muted">Doubles · Level 50 · Bring 6, pick 4<\/span><\/summary>/);
    for (const fact of FORMAT_FACTS) expect(format[2]).toContain(`>${fact.term}</dt><dd class="mb-1 min-w-0 wrap-anywhere text-text sm:mb-0">${fact.value.replace(/'/g, "&#x27;")}</dd>`);
    // Each difficulty card side by side: named by its label, described by its fact.
    expect(html).toContain('<legend class="text-sm font-semibold text-text">AI difficulty</legend><div class="mt-1.5 grid grid-cols-2 gap-1.5">');
    const safe = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]).find((radio) => radio.includes('value="safe"'))!;
    expect(html).toContain(`<span id="${/aria-labelledby="([^"]+)"/.exec(safe)![1]}" class="block font-semibold text-text">Plays safe</span>`);
    expect(html).toContain(`<span id="${/aria-describedby="([^"]+)"/.exec(safe)![1]}" class="block wrap-anywhere text-xs text-muted">Assumes your best reply</span>`);
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

  it("keeps Start unavailable with facts until Showdown's validator accepts the current key", () => {
    const loading = render({ ...snapshotWith(), engine: { status: "loading" } });
    expect(readiness(loading.html)).toContain("Loading battle rules…");
    expect(startTag(loading.html)).toContain('aria-disabled="true"');
    const base = snapshotWith();
    const { resolved, validation } = validFor(base);
    const checking = render({ ...base, validation: { status: "checking", key: resolved.key! } });
    expect(readiness(checking.html)).toContain("Checking teams with Showdown rules…");
    expect(startTag(checking.html)).toContain('aria-disabled="true"');
    // Showdown's count per side beside Start; the problems themselves stay in the team's panel.
    const opponentKey = resolved.opponent.chosen[0];
    const problem = render({ ...base, validation: { ...validation, own: { team: ["You are limited to 1 of each item by Item Clause."], members: { [resolved.own.chosen[1]]: ["Gyarados can't learn Spore."] } }, opponent: { team: [], members: { [opponentKey]: ["Absol can't learn Spore."] } } } });
    expect(problem.html).toContain("You are limited to 1 of each item by Item Clause.");
    expect(problem.html).toContain("Gyarados can&#x27;t learn Spore.");
    expect(readiness(problem.html)).toContain('data-training-blocker="true" class="text-danger">Your team: Showdown rules: 2 problems.</p>');
    expect(readiness(problem.html)).toContain('data-training-blocker="true" class="text-danger">Opponent: Showdown rules: 1 problem.</p>');
    expect(readiness(problem.html)).not.toContain("Spore");
    const valid = render({ ...base, validation });
    expect(readiness(valid.html)).toContain("Teams valid for VGC 2026 Reg M-C.");
    expect(startTag(valid.html)).not.toContain('aria-disabled="');
    const start = valid.buttons.find((button) => button["data-training-start"]);
    (start!.onClick as () => void)();
    const setup = vi.mocked(valid.actions.start).mock.calls[0][0];
    expect(setup.own.members).toHaveLength(6);
    expect(setup.opponent.members).toHaveLength(6);
    expect(setup.info).toEqual(DEFAULT_INFO);
    // Against a league opponent: the session remembers it as that league's recent opponent.
    expect(vi.mocked(valid.actions.start).mock.calls[0][1]).toEqual({ leagueId: "league-a", opponentId: "member-other" });
  });

  it("keeps Start focusable while unavailable: described by the one status region, a press does nothing", () => {
    const base = snapshotWith();
    const { resolved } = validFor(base);
    const checking = render({ ...base, validation: { status: "checking", key: resolved.key! } });
    const tag = startTag(checking.html);
    expect(tag).not.toMatch(/\sdisabled=""/);
    expect(tag).toContain("aria-disabled:opacity-60");
    expect(tag).toContain("aria-disabled:hover:bg-accent");
    const describedBy = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(checking.html).toContain(`<div id="${describedBy}" role="status" aria-atomic="false" data-training-readiness="true"`);
    const start = checking.buttons.find((button) => button["data-training-start"]);
    (start!.onClick as () => void)();
    expect(checking.actions.start).not.toHaveBeenCalled();
    // One live region: its lines, and each member's "Suggesting set…", are not live regions of their own.
    const suggesting = render(snapshotWith({ suggestions: { own: { status: "idle" }, opponent: { status: "idle" } } }));
    expect(suggesting.html.match(/role="status"/g)).toHaveLength(1);
    expect(suggesting.html).toContain('<p class="text-xs text-muted">Suggesting set…</p>');
    expect(suggesting.html.match(/<ul id="[^"]+" aria-busy="true"/g)).toHaveLength(2);
    // A failed Showdown check is an alert outside the region, and Start names it too.
    const failed = render({ ...base, validation: { status: "error", key: resolved.key!, message: "Validator crashed." } });
    expect(readiness(failed.html)).not.toContain("Showdown check failed");
    expect(failed.html).toMatch(/<p id="([^"]+)-check" role="alert" data-training-blocker="true"[^>]*>Showdown check failed: Validator crashed\.<\/p>/);
    expect(startTag(failed.html)).toMatch(/aria-describedby="([^"]+)-state \1-check"/);
    // The battle rules unavailable (both teams ready, the region empty): Start names the alert's fact, not its Retry.
    const engineDown = render({ ...base, engine: { status: "error", message: "Worker failed." } });
    const engineTag = startTag(engineDown.html);
    expect(engineTag).toContain('aria-disabled="true"');
    const [, prefix] = /aria-describedby="([^"]+)-engine \1-state"/.exec(engineTag)!;
    expect(engineDown.html).toMatch(new RegExp(`<div role="alert"[^>]*>[^]*?<p class="font-semibold"><span id="${prefix}-engine">Battle rules unavailable: Worker failed\\.</span></p>`));
    expect(readiness(engineDown.html)).toBe('<ul class="space-y-0.5 text-text empty:hidden"></ul>');
    expect(startTag(render(base).html)).toMatch(/aria-describedby="[^"]+-state"/);
  });

  it("says each team's missing piece in one live region: the panels, pickers and rosters row state theirs as plain text", () => {
    const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const draft = createSetupDraft();
    const leagueless = { ...base, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" as const };
    const cases = [
      { state: leagueless, facts: ["Your team: No team chosen.", "Opponent: No team chosen."], shown: "No team chosen." },
      { state: { ...base, opponentId: "" }, facts: ["Opponent: No opponent chosen."], shown: "No opponent chosen." },
      { state: { ...base, teamsStatus: "loading" as const, data: null }, facts: ["Your team: Loading current team rosters…", "Opponent: Loading current team rosters…"], shown: "Loading current team rosters…" },
      { state: { ...base, status: "loading" as const, teamsStatus: "loading" as const, data: null }, facts: ["Your team: Loading your leagues…", "Opponent: Loading your leagues…"], shown: "Loading your leagues…" },
      { state: { ...leagueless, leagues: [] }, facts: ["Your team: No leagues.", "Opponent: No leagues."], shown: "No leagues." },
      { state: leagueless, draft: { ...draft, own: { ...draft.own, mode: "paste" as const } }, facts: ["Your team: No team imported.", "Opponent: No league chosen."], shown: "No league chosen." },
    ];
    for (const { state, facts, shown, draft: current = draft } of cases) {
      const { html } = render(snapshotWith({}, current, state), session(), state);
      expect(html.match(/role="status"/g), shown).toEqual(['role="status"']);
      expect(html).toContain('role="status" aria-atomic="false" data-training-readiness="true"');
      for (const fact of facts) expect(readiness(html)).toContain(`>${fact}</li>`);
      expect(panels(html)).toContain(`>${shown}</p>`);
    }
  });

  it("keeps Start in the setup's last child, the sticky Start bar: the matchup, the one fact Start waits on, Start", () => {
    const base = snapshotWith();
    const { resolved, validation } = validFor(base);
    const valid = render({ ...base, validation });
    // After the Battle settings card (whose end keeps the one live region), as the setup root's last child.
    expect(valid.html).toMatch(/<\/section><div data-training-start-bar="true"/);
    expect(valid.html.endsWith("</button></div></div>")).toBe(true);
    const bar = startBar(valid.html);
    expect(bar).toContain('data-training-start="true"');
    expect(startTag(valid.html)).not.toContain("w-full");
    expect(startTag(valid.html)).toContain("min-h-11");
    expect(bar).not.toMatch(/role="|aria-live/);
    // One height at each width: the matchup one line (from 40rem), the fact in a row as tall as Start, two lines at most.
    expect(bar).toMatch(/^<div data-training-start-bar="true" class="[^"]*"><div class="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-sm sm:min-h-16">/);
    expect(bar).toContain('<p data-training-matchup="true" title="Home vs Away · Plays safe" class="hidden truncate font-medium text-text sm:block">Home vs Away · Plays safe</p>');
    expect(bar).toContain('<p title="Teams valid for VGC 2026 Reg M-C." class="flex min-h-11 min-w-0 items-center gap-1 text-success"><span class="line-clamp-2 wrap-anywhere">Teams valid for VGC 2026 Reg M-C.</span></p>');
    expect(bar.match(/\btruncate\b/g)).toHaveLength(1);
    // Below 40rem a smaller Start (still 44 px tall) leaves the fact its width.
    expect(startTag(valid.html)).toContain("min-h-11 shrink-0 max-sm:px-4 max-sm:text-sm");
    // The first line Start waits on, and how many more: a side's line is a button named by the fact.
    const noOpponent = render(snapshotWith(), session(), { ...rosterState(OWN_ROSTER, OPPONENT_ROSTER), opponentId: "" });
    expect(startBar(noOpponent.html)).toMatch(/<p data-training-start-fact="true" class="flex min-h-11 min-w-0 items-center gap-1"><button type="button" title="Opponent: No opponent chosen\." data-training-start-side="opponent" class="min-h-11 min-w-0 [^"]*"><span class="line-clamp-2 wrap-anywhere underline [^"]*">Opponent: No opponent chosen\.<\/span><\/button><\/p>/);
    expect(startBar(noOpponent.html)).not.toContain("data-training-matchup");
    const suggesting = startBar(render(snapshotWith({ suggestions: { own: { status: "idle" }, opponent: { status: "idle" } } })).html);
    expect(suggesting).toMatch(/data-training-start-side="own"[^>]*><span[^>]*>Your team: Suggesting sets…<\/span><\/button><span class="shrink-0 text-muted">· 1 more<\/span>/);
    const problems = startBar(render({ ...base, validation: { ...validation, own: { team: ["You are limited to 1 of each item by Item Clause."], members: { [resolved.own.chosen[1]]: ["Gyarados can't learn Spore."] } }, opponent: { team: [], members: { [resolved.opponent.chosen[0]]: ["Absol can't learn Spore."] } } } }).html);
    expect(problems).toMatch(/data-training-start-side="own"[^>]*><span[^>]*>Your team: Showdown rules: 2 problems\.<\/span><\/button><span class="shrink-0 text-muted">· 1 more<\/span>/);
    expect(problems).not.toContain("Spore");
    // Lines of no one side are text: the rules loading or unavailable, the Showdown check running or failed.
    expect(startBar(render({ ...base, engine: { status: "loading" } }).html)).toMatch(/<span title="Loading battle rules…" class="min-w-0 line-clamp-2 wrap-anywhere text-muted">Loading battle rules…<\/span><\/p>/);
    expect(startBar(render({ ...base, engine: { status: "error", message: "Worker failed." } }).html)).toContain(">Battle rules unavailable: Worker failed.</span>");
    expect(startBar(render({ ...base, validation: { status: "checking", key: resolved.key! } }).html)).toContain(">Checking teams with Showdown rules…</span>");
    expect(startBar(render({ ...base, validation: { status: "error", key: resolved.key!, message: "Validator crashed." } }).html)).toContain(">Showdown check failed: Validator crashed.</span>");
    // The matchup names the difficulty and says when a test setting is on; nothing hidden.
    const test = render({ ...base, draft: { ...base.draft, difficulty: "reads", info: { ...DEFAULT_INFO, youSee: PERFECT_INFORMATION } } });
    expect(startBar(test.html)).toContain(">Home vs Away · Reads you · Test settings on</p>");
    expect(positionalIn(bar + startBar(noOpponent.html) + suggesting + problems + startBar(test.html))).toEqual([]);
  });

  it("the Start bar's side fact takes the keyboard focus to that side's heading", () => {
    const { html, buttons } = render(snapshotWith(), session(), { ...rosterState(OWN_ROSTER, OPPONENT_ROSTER), opponentId: "" });
    for (const role of ["own", "opponent"]) expect(html).toMatch(new RegExp(`<h2 id="[^"]+" tabindex="-1" data-training-team-heading="${role}"`));
    const fact = buttons.find((button) => button["data-training-start-side"] === "opponent")!;
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", { querySelector });
    try {
      (fact.onClick as () => void)();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(querySelector).toHaveBeenCalledWith('[data-training-team-heading="opponent"]');
    expect(focus).toHaveBeenCalledOnce();
  });

  it("names what each side is missing beside Start: its panel's fact, its suggested sets, never Choose 6 (0 chosen)", () => {
    const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const noOpponent = readiness(render(snapshotWith(), session(), { ...base, opponentId: "" }).html);
    expect(noOpponent).toContain('<li data-training-side="opponent">Opponent: No opponent chosen.</li>');
    expect(noOpponent).not.toContain("Choose 6");
    const none = readiness(render(snapshotWith(), session(), { ...base, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html);
    expect(none).toContain(">Your team: No team chosen.</li>");
    expect(none).toContain(">Opponent: No team chosen.</li>");
    const rostersLoading = readiness(render(snapshotWith(), session(), { ...base, teamsStatus: "loading", data: null }).html);
    expect(rostersLoading).toContain(">Opponent: Loading current team rosters…</li>");
    const draft = createSetupDraft();
    const noPaste = readiness(render(snapshotWith({}, { ...draft, opponent: { ...draft.opponent, mode: "paste" } })).html);
    expect(noPaste).toContain(">Opponent: No team imported.</li>");
    expect(noPaste).not.toContain("Choose 6");
    // Your team a paste and no league chosen: the opponent's picker chooses the league, and both say "No league chosen.".
    const leagueless = { ...base, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" as const };
    const ownPaste = render(snapshotWith({}, { ...draft, own: { ...draft.own, mode: "paste" } }, leagueless), session(), leagueless).html;
    expect(readiness(ownPaste)).toContain('<li data-training-side="opponent">Opponent: No league chosen.</li>');
    expect(panelOf(ownPaste, "opponent")).toContain(">No league chosen.</p>");
    expect(ownPaste).not.toContain("No team chosen.");
    // Your team a league team: the opponent's picker has no league selector of its own.
    expect(none).toContain(">Opponent: No team chosen.</li>");
    const loading = readiness(render(snapshotWith({ suggestions: { own: { status: "idle" }, opponent: { status: "idle" } } })).html);
    expect(loading).toContain('<li data-training-side="own">Your team: Suggesting sets…</li>');
    expect(loading).toContain('<li data-training-side="opponent">Opponent: Suggesting sets…</li>');
    const ready = snapshotWith();
    const failedSets = readiness(render({ ...ready, suggestions: { ...ready.suggestions, opponent: { status: "error", key: (ready.suggestions.opponent as { key: string }).key, message: "No usage data." } } }).html);
    expect(failedSets).toContain(">Opponent: Suggested sets unavailable.</li>");
    expect(failedSets).not.toContain("No usage data.");
    expect(noOpponent + none + rostersLoading + noPaste + readiness(ownPaste) + loading + failedSets).not.toMatch(/Choose (a|an|your)\b|manual|Join or create|Pick|Select/);
    expect(positionalIn(noOpponent + none + rostersLoading + noPaste + readiness(ownPaste) + loading + failedSets)).toEqual([]);
  });

  it("states a missing team or opponent once per side panel, and the league rosters' status once for both, as facts", () => {
    const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const count = (html: string, fact: string) => html.split(`>${fact}</p>`).length - 1;
    const none = render(snapshotWith(), session(), { ...base, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html;
    expect(count(none, "No team chosen.")).toBe(2);
    // The rosters' status is the setup's, above both teams: said once (it was once per picker).
    const empty = render(snapshotWith(), session(), { ...base, leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html;
    expect(count(empty, "No leagues.")).toBe(1);
    expect(rostersRow(empty)).toContain(">No leagues.</p>");
    const noOpponent = render(snapshotWith(), session(), { ...base, opponentId: "" }).html;
    expect(count(noOpponent, "No opponent chosen.")).toBe(1);
    // Teams that failed to load: one alert above both teams, not the roster's "Could not load this league's teams." too.
    // (The status beside Start names each side's missing piece: there the roster's fact is the line.)
    const failed = render(snapshotWith(), session(), { ...base, teamsStatus: "error", data: null }).html;
    expect(panels(failed).split("League teams unavailable").length - 1).toBe(1);
    expect(rostersRow(failed)).toContain("League teams unavailable");
    expect(panels(failed)).not.toContain("Could not load this league&#x27;s teams.");
    expect(readiness(failed)).toContain(">Opponent: Could not load this league&#x27;s teams.</li>");
    expect(none + empty + noOpponent).not.toMatch(/Choose (a|an|your)\b|manual|Join or create/);
    expect(positionalIn(none + empty + noOpponent + failed)).toEqual([]);
  });

  it("keeps each source's Choose 6 picks when a side switches to PokéPaste and back", () => {
    const { buttons, actions } = render(snapshotWith());
    const source = (label: string, index: number) => buttons.filter((button) => text(button).includes(label) && "aria-pressed" in button)[index];
    const picks = ["a", "b", "c", "d", "e", "f"];
    let draft: SetupDraft = { ...createSetupDraft(), own: { ...createSetupDraft().own, chosen: picks } };
    (source("PokéPaste", 0).onClick as () => void)();
    draft = vi.mocked(actions.updateDraft).mock.calls[0][0](draft);
    expect(draft.own).toMatchObject({ mode: "paste", chosen: null, otherChosen: picks, epoch: 1 });
    (source("League team", 0).onClick as () => void)();
    draft = vi.mocked(actions.updateDraft).mock.calls[1][0](draft);
    expect(draft.own).toMatchObject({ mode: "league", chosen: picks, otherChosen: null, epoch: 2 });
    expect(draft.opponent).toEqual(createSetupDraft().opponent);
  });

  it("asks before Clear habits, with the turns it clears", () => {
    const clearButton = (turns: number) => {
      const { buttons, actions } = render(snapshotWith({ habits: { turns, data: emptyHabits() } }));
      return { clear: buttons.find((button) => text(button).includes("Clear habits"))!.onClick as () => void, actions };
    };
    const twelve = clearButton(12.4);
    const one = clearButton(1);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    try {
      twelve.clear();
      expect(confirm).toHaveBeenLastCalledWith("Clear the AI's habits (12 turns)?");
      expect(twelve.actions.clearHabits).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      twelve.clear();
      expect(twelve.actions.clearHabits).toHaveBeenCalledOnce();
      one.clear();
      expect(confirm).toHaveBeenLastCalledWith("Clear the AI's habits (1 turn)?");
    } finally {
      vi.unstubAllGlobals();
    }
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
    // "Protect added" names one of its moves: not on the opponent's rows while Moves is closed; your own rows keep it.
    expect(opponent).not.toContain("Protect added");
    expect(opponent).toMatch(/data-training-set-origin="true" class="text-muted">Suggested set<\/span>/);
    expect(own).toContain(">Suggested set · Protect added</span>");
    const defaults = render(snapshotWith());
    expect(defaults.html.slice(defaults.html.indexOf('data-training-team="opponent"'))).not.toContain("Edit as PokéPaste");
    expect(defaults.html.slice(defaults.html.indexOf('data-training-team="opponent"'))).toContain(">Suggested set · Protect added</span>");
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

  it("puts each member's header on one line: the box and name, then Edit set; the set's origin and facts share a line", () => {
    const { html } = render(snapshotWith());
    const rows = panelOf(html, "own").split("<li data-training-member=").slice(1);
    expect(rows).toHaveLength(7);
    const [garchomp] = rows;
    expect(garchomp).toContain('class="min-w-0 rounded-lg border px-3 py-1.5 border-accent-border bg-panel"');
    expect(garchomp).toMatch(/^[^>]*><div class="flex min-w-0 items-center gap-2"><label [^>]*class="[^"]*cursor-pointer"[^>]*>[^]*?>Garchomp<\/span><\/label><button type="button" aria-expanded="false" aria-controls="[^"]+" class="min-h-11 shrink-0 [^"]*">Edit set<span class="sr-only"> · Garchomp<\/span><\/button><\/div>/);
    expect(garchomp).toMatch(/<p class="wrap-anywhere"><span id="([^"]+)-origin" data-training-set-origin="true" class="text-muted">Suggested set · Protect added<\/span><span class="text-muted"> · <\/span><span id="\1-facts" data-training-set-facts="true" class="text-text">Rough Skin · Life Orb · Jolly · 66 SP<\/span><\/p><p id="\1-moves" data-training-set-moves="true" class="wrap-anywhere text-muted">Protect · Earthquake<\/p>/);
    // Tabbing to a chosen box reads its set.
    const box = /<input id="([^"]+)-choose" type="checkbox"[^>]*>/.exec(garchomp)!;
    expect(box[0]).toContain(`aria-describedby="${box[1]}-origin ${box[1]}-facts ${box[1]}-moves"`);
    // A full team's other member: its header only; "6 chosen" stays for the screen reader as the disabled box's description.
    const alakazam = rows[6];
    const bench = /<input id="([^"]+)-choose" type="checkbox" disabled="" aria-describedby="\1-reason"[^>]*>/.exec(alakazam)!;
    expect(bench).not.toBeNull();
    expect(alakazam).toContain(`<p id="${bench[1]}-reason" class="sr-only">6 chosen</p>`);
    expect(alakazam).toMatch(/<label [^>]*class="[^"]*cursor-not-allowed"/);
    expect(alakazam).toContain('<span class="min-w-0 wrap-anywhere font-semibold text-muted">Alakazam</span>');
    expect(alakazam).not.toContain("Edit set");
    // The Choose 6 group is named by its side and its fact: "Your team Choose 6 · 6 of 7 chosen".
    for (const role of ["own", "opponent"] as const) {
      const panel = panelOf(html, role);
      const [, heading, fact] = /<div role="group" aria-labelledby="([^" ]+) ([^" ]+)"/.exec(panel)!;
      expect(panel).toMatch(new RegExp(`<h2 id="${heading}" tabindex="-1" data-training-team-heading="${role}"[^>]*>${role === "own" ? "Your team" : "Opponent"}</h2>`));
      expect(panel).toContain(`<span id="${fact}" class="block text-sm font-semibold text-text max-lg:hidden">Choose 6 · 6 of ${role === "own" ? 7 : 6} chosen</span>`);
    }
    // Its problems join the box's description; a member that cannot be chosen keeps its own reason in view.
    const base = snapshotWith();
    const { resolved, validation } = validFor(base);
    const problem = panelOf(render({ ...base, validation: { ...validation, own: { team: [], members: { [resolved.own.chosen[0]]: ["Garchomp can't learn Spore."] } } } }).html, "own");
    const [first] = problem.split("<li data-training-member=").slice(1);
    const withProblem = /<input id="([^"]+)-choose" type="checkbox"[^>]*>/.exec(first)!;
    expect(withProblem[0]).toContain(`aria-describedby="${withProblem[1]}-origin ${withProblem[1]}-facts ${withProblem[1]}-moves ${withProblem[1]}-problems"`);
    expect(first).toContain(`<ul id="${withProblem[1]}-problems" data-training-problems="true"`);
    const unknown = rosterState([...OWN_ROSTER.slice(0, 6), "Notamon"], OPPONENT_ROSTER);
    const odd = panelOf(render(snapshotWith({}, createSetupDraft(), unknown), session(), unknown).html, "own").split("<li data-training-member=").slice(1)[6];
    const oddBox = /<input id="([^"]+)-choose" type="checkbox" disabled="" aria-describedby="\1-reason"[^>]*>/.exec(odd)!;
    expect(odd).toMatch(new RegExp(`<p id="${oddBox[1]}-reason" class="wrap-anywhere text-xs text-muted">[^<]+</p>`));
    expect(positionalIn(html)).toEqual([]);
  });

  it("folds a clean Choose 6 list below 64rem to its six names, its toggle the list's fact; every row stays in the markup", () => {
    const { html } = render(snapshotWith());
    for (const role of ["own", "opponent"] as const) {
      const panel = panelOf(html, role);
      const toggle = /<button type="button" data-training-choose-toggle="(?:own|opponent)" aria-expanded="(true|false)" aria-controls="([^"]+)"[^>]*>([^]*?)<\/button>/.exec(panel)!;
      expect(toggle[1]).toBe("false");
      expect(plain(toggle[3])).toBe(`Choose 6 · 6 of ${role === "own" ? 7 : 6} chosen · ${role === "own" ? "Your team" : "Opponent"}`);
      // The toggle below 64rem only (in a heading inside the fact); from 64rem the fact and the whole list, as before.
      expect(panel).toMatch(/<div tabindex="-1" data-training-choose="true" class="[^"]*"><span id="[^"]+" class="[^"]*max-lg:hidden">[^<]+<\/span><h3 class="text-sm font-semibold text-text lg:hidden"><button/);
      expect(panel).toContain(`<ul id="${toggle[2]}" class="${setupStyles.members} mt-2 grid gap-2 max-lg:hidden">`);
      expect(panel.split("<li data-training-member=").length - 1).toBe(role === "own" ? 7 : 6);
    }
    const chosen = /<div data-training-chosen="own" class="mt-1 space-y-1 lg:hidden">([^]*?)<\/div><ul/.exec(html)!;
    expect(plain(chosen[1])).toBe("Garchomp · Gyarados · Incineroar · Aerodactyl · Aegislash · Aggron");
    expect(chosen[1]).not.toContain("Showdown rules");
    expect(plain(/<div data-training-chosen="opponent"[^>]*>([^]*?)<\/div><ul/.exec(html)![1])).toBe("Absol · Altaria · Ampharos · Annihilape · Appletun · Araquanid");
    // Edit as PokéPaste ends the list: folded with it (the panel's end row shows from 64rem only).
    expect(panelOf(html, "own")).toMatch(new RegExp(`<div class="${setupStyles.teamEdit} max-lg:hidden"><button[^>]*>Edit as PokéPaste</button></div><div aria-hidden="true" class="${setupStyles.teamEnd}"></div></section>`));
    // Sets still loading: folded too (the names are known; the line beside Start says the sets are coming).
    const loading = render(snapshotWith({ suggestions: { own: { status: "idle" }, opponent: { status: "idle" } } })).html;
    expect(loading.match(/data-training-choose-toggle="(?:own|opponent)" aria-expanded="false"/g)).toHaveLength(2);
    expect(loading).toContain('<p class="text-xs text-muted">Suggesting set…</p>');
    expect(positionalIn(html)).toEqual([]);
  });

  it("starts a Choose 6 list open for what needs its rows: fewer than six chosen, sets unavailable, a blocker, a Showdown problem", () => {
    const expanded = (html: string, role: "own" | "opponent") => {
      const panel = panelOf(html, role);
      const open = /data-training-choose-toggle="(?:own|opponent)" aria-expanded="(true|false)"/.exec(panel)![1] === "true";
      // Open: no folded line, and the list shows at every width.
      expect(panel.includes("data-training-chosen=")).toBe(!open);
      expect(new RegExp(`<ul id="[^"]+"(?: aria-busy="true")? class="${setupStyles.members} mt-2 grid gap-2 max-lg:hidden">`).test(panel)).toBe(!open);
      return open;
    };
    const short = rosterState(OWN_ROSTER.slice(0, 5), OPPONENT_ROSTER);
    const five = render(snapshotWith({}, createSetupDraft(), short), session(), short).html;
    expect([expanded(five, "own"), expanded(five, "opponent")]).toEqual([true, false]);
    const ready = snapshotWith();
    const failed = render({ ...ready, suggestions: { ...ready.suggestions, opponent: { status: "error", key: (ready.suggestions.opponent as { key: string }).key, message: "No usage data." } } }).html;
    expect([expanded(failed, "own"), expanded(failed, "opponent")]).toEqual([false, true]);
    // Item Clause: two suggested sets hold a Life Orb.
    const sets = ready.suggestions.opponent as Extract<typeof ready.suggestions.opponent, { status: "ready" }>;
    const [, second] = Object.keys(sets.sets);
    const twice = render({ ...ready, suggestions: { ...ready.suggestions, opponent: { ...sets, sets: { ...sets.sets, [second]: { ...sets.sets[second], itemId: "lifeorb" } } } } }).html;
    expect(readiness(twice)).toContain("Opponent: Item Clause: Life Orb on Absol and Altaria.");
    expect([expanded(twice, "own"), expanded(twice, "opponent")]).toEqual([false, true]);
    const { validation } = validFor(ready);
    const problem = render({ ...ready, validation: { ...validation, opponent: { team: ["You are limited to 1 of each item by Item Clause."], members: {} } } }).html;
    expect([expanded(problem, "own"), expanded(problem, "opponent")]).toEqual([false, true]);
  });

  it("names a mirror's members by team in their set labels; the boxes keep the names they show", () => {
    const mirror = rosterState(OWN_ROSTER, MIRROR_ROSTER);
    const open = { ...createSetupDraft(), info: { ...DEFAULT_INFO, youSee: { ...PERFECT_INFORMATION, exactHP: false, brought: false } } };
    const { html } = render(snapshotWith({}, open, mirror), session(), mirror);
    expect(html).toContain('Edit set<span class="sr-only"> · Garchomp (yours)</span>');
    expect(html).toContain('Edit set<span class="sr-only"> · Garchomp (opponent&#x27;s)</span>');
    expect(html).toContain('Edit set<span class="sr-only"> · Gyarados</span>');
    // Each box sits in its side's named Choose 6 group.
    expect(html.match(/font-semibold text-text">Garchomp<\/span><\/label>/g)).toHaveLength(2);
    expect(positionalIn(html)).toEqual([]);
  });

  it("gives each team one heading and the league rosters one Refresh teams and status: no card in a card", () => {
    const { html, buttons, rosters: value } = render(snapshotWith());
    expect([...html.matchAll(/<h2\b[^>]*>([^]*?)<\/h2>/g)].map((match) => plain(match[1]))).toEqual(["Your team", "Opponent", "Battle settings"]);
    expect(html.match(/<section\b/g)).toHaveLength(3);
    expect(html.split("Refresh teams").length - 1).toBe(1);
    expect(rostersRow(html)).toMatch(/^<div data-training-rosters="true" class="flex flex-wrap items-start gap-2"><div class="min-w-0 flex-1 space-y-2 empty:hidden max-sm:basis-full"><\/div><button type="button" class="[^"]*min-h-11 ml-auto shrink-0"[^>]*>[^]*Refresh teams<\/button><\/div>/);
    (buttons.find((button) => text(button).includes("Refresh teams"))!.onClick as () => void)();
    expect(value.refresh).toHaveBeenCalledOnce();
    // Your league team's select names your team: the opponent's picker states the League only.
    const opponent = panelOf(html, "opponent");
    expect(opponent).not.toContain(">Your team</dt>");
    expect(opponent).toContain('>League</dt><dd class="wrap-anywhere font-medium text-text">Alpha</dd>');
    expect(html.match(/<label[^>]*>(?:My team|Opponent)<\/label>/g)).toHaveLength(2);
    // Below 40rem each side's League team | PokéPaste is two equal buttons across the panel.
    expect(html.match(/role="group" aria-label="(?:Your team|Opponent) source" class="grid w-full grid-cols-2 gap-1 rounded-lg border border-line bg-bg\/40 p-1 sm:flex sm:w-auto"/g)).toHaveLength(2);
    // Signed out: the alert and its Log in again link once.
    const out = render(snapshotWith(), session(), { ...rosterState(OWN_ROSTER, OPPONENT_ROSTER), status: "signed-out", leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }).html;
    expect(out.split("Log in again").length - 1).toBe(1);
    expect(rostersRow(out)).toContain('href="/login?next=%2Ftraining"');
  });

  it("embeds the PokéPaste importer and the opponent's league picker: no card, heading or target game line; every control kept", () => {
    const draft = createSetupDraft();
    const ownPaste = render(snapshotWith({}, { ...draft, own: { ...draft.own, mode: "paste" } })).html;
    const own = panelOf(ownPaste, "own");
    expect(own).toContain('<div data-paste-importer="own" class="min-w-0 space-y-4">');
    expect(own).not.toContain("Target game");
    // The side's heading, and the closed remove dialog's title: the importer has none of its own.
    expect([...own.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1])).toEqual(["Your team", "Remove imported team?"]);
    for (const label of ["Spread format", "PokéPaste link", "Team text", "Team label"]) expect(own).toContain(`>${label}</label>`);
    for (const label of ["Load link and preview", "Preview team text"]) expect(own).toContain(label);
    // Your team a paste: the opponent's picker lists the leagues itself and names your membership.
    const opponent = panelOf(ownPaste, "opponent");
    expect(opponent).toContain(">Opponent league</label>");
    expect(opponent).toContain(">Your league membership</dt>");
    expect(rostersRow(ownPaste)).toContain("Refresh teams");
    // Both teams pastes: no league rosters to refresh.
    const both = render(snapshotWith({}, { ...draft, own: { ...draft.own, mode: "paste" }, opponent: { ...draft.opponent, mode: "paste" } })).html;
    expect(both).not.toContain("data-training-rosters");
    expect(both).not.toContain("Refresh teams");
    expect(both.match(/<section\b/g)).toHaveLength(3);
    expect(both.match(/data-paste-importer="(?:own|opponent)"/g)).toHaveLength(2);
  });

  it("keeps the calculator's pickers and importer as they were: card, heading, Refresh teams, roster status, target game", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const cards = (current: typeof state) => renderToStaticMarkup(createElement("div", null,
      createElement(MyTeamPicker, { state: current, onLeagueChange: vi.fn(), onRefresh: vi.fn() }),
      createElement(OpponentPicker, { state: current, onOpponentChange: vi.fn(), onRefresh: vi.fn() }),
      createElement(PokePasteImporter, { role: "own", owner: { role: "own", revision: 0, epoch: 0 }, applied: null, onApply: vi.fn(), onRemove: vi.fn() }),
    ));
    const html = cards(state);
    expect(html.match(/<section\b/g)).toHaveLength(3);
    for (const fact of [">My team</h2>", ">Opponent</h2>", ">My team · PokéPaste</h2>", "Target game:", ">Your team</dt>"]) expect(html).toContain(fact);
    expect(html.split("Refresh teams").length - 1).toBe(2);
    expect(cards({ ...state, teamsStatus: "error", data: null }).split("League teams unavailable").length - 1).toBe(2);
  });
});

describe("opponent quick picks (package 4)", () => {
  const THIRD = { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 };
  const crowded = (state = rosterState(OWN_ROSTER, OPPONENT_ROSTER)) => ({ ...state, data: state.data && { ...state.data, members: [...state.data.members, THIRD] } });
  /** The quick picks' markup: from their row to the Opponent select's label. */
  const quickPart = (html: string) => html.slice(html.indexOf("<div data-opponent-quick"), html.lastIndexOf("<label", html.indexOf("data-opponent-selector")));

  it("OpponentPicker puts groups of one-press picks above the select, named as its options, pressed when chosen", () => {
    const onOpponentChange = vi.fn();
    host.buttons = [];
    host.capture = true;
    let html: string;
    try {
      html = renderToStaticMarkup(createElement(OpponentPicker, {
        state: crowded(), onOpponentChange, onRefresh: vi.fn(), embedded: true,
        quick: [
          { heading: "Next match", options: [{ id: "member-other", fact: "Round 3" }] },
          { heading: "Recent", options: [{ id: "member-third" }, { id: "member-gone" }] },
          { heading: "Yours", options: [{ id: "member-own" }] },
        ],
      }));
    } finally {
      host.capture = false;
    }
    const quick = quickPart(html);
    expect(html.indexOf("data-opponent-quick")).toBeLessThan(html.indexOf("data-opponent-selector"));
    expect([...quick.matchAll(/<p id="([^"]+)"[^>]*>([^<]*)<\/p>/g)].map((group) => group[2])).toEqual(["Next match", "Recent"]);
    expect(quick.match(/role="group" aria-labelledby="[^"]+"/g)).toHaveLength(2);
    expect(quick).toMatch(/<button type="button" data-opponent-quick-pick="member-other" aria-pressed="true"[^>]*>Away · Round 3<\/button>/);
    expect(quick).toMatch(/<button type="button" data-opponent-quick-pick="member-third" aria-pressed="false"[^>]*>Third<\/button>/);
    // A coach who is not one of the league's other members has no button; the select keeps every coach.
    expect(quick).not.toContain("member-gone");
    expect(quick).not.toContain("member-own");
    expect(html).toContain('<option value="member-third">Third</option>');
    (host.buttons.find((button) => button["data-opponent-quick-pick"] === "member-third")!.onClick as () => void)();
    expect(onOpponentChange).toHaveBeenCalledExactlyOnceWith("member-third");
    // None while the league's teams load, and none without the prop (the calculator's picker is unchanged).
    const loading = renderToStaticMarkup(createElement(OpponentPicker, { state: { ...crowded(), teamsStatus: "loading", data: null }, onOpponentChange, onRefresh: vi.fn(), quick: [{ heading: "Recent", options: [{ id: "member-third" }] }] }));
    expect(loading).not.toContain("data-opponent-quick");
    const calculator = renderToStaticMarkup(createElement(OpponentPicker, { state: crowded(), onOpponentChange, onRefresh: vi.fn() }));
    expect(calculator).not.toContain("data-opponent-quick");
    expect(renderToStaticMarkup(createElement(OpponentPicker, { state: crowded(), onOpponentChange, onRefresh: vi.fn(), quick: [] }))).toBe(calculator);
  });

  it("Training's Opponent panel offers your next match and the opponents of your last starts in the league; a press is your pick", () => {
    const state = crowded();
    const picks = { userId: "user-1", leagueId: "league-a", opponents: {}, recent: { "league-a": ["member-other", "member-third"], "league-b": ["member-x"] } };
    const value = { ...rosters(state), nextMatch: { opponentId: "member-other", name: "Round 3" } };
    host.buttons = [];
    host.capture = true;
    let html: string;
    try {
      html = renderToStaticMarkup(createElement(TeamSetup, { runtime, rosters: value, snapshot: snapshotWith({ picks }, createSetupDraft(), state), session: session() }));
    } finally {
      host.capture = false;
    }
    const opponent = panelOf(html, "opponent");
    expect(plain(quickPart(opponent))).toBe("Next matchAway · Round 3RecentThird");
    expect(panelOf(html, "own")).not.toContain("data-opponent-quick");
    (host.buttons.find((button) => button["data-opponent-quick-pick"] === "member-third")!.onClick as () => void)();
    expect(value.selectOpponent).toHaveBeenCalledExactlyOnceWith("member-third");
    // Another account's picks, or no schedule: no Recent, no Next match.
    const other = renderToStaticMarkup(createElement(TeamSetup, { runtime, rosters: rosters(state), snapshot: snapshotWith({ picks: { ...picks, userId: "user-2" } }, createSetupDraft(), state), session: session() }));
    expect(other).not.toContain("data-opponent-quick");
  });
});
