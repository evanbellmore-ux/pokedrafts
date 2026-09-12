"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ListOrdered,
  Play,
  Trophy,
  Users,
} from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import { ButtonLink, StatusPill } from "@/app/components/ui";
import {
  eliminationRoundName,
  isInBracket,
  nextPlayoffMatchFor,
  playoffMatchLabel,
  regularSeasonComplete,
  slotInfo,
} from "@/app/lib/league/bracket";
import { totalDraftPicks } from "@/app/lib/league/draft";
import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import type { LeagueStanding } from "@/app/types/league";
import {
  nextMatchFor,
  onClockMember,
  opponentId,
  type OverviewMatch,
  type OverviewMember,
} from "./overview";
import {
  draftingMembers,
  leaguePhase,
  PHASE_PILL,
  rankPhrase,
} from "./season";

export type OverviewStatusCardProps = {
  members: OverviewMember[];
  matches: OverviewMatch[];
  /** Rows from `league_standings`; empty before the draft is complete. */
  standings: LeagueStanding[];
};

type Step = {
  icon: typeof Users;
  title: string;
  detail: string;
  done: boolean;
  action: ReactNode;
};

function SetupSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-4 flex flex-col gap-3">
      {steps.map((step) => {
        const Icon = step.done ? Check : step.icon;
        return (
          <li
            key={step.title}
            className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  step.done
                    ? "bg-success-soft text-success"
                    : "bg-accent-soft text-accent-text"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-text">
                  {step.done && <span className="sr-only">Done: </span>}
                  {step.title}
                </p>
                <p className="text-sm text-muted">{step.detail}</p>
              </div>
            </div>
            {step.action && <div className="shrink-0">{step.action}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-bg p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-text">{children}</dd>
    </div>
  );
}

/**
 * Phase-aware status card with the next action: setup checklist, the pick
 * on the clock during the draft, the coach's record and next match during
 * the season, their playoff match (or the round they went out in) during
 * the playoffs, and the champion once the season is complete.
 */
export default function OverviewStatusCard({
  members,
  matches,
  standings,
}: OverviewStatusCardProps) {
  const { league, member, isCommissioner } = useLeague();
  const base = `/leagues/${league.id}`;
  const phase = leaguePhase(league, matches);
  const pill = PHASE_PILL[phase];

  let heading: string;
  let body: ReactNode;

  if (phase === "setup") {
    const drafting = draftingMembers(members);
    heading = "Get the league ready";
    const steps: Step[] = [
      {
        icon: Users,
        title: "Invite coaches",
        detail: `${members.length} of ${league.max_coaches} coaches have joined.`,
        done: members.length >= 2,
        action: isCommissioner ? (
          <ButtonLink href="#invite" variant="secondary" size="sm">
            Invite coaches
          </ButtonLink>
        ) : null,
      },
      {
        icon: ListOrdered,
        title: "Set the draft order",
        detail:
          drafting.length > 0
            ? `${pluralize(drafting.length, "coach", "coaches")} in the draft order.`
            : isCommissioner
              ? "No draft order yet. Coaches without a slot watch as spectators."
              : "The commissioner has not set the draft order yet.",
        done: drafting.length >= 2,
        action: isCommissioner ? (
          <ButtonLink href={`${base}/settings`} variant="secondary" size="sm">
            Set the draft order
          </ButtonLink>
        ) : null,
      },
      {
        icon: Play,
        title: "Open the draft room",
        detail: isCommissioner
          ? "Start the draft from the draft room once everyone is in."
          : "The commissioner starts the draft from the draft room.",
        done: false,
        action: (
          <ButtonLink href={`${base}/draft`} size="sm">
            Open the draft room
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        ),
      },
    ];
    body = <SetupSteps steps={steps} />;
  } else if (phase === "drafting") {
    const drafting = draftingMembers(members);
    const onClock = onClockMember(league, drafting);
    const pick = league.current_pick_number ?? 1;
    const total = totalDraftPicks(drafting.length, league.picks_per_team ?? 0);
    const paused = Boolean(league.draft_paused_at);
    heading = "Draft in progress";
    body = (
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-2xl font-bold text-text">
            Pick #{pick}
            {onClock
              ? onClock.id === member.id
                ? ", you are on the clock"
                : `, ${teamNameLabel(onClock.team_name)} is on the clock`
              : ""}
          </p>
          <p className="mt-1 text-sm text-muted">
            {total > 0 ? `${pluralize(total, "pick")} in total.` : ""}
            {paused ? " The draft is paused." : ""}
          </p>
        </div>
        <ButtonLink href={`${base}/draft`}>
          Draft room
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ButtonLink>
      </div>
    );
  } else {
    const mine = standings.find((row) => row.member_id === member.id) ?? null;
    const complete = phase === "complete";
    const playoffs = phase === "playoffs";
    const seeded = regularSeasonComplete(matches);
    const teamName = (memberId: string | null) =>
      teamNameLabel(members.find((row) => row.id === memberId)?.team_name ?? null);
    const championName = league.champion_member_id
      ? teamName(league.champion_member_id)
      : null;
    const youWon = league.champion_member_id === member.id;
    heading = complete
      ? "Season complete"
      : playoffs
        ? "Playoffs underway"
        : "Season underway";

    let situation: ReactNode;
    if (complete) {
      situation = (
        <>
          <span className="wrap-anywhere text-lg font-semibold">Champion: {championName}</span>
          <span className="mt-1 block text-sm text-muted">
            {youWon ? "You won the championship!" : "Congratulations to the champion."}
          </span>
        </>
      );
    } else if (playoffs) {
      const next = nextPlayoffMatchFor(matches, member.id);
      const eliminated = eliminationRoundName(matches, member.id);
      if (next) {
        const side = next.home_member_id === member.id ? "away" : "home";
        const slot = slotInfo(next, side, matches);
        situation = (
          <>
            <span className="wrap-anywhere text-lg font-semibold">
              {slot.kind === "member"
                ? `vs ${teamName(slot.memberId)}`
                : slot.kind === "winner_of"
                  ? `vs Winner of ${playoffMatchLabel(slot.feeder, matches)}`
                  : "Bye"}
            </span>
            <span className="ml-2 text-sm text-muted">
              {playoffMatchLabel(next, matches)}
            </span>
          </>
        );
      } else if (eliminated) {
        situation = (
          <span className="text-lg font-semibold">Eliminated in the {eliminated}</span>
        );
      } else if (!isInBracket(matches, member.id)) {
        situation = (
          <span className="text-sm text-muted">
            You did not make the playoffs this season.
          </span>
        );
      } else {
        situation = (
          <span className="text-sm text-muted">Every playoff match is played.</span>
        );
      }
    } else {
      const next = nextMatchFor(matches, member.id);
      const opponent = next ? teamName(opponentId(next, member.id)) : null;
      situation =
        next && opponent ? (
          <>
            <span className="wrap-anywhere text-lg font-semibold">vs {opponent}</span>
            <span className="ml-2 text-sm text-muted">
              Round {next.round_number},{" "}
              {next.home_member_id === member.id ? "home" : "away"}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted">
            {matches.length === 0
              ? isCommissioner
                ? "No schedule yet. Generate one on the Matches page."
                : "The commissioner has not generated the schedule yet."
              : seeded
                ? "Every regular-season match has been played."
                : "No upcoming matches for you."}
          </span>
        );
    }

    body = (
      <>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Stat label={seeded ? "Final record" : "Your record"}>
            {mine ? (
              <>
                <span className="text-2xl font-bold">
                  {mine.wins}-{mine.losses}
                </span>
                <span className="ml-2 text-sm text-muted">
                  {seeded
                    ? `Seed ${mine.seed} of ${standings.length}`
                    : mine.played > 0
                      ? `Currently ${rankPhrase(mine.rank, mine.tied)} of ${standings.length}`
                      : "No results yet"}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted">
                You are not in this season&apos;s schedule.
              </span>
            )}
          </Stat>
          <Stat label={complete ? "Champion" : playoffs ? "Playoffs" : "Next match"}>
            {situation}
          </Stat>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {playoffs || complete ? (
            <ButtonLink
              href={`${base}/matches#playoffs`}
              variant={complete ? "secondary" : "primary"}
            >
              View bracket
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          ) : (
            <ButtonLink href={`${base}/matches`}>
              Matches
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          )}
          <ButtonLink
            href={`${base}/standings`}
            variant={complete ? "primary" : "secondary"}
          >
            <Trophy className="h-4 w-4" aria-hidden="true" />
            Standings
          </ButtonLink>
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby="league-status-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="league-status-heading" className="text-lg font-semibold text-text">
          {heading}
        </h2>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>
      {body}
    </section>
  );
}
