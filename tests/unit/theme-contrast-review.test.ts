import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pokemonThemes } from "@/app/lib/theme";

/**
 * Review findings for the UI/theme lens (docs/release-architecture.md 8.6).
 *
 * These assert WCAG 1.4.3 (4.5:1 for normal-size text) on two token pairs
 * that the existing theme-contrast suite does not cover:
 *
 * 1. `text-on-accent` over `--type-accent-hover`: the primary Button
 *    (`bg-accent text-on-accent hover:bg-accent-hover`, app/components/ui/
 *    Button.tsx) keeps its label while the fill lightens on hover.
 * 2. `--type-faint`: used for placeholder text (`placeholder:text-faint` on
 *    a `bg-bg` input, app/components/ui/Input.tsx) and for 12px content text
 *    on `bg` and `panel` (landing footer disclaimer and "Step N" labels in
 *    app/page.tsx, error digest in app/error.tsx).
 *
 * They fail until the tokens are adjusted; the numbers in the assertion
 * messages are the measured ratios.
 */

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

type Vars = Record<string, string>;

function parseBlock(selector: string): Vars {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No CSS block for ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const vars: Vars = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
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

function contrastRatio(foreground: string, background: string) {
  const l1 = luminance(hexToRgb(foreground));
  const l2 = luminance(hexToRgb(background));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const root = parseBlock(":root");
const palette = (theme: string): Vars => ({
  ...root,
  ...parseBlock(`[data-pokemon-theme="${theme}"]`),
});

const AA_TEXT = 4.5;

describe("theme contrast (review findings)", () => {
  it.each(pokemonThemes)(
    "%s: on-accent text over the hovered accent (primary Button hover) meets 4.5:1",
    (theme) => {
      const vars = palette(theme);
      const ratio = contrastRatio(
        vars["type-on-accent"],
        vars["type-accent-hover"]
      );
      expect(
        ratio,
        `${theme}: ${vars["type-on-accent"]} over --type-accent-hover ${vars["type-accent-hover"]} = ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );

  it.each(pokemonThemes)(
    "%s: faint text (placeholders, footer, step labels) meets 4.5:1 on bg and panel",
    (theme) => {
      const vars = palette(theme);
      for (const surface of ["type-bg", "type-panel"]) {
        const ratio = contrastRatio(vars["type-faint"], vars[surface]);
        expect(
          ratio,
          `${theme}: --type-faint ${vars["type-faint"]} over ${surface} ${vars[surface]} = ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  );
});
