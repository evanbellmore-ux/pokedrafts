import { Lock, TriangleAlert } from "lucide-react";
import { StatusPill } from "@/app/components/ui";
import { pluralize } from "@/app/lib/league/labels";
import type { League } from "@/app/types/league";
import {
  cheapestFullTeam,
  draftingSeats,
  picksPerTeam,
  pointBudget,
  requiredPoolSize,
  type LeaguePoolInfo,
} from "../leaguePool";

export type PoolSummaryProps = {
  league: League;
  pool: LeaguePoolInfo;
  /** Name of `league.draft_format_id`, when it could be read. */
  formatName: string | null;
  /** Coaches with a draft position. */
  draftingCoaches: number;
};

export function poolSourceText(
  pool: LeaguePoolInfo,
  formatName: string | null
): string {
  if (!pool.pool) return "No pool yet, choose a draft format in Settings.";
  if (pool.mirrorsFormat) {
    return formatName
      ? `Mirrors the format ${formatName}.`
      : "Mirrors the league's draft format.";
  }
  return "Customised for this league.";
}

/**
 * Where the pool comes from and whether `start_draft` would accept it:
 * enough Pokémon for every drafting coach, and a cheapest full team that
 * fits the point budget.
 */
export default function PoolSummary({
  league,
  pool,
  formatName,
  draftingCoaches,
}: PoolSummaryProps) {
  const count = pool.pokemon.length;
  const seats = draftingSeats(league, draftingCoaches);
  const picks = picksPerTeam(league);
  const required = requiredPoolSize(league, draftingCoaches);
  const budget = pointBudget(league);
  const cheapest = cheapestFullTeam(pool.pokemon, picks);
  const short = Math.max(0, required - count);
  const overBudget = cheapest !== null && cheapest > budget;
  const locked = Boolean(league.draft_started);

  return (
    <section
      aria-label="Draft pool summary"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <p className="text-sm text-text">{poolSourceText(pool, formatName)}</p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-bg p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pokémon
          </dt>
          <dd className="mt-1 text-2xl font-bold text-text">{count}</dd>
        </div>
        <div className="rounded-lg border border-line bg-bg p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Needed to start
          </dt>
          <dd className="mt-1">
            <span className="text-2xl font-bold text-text">{required}</span>
            <span className="ml-2 text-xs text-muted">
              {draftingCoaches > 0
                ? `${pluralize(seats, "drafting coach", "drafting coaches")} × ${pluralize(picks, "pick")}`
                : `up to ${pluralize(seats, "coach", "coaches")} × ${pluralize(picks, "pick")}`}
            </span>
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-bg p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Point budget
          </dt>
          <dd className="mt-1">
            <span className="text-2xl font-bold text-text">{budget}</span>
            <span className="ml-2 text-xs text-muted">per team</span>
          </dd>
        </div>
      </dl>

      {(locked || short > 0 || overBudget) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {locked && (
            <StatusPill tone="warning">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Locked, the draft has started
            </StatusPill>
          )}
          {short > 0 && (
            <StatusPill tone="warning">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              Short by {pluralize(short, "Pokémon", "Pokémon")}
            </StatusPill>
          )}
          {overBudget && (
            <StatusPill tone="warning">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              Cheapest full team costs {cheapest}, over the budget
            </StatusPill>
          )}
        </div>
      )}
    </section>
  );
}
