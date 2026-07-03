"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const pokemonThemes = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type PokemonTheme = (typeof pokemonThemes)[number];

type ThemeContextValue = {
  theme: PokemonTheme;
  setTheme: (theme: PokemonTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPokemonTheme(value: string | null): value is PokemonTheme {
  return pokemonThemes.includes(value as PokemonTheme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<PokemonTheme>(() => {
    if (typeof window === "undefined") return "normal";

    const savedTheme = window.localStorage.getItem("pokedrafts-theme");
    if (isPokemonTheme(savedTheme)) {
      return savedTheme;
    }

    return "normal";
  });

  useEffect(() => {
    document.documentElement.dataset.pokemonTheme = theme;
    window.localStorage.setItem("pokedrafts-theme", theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
    }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function usePokemonTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("usePokemonTheme must be used inside ThemeProvider");
  }

  return value;
}
