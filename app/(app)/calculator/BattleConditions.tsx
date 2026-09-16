"use client";

import { useId } from "react";
import { Field, Select } from "@/app/components/ui";
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
};

export default function BattleConditions({ value, issues, onChange }: Props) {
  const prefix = useId();
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const activeConditions = Number(value.critical) + Number(value.gameType === "Doubles" && value.multipleTargets)
    + Object.values(value.attackerSide).filter(Boolean).length + Object.values(value.defenderSide).filter(Boolean).length;

  return (
    <details className="rounded-xl border border-line bg-panel">
      <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">
        Field conditions
        <span className="ml-2 font-normal text-muted">
          {value.gameType} · {value.weather || "No weather"} · {value.terrain ? `${value.terrain} terrain` : "No terrain"} · {activeConditions} toggles on
        </span>
      </summary>
      <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="text-xs text-muted">Weather and terrain are explicit field state, not automatically set by entry abilities. Shared conditions stay in place on Swap; each side’s conditions follow its Pokémon.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${prefix}-game-type`} label="Battle format" error={errorFor("gameType")}>
            <Select value={value.gameType} onChange={(event) => onChange({ ...value, gameType: event.target.value as Conditions["gameType"] })}>
              <option value="Singles">Singles</option>
              <option value="Doubles">Doubles</option>
            </Select>
          </Field>
          <Field id={`${prefix}-weather`} label="Weather" error={errorFor("weather")}>
            <Select value={value.weather} onChange={(event) => onChange({ ...value, weather: event.target.value as Conditions["weather"] })}>
              <option value="">None</option>
              <option value="Sun">Sun</option>
              <option value="Rain">Rain</option>
              <option value="Sand">Sand</option>
              <option value="Snow">Snow</option>
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
        <div className="grid gap-4 sm:grid-cols-2">
          {(["attackerSide", "defenderSide"] as const).map((side) => (
            <fieldset key={side} className="min-w-0 rounded-lg border border-line px-3 pb-2">
              <legend className="px-1 text-sm font-semibold text-text">{side === "attackerSide" ? "Attacker’s side" : "Defender’s side"}</legend>
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
    </details>
  );
}
