"use client";

import { useEffect, useId, useRef, useState } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button } from "@/app/components/ui";
import { chanceText } from "@/app/lib/battle/chance";
import type { DoublesAction, DoublesHP, DoublesSlotId, DoublesTargetRule, NameParts } from "@/app/lib/battle/doubles-types";
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import { mimicryNote, type MimicryState } from "@/app/lib/battle/mimicry";
import { describeMoveSlot } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleMechanic, BuildIssue } from "@/app/lib/battle/types";
import CurrentHPField from "./CurrentHPField";
import { RosterPicker } from "./LeagueMatchupPicker";
import MechanicControls, { RetainedConfiguration, TeraTypeField } from "./MechanicControls";
import PokemonChooser from "./PokemonChooser";
import PokemonName from "./PokemonName";
import { actionFact, ARROW, cardHPLabel, conditionsLine, FAINTED, rollDescription, shownHP, targetName, type DoublesNames } from "./doubles-format";
import { getBuildHealth, settledText, type DamageRollMode } from "./hp-preview";
import { getMoveOwner, type Combatant, type MoveOwner, type MoveReplacement, type RosterChoice, type RosterPanel } from "./roster-prep";
import styles from "./calculator.module.css";

/** One 2v2 slot as the summary shows it (the State/shell builder's useDoublesView makes these). */
export type DoublesCardView = {
  id: DoublesSlotId; slot: Combatant; action: DoublesAction;
  /** The target rule of the action's move (doubles-targets doublesTargetRule); null: no move. */
  rule: DoublesTargetRule | null;
  /** The turn's HP for this slot; null: no ready turn, or the slot is not in it. */
  hp: DoublesHP | null;
  /** `hp` is after the whole turn (its end of turn is estimated: doubles-format turnHP); otherwise after the moves. */
  afterTurn?: boolean;
  /** Some step reaches it: the card shows its KO chance. */
  reached: boolean;
  /** Its HP is 0: it fainted before the turn, so the card shows no move or target and the turn leaves it out. */
  fainted?: boolean;
  issues: BuildIssue[]; mimicry: MimicryState | null;
  rosterPanel: RosterPanel; rosterDisabled: (choice: RosterChoice) => string | null;
};

export type DoublesCardHandlers = {
  onBuildChange: (key: number, build: BattleBuild) => void;
  onHPChange: (key: number, text: string) => void;
  onRosterSelect: (key: number, choice: RosterChoice) => void;
  onToggleMega: (owner: MoveOwner, formId: string) => void;
  onToggleMechanic: (owner: MoveOwner, mechanic: BattleMechanic) => void;
  onActivateMove: (owner: MoveOwner, slotIndex: number) => void;
  onChooseMove: (owner: MoveOwner, moveId: string | null) => void;
  onShowMoves: (owner: MoveOwner) => void;
  onTargetChange: (owner: MoveOwner, target: DoublesSlotId) => void;
};

type Props = DoublesCardHandlers & {
  view: DoublesCardView;
  /** The four Pokémon's full names (doublesNames): this card's labels and its targets. */
  names: DoublesNames;
  /** This card's name parts (doublesNameParts): its heading (PokemonName). */
  nameParts: NameParts;
  runtime: BattleRuntime;
  rollMode: DamageRollMode;
  replacement: MoveReplacement | null;
  movesControl: string;
  /** The move the turn used for the action when it differs (Z-Move, Max Move): its name and type. */
  effective?: { name?: string; type?: string };
  /** Set when the move being aimed (DoublesSummary) can hit this Pokémon. */
  target?: DoublesCardTarget | null;
};

/** Text with a " → " between a move and its targets: the arrow is hidden from screen readers, which hear " targets ". */
export function PointedText({ text }: { text: string }) {
  const at = text.indexOf(ARROW);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<span aria-hidden="true">{ARROW}</span><span className="sr-only"> targets </span>{text.slice(at + ARROW.length)}</>;
}

const linkButton = "min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** The move being aimed can hit this card's Pokémon: clicking the card picks it (the Target radios stay for the keyboard). */
export type DoublesCardTarget = {
  selected: boolean;
  /** "Target Blastoise with Charizard's Heat Wave". */
  label: string;
  /** "Target of Charizard's Ancient Power" on the picked card. */
  chip: string | null;
  onPick(): void;
};

/**
 * A 2v2 card: the Pokémon, its HP after the turn (or after the moves when the end of turn is not estimated) with its
 * statuses and other conditions then, its move and its target (data-doubles-slot).
 */
export default function DoublesCard({ view, names, nameParts, runtime, rollMode, replacement, movesControl, effective, target, onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, onActivateMove, onChooseMove, onShowMoves, onTargetChange }: Props) {
  const id = useId();
  const { id: slotId, slot, action, rule, hp, reached, issues, mimicry, rosterPanel, rosterDisabled, fainted = false, afterTurn = false } = view;
  // The full name in every label ("Garchomp (yours, 1)"); the heading shows it as PokemonName does.
  const label = names[slotId];
  const owner = getMoveOwner(slot);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingHP, setEditingHP] = useState(false);
  const hpRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const species = runtime.speciesById.get(slot.build.speciesId);
  const megaOptions = getMegaOptions(slot.build.speciesId, runtime, slot.megaBase?.speciesId);
  const health = getBuildHealth(slot.build, runtime);
  // A fainted Pokémon's maximum: the build's HP at full (current HP 0 is not valid in 1v1).
  const faintedMaximum = fainted ? getBuildHealth({ ...slot.build, currentHP: null }, runtime)?.maximum ?? null : null;
  const teraType = runtime.profile.tera && slot.build.mechanic === "tera" ? slot.build.configuration?.teraType : undefined;
  const types = teraType && teraType !== "Stellar" ? [teraType] : mimicry?.type ? [mimicry.type] : species?.types;
  const maximum = hp?.maximum ?? health?.maximum ?? 0;
  const shown = hp ? shownHP(hp, rollMode) : health?.current ?? 0;
  const fraction = maximum ? shown / maximum : 0;
  const range = hp && hp.min !== hp.max ? ` (${hp.min}–${hp.max})` : "";
  const ko = hp && reached ? chanceText(hp.koChance) : null;
  const hpText = hp ? `${shown} of ${maximum} HP ${afterTurn ? "after the turn" : "after the moves"}, ${rollDescription(rollMode)}${range}.${ko ? ` KO chance: ${ko}.` : ""} Turn start HP: ${hp.start}.${hp.settled ? ` ${settledText(hp.settled)}.` : ""}`
    : health ? `${health.current} of ${health.maximum} HP` : "";
  const conditions = hp?.conditions?.length ? conditionsLine(hp.conditions) : "";
  const move = action.moveId ? runtime.movesById.get(action.moveId) : undefined;
  const moveName = effective?.name ?? move?.name ?? action.moveId ?? "";
  const offList = !!action.moveId && !slot.moves.some((prepared) => prepared.moveId === action.moveId);
  const hasRoster = rosterPanel.choices.some((choice) => choice.source);
  const unavailable = issues.find((issue) => issue.field === "currentHP")?.message ?? issues[0]?.message.replace(/ A learnset is not proof.*$/, "") ?? "HP unavailable.";

  useEffect(() => {
    if (editingHP) hpRef.current?.focus();
  }, [editingHP]);

  function finishHP() {
    setEditingHP(false);
    editRef.current?.focus();
  }

  const body = (
    <>
      {slot.source && slot.source.name !== species?.name && <p className="wrap-anywhere text-xs font-semibold text-muted">{slot.source.name}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="min-w-0 wrap-anywhere text-base font-bold leading-snug text-text sm:text-lg"><PokemonName parts={nameParts} /></h4>
        {megaOptions.length > 0 && (
          <div role="group" aria-label={`${label} ${megaOptions.every((option) => option.label.startsWith("Mega")) ? "Mega forms" : "battle forms"}`} className="flex min-w-0 flex-wrap gap-1">
            {megaOptions.map((option) => {
              const active = slot.build.speciesId === option.formId;
              const form = runtime.speciesById.get(option.formId);
              return (
                <Button
                  key={option.formId}
                  size="sm"
                  variant={active ? "primary" : "secondary"}
                  className="min-h-11 px-2 text-xs"
                  data-mega-form={option.formId}
                  aria-label={`${label} ${option.label}`}
                  aria-pressed={active}
                  title={[runtime.itemsById.get(option.itemId)?.name, option.requiredMove ? `Requires ${runtime.movesById.get(option.requiredMove)?.name ?? option.requiredMove}` : null, ...(form?.unsupported ?? [])].filter(Boolean).join(" — ")}
                  onClick={() => onToggleMega(owner, option.formId)}
                ><span className="text-xs">{option.label}</span></Button>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted sm:hidden">{types?.join(" / ")}{teraType && ` · Tera ${teraType}`}</p>
      <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{types?.map((type) => <TypeBadge key={type} type={type} />)}{teraType && <span className="text-xs font-semibold text-accent-text">Tera {teraType}</span>}</div>
      {teraType && teraType !== "Stellar" && <p className="mt-1 text-xs text-muted">Original types: {species?.types.join(" / ")}</p>}
      {mimicry && species && <p className="mt-1 text-xs text-muted">{mimicryNote(mimicry, species.types)}</p>}
      <MechanicControls build={slot.build} label={label} runtime={runtime} onToggle={(mechanic) => onToggleMechanic(owner, mechanic)} />
      {runtime.profile.tera && <div className="mt-2"><TeraTypeField id={`${id}-tera-type`} build={slot.build} issues={issues} onChange={(build) => onBuildChange(slot.key, build)} runtime={runtime} /></div>}
      <RetainedConfiguration build={slot.build} runtime={runtime} />
      {fainted ? (
        <>
          <p data-doubles-fainted={slotId} className="mt-1 text-xs font-semibold text-danger">{FAINTED}</p>
          {faintedMaximum !== null ? (
            <>
              <p className="tabular-nums"><span className="text-xl font-bold text-text">0</span><span className="text-sm text-muted"> / {faintedMaximum} HP</span></p>
              <div role="meter" aria-label={`${label} current HP`} aria-valuemin={0} aria-valuemax={faintedMaximum} aria-valuenow={0} aria-valuetext={`${FAINTED}: 0 of ${faintedMaximum} HP`} title={`${FAINTED}: 0 of ${faintedMaximum} HP`} className="mt-1 h-2 rounded-full bg-panel-hover" />
            </>
          ) : <p className="mt-1 wrap-anywhere text-sm font-semibold text-danger">{unavailable}</p>}
        </>
      ) : hp || health ? (
        <>
          <p className="mt-1 wrap-anywhere text-xs font-semibold text-muted">{cardHPLabel(!!hp, rollMode, slot.build.mechanic, afterTurn)}</p>
          <p className="tabular-nums"><span className="text-xl font-bold text-text">{shown}</span><span className="text-sm text-muted"> / {maximum} HP</span></p>
          <div role="meter" aria-label={`${label} ${hp ? "projected" : "current"} HP`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={shown} aria-valuetext={hpText} title={hpText} className="relative mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
            <div className={`h-full rounded-full ${fraction > 0.5 ? "bg-success" : fraction > 0.2 ? "bg-warning" : "bg-danger"}`} style={{ width: `${fraction * 100}%` }} />
            {/* The least to the most HP left over the turn's outcomes, over the selected roll's fill. */}
            {hp && range && <div data-hp-range aria-hidden="true" className="absolute inset-y-0 bg-text/25" style={{ left: `${hp.min / maximum * 100}%`, width: `${(hp.max - hp.min) / maximum * 100}%` }} />}
          </div>
          {conditions && <p data-doubles-conditions={slotId} className="mt-1 wrap-anywhere text-xs tabular-nums text-muted">{conditions}</p>}
          {hp && <p className="mt-1 wrap-anywhere text-xs tabular-nums text-muted">{hp.settled ? settledText(hp.settled) : `Turn start: ${hp.start} / ${hp.maximum}`}{ko && ` · KO chance: ${ko}`}</p>}
          {hp && hp.heals.length > 0 && <p className="mt-1 wrap-anywhere text-xs tabular-nums text-muted">{hp.heals.join(" ")}</p>}
        </>
      ) : <p className="mt-2 wrap-anywhere text-sm font-semibold text-danger">{unavailable}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3">
        <button type="button" aria-label={`Change ${label}`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)} className={linkButton}>Change<span className="sr-only sm:not-sr-only"> Pokémon</span></button>
        <button ref={editRef} type="button" aria-label={`Edit ${label} HP`} aria-expanded={editingHP} aria-controls={`${id}-hp-editor`} onClick={() => editingHP ? finishHP() : setEditingHP(true)} className={linkButton}>Edit HP</button>
      </div>
      <div id={`${id}-hp-editor`} hidden={!editingHP}>
        {editingHP && (
          <div className="mt-2 space-y-2 border-t border-line pt-3">
            <CurrentHPField
              ref={hpRef}
              id={`${id}-hp`}
              build={slot.build}
              runtime={runtime}
              issues={issues}
              text={slot.hpInput}
              onTextChange={(text) => onHPChange(slot.key, text)}
              allowFainted
              data-doubles-hp={slotId}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  finishHP();
                }
              }}
            />
            <Button size="sm" variant="secondary" className="min-h-11" aria-label={`Done editing ${label} HP`} onClick={finishHP}>Done</Button>
          </div>
        )}
      </div>
      {!fainted && <div role="group" aria-label={`${label} move`} className="mt-auto border-t border-line pt-2">
        <div className={styles.doublesQuickMoves}>
          {slot.moves.map((prepared, index) => {
            const quick = prepared.moveId ? runtime.movesById.get(prepared.moveId) : undefined;
            const selected = prepared.moveId !== null && action.moveId === prepared.moveId;
            const moveLabel = (selected ? effective?.name : undefined) ?? quick?.name ?? "Empty";
            const editing = !!replacement && replacement.owner.key === owner.key && replacement.owner.epoch === owner.epoch && replacement.slotIndex === index;
            return (
              <button
                key={index}
                type="button"
                data-move-owner={`${owner.key}:${owner.epoch}`}
                data-move-slot={index}
                data-move-session={editing ? replacement.session : undefined}
                aria-label={`${label} move ${index + 1}: ${moveLabel}${quick && moveLabel !== quick.name ? ` (from ${quick.name})` : ""}`}
                aria-describedby={`${id}-move-${index}-origin`}
                aria-controls={movesControl}
                aria-pressed={selected}
                onClick={() => onActivateMove(owner, index)}
                className={`min-h-11 min-w-0 rounded-lg border px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected || editing ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}
              >
                <span className="block wrap-anywhere text-xs font-semibold text-text">{moveLabel}</span>
                {quick && moveLabel !== quick.name && <span className="block wrap-anywhere text-xs text-muted">From {quick.name}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">{quick && <TypeBadge type={(selected ? effective?.type : undefined) ?? quick.type} />}{prepared.origin === "suggested" && <span>Suggested</span>}{prepared.origin === "required" && <span>Required</span>}{editing && <span className="text-accent-text">Editing</span>}</span>
                <span id={`${id}-move-${index}-origin`} className="sr-only">{describeMoveSlot(prepared)}</span>
              </button>
            );
          })}
        </div>
        <div className={`${styles.doublesQuickMoves} mt-1`}>
          <button type="button" data-doubles-no-move={slotId} aria-label={`${label}: no move`} aria-pressed={action.moveId === null} onClick={() => onChooseMove(owner, null)}
            className={`min-h-11 min-w-0 rounded-lg border px-1.5 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${action.moveId === null ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}><span className="text-xs">No move</span></button>
          <button type="button" data-doubles-all-moves={slotId} aria-label={`${label}: all moves`} aria-controls={movesControl} onClick={() => onShowMoves(owner)}
            className={`min-h-11 min-w-0 rounded-lg border px-1.5 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${offList ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}><span className="text-xs">All moves</span></button>
        </div>
        {offList && <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs text-text"><span className="wrap-anywhere font-semibold">Move: {moveName}</span>{move && <TypeBadge type={effective?.type ?? move.type} />}</p>}
        {action.moveId && rule && (
          <div data-doubles-target={slotId} className="mt-2 min-w-0">
            {/* One option (the other foe has fainted) is picked as the game does: the fact names it. */}
            {rule.kind === "choose" && rule.options.length > 1 && (
              <fieldset className="min-w-0">
                <legend className="text-xs font-semibold text-muted">Target<span className="sr-only"> for {label}</span></legend>
                <div className={`${styles.targets} mt-1`}>
                  {rule.options.map((option) => {
                    const checked = action.target === option;
                    return (
                      <label key={option} htmlFor={`${id}-target-${option}`}
                        className={`flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-lg border px-2 py-1 text-xs has-focus-visible:ring-2 has-focus-visible:ring-focus ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
                        <input id={`${id}-target-${option}`} type="radio" name={`${id}-target`} value={option} checked={checked} onChange={() => onTargetChange(owner, option)} className="sr-only" />
                        <span className={`wrap-anywhere font-semibold ${checked ? "text-accent-text" : "text-text"}`}>{targetName(names, slotId, option)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <p data-doubles-action={slotId} aria-hidden={(rule.kind === "choose" && rule.options.length > 1) || undefined} className="mt-1 wrap-anywhere text-xs text-muted">
              <PointedText text={actionFact(moveName, names, slotId, rule, action.target)} />
            </p>
          </div>
        )}
      </div>}
      <PokemonChooser
        label={label}
        build={slot.build}
        runtime={runtime}
        gameType="Doubles"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onChange={(build) => onBuildChange(slot.key, build)}
        roster={hasRoster && <RosterPicker panel={rosterPanel} role={slot.role} side={slotId} occupant={label} isDisabled={rosterDisabled} activeSource={slot.source} runtime={runtime} onSelect={(choice) => { onRosterSelect(slot.key, choice); setPickerOpen(false); }} />}
      />
    </>
  );
  if (!target) return <div data-doubles-slot={slotId} className="flex min-w-0 flex-col px-3 py-2 sm:px-4">{body}</div>;
  // The whole card is the click target for the move being aimed; its own controls sit above it and keep their clicks.
  const frame = target.selected ? "bg-accent-soft outline-2 -outline-offset-4 outline-accent" : "outline-2 outline-dashed -outline-offset-4 outline-accent hover:bg-panel-hover";
  return (
    <div data-doubles-slot={slotId} data-doubles-card-target={target.selected ? "selected" : "eligible"} className={`relative flex min-w-0 flex-col px-3 py-2 sm:px-4 ${frame}`}>
      <button type="button" data-doubles-card-pick={slotId} aria-label={target.label} aria-pressed={target.selected} onClick={target.onPick}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" />
      <div className={`${styles.cardTargetContent} relative z-10 flex min-w-0 flex-col`}>
        {target.chip && <p data-doubles-card-chip className="wrap-anywhere text-xs font-semibold text-accent-text">{target.chip}</p>}
        {body}
      </div>
    </div>
  );
}
