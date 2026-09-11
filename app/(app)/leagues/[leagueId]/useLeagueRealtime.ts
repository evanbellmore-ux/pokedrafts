"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveStatus } from "./LiveStatusPill";

/** Tables in the `supabase_realtime` publication that carry a league id. */
export type LeagueRealtimeTable =
  | "leagues"
  | "league_members"
  | "league_matches"
  | "league_news"
  | "draft_picks"
  | "drafted_teams";

export type LeagueRealtimeOptions = {
  supabase: SupabaseClient;
  leagueId: string;
  /** Distinguishes channels when several pages of one league are open. */
  name: string;
  tables: readonly LeagueRealtimeTable[];
  /**
   * Called with the table whose rows changed. Called with `null` when the
   * channel comes back after a drop, so the page can refetch what it missed.
   */
  onChange: (table: LeagueRealtimeTable | null) => void;
};

/**
 * Every subscription gets a topic of its own. supabase-js hands back the
 * existing channel for a repeated topic, and React runs effects twice in
 * development, so a reused topic would attach to a channel that the first
 * cleanup is still tearing down and never report "Live".
 */
let channelSequence = 0;

/**
 * One realtime channel for a league page (docs/release-architecture.md
 * section 7): every listed table is watched with a league filter, the
 * status callback drives the Live / Reconnecting pill, and the channel is
 * removed on unmount. `onChange` always sees the latest render's closure.
 */
export function useLeagueRealtime({
  supabase,
  leagueId,
  name,
  tables,
  onChange,
}: LeagueRealtimeOptions): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handleChange = useEffectEvent(onChange);
  const tableKey = tables.join(",");

  useEffect(() => {
    let active = true;
    let wasLive = false;
    channelSequence += 1;
    let channel = supabase.channel(
      `league:${leagueId}:${name}:${channelSequence}`
    );

    for (const table of tableKey.split(",") as LeagueRealtimeTable[]) {
      const column = table === "leagues" ? "id" : "league_id";
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `${column}=eq.${leagueId}`,
        },
        () => {
          if (active) handleChange(table);
        }
      );
    }

    channel.subscribe((state) => {
      if (!active) return;
      if (state === "SUBSCRIBED") {
        setStatus("live");
        // Rows may have changed while the socket was down.
        if (wasLive) handleChange(null);
        wasLive = true;
      } else {
        setStatus("reconnecting");
      }
    });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, leagueId, name, tableKey]);

  return status;
}
