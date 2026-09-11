"use client";

import { Trash2 } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { Button, NumberInput } from "@/app/components/ui";
import { LEAGUE_LIMITS } from "@/app/types/league";
import type { PoolRowsProps } from "./PoolTable";

/** Pool rows as cards (below md). Same data and keys as the table. */
export default function PoolCards({
  rows,
  editing,
  disabled = false,
  onPointsChange,
  onRemove,
}: PoolRowsProps) {
  return (
    <ul aria-label="Draft pool" className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={row.index}
          className="rounded-xl border border-line bg-panel p-4"
        >
          <div className="flex items-center gap-3">
            <PokemonSprite name={row.name} />
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold text-text">{row.name}</p>
              <PokemonTypes name={row.name} />
            </div>
            {!editing && (
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold text-text tabular-nums">
                  {row.points}
                  <span className="ml-1 text-xs font-normal text-muted">pts</span>
                </p>
                <p className="text-xs text-muted">Tier {row.tier ?? "–"}</p>
              </div>
            )}
          </div>

          {editing && (
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="flex items-end gap-3">
                {/* The control is w-full, so the wrapper sets the width. */}
                <div className="w-24">
                  <NumberInput
                    aria-label={`Points for ${row.name}`}
                    value={row.points}
                    onValueChange={(value) => onPointsChange?.(row.index, value)}
                    min={LEAGUE_LIMITS.poolPoints.min}
                    max={LEAGUE_LIMITS.poolPoints.max}
                    disabled={disabled}
                  />
                </div>
                <p className="pb-2.5 text-xs text-muted">Tier {row.tier ?? "–"}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove?.(row.index)}
                disabled={disabled}
                aria-label={`Remove ${row.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
