"use client";

import { Trash2 } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import {
  Button,
  NumberInput,
  TableWrap,
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui";
import { LEAGUE_LIMITS } from "@/app/types/league";
import type { PoolRow } from "./poolEditing";

export type PoolRowsProps = {
  rows: PoolRow[];
  editing: boolean;
  disabled?: boolean;
  onPointsChange?: (index: number, value: number | null) => void;
  onRemove?: (index: number) => void;
};

/** Pool rows as a table (md and up). Rows are keyed by index. */
export default function PoolTable({
  rows,
  editing,
  disabled = false,
  onPointsChange,
  onRemove,
}: PoolRowsProps) {
  return (
    <TableWrap>
      <table className={tableClassName}>
        <caption className="sr-only">Draft pool</caption>
        <thead className={theadClassName}>
          <tr>
            <th scope="col" className={thClassName}>
              Pokémon
            </th>
            <th scope="col" className={thClassName}>
              Points
            </th>
            <th scope="col" className={thClassName}>
              Tier
            </th>
            {editing && (
              <th scope="col" className={`${thClassName} text-right`}>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index} className={trClassName}>
              <td className={tdClassName}>
                <div className="flex items-center gap-3">
                  <PokemonSprite name={row.name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-text">{row.name}</p>
                    <PokemonTypes name={row.name} />
                  </div>
                </div>
              </td>
              <td className={`${tdClassName} tabular-nums`}>
                {editing ? (
                  // The control is w-full, so the wrapper sets the width.
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
                ) : (
                  row.points
                )}
              </td>
              <td className={`${tdClassName} tabular-nums text-muted`}>
                {row.tier ?? "–"}
              </td>
              {editing && (
                <td className={`${tdClassName} text-right`}>
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
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
