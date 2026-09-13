import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `leagues.champion_member_id` (the playoffs migration) is a second foreign
 * key between `leagues` and `league_members`; the first is
 * `league_members.league_id`. PostgREST answers an unhinted embed between two
 * tables that share more than one relationship with HTTP 300 ("more than one
 * relationship was found"), so a query on `league_members` must embed
 * `leagues!league_id(...)` and a query on `leagues` must embed
 * `league_members!champion_member_id(...)` (or `!league_id` for the members
 * list). The DB suite runs SQL, not PostgREST, so this static check is what
 * catches a bare embed before it reaches the browser.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(root, "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(appDir)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => ({ file: relative(root, file), source: readFileSync(file, "utf8") }));

/** Every string literal in the module (double, single and template quotes). */
function literals(source: string): string[] {
  return (source.match(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g) ?? []).map((raw) =>
    raw.slice(1, -1)
  );
}

/** Embeds of `table` written without a `!hint`, e.g. `leagues(id, name)`. */
function bareEmbeds(literal: string, table: string): string[] {
  const pattern = new RegExp(`(?<![!\\w])${table}\\s*\\(`, "g");
  return literal.match(pattern) ?? [];
}

describe("PostgREST embeds between leagues and league_members carry a hint", () => {
  const pairs: Array<[from: string, embed: string]> = [
    ["league_members", "leagues"],
    ["leagues", "league_members"],
  ];

  it.each(pairs)("queries on %s hint their %s embed", (from, embed) => {
    const offenders = sources
      .filter(({ source }) => source.includes(`.from("${from}")`))
      .flatMap(({ file, source }) =>
        literals(source)
          .flatMap((literal) => bareEmbeds(literal, embed))
          .map((match) => `${file}: ${match.trim()}`)
      );
    expect(offenders).toEqual([]);
  });

  it("still sees the dashboard's hinted embed (the check is not vacuous)", () => {
    const dashboard = sources.find(({ file }) =>
      file.endsWith(join("dashboard", "DashboardClient.tsx"))
    );
    expect(dashboard?.source).toMatch(/leagues!league_id\(/);
    expect(bareEmbeds("leagues(id, name)", "leagues")).toEqual(["leagues("]);
    expect(bareEmbeds("leagues!league_id(id, name)", "leagues")).toEqual([]);
  });
});
