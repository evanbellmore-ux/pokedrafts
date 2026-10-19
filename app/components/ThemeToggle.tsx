"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { usePokemonTheme } from "@/app/components/ThemeProvider";
import {
  formatThemeName,
  parseTheme,
  pokemonThemes,
  themeAccents,
} from "@/app/lib/theme";

/**
 * Native <select> for the Pokémon type theme, shown in the AppNav account
 * menu. Keyboard and screen reader behaviour come for free from the platform
 * control; the swatch beside the value previews the palette's accent. The
 * `<option>` list keeps its own colours from globals.css, so the open picker
 * stays readable.
 *
 * The boundary uses `border-control-border`, the opaque token every form
 * control shares, so the picker is identifiable at >= 3:1 in all palettes
 * (WCAG 1.4.11); `border-line` is decorative and too faint for a control.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = usePokemonTheme();
  const id = useId();

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        Pokémon type theme
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center"
        >
          <span
            className="h-3.5 w-3.5 rounded-full border border-white/40"
            style={{ backgroundColor: themeAccents[theme] }}
          />
        </span>
        <select
          id={id}
          value={theme}
          onChange={(event) => setTheme(parseTheme(event.target.value))}
          className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-control-border bg-bg pl-9 pr-8 text-sm font-medium text-text transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {pokemonThemes.map((option) => (
            <option key={option} value={option}>
              {formatThemeName(option)}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        />
      </div>
    </div>
  );
}
