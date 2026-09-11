"use client";

import { Trash2 } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import NumberInput, { clampInteger } from "@/app/components/ui/NumberInput";
import TableWrap, {
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui/TableWrap";
import { pointsToTier } from "@/app/types/draft";
import { useDebouncedValue, useMediaQuery } from "./hooks";
import {
  cleanName,
  entryKey,
  MAX_POINTS,
  MAX_POKEMON_NAME_LENGTH,
  MIN_POINTS,
  type PoolEntry,
} from "./poolFormat";

export type PoolTableProps = {
  /** The rows to render (already filtered and paged by the parent). */
  entries: PoolEntry[];
  /** Normalized names that appear on more than one row. */
  duplicateKeys: Set<string>;
  onChange: (key: string, patch: Partial<PoolEntry>) => void;
  onRemove: (key: string) => void;
};

type RowProps = {
  entry: PoolEntry;
  duplicateKeys: Set<string>;
  onChange: (key: string, patch: Partial<PoolEntry>) => void;
  onRemove: (key: string) => void;
};

/** Per-row derived state shared by the table row and the mobile card. */
function useRowState(entry: PoolEntry, duplicateKeys: Set<string>) {
  const name = cleanName(entry.name);
  const lookupName = useDebouncedValue(name, 400);
  const blank = name === "";
  const duplicate = !blank && duplicateKeys.has(entryKey(name));
  const label = name || "Unnamed row";
  const problem = duplicate ? "Duplicate name" : blank ? "Name required" : null;
  return { lookupName, label, problem, invalid: duplicate || blank };
}

function SpriteCell({ lookupName }: { lookupName: string }) {
  if (lookupName) return <PokemonSprite name={lookupName} />;
  return (
    <div
      role="img"
      aria-label="No Pokémon name yet"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-panel-hover text-sm font-bold text-muted"
    >
      ?
    </div>
  );
}

function NameField({
  entry,
  label,
  lookupName,
  problem,
  invalid,
  onChange,
}: {
  entry: PoolEntry;
  label: string;
  lookupName: string;
  problem: string | null;
  invalid: boolean;
  onChange: RowProps["onChange"];
}) {
  return (
    <div className="min-w-0 flex-1">
      <Input
        value={entry.name}
        onChange={(event) => onChange(entry.key, { name: event.target.value })}
        aria-label={`${label} name`}
        aria-invalid={invalid || undefined}
        maxLength={MAX_POKEMON_NAME_LENGTH}
        autoComplete="off"
        className="min-w-40"
      />
      <div className="mt-1 flex min-h-4 flex-wrap items-center gap-2">
        {lookupName && <PokemonTypes name={lookupName} />}
        {problem && (
          <span className="text-xs font-medium text-danger">{problem}</span>
        )}
      </div>
    </div>
  );
}

function PointsField({
  entry,
  label,
  onChange,
}: {
  entry: PoolEntry;
  label: string;
  onChange: RowProps["onChange"];
}) {
  return (
    <NumberInput
      value={entry.points}
      min={MIN_POINTS}
      max={MAX_POINTS}
      aria-label={`${label} points`}
      onValueChange={(value) => {
        if (value === null) return;
        const points = clampInteger(value, MIN_POINTS, MAX_POINTS);
        onChange(entry.key, { points, tier: pointsToTier(points) });
      }}
      className="w-24"
    />
  );
}

function DeleteButton({
  entry,
  label,
  onRemove,
}: {
  entry: PoolEntry;
  label: string;
  onRemove: RowProps["onRemove"];
}) {
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={() => onRemove(entry.key)}
      aria-label={`Delete ${label}`}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      Delete
    </Button>
  );
}

function PoolRow({ entry, duplicateKeys, onChange, onRemove }: RowProps) {
  const { lookupName, label, problem, invalid } = useRowState(entry, duplicateKeys);

  return (
    <tr className={trClassName}>
      <td className={tdClassName}>
        <div className="flex items-center gap-3">
          <SpriteCell lookupName={lookupName} />
          <NameField
            entry={entry}
            label={label}
            lookupName={lookupName}
            problem={problem}
            invalid={invalid}
            onChange={onChange}
          />
        </div>
      </td>
      <td className={tdClassName}>
        <PointsField entry={entry} label={label} onChange={onChange} />
      </td>
      <td className={`${tdClassName} whitespace-nowrap text-muted`}>
        Tier {entry.tier}
      </td>
      <td className={`${tdClassName} text-right`}>
        <DeleteButton entry={entry} label={label} onRemove={onRemove} />
      </td>
    </tr>
  );
}

function PoolCard({ entry, duplicateKeys, onChange, onRemove }: RowProps) {
  const { lookupName, label, problem, invalid } = useRowState(entry, duplicateKeys);

  return (
    <li className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <SpriteCell lookupName={lookupName} />
        <NameField
          entry={entry}
          label={label}
          lookupName={lookupName}
          problem={problem}
          invalid={invalid}
          onChange={onChange}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xs font-medium text-muted">
            Points
          </span>
          <PointsField entry={entry} label={label} onChange={onChange} />
        </div>
        <span className="text-sm text-muted">Tier {entry.tier}</span>
        <div className="ml-auto">
          <DeleteButton entry={entry} label={label} onRemove={onRemove} />
        </div>
      </div>
    </li>
  );
}

/**
 * The editable pool: a table inside TableWrap from `md` up, card rows below
 * it (docs/release-architecture.md section 8.5). Only one of the two is
 * mounted so a 2000-row pool is not rendered twice.
 */
export default function PoolTable({
  entries,
  duplicateKeys,
  onChange,
  onRemove,
}: PoolTableProps) {
  const wide = useMediaQuery("(min-width: 768px)");

  if (!wide) {
    return (
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <PoolCard
            key={entry.key}
            entry={entry}
            duplicateKeys={duplicateKeys}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
      </ul>
    );
  }

  return (
    <TableWrap>
      <table className={tableClassName}>
        <caption className="sr-only">Pokémon in this draft pool</caption>
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
            <th scope="col" className={`${thClassName} text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <PoolRow
              key={entry.key}
              entry={entry}
              duplicateKeys={duplicateKeys}
              onChange={onChange}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
