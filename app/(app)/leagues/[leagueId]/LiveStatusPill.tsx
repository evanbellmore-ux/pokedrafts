import { Radio, RefreshCw, WifiOff } from "lucide-react";
import { StatusPill, type StatusTone } from "@/app/components/ui";

/** Realtime channel state as seen by a page (docs section 7). */
export type LiveStatus = "connecting" | "live" | "reconnecting";

const STYLES: Record<
  LiveStatus,
  { tone: StatusTone; label: string; icon: typeof Radio; spin?: boolean }
> = {
  connecting: { tone: "neutral", label: "Connecting", icon: RefreshCw, spin: true },
  live: { tone: "success", label: "Live", icon: Radio },
  reconnecting: { tone: "warning", label: "Reconnecting", icon: WifiOff },
};

/**
 * Small pill announcing whether live updates are flowing. It is the page's
 * live region, and a `role="status"` region announces its content when it
 * changes (an `aria-label` would not be read then), so a visually hidden
 * "Live updates: " prefix gives every announcement a subject: "Live updates:
 * Reconnecting" instead of a bare "Reconnecting". Same prefix as the draft
 * room's `LivePill` (docs section 8.4); the visible pill is unchanged.
 */
export default function LiveStatusPill({ status }: { status: LiveStatus }) {
  const style = STYLES[status];
  const Icon = style.icon;
  return (
    <span role="status">
      <StatusPill tone={style.tone}>
        <Icon
          aria-hidden="true"
          className={`h-3 w-3 ${style.spin ? "animate-spin" : ""}`.trim()}
        />
        <span className="sr-only">Live updates: </span>
        {style.label}
      </StatusPill>
    </span>
  );
}
