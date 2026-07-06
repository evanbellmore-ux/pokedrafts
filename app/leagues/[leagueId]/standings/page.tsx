"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type LeagueMember = {
  id: string;
  team_name: string | null;
  draft_position: number | null;
};

type LeagueMatch = {
  id: string;
  home_member_id: string;
  away_member_id: string;
  status: string | null;
  winner_member_id: string | null;
};

type Standing = {
  member: LeagueMember;
  wins: number;
  losses: number;
  played: number;
  remaining: number;
  winPercentage: number;
};

export default function StandingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [message, setMessage] = useState("");

  async function loadStandings() {
    setMessage("");

    const { data: memberData, error: memberError } = await supabase
      .from("league_members")
      .select("id, team_name, draft_position")
      .eq("league_id", leagueId)
      .order("draft_position", { ascending: true, nullsFirst: false })
      .order("team_name", { ascending: true });

    if (memberError) {
      setMessage(memberError.message);
      return;
    }

    const { data: matchData, error: matchError } = await supabase
      .from("league_matches")
      .select("id, home_member_id, away_member_id, status, winner_member_id")
      .eq("league_id", leagueId);

    if (matchError) {
      setMessage(matchError.message);
      return;
    }

    setMembers(memberData ?? []);
    setMatches(matchData ?? []);
  }

  useEffect(() => {
    void Promise.resolve().then(loadStandings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const standings = useMemo<Standing[]>(() => {
    const records = new Map<string, Standing>();

    for (const member of members) {
      records.set(member.id, {
        member,
        wins: 0,
        losses: 0,
        played: 0,
        remaining: 0,
        winPercentage: 0,
      });
    }

    for (const match of matches) {
      const home = records.get(match.home_member_id);
      const away = records.get(match.away_member_id);

      if (!home || !away) continue;

      if (match.status === "completed" && match.winner_member_id) {
        home.played += 1;
        away.played += 1;

        if (match.winner_member_id === match.home_member_id) {
          home.wins += 1;
          away.losses += 1;
        } else if (match.winner_member_id === match.away_member_id) {
          away.wins += 1;
          home.losses += 1;
        }
      } else {
        home.remaining += 1;
        away.remaining += 1;
      }
    }

    return [...records.values()]
      .map((standing) => ({
        ...standing,
        winPercentage:
          standing.played > 0 ? standing.wins / standing.played : 0,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        if (b.winPercentage !== a.winPercentage) {
          return b.winPercentage - a.winPercentage;
        }
        return (a.member.team_name ?? "").localeCompare(
          b.member.team_name ?? ""
        );
      });
  }, [matches, members]);

  return (
    <>
      <h1 className="text-4xl font-bold">Standings</h1>
      <p className="mt-2 text-stone-400">
        Current records based on reported match results.
      </p>

      {message && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-sm text-stone-300">
          {message}
        </p>
      )}

      <section className="mt-6 overflow-hidden rounded-lg border border-amber-900/40 bg-stone-900">
        <table className="w-full">
          <thead className="bg-stone-950 text-sm text-stone-400">
            <tr>
              <th className="p-3 text-left">Rank</th>
              <th className="p-3 text-left">Team</th>
              <th className="p-3 text-left">W</th>
              <th className="p-3 text-left">L</th>
              <th className="p-3 text-left">Pct</th>
              <th className="p-3 text-left">Remaining</th>
            </tr>
          </thead>

          <tbody>
            {standings.map((standing, index) => (
              <tr
                key={standing.member.id}
                className="border-t border-amber-900/25"
              >
                <td className="p-3 font-semibold">#{index + 1}</td>
                <td className="p-3">
                  <p className="font-semibold">
                    {standing.member.team_name || "Unnamed Team"}
                  </p>
                </td>
                <td className="p-3">{standing.wins}</td>
                <td className="p-3">{standing.losses}</td>
                <td className="p-3">
                  {standing.played > 0
                    ? standing.winPercentage.toFixed(3).replace(/^0/, "")
                    : "-"}
                </td>
                <td className="p-3">{standing.remaining}</td>
              </tr>
            ))}

            {standings.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-stone-500">
                  No teams found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
