// Security review, round 2 (authorization lens). An attacker holds a valid
// coach account and the anon key. These probes cover what security.test.ts
// does not: authority after transfer_commissioner, the league's own format id
// echoed back by the settings form, invite revocation after remove_member, the
// commissioner's direct write paths that the pre-hardening policies allowed,
// unbounded draft_formats inserts, expired-invite previews, an outsider armed
// with a league id, and spectators.
//
// The invite-revocation gap this round found (a removed coach could rejoin
// with the link that was live when they were removed) is closed:
// remove_member rotates the invite code in the same transaction, and the
// "FIXED" tests pin it. The "DOCUMENTED DEVIATION" test pins behaviour that is
// accepted as is and is the evidence quoted in the review report.
import { randomUUID } from "node:crypto";
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
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
} from "./harness";

const LEAGUE_TABLES = [
  "leagues",
  "league_members",
  "league_invites",
  "draft_picks",
  "drafted_teams",
  "league_matches",
  "league_news",
  "draft_chat_messages",
  "draft_order",
];

describe("security review round 2: authority, invites, direct writes", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  // A league whose pool comes from a draft_formats row owned by the
  // commissioner (private: created_by = commissioner).
  async function leagueOnPrivateFormat(): Promise<{
    commissioner: string;
    coach: string;
    leagueId: string;
    formatId: string;
    commissionerMemberId: string;
    coachMemberId: string;
  }> {
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
    return { commissioner, coach, leagueId, formatId, commissionerMemberId: commissionerMember.id, coachMemberId: coachMember.id };
  }

  describe("authority after transfer_commissioner", () => {
    it("the former commissioner loses every commissioner power (RPCs, invite reads, RLS delete) and the new one gains them", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      const id = league.leagueId;
      const old = league.commissioner.userId;
      const next = league.coaches[0];

      await rpcAs(db, old, "transfer_commissioner", { p_league_id: id, p_member_id: next.memberId });

      // leagues.commissioner_id moved and the display roles followed.
      const { rows } = await db.query("select commissioner_id from public.leagues where id = $1", [id]);
      expect(rows[0].commissioner_id).toBe(next.userId);
      expect((await memberFor(db, id, old)).role).toBe("coach");
      expect((await memberFor(db, id, next.userId)).role).toBe("commissioner");
      expect((await memberFor(db, id, league.coaches[1].userId)).role).toBe("coach");

      // The old commissioner is a plain coach now: no commissioner RPC works ...
      await expectRpcError(
        rpcAs(db, old, "transfer_commissioner", { p_league_id: id, p_member_id: league.commissioner.memberId }),
        "not_commissioner",
      );
      await expectRpcError(rpcAs(db, old, "regenerate_invite", { p_league_id: id }), "not_commissioner");
      await expectRpcError(rpcAs(db, old, "start_draft", { p_league_id: id }), "not_commissioner");
      await expectRpcError(rpcAs(db, old, "reset_draft", { p_league_id: id }), "not_commissioner");
      await expectRpcError(rpcAs(db, old, "remove_member", { p_league_id: id, p_member_id: next.memberId }), "not_commissioner");
      await expectRpcError(rpcAs(db, old, "update_league_settings", { p_league_id: id, p_settings: { name: "Mine again" } }), "not_commissioner");
      // ... the invite is hidden ...
      expect(await asUser(db, old, (c) => count(c, "league_invites", "league_id = $1", [id]))).toBe(0);
      // ... and the RLS delete policy no longer matches.
      const del = await asUser(db, old, (c) => c.query("delete from public.leagues where id = $1", [id]));
      expect(del.rowCount).toBe(0);
      expect(await count(db, "leagues", "id = $1", [id])).toBe(1);

      // The new commissioner has everything.
      expect(await asUser(db, next.userId, (c) => count(c, "league_invites", "league_id = $1", [id]))).toBe(1);
      const updated = await rpcAs<{ name: string }>(db, next.userId, "update_league_settings", {
        p_league_id: id,
        p_settings: { name: "Handed over" },
      });
      expect(updated.name).toBe("Handed over");

      // The old commissioner may now leave (pre-draft) like any coach.
      await rpcAs(db, old, "leave_league", { p_league_id: id });
      expect(await count(db, "league_members", "league_id = $1 and user_id = $2", [id, old])).toBe(0);
    });

    it("after a transfer, the new commissioner can save settings that echo the league's current draft_format_id even when that format is private to the old commissioner", async () => {
      const { commissioner, coach, leagueId, formatId, coachMemberId } = await leagueOnPrivateFormat();
      await rpcAs(db, commissioner, "transfer_commissioner", { p_league_id: leagueId, p_member_id: coachMemberId });
      // The new commissioner can read the format (league membership branch of
      // the draft_formats select policy) and the league still points at it.
      expect(await asUser(db, coach, (c) => count(c, "draft_formats", "id = $1", [formatId]))).toBe(1);
      expect((await db.query("select draft_format_id from public.leagues where id = $1", [leagueId])).rows[0].draft_format_id).toBe(formatId);
      // The settings form submits the whole form, so draft_format_id comes back
      // unchanged with every save. An unchanged value is accepted without the
      // visibility check, and it does not clear the pool either.
      const { rows: before } = await db.query<{ custom_pool: unknown }>("select custom_pool from public.leagues where id = $1", [leagueId]);
      const updated = await rpcAs<{ name: string; draft_format_id: string | null; custom_pool: unknown }>(db, coach, "update_league_settings", {
        p_league_id: leagueId,
        p_settings: { name: "Renamed", draft_format_id: formatId },
      });
      expect(updated.name).toBe("Renamed");
      expect(updated.draft_format_id).toBe(formatId);
      expect(updated.custom_pool).toEqual(before[0].custom_pool);
      // Visibility is still enforced for a change: the new commissioner cannot
      // switch away and back to the private format, nor to another private one.
      const { rows } = await asUser(db, commissioner, (c) =>
        c.query<{ id: string }>("insert into public.draft_formats (name, json) values ('Other private', '{\"pokemon\": []}') returning id"),
      );
      await expectRpcError(
        rpcAs(db, coach, "update_league_settings", { p_league_id: leagueId, p_settings: { draft_format_id: rows[0].id } }),
        "format_not_found",
      );
      const cleared = await rpcAs<{ draft_format_id: string | null }>(db, coach, "update_league_settings", { p_league_id: leagueId, p_settings: { draft_format_id: null } });
      expect(cleared.draft_format_id).toBeNull();
      await expectRpcError(
        rpcAs(db, coach, "update_league_settings", { p_league_id: leagueId, p_settings: { draft_format_id: formatId } }),
        "format_not_found",
      );
    });

    it("a coach can read the league's private format but cannot adopt it for a league of their own", async () => {
      const { coach, formatId } = await leagueOnPrivateFormat();
      expect(await asUser(db, coach, (c) => count(c, "draft_formats", "id = $1", [formatId]))).toBe(1);
      await expectRpcError(
        rpcAs(db, coach, "create_league", { p_name: "Copycat", p_team_name: "T", p_max_coaches: 4, p_draft_format_id: formatId }),
        "format_not_found",
      );
      const own = await buildLeague(db, { coaches: 0, setOrder: false });
      // buildLeague makes a fresh commissioner; use the coach's own league instead.
      const coachLeague = await rpcAs<string>(db, coach, "create_league", { p_name: "Coach league", p_team_name: "T", p_max_coaches: 4 });
      await expectRpcError(
        rpcAs(db, coach, "update_league_settings", { p_league_id: coachLeague, p_settings: { draft_format_id: formatId } }),
        "format_not_found",
      );
      expect(own.leagueId).not.toBe(coachLeague);
      // Reading it is all they can do: no update or delete.
      const upd = await asUser(db, coach, (c) => c.query("update public.draft_formats set name = 'x' where id = $1", [formatId]));
      const del = await asUser(db, coach, (c) => c.query("delete from public.draft_formats where id = $1", [formatId]));
      expect(upd.rowCount).toBe(0);
      expect(del.rowCount).toBe(0);
    });
  });

  describe("invite revocation", () => {
    type InviteRow = { invite_code: string; used_count: number; max_uses: number; expires_at: Date | null };
    const invitesOf = async (leagueId: string): Promise<InviteRow[]> =>
      (await db.query<InviteRow>("select invite_code, used_count, max_uses, expires_at from public.league_invites where league_id = $1", [leagueId])).rows;

    it("FIXED: remove_member rotates the invite code in the same transaction, so the old link is dead for everyone and the commissioner has one new link to reshare", async () => {
      const league = await buildLeague(db, { coaches: 2, maxCoaches: 4, picksPerTeam: 2, setOrder: false });
      const [banned, staying] = league.coaches;
      await rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: banned.memberId });
      expect(await count(db, "league_members", "league_id = $1 and user_id = $2", [league.leagueId, banned.userId])).toBe(0);
      expect(await count(db, "league_members", "league_id = $1 and user_id = $2", [league.leagueId, staying.userId])).toBe(1);

      // The link the removed coach holds no longer opens anything, for them or
      // for anyone else they passed it to.
      await expectRpcError(rpcAs(db, banned.userId, "join_league", { p_code: league.inviteCode, p_team_name: "Back again" }), "invite_invalid");
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: league.inviteCode, p_team_name: "Late" }), "invite_invalid");
      const preview = await asAnon(db, (c) => rpc<{ invite_valid: boolean; league_id: string | null }>(c, "get_invite_preview", { p_code: league.inviteCode }));
      expect(preview).toMatchObject({ invite_valid: false, league_id: null });
      expect(await count(db, "league_members", "league_id = $1 and user_id = $2", [league.leagueId, banned.userId])).toBe(0);

      // Exactly one invite row remains: a fresh code, the counter reset and
      // max_uses in step with the coach limit, the same shape regenerate_invite
      // leaves. Only the commissioner can read it.
      const invites = await invitesOf(league.leagueId);
      expect(invites).toHaveLength(1);
      expect(invites[0].invite_code).not.toBe(league.inviteCode);
      expect(invites[0]).toMatchObject({ used_count: 0, max_uses: 3, expires_at: null });
      expect(await asUser(db, league.commissioner.userId, (c) => count(c, "league_invites", "league_id = $1", [league.leagueId]))).toBe(1);
      expect(await asUser(db, staying.userId, (c) => count(c, "league_invites", "league_id = $1", [league.leagueId]))).toBe(0);

      // Resharing the new link is the commissioner's call: it admits a
      // newcomer, and the removed coach only if it is sent to them again.
      const newcomer = await createUser(db);
      expect(await rpcAs<string>(db, newcomer, "join_league", { p_code: invites[0].invite_code, p_team_name: "New" })).toBe(league.leagueId);
      expect(await rpcAs<string>(db, banned.userId, "join_league", { p_code: invites[0].invite_code, p_team_name: "Forgiven" })).toBe(league.leagueId);
      expect((await invitesOf(league.leagueId))[0]).toMatchObject({ invite_code: invites[0].invite_code, used_count: 2 });
    });

    it("FIXED: a refused remove_member leaves the invite alone, and a second removal rotates the code again", async () => {
      const league = await buildLeague(db, { coaches: 2, maxCoaches: 4, picksPerTeam: 2, setOrder: false });
      const [first, second] = league.coaches;
      await expectRpcError(rpcAs(db, first.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: second.memberId }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: league.commissioner.memberId }), "cannot_remove_self");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: randomUUID() }), "member_not_found");
      expect((await invitesOf(league.leagueId)).map((i) => i.invite_code)).toEqual([league.inviteCode]);

      await rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: first.memberId });
      const afterFirst = (await invitesOf(league.leagueId))[0].invite_code;
      expect(afterFirst).not.toBe(league.inviteCode);
      await rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: second.memberId });
      const afterSecond = (await invitesOf(league.leagueId))[0].invite_code;
      expect(afterSecond).not.toBe(afterFirst);
      expect(await count(db, "league_invites", "league_id = $1", [league.leagueId])).toBe(1);
      await expectRpcError(rpcAs(db, first.userId, "join_league", { p_code: afterFirst, p_team_name: "Back" }), "invite_invalid");
      await expectRpcError(rpcAs(db, second.userId, "join_league", { p_code: league.inviteCode, p_team_name: "Back" }), "invite_invalid");
      // The regenerate button still works on top of it.
      const regenerated = await rpcAs<string>(db, league.commissioner.userId, "regenerate_invite", { p_league_id: league.leagueId });
      expect(regenerated).not.toBe(afterSecond);
      expect((await invitesOf(league.leagueId)).map((i) => i.invite_code)).toEqual([regenerated]);
    });

    it("a coach removed by the commissioner cannot rejoin with the invite that was live when they were removed", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, setOrder: false });
      const banned = league.coaches[0];
      await rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: banned.memberId });
      await expectRpcError(rpcAs(db, banned.userId, "join_league", { p_code: league.inviteCode, p_team_name: "Back" }), "invite_invalid");
    });

    it("DOCUMENTED DEVIATION: an expired invite still previews the league name and coach count (invite_valid=false) while join_league refuses it", async () => {
      const league = await buildLeague(db, { coaches: 0, setOrder: false });
      await db.query("update public.league_invites set expires_at = now() - interval '1 day' where league_id = $1", [league.leagueId]);
      const preview = await asAnon(db, (c) =>
        rpc<{ invite_valid: boolean; league_id: string | null; league_name: string | null; coach_count: number | null }>(c, "get_invite_preview", {
          p_code: league.inviteCode,
        }),
      );
      expect(preview.invite_valid).toBe(false);
      expect(preview.league_id).toBe(league.leagueId);
      expect(preview.league_name).toBe("Test League");
      expect(preview.coach_count).toBe(1);
      const stranger = await createUser(db);
      await expectRpcError(rpcAs(db, stranger, "join_league", { p_code: league.inviteCode, p_team_name: "Late" }), "invite_invalid");
      // No function ever sets expires_at to a value (regenerate_invite only
      // clears it), so this only matters for rows edited by hand. Checked in
      // the catalog rather than by counting rows, because other suites in this
      // shared database expire invites by hand too.
      const { rows: setters } = await db.query<{ proname: string }>(
        `select proname from pg_proc
         where pronamespace = 'public'::regnamespace
           and prosrc ~* 'expires_at\\s*=' and prosrc !~* 'expires_at\\s*=\\s*null'`,
      );
      expect(setters).toEqual([]);
    });
  });

  describe("commissioner direct writes", () => {
    it("the commissioner has no direct write path either: every update/delete the pre-hardening policies allowed now affects 0 rows, and inserts are refused", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      await runFullDraft(db, league);
      const id = league.leagueId;
      const commissioner = league.commissioner.userId;
      const coach = league.coaches[0];
      const team = await teamFor(db, id, coach.memberId);
      await rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: id, p_drop_name: team.pokemon[0].name, p_add_name: "Mon012" });
      const match = (await matchesFor(db, id))[0];

      // What SettingsClient.tsx still does today (direct update of leagues and
      // league_members): silently no rows.
      const statements: Array<[string, unknown[]]> = [
        ["update public.leagues set name = 'Renamed directly', max_coaches = 24 where id = $1", [id]],
        ["update public.leagues set draft_completed = false, draft_started = false where id = $1", [id]],
        ["update public.league_members set draft_position = 1 where id = $1", [coach.memberId]],
        ["update public.league_members set role = 'coach', free_agent_swaps_used = 0 where league_id = $1", [id]],
        ["update public.drafted_teams set pokemon = '[]', total_points = 0 where league_id = $1", [id]],
        ["update public.league_matches set status = 'completed', winner_member_id = $2 where id = $1", [match.id, match.home_member_id]],
        ["update public.league_invites set invite_code = 'AAAAAAAAAA', max_uses = 99 where league_id = $1", [id]],
        ["update public.draft_picks set points = 1 where league_id = $1", [id]],
        ["delete from public.league_news where league_id = $1", [id]],
        ["delete from public.league_members where league_id = $1 and id = $2", [id, coach.memberId]],
        ["delete from public.drafted_teams where league_id = $1", [id]],
        ["delete from public.league_matches where league_id = $1", [id]],
        ["delete from public.draft_picks where league_id = $1", [id]],
        ["delete from public.league_invites where league_id = $1", [id]],
        ["delete from public.draft_chat_messages where league_id = $1", [id]],
      ];
      for (const [sql, params] of statements) {
        const result = await asUser(db, commissioner, (c) => c.query(sql, params));
        expect(result.rowCount, sql).toBe(0);
      }
      const inserts: Array<[string, unknown[]]> = [
        ["insert into public.league_news (league_id, member_id, news_type, message) values ($1, $2, 'match_result', 'fake')", [id, coach.memberId]],
        ["insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id) values ($1, 9, 9, $2, $2)", [id, coach.memberId]],
        ["insert into public.league_members (league_id, user_id, role) values ($1, $2, 'coach')", [id, commissioner]],
        ["insert into public.league_invites (league_id, invite_code) values ($1, 'BBBBBBBBBB')", [id]],
      ];
      for (const [sql, params] of inserts) {
        const error = await expectSqlState(asUser(db, commissioner, (c) => c.query(sql, params)), "42501");
        expect(error.code, sql).toBe("42501");
      }
      expect((await db.query("select name, draft_completed from public.leagues where id = $1", [id])).rows[0]).toEqual({ name: "Test League", draft_completed: true });
      expect(await count(db, "league_news", "league_id = $1", [id])).toBe(1);
      expect(await count(db, "draft_picks", "league_id = $1", [id])).toBe(6);
    });
  });

  describe("draft_formats input bounds", () => {
    it("draft_formats refuses an oversized name and a body that is not an object with a pokemon array of at most 2000 entries (check constraints, 23514); the pool builder's shape still inserts", async () => {
      const user = await createUser(db);
      const insert = (name: string, json: unknown) =>
        asUser(db, user, (c) => c.query<{ id: string }>("insert into public.draft_formats (name, json) values ($1, $2) returning id", [name, JSON.stringify(json)]));
      await expectSqlState(insert("n".repeat(61), { pokemon: [] }), "23514");
      await expectSqlState(insert("n".repeat(100_000), { pokemon: [] }), "23514");
      await expectSqlState(insert("", { pokemon: [] }), "23514");
      await expectSqlState(insert("Junk", { pokemon: "not an array", junk: "x".repeat(100_000) }), "23514");
      await expectSqlState(insert("Junk", { version: "1.0" }), "23514");
      await expectSqlState(insert("Junk", [1, 2, 3]), "23514");
      await expectSqlState(insert("Junk", "text"), "23514");
      await expectSqlState(insert("Junk", { pokemon: Array.from({ length: 2001 }, (_, i) => ({ name: `M${i}`, points: 1 })) }), "23514");
      const ok = await insert("n".repeat(60), { version: "1.0", leagueName: "Mine", pokemon: [{ name: "A", points: 5, tier: 16 }] });
      expect(ok.rowCount).toBe(1);
      // Entry-level rules are not the row's business: _validate_pool applies
      // them when a league copies the format (security-attack-r4.test.ts).
      const rigged = await insert("Rigged", { pokemon: [{ name: "Zero", points: 0 }] });
      expect(rigged.rowCount).toBe(1);
      await expectRpcError(
        rpcAs(db, user, "create_league", { p_name: "Junk", p_team_name: "T", p_max_coaches: 2, p_draft_format_id: rigged.rows[0].id }),
        "invalid_points",
      );
      await db.query("delete from public.draft_formats where id = any($1)", [[ok.rows[0].id, rigged.rows[0].id]]);
    });

    it("row level security is checked before the constraints: a coach inserting a shared format still gets 42501, not a constraint error", async () => {
      const user = await createUser(db);
      await expectSqlState(
        asUser(db, user, (c) => c.query("insert into public.draft_formats (name, json, created_by) values ($1, '{}', null)", ["n".repeat(100_000)])),
        "42501",
      );
    });
  });

  describe("outsider armed with a league id", () => {
    it("get_invite_preview hands out the league id, but with it an outsider reads nothing and every RPC refuses", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      await runFullDraft(db, league);
      const id = league.leagueId;
      const outsider = await createUser(db);
      const preview = await rpcAs<{ league_id: string }>(db, outsider, "get_invite_preview", { p_code: league.inviteCode });
      expect(preview.league_id).toBe(id);

      for (const table of LEAGUE_TABLES) {
        const n = await asUser(db, outsider, (c) => count(c, table, table === "leagues" ? "id = $1" : "league_id = $1", [id]));
        expect(n, `outsider should see no ${table} rows`).toBe(0);
      }
      expect(await rpcAs<boolean>(db, outsider, "is_league_member", { p_league_id: id })).toBe(false);

      const memberOnly: Array<[string, Record<string, unknown>, string]> = [
        ["rename_team", { p_league_id: id, p_team_name: "X" }, "not_a_member"],
        ["leave_league", { p_league_id: id }, "not_a_member"],
        ["auto_pick_if_expired", { p_league_id: id }, "not_a_member"],
        ["swap_free_agent", { p_league_id: id, p_drop_name: null, p_add_name: "Mon012" }, "not_a_member"],
      ];
      for (const [fn, args, code] of memberOnly) {
        await expectRpcError(rpcAs(db, outsider, fn, args), code);
      }
      const commissionerOnly: Array<[string, Record<string, unknown>]> = [
        ["finalize_draft", { p_league_id: id }],
        ["generate_schedule", { p_league_id: id, p_format: "double_round_robin", p_randomize: true, p_discard_results: true }],
        ["reset_draft", { p_league_id: id }],
        ["update_league_pool", { p_league_id: id, p_pool: { pokemon: [{ name: "X", points: 1 }] } }],
        ["transfer_commissioner", { p_league_id: id, p_member_id: league.coaches[0].memberId }],
        ["regenerate_invite", { p_league_id: id }],
      ];
      for (const [fn, args] of commissionerOnly) {
        await expectRpcError(rpcAs(db, outsider, fn, args), "not_commissioner");
      }
      // Nothing changed.
      expect(await count(db, "league_matches", "league_id = $1", [id])).toBe(3);
      expect(await count(db, "drafted_teams", "league_id = $1", [id])).toBe(3);
      expect((await db.query("select draft_completed, commissioner_id from public.leagues where id = $1", [id])).rows[0]).toEqual({
        draft_completed: true,
        commissioner_id: league.commissioner.userId,
      });
    });

    it("a null or foreign league id never reaches the membership check with a useful error, and null ids on the id-only RPCs report not-found codes", async () => {
      const outsider = await createUser(db);
      await expectRpcError(rpcAs(db, outsider, "make_pick", { p_league_id: null, p_pokemon_name: "X" }), "league_not_found");
      await expectRpcError(rpcAs(db, outsider, "undo_free_agent_move", { p_news_id: null }), "news_not_found");
      await expectRpcError(rpcAs(db, outsider, "report_match_result", { p_match_id: null, p_winner_member_id: null }), "match_not_found");
      await expectRpcError(rpcAs(db, outsider, "clear_match_result", { p_match_id: null }), "match_not_found");
      await expectRpcError(rpcAs(db, outsider, "set_draft_order", { p_league_id: null, p_member_ids: null }), "league_not_found");
    });
  });

  describe("spectators", () => {
    it("a member without a draft position cannot pick, has no team to swap with, and cannot be reported as a winner", async () => {
      const league = await buildLeague(db, { coaches: 2, maxCoaches: 4, picksPerTeam: 2, pool: samplePool(12) });
      const spectatorUser = await createUser(db);
      await rpcAs(db, spectatorUser, "join_league", { p_code: league.inviteCode, p_team_name: "Watcher" });
      const spectator = await memberFor(db, league.leagueId, spectatorUser);
      expect(spectator.draft_position).toBeNull();

      await runFullDraft(db, league);
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(3);
      await expectRpcError(
        rpcAs(db, spectatorUser, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Mon012" }),
        "no_team",
      );
      const match = (await matchesFor(db, league.leagueId))[0];
      await expectRpcError(
        rpcAs(db, league.commissioner.userId, "report_match_result", { p_match_id: match.id, p_winner_member_id: spectator.id }),
        "invalid_winner",
      );
      // The spectator can still read everything a coach can.
      expect(await asUser(db, spectatorUser, (c) => count(c, "drafted_teams", "league_id = $1", [league.leagueId]))).toBe(3);
    });
  });
});
