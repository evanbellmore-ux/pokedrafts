"use client";

import { Check, ChevronDown, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  pokemonThemes,
  type PokemonTheme,
  usePokemonTheme,
} from "@/app/components/ThemeProvider";

const typeColors: Record<PokemonTheme, string> = {
  normal: "#a8a77a",
  fire: "#ee8130",
  water: "#6390f0",
  electric: "#f7d02c",
  grass: "#7ac74c",
  ice: "#96d9d6",
  fighting: "#c22e28",
  poison: "#a33ea1",
  ground: "#e2bf65",
  flying: "#a98ff3",
  psychic: "#f95587",
  bug: "#a6b91a",
  rock: "#b6a136",
  ghost: "#735797",
  dragon: "#6f35fc",
  dark: "#705746",
  steel: "#b7b7ce",
  fairy: "#d685ad",
};

function formatThemeName(theme: string) {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

export default function ThemeToggle() {
  const { theme, setTheme } = usePokemonTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function selectTheme(nextTheme: PokemonTheme) {
    setTheme(nextTheme);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-800/50 bg-stone-900 px-4 py-2.5 text-sm font-semibold text-stone-200 hover:border-amber-600/70 hover:bg-stone-800"
        title="Select Pokemon type theme"
      >
        <Palette className="h-4 w-4" />
        <span>Theme</span>
        <span
          className="h-3 w-3 rounded-full border border-white/40"
          style={{ backgroundColor: typeColors[theme] }}
          aria-hidden="true"
        />
        <span className="min-w-16 text-left">{formatThemeName(theme)}</span>
        <ChevronDown
          className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Pokemon type theme"
          className="absolute right-0 z-50 mt-2 max-h-80 w-56 overflow-y-auto rounded-lg border border-amber-800/50 bg-stone-900 p-2 shadow-xl"
        >
          {pokemonThemes.map((pokemonTheme) => {
            const selected = pokemonTheme === theme;

            return (
              <button
                key={pokemonTheme}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectTheme(pokemonTheme)}
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm font-semibold ${
                  selected
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
                    : "border-transparent text-stone-300 hover:border-amber-800/50 hover:bg-stone-800"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-white/40"
                    style={{ backgroundColor: typeColors[pokemonTheme] }}
                    aria-hidden="true"
                  />
                  <span>{formatThemeName(pokemonTheme)}</span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
