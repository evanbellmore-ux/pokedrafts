"use client";

import { useEffect, useMemo, useState } from "react";
import type { DraftFormat } from "@/app/types/draft";
import { pointsToTier } from "@/app/types/draft";
import { createClient } from "@/app/lib/supabase/client";

type DexEntry = {
  dex_number: number;
  name: string;
  sprite_url: string | null;
};

const emptyFormat: DraftFormat = {
  version: "1.0",
  leagueName: "Untitled Draft League",
  pokemon: [],
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[.\s-]/g, "");
}



function toPokeApiSlug(name: string) {
  const clean = name.trim();
  const lower = clean.toLowerCase().replace(/\s+/g, " ");

  if (lower === "paldean tauros") return "tauros-paldea-combat-breed";
  if (lower === "paldean tauros blaze") return "tauros-paldea-blaze-breed";
  if (lower === "paldean tauros aqua") return "tauros-paldea-aqua-breed";

  const regions: Record<string, string> = {
    alolan: "alola",
    alola: "alola",
    galarian: "galar",
    galar: "galar",
    hisuian: "hisui",
    hisui: "hisui",
    paldean: "paldea",
    paldea: "paldea",
  };

  for (const [inputRegion, apiRegion] of Object.entries(regions)) {
    if (lower.startsWith(`${inputRegion} `)) {
      const base = lower.slice(inputRegion.length + 1).replace(/\s+/g, "-");
      return `${base}-${apiRegion}`;
    }

    if (lower.endsWith(`-${inputRegion}`)) {
      const base = lower.slice(0, -1 * (`-${inputRegion}`.length));
      return `${base}-${apiRegion}`;
    }
  }

  if (lower.startsWith("mega ")) {
    const base = lower.replace("mega ", "").replace(/\s+/g, "-");

    if (base.endsWith("-x")) return base.replace(/-x$/, "-mega-x");
    if (base.endsWith("-y")) return base.replace(/-y$/, "-mega-y");

    return `${base}-mega`;
  }

  return lower.replace(/\s+/g, "-");
}

export default function DraftBuilder() {
  const supabase = createClient();

  const [format, setFormat] = useState<DraftFormat>(emptyFormat);
  const [dexEntries, setDexEntries] = useState<DexEntry[]>([]);
  const [pokeApiSprites, setPokeApiSprites] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  
  async function loadDex() {
    const first = await supabase
      .from("pokemon_dex")
      .select("dex_number, name, sprite_url")
      .order("dex_number", { ascending: true })
      .range(0, 999);

    const second = await supabase
      .from("pokemon_dex")
      .select("dex_number, name, sprite_url")
      .order("dex_number", { ascending: true })
      .range(1000, 1024);

    if (first.error) {
      console.error("First dex query failed:", first.error.message);
      return;
    }

    if (second.error) {
      console.error("Second dex query failed:", second.error.message);
      return;
    }

    const combined = [...(first.data ?? []), ...(second.data ?? [])];

    console.log("dex entries loaded", combined.length);

    setDexEntries(combined);
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadDex());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

async function saveFormat() {
  setSaving(true);
  setSaveMessage("");

  const { error } = await supabase.from("draft_formats").insert({
    name: format.leagueName,
    json: format,
  });

  if (error) {
    setSaveMessage(error.message);
  } else {
    setSaveMessage("Format saved.");
  }

  setSaving(false);
}

  async function fetchPokeApiSprite(pokemonName: string) {
    const normalized = normalizeName(pokemonName);

    if (pokeApiSprites[normalized]) return;

    const slug = toPokeApiSlug(pokemonName);

    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);

      if (!res.ok) {
        console.log("PokeAPI sprite not found:", pokemonName, slug);
        return;
      }

      const data = await res.json();

      const spriteUrl =
        data.sprites?.front_default ??
        data.sprites?.other?.["official-artwork"]?.front_default ??
        null;

      if (!spriteUrl) {
        console.log("PokeAPI has no sprite:", pokemonName, slug);
        return;
      }

      setPokeApiSprites((prev) => ({
        ...prev,
        [normalized]: spriteUrl,
      }));
    } catch (error) {
      console.error("PokeAPI fetch failed:", pokemonName, error);
    }
  }

  const dexByName = useMemo(() => {
    const map = new Map<string, DexEntry>();

    for (const entry of dexEntries) {
      map.set(normalizeName(entry.name), entry);
    }

    return map;
  }, [dexEntries]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();

    format.pokemon.forEach((pokemon) => {
      const key = normalizeName(pokemon.name);
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

  useEffect(() => {
    if (!dexEntries.length || !format.pokemon.length) return;

    const missing = format.pokemon.filter((pokemon) => {
      const normalizedName = normalizeName(pokemon.name);
      return !dexByName.get(normalizedName);
    });

    const uniqueMissing = Array.from(
      new Set(missing.map((pokemon) => pokemon.name))
    );

    console.log("Missing local sprites:", uniqueMissing);

    uniqueMissing.forEach((name) => {
      fetchPokeApiSprite(name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format.pokemon, dexEntries, dexByName]);

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

 async function addPokemon() {
  const rawName = newName.trim();
  if (!rawName) return;

  const finalName = toPokeApiSlug(rawName);

  const res = await fetch(
    `https://pokeapi.co/api/v2/pokemon/${finalName}`
  );

  if (!res.ok) {
    alert(`Could not find Pokémon: ${rawName}`);
    return;
  }

  setFormat((prev) => ({
    ...prev,
    pokemon: [
      ...prev.pokemon,
      {
        name: finalName,
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
          pokemon: parsed.pokemon.map((pokemon: { name?: unknown; points?: unknown }) => {
            const points = Math.min(
              20,
              Math.max(1, Number(pokemon.points) || 1)
            );

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
    <main className="min-h-screen bg-stone-950 p-6 text-stone-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">PokeDrafts Builder</h1>
            <p className="mt-2 text-stone-400">
              Upload, edit, and export Pokémon draft pools.
            </p>
          </div>
<button
  onClick={saveFormat}
  disabled={saving || format.pokemon.length === 0}
  className="rounded-lg border border-sky-800/60 bg-sky-950/50 px-5 py-3 font-semibold text-sky-200 hover:bg-sky-900/60 disabled:opacity-50"
>
  {saving ? "Saving..." : "Save Format"}
</button>
          <button
            onClick={exportJson}
            className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
          >
            Export JSON
          </button>
        </header>

        {saveMessage && (
          <p className="mb-6 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-sm text-stone-300">
            {saveMessage}
          </p>
        )}

        <section className="mb-6 rounded-lg border border-amber-900/40 bg-stone-900 p-5">
          <label className="block text-sm font-medium text-stone-300">
            Upload draft pool JSON
          </label>

          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            className="mt-3 block w-full rounded-lg border border-stone-700 bg-stone-950 p-3 text-stone-200"
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
            className="rounded-lg border border-stone-700 bg-stone-900 p-3"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Pokémon..."
            className="rounded-lg border border-stone-700 bg-stone-900 p-3"
          />

          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add Pokémon..."
              className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-900 p-3"
            />

            <button
              onClick={addPokemon}
              className="rounded-lg border border-amber-800/50 bg-stone-900 px-4 font-semibold text-amber-200 hover:bg-stone-800"
            >
              Add
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-amber-900/40 bg-stone-900">
          <div className="border-b border-amber-900/30 p-4 text-sm text-stone-400">
            {format.pokemon.length} Pokémon total
            {duplicateNames.size > 0 && (
              <span className="ml-4 text-amber-300">
                {duplicateNames.size} duplicate warning
                {duplicateNames.size > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <table className="w-full border-collapse text-left">
            <thead className="bg-stone-950 text-sm text-stone-400">
              <tr>
                <th className="p-3">Pokémon</th>
                <th className="p-3">Points</th>
                <th className="p-3">Tier</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredPokemon.map(({ pokemon, index }) => {
                const normalizedName = normalizeName(pokemon.name);
                const isDuplicate = duplicateNames.has(normalizedName);

                const dexEntry = dexByName.get(normalizedName);
                const spriteUrl =
                  dexEntry?.sprite_url ?? pokeApiSprites[normalizedName] ?? null;

                return (
                  <tr
                    key={`${pokemon.name}-${index}`}
                    className="border-t border-amber-900/25"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {spriteUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={spriteUrl}
                            alt={pokemon.name}
                            className="h-10 w-10 rounded-md bg-stone-800 object-contain p-1"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-stone-800 text-xs text-stone-500">
                            ?
                          </div>
                        )}

                        <input
                          value={pokemon.name}
                          onChange={(e) =>
                            updatePokemon(index, e.target.value, pokemon.points)
                          }
                          className={`w-full rounded-lg border bg-stone-950 p-2 ${
                            isDuplicate
                              ? "border-amber-500 text-amber-300"
                              : "border-stone-700"
                          }`}
                        />
                      </div>
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
                        className="w-24 rounded-lg border border-stone-700 bg-stone-950 p-2"
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
                  <td colSpan={4} className="p-8 text-center text-stone-500">
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
