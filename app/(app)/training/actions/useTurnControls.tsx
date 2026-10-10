"use client";

import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { actionFact } from "@/app/(app)/calculator/doubles-format";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { boardNames } from "../board/board-format";
import type { CardTarget } from "../board/BattleCard";
import type { AIStatus, BoardView, PlayerChoice, TrainingPhase } from "../model/view-types";
import ActionFieldset from "./ActionFieldset";
import {
  buildMoveAction, buildSwitchAction, EMPTY_SELECTION, MEGA_LABEL, megaBlockedBy, OWN_SLOTS, replaceSlots, slotOptions,
  type OwnSlot, type SlotSelection,
} from "./choice-builder";
import ForcedSwitchFieldset from "./ForcedSwitchFieldset";
import SubmitBar from "./SubmitBar";

/** targeting: the slot whose move the board's card frames aim (the last one given a move with a choice of targets). */
type Selections = { requestId: number | null; slots: [SlotSelection, SlotSelection]; picks: [string | null, string | null]; targeting: OwnSlot | null };
const fresh = (requestId: number | null): Selections => ({ requestId, slots: [EMPTY_SELECTION, EMPTY_SELECTION], picks: [null, null], targeting: null });

export type TurnControlsArgs = {
  runtime: BattleRuntime;
  board: BoardView;
  phase: TrainingPhase;
  ai: AIStatus;
  onSubmit(choice: PlayerChoice): void;
};
export type TurnControls = {
  formProps: ComponentProps<"form">;
  renderSlot(slot: OwnSlot): ReactNode;
  /** The card frame of a Pokémon the move being chosen can aim at. */
  cardTarget(slot: DoublesSlotId): CardTarget | null;
  submitBar: ReactNode;
};

/**
 * Your turn's controls. Selections belong to one request id: a new request clears them, a rejected choice keeps them
 * (its request keeps its id, SPEC 12.4). No preselection.
 */
export function useTurnControls({ runtime, board, phase, ai, onSubmit }: TurnControlsArgs): TurnControls {
  const request = phase.kind === "choose" || phase.kind === "switch" ? phase.request : null;
  const [state, setState] = useState<Selections>(() => fresh(request?.id ?? null));
  if (request && request.id !== state.requestId) setState(fresh(request.id));
  const selections = request && request.id === state.requestId ? state : fresh(request?.id ?? null);
  const names = boardNames(board);

  if (phase.kind === "choose") {
    const move = phase.request;
    const options = OWN_SLOTS.map((_, index) => slotOptions(move, board, index as 0 | 1, runtime));
    const built = buildMoveAction(move, board, selections.slots, runtime);
    // The slot's chosen move when it has two or more Pokémon to pick from (the same rule as its Target radios).
    const choosing = (index: number, selection: SlotSelection = selections.slots[index]) => {
      const choice = selection.choice;
      if (index >= move.active.length || options[index].passes || choice?.kind !== "move") return null;
      const option = options[index].moves.find((each) => each.id === choice.moveId);
      return option && !option.locked && option.rule.kind === "choose" && option.rule.options.length > 1 ? { option, targets: option.rule.options } : null;
    };
    const setSlot = (index: number, selection: SlotSelection) => setState((current) => {
      const slots = [...current.slots] as Selections["slots"];
      slots[index] = selection;
      const slot = OWN_SLOTS[index];
      const targeting = choosing(index, selection) ? slot : current.targeting === slot ? null : current.targeting;
      return { ...current, requestId: move.id, slots, targeting };
    });
    const marked = selections.targeting ? OWN_SLOTS.indexOf(selections.targeting) : -1;
    // The frames aim the marked slot's move, else the first move still without a target.
    const aiming = marked >= 0 && choosing(marked) ? marked : [0, 1].find((index) => choosing(index) && !selections.slots[index].target) ?? -1;
    const cardTarget = (target: DoublesSlotId): CardTarget | null => {
      const chips = [0, 1].flatMap((index) => {
        const pick = choosing(index);
        return pick && selections.slots[index].target === target ? [`Target of ${options[index].name}'s ${pick.option.name}`] : [];
      });
      const pick = aiming >= 0 ? choosing(aiming) : null;
      const eligible = !!pick && pick.targets.includes(target);
      if (!eligible && !chips.length) return null;
      const label = pick ? `Target ${names[target] || "—"} with ${options[aiming].name}'s ${pick.option.name}` : "";
      return {
        eligible, selected: eligible && selections.slots[aiming].target === target, label, chips,
        onPick: () => setState((current) => {
          const slots = [...current.slots] as Selections["slots"];
          slots[aiming] = { ...slots[aiming], target };
          // Then the other slot's move, if it still needs a target; else these frames keep aiming this one.
          const other = aiming === 0 ? 1 : 0;
          const targeting = choosing(other, slots[other]) && !slots[other].target ? OWN_SLOTS[other] : OWN_SLOTS[aiming];
          return { ...current, requestId: move.id, slots, targeting };
        }),
      };
    };
    const summary = "action" in built ? OWN_SLOTS.flatMap((slot, index) => {
      const each = built.action[slot];
      const option = options[index];
      if (!each || each.kind === "pass" || index >= move.active.length) return [];
      if (each.kind === "switch") return [`${option.name}: Switch to ${option.switches.find((entry) => entry.key === each.to)?.name ?? each.to}`];
      const chosen = option.moves.find((entry) => entry.id === each.moveId);
      const text = chosen ? (chosen.locked ? chosen.name : actionFact(chosen.name, names, slot, chosen.rule, each.target)) : each.moveId;
      return [`${option.name}: ${text}${each.mega ? ` · ${MEGA_LABEL[each.mega]}` : ""}`];
    }) : [];
    return {
      formProps: {
        onSubmit: (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if ("action" in built) onSubmit({ kind: "action", action: built.action });
        },
      },
      renderSlot(slot) {
        const index = OWN_SLOTS.indexOf(slot);
        const option = options[index];
        if (index >= move.active.length || option.passes) return null;
        const other = selections.slots[index === 0 ? 1 : 0];
        const otherSwitch = other.choice?.kind === "switch" ? { key: other.choice.key, name: options[index === 0 ? 1 : 0].name } : null;
        return (
          <ActionFieldset options={option} selection={selections.slots[index]} names={names} megaBlocked={megaBlockedBy(selections.slots, index as 0 | 1, options.map((each) => each.name))}
            otherSwitch={otherSwitch} onChange={(selection) => setSlot(index, selection)} />
        );
      },
      cardTarget,
      submitBar: <SubmitBar summary={summary} missing={"missing" in built ? built.missing : []} label="Submit turn" waiting={null} />,
    };
  }

  if (phase.kind === "switch") {
    const replace = phase.request;
    const slots = replaceSlots(replace, board);
    const bench = slots.find((slot) => slot.flagged)?.options.length ?? 0;
    const flaggedOrder = slots.filter((slot) => slot.flagged).map((slot) => slot.index);
    const built = buildSwitchAction(replace, board, selections.picks);
    const setPick = (index: number, key: string) => setState((current) => {
      const picks = [...current.picks] as Selections["picks"];
      picks[index] = key;
      return { ...current, requestId: replace.id, picks };
    });
    const summary = "action" in built ? slots.flatMap((slot) => {
      const each = built.action[slot.slot];
      if (!slot.flagged || each?.kind !== "switch") return [];
      return [`${slot.options.find((option) => option.key === each.to)?.name ?? each.to} replaces ${slot.name}`];
    }) : [];
    return {
      formProps: {
        onSubmit: (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if ("action" in built) onSubmit({ kind: "action", action: built.action });
        },
      },
      renderSlot(slot) {
        const each = slots.find((entry) => entry.slot === slot);
        if (!each?.flagged) return null;
        const other = slots.find((entry) => entry.flagged && entry.slot !== slot);
        const otherKey = other ? selections.picks[other.index] : null;
        return (
          <ForcedSwitchFieldset replace={each} midTurn={replace.midTurn} pick={selections.picks[each.index]}
            otherPick={other && otherKey ? { key: otherKey, name: other.name } : null}
            exhausted={flaggedOrder.indexOf(each.index) >= bench} onPick={(key) => setPick(each.index, key)} />
        );
      },
      cardTarget: () => null,
      submitBar: <SubmitBar summary={summary} missing={"missing" in built ? built.missing : []} label="Send out" waiting={null} />,
    };
  }

  const waiting = phase.kind === "waiting"
    ? phase.reason === "opponent-switch" ? "Opponent choosing a replacement…" : ai.status === "thinking" ? "AI choosing…" : `Simulating turn ${Math.max(1, board.turn)}…`
    : null;
  return {
    formProps: { onSubmit: (event: FormEvent<HTMLFormElement>) => event.preventDefault() },
    renderSlot: () => null,
    cardTarget: () => null,
    submitBar: waiting ? <SubmitBar summary={[]} missing={[]} label="Submit turn" waiting={waiting} /> : null,
  };
}
