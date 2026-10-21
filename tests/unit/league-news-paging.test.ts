import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { olderNewsFilter } from "@/app/(app)/leagues/[leagueId]/overview";

/**
 * The overview's "Load more" asks PostgREST for the news after the last row
 * on screen. The feed is ordered by created_at desc, then id desc, and rows
 * written in one transaction share created_at (now() is the transaction's
 * start): the last regular-season result is stored with "The playoff bracket
 * is set.", and the final with the champion row. A cursor on created_at alone
 * (`created_at < last`) skipped every row that shared the last row's
 * timestamp whenever a page ended between them, so the cursor carries the id
 * too: `created_at < last or (created_at = last and id < last.id)`.
 *
 * `matches` below reads the filter the way PostgREST does for the two
 * operators it uses (`lt`, `eq`) inside `or=(...)` with nested `and(...)`.
 * Timestamps compare as text, which is their order here because every
 * fixture value has the same format and offset.
 */

const root = resolve(__dirname, "../..");
const overviewClient = "app/(app)/leagues/[leagueId]/LeagueOverviewClient.tsx";

type Row = { id: string; created_at: string };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits a PostgREST logic-tree list at its top-level commas. */
function splitTerms(list: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      terms.push(list.slice(start, index));
      start = index + 1;
    }
  }
  terms.push(list.slice(start));
  return terms;
}

function matches(row: Row, term: string): boolean {
  const group = /^(and|or)\((.*)\)$/.exec(term);
  if (group) {
    const results = splitTerms(group[2]).map((part) => matches(row, part));
    return group[1] === "and" ? results.every(Boolean) : results.some(Boolean);
  }
  const [column, operator, ...rest] = term.split(".");
  if (column !== "id" && column !== "created_at") throw new Error(`unexpected column ${column}`);
  const order = compareText(row[column], rest.join("."));
  if (operator === "lt") return order < 0;
  if (operator === "eq") return order === 0;
  throw new Error(`unexpected operator ${operator}`);
}

/** created_at desc, then id desc: the feed's order. */
function feedOrder(a: Row, b: Row): number {
  return compareText(b.created_at, a.created_at) || compareText(b.id, a.id);
}

/** One page as `.or(filter).order(...).limit(size)` returns it. */
function page(rows: readonly Row[], orFilter: string | null, size: number): Row[] {
  return rows
    .filter((row) => orFilter === null || splitTerms(orFilter).some((term) => matches(row, term)))
    .sort(feedOrder)
    .slice(0, size);
}

const at = (seconds: number) => `2026-10-20T18:00:${String(seconds).padStart(2, "0")}.123456+00:00`;

// Three rows from one transaction straddle the end of the first page.
const NEWS: Row[] = [
  { id: "9b1f0c2e-0000-4000-8000-000000000001", created_at: at(5) },
  { id: "4a7d3e10-0000-4000-8000-000000000002", created_at: at(4) },
  { id: "e3c9a811-0000-4000-8000-000000000003", created_at: at(3) },
  { id: "b52e6f04-0000-4000-8000-000000000004", created_at: at(3) },
  { id: "0d84c7a9-0000-4000-8000-000000000005", created_at: at(3) },
  { id: "71aa5b36-0000-4000-8000-000000000006", created_at: at(1) },
  { id: "c08f92d7-0000-4000-8000-000000000007", created_at: at(0) },
];

describe("overview news paging", () => {
  it("continues after the last row shown, breaking created_at ties by id like the feed's order", () => {
    const last = NEWS[2];
    expect(olderNewsFilter(last)).toBe(
      `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`
    );
  });

  it("reaches every row once, in order, when a page ends inside a run of equal timestamps", () => {
    const shown = page(NEWS, null, 3);
    expect(shown.map((row) => row.created_at)).toEqual([at(5), at(4), at(3)]);
    for (let guard = 0; guard < NEWS.length; guard += 1) {
      const next = page(NEWS, olderNewsFilter(shown[shown.length - 1]), 3);
      if (next.length === 0) break;
      shown.push(...next);
    }
    expect(shown).toEqual([...NEWS].sort(feedOrder));

    // A cursor on created_at alone lost the two rows that shared the
    // timestamp of the last row on the first page.
    const byTimeOnly = page(NEWS, `created_at.lt.${shown[2].created_at}`, 3);
    expect(byTimeOnly.map((row) => row.created_at)).toEqual([at(1), at(0)]);
  });

  it("is the filter Load more sends", () => {
    const source = readFileSync(resolve(root, overviewClient), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("async function loadMoreNews");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n  }\n", start));
    expect(body).toMatch(/\.or\(olderNewsFilter\(oldest\)\)/);
    expect(body).not.toMatch(/\.lt\("created_at"/);
    expect(body).toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  });
});
