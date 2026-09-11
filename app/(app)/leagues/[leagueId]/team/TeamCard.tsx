"use client";

import PokemonSprite from "@/app/components/PokemonSprite";
import { StatusPill } from "@/app/components/ui";
import { pluralize, roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import RosterTable from "./RosterTable";
import type { TeamRoster } from "./roster";

export type TeamCardProps = {
  team: TeamRoster;
  budget: number;
};

/**
 * Another coach's team: name, Commissioner pill (from the display-only
 * `role` column the functions keep in sync), points and a sprite strip, with
 * the full roster table behind a native disclosure so a league of many teams
 * stays scannable.
 */
export default function TeamCard({ team, budget }: TeamCardProps) {
  const name = teamNameLabel(team.team_name);
  const commissioner = roleLabel(team.role) === "Commissioner";

  return (
    <article
      aria-label={name}
      className="rounded-xl border border-line bg-panel p-4 sm:p-5"
    >
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-text">
          <span className="min-w-0 truncate">{name}</span>
          {commissioner && <StatusPill tone="accent">Commissioner</StatusPill>}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {pluralize(team.pokemon.length, "Pokémon", "Pokémon")}
          {" · "}
          <span className="tabular-nums">
            {team.total_points} / {budget}
          </span>{" "}
          points
        </p>
      </div>

      {team.pokemon.length > 0 ? (
        <>
          <ul
            aria-label={`${name} at a glance`}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {team.pokemon.map((entry, index) => (
              <li key={`${entry.name}-${index}`}>
                <PokemonSprite name={entry.name} size="sm" />
              </li>
            ))}
          </ul>

          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-semibold text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show full roster</span>
              <span className="hidden group-open:inline">Hide full roster</span>
            </summary>
            <div className="mt-3">
              <RosterTable roster={team.pokemon} label={`${name} roster`} />
            </div>
          </details>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">No Pokémon on this roster.</p>
      )}
    </article>
  );
}
