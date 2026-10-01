"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  /** Names its data attributes: data-{kind}-section, data-{kind}-toggle and data-{kind}-region. */
  kind: "build" | "field";
  /** Their value, such as the side. */
  value?: string;
  /** The id of the collapsible region, which the disclosure button controls. */
  regionId: string;
  open: boolean;
  onToggle: () => void;
  /** The button's text, after its chevron. */
  label: ReactNode;
  /** Shown in the button, so problems are visible while collapsed. */
  issueCount: number;
  className?: string;
  children: ReactNode;
};

/** A collapsible settings section (Build settings, Field conditions): a disclosure button and its region. */
export default function SettingsDisclosure({ kind, value = "true", regionId, open, onToggle, label, issueCount, className, children }: Props) {
  const toggleId = useId();
  return (
    <div {...{ [`data-${kind}-section`]: value }} className={className}>
      <button
        id={toggleId}
        type="button"
        {...{ [`data-${kind}-toggle`]: value }}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-2 px-3 py-1 text-left text-xs font-semibold text-text hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:px-4"
      >
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
        {label}
        {issueCount > 0 && <span className="text-danger"><span className="sr-only">, </span>{issueCount} {issueCount === 1 ? "setting" : "settings"} to check</span>}
      </button>
      {/* Kept mounted while collapsed, so unfinished editor text survives closing it. */}
      <div id={regionId} role="region" aria-labelledby={toggleId} {...{ [`data-${kind}-region`]: value }} hidden={!open} className="border-t border-line px-3 pb-3 pt-2 sm:px-4">
        {children}
      </div>
    </div>
  );
}
