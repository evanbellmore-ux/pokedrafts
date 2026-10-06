"use client";

import { useId, useState } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { SHEET_FIELD_LABEL, SHEET_FIELDS, type InfoView, type SheetField } from "../model/info";
import { PROTECT_ADDED_FACT, SUGGESTION_LABEL } from "../model/usage";
import type { MemberEdit, MoveOptionsState, TrainingMember } from "../model/view-types";
import { totalPoints } from "./set-editor";
import SetEditor from "./SetEditor";
import type { Candidate } from "./team-draft";

// One "Choose 6" row: the checkbox, the set as facts, Showdown's problems for it, and the set editor. The opponent's rows show
// only what "You see" opens (SPEC Q3): a closed category reads "{Category}: not shown".

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

export default function TeamMemberRow({ candidate, member, chosen, full, runtime, visibility, problems, pending, edited, moveOptions, takenItems, onToggle, onLoadMoves, onEdit, onReset }: TeamMemberRowProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const reason = candidate.reason ?? (!chosen ? full : null);
  const disabled = !candidate.eligible || (!chosen && !!full);
  const allOpen = !visibility || SHEET_FIELDS.every((field) => visibility.open[field]);
  const editable = !!member && chosen && allOpen;
  const species = candidate.speciesId ? runtime.speciesById.get(candidate.speciesId) : null;
  return (
    <li data-training-member={candidate.key} className={`min-w-0 rounded-lg border px-3 py-2 ${chosen ? "border-accent-border bg-panel" : "border-line bg-bg"}`}>
      <div className="flex min-w-0 items-start gap-2">
        <label htmlFor={`${id}-choose`} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded has-focus-visible:ring-2 has-focus-visible:ring-focus">
          <input id={`${id}-choose`} type="checkbox" checked={chosen} disabled={disabled} onChange={onToggle}
            aria-describedby={reason ? `${id}-reason` : undefined} className="h-4 w-4 shrink-0 accent-accent disabled:opacity-50" />
          {species && <span aria-hidden="true" className="shrink-0"><PokemonSprite name={candidate.spriteName ?? species.name} size="md" /></span>}
          <span className="min-w-0 wrap-anywhere font-semibold text-text">{candidate.name}</span>
        </label>
      </div>
      {reason && <p id={`${id}-reason`} className="wrap-anywhere text-xs text-muted">{reason}</p>}
      {chosen && pending === "loading" && !member && <p role="status" className="text-xs text-muted">Suggesting set…</p>}
      {chosen && member && (
        <div className="mt-1 space-y-0.5 text-xs">
          <p data-training-set-origin className="wrap-anywhere text-muted">{originLabel(member)}{member.suggestion?.protectAdded ? ` · ${PROTECT_ADDED_FACT}` : ""}</p>
          <p data-training-set-facts className="wrap-anywhere text-text">{setFacts(member, runtime, visibility)}</p>
          <p data-training-set-moves className="wrap-anywhere text-muted">{movesFact(member, runtime, visibility)}</p>
        </div>
      )}
      {chosen && !!problems.length && (allOpen
        ? <ul data-training-problems className="mt-1 space-y-0.5 text-xs text-danger">{problems.map((problem, index) => <li key={index} className="wrap-anywhere">{problem}</li>)}</ul>
        : <p data-training-problems className="mt-1 text-xs text-danger">{hiddenProblems(problems.length)}</p>)}
      {editable && (
        <div className="mt-1">
          <button type="button" aria-expanded={editing} aria-controls={`${id}-editor`} onClick={() => { if (!editing && member) onLoadMoves(member.speciesId); setEditing(!editing); }}
            className="min-h-11 rounded px-1 text-sm font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {editing ? "Close editor" : "Edit set"}<span className="sr-only"> · {candidate.name}</span>
          </button>
          <div id={`${id}-editor`} hidden={!editing}>
            {editing && member && (
              <SetEditor member={member} runtime={runtime} moveOptions={moveOptions} takenItems={takenItems} canReset={edited}
                onChange={onEdit} onReset={onReset} />
            )}
          </div>
        </div>
      )}
    </li>
  );
}
