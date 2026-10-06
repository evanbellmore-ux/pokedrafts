"use client";

import { useId, useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@/app/components/ui";
import { getBuildStats, NATURES, parseIntegerInput, STATS } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleStat } from "@/app/lib/battle/types";
import type { MemberEdit, MoveOptionsState, TrainingMember } from "../model/view-types";
import {
  editOf, editorMoveList, filterMoves, MAX_STAT_POINTS, moveOptionText, natureLabel, pointsIssues, TOTAL_STAT_POINTS,
  withAbility, withItem, withMove, withNature, withPoints, type EditorMove,
} from "./set-editor";

// The set editor (addendum A1.3): four move pickers over every move the species can legally use in Reg M-C (usage order
// first, then A–Z), item, ability, nature and Champions Stat Points. Showdown's validator reports what is still illegal.

const STAT_SHORT: Record<BattleStat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/** Keeps unfinished text while its value is not a whole number (as the calculator's IntegerInput). */
function PointsInput({ id, label, value, onValue }: { id: string; label: string; value: number | null; onValue(value: number | null): void }) {
  const format = (number: number | null) => number === null ? "" : String(number);
  const [text, setText] = useState(() => format(value));
  const [synced, setSynced] = useState(value);
  if (!Object.is(value, synced)) {
    setSynced(value);
    setText(format(value));
  }
  return (
    <Input id={id} aria-label={label} type="text" inputMode="numeric" autoComplete="off" value={text} className="px-2 py-2 tabular-nums"
      onChange={(event) => {
        const next = event.target.value;
        const parsed = next.trim() === "" ? null : parseIntegerInput(next.trim());
        setText(next);
        setSynced(parsed);
        onValue(parsed);
      }} />
  );
}

function MoveGroup({ label, moves, taken, keep }: { label: string; moves: readonly EditorMove[]; taken: ReadonlySet<string>; keep: string | null }) {
  if (!moves.length) return null;
  return (
    <optgroup label={label}>
      {moves.map((move) => <option key={move.id} value={move.id} disabled={move.id !== keep && taken.has(move.id)}>{moveOptionText(move)}</option>)}
    </optgroup>
  );
}

export type SetEditorProps = {
  member: TrainingMember;
  runtime: BattleRuntime;
  moveOptions: MoveOptionsState | undefined;
  /** Items on the team's other chosen members (Item Clause = 1): item id → member name. */
  takenItems: ReadonlyMap<string, string>;
  /** The member has an edit to drop (back to its suggested or imported set). */
  canReset: boolean;
  onChange(edit: MemberEdit): void;
  onReset(): void;
};

export default function SetEditor({ member, runtime, moveOptions, takenItems, canReset, onChange, onReset }: SetEditorProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const edit = editOf(member);
  const { build } = edit;
  const species = runtime.speciesById.get(build.speciesId);
  const list = useMemo(() => editorMoveList(moveOptions, member.speciesId, runtime), [moveOptions, member.speciesId, runtime]);
  const items = useMemo(() => [...runtime.catalog.items].sort((a, b) => a.name.localeCompare(b.name, "en")), [runtime]);
  const chosenMoves = edit.moves.map((slot) => slot.moveId);
  const taken = new Set(chosenMoves.filter((moveId): moveId is string => !!moveId));
  const required = species?.requiredItem ?? null;
  const requiredItems = species?.requiredItems?.length ? species.requiredItems : required ? [required] : [];
  const points = build.game === "champions" ? build.points : null;
  const total = points ? STATS.reduce((sum, stat) => sum + (points[stat] ?? 0), 0) : 0;
  const issues = points ? pointsIssues(points) : [];
  const stats = getBuildStats(build, runtime);
  const known = new Set([...list.usage, ...list.other].map((move) => move.id));

  return (
    <div data-training-set-editor={member.key} className="mt-2 space-y-3 border-t border-line pt-3">
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Moves</legend>
        <Field id={`${id}-search`} label="Search moves">
          <Input type="search" autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} className="py-2" />
        </Field>
        {list.status === "loading" && <p role="status" className="text-xs text-muted">Loading legal moves…</p>}
        {list.status === "fallback" && <p className="wrap-anywhere text-xs text-muted">Legal moves unavailable: {list.message} · Showing the catalog learnset.</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {edit.moves.map((slot, index) => {
            const keep = slot.moveId;
            const usage = filterMoves(list.usage, query, keep);
            const other = filterMoves(list.other, query, keep);
            const missing = keep && !known.has(keep);
            return (
              <Field key={index} id={`${id}-move-${index}`} label={`Move ${index + 1}`}>
                <Select data-training-move-slot={index} value={keep ?? ""} className="py-2" onChange={(event) => onChange(withMove(edit, index, event.target.value || null))}>
                  <option value="">No move</option>
                  {missing && <option value={keep}>{runtime.movesById.get(keep)?.name ?? keep}</option>}
                  <MoveGroup label="Usage" moves={usage} taken={taken} keep={keep} />
                  <MoveGroup label={list.usage.length ? "Other legal moves" : "Legal moves"} moves={other} taken={taken} keep={keep} />
                </Select>
              </Field>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {requiredItems.length === 1 ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">Item</span>
            <span className="wrap-anywhere text-text">{runtime.itemsById.get(requiredItems[0])?.name ?? requiredItems[0]} · Required</span>
          </div>
        ) : (
          <Field id={`${id}-item`} label="Item">
            <Select data-training-item value={build.itemId} className="py-2" onChange={(event) => onChange(withItem(edit, event.target.value))}>
              {!requiredItems.length && <option value="">No item</option>}
              {(requiredItems.length ? items.filter((item) => requiredItems.includes(item.id)) : items).map((item) => {
                const holder = takenItems.get(item.id);
                return <option key={item.id} value={item.id}>{item.name}{holder ? ` · on ${holder}` : ""}</option>;
              })}
            </Select>
          </Field>
        )}
        <Field id={`${id}-ability`} label="Ability">
          <Select data-training-ability value={build.abilityId} className="py-2" onChange={(event) => onChange(withAbility(edit, event.target.value))}>
            {!species?.abilities.includes(build.abilityId) && <option value={build.abilityId}>{runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId}</option>}
            {(species?.abilities ?? []).map((ability) => <option key={ability} value={ability}>{runtime.abilitiesById.get(ability)?.name ?? ability}</option>)}
          </Select>
        </Field>
        <Field id={`${id}-nature`} label="Nature">
          <Select data-training-nature value={build.nature} className="py-2" onChange={(event) => onChange(withNature(edit, event.target.value))}>
            {NATURES.map((nature) => <option key={nature.name} value={nature.name}>{natureLabel(nature.name)}</option>)}
          </Select>
        </Field>
      </div>

      {points && (
        <fieldset className="min-w-0">
          <legend className="flex w-full flex-wrap justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>Stat Points</span>
            <span className={`tabular-nums normal-case ${total > TOTAL_STAT_POINTS ? "text-danger" : ""}`}>{total} / {TOTAL_STAT_POINTS}</span>
          </legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {STATS.map((stat) => (
              <div key={stat} className="min-w-0">
                <label htmlFor={`${id}-points-${stat}`} className="block text-xs font-medium text-text">{STAT_SHORT[stat]}</label>
                <PointsInput id={`${id}-points-${stat}`} label={`${STAT_SHORT[stat]} Stat Points (0–${MAX_STAT_POINTS})`} value={points[stat]} onValue={(value) => onChange(withPoints(edit, stat, value))} />
                <span className="block text-xs tabular-nums text-muted">{stats ? stats[stat] : "—"}</span>
              </div>
            ))}
          </div>
          {!!issues.length && <ul className="mt-1 space-y-0.5 text-xs text-danger">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        </fieldset>
      )}

      {canReset && <Button variant="secondary" size="sm" className="min-h-11" onClick={onReset}>Reset set</Button>}
    </div>
  );
}
