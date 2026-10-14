import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { ScheduledMatch } from "@/app/lib/league/next-match";
import { scheduledOpponent, scheduleKey, teamsLoaded } from "@/app/(app)/training/setup/next-opponent";
import type { ScheduleReader, useNextOpponent as UseNextOpponent } from "@/app/(app)/training/setup/useNextOpponent";
import { installFakeDom } from "../fixtures/fake-dom";
import { OPPONENT_ROSTER, OWN_ROSTER, rosterState } from "../fixtures/training";

// Training's default opponent: your next scheduled opponent in the selected league, once per mount and league, only while
// the Opponent picker is "—" and you have not picked. The calculator's picker has no default.

const match = (round: number, home: string | null, away: string | null, status = "upcoming"): ScheduledMatch => ({
  round_number: round, match_number: 1, home_member_id: home, away_member_id: away, status,
});
/** member-own played member-other in round 1; they meet again in round 2. */
const SCHEDULE = [match(1, "member-own", "member-other", "completed"), match(2, "member-other", "member-own")];
const unpicked = (patch: Partial<CalculatorRosterState> = {}): CalculatorRosterState => ({ ...rosterState(OWN_ROSTER, OPPONENT_ROSTER), opponentId: "", ...patch });

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
function Harness({ rosters, read, onPicker }: { rosters: Rosters; read: ScheduleReader; onPicker(pick: Rosters["selectOpponent"]): void }) {
  const { selectOpponent } = useNextOpponent(rosters, read);
  useEffect(() => { onPicker(selectOpponent); }, [onPicker, selectOpponent]);
  return null;
}
const rostersWith = (state: CalculatorRosterState, selectOpponent = vi.fn()) => ({ state, selectLeague: vi.fn(), selectOpponent, refresh: vi.fn() });
async function render(rosters: Rosters, read: ScheduleReader) {
  await act(async () => { root!.render(createElement(Harness, { rosters, read, onPicker: keepPicker })); });
}
function deferred() {
  let resolve!: (matches: ScheduledMatch[]) => void;
  const promise = new Promise<ScheduledMatch[]>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("the default opponent on the Training page", () => {
  it("selects your next scheduled opponent once per mount and league", async () => {
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

  it("is Training's only: the calculator's rosters have no default opponent", () => {
    const calculator = readFileSync(join(__dirname, "..", "..", "app", "(app)", "calculator", "CalculatorClient.tsx"), "utf8");
    expect(calculator).not.toMatch(/useNextOpponent|next-opponent|nextOpponentId/);
    const training = readFileSync(join(__dirname, "..", "..", "app", "(app)", "training", "TrainingClient.tsx"), "utf8");
    expect(training).toContain("useNextOpponent(useCalculatorRosters())");
  });
});
