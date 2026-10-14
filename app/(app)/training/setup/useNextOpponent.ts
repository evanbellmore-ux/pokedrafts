"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { NEXT_MATCH_SELECT, parseScheduledMatches, type ScheduledMatch } from "@/app/lib/league/next-match";
import { createClient } from "@/app/lib/supabase/client";
import { scheduledOpponent, scheduleKey, teamsLoaded } from "./next-opponent";

type Rosters = ReturnType<typeof useCalculatorRosters>;
export type ScheduleReader = (leagueId: string) => Promise<ScheduledMatch[]>;

/** The selected league's `league_matches` through the browser client, as the league overview reads them. */
async function readSchedule(leagueId: string): Promise<ScheduledMatch[]> {
  const { data, error } = await createClient().from("league_matches").select(NEXT_MATCH_SELECT).eq("league_id", leagueId);
  if (error) throw error;
  return parseScheduledMatches(data);
}

/**
 * Training's rosters with the default opponent: once per mount and league, when the league's teams are loaded and the
 * Opponent picker is still "—", it selects your next scheduled opponent. Your own pick (through the returned
 * selectOpponent, "—" included) is never overridden; an unreadable schedule leaves "—".
 */
export function useNextOpponent(rosters: Rosters, read: ScheduleReader = readSchedule): Rosters {
  const { state, selectOpponent } = rosters;
  const key = scheduleKey(state);
  const leagueId = key ? state.selectedLeagueId : null;
  const [schedule, setSchedule] = useState<{ key: string; matches: ScheduledMatch[] } | null>(null);
  /** Keys decided this mount: defaulted, picked by you, or the schedule unreadable. */
  const decided = useRef(new Set<string>());

  useEffect(() => {
    if (!key || !leagueId || decided.current.has(key)) return;
    let active = true;
    read(leagueId).then(
      (matches) => { if (active) setSchedule({ key, matches }); },
      () => { if (active) decided.current.add(key); },
    );
    return () => { active = false; };
  }, [key, leagueId, read]);

  useEffect(() => {
    if (!key || decided.current.has(key) || schedule?.key !== key || !teamsLoaded(state)) return;
    decided.current.add(key);
    const opponent = scheduledOpponent(state, schedule.matches);
    if (opponent) selectOpponent(opponent);
  }, [key, schedule, state, selectOpponent]);

  const pick = useCallback((id: string) => {
    if (key) decided.current.add(key);
    selectOpponent(id);
  }, [key, selectOpponent]);
  return { ...rosters, selectOpponent: pick };
}
