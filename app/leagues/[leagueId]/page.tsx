"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PokemonSprite from "@/app/components/PokemonSprite";
import { createClient } from "@/app/lib/supabase/client";

type DraftFormatJson = {
  pokemon?: unknown;
};

type League = {
  id: string;
  name: string;
  max_coaches: number;
  draft_started?: boolean | null;
  draft_completed?: boolean | null;
  current_pick_number?: number | null;
  draft_format?: {
    id: string;
    name: string;
    json: DraftFormatJson | null;
  } | null;
};

type LeagueMember = {
  id: string;
  team_name: string | null;
  role: string | null;
};

type LeagueInvite = {
  id: string;
  invite_code: string;
};

type LeagueNews = {
  id: string;
  news_type: string;
  message: string;
  metadata: {
    added?: string | null;
    dropped?: string | null;
  } | null;
  created_at: string;
};

export default function LeaguePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [invite, setInvite] = useState<LeagueInvite | null>(null);
  const [news, setNews] = useState<LeagueNews[]>([]);
  async function load() {
    const { data: leagueData } = await supabase
      .from("leagues")
      .select(`
        *,
        draft_format:draft_formats (
          id,
          name,
          json
        )
      `)
      .eq("id", leagueId)
      .single();

    setLeague(leagueData);

    const { data: memberData } = await supabase
      .from("league_members")
      .select("*")
      .eq("league_id", leagueId);

    setMembers(memberData ?? []);

    const { data: inviteData } = await supabase
      .from("league_invites")
      .select("*")
      .eq("league_id", leagueId)
      .limit(1)
      .single();

    setInvite(inviteData);

    const { data: newsData } = await supabase
      .from("league_news")
      .select("id, news_type, message, metadata, created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(20);

    setNews(newsData ?? []);
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inviteLink =
    invite && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${invite.invite_code}`
      : "";

  const pokemonCount =
    league?.draft_format?.json?.pokemon &&
    Array.isArray(league.draft_format.json.pokemon)
      ? league.draft_format.json.pokemon.length
      : null;

  return (
  <>
    <h1 className="text-4xl font-bold">{league?.name ?? "League"}</h1>

    <p className="mt-2 text-stone-400">
      Format: {league?.draft_format?.name ?? "No format selected"}
      {pokemonCount !== null ? ` • ${pokemonCount} Pokémon` : ""}
    </p>

    <section className="mt-6 rounded-lg border border-amber-900/40 bg-stone-900 p-5">
      <h2 className="text-xl font-semibold">Invite Link</h2>

      {inviteLink ? (
        <input
          readOnly
          value={inviteLink}
          className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />
      ) : (
        <p className="mt-3 text-stone-500">No invite found.</p>
      )}
    </section>

    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border border-emerald-900/40 bg-stone-900 p-5">
        <h2 className="text-xl font-semibold">
          Coaches {members.length}/{league?.max_coaches ?? "?"}
        </h2>

        <div className="mt-4 space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="rounded-lg border border-amber-900/30 bg-stone-950 p-3"
            >
              <p className="font-semibold">
                {member.team_name || "Unnamed Team"}
              </p>
              <p className="text-sm text-stone-500">{member.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-sky-900/40 bg-stone-900 p-5">
        <h2 className="text-xl font-semibold">League News</h2>

        <div className="mt-4 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
          {news.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-amber-900/30 bg-stone-950 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-xs font-medium capitalize text-emerald-200">
                  {item.news_type === "match_result"
                    ? "Match Result"
                    : "Free Agent"}
                </span>
                <time className="text-xs text-stone-500">
                  {new Date(item.created_at).toLocaleDateString()}
                </time>
              </div>
              {item.news_type === "free_agent" && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {item.metadata?.dropped && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-900/40 bg-stone-900 px-3 py-2">
                      <PokemonSprite name={item.metadata.dropped} size="sm" />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">
                          Dropped
                        </p>
                        <p className="text-sm font-semibold">
                          {item.metadata.dropped}
                        </p>
                      </div>
                    </div>
                  )}

                  {item.metadata?.added && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-900/40 bg-stone-900 px-3 py-2">
                      <PokemonSprite name={item.metadata.added} size="sm" />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                          Added
                        </p>
                        <p className="text-sm font-semibold">
                          {item.metadata.added}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p className="mt-3 text-sm text-stone-300">{item.message}</p>
            </article>
          ))}

          {news.length === 0 && (
            <p className="rounded-lg border border-amber-900/30 bg-stone-950 p-4 text-sm text-stone-500">
              No league news yet. Match results and free agent moves will appear
              here.
            </p>
          )}
        </div>
      </section>
    </div>
  </>
);
}
