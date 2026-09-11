// Security review, round 4 (attacker with a coach account and the anon key).
// Probes what the round-3 "copy the format onto the league" change opened or
// left open:
//   1. the format -> custom_pool copy (_format_pool) used a lenient parser
//      instead of update_league_pool's validation, so a commissioner could
//      write any draft_formats.json straight through PostgREST and have it
//      copied onto the league as the draft pool (0-point entries, 300-char
//      names, 20000 entries). Fixed in round 3: _validate_pool is the one
//      pool parser (update_league_pool, the format copies taken by
//      create_league / update_league_settings / reset_league_pool, and the
//      migration backfill all use it) and draft_formats carries structural
//      check constraints. The "FIXED" tests pin that.
//   2. make_pick / swap_free_agent reported the league's draft state before
//      the membership check, so an outsider armed with a league id learned it.
//      Fixed: _member_for runs right after the league lock, ahead of every
//      draft-state check, so a non-member only ever sees not_a_member. The
//      "FIXED" tests pin that, and that members still get the state codes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expectSqlState,
  leagueRow,
  memberFor,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
} from "./harness";

type PoolRow = { name: string; points: number; tier: number };

// Lists update_league_pool rejects, one per rule: points outside 1..20 (as a
// small and as an oversized number), a name over 80 characters, a tier that
// contradicts its points, and a duplicate name. Each is small enough to pass
// draft_formats' structural check (an object with a pokemon array of at most
// 2000 entries), so only _validate_pool stands between it and a league.
const RIGGED: Array<{ label: string; entries: Array<Record<string, unknown>>; code: string; message: RegExp }> = [
  { label: "0 points", entries: [{ name: "Zero", points: 0 }], code: "invalid_points", message: /"Zero" needs integer points between 1 and 20\./ },
  { label: "500000 points", entries: [{ name: "Huge", points: 500000 }], code: "invalid_points", message: /"Huge" needs integer points between 1 and 20\./ },
  { label: "81-char name", entries: [{ name: "N".repeat(81), points: 1 }], code: "invalid_pool", message: /name of at most 80 characters/ },
  { label: "wrong tier", entries: [{ name: "Neg", points: 2, tier: -7 }], code: "invalid_tier", message: /"Neg" has a tier that does not match its points\./ },
  { label: "duplicate name", entries: [{ name: "Twin", points: 3 }, { name: " twin ", points: 4 }], code: "duplicate_pokemon", message: /"twin" appears more than once in the pool\./i },
];

const CREATE_ARGS = { p_name: "Rigged League", p_team_name: "Commish", p_max_coaches: 4, p_point_budget: 100, p_picks_per_team: 2, p_pick_timer_seconds: 60 };

describe("security review round 4: format copy validation, state leaks", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  async function insertFormat(owner: string, json: unknown, name = "Rigged"): Promise<string> {
    const { rows } = await asUser(db, owner, (c) =>
      c.query<{ id: string }>("insert into public.draft_formats (name, json) values ($1, $2) returning id", [name, JSON.stringify(json)]),
    );
    return rows[0].id;
  }

  async function poolOf(leagueId: string): Promise<PoolRow[]> {
    const { rows } = await db.query<PoolRow>("select name, points, tier from public._league_pool($1) order by points desc, name", [leagueId]);
    return rows;
  }

  describe("draft_formats.json is validated like update_league_pool before it is copied onto a league", () => {
    it("FIXED: create_league refuses a format on every rule update_league_pool has, with the same code and a message that names the format, and creates nothing", async () => {
      const commissioner = await createUser(db);
      const scratch = await buildLeague(db, { coaches: 0, setOrder: false, pool: null });
      for (const rigged of RIGGED) {
        const pokemon = [...samplePool(4), ...rigged.entries];
        // update_league_pool's verdict ...
        const direct = await expectRpcError(
          rpcAs(db, scratch.commissioner.userId, "update_league_pool", { p_league_id: scratch.leagueId, p_pool: { pokemon } }),
          rigged.code,
        );
        expect(direct.message, rigged.label).toMatch(rigged.message);
        // ... is the format copy's verdict, prefixed with the format's name.
        const formatId = await insertFormat(commissioner, { version: "1.0", leagueName: "Rigged", pokemon });
        const viaFormat = await expectRpcError(rpcAs(db, commissioner, "create_league", { ...CREATE_ARGS, p_draft_format_id: formatId }), rigged.code);
        expect(viaFormat.message, rigged.label).toMatch(rigged.message);
        expect(viaFormat.message, rigged.label).toContain('The draft format "Rigged" cannot be used as a pool: ');
      }
      expect(await count(db, "leagues", "commissioner_id = $1", [commissioner])).toBe(0);
      expect(await count(db, "league_members", "user_id = $1", [commissioner])).toBe(0);
    });

    it("FIXED: update_league_settings and reset_league_pool refuse a rigged format and leave the league's validated pool, name and format alone", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      const commissioner = league.commissioner.userId;
      const riggedId = await insertFormat(commissioner, { pokemon: [...samplePool(4), { name: "Zero", points: 0 }] });
      const fineId = await insertFormat(commissioner, { pokemon: samplePool(6) }, "Fine");
      const before = await leagueRow(db, league.leagueId);
      expect(await poolOf(league.leagueId)).toHaveLength(12);

      const refused = await expectRpcError(
        rpcAs(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: { draft_format_id: riggedId, name: "Renamed" } }),
        "invalid_points",
      );
      expect(refused.message).toBe('The draft format "Rigged" cannot be used as a pool: "Zero" needs integer points between 1 and 20.');
      const after = await leagueRow(db, league.leagueId);
      expect(after.name).toBe(before.name);
      expect(after.draft_format_id).toBeNull();
      expect(after.custom_pool).toEqual(before.custom_pool);

      // A valid format is copied. The owner then rigs the row directly
      // (allowed: it is their format) and "Reset to format" refuses the edit.
      await rpcAs(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings: { draft_format_id: fineId } });
      const copied = await poolOf(league.leagueId);
      expect(copied).toHaveLength(6);
      const update = await asUser(db, commissioner, (c) =>
        c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon: [...samplePool(6), { name: "Huge", points: 500000 }] }), fineId]),
      );
      expect(update.rowCount).toBe(1);
      await expectRpcError(rpcAs(db, commissioner, "reset_league_pool", { p_league_id: league.leagueId }), "invalid_points");
      expect(await poolOf(league.leagueId)).toEqual(copied);
      expect(copied.every((p) => p.points >= 1 && p.points <= 20 && p.tier === 21 - p.points)).toBe(true);
    });

    it("FIXED: the 2000-entry cap applies to formats: a larger list cannot even be stored (23514), the copy refuses it regardless, and a 2000-entry format drafts in milliseconds", async () => {
      const commissioner = await createUser(db);
      const entry = (i: number) => ({ name: `Mon${String(i + 1).padStart(5, "0")}-${"x".repeat(60)}`, points: 20 - (i % 20) });
      const tooBig = Array.from({ length: 2001 }, (_, i) => entry(i));
      await expectSqlState(insertFormat(commissioner, { pokemon: tooBig }, "Big"), "23514");
      // The copy path has its own cap, for a row that predates the constraint.
      const capped = await expectSqlState(db.query("select public._validate_pool($1::jsonb)", [JSON.stringify(tooBig)]), "P0001");
      expect(capped.detail).toBe("invalid_pool");

      const big = tooBig.slice(0, 2000);
      const formatId = await insertFormat(commissioner, { pokemon: big }, "Big");
      const leagueId = await rpcAs<string>(db, commissioner, "create_league", { ...CREATE_ARGS, p_name: "Big League", p_draft_format_id: formatId });
      const { rows } = await db.query<{ n: number; len: number }>(
        "select jsonb_array_length(custom_pool -> 'pokemon') as n, octet_length(custom_pool::text) as len from public.leagues where id = $1",
        [leagueId],
      );
      expect(rows[0].n).toBe(2000);
      expect(rows[0].len).toBeLessThan(300_000);

      const invite = await db.query<{ invite_code: string }>("select invite_code from public.league_invites where league_id = $1", [leagueId]);
      const coach = await createUser(db);
      await rpcAs(db, coach, "join_league", { p_code: invite.rows[0].invite_code, p_team_name: "Coach" });
      const coachMember = await memberFor(db, leagueId, coach);
      const commissionerMember = await memberFor(db, leagueId, commissioner);
      await rpcAs(db, commissioner, "set_draft_order", { p_league_id: leagueId, p_member_ids: [commissionerMember.id, coachMember.id] });
      await rpcAs(db, commissioner, "start_draft", { p_league_id: leagueId });
      const t0 = Date.now();
      await rpcAs(db, commissioner, "make_pick", { p_league_id: leagueId, p_pokemon_name: big[0].name });
      const makePickMs = Date.now() - t0;
      const t1 = Date.now();
      await rpcAs(db, commissioner, "force_pick", { p_league_id: leagueId, p_pokemon_name: null });
      const forcePickMs = Date.now() - t1;
      console.log(`TIMING pool=2000 (format copy): custom_pool=${rows[0].len} bytes make_pick=${makePickMs}ms force_pick(best available)=${forcePickMs}ms`);
      expect(makePickMs).toBeLessThan(5_000);
      expect(forcePickMs).toBeLessThan(5_000);
      expect(await count(db, "draft_picks", "league_id = $1", [leagueId])).toBe(2);
    });

    it("FIXED: what a league gets from a format is normalized like an update_league_pool pool: trimmed names, integer points, tier filled in, the format's order kept", async () => {
      const commissioner = await createUser(db);
      const messy = [
        { name: " Eevee ", points: "3" },
        { name: "Pikachu", points: 5, tier: 16 },
        { name: "Mew", points: 20, tier: null },
      ];
      const formatId = await insertFormat(commissioner, { version: "2.0", leagueName: "ignored", pokemon: messy }, "Messy");
      const leagueId = await rpcAs<string>(db, commissioner, "create_league", { ...CREATE_ARGS, p_name: "Messy League", p_draft_format_id: formatId });
      const { rows } = await db.query<{ custom_pool: unknown }>("select custom_pool from public.leagues where id = $1", [leagueId]);
      expect(rows[0].custom_pool).toEqual({
        version: "1.0",
        leagueName: "Messy League",
        source: "format",
        draft_format_id: formatId,
        pokemon: [
          { name: "Eevee", points: 3, tier: 18 },
          { name: "Pikachu", points: 5, tier: 16 },
          { name: "Mew", points: 20, tier: 1 },
        ],
      });
      const pool = await poolOf(leagueId);
      expect(pool).toHaveLength(3);
      expect(pool.every((p) => p.points >= 1 && p.points <= 20 && p.tier === 21 - p.points && p.name.length <= 80)).toBe(true);
    });
  });

  describe("the draft state is not reported to an outsider", () => {
    // Every member-shaped RPC answers a non-member with not_a_member (and the
    // commissioner-shaped one with not_commissioner) whatever the draft state.
    async function probeAsOutsider(outsider: string, leagueId: string): Promise<void> {
      await expectRpcError(rpcAs(db, outsider, "make_pick", { p_league_id: leagueId, p_pokemon_name: "Mon001" }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "swap_free_agent", { p_league_id: leagueId, p_drop_name: null, p_add_name: "Mon001" }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "auto_pick_if_expired", { p_league_id: leagueId }), "not_a_member");
      await expectRpcError(rpcAs(db, outsider, "force_pick", { p_league_id: leagueId, p_pokemon_name: null }), "not_commissioner");
    }

    it("FIXED: with only a league id, a non-member gets not_a_member from make_pick and swap_free_agent whether the draft is not started, live, paused or completed", async () => {
      const outsider = await createUser(db);
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      await probeAsOutsider(outsider, league.leagueId);

      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await probeAsOutsider(outsider, league.leagueId);

      await rpcAs(db, league.commissioner.userId, "pause_draft", { p_league_id: league.leagueId });
      await probeAsOutsider(outsider, league.leagueId);

      const completed = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      await runFullDraft(db, completed);
      await probeAsOutsider(outsider, completed.leagueId);

      // The outsider still reads nothing and changed nothing.
      expect(await asUser(db, outsider, (c) => count(c, "leagues", "id = $1", [completed.leagueId]))).toBe(0);
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(0);
      expect(await count(db, "league_news", "league_id = $1", [completed.leagueId])).toBe(0);
    });

    it("FIXED: members still get the draft-state codes (not started, not completed, paused, completed) after the membership check", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      const coach = league.coaches[0];
      await expectRpcError(rpcAs(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" }), "draft_not_started");
      await expectRpcError(
        rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Mon001" }),
        "draft_not_completed",
      );
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await rpcAs(db, league.commissioner.userId, "pause_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" }), "draft_paused");

      const completed = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(12) });
      await runFullDraft(db, completed);
      await expectRpcError(rpcAs(db, completed.coaches[0].userId, "make_pick", { p_league_id: completed.leagueId, p_pokemon_name: "Mon001" }), "draft_completed");
    });
  });
});
