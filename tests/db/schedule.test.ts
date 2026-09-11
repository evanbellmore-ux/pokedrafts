import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildLeague,
  connect,
  expectRpcError,
  leagueRow,
  matchesFor,
  newsFor,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
  type LeagueFixture,
} from "./harness";

async function completedLeague(db: Client, teams = 4): Promise<LeagueFixture> {
  const league = await buildLeague(db, { coaches: teams - 1, picksPerTeam: 1, pool: samplePool(teams * 2) });
  await runFullDraft(db, league);
  return league;
}

function pairingKey(home: string, away: string): string {
  return [home, away].sort().join("|");
}

describe("schedule and result RPCs", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  describe("generate_schedule", () => {
    it("requires a completed draft, a valid format and the commissioner", async () => {
      const league = await buildLeague(db, { coaches: 2, picksPerTeam: 1, pool: samplePool(6) });
      const generate = (user: string, args: Record<string, unknown> = {}) =>
        rpcAs<number>(db, user, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: false, ...args });
      await expectRpcError(generate(league.commissioner.userId), "draft_not_completed");
      await runFullDraft(db, league);
      await expectRpcError(generate(league.coaches[0].userId), "not_commissioner");
      await expectRpcError(generate(league.commissioner.userId, { p_format: "swiss" }), "invalid_schedule_format");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "generate_schedule", { p_league_id: randomUUID(), p_format: "round_robin", p_randomize: false }), "league_not_found");
    });

    it("regenerates matches for both formats and updates schedule_format", async () => {
      const league = await completedLeague(db, 4);
      const commissioner = league.commissioner.userId;
      expect(await matchesFor(db, league.leagueId)).toHaveLength(6);

      const doubled = await rpcAs<number>(db, commissioner, "generate_schedule", { p_league_id: league.leagueId, p_format: "double_round_robin", p_randomize: false });
      expect(doubled).toBe(12);
      const matches = await matchesFor(db, league.leagueId);
      expect(matches).toHaveLength(12);
      expect((await leagueRow(db, league.leagueId)).schedule_format).toBe("double_round_robin");
      // Every pairing appears twice with home and away swapped.
      const firstHalf = matches.filter((m) => m.round_number <= 3);
      const secondHalf = matches.filter((m) => m.round_number > 3);
      expect(secondHalf.map((m) => `${m.away_member_id}>${m.home_member_id}`).sort()).toEqual(firstHalf.map((m) => `${m.home_member_id}>${m.away_member_id}`).sort());

      const single = await rpcAs<number>(db, commissioner, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: true });
      expect(single).toBe(6);
      const randomized = await matchesFor(db, league.leagueId);
      const pairings = new Set(randomized.map((m) => pairingKey(m.home_member_id, m.away_member_id)));
      expect(pairings.size).toBe(6);
      for (const round of [1, 2, 3]) {
        const inRound = randomized.filter((m) => m.round_number === round);
        expect(inRound.map((m) => m.match_number)).toEqual([1, 2]);
        const teams = inRound.flatMap((m) => [m.home_member_id, m.away_member_id]);
        expect(new Set(teams).size).toBe(4);
      }
    });

    it("refuses to discard reported results unless asked, and then clears their news", async () => {
      const league = await completedLeague(db, 3);
      const commissioner = league.commissioner.userId;
      const [match] = await matchesFor(db, league.leagueId);
      await rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.home_member_id });
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(1);

      await expectRpcError(
        rpcAs(db, commissioner, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: false }),
        "results_exist",
      );
      expect((await matchesFor(db, league.leagueId)).find((m) => m.id === match.id)?.status).toBe("completed");

      const regenerated = await rpcAs<number>(db, commissioner, "generate_schedule", {
        p_league_id: league.leagueId,
        p_format: "round_robin",
        p_randomize: false,
        p_discard_results: true,
      });
      expect(regenerated).toBe(3);
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(0);
      expect((await matchesFor(db, league.leagueId)).every((m) => m.status === "upcoming")).toBe(true);
    });
  });

  describe("report_match_result and clear_match_result", () => {
    it("records the winner and keeps exactly one news row per match", async () => {
      const league = await completedLeague(db, 3);
      const commissioner = league.commissioner.userId;
      const [match] = await matchesFor(db, league.leagueId);
      const home = league.order.find((p) => p.memberId === match.home_member_id)!;
      const away = league.order.find((p) => p.memberId === match.away_member_id)!;

      await expectRpcError(rpcAs(db, league.coaches[0].userId, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.home_member_id }), "not_commissioner");
      await expectRpcError(rpcAs(db, commissioner, "report_match_result", { p_match_id: randomUUID(), p_winner_member_id: match.home_member_id }), "match_not_found");
      await expectRpcError(rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: randomUUID() }), "invalid_winner");
      await expectRpcError(rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: null }), "invalid_winner");

      await rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.home_member_id });
      let stored = (await matchesFor(db, league.leagueId)).find((m) => m.id === match.id)!;
      expect(stored.status).toBe("completed");
      expect(stored.winner_member_id).toBe(match.home_member_id);
      let news = await newsFor(db, league.leagueId, "match_result");
      expect(news).toHaveLength(1);
      expect(news[0].member_id).toBe(match.home_member_id);
      expect(news[0].message).toBe(`${home.teamName} defeated ${away.teamName} in Round ${match.round_number}.`);
      expect(news[0].metadata).toEqual({
        match_id: match.id,
        winner_member_id: match.home_member_id,
        loser_member_id: match.away_member_id,
        round_number: match.round_number,
        match_number: match.match_number,
      });

      // Re-reporting flips the winner and replaces the news instead of adding to it.
      await rpcAs(db, commissioner, "report_match_result", { p_match_id: match.id, p_winner_member_id: match.away_member_id });
      stored = (await matchesFor(db, league.leagueId)).find((m) => m.id === match.id)!;
      expect(stored.winner_member_id).toBe(match.away_member_id);
      news = await newsFor(db, league.leagueId, "match_result");
      expect(news).toHaveLength(1);
      expect(news[0].message).toBe(`${away.teamName} defeated ${home.teamName} in Round ${match.round_number}.`);

      await expectRpcError(rpcAs(db, league.coaches[0].userId, "clear_match_result", { p_match_id: match.id }), "not_commissioner");
      await expectRpcError(rpcAs(db, commissioner, "clear_match_result", { p_match_id: randomUUID() }), "match_not_found");
      await rpcAs(db, commissioner, "clear_match_result", { p_match_id: match.id });
      stored = (await matchesFor(db, league.leagueId)).find((m) => m.id === match.id)!;
      expect(stored.status).toBe("upcoming");
      expect(stored.winner_member_id).toBeNull();
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(0);
    });

    it("news for one match never touches another match's news", async () => {
      const league = await completedLeague(db, 4);
      const commissioner = league.commissioner.userId;
      const [first, second] = await matchesFor(db, league.leagueId);
      await rpcAs(db, commissioner, "report_match_result", { p_match_id: first.id, p_winner_member_id: first.home_member_id });
      await rpcAs(db, commissioner, "report_match_result", { p_match_id: second.id, p_winner_member_id: second.away_member_id });
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(2);
      await rpcAs(db, commissioner, "clear_match_result", { p_match_id: first.id });
      const remaining = await newsFor(db, league.leagueId, "match_result");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].metadata.match_id).toBe(second.id);
    });
  });
});
