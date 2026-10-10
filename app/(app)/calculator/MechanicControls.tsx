"use client";

import { useId } from "react";
import { Button, Field, Select } from "@/app/components/ui";
import { validateMechanic } from "@/app/lib/battle/mechanics";
import { TERA_TYPES } from "@/app/lib/battle/profiles";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleMechanic, BuildIssue } from "@/app/lib/battle/types";

type ConfigurationProps = {
  build: BattleBuild;
  runtime?: BattleRuntime;
};

/** Foreign set metadata stays visible without becoming an active transformation. */
export function RetainedConfiguration({ build, runtime = championsRuntime }: ConfigurationProps) {
  const config = build.configuration;
  if (!config) return null;
  const retained = [
    !runtime.profile.tera && config.teraType ? `Tera Type: ${config.teraType}` : null,
    !runtime.profile.dynamax && config.gigantamax !== undefined ? `Gigantamax factor: ${config.gigantamax ? "Yes" : "No"}` : null,
    !runtime.profile.dynamax && config.dynamaxLevel !== undefined ? `Dynamax Level: ${config.dynamaxLevel}` : null,
    runtime.profile.generation !== 7 && config.hiddenPowerType ? `Hidden Power: ${config.hiddenPowerType}` : null,
  ].filter(Boolean);
  return retained.length ? <p className="mt-2 wrap-anywhere text-xs text-muted">{retained.join(" · ")} — retained; inactive in {runtime.profile.label}.</p> : null;
}

export function TeraTypeField({ build, runtime = championsRuntime, id, issues = [], onChange }: ConfigurationProps & {
  id: string;
  issues?: BuildIssue[];
  onChange: (build: BattleBuild) => void;
}) {
  if (!runtime.profile.tera) return null;
  const required = runtime.speciesById.get(build.speciesId)?.requiredTeraType;
  const value = build.configuration?.teraType ?? "";
  return (
    <Field id={id} label="Tera Type" error={issues.filter((issue) => issue.field === "configuration.teraType").map((issue) => issue.message).join(" ")}
      help={required ? `This form requires ${required}.` : undefined}>
      <Select value={value} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, teraType: event.target.value || undefined } })}>
        <option value="">—</option>
        {value && !TERA_TYPES.some((type) => type === value) && <option value={value} disabled>{value} — invalid type</option>}
        {TERA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </Select>
    </Field>
  );
}

export default function MechanicControls({ build, runtime = championsRuntime, label: pokemonLabel, onToggle }: ConfigurationProps & {
  /** The Pokémon's name in its labels, its full name ("Charizard (yours)" in a mirror); defaults to the species name. */
  label?: string;
  onToggle?: (mechanic: BattleMechanic) => void;
}) {
  const id = useId();
  const options: { mechanic: BattleMechanic; label: string }[] = runtime.profile.tera
    ? [{ mechanic: "tera", label: "Tera" }]
    : runtime.profile.dynamax ? [{ mechanic: "dynamax", label: "Dynamax" }, { mechanic: "gigantamax", label: "Gigantamax" }] : [];
  if (!options.length) return null;
  const name = pokemonLabel ?? runtime.speciesById.get(build.speciesId)?.name ?? "Pokémon";
  return (
    <div role="group" aria-label={`${name} battle mechanics`} className="mt-2 flex min-w-0 flex-wrap gap-1">
      {options.map(({ mechanic, label }) => {
        const active = build.mechanic === mechanic;
        const reason = !onToggle ? "Battle mechanic controls are unavailable."
          : active ? null : build.game !== runtime.profile.id ? "This build is for another game."
            : validateMechanic({ ...build, mechanic }, runtime)
              .filter((issue) => ["mechanic", "configuration.teraType", "configuration.gigantamax", "configuration.dynamaxLevel"].includes(issue.field))
              .map((issue) => issue.message).join(" ") || null;
        return (
          <div key={mechanic} className="min-w-0">
            <Button size="sm" variant={active ? "primary" : "secondary"} className="min-h-11 px-2 text-xs"
              data-battle-mechanic={mechanic} aria-label={`${name} ${label}`} aria-pressed={active}
              disabled={!!reason} aria-describedby={reason ? `${id}-${mechanic}-reason` : undefined}
              onClick={() => onToggle?.(mechanic)}>{label}</Button>
            {reason && <p id={`${id}-${mechanic}-reason`} className="mt-1 max-w-xs wrap-anywhere text-xs text-muted">{reason}</p>}
          </div>
        );
      })}
    </div>
  );
}
