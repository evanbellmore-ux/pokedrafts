// Security review probes: an attacker with a valid coach account (and the anon
// key) tries to read, write or act where they should not. The "draft format
// ownership" block covers three holes found in review (coaches locked out of a
// format-based pool, a format owner rewriting a live draft's pool, unbounded
// strings stored on the league row); each test asserts the fixed behaviour.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expectSqlState,
  matchesFor,
  memberFor,
  newsFor,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
  type LeagueFixture,
} from "./harness";

const ANON_FUNCTIONS = ["get_server_time", "get_invite_preview", "is_league_member"];

describe("security probes", () => {
  let db: Client;
  let leagueA: LeagueFixture;
  let leagueB: LeagueFixture;
  let outsider: string;
  let newsA: string;
  let matchA: { id: string; home_member_id: string; away_member_id: string };

  beforeAll(async () => {
    db = await connect();
    outsider = await createUser(db);
    leagueA = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
    leagueB = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
    await runFullDraft(db, leagueA);
    await runFullDraft(db, leagueB);

    // A free-agent move in league A so there is a news row to attack.
    const coach = leagueA.coaches[0];
    const team = await teamFor(db, leagueA.leagueId, coach.memberId);
    await rpcAs(db, coach.userId, "swap_free_agent", {
      p_league_id: leagueA.leagueId,
      p_drop_name: team.pokemon[0].name,
      p_add_name: "Mon012",
    });
    newsA = (await newsFor(db, leagueA.leagueId, "free_agent"))[0].id;
    matchA = (await matchesFor(db, leagueA.leagueId))[0];
  });

  afterAll(async () => {
    await db.end();
  });

  describe("IDOR: acting on another league's rows", () => {
    it("commissioner of league B cannot undo, report or clear league A's rows", async () => {
      const cb = leagueB.commissioner.userId;
      await expectRpcError(rpcAs(db, cb, "undo_free_agent_move", { p_news_id: newsA }), "not_commissioner");
      await expectRpcError(
        rpcAs(db, cb, "report_match_result", { p_match_id: matchA.id, p_winner_member_id: matchA.home_member_id }),
        "not_commissioner",
      );
      await expectRpcError(rpcAs(db, cb, "clear_match_result", { p_match_id: matchA.id }), "not_commissioner");
      const news = await newsFor(db, leagueA.leagueId, "free_agent");
      expect(news.map((n) => n.id)).toContain(newsA);
      expect((await matchesFor(db, leagueA.leagueId))[0].status).toBe("upcoming");
    });

    it("commissioner cannot transfer, remove or order members of another league", async () => {
      const fresh = await buildLeague(db, { coaches: 1, picksPerTeam: 2, setOrder: false });
      const c = fresh.commissioner.userId;
      const foreign = leagueA.coaches[0].memberId;
      await expectRpcError(rpcAs(db, c, "transfer_commissioner", { p_league_id: fresh.leagueId, p_member_id: foreign }), "member_not_found");
      await expectRpcError(rpcAs(db, c, "remove_member", { p_league_id: fresh.leagueId, p_member_id: foreign }), "member_not_found");
      await expectRpcError(
        rpcAs(db, c, "set_draft_order", { p_league_id: fresh.leagueId, p_member_ids: [fresh.commissioner.memberId, foreign] }),
        "member_not_found",
      );
      const { rows } = await db.query("select commissioner_id from public.leagues where id = $1", [leagueA.leagueId]);
      expect(rows[0].commissioner_id).toBe(leagueA.commissioner.userId);
      expect(await count(db, "league_members", "id = $1", [foreign])).toBe(1);
    });

    it("commissioner cannot report a winner who is not in the match", async () => {
      const ca = leagueA.commissioner.userId;
      await expectRpcError(
        rpcAs(db, ca, "report_match_result", { p_match_id: matchA.id, p_winner_member_id: leagueB.coaches[0].memberId }),
        "invalid_winner",
      );
      const notInMatch = leagueA.order.map((p) => p.memberId).find((id) => id !== matchA.home_member_id && id !== matchA.away_member_id);
      await expectRpcError(
        rpcAs(db, ca, "report_match_result", { p_match_id: matchA.id, p_winner_member_id: notInMatch }),
        "invalid_winner",
      );
      await expectRpcError(rpcAs(db, ca, "report_match_result", { p_match_id: matchA.id, p_winner_member_id: null }), "invalid_winner");
    });

    it("a league cannot be created with or switched to another user's private format", async () => {
      const alice = await createUser(db);
      const { rows } = await asUser(db, alice, (c) =>
        c.query<{ id: string }>("insert into public.draft_formats (name, json) values ('Private', '{\"pokemon\": []}') returning id"),
      );
      const formatId = rows[0].id;
      await expectRpcError(
        rpcAs(db, outsider, "create_league", { p_name: "Steal", p_team_name: "T", p_max_coaches: 4, p_draft_format_id: formatId }),
        "format_not_found",
      );
      const fresh = await buildLeague(db, { coaches: 0, setOrder: false });
      await expectRpcError(
        rpcAs(db, fresh.commissioner.userId, "update_league_settings", {
          p_league_id: fresh.leagueId,
          p_settings: { draft_format_id: formatId },
        }),
        "format_not_found",
      );
      await expectRpcError(
        rpcAs(db, fresh.commissioner.userId, "update_league_settings", {
          p_league_id: fresh.leagueId,
          p_settings: { draft_format_id: "not-a-uuid" },
        }),
        "format_not_found",
      );
    });
  });

  describe("privilege escalation through RPCs", () => {
    it("a coach cannot call any commissioner-only function", async () => {
      const coach = leagueA.coaches[1].userId;
      const id = leagueA.leagueId;
      const calls: Array<[string, Record<string, unknown>]> = [
        ["regenerate_invite", { p_league_id: id }],
        ["remove_member", { p_league_id: id, p_member_id: leagueA.coaches[0].memberId }],
        ["transfer_commissioner", { p_league_id: id, p_member_id: leagueA.coaches[1].memberId }],
        ["update_league_settings", { p_league_id: id, p_settings: { name: "Pwned" } }],
        ["update_league_pool", { p_league_id: id, p_pool: { pokemon: [{ name: "X", points: 1 }] } }],
        ["reset_league_pool", { p_league_id: id }],
        ["set_draft_order", { p_league_id: id, p_member_ids: [leagueA.coaches[1].memberId, leagueA.coaches[0].memberId] }],
        ["start_draft", { p_league_id: id }],
        ["pause_draft", { p_league_id: id }],
        ["resume_draft", { p_league_id: id }],
        ["undo_last_pick", { p_league_id: id }],
        ["force_pick", { p_league_id: id, p_pokemon_name: null }],
        ["finalize_draft", { p_league_id: id }],
        ["reset_draft", { p_league_id: id }],
        ["generate_schedule", { p_league_id: id, p_format: "round_robin", p_randomize: false }],
        ["undo_free_agent_move", { p_news_id: newsA }],
        ["report_match_result", { p_match_id: matchA.id, p_winner_member_id: matchA.home_member_id }],
        ["clear_match_result", { p_match_id: matchA.id }],
      ];
      for (const [fn, args] of calls) {
        const error = await expectRpcError(rpcAs(db, coach, fn, args), "not_commissioner");
        expect(error.detail, fn).toBe("not_commissioner");
      }
      const league = await db.query("select name, draft_completed, commissioner_id from public.leagues where id = $1", [id]);
      expect(league.rows[0].name).toBe("Test League");
      expect(league.rows[0].draft_completed).toBe(true);
      expect(league.rows[0].commissioner_id).toBe(leagueA.commissioner.userId);
    });

    it("a non-member cannot call member functions", async () => {
      const id = leagueA.leagueId;
      // Membership is checked before the draft state, so a finished league
      // reports not_a_member too (see security-attack-r4.test.ts).
      await expectRpcError(rpcAs(db, outsider, "make_pick", { p_league_id: id, p_pokemon_name: "Mon007" }), "not_a_member");
      const live = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      await rpcAs(db, live.commissioner.userId, "start_draft", { p_league_id: live.leagueId });
      await expectRpcError(rpcAs(db, outsider, "make_pick", { p_league_id: live.leagueId, p_pokemon_name: "Mon001" }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "auto_pick_if_expired", { p_league_id: live.leagueId }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "rename_team", { p_league_id: id, p_team_name: "Mine" }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "leave_league", { p_league_id: id }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "swap_free_agent", { p_league_id: id, p_drop_name: null, p_add_name: "Mon007" }), "not_a_member");
      expect(await count(db, "draft_picks", "league_id = $1", [live.leagueId])).toBe(0);
    });

    it("a coach cannot pick out of turn and cannot choose the points of a pick", async () => {
      const live = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      await rpcAs(db, live.commissioner.userId, "start_draft", { p_league_id: live.leagueId });
      // Commissioner is first in the order; coach 2 tries to jump the queue.
      await expectRpcError(
        rpcAs(db, live.coaches[1].userId, "make_pick", { p_league_id: live.leagueId, p_pokemon_name: "Mon001" }),
        "not_your_turn",
      );
      // A spectator (no draft position) in the league can never pick.
      const spectatorUser = await createUser(db);
      await db.query("insert into public.league_members (league_id, user_id, role, team_name) values ($1, $2, 'coach', 'Spec')", [
        live.leagueId,
        spectatorUser,
      ]);
      await expectRpcError(rpcAs(db, spectatorUser, "make_pick", { p_league_id: live.leagueId, p_pokemon_name: "Mon001" }), "not_your_turn");
      const result = await rpcAs<{ pick_number: number }>(db, live.commissioner.userId, "make_pick", {
        p_league_id: live.leagueId,
        p_pokemon_name: "  mon001 ",
      });
      expect(result.pick_number).toBe(1);
      const { rows } = await db.query("select points, tier, pokemon_name from public.draft_picks where league_id = $1", [live.leagueId]);
      expect(rows).toEqual([{ points: 20, tier: 1, pokemon_name: "Mon001" }]);
    });

    it("rejects negative, zero and huge numeric inputs", async () => {
      const u = await createUser(db);
      const base = { p_name: "N", p_team_name: "T", p_max_coaches: 4 };
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_max_coaches: 2147483647 }), "invalid_max_coaches");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_max_coaches: -1 }), "invalid_max_coaches");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_point_budget: -5 }), "invalid_point_budget");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_point_budget: 0 }), "invalid_point_budget");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_picks_per_team: 0 }), "invalid_picks_per_team");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_pick_timer_seconds: 1 }), "invalid_pick_timer");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_name: "x".repeat(61) }), "invalid_name");
      await expectRpcError(rpcAs(db, u, "create_league", { ...base, p_team_name: "   " }), "invalid_team_name");

      const fresh = await buildLeague(db, { coaches: 0, setOrder: false });
      const c = fresh.commissioner.userId;
      const settings = (p_settings: Record<string, unknown>) =>
        rpcAs(db, c, "update_league_settings", { p_league_id: fresh.leagueId, p_settings });
      await expectRpcError(settings({ max_coaches: "99999999999" }), "invalid_max_coaches");
      await expectRpcError(settings({ max_coaches: 1.5 }), "invalid_max_coaches");
      await expectRpcError(settings({ point_budget: -1 }), "invalid_point_budget");
      await expectRpcError(settings({ picks_per_team: 31 }), "invalid_picks_per_team");
      await expectRpcError(settings({ pick_timer_seconds: 9 }), "invalid_pick_timer");
      await expectRpcError(settings({ free_agent_swap_limit: -1 }), "invalid_swap_limit");
      await expectRpcError(settings({ free_agent_swap_limit: 1001 }), "invalid_swap_limit");
      await expectRpcError(settings({ name: "" }), "invalid_name");
      await expectRpcError(settings({ schedule_format: "chaos" }), "invalid_schedule_format");
      await expectRpcError(settings({ commissioner_id: outsider }), "unknown_setting");
      await expectRpcError(settings({ draft_started: true }), "unknown_setting");
    });
  });

  describe("direct table writes with the anon key", () => {
    it("a coach cannot insert into any league table", async () => {
      const coach = leagueA.coaches[0];
      const id = leagueA.leagueId;
      const inserts: Array<[string, string, unknown[]]> = [
        ["leagues", "insert into public.leagues (name, commissioner_id) values ('x', $1)", [coach.userId]],
        ["league_members", "insert into public.league_members (league_id, user_id, role) values ($1, $2, 'commissioner')", [leagueB.leagueId, coach.userId]],
        ["league_invites", "insert into public.league_invites (league_id, invite_code) values ($1, 'HACKHACK00')", [id]],
        ["draft_picks", "insert into public.draft_picks (league_id, member_id, pokemon_name, points, tier, pick_number) values ($1, $2, 'H', 1, 20, 99)", [id, coach.memberId]],
        ["drafted_teams", "insert into public.drafted_teams (league_id, member_id, pokemon) values ($1, $2, '[]')", [id, coach.memberId]],
        ["league_matches", "insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id) values ($1, 9, 9, $2, $2)", [id, coach.memberId]],
        ["league_news", "insert into public.league_news (league_id, member_id, news_type, message) values ($1, $2, 'free_agent', 'fake')", [id, coach.memberId]],
        ["draft_order", "insert into public.draft_order (league_id, member_id, pick_slot) values ($1, $2, 1)", [id, coach.memberId]],
        ["pokemon_dex", "insert into public.pokemon_dex (dex_number, name) values (99999, 'Fake')", []],
        // The Pool Builder dataset is read-only for the client; only the seed
        // script writes it (20260916120000_pool_builder.sql, Grants).
        [
          "pokemon",
          "insert into public.pokemon (id, species_id, slug, display_name, species_name, form_kind, type1, hp, attack, defense, special_attack, special_defense, speed, generation) values (999999, 999999, 'fake', 'Fake', 'Fake', 'default', 'Normal', 1, 1, 1, 1, 1, 1, 1)",
          [],
        ],
        ["draft_formats (shared)", "insert into public.draft_formats (name, json, created_by) values ('Shared', '{}', null)", []],
      ];
      for (const [label, sql, params] of inserts) {
        const error = await expectSqlState(asUser(db, coach.userId, (c) => c.query(sql, params)), "42501");
        expect(error.code, label).toBe("42501");
      }
    });

    it("a coach cannot update or delete rows in any league table", async () => {
      const coach = leagueA.coaches[0];
      const id = leagueA.leagueId;
      const statements: Array<[string, unknown[]]> = [
        ["update public.leagues set commissioner_id = $2 where id = $1", [id, coach.userId]],
        ["update public.leagues set draft_completed = false, draft_started = false where id = $1", [id]],
        ["update public.league_members set free_agent_swaps_used = 0 where league_id = $1", [id]],
        ["update public.league_members set role = 'commissioner' where id = $1", [coach.memberId]],
        ["update public.drafted_teams set pokemon = '[]', total_points = 0 where member_id = $1", [coach.memberId]],
        ["update public.league_matches set status = 'completed', winner_member_id = $2 where league_id = $1", [id, coach.memberId]],
        ["update public.league_news set metadata = '{}' where league_id = $1", [id]],
        ["update public.league_invites set invite_code = 'AAAAAAAAAA' where league_id = $1", [id]],
        ["update public.draft_picks set points = 1 where league_id = $1", [id]],
        ["delete from public.league_members where league_id = $1 and id <> $2", [id, coach.memberId]],
        ["delete from public.draft_picks where league_id = $1", [id]],
        ["delete from public.league_news where league_id = $1", [id]],
        ["delete from public.league_matches where league_id = $1", [id]],
        ["delete from public.drafted_teams where league_id = $1", [id]],
        ["delete from public.leagues where id = $1", [id]],
      ];
      for (const [sql, params] of statements) {
        const result = await asUser(db, coach.userId, (c) => c.query(sql, params));
        expect(result.rowCount, sql).toBe(0);
      }
      expect(await count(db, "league_members", "league_id = $1", [id])).toBe(3);
      expect(await count(db, "draft_picks", "league_id = $1", [id])).toBe(6);
    });

    it("chat: a member cannot post as another member or into a league they are not in", async () => {
      const coach = leagueA.coaches[0];
      await expectSqlState(
        asUser(db, coach.userId, (c) =>
          c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'x')", [
            leagueA.leagueId,
            leagueA.commissioner.memberId,
            coach.userId,
          ]),
        ),
        "42501",
      );
      await expectSqlState(
        asUser(db, coach.userId, (c) =>
          c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'x')", [
            leagueA.leagueId,
            leagueA.commissioner.memberId,
            leagueA.commissioner.userId,
          ]),
        ),
        "42501",
      );
      await expectSqlState(
        asUser(db, coach.userId, (c) =>
          c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'x')", [
            leagueB.leagueId,
            coach.memberId,
            coach.userId,
          ]),
        ),
        "42501",
      );
      const ok = await asUser(db, coach.userId, (c) =>
        c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'hello')", [
          leagueA.leagueId,
          coach.memberId,
          coach.userId,
        ]),
      );
      expect(ok.rowCount).toBe(1);
      const seen = await asUser(db, outsider, (c) => count(c, "draft_chat_messages", "league_id = $1", [leagueA.leagueId]));
      expect(seen).toBe(0);
    });
  });

  describe("grants and exposure", () => {
    it("no public function is executable by PUBLIC; anon executes only the three allowed; internals are hidden", async () => {
      const { rows } = await db.query<{ proname: string; nargs: number; public_exec: boolean; anon_exec: boolean; auth_exec: boolean }>(`
        select p.proname,
               p.pronargs as nargs,
               (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) as public_exec,
               has_function_privilege('anon', p.oid, 'execute') as anon_exec,
               has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
        order by p.proname`);
      expect(rows.length).toBeGreaterThan(40);
      const publicExec = rows.filter((r) => r.public_exec).map((r) => r.proname);
      expect(publicExec, "functions executable by PUBLIC").toEqual([]);
      const anonExec = rows.filter((r) => r.anon_exec).map((r) => r.proname).sort();
      expect(anonExec).toEqual([...ANON_FUNCTIONS].sort());
      const internalExposed = rows.filter((r) => r.proname.startsWith("_") && (r.auth_exec || r.anon_exec)).map((r) => r.proname);
      expect(internalExposed, "internal helpers executable by API roles").toEqual([]);
      // Only one signature per API function: PostgREST overload resolution
      // could otherwise route a call to a legacy body.
      const names = rows.map((r) => r.proname);
      expect(new Set(names).size).toBe(names.length);
      expect(names).not.toContain("start_draft_timer");
      expect(names).not.toContain("advance_draft_timer");
      expect(names).not.toContain("complete_draft_timer");
    });

    it("anon cannot execute internals or the authenticated API even when named directly", async () => {
      await expectSqlState(asAnon(db, (c) => c.query("select public._league_pool($1)", [leagueA.leagueId])), "42501");
      await expectSqlState(asAnon(db, (c) => c.query("select public._finalize_draft($1)", [leagueA.leagueId])), "42501");
      await expectSqlState(asAnon(db, (c) => rpc(c, "join_league", { p_code: leagueA.inviteCode, p_team_name: "x" })), "42501");
      await expectSqlState(
        asUser(db, outsider, (c) => c.query("select public._pick_internal($1, $2, 'Mon007')", [leagueA.leagueId, leagueA.coaches[0].memberId])),
        "42501",
      );
      await expectSqlState(asUser(db, outsider, (c) => c.query("select public._create_invite($1, 5)", [leagueA.leagueId])), "42501");
      const member = await asAnon(db, (c) => rpc<boolean>(c, "is_league_member", { p_league_id: leagueA.leagueId }));
      expect(member).toBe(false);
    });

    it("get_invite_preview exposes only the documented fields", async () => {
      const documented = ["already_member", "coach_count", "draft_completed", "draft_started", "invite_valid", "league_id", "league_name", "max_coaches"];
      const preview = await asAnon(db, (c) => rpc<Record<string, unknown>>(c, "get_invite_preview", { p_code: leagueA.inviteCode }));
      expect(Object.keys(preview).sort()).toEqual(documented);
      expect(preview.league_id).toBe(leagueA.leagueId);
      expect(preview.already_member).toBe(false);
      expect(JSON.stringify(preview)).not.toContain(leagueA.commissioner.userId);
      const asMember = await rpcAs<Record<string, unknown>>(db, leagueA.coaches[0].userId, "get_invite_preview", { p_code: leagueA.inviteCode.toLowerCase() });
      expect(asMember.already_member).toBe(true);
      const unknown = await asAnon(db, (c) => rpc<Record<string, unknown>>(c, "get_invite_preview", { p_code: "NOPE" }));
      expect(Object.keys(unknown).sort()).toEqual(documented);
      expect(unknown.invite_valid).toBe(false);
      expect(unknown.league_id).toBeNull();
      const nullCode = await asAnon(db, (c) => rpc<Record<string, unknown>>(c, "get_invite_preview", { p_code: null }));
      expect(nullCode.invite_valid).toBe(false);
    });

    it("realtime publishes only the intended tables (never invites or formats)", async () => {
      const { rows } = await db.query<{ tablename: string }>(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename",
      );
      // draft_chat_messages was added by 20260626163000 and is subscribed to by the draft room.
      expect(rows.map((r) => r.tablename)).toEqual(["draft_chat_messages", "draft_picks", "drafted_teams", "league_matches", "league_members", "league_news", "leagues"]);
    });

    it("every public table has RLS enabled and only the documented policies exist", async () => {
      const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname",
      );
      const withoutRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
      expect(withoutRls).toEqual([]);
      const policies = await db.query<{ tablename: string; cmd: string; n: string }>(
        "select tablename, cmd, count(*)::text as n from pg_policies where schemaname = 'public' group by tablename, cmd order by tablename, cmd",
      );
      const writable = policies.rows.filter((p) => p.cmd !== "SELECT").map((p) => `${p.tablename}:${p.cmd}`);
      expect(writable.sort()).toEqual(
        ["draft_chat_messages:INSERT", "draft_formats:DELETE", "draft_formats:INSERT", "draft_formats:UPDATE", "leagues:DELETE"].sort(),
      );
    });
  });

  describe("draft format ownership vs league membership", () => {
    async function leagueOnPrivateFormat(): Promise<{ commissioner: string; coach: string; leagueId: string; formatId: string; coachMemberId: string }> {
      const commissioner = await createUser(db);
      const pool = samplePool(12);
      const { rows } = await asUser(db, commissioner, (c) =>
        c.query<{ id: string }>("insert into public.draft_formats (name, json) values ('Mine', $1) returning id", [
          JSON.stringify({ version: "1.0", leagueName: "Mine", pokemon: pool }),
        ]),
      );
      const formatId = rows[0].id;
      const leagueId = await rpcAs<string>(db, commissioner, "create_league", {
        p_name: "Format League",
        p_team_name: "Commish",
        p_max_coaches: 4,
        p_draft_format_id: formatId,
        p_point_budget: 100,
        p_picks_per_team: 2,
        p_pick_timer_seconds: 60,
      });
      const invite = await db.query<{ invite_code: string }>("select invite_code from public.league_invites where league_id = $1", [leagueId]);
      const coach = await createUser(db);
      await rpcAs(db, coach, "join_league", { p_code: invite.rows[0].invite_code, p_team_name: "Coach" });
      const coachMember = await memberFor(db, leagueId, coach);
      const commissionerMember = await memberFor(db, leagueId, commissioner);
      await rpcAs(db, commissioner, "set_draft_order", { p_league_id: leagueId, p_member_ids: [commissionerMember.id, coachMember.id] });
      return { commissioner, coach, leagueId, formatId, coachMemberId: coachMember.id };
    }

    it("a coach can read the league's pool through the leagues -> draft_formats embed the app uses; strangers still cannot see the format", async () => {
      const { coach, leagueId, formatId } = await leagueOnPrivateFormat();
      // The functions see the pool ...
      const { rows: pool } = await db.query("select count(*)::int as n from public._league_pool($1)", [leagueId]);
      expect(pool[0].n).toBe(12);
      // ... and so does the coach's client, which embeds the format through the
      // league row (DraftClient, PoolClient, FreeAgentsClient, LeagueOverviewClient).
      const embed = "select f.json from public.leagues l left join public.draft_formats f on f.id = l.draft_format_id where l.id = $1";
      const { rows } = await asUser(db, coach, (c) => c.query<{ json: { pokemon: unknown[] } | null }>(embed, [leagueId]));
      expect(rows).toHaveLength(1);
      expect(rows[0].json?.pokemon).toHaveLength(12);
      expect(await asUser(db, coach, (c) => count(c, "draft_formats", "id = $1", [formatId]))).toBe(1);
      // Membership is the only door: a non-member sees neither the league nor the format.
      const stranger = await asUser(db, outsider, (c) => c.query(embed, [leagueId]));
      expect(stranger.rows).toHaveLength(0);
      expect(await asUser(db, outsider, (c) => count(c, "draft_formats", "id = $1", [formatId]))).toBe(0);
      expect(await asAnon(db, (c) => count(c, "draft_formats", "id = $1", [formatId]))).toBe(0);
    });

    it("a format-based league drafts from its own copy of the format, so the format owner cannot rewrite or delete the pool of a live draft they no longer commission", async () => {
      const { commissioner, coach, leagueId, formatId, coachMemberId } = await leagueOnPrivateFormat();
      const poolOf = async () => (await db.query<{ custom_pool: { source?: string; draft_format_id?: string; pokemon: unknown[] } | null }>("select custom_pool from public.leagues where id = $1", [leagueId])).rows[0].custom_pool;
      // create_league copied the format onto the league row; start_draft leaves that copy alone.
      const copied = await poolOf();
      expect(copied).toMatchObject({ source: "format", draft_format_id: formatId });
      expect(copied?.pokemon).toHaveLength(12);
      await rpcAs(db, commissioner, "start_draft", { p_league_id: leagueId });
      const frozen = await poolOf();
      expect(frozen).toEqual(copied);

      await rpcAs(db, commissioner, "transfer_commissioner", { p_league_id: leagueId, p_member_id: coachMemberId });
      // The former commissioner is now a plain coach. The pool is locked ...
      await expectRpcError(
        rpcAs(db, commissioner, "update_league_pool", { p_league_id: leagueId, p_pool: { pokemon: [{ name: "Only", points: 1 }] } }),
        "not_commissioner",
      );
      // ... and rewriting the format row they still own does not touch the draft.
      const rigged = JSON.stringify({ pokemon: [{ name: "Rigged", points: 1 }, { name: "Cheap", points: 1 }, { name: "X", points: 1 }, { name: "Y", points: 1 }] });
      const update = await asUser(db, commissioner, (c) => c.query("update public.draft_formats set json = $1 where id = $2", [rigged, formatId]));
      expect(update.rowCount).toBe(1);
      const { rows: after } = await db.query<{ name: string }>("select name from public._league_pool($1) order by name", [leagueId]);
      expect(after).toHaveLength(12);
      expect(after.map((r) => r.name)).not.toContain("Rigged");
      // Deleting it unlinks the format (on delete set null); the draft keeps its pool.
      const del = await asUser(db, commissioner, (c) => c.query("delete from public.draft_formats where id = $1", [formatId]));
      expect(del.rowCount).toBe(1);
      expect((await db.query("select draft_format_id from public.leagues where id = $1", [leagueId])).rows[0].draft_format_id).toBeNull();
      const { rows: gone } = await db.query("select count(*)::int as n from public._league_pool($1)", [leagueId]);
      expect(gone[0].n).toBe(12);
      // The coach's client reads that same frozen pool from the league row ...
      const seen = await asUser(db, coach, (c) =>
        c.query<{ n: number }>("select jsonb_array_length(custom_pool -> 'pokemon') as n from public.leagues where id = $1", [leagueId]),
      );
      expect(seen.rows[0].n).toBe(12);
      // ... and the draft goes on: the former commissioner still picks first.
      const pick = await rpcAs<{ pick_number: number; pokemon_name: string }>(db, commissioner, "make_pick", { p_league_id: leagueId, p_pokemon_name: "Mon001" });
      expect(pick).toMatchObject({ pick_number: 1, pokemon_name: "Mon001" });
    });

    it("update_league_pool never stores the client's version string or an oversized leagueName on the league row", async () => {
      const fresh = await buildLeague(db, { coaches: 0, setOrder: false, pool: null });
      const big = "v".repeat(1_000_000);
      await rpcAs(db, fresh.commissioner.userId, "update_league_pool", {
        p_league_id: fresh.leagueId,
        p_pool: { version: big, leagueName: big, pokemon: [{ name: "A", points: 1 }] },
      });
      // octet_length of the text form: pg_column_size would report the TOAST-compressed size.
      const { rows } = await db.query<{ len: number; custom_pool: { version: string; leagueName: string; pokemon: unknown[] } }>(
        "select octet_length(custom_pool::text) as len, custom_pool from public.leagues where id = $1",
        [fresh.leagueId],
      );
      expect(rows[0].len).toBeLessThan(1_000);
      expect(rows[0].custom_pool.version).toBe("1.0");
      expect(rows[0].custom_pool.leagueName).toBe("v".repeat(60));
      expect(rows[0].custom_pool.pokemon).toEqual([{ name: "A", points: 1, tier: 20 }]);
      expect(Object.keys(rows[0].custom_pool).sort()).toEqual(["leagueName", "pokemon", "version"]);
    });
  });
});
