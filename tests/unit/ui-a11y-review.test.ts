import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pokemonThemes } from "@/app/lib/theme";

/**
 * Review findings for the UI/accessibility lens (docs/release-architecture.md
 * sections 8.4 and 8.6).
 *
 * 1. WCAG 1.4.11 (non-text contrast): a text field's visible boundary must
 *    reach 3:1 against the surface next to it. `Input`/`Select` draw their
 *    boundary with a border token on a `bg-bg` fill, and the fill itself is
 *    within 1.2:1 of the surrounding `bg-panel` card in every palette, so the
 *    border is the only thing that identifies the field. The test resolves
 *    the border token the control actually uses and checks it over
 *    `--type-bg`, `--type-panel` and `--type-panel-hover` for all 18
 *    palettes (alpha colours are composited over the fill first).
 *
 * 2. Every control has a label (8.4): the Pool Builder lives in the
 *    app/(app)/builder route folder, split into BuilderClient, FormatLibrary
 *    and PoolTable. Across those files each `<input` must carry
 *    `aria-label`/`aria-labelledby` or an `id` that a `<label htmlFor>`
 *    points at, and the page must be built on the ui kit.
 */

const root = resolve(__dirname, "../..");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");

type Vars = Record<string, string>;

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

type Rgba = [number, number, number, number];

function parseColour(value: string): Rgba {
  const v = value.trim();
  if (v.startsWith("#")) {
    const h = v.slice(1);
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${value}`);
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) throw new Error(`Unsupported colour: ${value}`);
  const parts = m[1].split(",").map((p) => Number(p.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1,
  ];
}

function luminance([r, g, b]: Rgba) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(foreground: Rgba, background: Rgba) {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const rootVars = parseBlock(":root");
const palette = (theme: string): Vars => ({
  ...rootVars,
  ...parseBlock(`[data-pokemon-theme="${theme}"]`),
});

/** Tailwind colour token (`line`, `line-strong`, ...) -> `--type-*` name. */
function typeVariableFor(token: string): string {
  const themeBlock = css.slice(css.indexOf("@theme inline"));
  const m = themeBlock.match(
    new RegExp(`--color-${token.replace(/[-]/g, "\\-")}:\\s*var\\(--([a-z-]+)\\)`)
  );
  if (!m) throw new Error(`--color-${token} is not mapped in @theme inline`);
  return m[1];
}

const AA_NON_TEXT = 3;

describe("form control boundary contrast (WCAG 1.4.11)", () => {
  const inputSource = readFileSync(
    resolve(root, "app/components/ui/Input.tsx"),
    "utf8"
  );
  const classMatch = inputSource.match(/controlClassName =\s*"([^"]+)"/);
  if (!classMatch) throw new Error("controlClassName not found in Input.tsx");
  const classes = classMatch[1].split(/\s+/);

  const borderToken = classes
    .filter((c) => /^border-[a-z]/.test(c) && !/^border-(?:solid|dashed|none)$/.test(c))
    .map((c) => c.slice("border-".length))
    .find((token) => css.includes(`--color-${token}:`));
  const fillToken = classes
    .filter((c) => /^bg-[a-z]/.test(c))
    .map((c) => c.slice("bg-".length))
    .find((token) => css.includes(`--color-${token}:`));

  it("resolves the Input border and fill tokens from globals.css", () => {
    expect(borderToken).toBeDefined();
    expect(fillToken).toBeDefined();
  });

  it.each(pokemonThemes)(
    "%s: the Input border reaches 3:1 over the Input fill",
    (theme) => {
      const vars = palette(theme);
      const fill = parseColour(vars[typeVariableFor(fillToken!)]);
      const border = composite(parseColour(vars[typeVariableFor(borderToken!)]), fill);
      const ratio = contrastRatio(border, fill);
      expect(
        ratio,
        `border-${borderToken} over bg-${fillToken} is ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  );

  // A field usually sits on a panel card, and the ThemeToggle select on
  // panel/panel-hover, so the same boundary must also be visible against
  // those adjacent surfaces.
  it.each(pokemonThemes)(
    "%s: the control border reaches 3:1 over panel and panel-hover",
    (theme) => {
      const vars = palette(theme);
      const fill = parseColour(vars[typeVariableFor(fillToken!)]);
      const border = composite(parseColour(vars[typeVariableFor(borderToken!)]), fill);
      for (const surface of ["type-panel", "type-panel-hover"]) {
        const ratio = contrastRatio(border, parseColour(vars[surface]));
        expect(
          ratio,
          `border-${borderToken} over ${surface} is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  );

  it("draws the ThemeToggle select with the same control border token", () => {
    const source = readFileSync(
      resolve(root, "app/components/ThemeToggle.tsx"),
      "utf8"
    );
    // The doc comment mentions "<select>", so anchor on the JSX tag (which is
    // followed by whitespace and attributes) and read its className.
    const start = source.search(/<select\s/);
    expect(start).toBeGreaterThan(-1);
    const classes =
      source.slice(start).match(/className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(classes).toContain(`border-${borderToken}`);
    expect(classes).not.toContain("border-line");
  });
});

/** Every .tsx source in the Pool Builder route folder, concatenated. */
function readBuilderSource() {
  const dir = resolve(root, "app/(app)/builder");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .sort();
  expect(files).toContain("BuilderClient.tsx");
  return files
    .map((name) => readFileSync(resolve(dir, name), "utf8"))
    .join("\n");
}

describe("every control has a label (docs section 8.4)", () => {
  it("labels every <input> in app/(app)/builder", () => {
    const source = readBuilderSource();
    const labelledIds = new Set(
      [...source.matchAll(/htmlFor=\{?"?([A-Za-z0-9_-]+)"?\}?/g)].map((m) => m[1])
    );

    const unlabelled: string[] = [];
    // `[^>]` already spans newlines, so the es2018-only `s` flag is not needed
    // (tsconfig targets es2017).
    for (const match of source.matchAll(/<input\b([^>]*?)\/?>/g)) {
      const attrs = match[1];
      const line = source.slice(0, match.index).split("\n").length;
      const hasAria = /aria-label(?:ledby)?=/.test(attrs);
      const idMatch = attrs.match(/\bid=\{?"?([A-Za-z0-9_-]+)"?\}?/);
      const hasLabel = idMatch ? labelledIds.has(idMatch[1]) : false;
      if (!hasAria && !hasLabel) unlabelled.push(`line ${line}`);
    }

    expect(unlabelled).toEqual([]);
  });

  it("builds the Pool Builder on the ui kit (scope=col headers, no raw buttons or images)", () => {
    const source = readBuilderSource();
    const headers = [...source.matchAll(/<th\b([^>]*)>/g)].map((m) => m[1]);
    expect(headers.length).toBeGreaterThan(0);
    for (const attrs of headers) {
      expect(attrs, `<th${attrs}>`).toMatch(/scope="col"/);
    }
    expect(source).not.toMatch(/<button\b/);
    expect(source).not.toMatch(/<img\b/);
    expect(source).not.toMatch(/\balert\(/);
    for (const component of [
      "PageHeader",
      "Field",
      "Input",
      "NumberInput",
      "Button",
      "TableWrap",
      "PokemonSprite",
      "Alert",
    ]) {
      expect(source, component).toMatch(new RegExp(`<${component}\\b`));
    }
  });
});
