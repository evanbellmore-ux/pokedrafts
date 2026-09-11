"use client";

import { Trophy } from "lucide-react";
import { Button, StatusPill } from "@/app/components/ui";
import { matchStatusLabel } from "@/app/lib/league/labels";
import type { LeagueMatch } from "@/app/types/league";
import {
  isCompleted,
  matchTone,
  memberTeamName,
  type MatchMember,
  type Round,
} from "./helpers";

type RoundCardProps = {
  round: Round;
  members: MatchMember[];
  /** The viewer's own member id, for the "You" marker. */
  currentMemberId: string;
  isCommissioner: boolean;
  /** Disables the result buttons while a result action is running. */
  busy: boolean;
  onReport: (match: LeagueMatch, winnerMemberId: string) => void;
  onEdit: (match: LeagueMatch) => void;
};

/**
 * A team name that can never widen the page: the name is a flex item, so it
 * needs `min-w-0` to shrink below its longest word, and `wrap-anywhere`
 * (overflow-wrap: anywhere) so a spaceless 40-character name breaks instead
 * of setting the item's min-content width. Plain `break-words` is not enough
 * for either.
 */
function TeamName({ name, isYou }: { name: string; isYou: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="min-w-0 wrap-anywhere font-semibold text-text">
        {name}
      </span>
      {isYou && <StatusPill tone="accent">You</StatusPill>}
    </span>
  );
}

/** One round of the schedule: its matches and, in odd-sized leagues, the bye. */
export default function RoundCard({
  round,
  members,
  currentMemberId,
  isCommissioner,
  busy,
  onReport,
  onEdit,
}: RoundCardProps) {
  const headingId = `round-${round.roundNumber}-heading`;
  const finals = round.matches.filter(isCompleted).length;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-text">
          Round {round.roundNumber}
        </h2>
        <p className="text-sm text-muted">
          {finals} of {round.matches.length} final
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {round.matches.map((match) => {
          const homeName = memberTeamName(members, match.home_member_id);
          const awayName = memberTeamName(members, match.away_member_id);
          const completed = isCompleted(match);
          const winnerName = match.winner_member_id
            ? memberTeamName(members, match.winner_member_id)
            : null;

          return (
            <li
              key={match.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                  Match {match.match_number}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <TeamName
                    name={homeName}
                    isYou={match.home_member_id === currentMemberId}
                  />
                  <span className="text-sm text-faint">vs</span>
                  <TeamName
                    name={awayName}
                    isYou={match.away_member_id === currentMemberId}
                  />
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <StatusPill tone={matchTone(match)}>
                    {matchStatusLabel(match.status)}
                  </StatusPill>
                  {completed && winnerName && (
                    <span className="inline-flex max-w-full items-center gap-1 text-success">
                      <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 wrap-anywhere">
                        Winner:{" "}
                        <span className="font-semibold">{winnerName}</span>
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {isCommissioner && (
                <div className="flex max-w-full flex-wrap gap-2 md:shrink-0 md:justify-end">
                  {completed ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onEdit(match)}
                      aria-label={`Edit result: ${homeName} vs ${awayName}`}
                    >
                      Edit result
                    </Button>
                  ) : (
                    <>
                      {/*
                        The button group is `md:shrink-0`, so each button is
                        capped on md+ (and at the row width below md) and the
                        team name truncates; "won" stays visible so a clipped
                        label still reads as a result.
                      */}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="max-w-full md:max-w-56"
                        disabled={busy}
                        onClick={() => onReport(match, match.home_member_id)}
                      >
                        <span className="min-w-0 truncate">{homeName}</span>
                        <span className="shrink-0">won</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="max-w-full md:max-w-56"
                        disabled={busy}
                        onClick={() => onReport(match, match.away_member_id)}
                      >
                        <span className="min-w-0 truncate">{awayName}</span>
                        <span className="shrink-0">won</span>
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {round.byeMemberIds.map((memberId) => (
          <li
            key={`bye-${memberId}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted"
          >
            <span>Bye:</span>
            <TeamName
              name={memberTeamName(members, memberId)}
              isYou={memberId === currentMemberId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
