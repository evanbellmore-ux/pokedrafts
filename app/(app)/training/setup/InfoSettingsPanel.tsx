"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Alert } from "@/app/components/ui";
import {
  infoFact, INFO_PRESETS, presetOf, SHEET_FIELD_LABEL, SHEET_FIELDS, usesTestSettings,
  type InfoPreset, type InfoSettings, type InfoView, type SheetField,
} from "../model/info";

// Information settings (SPEC 12.2): what the AI may know of your team and what you see of its team, each category open or
// closed, plus the two test-only extras. Presets per direction with the direction's fact line ("AI knows" / "You see" are
// stated here only); "Custom" when the toggles match none. The category table is behind "Information categories".

type Direction = keyof InfoSettings;
type Toggle = SheetField | "exactHP" | "brought";

const DIRECTIONS: { id: Direction; group: string; column: string }[] = [
  { id: "aiKnows", group: "AI knows your team", column: "AI knows" },
  { id: "youSee", group: "You see the AI's team", column: "You see" },
];
const PRESET_ORDER: InfoPreset[] = ["open", "closed", "perfect"];
const ROWS: { id: Toggle; label: string }[] = [
  ...SHEET_FIELDS.map((field) => ({ id: field as Toggle, label: SHEET_FIELD_LABEL[field] })),
  { id: "exactHP", label: "Test: exact HP" },
  { id: "brought", label: "Test: brought Pokémon" },
];

function checked(view: InfoView, toggle: Toggle) {
  return toggle === "exactHP" ? view.exactHP : toggle === "brought" ? view.brought : view.open[toggle];
}

function toggled(view: InfoView, toggle: Toggle, value: boolean): InfoView {
  if (toggle === "exactHP") return { ...view, exactHP: value };
  if (toggle === "brought") return { ...view, brought: value };
  return { ...view, open: { ...view.open, [toggle]: value } };
}

const presetButton = "min-h-11 rounded-lg border px-3 py-1.5 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** A direction is Custom (no preset matches) or a test extra is on: the category table shows by itself. */
function needsTable(info: InfoSettings) {
  return DIRECTIONS.some((direction) => !presetOf(info[direction.id]) || usesTestSettings(info[direction.id]));
}

export default function InfoSettingsPanel({ info, onChange }: { info: InfoSettings; onChange(info: InfoSettings): void }) {
  const id = useId();
  // The table starts open for a Custom or test state and opens when one arrives (stored settings load after the first
  // render); it never closes by itself, and otherwise follows its toggle (adjust during render).
  const needed = needsTable(info);
  const [table, setTable] = useState({ open: needed, needed });
  if (needed !== table.needed) setTable({ open: table.open || needed, needed });
  // Each change builds on the last one sent, so two changes before the next render (one frame) both count.
  const latest = useRef(info);
  useEffect(() => { latest.current = info; }, [info]);
  const change = (direction: Direction, view: (current: InfoView) => InfoView) => {
    const next = { ...latest.current, [direction]: view(latest.current[direction]) };
    latest.current = next;
    onChange(next);
  };
  const testOn = usesTestSettings(info.aiKnows) || usesTestSettings(info.youSee);
  return (
    <fieldset data-training-info className="min-w-0 space-y-3">
      <legend className="text-sm font-semibold text-text">Information</legend>
      {DIRECTIONS.map((direction) => {
        const preset = presetOf(info[direction.id]);
        return (
          <div key={direction.id} className="min-w-0 space-y-1.5">
            <p id={`${id}-${direction.id}`} className="text-sm text-muted">{direction.group}</p>
            <div role="group" aria-labelledby={`${id}-${direction.id}`} aria-describedby={`${id}-${direction.id}-fact`} className="flex flex-wrap items-center gap-1.5">
              {PRESET_ORDER.map((each) => (
                <button
                  key={each}
                  type="button"
                  data-training-info-preset={`${direction.id}:${each}`}
                  aria-pressed={preset === each}
                  onClick={() => change(direction.id, () => INFO_PRESETS[each].view)}
                  className={`${presetButton} ${preset === each ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-panel text-text hover:bg-panel-hover"}`}
                >{INFO_PRESETS[each].label}</button>
              ))}
              {!preset && <span className="text-sm font-semibold text-text">Custom</span>}
            </div>
            <p id={`${id}-${direction.id}-fact`} data-training-info-fact={direction.id} className="wrap-anywhere text-xs text-text">{infoFact(info[direction.id])}</p>
          </div>
        );
      })}
      <button
        type="button"
        data-training-info-categories
        aria-expanded={table.open}
        aria-controls={`${id}-categories`}
        onClick={() => setTable({ ...table, open: !table.open })}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-sm font-semibold text-text hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted motion-safe:transition-transform ${table.open ? "rotate-180" : ""}`} />
        Information categories
      </button>
      <div id={`${id}-categories`} hidden={!table.open} className="min-w-0">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Information categories</caption>
          <colgroup><col /><col className="w-18" /><col className="w-18" /></colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-1.5 text-left font-medium text-muted"><span className="sr-only">Category</span></th>
              {DIRECTIONS.map((direction) => <th key={direction.id} scope="col" className="py-1.5 text-center text-xs font-semibold text-muted">{direction.column}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-1 pr-2 text-left font-normal wrap-anywhere text-text">{row.label}</th>
                {DIRECTIONS.map((direction) => (
                  <td key={direction.id} className="py-1 text-center">
                    <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg has-focus-visible:ring-2 has-focus-visible:ring-focus">
                      <input
                        type="checkbox"
                        data-training-info-toggle={`${direction.id}:${row.id}`}
                        aria-label={`${row.label}: ${direction.column}`}
                        checked={checked(info[direction.id], row.id)}
                        onChange={(event) => { const value = event.target.checked; change(direction.id, (current) => toggled(current, row.id, value)); }}
                        className="h-4 w-4 accent-accent"
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {testOn && <Alert variant="warning">Test settings on.</Alert>}
    </fieldset>
  );
}
