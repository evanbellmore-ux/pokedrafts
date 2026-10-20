"use client";

import { useState } from "react";
import { Button, Field, Select } from "@/app/components/ui";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import { benchSideView, hazardControls } from "./doubles-inputs";
import { addChosenDoublesBench, addDoublesBench } from "./doubles-prep";
import { controlId, EarlierCheckbox, EarlierInput, split, useEarlierTurn, Whose } from "./EarlierTurnFields";
import PokemonChooser from "./PokemonChooser";
import styles from "./calculator.module.css";

// status2 Track R-U (IN §5.7, ADDENDUM2 §5.3): one side's Bench and Hazards in its Field conditions fieldset, from
// EarlierTurnContext (the 2v2 matchup, the turn's issues, the side's roster). EarlierTurnFields renders it after the side's own
// controls and before its Pokémon; each Pokémon's Replacement is among its own controls (doubles-inputs earlierSlotControls).

/** A side's screen-reader suffix (": your side"). */
const SIDE_WORDS: Record<DoublesSideId, string> = { own: "your side", opponent: "the opponent's side" };
/** Its bench, as the Pokémon search's title and announcement name it. */
const BENCH_WORDS: Record<DoublesSideId, string> = { own: "your bench", opponent: "the opponent's bench" };

/**
 * The side's Bench (data-doubles-bench): Add to bench (the roster entries not in play and not benched, or with no roster the
 * Pokémon search over the whole game, while it holds fewer than four), then each bench Pokémon's row (its name, HP, Status,
 * and while they apply its sleep, freeze and once-a-battle state, then Remove {Name}); then its Hazards (data-doubles-hazards).
 * Shown as doubles-inputs benchSideView and hazardControls say; nothing without EarlierTurnContext or anything to show.
 */
export default function BenchFields({ id, side }: { id: string; side: DoublesSideId }) {
  const earlier = useEarlierTurn();
  const [choosing, setChoosing] = useState(false);
  if (!earlier) return null;
  const { doubles, issues, apply, rosters, update } = earlier;
  const roster = rosters?.[side] ?? [];
  const view = benchSideView(doubles, side, roster, issues?.field);
  const hazards = split(hazardControls(doubles, side, issues?.field));
  const hasHazards = hazards.checks.length > 0 || hazards.inputs.length > 0;
  if (!view.shown && !hasHazards) return null;
  const whose = SIDE_WORDS[side];
  const canAdd = !view.full && view.add.length > 0 && !!update;
  const canChoose = !view.full && view.choose && !!update;
  return (
    <div data-doubles-bench={side} className="min-w-0">
      {view.shown && (
        <div role="group" aria-labelledby={`${id}-heading`} className="mt-1 min-w-0 border-t border-line pt-1">
          <p id={`${id}-heading`} className="wrap-anywhere text-xs font-semibold text-text">Bench<Whose name={whose} /></p>
          {canAdd && (
            <div className={`${styles.fields} pb-1`}>
              <Field id={`${id}-add`} label={<>Add to bench<Whose name={whose} /></>}>
                <Select data-doubles-bench-add={side} value="" onChange={(event) => {
                  const choice = roster.find((each) => each.source?.key === event.target.value);
                  if (choice) update((state) => addDoublesBench(state, side, choice, roster));
                }}>
                  <option value="">—</option>
                  {view.add.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {canChoose && update && (
            <div className="pb-1">
              <Button size="sm" variant="secondary" className="min-h-11" data-doubles-bench-add={side} onClick={() => setChoosing(true)}>
                <span className="text-xs">Add to bench<Whose name={whose} /></span>
              </Button>
              <PokemonChooser build={doubles.slots[side === "own" ? "own-left" : "opponent-left"].build} runtime={doubles.runtime} gameType="Doubles" open={choosing}
                onClose={() => setChoosing(false)} onChange={(build) => update((state) => addChosenDoublesBench(state, side, build.speciesId))}
                adding={{ title: `Add to ${BENCH_WORDS[side]}`, announce: (name) => `${name} added to ${BENCH_WORDS[side]}.` }} />
            </div>
          )}
          {view.full && (view.add.length > 0 || view.choose) && <p className="wrap-anywhere text-xs text-muted">A bench holds at most four Pokémon.</p>}
          {view.issue && <p className="mb-1 wrap-anywhere text-xs text-danger">{view.issue}</p>}
          {view.rows.length > 0 && (
            <ul className="min-w-0">
              {view.rows.map((row, index) => {
                const { checks, inputs } = split(row.controls);
                const rowId = `${id}-${index}`;
                return (
                  <li key={row.key} data-doubles-bench-row={`${side}-${index}`} className="min-w-0 border-t border-line pt-1 first:border-t-0">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
                      <p className="min-w-0 wrap-anywhere text-xs font-semibold text-text">{row.name}</p>
                      <Button size="sm" variant="secondary" className="min-h-11 shrink-0 px-2" data-doubles-bench-remove={`${side}-${index}`} onClick={() => apply(row.remove)}>
                        <span className="text-xs">Remove<span className="sr-only"> {row.name}</span></span>
                      </Button>
                    </div>
                    <div className={`${styles.fields} pb-1`}>
                      {inputs.map((control) => <EarlierInput key={control.key} id={controlId(rowId, control)} control={control} whose={row.name} apply={apply} />)}
                    </div>
                    {checks.length > 0 && (
                      <div className="grid grid-cols-2 gap-x-2">
                        {checks.map((control) => <EarlierCheckbox key={control.key} id={controlId(rowId, control)} control={control} whose={row.name} apply={apply} />)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {hasHazards && (
        <div role="group" aria-labelledby={`${id}-hazards`} data-doubles-hazards={side} className="mt-1 min-w-0 border-t border-line pt-1">
          <p id={`${id}-hazards`} className="wrap-anywhere text-xs font-semibold text-text">Hazards<Whose name={whose} /></p>
          {hazards.checks.length > 0 && (
            <div className="grid grid-cols-2 gap-x-2">
              {hazards.checks.map((control) => <EarlierCheckbox key={control.key} id={controlId(id, control)} control={control} whose={whose} apply={apply} />)}
            </div>
          )}
          {hazards.inputs.length > 0 && (
            <div className={`${styles.fields} pb-1`}>
              {hazards.inputs.map((control) => <EarlierInput key={control.key} id={controlId(id, control)} control={control} whose={whose} apply={apply} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
