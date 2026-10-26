import { Trophy } from "lucide-react";
import { StatusPill } from "@/app/components/ui";
import {
  bracketRounds,
  isMatchCompleted,
  isPlayable,
  isPlayoffMatch,
  playoffMatchLabel,
  slotInfo,
  type BracketMatch,
} from "@/app/lib/league/bracket";
import { matchStatusLabel, teamNameLabel } from "@/app/lib/league/labels";
import { playoffProgress } from "@/app/lib/watch/watch-view";
import type { BracketSlot, PublicLeague, PublicMatch } from "@/app/types/league";

type Match = BracketMatch & Pick<PublicMatch, "winner_remaining">;

/**
 * The public matches with their bracket links, which a database without
 * 20261026120000_watch_review.sql does not hand out (see `linked`).
 */
export function bracketMatches(matches: readonly PublicMatch[]): Match[] {
  return matches.map((match) => ({ ...match, feeds_match_id: match.feeds_match_id ?? null, feeds_slot: match.feeds_slot ?? null }));
}

function SeedBadge({ seed }: { seed: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-panel-hover px-1.5 text-xs font-semibold text-text">
      <span className="sr-only">Seed </span>
      {seed}
    </span>
  );
}

function Slot({
  match,
  side,
  matches,
  linked,
  name,
}: {
  match: Match;
  side: BracketSlot;
  matches: Match[];
  linked: boolean;
  name: (id: string) => string;
}) {
  const info = slotInfo(match, side, matches);
  if (info.kind !== "member") {
    return (
      <p className="text-sm italic text-muted">
        {info.kind === "winner_of" ? `Winner of ${playoffMatchLabel(info.feeder, matches)}` : linked ? "Bye" : "To be decided"}
      </p>
    );
  }
  const completed = isMatchCompleted(match);
  const won = completed && match.winner_member_id === info.memberId;
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {info.seed !== null && <SeedBadge seed={info.seed} />}
      <span className={`min-w-0 wrap-anywhere font-semibold ${completed && !won ? "text-muted" : "text-text"}`}>{name(info.memberId)}</span>
      {won && (
        <>
          <Trophy className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
          <span className="sr-only">Winner</span>
        </>
      )}
    </div>
  );
}

/**
 * The playoff bracket on a league's watch page, read-only: the rounds one
 * under another, first round to the final, since the page's side column is
 * narrow (the Matches page lays them side by side). An empty slot reads
 * "Winner of Semifinal 1"; the top seeds' byes in `top_6` are listed in the
 * round they sit out.
 */
export default function PublicBracket({ league }: { league: Pick<PublicLeague, "coaches" | "matches" | "champion_member_id"> }) {
  const matches = bracketMatches(league.matches);
  const rounds = bracketRounds(matches);
  // Without the links (a database before the watch review file) no slot can name its feeder or tell a bye: an empty
  // slot reads "To be decided" and no byes are listed, rather than every seed already placed reading as one.
  const linked = league.matches.every((match) => !isPlayoffMatch(match) || match.feeds_slot !== undefined);
  const names = new Map(league.coaches.map((coach) => [coach.id, coach.team_name]));
  const name = (id: string) => teamNameLabel(names.get(id));
  const playoff = matches.filter(isPlayoffMatch);
  const progress = league.champion_member_id
    ? `Champion: ${name(league.champion_member_id)}`
    : (playoffProgress(playoff) ?? "Every match is final.");

  return (
    <section aria-labelledby="watch-bracket-heading" className="rounded-xl border border-line bg-panel p-4">
      <h2 id="watch-bracket-heading" className="text-base font-semibold text-text">
        Playoffs
      </h2>
      <p className="mt-1 text-sm text-muted">{progress}</p>
      <div className="mt-3 flex flex-col gap-4">
        {rounds.map((round) => {
          const headingId = `watch-round-${round.roundNumber}-heading`;
          return (
            <section key={round.roundNumber} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
              <h3 id={headingId} className="text-sm font-semibold text-text">
                {round.name}
              </h3>
              <ul className="flex flex-col gap-2">
                {round.matches.map((match) => {
                  const completed = isMatchCompleted(match);
                  return (
                    <li key={match.id} className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-faint">{playoffMatchLabel(match, matches)}</p>
                        <StatusPill tone={completed ? "success" : "neutral"}>
                          {isPlayable(match) ? matchStatusLabel(match.status) : "Waiting"}
                        </StatusPill>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Slot match={match} side="home" matches={matches} linked={linked} name={name} />
                        <Slot match={match} side="away" matches={matches} linked={linked} name={name} />
                      </div>
                      {completed && match.winner_remaining !== null && (
                        <p className="text-xs text-muted">{match.winner_remaining} left standing</p>
                      )}
                    </li>
                  );
                })}
                {linked && round.byes.map((bye) => (
                  <li
                    key={`bye-${bye.memberId}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted"
                  >
                    <span>Bye:</span>
                    {bye.seed !== null && <SeedBadge seed={bye.seed} />}
                    <span className="min-w-0 wrap-anywhere font-semibold text-text">{name(bye.memberId)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
