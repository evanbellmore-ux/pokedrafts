"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, Field, Input, Select, TableWrap } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { HIDDEN_POWER_TYPES } from "@/app/lib/battle/mechanics";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
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
import { RetainedConfiguration, TeraTypeField } from "./MechanicControls";
import { parseBuildInput } from "./build-input";
const stages = Array.from({ length: 13 }, (_, index) => index - 6);

/** Keep unfinished numeric text visible while its parsed value is invalid. */
function IntegerInput({
  value,
  onValueChange,
  allowUnset = false,
  ...props
}: Omit<InputProps, "value" | "onChange"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  allowUnset?: boolean;
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
        const nextValue = parseBuildInput(nextText, allowUnset);
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
  runtime?: BattleRuntime;
};

export default function PokemonPanel({ side, build, issues, onChange, hpInput, onHPChange, onReveal, roster, provenance, editorRevision = 0, panelId, runtime = championsRuntime }: Props) {
  const id = useId();
  const prefix = `${side}-${id}`;
  const position = side === "attacker" ? "left" : "right";
  const label = side === "attacker" ? "Left Pokémon" : "Right Pokémon";
  const [pickerOpen, setPickerOpen] = useState(false);
  const species = runtime.speciesById.get(build.speciesId);
  const stats = getBuildStats(build, runtime);
  const itemOptions = useMemo(() => [...runtime.catalog.items].sort((a, b) => a.name.localeCompare(b.name, "en")), [runtime]);
  const activationLabel = ABILITY_ACTIVATION_LABELS[build.abilityId];
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const trainingIssues = issues.filter((issue) => issue.field === "points" || issue.field.startsWith("points.") || issue.field.startsWith("native.") || issue.field.startsWith("boosts."));
  const allocation = build.game === "champions" ? build.points : build.native.evs;
  const allocationComplete = STATS.every((stat) => allocation[stat] !== null && Number.isFinite(allocation[stat]));
  const total = STATS.reduce((sum, stat) => sum + (allocation[stat] ?? 0), 0);
  const budget = build.game === "champions" ? 66 : 510;
  const level = build.game === "champions" ? 50 : build.native.level;
  const innateIVs = build.game !== "champions" ? build.native.innateIVs : undefined;

  return (
    <section id={panelId} aria-labelledby={`${prefix}-heading`} className="min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <h2 id={`${prefix}-heading`} className="text-xs font-semibold uppercase tracking-wide text-accent-text">{label}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="wrap-anywhere text-xl font-bold text-text">{species?.name ?? "Select a Pokémon"}</h3>
        {species?.types.map((type) => <TypeBadge key={type} type={type} />)}
        <Button size="sm" variant="secondary" className="min-h-11" data-calculator-change aria-label={`Change ${position} Pokémon manually`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>Change Pokémon</Button>
      </div>
      <p className="mt-1 wrap-anywhere text-xs text-muted">{provenance ? `Roster selection: ${provenance}` : "Manual build"}</p>
      {runtime.profile.tera && build.mechanic === "tera" && build.configuration?.teraType && <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">Active Tera: <TypeBadge type={build.configuration.teraType} />{build.configuration.teraType === "Stellar" ? "Original defensive types are retained." : "Defensive typing; original types above still determine original STAB."}</p>}
      {errorFor("speciesId") && <p className="mt-2 text-sm text-danger">Unsupported build: {errorFor("speciesId")}</p>}
      {errorFor("game") && <p className="mt-2 text-sm text-danger">{errorFor("game")}</p>}
      <div className="mt-4">
        <CurrentHPField id={`${prefix}-hp`} build={build} issues={issues} text={hpInput} onTextChange={onHPChange} runtime={runtime} data-calculator-hp />
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
                const ability = runtime.abilitiesById.get(abilityId);
                return <option key={abilityId} value={abilityId}>{ability?.name ?? abilityId}{ability?.unsupported.length ? " — unsupported" : ""}</option>;
              })}
            </Select>
          </Field>
          <Field id={`${prefix}-item`} label="Held item" error={errorFor("itemId")} help={species?.requiredItem ? `${runtime.itemsById.get(species.requiredItem)?.name ?? species.requiredItem} is required and locked for this form.` : undefined}>
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

        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold text-text">Set configuration</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${prefix}-gender`} label="Gender" error={errorFor("configuration.gender")} help={species?.gender ? `This species has fixed gender: ${species.gender === "N" ? "genderless" : species.gender === "M" ? "male" : "female"}.` : "Leave unknown unless confirmed. Rivalry needs both Pokémon’s genders."}>
              <Select value={build.configuration?.gender ?? ""} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, gender: event.target.value ? event.target.value as "M" | "F" | "N" : undefined } })}>
                <option value="">{species?.gender ? "Use species gender" : "Unknown"}</option>
                <option value="M" disabled={!!species?.gender && species.gender !== "M"}>Male</option>
                <option value="F" disabled={!!species?.gender && species.gender !== "F"}>Female</option>
                <option value="N" disabled={!!species?.gender && species.gender !== "N"}>Genderless</option>
              </Select>
            </Field>
            <Field id={`${prefix}-happiness`} label="Happiness" error={errorFor("configuration.happiness")} help="0–255. Blank uses 255 for supported Return / Frustration calculations; other moves are unchanged.">
              <IntegerInput key={editorRevision} value={build.configuration?.happiness ?? null} allowUnset placeholder="Default (255)" onValueChange={(happiness) => onChange({ ...build, configuration: { ...build.configuration, happiness: happiness ?? undefined } })} />
            </Field>
            <TeraTypeField id={`${prefix}-tera-type`} build={build} issues={issues} onChange={onChange} runtime={runtime} />
            {runtime.profile.dynamax && <>
              <Field id={`${prefix}-dynamax-level`} label="Dynamax Level" error={errorFor("configuration.dynamaxLevel")} help="0–10. Blank uses 10. Sets the HP multiplier only when Dynamax or Gigantamax is active.">
                <IntegerInput key={editorRevision} value={build.configuration?.dynamaxLevel ?? null} allowUnset placeholder="Default (10)" onValueChange={(dynamaxLevel) => onChange({ ...build, configuration: { ...build.configuration, dynamaxLevel: dynamaxLevel ?? undefined } })} />
              </Field>
              <Field id={`${prefix}-gigantamax`} label="Gigantamax factor" error={errorFor("configuration.gigantamax")} help={species?.canGigantamax ? "An eligible factor is configuration, not activation. Use Gigantamax by the Pokémon’s name." : "This species has no verified Gigantamax factor. Dynamax eligibility is separate."}>
                <Select value={build.configuration?.gigantamax === undefined ? "" : build.configuration.gigantamax ? "yes" : "no"} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, gigantamax: event.target.value === "" ? undefined : event.target.value === "yes" } })}>
                  <option value="">Not specified</option><option value="no">No</option><option value="yes" disabled={!species?.canGigantamax}>Yes</option>
                </Select>
              </Field>
            </>}
            {runtime.profile.generation === 7 && <Field id={`${prefix}-hidden-power`} label="Hidden Power type" error={errorFor("configuration.hiddenPowerType")} help="Optional declared type; it must match innate IVs. This never rewrites effective IVs.">
              <Select value={build.configuration?.hiddenPowerType ?? ""} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, hiddenPowerType: event.target.value || undefined } })}>
                <option value="">Determine from innate IVs</option>
                {HIDDEN_POWER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </Select>
            </Field>}
          </div>
          <RetainedConfiguration build={build} runtime={runtime} />
          {errorFor("mechanic") && <p className="text-xs text-danger">{errorFor("mechanic")}</p>}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">Stats at level {level ?? "—"}</h3>
            <p className={`text-xs tabular-nums ${allocationComplete && total > budget ? "text-danger" : "text-muted"}`}>
              {allocationComplete ? `${total} / ${budget} ${build.game === "champions" ? "Stat Points" : "EVs"}` : `${build.game === "champions" ? "Stat Point" : "EV"} allocation incomplete`}
            </p>
          </div>
          {build.game !== "champions" && <div className="mb-3 max-w-sm">
            <Field id={`${prefix}-level`} label="Level" error={errorFor("native.level")} help={`Exact level in ${runtime.profile.label}, from 1 to 100. Imported levels are not reset to 50.`}>
              <IntegerInput key={editorRevision} value={build.native.level} onValueChange={(level) => onChange({ ...build, native: { ...build.native, level } })} />
            </Field>
          </div>}
          <p id={`${prefix}-points-help`} className="mb-3 text-xs text-muted">{build.game === "champions" ? "Use 0–32 Stat Points per stat, at most 66 total." : "Use 0–252 EVs per stat, at most 510 total, and 0–31 effective IVs. Training values are never guessed from Champions points."} Stat values are before stages, abilities, items and Dynamax.</p>
          {build.game !== "champions" && (runtime.profile.generation === 7 || innateIVs) && <div className="mb-3">
            <label htmlFor={`${prefix}-innate-context`} className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input id={`${prefix}-innate-context`} type="checkbox" checked={!!innateIVs} aria-describedby={`${prefix}-innate-help`} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onChange={(event) => onChange({ ...build, native: { ...build.native, innateIVs: event.target.checked ? { ...build.native.ivs } : undefined } })} />
              Specify innate IVs before Hyper Training
            </label>
            <p id={`${prefix}-innate-help`} className="text-xs text-muted">Enabling starts from the displayed IVs; enter the known originals, not guesses. Hidden Power uses innate IVs without changing trained stats. Without separate context, the provided IVs are used as innate IVs.</p>
          </div>}
          <TableWrap>
            <table className={`w-full ${build.game === "champions" ? "min-w-[17rem]" : innateIVs ? "min-w-[29rem]" : "min-w-[23rem]"} text-left text-sm`} aria-label={`${label} stats and ${build.game === "champions" ? "Stat Points" : "EVs and IVs"}`}>
              <thead className="bg-panel-hover text-xs text-muted">
                <tr>
                  <th scope="col" className="px-2 py-2">Stat</th>
                  <th scope="col" className="px-2 py-2">{build.game === "champions" ? "Points" : "EVs"}</th>
                  {build.game !== "champions" && <th scope="col" className="px-2 py-2">IVs</th>}
                  {innateIVs && <th scope="col" className="px-2 py-2">Innate IVs</th>}
                  <th scope="col" className="px-2 py-2 text-right">Value</th>
                  <th scope="col" className="px-2 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {STATS.map((stat) => (
                  <tr key={stat} className="border-t border-line">
                    <th scope="row" className="px-2 py-2 text-xs font-medium text-text">{STAT_LABELS[stat]}</th>
                    {build.game === "champions" ? <td className="w-20 px-2 py-2">
                      <Field id={`${prefix}-points-${stat}`} label={`${position} ${STAT_LABELS[stat]} Stat Points`} hideLabel>
                        <IntegerInput key={editorRevision} value={build.points[stat]}
                          aria-invalid={!!errorFor(`points.${stat}`) || !!errorFor("points") || undefined}
                          aria-describedby={`${prefix}-points-help${trainingIssues.length ? ` ${prefix}-points-errors` : ""}`}
                          onValueChange={(value) => onChange({ ...build, points: { ...build.points, [stat]: value } })} className="tabular-nums" />
                      </Field>
                    </td> : <>
                      {(["evs", "ivs", ...(innateIVs ? ["innateIVs"] as const : [])] as const).map((kind) => <td key={kind} className="w-20 px-2 py-2">
                        <Field id={`${prefix}-${kind}-${stat}`} label={`${position} ${STAT_LABELS[stat]} ${kind === "evs" ? "EVs" : kind === "ivs" ? "IVs" : "innate IVs"}`} hideLabel>
                          <IntegerInput key={editorRevision} value={build.native[kind]?.[stat] ?? null}
                            aria-invalid={!!errorFor(`native.${kind}.${stat}`) || !!errorFor(`native.${kind}`) || undefined}
                            aria-describedby={`${prefix}-points-help${trainingIssues.length ? ` ${prefix}-points-errors` : ""}`}
                            onValueChange={(value) => onChange({ ...build, native: { ...build.native, [kind]: { ...(build.native[kind] ?? build.native.ivs), [stat]: value } } })} className="tabular-nums" />
                        </Field>
                      </td>)}
                    </>}
                    <td className="px-2 py-2 text-right tabular-nums text-text">{stats?.[stat] ?? "—"}</td>
                    <td className="w-20 px-2 py-2">
                      {stat === "hp" ? <span className="text-muted">—</span> : (
                        <>
                          <label htmlFor={`${prefix}-stage-${stat}`} className="sr-only">{position} {STAT_LABELS[stat]} stage</label>
                          <select id={`${prefix}-stage-${stat}`} value={build.boosts[stat] ?? ""}
                            aria-invalid={!!errorFor(`boosts.${stat}`) || undefined}
                            aria-describedby={trainingIssues.length ? `${prefix}-points-errors` : undefined}
                            onChange={(event) => onChange({ ...build, boosts: { ...build.boosts, [stat]: parseIntegerInput(event.target.value) } })}
                            className="w-full rounded-lg border border-control-border bg-bg px-1 py-2.5 text-sm text-text focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus">
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
          {trainingIssues.length > 0 && (
            <ul id={`${prefix}-points-errors`} className="mt-2 space-y-1 text-xs text-danger">
              {trainingIssues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
            </ul>
          )}
        </div>
      </div>

      <PokemonChooser side={side} build={build} open={pickerOpen} onClose={() => setPickerOpen(false)} onChange={onChange} onReturnFocus={onReveal} runtime={runtime} />
    </section>
  );
}
