"use client";

import { memo } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { EmptyState, StatusPill } from "@/app/components/ui";
import { pointsUnit, teamNameLabel } from "@/app/lib/league/labels";
import type { PublicPokemonInfo } from "@/app/types/league";
import type { BoardRound } from "./draft-room";

export type DraftBoardProps = {
  board: BoardRound[];
  /** Gate the empty-state copy until the first load has finished. */
  loading: boolean;
  /**
   * Sprites and types by Pokémon name, for pages a signed-out visitor sees
   * (the public watch page): the dex those lookups use needs a session.
   */
  pokemon?: Readonly<Record<string, PublicPokemonInfo>>;
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
  pokemon,
  className = "",
}: DraftBoardProps) {
  return (
    <section
      aria-labelledby="draft-board-heading"
      className={`flex flex-col rounded-xl border border-line bg-panel p-4 ${className}`.trim()}
    >
      <h2 id="draft-board-heading" className="text-base font-semibold text-text">
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
                  className="text-xs font-medium text-muted"
                >
                  Round {round.round}
                </h3>
                <ol className="mt-1 divide-y divide-line">
                  {round.entries.map((entry) => {
                    const info = entry.pick ? pokemon?.[entry.pick.pokemon_name] : undefined;
                    return (
                      <li
                        key={entry.pickNumber}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-muted">
                          #{entry.pickNumber}
                        </span>
                        {entry.pick ? (
                          <>
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg/70 ring-1 ring-line">
                              <PokemonSprite
                                name={entry.pick.pokemon_name}
                                src={info?.sprite_url ?? undefined}
                                size="fill"
                                bare
                                className="scale-110"
                              />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-text">
                                {entry.pick.pokemon_name}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {teamNameLabel(entry.coach?.team_name)}
                              </p>
                              <PokemonTypes
                                name={entry.pick.pokemon_name}
                                types={info?.type1 ? { type1: info.type1, type2: info.type2 } : undefined}
                                className="mt-1"
                              />
                            </div>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                              {entry.pick.points}
                              <span className="text-xs font-normal text-muted"> {pointsUnit(entry.pick.points)}</span>
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
                    );
                  })}
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
