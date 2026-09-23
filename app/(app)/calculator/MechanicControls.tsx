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

export function TeraTypeField({ build, runtime = championsRuntime, id, issues = [], onChange, compact = false }: ConfigurationProps & {
  id: string;
  issues?: BuildIssue[];
  onChange: (build: BattleBuild) => void;
  compact?: boolean;
}) {
  if (!runtime.profile.tera) return null;
  const required = runtime.speciesById.get(build.speciesId)?.requiredTeraType;
  const value = build.configuration?.teraType ?? "";
  return (
    <Field id={id} label="Tera Type" error={issues.filter((issue) => issue.field === "configuration.teraType").map((issue) => issue.message).join(" ")}
      help={required ? `This form requires ${required}. Configuration alone does not activate Tera.` : compact ? undefined : "Configuring a type does not activate Terastallization. Use the Tera button by the Pokémon’s name."}>
      <Select value={value} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, teraType: event.target.value || undefined } })}>
        <option value="">Choose Tera type</option>
        {value && !TERA_TYPES.some((type) => type === value) && <option value={value} disabled>{value} — invalid type</option>}
        {TERA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </Select>
    </Field>
  );
}

export default function MechanicControls({ build, runtime = championsRuntime, position, onToggle }: ConfigurationProps & {
  position: "left" | "right";
  onToggle?: (mechanic: BattleMechanic) => void;
}) {
  const id = useId();
  const options: { mechanic: BattleMechanic; label: string }[] = runtime.profile.tera
    ? [{ mechanic: "tera", label: "Tera" }]
    : runtime.profile.dynamax ? [{ mechanic: "dynamax", label: "Dynamax" }, { mechanic: "gigantamax", label: "Gigantamax" }] : [];
  if (!options.length) return null;
  const name = runtime.speciesById.get(build.speciesId)?.name ?? "Pokémon";
  return (
    <div className="mt-2 min-w-0">
      <div role="group" aria-label={`${name} ${position} battle mechanics`} className="flex flex-wrap gap-1">
        {options.map(({ mechanic, label }) => {
          const active = build.mechanic === mechanic;
          const reason = !onToggle ? "Battle mechanic controls are unavailable."
            : active ? null : build.game !== runtime.profile.id ? "Choose a build for this battle game."
              : validateMechanic({ ...build, mechanic }, runtime)
                .filter((issue) => ["mechanic", "configuration.teraType", "configuration.gigantamax", "configuration.dynamaxLevel"].includes(issue.field))
                .map((issue) => issue.message).join(" ") || null;
          return (
            <div key={mechanic} className="min-w-0">
              <Button size="sm" variant={active ? "primary" : "secondary"} className="min-h-11 px-2 text-xs"
                data-battle-mechanic={mechanic} aria-label={`${name} ${position} ${label}`} aria-pressed={active}
                disabled={!!reason} aria-describedby={reason ? `${id}-${mechanic}-reason` : `${id}-help`}
                onClick={() => onToggle?.(mechanic)}>{label}</Button>
              {reason && <p id={`${id}-${mechanic}-reason`} className="mt-1 max-w-xs wrap-anywhere text-xs text-muted">{reason}{mechanic === "gigantamax" && !build.configuration?.gigantamax ? " Set the Gigantamax factor in Build settings." : ""}</p>}
            </div>
          );
        })}
      </div>
      <p id={`${id}-help`} className="mt-1 text-xs text-muted">{runtime.profile.tera ? "Tera" : "Dynamax / Gigantamax"}: {options.some((option) => option.mechanic === build.mechanic) ? "active; click its button to deactivate." : "inactive. Set configuration never activates it automatically."}</p>
    </div>
  );
}
