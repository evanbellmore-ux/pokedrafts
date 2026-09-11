import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildLeague,
  connect,
  createUser,
  expectRpcError,
  memberFor,
  newsFor,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
  type LeagueFixture,
} from "./harness";

type NewsRow = {
  id: string;
  league_id: string;
  member_id: string;
  news_type: string;
  message: string;
  metadata: {
    added: string;
    dropped: string | null;
    team_id: string;
    before_pokemon: unknown[];
    after_pokemon: unknown[];
    previous_free_agent_swaps_used: number;
    next_free_agent_swaps_used: number;
  };
};

// 3 teams x 2 picks from a 12-entry pool priced 20..9: Mon001..Mon006 are
// drafted, Mon007..Mon012 are free agents.
async function draftedLeague(db: Client): Promise<LeagueFixture> {
  const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
  await runFullDraft(db, league);
  return league;
}

describe("free agent RPCs", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  describe("swap_free_agent", () => {
    it("requires a completed draft and membership", async () => {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Mon008" }), "draft_not_completed");
      await runFullDraft(db, league);
      await expectRpcError(rpcAs(db, await createUser(db), "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Mon008" }), "not_a_member");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "swap_free_agent", { p_league_id: randomUUID(), p_drop_name: null, p_add_name: "Mon008" }), "league_not_found");
    });

    it("swaps a roster entry, charges a swap and writes the news row", async () => {
      const league = await draftedLeague(db);
      const coach = league.coaches[0];
      const before = await teamFor(db, league.leagueId, coach.memberId);
      const dropped = before.pokemon[1];

      const news = await rpcAs<NewsRow>(db, coach.userId, "swap_free_agent", {
        p_league_id: league.leagueId,
        p_drop_name: dropped.name.toUpperCase(),
        p_add_name: " mon008 ",
      });
      expect(news.news_type).toBe("free_agent");
      expect(news.member_id).toBe(coach.memberId);
      expect(news.message).toBe(`Coach 1 added Mon008 and dropped ${dropped.name}.`);
      expect(news.metadata.added).toBe("Mon008");
      expect(news.metadata.dropped).toBe(dropped.name);
      expect(news.metadata.team_id).toBe(before.id);
      expect(news.metadata.before_pokemon).toEqual(before.pokemon);
      expect(news.metadata.previous_free_agent_swaps_used).toBe(0);
      expect(news.metadata.next_free_agent_swaps_used).toBe(1);

      const after = await teamFor(db, league.leagueId, coach.memberId);
      expect(after.pokemon).toHaveLength(2);
      expect(after.pokemon[0]).toEqual(before.pokemon[0]);
      expect(after.pokemon[1]).toEqual({ name: "Mon008", points: 13, tier: 8, pick_number: null, acquired: "free_agent" });
      expect(after.total_points).toBe(before.pokemon[0].points + 13);
      expect(news.metadata.after_pokemon).toEqual(after.pokemon);
      expect((await memberFor(db, league.leagueId, coach.userId)).free_agent_swaps_used).toBe(1);
      expect(await newsFor(db, league.leagueId, "free_agent")).toHaveLength(1);
    });

    it("validates the pool, ownership, roster membership, roster size and budget", async () => {
      const league = await draftedLeague(db);
      const coach = league.coaches[0];
      const other = league.coaches[1];
      const mine = await teamFor(db, league.leagueId, coach.memberId);
      const theirs = await teamFor(db, league.leagueId, other.memberId);
      const swap = (p_drop_name: string | null, p_add_name: string) =>
        rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name, p_add_name });

      await expectRpcError(swap(mine.pokemon[0].name, "Missingno"), "pokemon_not_in_pool");
      await expectRpcError(swap(mine.pokemon[0].name, theirs.pokemon[0].name), "pokemon_owned");
      await expectRpcError(swap(mine.pokemon[0].name, mine.pokemon[1].name), "pokemon_owned");
      await expectRpcError(swap(theirs.pokemon[0].name, "Mon009"), "not_on_roster");
      await expectRpcError(swap(null, "Mon009"), "roster_full");

      // Tighten the budget after the draft: dropping the cheaper mon for a
      // pricier free agent must not exceed it.
      const cheaper = mine.pokemon[0].points < mine.pokemon[1].points ? mine.pokemon[0] : mine.pokemon[1];
      const keep = cheaper === mine.pokemon[0] ? mine.pokemon[1] : mine.pokemon[0];
      await db.query("update public.leagues set point_budget = $2 where id = $1", [league.leagueId, keep.points + 13]);
      await expectRpcError(swap(cheaper.name, "Mon007"), "over_budget");
      await rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: cheaper.name, p_add_name: "Mon008" });
      expect((await teamFor(db, league.leagueId, coach.memberId)).total_points).toBe(keep.points + 13);
    });

    it("adds to an open slot when the roster is short", async () => {
      // A drafts 9 and cannot afford the remaining 5, so A's last turn is
      // skipped and the roster ends one short.
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
      await expectRpcError(rpcAs(db, a.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: "Five" }), "over_budget");
      await rpcAs(db, a.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
      expect((await teamFor(db, league.leagueId, a.memberId)).pokemon).toHaveLength(1);

      await expectRpcError(rpcAs(db, a.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Five" }), "over_budget");
      // The commissioner raises the budget after the draft; the open slot can now be filled.
      await db.query("update public.leagues set point_budget = 14 where id = $1", [league.leagueId]);
      const news = await rpcAs<NewsRow>(db, a.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: null, p_add_name: "Five" });
      expect(news.message).toBe("Commish added Five.");
      expect(news.metadata.dropped).toBeNull();
      const team = await teamFor(db, league.leagueId, a.memberId);
      expect(team.pokemon.map((p) => p.name)).toEqual(["Nine A", "Five"]);
      expect(team.pokemon[1]).toEqual({ name: "Five", points: 5, tier: 16, pick_number: null, acquired: "free_agent" });
      expect(team.total_points).toBe(14);
    });

    it("enforces the swap limit", async () => {
      const league = await draftedLeague(db);
      const coach = league.coaches[0];
      await rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { free_agent_swap_limit: 2 } });
      const roster = () => teamFor(db, league.leagueId, coach.memberId);
      await rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: (await roster()).pokemon[0].name, p_add_name: "Mon007" });
      await rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: (await roster()).pokemon[1].name, p_add_name: "Mon008" });
      expect((await memberFor(db, league.leagueId, coach.userId)).free_agent_swaps_used).toBe(2);
      await expectRpcError(
        rpcAs(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: "Mon007", p_add_name: "Mon009" }),
        "no_swaps_left",
      );
    });

    it("two coaches adding the same free agent: exactly one succeeds", async () => {
      const league = await draftedLeague(db);
      const [coachA, coachB] = league.coaches;
      const dropA = (await teamFor(db, league.leagueId, coachA.memberId)).pokemon[0].name;
      const dropB = (await teamFor(db, league.leagueId, coachB.memberId)).pokemon[0].name;
      const connA = await connect();
      const connB = await connect();
      try {
        const results = await Promise.allSettled([
          rpcAs(connA, coachA.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: dropA, p_add_name: "Mon007" }),
          rpcAs(connB, coachB.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: dropB, p_add_name: "Mon007" }),
        ]);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0].reason as { detail?: string }).detail).toBe("pokemon_owned");
        const owners = await db.query(
          "select count(*)::int as n from public.drafted_teams t, jsonb_array_elements(t.pokemon) e where t.league_id = $1 and e->>'name' = 'Mon007'",
          [league.leagueId],
        );
        expect(owners.rows[0].n).toBe(1);
        expect(await newsFor(db, league.leagueId, "free_agent")).toHaveLength(1);
      } finally {
        await connA.end();
        await connB.end();
      }
    });
  });

  describe("undo_free_agent_move", () => {
    it("restores the roster, the swap count and removes the news row", async () => {
      const league = await draftedLeague(db);
      const coach = league.coaches[0];
      const before = await teamFor(db, league.leagueId, coach.memberId);
      const news = await rpcAs<NewsRow>(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: before.pokemon[0].name, p_add_name: "Mon007" });
      await expectRpcError(rpcAs(db, coach.userId, "undo_free_agent_move", { p_news_id: news.id }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: randomUUID() }), "news_not_found");

      await rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: news.id });
      const restored = await teamFor(db, league.leagueId, coach.memberId);
      expect(restored.pokemon).toEqual(before.pokemon);
      expect(restored.total_points).toBe(before.total_points);
      expect((await memberFor(db, league.leagueId, coach.userId)).free_agent_swaps_used).toBe(0);
      expect(await newsFor(db, league.leagueId, "free_agent")).toHaveLength(0);
      await expectRpcError(rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: news.id }), "news_not_found");
    });

    it("refuses a stale move (a newer move exists for the team)", async () => {
      const league = await draftedLeague(db);
      const coach = league.coaches[0];
      const roster = () => teamFor(db, league.leagueId, coach.memberId);
      const first = await rpcAs<NewsRow>(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: (await roster()).pokemon[0].name, p_add_name: "Mon007" });
      const second = await rpcAs<NewsRow>(db, coach.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: (await roster()).pokemon[1].name, p_add_name: "Mon008" });
      await expectRpcError(rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: first.id }), "not_latest_move");
      await rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: second.id });
      await rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: first.id });
      expect((await memberFor(db, league.leagueId, coach.userId)).free_agent_swaps_used).toBe(0);
    });

    it("refuses when the roster changed or a restore would double-own a Pokémon", async () => {
      const league = await draftedLeague(db);
      const [coachA, coachB] = league.coaches;
      const rosterA = await teamFor(db, league.leagueId, coachA.memberId);
      const droppedByA = rosterA.pokemon[0].name;
      const moveA = await rpcAs<NewsRow>(db, coachA.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: droppedByA, p_add_name: "Mon007" });
      // Coach B picks up what A dropped.
      const rosterB = await teamFor(db, league.leagueId, coachB.memberId);
      const moveB = await rpcAs<NewsRow>(db, coachB.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: rosterB.pokemon[0].name, p_add_name: droppedByA });
      await expectRpcError(rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: moveA.id }), "pokemon_owned");
      // Undo B first, then A's restore is possible again.
      await rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: moveB.id });
      await rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: moveA.id });
      expect((await teamFor(db, league.leagueId, coachA.memberId)).pokemon).toEqual(rosterA.pokemon);

      const moveC = await rpcAs<NewsRow>(db, coachA.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: droppedByA, p_add_name: "Mon008" });
      await db.query("update public.drafted_teams set pokemon = pokemon || '[{\"name\":\"Extra\",\"points\":1,\"tier\":20}]'::jsonb where league_id = $1 and member_id = $2", [
        league.leagueId,
        coachA.memberId,
      ]);
      await expectRpcError(rpcAs(db, league.commissioner.userId, "undo_free_agent_move", { p_news_id: moveC.id }), "roster_changed");
    });
  });
});
