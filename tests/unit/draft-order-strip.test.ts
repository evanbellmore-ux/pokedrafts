import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DraftOrderStrip from "@/app/(app)/leagues/[leagueId]/draft/DraftOrderStrip";
import { getDraftRound, totalDraftPicks } from "@/app/lib/league/draft";
import type { TeamBudget } from "@/app/(app)/leagues/[leagueId]/draft/draft-room";
import type { LeagueMember } from "@/app/types/league";

/**
 * Draft room, "Draft order" strip (full two-account draft on production,
 * 2026-10-22). Once the draft was complete it listed the last round's snake
 * order: two coaches drafting ten each leave the room's round at 10, an
 * even round, so it read "1 Draft Testers, 2 Edge Challengers" although
 * Edge Challengers held draft slot 1, each with "0 pts" (the unspent budget,
 * which read like a score). Before the start and once the draft is complete
 * the strip now lists the draft order itself and no budgets; while the
 * draft runs (paused included) it keeps the round's order and points left.
 */

function coach(id: string, team: string, position: number): LeagueMember {
  return { id, league_id: "league-1", user_id: `user-${id}`, role: "coach", joined_at: null, team_name: team, draft_position: position, free_agent_swaps_used: 0 };
}

const edge = coach("ec", "Edge Challengers", 1);
const testers = coach("dt", "Draft Testers", 2);

function budget(remaining: number): TeamBudget {
  return { budget: 100, spent: 100 - remaining, remaining, pickCount: 0, slotsLeft: 0 };
}

function render(coaches: LeagueMember[], round: number, draftLive: boolean, remaining: number[]) {
  return renderToStaticMarkup(createElement(DraftOrderStrip, {
    coaches, round, draftLive, onClockId: draftLive ? coaches[0].id : null, nextUpId: null, nextUpName: null, myId: edge.id,
    budgets: new Map(coaches.map((row, index) => [row.id, budget(remaining[index])] as const)),
  }));
}

const heading = (html: string) => html.match(/<h2 id="draft-order-heading"[^>]*>([^<]*)<\/h2>/)?.[1];
const names = (html: string) => [...html.matchAll(/<span class="max-w-\[10rem\] truncate font-medium">([^<]*)/g)].map((match) => match[1]);
const positions = (html: string) => [...html.matchAll(/<span class="text-xs font-semibold tabular-nums">(\d+)<\/span>/g)].map((match) => Number(match[1]));
const points = (html: string) => [...html.matchAll(/<span class="text-xs tabular-nums">([^<]*)<\/span>/g)].map((match) => match[1]);

/** The round the room reports once every pick is made (`useDraftRoom` clamps the pick number to the last pick). */
function finishedRound(teamCount: number, picksPerTeam: number) {
  return getDraftRound(totalDraftPicks(teamCount, picksPerTeam), teamCount);
}

describe("draft room order strip", () => {
  it("lists the real draft order after a draft whose last round snaked back", () => {
    expect(finishedRound(2, 10)).toBe(10);
    const html = render([edge, testers], finishedRound(2, 10), false, [0, 0]);
    expect(heading(html)).toBe("Draft order");
    expect(names(html)).toEqual(["Edge Challengers", "Draft Testers"]);
    expect(positions(html)).toEqual([1, 2]);
  });

  it("shows no budgets outside a running draft: neither the unspent rest nor the full budget", () => {
    expect(points(render([edge, testers], finishedRound(2, 10), false, [0, 0]))).toEqual([]);
    expect(render([edge, testers], finishedRound(2, 10), false, [0, 0])).not.toMatch(/\bpts?\b/);
    const setup = render([edge, testers], 1, false, [100, 100]);
    expect(names(setup)).toEqual(["Edge Challengers", "Draft Testers"]);
    expect(points(setup)).toEqual([]);
  });

  it("lists slot order for any number of coaches once the draft is complete", () => {
    const third = coach("th", "Third Wheel", 3);
    expect(finishedRound(3, 6)).toBe(6);
    expect(names(render([edge, testers, third], finishedRound(3, 6), false, [4, 0, 1]))).toEqual(["Edge Challengers", "Draft Testers", "Third Wheel"]);
  });

  it("keeps the round's snake order and the points left while the draft runs", () => {
    const even = render([edge, testers], 2, true, [80, 1]);
    expect(heading(even)).toBe("Round 2 order");
    expect(names(even)).toEqual(["Draft Testers", "Edge Challengers"]);
    expect(points(even)).toEqual(["1 pt", "80 pts"]);
    const odd = render([edge, testers], 3, true, [61, 40]);
    expect(names(odd)).toEqual(["Edge Challengers", "Draft Testers"]);
    expect(points(odd)).toEqual(["61 pts", "40 pts"]);
  });
});
