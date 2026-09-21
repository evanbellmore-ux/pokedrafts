"use client";

import { useEffect, useId, useRef, useState } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button } from "@/app/components/ui";
import { movesById, speciesById } from "@/app/lib/battle/catalog";
import type { BattleBuild, BuildIssue, MoveDamageResult } from "@/app/lib/battle/types";
import CurrentHPField from "./CurrentHPField";
import { RosterPicker } from "./LeagueMatchupPicker";
import PokemonChooser from "./PokemonChooser";
import { getBuildHealth, previewRemainingHP, type DamageRollMode } from "./hp-preview";
import { formatRange, koChance } from "./result-format";
import type { CalculatorRosterState } from "./roster-data";
import { getRosterPanel, type BattleSide, type PreparedMatchup, type RosterChoice } from "./roster-prep";

const rollLabels: Record<DamageRollMode, string> = { low: "Low", average: "Average", high: "High" };

type EditProps = {
  rosterState?: CalculatorRosterState;
  onBuildChange: (key: number, build: BattleBuild) => void;
  onHPChange: (key: number, text: string) => void;
  onRosterSelect: (key: number, choice: RosterChoice) => void;
};

type Props = EditProps & {
  attacker: PreparedMatchup["attacker"];
  defender: PreparedMatchup["defender"];
  issues: Record<BattleSide, BuildIssue[]>;
  selectedMoveId: string | null;
  selectedRow: MoveDamageResult | undefined;
  rollMode: DamageRollMode;
  onRollModeChange: (mode: DamageRollMode) => void;
  blockedReason?: string;
  movesControl: string;
  onShowMove: () => void;
};

type CombatantProps = EditProps & {
  slot: PreparedMatchup["attacker"];
  side: BattleSide;
  issues: BuildIssue[];
  projected: Extract<ReturnType<typeof previewRemainingHP>, { status: "ready" }> | null;
  moveName: string | null;
  rollDescription: string;
};

function SummaryCombatant({ slot, side, issues, projected, moveName, rollDescription, rosterState, onBuildChange, onHPChange, onRosterSelect }: CombatantProps) {
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingHP, setEditingHP] = useState(false);
  const hpRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const species = speciesById.get(slot.build.speciesId);
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
      <p className="text-xs font-semibold text-muted">{side === "attacker" ? "Attacker" : "Defender"} · {slot.source ? ownership : "Manual"}</p>
      <h3 className="mt-1 wrap-anywhere text-base font-bold leading-snug text-text sm:text-xl">{species?.name ?? "Choose Pokémon"}</h3>
      <p className="mt-1 text-xs text-muted sm:hidden">{species?.types.join(" / ")}</p>
      <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{species?.types.map((type) => <TypeBadge key={type} type={type} />)}</div>
      {health ? (
        <>
          <p className="mt-2 wrap-anywhere text-xs font-semibold text-muted">{hpLabel}</p>
          <p className="tabular-nums"><span className="text-2xl font-bold text-text">{displayedHP}</span><span className="text-sm text-muted"> / {health.maximum} HP</span></p>
          <div role="meter" aria-label={`${species?.name ?? side} ${side} ${projected ? "projected" : "current"} HP`} aria-valuemin={0} aria-valuemax={health.maximum} aria-valuenow={displayedHP} aria-valuetext={hpText} title={hpText} className="mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
            <div className={`h-full rounded-full ${fraction > 0.5 ? "bg-success" : fraction > 0.2 ? "bg-warning" : "bg-danger"}`} style={{ width: `${fraction * 100}%` }} />
          </div>
          {projected && <p className="mt-1 text-xs tabular-nums text-muted">Current HP: {health.current} / {health.maximum}</p>}
        </>
      ) : <p className="mt-2 text-sm font-semibold text-danger">{issues.some((issue) => issue.field === "currentHP") ? "Edit HP to fix the current value" : "Check build settings to show HP"}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3">
        <button type="button" aria-label={`Change ${side} Pokémon`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Change<span className="sr-only sm:not-sr-only"> Pokémon</span></button>
        <button ref={editRef} type="button" aria-label={`Edit ${side} HP`} aria-expanded={editingHP} aria-controls={`${id}-hp-editor`} onClick={() => editingHP ? finishHP() : setEditingHP(true)} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Edit HP</button>
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
            <Button size="sm" variant="secondary" className="min-h-11" aria-label={`Done editing ${side} HP`} onClick={finishHP}>Done</Button>
          </div>
        )}
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

export default function MatchupSummary({ attacker, defender, issues, selectedMoveId, selectedRow, rollMode, onRollModeChange, blockedReason, movesControl, onShowMove, ...editProps }: Props) {
  const id = useId();
  const move = selectedMoveId ? movesById.get(selectedMoveId) : undefined;
  const row = selectedMoveId && selectedRow?.moveId === selectedMoveId && !blockedReason ? selectedRow : undefined;
  const preview = previewRemainingHP(defender.build, row, rollMode);
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
              projected={side === "defender" && preview.status === "ready" ? preview : null}
              moveName={move?.name ?? selectedMoveId}
              rollDescription={rollDescription}
              {...editProps}
            />
          );
        })}
      </div>
      <div className="border-t border-line bg-accent-soft px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
            {!selectedMoveId ? (
              <p className="text-sm font-medium text-accent-text">Choose a move in Moves to preview damage and HP remaining.</p>
            ) : (
              <>
                <p className="wrap-anywhere text-sm font-bold text-text">{move?.name ?? selectedMoveId}</p>
                {blockedReason ? <p className="mt-1 text-sm text-muted">{blockedReason}</p> : (
                  <>
                    {preview.status === "ready" && <p className="mt-1 text-sm tabular-nums text-text"><strong>{preview.damage} damage</strong> · {rollDescription}</p>}
                    {row?.kind === "calculated" && <p className="mt-1 text-xs tabular-nums text-muted">{formatRange(row.min, row.max)} damage range · One-use KO: {koChance(row)} (all rolls)</p>}
                    {preview.status === "ready" ? (
                      <p className="mt-1 text-sm text-text">Defender HP remaining: <strong className="whitespace-nowrap text-lg tabular-nums">{preview.remaining} / {preview.maximum}</strong></p>
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
