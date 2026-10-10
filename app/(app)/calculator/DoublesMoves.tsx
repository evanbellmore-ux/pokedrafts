"use client";

import { useId, type ReactNode } from "react";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { FAINTED, intoOptions } from "./doubles-format";
import styles from "./calculator.module.css";

export type DoublesMovesProps = {
  /** The four Pokémon's full names (doublesNames), which name the radios. */
  names: Record<DoublesSlotId, string>; focus: DoublesSlotId; into: DoublesSlotId;
  /** Slots whose Pokémon has fainted: shown, not chosen. */
  fainted?: Partial<Record<DoublesSlotId, boolean>>;
  onFocusChange: (slot: DoublesSlotId) => void; onIntoChange: (into: DoublesSlotId) => void; children: ReactNode;
};

const radioClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Choice({ id, name, value, checked, disabled = false, onChange, children }: { id: string; name: string; value: DoublesSlotId; checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-xs ${disabled ? "border-line opacity-60" : `cursor-pointer ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}`}>
      <input id={id} type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className={radioClassName} />
      <span className="min-w-0 wrap-anywhere">{children}{disabled && <span className="text-muted"> · {FAINTED}</span>}</span>
    </label>
  );
}

/** The 2v2 Moves pane (data-doubles-moves): whose moves the list shows and which Pokémon its damage is into, then the list. */
export default function DoublesMoves({ names, focus, into, fainted = {}, onFocusChange, onIntoChange, children }: DoublesMovesProps) {
  const id = useId();
  return (
    <div data-doubles-moves className="min-w-0 space-y-4">
      <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold text-text">Moves for</legend>
          <div className={`${styles.targets} mt-1`}>
            {DOUBLES_SLOTS.map((slot) => (
              <Choice key={slot} id={`${id}-for-${slot}`} name={`${id}-for`} value={slot} checked={focus === slot} disabled={!!fainted[slot]} onChange={() => onFocusChange(slot)}>
                <span className="font-semibold text-text">{names[slot]}</span>
              </Choice>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold text-text">Damage into</legend>
          <div className={`${styles.targets} mt-1`}>
            {intoOptions(focus).map((slot) => (
              <Choice key={slot} id={`${id}-into-${slot}`} name={`${id}-into`} value={slot} checked={into === slot} disabled={!!fainted[slot]} onChange={() => onIntoChange(slot)}>
                <span className="font-semibold text-text">{names[slot]}</span>
              </Choice>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted">Damage at the start of the turn, before any move.</p>
      </div>
      {children}
    </div>
  );
}
