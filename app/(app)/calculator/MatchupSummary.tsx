"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button } from "@/app/components/ui";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import { mimicryNote, mimicryState, type MimicryState } from "@/app/lib/battle/mimicry";
import { turnOrderQuestion } from "@/app/lib/battle/turn-order";
import type { BattleBuild, BattleConditions, BattleMechanic, BuildIssue, MoveDamageResult } from "@/app/lib/battle/types";
import MechanicControls, { RetainedConfiguration, TeraTypeField } from "./MechanicControls";
import CurrentHPField from "./CurrentHPField";
import { RosterPicker } from "./LeagueMatchupPicker";
import PokemonChooser from "./PokemonChooser";
import { getBuildHealth, previewRemainingHP, type DamageRollMode } from "./hp-preview";
import { formatRange, hitRangeText, koChance } from "./result-format";
import { KOText, rowHitRule, waitsForHits } from "./MoveResults";
import { usesToKOText } from "./uses-format";
import type { CalculatorRosterState } from "./roster-data";
import { getMoveOwner, getRosterPanel, sameMoveOwner, type BattleSide, type MoveOwner, type MoveReplacement, type PreparedMatchup, type RosterChoice, type RosterPanel, type RosterRole } from "./roster-prep";
import { describeMoveSlot } from "@/app/lib/battle/move-defaults";
import styles from "./calculator.module.css";

const rollLabels: Record<DamageRollMode, string> = { low: "Low", average: "Average", high: "High" };

type EditProps = {
  rosterState?: CalculatorRosterState;
  rosterPanels?: Record<RosterRole, RosterPanel>;
  onBuildChange: (key: number, build: BattleBuild) => void;
  onHPChange: (key: number, text: string) => void;
  onRosterSelect: (key: number, choice: RosterChoice) => void;
  onToggleMega: (owner: MoveOwner, formId: string) => void;
  onToggleMechanic?: (owner: MoveOwner, mechanic: BattleMechanic) => void;
  runtime?: BattleRuntime;
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
  /** Magic Room switches Loaded Dice off for the hit-count rule. */
  magicRoom?: boolean;
  /** The terrain, for Mimicry's type. */
  terrain?: BattleConditions["terrain"];
  /** Picks the usual ability for a Pokémon chosen here. */
  gameType?: BattleConditions["gameType"];
};

type CombatantProps = EditProps & QuickMoveProps & {
  slot: PreparedMatchup["attacker"];
  side: BattleSide;
  issues: BuildIssue[];
  projected: Extract<ReturnType<typeof previewRemainingHP>, { status: "ready" }> | null;
  moveName: string | null;
  rollDescription: string;
  selectedResult?: MoveDamageResult;
  mimicry?: MimicryState | null;
  gameType?: BattleConditions["gameType"];
};

function SummaryCombatant({ slot, side, issues, projected, moveName, rollDescription, selectedResult, rosterState, rosterPanels, onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, attack, replacement, movesControl, onActivateMove, mimicry, gameType, runtime = championsRuntime }: CombatantProps) {
  const id = useId();
  const position = side === "attacker" ? "left" : "right";
  const owner = getMoveOwner(slot);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingHP, setEditingHP] = useState(false);
  const hpRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const species = runtime.speciesById.get(slot.build.speciesId);
  const megaOptions = getMegaOptions(slot.build.speciesId, runtime, slot.megaBase?.speciesId);
  const baseName = megaOptions.length ? runtime.speciesById.get(megaOptions[0].baseSpeciesId)?.name : undefined;
  const health = getBuildHealth(slot.build, runtime);
  const teraType = runtime.profile.tera && slot.build.mechanic === "tera" ? slot.build.configuration?.teraType : undefined;
  const maxActive = slot.build.mechanic === "dynamax" || slot.build.mechanic === "gigantamax";
  const types = teraType && teraType !== "Stellar" ? [teraType] : mimicry?.type ? [mimicry.type] : species?.types;
  const displayedHP = projected?.remaining ?? health?.current ?? 0;
  const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
  const fraction = health ? displayedHP / health.maximum : 0;
  const hpLabel = projected ? `After ${moveName} · ${rollDescription}` : maxActive ? `Current HP (${slot.build.mechanic === "gigantamax" ? "Gigantamax" : "Dynamax"})` : "Current HP";
  const hpText = health ? `${displayedHP} of ${health.maximum} HP${projected ? ` after ${moveName}, ${rollDescription}. Current HP: ${health.current}.` : ""}` : "";
  const rosterPanel = rosterPanels?.[slot.role] ?? (rosterState ? getRosterPanel(rosterState, slot.role, runtime) : undefined);
  const hasRoster = rosterPanel?.choices.some((choice) => choice.source);

  useEffect(() => {
    if (editingHP) hpRef.current?.focus();
  }, [editingHP]);

  function finishHP() {
    setEditingHP(false);
    editRef.current?.focus();
  }

  return (
    <div data-summary-combatant={side} className="flex min-w-0 flex-col px-3 py-2 sm:px-4">
      {slot.source && <p className="wrap-anywhere text-xs font-semibold text-muted">{ownership}{slot.source.name !== species?.name ? ` · ${slot.source.name}` : ""}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="min-w-0 wrap-anywhere text-base font-bold leading-snug text-text sm:text-lg">{species?.name ?? "Choose Pokémon"}</h3>
        {megaOptions.length > 0 && (
          <div role="group" aria-label={`${baseName} ${position} ${megaOptions.every((option) => option.label.startsWith("Mega")) ? "Mega forms" : "battle forms"}`} className="flex min-w-0 flex-wrap gap-1">
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
                  aria-label={`${baseName} ${position} ${option.label}`}
                  aria-pressed={active}
                  title={[runtime.itemsById.get(option.itemId)?.name, option.requiredMove ? `Requires ${runtime.movesById.get(option.requiredMove)?.name ?? option.requiredMove}` : null, ...(form?.unsupported ?? [])].filter(Boolean).join(" — ")}
                  onClick={() => onToggleMega(owner, option.formId)}
                >{option.label}</Button>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted sm:hidden">{types?.join(" / ")}{teraType && ` · Tera ${teraType}`}</p>
      <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{types?.map((type) => <TypeBadge key={type} type={type} />)}{teraType && <span className="text-xs font-semibold text-accent-text">Tera {teraType}</span>}</div>
      {teraType && teraType !== "Stellar" && <p className="mt-1 text-xs text-muted">Original types: {species?.types.join(" / ")}</p>}
      {mimicry && species && <p className="mt-1 text-xs text-muted">{mimicryNote(mimicry, species.types)}</p>}
      <MechanicControls build={slot.build} position={position} runtime={runtime} onToggle={onToggleMechanic ? (mechanic) => onToggleMechanic(owner, mechanic) : undefined} />
      {runtime.profile.tera && <div className="mt-2"><TeraTypeField id={`${id}-tera-type`} build={slot.build} issues={issues} onChange={(build) => onBuildChange(slot.key, build)} runtime={runtime} /></div>}
      <RetainedConfiguration build={slot.build} runtime={runtime} />
      {health ? (
        <>
          <p className="mt-1 wrap-anywhere text-xs font-semibold text-muted">{hpLabel}</p>
          <p className="tabular-nums"><span className="text-xl font-bold text-text">{displayedHP}</span><span className="text-sm text-muted"> / {health.maximum} HP</span></p>
          <div role="meter" aria-label={`${species?.name ?? side} ${position} ${projected ? "projected" : "current"} HP`} aria-valuemin={0} aria-valuemax={health.maximum} aria-valuenow={displayedHP} aria-valuetext={hpText} title={hpText} className="mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
            <div className={`h-full rounded-full ${fraction > 0.5 ? "bg-success" : fraction > 0.2 ? "bg-warning" : "bg-danger"}`} style={{ width: `${fraction * 100}%` }} />
          </div>
          {projected && <p className="mt-1 text-xs tabular-nums text-muted">Current HP: {health.current} / {health.maximum}</p>}
        </>
      ) : <p className="mt-2 text-sm font-semibold text-danger">{issues.some((issue) => issue.field === "currentHP") ? "Edit HP to fix the current value"
        : issues.length === 1 && issues[0].field === "preparedMoves" ? issues[0].message.replace(/ A learnset is not proof.*$/, "")
        : "Check build settings to show HP"}</p>}
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
              build={slot.build}
              runtime={runtime}
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
      {/* At the card's foot, level with the other card's quick moves and the Build settings below them. */}
      <div role="group" aria-label={`${species?.name ?? "Pokémon"} ${position} quick moves`} className="mt-auto border-t border-line pt-2">
        <div className={styles.quickMoves}>
          {slot.moves.map((prepared, index) => {
            const move = prepared.moveId ? runtime.movesById.get(prepared.moveId) : undefined;
            const selected = prepared.moveId !== null && sameMoveOwner(attack.owner, owner) && attack.moveId === prepared.moveId;
            const effective = selected && selectedResult?.moveId === prepared.moveId ? selectedResult : undefined;
            const name = effective?.effectiveName ?? move?.name ?? "Choose move";
            const editing = replacement && sameMoveOwner(replacement.owner, owner) && replacement.slotIndex === index;
            return (
              <button
                key={index}
                type="button"
                data-move-owner={`${owner.key}:${owner.epoch}`}
                data-move-slot={index}
                data-move-session={editing ? replacement.session : undefined}
                aria-label={`${species?.name ?? "Pokémon"} ${position} move ${index + 1}: ${name}${name !== move?.name && move ? ` (from ${move.name})` : ""}`}
                aria-describedby={`${id}-move-${index}-origin`}
                aria-controls={movesControl}
                aria-pressed={selected}
                onClick={() => onActivateMove(owner, index)}
                className={`min-h-12 min-w-0 rounded-lg border px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected || editing ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}
              >
                <span className="block wrap-anywhere text-xs font-semibold text-text">{name}</span>
                {move && name !== move.name && <span className="block wrap-anywhere text-xs text-muted">From {move.name}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">{move && <TypeBadge type={effective?.effectiveType ?? move.type} />}{prepared.origin === "suggested" && <span>Suggested</span>}{prepared.origin === "required" && <span>Required</span>}{editing && <span className="text-accent-text">Editing</span>}</span>
                <span id={`${id}-move-${index}-origin`} className="sr-only">{describeMoveSlot(prepared)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <PokemonChooser
        side={side}
        build={slot.build}
        runtime={runtime}
        gameType={gameType}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onChange={(build) => onBuildChange(slot.key, build)}
        roster={hasRoster && <RosterPicker panel={rosterPanel} role={slot.role} side={side} activeSource={slot.source} runtime={runtime} onSelect={(choice) => { onRosterSelect(slot.key, choice); setPickerOpen(false); }} />}
      />
    </div>
  );
}

export default function MatchupSummary({ attacker, defender, issues, attack, replacement, resultIdentity, selectedRow, rollMode, onRollModeChange, blockedReason, movesControl, onActivateMove, onShowMove, runtime = championsRuntime, magicRoom = false, terrain = "", gameType, ...editProps }: Props) {
  const id = useId();
  const selectedMoveId = attack.moveId;
  const source = sameMoveOwner(attack.owner, getMoveOwner(attacker)) ? attacker : sameMoveOwner(attack.owner, getMoveOwner(defender)) ? defender : null;
  const receiver = source === defender ? attacker : defender;
  const sourceName = source && runtime.speciesById.get(source.build.speciesId)?.name;
  const receiverName = runtime.speciesById.get(receiver.build.speciesId)?.name;
  const receiverPosition = receiver === attacker ? "Left" : "Right";
  const move = selectedMoveId ? runtime.movesById.get(selectedMoveId) : undefined;
  const currentResult = source && resultIdentity && sameMoveOwner(resultIdentity.source, getMoveOwner(source)) && sameMoveOwner(resultIdentity.receiver, getMoveOwner(receiver));
  const row = currentResult && selectedMoveId && selectedRow?.moveId === selectedMoveId && !blockedReason ? selectedRow : undefined;
  const moveName = row?.effectiveName ?? move?.name ?? selectedMoveId;
  const preview = previewRemainingHP(receiver.build, row, rollMode, runtime);
  // Uses to KO covers every roll, so the roll choice above never changes it.
  const usesToKO = row?.kind === "calculated" ? usesToKOText(row) : null;
  const rollDescription = `${rollLabels[rollMode]} ${rollMode === "average" ? "estimate" : "roll"}`;
  const converted = source?.build.mechanic === "dynamax" || source?.build.mechanic === "gigantamax" || !!(selectedMoveId && source?.contexts[selectedMoveId]?.useZ)
    || !!(row?.effectiveName && move && row.effectiveName !== move.name && row.hits === 1);
  const hitRule = move && source ? rowHitRule(move, row, source.build, runtime, { magicRoom, opponentAbilityId: receiver.build.abilityId }) : null;
  const needsHits = !converted && row?.kind === "needs-context" && waitsForHits(hitRule, selectedMoveId ? source?.contexts[selectedMoveId] : undefined, row);
  const chosenHits = !converted && hitRule?.kind === "choose" && !!selectedMoveId && source?.contexts[selectedMoveId]?.hits !== undefined;
  const hits = row?.kind === "calculated" ? hitRangeText(row, chosenHits) : null;
  // Beat Up's party is chosen in the move settings, which Show move focuses.
  const needsParty = !converted && row?.kind === "needs-context" && move?.id === "beatup";
  // Analytic and Bolt Beak ask for the turn order in the same move settings.
  const needsTurnOrder = !!move && !!source && row?.kind === "needs-context" && /turn order/.test(row.reason ?? "")
    && !!turnOrderQuestion(move, source.build, converted, { opponentAbilityId: receiver.build.abilityId, magicRoom, gameType });

  return (
    <section data-calculator-summary aria-labelledby={`${id}-heading`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <h2 id={`${id}-heading`} className="sr-only">Active Pokémon and HP</h2>
      <fieldset className="min-w-0 border-b border-line px-3 py-0.5 sm:px-4">
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
              moveName={moveName}
              selectedResult={slot === source ? row : undefined}
              runtime={runtime}
              rollDescription={rollDescription}
              attack={attack}
              replacement={replacement}
              movesControl={movesControl}
              onActivateMove={onActivateMove}
              mimicry={mimicryState(slot.build, (side === "attacker" ? defender : attacker).build, { terrain, magicRoom })}
              gameType={gameType}
              {...editProps}
            />
          );
        })}
      </div>
      <div className="border-t border-line bg-accent-soft px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
            {!selectedMoveId ? (
              <p className="text-sm font-medium text-accent-text">Click either Pokémon’s quick move, or browse all moves below.</p>
            ) : (
              <>
                <p className="wrap-anywhere text-xs font-semibold text-muted">{sourceName ?? "Choose a Pokémon"} ({source === defender ? "right" : "left"}) → {receiverName} ({receiverPosition.toLowerCase()})</p>
                <p className="mt-1 wrap-anywhere text-sm font-bold text-text">{moveName}</p>
                {row?.effectiveName && move && row.effectiveName !== move.name && <p className="mt-1 wrap-anywhere text-xs text-muted">From {move.name} · {row.effectiveType} · {row.effectiveCategory} · Power {row.effectivePower ?? "—"}</p>}
                {blockedReason ? <p className="mt-1 text-sm text-muted">{blockedReason}</p> : (
                  <>
                    {preview.status === "ready" && <p className="mt-1 text-sm tabular-nums text-text"><strong>{preview.damage} damage</strong> · {rollDescription}</p>}
                    {row?.kind === "calculated" && <p className="mt-1 text-xs tabular-nums text-muted">{formatRange(row.min, row.max)} damage range{hits && `, ${hits}`}{row.alternate ? `, or ${formatRange(row.alternate.min, row.alternate.max)} with ${row.alternate.label} (${Math.round(row.alternate.chance * 100)}% chance)` : ""} · One-use KO: {koChance(row)} (all rolls{row.alternate ? ", both cases" : ""})</p>}
                    {usesToKO && <p className="mt-1 wrap-anywhere text-xs tabular-nums text-muted">Uses to KO: {row?.usesToKO ? <span className="font-semibold text-text"><KOText text={usesToKO.label} /></span> : usesToKO.label}{usesToKO.details.map((detail, index) => <Fragment key={index}> · <KOText text={detail} /></Fragment>)}</p>}
                    {preview.status === "ready" ? (
                      <>
                        <p className="mt-1 text-sm text-text">{receiverPosition} Pokémon HP remaining: <strong className="whitespace-nowrap text-lg tabular-nums">{preview.remaining} / {preview.maximum}</strong></p>
                        {preview.alternate && <p className="mt-1 text-xs tabular-nums text-muted">With {preview.alternate.label} ({Math.round(preview.alternate.chance * 100)}% chance, same {rollDescription}): {preview.alternate.damage} damage, {preview.alternate.remaining} / {preview.maximum} HP remaining.</p>}
                      </>
                    ) : <p className="mt-1 text-sm text-muted">{preview.reason}</p>}
                  </>
                )}
              </>
            )}
          </div>
          {row && <Button size="sm" variant="secondary" aria-controls={movesControl} onClick={onShowMove}>{needsHits ? "Set hits" : needsParty ? "Set party" : needsTurnOrder ? "Set turn order" : "Show move"}</Button>}
        </div>
      </div>
    </section>
  );
}
