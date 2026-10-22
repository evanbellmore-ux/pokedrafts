import { Trophy } from "lucide-react";
import type { LeagueStatus } from "@/app/lib/watch/watch-view";

const lineClass = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-text";

/**
 * A league's one status line, like the dashboard cards': a dot (pulsing
 * while something is live) or a trophy, the label, and a muted detail. A
 * span (laid out as a flex row), so it can also sit inside PageHeader's
 * description paragraph; `size="sm"` there, the cards' small print elsewhere.
 */
export default function WatchStatusLine({
  status,
  size = "xs",
  className = "",
}: {
  status: LeagueStatus;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span className={`${lineClass} ${size === "sm" ? "text-sm" : "text-xs"} ${className}`.trim()}>
      {status.tone === "live" ? (
        <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      ) : status.tone === "champion" ? (
        <Trophy className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${
            status.tone === "paused" ? "bg-warning" : status.tone === "season" ? "bg-accent" : "bg-faint"
          }`}
        />
      )}
      <span>{status.label}</span>
      {status.detail && <span className="wrap-anywhere text-muted">{status.detail}</span>}
    </span>
  );
}
