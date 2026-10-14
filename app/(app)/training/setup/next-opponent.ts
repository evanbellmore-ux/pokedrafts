import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { nextOpponentId, type ScheduledMatch } from "@/app/lib/league/next-match";

// Training's default opponent (the calculator's picker has none): your next scheduled opponent in the selected league, decided
// once per Training mount and league. Pure; setup/useNextOpponent.ts reads the schedule and applies it.

/** The account and selected league a default is decided for ("user:league"), or null while none is selected. */
export function scheduleKey(state: CalculatorRosterState): string | null {
  if (state.status !== "ready" || !state.userId) return null;
  return state.leagues.some((league) => league.id === state.selectedLeagueId) ? `${state.userId}:${state.selectedLeagueId}` : null;
}

/** The selected league's teams are loaded: the moment the default is decided (the Opponent picker lists them). */
export function teamsLoaded(state: CalculatorRosterState): boolean {
  return state.status === "ready" && state.teamsStatus === "ready" && !!state.selectedLeagueId && state.data?.leagueId === state.selectedLeagueId;
}

/**
 * The opponent of your next scheduled match in the selected league while the Opponent picker is still "—"; null when there is
 * none (no schedule, every match played, its other slot undecided) or that coach is not one of the league's loaded members.
 */
export function scheduledOpponent(state: CalculatorRosterState, matches: readonly ScheduledMatch[]): string | null {
  if (!teamsLoaded(state) || state.opponentId) return null;
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  if (!league) return null;
  const id = nextOpponentId(matches, league.memberId);
  return id && id !== league.memberId && !!state.data?.members.some((member) => member.id === id) ? id : null;
}
