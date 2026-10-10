"use client";

import { useId } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { slotsText, targetName } from "@/app/(app)/calculator/doubles-format";
import type { DoublesSlotId, DoublesTargetRule } from "@/app/lib/battle/doubles-types";
import type { BoardNames } from "../board/board-format";
import { MEGA_LABEL, type MoveOption, type SlotOptions, type SlotSelection } from "./choice-builder";
import { conditionText } from "./condition";
import styles from "./actions.module.css";

// One active Pokémon's choices as native radios (moves and switches in one group, SPEC D9), its Mega Evolution for this turn,
// and a Target group only when the move's rule lets you pick between two or more Pokémon.

/** What an automatic target reaches: "Both foes", "All adjacent", "A random foe", or the Pokémon by name ("Gyarados", as slotsText). */
const AUTO_FACT = (rule: Extract<DoublesTargetRule, { kind: "auto" }>, slot: DoublesSlotId, names: BoardNames) => {
  if (rule.random) return "A random foe";
  if (!rule.hits.length) return "No target";
  const foes = rule.hits.filter((hit) => hit.startsWith(slot.startsWith("own") ? "opponent" : "own")).length;
  const ally = rule.hits.length - foes;
  return foes === 2 && ally ? "All adjacent" : foes === 2 ? "Both foes" : slotsText(names, slot, rule.hits);
};
const NONE_FACT: Record<Extract<DoublesTargetRule, { kind: "none" }>["scope"], string> = {
  self: "Targets itself", "self-and-ally": "Targets itself and its ally", "own-side": "Targets its side", "foe-side": "Targets the foes' side",
  field: "Targets the field", "own-team": "Targets its team", "last-attacker": "Targets the foe that last hit it",
};
/** `names`: the board's full names (boardNames). */
export function ruleFact(move: MoveOption, slot: DoublesSlotId, names: BoardNames) {
  if (move.locked) return null;
  return move.rule.kind === "auto" ? AUTO_FACT(move.rule, slot, names) : move.rule.kind === "none" ? NONE_FACT[move.rule.scope] : null;
}

const card = "flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-lg border px-2 py-1.5 text-left text-xs has-focus-visible:ring-2 has-focus-visible:ring-focus has-disabled:cursor-not-allowed has-disabled:opacity-60";

export type ActionFieldsetProps = {
  options: SlotOptions;
  selection: SlotSelection;
  /** The board's full names (boardNames): target radios and automatic targets. */
  names: BoardNames;
  /** "Gyarados is Mega Evolving": the partner already Mega Evolves this turn. */
  megaBlocked: string | null;
  /** The bench member the other slot switches to, with that slot's Pokémon's name ("Gyarados"). */
  otherSwitch: { key: string; name: string } | null;
  onChange(selection: SlotSelection): void;
};

export default function ActionFieldset({ options, selection, names, megaBlocked, otherSwitch, onChange }: ActionFieldsetProps) {
  const id = useId();
  const { slot } = options;
  const choice = selection.choice;
  const move = choice?.kind === "move" ? options.moves.find((each) => each.id === choice.moveId) ?? null : null;
  const pick = (value: string) => {
    if (value.startsWith("move:")) {
      const moveId = value.slice(5);
      const next = options.moves.find((each) => each.id === moveId);
      const target = next?.rule.kind === "choose" && selection.target && next.rule.options.includes(selection.target) ? selection.target : null;
      onChange({ ...selection, choice: { kind: "move", moveId }, target });
    } else onChange({ choice: { kind: "switch", key: value.slice(7) }, target: null, mega: null });
  };
  const value = choice ? (choice.kind === "move" ? `move:${choice.moveId}` : `switch:${choice.key}`) : "";
  const megaReason = megaBlocked ?? (choice?.kind === "switch" ? "Switching" : null);
  return (
    <fieldset data-training-action={slot} className="min-w-0 space-y-2 p-2 sm:p-3">
      <legend className="wrap-anywhere text-xs font-semibold uppercase tracking-wide text-muted">{options.name}</legend>
      {options.mega.map((mechanic) => (
        <label key={mechanic} htmlFor={`${id}-${mechanic}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text has-disabled:cursor-not-allowed has-disabled:opacity-60">
          <input id={`${id}-${mechanic}`} type="checkbox" data-training-mechanic={mechanic} checked={selection.mega === mechanic}
            disabled={!!megaReason && selection.mega !== mechanic} aria-label={`${MEGA_LABEL[mechanic]} ${options.name}`}
            aria-describedby={megaReason ? `${id}-${mechanic}-reason` : undefined}
            onChange={(event) => onChange({ ...selection, mega: event.target.checked ? mechanic : null })} className="h-4 w-4 shrink-0 accent-accent" />
          {MEGA_LABEL[mechanic]}
          {megaReason && selection.mega !== mechanic && <span id={`${id}-${mechanic}-reason`} className="text-xs text-muted">{megaReason}</span>}
        </label>
      ))}
      <div className={styles.moves}>
        {options.moves.map((each, index) => {
          const checked = value === `move:${each.id}`;
          const fact = ruleFact(each, slot, names);
          return (
            <label key={each.id} htmlFor={`${id}-move-${index}`} data-training-move={index}
              className={`${card} ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
              <input id={`${id}-move-${index}`} type="radio" name={`${id}-action`} value={`move:${each.id}`} checked={checked} disabled={!!each.disabledReason}
                onChange={() => pick(`move:${each.id}`)} aria-describedby={`${id}-move-${index}-facts`} className="sr-only" />
              <span className="wrap-anywhere font-semibold text-text">{each.name}</span>
              <span id={`${id}-move-${index}-facts`} className="mt-0.5 flex flex-wrap items-center gap-1 text-muted">
                {each.type && <TypeBadge type={each.type} />}
                {each.pp !== null && <span className="tabular-nums">PP {each.pp}/{each.maxpp ?? each.pp}</span>}
                {fact && <span>{fact}</span>}
                {each.disabledReason && <span className="font-semibold text-danger">{each.disabledReason}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {!!options.switches.length && (
        <div className={styles.switches}>
          {options.switches.map((each, index) => {
            const checked = value === `switch:${each.key}`;
            const taken = otherSwitch?.key === each.key ? `Chosen for ${otherSwitch.name}` : null;
            const reason = each.disabledReason ?? taken;
            return (
              <label key={each.key} htmlFor={`${id}-switch-${index}`} data-training-switch={each.key}
                className={`${card} ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
                <input id={`${id}-switch-${index}`} type="radio" name={`${id}-action`} value={`switch:${each.key}`} checked={checked} disabled={!!reason}
                  onChange={() => pick(`switch:${each.key}`)} aria-describedby={`${id}-switch-${index}-facts`} className="sr-only" />
                <span className="wrap-anywhere font-semibold text-text">Switch to {each.name}</span>
                <span id={`${id}-switch-${index}-facts`} className="text-muted">{conditionText(each.condition)}{reason ? ` · ${reason}` : ""}</span>
              </label>
            );
          })}
        </div>
      )}
      {move && move.rule.kind === "choose" && move.rule.options.length > 1 && (
        <fieldset data-training-target={slot} className="min-w-0">
          <legend className="text-xs font-semibold text-muted">Target<span className="sr-only"> for {options.name}</span></legend>
          <div className={`${styles.targets} mt-1`}>
            {move.rule.options.map((option) => {
              const checked = selection.target === option;
              return (
                <label key={option} htmlFor={`${id}-target-${option}`} data-training-target-option={option}
                  className={`flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-lg border px-2 py-1 text-xs has-focus-visible:ring-2 has-focus-visible:ring-focus ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
                  <input id={`${id}-target-${option}`} type="radio" name={`${id}-target`} value={option} checked={checked}
                    onChange={() => onChange({ ...selection, target: option })} className="sr-only" />
                  <span className={`wrap-anywhere font-semibold ${checked ? "text-accent-text" : "text-text"}`}>{targetName(names, slot, option)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </fieldset>
  );
}
