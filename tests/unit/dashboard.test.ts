import { describe, expect, it } from "vitest";
import {
  MAX_ROSTER_SLOTS,
  compareLeagues,
  dashboardSummary,
  draftProgress,
  isSpectating,
  leagueHref,
  leagueStatus,
  normalizeInviteCode,
  phaseOf,
  rosterSlots,
  sortMembers,
  teamInitials,
  type DashboardLeague,
  type DashboardMember,
  type LeagueSummary,
} from "@/app/(app)/dashboard/dashboard";

/**
 * Dashboard helpers (app/(app)/dashboard/dashboard.ts): the one status line
 * per league card (docs/release-architecture.md section 12.6), the roster
 * slots, the coach avatars and the join-by-code parsing.
 */

const LEAGUE: LeagueSummary = {
  id: "league-1",
  name: "Kanto Classic",
  commissioner_id: "user-1",
  max_coaches: 8,
  draft_started: false,
  draft_completed: false,
  current_pick_number: 1,
  picks_per_team: 10,
  playoff_format: "none",
  champion_member_id: null,
};

function members(count: number, positioned = true): DashboardMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index + 1}`,
    teamName: `Team ${index + 1}`,
    draftPosition: positioned ? index + 1 : null,
  }));
}

function item(league: Partial<LeagueSummary>, extra: Partial<DashboardLeague> = {}): DashboardLeague {
  const full = { ...LEAGUE, ...league };
  return {
    league: full,
    memberId: "member-1",
    teamName: "Team 1",
    role: "commissioner",
    members: members(4),
    phase: phaseOf(full),
    championTeamName: null,
    roster: [],
    ...extra,
  };
}

describe("phaseOf and the card order", () => {
  it("reads setup, live and complete from the league row", () => {
    expect(phaseOf(LEAGUE)).toBe("setup");
    expect(phaseOf({ ...LEAGUE, draft_started: true })).toBe("live");
    expect(phaseOf({ ...LEAGUE, draft_started: true, draft_completed: true })).toBe("complete");
  });

  it("lists live drafts first, then setup, then finished drafts, each by name", () => {
    const leagues = [
      item({ name: "Zeta", draft_started: true, draft_completed: true }),
      item({ name: "Beta" }),
      item({ name: "Alpha", draft_started: true, draft_completed: true }),
      item({ name: "Omega", draft_started: true }),
    ];
    expect([...leagues].sort(compareLeagues).map((league) => league.league.name)).toEqual([
      "Omega",
      "Beta",
      "Alpha",
      "Zeta",
    ]);
  });

  it("sends a live draft to the draft room and everything else to the overview", () => {
    expect(leagueHref(item({ draft_started: true }))).toBe("/leagues/league-1/draft");
    expect(leagueHref(item({}))).toBe("/leagues/league-1");
  });
});

describe("leagueStatus", () => {
  it("is setup before the draft", () => {
    expect(leagueStatus(item({}))).toEqual({ kind: "setup" });
  });

  it("counts the draft's picks from the coaches in the draft order", () => {
    const live = item(
      { draft_started: true, current_pick_number: 12 },
      { members: [...members(4), { id: "spectator", teamName: "Watcher", draftPosition: null }] }
    );
    const status = leagueStatus(live);
    expect(status).toEqual({ kind: "drafting", pick: 12, totalPicks: 40 });
    if (status.kind === "drafting") expect(draftProgress(status)).toBeCloseTo(11 / 40);
  });

  it("falls back to every member when no draft order is known, and clamps the pick", () => {
    const status = leagueStatus(
      item({ draft_started: true, current_pick_number: 99, picks_per_team: 2 }, { members: members(3, false) })
    );
    expect(status).toEqual({ kind: "drafting", pick: 6, totalPicks: 6 });
  });

  it("reports the playoff size while the season runs", () => {
    const done = { draft_started: true, draft_completed: true };
    expect(leagueStatus(item({ ...done, playoff_format: "top_4" }))).toEqual({
      kind: "season",
      playoffTeams: 4,
    });
    expect(leagueStatus(item({ ...done, playoff_format: "none" }))).toEqual({
      kind: "season",
      playoffTeams: 0,
    });
  });

  it("names the champion and knows when it is the caller's team", () => {
    const done = { draft_started: true, draft_completed: true, playoff_format: "top_4" };
    expect(
      leagueStatus(item({ ...done, champion_member_id: "member-2" }, { championTeamName: "Kenosha Kyle" }))
    ).toEqual({ kind: "champion", teamName: "Kenosha Kyle", mine: false });
    expect(
      leagueStatus(item({ ...done, champion_member_id: "member-1" }, { championTeamName: "Team 1" }))
    ).toEqual({ kind: "champion", teamName: "Team 1", mine: true });
    expect(leagueStatus(item({ ...done, champion_member_id: "gone" }))).toEqual({
      kind: "champion",
      teamName: "Unknown team",
      mine: false,
    });
  });
});

describe("rosterSlots", () => {
  it("shows one slot per pick, filled in pick order", () => {
    expect(rosterSlots(["Pikachu", "Eevee"], 4)).toEqual({
      slots: ["Pikachu", "Eevee", null, null],
      overflow: 0,
    });
  });

  it("folds slots past the cap into a +N chip that keeps the total", () => {
    const roster = Array.from({ length: 14 }, (_, index) => `Mon ${index + 1}`);
    const { slots, overflow } = rosterSlots(roster, 20);
    expect(slots).toHaveLength(MAX_ROSTER_SLOTS - 1);
    expect(slots.every((slot) => slot !== null)).toBe(true);
    expect(slots.length + overflow).toBe(20);
  });

  it("never hides a Pokémon when the roster is longer than the pick count", () => {
    expect(rosterSlots(["A", "B", "C"], 2).slots).toEqual(["A", "B", "C"]);
  });

  it("assumes ten picks when the league row has none", () => {
    expect(rosterSlots([], null).slots).toHaveLength(10);
  });
});

describe("isSpectating", () => {
  it("is false during setup, when the order may not be set yet", () => {
    expect(isSpectating(item({}, { members: members(3, false) }))).toBe(false);
  });

  it("is true once the draft started for a member outside the order with no Pokémon", () => {
    const watcher: DashboardMember = { id: "member-1", teamName: null, draftPosition: null };
    const live = item({ draft_started: true }, { members: [watcher, ...members(2).slice(1)] });
    expect(isSpectating(live)).toBe(true);
    expect(isSpectating({ ...live, roster: ["Pikachu"] })).toBe(false);
    expect(isSpectating(item({ draft_started: true }))).toBe(false);
  });
});

describe("coach avatars", () => {
  it("takes initials from the first two words, or the first two letters", () => {
    expect(teamInitials("Commish Crew")).toBe("CC");
    expect(teamInitials("  evan  ")).toBe("EV");
    expect(teamInitials(null)).toBe("UT");
    expect(teamInitials("Équipe rocket")).toBe("ÉR");
  });

  it("keeps an emoji whole instead of splitting a surrogate pair", () => {
    expect(teamInitials("🔥 Squad")).toBe("🔥S");
  });

  it("orders members by draft position, then by team name", () => {
    const sorted = sortMembers([
      { id: "c", teamName: "Charlie", draftPosition: null },
      { id: "b", teamName: "Bravo", draftPosition: 2 },
      { id: "a", teamName: "alpha", draftPosition: null },
      { id: "d", teamName: "Delta", draftPosition: 1 },
    ]);
    expect(sorted.map((member) => member.id)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("dashboardSummary", () => {
  it("counts leagues, commissioner seats and live drafts, dropping zeros", () => {
    const leagues = [
      item({}),
      item({ id: "2", draft_started: true }),
      item({ id: "3", commissioner_id: "someone-else" }),
    ];
    expect(dashboardSummary(leagues, "user-1")).toBe("3 leagues · commissioner of 2 · 1 drafting now");
    expect(dashboardSummary([leagues[2]], "user-1")).toBe("1 league");
    expect(dashboardSummary([], "user-1")).toBe("0 leagues");
  });
});

describe("normalizeInviteCode", () => {
  it("accepts a bare code or a whole invite link", () => {
    expect(normalizeInviteCode(" k7pz q4xm2b ")).toBe("K7PZQ4XM2B");
    expect(normalizeInviteCode("https://pokedrafts.app/invite/K7PZQ4XM2B?ref=chat")).toBe(
      "K7PZQ4XM2B"
    );
    expect(normalizeInviteCode("HTTPS://POKEDRAFTS.APP/INVITE/K7PZQ4XM2B")).toBe("K7PZQ4XM2B");
  });
});
