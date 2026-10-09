"use client";

import { createContext, useContext, useId, useState } from "react";
import { Field, NumberInput, Select } from "@/app/components/ui";
import type { DoublesCarried, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { priorityShieldNames, SHARED_FIELD_EFFECTS } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { unmodelledBattleStates } from "@/app/lib/battle/unmodelled-states";
import type { BattleConditions as Conditions, BuildIssue, SideConditions } from "@/app/lib/battle/types";
import type { CarriedOptions } from "./doubles-prep";
import styles from "./calculator.module.css";

const sideOptions: { key: keyof SideConditions; label: string | ((runtime: BattleRuntime) => string) }[] = [
  { key: "reflect", label: "Reflect" },
  { key: "lightScreen", label: "Light Screen" },
  { key: "auroraVeil", label: "Aurora Veil" },
  { key: "helpingHand", label: "Helping Hand" },
  { key: "friendGuard", label: "Partner has Friend Guard" },
  { key: "priorityShield", label: (runtime) => `Partner has ${priorityShieldNames(runtime)}` },
  { key: "protect", label: "Protecting" },
  { key: "tailwind", label: "Tailwind" },
  { key: "charge", label: "Charge" },
];

/**
 * 2v2 sets these from the four Pokémon and their moves (doubles-types DoublesTurnInput field), so its editor leaves them out:
 * the format, the spread modifier, the extra Fairy Aura, and each side's Helping Hand, partner abilities, Protect and Charge.
 */
const DOUBLES_DERIVED = new Set<string>(["fairyAura", "helpingHand", "friendGuard", "priorityShield", "protect", "charge"]);
const DOUBLES_SIDE_KEYS = sideOptions.filter((option) => !DOUBLES_DERIVED.has(option.key)).map((option) => option.key);

const checkboxClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

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
 * The 2v2 state-from-earlier-turns controls for BattleConditions when its owner does not pass them (useDoublesView
 * provides it around DoublesSettings, which renders the Field conditions).
 */
export const DoublesCarriedContext = createContext<readonly CarriedControl[]>([]);

/** The 2v2 state-from-earlier-turns controls DoublesCarriedContext provides. */
export function useDoublesCarried(): readonly CarriedControl[] {
  return useContext(DoublesCarriedContext);
}

type Props = {
  value: Conditions;
  issues: BuildIssue[];
  onChange: (value: Conditions) => void;
  runtime?: BattleRuntime;
  /** Each side's Pokémon, which names its side. */
  names?: Partial<Record<Side, string>>;
  /** "doubles": the 2v2 field, without the controls its Pokémon and moves decide (DOUBLES_DERIVED). */
  variant?: "matchup" | "doubles";
  /** The side fieldsets' legends ("Your side", "Opponent's side" in 2v2; a 1v1 mirror's "Charizard’s side (yours)"), in place of the Pokémon names. */
  sideLegends?: Record<Side, string>;
  /** 2v2: one Charge checkbox per Pokémon, inside its side's fieldset. */
  charge?: readonly ChargeToggle[];
  /** 2v2: each Pokémon's state from earlier turns, inside its side's fieldset with its Charge; default DoublesCarriedContext's. */
  carried?: readonly CarriedControl[];
};

/** Settings that need an ally; Singles ignores them. */
const doublesOnly = (key: string) => key === "helpingHand" || key === "fairyAura" || key === "friendGuard" || key === "priorityShield";

export function describeConditions(value: Conditions) {
  const counts = (key: string, on: boolean) => on && !(value.gameType === "Singles" && doublesOnly(key));
  const activeConditions = Number(value.critical) + Number(value.gameType === "Doubles" && value.multipleTargets)
    + SHARED_FIELD_EFFECTS.filter(({ key }) => counts(key, value[key] === true)).length
    + Object.entries(value.attackerSide).filter(([key, on]) => counts(key, on)).length
    + Object.entries(value.defenderSide).filter(([key, on]) => counts(key, on)).length;
  return `${value.gameType} · ${value.weather || "No weather"} · ${value.terrain ? `${value.terrain} terrain` : "No terrain"} · ${activeConditions} toggles on`;
}

/**
 * The checkboxes ticked among a Pokémon's state-from-earlier-turns controls, as CarriedFields shows them: Confused, Rest
 * sleep, Substitute. A fainted Pokémon (NO_CARRIED_OPTIONS) shows none, though it keeps its state.
 */
function carriedToggles({ options, value }: Pick<CarriedControl, "options" | "value">) {
  return Number(options.confusion && !!value.confusion) + Number(!!options.sleep && !!value.sleep?.rest) + Number(!!options.substitute && value.substitute !== undefined);
}

/**
 * The 2v2 Field conditions summary: "Doubles · No weather · No terrain · 2 toggles on", counting only the toggles its editor
 * shows (each Pokémon's Charge, and the Confused, Rest sleep and Substitute of its state from earlier turns).
 */
export function describeDoublesConditions(value: Conditions, charged: Readonly<Partial<Record<DoublesSlotId, boolean>>>, carried: readonly Pick<CarriedControl, "options" | "value">[] = []) {
  const activeConditions = Number(value.critical)
    + SHARED_FIELD_EFFECTS.filter(({ key }) => !DOUBLES_DERIVED.has(key) && value[key] === true).length
    + (["attackerSide", "defenderSide"] as const).reduce((sum, side) => sum + DOUBLES_SIDE_KEYS.filter((key) => value[side][key]).length, 0)
    + Object.values(charged).filter(Boolean).length
    + carried.reduce((sum, control) => sum + carriedToggles(control), 0);
  return `Doubles · ${value.weather || "No weather"} · ${value.terrain ? `${value.terrain} terrain` : "No terrain"} · ${activeConditions} toggles on`;
}

const range = (max: number) => Array.from({ length: max + 1 }, (_, index) => index);

/** A label's name for screen readers when its group already shows it: "Confused" reads "Confused: Garchomp". */
function Whose({ name }: { name: string }) {
  return <span className="sr-only">: {name}</span>;
}

/**
 * One 2v2 Pokémon's Charge and state from earlier turns (data-doubles-carried), named by the Pokémon: checkboxes first,
 * then the counts that apply to its status. A count left at 0 is the turn's assumption, which the turn states. Only what
 * `options` offers shows: a fainted Pokémon keeps its state, unseen, for when its HP comes back.
 */
function CarriedFields({ id, control, charge }: { id: string; control: CarriedControl; charge?: ChargeToggle }) {
  const { slot, name, options, value, issues = {}, onChange } = control;
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
  const counts = !!options.sleep || !!options.freeze || !!confusion || options.toxic || (!!options.substitute && value.substitute !== undefined);
  return (
    <div role="group" aria-labelledby={`${id}-name`} data-doubles-carried={slot} className="mt-1 min-w-0 border-t border-line pt-1">
      <p id={`${id}-name`} className="wrap-anywhere text-xs font-semibold text-text">{name}</p>
      <div className="grid grid-cols-2 gap-x-2">
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
      </div>
      {counts && (
        <div className={`${styles.fields} pb-1`}>
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
        </div>
      )}
    </div>
  );
}

/** The field editor, in its collapsible Field conditions section (CalculatorClient). */
export default function BattleConditions({ value, issues, onChange, runtime = championsRuntime, names = {}, variant = "matchup", sideLegends, charge = [], carried: carriedProp }: Props) {
  const prefix = useId();
  const provided = useDoublesCarried();
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const singles = value.gameType === "Singles";
  const doubles = variant === "doubles";
  const carried = doubles ? carriedProp ?? provided : [];
  // Named after its Pokémon; the position is shown only to tell two of the same species apart.
  const sideLegend = (side: Side) => {
    if (sideLegends) return sideLegends[side];
    const position = side === "attackerSide" ? "left" : "right";
    const name = names[side];
    if (!name) return `${side === "attackerSide" ? "Left" : "Right"} Pokémon’s side`;
    return names.attackerSide === names.defenderSide ? `${name}’s side (${position})` : <>{name}’s side<span className="sr-only"> ({position})</span></>;
  };

  return (
    <div data-calculator-field className={styles.editor}>
      <fieldset className="min-w-0">
        <legend className="sr-only">{doubles ? "Weather and terrain" : "Battle format, weather and terrain"}</legend>
        <div className={styles.fields}>
          {!doubles && <Field id={`${prefix}-game-type`} label="Battle format" error={errorFor("gameType")}>
            <Select value={value.gameType} onChange={(event) => onChange({ ...value, gameType: event.target.value as Conditions["gameType"] })}>
              <option value="Singles">Singles</option>
              <option value="Doubles">Doubles</option>
            </Select>
          </Field>}
          <Field id={`${prefix}-weather`} label="Weather" error={errorFor("weather")}>
            <Select value={value.weather} onChange={(event) => onChange({ ...value, weather: event.target.value as Conditions["weather"] })}>
              {!runtime.profile.weather.includes(value.weather) && <option value={value.weather} disabled>{value.weather} — unavailable in this game</option>}
              {runtime.profile.weather.map((weather) => <option key={weather} value={weather}>{weather || "None"}</option>)}
            </Select>
          </Field>
          <Field id={`${prefix}-terrain`} label="Terrain" error={errorFor("terrain")}>
            <Select value={value.terrain} onChange={(event) => onChange({ ...value, terrain: event.target.value as Conditions["terrain"] })}>
              <option value="">None</option>
              <option value="Electric">Electric</option>
              <option value="Grassy">Grassy</option>
              <option value="Misty">Misty</option>
              <option value="Psychic">Psychic</option>
            </Select>
          </Field>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-6">
        <label htmlFor={`${prefix}-critical`} className="flex min-h-11 items-center gap-2 text-text">
          <input id={`${prefix}-critical`} type="checkbox" checked={value.critical} onChange={(event) => onChange({ ...value, critical: event.target.checked })} className={checkboxClassName} />
          Critical hit
        </label>
        {!doubles && <label htmlFor={`${prefix}-spread`} className="flex min-h-11 items-center gap-2 text-text">
          <input id={`${prefix}-spread`} type="checkbox" checked={value.multipleTargets} disabled={value.gameType === "Singles"} onChange={(event) => onChange({ ...value, multipleTargets: event.target.checked })} className={`${checkboxClassName} disabled:opacity-50`} />
          Multiple targets hit
        </label>}
      </div>
      <fieldset className="min-w-0 rounded-lg border border-line px-2 pb-1">
        <legend className="px-1 text-xs font-semibold text-text">Shared field effects</legend>
        <div className={styles.toggles}>
          {SHARED_FIELD_EFFECTS.filter((effect) => !doubles || !DOUBLES_DERIVED.has(effect.key)).map((effect) => {
            const id = `${prefix}-${effect.key}`;
            const error = errorFor(effect.key);
            const ignored = singles && doublesOnly(effect.key);
            return (
              <div key={effect.key} className="min-w-0">
                <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-text">
                  <input
                    id={id}
                    type="checkbox"
                    checked={value[effect.key] === true}
                    disabled={ignored}
                    aria-invalid={!!error || undefined}
                    aria-describedby={[ignored && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
                    onChange={(event) => onChange({ ...value, [effect.key]: event.target.checked })}
                    className={doublesOnly(effect.key) ? `${checkboxClassName} disabled:opacity-50` : checkboxClassName}
                  />
                  {effect.label}
                </label>
                {ignored && <p id={`${id}-help`} className="text-xs text-muted">Ignored in Singles.</p>}
                {error && <p id={`${id}-error`} className="mb-1 text-xs text-danger">{error}</p>}
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className={styles.fieldSides}>
        {(["attackerSide", "defenderSide"] as const).map((side) => (
          <fieldset key={side} className="min-w-0 rounded-lg border border-line px-2 pb-1">
            <legend className="px-1 text-xs font-semibold text-text">{sideLegend(side)}</legend>
            <div className="grid grid-cols-2 gap-x-2">
              {sideOptions.filter((option) => !doubles || !DOUBLES_DERIVED.has(option.key)).map((option) => (
                <label key={option.key} htmlFor={`${prefix}-${side}-${option.key}`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
                  <input
                    id={`${prefix}-${side}-${option.key}`}
                    type="checkbox"
                    checked={value[side][option.key]}
                    disabled={singles && doublesOnly(option.key)}
                    onChange={(event) => onChange({ ...value, [side]: { ...value[side], [option.key]: event.target.checked } })}
                    className={doublesOnly(option.key) ? `${checkboxClassName} disabled:opacity-50` : checkboxClassName}
                  />
                  {typeof option.label === "function" ? option.label(runtime) : option.label}
                </label>
              ))}
              {/* A Charge without state-from-earlier-turns controls for its Pokémon stays among the side's toggles. */}
              {charge.filter((entry) => entry.side === side && !carried.some((control) => control.slot === entry.slot)).map((entry) => (
                <label key={entry.slot} htmlFor={`${prefix}-charged-${entry.slot}`} className="flex min-h-11 min-w-0 items-center gap-2 wrap-anywhere text-text">
                  <input id={`${prefix}-charged-${entry.slot}`} type="checkbox" data-doubles-charge={entry.slot} checked={entry.checked} onChange={(event) => entry.onChange(event.target.checked)} className={checkboxClassName} />
                  Charge: {entry.name}
                </label>
              ))}
            </div>
            {carried.filter((control) => control.side === side).map((control) => (
              <CarriedFields key={control.slot} id={`${prefix}-carried-${control.slot}`} control={control} charge={charge.find((entry) => entry.slot === control.slot)} />
            ))}
          </fieldset>
        ))}
      </div>
      <div role="note" aria-labelledby={`${prefix}-unmodelled`} className="rounded-lg border border-line px-3 py-2 text-xs text-muted">
        <h3 id={`${prefix}-unmodelled`} className="text-sm font-semibold text-text">Battle states that cannot be set here</h3>
        <p className="mt-1">These common states cannot be represented; results assume none is in effect in {runtime.profile.label}:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">{unmodelledBattleStates(runtime).map((state) => <li key={state}>{state}.</li>)}</ul>
      </div>
    </div>
  );
}
