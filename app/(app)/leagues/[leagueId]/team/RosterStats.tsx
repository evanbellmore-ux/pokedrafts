import type { ReactNode } from "react";
import { Skeleton } from "@/app/components/ui";

export type RosterStat = {
  label: string;
  value: ReactNode;
  /** Small line under the value, e.g. "of 100". */
  hint?: ReactNode;
};

export type RosterStatsProps = {
  items: RosterStat[];
  /** Replaces the values with skeletons while the rosters load. */
  loading?: boolean;
  className?: string;
};

/** Three-up strip of roster numbers (points used, slots, swaps). */
export default function RosterStats({
  items,
  loading = false,
  className = "",
}: RosterStatsProps) {
  return (
    <dl
      className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${className}`.trim()}
      aria-busy={loading || undefined}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-line bg-panel px-4 py-3"
        >
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            {item.label}
          </dt>
          <dd className="mt-1 text-xl font-bold tabular-nums text-text">
            {loading ? <Skeleton className="h-7 w-20" /> : item.value}
          </dd>
          {item.hint && !loading && (
            <dd className="mt-0.5 text-xs text-muted">{item.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
