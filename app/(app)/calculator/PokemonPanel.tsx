"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, TableWrap } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { HIDDEN_POWER_TYPES, hiddenPowerType } from "@/app/lib/battle/mechanics";
import { NO_TRACE_ABILITIES } from "@/app/lib/battle/imposter";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import {
  abilityActivationLabel,
  PARTNER_ABILITY_CONDITIONS,
  defaultAbilityActive,
  fieldItemLabel,
  getBuildStats,
  NATURES,
  parseIntegerInput,
  roomItemLabel,
  STATS,
  STAT_LABELS,
  STATUSES,
  type FieldItemChoice,
} from "@/app/lib/battle/model";
import type { BattleBuild, BattleStatus, BuildIssue } from "@/app/lib/battle/types";

import CurrentHPField from "./CurrentHPField";
import { parseBuildInput } from "./build-input";
import { stagedStat } from "./stage-stat";
import styles from "./calculator.module.css";

const stages = Array.from({ length: 13 }, (_, index) => index - 6);
const cell = "px-1 py-1";

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
  roster?: ReactNode;
  editorRevision?: number;
  /** Intimidate from this Pokémon against the other one (roster-prep applyMatchupIntimidate). */
  onApplyIntimidate?: () => void;
  /** The last result of that button (roster-prep intimidateResult). */
  intimidateResult?: string | null;
  runtime?: BattleRuntime;
  /** Plus/Minus needs an ally, so its condition is ignored in Singles. */
  gameType?: "Singles" | "Doubles";
  /** The held item whose use before Magic Room is a choice (model roomItemChoice), or null. */
  roomItemChoice?: string | null;
  /** A Protosynthesis / Quark Drive holder's item timing against its field (model fieldItemChoice), or null. */
  fieldItemChoice?: FieldItemChoice | null;
  /** Whether Magic Room is up now; without it the switch covers a room that has ended. */
  magicRoom?: boolean;
  /** The form's required move and its current quick moves, to fix a prepared-move issue. */
  requiredMove?: { name: string; slots: readonly string[]; onEquip: (slotIndex: number) => void };
  /** The Pokémon's place in its labels ("your left" in 2v2); defaults to the side's "left" / "right". */
  position?: string;
  /** The Intimidate button's text; defaults to applying it to the other 1v1 Pokémon. */
  intimidateLabel?: string;
  /** A fact shown instead of the ability-condition checkbox (2v2 Plus / Minus, which the ally's ability decides). */
  abilityActivationFact?: string | null;
  /** The Trace select's option for no chosen ability; defaults to the other 1v1 Pokémon's ability. */
  tracedUnsetLabel?: string;
};

/**
 * One Pokémon's build editor, in its Build settings under its summary card. That card already
 * shows the species, types, Mimicry, Tera type, retained configuration and Change Pokémon.
 */
export default function PokemonPanel({ side, build, issues, onChange, hpInput, onHPChange, roster, editorRevision = 0, runtime = championsRuntime, gameType = "Doubles", roomItemChoice = null, fieldItemChoice = null, magicRoom = true, requiredMove, onApplyIntimidate, intimidateResult, position: positionLabel, intimidateLabel, abilityActivationFact, tracedUnsetLabel }: Props) {
  const id = useId();
  const prefix = `${side}-${id}`;
  const position = positionLabel ?? (side === "attacker" ? "left" : "right");
  const species = runtime.speciesById.get(build.speciesId);
  const stats = getBuildStats(build, runtime);
  const itemOptions = useMemo(() => [...runtime.catalog.items].sort((a, b) => a.name.localeCompare(b.name, "en")), [runtime]);
  const traceOptions = useMemo(() => runtime.catalog.abilities.filter((ability) => !NO_TRACE_ABILITIES.has(ability.id) && !ability.unsupported.length)
    .sort((a, b) => a.name.localeCompare(b.name, "en")), [runtime]);
  const activationLabel = abilityActivationLabel(build.abilityId, runtime.profile.id, { level: build.game === "champions" ? 50 : build.native.level ?? undefined });
  // Choosing a slot never commits: arrow keys change a closed select's value at once.
  const [requiredSlot, setRequiredSlot] = useState("");
  const partnerIgnored = gameType === "Singles" && PARTNER_ABILITY_CONDITIONS.has(build.abilityId);
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const trainingIssues = issues.filter((issue) => issue.field === "points" || issue.field.startsWith("points.") || issue.field.startsWith("native.") || issue.field.startsWith("boosts."));
  const allocation = build.game === "champions" ? build.points : build.native.evs;
  const allocationComplete = STATS.every((stat) => allocation[stat] !== null && Number.isFinite(allocation[stat]));
  const total = STATS.reduce((sum, stat) => sum + (allocation[stat] ?? 0), 0);
  const budget = build.game === "champions" ? 66 : 510;
  const level = build.game === "champions" ? 50 : build.native.level;
  const innateIVs = build.game !== "champions" ? build.native.innateIVs : undefined;

  return (
    <div data-calculator-build-settings className={styles.editor}>
      {errorFor("speciesId") && <p className="text-sm text-danger">Unsupported build: {errorFor("speciesId")}</p>}
      {errorFor("game") && <p className="text-sm text-danger">{errorFor("game")}</p>}
      {roster}

      <div className={styles.fields}>
        <CurrentHPField id={`${prefix}-hp`} build={build} issues={issues} text={hpInput} onTextChange={onHPChange} runtime={runtime} data-calculator-hp />
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
          <Select value={build.abilityId} onChange={(event) => onChange({ ...build, abilityId: event.target.value, abilityActive: defaultAbilityActive(event.target.value), tracedAbility: undefined })}>
            {species?.abilities.map((abilityId) => {
              const ability = runtime.abilitiesById.get(abilityId);
              return <option key={abilityId} value={abilityId}>{ability?.name ?? abilityId}{ability?.unsupported.length ? " — unsupported" : ""}</option>;
            })}
          </Select>
        </Field>
        <Field id={`${prefix}-item`} label="Held item" error={errorFor("itemId")} help={species?.requiredItem ? `${runtime.itemsById.get(species.requiredItem)?.name ?? species.requiredItem} is required and locked for this form.` : undefined}>
          <Select value={build.itemId} disabled={!!species?.requiredItem} onChange={(event) => onChange({ ...build, itemId: event.target.value, itemUsedBeforeRoom: undefined, itemUsedBeforeField: undefined })}>
            <option value="">None</option>
            {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.unsupported.length ? " — unsupported" : ""}</option>)}
          </Select>
        </Field>
        <Field id={`${prefix}-status`} label="Status" error={errorFor("status")}>
          <Select value={build.status} onChange={(event) => onChange({ ...build, status: event.target.value as BattleStatus })}>
            {STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </Select>
        </Field>
        {build.game !== "champions" && (
          <Field id={`${prefix}-level`} label="Level" error={errorFor("native.level")}>
            <IntegerInput key={editorRevision} value={build.native.level} onValueChange={(level) => onChange({ ...build, native: { ...build.native, level } })} />
          </Field>
        )}
        {runtime.profile.dynamax && <>
          <Field id={`${prefix}-dynamax-level`} label="Dynamax Level" error={errorFor("configuration.dynamaxLevel")}>
            <IntegerInput key={editorRevision} value={build.configuration?.dynamaxLevel ?? null} allowUnset placeholder="Default (10)" onValueChange={(dynamaxLevel) => onChange({ ...build, configuration: { ...build.configuration, dynamaxLevel: dynamaxLevel ?? undefined } })} />
          </Field>
          <Field id={`${prefix}-gigantamax`} label="Gigantamax factor" error={errorFor("configuration.gigantamax")} help={species?.canGigantamax ? undefined : "This species has no verified Gigantamax factor."}>
            <Select value={build.configuration?.gigantamax === undefined ? "" : build.configuration.gigantamax ? "yes" : "no"} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, gigantamax: event.target.value === "" ? undefined : event.target.value === "yes" } })}>
              <option value="">Not specified</option><option value="no">No</option><option value="yes" disabled={!species?.canGigantamax}>Yes</option>
            </Select>
          </Field>
        </>}
        {runtime.profile.generation === 7 && (
          <Field id={`${prefix}-hidden-power`} label="Hidden Power type" error={errorFor("configuration.hiddenPowerType")}>
            <Select value={build.configuration?.hiddenPowerType ?? ""} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, hiddenPowerType: event.target.value || undefined } })}>
              <option value="">{`Determine from innate IVs${build.game === "champions" ? "" : ` (${hiddenPowerType(innateIVs ?? build.native.ivs) ?? "incomplete"})`}`}</option>
              {HIDDEN_POWER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
          </Field>
        )}
        {build.abilityId === "supremeoverlord" && (
          <Field id={`${prefix}-fainted-allies`} label="Allies fainted before it entered" error={errorFor("faintedAllies")}>
            <Select value={build.faintedAllies ?? 0} onChange={(event) => onChange({ ...build, faintedAllies: parseIntegerInput(event.target.value) ?? 0 })}>
              {Array.from({ length: 6 }, (_, count) => <option key={count} value={count}>{count}</option>)}
            </Select>
          </Field>
        )}
        {build.abilityId === "trace" && (
          <Field id={`${prefix}-traced-ability`} label="Ability Trace copied" error={errorFor("tracedAbility")}>
            <Select value={build.tracedAbility ?? ""} onChange={(event) => onChange({ ...build, tracedAbility: event.target.value || undefined })}>
              <option value="">{tracedUnsetLabel ?? "The other Pokémon’s ability"}</option>
              {traceOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.name}</option>)}
            </Select>
          </Field>
        )}
      </div>

      {roomItemChoice && (
        <label htmlFor={`${prefix}-room-item`} className="flex min-h-11 items-center gap-2 text-xs text-text">
          <input
            id={`${prefix}-room-item`}
            type="checkbox"
            checked={build.itemUsedBeforeRoom !== false}
            onChange={(event) => onChange({ ...build, itemUsedBeforeRoom: event.target.checked ? undefined : false })}
            className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          {roomItemLabel(roomItemChoice, runtime, magicRoom)}
        </label>
      )}

      {fieldItemChoice && (
        <label htmlFor={`${prefix}-field-item`} className="flex min-h-11 items-center gap-2 text-xs text-text">
          <input
            id={`${prefix}-field-item`}
            type="checkbox"
            checked={fieldItemChoice.checked}
            onChange={(event) => onChange({ ...build, itemUsedBeforeField: event.target.checked, ...(event.target.checked ? { itemUsedBeforeRoom: undefined } : {}) })}
            className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          {fieldItemLabel(fieldItemChoice, runtime)}
        </label>
      )}

      {errorFor("preparedMoves") && (
        requiredMove ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field id={`${prefix}-required-move`} label={`Quick move to replace with ${requiredMove.name}`} error={errorFor("preparedMoves")} className="min-w-0 flex-1">
              <Select value={requiredSlot} onChange={(event) => setRequiredSlot(event.target.value)}>
                <option value="">Choose a quick move</option>
                {requiredMove.slots.map((label, index) => <option key={index} value={index}>{`Quick move ${index + 1}: ${label}`}</option>)}
              </Select>
            </Field>
            <Button variant="secondary" disabled={requiredSlot === ""} onClick={() => {
              const slot = parseIntegerInput(requiredSlot);
              setRequiredSlot("");
              if (slot !== null) requiredMove.onEquip(slot);
            }}>{`Replace with ${requiredMove.name}`}</Button>
          </div>
        ) : <p className="text-sm text-danger">{errorFor("preparedMoves")}</p>
      )}

      {activationLabel && typeof abilityActivationFact === "string" ? (
        <p data-ability-activation-fact className="text-xs text-muted">{abilityActivationFact}</p>
      ) : activationLabel && (
        <div>
          <label htmlFor={`${prefix}-ability-active`} className="flex min-h-11 items-center gap-2 text-xs text-text">
            <input
              id={`${prefix}-ability-active`}
              type="checkbox"
              checked={build.abilityActive}
              disabled={partnerIgnored}
              aria-invalid={!!errorFor("abilityActive") || undefined}
              aria-describedby={[partnerIgnored && `${prefix}-ability-help`, errorFor("abilityActive") && `${prefix}-ability-error`].filter(Boolean).join(" ") || undefined}
              onChange={(event) => onChange({ ...build, abilityActive: event.target.checked })}
              className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
            />
            {activationLabel}
          </label>
          {partnerIgnored && <p id={`${prefix}-ability-help`} className="text-xs text-muted">Singles has no ally, so this condition is ignored.</p>}
          {errorFor("abilityActive") && <p id={`${prefix}-ability-error`} className="mt-1 text-xs text-danger">{errorFor("abilityActive")}</p>}
        </div>
      )}

      {build.abilityId === "intimidate" && onApplyIntimidate && (
        <div>
          <Button size="sm" variant="secondary" className="min-h-11" onClick={onApplyIntimidate}>
            {intimidateLabel ?? <>Apply Intimidate to the {side === "attacker" ? "right" : "left"} Pokémon</>}
          </Button>
          <p role="status" className="mt-1 text-xs text-text">{intimidateResult}</p>
        </div>
      )}

      {errorFor("mechanic") && <p className="text-xs text-danger">{errorFor("mechanic")}</p>}

      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 className="text-xs font-semibold text-text">Stats at level {level ?? "—"}</h3>
          <p className={`text-xs tabular-nums ${allocationComplete && total > budget ? "text-danger" : "text-muted"}`}>
            {allocationComplete ? `${total} / ${budget} ${build.game === "champions" ? "Stat Points" : "EVs"}` : `${build.game === "champions" ? "Stat Point" : "EV"} allocation incomplete`}
          </p>
        </div>
        {build.game !== "champions" && (runtime.profile.generation === 7 || innateIVs) && (
          <label htmlFor={`${prefix}-innate-context`} className="flex min-h-11 items-center gap-2 text-xs text-text">
            <input id={`${prefix}-innate-context`} type="checkbox" checked={!!innateIVs} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onChange={(event) => onChange({ ...build, native: { ...build.native, innateIVs: event.target.checked ? { ...build.native.ivs } : undefined } })} />
            Specify innate IVs before Hyper Training
          </label>
        )}
        <TableWrap>
          <table className={`${styles.statTable} w-full ${build.game === "champions" ? "min-w-[15rem]" : innateIVs ? "min-w-[19.5rem]" : "min-w-[18rem]"} text-left text-sm`} aria-label={`${position[0].toUpperCase()}${position.slice(1)} Pokémon stats and ${build.game === "champions" ? "Stat Points" : "EVs and IVs"}`}>
            <thead className="bg-panel-hover text-xs text-muted">
              <tr>
                <th scope="col" className={cell}>Stat</th>
                <th scope="col" className={cell}>{build.game === "champions" ? "Points" : "EVs"}</th>
                {build.game !== "champions" && <th scope="col" className={cell}>IVs</th>}
                {innateIVs && <th scope="col" className={cell}>Innate IVs</th>}
                <th scope="col" className={`${cell} text-right`}>Value</th>
                <th scope="col" className={cell}>Stage</th>
                <th scope="col" className={`${cell} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {STATS.map((stat) => (
                <tr key={stat} className="border-t border-line">
                  <th scope="row" className={`${cell} text-xs font-medium text-text`}>{STAT_LABELS[stat]}</th>
                  {build.game === "champions" ? <td className={`w-20 ${cell}`}>
                    <Field id={`${prefix}-points-${stat}`} label={`${position} ${STAT_LABELS[stat]} Stat Points`} hideLabel>
                      <IntegerInput key={editorRevision} value={build.points[stat]}
                        aria-invalid={!!errorFor(`points.${stat}`) || !!errorFor("points") || undefined}
                        aria-describedby={trainingIssues.length ? `${prefix}-points-errors` : undefined}
                        onValueChange={(value) => onChange({ ...build, points: { ...build.points, [stat]: value } })} className="tabular-nums" />
                    </Field>
                  </td> : <>
                    {(["evs", "ivs", ...(innateIVs ? ["innateIVs"] as const : [])] as const).map((kind) => <td key={kind} className={`w-20 ${cell}`}>
                      <Field id={`${prefix}-${kind}-${stat}`} label={`${position} ${STAT_LABELS[stat]} ${kind === "evs" ? "EVs" : kind === "ivs" ? "IVs" : "innate IVs"}`} hideLabel>
                        <IntegerInput key={editorRevision} value={build.native[kind]?.[stat] ?? null}
                          aria-invalid={!!errorFor(`native.${kind}.${stat}`) || !!errorFor(`native.${kind}`) || undefined}
                          aria-describedby={trainingIssues.length ? `${prefix}-points-errors` : undefined}
                          onValueChange={(value) => onChange({ ...build, native: { ...build.native, [kind]: { ...(build.native[kind] ?? build.native.ivs), [stat]: value } } })} className="tabular-nums" />
                      </Field>
                    </td>)}
                  </>}
                  <td className={`${cell} text-right tabular-nums text-text`}>{stats?.[stat] ?? "—"}</td>
                  <td className={`w-20 ${cell}`}>
                    {stat === "hp" ? <span className="text-muted">—</span> : (
                      <>
                        <label htmlFor={`${prefix}-stage-${stat}`} className="sr-only">{position} {STAT_LABELS[stat]} stage</label>
                        <select id={`${prefix}-stage-${stat}`} value={build.boosts[stat] ?? ""}
                          aria-invalid={!!errorFor(`boosts.${stat}`) || undefined}
                          aria-describedby={trainingIssues.length ? `${prefix}-points-errors` : undefined}
                          onChange={(event) => onChange({ ...build, boosts: { ...build.boosts, [stat]: parseIntegerInput(event.target.value) } })}
                          className="w-full rounded-lg border border-control-border bg-bg px-0.5 py-1.5 text-sm text-text focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus">
                          {stages.map((stage) => <option key={stage} value={stage}>{stage > 0 ? `+${stage}` : stage}</option>)}
                        </select>
                      </>
                    )}
                  </td>
                  <td className={`${cell} text-right tabular-nums text-text`}>
                    {stat === "hp" ? <span className="text-muted">—</span> : stagedStat(stats?.[stat], build.boosts[stat]) ?? "—"}
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

      <div className={styles.fields}>
        <Field id={`${prefix}-gender`} label="Gender" error={errorFor("configuration.gender")} help={species?.gender ? `This species has fixed gender: ${species.gender === "N" ? "genderless" : species.gender === "M" ? "male" : "female"}.` : undefined}>
          <Select value={build.configuration?.gender ?? ""} onChange={(event) => onChange({ ...build, configuration: { ...build.configuration, gender: event.target.value ? event.target.value as "M" | "F" | "N" : undefined } })}>
            <option value="">{species?.gender ? "Use species gender" : "Unknown"}</option>
            <option value="M" disabled={!!species?.gender && species.gender !== "M"}>Male</option>
            <option value="F" disabled={!!species?.gender && species.gender !== "F"}>Female</option>
            <option value="N" disabled={!!species && species.gender !== "N"}>Genderless</option>
          </Select>
        </Field>
        <Field id={`${prefix}-happiness`} label="Happiness" error={errorFor("configuration.happiness")}>
          <IntegerInput key={editorRevision} value={build.configuration?.happiness ?? null} allowUnset placeholder="Default (255)" onValueChange={(happiness) => onChange({ ...build, configuration: { ...build.configuration, happiness: happiness ?? undefined } })} />
        </Field>
      </div>
    </div>
  );
}
