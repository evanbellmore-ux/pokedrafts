"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/app/components/ui";
import { DOUBLES_SLOTS, type DoublesSlotId, type DoublesStep, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { MoveDamageResult } from "@/app/lib/battle/types";
import { PointedText, type DoublesCardView } from "./DoublesCard";
import {
  actionTargets, actsWithoutMoves, copiedFact, copiedTargets, endNotEstimatedText, factLine, hitLine, idName, issueLines, leaverText, listedHits, namesFor, orderFact,
  recordOf, residualLine, rollDescription, startRowLine, stepHeading, stepMoveName, stepNames, substituteLine, turnSummary, type DoublesNames,
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
  /** status2 R-U: the bench Pokémon's names by id (doubles-types turnBenchNames), for hits, residuals and switches on a newcomer. */
  benchNames?: Readonly<Record<string, string>>;
  onShowStep: (owner: MoveOwner, moveId: string) => void;
  onFixSettings: () => void;
};

/** No bench Pokémon (a turn without a bench). */
const NO_NAMES: Readonly<Record<string, string>> = {};

/**
 * The step's targets from its slot's action, while the action is still the step's move. A copied step (a Dancer's copy, an
 * instructed move) is not its action: a move with no Pokémon target states its scope, any other names what it reached.
 */
function stepTargets(step: DoublesStep, view: DoublesCardView, names: DoublesNames, runtime: BattleRuntime) {
  if (step.copied) return copiedTargets(step, runtime);
  return view.action.moveId === step.moveId && view.rule ? actionTargets(names, step.slot, view.rule, view.action.target) : null;
}

/**
 * Show move opens the Moves pane on the step's move for its Pokémon, so a copied step has it only when the Pokémon learns
 * the move (a Dancer can copy a dance it does not know; an instructed move is its own), and a newcomer's step (DoublesStep.id:
 * a Pokémon with no card) has none.
 */
function showsMove(step: DoublesStep, view: DoublesCardView, runtime: BattleRuntime) {
  if (step.id !== undefined) return false;
  return !step.copied || view.action.moveId === step.moveId || view.slot.moves.some((prepared) => prepared.moveId === step.moveId)
    || !!runtime.speciesById.get(view.slot.build.speciesId)?.moves.includes(step.moveId);
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
export default function DoublesTurn({ runtime, names, cards, turn, blockedReason, rollMode, movesControl, magicRoom = false, benchNames = NO_NAMES, onShowStep, onFixSettings }: Props) {
  const id = useId();
  // No moves chosen and nothing happens without them (no end of turn to show, no self-hit): nothing to list.
  const noMoves = DOUBLES_SLOTS.every((slot) => cards[slot].action.moveId === null) && !actsWithoutMoves(turn);
  const live = blockedReason ?? (turn?.status !== "issues" && noMoves ? "No moves chosen." : turnSummary(turn, names, rollMode, benchNames));

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
    // HP lost outside any step (a No-move Pokémon's confusion self-hit), in slot order; status2 integration 2: then each
    // newcomer's losses as it came in during the moves (its hazards: "Corviknight loses 21 HP (Stealth Rock)."), which name it.
    const losses = DOUBLES_SLOTS.flatMap((slot) => [
      ...(turn.hp[slot]?.losses ?? []),
      ...Object.values(turn.hpEntered?.[slot] ?? {}).flatMap((entered) => entered.losses ?? []),
    ].map((loss) => ({ slot, loss })));
    const end = turn.endOfTurn;
    const divided = turn.steps.length > 0 || losses.length > 0 ? "border-t border-line pt-2" : "";
    // status2 R-U: each switch after the residual, by slot: who left at what HP, then who came in.
    const endSwitches = end.status === "ready" ? DOUBLES_SLOTS.flatMap((slot) => {
      const replaced = end.replaced?.[slot];
      if (!replaced) return [];
      return [
        ...replaced.left.map((entry) => ({ slot, text: factLine({ text: leaverText({ name: idName(names, benchNames, slot, entry.id), hp: entry.hp, chance: entry.chance }), chance: entry.chance }) })),
        ...replaced.entered.flatMap((entry) => [
          { slot, text: factLine({ text: `${idName(names, benchNames, slot, entry.id)} comes in.`, chance: entry.chance }) },
          // status2 integration 2: its losses as it came in (its hazards), from the end of turn's record of it.
          ...(end.hpEntered?.[slot]?.[entry.id]?.losses ?? []).map((loss) => ({ slot, text: factLine(loss) })),
        ]),
      ];
    }) : [];
    body = (
      <div className="space-y-2">
        {/* No step: every Pokémon with a move has fainted or has no target (the facts say which). */}
        {turn.steps.length > 0 && <ol aria-label="Actions in turn order" className="space-y-2">
          {turn.steps.map((step, index) => {
            const view = cards[step.slot];
            const move = stepMoveName(step, runtime);
            // status2 R: the step's Pokémon and the Pokémon it reached, a newcomer by its name (DoublesStep.id, DoublesHit.id).
            const named = stepNames(names, benchNames, step);
            const order = orderFact(step.order);
            // A calling move (Sleep Talk, Copycat, Nature Power...) that calculated a damaging hit is not a status move's line.
            const status = runtime.movesById.get(step.moveId)?.category === "Status" && !step.hits.some((hit) => hit.row);
            const hits = listedHits(step);
            // A Dancer's or Instruct's copy is a later step of the same Pokémon, headed by the copy's own fact (DoublesStep.copied).
            const { heading, facts } = copiedFact(step);
            return (
              // The index keeps two copies of one move by one Pokémon apart (a Dancer copying two Swords Dances).
              <li key={`${index}-${step.slot}-${step.moveId}${step.copied ? `-${step.copied}` : ""}`} data-doubles-step={step.slot} data-doubles-copied={step.copied}
                className="min-w-0 border-t border-line pt-2 first:border-t-0 first:pt-0">
                {heading && <p data-doubles-copy-fact={step.slot} className="wrap-anywhere text-xs font-semibold text-muted">{factLine(heading)}</p>}
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <p className="min-w-0 flex-1 wrap-anywhere text-sm font-semibold text-text"><PointedText text={stepHeading(index + 1, step, named, runtime, stepTargets(step, view, named, runtime))} /></p>
                  {showsMove(step, view, runtime) && (
                    <Button size="sm" variant="secondary" className="min-h-11 shrink-0 px-2" aria-controls={movesControl} onClick={() => onShowStep(getMoveOwner(view.slot), step.moveId)}>
                      <span className="text-xs">Show move<span className="sr-only"> {move}, {named[step.slot]}</span></span>
                    </Button>
                  )}
                </div>
                {order && <p className="mt-0.5 text-xs tabular-nums text-muted">{order}</p>}
                {[...step.skipped, ...facts].map((fact, factIndex) => <p key={factIndex} className="mt-0.5 wrap-anywhere text-xs text-muted">{factLine(fact)}</p>)}
                {hits.length > 0 && (
                  // Named after the move and its user: two Pokémon can use one move in a turn.
                  <ul aria-label={`${move} hits from ${named[step.slot]}`} className="mt-1 space-y-1">
                    {hits.map((hit) => {
                      // status2 R-U: a hit on a newcomer (DoublesHit.id) names it, and its certain KO is its own record's.
                      const hitNames = namesFor(names, benchNames, hit.slot, hit.id);
                      // A calculated hit that also met a Substitute: the Substitute's line, then the hits that reached the Pokémon.
                      const sub = hit.kind === "calculated" ? substituteLine(hit, hitNames) : null;
                      return (
                        <li key={`${hit.slot}${hit.id ? `-${hit.id}` : ""}`} data-doubles-hit={hit.slot} className="wrap-anywhere text-xs tabular-nums text-text">
                          {sub && <span data-doubles-substitute-hit={hit.slot} className="block">{sub}</span>}
                          {hitLine(hit, hitNames, chosenHits(runtime, cards, step.slot, step.moveId, hit.slot, hit.row, magicRoom), status, recordOf(turn.hp, turn.hpEntered, hit.slot, hit.id)?.koChance === 1)}
                          {hit.facts.map((fact, factIndex) => <span key={factIndex} className="block text-muted">{factLine(fact)}</span>)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>}
        {losses.length > 0 && (
          <ul className={`space-y-1 text-xs tabular-nums text-text ${turn.steps.length ? "border-t border-line pt-2" : ""}`}>
            {losses.map(({ slot, loss }, index) => <li key={index} data-doubles-loss={slot} className="wrap-anywhere">{factLine(loss)}</li>)}
          </ul>
        )}
        {end.status === "not-estimated" ? (
          <p data-doubles-end-not-estimated className={`wrap-anywhere text-xs font-semibold text-text ${divided}`}>{endNotEstimatedText(end.reason)}</p>
        ) : (end.residuals.length > 0 || end.facts.length > 0 || endSwitches.length > 0) && (
          <div data-doubles-end className={divided}>
            <h4 id={`${id}-end`} className="text-xs font-semibold text-muted">End of turn</h4>
            {end.residuals.length > 0 && (
              <ul aria-labelledby={`${id}-end`} className="mt-1 space-y-1 text-xs tabular-nums text-text">
                {end.residuals.map((residual, index) => (
                  <li key={index} data-doubles-residual={residual.slot} className="wrap-anywhere">
                    {residualLine(residual, names, recordOf(end.hp, end.hpEntered, residual.slot, residual.id)?.koChance === 1, benchNames)}
                    {residual.facts.map((fact, factIndex) => <span key={factIndex} className="block text-muted">{factLine(fact)}</span>)}
                  </li>
                ))}
              </ul>
            )}
            {end.facts.length > 0 && <ul aria-label="End-of-turn facts" className="mt-1 space-y-1 text-xs text-muted">{end.facts.map((fact, index) => <li key={index} className="wrap-anywhere">{fact}</li>)}</ul>}
            {/* status2 R-U: the switches after the residual (Eject Pack, Emergency Exit, Wimp Out), which no step states. */}
            {endSwitches.length > 0 && (
              <ul aria-label="Switches after the turn" className="mt-1 space-y-1 text-xs tabular-nums text-text">
                {endSwitches.map((line, index) => <li key={index} data-doubles-end-switch={line.slot} className="wrap-anywhere">{line.text}</li>)}
              </ul>
            )}
          </div>
        )}
        {turn.facts.length > 0 && <ul aria-label="Turn facts" className={`space-y-1 text-xs text-muted ${divided}`}>{turn.facts.map((fact, index) => <li key={index} className="wrap-anywhere">{fact}</li>)}</ul>}
      </div>
    );
  }

  return (
    <section data-doubles-turn aria-labelledby={`${id}-heading`} className="min-w-0 border-t border-line bg-accent-soft px-3 py-2 sm:px-4">
      <h3 id={`${id}-heading`} className="text-xs font-medium text-muted">Turn · {rollDescription(rollMode)}</h3>
      <p data-doubles-live aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>
      {body && <div className="mt-1">{body}</div>}
    </section>
  );
}
