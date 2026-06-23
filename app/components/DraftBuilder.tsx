"use client";

import { useMemo, useState } from "react";
import type { DraftFormat } from "@/app/types/draft";
import { pointsToTier } from "@/app/types/draft";

const emptyFormat: DraftFormat = {
  version: "1.0",
  leagueName: "Untitled Draft League",
  pokemon: [],
};

export default function DraftBuilder() {
  const [format, setFormat] = useState<DraftFormat>(emptyFormat);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();

    format.pokemon.forEach((pokemon) => {
      const key = pokemon.name.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );
  }, [format.pokemon]);

  const filteredPokemon = format.pokemon
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon }) =>
      pokemon.name.toLowerCase().includes(search.toLowerCase())
    );

  function updatePokemon(index: number, name: string, points: number) {
    setFormat((prev) => {
      const nextPokemon = [...prev.pokemon];

      nextPokemon[index] = {
        name,
        points,
        tier: pointsToTier(points),
      };

      return {
        ...prev,
        pokemon: nextPokemon,
      };
    });
  }

  function deletePokemon(index: number) {
    setFormat((prev) => ({
      ...prev,
      pokemon: prev.pokemon.filter((_, i) => i !== index),
    }));
  }

  function addPokemon() {
    const name = newName.trim();
    if (!name) return;

    setFormat((prev) => ({
      ...prev,
      pokemon: [
        ...prev.pokemon,
        {
          name,
          points: 1,
          tier: 20,
        },
      ],
    }));

    setNewName("");
  }

  function handleUpload(file: File) {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        if (!Array.isArray(parsed.pokemon)) {
          alert("Invalid JSON: missing pokemon array.");
          return;
        }

        const cleaned: DraftFormat = {
          version: parsed.version ?? "1.0",
          leagueName: parsed.leagueName ?? "Untitled Draft League",
          pokemon: parsed.pokemon.map((pokemon: any) => {
            const points = Math.min(20, Math.max(1, Number(pokemon.points) || 1));

            return {
              name: String(pokemon.name),
              points,
              tier: pointsToTier(points),
            };
          }),
        };

        setFormat(cleaned);
      } catch {
        alert("Could not read that JSON file.");
      }
    };

    reader.readAsText(file);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(format, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${format.leagueName
      .toLowerCase()
      .replaceAll(" ", "-")}-pool.json`;

    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">PokeDrafts Builder</h1>
            <p className="mt-2 text-zinc-400">
              Upload, edit, and export Pokémon draft pools.
            </p>
          </div>

          <button
            onClick={exportJson}
            className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Export JSON
          </button>
        </header>

        <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <label className="block text-sm font-medium text-zinc-300">
            Upload draft pool JSON
          </label>

          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            className="mt-3 block w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-200"
          />
        </section>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <input
            value={format.leagueName}
            onChange={(e) =>
              setFormat((prev) => ({
                ...prev,
                leagueName: e.target.value,
              }))
            }
            className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Pokémon..."
            className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"
          />

          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add Pokémon..."
              className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 p-3"
            />

            <button
              onClick={addPokemon}
              className="rounded-xl bg-zinc-100 px-4 font-semibold text-zinc-950 hover:bg-white"
            >
              Add
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 p-4 text-sm text-zinc-400">
            {format.pokemon.length} Pokémon total
            {duplicateNames.size > 0 && (
              <span className="ml-4 text-amber-400">
                {duplicateNames.size} duplicate warning
                {duplicateNames.size > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <table className="w-full border-collapse text-left">
            <thead className="bg-zinc-950 text-sm text-zinc-400">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Points</th>
                <th className="p-3">Tier</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredPokemon.map(({ pokemon, index }) => {
                const isDuplicate = duplicateNames.has(
                  pokemon.name.trim().toLowerCase()
                );

                return (
                  <tr key={`${pokemon.name}-${index}`} className="border-t border-zinc-800">
                    <td className="p-3">
                      <input
                        value={pokemon.name}
                        onChange={(e) =>
                          updatePokemon(index, e.target.value, pokemon.points)
                        }
                        className={`w-full rounded-lg border bg-zinc-950 p-2 ${
                          isDuplicate
                            ? "border-amber-500 text-amber-300"
                            : "border-zinc-700"
                        }`}
                      />
                    </td>

                    <td className="p-3">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={pokemon.points}
                        onChange={(e) => {
                          const points = Math.min(
                            20,
                            Math.max(1, Number(e.target.value))
                          );

                          updatePokemon(index, pokemon.name, points);
                        }}
                        className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 p-2"
                      />
                    </td>

                    <td className="p-3">Tier {pokemon.tier}</td>

                    <td className="p-3 text-right">
                      <button
                        onClick={() => deletePokemon(index)}
                        className="rounded-lg bg-red-500/15 px-3 py-2 text-red-300 hover:bg-red-500/25"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredPokemon.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">
                    No Pokémon found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}