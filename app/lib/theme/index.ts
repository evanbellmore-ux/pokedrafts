/**
 * Pokémon type theme definitions shared by the server layout (cookie read),
 * the ThemeProvider (client state) and the ThemeToggle (picker).
 *
 * This module is intentionally free of "use client" so it can be imported
 * from server components.
 */

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

export const DEFAULT_THEME: PokemonTheme = "normal";

/** Cookie that stores the selected theme (1 year, SameSite=Lax). */
export const THEME_COOKIE = "pokedrafts-theme";

export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Accent swatch per theme, used by the picker. Matches globals.css. */
export const themeAccents: Record<PokemonTheme, string> = {
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

/**
 * Text colour that meets WCAG AA (4.5:1) on the matching accent. Mirrors
 * `--type-on-accent` in globals.css; tests/unit/theme-contrast.test.ts keeps
 * the two in step.
 */
export const themeOnAccent: Record<PokemonTheme, string> = {
  normal: "#171717",
  fire: "#170b06",
  water: "#06111d",
  electric: "#171300",
  grass: "#07140a",
  ice: "#071518",
  fighting: "#fff5f4",
  poison: "#fdf4fd",
  ground: "#181106",
  flying: "#0f0e1c",
  psychic: "#190711",
  bug: "#111407",
  rock: "#141007",
  ghost: "#f8f3ff",
  dragon: "#f6f1ff",
  dark: "#fbf6f2",
  steel: "#0d1015",
  fairy: "#180a12",
};

/**
 * Page background per theme (`--type-bg` in globals.css). The root layout's
 * `generateViewport` maps the theme cookie to `themeColor` with it, so the
 * mobile browser chrome matches the palette instead of always showing the
 * `normal` background. tests/unit/theme-contrast.test.ts keeps it in step
 * with the CSS.
 */
export const themeBackgrounds: Record<PokemonTheme, string> = {
  normal: "#101012",
  fire: "#170b06",
  water: "#06111d",
  electric: "#171300",
  grass: "#07140a",
  ice: "#071518",
  fighting: "#170706",
  poison: "#130817",
  ground: "#181106",
  flying: "#0f0e1c",
  psychic: "#190711",
  bug: "#111407",
  rock: "#141007",
  ghost: "#0d0916",
  dragon: "#0c0618",
  dark: "#090807",
  steel: "#0d1015",
  fairy: "#180a12",
};

export type PokemonTypeColours = {
  /** Canonical colour of the Pokémon type (same value as the theme accent). */
  background: string;
  /** Text colour with >= 4.5:1 contrast on `background`. */
  foreground: string;
};

/**
 * Colours for the 18 Pokémon types, used by TypeBadge. They are applied as
 * inline styles so the active theme never recolours a badge: a Grass badge
 * is green in every theme.
 */
export const pokemonTypeColours: Record<PokemonTheme, PokemonTypeColours> =
  Object.fromEntries(
    pokemonThemes.map((type) => [
      type,
      { background: themeAccents[type], foreground: themeOnAccent[type] },
    ])
  ) as Record<PokemonTheme, PokemonTypeColours>;

/** Colours for a type name in any casing, or null for an unknown type. */
export function getPokemonTypeColours(type: string): PokemonTypeColours | null {
  const normalized = type.trim().toLowerCase();
  return isPokemonTheme(normalized) ? pokemonTypeColours[normalized] : null;
}

export function isPokemonTheme(value: unknown): value is PokemonTheme {
  return (
    typeof value === "string" &&
    (pokemonThemes as readonly string[]).includes(value)
  );
}

/** Coerces any cookie/storage value to a valid theme, falling back to normal. */
export function parseTheme(value: unknown): PokemonTheme {
  return isPokemonTheme(value) ? value : DEFAULT_THEME;
}

export function formatThemeName(theme: string) {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

/**
 * Focus ring for inline text links (auth page links, landing footer): the
 * same opaque per-theme ring with a `bg` offset that Button draws (docs
 * section 8.4), so a keyboard user gets one indicator everywhere. Callers
 * add their own colour and weight (`font-semibold text-accent-text
 * hover:underline`, `hover:text-text`, ...).
 */
export const linkClassName =
  "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
