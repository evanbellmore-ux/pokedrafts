"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Dialog, Field, Input } from "@/app/components/ui";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { createBuild } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { BattleSide } from "./roster-prep";

const SEARCH_PAGE_SIZE = 8;
const speciesOptions = [...champions.species].sort((a, b) => a.name.localeCompare(b.name, "en"));

function normalizeName(text: string) {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Some native dialogs briefly visit the document body at these keyboard boundaries.
function wrapPickerFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  const dialog = event.currentTarget.querySelector("dialog[open]");
  if (!dialog) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")]
    .filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  const destination = event.shiftKey && event.target === first ? last
    : !event.shiftKey && event.target === last ? first : undefined;
  if (destination) {
    event.preventDefault();
    destination.focus();
  }
}

type Props = {
  side: BattleSide;
  build: BattleBuild;
  open: boolean;
  onClose: () => void;
  onChange: (build: BattleBuild) => void;
  onReturnFocus?: (opener: HTMLElement) => void;
  roster?: ReactNode;
};

export default function PokemonChooser({ side, build, open, onClose, onChange, onReturnFocus, roster }: Props) {
  const id = useId();
  const label = side === "attacker" ? "Attacker" : "Defender";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [teamMode, setTeamMode] = useState(false);
  const [notice, setNotice] = useState("");
  const showTeam = !!roster && teamMode;
  const tokens = query.trim().split(/\s+/).map(normalizeName).filter(Boolean);
  const matches = speciesOptions.filter((entry) => tokens.every((token) =>
    normalizeName(`${entry.name} ${entry.id} ${entry.baseSpecies}`).includes(token),
  ));
  const visible = matches.slice(page * SEARCH_PAGE_SIZE, (page + 1) * SEARCH_PAGE_SIZE);

  function selectSpecies(speciesId: string) {
    onClose();
    if (speciesId === build.speciesId) return;
    onChange(createBuild(speciesId));
    setNotice(`${label} changed to ${speciesById.get(speciesId)?.name}. Build settings reset; any required Mega Stone is selected.`);
  }

  return (
    <div onKeyDown={wrapPickerFocus}>
      <p role="status" className="sr-only">{notice}</p>
      <Dialog open={open} onClose={onClose} onReturnFocus={onReturnFocus} title={`Change ${side} Pokémon`}>
        {roster && (
          <div role="group" aria-label="Pokémon source" className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="min-h-11" aria-pressed={!showTeam} onClick={() => setTeamMode(false)}>All Pokémon</Button>
            <Button size="sm" variant="secondary" className="min-h-11" aria-pressed={showTeam} onClick={() => setTeamMode(true)}>Team Pokémon</Button>
          </div>
        )}
        {showTeam ? open && roster : (
          <div className="space-y-3">
            <Field id={`${id}-search`} label={`Find ${side} Pokémon`} help="Search any name or form. Changing Pokémon resets nature, ability, item, Stat Points, stages, HP and status.">
              <Input type="search" value={query} placeholder="Name or form, e.g. Charizard Mega" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
            </Field>
            <p role="status" className="text-xs text-muted">
              {matches.length ? `${page * SEARCH_PAGE_SIZE + 1}–${page * SEARCH_PAGE_SIZE + visible.length} of ${matches.length} Pokémon` : "No matching Pokémon."}
              {matches.length > SEARCH_PAGE_SIZE && " · Refine the name or browse pages."}
            </p>
            <ul aria-label={`${label} Pokémon choices`} className="space-y-1">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={entry.id === build.speciesId}
                    onClick={() => selectSpecies(entry.id)}
                    className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${entry.id === build.speciesId ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-text hover:bg-panel-hover"}`}
                  >
                    <span className="wrap-anywhere font-medium">{entry.name}</span>
                    <span className="text-xs">{entry.unsupported.length > 0 ? "Unsupported in v1" : entry.id === build.speciesId ? "Selected" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > SEARCH_PAGE_SIZE && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={`Previous ${side} Pokémon page`}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={(page + 1) * SEARCH_PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)} aria-label={`Next ${side} Pokémon page`}>Next</Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
