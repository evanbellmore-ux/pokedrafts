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
    // One strip split by hairlines (the gap shows the bg-line behind the
    // cells) rather than a row of separate boxes.
    <dl
      className={`grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line ${className}`.trim()}
      aria-busy={loading || undefined}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-panel px-3 py-3 sm:px-4">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text sm:text-xl">
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
