"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import PokemonSprite from "@/app/components/PokemonSprite";

export default function PoolPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<any>(null);
  const [pokemon, setPokemon] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadPool();
  }, []);

  async function loadPool() {
    const { data } = await supabase
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

    setLeague(data);

    const pool = data?.draft_format?.json?.pokemon ?? [];
    setPokemon(pool);
  }

  const filtered = pokemon.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
  <>
    <h1 className="text-4xl font-bold">
      {league?.draft_format?.name ?? "Pokemon Pool"}
    </h1>

    <p className="mt-2 text-zinc-400">
      {pokemon.length} Pokémon
    </p>

    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search Pokémon..."
      className="mt-6 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3"
    />

    <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      <table className="w-full">
        <thead className="bg-zinc-950">
          <tr>
            <th className="p-3 text-left">Pokemon</th>
            <th className="p-3 text-left">Points</th>
            <th className="p-3 text-left">Tier</th>
          </tr>
        </thead>

        <tbody>
          {filtered.map((pokemon) => (
            <tr
              key={pokemon.name}
              className="border-t border-zinc-800"
            >
              <td className="p-3">
  <div className="flex items-center gap-3">
    <PokemonSprite name={pokemon.name} />
    <span className="font-semibold">{pokemon.name}</span>
  </div>
</td>
              <td className="p-3">{pokemon.points}</td>
              <td className="p-3">{pokemon.tier}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);
}