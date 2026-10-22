import { Trophy } from "lucide-react";
import { EmptyState } from "@/app/components/ui";
import { playoffSize } from "@/app/lib/league/bracket";
import { teamNameLabel } from "@/app/lib/league/labels";
import { formatDifferential, formatWinPercentage } from "@/app/lib/league/standings";
import type { PublicLeague } from "@/app/types/league";

const th = "px-3 py-2.5 font-medium";
const td = "px-3 py-2.5 align-middle";

/**
 * The league's standings for the watch page: `get_public_league` already
 * ranks them (league_standings, docs/schema.md "Standings and playoffs"), so
 * this only names the teams. Narrower than the Standings page's table: no
 * Remaining column, so it fits the side column without scrolling.
 */
export default function PublicStandings({ league }: { league: PublicLeague }) {
  const names = new Map(league.coaches.map((coach) => [coach.id, coach.team_name]));
  const playoffLine = playoffSize(league.playoff_format);
  const rows = league.standings;
  const regular = league.matches.filter((match) => match.stage === "regular");
  const played = regular.filter((match) => match.status === "completed").length;

  return (
    <section aria-labelledby="watch-standings-heading" className="rounded-xl border border-line bg-panel p-4">
      <h2 id="watch-standings-heading" className="text-base font-semibold text-text">
        Standings
      </h2>
      <p className="mt-1 text-sm text-muted">
        {regular.length > 0
          ? `${played} of ${regular.length} regular season matches played.`
          : "The schedule has not been made yet."}
      </p>

      {rows.length === 0 ? (
        <EmptyState className="mt-3" title="No standings yet" />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">League standings</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className={th}>
                  Rank
                </th>
                <th scope="col" className={th}>
                  Team
                </th>
                <th scope="col" className={`${th} text-right`}>
                  <abbr title="Wins">W</abbr>
                </th>
                <th scope="col" className={`${th} text-right`}>
                  <abbr title="Losses">L</abbr>
                </th>
                <th scope="col" className={`${th} text-right`}>
                  <abbr title="Win percentage">Pct</abbr>
                </th>
                <th scope="col" className={`${th} text-right`}>
                  <abbr title="Differential">Diff</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.member_id}
                  className={`border-t ${
                    playoffLine > 0 && playoffLine < rows.length && row.seed === playoffLine + 1
                      ? "border-accent-border"
                      : "border-line"
                  }`}
                >
                  <td className={`${td} font-semibold tabular-nums text-text`}>
                    {row.tied ? (
                      <>
                        <span aria-hidden="true">T-{row.rank}</span>
                        <span className="sr-only">Tied for {row.rank}</span>
                      </>
                    ) : (
                      row.rank
                    )}
                  </td>
                  <td className={`${td} wrap-anywhere font-semibold text-text`}>
                    {teamNameLabel(names.get(row.member_id))}
                    {row.member_id === league.champion_member_id && (
                      <>
                        <Trophy className="ml-1.5 inline h-3.5 w-3.5 align-[-2px] text-warning" aria-hidden="true" />
                        <span className="sr-only"> (champion)</span>
                      </>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{row.wins}</td>
                  <td className={`${td} text-right tabular-nums`}>{row.losses}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {row.played > 0 ? formatWinPercentage(Number(row.win_pct)) : "–"}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{formatDifferential(row.differential)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {playoffLine > 0 && playoffLine < rows.length && (
        <p className="mt-2 text-xs text-muted">The top {playoffLine} seeds make the playoffs.</p>
      )}
    </section>
  );
}
