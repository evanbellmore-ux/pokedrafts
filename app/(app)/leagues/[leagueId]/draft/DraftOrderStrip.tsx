"use client";

import { memo } from "react";
import { StatusPill } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { LeagueMember } from "@/app/types/league";
import { getRoundOrder, type TeamBudget } from "./draft-room";

export type DraftOrderStripProps = {
  coaches: LeagueMember[];
  round: number;
  onClockId: string | null;
  nextUpId: string | null;
  nextUpName: string | null;
  myId: string;
  budgets: Map<string, TeamBudget>;
  /** Highlights are only meaningful while the draft is running. */
  draftLive: boolean;
};

/**
 * The drafting coaches in the order they pick this round (reversed on even
 * rounds, snake style), with the coach on the clock and the next pick
 * highlighted. Scrolls sideways on narrow screens.
 */
const DraftOrderStrip = memo(function DraftOrderStrip({
  coaches,
  round,
  onClockId,
  nextUpId,
  nextUpName,
  myId,
  budgets,
  draftLive,
}: DraftOrderStripProps) {
  if (coaches.length === 0) return null;

  const order = getRoundOrder(coaches, round);

  return (
    <section aria-labelledby="draft-order-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="draft-order-heading" className="text-sm font-semibold text-text">
          {draftLive ? `Round ${round} order` : "Draft order"}
        </h2>
        {draftLive && nextUpName && (
          <p className="text-xs text-muted">
            Next up: <span className="font-semibold text-text">{nextUpName}</span>
          </p>
        )}
      </div>

      <ol
        aria-label={draftLive ? `Pick order for round ${round}` : "Draft order"}
        className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {order.map((coach, index) => {
          const current = draftLive && coach.id === onClockId;
          const next = draftLive && !current && coach.id === nextUpId;
          const remaining = budgets.get(coach.id)?.remaining;
          const isMe = coach.id === myId;

          return (
            <li
              key={coach.id}
              aria-current={current ? "true" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                current
                  ? "border-accent-border bg-accent-soft text-accent-text"
                  : next
                    ? "border-line-strong bg-panel text-text"
                    : "border-line bg-panel text-muted"
              }`}
            >
              <span className="text-xs font-bold tabular-nums">{index + 1}</span>
              <span className="max-w-[10rem] truncate font-medium">
                {teamNameLabel(coach.team_name)}
                {isMe && <span className="font-normal"> (you)</span>}
              </span>
              {remaining !== undefined && (
                <span className="text-xs tabular-nums">{remaining} pts</span>
              )}
              {current && <StatusPill tone="accent">On the clock</StatusPill>}
              {next && <StatusPill tone="neutral">Next</StatusPill>}
            </li>
          );
        })}
      </ol>
    </section>
  );
});

export default DraftOrderStrip;
