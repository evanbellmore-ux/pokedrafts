"use client";

import { useId } from "react";
import type { TrainingDifficulty } from "../model/view-types";

const OPTIONS: { value: TrainingDifficulty; label: string; fact: string }[] = [
  { value: "safe", label: "Plays safe", fact: "Assumes your best reply" },
  { value: "reads", label: "Reads you", fact: "Weights your past choices" },
];

export default function DifficultyField({ value, onChange }: { value: TrainingDifficulty; onChange(value: TrainingDifficulty): void }) {
  const id = useId();
  return (
    <fieldset data-training-difficulty className="min-w-0">
      <legend className="text-sm font-semibold text-text">AI</legend>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <label key={option.value} htmlFor={`${id}-${option.value}`}
            className={`flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-focus ${value === option.value ? "border-accent-border bg-accent-soft" : "border-line bg-panel hover:bg-panel-hover"}`}>
            <input id={`${id}-${option.value}`} type="radio" name={`${id}-difficulty`} value={option.value} checked={value === option.value}
              onChange={() => onChange(option.value)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
            <span className="min-w-0">
              <span className="block font-semibold text-text">{option.label}</span>
              <span className="block wrap-anywhere text-xs text-muted">{option.fact}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
