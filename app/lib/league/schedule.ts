export type ScheduleFormat = "round_robin" | "double_round_robin";

export type SchedulableMember = {
  id: string;
  team_name: string | null;
};

type ScheduleMatch = {
  home_member_id: string;
  away_member_id: string;
};

function generateRoundRobin(members: SchedulableMember[]) {
  const teams = [...members];

  if (teams.length % 2 === 1) {
    teams.push({
      id: "bye",
      team_name: "Bye",
    });
  }

  const rounds: ScheduleMatch[][] = [];
  const rotating = [...teams];

  for (let round = 0; round < teams.length - 1; round++) {
    const matches: ScheduleMatch[] = [];

    for (let i = 0; i < teams.length / 2; i++) {
      const home = rotating[i];
      const away = rotating[teams.length - 1 - i];

      if (home.id !== "bye" && away.id !== "bye") {
        matches.push({
          home_member_id: round % 2 === 0 ? home.id : away.id,
          away_member_id: round % 2 === 0 ? away.id : home.id,
        });
      }
    }

    rounds.push(matches);

    const fixed = rotating[0];
    const rest = rotating.slice(1);
    rest.unshift(rest.pop()!);
    rotating.splice(0, rotating.length, fixed, ...rest);
  }

  return rounds;
}

export function buildScheduleRows(
  leagueId: string,
  members: SchedulableMember[],
  format: ScheduleFormat
) {
  const firstRoundRobin = generateRoundRobin(members);
  const rounds =
    format === "double_round_robin"
      ? [
          ...firstRoundRobin,
          ...firstRoundRobin.map((round) =>
            round.map((match) => ({
              home_member_id: match.away_member_id,
              away_member_id: match.home_member_id,
            }))
          ),
        ]
      : firstRoundRobin;

  return rounds.flatMap((round, roundIndex) =>
    round.map((match, matchIndex) => ({
      league_id: leagueId,
      round_number: roundIndex + 1,
      match_number: matchIndex + 1,
      home_member_id: match.home_member_id,
      away_member_id: match.away_member_id,
      status: "upcoming",
    }))
  );
}
