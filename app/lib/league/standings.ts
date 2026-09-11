/**
 * Standings derivation. Sorted by win percentage desc, wins desc,
 * head-to-head record between the tied teams, then team name. Teams that are
 * still tied after head-to-head share a rank and get a "T-n" label.
 */

export type StandingsMember = {
  id: string;
  team_name: string | null;
  draft_position?: number | null;
};

export type StandingsMatch = {
  home_member_id: string;
  away_member_id: string;
  status: string | null;
  winner_member_id: string | null;
};

export type Standing<M extends StandingsMember = StandingsMember> = {
  member: M;
  wins: number;
  losses: number;
  played: number;
  remaining: number;
  winPercentage: number;
  rank: number;
  rankLabel: string;
  tied: boolean;
};

function headToHead(
  a: string,
  b: string,
  matches: StandingsMatch[]
): number {
  let aWins = 0;
  let bWins = 0;
  for (const match of matches) {
    if (match.status !== "completed" || !match.winner_member_id) continue;
    const between =
      (match.home_member_id === a && match.away_member_id === b) ||
      (match.home_member_id === b && match.away_member_id === a);
    if (!between) continue;
    if (match.winner_member_id === a) aWins += 1;
    else if (match.winner_member_id === b) bWins += 1;
  }
  return bWins - aWins;
}

type Record_ = Omit<Standing, "rank" | "rankLabel" | "tied">;

function compareRecords(
  a: Record_,
  b: Record_,
  matches: StandingsMatch[]
): number {
  if (b.winPercentage !== a.winPercentage) {
    return b.winPercentage - a.winPercentage;
  }
  if (b.wins !== a.wins) return b.wins - a.wins;
  return headToHead(a.member.id, b.member.id, matches);
}

function compareNames(a: Record_, b: Record_) {
  return (a.member.team_name ?? "").localeCompare(
    b.member.team_name ?? "",
    undefined,
    { sensitivity: "base" }
  );
}

export function computeStandings<M extends StandingsMember>(
  members: M[],
  matches: StandingsMatch[]
): Standing<M>[] {
  const records = new Map<string, Record_ & { member: M }>();

  for (const member of members) {
    records.set(member.id, {
      member,
      wins: 0,
      losses: 0,
      played: 0,
      remaining: 0,
      winPercentage: 0,
    });
  }

  for (const match of matches) {
    const home = records.get(match.home_member_id);
    const away = records.get(match.away_member_id);
    if (!home || !away) continue;

    if (match.status === "completed" && match.winner_member_id) {
      if (match.winner_member_id === home.member.id) {
        home.wins += 1;
        away.losses += 1;
      } else if (match.winner_member_id === away.member.id) {
        away.wins += 1;
        home.losses += 1;
      } else {
        continue;
      }
      home.played += 1;
      away.played += 1;
    } else {
      home.remaining += 1;
      away.remaining += 1;
    }
  }

  const sorted = [...records.values()]
    .map((record) => ({
      ...record,
      winPercentage: record.played > 0 ? record.wins / record.played : 0,
    }))
    .sort((a, b) => compareRecords(a, b, matches) || compareNames(a, b));

  const result: Standing<M>[] = [];
  let rank = 0;

  sorted.forEach((record, index) => {
    const previous = sorted[index - 1];
    const tiedWithPrevious =
      previous !== undefined && compareRecords(previous, record, matches) === 0;
    if (!tiedWithPrevious) rank = index + 1;
    result.push({ ...record, rank, rankLabel: String(rank), tied: false });
  });

  // Label groups that share a rank.
  const counts = new Map<number, number>();
  for (const standing of result) {
    counts.set(standing.rank, (counts.get(standing.rank) ?? 0) + 1);
  }
  for (const standing of result) {
    if ((counts.get(standing.rank) ?? 0) > 1) {
      standing.tied = true;
      standing.rankLabel = `T-${standing.rank}`;
    }
  }

  return result;
}

export function formatWinPercentage(value: number): string {
  return value.toFixed(3).replace(/^0/, "");
}
