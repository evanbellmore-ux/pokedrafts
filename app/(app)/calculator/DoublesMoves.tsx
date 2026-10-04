"use client";

import { useId, type ReactNode } from "react";
import { DOUBLES_SLOTS, SLOT_POSITION, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { baseName, intoOptions, relativeLabel } from "./doubles-format";
import styles from "./calculator.module.css";

export type DoublesMovesProps = {
  names: Record<DoublesSlotId, string>; focus: DoublesSlotId; into: DoublesSlotId;
  onFocusChange: (slot: DoublesSlotId) => void; onIntoChange: (into: DoublesSlotId) => void; children: ReactNode;
};

const radioClassName = "h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Choice({ id, name, value, checked, onChange, children }: { id: string; name: string; value: DoublesSlotId; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-xs ${checked ? "border-accent-border bg-accent-soft" : "border-line hover:bg-panel-hover"}`}>
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={onChange} className={radioClassName} />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </label>
  );
}

/** The 2v2 Moves pane (data-doubles-moves): whose moves the list shows and which Pokémon its damage is into, then the list. */
export default function DoublesMoves({ names, focus, into, onFocusChange, onIntoChange, children }: DoublesMovesProps) {
  const id = useId();
  return (
    <div data-doubles-moves className="min-w-0 space-y-4">
      <div className="space-y-2 rounded-xl border border-line bg-panel p-3">
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold text-text">Moves for</legend>
          <div className={`${styles.targets} mt-1`}>
            {DOUBLES_SLOTS.map((slot) => (
              <Choice key={slot} id={`${id}-for-${slot}`} name={`${id}-for`} value={slot} checked={focus === slot} onChange={() => onFocusChange(slot)}>
                <span className="font-semibold text-text">{baseName(names, slot)}</span><span className="text-muted"> · {SLOT_POSITION[slot]}</span>
              </Choice>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold text-text">Damage into</legend>
          <div className={`${styles.targets} mt-1`}>
            {intoOptions(focus).map((slot) => (
              <Choice key={slot} id={`${id}-into-${slot}`} name={`${id}-into`} value={slot} checked={into === slot} onChange={() => onIntoChange(slot)}>
                <span className="font-semibold text-text">{relativeLabel(focus, slot)}</span><span className="text-muted"> · {baseName(names, slot)}</span>
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
