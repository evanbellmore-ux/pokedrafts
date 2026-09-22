"use client";

import { useEffect, useId, useRef, useState } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button } from "@/app/components/ui";
import { itemsById, movesById, speciesById } from "@/app/lib/battle/catalog";
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import type { BattleBuild, BuildIssue, MoveDamageResult } from "@/app/lib/battle/types";
import CurrentHPField from "./CurrentHPField";
import { RosterPicker } from "./LeagueMatchupPicker";
import PokemonChooser from "./PokemonChooser";
import { getBuildHealth, previewRemainingHP, type DamageRollMode } from "./hp-preview";
import { formatRange, koChance } from "./result-format";
import type { CalculatorRosterState } from "./roster-data";
import { getMoveOwner, getRosterPanel, sameMoveOwner, type BattleSide, type MoveOwner, type MoveReplacement, type PreparedMatchup, type RosterChoice } from "./roster-prep";
import { describeMoveSlot } from "@/app/lib/battle/move-defaults";
import styles from "./calculator.module.css";

const rollLabels: Record<DamageRollMode, string> = { low: "Low", average: "Average", high: "High" };

type EditProps = {
  rosterState?: CalculatorRosterState;
  onBuildChange: (key: number, build: BattleBuild) => void;
  onHPChange: (key: number, text: string) => void;
  onRosterSelect: (key: number, choice: RosterChoice) => void;
  onToggleMega: (owner: MoveOwner, formId: string) => void;
};

type QuickMoveProps = {
  attack: PreparedMatchup["attack"];
  replacement: MoveReplacement | null;
  movesControl: string;
  onActivateMove: (owner: MoveOwner, slotIndex: number) => void;
};

type Props = EditProps & QuickMoveProps & {
  attacker: PreparedMatchup["attacker"];
  defender: PreparedMatchup["defender"];
  issues: Record<BattleSide, BuildIssue[]>;
  resultIdentity?: { source: MoveOwner; receiver: MoveOwner };
  selectedRow: MoveDamageResult | undefined;
  rollMode: DamageRollMode;
  onRollModeChange: (mode: DamageRollMode) => void;
  blockedReason?: string;
  onShowMove: () => void;
};

type CombatantProps = EditProps & QuickMoveProps & {
  slot: PreparedMatchup["attacker"];
  side: BattleSide;
  issues: BuildIssue[];
  projected: Extract<ReturnType<typeof previewRemainingHP>, { status: "ready" }> | null;
  moveName: string | null;
  rollDescription: string;
};

function SummaryCombatant({ slot, side, issues, projected, moveName, rollDescription, rosterState, onBuildChange, onHPChange, onRosterSelect, onToggleMega, attack, replacement, movesControl, onActivateMove }: CombatantProps) {
  const id = useId();
  const position = side === "attacker" ? "left" : "right";
  const owner = getMoveOwner(slot);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingHP, setEditingHP] = useState(false);
  const hpRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const species = speciesById.get(slot.build.speciesId);
  const megaOptions = getMegaOptions(slot.build.speciesId);
  const baseName = megaOptions.length ? speciesById.get(megaOptions[0].baseSpeciesId)?.name : undefined;
  const health = getBuildHealth(slot.build);
  const displayedHP = projected?.remaining ?? health?.current ?? 0;
  const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
  const fraction = health ? displayedHP / health.maximum : 0;
  const hpLabel = projected ? `After ${moveName} · ${rollDescription}` : "Current HP";
  const hpText = health ? `${displayedHP} of ${health.maximum} HP${projected ? ` after ${moveName}, ${rollDescription}. Current HP: ${health.current}.` : ""}` : "";
  const hasRoster = rosterState && getRosterPanel(rosterState, slot.role).choices.some((choice) => choice.source);

  useEffect(() => {
    if (editingHP) hpRef.current?.focus();
  }, [editingHP]);

  function finishHP() {
    setEditingHP(false);
    editRef.current?.focus();
  }

  return (
    <div data-summary-combatant={side} className="min-w-0 px-3 py-3 sm:px-5">
      <p className="text-xs font-semibold text-muted">{side === "attacker" ? "Left Pokémon" : "Right Pokémon"} · {slot.source ? ownership : "Manual"}</p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="min-w-0 wrap-anywhere text-base font-bold leading-snug text-text sm:text-xl">{species?.name ?? "Choose Pokémon"}</h3>
        {megaOptions.length > 0 && (
          <div role="group" aria-label={`${baseName} ${position} Mega forms`} aria-describedby={`${id}-mega-help`} className="flex min-w-0 flex-wrap gap-1">
            {megaOptions.map((option) => {
              const active = slot.build.speciesId === option.formId;
              const form = speciesById.get(option.formId);
              return (
                <Button
                  key={option.formId}
                  size="sm"
                  variant={active ? "primary" : "secondary"}
                  className="min-h-11 px-2 text-xs"
                  data-mega-form={option.formId}
                  aria-label={`${baseName} ${position} ${option.label}`}
                  aria-pressed={active}
                  title={[itemsById.get(option.itemId)?.name, ...(form?.unsupported ?? [])].join(" — ")}
                  onClick={() => onToggleMega(owner, option.formId)}
                >{option.label}</Button>
              );
            })}
          </div>
        )}
      </div>
      {megaOptions.length > 0 && <p id={`${id}-mega-help`} className="sr-only">Change form, ability and held stone without resetting preparation. Click the active Mega again to return to base.</p>}
      <p className="mt-1 text-xs text-muted sm:hidden">{species?.types.join(" / ")}</p>
      <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{species?.types.map((type) => <TypeBadge key={type} type={type} />)}</div>
      {health ? (
        <>
          <p className="mt-2 wrap-anywhere text-xs font-semibold text-muted">{hpLabel}</p>
          <p className="tabular-nums"><span className="text-2xl font-bold text-text">{displayedHP}</span><span className="text-sm text-muted"> / {health.maximum} HP</span></p>
          <div role="meter" aria-label={`${species?.name ?? side} ${position} ${projected ? "projected" : "current"} HP`} aria-valuemin={0} aria-valuemax={health.maximum} aria-valuenow={displayedHP} aria-valuetext={hpText} title={hpText} className="mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
            <div className={`h-full rounded-full ${fraction > 0.5 ? "bg-success" : fraction > 0.2 ? "bg-warning" : "bg-danger"}`} style={{ width: `${fraction * 100}%` }} />
          </div>
          {projected && <p className="mt-1 text-xs tabular-nums text-muted">Current HP: {health.current} / {health.maximum}</p>}
        </>
      ) : <p className="mt-2 text-sm font-semibold text-danger">{issues.some((issue) => issue.field === "currentHP") ? "Edit HP to fix the current value" : "Check build settings to show HP"}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3">
        <button type="button" aria-label={`Change ${position} Pokémon`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Change<span className="sr-only sm:not-sr-only"> Pokémon</span></button>
        <button ref={editRef} type="button" aria-label={`Edit ${position} HP`} aria-expanded={editingHP} aria-controls={`${id}-hp-editor`} onClick={() => editingHP ? finishHP() : setEditingHP(true)} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Edit HP</button>
      </div>
      <div id={`${id}-hp-editor`} hidden={!editingHP}>
        {editingHP && (
          <div className="mt-2 space-y-2 border-t border-line pt-3">
            <CurrentHPField
              ref={hpRef}
              id={`${id}-hp`}
              compact
              build={slot.build}
              issues={issues}
              text={slot.hpInput}
              onTextChange={(text) => onHPChange(slot.key, text)}
              data-summary-hp={side}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === "Escape") && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  finishHP();
                }
              }}
            />
            <Button size="sm" variant="secondary" className="min-h-11" aria-label={`Done editing ${position} HP`} onClick={finishHP}>Done</Button>
          </div>
        )}
      </div>
      <div role="group" aria-label={`${species?.name ?? "Pokémon"} ${position} quick moves`} className="mt-2 border-t border-line pt-2">
        <p className="mb-2 text-xs font-semibold text-muted">Quick moves <span className="font-normal">· click to calculate or replace</span></p>
        <div className={styles.quickMoves}>
          {slot.moves.map((prepared, index) => {
            const move = prepared.moveId ? movesById.get(prepared.moveId) : undefined;
            const selected = prepared.moveId !== null && sameMoveOwner(attack.owner, owner) && attack.moveId === prepared.moveId;
            const editing = replacement && sameMoveOwner(replacement.owner, owner) && replacement.slotIndex === index;
            return (
              <button
                key={index}
                type="button"
                data-move-owner={`${owner.key}:${owner.epoch}`}
                data-move-slot={index}
                data-move-session={editing ? replacement.session : undefined}
                aria-label={`${species?.name ?? "Pokémon"} ${position} move ${index + 1}: ${move?.name ?? "Choose move"}`}
                aria-describedby={`${id}-move-${index}-origin`}
                aria-controls={movesControl}
                aria-pressed={selected}
                onClick={() => onActivateMove(owner, index)}
                className={`min-h-12 min-w-0 rounded-lg border px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected || editing ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}
              >
                <span className="block wrap-anywhere text-xs font-semibold text-text">{move?.name ?? "Choose move"}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">{move && <TypeBadge type={move.type} />}{prepared.origin === "suggested" && <span>Suggested</span>}{editing && <span className="text-accent-text">Editing</span>}</span>
                <span id={`${id}-move-${index}-origin`} className="sr-only">{describeMoveSlot(prepared)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <PokemonChooser
        side={side}
        build={slot.build}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onChange={(build) => onBuildChange(slot.key, build)}
        roster={hasRoster && <RosterPicker state={rosterState} role={slot.role} side={side} activeSource={slot.source} onSelect={(choice) => { onRosterSelect(slot.key, choice); setPickerOpen(false); }} />}
      />
    </div>
  );
}

export default function MatchupSummary({ attacker, defender, issues, attack, replacement, resultIdentity, selectedRow, rollMode, onRollModeChange, blockedReason, movesControl, onActivateMove, onShowMove, ...editProps }: Props) {
  const id = useId();
  const selectedMoveId = attack.moveId;
  const source = sameMoveOwner(attack.owner, getMoveOwner(attacker)) ? attacker : sameMoveOwner(attack.owner, getMoveOwner(defender)) ? defender : null;
  const receiver = source === defender ? attacker : defender;
  const sourceName = source && speciesById.get(source.build.speciesId)?.name;
  const receiverName = speciesById.get(receiver.build.speciesId)?.name;
  const receiverPosition = receiver === attacker ? "Left" : "Right";
  const move = selectedMoveId ? movesById.get(selectedMoveId) : undefined;
  const currentResult = source && resultIdentity && sameMoveOwner(resultIdentity.source, getMoveOwner(source)) && sameMoveOwner(resultIdentity.receiver, getMoveOwner(receiver));
  const row = currentResult && selectedMoveId && selectedRow?.moveId === selectedMoveId && !blockedReason ? selectedRow : undefined;
  const preview = previewRemainingHP(receiver.build, row, rollMode);
  const rollDescription = `${rollLabels[rollMode]} ${rollMode === "average" ? "estimate" : "roll"}`;
  const needsHits = row?.kind === "needs-context" && Array.isArray(move?.multihit);

  return (
    <section data-calculator-summary aria-labelledby={`${id}-heading`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <h2 id={`${id}-heading`} className="sr-only">Active Pokémon and HP</h2>
      <fieldset aria-describedby={`${id}-roll-help`} className="min-w-0 border-b border-line px-3 py-1 sm:px-5">
        <legend className="sr-only">Damage roll</legend>
        <div className="flex flex-wrap items-center gap-x-3">
          <span aria-hidden="true" className="text-xs font-semibold text-muted">Damage roll</span>
          <div className="flex flex-wrap gap-1">
            {(["low", "average", "high"] as const).map((mode) => (
              <label key={mode} htmlFor={`${id}-roll-${mode}`} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold text-text sm:px-3 ${rollMode === mode ? "bg-accent-soft" : "hover:bg-panel-hover"}`}>
                <input id={`${id}-roll-${mode}`} type="radio" name={`${id}-damage-roll`} value={mode} checked={rollMode === mode} onChange={() => onRollModeChange(mode)} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
                {rollLabels[mode]}
              </label>
            ))}
          </div>
        </div>
        <p id={`${id}-roll-help`} className="sr-only">Low and High use minimum and maximum damage. Average uses the mean of all damage rolls, rounded to whole HP. Changes only the preview, not current HP.</p>
      </fieldset>
      <div className="grid grid-cols-2 divide-x divide-line">
        {(["attacker", "defender"] as const).map((side) => {
          const slot = side === "attacker" ? attacker : defender;
          return (
            <SummaryCombatant
              key={slot.key}
              slot={slot}
              side={side}
              issues={issues[side]}
              projected={slot === receiver && preview.status === "ready" ? preview : null}
              moveName={move?.name ?? selectedMoveId}
              rollDescription={rollDescription}
              attack={attack}
              replacement={replacement}
              movesControl={movesControl}
              onActivateMove={onActivateMove}
              {...editProps}
            />
          );
        })}
      </div>
      <div className="border-t border-line bg-accent-soft px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
            {!selectedMoveId ? (
              <p className="text-sm font-medium text-accent-text">Click either Pokémon’s quick move to calculate and edit that slot, or browse all moves below.</p>
            ) : (
              <>
                <p className="wrap-anywhere text-xs font-semibold text-muted">{sourceName ?? "Choose a Pokémon"} ({source === defender ? "right" : "left"}) → {receiverName} ({receiverPosition.toLowerCase()})</p>
                <p className="mt-1 wrap-anywhere text-sm font-bold text-text">{move?.name ?? selectedMoveId}</p>
                {blockedReason ? <p className="mt-1 text-sm text-muted">{blockedReason}</p> : (
                  <>
                    {preview.status === "ready" && <p className="mt-1 text-sm tabular-nums text-text"><strong>{preview.damage} damage</strong> · {rollDescription}</p>}
                    {row?.kind === "calculated" && <p className="mt-1 text-xs tabular-nums text-muted">{formatRange(row.min, row.max)} damage range · One-use KO: {koChance(row)} (all rolls)</p>}
                    {preview.status === "ready" ? (
                      <p className="mt-1 text-sm text-text">{receiverPosition} Pokémon HP remaining: <strong className="whitespace-nowrap text-lg tabular-nums">{preview.remaining} / {preview.maximum}</strong></p>
                    ) : <p className="mt-1 text-sm text-muted">{preview.reason}</p>}
                  </>
                )}
              </>
            )}
          </div>
          {row && <Button size="sm" variant="secondary" aria-controls={movesControl} onClick={onShowMove}>{needsHits ? "Set hits" : "Show move"}</Button>}
        </div>
        {preview.status === "ready" && <p className="mt-1 text-xs text-muted">{rollMode === "average" && "Average damage is the mean of all rolls, rounded to whole HP. "}Damage-only estimate if it connects. Current HP is unchanged; recoil, healing and later turns are not included.</p>}
      </div>
    </section>
  );
}
