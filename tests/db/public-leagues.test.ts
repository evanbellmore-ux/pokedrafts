// Public leagues (20261022120000_public_leagues.sql): the commissioner's
// update_league_public_page, and the two reads anyone may call,
// list_public_leagues and get_public_league. A private league must read
// exactly like a missing one, and nothing a public league hands out may name
// a coach's account, the invite code, the pool or the chat. The list holds
// only leagues a site admin listed (20261026120000_watch_review.sql, covered
// in watch-review.test.ts), so the list's fixtures are listed first.
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
  onClockMember,
  rolledBack,
  rpc,
  rpcAs,
  runFullDraft,
  type Client,
  type LeagueFixture,
} from "./harness";
import { parseReplayLink, parseStreamLink } from "../../app/lib/watch/stream-links";

type Replay = { title: string; url: string; added_at: string };
type PublicPage = { is_public: boolean; stream_url: string | null; replay_links: Replay[] };
type PublicLeague = Record<string, unknown> & {
  id: string;
  name: string;
  coaches: Array<Record<string, unknown>>;
  picks: Array<{ pick_number: number; member_id: string; pokemon_name: string; points: number }>;
  teams: Array<{ member_id: string; pokemon: Array<{ name: string }>; total_points: number }>;
  matches: Array<Record<string, unknown>>;
  standings: Array<Record<string, unknown>>;
  pokemon: Record<string, { sprite_url: string | null; type1: string | null; type2: string | null }>;
  on_clock_member_id: string | null;
  stream_url: string | null;
  replay_links: Replay[];
};
type PublicList = { server_time: string; leagues: Array<Record<string, unknown> & { id: string }> };

const TWITCH = "https://www.twitch.tv/pokedrafts";

function setPage(
  db: Client,
  userId: string | null,
  leagueId: string,
  page: { isPublic?: boolean | null; streamUrl?: string | null; replays?: unknown },
): Promise<PublicPage> {
  return rpcAs<PublicPage>(db, userId, "update_league_public_page", {
    p_league_id: leagueId,
    p_is_public: page.isPublic === undefined ? true : page.isPublic,
    p_stream_url: page.streamUrl ?? null,
    // node-postgres sends a JS array as a Postgres array literal, so the list
    // goes over as JSON text.
    p_replay_links: JSON.stringify(page.replays === undefined ? [] : page.replays),
  });
}

function getPublic(db: Client, userId: string | null, leagueId: string): Promise<PublicLeague | null> {
  return rpcAs<PublicLeague | null>(db, userId, "get_public_league", { p_league_id: leagueId });
}

function listPublic(db: Client, userId: string | null): Promise<PublicList> {
  return rpcAs<PublicList>(db, userId, "list_public_leagues");
}

describe("public leagues: update_league_public_page", () => {
  let db: Client;
  let league: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    league = await buildLeague(db, { coaches: 2, name: "Public Page League" });
  });

  afterAll(async () => {
    await db.end();
  });

  it("a new league is private, with no stream and no replays", async () => {
    const row = await leagueRow(db, league.leagueId);
    expect(row.is_public).toBe(false);
    expect(row.stream_url).toBeNull();
    expect(row.replay_links).toEqual([]);
  });

  it("the commissioner saves the public flag, the stream and the replays in one call", async () => {
    const saved = await setPage(db, league.commissioner.userId, league.leagueId, {
      streamUrl: `  ${TWITCH}  `,
      replays: [
        { title: "  Draft night  ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s" },
        { title: "Week 1", url: "https://www.twitch.tv/videos/2345678901?t=0h1m30s" },
        { title: "Best pick", url: "https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage-a1B2_c3" },
      ],
    });
    expect(saved.is_public).toBe(true);
    expect(saved.stream_url).toBe(TWITCH);
    expect(saved.replay_links.map((r) => [r.title, r.url])).toEqual([
      ["Draft night", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"],
      ["Week 1", "https://www.twitch.tv/videos/2345678901?t=0h1m30s"],
      ["Best pick", "https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage-a1B2_c3"],
    ]);
    for (const replay of saved.replay_links) {
      expect(Number.isNaN(Date.parse(replay.added_at)), replay.added_at).toBe(false);
    }

    const row = await leagueRow(db, league.leagueId);
    expect(row.is_public).toBe(true);
    expect(row.stream_url).toBe(TWITCH);
    expect(row.replay_links).toEqual(saved.replay_links);
  });

  it("a replay that stays listed keeps the time it was first added; a new one gets its own", async () => {
    const first = await setPage(db, league.commissioner.userId, league.leagueId, {
      streamUrl: TWITCH,
      replays: [{ title: "Week 1", url: "https://www.twitch.tv/videos/111" }],
    });
    await db.query("select pg_sleep(0.05)");
    const second = await setPage(db, league.commissioner.userId, league.leagueId, {
      streamUrl: TWITCH,
      replays: [
        { title: "Week 2", url: "https://www.twitch.tv/videos/222" },
        { title: "Week 1 (renamed)", url: "https://www.twitch.tv/videos/111" },
      ],
    });
    expect(second.replay_links[1]).toEqual({
      title: "Week 1 (renamed)",
      url: "https://www.twitch.tv/videos/111",
      added_at: first.replay_links[0].added_at,
    });
    expect(Date.parse(second.replay_links[0].added_at)).toBeGreaterThan(Date.parse(first.replay_links[0].added_at));
  });

  it("a blank stream link means no stream, and making the league private keeps its links", async () => {
    const cleared = await setPage(db, league.commissioner.userId, league.leagueId, {
      isPublic: false,
      streamUrl: "   ",
      replays: [{ title: "Week 1", url: "https://www.twitch.tv/videos/111" }],
    });
    expect(cleared).toMatchObject({ is_public: false, stream_url: null });
    expect(cleared.replay_links).toHaveLength(1);
    const row = await leagueRow(db, league.leagueId);
    expect(row.is_public).toBe(false);
    expect(row.stream_url).toBeNull();
  });

  it("only the commissioner may save, and only when signed in", async () => {
    const outsider = await createUser(db);
    await expectRpcError(setPage(db, league.coaches[0].userId, league.leagueId, {}), "not_commissioner");
    await expectRpcError(setPage(db, outsider, league.leagueId, {}), "not_commissioner");
    await expectRpcError(
      asAuthenticatedNoSub(db, (c) =>
        rpc(c, "update_league_public_page", {
          p_league_id: league.leagueId,
          p_is_public: true,
          p_stream_url: null,
          p_replay_links: "[]",
        }),
      ),
      "not_authenticated",
    );
    await expectSqlState(setPage(db, null, league.leagueId, {}), "42501");
    await expectRpcError(
      setPage(db, league.commissioner.userId, "00000000-0000-4000-8000-000000000000", {}),
      "league_not_found",
    );
  });

  it("refuses a missing public flag and stream links of any other shape", async () => {
    const commissioner = league.commissioner.userId;
    await expectRpcError(setPage(db, commissioner, league.leagueId, { isPublic: null }), "invalid_public_setting");
    for (const bad of [
      "https://evil.example/pokedrafts",
      "javascript:alert(1)",
      "twitch.tv/pokedrafts",
      "https://twitch.tv/pokedrafts",
      "https://www.twitch.tv/PokeDrafts",
      "https://www.twitch.tv/pokedrafts/videos",
      "https://www.twitch.tv/videos/12345",
      "https://www.youtube.com/@x",
      "https://www.youtube.com/channel/UCshort",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
      `https://www.twitch.tv/${"a".repeat(26)}`,
    ]) {
      const error = await expectRpcError(setPage(db, commissioner, league.leagueId, { streamUrl: bad }), "invalid_stream_link");
      expect(error.message).toContain("Twitch channel");
    }
    const row = await leagueRow(db, league.leagueId);
    expect(row.stream_url).toBeNull();
  });

  it("refuses malformed replay lists, naming the replay", async () => {
    const commissioner = league.commissioner.userId;
    const save = (replays: unknown) => setPage(db, commissioner, league.leagueId, { streamUrl: TWITCH, replays });

    await expectRpcError(save({ title: "x", url: "https://www.twitch.tv/videos/1" }), "invalid_replays");
    await expectRpcError(save(["https://www.twitch.tv/videos/1"]), "invalid_replays");
    await expectRpcError(
      save(Array.from({ length: 21 }, (_, i) => ({ title: `R${i}`, url: `https://www.twitch.tv/videos/${i + 1}` }))),
      "too_many_replays",
    );
    const badLink = await expectRpcError(
      save([
        { title: "Fine", url: "https://www.twitch.tv/videos/1" },
        { title: "Channel", url: TWITCH },
      ]),
      "invalid_replay_link",
    );
    expect(badLink.message).toContain("Replay 2");
    await expectRpcError(save([{ title: "Not normalized", url: "https://youtu.be/dQw4w9WgXcQ" }]), "invalid_replay_link");
    await expectRpcError(save([{ title: "   ", url: "https://www.twitch.tv/videos/1" }]), "invalid_replay_title");
    await expectRpcError(save([{ title: "x".repeat(81), url: "https://www.twitch.tv/videos/1" }]), "invalid_replay_title");
    await expectRpcError(save([{ url: "https://www.twitch.tv/videos/1" }]), "invalid_replay_title");
    const duplicate = await expectRpcError(
      save([
        { title: "One", url: "https://www.twitch.tv/videos/1" },
        { title: "Again", url: "https://www.twitch.tv/videos/1" },
      ]),
      "duplicate_replay",
    );
    expect(duplicate.message).toContain("Replay 2");

    // Twenty is the limit, not past it.
    const twenty = await save(
      Array.from({ length: 20 }, (_, i) => ({ title: `R${i}`, url: `https://www.twitch.tv/videos/${i + 1}` })),
    );
    expect(twenty.replay_links).toHaveLength(20);
  });

  it("stores exactly what the Settings card's parser writes", async () => {
    const commissioner = league.commissioner.userId;
    const streams = [
      "twitch.tv/PokeDrafts",
      "https://m.twitch.tv/pokedrafts/videos?filter=archives",
      "https://player.twitch.tv/?channel=Some_Streamer&parent=example.com",
      "https://www.youtube.com/@PokeDrafts.Live",
      "youtube.com/@poke-drafts/streams",
      "https://www.youtube.com/channel/UC1234567890abcdefghijAB/live",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    ];
    for (const input of streams) {
      const parsed = parseStreamLink(input);
      if (!parsed.ok) throw new Error(`${input}: ${parsed.error}`);
      const saved = await setPage(db, commissioner, league.leagueId, { streamUrl: parsed.link.url });
      expect(saved.stream_url, input).toBe(parsed.link.url);
    }

    const replays = [
      "https://www.twitch.tv/videos/2345678901?t=1h2m3s",
      "twitch.tv/videos/42?t=95",
      "https://www.twitch.tv/pokedrafts/clip/AwkwardHelplessSalamanderSwiftRage-a1B2_c3?filter=clips",
      "https://clips.twitch.tv/embed?clip=FunnyClip&parent=example.com",
      "https://youtu.be/dQw4w9WgXcQ?t=42",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s",
      "https://m.youtube.com/watch?v=abcdefghijk",
      "https://www.youtube.com/shorts/abcdefghijk",
    ];
    const entries = replays.map((input, index) => {
      const parsed = parseReplayLink(input);
      if (!parsed.ok) throw new Error(`${input}: ${parsed.error}`);
      return { title: `Replay ${index + 1}`, url: parsed.link.url };
    });
    const unique = entries.filter((entry, index) => entries.findIndex((e) => e.url === entry.url) === index);
    const saved = await setPage(db, commissioner, league.leagueId, { streamUrl: TWITCH, replays: unique });
    expect(saved.replay_links.map((r) => r.url)).toEqual(unique.map((e) => e.url));
  });

  it("the column checks hold the same shapes for a write that skips the function", async () => {
    await expectSqlState(
      db.query("update public.leagues set stream_url = 'https://evil.example/x' where id = $1", [league.leagueId]),
      "23514",
    );
    await expectSqlState(
      db.query(`update public.leagues set replay_links = '{"a": 1}'::jsonb where id = $1`, [league.leagueId]),
      "23514",
    );
    await expectSqlState(
      db.query(
        "update public.leagues set replay_links = (select jsonb_agg(jsonb_build_object('title', 't', 'url', 'u')) from generate_series(1, 21)) where id = $1",
        [league.leagueId],
      ),
      "23514",
    );
  });
});

describe("public leagues: get_public_league", () => {
  let db: Client;
  let league: LeagueFixture;
  let privateLeague: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    league = await buildLeague(db, { coaches: 3, picksPerTeam: 2, name: "Watchable League" });
    privateLeague = await buildLeague(db, { coaches: 1, name: "Private League" });
    await setPage(db, league.commissioner.userId, league.leagueId, {
      streamUrl: TWITCH,
      replays: [{ title: "Draft night", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
    });
    await asUser(db, league.coaches[0].userId, (c) =>
      c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, $4)", [
        league.leagueId,
        league.coaches[0].memberId,
        league.coaches[0].userId,
        "secret chat line",
      ]),
    );
  });

  afterAll(async () => {
    await db.end();
  });

  it("a private or unknown league reads as null for everyone, its own coaches included", async () => {
    for (const caller of [null, privateLeague.commissioner.userId, privateLeague.coaches[0].userId, league.commissioner.userId]) {
      expect(await getPublic(db, caller, privateLeague.leagueId)).toBeNull();
    }
    expect(await getPublic(db, null, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("a public league's setup, coaches and stream, for a signed-out visitor", async () => {
    const data = await getPublic(db, null, league.leagueId);
    if (!data) throw new Error("expected the public league");
    expect(data).toMatchObject({
      id: league.leagueId,
      name: "Watchable League",
      draft_started: false,
      draft_completed: false,
      on_clock_member_id: null,
      stream_url: TWITCH,
      picks: [],
      teams: [],
      matches: [],
    });
    expect(data.replay_links.map((r) => r.title)).toEqual(["Draft night"]);
    expect(data.coaches).toEqual(
      league.order.map((p, index) => ({ id: p.memberId, team_name: p.teamName, draft_position: index + 1 })),
    );
    expect(Number.isNaN(Date.parse(String(data.server_time)))).toBe(false);
    for (const key of ["commissioner_id", "custom_pool", "draft_format_id", "invite_code", "is_public"]) {
      expect(data, key).not.toHaveProperty(key);
    }
  });

  it("follows the draft: the coach on the clock, every pick, then rosters, matches and standings", async () => {
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    const clock = await onClockMember(db, league.leagueId);
    const live = await getPublic(db, null, league.leagueId);
    expect(live?.draft_started).toBe(true);
    expect(live?.on_clock_member_id).toBe(clock.memberId);

    // runFullDraft starts the draft itself, so reset and run it end to end.
    await rpcAs(db, league.commissioner.userId, "reset_draft", { p_league_id: league.leagueId });
    const picks = await runFullDraft(db, league);
    const done = await getPublic(db, null, league.leagueId);
    if (!done) throw new Error("expected the public league");
    expect(done.draft_completed).toBe(true);
    expect(done.on_clock_member_id).toBeNull();
    expect(done.picks.map((p) => [p.pick_number, p.member_id, p.pokemon_name])).toEqual(
      picks.map((p) => [p.pickNumber, p.memberId, p.name]),
    );
    expect(done.teams).toHaveLength(league.order.length);
    expect(done.matches.length).toBeGreaterThan(0);
    expect(done.standings.map((s) => s.member_id).sort()).toEqual(league.order.map((p) => p.memberId).sort());
    expect(done.standings[0]).toMatchObject({ seed: 1, wins: 0, losses: 0 });
  });

  it("never hands out an account id or the chat", async () => {
    const text = JSON.stringify(await getPublic(db, null, league.leagueId));
    for (const participant of league.order) {
      expect(text).not.toContain(participant.userId);
    }
    expect(text).not.toContain(league.inviteCode);
    expect(text).not.toContain("secret chat line");
  });

  it("names each Pokémon's sprite and types from the dataset, matching forms by key", async () => {
    await rolledBack(db, async (c) => {
      const pick = (await c.query<{ pokemon_name: string }>(
        "select pokemon_name from public.draft_picks where league_id = $1 order by pick_number limit 1",
        [league.leagueId],
      )).rows[0].pokemon_name;
      await c.query(
        `insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, type2, hp, attack, defense, special_attack, special_defense, speed, generation, sprite_url)
         values (990001, 9901, $1, $2, $2, 'default', 'Fire', null, 1, 1, 1, 1, 1, 1, 1, 'https://example.test/exact.png'),
                (990002, 9902, 'zzmon-aqua', 'Zzmon (Aqua)', 'Zzmon', 'other', 'Electric', 'Water', 1, 1, 1, 1, 1, 1, 4, 'https://example.test/zzmon-aqua.png')`,
        [`slug-${pick.toLowerCase()}`, pick],
      );
      // A pick spelled the way an older pool spells a form ("Rotom-Wash" for
      // the dataset's "Rotom (Wash)").
      await c.query("update public.draft_picks set pokemon_name = 'Zzmon-Aqua' where league_id = $1 and pick_number = 2", [
        league.leagueId,
      ]);
      const data = await rpc<PublicLeague>(c, "get_public_league", { p_league_id: league.leagueId });
      expect(data.pokemon[pick]).toEqual({ sprite_url: "https://example.test/exact.png", type1: "Fire", type2: null });
      expect(data.pokemon["Zzmon-Aqua"]).toEqual({
        sprite_url: "https://example.test/zzmon-aqua.png",
        type1: "Electric",
        type2: "Water",
      });
    });
  });

  it("leaves the tables closed to signed-out visitors", async () => {
    for (const table of ["leagues", "league_members", "draft_picks", "drafted_teams", "league_matches"]) {
      const column = table === "leagues" ? "id" : "league_id";
      const { rowCount } = await asAnon(db, (c) =>
        c.query(`select 1 from public.${table} where ${column} = $1`, [league.leagueId]),
      );
      expect(rowCount, table).toBe(0);
    }
  });
});

describe("public leagues: list_public_leagues", () => {
  let db: Client;
  let idle: LeagueFixture;
  let drafting: LeagueFixture;
  let paused: LeagueFixture;
  let hidden: LeagueFixture;

  beforeAll(async () => {
    db = await connect();
    idle = await buildLeague(db, { coaches: 1, name: "Idle Public" });
    drafting = await buildLeague(db, { coaches: 2, name: "Drafting Public" });
    paused = await buildLeague(db, { coaches: 1, name: "Paused Public" });
    hidden = await buildLeague(db, { coaches: 1, name: "Hidden League" });
    const admin = await createUser(db);
    await db.query("insert into public.site_admins (user_id) values ($1)", [admin]);
    for (const fixture of [idle, drafting, paused]) {
      await setPage(db, fixture.commissioner.userId, fixture.leagueId, {
        streamUrl: fixture === idle ? "https://www.youtube.com/@pokedrafts" : null,
        replays: fixture === idle ? [{ title: "Highlights", url: "https://clips.twitch.tv/SomeClip" }] : [],
      });
      await rpcAs(db, admin, "set_watch_listing", { p_league_id: fixture.leagueId, p_listed: true });
    }
    // A league that is listed but private stays off the list.
    await rpcAs(db, admin, "set_watch_listing", { p_league_id: hidden.leagueId, p_listed: true });
    await rpcAs(db, drafting.commissioner.userId, "start_draft", { p_league_id: drafting.leagueId });
    await rpcAs(db, paused.commissioner.userId, "start_draft", { p_league_id: paused.leagueId });
    await rpcAs(db, paused.commissioner.userId, "pause_draft", { p_league_id: paused.leagueId });
  });

  afterAll(async () => {
    await db.end();
  });

  it("lists listed public leagues only, running drafts first, for signed-out and signed-in callers alike", async () => {
    const signedOut = await listPublic(db, null);
    const signedIn = await listPublic(db, hidden.commissioner.userId);
    for (const list of [signedOut, signedIn]) {
      const ids = list.leagues.map((l) => l.id);
      expect(ids).toEqual(expect.arrayContaining([idle.leagueId, drafting.leagueId, paused.leagueId]));
      expect(ids).not.toContain(hidden.leagueId);
      // Every running draft sorts before every league that is not running.
      const running = list.leagues.map((l) => l.draft_started === true && l.draft_completed === false && l.draft_paused === false);
      expect(running.indexOf(false) === -1 || running.lastIndexOf(true) < running.indexOf(false)).toBe(true);
      expect(running[ids.indexOf(drafting.leagueId)]).toBe(true);
      expect(running[ids.indexOf(paused.leagueId)]).toBe(false);
    }
    expect(Number.isNaN(Date.parse(signedOut.server_time))).toBe(false);
  });

  it("carries each league's progress, stream and replays by team name only", async () => {
    const { leagues } = await listPublic(db, null);
    const live = leagues.find((l) => l.id === drafting.leagueId);
    const clock = await onClockMember(db, drafting.leagueId);
    const onClockTeam = drafting.order.find((p) => p.memberId === clock.memberId)?.teamName;
    expect(live).toMatchObject({
      name: "Drafting Public",
      coach_count: 3,
      drafting_count: 3,
      current_pick_number: 1,
      draft_started: true,
      draft_paused: false,
      on_clock: { team_name: onClockTeam },
      last_pick: null,
      stream_url: null,
      replay_links: [],
    });
    expect(Number.isNaN(Date.parse(String(live?.pick_deadline)))).toBe(false);

    const pausedRow = leagues.find((l) => l.id === paused.leagueId);
    expect(pausedRow).toMatchObject({ draft_paused: true, on_clock: null, pick_deadline: null });

    const idleRow = leagues.find((l) => l.id === idle.leagueId);
    expect(idleRow).toMatchObject({
      draft_started: false,
      stream_url: "https://www.youtube.com/@pokedrafts",
      regular_played: 0,
      regular_total: 0,
      playoff_matches: [],
      champion: null,
    });
    expect((idleRow?.replay_links as Replay[]).map((r) => r.title)).toEqual(["Highlights"]);

    const text = JSON.stringify(leagues);
    for (const fixture of [idle, drafting, paused, hidden]) {
      for (const participant of fixture.order) {
        expect(text).not.toContain(participant.userId);
      }
      expect(text).not.toContain(fixture.inviteCode);
    }
  });

  it("shows the newest pick once the draft moves", async () => {
    const clock = await onClockMember(db, drafting.leagueId);
    const picker = drafting.order.find((p) => p.memberId === clock.memberId);
    if (!picker) throw new Error("no coach on the clock");
    const { rows } = await db.query<{ name: string }>("select name from public._best_available($1, $2)", [
      drafting.leagueId,
      clock.memberId,
    ]);
    await rpcAs(db, picker.userId, "make_pick", { p_league_id: drafting.leagueId, p_pokemon_name: rows[0].name });
    const { leagues } = await listPublic(db, null);
    expect(leagues.find((l) => l.id === drafting.leagueId)).toMatchObject({
      current_pick_number: 2,
      last_pick: { pick_number: 1, pokemon_name: rows[0].name, team_name: picker.teamName },
    });
  });

  it("drops a league the moment it goes private", async () => {
    await setPage(db, idle.commissioner.userId, idle.leagueId, { isPublic: false });
    const { leagues } = await listPublic(db, null);
    expect(leagues.map((l) => l.id)).not.toContain(idle.leagueId);
    expect(await getPublic(db, null, idle.leagueId)).toBeNull();
  });
});
