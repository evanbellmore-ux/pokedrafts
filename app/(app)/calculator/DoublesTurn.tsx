"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/app/components/ui";
import { DOUBLES_SLOTS, type DoublesSlotId, type DoublesStep, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { MoveDamageResult } from "@/app/lib/battle/types";
import { PointedText, type DoublesCardView } from "./DoublesCard";
import {
  actionTargets, factLine, hitLine, issueLines, orderFact, positionedName, rollDescription, startRowLine, stepHeading, stepMoveName, turnSummary,
  type DoublesNames,
} from "./doubles-format";
import type { DamageRollMode } from "./hp-preview";
import { isConverted, rowHitRule } from "./MoveResults";
import { getMoveOwner, type MoveOwner } from "./roster-prep";

type Props = {
  runtime: BattleRuntime;
  names: DoublesNames;
  cards: Record<DoublesSlotId, DoublesCardView>;
  turn: DoublesTurnResult | null;
  blockedReason?: string;
  rollMode: DamageRollMode;
  movesControl: string;
  /** Magic Room, which can switch Loaded Dice off (the hit-count rule). */
  magicRoom?: boolean;
  onShowStep: (owner: MoveOwner, moveId: string) => void;
  onFixSettings: () => void;
};

/** The step's targets from its slot's action, while the action is still the step's move. */
function stepTargets(step: DoublesStep, view: DoublesCardView, names: DoublesNames) {
  return view.action.moveId === step.moveId && view.rule ? actionTargets(names, step.slot, view.rule, view.action.target) : null;
}

/**
 * `slot`'s move `moveId` into `target` uses a hit count chosen in its move settings, which the line names: the 1v1 rule
 * (MoveResults chosenHits, MatchupSummary chosenHits) with the target's ability, as the turn reads the slot's contexts.
 */
function chosenHits(runtime: BattleRuntime, cards: Record<DoublesSlotId, DoublesCardView>, slot: DoublesSlotId, moveId: string, target: DoublesSlotId, row: MoveDamageResult | undefined, magicRoom: boolean) {
  const { build, contexts } = cards[slot].slot;
  const move = runtime.movesById.get(moveId);
  const context = contexts[moveId];
  return !!move && !!row && context?.hits !== undefined && !isConverted(move, row, context, build)
    && rowHitRule(move, row, build, runtime, { magicRoom, opponentAbilityId: cards[target].slot.build.abilityId }).kind === "choose";
}

/** The 2v2 turn (data-doubles-turn): each move in Showdown order with each Pokémon it reaches, or why it is not shown. */
export default function DoublesTurn({ runtime, names, cards, turn, blockedReason, rollMode, movesControl, magicRoom = false, onShowStep, onFixSettings }: Props) {
  const id = useId();
  const noMoves = DOUBLES_SLOTS.every((slot) => cards[slot].action.moveId === null);
  const live = blockedReason ?? (turn?.status !== "issues" && noMoves ? "No moves chosen." : turnSummary(turn, names, rollMode));

  let body: ReactNode = null;
  if (blockedReason) body = <p className="text-sm text-muted">{blockedReason}</p>;
  else if (turn?.status === "issues") {
    body = (
      <div className="space-y-2">
        <ul className="space-y-1 text-sm text-danger">{issueLines(turn.issues, names).map((line, index) => <li key={index} className="wrap-anywhere">{line}</li>)}</ul>
        <Button size="sm" variant="secondary" className="min-h-11" onClick={onFixSettings}>Fix settings</Button>
      </div>
    );
  } else if (noMoves) body = <p className="text-sm text-muted">No moves chosen.</p>;
  else if (turn?.status === "not-estimated") {
    body = (
      <div className="space-y-2">
        <p data-doubles-not-estimated className="wrap-anywhere text-sm font-semibold text-text">Turn not estimated: {turn.reason}</p>
        {turn.startRows.length > 0 && (
          <div>
            <h4 id={`${id}-start`} className="text-xs font-semibold text-muted">At the start of the turn</h4>
            <ul aria-labelledby={`${id}-start`} className="mt-1 space-y-1 text-xs tabular-nums text-text">
              {turn.startRows.map((entry, index) => <li key={index} data-doubles-start-row={entry.slot} className="wrap-anywhere"><PointedText text={startRowLine(entry, names, runtime, chosenHits(runtime, cards, entry.slot, entry.row.moveId, entry.target, entry.row, magicRoom))} /></li>)}
            </ul>
          </div>
        )}
        {turn.facts.length > 0 && <ul className="space-y-1 text-xs text-muted">{turn.facts.map((fact, index) => <li key={index} className="wrap-anywhere">{fact}</li>)}</ul>}
      </div>
    );
  } else if (turn?.status === "ready") {
    body = (
      <div className="space-y-2">
        <ol aria-label="Actions in turn order" className="space-y-2">
          {turn.steps.map((step, index) => {
            const view = cards[step.slot];
            const move = stepMoveName(step, runtime);
            const order = orderFact(step.order);
            return (
              <li key={`${step.slot}-${step.moveId}`} data-doubles-step={step.slot} className="min-w-0 border-t border-line pt-2 first:border-t-0 first:pt-0">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <p className="min-w-0 flex-1 wrap-anywhere text-sm font-semibold text-text"><PointedText text={stepHeading(index + 1, step, names, runtime, stepTargets(step, view, names))} /></p>
                  <Button size="sm" variant="secondary" className="min-h-11 shrink-0 px-2" aria-controls={movesControl} onClick={() => onShowStep(getMoveOwner(view.slot), step.moveId)}>
                    <span className="text-xs">Show move<span className="sr-only"> {move}, {positionedName(names, step.slot)}</span></span>
                  </Button>
                </div>
                {order && <p className="mt-0.5 text-xs tabular-nums text-muted">{order}</p>}
                {[...step.skipped, ...step.facts].map((fact, factIndex) => <p key={factIndex} className="mt-0.5 wrap-anywhere text-xs text-muted">{factLine(fact)}</p>)}
                {step.hits.length > 0 && (
                  <ul aria-label={`${move} hits`} className="mt-1 space-y-1">
                    {step.hits.map((hit) => (
                      <li key={hit.slot} data-doubles-hit={hit.slot} className="wrap-anywhere text-xs tabular-nums text-text">
                        {hitLine(hit, names, chosenHits(runtime, cards, step.slot, step.moveId, hit.slot, hit.row, magicRoom))}
                        {hit.facts.map((fact, factIndex) => <span key={factIndex} className="block text-muted">{factLine(fact)}</span>)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
        {turn.facts.length > 0 && <ul aria-label="Turn facts" className="space-y-1 border-t border-line pt-2 text-xs text-muted">{turn.facts.map((fact, index) => <li key={index} className="wrap-anywhere">{fact}</li>)}</ul>}
      </div>
    );
  }

  return (
    <section data-doubles-turn aria-labelledby={`${id}-heading`} className="min-w-0 border-t border-line bg-accent-soft px-3 py-2 sm:px-4">
      <h3 id={`${id}-heading`} className="text-xs font-semibold uppercase tracking-wide text-muted">Turn · {rollDescription(rollMode)}</h3>
      <p data-doubles-live aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>
      {body && <div className="mt-1">{body}</div>}
    </section>
  );
}
