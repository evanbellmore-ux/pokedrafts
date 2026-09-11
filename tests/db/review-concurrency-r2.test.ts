// Round-2 review probes (correctness and concurrency lens): races that take the
// league lock in a different order than the first read, timer arithmetic
// across pause/resume, and the deferred draft-position constraint under a full
// reversal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildLeague,
  connect,
  count,
  createUser,
  expireTimer,
  leagueRow,
  matchesFor,
  newsFor,
  memberFor,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
} from "./harness";

type AutoPickResult = { picked: boolean; pokemon_name: string | null; skipped: boolean; draft_completed: boolean };
type PickResult = { pick_number: number; draft_completed: boolean; pokemon_name?: string };

// Opens a transaction as `userId` on `client`, runs `fn`, and returns a commit
// callback so a test can hold the league lock while another connection waits.
async function holdTransaction<T>(client: Client, userId: string, fn: (c: Client) => Promise<T>): Promise<{ result: T; commit: () => Promise<void> }> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("set local role authenticated");
  const result = await fn(client);
  return {
    result,
    commit: async () => {
      await client.query("commit");
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("review round 2: correctness and concurrency", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("report_match_result racing generate_schedule: the report must fail with match_not_found instead of writing an orphan news row", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 1, pool: samplePool(6) });
    await runFullDraft(db, league);
    const commissioner = league.commissioner.userId;
    const [match] = await matchesFor(db, league.leagueId);

    const connA = await connect();
    const connB = await connect();
    try {
      // A regenerates the schedule (deleting every match) and holds the league lock.
      const held = await holdTransaction(connA, commissioner, (c) =>
        rpc<number>(c, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: true }),
      );
      // B read the match before A's delete became visible and now waits on the league lock.
      const report = rpcAs(connB, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.home_member_id }).then(
        () => ({ ok: true as const }),
        (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
      );
      await wait(300);
      await held.commit();
      const outcome = await report;

      const news = await newsFor(db, league.leagueId, "match_result");
      // Expected: the stale match is gone, so the report is refused and no news is written.
      expect(outcome, JSON.stringify({ outcome, news })).toEqual({ ok: false, detail: "match_not_found" });
      expect(news).toHaveLength(0);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("clear_match_result racing generate_schedule: the stale match is refused with match_not_found and the fresh schedule is untouched", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 1, pool: samplePool(6) });
    await runFullDraft(db, league);
    const commissioner = league.commissioner.userId;
    const [match] = await matchesFor(db, league.leagueId);
    await rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.home_member_id });

    const connA = await connect();
    const connB = await connect();
    try {
      const held = await holdTransaction(connA, commissioner, (c) =>
        rpc<number>(c, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: false, p_discard_results: true }),
      );
      const clear = rpcAs(connB, commissioner, "clear_match_result", { p_match_id: match.id }).then(
        () => ({ ok: true as const }),
        (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
      );
      await wait(300);
      await held.commit();
      // Same re-read under the league lock as report_match_result: the row B
      // read before waiting is gone, so B gets the same error a stale page gets.
      expect(await clear).toEqual({ ok: false, detail: "match_not_found" });
      const matches = await matchesFor(db, league.leagueId);
      expect(matches).toHaveLength(3);
      expect(matches.every((m) => m.status === "upcoming")).toBe(true);
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(0);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("the same user joining twice concurrently ends up with exactly one membership", async () => {
    const league = await buildLeague(db, { coaches: 0, maxCoaches: 4, setOrder: false });
    const user = await createUser(db);
    const connA = await connect();
    const connB = await connect();
    try {
      const results = await Promise.allSettled([
        rpcAs<string>(connA, user, "join_league", { p_code: league.inviteCode, p_team_name: "Twin A" }),
        rpcAs<string>(connB, user, "join_league", { p_code: league.inviteCode, p_team_name: "Twin B" }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(results.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual([league.leagueId, league.leagueId]);
      expect(await count(db, "league_members", "league_id = $1 and user_id = $2", [league.leagueId, user])).toBe(1);
      const { rows } = await db.query<{ used_count: number }>("select used_count from public.league_invites where league_id = $1", [league.leagueId]);
      expect(rows[0].used_count).toBe(1);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("two clients calling auto_pick_if_expired during a pause both get picked:false and nothing changes", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    await expireTimer(db, league.leagueId);
    await rpcAs(db, league.commissioner.userId, "pause_draft", { p_league_id: league.leagueId });
    const connA = await connect();
    const connB = await connect();
    try {
      const [a, b] = await Promise.all([
        rpcAs<AutoPickResult>(connA, league.coaches[0].userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
        rpcAs<AutoPickResult>(connB, league.coaches[1].userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
      ]);
      expect(a).toEqual({ picked: false, pokemon_name: null, skipped: false, draft_completed: false });
      expect(b).toEqual(a);
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(0);
      expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(1);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("resume shifts pick_started_at by exactly the paused duration, so the time left on the clock is preserved", async () => {
    // timer 60 s; 40 s elapsed when paused; paused for 100 s -> 20 s left after resume.
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8), pickTimerSeconds: 60 });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "pause_draft", { p_league_id: league.leagueId });
    await db.query(
      "update public.leagues set pick_started_at = now() - interval '140 seconds', draft_paused_at = now() - interval '100 seconds' where id = $1",
      [league.leagueId],
    );
    await rpcAs(db, a.userId, "resume_draft", { p_league_id: league.leagueId });
    const { rows } = await db.query<{ elapsed: number; paused_total: number }>(
      "select extract(epoch from now() - pick_started_at)::numeric::float8 as elapsed, draft_paused_total_seconds as paused_total from public.leagues where id = $1",
      [league.leagueId],
    );
    expect(rows[0].elapsed).toBeGreaterThanOrEqual(39);
    expect(rows[0].elapsed).toBeLessThan(42);
    expect(rows[0].paused_total).toBeGreaterThanOrEqual(99);
    expect(rows[0].paused_total).toBeLessThanOrEqual(101);
    // 20 s remain: auto-pick must not fire yet ...
    const early = await rpcAs<AutoPickResult>(db, b.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    expect(early.picked).toBe(false);
    // ... but once those 20 s pass it does.
    await db.query("update public.leagues set pick_started_at = pick_started_at - interval '21 seconds' where id = $1", [league.leagueId]);
    const late = await rpcAs<AutoPickResult>(db, b.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    expect(late.picked).toBe(true);
  });

  it("make_pick waiting behind undo_last_pick re-reads the clock: the pick lands on the reopened pick number, no duplicate numbers", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a, b] = league.order; // order a, b, b, a
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    const connA = await connect();
    const connB = await connect();
    try {
      const held = await holdTransaction(connA, a.userId, (c) => rpc(c, "undo_last_pick", { p_league_id: league.leagueId }));
      const pick = rpcAs<PickResult>(connB, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
      await wait(300);
      await held.commit();
      const result = await pick;
      expect(result.pick_number).toBe(2);
      const { rows } = await db.query<{ pick_number: number; pokemon_name: string }>(
        "select pick_number, pokemon_name from public.draft_picks where league_id = $1 order by pick_number",
        [league.leagueId],
      );
      expect(rows).toEqual([
        { pick_number: 1, pokemon_name: "Mon001" },
        { pick_number: 2, pokemon_name: "Mon003" },
      ]);
      expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(3);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("set_draft_order can fully reverse four positions in one statement (deferred unique)", async () => {
    const league = await buildLeague(db, { coaches: 3 });
    const ids = league.order.map((p) => p.memberId);
    await rpcAs(db, league.commissioner.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: [...ids].reverse() });
    for (let i = 0; i < ids.length; i += 1) {
      const member = await memberFor(db, league.leagueId, league.order[i].userId);
      expect(member.draft_position).toBe(ids.length - i);
    }
    // Rotating by one also works, and the on-clock coach for pick 1 follows.
    await rpcAs(db, league.commissioner.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: [ids[1], ids[2], ids[3], ids[0]] });
    const { rows } = await db.query<{ m: string }>("select public._snake_member($1, 1) as m", [league.leagueId]);
    expect(rows[0].m).toBe(ids[1]);
  });

  it("finalize is exact: pick positioned*picks_per_team completes, and the recovery wrapper is a no-op on the same teams", async () => {
    const league = await buildLeague(db, { coaches: 3, picksPerTeam: 3, pool: samplePool(24) });
    const picks = await runFullDraft(db, league);
    expect(picks).toHaveLength(12);
    expect(picks[11].pickNumber).toBe(12);
    const row = await leagueRow(db, league.leagueId);
    expect(row.draft_completed).toBe(true);
    expect(row.current_pick_number).toBe(12);
    const before = await db.query("select member_id, pokemon, total_points from public.drafted_teams where league_id = $1 order by member_id", [league.leagueId]);
    // Direct internal call (what a recovery would do) leaves the teams byte-for-byte identical.
    await db.query("select public._finalize_draft($1)", [league.leagueId]);
    const after = await db.query("select member_id, pokemon, total_points from public.drafted_teams where league_id = $1 order by member_id", [league.leagueId]);
    expect(after.rows).toEqual(before.rows);
    expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(4);
    for (const team of after.rows as Array<{ pokemon: Array<{ pick_number: number }> }>) {
      const numbers = team.pokemon.map((p) => p.pick_number);
      expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
      expect(numbers).toHaveLength(3);
    }
  });
});
