"use client";

import { ChevronDown, Palette } from "lucide-react";
import { useId } from "react";
import { usePokemonTheme } from "@/app/components/ThemeProvider";
import {
  formatThemeName,
  parseTheme,
  pokemonThemes,
  themeAccents,
} from "@/app/lib/theme";

/**
 * Native <select> styled to match the nav buttons. Keyboard and screen
 * reader behaviour come for free from the platform control.
 *
 * Below `sm` the control is a 40px icon button (palette icon plus the
 * current accent swatch; the value text is transparent and the chevron is
 * hidden) so the AppNav fits a 320px viewport without horizontal scroll.
 * The `<option>` list keeps its own colours from globals.css, so the open
 * picker stays readable. From `sm` up the theme name and chevron show.
 *
 * The boundary uses `border-control-border`, the opaque token every form
 * control shares, so the picker is identifiable at >= 3:1 in all palettes
 * (WCAG 1.4.11); `border-line` is decorative and too faint for a control.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = usePokemonTheme();
  const id = useId();

  return (
    <div className={`relative inline-flex ${className}`.trim()}>
      <label htmlFor={id} className="sr-only">
        Pokémon type theme
      </label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center gap-1.5 sm:left-3 sm:w-auto sm:justify-start"
      >
        <Palette className="h-4 w-4 text-muted" />
        <span
          className="h-3 w-3 rounded-full border border-white/40"
          style={{ backgroundColor: themeAccents[theme] }}
        />
      </span>
      <select
        id={id}
        value={theme}
        onChange={(event) => setTheme(parseTheme(event.target.value))}
        title="Pokémon type theme"
        className="h-10 w-10 cursor-pointer appearance-none rounded-lg border border-control-border bg-panel px-0 text-sm font-semibold text-transparent hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:w-auto sm:min-w-32 sm:pl-12 sm:pr-8 sm:text-text"
      >
        {pokemonThemes.map((option) => (
          <option key={option} value={option}>
            {formatThemeName(option)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted sm:block"
      />
    </div>
  );
}
