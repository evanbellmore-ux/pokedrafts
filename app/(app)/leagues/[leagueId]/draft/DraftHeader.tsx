"use client";

import { memo } from "react";
import { Eye, Radio, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { StatusPill, type StatusTone } from "@/app/components/ui";
import { formatCountdown, URGENT_SECONDS, type DraftPhase, type TeamBudget } from "./draft-room";
import type { LiveStatus } from "./useDraftRoom";

const LIVE_STYLES: Record<
  LiveStatus,
  { tone: StatusTone; label: string; icon: typeof Radio; spin?: boolean }
> = {
  connecting: { tone: "neutral", label: "Connecting", icon: RefreshCw, spin: true },
  live: { tone: "success", label: "Live", icon: Radio },
  reconnecting: { tone: "warning", label: "Reconnecting", icon: WifiOff },
};

/**
 * Pill showing whether live updates are flowing. Not a live region on
 * purpose: `DraftStatusBanner` is the room's one announcement for a dropped
 * channel (docs section 8.4), so this reads as "Live updates: Live" only
 * when a screen reader lands on it.
 */
export function LivePill({ status }: { status: LiveStatus }) {
  const style = LIVE_STYLES[status];
  const Icon = style.icon;
  return (
    <StatusPill tone={style.tone}>
      <Icon
        aria-hidden="true"
        className={`h-3 w-3 ${style.spin ? "animate-spin" : ""}`.trim()}
      />
      <span className="sr-only">Live updates: </span>
      {style.label}
    </StatusPill>
  );
}

/**
 * Explains a dropped channel under the header. A plain notice rather than an
 * `Alert`: `variant="warning"` is `role="alert"`, and the status banner
 * already announces "Reconnecting...", so a second live region would read
 * the same event twice.
 */
export function ReconnectNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-text">
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Reconnecting...</p>
        <p className="mt-0.5 text-muted">
          Live updates are interrupted. The room refreshes on its own every 10
          seconds while the draft is running.
        </p>
      </div>
    </div>
  );
}

/** Shown to coaches without a draft position. */
export function SpectatorPill() {
  return (
    <StatusPill tone="neutral">
      <Eye aria-hidden="true" className="h-3 w-3" />
      You are watching this draft
    </StatusPill>
  );
}

const CARD = "rounded-xl border border-line bg-panel px-4 py-3";
const CARD_LABEL = "text-xs font-semibold uppercase tracking-wide text-muted";

export type DraftTimerProps = {
  phase: DraftPhase;
  secondsLeft: number | null;
  pickTimerSeconds: number;
  clockSynced: boolean;
  /** `leagues.auto_pick_in_progress`: a server-side auto-pick is under way. */
  autoPickInProgress: boolean;
  autoPickError: string | null;
  /** True for the coach on the clock; only they are told to "Pick now!". */
  isMyTurn: boolean;
};

/**
 * The pick countdown. The number itself is `aria-live="off"` (a value that
 * changes every second must not be announced); the status banner carries
 * the announcements instead. The urgency colour shows everyone the clock is
 * nearly out; the "Pick now!" prompt is only for the coach who has to act.
 */
export const DraftTimer = memo(function DraftTimer({
  phase,
  secondsLeft,
  pickTimerSeconds,
  clockSynced,
  autoPickInProgress,
  autoPickError,
  isMyTurn,
}: DraftTimerProps) {
  const running = phase === "live";
  const urgent = running && secondsLeft !== null && secondsLeft < URGENT_SECONDS;

  let display: string;
  let detail: string;
  if (phase === "completed") {
    display = "Done";
    detail = "The draft is over.";
  } else if (phase === "setup") {
    display = formatCountdown(pickTimerSeconds);
    detail = "Per pick, once the draft starts.";
  } else if (secondsLeft === null) {
    display = "—";
    detail = "Waiting for the clock.";
  } else {
    display = formatCountdown(secondsLeft);
    detail =
      phase === "paused"
        ? "Paused"
        : secondsLeft === 0 || autoPickInProgress
          ? "Time is up. Auto-picking..."
          : urgent && isMyTurn
            ? "Pick now!"
            : `${pickTimerSeconds}s per pick`;
  }

  return (
    <div
      className={
        urgent
          ? "rounded-xl border border-danger/50 bg-danger-soft px-4 py-3"
          : CARD
      }
    >
      <p className={CARD_LABEL}>Pick timer</p>
      <p
        aria-live="off"
        className={`mt-1 text-3xl font-bold tabular-nums ${
          urgent ? "text-danger" : "text-text"
        }`}
      >
        {display}
      </p>
      <p className={`mt-0.5 text-xs ${urgent ? "text-danger" : "text-muted"}`}>
        {detail}
      </p>
      {!clockSynced && phase !== "setup" && phase !== "completed" && (
        <p className="mt-1 text-xs text-warning">Using your device clock.</p>
      )}
      {autoPickError && (
        <p className="mt-1 text-xs text-danger">Auto-pick failed: {autoPickError}</p>
      )}
    </div>
  );
});

export type DraftHeaderProps = {
  phase: DraftPhase;
  round: number;
  currentPick: number;
  totalPicks: number;
  picksMade: number;
  onClockName: string | null;
  myBudget: TeamBudget | null;
  timer: DraftTimerProps;
};

/** Round / pick, picks made, timer and (for drafting coaches) budget cards. */
export const DraftHeader = memo(function DraftHeader({
  phase,
  round,
  currentPick,
  totalPicks,
  picksMade,
  onClockName,
  myBudget,
  timer,
}: DraftHeaderProps) {
  const showPick = phase === "live" || phase === "paused";

  return (
    <div
      className={`grid grid-cols-2 gap-3 ${
        myBudget ? "lg:grid-cols-4" : "lg:grid-cols-3"
      }`}
    >
      <div className={CARD}>
        <p className={CARD_LABEL}>{showPick ? "On the clock" : "Status"}</p>
        <p className="mt-1 truncate text-lg font-bold text-text">
          {phase === "setup"
            ? "Not started"
            : phase === "completed"
              ? "Complete"
              : (onClockName ?? "Nobody")}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {showPick
            ? `Round ${round} · Pick ${Math.min(currentPick, totalPicks)} of ${totalPicks}`
            : phase === "setup"
              ? "Waiting for the commissioner"
              : `${totalPicks} picks were made`}
        </p>
      </div>

      <div className={CARD}>
        <p className={CARD_LABEL}>Picks made</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-text">
          {picksMade}
          <span className="text-base font-semibold text-muted"> / {totalPicks}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {Math.max(0, totalPicks - picksMade)} to go
        </p>
      </div>

      <DraftTimer {...timer} />

      {myBudget && (
        <div className={CARD}>
          <p className={CARD_LABEL}>Your budget</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-text">
            {myBudget.remaining}
            <span className="text-base font-semibold text-muted">
              {" "}
              / {myBudget.budget}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {myBudget.spent} spent · {myBudget.slotsLeft}{" "}
            {myBudget.slotsLeft === 1 ? "slot" : "slots"} open
          </p>
        </div>
      )}
    </div>
  );
});

export type DraftStatusBannerProps = {
  live: LiveStatus;
  phase: DraftPhase;
  isMyTurn: boolean;
  onClockName: string | null;
};

/**
 * The announced state of the room (docs section 8.4): a `role="status"`
 * region separate from the countdown so screen readers hear "You are on the
 * clock" without hearing every tick. It is also the only live region for a
 * dropped channel; `LivePill` and `ReconnectNotice` stay silent.
 */
export function DraftStatusBanner({
  live,
  phase,
  isMyTurn,
  onClockName,
}: DraftStatusBannerProps) {
  let text: string;
  let className: string;

  if (live === "reconnecting") {
    text = "Reconnecting...";
    className = "border-warning/50 bg-warning-soft text-warning";
  } else if (phase === "setup") {
    text = "Waiting for the commissioner to start the draft.";
    className = "border-line bg-panel text-muted";
  } else if (phase === "completed") {
    text = "The draft is complete.";
    className = "border-success/50 bg-success-soft text-success";
  } else if (phase === "paused") {
    text = "Draft paused";
    className = "border-warning/50 bg-warning-soft text-warning";
  } else if (isMyTurn) {
    text = "You are on the clock";
    className = "border-accent-border bg-accent-soft text-accent-text";
  } else {
    text = `Waiting for ${onClockName ?? "the next coach"}`;
    className = "border-line bg-panel text-muted";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border px-4 py-3 text-sm font-semibold ${className}`}
    >
      {text}
    </div>
  );
}
