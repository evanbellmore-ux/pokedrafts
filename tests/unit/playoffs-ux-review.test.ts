import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UX, accessibility, mobile and copy review of the playoffs client
 * (docs/release-architecture.md sections 8.4, 8.5 and 12.6).
 *
 * 1. "View bracket" on the overview links to `/matches#playoffs`, but the
 *    Matches page renders that section only once its data has loaded. The
 *    app router scrolls to a hash once, at commit, and drops it when the
 *    element is missing (`getHashFragmentDomNode` in
 *    next/dist/client/components/layout-router.js), so the page must scroll
 *    to the bracket itself after the load finishes.
 * 2. Section 8.5: user-entered names are wrapped with `wrap-anywhere`
 *    wherever they can appear without spaces. The overview status card
 *    prints the champion's and the next opponent's team name in a plain
 *    span inside a grid cell, and the news feed prints the function's
 *    messages ("X won the championship") in a plain paragraph.
 * 3. Copy: the playoff-format help pluralises the coach count.
 */

const root = resolve(__dirname, "../..");
const leagueDir = "app/(app)/leagues/[leagueId]";

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("View bracket reaches the bracket (section 12.6)", () => {
  it("the overview links to the matches page's playoffs anchor", () => {
    expect(read(`${leagueDir}/OverviewStatusCard.tsx`)).toMatch(/matches#playoffs/);
    expect(read(`${leagueDir}/matches/MatchesClient.tsx`)).toMatch(/id="playoffs"/);
  });

  it("the matches page scrolls to the playoffs section itself once the data is ready", () => {
    const source = read(`${leagueDir}/matches/MatchesClient.tsx`);
    expect(source).toMatch(/location\.hash/);
    expect(source).toMatch(/scrollIntoView/);
  });
});

describe("long team names cannot widen a 375px viewport (section 8.5)", () => {
  it("wraps the champion and opponent names on the overview status card", () => {
    const source = read(`${leagueDir}/OverviewStatusCard.tsx`);
    const nameSpans = [
      ...source.matchAll(/<span className="([^"]*)">\s*(?:Champion: \{championName\}|vs \{opponent\}|\{slot\.kind === "member")/g),
    ];
    expect(nameSpans.length).toBeGreaterThanOrEqual(3);
    for (const [, className] of nameSpans) {
      expect(className).toMatch(/wrap-anywhere/);
    }
  });

  it("wraps the news message, which carries team names from the functions", () => {
    const source = read(`${leagueDir}/NewsFeed.tsx`);
    expect(source).toMatch(/<p className="[^"]*wrap-anywhere[^"]*">\{item\.message\}<\/p>/);
  });
});

describe("copy", () => {
  it("pluralises the playing coach count in the playoff-format help", () => {
    const source = read(`${leagueDir}/settings/SettingsForm.tsx`);
    expect(source).not.toMatch(/\$\{playingCount\} coaches play\./);
  });
});
