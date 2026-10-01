"use client";

import { useId } from "react";
import { Field, Select } from "@/app/components/ui";
import { priorityShieldNames, SHARED_FIELD_EFFECTS } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { unmodelledBattleStates } from "@/app/lib/battle/unmodelled-states";
import type { BattleConditions as Conditions, BuildIssue, SideConditions } from "@/app/lib/battle/types";

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

const checkboxClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

type Props = {
  value: Conditions;
  issues: BuildIssue[];
  onChange: (value: Conditions) => void;
  id?: string;
  runtime?: BattleRuntime;
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

export default function BattleConditions({ value, issues, onChange, id, runtime = championsRuntime }: Props) {
  const prefix = useId();
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const singles = value.gameType === "Singles";

  return (
    <section id={id} aria-labelledby={`${prefix}-heading`} className="rounded-xl border border-line bg-panel">
      <h2 id={`${prefix}-heading`} tabIndex={-1} className="rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">
        Field conditions
        <span className="ml-2 font-normal text-muted">
          {describeConditions(value)}
        </span>
        {issues.length > 0 && <span className="ml-2 text-danger">{issues.length} settings to check</span>}
      </h2>
      <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-text">Battle format, weather and terrain</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id={`${prefix}-game-type`} label="Battle format" error={errorFor("gameType")}>
              <Select value={value.gameType} onChange={(event) => onChange({ ...value, gameType: event.target.value as Conditions["gameType"] })}>
                <option value="Singles">Singles</option>
                <option value="Doubles">Doubles</option>
              </Select>
            </Field>
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
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <label htmlFor={`${prefix}-critical`} className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input id={`${prefix}-critical`} type="checkbox" checked={value.critical} onChange={(event) => onChange({ ...value, critical: event.target.checked })} className={checkboxClassName} />
            Critical hit
          </label>
          <label htmlFor={`${prefix}-spread`} className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input id={`${prefix}-spread`} type="checkbox" checked={value.multipleTargets} disabled={value.gameType === "Singles"} onChange={(event) => onChange({ ...value, multipleTargets: event.target.checked })} className={`${checkboxClassName} disabled:opacity-50`} />
            Multiple targets hit
          </label>
        </div>
        <fieldset className="min-w-0 rounded-lg border border-line px-3 pb-3">
          <legend className="px-1 text-sm font-semibold text-text">Shared field effects</legend>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {SHARED_FIELD_EFFECTS.map((effect) => {
              const id = `${prefix}-${effect.key}`;
              const error = errorFor(effect.key);
              const ignored = singles && doublesOnly(effect.key);
              return (
                <div key={effect.key} className="min-w-0">
                  <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-text">
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
                  {error && <p id={`${id}-error`} className="mt-1 text-xs text-danger">{error}</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["attackerSide", "defenderSide"] as const).map((side) => (
            <fieldset key={side} className="min-w-0 rounded-lg border border-line px-3 pb-2">
              <legend className="px-1 text-sm font-semibold text-text">{side === "attackerSide" ? "Left Pokémon’s side" : "Right Pokémon’s side"}</legend>
              <div className="grid grid-cols-2 gap-x-2">
                {sideOptions.map((option) => (
                  <label key={option.key} htmlFor={`${prefix}-${side}-${option.key}`} className="flex min-h-11 items-center gap-2 text-sm text-text">
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
              </div>
            </fieldset>
          ))}
        </div>
        <div role="note" aria-labelledby={`${prefix}-unmodelled`} className="rounded-lg border border-line px-3 py-2 text-xs text-muted">
          <h3 id={`${prefix}-unmodelled`} className="text-sm font-semibold text-text">Battle states that cannot be set here</h3>
          <p className="mt-1">These common states cannot be represented; results assume none is in effect in {runtime.profile.label}:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{unmodelledBattleStates(runtime).map((state) => <li key={state}>{state}.</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
