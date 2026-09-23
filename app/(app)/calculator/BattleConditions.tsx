"use client";

import { useId } from "react";
import { Field, Select } from "@/app/components/ui";
import { SHARED_FIELD_EFFECTS } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions as Conditions, BuildIssue, SideConditions } from "@/app/lib/battle/types";

const sideOptions: { key: keyof SideConditions; label: string }[] = [
  { key: "reflect", label: "Reflect" },
  { key: "lightScreen", label: "Light Screen" },
  { key: "auroraVeil", label: "Aurora Veil" },
  { key: "helpingHand", label: "Helping Hand" },
];

const checkboxClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

type Props = {
  value: Conditions;
  issues: BuildIssue[];
  onChange: (value: Conditions) => void;
  id?: string;
  runtime?: BattleRuntime;
};

export function describeConditions(value: Conditions) {
  const activeConditions = Number(value.critical) + Number(value.gameType === "Doubles" && value.multipleTargets)
    + SHARED_FIELD_EFFECTS.filter(({ key }) => value[key] === true).length
    + Object.values(value.attackerSide).filter(Boolean).length + Object.values(value.defenderSide).filter(Boolean).length;
  return `${value.gameType} · ${value.weather || "No weather"} · ${value.terrain ? `${value.terrain} terrain` : "No terrain"} · ${activeConditions} toggles on`;
}

export default function BattleConditions({ value, issues, onChange, id, runtime = championsRuntime }: Props) {
  const prefix = useId();
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");

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
        <p className="text-xs text-muted">{runtime.profile.label} field rules. Set effects that are already active; move use and duration are not simulated. Weather and terrain are not automatically set by entry abilities. Shared conditions stay in place on Swap; each side’s conditions follow its Pokémon.</p>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-text">Battle format, weather and terrain</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id={`${prefix}-game-type`} label="Battle format" error={errorFor("gameType")}>
              <Select value={value.gameType} onChange={(event) => onChange({ ...value, gameType: event.target.value as Conditions["gameType"] })}>
                <option value="Singles">Singles</option>
                <option value="Doubles">Doubles</option>
              </Select>
            </Field>
            <Field id={`${prefix}-weather`} label="Weather" error={errorFor("weather")} help={`Available weather follows ${runtime.profile.label}, not the battle format.`}>
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
            <input id={`${prefix}-spread`} type="checkbox" checked={value.multipleTargets} disabled={value.gameType === "Singles"} aria-describedby={`${prefix}-spread-help`} onChange={(event) => onChange({ ...value, multipleTargets: event.target.checked })} className={`${checkboxClassName} disabled:opacity-50`} />
            Multiple targets hit
          </label>
        </div>
        <p id={`${prefix}-spread-help`} className="text-xs text-muted">Multiple targets applies only in Doubles and only to eligible spread moves. It does not reduce single-target attacks.</p>
        <fieldset className="min-w-0 rounded-lg border border-line px-3 pb-3">
          <legend className="px-1 text-sm font-semibold text-text">Shared field effects</legend>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {SHARED_FIELD_EFFECTS.map((effect) => {
              const id = `${prefix}-${effect.key}`;
              const error = errorFor(effect.key);
              return (
                <div key={effect.key} className="min-w-0">
                  <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-text">
                    <input
                      id={id}
                      type="checkbox"
                      checked={value[effect.key] === true}
                      aria-invalid={!!error || undefined}
                      aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
                      onChange={(event) => onChange({ ...value, [effect.key]: event.target.checked })}
                      className={checkboxClassName}
                    />
                    {effect.label}
                  </label>
                  <p id={`${id}-help`} className="text-xs text-muted">{effect.description}</p>
                  {error && <p id={`${id}-error`} className="mt-1 text-xs text-danger">{error}</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
        <p id={`${prefix}-sides-help`} className="text-xs text-muted">Screens on the receiving Pokémon’s side reduce incoming damage; Helping Hand on the attacking Pokémon’s side boosts outgoing damage, regardless of left/right position. Aurora Veil does not stack with Reflect or Light Screen and can remain active after {runtime.profile.weather.includes("Hail") ? "Hail" : "Snow"} ends.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["attackerSide", "defenderSide"] as const).map((side) => (
            <fieldset key={side} aria-describedby={`${prefix}-sides-help`} className="min-w-0 rounded-lg border border-line px-3 pb-2">
              <legend className="px-1 text-sm font-semibold text-text">{side === "attackerSide" ? "Left Pokémon’s side" : "Right Pokémon’s side"}</legend>
              <div className="grid grid-cols-2 gap-x-2">
                {sideOptions.map((option) => (
                  <label key={option.key} htmlFor={`${prefix}-${side}-${option.key}`} className="flex min-h-11 items-center gap-2 text-sm text-text">
                    <input
                      id={`${prefix}-${side}-${option.key}`}
                      type="checkbox"
                      checked={value[side][option.key]}
                      onChange={(event) => onChange({ ...value, [side]: { ...value[side], [option.key]: event.target.checked } })}
                      className={checkboxClassName}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </section>
  );
}
