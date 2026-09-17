"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  WandSparkles,
} from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import EmptyState from "@/app/components/ui/EmptyState";
import Field from "@/app/components/ui/Field";
import NumberInput from "@/app/components/ui/NumberInput";
import Select from "@/app/components/ui/Select";
import { SkeletonLines } from "@/app/components/ui/Skeleton";
import StatusPill from "@/app/components/ui/StatusPill";
import TableWrap, {
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui/TableWrap";
import {
  ALL_POKEMON_LABEL,
  applyRules,
  BAND_COUNT,
  BUILDER_GAMES,
  DEFAULT_BANDS,
  describePreset,
  findPreset,
  FORM_TOGGLE_KINDS,
  FORM_TOGGLE_LABELS,
  GAME_LABELS,
  gameLabel,
  isGameKey,
  MAX_BST,
  MAX_GENERATION,
  MAX_POINTS,
  MAX_STAT,
  MIN_GENERATION,
  POKEMON_TYPES,
  presetDates,
  presetsForSource,
  priceByBands,
  rulesProblems,
  STAT_KEYS,
  STAT_LABELS,
  STAT_SHORT_LABELS,
  TAG_KEYS,
  TAG_LABELS,
} from "@/app/lib/pokemon/rules";
import { linkClassName } from "@/app/lib/theme";
import type {
  FormatRules,
  FormToggleKind,
  GameKey,
  PokemonEntry,
  Preset,
  RulesFilters,
  StatKey,
  TagKey,
} from "@/app/types/pokemon";
import { useMediaQuery } from "./hooks";
import { DEFAULT_POINTS, MAX_POOL_SIZE } from "./poolFormat";

/** Preview rows rendered before a "Show more" button appears (section 8.5). */
const PAGE_SIZE = 100;

export type DatasetState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: PokemonEntry[] };

/** "Replace pool" or "Add missing only" in the confirm dialog. */
export type ApplyMode = "replace" | "add-missing";

export type RuleBuilderProps = {
  rules: FormatRules;
  onRulesChange: (next: FormatRules) => void;
  dataset: DatasetState;
  onRetryDataset: () => void;
  presets: readonly Preset[];
  /** Rows in the pool right now; a non-empty pool makes Apply confirm first. */
  poolSize: number;
  /** True when the loaded format was saved without rules. */
  builtByHand: boolean;
  /** The rules the loaded format was saved with, for "Rebuild from rules". */
  savedRules: FormatRules | null;
  /** True once a price was edited by hand after the rules were applied. */
  handPriced: boolean;
  onApply: (result: PokemonEntry[], rules: FormatRules, mode: ApplyMode) => void;
  disabled?: boolean;
};

/** "312 Pokémon match", "1 Pokémon matches". */
export function matchCountLabel(count: number): string {
  return `${count.toLocaleString("en-US")} Pokémon ${count === 1 ? "matches" : "match"}`;
}

/** Points a row gets under the rules' pricing. */
export function pointsFor(entry: PokemonEntry, rules: FormatRules): number {
  return rules.pricing.mode === "bands"
    ? priceByBands(entry.bst, rules.pricing.bands)
    : DEFAULT_POINTS;
}

/**
 * Every reason a set of rules cannot become the pool right now: the rules'
 * own problems (`rulesProblems`), a result with no Pokémon, or one above the
 * pool limit. Empty when Apply, and Rebuild from rules, may go ahead; both
 * use it so saved rules that select nothing can never blank the pool.
 */
export function applyProblems(
  rules: FormatRules,
  result: readonly PokemonEntry[]
): string[] {
  const problems = rulesProblems(rules);
  if (problems.length > 0) return problems;
  if (result.length === 0) {
    return ["No Pokémon match these rules in the current dataset."];
  }
  if (result.length > MAX_POOL_SIZE) {
    return [
      `A draft pool can hold at most ${MAX_POOL_SIZE.toLocaleString("en-US")} Pokémon; these rules select ${result.length.toLocaleString("en-US")}.`,
    ];
  }
  return [];
}

const checkboxClassName =
  "h-4 w-4 shrink-0 rounded border-line-strong accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  type = "checkbox",
  name,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  type?: "checkbox" | "radio";
  name?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        type={type}
        id={id}
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className={checkboxClassName}
      />
      <label htmlFor={id} className="text-sm text-text">
        {label}
      </label>
    </div>
  );
}

function Fieldset({
  legend,
  help,
  children,
  className = "",
}: {
  legend: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`min-w-0 ${className}`.trim()}>
      <legend className="text-sm font-medium text-text">{legend}</legend>
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{children}</div>
    </fieldset>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function PresetDescription({ preset }: { preset: Preset }) {
  const dates = presetDates(preset);
  return (
    <p className="text-xs text-muted">
      {dates && <span>{dates}. </span>}
      <span>{describePreset(preset)}.</span>{" "}
      {preset.source && (
        <a
          href={preset.source}
          target="_blank"
          rel="noreferrer"
          className={`${linkClassName} text-accent-text underline`}
        >
          Source
        </a>
      )}
    </p>
  );
}

function tagsLabel(entry: PokemonEntry): string {
  return entry.tags
    .map((tag) => (TAG_KEYS as readonly string[]).includes(tag) ? TAG_LABELS[tag as TagKey] : tag)
    .join(", ");
}

function PreviewTable({ entries, rules }: { entries: PokemonEntry[]; rules: FormatRules }) {
  return (
    <TableWrap>
      <table className={`${tableClassName} min-w-[56rem]`}>
        <caption className="sr-only">Pokémon that match the rules</caption>
        <thead className={theadClassName}>
          <tr>
            <th scope="col" className={thClassName}>
              Pokémon
            </th>
            <th scope="col" className={thClassName}>
              Types
            </th>
            {STAT_KEYS.map((stat) => (
              <th key={stat} scope="col" className={`${thClassName} text-right`}>
                <abbr title={STAT_LABELS[stat]} className="no-underline">
                  {STAT_SHORT_LABELS[stat]}
                </abbr>
              </th>
            ))}
            <th scope="col" className={`${thClassName} text-right`}>
              Total
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              Points
            </th>
            <th scope="col" className={thClassName}>
              Categories
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={trClassName}>
              <td className={tdClassName}>
                <div className="flex items-center gap-3">
                  <PokemonSprite name={entry.display_name} size="sm" />
                  <div className="min-w-0">
                    <p className="wrap-anywhere font-semibold text-text">{entry.display_name}</p>
                    {entry.form_label && (
                      <p className="text-xs text-muted">{entry.form_label}</p>
                    )}
                  </div>
                </div>
              </td>
              <td className={tdClassName}>
                <PokemonTypes
                  name={entry.display_name}
                  types={{ type1: entry.type1, type2: entry.type2 }}
                />
              </td>
              {STAT_KEYS.map((stat) => (
                <td key={stat} className={`${tdClassName} text-right tabular-nums`}>
                  {entry[stat]}
                </td>
              ))}
              <td className={`${tdClassName} text-right font-semibold tabular-nums text-text`}>
                {entry.bst}
              </td>
              <td className={`${tdClassName} text-right tabular-nums`}>
                {pointsFor(entry, rules)}
              </td>
              <td className={`${tdClassName} text-muted`}>{tagsLabel(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function PreviewCards({ entries, rules }: { entries: PokemonEntry[]; rules: FormatRules }) {
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-xl border border-line bg-panel p-4">
          <div className="flex items-start gap-3">
            <PokemonSprite name={entry.display_name} />
            <div className="min-w-0 flex-1">
              <p className="wrap-anywhere font-semibold text-text">{entry.display_name}</p>
              {entry.form_label && <p className="text-xs text-muted">{entry.form_label}</p>}
              <PokemonTypes
                name={entry.display_name}
                types={{ type1: entry.type1, type2: entry.type2 }}
                className="mt-1"
              />
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-text">{entry.bst}</p>
              <p className="text-xs text-muted">{pointsFor(entry, rules)} pts</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-6 gap-1 text-center">
            {STAT_KEYS.map((stat) => (
              <div key={stat}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <abbr title={STAT_LABELS[stat]} className="no-underline">
                    {STAT_SHORT_LABELS[stat]}
                  </abbr>
                </dt>
                <dd className="text-sm tabular-nums text-text">{entry[stat]}</dd>
              </div>
            ))}
          </dl>
          {entry.tags.length > 0 && (
            <p className="mt-2 text-xs text-muted">{tagsLabel(entry)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function BandsTable({
  bands,
  onChange,
  onReset,
  disabled,
}: {
  bands: number[];
  onChange: (index: number, value: number) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <TableWrap>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Minimum stat total for each point value</caption>
          <thead className={theadClassName}>
            <tr>
              <th scope="col" className={thClassName}>
                Points
              </th>
              <th scope="col" className={thClassName}>
                Minimum stat total
              </th>
            </tr>
          </thead>
          <tbody>
            {bands.map((minimum, index) => {
              const points = MAX_POINTS - index;
              const last = index === BAND_COUNT - 1;
              return (
                <tr key={points} className={trClassName}>
                  <td className={`${tdClassName} font-semibold text-text`}>{points}</td>
                  <td className={tdClassName}>
                    {last ? (
                      <span className="text-muted">0 (every Pokémon gets at least 1 point)</span>
                    ) : (
                      <Field label={`Minimum stat total for ${points} points`} hideLabel>
                        <NumberInput
                          value={minimum}
                          min={0}
                          max={MAX_BST}
                          onValueChange={(value) => {
                            if (value !== null) onChange(index, value);
                          }}
                          disabled={disabled}
                          className="w-28"
                        />
                      </Field>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <div>
        <Button variant="secondary" size="sm" onClick={onReset} disabled={disabled}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset bands
        </Button>
      </div>
    </div>
  );
}

/**
 * The "Build from rules" card (docs/release-architecture.md 13.7): source,
 * regulation preset, filters, a live result preview, the pricing bands and
 * the Apply action. The rules live in the parent so Save can write them
 * into the format; this card only edits them and reports the result.
 */
export default function RuleBuilder({
  rules,
  onRulesChange,
  dataset,
  onRetryDataset,
  presets,
  poolSize,
  builtByHand,
  savedRules,
  handPriced,
  onApply,
  disabled = false,
}: RuleBuilderProps) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "rebuild" | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lastGames, setLastGames] = useState<GameKey[]>(
    rules.source.kind === "games" && rules.source.games.length > 0
      ? rules.source.games
      : [BUILDER_GAMES[0]]
  );
  // Bands survive a round trip through "manual" so toggling pricing back on
  // restores what the coach typed rather than the defaults.
  const [draftBands, setDraftBands] = useState<number[]>(() =>
    rules.pricing.mode === "bands" ? rules.pricing.bands : [...DEFAULT_BANDS]
  );
  if (rules.pricing.mode === "bands" && rules.pricing.bands !== draftBands) {
    setDraftBands(rules.pricing.bands);
  }
  const bodyId = useId();

  const entries = dataset.status === "ready" ? dataset.entries : null;
  const problems = useMemo(() => rulesProblems(rules), [rules]);
  const result = useMemo(
    () => (entries ? applyRules(entries, presets, rules) : []),
    [entries, presets, rules]
  );
  // A new result restarts paging (state adjusted during render, not an effect).
  const [pagedFor, setPagedFor] = useState(result);
  if (pagedFor !== result) {
    setPagedFor(result);
    setVisibleCount(PAGE_SIZE);
  }
  const visible = result.slice(0, visibleCount);

  const preset = findPreset(presets, rules.preset);
  const presetOptions = useMemo(() => {
    const options = presetsForSource(presets, rules.source);
    if (preset && !options.includes(preset)) options.push(preset);
    return options;
  }, [presets, rules.source, preset]);
  const emptyRoster = preset?.rule.kind === "roster" && preset.rule.slugs.length === 0;

  const open = wide || expanded;
  const datasetEmpty = entries !== null && entries.length === 0;
  const tooMany = result.length > MAX_POOL_SIZE;
  const canApply =
    !disabled && entries !== null && applyProblems(rules, result).length === 0;
  // "Rebuild from rules" re-applies the saved rules; a result they cannot
  // produce (nothing selected, a preset whose roster is gone, an invalid
  // filter) is refused in the dialog rather than emptying the pool.
  const rebuild = useMemo(() => {
    if (!savedRules || !entries) return null;
    const rebuilt = applyRules(entries, presets, savedRules);
    return { result: rebuilt, problems: applyProblems(savedRules, rebuilt) };
  }, [entries, presets, savedRules]);
  const rebuildBlocked = rebuild !== null && rebuild.problems.length > 0;

  function update(patch: Partial<FormatRules>) {
    onRulesChange({ ...rules, ...patch });
  }

  function updateFilters(patch: Partial<RulesFilters>) {
    update({ filters: { ...rules.filters, ...patch } });
  }

  function chooseGames() {
    update({ source: { kind: "games", games: lastGames } });
  }

  function toggleGame(game: GameKey, checked: boolean) {
    const current = rules.source.kind === "games" ? rules.source.games : lastGames;
    const games = checked
      ? BUILDER_GAMES.filter((key) => key === game || current.includes(key))
      : current.filter((key) => key !== game);
    if (games.length > 0) setLastGames(games);
    update({ source: { kind: "games", games } });
  }

  function choosePreset(key: string) {
    const next = findPreset(presets, key || null);
    if (!next) {
      update({ preset: null });
      return;
    }
    // Choosing a preset sets its game and leaves the filters as they are.
    if (isGameKey(next.game)) {
      setLastGames([next.game]);
      update({ preset: next.key, source: { kind: "games", games: [next.game] } });
    } else {
      update({ preset: next.key });
    }
  }

  function setStat(stat: StatKey, value: number | null) {
    updateFilters({ stats: { ...rules.filters.stats, [stat]: value } });
  }

  function toggleType(type: string, checked: boolean) {
    const types = checked
      ? POKEMON_TYPES.filter((name) => name === type || rules.filters.types.includes(name))
      : rules.filters.types.filter((name) => name !== type);
    updateFilters({ types });
  }

  function toggleTag(tag: TagKey, included: boolean) {
    const excludeTags = included
      ? rules.filters.excludeTags.filter((name) => name !== tag)
      : TAG_KEYS.filter((name) => name === tag || rules.filters.excludeTags.includes(name));
    updateFilters({ excludeTags });
  }

  function toggleForm(kind: FormToggleKind, checked: boolean) {
    updateFilters({ forms: { ...rules.filters.forms, [kind]: checked } });
  }

  function togglePricing(checked: boolean) {
    update({ pricing: checked ? { mode: "bands", bands: draftBands } : { mode: "manual" } });
  }

  function setBand(index: number, value: number) {
    const bands = draftBands.map((band, i) => (i === index ? value : band));
    update({ pricing: { mode: "bands", bands } });
  }

  function resetBands() {
    update({ pricing: { mode: "bands", bands: [...DEFAULT_BANDS] } });
  }

  function requestApply() {
    if (!canApply) return;
    if (poolSize === 0) onApply(result, rules, "replace");
    else setConfirm("apply");
  }

  function finishApply(mode: ApplyMode) {
    setConfirm(null);
    onApply(result, rules, mode);
  }

  function finishRebuild() {
    setConfirm(null);
    if (!savedRules || !rebuild || rebuild.problems.length > 0) return;
    onRulesChange(savedRules);
    onApply(rebuild.result, savedRules, "replace");
  }

  const rebuildDescription = savedRules
    ? `The pool will be replaced with the Pokémon the saved rules select from the current dataset, ${
        savedRules.pricing.mode === "bands"
          ? "priced by the saved bands"
          : `at ${DEFAULT_POINTS} points each because this format keeps manual prices`
      }. Changes made by hand are lost.`
    : undefined;

  return (
    <section
      aria-labelledby="rule-builder-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <WandSparkles className="h-5 w-5 text-accent-text" aria-hidden="true" />
        <h2 id="rule-builder-heading" className="text-lg font-semibold text-text">
          Build from rules
        </h2>
        {builtByHand && <StatusPill>This format was built by hand</StatusPill>}
        {handPriced && <StatusPill tone="warning">Prices edited by hand</StatusPill>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {savedRules && open && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirm("rebuild")}
              disabled={disabled || entries === null || datasetEmpty}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Rebuild from rules
            </Button>
          )}
          {!wide && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-controls={expanded ? bodyId : undefined}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
              {expanded ? "Hide rules" : "Build from rules"}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">
        Pick a game or every Pokémon, a regulation set and filters, then price the
        result by stat total and apply it to the pool. Adjust single rows in the
        pool afterwards.
      </p>

      {open && (
        <div id={bodyId} className="mt-5 flex flex-col gap-6">
          {dataset.status === "loading" && (
            <div aria-busy="true">
              <SkeletonLines lines={4} />
            </div>
          )}

          {dataset.status === "error" && (
            <Alert
              variant="error"
              action={
                <Button size="sm" variant="secondary" onClick={onRetryDataset}>
                  Retry
                </Button>
              }
            >
              {dataset.message}
            </Alert>
          )}

          {datasetEmpty && (
            <EmptyState
              title="The Pokémon dataset has not been loaded yet"
              description="Seed the pokemon table (npm run seed:pokemon) to build pools from rules. Until then you can add Pokémon by name, upload a JSON file or load a saved format."
            />
          )}

          {entries !== null && !datasetEmpty && (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <SectionHeading>Start from</SectionHeading>
                  <Fieldset legend="Start from">
                    <Checkbox
                      type="radio"
                      name="rule-source"
                      label="Games"
                      checked={rules.source.kind === "games"}
                      onChange={(checked) => {
                        if (checked) chooseGames();
                      }}
                      disabled={disabled}
                    />
                    <Checkbox
                      type="radio"
                      name="rule-source"
                      label={ALL_POKEMON_LABEL}
                      checked={rules.source.kind === "all"}
                      onChange={(checked) => {
                        if (checked) update({ source: { kind: "all" } });
                      }}
                      disabled={disabled}
                    />
                  </Fieldset>
                  {rules.source.kind === "games" && (
                    <Fieldset legend="Games" help="Choose at least one game.">
                      {BUILDER_GAMES.map((game) => (
                        <Checkbox
                          key={game}
                          label={GAME_LABELS[game]}
                          checked={
                            rules.source.kind === "games" && rules.source.games.includes(game)
                          }
                          onChange={(checked) => toggleGame(game, checked)}
                          disabled={disabled}
                        />
                      ))}
                    </Fieldset>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <SectionHeading>Regulation</SectionHeading>
                  <Field
                    label="Regulation"
                    help={
                      preset ? undefined : "A regulation set narrows the source before your filters."
                    }
                  >
                    <Select
                      value={preset ? preset.key : ""}
                      onChange={(event) => choosePreset(event.target.value)}
                      disabled={disabled}
                    >
                      <option value="">None</option>
                      {presetOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.name}
                          {rules.source.kind === "all" || rules.source.games.length > 1
                            ? ` (${gameLabel(option.game)})`
                            : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {preset && <PresetDescription preset={preset} />}
                  {emptyRoster && preset && (
                    <Alert variant="info">
                      The roster for {preset.name} has not been loaded into this build yet,
                      so no Pokémon match. Pick another regulation or None.
                    </Alert>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeading>Filters</SectionHeading>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Stat total minimum">
                    <NumberInput
                      value={rules.filters.bst.min}
                      min={0}
                      max={MAX_BST}
                      onValueChange={(value) =>
                        updateFilters({ bst: { ...rules.filters.bst, min: value } })
                      }
                      placeholder="Any"
                      disabled={disabled}
                    />
                  </Field>
                  <Field label="Stat total maximum">
                    <NumberInput
                      value={rules.filters.bst.max}
                      min={0}
                      max={MAX_BST}
                      onValueChange={(value) =>
                        updateFilters({ bst: { ...rules.filters.bst, max: value } })
                      }
                      placeholder="Any"
                      disabled={disabled}
                    />
                  </Field>
                  <Field label="Generation minimum">
                    <NumberInput
                      value={rules.filters.generation.min}
                      min={MIN_GENERATION}
                      max={MAX_GENERATION}
                      onValueChange={(value) =>
                        updateFilters({
                          generation: { ...rules.filters.generation, min: value },
                        })
                      }
                      placeholder="Any"
                      disabled={disabled}
                    />
                  </Field>
                  <Field label="Generation maximum">
                    <NumberInput
                      value={rules.filters.generation.max}
                      min={MIN_GENERATION}
                      max={MAX_GENERATION}
                      onValueChange={(value) =>
                        updateFilters({
                          generation: { ...rules.filters.generation, max: value },
                        })
                      }
                      placeholder="Any"
                      disabled={disabled}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {STAT_KEYS.map((stat) => (
                    <Field key={stat} label={`Max ${STAT_LABELS[stat]}`}>
                      <NumberInput
                        value={rules.filters.stats[stat]}
                        min={0}
                        max={MAX_STAT}
                        onValueChange={(value) => setStat(stat, value)}
                        placeholder="Any"
                        disabled={disabled}
                      />
                    </Field>
                  ))}
                </div>

                <Fieldset
                  legend="Types"
                  help="Leave every type unchecked to allow any type; otherwise either of a Pokémon's types must be checked."
                >
                  {POKEMON_TYPES.map((type) => (
                    <Checkbox
                      key={type}
                      label={type}
                      checked={rules.filters.types.includes(type)}
                      onChange={(checked) => toggleType(type, checked)}
                      disabled={disabled}
                    />
                  ))}
                </Fieldset>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Fieldset legend="Categories" help="Checked categories are included.">
                    {TAG_KEYS.map((tag) => (
                      <Checkbox
                        key={tag}
                        label={TAG_LABELS[tag]}
                        checked={!rules.filters.excludeTags.includes(tag)}
                        onChange={(checked) => toggleTag(tag, checked)}
                        disabled={disabled}
                      />
                    ))}
                  </Fieldset>
                  <Fieldset legend="Forms" help="Default forms are always included.">
                    {FORM_TOGGLE_KINDS.map((kind) => (
                      <Checkbox
                        key={kind}
                        label={FORM_TOGGLE_LABELS[kind]}
                        checked={rules.filters.forms[kind]}
                        onChange={(checked) => toggleForm(kind, checked)}
                        disabled={disabled}
                      />
                    ))}
                  </Fieldset>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <SectionHeading>Result</SectionHeading>
                  <p role="status" className="text-sm font-medium text-text">
                    {matchCountLabel(result.length)}
                  </p>
                </div>
                {problems.length > 0 && (
                  <Alert variant="error" title="Fix these before applying">
                    <ul className="list-disc pl-5">
                      {problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
                {tooMany && (
                  <Alert variant="warning">
                    A draft pool can hold at most {MAX_POOL_SIZE.toLocaleString("en-US")}{" "}
                    Pokémon. Narrow the filters to apply these rules.
                  </Alert>
                )}
                {result.length === 0 ? (
                  <EmptyState
                    title="No Pokémon match these rules"
                    description={
                      emptyRoster
                        ? "The chosen regulation's roster is empty in this build."
                        : "Loosen a filter, choose another regulation or add a game."
                    }
                  />
                ) : (
                  <>
                    {wide ? (
                      <PreviewTable entries={visible} rules={rules} />
                    ) : (
                      <PreviewCards entries={visible} rules={rules} />
                    )}
                    {result.length > visible.length && (
                      <div className="flex justify-center">
                        <Button
                          variant="secondary"
                          onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
                        >
                          Show {Math.min(PAGE_SIZE, result.length - visible.length)} more
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <SectionHeading>Price by stat total</SectionHeading>
                <Checkbox
                  label="Price by stat total"
                  checked={rules.pricing.mode === "bands"}
                  onChange={togglePricing}
                  disabled={disabled}
                />
                <p className="text-xs text-muted">
                  {rules.pricing.mode === "bands"
                    ? "Each Pokémon gets the points of the first row its stat total reaches."
                    : `Every Pokémon is added at ${DEFAULT_POINTS} points; set prices by hand in the pool.`}
                </p>
                {rules.pricing.mode === "bands" && (
                  <BandsTable
                    bands={rules.pricing.bands}
                    onChange={setBand}
                    onReset={resetBands}
                    disabled={disabled}
                  />
                )}
              </div>

              <div className="flex flex-col gap-3">
                <SectionHeading>Apply to pool</SectionHeading>
                <p className="text-sm text-muted">
                  {poolSize === 0
                    ? "The matching Pokémon become the pool."
                    : `The pool has ${poolSize.toLocaleString("en-US")} Pokémon; you will choose between replacing it and adding only the missing ones.`}
                </p>
                <div>
                  <Button onClick={requestApply} disabled={!canApply}>
                    <WandSparkles className="h-4 w-4" aria-hidden="true" />
                    Apply to pool
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <Dialog
        open={confirm === "apply"}
        onClose={() => setConfirm(null)}
        title="Apply rules to the pool?"
        description={`The pool has ${poolSize.toLocaleString("en-US")} Pokémon. Replace pool removes them and adds the ${result.length.toLocaleString("en-US")} that match the rules. Add missing only keeps the current rows and their prices and appends the ones that are not in the pool yet.`}
        danger
        onConfirm={() => finishApply("replace")}
        confirmLabel="Replace pool"
      >
        <Button variant="secondary" onClick={() => finishApply("add-missing")}>
          Add missing only
        </Button>
      </Dialog>

      <Dialog
        open={confirm === "rebuild"}
        onClose={() => setConfirm(null)}
        title="Rebuild from rules?"
        description={
          rebuildBlocked
            ? "The saved rules cannot be applied to the current dataset, so the pool stays as it is. Adjust the rules in the card and use Apply to pool instead."
            : rebuildDescription
        }
        danger
        onConfirm={rebuildBlocked ? undefined : finishRebuild}
        confirmLabel="Rebuild pool"
        cancelLabel={rebuildBlocked ? "Close" : "Cancel"}
      >
        {rebuild && rebuildBlocked && (
          <Alert variant="error">
            <ul className="list-disc pl-5">
              {rebuild.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}
      </Dialog>
    </section>
  );
}
