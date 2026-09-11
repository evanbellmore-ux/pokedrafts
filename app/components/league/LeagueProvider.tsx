"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { friendlyError } from "@/app/lib/errors";
import { isLeagueCommissioner } from "@/app/lib/league/permissions";
import { createClient } from "@/app/lib/supabase/client";
import type { League, LeagueMember, SessionUser } from "@/app/types/league";

export type LeagueContextValue = {
  league: League;
  /** The caller's own league_members row. */
  member: LeagueMember;
  user: SessionUser;
  isCommissioner: boolean;
  /** Re-reads the league and member rows; resolves to an error message or null. */
  refresh: () => Promise<string | null>;
  refreshing: boolean;
};

const LeagueContext = createContext<LeagueContextValue | null>(null);

export type LeagueProviderProps = {
  league: League;
  member: LeagueMember;
  user: SessionUser;
  children: ReactNode;
};

/**
 * Seeded by the server league layout (which already verified membership).
 * Client pages read the league and their own member row from `useLeague()`
 * instead of refetching them, and call `refresh()` after mutations.
 */
export function LeagueProvider({
  league: initialLeague,
  member: initialMember,
  user,
  children,
}: LeagueProviderProps) {
  const [league, setLeague] = useState(initialLeague);
  const [member, setMember] = useState(initialMember);
  const [seed, setSeed] = useState({ league: initialLeague, member: initialMember });
  const [refreshing, setRefreshing] = useState(false);

  // When the server re-renders the layout (router.refresh), adopt the new
  // rows. Done during render per the React "adjusting state on prop change"
  // guidance rather than in an effect.
  if (seed.league !== initialLeague || seed.member !== initialMember) {
    setSeed({ league: initialLeague, member: initialMember });
    setLeague(initialLeague);
    setMember(initialMember);
  }

  const leagueId = initialLeague.id;
  const userId = user.id;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const supabase = createClient();
      const [leagueResult, memberResult] = await Promise.all([
        supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle(),
        supabase
          .from("league_members")
          .select("*")
          .eq("league_id", leagueId)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      if (leagueResult.error) return friendlyError(leagueResult.error);
      if (memberResult.error) return friendlyError(memberResult.error);
      if (!leagueResult.data) return "This league no longer exists.";
      if (!memberResult.data) return "You are no longer a coach in this league.";

      setLeague(leagueResult.data as League);
      setMember(memberResult.data as LeagueMember);
      return null;
    } catch (caught) {
      return friendlyError(caught);
    } finally {
      setRefreshing(false);
    }
  }, [leagueId, userId]);

  const value = useMemo<LeagueContextValue>(
    () => ({
      league,
      member,
      user,
      isCommissioner: isLeagueCommissioner(league, user.id),
      refresh,
      refreshing,
    }),
    [league, member, user, refresh, refreshing]
  );

  return (
    <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>
  );
}

export function useLeague(): LeagueContextValue {
  const value = useContext(LeagueContext);
  if (!value) {
    throw new Error("useLeague must be used inside a league layout");
  }
  return value;
}

/** Like useLeague, but returns null outside a league layout. */
export function useOptionalLeague(): LeagueContextValue | null {
  return useContext(LeagueContext);
}
