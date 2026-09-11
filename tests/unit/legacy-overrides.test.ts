import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Theme contract (docs/release-architecture.md section 8.6): pages colour
 * themselves only with the theme tokens (`bg-panel`, `text-muted`, ...) and
 * the ui components, so every palette recolours every page. The
 * "legacy overrides" block that once recoloured stone/amber/emerald/sky
 * utilities with `!important` was deleted together with the last page that
 * used them, so nothing may bring those utilities (or hard-coded hex colours
 * in a className) back. `TypeBadge` and `app/lib/theme` apply the canonical
 * Pokémon type colours as inline styles by design and are excluded.
 */

const root = resolve(__dirname, "../..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

const excluded = new Set([
  join(root, "app/components/TypeBadge.tsx"),
]);

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (path === join(root, "app/lib/theme")) continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry) && !excluded.has(path)) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(join(root, "app"));

const legacyUtility =
  /(?:^|[\s"'`{(])(?:[a-z-]+:)*(?:bg|border|text|ring|from|to|via|fill|stroke|divide|outline|shadow|placeholder|decoration|accent|caret)-(?:stone|amber|emerald|sky|red|green|yellow|gray|zinc|neutral)-[0-9]{2,3}(?:\/[0-9]+)?/g;

const hexInClassName = /className[^\n]*#[0-9a-fA-F]{3,8}\b/;

function where(file: string, index: number) {
  return `${file.slice(root.length + 1).split(sep).join("/")}:${index + 1}`;
}

describe("legacy palette utilities", () => {
  it("are used by no page or component under app/", () => {
    const found: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(legacyUtility)) {
            found.push(`${match[0].trim()} (${where(file, index)})`);
          }
        });
    }
    expect(found.sort()).toEqual([]);
  });

  it("are never replaced by hex colours in a className", () => {
    const found: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (hexInClassName.test(line)) found.push(where(file, index));
        });
    }
    expect(found).toEqual([]);
  });

  it("have no override block left in app/globals.css", () => {
    expect(css).not.toContain("legacy overrides");
    expect(css).not.toContain("!important");
    expect(css).not.toMatch(/\.bg-stone-|\.text-stone-|\.border-amber-|\.bg-emerald-/);
  });
});
