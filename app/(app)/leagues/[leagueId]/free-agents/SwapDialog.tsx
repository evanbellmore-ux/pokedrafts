"use client";

import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { Dialog } from "@/app/components/ui";
import type { DraftPokemon } from "@/app/types/draft";
import type { RosterPokemon } from "@/app/types/league";

export type PendingMove = {
  add: DraftPokemon;
  /** Null for an add-only move into an open slot. */
  drop: RosterPokemon | null;
  pointsAfter: number;
};

export type SwapDialogProps = {
  move: PendingMove | null;
  budget: number;
  swapsRemaining: number;
  swapLimit: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

function MoveCard({
  label,
  tone,
  entry,
}: {
  label: string;
  tone: "drop" | "add";
  entry: DraftPokemon;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center rounded-lg border border-line bg-bg p-3 text-center">
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          tone === "drop" ? "text-danger" : "text-success"
        }`}
      >
        {label}
      </p>
      <PokemonSprite name={entry.name} size="lg" className="mt-2" />
      <p className="mt-2 w-full break-words text-sm font-semibold text-text">
        {entry.name}
      </p>
      <PokemonTypes name={entry.name} className="mt-1 justify-center" />
      <p className="mt-1 text-xs text-muted">
        {entry.points} pts · Tier {entry.tier}
      </p>
    </div>
  );
}

/** Confirmation for a free agent move: the Drop and Add cards plus totals. */
export default function SwapDialog({
  move,
  budget,
  swapsRemaining,
  swapLimit,
  pending,
  onClose,
  onConfirm,
}: SwapDialogProps) {
  const swapNote =
    swapsRemaining <= 1
      ? "This uses your last free agent swap of the season."
      : `This uses one of your ${swapsRemaining} remaining free agent swaps.`;

  const description = move
    ? move.drop
      ? `Add ${move.add.name} and drop ${move.drop.name}. ${swapNote}`
      : `Add ${move.add.name} to an open roster slot. ${swapNote}`
    : undefined;

  return (
    <Dialog
      open={move !== null}
      onClose={onClose}
      title="Confirm free agent move"
      description={description}
      onConfirm={onConfirm}
      confirmLabel="Confirm move"
      pending={pending}
    >
      {move && (
        <>
          <div
            className={`grid gap-3 ${move.drop ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {move.drop && <MoveCard label="Drop" tone="drop" entry={move.drop} />}
            <MoveCard label="Add" tone="add" entry={move.add} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel-hover px-3 py-2 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Points after move
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-text">
                {move.pointsAfter} / {budget}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Swaps left after
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-text">
                {Math.max(0, swapsRemaining - 1)} / {swapLimit}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Dialog>
  );
}
