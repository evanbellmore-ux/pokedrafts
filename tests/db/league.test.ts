import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asAuthenticatedNoSub,
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  inviteCodeFor,
  leagueRow,
  memberFor,
  rpc,
  rpcAs,
  samplePool,
  type Client,
} from "./harness";

const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

type Preview = {
  league_id: string | null;
  league_name: string | null;
  coach_count: number | null;
  max_coaches: number | null;
  draft_started: boolean | null;
  draft_completed: boolean | null;
  already_member: boolean;
  invite_valid: boolean;
};

describe("league lifecycle RPCs", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  describe("create_league", () => {
    it("creates the league, the commissioner member and an invite in one call", async () => {
      const user = await createUser(db);
      const leagueId = await rpcAs<string>(db, user, "create_league", {
        p_name: "  Kanto Cup  ",
        p_team_name: "  Rockets ",
        p_max_coaches: 6,
        p_draft_format_id: null,
        p_point_budget: 120,
        p_picks_per_team: 8,
        p_pick_timer_seconds: 90,
      });
      const league = await leagueRow(db, leagueId);
      expect(league.name).toBe("Kanto Cup");
      expect(league.commissioner_id).toBe(user);
      expect(league.max_coaches).toBe(6);
      expect(league.point_budget).toBe(120);
      expect(league.picks_per_team).toBe(8);
      expect(league.pick_timer_seconds).toBe(90);
      expect(league.draft_started).toBe(false);
      expect(league.current_pick_number).toBe(1);

      const member = await memberFor(db, leagueId, user);
      expect(member.role).toBe("commissioner");
      expect(member.team_name).toBe("Rockets");
      expect(member.draft_position).toBeNull();

      const { rows } = await db.query("select invite_code, max_uses, used_count from public.league_invites where league_id = $1", [leagueId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].invite_code).toMatch(CODE_ALPHABET);
      expect(rows[0].max_uses).toBe(5);
      expect(rows[0].used_count).toBe(0);
    });

    it("uses defaults for omitted numeric settings", async () => {
      const user = await createUser(db);
      const leagueId = await rpcAs<string>(db, user, "create_league", { p_name: "Defaults", p_team_name: "T", p_max_coaches: 4 });
      const league = await leagueRow(db, leagueId);
      expect([league.point_budget, league.picks_per_team, league.pick_timer_seconds]).toEqual([100, 10, 120]);
    });

    it("validates every field and reports the documented codes", async () => {
      const user = await createUser(db);
      const base = { p_name: "Ok", p_team_name: "Ok", p_max_coaches: 4, p_draft_format_id: null, p_point_budget: 100, p_picks_per_team: 10, p_pick_timer_seconds: 120 };
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_name: "   " }), "invalid_name");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_name: "x".repeat(61) }), "invalid_name");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_team_name: "" }), "invalid_team_name");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_team_name: "x".repeat(41) }), "invalid_team_name");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_max_coaches: 1 }), "invalid_max_coaches");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_max_coaches: 25 }), "invalid_max_coaches");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_point_budget: 0 }), "invalid_point_budget");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_point_budget: 10001 }), "invalid_point_budget");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_picks_per_team: 0 }), "invalid_picks_per_team");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_picks_per_team: 31 }), "invalid_picks_per_team");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_pick_timer_seconds: 9 }), "invalid_pick_timer");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_pick_timer_seconds: 3601 }), "invalid_pick_timer");
      await expectRpcError(rpcAs(db, user, "create_league", { ...base, p_draft_format_id: randomUUID() }), "format_not_found");
    });

    it("only accepts formats visible to the caller", async () => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      const { rows } = await db.query<{ id: string }>(
        "insert into public.draft_formats (name, json, created_by) values ('Private', '{\"pokemon\": [{\"name\":\"A\",\"points\":5,\"tier\":16}]}', $1) returning id",
        [alice],
      );
      const formatId = rows[0].id;
      await expectRpcError(
        rpcAs(db, bob, "create_league", { p_name: "L", p_team_name: "T", p_max_coaches: 4, p_draft_format_id: formatId }),
        "format_not_found",
      );
      const leagueId = await rpcAs<string>(db, alice, "create_league", { p_name: "L", p_team_name: "T", p_max_coaches: 4, p_draft_format_id: formatId });
      const league = await leagueRow(db, leagueId);
      expect(league.draft_format_id).toBe(formatId);
    });

    it("raises not_authenticated without a user", async () => {
      await expectRpcError(
        asAuthenticatedNoSub(db, (c) => rpc(c, "create_league", { p_name: "L", p_team_name: "T", p_max_coaches: 4 })),
        "not_authenticated",
      );
    });
  });

  describe("get_invite_preview and join_league", () => {
    it("previews a league for anon and reports membership for members", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 4 });
      const preview = await asAnon(db, (c) => rpc<Preview>(c, "get_invite_preview", { p_code: league.inviteCode.toLowerCase() }));
      expect(preview).toEqual({
        league_id: league.leagueId,
        league_name: "Test League",
        coach_count: 2,
        max_coaches: 4,
        draft_started: false,
        draft_completed: false,
        already_member: false,
        invite_valid: true,
      });
      const asMember = await rpcAs<Preview>(db, league.coaches[0].userId, "get_invite_preview", { p_code: league.inviteCode });
      expect(asMember.already_member).toBe(true);
    });

    it("returns an invalid preview for unknown or expired codes", async () => {
      const unknown = await asAnon(db, (c) => rpc<Preview>(c, "get_invite_preview", { p_code: "NOPE" }));
      expect(unknown.invite_valid).toBe(false);
      expect(unknown.league_id).toBeNull();
      expect(unknown.already_member).toBe(false);

      const league = await buildLeague(db, { coaches: 0 });
      await db.query("update public.league_invites set expires_at = now() - interval '1 day' where league_id = $1", [league.leagueId]);
      const expired = await asAnon(db, (c) => rpc<Preview>(c, "get_invite_preview", { p_code: league.inviteCode }));
      expect(expired.invite_valid).toBe(false);
      expect(expired.league_name).toBe("Test League");
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: league.inviteCode, p_team_name: "Late" }), "invite_invalid");
    });

    it("joins as a coach, trims the team name and counts the use", async () => {
      const league = await buildLeague(db, { coaches: 0, maxCoaches: 4 });
      const user = await createUser(db);
      const joined = await rpcAs<string>(db, user, "join_league", { p_code: ` ${league.inviteCode.toLowerCase()} `, p_team_name: "  Pidgeys  " });
      expect(joined).toBe(league.leagueId);
      const member = await memberFor(db, league.leagueId, user);
      expect(member.role).toBe("coach");
      expect(member.team_name).toBe("Pidgeys");
      const { rows } = await db.query("select used_count from public.league_invites where league_id = $1", [league.leagueId]);
      expect(rows[0].used_count).toBe(1);
    });

    it("returns the league id for an existing member without inserting again", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 4 });
      const again = await rpcAs<string>(db, league.coaches[0].userId, "join_league", { p_code: league.inviteCode, p_team_name: "" });
      expect(again).toBe(league.leagueId);
      const commissionerJoin = await rpcAs<string>(db, league.commissioner.userId, "join_league", { p_code: league.inviteCode, p_team_name: "Dup" });
      expect(commissionerJoin).toBe(league.leagueId);
      expect(await count(db, "league_members", "league_id = $1", [league.leagueId])).toBe(2);
    });

    it("rejects bad codes, bad team names, full leagues and started drafts", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 2 });
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: "ZZZZZZZZZZ", p_team_name: "T" }), "invite_invalid");
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: league.inviteCode, p_team_name: "T" }), "league_full");

      const roomy = await buildLeague(db, { coaches: 1, maxCoaches: 5 });
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: roomy.inviteCode, p_team_name: "   " }), "invalid_team_name");
      await rpcAs(db, roomy.commissioner.userId, "start_draft", { p_league_id: roomy.leagueId });
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: roomy.inviteCode, p_team_name: "Late" }), "draft_already_started");
    });

    it("two coaches racing for the last seat: exactly one joins", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 3 });
      const a = await createUser(db);
      const b = await createUser(db);
      const connA = await connect();
      const connB = await connect();
      try {
        const results = await Promise.allSettled([
          rpcAs<string>(connA, a, "join_league", { p_code: league.inviteCode, p_team_name: "Racer A" }),
          rpcAs<string>(connB, b, "join_league", { p_code: league.inviteCode, p_team_name: "Racer B" }),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0].reason as { detail?: string }).detail).toBe("league_full");
        expect(await count(db, "league_members", "league_id = $1", [league.leagueId])).toBe(3);
      } finally {
        await connA.end();
        await connB.end();
      }
    });
  });

  describe("regenerate_invite", () => {
    it("replaces the code and resets the counter", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 4 });
      const oldCode = league.inviteCode;
      const newCode = await rpcAs<string>(db, league.commissioner.userId, "regenerate_invite", { p_league_id: league.leagueId });
      expect(newCode).toMatch(CODE_ALPHABET);
      expect(newCode).not.toBe(oldCode);
      expect(await inviteCodeFor(db, league.leagueId)).toBe(newCode);
      const { rows } = await db.query("select used_count from public.league_invites where league_id = $1", [league.leagueId]);
      expect(rows[0].used_count).toBe(0);
      await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: oldCode, p_team_name: "T" }), "invite_invalid");
      await rpcAs(db, await createUser(db), "join_league", { p_code: newCode, p_team_name: "T" });
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "regenerate_invite", { p_league_id: league.leagueId }), "not_commissioner");
    });
  });

  describe("rename_team, leave_league, remove_member, transfer_commissioner", () => {
    it("rename_team updates the caller's own row with validation", async () => {
      const league = await buildLeague(db, { coaches: 1 });
      const coach = league.coaches[0];
      await rpcAs(db, coach.userId, "rename_team", { p_league_id: league.leagueId, p_team_name: "  New Name " });
      expect((await memberFor(db, league.leagueId, coach.userId)).team_name).toBe("New Name");
      await expectRpcError(rpcAs(db, coach.userId, "rename_team", { p_league_id: league.leagueId, p_team_name: "" }), "invalid_team_name");
      await expectRpcError(rpcAs(db, coach.userId, "rename_team", { p_league_id: league.leagueId, p_team_name: "x".repeat(41) }), "invalid_team_name");
      await expectRpcError(rpcAs(db, await createUser(db), "rename_team", { p_league_id: league.leagueId, p_team_name: "Nope" }), "not_a_member");
      await expectRpcError(rpcAs(db, coach.userId, "rename_team", { p_league_id: randomUUID(), p_team_name: "Nope" }), "league_not_found");
    });

    it("leave_league works for coaches before the draft only", async () => {
      const league = await buildLeague(db, { coaches: 2 });
      await expectRpcError(rpcAs(db, league.commissioner.userId, "leave_league", { p_league_id: league.leagueId }), "commissioner_cannot_leave");
      await rpcAs(db, league.coaches[0].userId, "leave_league", { p_league_id: league.leagueId });
      expect(await count(db, "league_members", "id = $1", [league.coaches[0].memberId])).toBe(0);
      await rpcAs(db, league.commissioner.userId, "set_draft_order", {
        p_league_id: league.leagueId,
        p_member_ids: [league.commissioner.memberId, league.coaches[1].memberId],
      });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, league.coaches[1].userId, "leave_league", { p_league_id: league.leagueId }), "draft_already_started");
    });

    it("remove_member is commissioner-only, pre-draft, and never self", async () => {
      const league = await buildLeague(db, { coaches: 2 });
      const [coachA, coachB] = league.coaches;
      await expectRpcError(rpcAs(db, coachA.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: coachB.memberId }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: league.commissioner.memberId }), "cannot_remove_self");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: randomUUID() }), "member_not_found");
      await rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: coachA.memberId });
      expect(await count(db, "league_members", "id = $1", [coachA.memberId])).toBe(0);
      await rpcAs(db, league.commissioner.userId, "set_draft_order", {
        p_league_id: league.leagueId,
        p_member_ids: [league.commissioner.memberId, coachB.memberId],
      });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, league.commissioner.userId, "remove_member", { p_league_id: league.leagueId, p_member_id: coachB.memberId }), "draft_already_started");
    });

    it("transfer_commissioner moves commissioner_id and keeps roles in sync", async () => {
      const league = await buildLeague(db, { coaches: 2 });
      const target = league.coaches[1];
      await expectRpcError(rpcAs(db, target.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: target.memberId }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: randomUUID() }), "member_not_found");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.commissioner.memberId }), "already_commissioner");
      await rpcAs(db, league.commissioner.userId, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: target.memberId });
      expect((await leagueRow(db, league.leagueId)).commissioner_id).toBe(target.userId);
      expect((await memberFor(db, league.leagueId, target.userId)).role).toBe("commissioner");
      expect((await memberFor(db, league.leagueId, league.commissioner.userId)).role).toBe("coach");
      // The old commissioner is now a coach and cannot regenerate invites.
      await expectRpcError(rpcAs(db, league.commissioner.userId, "regenerate_invite", { p_league_id: league.leagueId }), "not_commissioner");
      await rpcAs(db, target.userId, "regenerate_invite", { p_league_id: league.leagueId });
    });
  });

  describe("update_league_settings", () => {
    it("updates accepted keys, validates ranges and returns the league row", async () => {
      const league = await buildLeague(db, { coaches: 2, maxCoaches: 6 });
      const updated = await rpcAs<Record<string, unknown>>(db, league.commissioner.userId, "update_league_settings", {
        p_league_id: league.leagueId,
        p_settings: {
          name: " Renamed ",
          max_coaches: 4,
          point_budget: "150",
          picks_per_team: 6,
          pick_timer_seconds: 45,
          free_agent_swap_limit: 5,
          schedule_format: "double_round_robin",
        },
      });
      expect(updated.id).toBe(league.leagueId);
      expect(updated.name).toBe("Renamed");
      expect(updated.max_coaches).toBe(4);
      expect(updated.point_budget).toBe(150);
      expect(updated.picks_per_team).toBe(6);
      expect(updated.pick_timer_seconds).toBe(45);
      expect(updated.free_agent_swap_limit).toBe(5);
      expect(updated.schedule_format).toBe("double_round_robin");
      const { rows } = await db.query("select max_uses from public.league_invites where league_id = $1", [league.leagueId]);
      expect(rows[0].max_uses).toBe(3);

      const commissioner = league.commissioner.userId;
      const settings = (p_settings: Record<string, unknown>) => rpcAs(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings });
      await expectRpcError(settings({ bogus: 1 }), "unknown_setting");
      // node-pg would encode a JS array as a Postgres array, so send the JSON text.
      await expectRpcError(rpcAs(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: JSON.stringify([1]) }), "invalid_settings");
      await expectRpcError(settings({ name: "" }), "invalid_name");
      await expectRpcError(settings({ max_coaches: 30 }), "invalid_max_coaches");
      await expectRpcError(settings({ max_coaches: "abc" }), "invalid_max_coaches");
      await expectRpcError(settings({ max_coaches: 2 }), "max_coaches_below_members");
      await expectRpcError(settings({ point_budget: 0 }), "invalid_point_budget");
      await expectRpcError(settings({ picks_per_team: 31 }), "invalid_picks_per_team");
      await expectRpcError(settings({ pick_timer_seconds: 5 }), "invalid_pick_timer");
      await expectRpcError(settings({ free_agent_swap_limit: -1 }), "invalid_swap_limit");
      await expectRpcError(settings({ schedule_format: "cup" }), "invalid_schedule_format");
      await expectRpcError(settings({ draft_format_id: randomUUID() }), "format_not_found");
      await expectRpcError(settings({ draft_format_id: "not-a-uuid" }), "format_not_found");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { name: "x" } }), "not_commissioner");
    });

    it("locks draft-affecting fields once the draft has started", async () => {
      const league = await buildLeague(db, { coaches: 2, maxCoaches: 6 });
      const commissioner = league.commissioner.userId;
      const settings = (p_settings: Record<string, unknown>) => rpcAs<Record<string, unknown>>(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings });
      const { rows } = await db.query<{ id: string }>(
        `insert into public.draft_formats (name, json, created_by)
         values ('Shared A', '{"pokemon": [{"name":"A","points":5,"tier":16}]}', null), ('Shared B', '{"pokemon": [{"name":"A","points":5,"tier":16}]}', null)
         returning id`,
      );
      const [formatA, formatB] = rows.map((r) => r.id);
      // The format is chosen before the draft; the pool comes from the fixture's custom_pool.
      await settings({ draft_format_id: formatA });
      await rpcAs(db, commissioner, "update_league_pool", { p_league_id: league.leagueId, p_pool: { pokemon: samplePool(12) } });
      await rpcAs(db, commissioner, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(settings({ point_budget: 200 }), "locked_during_draft");
      await expectRpcError(settings({ picks_per_team: 5 }), "locked_during_draft");
      await expectRpcError(settings({ max_coaches: 5 }), "locked_during_draft");
      await expectRpcError(settings({ draft_format_id: null }), "locked_during_draft");
      await expectRpcError(settings({ draft_format_id: formatB }), "locked_during_draft");
      // Unchanged values and the unlocked keys are fine.
      const ok = await settings({ point_budget: 100, draft_format_id: formatA, name: "Mid-draft rename", pick_timer_seconds: 30, free_agent_swap_limit: 1, schedule_format: "double_round_robin" });
      expect(ok.custom_pool).not.toBeNull();
      expect(ok.name).toBe("Mid-draft rename");
      expect(ok.pick_timer_seconds).toBe(30);
      expect(ok.free_agent_swap_limit).toBe(1);
      expect(ok.schedule_format).toBe("double_round_robin");
    });

    it("replaces custom_pool with a copy of the new draft format when it changes, and keeps it otherwise", async () => {
      const league = await buildLeague(db, { coaches: 1 });
      const commissioner = league.commissioner.userId;
      const { rows } = await db.query<{ id: string }>(
        "insert into public.draft_formats (name, json, created_by) values ('Shared', '{\"pokemon\": [{\"name\":\"A\",\"points\":5,\"tier\":16}]}', null) returning id",
      );
      const formatId = rows[0].id;
      expect((await leagueRow(db, league.leagueId)).custom_pool).not.toBeNull();
      const changed = await rpcAs<Record<string, unknown>>(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: { draft_format_id: formatId } });
      expect(changed.draft_format_id).toBe(formatId);
      // The league does not follow the format live: it takes a copy now.
      expect(changed.custom_pool).toEqual({
        version: "1.0",
        leagueName: "Test League",
        pokemon: [{ name: "A", points: 5, tier: 16 }],
        source: "format",
        draft_format_id: formatId,
      });

      await rpcAs(db, commissioner, "update_league_pool", { p_league_id: league.leagueId, p_pool: { pokemon: samplePool(3) } });
      const same = await rpcAs<Record<string, unknown>>(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: { draft_format_id: formatId, name: "Still custom" } });
      const samePool = same.custom_pool as { pokemon: unknown[]; source?: string };
      expect(samePool.pokemon).toHaveLength(3);
      expect(samePool.source).toBeUndefined();

      const cleared = await rpcAs<Record<string, unknown>>(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: { draft_format_id: null } });
      expect(cleared.draft_format_id).toBeNull();
      expect(cleared.custom_pool).toBeNull();
    });
  });

  describe("update_league_pool and reset_league_pool", () => {
    it("stores a normalized pool and rejects invalid ones", async () => {
      const league = await buildLeague(db, { coaches: 1, pool: null });
      const commissioner = league.commissioner.userId;
      const setPool = (p_pool: unknown) => rpcAs(db, commissioner, "update_league_pool", { p_league_id: league.leagueId, p_pool });

      await setPool({ version: "2.0", leagueName: "", pokemon: [{ name: " Bulbasaur ", points: 7 }, { name: "Ivysaur", points: "9", tier: 12 }] });
      const stored = (await leagueRow(db, league.leagueId)).custom_pool as { version: string; leagueName: string; pokemon: unknown[] };
      // The client's version is ignored; a blank leagueName falls back to the league name.
      expect(stored.version).toBe("1.0");
      expect(stored.leagueName).toBe("Test League");
      expect(stored.pokemon).toEqual([
        { name: "Bulbasaur", points: 7, tier: 14 },
        { name: "Ivysaur", points: 9, tier: 12 },
      ]);
      // leagueName is trimmed and capped like a league name (60 chars).
      await setPool({ leagueName: `  ${"n".repeat(70)}  `, pokemon: [{ name: "A", points: 1 }] });
      expect(((await leagueRow(db, league.leagueId)).custom_pool as { leagueName: string }).leagueName).toBe("n".repeat(60));

      await expectRpcError(setPool({ version: "1.0" }), "invalid_pool");
      await expectRpcError(setPool({ pokemon: [] }), "invalid_pool");
      await expectRpcError(setPool({ pokemon: ["x"] }), "invalid_pool");
      await expectRpcError(setPool({ pokemon: [{ name: "", points: 5 }] }), "invalid_pool");
      await expectRpcError(setPool({ pokemon: [{ name: "A", points: 5 }, { name: "a", points: 6 }] }), "duplicate_pokemon");
      await expectRpcError(setPool({ pokemon: [{ name: "A", points: 0 }] }), "invalid_points");
      await expectRpcError(setPool({ pokemon: [{ name: "A", points: 21 }] }), "invalid_points");
      await expectRpcError(setPool({ pokemon: [{ name: "A", points: "abc" }] }), "invalid_points");
      await expectRpcError(setPool({ pokemon: [{ name: "A", points: 5, tier: 3 }] }), "invalid_tier");
      await expectRpcError(setPool({ pokemon: samplePool(2001) }), "invalid_pool");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "update_league_pool", { p_league_id: league.leagueId, p_pool: { pokemon: samplePool(2) } }), "not_commissioner");

      await rpcAs(db, commissioner, "reset_league_pool", { p_league_id: league.leagueId });
      expect((await leagueRow(db, league.leagueId)).custom_pool).toBeNull();
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "reset_league_pool", { p_league_id: league.leagueId }), "not_commissioner");
    });

    it("is locked once the draft has started", async () => {
      const league = await buildLeague(db, { coaches: 1 });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, league.commissioner.userId, "update_league_pool", { p_league_id: league.leagueId, p_pool: { pokemon: samplePool(4) } }), "draft_already_started");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "reset_league_pool", { p_league_id: league.leagueId }), "draft_already_started");
    });
  });

  describe("set_draft_order", () => {
    it("assigns positions 1..n in order, nulls the rest, and validates the permutation", async () => {
      const league = await buildLeague(db, { coaches: 3, setOrder: false });
      const commissioner = league.commissioner.userId;
      const [a, b, c] = league.coaches;
      const setOrder = (ids: unknown[]) => rpcAs(db, commissioner, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: ids });

      await setOrder([b.memberId, league.commissioner.memberId, a.memberId]);
      expect((await memberFor(db, league.leagueId, b.userId)).draft_position).toBe(1);
      expect((await memberFor(db, league.leagueId, league.commissioner.userId)).draft_position).toBe(2);
      expect((await memberFor(db, league.leagueId, a.userId)).draft_position).toBe(3);
      expect((await memberFor(db, league.leagueId, c.userId)).draft_position).toBeNull();

      // Swapping positions in one statement relies on the deferred unique constraint.
      await setOrder([a.memberId, league.commissioner.memberId, b.memberId, c.memberId]);
      expect((await memberFor(db, league.leagueId, a.userId)).draft_position).toBe(1);
      expect((await memberFor(db, league.leagueId, b.userId)).draft_position).toBe(3);
      expect((await memberFor(db, league.leagueId, c.userId)).draft_position).toBe(4);

      await expectRpcError(setOrder([a.memberId]), "not_enough_coaches");
      await expectRpcError(setOrder([]), "not_enough_coaches");
      await expectRpcError(setOrder([a.memberId, a.memberId]), "duplicate_member");
      await expectRpcError(setOrder([a.memberId, randomUUID()]), "member_not_found");
      await expectRpcError(setOrder([a.memberId, null]), "member_not_found");
      await expectRpcError(rpcAs(db, a.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: [a.memberId, b.memberId] }), "not_commissioner");

      await rpcAs(db, commissioner, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(setOrder([b.memberId, a.memberId]), "draft_already_started");
    });
  });

  it("get_server_time returns the database clock", async () => {
    const before = Date.now();
    const time = await asUser(db, await createUser(db), (c) => rpc<Date>(c, "get_server_time"));
    expect(Math.abs(new Date(time).getTime() - before)).toBeLessThan(10_000);
  });
});
