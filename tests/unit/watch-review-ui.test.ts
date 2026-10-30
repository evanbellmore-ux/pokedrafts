import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMenuLink } from "@/app/components/AppNav";
import AdminPage from "@/app/(app)/admin/page";
import WatchReviewClient, { REVIEW_GROUPS, ReviewRow, renamesLine } from "@/app/(app)/admin/WatchReviewClient";
import PublicBracket, { bracketMatches } from "@/app/watch/[leagueId]/PublicBracket";
import WatchLeagueClient from "@/app/watch/[leagueId]/WatchLeagueClient";
import { NOT_LIVE } from "@/app/lib/watch/watch-view";
import type { PublicLeague, PublicMatch, WatchReviewLeague } from "@/app/types/league";
import { capture, textOf } from "../fixtures/jsx-capture";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("next/link", () => ({ default: "a" }));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: navigation.notFound,
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
const server = vi.hoisted(() => ({ status: { data: null as unknown, error: null as string | null } }));
vi.mock("@/app/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/app/lib/rpc", async (original) => ({
  ...(await original<typeof import("@/app/lib/rpc")>()),
  createRpc: () => ({ siteAdminStatus: async () => server.status }),
}));

// The /watch review (docs/release-architecture.md section 16) and the playoffs on a league's watch page.

const coaches = [
  { id: "m1", team_name: "Rockets", draft_position: 1 },
  { id: "m2", team_name: "Magma", draft_position: 2 },
  { id: "m3", team_name: "Aqua", draft_position: 3 },
  { id: "m4", team_name: "Galactic", draft_position: 4 },
];

function match(overrides: Partial<PublicMatch> & Pick<PublicMatch, "id" | "round_number" | "match_number">): PublicMatch {
  return {
    stage: "playoff",
    status: "upcoming",
    home_member_id: null,
    away_member_id: null,
    winner_member_id: null,
    winner_remaining: null,
    home_seed: null,
    away_seed: null,
    feeds_match_id: null,
    feeds_slot: null,
    ...overrides,
  };
}

// top_4 after a six-round season: semifinal 1 decided, semifinal 2 to play, the final waiting.
const TOP_4: PublicMatch[] = [
  match({ id: "r6", round_number: 6, match_number: 1, stage: "regular", status: "completed", home_member_id: "m1", away_member_id: "m2", winner_member_id: "m1" }),
  match({ id: "sf1", round_number: 7, match_number: 1, status: "completed", home_member_id: "m1", away_member_id: "m4", home_seed: 1, away_seed: 4, winner_member_id: "m1", winner_remaining: 2, feeds_match_id: "f", feeds_slot: "home" }),
  match({ id: "sf2", round_number: 7, match_number: 2, home_member_id: "m2", away_member_id: "m3", home_seed: 2, away_seed: 3, feeds_match_id: "f", feeds_slot: "away" }),
  match({ id: "f", round_number: 8, match_number: 1, home_member_id: "m1", home_seed: 1 }),
];

function publicLeague(overrides: Partial<PublicLeague> = {}): PublicLeague {
  return {
    id: "league-1",
    name: "Nothing But Draft League",
    max_coaches: 4,
    point_budget: 100,
    picks_per_team: 1,
    pick_timer_seconds: 120,
    draft_started: true,
    draft_completed: true,
    current_pick_number: 5,
    pick_started_at: null,
    draft_paused_at: null,
    on_clock_member_id: null,
    schedule_format: "round_robin",
    playoff_format: "top_4",
    tiebreaker: "head_to_head",
    champion_member_id: null,
    stream_url: null,
    replay_links: [],
    watch_listed: true,
    server_time: "2026-10-26T12:00:00Z",
    coaches,
    picks: [],
    teams: [],
    matches: TOP_4,
    standings: [],
    pokemon: {},
    ...overrides,
  };
}

describe("the bracket on a league's watch page", () => {
  it("names the rounds and matches, fills decided slots and points empty ones at their feeder", () => {
    const html = renderToStaticMarkup(createElement(PublicBracket, { league: publicLeague() }));
    expect(html).toContain(">Playoffs</h2>");
    expect(html).toContain("Semifinals · 1 of 2 played");
    expect(html.indexOf(">Semifinals</h3>")).toBeLessThan(html.indexOf(">Final</h3>"));
    expect(html).toContain("Semifinal 1");
    expect(html).toContain("Winner of Semifinal 2");
    expect(html).toContain("2 left standing");
    expect(html).toContain('<span class="sr-only">Winner</span>');
    // The final has one side waiting; a decided semifinal reads Final, an open one Upcoming.
    expect(html).toContain(">Waiting</span>");
    expect(html).toContain(">Upcoming</span>");
    for (const team of ["Rockets", "Magma", "Aqua", "Galactic"]) expect(html).toContain(team);
    // The regular season is not part of it.
    expect(html).not.toContain("Round 6");
  });

  it("lists the top seeds' byes in the round they sit out, and names the champion once crowned", () => {
    const top6: PublicMatch[] = [
      match({ id: "q1", round_number: 4, match_number: 1, home_member_id: "m4", away_member_id: "m1", home_seed: 4, away_seed: 5, feeds_match_id: "s1", feeds_slot: "away" }),
      match({ id: "q2", round_number: 4, match_number: 2, home_member_id: "m3", away_member_id: "m2", home_seed: 3, away_seed: 6, feeds_match_id: "s2", feeds_slot: "away" }),
      match({ id: "s1", round_number: 5, match_number: 1, home_member_id: "m1", home_seed: 1, feeds_match_id: "f", feeds_slot: "home" }),
      match({ id: "s2", round_number: 5, match_number: 2, home_member_id: "m2", home_seed: 2, feeds_match_id: "f", feeds_slot: "away" }),
      match({ id: "f", round_number: 6, match_number: 1 }),
    ];
    const html = renderToStaticMarkup(createElement(PublicBracket, { league: publicLeague({ matches: top6 }) }));
    expect(html).toContain(">Quarterfinals</h3>");
    expect(html).toContain("Quarterfinals · 0 of 2 played");
    expect(html.match(/Bye:/g)).toHaveLength(2);
    const crowned = renderToStaticMarkup(createElement(PublicBracket, { league: publicLeague({ champion_member_id: "m2" }) }));
    expect(crowned).toContain("Champion: Magma");
  });

  it("without the bracket links (a database before the review file) lists no byes and leaves empty slots to be decided", () => {
    const bare = TOP_4.map((row) => {
      const copy = { ...row };
      delete copy.feeds_match_id;
      delete copy.feeds_slot;
      return copy;
    });
    expect(bracketMatches(bare).every((row) => row.feeds_match_id === null && row.feeds_slot === null)).toBe(true);
    const html = renderToStaticMarkup(createElement(PublicBracket, { league: publicLeague({ matches: bare }) }));
    expect(html).toContain("To be decided");
    expect(html).not.toContain("Bye");
    expect(html).not.toContain("Winner of");
  });

  it("opens on the bracket once there is one, names the playoffs in the status line, and offers Standings and the board", () => {
    const { result: html, elements } = capture(() =>
      renderToStaticMarkup(createElement(WatchLeagueClient, { initial: publicLeague(), status: NOT_LIVE })),
    );
    expect(html).toContain("Playoffs");
    expect(html).toContain("Semifinals · 1 of 2 played");
    const toggles = elements.filter((element) => element.type === "button" && element.props["aria-pressed"] !== undefined);
    expect(toggles.map((button) => [textOf(button.props.children), button.props["aria-pressed"]])).toEqual([
      ["Playoffs", true],
      ["Standings", false],
      ["Draft board", false],
    ]);
    expect(html).toContain('id="watch-bracket-heading"');
    // Without a bracket the standings come first, as before.
    const regular = capture(() =>
      renderToStaticMarkup(createElement(WatchLeagueClient, { initial: publicLeague({ matches: TOP_4.slice(0, 1), playoff_format: "none" }), status: NOT_LIVE })),
    );
    expect(regular.elements.filter((element) => element.props["aria-pressed"] !== undefined).map((button) => textOf(button.props.children))).toEqual([
      "Standings",
      "Draft board",
    ]);
    expect(regular.result).toContain('id="watch-standings-heading"');
  });
});

describe("the admin's Watch listings", () => {
  beforeEach(() => {
    navigation.notFound.mockClear();
  });

  it("is a 404 for anyone but a site admin, and the review list for an admin", async () => {
    for (const status of [{ data: { admin: false }, error: null }, { data: null, error: "This feature is not available yet." }]) {
      server.status = status;
      await expect(AdminPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    }
    expect(navigation.notFound).toHaveBeenCalledTimes(2);
    server.status = { data: { admin: true, watch_waiting: 3 }, error: null };
    const page = await AdminPage();
    expect(page.type).toBe(WatchReviewClient);
  });

  it("groups the leagues waiting, listed, then not listed", () => {
    expect(REVIEW_GROUPS.map((group) => [group.state, group.title])).toEqual([
      ["waiting", "Waiting for review"],
      ["listed", "Listed on Watch"],
      ["unlisted", "Not listed"],
    ]);
  });

  const row: WatchReviewLeague = {
    id: "league-1",
    name: "Nothing But Draft League",
    created_at: "2026-10-01T12:00:00Z",
    commissioner_team: "Rockets",
    coach_count: 3,
    max_coaches: 8,
    draft_started: true,
    draft_completed: false,
    stream_url: "https://www.twitch.tv/pokedrafts",
    replay_links: [{ title: "Draft night", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", added_at: "2026-10-02T12:00:00Z" }],
    watch_listed: false,
    watch_reviewed_at: null,
    is_public: true,
    renamed: null,
  };
  const renderRow = (state: "waiting" | "listed" | "unlisted", pending: boolean | null = null, league: WatchReviewLeague = row) => {
    const onReview = vi.fn();
    const { result: html, elements } = capture(() =>
      renderToStaticMarkup(createElement(ReviewRow, { league, state, busy: pending !== null, pending, onReview })),
    );
    const buttons = elements.filter((element) => element.type === "button");
    return { html, buttons, onReview };
  };

  it("shows what a league would put on Watch, with its page, stream and replays as links", () => {
    const { html } = renderRow("waiting");
    expect(html).toContain('href="/watch/league-1"');
    expect(html).toContain("Rockets runs it · 3 of 8 coaches · Drafting");
    expect(html).toContain('href="https://www.twitch.tv/pokedrafts" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("twitch.tv/pokedrafts");
    expect(html).toContain("1 replay");
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain("Draft night");
  });

  it("offers Approve and Decline while waiting, Unlist once listed, Approve when not listed", () => {
    const waiting = renderRow("waiting");
    expect(waiting.buttons.map((button) => button.props["aria-label"])).toEqual(["Approve Nothing But Draft League", "Decline Nothing But Draft League"]);
    (waiting.buttons[0].props.onClick as () => void)();
    (waiting.buttons[1].props.onClick as () => void)();
    expect(waiting.onReview.mock.calls).toEqual([[true], [false]]);

    const listed = renderRow("listed");
    expect(listed.buttons.map((button) => textOf(button.props.children))).toEqual(["Unlist"]);
    (listed.buttons[0].props.onClick as () => void)();
    expect(listed.onReview).toHaveBeenCalledWith(false);

    const unlisted = renderRow("unlisted");
    expect(unlisted.buttons.map((button) => textOf(button.props.children))).toEqual(["Approve"]);

    // While one moves, every button waits; the pressed one says what it is doing.
    const declining = renderRow("waiting", false);
    expect(declining.buttons.every((button) => button.props.disabled === true)).toBe(true);
    expect(declining.html).toContain("Declining...");
    expect(declining.html).not.toContain("Approving...");
  });

  it("marks a listed league renamed since approval with its new names, and offers Keep listed and Unlist", () => {
    const listed = { ...row, watch_listed: true, watch_reviewed_at: "2026-10-03T12:00:00Z" };
    const renamed = renderRow("listed", null, { ...listed, renamed: { league: true, teams: ["Team Rocket", "Aqua"] } });
    expect(renamed.html).toContain("Renamed since approval");
    expect(renamed.html).toContain("New league name · New team names: Team Rocket, Aqua");
    expect(renamed.buttons.map((button) => button.props["aria-label"])).toEqual(["Keep Nothing But Draft League listed", "Unlist Nothing But Draft League"]);
    (renamed.buttons[0].props.onClick as () => void)();
    (renamed.buttons[1].props.onClick as () => void)();
    expect(renamed.onReview.mock.calls).toEqual([[true], [false]]);
    expect(renderRow("listed", true, { ...listed, renamed: { league: false, teams: ["Aqua"] } }).html).toContain("Keeping...");

    // Not renamed, or a database without the renames file: no mark, Unlist only.
    for (const league of [listed, { ...listed, renamed: undefined, is_public: undefined }]) {
      const plain = renderRow("listed", null, league);
      expect(plain.html).not.toContain("Renamed since approval");
      expect(plain.html).not.toContain("Private");
      expect(plain.buttons.map((button) => textOf(button.props.children))).toEqual(["Unlist"]);
    }
    // Renames only mark a listed league.
    expect(renderRow("unlisted", null, { ...row, watch_reviewed_at: "2026-10-03T12:00:00Z", renamed: { league: true, teams: [] } }).html).not.toContain("Renamed since approval");
  });

  it("says a listed league that is private now is off Watch, and still offers Unlist", () => {
    const { html, buttons } = renderRow("listed", null, { ...row, watch_listed: true, watch_reviewed_at: "2026-10-03T12:00:00Z", is_public: false });
    expect(html).toContain("Private");
    expect(html).toContain("Off Watch until it is public again.");
    expect(buttons.map((button) => textOf(button.props.children))).toEqual(["Unlist"]);
  });

  it("writes the renames as one line", () => {
    expect(renamesLine({ league: true, teams: [] })).toBe("New league name");
    expect(renamesLine({ league: false, teams: ["Aqua"] })).toBe("New team name: Aqua");
    expect(renamesLine({ league: true, teams: ["Team Rocket", "Aqua"] })).toBe("New league name · New team names: Team Rocket, Aqua");
  });

  it("links a site admin to it from the account menu, with the count to review", () => {
    const html = renderToStaticMarkup(createElement(AdminMenuLink, { toReview: 2 }));
    expect(html).toMatch(/<a [^>]*href="\/admin"/);
    expect(html).toContain("Watch listings");
    expect(html).toContain("2 to review");
    expect(renderToStaticMarkup(createElement(AdminMenuLink, { toReview: 0 }))).not.toContain("to review");
  });
});
