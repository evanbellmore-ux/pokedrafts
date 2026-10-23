"use client";

import type { SetupMode } from "../model/situation";

const MODES: { value: SetupMode; label: string }[] = [{ value: "battle", label: "Full battle" }, { value: "situations", label: "Situations" }];

/**
 * Full battle (your teams, team preview) or Situations (dealt teams, a battle already in progress), above Setup. A
 * pressed-button group, as the calculator's 1v1 | 2v2 switch.
 */
export default function SetupModeSwitch({ mode, onChange }: { mode: SetupMode; onChange(mode: SetupMode): void }) {
  return (
    <div role="group" aria-label="Battle start" data-training-mode-switch className="inline-grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg/40 p-1 max-sm:grid max-sm:w-full">
      {MODES.map((entry) => {
        const pressed = entry.value === mode;
        return (
          <button key={entry.value} type="button" data-training-mode={entry.value} aria-pressed={pressed} onClick={() => onChange(entry.value)}
            className={`min-h-11 rounded-md px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${pressed ? "bg-panel-hover text-text shadow-sm" : "text-muted hover:text-text"}`}>
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
