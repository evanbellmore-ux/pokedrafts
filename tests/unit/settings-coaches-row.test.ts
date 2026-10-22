import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachesCard from "@/app/(app)/leagues/[leagueId]/settings/CoachesCard";
import type { SettingsMember } from "@/app/(app)/leagues/[leagueId]/settings/helpers";
import type { League } from "@/app/types/league";

/**
 * League Settings, Coaches card (full two-account draft on production,
 * 2026-10-22). The card sits in the settings page's narrow column (2/5 of
 * the page from `lg`: 426 px at a 1212 px window), and from the `sm`
 * viewport up each row put the team and its buttons side by side with the
 * buttons unable to shrink. Before the draft "Make commissioner" and
 * "Remove" left "Edge Challengers" 16 px ("E…", the joined line broken into
 * six lines); during the draft, with "Make commissioner" alone, it read
 * "Edge Challenge…" over two lines. The row now wraps by its contents: the
 * team starts at its full width and the buttons move below it when both do
 * not fit, whatever the viewport. Node cannot lay the row out, so this pins
 * what makes it wrap; the widths were measured in the browser (1024 to
 * 1920 px, 900, 640, 375 and 320 px).
 */

const league: League = {
  id: "league-1", name: "Full Draft Test", commissioner_id: "user-dt", max_coaches: 2, created_at: null,
  draft_format_id: null, point_budget: 100, draft_started: false, current_pick_number: 1, picks_per_team: 10,
  draft_completed: false, pick_timer_seconds: 120, pick_started_at: null, auto_pick_in_progress: false,
  custom_pool: null, schedule_format: "round_robin", free_agent_swap_limit: 3, draft_paused_at: null,
  tiebreaker: "head_to_head", playoff_format: "none", champion_member_id: null,
};

const members: SettingsMember[] = [
  { id: "m-dt", user_id: "user-dt", team_name: "Draft Testers", role: "commissioner", draft_position: 2, joined_at: "2026-10-22T14:00:00Z" },
  { id: "m-ec", user_id: "user-ec", team_name: "Edge Challengers", role: "coach", draft_position: 1, joined_at: "2026-10-22T14:05:00Z" },
];

function render(draftStarted: boolean) {
  const noop = async () => undefined;
  return renderToStaticMarkup(createElement(CoachesCard, {
    league: { ...league, draft_started: draftStarted }, members, currentUserId: "user-dt", onRemoved: noop, onTransferred: noop,
  }));
}

/** Each coach row: the row's classes, its team block's, its buttons wrapper's (null for your own row). */
function rows(html: string) {
  return html.split("<li ").slice(1).map((row) => ({
    row: row.match(/^class="([^"]*)"/)?.[1] ?? "",
    team: row.match(/^class="[^"]*"><div class="([^"]*)"/)?.[1] ?? "",
    buttons: row.match(/<div class="([^"]*)"><button/)?.[1] ?? null,
    text: row.replace(/<[^>]+>/g, ""),
  }));
}

describe("Settings coach rows", () => {
  it.each([
    ["before the draft (Make commissioner and Remove)", false],
    ["once the draft has started (Make commissioner)", true],
  ])("move the buttons below the team instead of squeezing it, %s", (_, started) => {
    const list = rows(render(started));
    expect(list).toHaveLength(2);
    for (const { row, team } of list) {
      // Wraps by content: no viewport breakpoint forces one line.
      expect(row.split(" ")).toContain("flex-wrap");
      expect(row).not.toMatch(/(^|\s)(sm|md|lg):flex-(row|col)\b/);
      // The team grows from its own width, and can still shrink (truncate) on a row narrower than its name.
      expect(team.split(" ")).toEqual(expect.arrayContaining(["flex-auto", "min-w-0"]));
    }
    const coach = list.find(({ text }) => text.includes("Edge Challengers"))!;
    // The buttons may not refuse to shrink and keep the team's room for themselves.
    expect(coach.buttons).not.toBeNull();
    expect(coach.buttons).not.toMatch(/shrink-0/);
    expect(coach.text).toContain(started ? "Make commissioner" : "Make commissionerRemove");
  });

  it("keeps \"Joined <date>\" in one piece, so the role line wraps only after the role", () => {
    const html = render(false);
    expect(html).toMatch(/>Coach · <span class="whitespace-nowrap">Joined [^<]+2026<\/span>/);
    expect(html).toMatch(/>Commissioner · <span class="whitespace-nowrap">Joined [^<]+2026<\/span>/);
  });

  it("still truncates a name longer than the whole row", () => {
    expect(render(false)).toMatch(/<span class="min-w-0 truncate font-semibold text-text">Edge Challengers<\/span>/);
  });
});
