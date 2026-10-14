import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { SetupPicks, TrainingSnapshot } from "@/app/(app)/training/model/view-types";
import type TrainingClientType from "@/app/(app)/training/TrainingClient";
import { initialSnapshot } from "@/app/(app)/training/training-session";
import { installFakeDom, reactProps, type FakeDocument } from "../fixtures/fake-dom";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState } from "../fixtures/training";

// The Training page restores your remembered picks (fake DOM, the real hooks): the league you last picked once the account is
// bound, then the opponent you last picked there, each once per visit; your own pick is remembered and never replaced. It
// offers the Opponent picker's quick picks (Next match from the one schedule read, Recent from your last starts) and, with no
// unfinished battle, the newest finished one as Last battle.

const state = vi.hoisted(() => ({ snapshot: null as unknown, session: null as unknown, rosters: null as unknown, schedule: [] as unknown[], reads: [] as string[] }));
vi.mock("@/app/(app)/training/useTrainingSession", () => ({ useTrainingSession: () => [state.snapshot, state.session] }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", () => ({ default: () => state.rosters }));
// The schedule read (league_matches): none scheduled unless a case sets one; each read's league is recorded.
vi.mock("@/app/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: async (_column: string, leagueId: string) => { state.reads.push(leagueId); return { data: state.schedule, error: null }; } }) }) }),
}));

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let TrainingClient: typeof TrainingClientType;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  TrainingClient = (await import("@/app/(app)/training/TrainingClient")).default;
  root = createRoot(document.body.appendChild(document.createElement("div")) as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

const BETA = { id: "league-b", name: "Beta", memberId: "member-own-b", teamName: "Home", draftStarted: true, draftCompleted: true };
const BETA_MEMBERS = [
  { id: "member-own-b", role: "coach", team_name: "Home", draft_position: 1 },
  { id: "member-rival", role: "coach", team_name: "Rival", draft_position: 2 },
  { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 },
];
const alpha = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
/** Your two leagues (Alpha first, as the rosters start), the opponent "—". */
const rosters = (patch: Partial<CalculatorRosterState>): CalculatorRosterState => ({ ...alpha, leagues: [...alpha.leagues, BETA], opponentId: "", ...patch });
const PICKS: SetupPicks = { userId: "user-1", leagueId: "league-b", opponents: { "league-b": "member-third" }, recent: {} };

describe("the Training page's remembered picks", () => {
  const session = new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
  const actions = { selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() };
  async function show(rosterPatch: Partial<CalculatorRosterState>, picks: SetupPicks | null) {
    state.snapshot = { ...initialSnapshot(), engine: { status: "ready" }, picks } satisfies TrainingSnapshot;
    state.session = session;
    state.rosters = { state: rosters(rosterPatch), ...actions };
    await act(async () => { root.render(createElement(TrainingClient)); });
  }

  it("restores the league, then the opponent there, once each; your own pick is remembered and wins", async () => {
    await show({ status: "loading", leagues: [], selectedLeagueId: "", teamsStatus: "idle", data: null }, null);
    expect(session.bindAccount).not.toHaveBeenCalled();
    // The rosters start on the first league; until the account's picks are read nothing is restored.
    await show({ teamsStatus: "loading", data: null }, null);
    expect(session.bindAccount).toHaveBeenCalledWith("user-1");
    expect(actions.selectLeague).not.toHaveBeenCalled();
    await show({ teamsStatus: "loading", data: null }, PICKS);
    expect(actions.selectLeague).toHaveBeenCalledExactlyOnceWith("league-b");
    // Beta's teams: the opponent you last picked there (before the schedule), once.
    const beta = { selectedLeagueId: "league-b", teamsStatus: "ready" as const, data: { leagueId: "league-b", members: BETA_MEMBERS, teams: [] } };
    await show(beta, PICKS);
    await show(beta, PICKS);
    expect(actions.selectOpponent).toHaveBeenCalledExactlyOnceWith("member-third");
    expect(actions.selectLeague).toHaveBeenCalledOnce();
    expect(session.rememberLeague).not.toHaveBeenCalled();
    expect(session.rememberOpponent).not.toHaveBeenCalled();
    // Your pick in the Opponent picker: remembered for Beta, and the default never comes back over it.
    const select = document.querySelectorAll("select").find((element) => element.getAttribute("data-opponent-selector") !== null)!;
    await act(async () => { (reactProps(select).onChange as (event: unknown) => void)({ target: { value: "member-rival" } }); });
    expect(session.rememberOpponent).toHaveBeenCalledExactlyOnceWith("league-b", "member-rival");
    expect(actions.selectOpponent).toHaveBeenLastCalledWith("member-rival");
    await show(beta, { ...PICKS, opponents: { "league-b": "member-rival" } });
    expect(actions.selectOpponent).toHaveBeenCalledTimes(2);
    await act(async () => { root.render(null); });
  });

  it("offers Next match from the one schedule read and Recent from your last starts there; a quick pick is remembered as your pick", async () => {
    const quickSession = new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
    const quickActions = { selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() };
    state.reads = [];
    state.schedule = [
      { round_number: 2, match_number: 1, home_member_id: "member-own-b", away_member_id: "member-third", status: "completed", stage: "regular" },
      { round_number: 3, match_number: 1, home_member_id: "member-rival", away_member_id: "member-own-b", status: "upcoming", stage: "regular" },
    ];
    const picks: SetupPicks = { userId: "user-1", leagueId: "league-b", opponents: {}, recent: { "league-b": ["member-rival", "member-third"] } };
    const show = async () => {
      state.snapshot = { ...initialSnapshot(), engine: { status: "ready" }, picks } satisfies TrainingSnapshot;
      state.session = quickSession;
      state.rosters = { state: rosters({ selectedLeagueId: "league-b", data: { leagueId: "league-b", members: BETA_MEMBERS, teams: [] } }), ...quickActions };
      await act(async () => { root.render(createElement(TrainingClient)); });
    };
    await show();
    await show();
    const quick = () => document.querySelectorAll("button").filter((element) => element.getAttribute("data-opponent-quick-pick") !== null);
    expect(quick().map((button) => [button.getAttribute("data-opponent-quick-pick"), button.textContent])).toEqual([["member-rival", "Rival · Round 3"], ["member-third", "Third"]]);
    expect(state.reads).toEqual(["league-b"]);
    // The default (two other coaches: the schedule's) came from the same read.
    expect(quickActions.selectOpponent).toHaveBeenCalledExactlyOnceWith("member-rival");
    const third = quick().find((button) => button.getAttribute("data-opponent-quick-pick") === "member-third")!;
    await act(async () => { (reactProps(third).onClick as () => void)(); });
    expect(quickSession.rememberOpponent).toHaveBeenCalledExactlyOnceWith("league-b", "member-third");
    expect(quickActions.selectOpponent).toHaveBeenLastCalledWith("member-third");
    state.schedule = [];
    await act(async () => { root.render(null); });
  });

  it("shows the newest finished battle as Last battle above the teams; its Rematch plays that saved battle again", async () => {
    const savedSession = new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
    const finished = {
      id: "f1", status: "finished" as const, source: "played" as const, createdAt: 1, updatedAt: 2, own: "Home", opponent: "Rival", turn: 7,
      result: { result: "win" as const, forfeited: false }, difficulty: "reads" as const,
    };
    state.snapshot = {
      ...initialSnapshot(), engine: { status: "ready" }, picks: null,
      saved: { status: "ready", list: [finished], message: null, import: { status: "idle" }, autosaved: null },
    } satisfies TrainingSnapshot;
    state.session = savedSession;
    state.rosters = { state: rosters({}), selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() };
    await act(async () => { root.render(createElement(TrainingClient)); });
    const sections = document.querySelectorAll("section");
    const card = sections.findIndex((element) => element.getAttribute("data-training-last-battle") !== null);
    expect(card).toBeGreaterThanOrEqual(0);
    expect(card).toBeLessThan(sections.findIndex((element) => element.getAttribute("data-training-team") === "own"));
    expect(sections[card].textContent).toContain("Won · 7 turns · Reads you");
    const rematch = sections[card].querySelectorAll("button").find((button) => button.textContent === "Rematch")!;
    await act(async () => { (reactProps(rematch).onClick as () => void)(); });
    expect(savedSession.rematchSaved).toHaveBeenCalledExactlyOnceWith("f1");
    await act(async () => { root.render(null); });
  });
});
