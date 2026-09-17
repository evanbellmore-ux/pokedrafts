import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRosterController,
  createRosterState,
  type CalculatorRosterClient,
  type CalculatorRosterState,
} from "@/app/(app)/calculator/roster-data";
import useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { MEMBER_SELECT } from "@/app/(app)/leagues/[leagueId]/overview";
import { ROSTER_ONLY_SELECT } from "@/app/(app)/leagues/[leagueId]/team/roster";
import { CONNECTION_ERROR, GENERIC_ERROR, PERMISSION_ERROR } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";

// Importing/rendering the hook must not even try to configure a browser client.
vi.mock("@/app/lib/supabase/client", () => ({ createClient: vi.fn() }));

type ReadResult = { data: unknown; error: unknown };
type AuthResult = Awaited<ReturnType<CalculatorRosterClient["auth"]["getUser"]>>;
type Query = { table: string; select: string; column: string; value: string };
type AuthListener = Parameters<CalculatorRosterClient["auth"]["onAuthStateChange"]>[0];
const controllers: ReturnType<typeof createRosterController>[] = [];
const ok = (data: unknown): ReadResult => ({ data, error: null });
const account = (id: string | null): AuthResult => ({
  data: { user: id === null ? null : { id } },
  error: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  // Drain the auth helper, query-chain mocks and Promise.all without real timers.
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function membership(id = "league-a", memberId = "membership-a", name = "Alpha") {
  return {
    id: memberId,
    league_id: id,
    team_name: `Team ${memberId}`,
    leagues: { id, name, draft_started: true, draft_completed: true },
  };
}

function member(id: string, teamName: string | null = `Team ${id}`) {
  return { id, role: "coach", team_name: teamName, draft_position: null };
}

function team(id: string, memberId: string, name = "Charizard") {
  return {
    id,
    member_id: memberId,
    pokemon: [{ name, points: 12, tier: 1, pick_number: 1, acquired: "draft" }],
    total_points: 12,
  };
}

function setup() {
  let userId: string | null = "account-a";
  let listener: AuthListener | null = null;
  const memberships = new Map<string, unknown[]>([
    ["account-a", [membership(), membership("league-b", "membership-b", "Beta")]],
    ["account-b", [membership("league-c", "membership-c", "Gamma")]],
  ]);
  const members = new Map<string, unknown[]>([
    ["league-a", [member("membership-a"), member("opponent-a"), member("no-team")]],
    ["league-b", [member("membership-b"), member("opponent-b")]],
    ["league-c", [member("membership-c"), member("opponent-c")]],
  ]);
  const teams = new Map<string, unknown[]>([
    ["league-a", [team("roster-a", "membership-a"), team("roster-foe", "opponent-a", "Blastoise")]],
    ["league-b", [team("roster-b", "membership-b", "Gengar")]],
    ["league-c", [team("roster-c", "membership-c", "Venusaur")]],
  ]);
  const read = vi.fn<(query: Query) => PromiseLike<ReadResult>>((query) => {
    if (query.table === "league_members" && query.column === "user_id") {
      return Promise.resolve(ok(memberships.get(query.value) ?? []));
    }
    if (query.table === "league_members" && query.column === "league_id") {
      return Promise.resolve(ok(members.get(query.value) ?? []));
    }
    if (query.table === "drafted_teams" && query.column === "league_id") {
      return Promise.resolve(ok(teams.get(query.value) ?? []));
    }
    throw new Error(`Unexpected read: ${JSON.stringify(query)}`);
  });
  const getUser = vi.fn<CalculatorRosterClient["auth"]["getUser"]>(async () => account(userId));
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn<CalculatorRosterClient["auth"]["onAuthStateChange"]>((callback) => {
    listener = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  const client: CalculatorRosterClient = {
    auth: { getUser, onAuthStateChange },
    from: (table) => ({
      select: (select) => ({
        eq: (column, value) => read({ table, select, column, value }),
      }),
    }),
  };
  const snapshots: CalculatorRosterState[] = [];
  const onSnapshot = vi.fn((state: CalculatorRosterState) => snapshots.push(state));
  const controller = createRosterController(client, onSnapshot);
  controllers.push(controller);
  return {
    controller, client, read, getUser, onAuthStateChange, unsubscribe,
    memberships, members, teams, snapshots, onSnapshot,
    setAccount: (id: string | null) => { userId = id; },
    authEvent: (event: string, id: string | null) => {
      userId = id;
      return listener?.(event, id === null ? null : { user: { id } });
    },
  };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("calculator roster initial state and SSR", () => {
  it("creates independent empty loading states", () => {
    const first = createRosterState();
    const second = createRosterState();
    expect(first).toEqual({
      status: "loading", userId: null, leagues: [], selectedLeagueId: "", opponentId: "",
      teamsStatus: "idle", data: null, message: null, teamsMessage: null,
    });
    expect(first).not.toBe(second);
    expect(first.leagues).not.toBe(second.leagues);
  });

  it("can render the hook on the server without configuring auth or emitting snapshots", () => {
    const snapshot = vi.fn();
    function Probe() {
      const { state } = useCalculatorRosters(snapshot);
      return createElement("span", null, state.status);
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>loading</span>");
    expect(createClient).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe("authenticated calculator reads", () => {
  it("filters memberships by verified user, scopes both concurrent reads, and joins finalized teams by MEMBER id", async () => {
    const h = setup();
    const pendingMembers = deferred<ReadResult>();
    const pendingTeams = deferred<ReadResult>();
    h.read.mockImplementationOnce(async () => ok(h.memberships.get("account-a")));
    h.read.mockImplementationOnce(() => pendingMembers.promise);
    h.read.mockImplementationOnce(() => pendingTeams.promise);
    const loading = h.controller.start();
    await flushPromises();

    expect(h.read.mock.calls.map(([query]) => query)).toEqual([
      {
        table: "league_members",
        select: "id, league_id, team_name, leagues!league_id(id, name, draft_started, draft_completed)",
        column: "user_id", value: "account-a",
      },
      { table: "league_members", select: MEMBER_SELECT, column: "league_id", value: "league-a" },
      { table: "drafted_teams", select: ROSTER_ONLY_SELECT, column: "league_id", value: "league-a" },
    ]);
    expect(h.controller.getState()).toMatchObject({ status: "ready", teamsStatus: "loading", data: null });
    pendingMembers.resolve(ok(h.members.get("league-a")));
    pendingTeams.resolve(ok([{
      id: "current-roster", member_id: "membership-a", total_points: 9,
      pokemon: [{ name: "Gengar", points: 9, tier: 2, acquired: "free_agent", pick_number: null }],
    }]));
    await loading;

    const state = h.controller.getState();
    expect(state).toMatchObject({ userId: "account-a", selectedLeagueId: "league-a", opponentId: "", teamsStatus: "ready" });
    expect(state.leagues[0].memberId).toBe("membership-a");
    expect(state.data?.teams).toEqual([{
      id: "current-roster", member_id: "membership-a", total_points: 9,
      team_name: "Team membership-a", role: "coach",
      pokemon: [{ name: "Gengar", points: 9, tier: 2, acquired: "free_agent", pick_number: null }],
    }]);
    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.read.mock.calls.every(([query]) => query.table !== "draft_picks")).toBe(true);
  });

  it("normalizes object/array/null embeds, excludes invisible leagues, and sorts by name then id", async () => {
    const h = setup();
    const a = membership();
    const b = membership("league-b", "membership-b", "Alpha");
    h.memberships.set("account-a", [
      membership("league-z", "membership-z", "Zulu"),
      { ...b, leagues: [b.leagues] },
      { ...membership("hidden", "hidden-member"), leagues: null },
      { ...membership("empty", "empty-member"), leagues: [] },
      { ...a, team_name: null, leagues: { ...a.leagues, draft_started: null, draft_completed: null } },
    ]);
    await h.controller.start();
    expect(h.controller.getState().leagues).toEqual([
      { id: "league-a", memberId: "membership-a", name: "Alpha", teamName: null, draftStarted: false, draftCompleted: false },
      { id: "league-b", memberId: "membership-b", name: "Alpha", teamName: "Team membership-b", draftStarted: true, draftCompleted: true },
      { id: "league-z", memberId: "membership-z", name: "Zulu", teamName: "Team membership-z", draftStarted: true, draftCompleted: true },
    ]);
    expect(h.controller.getState().selectedLeagueId).toBe("league-a");
  });

  it.each([
    ["missing membership id", [{ ...membership(), id: undefined }]],
    ["missing team name", [{ ...membership(), team_name: undefined }]],
    ["missing league embed", [{ ...membership(), leagues: undefined }]],
    ["mismatched league id", [{ ...membership(), leagues: { ...membership().leagues, id: "elsewhere" } }]],
    ["invalid name", [{ ...membership(), leagues: { ...membership().leagues, name: " " } }]],
    ["invalid flags", [{ ...membership(), leagues: { ...membership().leagues, draft_started: "yes" } }]],
    ["ambiguous league embed", [{ ...membership(), leagues: [membership().leagues, membership().leagues] }]],
    ["duplicate league membership", [membership(), membership("league-a", "different-member")]],
    ["reused membership id", [membership(), membership("league-b", "membership-a")]],
  ])("rejects %s rather than silently choosing a membership", async (_name, rows) => {
    const h = setup();
    h.memberships.set("account-a", rows);
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "error", userId: "account-a", leagues: [], selectedLeagueId: "", data: null });
    expect(h.controller.getState().message).toMatch(/memberships/);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("builds opponent choices from members, including missing/empty teams, and does not fetch on selection", async () => {
    const h = setup();
    h.members.set("league-a", [...h.members.get("league-a")!, member("empty-team"), member("account-a")]);
    h.teams.set("league-a", [...h.teams.get("league-a")!, { ...team("empty-roster", "empty-team"), pokemon: [] }]);
    await h.controller.start();
    const count = h.read.mock.calls.length;
    const before = h.controller.getState();
    h.controller.selectOpponent("no-team");
    expect(h.controller.getState().opponentId).toBe("no-team");
    h.controller.selectOpponent("empty-team");
    expect(h.controller.getState().opponentId).toBe("empty-team");
    // A member id that happens to equal the account id is still not our membership.
    h.controller.selectOpponent("account-a");
    expect(h.controller.getState().opponentId).toBe("account-a");
    h.controller.selectOpponent("membership-a");
    expect(h.controller.getState().opponentId).toBe("account-a");
    expect(h.read).toHaveBeenCalledTimes(count);
    expect(before.opponentId).toBe("");
    expect(before.data).toBe(h.controller.getState().data);
    expect(new Set(h.snapshots).size).toBe(h.snapshots.length);
  });

  it("allows no opponents/no finalized roster before a draft completes without confusing that with a failure", async () => {
    const h = setup();
    h.memberships.set("account-a", [{ ...membership(), leagues: { ...membership().leagues, draft_completed: false } }]);
    h.members.set("league-a", [member("membership-a")]);
    h.teams.set("league-a", []);
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({
      status: "ready", teamsStatus: "ready", message: null, teamsMessage: null,
      data: { members: [member("membership-a")], teams: [] },
    });
    expect(h.controller.getState().leagues[0].draftCompleted).toBe(false);
  });

  it("rejects duplicate member identities instead of selecting the first row", async () => {
    const h = setup();
    h.members.set("league-a", [member("membership-a"), member("membership-a", "Conflicting name")]);
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "ready", teamsStatus: "error", data: null });
    expect(h.controller.getState().teamsMessage).toMatch(/members could not be read/);
  });

  it("clears access and old selections if the authorized own membership disappears from the members read", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    h.members.set("league-a", [member("opponent-a")]);
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({
      status: "ready", selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "error",
    });
    expect(h.controller.getState().teamsMessage).toMatch(/membership.*no longer available/);
    expect(h.controller.getState().leagues.map((league) => league.id)).toEqual(["league-b"]);
  });
});

describe("calculator roster errors, retry and refreshed navigation", () => {
  it("distinguishes a signed-out account from an empty successful membership read", async () => {
    const signedOut = setup();
    signedOut.setAccount(null);
    await signedOut.controller.start();
    expect(signedOut.controller.getState()).toEqual({ ...createRosterState(), status: "signed-out" });
    expect(signedOut.read).not.toHaveBeenCalled();

    const empty = setup();
    empty.memberships.set("account-a", []);
    await empty.controller.start();
    expect(empty.controller.getState()).toEqual({ ...createRosterState(), status: "ready", userId: "account-a" });
  });

  it("does not auto-select newly available leagues after the initial successful empty load", async () => {
    const h = setup();
    h.memberships.set("account-a", []);
    await h.controller.start();
    h.memberships.set("account-a", [membership()]);
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", selectedLeagueId: "", teamsStatus: "idle", data: null });
    expect(h.controller.getState().leagues).toHaveLength(1);
  });

  it("keeps auth failure distinct from sign-out and retries the first successful account selection", async () => {
    const h = setup();
    h.getUser.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "error", userId: null, message: CONNECTION_ERROR });
    expect(h.read).not.toHaveBeenCalled();
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", userId: "account-a", selectedLeagueId: "league-a", teamsStatus: "ready", message: null });
  });

  it("retains last identity and navigation on a transient auth failure, then preserves them through retry", async () => {
    const h = setup();
    await h.controller.start();
    await h.controller.selectLeague("league-b");
    h.controller.selectOpponent("opponent-b");
    const leagues = h.controller.getState().leagues;
    h.getUser.mockResolvedValueOnce({
      data: { user: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
    });
    const refreshing = h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({
      status: "loading", userId: "account-a", leagues, selectedLeagueId: "league-b", opponentId: "opponent-b", data: null,
    });
    await refreshing;
    expect(h.controller.getState()).toMatchObject({
      status: "error", userId: "account-a", leagues, selectedLeagueId: "league-b", opponentId: "opponent-b", message: CONNECTION_ERROR,
    });
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", selectedLeagueId: "league-b", opponentId: "opponent-b", teamsStatus: "ready" });
  });

  it("reports membership query errors safely instead of presenting an empty league list", async () => {
    const h = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.read.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private database diagnostic" } });
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "error", userId: "account-a", message: GENERIC_ERROR, data: null });
    expect(log).toHaveBeenCalled();
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", selectedLeagueId: "league-a", message: null });
  });

  it.each(["league_members", "drafted_teams"])("keeps a %s roster-read failure separate and retries current teams", async (table) => {
    const h = setup();
    const original = h.read.getMockImplementation()!;
    let fail = true;
    h.read.mockImplementation((query) => {
      if (fail && query.table === table && query.column === "league_id") {
        return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } });
      }
      return original(query);
    });
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "ready", teamsStatus: "error", teamsMessage: PERMISSION_ERROR, message: null, data: null });
    fail = false;
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", teamsStatus: "ready", teamsMessage: null });
    expect(h.getUser).toHaveBeenCalledTimes(2);
  });

  it("catches a rejected roster promise and can retry it", async () => {
    const h = setup();
    h.read.mockImplementationOnce(async () => ok(h.memberships.get("account-a")));
    h.read.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ status: "ready", teamsStatus: "error", teamsMessage: CONNECTION_ERROR, data: null });
    await h.controller.refresh();
    expect(h.controller.getState().teamsStatus).toBe("ready");
  });

  it("preserves valid refreshed choices and clears a removed opponent without choosing a replacement", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    const firstEmission = h.snapshots.length;
    await h.controller.refresh();
    expect(h.snapshots.slice(firstEmission).every((state) => state.selectedLeagueId === "league-a" && state.opponentId === "opponent-a")).toBe(true);
    h.members.set("league-a", [member("membership-a"), member("no-team")]);
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ selectedLeagueId: "league-a", opponentId: "", teamsStatus: "ready" });
    expect(h.controller.getState().data?.teams.map((row) => row.member_id)).toEqual(["membership-a"]);
  });

  it("clears a vanished league without auto-picking another, even on later refreshes", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    h.memberships.set("account-a", [membership("league-b", "membership-b", "Beta")]);
    await h.controller.refresh();
    expect(h.controller.getState()).toMatchObject({ status: "ready", selectedLeagueId: "", opponentId: "", teamsStatus: "idle", data: null });
    await h.controller.refresh();
    expect(h.controller.getState().selectedLeagueId).toBe("");
    await h.controller.selectLeague("league-b");
    expect(h.controller.getState()).toMatchObject({ selectedLeagueId: "league-b", teamsStatus: "ready" });
    await h.controller.selectLeague("");
    await h.controller.refresh();
    expect(h.controller.getState().selectedLeagueId).toBe("");
  });

  it("ignores unauthorized, own-member, unchanged, and not-yet-loaded selections without reads/emissions", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    const count = h.read.mock.calls.length;
    const emissions = h.snapshots.length;
    await h.controller.selectLeague("not-accessible");
    await h.controller.selectLeague("league-a");
    h.controller.selectOpponent("not-a-member");
    h.controller.selectOpponent("membership-a");
    h.controller.selectOpponent("opponent-b");
    h.controller.selectOpponent("opponent-a");
    expect(h.read).toHaveBeenCalledTimes(count);
    expect(h.snapshots).toHaveLength(emissions);

    const pending = deferred<AuthResult>();
    h.getUser.mockReturnValueOnce(pending.promise);
    const refresh = h.controller.refresh();
    await h.controller.selectLeague("league-b");
    h.controller.selectOpponent("no-team");
    expect(h.controller.getState()).toMatchObject({ selectedLeagueId: "league-a", opponentId: "opponent-a" });
    pending.resolve(account("account-a"));
    await refresh;
  });
});

describe("calculator roster stale-response guards", () => {
  it.each(["resolve", "reject"] as const)("clears old teams on league switch and ignores a late %s from the old league", async (outcome) => {
    const h = setup();
    const stale = deferred<ReadResult>();
    const original = h.read.getMockImplementation()!;
    h.read.mockImplementation((query) => query.table === "drafted_teams" && query.value === "league-a" ? stale.promise : original(query));
    const initial = h.controller.start();
    await flushPromises();
    const switchLeague = h.controller.selectLeague("league-b");
    expect(h.controller.getState()).toMatchObject({ selectedLeagueId: "league-b", opponentId: "", teamsStatus: "loading", data: null });
    await switchLeague;
    const latest = h.controller.getState();
    if (outcome === "resolve") stale.resolve(ok(h.teams.get("league-a")));
    else stale.reject(new TypeError("Failed to fetch"));
    await initial;
    expect(h.controller.getState()).toBe(latest);
    expect(latest.data?.leagueId).toBe("league-b");
  });

  it("a second refresh supersedes pending memberships before they can launch old team reads", async () => {
    const h = setup();
    await h.controller.start();
    const stale = deferred<ReadResult>();
    h.read.mockReturnValueOnce(stale.promise);
    const first = h.controller.refresh();
    await flushPromises();
    h.memberships.set("account-a", [membership("league-b", "membership-b", "Beta")]);
    await h.controller.refresh();
    const latest = h.controller.getState();
    const calls = h.read.mock.calls.length;
    stale.resolve(ok([membership()]));
    await first;
    expect(h.controller.getState()).toBe(latest);
    expect(latest.selectedLeagueId).toBe("");
    expect(h.read).toHaveBeenCalledTimes(calls);
  });

  it("a second refresh of the same league supersedes old roster results", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    const stale = deferred<ReadResult>();
    const original = h.read.getMockImplementation()!;
    let hold = true;
    h.read.mockImplementation((query) => hold && query.table === "drafted_teams" ? stale.promise : original(query));
    const first = h.controller.refresh();
    await flushPromises();
    hold = false;
    h.teams.set("league-a", [team("current-version", "membership-a", "Gengar")]);
    await h.controller.refresh();
    const latest = h.controller.getState();
    stale.resolve(ok([team("outdated-version", "membership-a")]));
    await first;
    expect(h.controller.getState()).toBe(latest);
    expect(latest.data?.teams[0].id).toBe("current-version");
    expect(latest.opponentId).toBe("opponent-a");
  });

  it("changing account immediately clears private lists, and auth verification runs outside the subscription callback", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    const calls = h.getUser.mock.calls.length;
    expect(h.authEvent("SIGNED_IN", "account-b")).toBeUndefined();
    expect(h.getUser).toHaveBeenCalledTimes(calls);
    expect(h.controller.getState()).toEqual({ ...createRosterState(), userId: "account-b" });
    await vi.runOnlyPendingTimersAsync();
    expect(h.getUser).toHaveBeenCalledTimes(calls + 1);
    expect(h.controller.getState()).toMatchObject({ status: "ready", userId: "account-b", selectedLeagueId: "league-c", opponentId: "", data: { leagueId: "league-c" } });
  });

  it("ignores token refresh and repeated same-user sign-in without duplicate reads or state emissions", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.start();
    const state = h.controller.getState();
    const calls = h.read.mock.calls.length;
    for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) {
      h.authEvent(event, "account-a");
    }
    await vi.runOnlyPendingTimersAsync();
    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(calls);
    expect(h.controller.getState()).toBe(state);
  });

  it("coalesces rapid account changes and verifies auth instead of trusting an event's user id for reads", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.start();
    const reads = h.read.mock.calls.length;
    h.authEvent("SIGNED_IN", "account-b");
    h.authEvent("SIGNED_IN", "unverified-event-id");
    h.setAccount(null);
    await vi.runOnlyPendingTimersAsync();
    expect(h.getUser).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenCalledTimes(reads);
    expect(h.controller.getState()).toEqual({ ...createRosterState(), status: "signed-out" });
  });

  it.each(["auth", "memberships", "teams"] as const)("ignores a deferred old account's %s result after replacement", async (stage) => {
    vi.useFakeTimers();
    const h = setup();
    const staleAuth = deferred<AuthResult>();
    const staleRead = deferred<ReadResult>();
    const original = h.read.getMockImplementation()!;
    if (stage === "auth") h.getUser.mockReturnValueOnce(staleAuth.promise);
    else h.read.mockImplementation((query) => {
      const stale = stage === "memberships"
        ? query.column === "user_id" && query.value === "account-a"
        : query.table === "drafted_teams" && query.value === "league-a";
      return stale ? staleRead.promise : original(query);
    });
    const old = h.controller.start();
    await flushPromises();
    h.authEvent("SIGNED_IN", "account-b");
    expect(h.controller.getState()).toEqual({ ...createRosterState(), userId: "account-b" });
    await vi.runOnlyPendingTimersAsync();
    const latest = h.controller.getState();
    staleAuth.resolve(account("account-a"));
    staleRead.resolve(ok(stage === "memberships" ? h.memberships.get("account-a") : h.teams.get("league-a")));
    await old;
    expect(h.controller.getState()).toBe(latest);
    expect(latest.userId).toBe("account-b");
    expect(latest.data?.leagueId).toBe("league-c");
  });

  it("sign-out immediately clears everything and late roster responses cannot restore it", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    const stale = deferred<ReadResult>();
    const original = h.read.getMockImplementation()!;
    h.read.mockImplementation((query) => query.table === "drafted_teams" ? stale.promise : original(query));
    const refresh = h.controller.refresh();
    await flushPromises();
    h.authEvent("SIGNED_OUT", null);
    const cleared = h.controller.getState();
    expect(cleared).toEqual({ ...createRosterState(), status: "signed-out" });
    stale.resolve(ok(h.teams.get("league-a")));
    await refresh;
    expect(h.controller.getState()).toBe(cleared);
  });

  it("a verified account replacement discovered by Refresh clears before its memberships load", async () => {
    const h = setup();
    await h.controller.start();
    h.controller.selectOpponent("opponent-a");
    h.setAccount("account-b");
    const pending = deferred<ReadResult>();
    h.read.mockReturnValueOnce(pending.promise);
    const refresh = h.controller.refresh();
    await flushPromises();
    expect(h.controller.getState()).toEqual({ ...createRosterState(), userId: "account-b" });
    pending.resolve(ok(h.memberships.get("account-b")));
    await refresh;
    expect(h.controller.getState()).toMatchObject({ selectedLeagueId: "league-c", opponentId: "" });
  });

  it.each(["auth", "memberships", "teams"] as const)("disposal unregisters once and suppresses pending %s reads and later events", async (stage) => {
    const h = setup();
    const pendingAuth = deferred<AuthResult>();
    const pendingRead = deferred<ReadResult>();
    const original = h.read.getMockImplementation()!;
    if (stage === "auth") h.getUser.mockReturnValueOnce(pendingAuth.promise);
    else h.read.mockImplementation((query) => {
      const pending = stage === "memberships" ? query.column === "user_id" : query.table === "drafted_teams";
      return pending ? pendingRead.promise : original(query);
    });
    const loading = h.controller.start();
    await flushPromises();
    h.controller.dispose();
    h.controller.dispose();
    const emissions = h.snapshots.length;
    const reads = h.read.mock.calls.length;
    h.authEvent("SIGNED_IN", "account-b");
    pendingAuth.resolve(account("account-a"));
    pendingRead.resolve(ok(stage === "memberships" ? h.memberships.get("account-a") : h.teams.get("league-a")));
    await loading;
    await h.controller.refresh();
    await h.controller.selectLeague("league-b");
    h.controller.selectOpponent("opponent-a");
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.snapshots).toHaveLength(emissions);
    expect(h.read).toHaveBeenCalledTimes(reads);
  });

  it("disposal cancels a queued auth reload before it can call auth", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.start();
    h.authEvent("SIGNED_IN", "account-b");
    h.controller.dispose();
    await vi.runOnlyPendingTimersAsync();
    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
