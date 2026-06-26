"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type ScheduleFormat = "round_robin" | "double_round_robin";

type LeagueMember = {
  id: string;
  team_name: string | null;
  role: string | null;
  draft_position: number | null;
  user_id: string;
};

type LeagueMatch = {
  id: string;
  round_number: number;
  match_number: number;
  home_member_id: string;
  away_member_id: string;
  status: string;
  winner_member_id: string | null;
  scheduled_at: string | null;
};

function getTeamName(members: LeagueMember[], memberId: string) {
  return members.find((member) => member.id === memberId)?.team_name ?? "Unnamed Team";
}

function shuffleMembers(members: LeagueMember[]) {
  return [...members].sort(() => Math.random() - 0.5);
}

function generateRoundRobin(members: LeagueMember[]) {
  const teams = [...members];

  if (teams.length % 2 === 1) {
    teams.push({
      id: "bye",
      team_name: "Bye",
      role: null,
      draft_position: null,
      user_id: "bye",
    });
  }

  const rounds: { home_member_id: string; away_member_id: string }[][] = [];
  const rotating = [...teams];

  for (let round = 0; round < teams.length - 1; round++) {
    const matches: { home_member_id: string; away_member_id: string }[] = [];

    for (let i = 0; i < teams.length / 2; i++) {
      const home = rotating[i];
      const away = rotating[teams.length - 1 - i];

      if (home.id !== "bye" && away.id !== "bye") {
        matches.push({
          home_member_id: round % 2 === 0 ? home.id : away.id,
          away_member_id: round % 2 === 0 ? away.id : home.id,
        });
      }
    }

    rounds.push(matches);

    const fixed = rotating[0];
    const rest = rotating.slice(1);
    rest.unshift(rest.pop()!);
    rotating.splice(0, rotating.length, fixed, ...rest);
  }

  return rounds;
}

function flattenSchedule(
  leagueId: string,
  rounds: { home_member_id: string; away_member_id: string }[][]
) {
  return rounds.flatMap((round, roundIndex) =>
    round.map((match, matchIndex) => ({
      league_id: leagueId,
      round_number: roundIndex + 1,
      match_number: matchIndex + 1,
      home_member_id: match.home_member_id,
      away_member_id: match.away_member_id,
      status: "upcoming",
    }))
  );
}

export default function MatchesPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [format, setFormat] = useState<ScheduleFormat>("round_robin");
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMatches();
  }, []);

  async function loadMatches() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: league } = await supabase
      .from("leagues")
      .select("commissioner_id")
      .eq("id", leagueId)
      .single();

    setIsCommissioner(Boolean(user && league?.commissioner_id === user.id));

    const { data: memberData, error: memberError } = await supabase
      .from("league_members")
      .select("id, team_name, role, draft_position, user_id")
      .eq("league_id", leagueId)
      .order("draft_position", { ascending: true, nullsFirst: false })
      .order("team_name", { ascending: true });

    if (memberError) {
      setMessage(memberError.message);
      return;
    }

    const { data: matchData, error: matchError } = await supabase
      .from("league_matches")
      .select("*")
      .eq("league_id", leagueId)
      .order("round_number", { ascending: true })
      .order("match_number", { ascending: true });

    if (matchError) {
      setMessage(matchError.message);
      return;
    }

    setMembers(memberData ?? []);
    setMatches(matchData ?? []);
  }

  async function generateSchedule() {
    setSaving(true);
    setMessage("");

    const playableMembers = members.filter((member) => member.id !== "bye");

    if (playableMembers.length < 2) {
      setMessage("You need at least 2 teams to generate matches.");
      setSaving(false);
      return;
    }

    const orderedMembers = randomizeOrder
      ? shuffleMembers(playableMembers)
      : playableMembers;

    const firstRoundRobin = generateRoundRobin(orderedMembers);

    const schedule =
      format === "double_round_robin"
        ? [
            ...firstRoundRobin,
            ...firstRoundRobin.map((round) =>
              round.map((match) => ({
                home_member_id: match.away_member_id,
                away_member_id: match.home_member_id,
              }))
            ),
          ]
        : firstRoundRobin;

    const rows = flattenSchedule(leagueId, schedule);

    const { error: deleteError } = await supabase
      .from("league_matches")
      .delete()
      .eq("league_id", leagueId);

    if (deleteError) {
      setMessage(deleteError.message);
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("league_matches")
      .insert(rows);

    if (insertError) {
      setMessage(insertError.message);
      setSaving(false);
      return;
    }

    setMessage("Match schedule generated.");
    setSaving(false);
    await loadMatches();
  }

  const matchesByRound = useMemo(() => {
    return matches.reduce<Record<number, LeagueMatch[]>>((acc, match) => {
      if (!acc[match.round_number]) {
        acc[match.round_number] = [];
      }

      acc[match.round_number].push(match);
      return acc;
    }, {});
  }, [matches]);

  return (
    <>
      <h1 className="text-4xl font-bold">Matches</h1>

      <p className="mt-2 text-zinc-400">
        Generate upcoming matchups for every team in this league.
      </p>

      {isCommissioner && (
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-xl font-semibold">Generate Schedule</h2>

          <label className="mt-5 block text-sm font-medium text-zinc-300">
            Format
          </label>

          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ScheduleFormat)}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
          >
            <option value="round_robin">Round Robin</option>
            <option value="double_round_robin">Double Round Robin</option>
          </select>

          <label className="mt-5 flex items-center gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={randomizeOrder}
              onChange={(e) => setRandomizeOrder(e.target.checked)}
            />
            Randomize team order before generating
          </label>

          <button
            onClick={generateSchedule}
            disabled={saving}
            className="mt-5 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {saving ? "Generating..." : "Generate Matchups"}
          </button>

          {matches.length > 0 && (
            <p className="mt-3 text-sm text-yellow-300">
              Generating again will replace the current match schedule.
            </p>
          )}
        </section>
      )}

      {message && (
        <p className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
          {message}
        </p>
      )}

      <section className="mt-6 space-y-6">
        {Object.entries(matchesByRound).map(([roundNumber, roundMatches]) => (
          <div
            key={roundNumber}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <h2 className="text-xl font-semibold">Round {roundNumber}</h2>

            <div className="mt-4 space-y-3">
              {roundMatches.map((match) => (
                <div
                  key={match.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                >
                  <p className="font-semibold">
                    {getTeamName(members, match.home_member_id)}
                    <span className="mx-3 text-zinc-500">vs</span>
                    {getTeamName(members, match.away_member_id)}
                  </p>

                  <p className="mt-1 text-sm text-zinc-500">
                    Match {match.match_number} • {match.status}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {matches.length === 0 && (
          <p className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-zinc-500">
            No matches generated yet.
          </p>
        )}
      </section>
    </>
  );
}