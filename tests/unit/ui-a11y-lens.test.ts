import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pokemonThemes } from "@/app/lib/theme";

/**
 * Review findings for the UI system / theme / accessibility lens
 * (docs/release-architecture.md sections 8.4 and 8.6).
 *
 * `Alert` (app/components/ui/Alert.tsx) renders its body in `text-muted`
 * whenever a `title` is given, on top of the variant's translucent "soft"
 * fill. The info variant uses `bg-accent-soft`, and an alert normally sits on
 * a `bg-panel` card, so the body text is `--type-muted` over `--type-accent-
 * soft` composited over `--type-panel`. WCAG 1.4.3 needs 4.5:1 for 14px
 * text; the electric, ice, ground and bug palettes land between 4.09:1 and
 * 4.38:1. The other three variants (success / warning / danger soft fills)
 * pass in every palette and are asserted here so they stay that way.
 */

const root = resolve(__dirname, "../..");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");

type Vars = Record<string, string>;
type Rgb = [number, number, number];

function parseBlock(selector: string): Vars {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No CSS block for ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Vars = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function parseColour(value: string): { rgb: Rgb; alpha: number } {
  const v = value.trim();
  if (v.startsWith("#")) {
    const h = v.slice(1);
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${value}`);
    return {
      rgb: [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
    };
  }
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) throw new Error(`Unsupported colour: ${value}`);
  const parts = m[1].split(",").map((p) => Number(p.trim()));
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
}

function composite(fg: string, bg: Rgb): Rgb {
  const { rgb, alpha } = parseColour(fg);
  return rgb.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;
}

function luminance([r, g, b]: Rgb) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: Rgb, b: Rgb) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const rootVars = parseBlock(":root");
const palette = (theme: string): Vars => ({
  ...rootVars,
  ...parseBlock(`[data-pokemon-theme="${theme}"]`),
});

const AA_TEXT = 4.5;

const alertSource = readFileSync(
  resolve(root, "app/components/ui/Alert.tsx"),
  "utf8"
);

/** `bg-*` token of an Alert variant's box classes, e.g. info -> accent-soft. */
function alertFillToken(variant: string): string {
  const block = alertSource.match(
    new RegExp(`${variant}:\\s*\\{[^}]*box:\\s*"([^"]+)"`)
  );
  if (!block) throw new Error(`No box classes for Alert variant ${variant}`);
  const fill = block[1].split(/\s+/).find((c) => c.startsWith("bg-"));
  if (!fill) throw new Error(`No bg-* class for Alert variant ${variant}`);
  return fill.slice("bg-".length);
}

describe("Alert body text contrast (WCAG 1.4.3, docs 8.4/8.6)", () => {
  it("renders the body in text-muted when a title is present", () => {
    // The finding depends on this; if the body colour changes, update the
    // token below.
    expect(alertSource).toMatch(/title \? "mt-0\.5 text-muted"/);
  });

  const variants = ["info", "success", "warning", "error"] as const;

  describe.each(variants)("variant %s", (variant) => {
    const fillToken = alertFillToken(variant);

    it.each(pokemonThemes)(
      `%s: muted body over bg-${fillToken} on a panel meets 4.5:1`,
      (theme) => {
        const vars = palette(theme);
        const panel = parseColour(vars["type-panel"]).rgb;
        const fill = composite(vars[`type-${fillToken}`], panel);
        const muted = parseColour(vars["type-muted"]).rgb;
        const ratio = contrastRatio(muted, fill);
        expect(
          ratio,
          `${theme}: --type-muted ${vars["type-muted"]} over --type-${fillToken} ${vars[`type-${fillToken}`]} on --type-panel ${vars["type-panel"]} = ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    );
  });
});
