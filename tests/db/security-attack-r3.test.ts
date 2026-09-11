// Security review round 3: an attacker with a valid coach account probes the
// gaps the earlier suites do not pin. The format-ownership block is a set of
// regressions for a closed hole (a league never reads draft_formats live; its
// pool is the copy on leagues.custom_pool). The chat block pins another closed
// hole: draft_chat_messages.id and created_at are assigned by the
// draft_chat_messages_defaults trigger, so a member cannot pin a message to
// 2099 or choose its id. The remaining "CURRENT BEHAVIOUR" test documents an
// accepted deviation (the unknown_setting message echoes the client's key).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  buildLeague,
  count,
  createUser,
  connect,
  expectRpcError,
  memberFor,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
} from "./harness";

type FormatLeague = {
  owner: string;
  coach: string;
  leagueId: string;
  formatId: string;
  ownerMemberId: string;
  coachMemberId: string;
};

describe("security review round 3: format ownership window, chat rows, reflected input", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  // A league drafting from a private format owned by its creator, with one
  // coach, draft order owner first. Nothing has started yet.
  async function leagueOnOwnedFormat(): Promise<FormatLeague> {
    const owner = await createUser(db);
    const { rows } = await asUser(db, owner, (c) =>
      c.query<{ id: string }>("insert into public.draft_formats (name, json) values ('Mine', $1) returning id", [
        JSON.stringify({ version: "1.0", leagueName: "Mine", pokemon: samplePool(12) }),
      ]),
    );
    const formatId = rows[0].id;
    const leagueId = await rpcAs<string>(db, owner, "create_league", {
      p_name: "Format League",
      p_team_name: "Owner",
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
    const ownerMember = await memberFor(db, leagueId, owner);
    await rpcAs(db, owner, "set_draft_order", { p_league_id: leagueId, p_member_ids: [ownerMember.id, coachMember.id] });
    return { owner, coach, leagueId, formatId, ownerMemberId: ownerMember.id, coachMemberId: coachMember.id };
  }

  async function poolNames(leagueId: string): Promise<Array<{ name: string; points: number }>> {
    const { rows } = await db.query<{ name: string; points: number }>("select name, points from public._league_pool($1) order by points desc, name", [leagueId]);
    return rows;
  }

  describe("a former commissioner who still owns the league's draft format", () => {
    // The league copied the format onto its own row when it was created
    // (leagues.custom_pool, source "format"), so from then on only the
    // commissioner (update_league_pool / reset_league_pool) changes what it
    // drafts from. The format row itself stays the old commissioner's.
    it("between transfer_commissioner and start_draft the old commissioner's rewrite of the format row leaves the league's pool untouched, and the planted 0-point entry cannot be drafted", async () => {
      const league = await leagueOnOwnedFormat();
      await rpcAs(db, league.owner, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coachMemberId });

      // Everything commissioner-shaped is closed to the old commissioner ...
      await expectRpcError(
        rpcAs(db, league.owner, "update_league_pool", { p_league_id: league.leagueId, p_pool: { pokemon: [{ name: "Only", points: 1 }] } }),
        "not_commissioner",
      );
      // ... the new commissioner (not the owner) cannot touch the format row ...
      const byNewCommissioner = await asUser(db, league.coach, (c) =>
        c.query("update public.draft_formats set json = '{\"pokemon\":[]}' where id = $1", [league.formatId]),
      );
      expect(byNewCommissioner.rowCount).toBe(0);

      // ... and the old commissioner can still rewrite the row they own.
      const longName = "L".repeat(5_000);
      const rigged = {
        pokemon: [
          ...samplePool(12),
          { name: "Freebie", points: 0 },
          { name: longName, points: 999_999 },
        ],
      };
      const update = await asUser(db, league.owner, (c) => c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify(rigged), league.formatId]));
      expect(update.rowCount).toBe(1);

      // The league does not notice: it drafts from the 12 entries the
      // commissioner chose, and no entry can cost 0 points.
      const pool = await poolNames(league.leagueId);
      expect(pool).toHaveLength(12);
      expect(pool.map((p) => p.name)).not.toContain("Freebie");
      expect(pool.map((p) => p.name)).not.toContain(longName);
      expect(pool.every((p) => p.points >= 1 && p.points <= 20)).toBe(true);
      const { rows: stored } = await db.query<{ n: number; has_freebie: boolean }>(
        `select jsonb_array_length(custom_pool -> 'pokemon') as n,
                exists (select 1 from jsonb_array_elements(custom_pool -> 'pokemon') e where e ->> 'name' = 'Freebie') as has_freebie
         from public.leagues where id = $1`,
        [league.leagueId],
      );
      expect(stored[0]).toEqual({ n: 12, has_freebie: false });

      // The new commissioner starts the draft from that same list ...
      await rpcAs(db, league.coach, "start_draft", { p_league_id: league.leagueId });
      const { rows: frozen } = await db.query<{ n: number }>("select jsonb_array_length(custom_pool -> 'pokemon') as n from public.leagues where id = $1", [league.leagueId]);
      expect(frozen[0].n).toBe(12);
      // ... and the old commissioner, picking first, cannot take the free entry.
      await expectRpcError(rpcAs(db, league.owner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Freebie" }), "pokemon_not_in_pool");
      const pick = await rpcAs<{ pick_number: number; pokemon_name: string }>(db, league.owner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
      expect(pick).toMatchObject({ pick_number: 1, pokemon_name: "Mon001" });
      const { rows: picks } = await db.query<{ points: number; tier: number }>("select points, tier from public.draft_picks where league_id = $1 and pokemon_name = 'Mon001'", [league.leagueId]);
      expect(picks[0]).toEqual({ points: 20, tier: 1 });
    });

    it("deleting the format before start_draft unlinks it, but the league keeps its copy and the new commissioner can still start the draft", async () => {
      const league = await leagueOnOwnedFormat();
      await rpcAs(db, league.owner, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coachMemberId });
      const del = await asUser(db, league.owner, (c) => c.query("delete from public.draft_formats where id = $1", [league.formatId]));
      expect(del.rowCount).toBe(1);
      const { rows } = await db.query<{ draft_format_id: string | null; custom_pool: { source?: string; draft_format_id?: string; pokemon: unknown[] } | null }>(
        "select draft_format_id, custom_pool from public.leagues where id = $1",
        [league.leagueId],
      );
      expect(rows[0].draft_format_id).toBeNull();
      expect(rows[0].custom_pool).toMatchObject({ source: "format", draft_format_id: league.formatId });
      expect(rows[0].custom_pool?.pokemon).toHaveLength(12);
      expect(await poolNames(league.leagueId)).toHaveLength(12);
      await rpcAs(db, league.coach, "start_draft", { p_league_id: league.leagueId });
      expect((await db.query("select draft_started from public.leagues where id = $1", [league.leagueId])).rows[0].draft_started).toBe(true);
    });

    it("a league's pool is fixed by its commissioner, not by whoever owns the format row after a transfer", async () => {
      const league = await leagueOnOwnedFormat();
      await rpcAs(db, league.owner, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coachMemberId });
      await asUser(db, league.owner, (c) =>
        c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon: [...samplePool(12), { name: "Freebie", points: 0 }] }), league.formatId]),
      );
      const pool = await poolNames(league.leagueId);
      expect(pool.map((p) => p.name)).not.toContain("Freebie");
      expect(pool.every((p) => p.points >= 1 && p.points <= 20)).toBe(true);
      // Only the commissioner puts the format's current list back on the league, and only on request.
      await expectRpcError(rpcAs(db, league.owner, "reset_league_pool", { p_league_id: league.leagueId }), "not_commissioner");
      expect(await poolNames(league.leagueId)).toHaveLength(12);
    });

    it("a league whose custom_pool is null never falls back to draft_formats, so a 0-point entry planted in the format is not a free agent of a finished season", async () => {
      // Real pre-release rows (custom_pool null, draft_format_id set) are
      // backfilled by the migration; see live-simulation.test.ts. This pins the
      // functions themselves: with no pool array on the league row the pool is
      // empty, never the format's live json.
      const league = await leagueOnOwnedFormat();
      const commissionerParticipant = { userId: league.owner, memberId: league.ownerMemberId, teamName: "Owner" };
      const coachParticipant = { userId: league.coach, memberId: league.coachMemberId, teamName: "Coach" };
      await runFullDraft(db, {
        leagueId: league.leagueId,
        inviteCode: "",
        commissioner: commissionerParticipant,
        coaches: [coachParticipant],
        order: [commissionerParticipant, coachParticipant],
      });
      await db.query("update public.leagues set custom_pool = null where id = $1", [league.leagueId]);
      expect((await db.query("select draft_completed from public.leagues where id = $1", [league.leagueId])).rows[0].draft_completed).toBe(true);

      await rpcAs(db, league.owner, "transfer_commissioner", { p_league_id: league.leagueId, p_member_id: league.coachMemberId });
      const rigged = { pokemon: [...samplePool(12), { name: "Freebie", points: 0 }] };
      await asUser(db, league.owner, (c) => c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify(rigged), league.formatId]));

      expect(await poolNames(league.leagueId)).toHaveLength(0);
      const before = await teamFor(db, league.leagueId, league.ownerMemberId);
      await expectRpcError(
        rpcAs(db, league.owner, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: before.pokemon[0].name, p_add_name: "Freebie" }),
        "pokemon_not_in_pool",
      );
      const after = await teamFor(db, league.leagueId, league.ownerMemberId);
      expect(after.pokemon).toEqual(before.pokemon);
      expect(after.total_points).toBe(before.total_points);
    });
  });

  describe("draft chat rows", () => {
    // Postgres' now() and Date.now() run on the same machine here; the window
    // only has to absorb the round trips, not a clock skew.
    const CLOCK_WINDOW_MS = 60_000;

    it("FIXED: id and created_at are server-assigned, so a chosen id and a 2099 (or 2000) timestamp are ignored and the message sorts with the real conversation", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      const coach = league.coaches[0];
      const honest = await asUser(db, coach.userId, (c) =>
        c.query<{ id: string; created_at: Date }>(
          "insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'hello') returning id, created_at",
          [league.leagueId, coach.memberId, coach.userId],
        ),
      );

      const chosenId = "11111111-2222-4333-8444-555555555555";
      const pinned = await asUser(db, coach.userId, (c) =>
        c.query<{ id: string; created_at: Date }>(
          `insert into public.draft_chat_messages (id, league_id, member_id, user_id, message, created_at)
           values ($1, $2, $3, $4, 'pinned forever', '2099-01-01T00:00:00Z') returning id, created_at`,
          [chosenId, league.leagueId, coach.memberId, coach.userId],
        ),
      );
      const backdated = await asUser(db, coach.userId, (c) =>
        c.query<{ id: string; created_at: Date }>(
          `insert into public.draft_chat_messages (league_id, member_id, user_id, message, created_at)
           values ($1, $2, $3, 'first, honest', '2000-01-01T00:00:00Z') returning id, created_at`,
          [league.leagueId, coach.memberId, coach.userId],
        ),
      );

      // The insert succeeded (the room's insert().select() keeps working) with
      // server values: a fresh id and the transaction's clock.
      expect(pinned.rows[0].id).not.toBe(chosenId);
      expect(pinned.rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      for (const row of [pinned.rows[0], backdated.rows[0]]) {
        expect(row.created_at.getUTCFullYear()).not.toBe(2099);
        expect(row.created_at.getUTCFullYear()).not.toBe(2000);
        expect(Math.abs(row.created_at.getTime() - Date.now())).toBeLessThan(CLOCK_WINDOW_MS);
        expect(row.created_at.getTime()).toBeGreaterThanOrEqual(honest.rows[0].created_at.getTime());
      }
      expect(await count(db, "draft_chat_messages", "id = $1", [chosenId])).toBe(0);

      // Chronological order is the order the messages were sent in.
      const { rows } = await db.query<{ id: string }>("select id from public.draft_chat_messages where league_id = $1 order by created_at, id", [league.leagueId]);
      expect(rows.map((r) => r.id)).toEqual([honest.rows[0].id, pinned.rows[0].id, backdated.rows[0].id]);
    });

    it("draft_chat_messages.created_at is server-assigned: a client-supplied future timestamp is ignored", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      const coach = league.coaches[0];
      const inserted = await asUser(db, coach.userId, (c) =>
        c.query<{ created_at: Date }>(
          `insert into public.draft_chat_messages (league_id, member_id, user_id, message, created_at)
           values ($1, $2, $3, 'pinned forever', '2099-01-01T00:00:00Z') returning created_at`,
          [league.leagueId, coach.memberId, coach.userId],
        ),
      );
      expect(inserted.rows).toHaveLength(1);
      expect(inserted.rows[0].created_at.getUTCFullYear()).toBeLessThan(2099);
      expect(Math.abs(inserted.rows[0].created_at.getTime() - Date.now())).toBeLessThan(CLOCK_WINDOW_MS);
    });

    it("the defaults trigger is the only trigger on the table and its function is internal", async () => {
      const { rows: triggers } = await db.query<{ tgname: string; tgenabled: string; fn: string }>(
        `select t.tgname, t.tgenabled, p.proname as fn
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.draft_chat_messages'::regclass and not t.tgisinternal
         order by t.tgname`,
      );
      expect(triggers).toEqual([{ tgname: "draft_chat_messages_defaults", tgenabled: "O", fn: "_chat_message_defaults" }]);
      const { rows: grants } = await db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', 'public._chat_message_defaults()', 'execute') as anon,
                has_function_privilege('authenticated', 'public._chat_message_defaults()', 'execute') as authenticated`,
      );
      expect(grants[0]).toEqual({ anon: false, authenticated: false });
    });
  });

  describe("reflected input in user-facing errors", () => {
    it("CURRENT BEHAVIOUR: update_league_settings echoes an unbounded client-chosen key back in the unknown_setting message the UI displays verbatim", async () => {
      const league = await buildLeague(db, { coaches: 0, setOrder: false, pool: null });
      const key = "k".repeat(200_000);
      const error = await expectRpcError(
        rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { [key]: 1 } }),
        "unknown_setting",
      );
      expect(error.message.length).toBeGreaterThan(200_000);
      expect(error.message).toContain(key);
    });
  });
});
