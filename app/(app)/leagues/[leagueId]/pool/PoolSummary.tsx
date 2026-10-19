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
    <section aria-label="Draft pool summary">
      <p className="text-sm text-muted">{poolSourceText(pool, formatName)}</p>

      {/* One strip split by hairlines, like the roster numbers. */}
      <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div className="min-w-0 bg-panel px-3 py-3 sm:px-4">
          <dt className="text-xs text-muted">Pokémon</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text sm:text-xl">{count}</dd>
        </div>
        <div className="min-w-0 bg-panel px-3 py-3 sm:px-4">
          <dt className="text-xs text-muted">Needed to start</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text sm:text-xl">
            {required}
          </dd>
          <dd className="mt-0.5 text-xs text-muted">
            {draftingCoaches > 0
              ? `${pluralize(seats, "drafting coach", "drafting coaches")} × ${pluralize(picks, "pick")}`
              : `up to ${pluralize(seats, "coach", "coaches")} × ${pluralize(picks, "pick")}`}
          </dd>
        </div>
        <div className="min-w-0 bg-panel px-3 py-3 sm:px-4">
          <dt className="text-xs text-muted">Point budget</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text sm:text-xl">
            {budget}
          </dd>
          <dd className="mt-0.5 text-xs text-muted">per team</dd>
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
