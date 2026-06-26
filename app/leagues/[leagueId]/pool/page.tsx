"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import PokemonSprite from "@/app/components/PokemonSprite";


type PoolPokemon = {
  name: string;
  points: number;
  tier: number;
};

function pointsToTier(points: number) {
  return 21 - points;
}

export default function PoolPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<any>(null);
  const [pokemon, setPokemon] = useState<PoolPokemon[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isCommissioner, setIsCommissioner] = useState(false);

  useEffect(() => {
    loadPool();
  }, []);

  async function loadPool() {
    setMessage("");

    const { data, error } = await supabase
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

    if (error) {
      setMessage(error.message);
      return;
    }

    setLeague(data);
const {
  data: { user },
} = await supabase.auth.getUser();

if (user) {
  const { data: member } = await supabase
    .from("league_members")
    .select("role")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();

  setIsCommissioner(member?.role === "commissioner");
}
    const pool =
      data?.custom_pool?.pokemon ??
      data?.draft_format?.json?.pokemon ??
      [];

    setPokemon(Array.isArray(pool) ? pool : []);
  }

  function updatePoints(index: number, value: number) {
    const points = Math.min(20, Math.max(1, Number(value) || 1));

    setPokemon((prev) =>
      prev.map((mon, i) =>
        i === index
          ? {
              ...mon,
              points,
              tier: pointsToTier(points),
            }
          : mon
      )
    );
  }

  async function saveLeaguePool() {
    setSaving(true);
    setMessage("");

    const customPool = {
      version: league?.draft_format?.json?.version ?? "1.0",
      leagueName:
        league?.draft_format?.json?.leagueName ??
        league?.draft_format?.name ??
        "Custom League Pool",
      pokemon,
    };

    const { error } = await supabase
      .from("leagues")
      .update({ custom_pool: customPool })
      .eq("id", leagueId);

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    setEditing(false);
    setSaving(false);
    setMessage("League pool saved.");
    await loadPool();
  }

  function cancelEditing() {
    setEditing(false);
    loadPool();
  }

 const filtered = pokemon
  .map((mon, index) => ({ mon, index }))
  .filter(({ mon }) =>
    mon.name.toLowerCase().includes(search.toLowerCase())
  )
  .sort((a, b) => {
    if (b.mon.points !== a.mon.points) {
      return b.mon.points - a.mon.points;
    }

    return a.mon.name.localeCompare(b.mon.name);
  });
  return (
    <>
      <div className="flex gap-3">
  {isCommissioner ? (
    !editing ? (
      <button
        onClick={() => setEditing(true)}
        className="rounded-lg border border-amber-800/50 bg-stone-900 px-5 py-3 font-semibold text-stone-200 hover:bg-stone-800"
      >
        Edit Points
      </button>
    ) : (
      <>
        <button
          onClick={cancelEditing}
          disabled={saving}
          className="rounded-lg border border-stone-700 bg-stone-900 px-5 py-3 font-semibold hover:bg-stone-800 disabled:opacity-50"
        >
          Cancel
        </button>

        <button
          onClick={saveLeaguePool}
          disabled={saving}
          className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save League Pool"}
        </button>
      </>
    )
  ) : (
    <p className="flex items-center text-sm text-stone-500">
      Only the commissioner can edit points.
    </p>
  )}
</div>
      

      {message && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
          {message}
        </p>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search Pokémon..."
        className="mt-6 w-full rounded-lg border border-stone-700 bg-stone-900 p-3"
      />

      <div className="mt-6 overflow-hidden rounded-lg border border-amber-900/40 bg-stone-900">
        <table className="w-full">
          <thead className="bg-stone-950">
            <tr>
              <th className="p-3 text-left">Pokemon</th>
              <th className="p-3 text-left">Points</th>
              <th className="p-3 text-left">Tier</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(({ mon, index }) => (
              <tr key={mon.name} className="border-t border-amber-900/25">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <PokemonSprite name={mon.name} />
                    <span className="font-semibold">{mon.name}</span>
                  </div>
                </td>

                <td className="p-3">
                  {editing ? (
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={mon.points}
                      onChange={(e) =>
                        updatePoints(index, Number(e.target.value))
                      }
                      className="w-24 rounded-lg border border-stone-700 bg-stone-950 p-2"
                    />
                  ) : (
                    mon.points
                  )}
                </td>

                <td className="p-3">{mon.tier}</td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-stone-500">
                  No Pokémon found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
