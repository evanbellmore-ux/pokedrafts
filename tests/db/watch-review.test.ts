// Watch listings (20261026120000_watch_review.sql): a public league's own
// page works at once, but /watch lists it only after a site admin approves
// it; approval sticks until an admin unlists it. Only a site admin reviews,
// and nobody reads the admin list through the API. The public reads also
// carry the playoffs: each listed league's playoff matches, and each match's
// bracket links on the league's page. Renames since approval
// (20261027120000_watch_renames.sql) keep a league listed but mark it on the
// review list until an admin keeps or unlists it, and a listed league that
// went private stays on that list.
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
  type Participant,
} from "./harness";

type Replay = { title: string; url: string; added_at?: string };
type ReviewRow = {
  id: string;
  name: string;
  created_at: string;
  is_public: boolean;
  commissioner_team: string | null;
  coach_count: number;
  max_coaches: number;
  draft_started: boolean;
  draft_completed: boolean;
  stream_url: string | null;
  replay_links: Replay[];
  watch_listed: boolean;
  watch_reviewed_at: string | null;
  renamed: { league: boolean; teams: string[] } | null;
};
type AdminStatus = { admin: boolean; watch_waiting: number; watch_renamed: number };
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

async function reviewRow(db: Client, admin: string, leagueId: string): Promise<ReviewRow> {
  const row = (await review(db, admin)).find((r) => r.id === leagueId);
  if (!row) throw new Error("expected the league on the review list");
  return row;
}

async function renamedCount(db: Client, admin: string): Promise<number> {
  return (await rpcAs<AdminStatus>(db, admin, "site_admin_status")).watch_renamed;
}

function renameLeague(db: Client, league: LeagueFixture, name: string) {
  return rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { name } });
}

function renameTeam(db: Client, league: LeagueFixture, participant: Participant, name: string) {
  return rpcAs(db, participant.userId, "rename_team", { p_league_id: league.leagueId, p_team_name: name });
}

/** A public league an admin listed. */
async function listedLeague(db: Client, admin: string, name: string, coaches = 1): Promise<LeagueFixture> {
  const league = await buildLeague(db, { coaches, name });
  await setPage(db, league, {});
  await setListing(db, admin, league.leagueId, true);
  return league;
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

  it("the review list holds every public league and every listed private one, waiting first, then listed, then unlisted", async () => {
    const rows = await review(db, admin);
    const ours = rows.filter((r) => [waiting, listed, unlisted, privateLeague].some((f) => f.leagueId === r.id));
    // The private listed league is the newer of the two listed ones.
    expect(ours.map((r) => r.name)).toEqual(["Waiting League", "Private Listed League", "Listed League", "Unlisted League"]);
    const state = (r: ReviewRow) => (r.watch_listed ? 1 : r.watch_reviewed_at === null ? 0 : 2);
    expect(rows.map(state)).toEqual([...rows.map(state)].sort((a, b) => a - b));
    expect(ours[0]).toMatchObject({
      is_public: true,
      commissioner_team: "Commish",
      coach_count: 2,
      max_coaches: 2,
      draft_started: false,
      draft_completed: false,
      stream_url: TWITCH,
      replay_links: [],
      watch_listed: false,
      watch_reviewed_at: null,
      renamed: null,
    });
    expect(ours[1]).toMatchObject({ is_public: false, watch_listed: true, renamed: null });
    expect(ours[2].replay_links.map((r) => r.title)).toEqual(["Week 1"]);
    expect(ours[2]).toMatchObject({ is_public: true, watch_listed: true });
    expect(Number.isNaN(Date.parse(String(ours[3].watch_reviewed_at)))).toBe(false);
    const text = JSON.stringify(ours);
    for (const fixture of [waiting, listed, unlisted, privateLeague]) {
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

describe("watch review: renames since approval", () => {
  let db: Client;
  let admin: string;

  beforeAll(async () => {
    db = await connect();
    admin = await makeAdmin(db);
  });

  afterAll(async () => {
    await db.end();
  });

  it("a league renamed after approval stays on /watch under its new name, marked and counted until an admin keeps it listed", async () => {
    const league = await listedLeague(db, admin, "Approved Name League");
    const before = await renamedCount(db, admin);
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();

    await renameLeague(db, league, "Renamed After Approval");
    expect(await reviewRow(db, admin, league.leagueId)).toMatchObject({
      name: "Renamed After Approval",
      watch_listed: true,
      renamed: { league: true, teams: [] },
    });
    expect(await renamedCount(db, admin)).toBe(before + 1);
    const list = await rpcAs<{ leagues: ListRow[] }>(db, null, "list_public_leagues");
    expect(list.leagues.find((l) => l.id === league.leagueId)?.name).toBe("Renamed After Approval");

    // Keep listed is set_watch_listing(true) again: a new review time.
    await setListing(db, admin, league.leagueId, true);
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();
    expect(await renamedCount(db, admin)).toBe(before);
    expect(await listedIds(db)).toContain(league.leagueId);
  });

  it("team renames after approval list the new names, oldest rename first; unlisting ends the mark", async () => {
    const league = await listedLeague(db, admin, "Team Rename League", 2);
    await renameTeam(db, league, league.coaches[1], "Team Rocket");
    await renameTeam(db, league, league.commissioner, "Aqua");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toEqual({ league: false, teams: ["Team Rocket", "Aqua"] });
    // A second rename of the same team keeps one entry, in its new place.
    await renameTeam(db, league, league.coaches[1], "Team Magma");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toEqual({ league: false, teams: ["Aqua", "Team Magma"] });

    const before = await renamedCount(db, admin);
    await setListing(db, admin, league.leagueId, false);
    expect(await reviewRow(db, admin, league.leagueId)).toMatchObject({ watch_listed: false, renamed: null });
    expect(await renamedCount(db, admin)).toBe(before - 1);
  });

  it("marks nothing for a rename before approval, a save with the same name, or a league that is not listed", async () => {
    const league = await buildLeague(db, { coaches: 1, name: "Early Rename League" });
    await setPage(db, league, {});
    await renameLeague(db, league, "Early Rename League 2");
    await renameTeam(db, league, league.coaches[0], "Early Team");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();
    await setListing(db, admin, league.leagueId, true);
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();

    // The settings form sends the name with every save.
    await renameLeague(db, league, "Early Rename League 2");
    await rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { pick_timer_seconds: 90 } });
    await renameTeam(db, league, league.coaches[0], "Early Team");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();

    await setListing(db, admin, league.leagueId, false);
    await renameLeague(db, league, "Early Rename League 3");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toBeNull();
  });

  it("lists renamed leagues first among the listed ones", async () => {
    const older = await listedLeague(db, admin, "Older Listed League");
    const newer = await listedLeague(db, admin, "Newer Listed League");
    const position = (rows: ReviewRow[], fixture: LeagueFixture) => rows.findIndex((r) => r.id === fixture.leagueId);
    let rows = await review(db, admin);
    expect(position(rows, newer)).toBeLessThan(position(rows, older));

    await renameLeague(db, older, "Older Listed League, renamed");
    rows = await review(db, admin);
    expect(position(rows, older)).toBeLessThan(position(rows, newer));
    const listed = rows.filter((r) => r.watch_listed);
    const firstPlain = listed.findIndex((r) => r.renamed === null);
    expect(listed.slice(firstPlain).every((r) => r.renamed === null)).toBe(true);
  });

  it("stamps through two internal triggers; nobody writes a stamp through the API", async () => {
    const { rows: triggers } = await db.query<{ table: string; tgname: string; fn: string }>(
      `select t.tgrelid::regclass::text as table, t.tgname, p.proname as fn
       from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid in ('public.leagues'::regclass, 'public.league_members'::regclass) and not t.tgisinternal
       order by 1, 2`,
    );
    expect(triggers).toEqual([
      { table: "league_members", tgname: "league_members_team_name_changed", fn: "_stamp_team_name_change" },
      { table: "leagues", tgname: "leagues_name_changed", fn: "_stamp_league_name_change" },
    ]);
    const { rows: grants } = await db.query<{ proname: string; anon: boolean; authenticated: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('_watch_renames', '_stamp_league_name_change', '_stamp_team_name_change')
       order by 1`,
    );
    expect(grants).toEqual([
      { proname: "_stamp_league_name_change", anon: false, authenticated: false },
      { proname: "_stamp_team_name_change", anon: false, authenticated: false },
      { proname: "_watch_renames", anon: false, authenticated: false },
    ]);

    const league = await listedLeague(db, admin, "Stamp Writer League");
    await renameTeam(db, league, league.coaches[0], "Renamed Coach");
    for (const sql of [
      "update public.league_members set team_name_changed_at = null where league_id = $1",
      "update public.leagues set name_changed_at = null where id = $1",
    ]) {
      const { rowCount } = await asUser(db, league.commissioner.userId, (c) => c.query(sql, [league.leagueId]));
      expect(rowCount).toBe(0);
    }
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toEqual({ league: false, teams: ["Renamed Coach"] });
  });
});

describe("watch review: approved leagues that went private", () => {
  let db: Client;
  let admin: string;

  beforeAll(async () => {
    db = await connect();
    admin = await makeAdmin(db);
  });

  afterAll(async () => {
    await db.end();
  });

  it("stay on the review list, marked when renamed but counted only while public, and an admin can unlist them", async () => {
    const league = await listedLeague(db, admin, "Gone Private League");
    await setPage(db, league, { isPublic: false });
    expect(await reviewRow(db, admin, league.leagueId)).toMatchObject({ is_public: false, watch_listed: true, renamed: null });

    const before = await renamedCount(db, admin);
    await renameLeague(db, league, "Gone Private, Renamed");
    expect((await reviewRow(db, admin, league.leagueId)).renamed).toEqual({ league: true, teams: [] });
    expect(await renamedCount(db, admin)).toBe(before);
    await setPage(db, league, {});
    expect(await renamedCount(db, admin)).toBe(before + 1);

    // Unlisted while private: off the review list until it is public, then not listed.
    await setPage(db, league, { isPublic: false });
    await setListing(db, admin, league.leagueId, false);
    expect((await review(db, admin)).map((r) => r.id)).not.toContain(league.leagueId);
    await setPage(db, league, {});
    expect(await listedIds(db)).not.toContain(league.leagueId);
    expect(await reviewRow(db, admin, league.leagueId)).toMatchObject({ is_public: true, watch_listed: false, renamed: null });
  });

  it("a private league that was never approved is not on the review list", async () => {
    const league = await buildLeague(db, { coaches: 1, name: "Never Public League" });
    expect((await review(db, admin)).map((r) => r.id)).not.toContain(league.leagueId);
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
