"use client";

import { useId, useMemo, useState } from "react";
import { Button, Dialog, Field, Input } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { createSpeciesSearch } from "@/app/lib/battle/species-search";
import type { SwitchInOptions } from "./doubles-inputs";

const SEARCH_PAGE_SIZE = 8;

/** A picked option: a bench Pokémon or a team Pokémon by key, any Pokémon of the game by species, or none left. */
export type SwitchInPick = { kind: "bench"; key: string } | { kind: "team"; key: string } | { kind: "species"; speciesId: string } | { kind: "none" };

type Props = {
  open: boolean;
  onClose: () => void;
  /** The Pokémon switching out, as the 2v2 names it ("Pikachu", "Garchomp (yours, 1)"). */
  name: string;
  runtime: BattleRuntime;
  options: SwitchInOptions;
  onPick: (pick: SwitchInPick) => void;
};

const optionClass = (pressed: boolean) =>
  `flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${pressed ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-text hover:bg-panel-hover"}`;

/**
 * "Switch in for Pikachu" (Training's mid-turn wording): the 2v2 pop-up that names the Pokémon a switching Pokémon brings in.
 * Its side's bench Pokémon (the one it switches to now pressed), its team Pokémon not in play, Find Pokémon over the whole game
 * (listed at once when there is no bench or team to pick from, else once something is typed), and No Pokémon left while its
 * bench is empty. A pick closes it.
 */
export default function SwitchInChooser({ open, onClose, name, runtime, options, onPick }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = useMemo(() => createSpeciesSearch(runtime), [runtime]);
  const matches = useMemo(() => search(query), [search, query]);
  const visible = matches.slice(page * SEARCH_PAGE_SIZE, (page + 1) * SEARCH_PAGE_SIZE);
  const { bench, team, full, noneLeft, current } = options;
  const listAll = query.trim() !== "" || (bench.length === 0 && team.length === 0);

  function pick(choice: SwitchInPick) {
    onClose();
    onPick(choice);
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Switch in for ${name}`}>
      <div className="space-y-4">
        {bench.length > 0 && (
          <section aria-labelledby={`${id}-bench`}>
            <h3 id={`${id}-bench`} className="text-xs font-medium text-muted">On the bench</h3>
            <ul className="mt-1 space-y-1">
              {bench.map((entry) => (
                <li key={entry.key}>
                  <button type="button" data-switch-in-bench={entry.key} aria-pressed={entry.key === current} onClick={() => pick({ kind: "bench", key: entry.key })} className={optionClass(entry.key === current)}>
                    <span className="wrap-anywhere font-medium">{entry.name}</span>
                    {entry.detail && <span className="text-xs tabular-nums">{entry.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {full ? <p className="text-xs text-muted">A bench holds at most four Pokémon.</p> : (
          <>
            {team.length > 0 && (
              <section aria-labelledby={`${id}-team`}>
                <h3 id={`${id}-team`} className="text-xs font-medium text-muted">Team</h3>
                <ul className="mt-1 space-y-1">
                  {team.map((entry) => (
                    <li key={entry.key}>
                      <button type="button" data-switch-in-team={entry.key} aria-pressed={false} onClick={() => pick({ kind: "team", key: entry.key })} className={optionClass(false)}>
                        <span className="wrap-anywhere font-medium">{entry.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="space-y-2">
              <Field id={`${id}-search`} label="Find Pokémon">
                <Input type="search" value={query} placeholder="Name or form, e.g. Garchomp" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
              </Field>
              {listAll && (
                <>
                  <p role="status" className="text-xs text-muted">
                    {matches.length ? `${page * SEARCH_PAGE_SIZE + 1}–${page * SEARCH_PAGE_SIZE + visible.length} of ${matches.length} Pokémon` : "No matching Pokémon."}
                  </p>
                  <ul aria-label="Pokémon choices" className="space-y-1">
                    {visible.map((entry) => (
                      <li key={entry.id}>
                        <button type="button" data-switch-in-species={entry.id} aria-pressed={false} onClick={() => pick({ kind: "species", speciesId: entry.id })} className={optionClass(false)}>
                          <span className="wrap-anywhere font-medium">{entry.name}</span>
                          <span className="text-xs">{entry.unsupported.length > 0 ? "Coverage not verified" : ""}</span>
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
                </>
              )}
            </section>
          </>
        )}
        {noneLeft && (
          <button type="button" data-switch-in-none aria-pressed={false} onClick={() => pick({ kind: "none" })} className={optionClass(false)}>
            <span className="wrap-anywhere font-medium">No Pokémon left</span>
            <span className="text-xs">{name} stays in</span>
          </button>
        )}
      </div>
    </Dialog>
  );
}
