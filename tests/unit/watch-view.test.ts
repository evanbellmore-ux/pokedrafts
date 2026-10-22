import { describe, expect, it } from "vitest";
import {
  NOT_LIVE,
  buildBrowseView,
  clockSecondsLeft,
  defaultSource,
  formatClock,
  leagueStatus,
  type StreamStatus,
} from "@/app/lib/watch/watch-view";
import type { PublicLeague, PublicLeagueSummary } from "@/app/types/league";

/**
 * What the Watch pages show (app/lib/watch/watch-view.ts): which public
 * leagues count as live and in what order, the replays shown when nothing
 * is, each league's status line, and what the watch page plays first.
 */

function summary(overrides: Partial<PublicLeagueSummary> & { id: string }): PublicLeagueSummary {
  return {
    name: `League ${overrides.id}`,
    coach_count: 8,
    drafting_count: 8,
    max_coaches: 8,
    picks_per_team: 10,
    current_pick_number: 1,
    draft_started: false,
    draft_completed: false,
    draft_paused: false,
    pick_deadline: null,
    on_clock: null,
    last_pick: null,
    regular_played: 0,
    regular_total: 0,
    champion: null,
    stream_url: null,
    replay_links: [],
    last_activity: null,
    ...overrides,
  };
}

const live = (viewers: number | null = null): StreamStatus => ({ ...NOT_LIVE, checked: true, live: true, viewers });

describe("Watch list", () => {
  it("puts on-air streams first (most viewers first), then running drafts, and keeps the rest in list order", () => {
    const leagues = [
      summary({ id: "idle", stream_url: "https://www.twitch.tv/idle" }),
      summary({ id: "drafting", draft_started: true }),
      summary({ id: "small", stream_url: "https://www.twitch.tv/small" }),
      summary({ id: "paused", draft_started: true, draft_paused: true }),
      summary({ id: "big", stream_url: "https://www.youtube.com/@big" }),
      summary({ id: "done", draft_started: true, draft_completed: true }),
    ];
    const view = buildBrowseView(leagues, {
      "https://www.twitch.tv/small": live(12),
      "https://www.youtube.com/@big": live(900),
      "https://www.twitch.tv/idle": { ...NOT_LIVE, checked: true },
    });
    expect(view.live.map((row) => row.id)).toEqual(["big", "small", "drafting"]);
    expect(view.others.map((row) => row.id)).toEqual(["idle", "paused", "done"]);
    expect(view.live[0]).toMatchObject({ streamLive: true, draftLive: false });
    expect(view.live[2]).toMatchObject({ streamLive: false, draftLive: true });
  });

  it("without the platform keys only running drafts are live", () => {
    const view = buildBrowseView(
      [summary({ id: "stream", stream_url: "https://www.twitch.tv/x" }), summary({ id: "drafting", draft_started: true })],
      {},
    );
    expect(view.live.map((row) => row.id)).toEqual(["drafting"]);
  });

  it("lists the newest replays across the leagues, skipping links that no longer parse", () => {
    const view = buildBrowseView(
      [
        summary({
          id: "a",
          replay_links: [
            { title: "A old", url: "https://www.twitch.tv/videos/1", added_at: "2026-10-01T10:00:00Z" },
            { title: "A new", url: "https://www.twitch.tv/videos/2", added_at: "2026-10-20T10:00:00Z" },
          ],
        }),
        summary({
          id: "b",
          replay_links: [
            { title: "B mid", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", added_at: "2026-10-10T10:00:00Z" },
            { title: "B broken", url: "https://example.com/video", added_at: "2026-10-21T10:00:00Z" },
          ],
        }),
      ],
      {},
      2,
    );
    expect(view.replays.map((replay) => [replay.leagueId, replay.title])).toEqual([
      ["a", "A new"],
      ["b", "B mid"],
    ]);
  });
});

describe("status lines", () => {
  it("say where the league is", () => {
    expect(leagueStatus(summary({ id: "s", coach_count: 6 }))).toEqual({
      tone: "idle",
      label: "Setting up",
      detail: "6 of 8 coaches",
    });
    expect(
      leagueStatus(summary({ id: "d", draft_started: true, current_pick_number: 9, on_clock: { team_name: "Rockets" } })),
    ).toEqual({ tone: "live", label: "Drafting now", detail: "Pick 9 of 80 · Rockets on the clock" });
    expect(leagueStatus(summary({ id: "p", draft_started: true, draft_paused: true, current_pick_number: 9 }))).toEqual({
      tone: "paused",
      label: "Draft paused",
      detail: "Pick 9 of 80",
    });
    expect(
      leagueStatus(summary({ id: "r", draft_started: true, draft_completed: true, regular_played: 12, regular_total: 28 })),
    ).toEqual({ tone: "season", label: "In season", detail: "12 of 28 matches played" });
    expect(
      leagueStatus(summary({ id: "c", draft_started: true, draft_completed: true, champion: { team_name: null } })),
    ).toEqual({ tone: "champion", label: "Champion", detail: "Unnamed team" });
  });

  it("lead with the stream while it is on air", () => {
    const row = summary({ id: "l", draft_started: true, current_pick_number: 3, stream_url: "https://www.twitch.tv/x" });
    const [entry] = buildBrowseView([row], { "https://www.twitch.tv/x": live(1500) }).live;
    expect(leagueStatus(row, entry)).toEqual({
      tone: "live",
      label: "Live on Twitch",
      detail: "1,500 watching · Pick 3 of 80",
    });
  });
});

function league(overrides: Partial<PublicLeague>): PublicLeague {
  return {
    id: "l",
    name: "League",
    max_coaches: 4,
    point_budget: 100,
    picks_per_team: 2,
    pick_timer_seconds: 120,
    draft_started: false,
    draft_completed: false,
    current_pick_number: 1,
    pick_started_at: null,
    draft_paused_at: null,
    on_clock_member_id: null,
    schedule_format: "round_robin",
    playoff_format: "none",
    tiebreaker: "head_to_head",
    champion_member_id: null,
    stream_url: null,
    replay_links: [],
    server_time: "2026-10-22T12:00:00Z",
    coaches: [],
    picks: [],
    teams: [],
    matches: [],
    standings: [],
    pokemon: {},
    ...overrides,
  };
}

describe("watch page", () => {
  const replay = { title: "Week 1", url: "https://www.twitch.tv/videos/1" };

  it("plays the stream while it is live, the draft runs or nobody could check, else the newest replay", () => {
    const stream = "https://www.twitch.tv/x";
    expect(defaultSource(league({ stream_url: stream, replay_links: [replay] }), live())).toBe("stream");
    expect(defaultSource(league({ stream_url: stream, replay_links: [replay] }), NOT_LIVE)).toBe("stream");
    expect(defaultSource(league({ stream_url: stream, replay_links: [replay], draft_started: true }), { ...NOT_LIVE, checked: true })).toBe("stream");
    expect(defaultSource(league({ stream_url: stream, replay_links: [replay] }), { ...NOT_LIVE, checked: true })).toBe(0);
    expect(defaultSource(league({ stream_url: stream }), { ...NOT_LIVE, checked: true })).toBe("stream");
    expect(defaultSource(league({ replay_links: [replay] }), NOT_LIVE)).toBe(0);
    expect(defaultSource(league({}), NOT_LIVE)).toBeNull();
  });

  it("counts the clock down from the server's time, only while the draft runs", () => {
    const running = league({ draft_started: true, pick_started_at: "2026-10-22T12:00:00Z", pick_timer_seconds: 120 });
    const at = (iso: string) => Date.parse(iso);
    expect(clockSecondsLeft(running, at("2026-10-22T12:00:37Z"))).toBe(83);
    expect(clockSecondsLeft(running, at("2026-10-22T12:05:00Z"))).toBe(0);
    expect(clockSecondsLeft({ ...running, draft_paused_at: "2026-10-22T12:00:10Z" }, at("2026-10-22T12:00:37Z"))).toBeNull();
    expect(clockSecondsLeft({ ...running, draft_completed: true }, at("2026-10-22T12:00:37Z"))).toBeNull();
    expect(formatClock(83)).toBe("1:23");
    expect(formatClock(5)).toBe("0:05");
  });
});
