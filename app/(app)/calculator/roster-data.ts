import {
  getCurrentUser,
  type CurrentUserAuth,
} from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import {
  MEMBER_SELECT,
  type OverviewMember,
} from "@/app/(app)/leagues/[leagueId]/overview";
import {
  ROSTER_ONLY_SELECT,
  parseTeamRosters,
  type TeamRoster,
} from "@/app/(app)/leagues/[leagueId]/team/roster";

export type CalculatorLeague = {
  id: string;
  name: string;
  memberId: string;
  teamName: string | null;
  draftStarted: boolean;
  draftCompleted: boolean;
};

export type LeagueRosterData = {
  leagueId: string;
  members: OverviewMember[];
  teams: TeamRoster[];
};

export type CalculatorRosterState = {
  status: "loading" | "ready" | "error" | "signed-out";
  userId: string | null;
  leagues: CalculatorLeague[];
  selectedLeagueId: string;
  opponentId: string;
  teamsStatus: "idle" | "loading" | "ready" | "error";
  data: LeagueRosterData | null;
  message: string | null;
  teamsMessage: string | null;
};

export function createRosterState(): CalculatorRosterState {
  return {
    status: "loading",
    userId: null,
    leagues: [],
    selectedLeagueId: "",
    opponentId: "",
    teamsStatus: "idle",
    data: null,
    message: null,
    teamsMessage: null,
  };
}

/** The read-only client slice also lets tests use query-chain stubs. */
export type CalculatorRosterClient = {
  auth: CurrentUserAuth & {
    onAuthStateChange(
      callback: (event: string, session: { user: { id: string } } | null) => void
    ): { data: { subscription: { unsubscribe(): void } } };
  };
  from(table: "league_members" | "drafted_teams"): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

const LEAGUE_SELECT =
  "id, league_id, team_name, leagues!league_id(id, name, draft_started, draft_completed)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseLeagues(rows: unknown): CalculatorLeague[] {
  const invalid = "League memberships could not be read. Please refresh and try again.";
  const ambiguous = "League memberships are ambiguous. Please refresh and try again.";
  if (!Array.isArray(rows)) throw new Error(invalid);

  const leagueIds = new Set<string>();
  const memberIds = new Set<string>();
  const leagues: CalculatorLeague[] = [];
  for (const row of rows) {
    if (
      !isRecord(row) ||
      !isId(row.id) ||
      !isId(row.league_id) ||
      !isNullableString(row.team_name)
    ) {
      throw new Error(invalid);
    }
    if (leagueIds.has(row.league_id) || memberIds.has(row.id)) {
      throw new Error(ambiguous);
    }
    leagueIds.add(row.league_id);
    memberIds.add(row.id);

    const embed = row.leagues;
    // A league hidden by RLS is not an accessible selection.
    if (embed === null || (Array.isArray(embed) && embed.length === 0)) continue;
    if (Array.isArray(embed) && embed.length !== 1) throw new Error(ambiguous);
    const league: unknown = Array.isArray(embed) ? embed[0] : embed;
    if (
      !isRecord(league) ||
      league.id !== row.league_id ||
      !isId(league.name) ||
      !(typeof league.draft_started === "boolean" || league.draft_started === null) ||
      !(typeof league.draft_completed === "boolean" || league.draft_completed === null)
    ) {
      throw new Error(invalid);
    }
    leagues.push({
      id: row.league_id,
      name: league.name,
      memberId: row.id,
      teamName: row.team_name,
      draftStarted: league.draft_started === true,
      draftCompleted: league.draft_completed === true,
    });
  }
  return leagues.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

function parseMembers(rows: unknown): OverviewMember[] {
  const invalid = "League members could not be read. Please refresh and try again.";
  if (!Array.isArray(rows)) throw new Error(invalid);
  const seen = new Set<string>();
  return rows.map((row): OverviewMember => {
    if (
      !isRecord(row) ||
      !isId(row.id) ||
      seen.has(row.id) ||
      typeof row.role !== "string" ||
      !isNullableString(row.team_name) ||
      !(
        row.draft_position === null ||
        (typeof row.draft_position === "number" && Number.isFinite(row.draft_position))
      )
    ) {
      throw new Error(invalid);
    }
    seen.add(row.id);
    return {
      id: row.id,
      role: row.role,
      team_name: row.team_name,
      draft_position: row.draft_position,
    };
  });
}

/**
 * Calculator-local async state. Every publication is a new snapshot; generations
 * invalidate reads even when the underlying client cannot cancel their promises.
 */
export function createRosterController(
  client: CalculatorRosterClient,
  onSnapshot: (state: CalculatorRosterState) => void
) {
  let state = createRosterState();
  let disposed = false;
  let identity: string | null | undefined;
  let loadedAccount = false;
  let accountRequest = 0;
  let teamsRequest = 0;
  let unsubscribe: (() => void) | null = null;
  let authReload: ReturnType<typeof setTimeout> | null = null;

  function emit(next: CalculatorRosterState) {
    if (disposed) return;
    state = next;
    onSnapshot(next);
  }

  function cancelAuthReload() {
    if (authReload !== null) clearTimeout(authReload);
    authReload = null;
  }

  function invalidate() {
    accountRequest += 1;
    teamsRequest += 1;
    cancelAuthReload();
  }

  function resetIdentity(userId: string | null) {
    identity = userId;
    loadedAccount = false;
    emit({
      ...createRosterState(),
      userId,
      status: userId === null ? "signed-out" : "loading",
    });
  }

  async function loadTeams(league: CalculatorLeague) {
    const account = accountRequest;
    const request = ++teamsRequest;
    const userId = state.userId;
    const current = () =>
      !disposed &&
      account === accountRequest &&
      request === teamsRequest &&
      userId === state.userId &&
      state.selectedLeagueId === league.id;

    try {
      const [memberResult, teamResult] = await Promise.all([
        client.from("league_members").select(MEMBER_SELECT).eq("league_id", league.id),
        client.from("drafted_teams").select(ROSTER_ONLY_SELECT).eq("league_id", league.id),
      ]);
      if (!current()) return;
      if (memberResult.error) throw memberResult.error;
      const members = parseMembers(memberResult.data);
      if (!members.some((member) => member.id === league.memberId)) {
        emit({
          ...state,
          leagues: state.leagues.filter((item) => item.id !== league.id),
          selectedLeagueId: "",
          opponentId: "",
          data: null,
          teamsStatus: "error",
          teamsMessage: "Your membership in this league is no longer available. Refresh and try again.",
        });
        return;
      }
      if (teamResult.error) throw teamResult.error;
      const byMember = new Map(members.map((member) => [member.id, member]));
      const teams = parseTeamRosters(teamResult.data).flatMap((team): TeamRoster[] => {
        const member = byMember.get(team.member_id);
        return member
          ? [{ ...team, team_name: member.team_name, role: member.role }]
          : [];
      });
      const opponentId =
        state.opponentId !== league.memberId && byMember.has(state.opponentId)
          ? state.opponentId
          : "";
      emit({
        ...state,
        opponentId,
        teamsStatus: "ready",
        teamsMessage: null,
        data: { leagueId: league.id, members, teams },
      });
    } catch (error) {
      if (!current()) return;
      emit({
        ...state,
        data: null,
        teamsStatus: "error",
        teamsMessage: friendlyError(error),
      });
    }
  }

  async function refresh() {
    if (disposed) return;
    cancelAuthReload();
    const request = ++accountRequest;
    teamsRequest += 1;
    const current = () => !disposed && request === accountRequest;
    emit({
      ...state,
      status: "loading",
      data: null,
      teamsStatus: state.selectedLeagueId ? "loading" : "idle",
      message: null,
      teamsMessage: null,
    });

    try {
      const account = await getCurrentUser(client.auth);
      if (!current()) return;
      if (account.status === "error") {
        // Preserve the last identity: an auth outage is not an account switch.
        emit({ ...state, status: "error", teamsStatus: "idle", message: account.message });
        return;
      }
      if (account.status === "signed-out") {
        invalidate();
        resetIdentity(null);
        return;
      }
      if (identity !== account.user.id) resetIdentity(account.user.id);
      if (!current()) return;

      const result = await client
        .from("league_members")
        .select(LEAGUE_SELECT)
        .eq("user_id", account.user.id);
      if (!current()) return;
      if (result.error) throw result.error;
      const leagues = parseLeagues(result.data);
      const selected = loadedAccount
        ? leagues.find((league) => league.id === state.selectedLeagueId)
        : leagues[0];
      loadedAccount = true;
      emit({
        ...state,
        status: "ready",
        leagues,
        selectedLeagueId: selected?.id ?? "",
        opponentId: selected ? state.opponentId : "",
        data: null,
        teamsStatus: selected ? "loading" : "idle",
        message: null,
        teamsMessage: null,
      });
      if (selected && current()) await loadTeams(selected);
    } catch (error) {
      if (!current()) return;
      emit({
        ...state,
        status: "error",
        data: null,
        teamsStatus: "idle",
        message: friendlyError(error),
      });
    }
  }

  function onAuthChange(event: string, session: { user: { id: string } } | null) {
    if (disposed) return;
    const userId = event === "SIGNED_OUT" ? null : session?.user.id ?? null;
    if (
      userId === identity &&
      !(event === "SIGNED_OUT" && state.status !== "signed-out")
    ) {
      return;
    }
    invalidate();
    resetIdentity(userId);
    if (userId !== null) {
      // auth-js holds its lock while notifying subscribers. Never call an auth
      // method (or await a reload) in that callback, including via a microtask.
      authReload = setTimeout(() => {
        authReload = null;
        void refresh();
      }, 0);
    }
  }

  function start(): Promise<void> {
    if (disposed || unsubscribe !== null) return Promise.resolve();
    const { data } = client.auth.onAuthStateChange(onAuthChange);
    unsubscribe = () => data.subscription.unsubscribe();
    return refresh();
  }

  function selectLeague(id: string): Promise<void> {
    if (disposed || state.status !== "ready" || id === state.selectedLeagueId) {
      return Promise.resolve();
    }
    const league = state.leagues.find((item) => item.id === id);
    if (id !== "" && !league) return Promise.resolve();
    teamsRequest += 1;
    emit({
      ...state,
      selectedLeagueId: id,
      opponentId: "",
      data: null,
      teamsStatus: league ? "loading" : "idle",
      teamsMessage: null,
    });
    return league ? loadTeams(league) : Promise.resolve();
  }

  function selectOpponent(id: string) {
    if (disposed || id === state.opponentId) return;
    const league = state.leagues.find((item) => item.id === state.selectedLeagueId);
    if (
      id !== "" &&
      (state.status !== "ready" ||
        state.teamsStatus !== "ready" ||
        !league ||
        id === league.memberId ||
        state.data?.leagueId !== league.id ||
        !state.data.members.some((member) => member.id === id))
    ) {
      return;
    }
    emit({ ...state, opponentId: id });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidate();
    unsubscribe?.();
    unsubscribe = null;
  }

  return { start, refresh, selectLeague, selectOpponent, dispose, getState: () => state };
}
