"use client";

import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import {
  StatusPill,
  TableWrap,
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui";
import type { RosterPokemon } from "@/app/types/league";
import { useMinWidthMd } from "../useMinWidthMd";
import { isFreeAgentPickup } from "./roster";

/** "#12" for a drafted entry, an "FA" pill for a free-agent pickup. */
export function PickLabel({ entry }: { entry: RosterPokemon }) {
  if (isFreeAgentPickup(entry)) {
    return (
      <StatusPill tone="accent">
        <abbr title="Free agent pickup" className="no-underline">
          FA
        </abbr>
      </StatusPill>
    );
  }

  return (
    <span className="font-semibold tabular-nums text-text">
      #{entry.pick_number}
    </span>
  );
}

export type RosterTableProps = {
  roster: RosterPokemon[];
  /** Accessible name for the table and the mobile list. */
  label: string;
};

/**
 * A team's roster: a four-column table inside `TableWrap` from `md` up and
 * card rows below it (docs section 8.5), only one of which is mounted
 * (`useMinWidthMd`). Entries keep the order stored on the row, so a
 * free-agent pickup sits in the slot it replaced.
 */
export default function RosterTable({ roster, label }: RosterTableProps) {
  const wide = useMinWidthMd();

  if (wide) {
    return (
      <TableWrap>
        <table className={tableClassName} aria-label={label}>
          <thead className={theadClassName}>
            <tr>
              <th scope="col" className={thClassName}>
                Pick
              </th>
              <th scope="col" className={thClassName}>
                Pokémon
              </th>
              <th scope="col" className={`${thClassName} text-right`}>
                Points
              </th>
              <th scope="col" className={`${thClassName} text-right`}>
                Tier
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((entry, index) => (
              <tr key={`${entry.name}-${index}`} className={trClassName}>
                <td className={tdClassName}>
                  <PickLabel entry={entry} />
                </td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {roster.map((entry, index) => (
        <li
          key={`${entry.name}-${index}`}
          className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3"
        >
          <PokemonSprite name={entry.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-text">{entry.name}</p>
            <PokemonTypes name={entry.name} className="mt-1" />
            <p className="mt-1 text-xs text-muted">
              {entry.points} pts · Tier {entry.tier}
            </p>
          </div>
          <PickLabel entry={entry} />
        </li>
      ))}
    </ul>
  );
}
