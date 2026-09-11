"use client";

import { memo, useMemo } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { Field, Select } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { DraftPick, LeagueMember } from "@/app/types/league";
import type { TeamBudget } from "./draft-room";

export type RosterPanelProps = {
  coaches: LeagueMember[];
  picks: DraftPick[];
  picksPerTeam: number;
  budgets: Map<string, TeamBudget>;
  selectedId: string;
  onSelect: (memberId: string) => void;
  myId: string;
  className?: string;
};

/**
 * "Roster: <team>" with a team picker and one tile per roster slot. Slots
 * fill in pick order; a turn that was skipped leaves a slot open.
 */
const RosterPanel = memo(function RosterPanel({
  coaches,
  picks,
  picksPerTeam,
  budgets,
  selectedId,
  onSelect,
  myId,
  className = "",
}: RosterPanelProps) {
  const selected = coaches.find((coach) => coach.id === selectedId) ?? null;

  const rosterPicks = useMemo(
    () =>
      selected
        ? picks
            .filter((pick) => pick.member_id === selected.id)
            .sort((a, b) => a.pick_number - b.pick_number)
        : [],
    [picks, selected]
  );

  const teamName = teamNameLabel(selected?.team_name);
  const teamBudget = selected ? budgets.get(selected.id) : undefined;
  const slots = Array.from(
    { length: Math.max(picksPerTeam, rosterPicks.length) },
    (_, index) => rosterPicks[index] ?? null
  );

  return (
    <section
      aria-labelledby="roster-heading"
      className={`rounded-xl border border-line bg-panel p-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="roster-heading" className="truncate text-lg font-bold text-text">
            Roster: {teamName}
          </h2>
          {selected && teamBudget && (
            <p className="mt-0.5 text-sm text-muted">
              {rosterPicks.length} of {picksPerTeam} slots filled · {teamBudget.spent}{" "}
              spent · {teamBudget.remaining} of {teamBudget.budget} points left
            </p>
          )}
          {!selected && (
            <p className="mt-0.5 text-sm text-muted">
              No coach has a draft position yet.
            </p>
          )}
        </div>

        {coaches.length > 0 && (
          <Field label="Team" className="sm:w-64">
            <Select
              value={selectedId}
              onChange={(event) => onSelect(event.target.value)}
            >
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {teamNameLabel(coach.team_name)}
                  {coach.id === myId ? " (you)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {selected && (
        <ul
          aria-label={`${teamName} roster`}
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5"
        >
          {slots.map((pick, index) => (
            <li
              key={pick ? pick.id : `empty-${index}`}
              className={`flex min-h-28 flex-col items-center justify-center rounded-lg border p-2 text-center ${
                pick
                  ? "border-line bg-bg"
                  : "border-dashed border-line bg-panel"
              }`}
            >
              {pick ? (
                <>
                  <PokemonSprite name={pick.pokemon_name} />
                  <p className="mt-1.5 w-full truncate text-xs font-semibold text-text">
                    {pick.pokemon_name}
                  </p>
                  <PokemonTypes name={pick.pokemon_name} className="mt-1 justify-center" />
                  <p className="mt-1 text-xs tabular-nums text-muted">
                    {pick.points} pts · #{pick.pick_number}
                  </p>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-line text-xs font-semibold text-faint"
                  >
                    {index + 1}
                  </span>
                  <p className="mt-2 text-xs text-faint">Open slot</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

export default RosterPanel;
