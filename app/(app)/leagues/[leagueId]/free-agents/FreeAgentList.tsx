"use client";

import { useId, useState, type ReactNode } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import {
  Button,
  EmptyState,
  SkeletonLines,
  TableWrap,
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui";
import type { DraftPokemon } from "@/app/types/draft";
import { useMinWidthMd } from "../useMinWidthMd";

/** Rows rendered before "Show more"; a pool can hold 2000 entries. */
const PAGE_SIZE = 60;

export type FreeAgentListProps = {
  items: DraftPokemon[];
  /**
   * Changes when the user starts a new search; the list goes back to its
   * first page then, but not when a reload merely refreshes `items`.
   */
  resetKey: string;
  /** Why an entry cannot be added right now (shown next to the button). */
  blockerFor: (entry: DraftPokemon) => string | null;
  onAdd: (entry: DraftPokemon) => void;
  /** Name of the entry whose availability is being re-checked. */
  preparing: string | null;
  /** True while any move is in flight; every Add button is disabled. */
  busy: boolean;
  loading: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
};

/**
 * Free agents as a table inside `TableWrap` from `md` up and card rows
 * below it (docs section 8.5). Only one of the two is mounted, through
 * `useMinWidthMd`, so the reason ids stay unique. Each Add button carries
 * its disabled reason as visible text linked through `aria-describedby`.
 */
export default function FreeAgentList({
  items,
  resetKey,
  blockerFor,
  onAdd,
  preparing,
  busy,
  loading,
  emptyTitle,
  emptyDescription,
  emptyIcon,
}: FreeAgentListProps) {
  const idPrefix = useId();
  const wide = useMinWidthMd();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [syncedKey, setSyncedKey] = useState(resetKey);

  // A new search starts again from the first page: React's "adjusting state
  // when a prop changes" pattern, evaluated during render.
  if (resetKey !== syncedKey) {
    setSyncedKey(resetKey);
    setLimit(PAGE_SIZE);
  }

  if (loading) {
    return (
      <div
        aria-busy="true"
        className="rounded-xl border border-line bg-panel p-4"
      >
        <SkeletonLines lines={5} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const visible = items.slice(0, limit);
  const remaining = items.length - visible.length;

  function renderAction(entry: DraftPokemon, index: number, align: "end" | "start") {
    const blocker = blockerFor(entry);
    const reasonId = `${idPrefix}-reason-${index}`;
    const checking = preparing === entry.name;

    return (
      <div
        className={`flex flex-col gap-1 ${align === "end" ? "items-end text-right" : "items-start"}`}
      >
        <Button
          size="sm"
          onClick={() => onAdd(entry)}
          disabled={blocker !== null || busy}
          pending={checking}
          pendingText="Checking..."
          aria-label={`Add ${entry.name}`}
          aria-describedby={blocker ? reasonId : undefined}
        >
          Add
        </Button>
        {blocker && (
          <span id={reasonId} className="text-xs text-muted">
            {blocker}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {wide ? (
        <TableWrap>
          <table className={tableClassName} aria-label="Free agents">
            <thead className={theadClassName}>
              <tr>
                <th scope="col" className={thClassName}>
                  Pokémon
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  Points
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  Tier
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  Move
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, index) => (
                <tr key={entry.name} className={trClassName}>
                  <td className={tdClassName}>
                    <div className="flex items-center gap-3">
                      <PokemonSprite name={entry.name} />
                      <div className="min-w-0">
                        <p className="font-semibold text-text">{entry.name}</p>
                        <PokemonTypes name={entry.name} className="mt-1" />
                      </div>
                    </div>
                  </td>
                  <td className={`${tdClassName} text-right tabular-nums text-text`}>
                    {entry.points}
                  </td>
                  <td className={`${tdClassName} text-right tabular-nums text-muted`}>
                    {entry.tier}
                  </td>
                  <td className={`${tdClassName} text-right`}>
                    {renderAction(entry, index, "end")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Free agents">
          {visible.map((entry, index) => (
            <li
              key={entry.name}
              className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3"
            >
              <div className="flex items-center gap-3">
                <PokemonSprite name={entry.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-text">{entry.name}</p>
                  <PokemonTypes name={entry.name} className="mt-1" />
                  <p className="mt-1 text-xs text-muted">
                    {entry.points} pts · Tier {entry.tier}
                  </p>
                </div>
              </div>
              {renderAction(entry, index, "start")}
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <div className="flex flex-col items-center gap-1">
          <Button
            variant="secondary"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            Show {Math.min(remaining, PAGE_SIZE)} more
          </Button>
          <p className="text-xs text-muted">
            Showing {visible.length} of {items.length}
          </p>
        </div>
      )}
    </div>
  );
}
