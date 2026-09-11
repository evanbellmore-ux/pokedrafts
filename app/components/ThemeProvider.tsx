"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  isPokemonTheme,
  pokemonThemes,
  themeBackgrounds,
  type PokemonTheme,
} from "@/app/lib/theme";

export { pokemonThemes, isPokemonTheme };
export type { PokemonTheme };

type ThemeContextValue = {
  theme: PokemonTheme;
  setTheme: (theme: PokemonTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function writeThemeCookie(theme: PokemonTheme) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Seeded from the `pokedrafts-theme` cookie by the root layout so the first
 * client render matches the server HTML (no hydration mismatch, no flash).
 * Changing the theme updates the <html> attribute, the theme-color meta and
 * the cookie directly.
 */
export function ThemeProvider({
  initialTheme = DEFAULT_THEME,
  children,
}: {
  initialTheme?: PokemonTheme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<PokemonTheme>(initialTheme);

  const setTheme = useCallback((next: PokemonTheme) => {
    if (!isPokemonTheme(next)) return;
    setThemeState(next);
    document.documentElement.dataset.pokemonTheme = next;
    // The root layout's generateViewport wrote this meta for the cookie theme;
    // keep the browser chrome in step without waiting for a navigation.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeBackgrounds[next]);
    try {
      writeThemeCookie(next);
    } catch {
      // Cookies disabled: the theme still applies for this page view.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme]
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
