import TeamAvatar from "@/app/components/TeamAvatar";
import {
  playoffFormatLabel,
  pluralize,
  scheduleFormatLabel,
  teamNameLabel,
  tiebreakerLabel,
} from "@/app/lib/league/labels";
import { CREATE_LEAGUE_DEFAULTS } from "@/app/lib/league/limits";
import type { League } from "@/app/types/league";
import {
  formatName,
  positionedMembers,
  spectatorMembers,
  timerLabel,
  type FormatOption,
  type SettingsMember,
} from "./helpers";

type SettingsSummaryProps = {
  league: League;
  members: SettingsMember[];
  formats: FormatOption[];
  currentUserId: string;
};

/** A setting as a ruled row: label left, value right (stacked on phones). */
function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t border-line py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-text sm:text-right">{value}</dd>
    </div>
  );
}

/** Read-only view of the league settings for coaches. */
export default function SettingsSummary({
  league,
  members,
  formats,
  currentUserId,
}: SettingsSummaryProps) {
  const commissioner = members.find(
    (member) => member.user_id === league.commissioner_id
  );
  const drafting = positionedMembers(members);
  const spectators = spectatorMembers(members);
  const draftFormat = formatName(formats, league.draft_format_id);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="summary-heading"
        className="rounded-xl border border-line bg-panel p-5"
      >
        <h2 id="summary-heading" className="text-base font-semibold text-text">
          League settings
        </h2>
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-8 sm:grid-cols-2">
          <Item label="League name" value={league.name} />
          <Item
            label="Commissioner"
            value={commissioner ? teamNameLabel(commissioner.team_name) : "Unknown"}
          />
          <Item label="Coaches" value={`${members.length} of ${league.max_coaches}`} />
          <Item
            label="Point budget"
            value={`${league.point_budget ?? CREATE_LEAGUE_DEFAULTS.pointBudget} points`}
          />
          <Item
            label="Picks per team"
            value={String(league.picks_per_team ?? CREATE_LEAGUE_DEFAULTS.picksPerTeam)}
          />
          <Item label="Pick timer" value={timerLabel(league.pick_timer_seconds)} />
          <Item
            label="Free agent swap limit"
            value={
              league.free_agent_swap_limit === 0
                ? "Off"
                : pluralize(league.free_agent_swap_limit, "swap")
            }
          />
          <Item label="Matchup format" value={scheduleFormatLabel(league.schedule_format)} />
          <Item label="Tiebreaker" value={tiebreakerLabel(league.tiebreaker)} />
          <Item label="Playoff format" value={playoffFormatLabel(league.playoff_format)} />
          <Item
            label="Draft format"
            value={
              draftFormat ??
              (league.draft_format_id ? "Format no longer available" : "None")
            }
          />
        </dl>
      </section>

      <section
        aria-labelledby="order-summary-heading"
        className="rounded-xl border border-line bg-panel p-5"
      >
        <h2 id="order-summary-heading" className="text-base font-semibold text-text">
          Draft order
        </h2>
        {drafting.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            The commissioner has not set the draft order yet.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-t border-line">
            {drafting.map((member, index) => (
              <li key={member.id} className="flex items-center gap-3 py-2.5">
                <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted">
                  {index + 1}
                </span>
                <TeamAvatar
                  name={member.team_name}
                  mine={member.user_id === currentUserId}
                  size="sm"
                />
                <span className="min-w-0 truncate font-medium text-text">
                  {teamNameLabel(member.team_name)}
                </span>
                {member.user_id === currentUserId && (
                  <span className="shrink-0 text-xs font-medium text-accent-text">You</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {spectators.length > 0 && drafting.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Watching as spectators:{" "}
            {spectators.map((member) => teamNameLabel(member.team_name)).join(", ")}.
          </p>
        )}
      </section>
    </div>
  );
}
