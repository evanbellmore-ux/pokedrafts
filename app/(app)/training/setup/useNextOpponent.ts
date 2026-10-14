"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import { NEXT_MATCH_SELECT, parseScheduledMatches, type ScheduledMatch } from "@/app/lib/league/next-match";
import { createClient } from "@/app/lib/supabase/client";
import { defaultOpponent, nextMatchIn, scheduleKey, teamsLoaded, type NextMatch } from "./next-opponent";

type Rosters = ReturnType<typeof useCalculatorRosters>;
/** Training's rosters with your next scheduled match in the selected league (null: none, or its schedule not read yet). */
export type ScheduledRosters = Rosters & { nextMatch: NextMatch | null };
export type ScheduleReader = (leagueId: string) => Promise<ScheduledMatch[]>;
/** The opponent you last picked per league ("": "—"; remembered for the account), or null while the account's record is not read. */
export type RememberedOpponents = Readonly<Record<string, string>> | null;
const NONE_REMEMBERED: RememberedOpponents = {};

/** The selected league's `league_matches` through the browser client, as the league overview reads them. */
async function readSchedule(leagueId: string): Promise<ScheduledMatch[]> {
  const { data, error } = await createClient().from("league_matches").select(NEXT_MATCH_SELECT).eq("league_id", leagueId);
  if (error) throw error;
  return parseScheduledMatches(data);
}

/**
 * Training's rosters with the default opponent: each time a league is entered (the rosters reset the picker to "—" there),
 * once its teams are loaded, the account's remembered picks are read and the Opponent picker is still "—", it selects the
 * opponent you last picked in that league, else your next scheduled opponent, else the league's only other coach
 * (next-opponent.ts defaultOpponent), as a reload would. Your own pick (through the returned selectOpponent, "—" included) is
 * never overridden while you stay in that league, and is what the default is next time ("—" stays "—"). The schedule is read
 * once per mount and league (kept for a league you come back to) and also gives `nextMatch`, the picker's "Next match".
 */
export function useNextOpponent(rosters: Rosters, remembered: RememberedOpponents = NONE_REMEMBERED, read: ScheduleReader = readSchedule): ScheduledRosters {
  const { state, selectOpponent } = rosters;
  const key = scheduleKey(state);
  const leagueId = key ? state.selectedLeagueId : null;
  /** The account and league ("user:league", "user:" for "—") while the rosters are ready (a refresh does not leave it). */
  const entry = state.status === "ready" ? `${state.userId ?? ""}:${state.selectedLeagueId}` : null;
  /** The schedule read per key (null: unreadable). */
  const [schedules, setSchedules] = useState<Readonly<Record<string, ScheduledMatch[] | null>>>({});
  /** Keys whose schedule was read or is being read this mount. */
  const requested = useRef(new Set<string>());
  /** The league entered last, and whether its default is decided (defaulted, left "—" or picked by you) since. */
  const entered = useRef<string | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    const keys = requested.current;
    if (!key || !leagueId || keys.has(key)) return;
    keys.add(key);
    let active = true;
    let settled = false;
    const keep = (matches: ScheduledMatch[] | null) => {
      settled = true;
      if (active) setSchedules((current) => ({ ...current, [key]: matches }));
    };
    read(leagueId).then(keep, () => keep(null));
    // Left (another league, unmounted) before it answered: read again when it comes back.
    return () => { active = false; if (!settled) keys.delete(key); };
  }, [key, leagueId, read]);

  const matches = key && key in schedules ? schedules[key] : undefined;
  useEffect(() => {
    if (entry !== null && entry !== entered.current) {
      entered.current = entry;
      decided.current = false;
    }
    if (!key || decided.current || !remembered || !teamsLoaded(state)) return;
    const opponent = defaultOpponent(state, remembered[state.selectedLeagueId] ?? null, matches);
    if (opponent === undefined) return;
    decided.current = true;
    if (opponent) selectOpponent(opponent);
  }, [entry, key, matches, state, remembered, selectOpponent]);

  const pick = useCallback((id: string) => {
    if (entry !== null) {
      entered.current = entry;
      decided.current = true;
    }
    selectOpponent(id);
  }, [entry, selectOpponent]);
  const nextMatch = useMemo(() => (matches ? nextMatchIn(state, matches) : null), [matches, state]);
  return { ...rosters, selectOpponent: pick, nextMatch };
}
