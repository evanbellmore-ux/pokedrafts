import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommissionerControls, { type CommissionerControlsProps } from "@/app/(app)/leagues/[leagueId]/draft/CommissionerControls";
import type { LeagueMember } from "@/app/types/league";

/**
 * Before the start, the commissioner controls name the members outside the
 * draft order: start_draft drafts positioned members only, so a coach left out
 * would otherwise just watch without anyone noticing.
 */

function member(id: string, teamName: string | null, position: number | null): LeagueMember {
  return { id, league_id: "league", user_id: `user-${id}`, role: "coach", joined_at: null, team_name: teamName, draft_position: position, free_agent_swaps_used: 0 };
}

function render(phase: CommissionerControlsProps["phase"], members: LeagueMember[]) {
  const noop = async () => null;
  return renderToStaticMarkup(createElement(CommissionerControls, {
    phase, leagueName: "Test League", currentPick: 1, startBlock: null, canFinalize: false, finalizeNote: null, lastPick: null, onClock: null,
    membersById: new Map(members.map((each) => [each.id, each] as const)), legalForOnClock: [], pendingAction: null,
    onStart: noop, onPause: noop, onResume: noop, onUndo: noop, onForce: noop, onFinalize: noop, onReset: noop,
  }));
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("members outside the draft order", () => {
  it("names them before the draft starts", () => {
    const html = render("setup", [member("a", "Rockets", 1), member("b", "Pidgeys", 2), member("c", "Watchers", null), member("d", "Latecomers", null)]);
    expect(text(html)).toContain("Not in the draft order, so they will watch: Watchers and Latecomers.");
  });

  it("says nothing when everyone is in the order, or once the draft has started", () => {
    expect(render("setup", [member("a", "Rockets", 1), member("b", "Pidgeys", 2)])).not.toContain("data-draft-unplaced");
    expect(render("live", [member("a", "Rockets", 1), member("b", "Pidgeys", 2), member("c", "Watchers", null)])).not.toContain("data-draft-unplaced");
  });

  it("says nothing before an order of two exists, since the draft cannot start yet", () => {
    expect(render("setup", [member("a", "Rockets", null), member("b", "Pidgeys", null)])).not.toContain("data-draft-unplaced");
    expect(render("setup", [member("a", "Rockets", 1), member("b", "Pidgeys", null)])).not.toContain("data-draft-unplaced");
  });
});
