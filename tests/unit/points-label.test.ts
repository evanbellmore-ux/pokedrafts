import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommissionerControls from "@/app/(app)/leagues/[leagueId]/draft/CommissionerControls";
import DraftBoard from "@/app/(app)/leagues/[leagueId]/draft/DraftBoard";
import DraftPool from "@/app/(app)/leagues/[leagueId]/draft/DraftPool";
import RosterPanel from "@/app/(app)/leagues/[leagueId]/draft/RosterPanel";
import { buildBoard, getTeamBudget } from "@/app/(app)/leagues/[leagueId]/draft/draft-room";
import FreeAgentList from "@/app/(app)/leagues/[leagueId]/free-agents/FreeAgentList";
import SwapDialog from "@/app/(app)/leagues/[leagueId]/free-agents/SwapDialog";
import YourTeamPicker from "@/app/(app)/leagues/[leagueId]/free-agents/YourTeamPicker";
import PoolCards from "@/app/(app)/leagues/[leagueId]/pool/PoolCards";
import SettingsSummary from "@/app/(app)/leagues/[leagueId]/settings/SettingsSummary";
import RosterTable from "@/app/(app)/leagues/[leagueId]/team/RosterTable";
import { pointsLabel, pointsUnit } from "@/app/lib/league/labels";
import type { DraftPick, League, LeagueMember } from "@/app/types/league";

/**
 * One-point Pokémon read "1 pts" in the draft room roster ("Ariados … 1 pts
 * · #18", full two-account draft on production, 2026-10-22), and every
 * other short points label had the same plural: the draft board, the draft
 * pool, the force pick choices, the order strip, the pool page, My Team and
 * the free agent pages. They now go through `pointsLabel` / `pointsUnit`.
 * Card layouts are what render here (`useMinWidthMd` is false on the
 * server); the tables show the bare number under a "Points" heading.
 */

const root = path.resolve(__dirname, "../..");
const ariados = { name: "Ariados", points: 1, tier: 20 };
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

function member(id: string, team: string, position: number): LeagueMember {
  return { id, league_id: "league-1", user_id: `user-${id}`, role: "coach", joined_at: null, team_name: team, draft_position: position, free_agent_swaps_used: 0 };
}

const edge = member("ec", "Edge Challengers", 1);
const testers = member("dt", "Draft Testers", 2);
const coaches = [edge, testers];
const picks: DraftPick[] = [
  { id: "p17", league_id: "league-1", member_id: edge.id, pokemon_name: "Pelipper", points: 5, tier: 16, pick_number: 17, created_at: null },
  { id: "p18", league_id: "league-1", member_id: testers.id, pokemon_name: "Ariados", points: 1, tier: 20, pick_number: 18, created_at: null },
];

describe("points labels", () => {
  it("say pt for exactly one point", () => {
    expect(pointsLabel(1)).toBe("1 pt");
    expect(pointsLabel(0)).toBe("0 pts");
    expect(pointsLabel(12)).toBe("12 pts");
    expect(pointsUnit(1)).toBe("pt");
    expect(pointsUnit(20)).toBe("pts");
  });

  it("draft room roster", () => {
    const budgets = new Map(coaches.map((row) => [row.id, getTeamBudget(row.id, picks, 100, 10)] as const));
    const html = renderToStaticMarkup(createElement(RosterPanel, {
      coaches, picks, picksPerTeam: 10, budgets, selectedId: testers.id, onSelect: () => undefined, myId: edge.id,
    }));
    expect(text(html)).toContain("Ariados1 pt · #18");
    expect(text(html)).not.toMatch(/\b1 pts\b/);
  });

  it("draft room roster budget line, budget of one point", () => {
    const budgets = new Map([[testers.id, getTeamBudget(testers.id, picks, 1, 1)]]);
    const html = renderToStaticMarkup(createElement(RosterPanel, {
      coaches: [testers], picks, picksPerTeam: 1, budgets, selectedId: testers.id, onSelect: () => undefined, myId: edge.id,
    }));
    expect(text(html)).toContain("0 of 1 point left");
  });

  it("draft board", () => {
    const board = buildBoard(picks, coaches, new Map(coaches.map((row) => [row.id, row] as const)), 18);
    const html = text(renderToStaticMarkup(createElement(DraftBoard, { board, loading: false })));
    expect(html).toContain("Draft Testers1 pt");
    expect(html).toContain("Edge Challengers5 pts");
  });

  it("draft pool cards", () => {
    const html = renderToStaticMarkup(createElement(DraftPool, {
      undrafted: [ariados], poolSize: 20, blocks: new Map(), legalCount: 1, isDrafting: true, isMyTurn: false, canPick: false,
      pendingAction: null, onPick: () => undefined, loading: false,
    }));
    expect(text(html)).toContain("1 pt · Tier 20");
  });

  it("force pick choices", () => {
    const noop = async () => null;
    const html = renderToStaticMarkup(createElement(CommissionerControls, {
      phase: "live", leagueName: "Full Draft Test", currentPick: 18, startBlock: null, canFinalize: false, finalizeNote: null,
      lastPick: null, onClock: testers, membersById: new Map(coaches.map((row) => [row.id, row] as const)), legalForOnClock: [ariados],
      pendingAction: null, onStart: noop, onPause: noop, onResume: noop, onUndo: noop, onForce: noop, onFinalize: noop, onReset: noop,
    }));
    expect(html).toContain(">Ariados (1 pt)</option>");
  });

  it("pool page cards", () => {
    const html = renderToStaticMarkup(createElement(PoolCards, {
      rows: [{ index: 0, name: "Ariados", points: 1, tier: 20 }, { index: 1, name: "Garchomp", points: 20, tier: 1 }], editing: false,
    }));
    expect([...html.matchAll(/<span class="ml-1 text-xs font-normal text-muted">([^<]*)<\/span>/g)].map((match) => match[1])).toEqual(["pt", "pts"]);
  });

  it("My Team roster cards", () => {
    const html = renderToStaticMarkup(createElement(RosterTable, {
      roster: [{ ...ariados, pick_number: 18, acquired: "draft" }], label: "Draft Testers roster",
    }));
    expect(text(html)).toContain("1 pt · Tier 20");
  });

  it("free agent list, your team picker and the swap dialog", () => {
    const list = renderToStaticMarkup(createElement(FreeAgentList, {
      items: [ariados], resetKey: "", blockerFor: () => null, onAdd: () => undefined, preparing: null, busy: false, loading: false,
      emptyTitle: "No free agents",
    }));
    expect(text(list)).toContain("1 pt · Tier 20");

    const picker = renderToStaticMarkup(createElement(YourTeamPicker, {
      roster: [{ ...ariados, pick_number: 18 }], selectedKey: null, onSelect: () => undefined, disabled: false, hasOpenSlot: false,
      loading: false,
    }));
    expect(text(picker)).toContain("1 pt · Tier 20");

    const dialog = renderToStaticMarkup(createElement(SwapDialog, {
      move: { add: { name: "Ledian", points: 1, tier: 20 }, drop: { name: "Pelipper", points: 5, tier: 16 }, pointsAfter: 96 },
      budget: 100, swapsRemaining: 2, swapLimit: 3, pending: false, onClose: () => undefined, onConfirm: () => undefined,
    }));
    expect(text(dialog)).toContain("5 pts · Tier 16");
    expect(text(dialog)).toContain("1 pt · Tier 20");
  });

  it("the settings summary's point budget", () => {
    const league: League = {
      id: "league-1", name: "Full Draft Test", commissioner_id: "user-dt", max_coaches: 2, created_at: null, draft_format_id: null,
      point_budget: 1, draft_started: false, current_pick_number: 1, picks_per_team: 1, draft_completed: false, pick_timer_seconds: 120,
      pick_started_at: null, auto_pick_in_progress: false, custom_pool: null, schedule_format: "round_robin", free_agent_swap_limit: 3,
      draft_paused_at: null, tiebreaker: "head_to_head", playoff_format: "none", champion_member_id: null,
    };
    const html = renderToStaticMarkup(createElement(SettingsSummary, { league, members: [], formats: [], currentUserId: "user-ec" }));
    expect(html).toContain(">1 point</dd>");
    expect(renderToStaticMarkup(createElement(SettingsSummary, { league: { ...league, point_budget: 100 }, members: [], formats: [], currentUserId: "user-ec" })))
      .toContain(">100 points</dd>");
  });
});

/** Every .ts/.tsx file under `dir`. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("no hand-written pts", () => {
  it("leaves the plural to pointsLabel / pointsUnit on the pages that show draft points", () => {
    const dirs = ["app/(app)/leagues", "app/(app)/builder", "app/(app)/dashboard", "app/components"];
    const found = dirs.flatMap((dir) => sourceFiles(path.join(root, dir))).flatMap((file) =>
      fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n").flatMap((line, index) => {
        const trimmed = line.trim();
        const comment = /^(\/\/|\/?\*|\{\/\*)/.test(trimmed);
        return !comment && /\bpts\b/.test(line) ? [`${path.relative(root, file)}:${index + 1}: ${trimmed}`] : [];
      })
    );
    expect(found).toEqual([]);
  });
});
