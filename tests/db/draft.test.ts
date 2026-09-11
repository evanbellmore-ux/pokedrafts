import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildScheduleRows, type ScheduleFormat } from "../../app/lib/league/schedule";
import {
  bestAvailable,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expireTimer,
  inviteCodeFor,
  leagueRow,
  matchesFor,
  memberFor,
  onClockMember,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
  type LeagueFixture,
} from "./harness";

type PickResult = { pick_number: number; draft_completed: boolean; pokemon_name?: string };
type AutoPickResult = { picked: boolean; pokemon_name: string | null; skipped: boolean; draft_completed: boolean };

async function picksFor(db: Client, leagueId: string) {
  const { rows } = await db.query<{ pick_number: number; member_id: string; pokemon_name: string; points: number; tier: number }>(
    "select pick_number, member_id, pokemon_name, points, tier from public.draft_picks where league_id = $1 order by pick_number",
    [leagueId],
  );
  return rows;
}

describe("draft RPCs", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  describe("start_draft", () => {
    it("validates the order, the pool and the budget", async () => {
      const noOrder = await buildLeague(db, { coaches: 2, setOrder: false });
      await expectRpcError(rpcAs(db, noOrder.commissioner.userId, "start_draft", { p_league_id: noOrder.leagueId }), "not_enough_coaches");
      await expectRpcError(rpcAs(db, noOrder.coaches[0].userId, "start_draft", { p_league_id: noOrder.leagueId }), "not_commissioner");

      const smallPool = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(5) });
      await expectRpcError(rpcAs(db, smallPool.commissioner.userId, "start_draft", { p_league_id: smallPool.leagueId }), "pool_too_small");

      const poorLeague = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 3, pool: [
        { name: "A", points: 2, tier: 19 }, { name: "B", points: 2, tier: 19 }, { name: "C", points: 2, tier: 19 }, { name: "D", points: 2, tier: 19 },
      ] });
      await expectRpcError(rpcAs(db, poorLeague.commissioner.userId, "start_draft", { p_league_id: poorLeague.leagueId }), "budget_too_small");
    });

    it("flips the draft flags and starts the clock", async () => {
      const league = await buildLeague(db, { coaches: 2 });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      const row = await leagueRow(db, league.leagueId);
      expect(row.draft_started).toBe(true);
      expect(row.draft_completed).toBe(false);
      expect(row.current_pick_number).toBe(1);
      expect(row.auto_pick_in_progress).toBe(false);
      expect(row.draft_paused_at).toBeNull();
      expect(Math.abs(new Date(row.pick_started_at as string).getTime() - Date.now())).toBeLessThan(10_000);
      await expectRpcError(rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId }), "draft_already_started");
    });

    it("copies a format onto custom_pool at creation; start_draft and reset_draft keep that copy, reset_league_pool refreshes it", async () => {
      const owner = await createUser(db);
      const { rows: formats } = await db.query<{ id: string }>(
        "insert into public.draft_formats (name, json, created_by) values ('Owned', $1, $2) returning id",
        [JSON.stringify({ version: "1.0", leagueName: "Owned", pokemon: samplePool(8) }), owner],
      );
      const formatId = formats[0].id;
      const leagueId = await rpcAs<string>(db, owner, "create_league", {
        p_name: "Format League",
        p_team_name: "Owner",
        p_max_coaches: 4,
        p_draft_format_id: formatId,
        p_point_budget: 100,
        p_picks_per_team: 2,
        p_pick_timer_seconds: 60,
      });
      const coach = await createUser(db);
      await rpcAs(db, coach, "join_league", { p_code: await inviteCodeFor(db, leagueId), p_team_name: "Coach" });
      const ownerMember = await memberFor(db, leagueId, owner);
      const coachMember = await memberFor(db, leagueId, coach);
      await rpcAs(db, owner, "set_draft_order", { p_league_id: leagueId, p_member_ids: [ownerMember.id, coachMember.id] });
      const poolCount = async () => (await db.query<{ n: number }>("select count(*)::int as n from public._league_pool($1)", [leagueId])).rows[0].n;

      // The league has carried a normalized copy of the format since it was created.
      const copied = (await leagueRow(db, leagueId)).custom_pool as { pokemon: Array<{ name: string; points: number; tier: number }> };
      expect(copied).toMatchObject({ version: "1.0", leagueName: "Format League", source: "format", draft_format_id: formatId });
      expect(copied.pokemon).toHaveLength(8);
      expect(copied.pokemon[0]).toEqual({ name: "Mon001", points: 20, tier: 1 });

      await rpcAs(db, owner, "start_draft", { p_league_id: leagueId });
      expect((await leagueRow(db, leagueId)).custom_pool).toEqual(copied);

      // Editing the format mid-draft changes nothing for the league ...
      await db.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon: samplePool(4) }), formatId]);
      expect(await bestAvailable(db, leagueId, ownerMember.id)).toBe("Mon001");
      expect(await poolCount()).toBe(8);

      // ... and neither does reset_draft: the league keeps the copy it drafted from.
      await rpcAs(db, owner, "reset_draft", { p_league_id: leagueId });
      expect((await leagueRow(db, leagueId)).custom_pool).toEqual(copied);
      expect(await poolCount()).toBe(8);

      // reset_league_pool is how the commissioner pulls the format's current list.
      await rpcAs(db, owner, "reset_league_pool", { p_league_id: leagueId });
      const refreshed = (await leagueRow(db, leagueId)).custom_pool as { pokemon: unknown[] };
      expect(refreshed).toMatchObject({ version: "1.0", leagueName: "Format League", source: "format", draft_format_id: formatId });
      expect(refreshed.pokemon).toHaveLength(4);
      expect(await poolCount()).toBe(4);

      // When the format is gone, the copy is the only pool left and stays through start/reset.
      await rpcAs(db, owner, "start_draft", { p_league_id: leagueId });
      await db.query("delete from public.draft_formats where id = $1", [formatId]);
      expect((await leagueRow(db, leagueId)).draft_format_id).toBeNull();
      await rpcAs(db, owner, "reset_draft", { p_league_id: leagueId });
      const kept = (await leagueRow(db, leagueId)).custom_pool as { pokemon: unknown[] } | null;
      expect(kept?.pokemon).toHaveLength(4);
      // Without a format, reset_league_pool leaves the league with no pool at all.
      await rpcAs(db, owner, "reset_league_pool", { p_league_id: leagueId });
      expect((await leagueRow(db, leagueId)).custom_pool).toBeNull();
      expect(await poolCount()).toBe(0);
      await expectRpcError(rpcAs(db, owner, "start_draft", { p_league_id: leagueId }), "pool_too_small");

      // A pool set explicitly with update_league_pool survives start/reset untouched.
      await rpcAs(db, owner, "update_league_pool", { p_league_id: leagueId, p_pool: { pokemon: samplePool(6) } });
      await rpcAs(db, owner, "start_draft", { p_league_id: leagueId });
      await rpcAs(db, owner, "reset_draft", { p_league_id: leagueId });
      const explicit = (await leagueRow(db, leagueId)).custom_pool as { pokemon: unknown[]; source?: string };
      expect(explicit.pokemon).toHaveLength(6);
      expect(explicit.source).toBeUndefined();
    });
  });

  describe("make_pick", () => {
    it("runs a 3-team x 2-pick snake draft and finalizes teams and matches", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      const [commish, coach1, coach2] = league.order;
      const commissioner = commish.userId;

      await expectRpcError(rpcAs(db, commissioner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" }), "draft_not_started");
      await rpcAs(db, commissioner, "start_draft", { p_league_id: league.leagueId });

      const expectedOrder = [commish, coach1, coach2, coach2, coach1, commish];
      const names = ["Mon001", "Mon002", "Mon003", "Mon004", "Mon005", "Mon006"];

      for (let i = 0; i < expectedOrder.length; i += 1) {
        const clock = await onClockMember(db, league.leagueId);
        expect(clock.pickNumber).toBe(i + 1);
        expect(clock.memberId).toBe(expectedOrder[i].memberId);

        const wrongUser = league.order.find((p) => p.memberId !== expectedOrder[i].memberId)!;
        await expectRpcError(rpcAs(db, wrongUser.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: names[i] }), "not_your_turn");
        await expectRpcError(rpcAs(db, await createUser(db), "make_pick", { p_league_id: league.leagueId, p_pokemon_name: names[i] }), "not_a_member");

        const result = await rpcAs<PickResult>(db, expectedOrder[i].userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: names[i].toLowerCase() });
        expect(result.pick_number).toBe(i + 1);
        expect(result.draft_completed).toBe(i === expectedOrder.length - 1);
      }

      const picks = await picksFor(db, league.leagueId);
      expect(picks.map((p) => p.pokemon_name)).toEqual(names);
      expect(picks.map((p) => p.member_id)).toEqual(expectedOrder.map((p) => p.memberId));
      expect(picks[0]).toMatchObject({ points: 20, tier: 1 });

      const row = await leagueRow(db, league.leagueId);
      expect(row.draft_completed).toBe(true);
      expect(row.auto_pick_in_progress).toBe(false);

      const commishTeam = await teamFor(db, league.leagueId, commish.memberId);
      expect(commishTeam.pokemon).toEqual([
        { name: "Mon001", points: 20, tier: 1, pick_number: 1 },
        { name: "Mon006", points: 15, tier: 6, pick_number: 6 },
      ]);
      expect(commishTeam.total_points).toBe(35);
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(3);
      expect(await count(db, "league_matches", "league_id = $1", [league.leagueId])).toBe(3);

      await expectRpcError(rpcAs(db, commissioner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon007" }), "draft_completed");
    });

    it("rejects unknown, drafted and unaffordable Pokémon with points taken from the pool", async () => {
      const pool = [9, 8, 7, 6, 5, 4, 3, 2].map((points, i) => ({ name: `P${i}`, points, tier: 21 - points }));
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
      const [commish, coach] = league.order;
      await rpcAs(db, commish.userId, "start_draft", { p_league_id: league.leagueId });

      await expectRpcError(rpcAs(db, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Missingno" }), "pokemon_not_in_pool");
      // 9 points leaves 1, but one more slot needs at least 2 (the pool minimum).
      await expectRpcError(rpcAs(db, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P0" }), "over_budget");
      await rpcAs(db, commish.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P1" });
      await expectRpcError(rpcAs(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P1" }), "pokemon_already_drafted");
      await rpcAs(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P2" });
      // Coach has 3 left: P3 (6) is too expensive, P6 (3) fits.
      await expectRpcError(rpcAs(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P3" }), "over_budget");
      const result = await rpcAs<PickResult>(db, coach.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "P6" });
      expect(result.draft_completed).toBe(false);
      const picks = await picksFor(db, league.leagueId);
      expect(picks.find((p) => p.pokemon_name === "P6")).toMatchObject({ points: 3, tier: 18 });
    });
  });

  describe("finalize schedule", () => {
    for (const teams of [3, 4, 5]) {
      for (const format of ["round_robin", "double_round_robin"] as ScheduleFormat[]) {
        it(`generates the same ${format} pairings as schedule.ts for ${teams} teams`, async () => {
          const league = await buildLeague(db, { coaches: teams - 1, picksPerTeam: 1, pool: samplePool(teams * 2) });
          await rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { schedule_format: format } });
          await runFullDraft(db, league);

          const expected = buildScheduleRows(
            league.leagueId,
            league.order.map((p) => ({ id: p.memberId, team_name: p.teamName })),
            format,
          );
          const rounds = teams % 2 === 0 ? teams - 1 : teams;
          const perRound = Math.floor(teams / 2);
          const expectedCount = rounds * perRound * (format === "double_round_robin" ? 2 : 1);
          expect(expected).toHaveLength(expectedCount);

          const actual = await matchesFor(db, league.leagueId);
          expect(actual).toHaveLength(expectedCount);
          expect(actual.map((m) => ({ round_number: m.round_number, match_number: m.match_number, home_member_id: m.home_member_id, away_member_id: m.away_member_id }))).toEqual(
            expected.map((m) => ({ round_number: m.round_number, match_number: m.match_number, home_member_id: m.home_member_id, away_member_id: m.away_member_id })),
          );
          expect(actual.every((m) => m.status === "upcoming" && m.winner_member_id === null)).toBe(true);
        });
      }
    }
  });

  describe("auto_pick_if_expired", () => {
    it("does nothing while the timer is running and drafts the best legal Pokémon once expired", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      const coach = league.coaches[1];
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });

      const early = await rpcAs<AutoPickResult>(db, coach.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
      expect(early).toEqual({ picked: false, pokemon_name: null, skipped: false, draft_completed: false });
      await expectRpcError(rpcAs(db, await createUser(db), "auto_pick_if_expired", { p_league_id: league.leagueId }), "not_a_member");

      await expireTimer(db, league.leagueId);
      const result = await rpcAs<AutoPickResult>(db, coach.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
      expect(result).toEqual({ picked: true, pokemon_name: "Mon001", skipped: false, draft_completed: false });
      const picks = await picksFor(db, league.leagueId);
      expect(picks).toHaveLength(1);
      expect(picks[0].member_id).toBe(league.commissioner.memberId);
      const row = await leagueRow(db, league.leagueId);
      expect(row.current_pick_number).toBe(2);
      expect(Math.abs(new Date(row.pick_started_at as string).getTime() - Date.now())).toBeLessThan(10_000);

      // Ties on points resolve by name.
      const tied = await buildLeague(db, { coaches: 1, picksPerTeam: 1, pool: [
        { name: "Zebra", points: 10, tier: 11 }, { name: "Apple", points: 10, tier: 11 }, { name: "Cheap", points: 1, tier: 20 },
      ] });
      await rpcAs(db, tied.commissioner.userId, "start_draft", { p_league_id: tied.leagueId });
      await expireTimer(db, tied.leagueId);
      const tiedResult = await rpcAs<AutoPickResult>(db, tied.coaches[0].userId, "auto_pick_if_expired", { p_league_id: tied.leagueId });
      expect(tiedResult.pokemon_name).toBe("Apple");
    });

    it("skips the turn when no Pokémon is legal, leaving an empty slot", async () => {
      // 2 teams, 2 picks, budget 10, pool 9/9/1/5: A takes 9, B takes 9 then 1,
      // A cannot afford the remaining 5 and is skipped, which ends the draft.
      const pool = [
        { name: "Nine A", points: 9, tier: 12 },
        { name: "Nine B", points: 9, tier: 12 },
        { name: "One", points: 1, tier: 20 },
        { name: "Five", points: 5, tier: 16 },
      ];
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
      const [a, b] = league.order;
      await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });

      const results: AutoPickResult[] = [];
      for (let i = 0; i < 4; i += 1) {
        await expireTimer(db, league.leagueId);
        results.push(await rpcAs<AutoPickResult>(db, b.userId, "auto_pick_if_expired", { p_league_id: league.leagueId }));
      }
      expect(results.map((r) => r.pokemon_name)).toEqual(["Nine A", "Nine B", "One", null]);
      expect(results[3]).toEqual({ picked: false, pokemon_name: null, skipped: true, draft_completed: true });

      const teamA = await teamFor(db, league.leagueId, a.memberId);
      const teamB = await teamFor(db, league.leagueId, b.memberId);
      expect(teamA.pokemon.map((p) => p.name)).toEqual(["Nine A"]);
      expect(teamB.pokemon.map((p) => p.name)).toEqual(["Nine B", "One"]);
      expect(await count(db, "league_matches", "league_id = $1", [league.leagueId])).toBe(1);

      const after = await rpcAs<AutoPickResult>(db, b.userId, "auto_pick_if_expired", { p_league_id: league.leagueId });
      expect(after).toEqual({ picked: false, pokemon_name: null, skipped: false, draft_completed: true });
    });

    it("is idempotent when two clients call it at the same time", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await expireTimer(db, league.leagueId);
      const connA = await connect();
      const connB = await connect();
      try {
        const [first, second] = await Promise.all([
          rpcAs<AutoPickResult>(connA, league.coaches[0].userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
          rpcAs<AutoPickResult>(connB, league.coaches[1].userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
        ]);
        expect([first.picked, second.picked].filter(Boolean)).toHaveLength(1);
        expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(1);
        expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(2);
      } finally {
        await connA.end();
        await connB.end();
      }
    });
  });

  describe("pause_draft and resume_draft", () => {
    it("blocks picks while paused and shifts the timer forward on resume", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      const commissioner = league.commissioner.userId;
      await expectRpcError(rpcAs(db, commissioner, "pause_draft", { p_league_id: league.leagueId }), "draft_not_started");
      await rpcAs(db, commissioner, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, commissioner, "resume_draft", { p_league_id: league.leagueId }), "not_paused");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "pause_draft", { p_league_id: league.leagueId }), "not_commissioner");

      await rpcAs(db, commissioner, "pause_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, commissioner, "pause_draft", { p_league_id: league.leagueId }), "already_paused");
      await expectRpcError(rpcAs(db, commissioner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" }), "draft_paused");
      await expectRpcError(rpcAs(db, commissioner, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null }), "draft_paused");

      await expireTimer(db, league.leagueId);
      const whilePaused = await rpcAs<AutoPickResult>(db, commissioner, "auto_pick_if_expired", { p_league_id: league.leagueId });
      expect(whilePaused.picked).toBe(false);

      // Pretend the pause started 30 seconds ago.
      await db.query("update public.leagues set draft_paused_at = now() - interval '30 seconds' where id = $1", [league.leagueId]);
      const before = await leagueRow(db, league.leagueId);
      await rpcAs(db, commissioner, "resume_draft", { p_league_id: league.leagueId });
      const after = await leagueRow(db, league.leagueId);
      const shift = (new Date(after.pick_started_at as string).getTime() - new Date(before.pick_started_at as string).getTime()) / 1000;
      expect(shift).toBeGreaterThanOrEqual(29);
      expect(shift).toBeLessThan(35);
      expect(after.draft_paused_at).toBeNull();
      expect(after.draft_paused_total_seconds).toBeGreaterThanOrEqual(29);
      expect(after.draft_paused_total_seconds).toBeLessThan(35);

      await rpcAs(db, commissioner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    });
  });

  describe("undo_last_pick and force_pick", () => {
    it("undo removes the highest pick and hands the turn back", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      const [a, b] = league.order;
      await expectRpcError(rpcAs(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId }), "draft_not_started");
      await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId }), "no_picks");
      await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
      await expectRpcError(rpcAs(db, b.userId, "undo_last_pick", { p_league_id: league.leagueId }), "not_commissioner");

      const undone = await rpcAs<{ pick_number: number; pokemon_name: string }>(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId });
      expect(undone).toEqual({ pick_number: 2, pokemon_name: "Mon002" });
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(1);
      const row = await leagueRow(db, league.leagueId);
      expect(row.current_pick_number).toBe(2);
      expect(Math.abs(new Date(row.pick_started_at as string).getTime() - Date.now())).toBeLessThan(10_000);
      expect((await onClockMember(db, league.leagueId)).memberId).toBe(b.memberId);
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
      const finished = await rpcAs<PickResult>(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon004" });
      expect(finished.draft_completed).toBe(true);
      await expectRpcError(rpcAs(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId }), "draft_completed");
    });

    it("force_pick drafts for the coach on the clock, by name or best available", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      const [commish, coach1, coach2] = league.order;
      await rpcAs(db, commish.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(rpcAs(db, coach1.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" }), "not_commissioner");

      const first = await rpcAs<PickResult & { skipped: boolean }>(db, commish.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon005" });
      expect(first).toMatchObject({ pick_number: 1, draft_completed: false, skipped: false, pokemon_name: "Mon005" });
      await expectRpcError(rpcAs(db, commish.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon005" }), "pokemon_already_drafted");
      await expectRpcError(rpcAs(db, commish.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nope" }), "pokemon_not_in_pool");

      // Pick 2 belongs to coach1; a forced best-available pick lands on their team.
      const second = await rpcAs<PickResult & { skipped: boolean }>(db, commish.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
      expect(second).toMatchObject({ pick_number: 2, pokemon_name: "Mon001", skipped: false });
      const picks = await picksFor(db, league.leagueId);
      expect(picks[1].member_id).toBe(coach1.memberId);
      expect((await onClockMember(db, league.leagueId)).memberId).toBe(coach2.memberId);
    });

    it("force_pick skips the turn when nothing is legal", async () => {
      const pool = [
        { name: "Nine A", points: 9, tier: 12 },
        { name: "Nine B", points: 9, tier: 12 },
        { name: "One", points: 1, tier: 20 },
        { name: "Five", points: 5, tier: 16 },
      ];
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
      const [a, b] = league.order;
      await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
      await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine A" });
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine B" });
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" });
      const skipped = await rpcAs<PickResult & { skipped: boolean }>(db, a.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
      expect(skipped).toEqual({ pick_number: 4, pokemon_name: null, draft_completed: true, skipped: true });
      expect((await teamFor(db, league.leagueId, a.memberId)).pokemon).toHaveLength(1);
    });
  });

  describe("finalize_draft and reset_draft", () => {
    it("finalize_draft refuses early, recovers a stuck league, and refuses a finished one", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      const [a, b] = league.order;
      await expectRpcError(rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId }), "draft_not_started");
      await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
      await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
      await expectRpcError(rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId }), "draft_incomplete");
      await expectRpcError(rpcAs(db, b.userId, "finalize_draft", { p_league_id: league.leagueId }), "not_commissioner");
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
      await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
      await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon004" });
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(2);
      await expectRpcError(rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId }), "draft_completed");

      // Simulate a league that finished its picks but never materialized teams.
      await db.query("delete from public.drafted_teams where league_id = $1", [league.leagueId]);
      await db.query("delete from public.league_matches where league_id = $1", [league.leagueId]);
      await db.query("update public.leagues set draft_completed = false where id = $1", [league.leagueId]);
      await rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId });
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(2);
      expect(await count(db, "league_matches", "league_id = $1", [league.leagueId])).toBe(1);
      expect((await leagueRow(db, league.leagueId)).draft_completed).toBe(true);
      // Idempotent on a completed league without teams too.
      await db.query("delete from public.drafted_teams where league_id = $1", [league.leagueId]);
      await rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId });
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(2);
    });

    it("reset_draft wipes picks, teams, matches and news and resets the flags", async () => {
      const league: LeagueFixture = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
      await runFullDraft(db, league);
      await rpcAs(db, league.coaches[0].userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Mon007" }).catch(() => undefined);
      const matches = await matchesFor(db, league.leagueId);
      await rpcAs(db, league.commissioner.userId, "report_match_result", { p_match_id: matches[0].id, p_winner_member_id: matches[0].home_member_id });
      await db.query("update public.league_members set free_agent_swaps_used = 2 where id = $1", [league.coaches[0].memberId]);
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "reset_draft", { p_league_id: league.leagueId }), "not_commissioner");

      await rpcAs(db, league.commissioner.userId, "reset_draft", { p_league_id: league.leagueId });
      for (const table of ["draft_picks", "drafted_teams", "league_matches", "league_news"]) {
        expect(await count(db, table, "league_id = $1", [league.leagueId]), table).toBe(0);
      }
      const row = await leagueRow(db, league.leagueId);
      expect(row.draft_started).toBe(false);
      expect(row.draft_completed).toBe(false);
      expect(row.current_pick_number).toBe(1);
      expect(row.draft_paused_at).toBeNull();
      // The fixture's explicit custom pool is kept.
      expect(row.custom_pool).not.toBeNull();
      const { rows } = await db.query("select free_agent_swaps_used from public.league_members where league_id = $1", [league.leagueId]);
      expect(rows.every((r) => r.free_agent_swaps_used === 0)).toBe(true);
      // The draft can run again from scratch.
      await runFullDraft(db, league);
      expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(3);
    });
  });
});
