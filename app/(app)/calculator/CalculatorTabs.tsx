"use client";

import { useEffect, useRef } from "react";
import styles from "./calculator.module.css";

export const CALCULATOR_TABS = [
  { id: "team", label: "My team" },
  { id: "moves", label: "Moves" },
  { id: "builds", label: "Build settings" },
  { id: "field", label: "Field conditions" },
  { id: "opponent", label: "Opponent" },
] as const;

export type CalculatorTab = typeof CALCULATOR_TABS[number]["id"];

export function calculatorTabIds(prefix: string, tab: CalculatorTab) {
  return { tabId: `${prefix}-tab-${tab}`, panelId: `${prefix}-pane-${tab}` };
}

export function calculatorTabForKey(tab: CalculatorTab, key: string): CalculatorTab | null {
  const index = CALCULATOR_TABS.findIndex((entry) => entry.id === tab);
  if (key === "Home") return CALCULATOR_TABS[0].id;
  if (key === "End") return CALCULATOR_TABS.at(-1)!.id;
  if (key === "ArrowLeft") return CALCULATOR_TABS[(index + CALCULATOR_TABS.length - 1) % CALCULATOR_TABS.length].id;
  if (key === "ArrowRight") return CALCULATOR_TABS[(index + 1) % CALCULATOR_TABS.length].id;
  return null;
}

function revealTab(element: HTMLButtonElement) {
  const strip = element.parentElement!;
  const bounds = strip.getBoundingClientRect();
  const button = element.getBoundingClientRect();
  if (button.left < bounds.left + 4) strip.scrollBy({ left: button.left - bounds.left - 4 });
  else if (button.right > bounds.right - 4) strip.scrollBy({ left: button.right - bounds.right + 4 });
}

export default function CalculatorTabs({ prefix, activeTab, onSelect, issues = {} }: {
  prefix: string;
  activeTab: CalculatorTab;
  onSelect: (tab: CalculatorTab) => void;
  issues?: Partial<Record<CalculatorTab, number>>;
}) {
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = activeButton.current;
    if (!button) return;
    revealTab(button);
    const observer = new ResizeObserver(() => revealTab(button));
    observer.observe(button.parentElement!);
    observer.observe(button);
    return () => observer.disconnect();
  }, [activeTab]);

  return (
    <div role="tablist" aria-label="Calculator menus" className={styles.tabs}>
      {CALCULATOR_TABS.map(({ id, label }) => {
        const ids = calculatorTabIds(prefix, id);
        const selected = id === activeTab;
        const count = issues[id] ?? 0;
        return (
          <button
            key={id}
            ref={selected ? activeButton : undefined}
            id={ids.tabId}
            type="button"
            role="tab"
            data-calculator-tab={id}
            aria-controls={ids.panelId}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onFocus={(event) => {
              onSelect(id);
              revealTab(event.currentTarget);
            }}
            onKeyDown={(event) => {
              const next = calculatorTabForKey(id, event.key);
              if (!next) return;
              event.preventDefault();
              onSelect(next);
              document.getElementById(calculatorTabIds(prefix, next).tabId)?.focus({ preventScroll: true });
            }}
            className={`${styles.tab} min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-panel text-text hover:bg-panel-hover"}`}
          >
            {label}
            {count > 0 && <span className="ml-2 text-danger">{count}<span className="sr-only"> settings to check</span></span>}
          </button>
        );
      })}
    </div>
  );
}
