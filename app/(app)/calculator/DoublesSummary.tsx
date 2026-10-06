"use client";

import { useId, useState } from "react";
import { DOUBLES_SLOTS, slotSide, type DoublesSideId, type DoublesSlotId, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions } from "@/app/lib/battle/types";
import DoublesCard, { type DoublesCardHandlers, type DoublesCardTarget, type DoublesCardView } from "./DoublesCard";
import { baseName, relativeLabel } from "./doubles-format";
import DoublesTurn from "./DoublesTurn";
import type { DamageRollMode } from "./hp-preview";
import { getMoveOwner, type MoveOwner, type MoveReplacement } from "./roster-prep";
import styles from "./calculator.module.css";

export type { DoublesCardView };

export type DoublesSummaryProps = DoublesCardHandlers & {
  runtime: BattleRuntime; cards: Record<DoublesSlotId, DoublesCardView>; names: Record<DoublesSlotId, string>;
  turn: DoublesTurnResult | null; blockedReason?: string;
  rollMode: DamageRollMode; onRollModeChange: (mode: DamageRollMode) => void;
  replacement: MoveReplacement | null; movesControl: string;
  /** The field's Magic Room and terrain (the cards' Mimicry comes with their views). */
  magicRoom: boolean; terrain: BattleConditions["terrain"];
  onShowStep: (owner: MoveOwner, moveId: string) => void; onFixSettings: () => void;
  /** The slot whose move the card frames aim at first (tests); afterwards the last slot given a move or a target. */
  defaultAiming?: DoublesSlotId | null;
};

const rollLabels: Record<DamageRollMode, string> = { low: "Low", average: "Average", high: "High" };
const SIDES: { id: DoublesSideId; label: string }[] = [{ id: "own", label: "Your side" }, { id: "opponent", label: "Opponent's side" }];

/** The move the turn used for a slot's action when it differs (Z-Move, Max Move), from the turn or its start rows. */
function effectiveMove(turn: DoublesTurnResult | null, view: DoublesCardView) {
  const moveId = view.action.moveId;
  if (!moveId || !turn || turn.status === "issues") return undefined;
  const step = turn.status === "ready" ? turn.steps.find((entry) => entry.slot === view.id && entry.moveId === moveId) : undefined;
  if (step) return { name: step.effectiveName, type: step.effectiveType };
  const row = turn.startRows.find((entry) => entry.slot === view.id && entry.row.moveId === moveId)?.row;
  return row && { name: row.effectiveName, type: row.effectiveType };
}

/** The 2v2 summary: the damage roll, each side's two cards, then the turn. Not sticky: it is taller than a screen. */
export default function DoublesSummary(props: DoublesSummaryProps) {
  const { runtime, cards, names, turn, blockedReason, rollMode, onRollModeChange, replacement, movesControl, onShowStep, onFixSettings } = props;
  const id = useId();
  const noMoves = DOUBLES_SLOTS.every((slot) => cards[slot].action.moveId === null);
  // The cards show the turn's HP only for a ready turn with a move; otherwise their current HP.
  const projected = !blockedReason && !noMoves && turn?.status === "ready";
  const { onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, onActivateMove, onChooseMove, onShowMoves, onTargetChange } = props;
  // The card frames aim the move of the slot last given a move, a Moves pane or a target.
  const [aiming, setAiming] = useState<DoublesSlotId | null>(props.defaultAiming ?? null);
  const aim = (owner: MoveOwner) => setAiming(DOUBLES_SLOTS.find((slot) => cards[slot].slot.key === owner.key) ?? null);
  const cardHandlers: DoublesCardHandlers = {
    onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic,
    onActivateMove: (owner, index) => { aim(owner); onActivateMove(owner, index); },
    onChooseMove: (owner, moveId) => { aim(owner); onChooseMove(owner, moveId); },
    onShowMoves: (owner) => { aim(owner); onShowMoves(owner); },
    onTargetChange: (owner, target) => { aim(owner); onTargetChange(owner, target); },
  };
  const aimer = aiming ? cards[aiming] : null;
  // The same rule as the card's Target radios: a move with two or more Pokémon to pick from.
  const aimRule = aimer && !aimer.fainted && aimer.action.moveId && aimer.rule?.kind === "choose" && aimer.rule.options.length > 1 ? aimer.rule : null;
  const aimMove = aimer?.action.moveId
    ? (blockedReason ? undefined : effectiveMove(turn, aimer)?.name) ?? runtime.movesById.get(aimer.action.moveId)?.name ?? aimer.action.moveId : "";
  const cardTarget = (slot: DoublesSlotId): DoublesCardTarget | null => {
    if (!aimer || !aimRule || !aimRule.options.includes(slot)) return null;
    const selected = aimer.action.target === slot;
    const actor = baseName(names, aimer.id);
    return {
      selected, label: `Target ${baseName(names, slot)} (${relativeLabel(aimer.id, slot).toLowerCase()}) with ${actor}'s ${aimMove}`,
      chip: selected ? `Target of ${actor}'s ${aimMove}` : null,
      onPick: () => onTargetChange(getMoveOwner(aimer.slot), slot),
    };
  };

  return (
    <section data-doubles-summary aria-labelledby={`${id}-heading`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <h2 id={`${id}-heading`} className="sr-only">2v2 Pokémon, moves and HP</h2>
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
      {SIDES.map((side) => (
        <div key={side.id} role="group" aria-labelledby={`${id}-${side.id}`} data-doubles-side={side.id} className="border-b border-line">
          <h3 id={`${id}-${side.id}`} className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted sm:px-4">{side.label}</h3>
          <div className={styles.doublesSide}>
            {DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side.id).map((slot) => {
              const view = cards[slot];
              return (
                <DoublesCard
                  key={view.slot.key}
                  view={projected ? view : { ...view, hp: null, reached: false }}
                  names={names}
                  runtime={runtime}
                  rollMode={rollMode}
                  replacement={replacement}
                  movesControl={movesControl}
                  effective={blockedReason ? undefined : effectiveMove(turn, view)}
                  target={cardTarget(slot)}
                  {...cardHandlers}
                />
              );
            })}
          </div>
        </div>
      ))}
      <DoublesTurn runtime={runtime} names={names} cards={cards} turn={turn} blockedReason={blockedReason} rollMode={rollMode} movesControl={movesControl} magicRoom={props.magicRoom} onShowStep={onShowStep} onFixSettings={onFixSettings} />
    </section>
  );
}
