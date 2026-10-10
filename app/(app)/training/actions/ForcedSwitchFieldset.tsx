"use client";

import { useId } from "react";
import { replaceLegend } from "../log/announcement";
import type { ReplaceSlot } from "./choice-builder";
import { conditionText } from "./condition";
import styles from "./actions.module.css";

export type ForcedSwitchFieldsetProps = {
  replace: ReplaceSlot;
  midTurn: boolean;
  pick: string | null;
  /** The member the other flagged slot sends out, and the name of the Pokémon that slot replaces. */
  otherPick: { key: string; name: string } | null;
  /** More flagged slots than living bench members: this one passes (pinned sim/side.ts:936). */
  exhausted: boolean;
  onPick(key: string): void;
};

/** "Replace Abomasnow" at the end of a turn, "Switch in for Incineroar" mid-turn. */
export default function ForcedSwitchFieldset({ replace, midTurn, pick, otherPick, exhausted, onPick }: ForcedSwitchFieldsetProps) {
  const id = useId();
  return (
    <fieldset data-training-replace={replace.slot} className="min-w-0 space-y-2 p-2 sm:p-3">
      <legend data-training-replace-legend className="wrap-anywhere text-xs font-semibold uppercase tracking-wide text-muted">{replaceLegend(replace.name, midTurn)}</legend>
      {exhausted ? <p className="text-sm text-muted">No Pokémon left</p> : (
        <div className={styles.switches}>
          {replace.options.map((option, index) => {
            const checked = pick === option.key;
            const taken = otherPick?.key === option.key ? `Chosen for ${otherPick.name}` : null;
            return (
              <label key={option.key} htmlFor={`${id}-option-${index}`} data-training-switch={option.key}
                className={`flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-lg border px-2 py-1.5 text-left text-xs has-focus-visible:ring-2 has-focus-visible:ring-focus has-disabled:cursor-not-allowed has-disabled:opacity-60 ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
                <input id={`${id}-option-${index}`} type="radio" name={`${id}-replace`} value={option.key} checked={checked} disabled={!!taken}
                  onChange={() => onPick(option.key)} aria-describedby={`${id}-option-${index}-facts`} className="sr-only" />
                <span className="wrap-anywhere font-semibold text-text">{option.name}</span>
                <span id={`${id}-option-${index}-facts`} className="text-muted">{conditionText(option.condition)}{taken ? ` · ${taken}` : ""}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
