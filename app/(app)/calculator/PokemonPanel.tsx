"use client";

import { useId, useState } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, Field, Input, Select, TableWrap } from "@/app/components/ui";
import type { InputProps } from "@/app/components/ui/Input";
import { abilitiesById, champions, itemsById, speciesById } from "@/app/lib/battle/catalog";
import {
  ABILITY_ACTIVATION_LABELS,
  createBuild,
  defaultAbilityActive,
  getBuildStats,
  NATURES,
  parseIntegerInput,
  STATS,
  STAT_LABELS,
  STATUSES,
} from "@/app/lib/battle/model";
import type { BattleBuild, BattleStatus, BuildIssue } from "@/app/lib/battle/types";

const SEARCH_PAGE_SIZE = 8;
const speciesOptions = [...champions.species].sort((a, b) => a.name.localeCompare(b.name, "en"));
const itemOptions = [...champions.items].sort((a, b) => a.name.localeCompare(b.name, "en"));
const stages = Array.from({ length: 13 }, (_, index) => index - 6);

function normalizeName(text: string) {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseBuildInput(text: string, fullHP = false) {
  const parsed = parseIntegerInput(text);
  return fullHP && text !== "" ? parsed ?? Number.NaN : parsed;
}

/** Keep invalid text visible; only an empty HP field means full HP. */
function IntegerInput({
  value,
  onValueChange,
  fullHP = false,
  ...props
}: Omit<InputProps, "value" | "onChange"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  fullHP?: boolean;
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
        const nextValue = parseBuildInput(nextText, fullHP);
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
};

export default function PokemonPanel({ side, build, issues, onChange }: Props) {
  const id = useId();
  const prefix = `${side}-${id}`;
  const label = side === "attacker" ? "Attacker" : "Defender";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const species = speciesById.get(build.speciesId);
  const stats = getBuildStats(build);
  const activationLabel = ABILITY_ACTIVATION_LABELS[build.abilityId];
  const tokens = query.trim().split(/\s+/).map(normalizeName).filter(Boolean);
  const matches = speciesOptions.filter((entry) => tokens.every((token) =>
    normalizeName(`${entry.name} ${entry.id} ${entry.baseSpecies}`).includes(token),
  ));
  const visible = matches.slice(page * SEARCH_PAGE_SIZE, (page + 1) * SEARCH_PAGE_SIZE);
  const errorFor = (field: string) => issues.filter((issue) => issue.field === field).map((issue) => issue.message).join(" ");
  const pointIssues = issues.filter((issue) => issue.field === "points" || issue.field.startsWith("points.") || issue.field.startsWith("boosts."));
  const pointsComplete = STATS.every((stat) => build.points[stat] !== null && Number.isFinite(build.points[stat]));
  const total = STATS.reduce((sum, stat) => sum + (build.points[stat] ?? 0), 0);

  function selectSpecies(speciesId: string) {
    if (speciesId === build.speciesId) return;
    onChange(createBuild(speciesId));
    setNotice(`${label} changed to ${speciesById.get(speciesId)?.name}. Build settings reset; any required Mega Stone is selected.`);
  }

  return (
    <section aria-labelledby={`${prefix}-heading`} className="min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <h2 id={`${prefix}-heading`} className="text-xs font-semibold uppercase tracking-wide text-accent-text">{label}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="wrap-anywhere text-xl font-bold text-text">{species?.name ?? "Select a Pokémon"}</h3>
        {species?.types.map((type) => <TypeBadge key={type} type={type} />)}
      </div>
      {errorFor("speciesId") && <p className="mt-2 text-sm text-danger">Unsupported build: {errorFor("speciesId")}</p>}
      <p role="status" className="sr-only">{notice}</p>

      <details className="mt-3 rounded-lg border border-line">
        <summary className="cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          Change {label.toLowerCase()} Pokémon
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <Field id={`${prefix}-search`} label={`Find ${label.toLowerCase()} Pokémon`} help="Search any name or form. Changing Pokémon resets nature, ability, item, Stat Points, stages, HP and status.">
            <Input type="search" value={query} placeholder="Name or form, e.g. Charizard Mega" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </Field>
          <p role="status" className="text-xs text-muted">
            {matches.length ? `${page * SEARCH_PAGE_SIZE + 1}–${page * SEARCH_PAGE_SIZE + visible.length} of ${matches.length} Pokémon` : "No matching Pokémon."}
            {matches.length > SEARCH_PAGE_SIZE && " · Refine the name or browse pages."}
          </p>
          <ul aria-label={`${label} Pokémon choices`} className="space-y-1">
            {visible.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-pressed={entry.id === build.speciesId}
                  onClick={() => selectSpecies(entry.id)}
                  className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${entry.id === build.speciesId ? "border-accent-border bg-accent-soft text-accent-text" : "border-line text-text hover:bg-panel-hover"}`}
                >
                  <span className="wrap-anywhere font-medium">{entry.name}</span>
                  <span className="text-xs">{entry.unsupported.length > 0 ? "Unsupported in v1" : entry.id === build.speciesId ? "Selected" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {matches.length > SEARCH_PAGE_SIZE && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={`Previous ${label.toLowerCase()} Pokémon page`}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={(page + 1) * SEARCH_PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)} aria-label={`Next ${label.toLowerCase()} Pokémon page`}>Next</Button>
            </div>
          )}
        </div>
      </details>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
              aria-describedby={`${prefix}-ability-help`}
              onChange={(event) => onChange({ ...build, abilityActive: event.target.checked })}
              className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
            {activationLabel}
          </label>
          <p id={`${prefix}-ability-help`} className="text-xs text-muted">
            This sets the ability’s condition, not whether the ability exists. Do not manually apply the same entry-stage change twice.
          </p>
          {errorFor("abilityActive") && <p className="mt-1 text-xs text-danger">{errorFor("abilityActive")}</p>}
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
                    <Field id={`${prefix}-points-${stat}`} label={`${label} ${STAT_LABELS[stat]} Stat Points`} hideLabel>
                      <IntegerInput
                        key={build.speciesId}
                        value={build.points[stat]}
                        aria-invalid={!!errorFor(`points.${stat}`) || undefined}
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
                        <label htmlFor={`${prefix}-stage-${stat}`} className="sr-only">{label} {STAT_LABELS[stat]} stage</label>
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

      <Field id={`${prefix}-hp`} label="Current HP" error={errorFor("currentHP")} help={`Blank means full HP${stats ? ` (${stats.hp})` : ""}. Damage percentages use maximum HP; KO chances use current HP.`} className="mt-4">
        <IntegerInput key={build.speciesId} value={build.currentHP} fullHP placeholder={stats ? `Full HP (${stats.hp})` : "Full HP"} onValueChange={(value) => onChange({ ...build, currentHP: value })} />
      </Field>
    </section>
  );
}
