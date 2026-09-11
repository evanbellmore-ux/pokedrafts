import { StatusPill } from "@/app/components/ui";
import { pluralize, scheduleFormatLabel, teamNameLabel } from "@/app/lib/league/labels";
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

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-bg px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-text">{value}</dd>
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
        <h2 id="summary-heading" className="text-lg font-semibold text-text">
          League settings
        </h2>
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
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
        <h2 id="order-summary-heading" className="text-lg font-semibold text-text">
          Draft order
        </h2>
        {drafting.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            The commissioner has not set the draft order yet.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-2">
            {drafting.map((member, index) => (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2"
              >
                <span className="w-8 shrink-0 text-center text-sm font-semibold text-accent-text">
                  #{index + 1}
                </span>
                <span className="min-w-0 truncate font-semibold text-text">
                  {teamNameLabel(member.team_name)}
                </span>
                {member.user_id === currentUserId && (
                  <StatusPill tone="accent">You</StatusPill>
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
