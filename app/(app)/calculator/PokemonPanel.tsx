"use client";

import { useId, useState, type ReactNode } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, Field, Input, Select, TableWrap } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { abilitiesById, champions, itemsById, speciesById } from "@/app/lib/battle/catalog";
import {
  ABILITY_ACTIVATION_LABELS,
  defaultAbilityActive,
  getBuildStats,
  NATURES,
  parseIntegerInput,
  STATS,
  STAT_LABELS,
  STATUSES,
} from "@/app/lib/battle/model";
import type { BattleBuild, BattleStatus, BuildIssue } from "@/app/lib/battle/types";

import CurrentHPField from "./CurrentHPField";
import PokemonChooser from "./PokemonChooser";
import { parseBuildInput } from "./build-input";

const itemOptions = [...champions.items].sort((a, b) => a.name.localeCompare(b.name, "en"));
const stages = Array.from({ length: 13 }, (_, index) => index - 6);

/** Keep unfinished Stat Point text visible while its parsed value is invalid. */
function IntegerInput({
  value,
  onValueChange,
  ...props
}: Omit<InputProps, "value" | "onChange"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
}) {
  const format = (number: number | null) => number === null ? "" : String(number);
  const [text, setText] = useState(() => format(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (!Object.is(value, syncedValue)) {
    setSyncedValue(value);
    setText(format(value));
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const nextText = event.target.value;
        const nextValue = parseBuildInput(nextText);
        setText(nextText);
        setSyncedValue(nextValue);
        onValueChange(nextValue);
      }}
    />
  );
}

type Props = {
  side: "attacker" | "defender";
  build: BattleBuild;
  issues: BuildIssue[];
  onChange: (build: BattleBuild) => void;
  hpInput: string;
  onHPChange: (text: string) => void;
  onReveal?: (element: HTMLElement) => void;
  roster?: ReactNode;
  provenance?: string;
  editorRevision?: number;
  panelId?: string;
};

export default function PokemonPanel({ side, build, issues, onChange, hpInput, onHPChange, onReveal, roster, provenance, editorRevision = 0, panelId }: Props) {
  const id = useId();
  const prefix = `${side}-${id}`;
  const position = side === "attacker" ? "left" : "right";
  const label = side === "attacker" ? "Left Pokémon" : "Right Pokémon";
  const [pickerOpen, setPickerOpen] = useState(false);
  const species = speciesById.get(build.speciesId);
  const stats = getBuildStats(build);
  const activationLabel = ABILITY_ACTIVATION_LABELS[build.abilityId];
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const pointIssues = issues.filter((issue) => issue.field === "points" || issue.field.startsWith("points.") || issue.field.startsWith("boosts."));
  const pointsComplete = STATS.every((stat) => build.points[stat] !== null && Number.isFinite(build.points[stat]));
  const total = STATS.reduce((sum, stat) => sum + (build.points[stat] ?? 0), 0);

  return (
    <section id={panelId} aria-labelledby={`${prefix}-heading`} className="min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <h2 id={`${prefix}-heading`} className="text-xs font-semibold uppercase tracking-wide text-accent-text">{label}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="wrap-anywhere text-xl font-bold text-text">{species?.name ?? "Select a Pokémon"}</h3>
        {species?.types.map((type) => <TypeBadge key={type} type={type} />)}
        <Button size="sm" variant="secondary" className="min-h-11" data-calculator-change aria-label={`Change ${position} Pokémon manually`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>Change Pokémon</Button>
      </div>
      <p className="mt-1 wrap-anywhere text-xs text-muted">{provenance ? `Roster selection: ${provenance}` : "Manual build"}</p>
      {errorFor("speciesId") && <p className="mt-2 text-sm text-danger">Unsupported build: {errorFor("speciesId")}</p>}
      <div className="mt-4">
        <CurrentHPField id={`${prefix}-hp`} build={build} issues={issues} text={hpInput} onTextChange={onHPChange} data-calculator-hp />
      </div>
      {roster && <div className="mt-4">{roster}</div>}

      <div data-calculator-build-settings className="mt-4 border-t border-line pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${prefix}-nature`} label="Nature" error={errorFor("nature")}>
            <Select value={build.nature} onChange={(event) => onChange({ ...build, nature: event.target.value })}>
              {NATURES.map((nature) => (
                <option key={nature.name} value={nature.name}>
                  {nature.name} ({nature.plus && nature.minus ? `+${STAT_LABELS[nature.plus]}, −${STAT_LABELS[nature.minus]}` : "neutral"})
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${prefix}-ability`} label="Ability" error={errorFor("abilityId")}>
            <Select value={build.abilityId} onChange={(event) => onChange({ ...build, abilityId: event.target.value, abilityActive: defaultAbilityActive(event.target.value) })}>
              {species?.abilities.map((abilityId) => {
                const ability = abilitiesById.get(abilityId);
                return <option key={abilityId} value={abilityId}>{ability?.name ?? abilityId}{ability?.unsupported.length ? " — unsupported" : ""}</option>;
              })}
            </Select>
          </Field>
          <Field id={`${prefix}-item`} label="Held item" error={errorFor("itemId")} help={species?.requiredItem ? `${itemsById.get(species.requiredItem)?.name ?? species.requiredItem} is required and locked for this form.` : undefined}>
            <Select value={build.itemId} disabled={!!species?.requiredItem} onChange={(event) => onChange({ ...build, itemId: event.target.value })}>
              <option value="">None</option>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.unsupported.length ? " — unsupported" : ""}</option>)}
            </Select>
          </Field>
          <Field id={`${prefix}-status`} label="Status" error={errorFor("status")}>
            <Select value={build.status} onChange={(event) => onChange({ ...build, status: event.target.value as BattleStatus })}>
              {STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </Select>
          </Field>
        </div>

        {activationLabel && (
          <div className="mt-3">
            <label htmlFor={`${prefix}-ability-active`} className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                id={`${prefix}-ability-active`}
                type="checkbox"
                checked={build.abilityActive}
                aria-invalid={!!errorFor("abilityActive") || undefined}
                aria-describedby={`${prefix}-ability-help${errorFor("abilityActive") ? ` ${prefix}-ability-error` : ""}`}
                onChange={(event) => onChange({ ...build, abilityActive: event.target.checked })}
                className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              {activationLabel}
            </label>
            <p id={`${prefix}-ability-help`} className="text-xs text-muted">
              This sets the ability’s condition, not whether the ability exists. Do not manually apply the same entry-stage change twice.
            </p>
            {errorFor("abilityActive") && <p id={`${prefix}-ability-error`} className="mt-1 text-xs text-danger">{errorFor("abilityActive")}</p>}
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">Stats at level 50</h3>
            <p className={`text-xs tabular-nums ${pointsComplete && total > 66 ? "text-danger" : "text-muted"}`}>
              {pointsComplete ? `${total} / 66 Stat Points` : "Stat Point allocation incomplete"}
            </p>
          </div>
          <p id={`${prefix}-points-help`} className="mb-3 text-xs text-muted">Use 0–32 Stat Points per stat, at most 66 total. Stat values are before stages, abilities and items.</p>
          <TableWrap>
            <table className="w-full min-w-[17rem] text-left text-sm" aria-label={`${label} stats and Stat Points`}>
              <thead className="bg-panel-hover text-xs text-muted">
                <tr>
                  <th scope="col" className="px-2 py-2">Stat</th>
                  <th scope="col" className="px-2 py-2">Points</th>
                  <th scope="col" className="px-2 py-2 text-right">Value</th>
                  <th scope="col" className="px-2 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {STATS.map((stat) => (
                  <tr key={stat} className="border-t border-line">
                    <th scope="row" className="px-2 py-2 text-xs font-medium text-text">{STAT_LABELS[stat]}</th>
                    <td className="w-20 px-2 py-2">
                      <Field id={`${prefix}-points-${stat}`} label={`${position} ${STAT_LABELS[stat]} Stat Points`} hideLabel>
                        <IntegerInput
                          key={editorRevision}
                          value={build.points[stat]}
                          aria-invalid={!!errorFor(`points.${stat}`) || !!errorFor("points") || undefined}
                          aria-describedby={`${prefix}-points-help${pointIssues.length ? ` ${prefix}-points-errors` : ""}`}
                          onValueChange={(value) => onChange({ ...build, points: { ...build.points, [stat]: value } })}
                          className="tabular-nums"
                        />
                      </Field>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-text">{stats?.[stat] ?? "—"}</td>
                    <td className="w-20 px-2 py-2">
                      {stat === "hp" ? <span className="text-muted">—</span> : (
                        <>
                          <label htmlFor={`${prefix}-stage-${stat}`} className="sr-only">{position} {STAT_LABELS[stat]} stage</label>
                          <select
                            id={`${prefix}-stage-${stat}`}
                            value={build.boosts[stat] ?? ""}
                            aria-invalid={!!errorFor(`boosts.${stat}`) || undefined}
                            aria-describedby={pointIssues.length ? `${prefix}-points-errors` : undefined}
                            onChange={(event) => onChange({ ...build, boosts: { ...build.boosts, [stat]: parseIntegerInput(event.target.value) } })}
                            className="w-full rounded-lg border border-control-border bg-bg px-1 py-2.5 text-sm text-text focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
                          >
                            {stages.map((stage) => <option key={stage} value={stage}>{stage > 0 ? `+${stage}` : stage}</option>)}
                          </select>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {pointIssues.length > 0 && (
            <ul id={`${prefix}-points-errors`} className="mt-2 space-y-1 text-xs text-danger">
              {pointIssues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
            </ul>
          )}
        </div>
      </div>

      <PokemonChooser side={side} build={build} open={pickerOpen} onClose={() => setPickerOpen(false)} onChange={onChange} onReturnFocus={onReveal} />
    </section>
  );
}
