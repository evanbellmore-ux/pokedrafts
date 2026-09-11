// Review probes for the correctness/concurrency lens: snake mapping, budget
// reserve, finalize boundary, schedule parity for n = 2..8, timer math around
// pause/resume, pick races, invite alphabet and constraint shape.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildScheduleRows, type ScheduleFormat } from "../../app/lib/league/schedule";
import {
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expireTimer,
  leagueRow,
  rpcAs,
  samplePool,
  teamFor,
  type Client,
} from "./harness";

type PickResult = { pick_number: number; draft_completed: boolean; pokemon_name?: string; skipped?: boolean };
type AutoPickResult = { picked: boolean; pokemon_name: string | null; skipped: boolean; draft_completed: boolean };

describe("review: correctness and concurrency", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("_snake_member maps every pick of a 4-team x 3-round draft, including the last pick of even and odd rounds", async () => {
    const league = await buildLeague(db, { coaches: 3, picksPerTeam: 3, pool: samplePool(24) });
    const ids = league.order.map((p) => p.memberId); // positions 1..4
    const expected = [
      ids[0], ids[1], ids[2], ids[3], // round 1 (picks 1..4)
      ids[3], ids[2], ids[1], ids[0], // round 2 (picks 5..8) reversed
      ids[0], ids[1], ids[2], ids[3], // round 3 (picks 9..12)
    ];
    for (let pick = 1; pick <= 12; pick += 1) {
      const { rows } = await db.query<{ m: string }>("select public._snake_member($1, $2) as m", [league.leagueId, pick]);
      expect(rows[0].m, `pick ${pick}`).toBe(expected[pick - 1]);
    }
    // Boundary picks: 4 -> 5 stays on the same coach, 8 -> 9 stays on the same coach.
    expect(expected[3]).toBe(expected[4]);
    expect(expected[7]).toBe(expected[8]);
    const { rows: beyond } = await db.query<{ m: string }>("select public._snake_member($1, 0) as m", [league.leagueId]);
    expect(beyond[0].m).toBeNull();
  });

  it("finalizes exactly at positioned_count * picks_per_team even when a turn was skipped", async () => {
    // 3 teams x 2 picks = 6 turns. Budget 10, pool 9/9/9/1/1/5: commish takes 9,
    // c1 takes 9, c2 takes 9 then 1, c1 takes 1, commish has 1 left and is
    // skipped on turn 6, which must still finalize (5 picks, 6 turns).
    const pool = [
      { name: "Nine A", points: 9, tier: 12 },
      { name: "Nine B", points: 9, tier: 12 },
      { name: "Nine C", points: 9, tier: 12 },
      { name: "One A", points: 1, tier: 20 },
      { name: "One B", points: 1, tier: 20 },
      { name: "Five", points: 5, tier: 16 },
    ];
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pointBudget: 10, pool });
    const [commish, c1, c2] = league.order;
    await rpcAs(db, commish.userId, "start_draft", { p_league_id: league.leagueId });
    const results: PickResult[] = [];
    results.push(await rpcAs<PickResult>(db, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine A" }));
    results.push(await rpcAs<PickResult>(db, c1.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine B" }));
    results.push(await rpcAs<PickResult>(db, c2.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine C" }));
    results.push(await rpcAs<PickResult>(db, c2.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One A" }));
    results.push(await rpcAs<PickResult>(db, c1.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One B" }));
    expect(results.map((r) => r.draft_completed)).toEqual([false, false, false, false, false]);
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(6);
    await expectRpcError(rpcAs(db, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Five" }), "over_budget");
    await expireTimer(db, league.leagueId);
    const skipped = await rpcAs<AutoPickResult>(db, c1.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    expect(skipped).toEqual({ picked: false, pokemon_name: null, skipped: true, draft_completed: true });
    expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(5);
    expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(3);
    expect((await teamFor(db, league.leagueId, commish.memberId)).pokemon.map((p) => p.name)).toEqual(["Nine A"]);
    // drafted_teams entries are ordered by pick_number.
    const c2Team = await teamFor(db, league.leagueId, c2.memberId);
    expect(c2Team.pokemon.map((p) => p.pick_number)).toEqual([3, 4]);
    expect(c2Team.total_points).toBe(10);
  });

  it("budget reserve uses the pool minimum (> 1) per remaining slot", async () => {
    // budget 10, 2 picks, cheapest 2: 8 leaves 2 (ok), 9 leaves 1 (< 2, refused).
    const pool = [
      { name: "Nine", points: 9, tier: 12 },
      { name: "Eight", points: 8, tier: 13 },
      { name: "Two A", points: 2, tier: 19 },
      { name: "Two B", points: 2, tier: 19 },
      { name: "Two C", points: 2, tier: 19 },
      { name: "Two D", points: 2, tier: 19 },
    ];
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
    const [a] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine" }), "over_budget");
    const ok = await rpcAs<PickResult>(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Eight" });
    expect(ok.pick_number).toBe(1);
  });

  it("DESIGN LIMIT: the reserve is priced from the whole pool, so a coach can still be left with an empty slot once the cheap entries are gone", async () => {
    // budget 10, 2 picks, min price 2. A takes 8 (legal: 2 left >= 1*2).
    // B takes both 2-pointers. A's remaining budget 2 cannot buy the 5.
    const pool = [
      { name: "Eight", points: 8, tier: 13 },
      { name: "Two A", points: 2, tier: 19 },
      { name: "Two B", points: 2, tier: 19 },
      { name: "Five", points: 5, tier: 16 },
    ];
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Eight" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Two A" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Two B" });
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Five" }), "over_budget");
    const forced = await rpcAs<PickResult>(db, a.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
    expect(forced.skipped).toBe(true);
    expect((await teamFor(db, league.leagueId, a.memberId)).pokemon).toHaveLength(1);
  });

  it("finalize_draft accepts current_pick_number = total while the last pick is still unmade (loses the last turn)", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
    const row = await leagueRow(db, league.leagueId);
    expect(row.current_pick_number).toBe(4);
    expect(row.draft_completed).toBe(false);
    // Pick 4 (a's second) has not been made, yet finalize_draft succeeds.
    await rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId });
    expect((await leagueRow(db, league.leagueId)).draft_completed).toBe(true);
    expect((await teamFor(db, league.leagueId, a.memberId)).pokemon).toHaveLength(1);
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon004" }), "draft_completed");
  });

  for (const teams of [2, 3, 4, 5, 6, 7, 8]) {
    for (const format of ["round_robin", "double_round_robin"] as ScheduleFormat[]) {
      it(`_schedule_rows matches schedule.ts for ${teams} teams (${format})`, async () => {
        const ids = Array.from({ length: teams }, () => randomUUID());
        const { rows } = await db.query<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>(
          "select round_number, match_number, home_member_id, away_member_id from public._schedule_rows($1::uuid[], $2) order by round_number, match_number",
          [ids, format],
        );
        const expected = buildScheduleRows("league", ids.map((id) => ({ id, team_name: null })), format).map((m) => ({
          round_number: m.round_number,
          match_number: m.match_number,
          home_member_id: m.home_member_id,
          away_member_id: m.away_member_id,
        }));
        expect(rows).toEqual(expected);
        // Every pair meets once per pass, and nobody plays twice in a round.
        const passes = format === "double_round_robin" ? 2 : 1;
        expect(rows).toHaveLength((teams * (teams - 1) / 2) * passes);
        const byRound = new Map<number, string[]>();
        for (const m of rows) {
          const list = byRound.get(m.round_number) ?? [];
          expect(list).not.toContain(m.home_member_id);
          expect(list).not.toContain(m.away_member_id);
          list.push(m.home_member_id, m.away_member_id);
          byRound.set(m.round_number, list);
        }
      });
    }
  }

  it("make_pick and auto_pick_if_expired racing on the same turn produce exactly one pick", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
    const [commish, coach1] = league.order;
    await rpcAs(db, commish.userId, "start_draft", { p_league_id: league.leagueId });
    await expireTimer(db, league.leagueId);
    const connA = await connect();
    const connB = await connect();
    try {
      const results = await Promise.allSettled([
        rpcAs<PickResult>(connA, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon005" }),
        rpcAs<AutoPickResult>(connB, coach1.userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
      ]);
      const [pick, auto] = results;
      if (pick.status === "fulfilled") {
        expect(auto.status).toBe("fulfilled");
        expect((auto as PromiseFulfilledResult<AutoPickResult>).value.picked).toBe(false);
      } else {
        expect((pick.reason as { detail?: string }).detail).toBe("not_your_turn");
        expect(auto.status).toBe("fulfilled");
        expect((auto as PromiseFulfilledResult<AutoPickResult>).value.picked).toBe(true);
      }
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(1);
      expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(2);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("undo_last_pick during a pause restarts the clock, and resume then shifts it into the future", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, a.userId, "pause_draft", { p_league_id: league.leagueId });
    await db.query("update public.leagues set draft_paused_at = now() - interval '300 seconds' where id = $1", [league.leagueId]);
    await rpcAs(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "resume_draft", { p_league_id: league.leagueId });
    const row = await leagueRow(db, league.leagueId);
    const aheadSeconds = (new Date(row.pick_started_at as string).getTime() - Date.now()) / 1000;
    // pick_started_at is ~300 s in the future: the coach gets timer + 300 s.
    expect(aheadSeconds).toBeGreaterThan(290);
  });

  it("a pause taken after the timer already expired does not refund time: auto-pick fires right after resume", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await expireTimer(db, league.leagueId);
    await rpcAs(db, a.userId, "pause_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "resume_draft", { p_league_id: league.leagueId });
    const result = await rpcAs<AutoPickResult>(db, b.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    expect(result.picked).toBe(true);
  });

  it("two concurrent undos of the same free agent move: one wins, the other reports a code", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon004" });
    const news = await rpcAs<{ id: string }>(db, b.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: "Mon002", p_add_name: "Mon005" });
    const connA = await connect();
    const connB = await connect();
    try {
      const results = await Promise.allSettled([
        rpcAs(connA, a.userId, "undo_free_agent_move", { p_news_id: news.id }),
        rpcAs(connB, a.userId, "undo_free_agent_move", { p_news_id: news.id }),
      ]);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // BUG (review finding): the loser re-selects the news row after taking the
      // league lock without a `not found` check, so it falls through to the
      // "coach is no longer in the league" branch instead of news_not_found.
      const detail = (rejected[0].reason as { detail?: string }).detail;
      expect(detail).toBe("member_not_found");
    } finally {
      await connA.end();
      await connB.end();
    }
    expect((await teamFor(db, league.leagueId, b.memberId)).pokemon.map((p) => p.name)).toEqual(["Mon002", "Mon003"]);
  });

  it("invite codes are 10 chars from A-Z2-9 without I, O, 0, 1 and unique across many leagues", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const { rows } = await db.query<{ c: string }>("select public._new_invite_code() as c");
      codes.add(rows[0].c);
      expect(rows[0].c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    }
    expect(codes.size).toBe(40);
    // The retry loop: make the generator return an already-taken code once and
    // make sure the next league still gets a fresh, unique code.
    const league = await buildLeague(db, { coaches: 0, setOrder: false });
    const { rows: existing } = await db.query<{ invite_code: string }>("select invite_code from public.league_invites where league_id = $1", [league.leagueId]);
    const taken = existing[0].invite_code;
    const { rows: def } = await db.query<{ d: string }>("select pg_get_functiondef('public._new_invite_code()'::regprocedure) as d");
    try {
      await db.query(
        `create or replace function public._new_invite_code() returns text language plpgsql as $$
         declare v_n int; begin
           select coalesce(nullif(current_setting('review.calls', true), ''), '0')::int into v_n;
           perform set_config('review.calls', (v_n + 1)::text, true);
           if v_n = 0 then return '${taken}'; end if;
           return 'REVIEW' || lpad(v_n::text, 4, '2');
         end $$`,
      );
      const other = await buildLeague(db, { coaches: 0, setOrder: false });
      const { rows: fresh } = await db.query<{ invite_code: string }>("select invite_code from public.league_invites where league_id = $1", [other.leagueId]);
      expect(fresh[0].invite_code).toBe("REVIEW2221");
    } finally {
      await db.query(def[0].d);
    }
  });

  it("the (league_id, draft_position) unique constraint is deferrable initially deferred", async () => {
    const { rows } = await db.query<{ condeferrable: boolean; condeferred: boolean }>(
      "select condeferrable, condeferred from pg_constraint where conname = 'league_members_league_id_draft_position_key'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ condeferrable: true, condeferred: true });
  });

  it("update_league_settings refuses max_coaches below the member count and keeps the invite counter in step", async () => {
    const league = await buildLeague(db, { coaches: 3, maxCoaches: 6 });
    await expectRpcError(
      rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { max_coaches: 3 } }),
      "max_coaches_below_members",
    );
    await rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { max_coaches: 4 } });
    const { rows } = await db.query<{ max_uses: number }>("select max_uses from public.league_invites where league_id = $1", [league.leagueId]);
    expect(rows[0].max_uses).toBe(3);
    await expectRpcError(rpcAs(db, await createUser(db), "join_league", { p_code: league.inviteCode, p_team_name: "Late" }), "league_full");
  });

  it("reset_draft leaves chat messages and draft positions in place", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 1, pool: samplePool(4) });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await asUser(db, a.userId, (c) =>
      c.query("insert into public.draft_chat_messages (league_id, member_id, user_id, message) values ($1, $2, $3, 'hi')", [league.leagueId, a.memberId, a.userId]),
    );
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    await rpcAs(db, a.userId, "reset_draft", { p_league_id: league.leagueId });
    expect(await count(db, "draft_chat_messages", "league_id = $1", [league.leagueId])).toBe(1);
    const { rows } = await db.query<{ draft_position: number | null }>("select draft_position from public.league_members where league_id = $1 order by draft_position", [league.leagueId]);
    expect(rows.map((r) => r.draft_position)).toEqual([1, 2]);
  });

  it("REGRESSION: _best_available is linear in the pool size and agrees with the per-row budget rule", async () => {
    // The previous implementation called _pick_legal (a full pool parse) per
    // candidate: 123 ms at 300 entries, 4.4 s at 1000, 13.7 s at 2000.
    for (const size of [300, 1000]) {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 10, pointBudget: 100, pool: samplePool(size) });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      const member = league.commissioner.memberId;
      const t0 = Date.now();
      const { rows: best } = await db.query<{ name: string; points: number }>("select name, points from public._best_available($1, $2)", [league.leagueId, member]);
      const bestMs = Date.now() - t0;
      expect(best[0]).toEqual({ name: "Mon001", points: 20 });
      expect(bestMs, `_best_available on ${size} entries took ${bestMs} ms`).toBeLessThan(1000);
      if (size === 300) {
        // The SQL filter must choose exactly what the per-row rule would.
        const { rows: legal } = await db.query<{ name: string }>(
          `select p.name from public._league_pool($1) p
           where public._pick_legal($1, $2, p.points)
             and not exists (select 1 from public.draft_picks d where d.league_id = $1 and lower(d.pokemon_name) = lower(p.name))
           order by p.points desc, p.name asc limit 1`,
          [league.leagueId, member],
        );
        expect(legal[0].name).toBe(best[0].name);
      }
      console.log(`TIMING pool=${size}: _best_available=${bestMs}ms`);
    }
  });

  it("REGRESSION: auto-pick and force-pick on a 2000-entry pool finish well inside the API statement timeout", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 10, pointBudget: 100, pool: null, setOrder: true });
    const big = samplePool(2000);
    const t0 = Date.now();
    await rpcAs(db, league.commissioner.userId, "update_league_pool", { p_league_id: league.leagueId, p_pool: { version: "1.0", leagueName: "Big", pokemon: big } });
    const poolMs = Date.now() - t0;
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    const t1 = Date.now();
    const { rows } = await db.query<{ name: string }>("select name from public._best_available($1, $2)", [league.leagueId, league.commissioner.memberId]);
    const bestMs = Date.now() - t1;
    expect(rows[0].name).toBe("Mon001");
    expect(bestMs, `_best_available on 2000 entries took ${bestMs} ms`).toBeLessThan(1000);
    await expireTimer(db, league.leagueId);
    const t2 = Date.now();
    const auto = await rpcAs<AutoPickResult>(db, league.coaches[0].userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    const autoMs = Date.now() - t2;
    expect(auto).toMatchObject({ picked: true, pokemon_name: "Mon001", skipped: false, draft_completed: false });
    expect(autoMs, `auto_pick_if_expired on 2000 entries took ${autoMs} ms`).toBeLessThan(1000);
    // Pick 2 belongs to the coach; the commissioner forces the best available for them.
    const t3 = Date.now();
    const forced = await rpcAs<PickResult>(db, league.commissioner.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
    const forceMs = Date.now() - t3;
    expect(forced).toMatchObject({ pick_number: 2, pokemon_name: "Mon021", skipped: false });
    expect(forceMs, `force_pick(best available) on 2000 entries took ${forceMs} ms`).toBeLessThan(1000);
    console.log(`TIMING pool=2000: update_league_pool=${poolMs}ms _best_available=${bestMs}ms auto_pick=${autoMs}ms force_pick=${forceMs}ms`);
  });
});
