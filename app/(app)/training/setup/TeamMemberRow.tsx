"use client";

import { useId, useState } from "react";
import BattleSprite from "@/app/components/BattleSprite";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { SHEET_FIELD_LABEL, SHEET_FIELDS, type InfoView, type SheetField } from "../model/info";
import { PROTECT_ADDED_FACT, SUGGESTION_LABEL } from "../model/usage";
import type { MemberEdit, MoveOptionsState, TeamProblems, TrainingMember } from "../model/view-types";
import { totalPoints } from "./set-editor";
import SetEditor from "./SetEditor";
import type { Candidate } from "./team-draft";

// One "Choose 6" row: a header line (the checkbox with the name, Edit set at its end), the set as facts, Showdown's problems
// for it, and the set editor. The opponent's rows show only what "You see" opens (SPEC Q3): a closed category reads
// "{Category}: not shown".

/** Showdown's problems for one team (a count only: the opponent's text can name what "You see" closes). */
export function problemCount(problems: TeamProblems) {
  return problems.team.length + Object.values(problems.members).reduce((sum, list) => sum + list.length, 0);
}

/** "Showdown rules: 2 problems." */
export function problemsFact(count: number) {
  return `Showdown rules: ${count} problem${count === 1 ? "" : "s"}.`;
}

/** Showdown's problem text names moves, items and abilities: with a "You see" category closed, only the count is shown. */
export function hiddenProblems(count: number) {
  return `Showdown rules: ${count} problem${count === 1 ? "" : "s"} (not shown)`;
}

export function originLabel(member: TrainingMember) {
  if (member.origin === "edited") return "Edited set";
  if (member.origin === "imported") return "Imported set";
  return member.suggestion ? SUGGESTION_LABEL[member.suggestion.source] : "Suggested set";
}

function closed(visibility: InfoView | null, field: SheetField) {
  return !!visibility && !visibility.open[field];
}

/** "Rough Skin · No item · Hardy · 0 SP", with "{Category}: not shown" for closed ones. */
export function setFacts(member: TrainingMember, runtime: BattleRuntime, visibility: InfoView | null) {
  const { build } = member;
  const hidden = (field: SheetField) => `${SHEET_FIELD_LABEL[field]}: not shown`;
  return [
    closed(visibility, "abilities") ? hidden("abilities") : runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId,
    closed(visibility, "items") ? hidden("items") : build.itemId ? runtime.itemsById.get(build.itemId)?.name ?? build.itemId : "No item",
    closed(visibility, "natures") ? hidden("natures") : build.nature,
    closed(visibility, "statPoints") ? hidden("statPoints") : `${totalPoints(build)} SP`,
  ].join(" · ");
}

export function movesFact(member: TrainingMember, runtime: BattleRuntime, visibility: InfoView | null) {
  if (closed(visibility, "moves")) return `${SHEET_FIELD_LABEL.moves}: not shown`;
  const names = member.moves.flatMap((slot) => slot.moveId ? [runtime.movesById.get(slot.moveId)?.name ?? slot.moveId] : []);
  return names.length ? names.join(" · ") : "No moves";
}

export type TeamMemberRowProps = {
  candidate: Candidate;
  /** The name in its controls' labels: the species name, with its team when both teams have it ("Garchomp (yours)"). */
  label: string;
  member: TrainingMember | null;
  chosen: boolean;
  /** Why an unchosen box is disabled ("6 chosen"), or null. */
  full: string | null;
  runtime: BattleRuntime;
  /** null: your own row, everything shown. */
  visibility: InfoView | null;
  /** Showdown's validator problems for this member, verbatim. */
  problems: readonly string[];
  /** League member whose suggested set is loading or unavailable. */
  pending: "loading" | "error" | null;
  edited: boolean;
  moveOptions: MoveOptionsState | undefined;
  takenItems: ReadonlyMap<string, string>;
  onToggle(): void;
  onLoadMoves(speciesId: string): void;
  onEdit(edit: MemberEdit): void;
  onReset(): void;
};

export default function TeamMemberRow({ candidate, label, member, chosen, full, runtime, visibility, problems, pending, edited, moveOptions, takenItems, onToggle, onLoadMoves, onEdit, onReset }: TeamMemberRowProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  // A full team's other members show their header only: "6 chosen" (the legend's count) stays for the screen reader as the
  // disabled box's description. A member that cannot be chosen keeps its own reason in view.
  const bench = !candidate.reason && !chosen && !!full;
  const reason = candidate.reason ?? (bench ? full : null);
  const disabled = !candidate.eligible || (!chosen && !!full);
  const allOpen = !visibility || SHEET_FIELDS.every((field) => visibility.open[field]);
  const editable = !!member && chosen && allOpen;
  const species = candidate.speciesId ? runtime.speciesById.get(candidate.speciesId) : null;
  const shownSet = chosen && !!member;
  const shownProblems = chosen && !!problems.length;
  // "Protect added" names one of the set's moves: shown only while "You see" opens Moves.
  const protectAdded = !!member?.suggestion?.protectAdded && !closed(visibility, "moves");
  // Tabbing to the box reads the set: its origin, facts, moves and problems.
  const describedBy = [
    reason && `${id}-reason`, shownSet && `${id}-origin ${id}-facts ${id}-moves`, shownProblems && `${id}-problems`,
  ].filter(Boolean).join(" ") || undefined;
  return (
    <li data-training-member={candidate.key} className={`min-w-0 rounded-lg border px-3 py-1.5 ${chosen ? "border-accent-border bg-panel" : "border-line bg-bg"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={`${id}-choose`} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded has-focus-visible:ring-2 has-focus-visible:ring-focus ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
          <input id={`${id}-choose`} type="checkbox" checked={chosen} disabled={disabled} onChange={onToggle}
            aria-describedby={describedBy} className="h-4 w-4 shrink-0 accent-accent disabled:opacity-50" />
          {species && <BattleSprite speciesId={species.id} name={species.name} />}
          <span className={`min-w-0 wrap-anywhere font-semibold ${disabled ? "text-muted" : "text-text"}`}>{candidate.name}</span>
        </label>
        {editable && (
          <button type="button" aria-expanded={editing} aria-controls={`${id}-editor`} onClick={() => { if (!editing && member) onLoadMoves(member.speciesId); setEditing(!editing); }}
            className="min-h-11 shrink-0 rounded px-1 text-sm font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {editing ? "Close editor" : "Edit set"}<span className="sr-only"> · {label}</span>
          </button>
        )}
      </div>
      {reason && <p id={`${id}-reason`} className={bench ? "sr-only" : "wrap-anywhere text-xs text-muted"}>{reason}</p>}
      {/* Not a live region of its own: the setup's status beside Start says it once per side ("Your team: Suggesting sets…"). */}
      {chosen && pending === "loading" && !member && <p className="text-xs text-muted">Suggesting set…</p>}
      {chosen && member && (
        <div className="space-y-0.5 text-xs">
          <p className="wrap-anywhere">
            <span id={`${id}-origin`} data-training-set-origin className="text-muted">{originLabel(member)}{protectAdded ? ` · ${PROTECT_ADDED_FACT}` : ""}</span>
            <span className="text-muted"> · </span>
            <span id={`${id}-facts`} data-training-set-facts className="text-text">{setFacts(member, runtime, visibility)}</span>
          </p>
          <p id={`${id}-moves`} data-training-set-moves className="wrap-anywhere text-muted">{movesFact(member, runtime, visibility)}</p>
        </div>
      )}
      {shownProblems && (allOpen
        ? <ul id={`${id}-problems`} data-training-problems className="mt-1 space-y-0.5 text-xs text-danger">{problems.map((problem, index) => <li key={index} className="wrap-anywhere">{problem}</li>)}</ul>
        : <p id={`${id}-problems`} data-training-problems className="mt-1 text-xs text-danger">{hiddenProblems(problems.length)}</p>)}
      {editable && (
        <div id={`${id}-editor`} hidden={!editing}>
          {editing && member && (
            <SetEditor member={member} label={label} runtime={runtime} moveOptions={moveOptions} takenItems={takenItems} canReset={edited}
              onChange={onEdit} onReset={onReset} />
          )}
        </div>
      )}
    </li>
  );
}
