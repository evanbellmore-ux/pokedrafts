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
  commissioner_id: string | null;
  draft_started?: boolean | null;
  draft_completed?: boolean | null;
  current_pick_number?: number | null;
  custom_pool?: DraftFormatJson | null;
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
  member_id: string | null;
  news_type: string;
  message: string;
  metadata: {
    added?: string | null;
    dropped?: string | null;
    team_id?: string | null;
    before_pokemon?: unknown;
    previous_free_agent_swaps_used?: number | null;
  } | null;
  created_at: string;
};

type Pokemon = {
  name: string;
  points: number;
  tier: number;
};

type DraftedPokemon = Pokemon & {
  pick_number: number;
};

type DraftedTeamRow = {
  id: string;
  member_id: string;
  pokemon: unknown;
};

type LeagueMemberRow = LeagueMember & {
  user_id: string;
  free_agent_swaps_used: number | null;
};

function isPokemon(value: unknown): value is Pokemon {
  const pokemon = value as Pokemon;

  return (
    typeof pokemon?.name === "string" &&
    typeof pokemon?.points === "number" &&
    typeof pokemon?.tier === "number"
  );
}

function isDraftedPokemon(value: unknown): value is DraftedPokemon {
  const pokemon = value as DraftedPokemon;

  return isPokemon(value) && typeof pokemon.pick_number === "number";
}

export default function LeaguePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [invite, setInvite] = useState<LeagueInvite | null>(null);
  const [news, setNews] = useState<LeagueNews[]>([]);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [undoingNewsId, setUndoingNewsId] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

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
    setIsCommissioner(Boolean(user && leagueData?.commissioner_id === user.id));

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
      .select("id, member_id, news_type, message, metadata, created_at")
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
  const rawPokemonPool =
    league?.custom_pool?.pokemon ?? league?.draft_format?.json?.pokemon ?? [];
  const pokemonPool = Array.isArray(rawPokemonPool)
    ? rawPokemonPool.filter(isPokemon)
    : [];

  const latestFreeAgentNewsByMember = new Map<string, string>();

  for (const item of news) {
    if (
      item.news_type === "free_agent" &&
      item.member_id &&
      !latestFreeAgentNewsByMember.has(item.member_id)
    ) {
      latestFreeAgentNewsByMember.set(item.member_id, item.id);
    }
  }

  async function undoFreeAgentMove(item: LeagueNews) {
    if (!isCommissioner) {
      setMessage("Only the commissioner can undo free agent moves.");
      return;
    }

    if (item.news_type !== "free_agent" || !item.member_id) {
      setMessage("That news item cannot be undone.");
      return;
    }

    if (latestFreeAgentNewsByMember.get(item.member_id) !== item.id) {
      setMessage("Only the latest free agent move for a team can be undone.");
      return;
    }

    setUndoingNewsId(item.id);
    setMessage("");

    const { data: teamData, error: teamError } = await supabase
      .from("drafted_teams")
      .select("id, member_id, pokemon")
      .eq("league_id", leagueId)
      .eq("member_id", item.member_id)
      .single();

    if (teamError || !teamData) {
      setMessage(teamError?.message ?? "Could not find that team's roster.");
      setUndoingNewsId("");
      return;
    }

    const team = teamData as DraftedTeamRow;
    const currentPokemon = Array.isArray(team.pokemon)
      ? team.pokemon.filter(isDraftedPokemon)
      : [];
    const metadata = item.metadata ?? {};
    const beforePokemon = Array.isArray(metadata.before_pokemon)
      ? metadata.before_pokemon.filter(isDraftedPokemon)
      : null;
    const addedPokemon = metadata.added
      ? currentPokemon.find((pokemon) => pokemon.name === metadata.added)
      : null;

    let nextPokemon = beforePokemon;

    if (!nextPokemon) {
      if (!metadata.added || !addedPokemon) {
        setMessage("That move cannot be undone from the available news data.");
        setUndoingNewsId("");
        return;
      }

      const droppedPokemon = metadata.dropped
        ? pokemonPool.find((pokemon) => pokemon.name === metadata.dropped)
        : null;

      if (metadata.dropped && !droppedPokemon) {
        setMessage("That move cannot be undone from the available news data.");
        setUndoingNewsId("");
        return;
      }

      nextPokemon = metadata.dropped
        ? currentPokemon.map((pokemon) =>
            pokemon.name === metadata.added
              ? {
                  ...(droppedPokemon ?? pokemon),
                  pick_number: pokemon.pick_number,
                }
              : pokemon
          )
        : currentPokemon.filter((pokemon) => pokemon.name !== metadata.added);
    }

    const nextTotal = nextPokemon.reduce(
      (total, pokemon) => total + pokemon.points,
      0
    );

    const { error: rosterError } = await supabase
      .from("drafted_teams")
      .update({
        pokemon: nextPokemon,
        total_points: nextTotal,
      })
      .eq("id", team.id)
      .eq("league_id", leagueId);

    if (rosterError) {
      setMessage(`Could not restore team: ${rosterError.message}`);
      setUndoingNewsId("");
      return;
    }

    const { data: memberData, error: memberError } = await supabase
      .from("league_members")
      .select("id, free_agent_swaps_used")
      .eq("id", item.member_id)
      .eq("league_id", leagueId)
      .single();

    if (memberError || !memberData) {
      setMessage(memberError?.message ?? "Team restored, but swap count failed.");
      setUndoingNewsId("");
      return;
    }

    const member = memberData as LeagueMemberRow;
    const currentSwapsUsed = member.free_agent_swaps_used ?? 0;
    const nextSwapsUsed =
      typeof metadata.previous_free_agent_swaps_used === "number"
        ? metadata.previous_free_agent_swaps_used
        : Math.max(0, currentSwapsUsed - 1);

    const { error: swapError } = await supabase
      .from("league_members")
      .update({ free_agent_swaps_used: nextSwapsUsed })
      .eq("id", item.member_id)
      .eq("league_id", leagueId);

    if (swapError) {
      setMessage(`Team restored, but swap count failed: ${swapError.message}`);
      setUndoingNewsId("");
      return;
    }

    const { error: deleteError } = await supabase
      .from("league_news")
      .delete()
      .eq("id", item.id)
      .eq("league_id", leagueId)
      .eq("news_type", "free_agent");

    if (deleteError) {
      setMessage(`Move undone, but news removal failed: ${deleteError.message}`);
      setUndoingNewsId("");
      return;
    }

    setUndoingNewsId("");
    await load();
    setMessage("Free agent move undone.");
  }

  return (
  <>
    <h1 className="text-4xl font-bold">{league?.name ?? "League"}</h1>

    <p className="mt-2 text-stone-400">
      Format: {league?.draft_format?.name ?? "No format selected"}
      {pokemonCount !== null ? ` • ${pokemonCount} Pokémon` : ""}
    </p>

    {message && (
      <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
        {message}
      </p>
    )}

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
              {isCommissioner &&
                item.news_type === "free_agent" &&
                item.member_id &&
                latestFreeAgentNewsByMember.get(item.member_id) === item.id && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => undoFreeAgentMove(item)}
                      disabled={undoingNewsId === item.id}
                      className="rounded-lg border border-red-900/60 px-3 py-2 text-sm font-semibold text-red-200 hover:border-red-700 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {undoingNewsId === item.id ? "Undoing..." : "Undo Move"}
                    </button>
                  </div>
                )}
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
