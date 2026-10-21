"use client";

import { createContext, useContext, useState } from "react";
import { Field, NumberInput, Select } from "@/app/components/ui";
import type { DoublesCarried, DoublesIssues, DoublesSideId, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import BenchFields from "./BenchFields";
import {
  earlierFieldControls, earlierSideControls, earlierSlotControls,
  type CarriedOptions, type EarlierChange, type EarlierCheck, type EarlierControl,
} from "./doubles-inputs";
import type { CalculatorState, DoublesMatchup } from "./doubles-prep";
import type { RosterChoice } from "./roster-prep";
import styles from "./calculator.module.css";

// The 2v2 Field conditions' controls for earlier turns (status2 IN §5, ADDENDUM2 §5.2): Track NU's file. Step 0c moved
// today's per-Pokémon controls here verbatim from BattleConditions.tsx (which re-exports the control types), and
// BattleConditions renders them through EarlierTurnFields, one call per side fieldset. Track NU adds ADDENDUM2 §5.2's
// controls from EarlierTurnContext (the 2v2 matchup, the turn's input issues and the state setter): each side's
// conditions before its Pokémon, each Pokémon's new checkboxes and selects in its group after today's, and the field's
// (EarlierFieldFields, which BattleConditions places in its Weather and terrain and Shared field effects fieldsets).
// Without the context only today's controls render.

/** BattleConditions' checkbox class (the same text, so every checkbox in Field conditions looks the same). */
const checkboxClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * The 2v2 matchup the earlier-turn controls read and change (useDoublesView provides it around DoublesSettings): `issues`,
 * the turn's input issues while it has them; `apply`, a control's change to the calculator state (doubles-inputs
 * applyDoublesEarlier). Absent (1v1, or a Field conditions rendered on its own): only today's controls. status2 R-U: `rosters`,
 * each side's roster panel's choices (the Bench's Add to bench), and `update`, a change of the whole calculator state (adding a
 * bench Pokémon reads the shared cache: doubles-prep addDoublesBench); without them no Pokémon can be added.
 */
export type EarlierTurnState = {
  doubles: DoublesMatchup; issues?: DoublesIssues | null; apply: (change: EarlierChange) => void;
  rosters?: Partial<Record<DoublesSideId, readonly RosterChoice[]>>;
  update?: (transition: (state: CalculatorState) => CalculatorState) => void;
};
export const EarlierTurnContext = createContext<EarlierTurnState | null>(null);

/** The 2v2 matchup EarlierTurnContext provides, or null. */
export function useEarlierTurn(): EarlierTurnState | null {
  return useContext(EarlierTurnContext);
}

type Side = "attackerSide" | "defenderSide";

/** One 2v2 Pokémon's Charge from an earlier turn, shown in its side's fieldset. */
export type ChargeToggle = { slot: DoublesSlotId; side: Side; name: string; checked: boolean; onChange: (checked: boolean) => void };

/**
 * 2v2 (status-eot SPEC §5, ADDENDUM §5): one Pokémon's state from earlier turns, shown in its side's fieldset with its
 * Charge: turns lost to sleep and Rest sleep, turns lost to freeze (Champions), confusion and its turns so far, bad poison
 * turns so far, and a Substitute with its HP. `issues`: the turn's input issues about them ("Garchomp: …", by control).
 */
export type CarriedControl = {
  slot: DoublesSlotId; side: Side; name: string;
  options: CarriedOptions;
  value: DoublesCarried;
  issues?: Partial<Record<keyof CarriedOptions, string>>;
  onChange: (carried: DoublesCarried) => void;
};

/**
 * The checkboxes ticked among a Pokémon's state-from-earlier-turns controls, as CarriedFields shows them: Confused, Rest
 * sleep, Substitute. A fainted Pokémon (NO_CARRIED_OPTIONS) shows none, though it keeps its state.
 */
export function carriedToggles({ options, value }: Pick<CarriedControl, "options" | "value">) {
  return Number(options.confusion && !!value.confusion) + Number(!!options.sleep && !!value.sleep?.rest) + Number(!!options.substitute && value.substitute !== undefined);
}

const range = (max: number) => Array.from({ length: max + 1 }, (_, index) => index);

/** A label's name for screen readers when its group already shows it: "Confused" reads "Confused: Garchomp". */
export function Whose({ name }: { name: string }) {
  return <span className="sr-only">: {name}</span>;
}

/** A control's id within its group: the key with dots as dashes ("attackerSide.safeguard" → "attackerSide-safeguard"). */
export const controlId = (id: string, control: EarlierControl) => `${id}-${control.key.replace(/\./g, "-")}`;

/** One earlier-turn checkbox (doubles-inputs EarlierCheck), as today's: the label wraps in its column; its issue below it. */
export function EarlierCheckbox({ id, control, whose, apply }: { id: string; control: EarlierCheck; whose?: string; apply: (change: EarlierChange) => void }) {
  const box = (
    <label htmlFor={id} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
      <input id={id} type="checkbox" {...{ [control.attr]: control.attrValue }} value={control.inputValue} checked={control.checked}
        aria-invalid={control.issue ? true : undefined} aria-describedby={control.issue ? `${id}-error` : undefined}
        onChange={(event) => apply(control.set(event.target.checked))} className={checkboxClassName} />
      <span>{control.label}{whose && <Whose name={whose} />}</span>
    </label>
  );
  if (!control.issue) return box;
  return <div className="min-w-0">{box}<p id={`${id}-error`} className="mb-1 text-xs text-danger wrap-anywhere">{control.issue}</p></div>;
}

/** One earlier-turn select or number (doubles-inputs EarlierSelect, EarlierNumber), compact as today's counts. */
export function EarlierInput({ id, control, whose, apply }: { id: string; control: Exclude<EarlierControl, EarlierCheck>; whose?: string; apply: (change: EarlierChange) => void }) {
  const label = <>{control.label}{whose && <Whose name={whose} />}</>;
  const data = { [control.attr]: control.attrValue };
  return (
    <Field id={id} label={label} error={control.issue}>
      {control.kind === "select" ? (
        <Select {...data} value={control.value} onChange={(event) => apply(control.set(event.target.value))}>
          {control.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </Select>
      ) : (
        <NumberInput {...data} value={control.value} min={control.min} max={control.max} onValueChange={(next) => apply(control.set(next))} />
      )}
    </Field>
  );
}

/** Earlier-turn controls split as a group shows them: the checkboxes, then the selects and numbers. */
export function split(controls: readonly EarlierControl[]) {
  return {
    checks: controls.filter((control): control is EarlierCheck => control.kind === "check"),
    inputs: controls.filter((control): control is Exclude<EarlierControl, EarlierCheck> => control.kind !== "check"),
  };
}

/**
 * One 2v2 Pokémon's Charge and state from earlier turns (data-doubles-carried), named by the Pokémon: checkboxes first,
 * then the counts that apply to its status. A count left at 0 is the turn's assumption, which the turn states. Only what
 * `options` offers shows: a fainted Pokémon keeps its state, unseen, for when its HP comes back. `earlier`: its controls of
 * ADDENDUM2 §5.2 (doubles-inputs earlierSlotControls), after today's checkboxes and counts; `onEarlier` applies their changes.
 */
export function CarriedFields({ id, control, charge, earlier = [], onEarlier }: {
  id: string; control: CarriedControl; charge?: ChargeToggle; earlier?: readonly EarlierControl[]; onEarlier?: (change: EarlierChange) => void;
}) {
  const { slot, name, options, value, issues = {}, onChange } = control;
  const { checks, inputs } = split(onEarlier ? earlier : []);
  const apply = onEarlier ?? (() => undefined);
  const sleep = value.sleep ?? { attempts: 0, rest: false };
  const confusion = options.confusion ? value.confusion : undefined;
  // A Substitute HP typed outside 1 to the maximum, while the turn uses the bound (the field keeps the typed text until blur).
  const [outside, setOutside] = useState<{ typed: number; used: number; max: number } | null>(null);
  const subMax = options.substitute?.max ?? null;
  const subError = outside && subMax === outside.max && value.substitute === outside.used
    ? `${name}: a Substitute has ${outside.typed > outside.max ? `at most ${outside.max}` : "at least 1"} HP; the turn uses ${outside.used}.` : undefined;
  const set = (patch: Partial<DoublesCarried>) => {
    const next: DoublesCarried = { ...value, ...patch };
    for (const key of Object.keys(patch) as (keyof DoublesCarried)[]) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const setSleep = (attempts: number, rest: boolean) => set({ sleep: attempts || rest ? { attempts, rest } : undefined });
  const counts = !!options.sleep || !!options.freeze || !!confusion || options.toxic || (!!options.substitute && value.substitute !== undefined) || inputs.length > 0;
  return (
    <div role="group" aria-labelledby={`${id}-name`} data-doubles-carried={slot} className="mt-1 min-w-0 border-t border-line pt-1">
      <p id={`${id}-name`} className={`${styles.sideHeading} wrap-anywhere text-xs font-semibold text-text`}>{name}</p>
      <div className={`${styles.sideChecks} grid grid-cols-2 gap-x-2`}>
        {charge && (
          <label htmlFor={`${id}-charged`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
            <input id={`${id}-charged`} type="checkbox" data-doubles-charge={slot} checked={charge.checked} onChange={(event) => charge.onChange(event.target.checked)} className={checkboxClassName} />
            <span>Charge<Whose name={name} /></span>
          </label>
        )}
        {options.confusion && (
          <label htmlFor={`${id}-confused`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
            <input id={`${id}-confused`} type="checkbox" data-doubles-confused={slot} checked={!!value.confusion}
              onChange={(event) => set({ confusion: event.target.checked ? { attempts: 0 } : undefined })} className={checkboxClassName} />
            <span>Confused<Whose name={name} /></span>
          </label>
        )}
        {options.sleep && (
          <label htmlFor={`${id}-rest`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
            <input id={`${id}-rest`} type="checkbox" data-doubles-rest={slot} checked={sleep.rest} onChange={(event) => setSleep(sleep.attempts, event.target.checked)} className={checkboxClassName} />
            <span>Rest sleep<Whose name={name} /></span>
          </label>
        )}
        {options.substitute && (
          <label htmlFor={`${id}-substitute`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
            <input id={`${id}-substitute`} type="checkbox" data-doubles-substitute={slot} checked={value.substitute !== undefined}
              onChange={(event) => set({ substitute: event.target.checked ? options.substitute!.max : undefined })} className={checkboxClassName} />
            <span>Substitute<Whose name={name} /></span>
          </label>
        )}
        {checks.map((entry) => <EarlierCheckbox key={entry.key} id={controlId(id, entry)} control={entry} whose={name} apply={apply} />)}
      </div>
      {counts && (
        <div className={`${styles.fields} ${styles.sideInputs} pb-1`}>
          {options.sleep && (
            <Field id={`${id}-sleep`} label={<>Turns lost to sleep<Whose name={name} /></>} error={issues.sleep}>
              <Select data-doubles-sleep={slot} value={sleep.attempts} onChange={(event) => setSleep(Number(event.target.value), sleep.rest)}>
                {range(Math.max(options.sleep.max, sleep.attempts)).map((count) => <option key={count} value={count}>{count}</option>)}
              </Select>
            </Field>
          )}
          {options.freeze && (
            <Field id={`${id}-freeze`} label={<>Turns lost to freeze<Whose name={name} /></>} error={issues.freeze}>
              <Select data-doubles-freeze={slot} value={value.freeze?.attempts ?? 0} onChange={(event) => set({ freeze: Number(event.target.value) ? { attempts: Number(event.target.value) } : undefined })}>
                {range(Math.max(options.freeze.max, value.freeze?.attempts ?? 0)).map((count) => <option key={count} value={count}>{count}</option>)}
              </Select>
            </Field>
          )}
          {confusion && (
            <Field id={`${id}-confusion`} label={<>Confusion turns so far<Whose name={name} /></>} error={issues.confusion}>
              <Select data-doubles-confusion-turns={slot} value={confusion.attempts} onChange={(event) => set({ confusion: { ...confusion, attempts: Number(event.target.value) } })}>
                {range(Math.max(4, confusion.attempts)).map((count) => <option key={count} value={count}>{count}</option>)}
              </Select>
            </Field>
          )}
          {options.toxic && (
            <Field id={`${id}-toxic`} label={<>Bad poison turns so far<Whose name={name} /></>} error={issues.toxic}>
              <Select data-doubles-toxic={slot} value={value.toxic ?? 0} onChange={(event) => set({ toxic: Number(event.target.value) || undefined })}>
                {range(Math.max(15, value.toxic ?? 0)).map((count) => <option key={count} value={count}>{count}</option>)}
              </Select>
            </Field>
          )}
          {options.substitute && value.substitute !== undefined && (
            <Field id={`${id}-substitute-hp`} label={<>Substitute HP<Whose name={name} /></>} error={[issues.substitute, subError].filter(Boolean).join(" ") || undefined}>
              <NumberInput data-doubles-substitute-hp={slot} value={value.substitute} min={1} max={options.substitute.max}
                onValueChange={(hp) => {
                  if (hp === null) { setOutside(null); return; }
                  const used = Math.min(options.substitute!.max, Math.max(1, hp));
                  // An unchanged bound leaves the typed text in the field, so the field says which HP the turn uses.
                  setOutside(used !== hp && used === value.substitute ? { typed: hp, used, max: options.substitute!.max } : null);
                  set({ substitute: used });
                }} />
            </Field>
          )}
          {inputs.map((entry) => <EarlierInput key={entry.key} id={controlId(id, entry)} control={entry} whose={name} apply={apply} />)}
        </div>
      )}
    </div>
  );
}

const SIDE_IDS = { attackerSide: "own", defenderSide: "opponent" } as const;
/** A side control's screen-reader suffix (": your side"), by side fieldset. */
export const SIDE_NAMES = { attackerSide: "your side", defenderSide: "the opponent's side" } as const;

/**
 * The field's earlier-turn controls (doubles-inputs earlierFieldControls), for BattleConditions to place in 2v2: "weather"
 * under the Weather and Terrain selects (Weather ends this turn, Terrain ends this turn), "shared" at the end of Shared field
 * effects (Mud Sport and Water Sport in USUM, Gravity and Magic Room ending while on, then Entered first, Last move in the
 * battle and Echoed Voice turns in a row when the turn reads them). Nothing without EarlierTurnContext or controls.
 */
export function EarlierFieldFields({ id, part }: { id: string; part: "weather" | "shared" }) {
  const earlier = useEarlierTurn();
  const controls = earlier ? earlierFieldControls(earlier.doubles, part, earlier.issues?.field) : [];
  if (!earlier || !controls.length) return null;
  const { checks, inputs } = split(controls);
  return (
    <div data-doubles-field-earlier={part} className="min-w-0">
      {checks.length > 0 && (
        <div className={part === "weather" ? "flex flex-wrap gap-x-6" : styles.toggles}>
          {checks.map((entry) => <EarlierCheckbox key={entry.key} id={controlId(id, entry)} control={entry} apply={earlier.apply} />)}
        </div>
      )}
      {inputs.length > 0 && (
        <div className={`${styles.fields} pb-1`}>
          {inputs.map((entry) => <EarlierInput key={entry.key} id={controlId(id, entry)} control={entry} apply={earlier.apply} />)}
        </div>
      )}
    </div>
  );
}

/**
 * One side fieldset's controls for earlier turns (BattleConditions' render calls it after the side's toggles): with
 * EarlierTurnContext, the side's conditions first (doubles-inputs earlierSideControls: Safeguard, Mist, Lucky Chant, the
 * G-Max side conditions, No Pokémon left to switch in, Lost a Pokémon last turn), each label read with ": your side" or ":
 * the opponent's side"; then (status2 R-U) the side's Bench and Hazards (BenchFields); then each of the side's Pokémon with
 * controls, in the order given, with its Charge (`charge`) and its ADDENDUM2 §5.2 controls (earlierSlotControls, its Replacement
 * among them). `id` prefixes each Pokémon's group id (`{id}-{slot}`) and the side's (`{id}-{side}-…`).
 */
export default function EarlierTurnFields({ id, side, carried, charge }: { id: string; side: Side; carried: readonly CarriedControl[]; charge: readonly ChargeToggle[] }) {
  const earlier = useEarlierTurn();
  const own = earlier ? split(earlierSideControls(earlier.doubles, SIDE_IDS[side], earlier.issues?.field)) : null;
  return (
    <>
      {earlier && own && (own.checks.length > 0 || own.inputs.length > 0) && (
        <div data-doubles-side-earlier={SIDE_IDS[side]} className="min-w-0">
          {own.checks.length > 0 && (
            <div className={`${styles.sideChecks} grid grid-cols-2 gap-x-2`}>
              {own.checks.map((entry) => <EarlierCheckbox key={entry.key} id={controlId(`${id}-${side}`, entry)} control={entry} whose={SIDE_NAMES[side]} apply={earlier.apply} />)}
            </div>
          )}
          {own.inputs.length > 0 && (
            <div className={`${styles.fields} ${styles.sideInputs} pb-1`}>
              {own.inputs.map((entry) => <EarlierInput key={entry.key} id={controlId(`${id}-${side}`, entry)} control={entry} whose={SIDE_NAMES[side]} apply={earlier.apply} />)}
            </div>
          )}
        </div>
      )}
      {/* status2 R-U (IN §5.7): the side's Bench and Hazards, before its Pokémon (each Pokémon's Replacement is in its group). */}
      {earlier && <BenchFields id={`${id}-${side}-bench`} side={SIDE_IDS[side]} />}
      {carried.filter((control) => control.side === side).map((control) => (
        <CarriedFields key={control.slot} id={`${id}-${control.slot}`} control={control} charge={charge.find((entry) => entry.slot === control.slot)}
          earlier={earlier ? earlierSlotControls(earlier.doubles, control.slot, earlier.issues?.pokemon[control.slot]) : undefined} onEarlier={earlier?.apply} />
      ))}
    </>
  );
}
