"use client";

import { Plus } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { SkeletonLines } from "@/app/components/ui";
import type { RosterPokemon } from "@/app/types/league";
import { PickLabel } from "../team/RosterTable";
import { pokemonKey } from "../team/roster";

export type YourTeamPickerProps = {
  roster: RosterPokemon[];
  /** `pokemonKey` of the entry selected to drop; null for an add-only move. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Disables every toggle (draft not complete, no swaps, move in flight). */
  disabled: boolean;
  /** Offers "Add without dropping" when the roster has an open slot. */
  hasOpenSlot: boolean;
  loading: boolean;
};

const toggleBase =
  "flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60";
const toggleOff =
  "border-line bg-panel hover:border-line-strong hover:bg-panel-hover";
const toggleOn = "border-accent-border bg-accent-soft";

/**
 * The coach's roster as toggle buttons: pressing one marks it as the
 * Pokémon to drop, pressing it again clears the selection. With an open
 * slot an extra toggle selects an add-only move.
 */
export default function YourTeamPicker({
  roster,
  selectedKey,
  onSelect,
  disabled,
  hasOpenSlot,
  loading,
}: YourTeamPickerProps) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="rounded-xl border border-line bg-panel p-4"
      >
        <SkeletonLines lines={3} />
      </div>
    );
  }

  const addOnlySelected = selectedKey === null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {roster.length === 0
          ? "Every slot on your roster is open."
          : hasOpenSlot
            ? "Choose a Pokémon to drop, or keep “Add without dropping” to use an open slot, then pick a free agent."
            : "Choose the Pokémon to drop, then pick a free agent to add."}
      </p>

      <div
        role="group"
        aria-label="Pokémon to drop"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {roster.map((entry, index) => {
          const key = pokemonKey(entry.name);
          const pressed = selectedKey === key;
          return (
            <button
              key={`${key}-${index}`}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onSelect(pressed ? null : key)}
              className={`${toggleBase} ${pressed ? toggleOn : toggleOff}`}
            >
              <PokemonSprite name={entry.name} />
              <span className="w-full truncate text-sm font-semibold text-text">
                {entry.name}
              </span>
              <PokemonTypes name={entry.name} className="justify-center" />
              <span className="text-xs text-muted">
                {entry.points} pts · Tier {entry.tier}
              </span>
              <PickLabel entry={entry} />
              {pressed && (
                <span className="text-xs font-semibold text-accent-text">
                  Dropping
                </span>
              )}
            </button>
          );
        })}

        {hasOpenSlot && (
          <button
            type="button"
            aria-pressed={addOnlySelected}
            disabled={disabled}
            onClick={() => onSelect(null)}
            className={`${toggleBase} justify-center border-dashed ${addOnlySelected ? toggleOn : toggleOff}`}
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-text"
            >
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-text">
              Add without dropping
            </span>
            <span className="text-xs text-muted">Use an open slot</span>
          </button>
        )}
      </div>
    </div>
  );
}
