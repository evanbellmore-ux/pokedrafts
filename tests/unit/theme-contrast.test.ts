import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPokemonTypeColours,
  pokemonThemes,
  pokemonTypeColours,
  themeAccents,
  themeBackgrounds,
  themeOnAccent,
} from "@/app/lib/theme";

/**
 * Contract checks for app/globals.css (docs/release-architecture.md 8.6):
 * every palette must keep on-accent text readable on the accent, the focus
 * ring must be visible on every surface, the base :root palette must equal
 * the "normal" theme, and every Tailwind token must resolve to a --type-*
 * variable. Ratios follow the WCAG 2.x formula.
 */

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

type Vars = Record<string, string>;

function parseBlock(selector: string): Vars {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No CSS block for ${selector}`);
  const vars: Vars = {};
  for (const m of match[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(foreground: string, background: string) {
  const l1 = luminance(hexToRgb(foreground));
  const l2 = luminance(hexToRgb(background));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const root = parseBlock(":root");

function palette(theme: string): Vars {
  return { ...root, ...parseBlock(`[data-pokemon-theme="${theme}"]`) };
}

/** WCAG 1.4.3 for normal text. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11 for UI components and focus indicators. */
const AA_NON_TEXT = 3;

describe("theme palettes", () => {
  it("defines a block for every theme in pokemonThemes", () => {
    for (const theme of pokemonThemes) {
      expect(() => parseBlock(`[data-pokemon-theme="${theme}"]`)).not.toThrow();
    }
  });

  it("keeps :root equal to the normal palette (no first-paint flash)", () => {
    const normal = parseBlock('[data-pokemon-theme="normal"]');
    for (const [name, value] of Object.entries(normal)) {
      expect(root[name], `--${name}`).toBe(value);
    }
  });

  it("keeps themeAccents in step with --type-accent", () => {
    for (const theme of pokemonThemes) {
      expect(palette(theme)["type-accent"].toLowerCase()).toBe(
        themeAccents[theme].toLowerCase()
      );
    }
  });

  it("keeps themeOnAccent in step with --type-on-accent", () => {
    for (const theme of pokemonThemes) {
      expect(palette(theme)["type-on-accent"].toLowerCase()).toBe(
        themeOnAccent[theme].toLowerCase()
      );
    }
  });

  // The root layout's generateViewport turns the theme cookie into
  // `themeColor` through this map, so the browser chrome must match the
  // page background of the palette being rendered.
  it("keeps themeBackgrounds in step with --type-bg", () => {
    for (const theme of pokemonThemes) {
      expect(themeBackgrounds[theme], theme).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette(theme)["type-bg"].toLowerCase()).toBe(
        themeBackgrounds[theme].toLowerCase()
      );
    }
  });

  it.each(pokemonThemes)(
    "%s: on-accent text over the accent meets WCAG AA (4.5:1)",
    (theme) => {
      const vars = palette(theme);
      const ratio = contrastRatio(vars["type-on-accent"], vars["type-accent"]);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );

  it.each(pokemonThemes)(
    "%s: accent text over a panel meets WCAG AA (4.5:1)",
    (theme) => {
      const vars = palette(theme);
      const ratio = contrastRatio(vars["type-accent-text"], vars["type-panel"]);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );

  it.each(pokemonThemes)(
    "%s: muted text over a panel meets WCAG AA (4.5:1)",
    (theme) => {
      const vars = palette(theme);
      const ratio = contrastRatio(vars["type-muted"], vars["type-panel"]);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );

  // Every focus indicator (Button, Input, AppNav, LeagueNav, ThemeToggle,
  // skip link, Alert dismiss) uses `ring-focus`, which must be opaque and
  // visible against every surface it can sit on.
  it.each(pokemonThemes)(
    "%s: the focus token is opaque and meets 3:1 on bg, panel and panel-hover",
    (theme) => {
      const vars = palette(theme);
      const focus = vars["type-focus"];
      expect(focus, "--type-focus").toMatch(/^#[0-9a-f]{6}$/i);
      for (const surface of ["type-bg", "type-panel", "type-panel-hover"]) {
        expect(
          contrastRatio(focus, vars[surface]),
          `focus over ${surface}`
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  );

  // Button variant "danger" renders `bg-danger-strong text-on-danger`
  // (app/components/ui/Button.tsx) and hovers to danger-strong-hover. These
  // colours are shared by every theme, so one check covers all of them.
  it("on-danger text over the danger button fills meets WCAG AA (4.5:1)", () => {
    for (const fill of ["type-danger-strong", "type-danger-strong-hover"]) {
      expect(
        contrastRatio(root["type-on-danger"], root[fill]),
        `on-danger over ${fill}`
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps danger text readable on panels (text-danger usage)", () => {
    for (const theme of pokemonThemes) {
      const vars = palette(theme);
      expect(
        contrastRatio(vars["type-danger"], vars["type-panel"]),
        `${theme}: danger over panel`
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("Pokémon type badge colours", () => {
  it.each(pokemonThemes)("%s: badge text meets WCAG AA on its fill", (type) => {
    const { background, foreground } = pokemonTypeColours[type];
    expect(background.toLowerCase()).toBe(themeAccents[type].toLowerCase());
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
      AA_TEXT
    );
  });

  it("looks up colours case-insensitively and returns null for unknown types", () => {
    expect(getPokemonTypeColours("Grass")).toEqual(pokemonTypeColours.grass);
    expect(getPokemonTypeColours("  FIRE ")).toEqual(pokemonTypeColours.fire);
    expect(getPokemonTypeColours("stellar")).toBeNull();
    expect(getPokemonTypeColours("")).toBeNull();
  });
});

describe("@theme inline tokens", () => {
  const tokens = [
    "bg",
    "panel",
    "panel-hover",
    "line",
    "line-strong",
    "control-border",
    "accent",
    "accent-hover",
    "accent-soft",
    "accent-border",
    "accent-text",
    "text",
    "muted",
    "faint",
    "on-accent",
    "focus",
    "danger",
    "danger-soft",
    "danger-strong",
    "danger-strong-hover",
    "on-danger",
    "warning",
    "warning-soft",
    "success",
    "success-soft",
  ];

  const themeBlock = css.match(/@theme inline\s*\{([^}]*)\}/)?.[1] ?? "";

  it.each(tokens)("--color-%s resolves to a --type-* variable", (token) => {
    const match = themeBlock.match(
      new RegExp(`--color-${token}:\\s*var\\(--type-([a-z-]+)\\);`)
    );
    expect(match, `--color-${token}`).not.toBeNull();
    expect(root[`type-${match![1]}`], `--type-${match![1]} in :root`).toBeDefined();
  });

  it("maps --font-sans to the Geist variable and never falls back to Arial", () => {
    expect(themeBlock).toMatch(/--font-sans:\s*var\(--font-geist-sans\);/);
    expect(css).not.toMatch(/Arial/i);
  });
});
