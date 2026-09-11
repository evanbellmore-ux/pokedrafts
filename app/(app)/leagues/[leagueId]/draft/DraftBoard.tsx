"use client";

import { memo } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { EmptyState, StatusPill } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { BoardRound } from "./draft-room";

export type DraftBoardProps = {
  board: BoardRound[];
  /** Gate the empty-state copy until the first load has finished. */
  loading: boolean;
  className?: string;
};

/**
 * Every pick so far, grouped by round with the newest round (and the newest
 * pick inside it) first, inside a bounded scroll region so a long draft never
 * pushes the page height.
 */
const DraftBoard = memo(function DraftBoard({
  board,
  loading,
  className = "",
}: DraftBoardProps) {
  return (
    <section
      aria-labelledby="draft-board-heading"
      className={`flex flex-col rounded-xl border border-line bg-panel p-4 ${className}`.trim()}
    >
      <h2 id="draft-board-heading" className="text-lg font-bold text-text">
        Draft board
      </h2>

      <div className="mt-3 max-h-[32rem] overflow-y-auto pr-1 [scrollbar-width:thin]">
        {board.length === 0 ? (
          !loading && (
            <EmptyState
              title="No picks yet"
              description="Picks show up here as coaches make them, newest first."
            />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {board.map((round) => (
              <section key={round.round} aria-labelledby={`board-round-${round.round}`}>
                <h3
                  id={`board-round-${round.round}`}
                  className="text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  Round {round.round}
                </h3>
                <ol className="mt-2 flex flex-col gap-2">
                  {round.entries.map((entry) => (
                    <li
                      key={entry.pickNumber}
                      className="flex items-center gap-3 rounded-lg border border-line bg-bg p-2.5"
                    >
                      <span className="w-9 shrink-0 text-xs font-bold tabular-nums text-muted">
                        #{entry.pickNumber}
                      </span>
                      {entry.pick ? (
                        <>
                          <PokemonSprite name={entry.pick.pokemon_name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-text">
                              {entry.pick.pokemon_name}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {teamNameLabel(entry.coach?.team_name)}
                            </p>
                            <PokemonTypes name={entry.pick.pokemon_name} className="mt-1" />
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                            {entry.pick.points}
                            <span className="text-xs font-normal text-muted"> pts</span>
                          </span>
                        </>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                          <p className="truncate text-xs text-muted">
                            {teamNameLabel(entry.coach?.team_name)}
                          </p>
                          <StatusPill tone="neutral">Skipped</StatusPill>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

export default DraftBoard;
