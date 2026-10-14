import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { ScheduledMatch } from "@/app/lib/league/next-match";
import {
  defaultOpponent, nextMatchIn, opponentQuickPicks, RECENT_SHOWN, scheduledOpponent, scheduleKey, teamsLoaded, type NextMatch,
} from "@/app/(app)/training/setup/next-opponent";
import type { RememberedOpponents, ScheduleReader, useNextOpponent as UseNextOpponent } from "@/app/(app)/training/setup/useNextOpponent";
import { installFakeDom } from "../fixtures/fake-dom";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState } from "../fixtures/training";

// Training's default opponent, each time a league is entered, only while the Opponent picker is "—" and you have not picked: the
// opponent you last picked in that league (remembered; your "—" stays), else your next scheduled opponent, else the league's
// only other coach. The calculator's picker has no default.

const match = (round: number, home: string | null, away: string | null, status = "upcoming", stage = "regular"): ScheduledMatch => ({
  round_number: round, match_number: 1, home_member_id: home, away_member_id: away, status, stage,
});
/** member-own played member-other in round 1; they meet again in round 2. */
const SCHEDULE = [match(1, "member-own", "member-other", "completed"), match(2, "member-other", "member-own")];
/** The fixture's league with a third coach (two other coaches: the schedule decides). */
const THIRD = { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 };
const unpicked = (patch: Partial<CalculatorRosterState> = {}): CalculatorRosterState => {
  const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
  return { ...base, opponentId: "", data: { ...base.data!, members: [...base.data!.members, THIRD] }, ...patch };
};
/** The fixture's league as it is: one other coach. */
const twoCoaches = (patch: Partial<CalculatorRosterState> = {}): CalculatorRosterState => ({ ...rosterState(OWN_ROSTER, OPPONENT_ROSTER), opponentId: "", ...patch });

describe("which opponent Training starts on", () => {
  it("is your next scheduled opponent once the league's teams are loaded and the picker is still —", () => {
    expect(scheduleKey(unpicked())).toBe("user-1:league-a");
    expect(teamsLoaded(unpicked())).toBe(true);
    expect(scheduledOpponent(unpicked(), SCHEDULE)).toBe("member-other");
  });

  it("is none with no schedule, the season played, an undecided slot, or a coach not in the loaded league", () => {
    expect(scheduledOpponent(unpicked(), [])).toBeNull();
    expect(scheduledOpponent(unpicked(), [SCHEDULE[0]])).toBeNull();
    expect(scheduledOpponent(unpicked(), [match(5, null, "member-own")])).toBeNull();
    expect(scheduledOpponent(unpicked(), [match(2, "member-gone", "member-own")])).toBeNull();
  });

  it("never replaces a chosen opponent and waits for the league's teams", () => {
    expect(scheduledOpponent(unpicked({ opponentId: "member-other" }), SCHEDULE)).toBeNull();
    const loading = unpicked({ teamsStatus: "loading", data: null });
    expect(teamsLoaded(loading)).toBe(false);
    expect(scheduledOpponent(loading, SCHEDULE)).toBeNull();
    expect(scheduleKey(unpicked({ selectedLeagueId: "" }))).toBeNull();
    expect(scheduleKey(unpicked({ status: "loading" }))).toBeNull();
    expect(scheduleKey(unpicked({ selectedLeagueId: "league-gone" }))).toBeNull();
  });

  it("is the opponent you last picked there, else the next scheduled one, else the only other coach, else —", () => {
    // Remembered wins over the schedule, without waiting for it; one no longer in the league (or you) is ignored.
    expect(defaultOpponent(unpicked(), "member-third", undefined)).toBe("member-third");
    // Your "—" there is remembered too: it stays, schedule or only other coach.
    expect(defaultOpponent(unpicked(), "", SCHEDULE)).toBeNull();
    expect(defaultOpponent(unpicked(), "", undefined)).toBeNull();
    expect(defaultOpponent(twoCoaches(), "", undefined)).toBeNull();
    expect(defaultOpponent(unpicked(), "member-third", SCHEDULE)).toBe("member-third");
    expect(defaultOpponent(unpicked(), "member-gone", undefined)).toBeUndefined();
    expect(defaultOpponent(unpicked(), "member-own", SCHEDULE)).toBe("member-other");
    // Two other coaches: the schedule decides (waited for; unreadable or empty: —).
    expect(defaultOpponent(unpicked(), null, undefined)).toBeUndefined();
    expect(defaultOpponent(unpicked(), null, SCHEDULE)).toBe("member-other");
    expect(defaultOpponent(unpicked(), null, null)).toBeNull();
    expect(defaultOpponent(unpicked(), null, [])).toBeNull();
    // One other coach: that coach, schedule or not.
    expect(defaultOpponent(twoCoaches(), null, undefined)).toBe("member-other");
    expect(defaultOpponent(twoCoaches(), "member-gone", null)).toBe("member-other");
    // No other member, an opponent already chosen, teams not loaded: none.
    const alone = twoCoaches();
    expect(defaultOpponent({ ...alone, data: { ...alone.data!, members: [alone.data!.members[0]] } }, null, [])).toBeNull();
    expect(defaultOpponent(unpicked({ opponentId: "member-other" }), "member-third", SCHEDULE)).toBeNull();
    expect(defaultOpponent(unpicked({ teamsStatus: "loading", data: null }), "member-third", SCHEDULE)).toBeNull();
  });
});

describe("the Opponent picker's quick picks (pure)", () => {
  /** The fixture's league with five other coaches. */
  const more = ["fourth", "fifth", "sixth"].map((name, index) => ({ id: `member-${name}`, role: "coach", team_name: name, draft_position: 4 + index }));
  const crowded = (patch: Partial<CalculatorRosterState> = {}) => { const base = unpicked(patch); return { ...base, data: base.data && { ...base.data, members: [...base.data.members, ...more] } }; };
  const NEXT: NextMatch = { opponentId: "member-other", name: "Round 2" };

  it("Next match is your next scheduled match in the league, whoever the picker shows: its opponent and round", () => {
    expect(nextMatchIn(unpicked(), SCHEDULE)).toEqual(NEXT);
    expect(nextMatchIn(unpicked({ opponentId: "member-third" }), SCHEDULE)).toEqual(NEXT);
    // A playoff match continues the season's round numbers: it is named as the bracket (and the league overview) names it.
    const season = [match(1, "member-own", "member-other", "completed"), match(2, "member-third", "member-own", "completed")];
    const semifinal = match(3, "member-own", "member-third", "upcoming", "playoff");
    const final = match(4, null, null, "upcoming", "playoff");
    expect(nextMatchIn(unpicked(), [...season, semifinal, final])).toEqual({ opponentId: "member-third", name: "Semifinal 1" });
    expect(nextMatchIn(unpicked(), [...season, { ...semifinal, status: "completed" }, { ...final, home_member_id: "member-own", away_member_id: "member-other" }]))
      .toEqual({ opponentId: "member-other", name: "Final" });
    // None: every match played, an undecided slot, a coach not in the loaded league, teams not loaded.
    expect(nextMatchIn(unpicked(), [SCHEDULE[0]])).toBeNull();
    expect(nextMatchIn(unpicked(), [match(5, null, "member-own")])).toBeNull();
    expect(nextMatchIn(unpicked(), [match(2, "member-gone", "member-own")])).toBeNull();
    expect(nextMatchIn(unpicked({ teamsStatus: "loading", data: null }), SCHEDULE)).toBeNull();
  });

  it("groups Next match (\"Round 2\") and Recent: up to three opponents of your last starts still in the league, the next match's left out", () => {
    expect(RECENT_SHOWN).toBe(3);
    const recent = ["member-other", "member-gone", "member-third", "member-own", "member-fourth", "member-fifth", "member-sixth"];
    expect(opponentQuickPicks(crowded(), NEXT, recent)).toEqual([
      { heading: "Next match", options: [{ id: "member-other", fact: "Round 2" }] },
      { heading: "Recent", options: [{ id: "member-third" }, { id: "member-fourth" }, { id: "member-fifth" }] },
    ]);
    // Either group alone, or none; nothing until the league's teams are loaded.
    expect(opponentQuickPicks(crowded(), null, ["member-third", "member-other"])).toEqual([{ heading: "Recent", options: [{ id: "member-third" }, { id: "member-other" }] }]);
    expect(opponentQuickPicks(crowded(), NEXT, ["member-other"])).toEqual([{ heading: "Next match", options: [{ id: "member-other", fact: "Round 2" }] }]);
    expect(opponentQuickPicks(crowded(), null, [])).toEqual([]);
    expect(opponentQuickPicks(crowded({ teamsStatus: "loading", data: null }), NEXT, ["member-third"])).toEqual([]);
  });
});

let document: ReturnType<typeof installFakeDom>;
let createRoot: typeof import("react-dom/client").createRoot;
let root: { render: (node: unknown) => void; unmount: () => void } | null = null;
let useNextOpponent: typeof UseNextOpponent;

beforeAll(async () => {
  document = installFakeDom();
  ({ createRoot } = await import("react-dom/client"));
  ({ useNextOpponent } = await import("@/app/(app)/training/setup/useNextOpponent"));
});
// Each case is a new Training mount.
beforeEach(() => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as NonNullable<typeof root>;
});
afterEach(async () => { await act(async () => { root?.unmount(); }); });

type Rosters = Parameters<typeof UseNextOpponent>[0];
/** The page's selectOpponent as the hook returns it (what the Opponent picker calls). */
let picker: Rosters["selectOpponent"] = () => undefined;
const keepPicker = (pick: Rosters["selectOpponent"]) => { picker = pick; };
const NOTHING_REMEMBERED: RememberedOpponents = {};
/** The next match the hook last returned (the picker's "Next match"). */
let shownNext: NextMatch | null = null;
const keepNext = (next: NextMatch | null) => { shownNext = next; };
function Harness({ rosters, read, remembered, onPicker }: { rosters: Rosters; read: ScheduleReader; remembered: RememberedOpponents; onPicker(pick: Rosters["selectOpponent"]): void }) {
  const { selectOpponent, nextMatch } = useNextOpponent(rosters, remembered, read);
  useEffect(() => { onPicker(selectOpponent); }, [onPicker, selectOpponent]);
  useEffect(() => { keepNext(nextMatch); }, [nextMatch]);
  return null;
}
const rostersWith = (state: CalculatorRosterState, selectOpponent = vi.fn()) => ({ state, selectLeague: vi.fn(), selectOpponent, refresh: vi.fn() });
async function render(rosters: Rosters, read: ScheduleReader, remembered: RememberedOpponents = NOTHING_REMEMBERED) {
  await act(async () => { root!.render(createElement(Harness, { rosters, read, remembered, onPicker: keepPicker })); });
}
function deferred() {
  let resolve!: (matches: ScheduledMatch[]) => void;
  const promise = new Promise<ScheduledMatch[]>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("the default opponent on the Training page", () => {
  it("applies the opponent you picked in a league again when you come back to it, as a reload would; your — there stays", async () => {
    const selectOpponent = vi.fn();
    const read = vi.fn(async (): Promise<ScheduledMatch[]> => []);
    const base = unpicked();
    const alpha: CalculatorRosterState = { ...base, leagues: [...base.leagues, { ...base.leagues[0], id: "league-b", name: "Beta" }] };
    const beta: CalculatorRosterState = { ...alpha, selectedLeagueId: "league-b", data: { ...base.data!, leagueId: "league-b" } };
    const none: CalculatorRosterState = { ...alpha, selectedLeagueId: "", teamsStatus: "idle", data: null };
    // Alpha: two other coaches, nothing scheduled or remembered: "—". Your pick there is remembered for Alpha.
    await render(rostersWith(alpha, selectOpponent), read, {});
    expect(selectOpponent).not.toHaveBeenCalled();
    picker("member-third");
    const picked = { "league-a": "member-third" };
    // Beta, then back to Alpha (the rosters reset the picker to "—"): your pick comes back, once.
    await render(rostersWith(beta, selectOpponent), read, picked);
    await render(rostersWith(alpha, selectOpponent), read, picked);
    await render(rostersWith({ ...alpha }, selectOpponent), read, picked);
    expect(selectOpponent.mock.calls).toEqual([["member-third"], ["member-third"]]);
    // The league "—" and back: again.
    await render(rostersWith(none, selectOpponent), read, picked);
    await render(rostersWith(alpha, selectOpponent), read, picked);
    expect(selectOpponent).toHaveBeenCalledTimes(3);
    // Your "—" in Alpha (remembered as ""): it stays when you come back.
    picker("");
    await render(rostersWith(beta, selectOpponent), read, { "league-a": "" });
    await render(rostersWith(alpha, selectOpponent), read, { "league-a": "" });
    expect(selectOpponent.mock.calls.slice(3)).toEqual([[""]]);
  });

  it("selects your next scheduled opponent once per league entered", async () => {
    const selectOpponent = vi.fn();
    const read = vi.fn(async () => SCHEDULE);
    await render(rostersWith(unpicked({ teamsStatus: "loading", data: null }), selectOpponent), read);
    expect(read).toHaveBeenCalledWith("league-a");
    expect(selectOpponent).not.toHaveBeenCalled();
    await render(rostersWith(unpicked(), selectOpponent), read);
    expect(selectOpponent).toHaveBeenCalledExactlyOnceWith("member-other");
    // Back to "—" in the same league (the picker's own choice): it stays.
    await render(rostersWith(unpicked(), selectOpponent), read);
    expect(selectOpponent).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    // Another league: its own next opponent, once.
    const base = unpicked();
    const beta = { ...base.leagues[0], id: "league-b", name: "Beta" };
    const other: CalculatorRosterState = { ...base, leagues: [...base.leagues, beta], selectedLeagueId: "league-b", data: { ...base.data!, leagueId: "league-b" } };
    await render(rostersWith(other, selectOpponent), read);
    expect(read).toHaveBeenLastCalledWith("league-b");
    expect(selectOpponent).toHaveBeenCalledTimes(2);
    await render(rostersWith({ ...other }, selectOpponent), read);
    expect(selectOpponent).toHaveBeenCalledTimes(2);
  });

  it("never overrides your own pick, — included, made before the schedule arrives", async () => {
    const selectOpponent = vi.fn();
    const schedule = deferred();
    await render(rostersWith(unpicked(), selectOpponent), () => schedule.promise);
    picker("");
    expect(selectOpponent).toHaveBeenCalledExactlyOnceWith("");
    await act(async () => { schedule.resolve(SCHEDULE); await schedule.promise; });
    expect(selectOpponent).toHaveBeenCalledOnce();
  });

  it("leaves — when the schedule cannot be read or names no opponent, and keeps an opponent already chosen", async () => {
    const cases: [CalculatorRosterState, ScheduleReader][] = [
      [unpicked(), () => Promise.reject(new Error("permission denied for table league_matches"))],
      [unpicked({ userId: "user-2" }), async () => [SCHEDULE[0]]],
      [unpicked({ userId: "user-3", opponentId: "member-other" }), async () => SCHEDULE],
    ];
    for (const [state, read] of cases) {
      const selectOpponent = vi.fn();
      await render(rostersWith(state, selectOpponent), read);
      await render(rostersWith({ ...state }, selectOpponent), read);
      expect(selectOpponent).not.toHaveBeenCalled();
    }
  });

  it("starts on the opponent you last picked in the league once your picks are read, without waiting for the schedule", async () => {
    const selectOpponent = vi.fn();
    const schedule = deferred();
    const read = vi.fn(() => schedule.promise);
    // The account's remembered picks not read yet: nothing is decided.
    await render(rostersWith(unpicked(), selectOpponent), read, null);
    expect(selectOpponent).not.toHaveBeenCalled();
    await render(rostersWith(unpicked(), selectOpponent), read, { "league-a": "member-third", "league-b": "member-other" });
    expect(selectOpponent).toHaveBeenCalledExactlyOnceWith("member-third");
    await act(async () => { schedule.resolve(SCHEDULE); await schedule.promise; });
    expect(selectOpponent).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });

  it("applies a remembered opponent when the schedule failed first, and ignores one who left the league", async () => {
    const failing: ScheduleReader = () => Promise.reject(new Error("permission denied for table league_matches"));
    const selectOpponent = vi.fn();
    await render(rostersWith(unpicked({ teamsStatus: "loading", data: null }), selectOpponent), failing, { "league-a": "member-third" });
    await render(rostersWith(unpicked(), selectOpponent), failing, { "league-a": "member-third" });
    expect(selectOpponent).toHaveBeenCalledExactlyOnceWith("member-third");
    await act(async () => { root?.unmount(); });
    root = createRoot(document.body.appendChild(document.createElement("div")) as unknown as Element) as unknown as NonNullable<typeof root>;
    const gone = vi.fn();
    await render(rostersWith(unpicked({ userId: "user-2" }), gone), async () => SCHEDULE, { "league-a": "member-gone" });
    await render(rostersWith(unpicked({ userId: "user-2" }), gone), async () => SCHEDULE, { "league-a": "member-gone" });
    expect(gone).toHaveBeenCalledExactlyOnceWith("member-other");
  });

  it("starts a league with one other coach on that coach at once; your — before it stays", async () => {
    const selectOpponent = vi.fn();
    const never = () => new Promise<ScheduledMatch[]>(() => undefined);
    await render(rostersWith(twoCoaches(), selectOpponent), never);
    expect(selectOpponent).toHaveBeenCalledExactlyOnceWith("member-other");
    await act(async () => { root?.unmount(); });
    root = createRoot(document.body.appendChild(document.createElement("div")) as unknown as Element) as unknown as NonNullable<typeof root>;
    const picked = vi.fn();
    await render(rostersWith(twoCoaches({ userId: "user-2", teamsStatus: "loading", data: null }), picked), never);
    picker("");
    await render(rostersWith(twoCoaches({ userId: "user-2" }), picked), never);
    expect(picked).toHaveBeenCalledExactlyOnceWith("");
  });

  it("returns your next match from the same schedule read, whoever is picked, and again for a league you come back to", async () => {
    const read = vi.fn(async (leagueId: string) => (leagueId === "league-a" ? SCHEDULE : []));
    await render(rostersWith(unpicked({ teamsStatus: "loading", data: null })), read);
    expect(shownNext).toBeNull();
    await render(rostersWith(unpicked()), read);
    expect(shownNext).toEqual({ opponentId: "member-other", name: "Round 2" });
    // Another coach picked: the next match stays as scheduled.
    await render(rostersWith(unpicked({ opponentId: "member-third" })), read);
    expect(shownNext).toEqual({ opponentId: "member-other", name: "Round 2" });
    // Another league (nothing scheduled there), then back: Alpha's schedule is kept, not read again.
    const base = unpicked();
    const beta = { ...base.leagues[0], id: "league-b", name: "Beta" };
    const other: CalculatorRosterState = { ...base, leagues: [...base.leagues, beta], selectedLeagueId: "league-b", data: { ...base.data!, leagueId: "league-b" } };
    await render(rostersWith(other), read);
    expect(shownNext).toBeNull();
    await render(rostersWith({ ...other, selectedLeagueId: "league-a", data: { ...base.data!, leagueId: "league-a" } }), read);
    expect(shownNext).toEqual({ opponentId: "member-other", name: "Round 2" });
    expect(read.mock.calls).toEqual([["league-a"], ["league-b"]]);
  });

  it("reads a schedule again when you left its league before it answered", async () => {
    const first = deferred();
    let alphaReads = 0;
    const read = vi.fn((leagueId: string) => (leagueId === "league-a" && ++alphaReads === 1 ? first.promise : Promise.resolve(leagueId === "league-a" ? SCHEDULE : [])));
    const base = unpicked();
    const beta = { ...base.leagues[0], id: "league-b", name: "Beta" };
    const both: CalculatorRosterState = { ...base, leagues: [...base.leagues, beta] };
    await render(rostersWith(both), read);
    await render(rostersWith({ ...both, selectedLeagueId: "league-b", data: { ...base.data!, leagueId: "league-b" } }), read);
    // Alpha's first answer arrives after you left: dropped; back in Alpha it is read again.
    await act(async () => { first.resolve([]); await first.promise; });
    await render(rostersWith(both), read);
    expect(read.mock.calls).toEqual([["league-a"], ["league-b"], ["league-a"]]);
    expect(shownNext).toEqual({ opponentId: "member-other", name: "Round 2" });
  });

  it("is Training's only: the calculator's rosters have no default opponent", () => {
    const calculator = readFileSync(join(__dirname, "..", "..", "app", "(app)", "calculator", "CalculatorClient.tsx"), "utf8");
    expect(calculator).not.toMatch(/useNextOpponent|next-opponent|nextOpponentId|useRememberedPicks/);
    const training = readFileSync(join(__dirname, "..", "..", "app", "(app)", "training", "TrainingClient.tsx"), "utf8");
    // The calculator's rosters, with the remembered opponents of the bound account (null until it is bound).
    expect(training).toContain("useRememberedPicks(useNextOpponent(calculatorRosters, picks?.opponents ?? null), picks, session)");
    expect(training).toContain("const calculatorRosters = useCalculatorRosters();");
  });
});
