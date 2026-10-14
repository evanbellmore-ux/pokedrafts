import type { OpponentQuickGroup } from "@/app/(app)/calculator/LeagueMatchupPicker";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { isPlayoffMatch, playoffMatchLabel } from "@/app/lib/league/bracket";
import { nextMatchFor, opponentId as otherSide, type ScheduledMatch } from "@/app/lib/league/next-match";

// Training's default opponent (the calculator's picker has none), decided each time a league is entered on the Training page:
// the opponent you last picked in that league ("—" included), else your next scheduled opponent, else the league's only other
// coach. And the Opponent picker's quick picks: your next scheduled match and the opponents of your last starts in the league.
// Pure; setup/useNextOpponent.ts reads the schedule and applies it.

/** The quick picks' "Recent": the opponents of your last starts in the league, at most this many. */
export const RECENT_SHOWN = 3;

/**
 * Your next scheduled match in the selected league: its opponent (one of the league's loaded members other than you) and the
 * match as the league's pages name it ("Round 3"; a playoff match by its bracket name, "Semifinal 1", "Final").
 */
export type NextMatch = { opponentId: string; name: string };

/** The account and selected league a default is decided for ("user:league"), or null while none is selected. */
export function scheduleKey(state: CalculatorRosterState): string | null {
  if (state.status !== "ready" || !state.userId) return null;
  return state.leagues.some((league) => league.id === state.selectedLeagueId) ? `${state.userId}:${state.selectedLeagueId}` : null;
}

/** The selected league's teams are loaded: the moment the default is decided (the Opponent picker lists them). */
export function teamsLoaded(state: CalculatorRosterState): boolean {
  return state.status === "ready" && state.teamsStatus === "ready" && !!state.selectedLeagueId && state.data?.leagueId === state.selectedLeagueId;
}

/** The selected league (your membership in it) once its teams are loaded, and its members other than you. */
function loadedLeague(state: CalculatorRosterState) {
  if (!teamsLoaded(state)) return null;
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  if (!league) return null;
  return { league, others: (state.data?.members ?? []).filter((member) => member.id !== league.memberId) };
}

/**
 * Your next scheduled match in the selected league, whoever the Opponent picker shows; null when there is none (no schedule,
 * every match played, its other slot undecided) or that coach is not one of the league's loaded members.
 */
export function nextMatchIn(state: CalculatorRosterState, matches: readonly ScheduledMatch[]): NextMatch | null {
  const loaded = loadedLeague(state);
  if (!loaded) return null;
  const next = nextMatchFor(matches, loaded.league.memberId);
  const id = next ? otherSide(next, loaded.league.memberId) : null;
  if (!next || !id || !loaded.others.some((member) => member.id === id)) return null;
  // Playoff rounds continue the season's numbers, so a playoff match is named as the bracket names it.
  return { opponentId: id, name: isPlayoffMatch(next) ? playoffMatchLabel(next, [...matches]) : `Round ${next.round_number}` };
}

/** The opponent of your next scheduled match in the selected league while the Opponent picker is still "—" (else null). */
export function scheduledOpponent(state: CalculatorRosterState, matches: readonly ScheduledMatch[]): string | null {
  return state.opponentId ? null : nextMatchIn(state, matches)?.opponentId ?? null;
}

/**
 * The opponent Training starts on while the Opponent picker is still "—", in this order: `remembered` (the one you last picked
 * in the selected league) while it is still a member other than you; your next scheduled opponent; the league's only other
 * coach. `remembered` "": you picked "—" there, which stays. null: none ("—" stays); undefined: it waits for the schedule
 * (`matches` undefined; null when it was unreadable). With exactly one other coach the next scheduled opponent can only be
 * that coach, so the schedule is not waited for.
 */
export function defaultOpponent(state: CalculatorRosterState, remembered: string | null, matches: readonly ScheduledMatch[] | null | undefined): string | null | undefined {
  if (state.opponentId || remembered === "") return null;
  const loaded = loadedLeague(state);
  if (!loaded) return null;
  if (remembered && loaded.others.some((member) => member.id === remembered)) return remembered;
  if (loaded.others.length === 1) return loaded.others[0].id;
  if (matches === undefined) return undefined;
  return matches ? scheduledOpponent(state, matches) : null;
}

/**
 * The Opponent picker's quick picks in the selected league: "Next match" (your next scheduled opponent, "Round 3" or
 * "Semifinal 1") and "Recent"
 * (`recent`: the opponents of your last starts there, newest first; at most RECENT_SHOWN that are still members, the next
 * match's left out). Groups without a coach are left out.
 */
export function opponentQuickPicks(state: CalculatorRosterState, next: NextMatch | null, recent: readonly string[]): OpponentQuickGroup[] {
  const loaded = loadedLeague(state);
  if (!loaded) return [];
  const member = (id: string) => loaded.others.some((each) => each.id === id);
  const groups: OpponentQuickGroup[] = [];
  if (next && member(next.opponentId)) groups.push({ heading: "Next match", options: [{ id: next.opponentId, fact: next.name }] });
  const shown = [...new Set(recent)].filter((id) => id !== next?.opponentId && member(id)).slice(0, RECENT_SHOWN);
  if (shown.length) groups.push({ heading: "Recent", options: shown.map((id) => ({ id })) });
  return groups;
}
