import { describe, expect, it } from "vitest";
import {
  buildScheduleRows,
  type SchedulableMember,
} from "@/app/lib/league/schedule";

function makeMembers(count: number): SchedulableMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    team_name: `Team ${index + 1}`,
  }));
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

function groupByRound<T extends { round_number: number }>(rows: T[]) {
  const rounds = new Map<number, T[]>();
  for (const row of rows) {
    const list = rounds.get(row.round_number) ?? [];
    list.push(row);
    rounds.set(row.round_number, list);
  }
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, matches]) => matches);
}

describe("buildScheduleRows (single round robin)", () => {
  for (let n = 2; n <= 9; n += 1) {
    describe(`${n} teams`, () => {
      const members = makeMembers(n);
      const rows = buildScheduleRows("league-1", members, "round_robin");
      const rounds = groupByRound(rows);
      const padded = n % 2 === 0 ? n : n + 1;

      it("has padded-1 rounds", () => {
        expect(rounds).toHaveLength(padded - 1);
        rounds.forEach((_, index) => {
          expect(rows.some((row) => row.round_number === index + 1)).toBe(true);
        });
      });

      it("plays every pair exactly once", () => {
        const seen = new Map<string, number>();
        for (const row of rows) {
          const key = pairKey(row.home_member_id, row.away_member_id);
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        expect(rows).toHaveLength((n * (n - 1)) / 2);
        expect([...seen.values()].every((count) => count === 1)).toBe(true);
        expect(seen.size).toBe((n * (n - 1)) / 2);
      });

      it("never schedules a team twice in one round", () => {
        for (const round of rounds) {
          const ids = round.flatMap((match) => [
            match.home_member_id,
            match.away_member_id,
          ]);
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.every((id) => id !== "bye")).toBe(true);
        }
      });

      it(`gives ${n % 2 === 1 ? "one bye" : "no byes"} per round`, () => {
        for (const round of rounds) {
          expect(round).toHaveLength(Math.floor(n / 2));
        }
      });

      it("restarts match numbers at 1 in every round", () => {
        for (const round of rounds) {
          const numbers = round.map((match) => match.match_number).sort((a, b) => a - b);
          expect(numbers).toEqual(numbers.map((_, index) => index + 1));
        }
      });

      it("stamps the league id and upcoming status on every row", () => {
        for (const row of rows) {
          expect(row.league_id).toBe("league-1");
          expect(row.status).toBe("upcoming");
          expect(row.home_member_id).not.toBe(row.away_member_id);
        }
      });
    });
  }
});

describe("buildScheduleRows (double round robin)", () => {
  for (let n = 2; n <= 9; n += 1) {
    it(`${n} teams: mirrors the first half with home and away swapped`, () => {
      const members = makeMembers(n);
      const single = buildScheduleRows("league-1", members, "round_robin");
      const double = buildScheduleRows("league-1", members, "double_round_robin");
      const singleRounds = groupByRound(single);
      const doubleRounds = groupByRound(double);

      expect(double).toHaveLength(single.length * 2);
      expect(doubleRounds).toHaveLength(singleRounds.length * 2);

      singleRounds.forEach((round, index) => {
        const mirror = doubleRounds[index + singleRounds.length];
        expect(mirror).toHaveLength(round.length);
        round.forEach((match, matchIndex) => {
          expect(mirror[matchIndex].home_member_id).toBe(match.away_member_id);
          expect(mirror[matchIndex].away_member_id).toBe(match.home_member_id);
          expect(mirror[matchIndex].match_number).toBe(match.match_number);
        });
      });

      const seen = new Map<string, number>();
      for (const row of double) {
        const key = pairKey(row.home_member_id, row.away_member_id);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      expect([...seen.values()].every((count) => count === 2)).toBe(true);
    });
  }
});
