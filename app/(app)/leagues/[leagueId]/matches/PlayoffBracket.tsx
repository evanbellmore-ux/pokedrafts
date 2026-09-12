"use client";

import { Trophy } from "lucide-react";
import { Button, StatusPill } from "@/app/components/ui";
import {
  bracketRounds,
  isPlayable,
  playoffMatchLabel,
  slotInfo,
  type BracketBye,
} from "@/app/lib/league/bracket";
import { matchStatusLabel } from "@/app/lib/league/labels";
import type { BracketSlot, LeagueMatch } from "@/app/types/league";
import {
  isCompleted,
  matchTone,
  memberTeamName,
  participants,
  type MatchMember,
} from "./helpers";
import TeamName from "./TeamName";

type PlayoffBracketProps = {
  /** Every match of the league; the bracket keeps the playoff ones. */
  matches: LeagueMatch[];
  members: MatchMember[];
  currentMemberId: string;
  isCommissioner: boolean;
  /** Disables the result buttons while an action is running. */
  busy: boolean;
  onReport: (match: LeagueMatch, winnerMemberId: string) => void;
  onEdit: (match: LeagueMatch) => void;
};

function SeedBadge({ seed }: { seed: number }) {
  return (
    <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-panel-hover px-1.5 text-xs font-bold text-text">
      <span className="sr-only">Seed </span>
      {seed}
    </span>
  );
}

function Slot({
  match,
  side,
  matches,
  members,
  currentMemberId,
}: {
  match: LeagueMatch;
  side: BracketSlot;
  matches: LeagueMatch[];
  members: MatchMember[];
  currentMemberId: string;
}) {
  const info = slotInfo(match, side, matches);

  if (info.kind === "member") {
    const completed = isCompleted(match);
    const won = completed && match.winner_member_id === info.memberId;
    return (
      <div className="flex min-w-0 items-center gap-2">
        {info.seed !== null && <SeedBadge seed={info.seed} />}
        <TeamName
          name={memberTeamName(members, info.memberId)}
          isYou={info.memberId === currentMemberId}
          muted={completed && !won}
        />
        {won && (
          <>
            <Trophy className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span className="sr-only">Winner</span>
          </>
        )}
      </div>
    );
  }

  return (
    <p className="text-sm italic text-muted">
      {info.kind === "winner_of"
        ? `Winner of ${playoffMatchLabel(info.feeder, matches)}`
        : "Bye"}
    </p>
  );
}

function ByeRow({
  bye,
  members,
  currentMemberId,
}: {
  bye: BracketBye;
  members: MatchMember[];
  currentMemberId: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
      <span>Bye:</span>
      {bye.seed !== null && <SeedBadge seed={bye.seed} />}
      <TeamName
        name={memberTeamName(members, bye.memberId)}
        isYou={bye.memberId === currentMemberId}
      />
    </li>
  );
}

/**
 * The single-elimination bracket: one column per round from the first
 * round to the final on `md` and up, stacked below it (section 12.6).
 * Empty slots read "Winner of Quarterfinal 2"; the top seeds' byes in
 * `top_6` are listed in the round they sit out. Playable matches get the
 * same result actions as the regular season.
 */
export default function PlayoffBracket({
  matches,
  members,
  currentMemberId,
  isCommissioner,
  busy,
  onReport,
  onEdit,
}: PlayoffBracketProps) {
  const rounds = bracketRounds(matches);

  return (
    <div className="grid gap-4 md:auto-cols-fr md:grid-flow-col">
      {rounds.map((round) => {
        const headingId = `playoff-round-${round.roundNumber}-heading`;
        return (
          <section
            key={round.roundNumber}
            aria-labelledby={headingId}
            className="flex min-w-0 flex-col gap-3"
          >
            <h3 id={headingId} className="text-base font-semibold text-text">
              {round.name}
            </h3>
            <ul className="flex flex-col gap-3">
              {round.matches.map((match) => {
                const sides = participants(match);
                const completed = isCompleted(match);
                const homeName = memberTeamName(members, match.home_member_id);
                const awayName = memberTeamName(members, match.away_member_id);
                return (
                  <li
                    key={match.id}
                    className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                      {playoffMatchLabel(match, matches)}
                    </p>
                    <div className="flex flex-col gap-2">
                      <Slot
                        match={match}
                        side="home"
                        matches={matches}
                        members={members}
                        currentMemberId={currentMemberId}
                      />
                      <Slot
                        match={match}
                        side="away"
                        matches={matches}
                        members={members}
                        currentMemberId={currentMemberId}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusPill tone={matchTone(match)}>
                        {isPlayable(match) ? matchStatusLabel(match.status) : "Waiting"}
                      </StatusPill>
                      {completed && match.winner_remaining !== null && (
                        <span className="text-muted">
                          {match.winner_remaining} left standing
                        </span>
                      )}
                    </div>

                    {isCommissioner && sides && (
                      <div className="flex max-w-full flex-wrap gap-2">
                        {completed ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onEdit(match)}
                            aria-label={`Edit result: ${homeName} vs ${awayName}, ${playoffMatchLabel(match, matches)}`}
                          >
                            Edit result
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="max-w-full"
                              disabled={busy}
                              onClick={() => onReport(match, sides.home)}
                              aria-label={`${homeName} won`}
                            >
                              <span className="min-w-0 truncate">{homeName}</span>
                              <span className="shrink-0">won</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="max-w-full"
                              disabled={busy}
                              onClick={() => onReport(match, sides.away)}
                              aria-label={`${awayName} won`}
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
              {round.byes.map((bye) => (
                <ByeRow
                  key={`bye-${bye.memberId}`}
                  bye={bye}
                  members={members}
                  currentMemberId={currentMemberId}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
