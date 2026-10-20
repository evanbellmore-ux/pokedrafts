"use client";

import { useId, useState } from "react";
import { DOUBLES_SLOTS, doublesNameParts, slotSide, type DoublesSideId, type DoublesSlotId, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions } from "@/app/lib/battle/types";
import DoublesCard, { type DoublesCardHandlers, type DoublesCardTarget, type DoublesCardView } from "./DoublesCard";
import { actsWithoutMoves } from "./doubles-format";
import DoublesTurn from "./DoublesTurn";
import type { DamageRollMode } from "./hp-preview";
import { getMoveOwner, type MoveOwner, type MoveReplacement } from "./roster-prep";
import styles from "./calculator.module.css";

export type { DoublesCardView };

export type DoublesSummaryProps = DoublesCardHandlers & {
  runtime: BattleRuntime; cards: Record<DoublesSlotId, DoublesCardView>;
  /** The four Pokémon's full names (doublesNames of the cards' builds). */
  names: Record<DoublesSlotId, string>;
  turn: DoublesTurnResult | null; blockedReason?: string;
  rollMode: DamageRollMode; onRollModeChange: (mode: DamageRollMode) => void;
  replacement: MoveReplacement | null; movesControl: string;
  /** The field's Magic Room and terrain (the cards' Mimicry comes with their views). */
  magicRoom: boolean; terrain: BattleConditions["terrain"];
  onShowStep: (owner: MoveOwner, moveId: string) => void; onFixSettings: () => void;
  /** The slot whose move the card frames aim at first (tests); afterwards the last slot given a move or a target. */
  defaultAiming?: DoublesSlotId | null;
  /** status2 R-U: the bench Pokémon's names by id (doubles-types turnBenchNames), for the turn's hits, residuals and switches on a newcomer. */
  benchNames?: Readonly<Record<string, string>>;
  /** A side whose bench the turn reads with none set, and Set bench's handler (DoublesTurn). */
  benchSide?: DoublesSideId | null; onSetBench?: (side: DoublesSideId) => void;
};

const rollLabels: Record<DamageRollMode, string> = { low: "Low", average: "Average", high: "High" };
/**
 * The opponent's row on top and yours below, as the game (and Training's board) shows them; each left card faces the one
 * across from it. Each side's cards share its hue (globals.css --type-side-*): a wash under the row and a dot by its name.
 */
const SIDES: { id: DoublesSideId; label: string; wash: string; dot: string }[] = [
  { id: "opponent", label: "Opponent's side", wash: "bg-side-opponent/12", dot: "bg-side-opponent" },
  { id: "own", label: "Your side", wash: "bg-side-own/12", dot: "bg-side-own" },
];

/**
 * The move the turn used for a slot's action when it differs (Z-Move, Max Move), from the turn or its start rows, and the
 * type its calculation gave it (Judgment's Plate, Multi-Attack's Memory, Weather Ball's weather...): the step's, else that
 * of a hit it calculated, else its start row's. The step is the Pokémon's own action, not a later copy of the same move
 * (a Dancer's copy, an instructed move: DoublesStep.copied).
 */
function effectiveMove(turn: DoublesTurnResult | null, view: DoublesCardView) {
  const moveId = view.action.moveId;
  if (!moveId || !turn || turn.status === "issues") return undefined;
  const step = turn.status === "ready" ? turn.steps.find((entry) => entry.slot === view.id && entry.moveId === moveId && !entry.copied) : undefined;
  const row = turn.startRows.find((entry) => entry.slot === view.id && entry.row.moveId === moveId)?.row;
  if (step) return { name: step.effectiveName, type: step.effectiveType ?? step.hits.find((hit) => hit.row)?.row?.effectiveType ?? row?.effectiveType };
  return row && { name: row.effectiveName, type: row.effectiveType };
}

/** The 2v2 summary: the damage roll, each side's two cards, then the turn. Not sticky: it is taller than a screen. */
export default function DoublesSummary(props: DoublesSummaryProps) {
  const { runtime, cards, names, turn, blockedReason, rollMode, onRollModeChange, replacement, movesControl, onShowStep, onFixSettings } = props;
  const id = useId();
  // The card headings' parts, from the same builds as `names` (PokemonName: the side word for screen readers only).
  const nameParts = doublesNameParts(Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, cards[slot].slot])) as Record<DoublesSlotId, DoublesCardView["slot"]>, runtime);
  const noMoves = DOUBLES_SLOTS.every((slot) => cards[slot].action.moveId === null) && !actsWithoutMoves(turn);
  // The cards show the turn's HP only for a ready turn with a move, or with an end of turn that acts; otherwise their current HP.
  const projected = !blockedReason && !noMoves && turn?.status === "ready";
  const { onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic, onActivateMove, onChooseMove, onSwitchedIn, onShowMoves, onTargetChange } = props;
  // The card frames aim the move of the slot last given a move, a Moves pane or a target.
  const [aiming, setAiming] = useState<DoublesSlotId | null>(props.defaultAiming ?? null);
  const aim = (owner: MoveOwner) => setAiming(DOUBLES_SLOTS.find((slot) => cards[slot].slot.key === owner.key) ?? null);
  const cardHandlers: DoublesCardHandlers = {
    onBuildChange, onHPChange, onRosterSelect, onToggleMega, onToggleMechanic,
    onActivateMove: (owner, index) => { aim(owner); onActivateMove(owner, index); },
    onChooseMove: (owner, moveId) => { aim(owner); onChooseMove(owner, moveId); },
    ...(onSwitchedIn ? { onSwitchedIn } : {}),
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
    const actor = names[aimer.id];
    return {
      selected, label: `Target ${names[slot]} with ${actor}'s ${aimMove}`,
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
              <label key={mode} htmlFor={`${id}-roll-${mode}`} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold text-text sm:px-3 ${rollMode === mode ? "bg-panel-hover" : "hover:bg-panel-hover/60"}`}>
                <input id={`${id}-roll-${mode}`} type="radio" name={`${id}-damage-roll`} value={mode} checked={rollMode === mode} onChange={() => onRollModeChange(mode)} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
                {rollLabels[mode]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      {SIDES.map((side) => (
        <div key={side.id} role="group" aria-labelledby={`${id}-${side.id}`} data-doubles-side={side.id} className={`border-b border-line ${side.wash}`}>
          <h3 id={`${id}-${side.id}`} className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-muted sm:px-4">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${side.dot}`} />{side.label}
          </h3>
          <div className={styles.doublesSide}>
            {DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side.id).map((slot) => {
              const view = cards[slot];
              return (
                <DoublesCard
                  key={view.slot.key}
                  view={projected ? view : { ...view, hp: null, reached: false, switches: null }}
                  names={names}
                  nameParts={nameParts[slot]}
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
      <DoublesTurn runtime={runtime} names={names} cards={cards} turn={turn} blockedReason={blockedReason} rollMode={rollMode} movesControl={movesControl} magicRoom={props.magicRoom} benchNames={props.benchNames} benchSide={props.benchSide} onShowStep={onShowStep} onFixSettings={onFixSettings} onSetBench={props.onSetBench} />
    </section>
  );
}
