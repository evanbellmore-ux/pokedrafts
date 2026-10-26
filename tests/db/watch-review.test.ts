// Watch listings (20261026120000_watch_review.sql): a public league's own
// page works at once, but /watch lists it only after a site admin approves
// it; approval sticks until an admin unlists it. Only a site admin reviews,
// and nobody reads the admin list through the API. The public reads also
// carry the playoffs: each listed league's playoff matches, and each match's
// bracket links on the league's page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asAuthenticatedNoSub,
  asUser,
  buildLeague,
  connect,
  createUser,
  expectRpcError,
  expectSqlState,
  leagueRow,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
  type LeagueFixture,
} from "./harness";

type Replay = { title: string; url: string; added_at?: string };
type ReviewRow = {
  id: string;
  name: string;
  created_at: string;
  commissioner_team: string | null;
  coach_count: number;
  max_coaches: number;
  draft_started: boolean;
  draft_completed: boolean;
  stream_url: string | null;
  replay_links: Replay[];
  watch_listed: boolean;
  watch_reviewed_at: string | null;
};
type ListRow = Record<string, unknown> & { id: string; playoff_matches: Array<{ round_number: number; status: string }> };
type MatchRow = { id: string; round_number: number; match_number: number; stage: string; status: string; home_member_id: string | null; feeds_match_id: string | null; feeds_slot: string | null };

const TWITCH = "https://www.twitch.tv/pokedrafts";

function setPage(db: Client, league: LeagueFixture, page: { isPublic?: boolean; streamUrl?: string | null; replays?: Replay[] } = {}) {
  return rpcAs(db, league.commissioner.userId, "update_league_public_page", {
    p_league_id: league.leagueId,
    p_is_public: page.isPublic ?? true,
    p_stream_url: page.streamUrl ?? null,
    p_replay_links: JSON.stringify(page.replays ?? []),
  });
}

async function listedIds(db: Client, userId: string | null = null): Promise<string[]> {
  const list = await rpcAs<{ leagues: ListRow[] }>(db, userId, "list_public_leagues");
  return list.leagues.map((l) => l.id);
}

function review(db: Client, userId: string): Promise<ReviewRow[]> {
  return rpcAs<{ server_time: string; leagues: ReviewRow[] }>(db, userId, "list_watch_review").then((r) => r.leagues);
}

function setListing(db: Client, userId: string | null, leagueId: string, listed: boolean | null) {
  return rpcAs<{ id: string; watch_listed: boolean; watch_reviewed_at: string }>(db, userId, "set_watch_listing", {
    p_league_id: leagueId,
    p_listed: listed,
  });
}

async function makeAdmin(db: Client): Promise<string> {
  const userId = await createUser(db);
  await db.query("insert into public.site_admins (user_id) values ($1)", [userId]);
  return userId;
}

describe("watch review: who reviews", () => {
  let db: Client;
  let admin: string;
  let league: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    admin = await makeAdmin(db);
    league = await buildLeague(db, { coaches: 1, name: "Review Gate League" });
    await setPage(db, league, { streamUrl: TWITCH });
  });

  afterAll(async () => {
    await db.end();
  });

  it("only a site admin may list, unlist or read the review list", async () => {
    const outsider = await createUser(db);
    for (const caller of [league.commissioner.userId, league.coaches[0].userId, outsider]) {
      await expectRpcError(review(db, caller), "not_site_admin");
      await expectRpcError(setListing(db, caller, league.leagueId, true), "not_site_admin");
    }
    await expectRpcError(
      asAuthenticatedNoSub(db, (c) => rpc(c, "set_watch_listing", { p_league_id: league.leagueId, p_listed: true })),
      "not_authenticated",
    );
    await expectRpcError(asAuthenticatedNoSub(db, (c) => rpc(c, "list_watch_review")), "not_authenticated");
    // Signed out: the three admin functions are not granted to anon at all.
    for (const fn of ["list_watch_review", "site_admin_status"]) {
      await expectSqlState(asAnon(db, (c) => rpc(c, fn)), "42501");
    }
    await expectSqlState(setListing(db, null, league.leagueId, true), "42501");
    expect((await leagueRow(db, league.leagueId)).watch_listed).toBe(false);
  });

  it("site_admin_status: false for everyone else, the waiting count for an admin", async () => {
    for (const caller of [league.commissioner.userId, league.coaches[0].userId]) {
      expect(await rpcAs(db, caller, "site_admin_status")).toEqual({ admin: false });
    }
    expect(await asAuthenticatedNoSub(db, (c) => rpc(c, "site_admin_status"))).toEqual({ admin: false });
    const before = await rpcAs<{ admin: boolean; watch_waiting: number }>(db, admin, "site_admin_status");
    expect(before.admin).toBe(true);
    const another = await buildLeague(db, { coaches: 1, name: "Another Waiting League" });
    await setPage(db, another);
    const after = await rpcAs<{ admin: boolean; watch_waiting: number }>(db, admin, "site_admin_status");
    expect(after.watch_waiting).toBe(before.watch_waiting + 1);
    // Reviewed either way, it no longer waits.
    await setListing(db, admin, another.leagueId, false);
    expect((await rpcAs<{ watch_waiting: number }>(db, admin, "site_admin_status")).watch_waiting).toBe(before.watch_waiting);
  });

  it("refuses a missing choice and an unknown league", async () => {
    await expectRpcError(setListing(db, admin, league.leagueId, null), "invalid_listing");
    await expectRpcError(setListing(db, admin, "00000000-0000-4000-8000-000000000000", true), "league_not_found");
  });

  it("keeps the admin list closed to every API role, an admin's own account included", async () => {
    for (const caller of [null, admin, league.commissioner.userId]) {
      await expectSqlState(asUser(db, caller, (c) => c.query("select user_id from public.site_admins")), "42501");
      await expectSqlState(
        asUser(db, caller, (c) => c.query("insert into public.site_admins (user_id) values ($1)", [league.commissioner.userId])),
        "42501",
      );
    }
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.site_admins'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it("a commissioner cannot list their own league by writing the row", async () => {
    const { rowCount } = await asUser(db, league.commissioner.userId, (c) =>
      c.query("update public.leagues set watch_listed = true, watch_reviewed_at = now() where id = $1", [league.leagueId]),
    );
    expect(rowCount).toBe(0);
    expect(await listedIds(db)).not.toContain(league.leagueId);
  });
});

describe("watch review: the list and the page", () => {
  let db: Client;
  let admin: string;
  let waiting: LeagueFixture;
  let listed: LeagueFixture;
  let unlisted: LeagueFixture;
  let privateLeague: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    admin = await makeAdmin(db);
    waiting = await buildLeague(db, { coaches: 1, name: "Waiting League" });
    listed = await buildLeague(db, { coaches: 2, name: "Listed League" });
    unlisted = await buildLeague(db, { coaches: 1, name: "Unlisted League" });
    privateLeague = await buildLeague(db, { coaches: 1, name: "Private Listed League" });
    await setPage(db, waiting, { streamUrl: TWITCH });
    await setPage(db, listed, { replays: [{ title: "Week 1", url: "https://www.twitch.tv/videos/1" }] });
    await setPage(db, unlisted, { streamUrl: "https://www.youtube.com/@pokedrafts" });
    await setListing(db, admin, listed.leagueId, true);
    await setListing(db, admin, unlisted.leagueId, true);
    await setListing(db, admin, unlisted.leagueId, false);
    await setListing(db, admin, privateLeague.leagueId, true);
  });

  afterAll(async () => {
    await db.end();
  });

  it("a new public league waits: its page works, /watch leaves it out", async () => {
    const row = await leagueRow(db, waiting.leagueId);
    expect(row).toMatchObject({ is_public: true, watch_listed: false, watch_reviewed_at: null });
    const page = await rpcAs<Record<string, unknown> | null>(db, null, "get_public_league", { p_league_id: waiting.leagueId });
    expect(page).toMatchObject({ id: waiting.leagueId, stream_url: TWITCH, watch_listed: false });
    const ids = await listedIds(db);
    expect(ids).toContain(listed.leagueId);
    for (const fixture of [waiting, unlisted, privateLeague]) {
      expect(ids).not.toContain(fixture.leagueId);
    }
    expect(await listedIds(db, waiting.commissioner.userId)).toEqual(ids);
  });

  it("the review list holds every public league, waiting first, then listed, then unlisted", async () => {
    const rows = await review(db, admin);
    const ours = rows.filter((r) => [waiting, listed, unlisted, privateLeague].some((f) => f.leagueId === r.id));
    expect(ours.map((r) => r.name)).toEqual(["Waiting League", "Listed League", "Unlisted League"]);
    const state = (r: ReviewRow) => (r.watch_listed ? 1 : r.watch_reviewed_at === null ? 0 : 2);
    expect(rows.map(state)).toEqual([...rows.map(state)].sort((a, b) => a - b));
    expect(ours[0]).toMatchObject({
      commissioner_team: "Commish",
      coach_count: 2,
      max_coaches: 2,
      draft_started: false,
      draft_completed: false,
      stream_url: TWITCH,
      replay_links: [],
      watch_listed: false,
      watch_reviewed_at: null,
    });
    expect(ours[1].replay_links.map((r) => r.title)).toEqual(["Week 1"]);
    expect(ours[1].watch_listed).toBe(true);
    expect(Number.isNaN(Date.parse(String(ours[2].watch_reviewed_at)))).toBe(false);
    const text = JSON.stringify(ours);
    for (const fixture of [waiting, listed, unlisted]) {
      for (const participant of fixture.order) expect(text).not.toContain(participant.userId);
      expect(text).not.toContain(fixture.inviteCode);
    }
  });

  it("approval sticks through new links and a trip to private; unlisting holds until listed again", async () => {
    await setPage(db, listed, { streamUrl: "https://www.twitch.tv/someoneelse", replays: [{ title: "New", url: "https://www.twitch.tv/videos/2" }] });
    expect(await listedIds(db)).toContain(listed.leagueId);
    await setPage(db, listed, { isPublic: false });
    expect(await listedIds(db)).not.toContain(listed.leagueId);
    await setPage(db, listed, {});
    expect(await listedIds(db)).toContain(listed.leagueId);

    // Unlisted stays off whatever the commissioner saves.
    await setPage(db, unlisted, { streamUrl: TWITCH });
    expect(await listedIds(db)).not.toContain(unlisted.leagueId);
    const relisted = await setListing(db, admin, unlisted.leagueId, true);
    expect(relisted).toMatchObject({ id: unlisted.leagueId, watch_listed: true });
    expect(await listedIds(db)).toContain(unlisted.leagueId);

    // A listed league that is private stays off both, and comes back listed.
    expect(await listedIds(db)).not.toContain(privateLeague.leagueId);
    expect(await rpcAs(db, null, "get_public_league", { p_league_id: privateLeague.leagueId })).toBeNull();
    await setPage(db, privateLeague, {});
    expect(await listedIds(db)).toContain(privateLeague.leagueId);
  });
});

describe("watch review: the playoffs in the public reads", () => {
  let db: Client;
  let admin: string;
  let league: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    admin = await makeAdmin(db);
    league = await buildLeague(db, { coaches: 3, picksPerTeam: 1, pool: samplePool(8), playoffFormat: "top_4", name: "Bracket League" });
    await runFullDraft(db, league);
    await setPage(db, league, {});
    await setListing(db, admin, league.leagueId, true);
  });

  afterAll(async () => {
    await db.end();
  });

  async function matches(): Promise<MatchRow[]> {
    const { rows } = await db.query<MatchRow>(
      "select id, round_number, match_number, stage, status, home_member_id, feeds_match_id, feeds_slot from public.league_matches where league_id = $1 order by round_number, match_number",
      [league.leagueId],
    );
    return rows;
  }

  async function listRow(): Promise<ListRow> {
    const list = await rpcAs<{ leagues: ListRow[] }>(db, null, "list_public_leagues");
    const row = list.leagues.find((l) => l.id === league.leagueId);
    if (!row) throw new Error("expected the listed league");
    return row;
  }

  it("lists no playoff matches before the bracket exists", async () => {
    expect((await listRow()).playoff_matches).toEqual([]);
  });

  it("lists the bracket's matches by round once the season ends, and the page its links", async () => {
    for (const match of (await matches()).filter((m) => m.stage === "regular")) {
      await rpcAs(db, league.commissioner.userId, "report_match_result", {
        p_match_id: match.id,
        p_winner_member_id: match.home_member_id,
        p_winner_remaining: null,
      });
    }
    const playoff = (await matches()).filter((m) => m.stage === "playoff");
    expect(playoff).toHaveLength(3);
    const row = await listRow();
    expect(row).toMatchObject({ regular_played: row.regular_total, champion: null });
    expect(row.playoff_matches).toEqual(playoff.map((m) => ({ round_number: m.round_number, status: "upcoming" })));

    const page = await rpcAs<{ matches: Array<Record<string, unknown>> }>(db, null, "get_public_league", { p_league_id: league.leagueId });
    const semifinal = page.matches.find((m) => m.id === playoff[0].id);
    expect(semifinal).toMatchObject({ stage: "playoff", feeds_match_id: playoff[2].id, feeds_slot: "home" });
    expect(page.matches.find((m) => m.id === playoff[1].id)).toMatchObject({ feeds_match_id: playoff[2].id, feeds_slot: "away" });
    expect(page.matches.find((m) => m.id === playoff[2].id)).toMatchObject({ feeds_match_id: null, feeds_slot: null });

    await rpcAs(db, league.commissioner.userId, "report_match_result", {
      p_match_id: playoff[0].id,
      p_winner_member_id: playoff[0].home_member_id,
      p_winner_remaining: 2,
    });
    expect((await listRow()).playoff_matches.map((m) => m.status)).toEqual(["completed", "upcoming", "upcoming"]);
  });
});
