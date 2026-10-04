"use client";

import styles from "./calculator.module.css";

export const CALCULATOR_MODES = ["1v1", "2v2"] as const;
export type CalculatorMode = typeof CALCULATOR_MODES[number];

/**
 * 1v1 or 2v2, under the page header. A pressed-button group rather than tabs: the menus below are the page's only
 * tablist, and their panels its only tabpanels.
 */
export default function CalculatorModeSwitch({ mode, onChange }: { mode: CalculatorMode; onChange: (mode: CalculatorMode) => void }) {
  return (
    <div role="group" aria-label="Matchup" data-calculator-mode-switch className={styles.modes}>
      {CALCULATOR_MODES.map((entry) => {
        const pressed = entry === mode;
        return (
          <button
            key={entry}
            type="button"
            data-calculator-mode={entry}
            aria-pressed={pressed}
            onClick={() => onChange(entry)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${pressed ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-panel text-text hover:bg-panel-hover"}`}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}
