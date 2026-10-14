"use client";

import { useCallback, useEffect, useRef } from "react";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import type { SetupPicks } from "../model/view-types";
import type { TrainingSession } from "../training-session";

type Rosters = ReturnType<typeof useCalculatorRosters>;

/**
 * Training's rosters with your remembered league picks: once per mount and account (the rosters start over on every mount,
 * the session's draft does not), the league you last picked when it is still one of yours ("—" included); the opponent comes back through
 * useNextOpponent. Your own league and opponent picks (through the returned selectLeague and selectOpponent) are remembered
 * for the account, and a league you pick before the restore is never overridden. `picks`: the bound account's (null until then).
 * The rosters' other fields (useNextOpponent's nextMatch) pass through.
 */
export function useRememberedPicks<R extends Rosters>(rosters: R, picks: SetupPicks | null, session: Pick<TrainingSession, "rememberLeague" | "rememberOpponent">): R {
  const { state, selectLeague, selectOpponent } = rosters;
  const { status, userId, leagues, selectedLeagueId } = state;
  /** Accounts whose league was restored (or picked by you) this mount. */
  const restored = useRef(new Set<string>());

  useEffect(() => {
    if (status !== "ready" || !userId || !picks || picks.userId !== userId || restored.current.has(userId)) return;
    restored.current.add(userId);
    const id = picks.leagueId;
    // "": you picked "—".
    if (id !== null && id !== selectedLeagueId && (id === "" || leagues.some((league) => league.id === id))) selectLeague(id);
  }, [status, userId, leagues, selectedLeagueId, picks, selectLeague]);

  const pickLeague = useCallback((id: string) => {
    if (userId) restored.current.add(userId);
    session.rememberLeague(id);
    selectLeague(id);
  }, [userId, session, selectLeague]);
  const pickOpponent = useCallback((id: string) => {
    if (selectedLeagueId) session.rememberOpponent(selectedLeagueId, id);
    selectOpponent(id);
  }, [selectedLeagueId, session, selectOpponent]);
  return { ...rosters, selectLeague: pickLeague, selectOpponent: pickOpponent };
}
