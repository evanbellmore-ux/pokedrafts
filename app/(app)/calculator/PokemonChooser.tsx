"use client";

import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Dialog, Field, Input } from "@/app/components/ui";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { createBuild, withUsualAbility } from "@/app/lib/battle/model";
import { usualAbility } from "@/app/lib/battle/move-defaults";
import { createSpeciesSearch } from "@/app/lib/battle/species-search";
import type { BattleBuild } from "@/app/lib/battle/types";

const SEARCH_PAGE_SIZE = 8;

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
  build: BattleBuild;
  open: boolean;
  onClose: () => void;
  onChange: (build: BattleBuild) => void;
  onReturnFocus?: (opener: HTMLElement) => void;
  roster?: ReactNode;
  runtime?: BattleRuntime;
  /** Champions usage, or a native game's Random Battle sets, pick the usual ability per format. */
  gameType?: "Singles" | "Doubles";
  /**
   * The Pokémon's full name for the change notice ("Charizard (yours) changed to …" in a 2v2 mirror); defaults to its
   * species name. The dialog is modal and opened from that Pokémon's card, so its title names the species
   * ("Change Charizard") and its controls need no name.
   */
  label?: string;
};

/** A hand-picked Pokémon's fresh build, with its usual ability for the format (move-defaults usualAbility). */
export function chosenBuild(speciesId: string, runtime: BattleRuntime, gameType: "Singles" | "Doubles"): BattleBuild {
  return withUsualAbility(createBuild(speciesId, runtime), usualAbility(speciesId, gameType, runtime));
}

export default function PokemonChooser({ build, open, onClose, onChange, onReturnFocus, roster, runtime = championsRuntime, gameType = "Doubles", label }: Props) {
  const id = useId();
  const current = runtime.speciesById.get(build.speciesId)?.name ?? build.speciesId;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [teamMode, setTeamMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [catalogIdentity, setCatalogIdentity] = useState(runtime.identity);
  if (catalogIdentity !== runtime.identity) {
    setCatalogIdentity(runtime.identity);
    setQuery("");
    setPage(0);
    setTeamMode(false);
    setNotice("");
  }
  const search = useMemo(() => createSpeciesSearch(runtime), [runtime]);
  const showTeam = !!roster && teamMode;
  const matches = useMemo(() => search(query), [search, query]);
  const visible = matches.slice(page * SEARCH_PAGE_SIZE, (page + 1) * SEARCH_PAGE_SIZE);

  function selectSpecies(speciesId: string) {
    onClose();
    if (speciesId === build.speciesId && build.game === runtime.profile.id) return;
    onChange(chosenBuild(speciesId, runtime, gameType));
    setNotice(`${label ?? current} changed to ${runtime.speciesById.get(speciesId)?.name}. Build settings reset for ${runtime.profile.label}; any required item is selected.`);
  }

  return (
    <div onKeyDown={wrapPickerFocus}>
      <p role="status" className="sr-only">{notice}</p>
      <Dialog open={open} onClose={onClose} onReturnFocus={onReturnFocus} title={`Change ${current}`}>
        {roster && (
          <div role="group" aria-label="Pokémon source" className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="min-h-11" aria-pressed={!showTeam} onClick={() => setTeamMode(false)}>All Pokémon</Button>
            <Button size="sm" variant="secondary" className="min-h-11" aria-pressed={showTeam} onClick={() => setTeamMode(true)}>Team Pokémon</Button>
          </div>
        )}
        {showTeam ? open && roster : (
          <div className="space-y-3">
            <Field id={`${id}-search`} label="Find Pokémon">
              <Input type="search" value={query} placeholder="Name or form, e.g. Charizard Mega" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
            </Field>
            <p role="status" className="text-xs text-muted">
              {matches.length ? `${page * SEARCH_PAGE_SIZE + 1}–${page * SEARCH_PAGE_SIZE + visible.length} of ${matches.length} Pokémon` : "No matching Pokémon."}
            </p>
            <ul aria-label="Pokémon choices" className="space-y-1">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={entry.id === build.speciesId}
                    onClick={() => selectSpecies(entry.id)}
                    className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${entry.id === build.speciesId ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-text hover:bg-panel-hover"}`}
                  >
                    <span className="wrap-anywhere font-medium">{entry.name}</span>
                    <span className="text-xs">{entry.unsupported.length > 0 ? "Coverage not verified" : entry.id === build.speciesId ? "Selected" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > SEARCH_PAGE_SIZE && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous Pokémon page">Previous</Button>
                <Button size="sm" variant="secondary" disabled={(page + 1) * SEARCH_PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)} aria-label="Next Pokémon page">Next</Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
