// Round-3 review probes (correctness and concurrency lens). Each test pins a
// behaviour the reviewer found by reading the hardening migration; the titles
// say whether it is a defect or a confirmation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  leagueRow,
  rpcAs,
  samplePool,
  type Client,
} from "./harness";

type AutoPickResult = { picked: boolean; pokemon_name: string | null; skipped: boolean; draft_completed: boolean };

describe("review round 3: correctness and concurrency", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("BUG: a legacy league with more members than max_coaches cannot save Settings at all, because the form echoes the unchanged max_coaches and the floor check runs before the change test", async () => {
    // Live data from the old non-atomic join flow can hold count > max_coaches
    // (issues-high.md: two invitees both pass the client-side capacity check).
    // The migration clamps max_coaches into 2..24 but never raises it to the
    // member count.
    const league = await buildLeague(db, { coaches: 1, maxCoaches: 2, setOrder: false });
    const extra = await createUser(db);
    await db.query("insert into public.league_members (league_id, user_id, role, team_name) values ($1, $2, 'coach', 'Overflow')", [league.leagueId, extra]);
    expect(await count(db, "league_members", "league_id = $1", [league.leagueId])).toBe(3);
    expect((await leagueRow(db, league.leagueId)).max_coaches).toBe(2);

    // The settings form always sends max_coaches (SettingsClient.tsx:164), so a
    // plain rename or timer change is refused with the unchanged value.
    await expectRpcError(
      rpcAs(db, league.commissioner.userId, "update_league_settings", {
        p_league_id: league.leagueId,
        p_settings: { name: "Renamed", max_coaches: 2, pick_timer_seconds: 90 },
      }),
      "max_coaches_below_members",
    );
    // Raising it is the only way out, which the form does not tell the user.
    const fixed = await rpcAs<{ max_coaches: number; name: string }>(db, league.commissioner.userId, "update_league_settings", {
      p_league_id: league.leagueId,
      p_settings: { name: "Renamed", max_coaches: 3 },
    });
    expect(fixed).toMatchObject({ max_coaches: 3, name: "Renamed" });
  });

  it("CONFIRMED: auto_pick_if_expired treats a null pick_started_at as expired and picks immediately", async () => {
    // Not reachable through the RPCs (start_draft, undo, advance and resume all
    // write pick_started_at) and the app never writes the column, so this only
    // matters for legacy rows nulled by hand: such a league would auto-pick on
    // the first client tick after deploy.
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 1, pool: samplePool(4) });
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    await db.query("update public.leagues set pick_started_at = null where id = $1", [league.leagueId]);
    const result = await rpcAs<AutoPickResult>(db, league.coaches[0].userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
    expect(result.picked).toBe(true);
    expect((await leagueRow(db, league.leagueId)).pick_started_at).not.toBeNull();
  });

  it("CONFIRMED: undo_last_pick reopens exactly the highest pick number and the same coach gets it back, no duplicate numbers", async () => {
    // Order a, b, b, a. budget 10, pool 9/9/1/5/2: a takes Nine A (1), b takes
    // Nine B (2) and One (3). Undo removes pick 3 and puts b back on the clock.
    const pool = [
      { name: "Nine A", points: 9, tier: 12 },
      { name: "Nine B", points: 9, tier: 12 },
      { name: "One", points: 1, tier: 20 },
      { name: "Five", points: 5, tier: 16 },
      { name: "Two", points: 2, tier: 19 },
    ];
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine A" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine B" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" });
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(4);
    const undone = await rpcAs<{ pick_number: number; pokemon_name: string }>(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId });
    expect(undone).toEqual({ pick_number: 3, pokemon_name: "One" });
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(3);
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" }), "not_your_turn");
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" });
    const { rows } = await db.query<{ pick_number: number }>("select pick_number from public.draft_picks where league_id = $1 order by pick_number", [league.leagueId]);
    expect(rows.map((r) => r.pick_number)).toEqual([1, 2, 3]);
  });

  it("CONFIRMED: join_league queued behind leave_league sees the freed seat (both serialize on the league lock)", async () => {
    const league = await buildLeague(db, { coaches: 1, maxCoaches: 2, setOrder: false });
    const leaver = league.coaches[0];
    const joiner = await createUser(db);
    const connA = await connect();
    const connB = await connect();
    try {
      await expectRpcError(rpcAs(connB, joiner, "join_league", { p_code: league.inviteCode, p_team_name: "Late" }), "league_full");
      const [leave, join] = await Promise.allSettled([
        rpcAs(connA, leaver.userId, "leave_league", { p_league_id: league.leagueId }),
        new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
          rpcAs<string>(connB, joiner, "join_league", { p_code: league.inviteCode, p_team_name: "Late" }),
        ),
      ]);
      expect(leave.status).toBe("fulfilled");
      expect(join.status).toBe("fulfilled");
      expect(await count(db, "league_members", "league_id = $1", [league.leagueId])).toBe(2);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("CONFIRMED: set_draft_order swapping two of four positions keeps the other two, and repeating the same order is a no-op", async () => {
    const league = await buildLeague(db, { coaches: 3 });
    const ids = league.order.map((p) => p.memberId);
    const swapped = [ids[1], ids[0], ids[2], ids[3]];
    await rpcAs(db, league.commissioner.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: swapped });
    await rpcAs(db, league.commissioner.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: swapped });
    const { rows } = await db.query<{ id: string; draft_position: number }>(
      "select id, draft_position from public.league_members where league_id = $1 order by draft_position",
      [league.leagueId],
    );
    expect(rows.map((r) => r.id)).toEqual(swapped);
    expect(rows.map((r) => r.draft_position)).toEqual([1, 2, 3, 4]);
  });

  it("CONFIRMED: swap_free_agent replaces the dropped entry in place, recomputes total_points, and refuses a null drop on a full roster", async () => {
    // 2 teams x 2 picks, budget 12. Order a, b, b, a: a takes Nine A, b takes
    // Nine B and Three, a takes Two (9 + 2 = 11). After the draft a swaps Two
    // for One: the replacement lands in the same slot with pick_number null.
    const pool = [
      { name: "Nine A", points: 9, tier: 12 },
      { name: "Nine B", points: 9, tier: 12 },
      { name: "One", points: 1, tier: 20 },
      { name: "Five", points: 5, tier: 16 },
      { name: "Two", points: 2, tier: 19 },
      { name: "Three", points: 3, tier: 18 },
    ];
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 12, pool });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine A" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine B" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Three" });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Two" });
    expect((await leagueRow(db, league.leagueId)).draft_completed).toBe(true);
    // a is full (9 + 2 = 11 of 12); dropping Two for One is a swap within budget.
    const news = await rpcAs<{ metadata: { after_pokemon: Array<{ name: string; points: number; pick_number: number | null; acquired?: string }> } }>(
      db, a.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: "Two", p_add_name: "One" },
    );
    expect(news.metadata.after_pokemon.map((p) => [p.name, p.points, p.pick_number, p.acquired ?? null])).toEqual([
      ["Nine A", 9, 1, null],
      ["One", 1, null, "free_agent"],
    ]);
    const { rows } = await db.query<{ total_points: number }>("select total_points from public.drafted_teams where league_id = $1 and member_id = $2", [league.leagueId, a.memberId]);
    expect(rows[0].total_points).toBe(10);
    // Adding without a drop on a full roster is refused with roster_full.
    await expectRpcError(rpcAs(db, a.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Five" }), "roster_full");
  });
});
