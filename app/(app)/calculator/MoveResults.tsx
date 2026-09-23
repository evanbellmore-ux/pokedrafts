"use client";

import { Fragment, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, EmptyState, Field, Input, Select, TableWrap, tableClassName, tdClassName, thClassName, theadClassName, trClassName } from "@/app/components/ui";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { parseIntegerInput, rankResults, type DamageSort } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleBuild, ChampionsMove, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";
import { useMinWidthMd } from "../leagues/[leagueId]/useMinWidthMd";
import { damagePercent, formatRange, koChance } from "./result-format";

const PAGE_SIZE = 30;
const kindLabels: Record<MoveDamageResult["kind"], string> = {
  calculated: "Calculated",
  status: "Status move",
  "needs-context": "Needs context",
  unsupported: "Unsupported",
};
type MoveFilter = "all" | "damaging" | "status" | "needs-context" | "unsupported";
type Candidate = { move: ChampionsMove; row?: MoveDamageResult };

export function filterMoveResults(rows: MoveDamageResult[], query: string, filter: MoveFilter, runtime: BattleRuntime = championsRuntime) {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    const move = runtime.movesById.get(row.moveId);
    const category = row.effectiveCategory ?? move?.category;
    const matchesFilter = filter === "all"
      || (filter === "status" ? category === "Status"
        : filter === "damaging" ? category !== "Status" : row.kind === filter);
    return matchesFilter && `${move?.name ?? row.moveId} ${row.effectiveName ?? ""}`.toLowerCase().includes(normalizedQuery);
  });
}

function isConverted(move: ChampionsMove | undefined, row?: MoveDamageResult, context?: MoveContext, sourceBuild?: BattleBuild) {
  return context?.useZ === true || sourceBuild?.mechanic === "dynamax" || sourceBuild?.mechanic === "gigantamax"
    || !!(row?.effectiveName && move && row.effectiveName !== move.name && row.hits === 1);
}

function basePower(move: ChampionsMove | undefined) {
  return !move ? "—" : move.power === 0 ? "Variable / special" : String(move.power);
}

function Damage({ row }: { row: MoveDamageResult | undefined }) {
  if (!row) return <p className="text-sm text-muted">Not calculated</p>;
  if (row.kind !== "calculated") return <p className="text-sm text-muted">Unranked · {kindLabels[row.kind]}</p>;
  return (
    <div className="tabular-nums">
      <p className="font-semibold text-text">{formatRange(row.min, row.max)} HP</p>
      <p className="mt-0.5 text-xs text-muted">{damagePercent(row)}</p>
    </div>
  );
}

function Rolls({ rolls }: { rolls: MoveDamageResult["rolls"] }) {
  if (rolls === null) return <p className="text-muted">No damage rolls available.</p>;
  if (typeof rolls === "number") return <p className="tabular-nums">Fixed damage: {rolls} HP.</p>;
  if (!rolls.some(Array.isArray)) return <p className="wrap-anywhere tabular-nums">Damage rolls: {rolls.join(", ")}</p>;
  return (
    <div className="space-y-2">
      <p className="text-muted">Separate roll groups are preserved, not flattened into a probability distribution.</p>
      <ol className="space-y-1">
        {rolls.map((group, index) => <li key={index} className="wrap-anywhere tabular-nums">Group {index + 1}: {Array.isArray(group) ? `[${group.join(", ")}]` : group}</li>)}
      </ol>
    </div>
  );
}

export function MoveDetails({ moveId, row, id, context, abilityId, itemId, onContextChange, sourceBuild, runtime = championsRuntime }: {
  moveId: string;
  row?: MoveDamageResult;
  id: string;
  context: MoveContext | undefined;
  abilityId: string;
  itemId: string;
  onContextChange: (context: MoveContext) => void;
  sourceBuild?: BattleBuild;
  runtime?: BattleRuntime;
}) {
  const move = runtime.movesById.get(moveId);
  const name = row?.effectiveName ?? move?.name ?? moveId;
  const converted = isConverted(move, row, context, sourceBuild);
  const hitRange = !converted && Array.isArray(move?.multihit) ? move.multihit : null;
  const minimumHits = hitRange && itemId === "loadeddice" && hitRange[0] === 2 && hitRange[1] === 5 ? 4 : hitRange?.[0] ?? 1;
  return (
    <div id={id} tabIndex={-1} aria-label={`${name} details`} className="space-y-3 rounded wrap-anywhere text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      {row?.reason && <p className="font-medium">{row.reason}</p>}
      {hitRange && (abilityId === "skilllink" ? (
        <p>Skill Link fixes this move at {hitRange[1]} hits; no manual hit count is needed.</p>
      ) : (
        <Field id={`${id}-hits`} label={`${move?.name ?? moveId}: hits this use`} help={`Choose the number of hits for this one use. No hidden hit count or future-turn sequence is assumed.${minimumHits !== hitRange[0] ? " Loaded Dice limits this choice to 4–5 hits." : ""}`} className="max-w-sm">
          <Select value={context?.hits ?? ""} onChange={(event) => onContextChange({ ...context, hits: parseIntegerInput(event.target.value) ?? undefined })}>
            <option value="">Choose hit count</option>
            {context?.hits !== undefined && context.hits < minimumHits && <option value={context.hits} disabled>{context.hits} hits — choose again</option>}
            {Array.from({ length: hitRange[1] - minimumHits + 1 }, (_, index) => minimumHits + index).map((hits) => <option key={hits} value={hits}>{hits} hits</option>)}
          </Select>
        </Field>
      ))}
      {row?.effectiveName && <p className="flex flex-wrap items-center gap-2 font-semibold">{row.effectiveName}<TypeBadge type={row.effectiveType ?? move?.type ?? "Unknown"} /><span className="text-xs font-normal text-muted">Power: {row.effectivePower ?? "—"} · {row.effectiveCategory ?? move?.category}</span></p>}
      {converted && <p className="text-xs text-muted">Requested Z / Max conversion uses one transformed attack, not the base move’s hit count. Unsupported requests remain uncalculated.</p>}
      <p className="text-xs text-muted">{converted ? `Assigned move: ${move?.name ?? moveId} · Catalog base power` : "Base power"}: {basePower(move)} · Accuracy: {move?.accuracy != null ? `${move.accuracy}%` : "—"} · Category: {move?.category ?? "—"}</p>
      {move?.description && <p className="text-muted">{move.description}</p>}
      {row?.description && <p>{row.description}</p>}
      <p className="text-xs text-muted">
        Target: {move?.target ?? "—"} · Priority: {move?.priority ?? "—"}
        {row && row.hits !== null && ` · Hits: ${row.hits}`}
      </p>
      {row && row.assumptions.length > 0 && (
        <div>
          <p className="font-semibold">Assumptions for this result</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{row.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
        </div>
      )}
      {row ? <Rolls rolls={row.rolls} /> : <p className="text-muted">Damage is not available yet. Move information and hit-count editing remain available.</p>}
      <p className="text-xs text-muted">Type, base power and accuracy are catalog values; effective changes appear above. A dash is not a normal accuracy percentage.</p>
    </div>
  );
}

export type MoveResultsHandle = { showMove: (moveId: string, expectedOwner?: string) => void };

type Props = {
  rows: MoveDamageResult[];
  moveIds: readonly string[];
  ownerId: string;
  selectedMoveId: string | null;
  onSelectMove: (moveId: string) => void;
  contexts: Record<string, MoveContext>;
  onContextChange: (moveId: string, context: MoveContext) => void;
  replacement?: {
    slotIndex: number;
    moves: MoveSlots;
    onReplace: (moveId: string) => void;
    onDone: () => void;
  };
  abilityId: string;
  itemId: string;
  attackerName: string;
  defenderName: string;
  sourcePosition: "left" | "right";
  defenderHP: number | null;
  blocked?: boolean;
  id?: string;
  ref?: Ref<MoveResultsHandle>;
  onReveal?: (element: HTMLElement) => void;
  sourceBuild?: BattleBuild;
  runtime?: BattleRuntime;
};

export default function MoveResults({ rows, moveIds, ownerId, selectedMoveId, onSelectMove, contexts, onContextChange, replacement, abilityId, itemId, attackerName, defenderName, sourcePosition, defenderHP, blocked = false, id, ref, onReveal, sourceBuild, runtime = championsRuntime }: Props) {
  const prefix = useId();
  const wide = useMinWidthMd();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MoveFilter>("all");
  const [sort, setSort] = useState<DamageSort>("minimum");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [detailTarget, setDetailTarget] = useState<{ ownerId: string; moveId: string | null }>({ ownerId, moveId: null });
  if (detailTarget.ownerId !== ownerId) setDetailTarget({ ownerId, moveId: null });
  const expanded = detailTarget.ownerId === ownerId ? detailTarget.moveId : null;
  const pendingFocus = useRef<{ ownerId: string; moveId: string } | null>(null);
  const resultRows = blocked ? [] : rows;
  const effectiveSort = blocked ? "name" : sort;
  const effectiveFilter = blocked && (filter === "needs-context" || filter === "unsupported") ? "all" : filter;
  const ranked = rankResults(resultRows, effectiveSort, runtime);
  const results = new Map(ranked.map((row, index) => [row.moveId, { row, index }]));
  const assignedMoves = new Set(replacement?.moves.map((slot) => slot.moveId));
  const candidates: Candidate[] = [...new Set(moveIds)].flatMap((moveId) => {
    const move = runtime.movesById.get(moveId);
    return move && !assignedMoves.has(moveId) ? [{ move, row: results.get(moveId)?.row }] : [];
  });
  const candidateName = (candidate: Candidate) => candidate.row?.effectiveName ?? candidate.move.name;
  candidates.sort((a, b) => effectiveSort === "name" ? candidateName(a).localeCompare(candidateName(b), "en")
    : (results.get(a.move.id)?.index ?? Infinity) - (results.get(b.move.id)?.index ?? Infinity) || candidateName(a).localeCompare(candidateName(b), "en"));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = candidates.filter(({ move, row }) => {
    const category = row?.effectiveCategory ?? move.category;
    const matchesFilter = effectiveFilter === "all" || (effectiveFilter === "status" ? category === "Status"
      : effectiveFilter === "damaging" ? category !== "Status" : row?.kind === effectiveFilter);
    return matchesFilter && `${move.name} ${row?.effectiveName ?? ""}`.toLowerCase().includes(normalizedQuery);
  });
  // Keep an open editor mounted if its hit count changes the damage ranking.
  const visible = filtered.filter(({ move }, index) => index < limit || move.id === expanded);
  const counts = (kind: MoveDamageResult["kind"]) => resultRows.filter((row) => row.kind === kind).length;
  const selectedHidden = candidates.some(({ move }) => move.id === selectedMoveId) && !visible.some(({ move }) => move.id === selectedMoveId);
  const currentMoveId = replacement?.moves[replacement.slotIndex].moveId;
  const selectedMove = selectedMoveId && moveIds.includes(selectedMoveId) ? runtime.movesById.get(selectedMoveId) : undefined;
  const selectedContext = selectedMoveId ? contexts[selectedMoveId] : undefined;
  const selectedResult = selectedMoveId ? results.get(selectedMoveId)?.row : undefined;
  const stellarActive = runtime.profile.tera && sourceBuild?.mechanic === "tera" && sourceBuild.configuration?.teraType === "Stellar";
  const showMoveContext = !!selectedMove && (runtime.profile.zMoves || stellarActive);

  function resetFilter() {
    setQuery("");
    setFilter("all");
    setLimit(PAGE_SIZE);
  }

  function focusDetails(moveId: string) {
    const element = document.getElementById(`${prefix}-${moveId}-details-hits`) ?? document.getElementById(`${prefix}-${moveId}-details`);
    if (!element || element.closest("[hidden]")) return false;
    if (onReveal) onReveal(element);
    else {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "center" });
    }
    return true;
  }

  function showMove(moveId: string, expectedOwner = ownerId) {
    if (expectedOwner !== ownerId || !candidates.some(({ move }) => move.id === moveId)) return;
    if (expanded === moveId && visible.some(({ move }) => move.id === moveId) && focusDetails(moveId)) return;
    pendingFocus.current = { ownerId, moveId };
    resetFilter();
    setDetailTarget({ ownerId, moveId });
  }

  useImperativeHandle(ref, () => ({ showMove }));

  useEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (!pending || pending.ownerId !== ownerId) return;
    const element = document.getElementById(`${prefix}-${pending.moveId}-details-hits`) ?? document.getElementById(`${prefix}-${pending.moveId}-details`);
    if (element && !element.closest("[hidden]")) {
      if (onReveal) onReveal(element);
      else {
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "center" });
      }
    }
  }, [detailTarget, query, filter, limit, prefix, ownerId, onReveal]);

  function needsHits({ move, row }: Candidate) {
    return !isConverted(move, row, contexts[move.id], sourceBuild) && Array.isArray(move.multihit) && abilityId !== "skilllink"
      && (!row || row.kind === "needs-context" && (!row.reason || /\bhits?\b/i.test(row.reason)));
  }

  function choose(candidate: Candidate) {
    if (replacement) {
      pendingFocus.current = null;
      replacement.onReplace(candidate.move.id);
      return;
    }
    onSelectMove(candidate.move.id);
    if (needsHits(candidate)) {
      // Reveal after the selection commit updates the sticky summary's height.
      pendingFocus.current = { ownerId, moveId: candidate.move.id };
      setDetailTarget({ ownerId, moveId: candidate.move.id });
    }
  }

  function selection(candidate: Candidate) {
    const { move, row } = candidate;
    const name = row?.effectiveName ?? move.name;
    if (replacement) {
      return (
        <div className="space-y-2">
          <p className="wrap-anywhere font-semibold text-text">{name}{name !== move.name && <span className="block text-xs font-normal text-muted">From {move.name}</span>}</p>
          <Button size="sm" aria-label={`Replace move ${replacement.slotIndex + 1} with ${move.name}`} onClick={() => choose(candidate)}>Replace</Button>
        </div>
      );
    }
    return (
      <label htmlFor={`${prefix}-${move.id}-select`} className="flex min-h-11 cursor-pointer items-center gap-3 wrap-anywhere font-semibold text-text">
        <input
          id={`${prefix}-${move.id}-select`}
          type="radio"
          name={`${prefix}-selected-move`}
          value={move.id}
          checked={selectedMoveId === move.id}
          aria-label={`Select ${name}${name !== move.name ? ` (from ${move.name})` : ""} to preview HP`}
          aria-describedby={`${prefix}-${move.id}-damage`}
          onChange={() => choose(candidate)}
          className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <span>{name}{selectedMoveId === move.id && <span className="ml-2 text-xs font-medium text-accent-text">Selected</span>}{name !== move.name && <span className="block text-xs font-normal text-muted">From {move.name}</span>}</span>
      </label>
    );
  }

  function toggle(candidate: Candidate) {
    const { move } = candidate;
    return (
      <Button size="sm" variant="secondary" aria-expanded={expanded === move.id} aria-controls={expanded === move.id ? `${prefix}-${move.id}-details` : undefined} onClick={() => setDetailTarget({ ownerId, moveId: expanded === move.id ? null : move.id })}>
        {expanded === move.id ? "Hide details" : needsHits(candidate) ? "Set hits" : "Details"}
        <span className="sr-only"> for {move.name}</span>
      </Button>
    );
  }

  function details({ move, row }: Candidate) {
    return <MoveDetails moveId={move.id} row={row} id={`${prefix}-${move.id}-details`} context={contexts[move.id]} abilityId={abilityId} itemId={itemId} onContextChange={(context) => onContextChange(move.id, context)} sourceBuild={sourceBuild} runtime={runtime} />;
  }

  return (
    <section id={id} data-moves-owner={ownerId} aria-labelledby={`${prefix}-heading`} className="min-w-0 space-y-4" onKeyDown={(event) => {
      if (replacement && event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        replacement.onDone();
      }
    }}>
      <div className={`flex flex-wrap items-start justify-between gap-3 ${replacement ? "rounded-xl border border-accent-border bg-accent-soft p-4" : ""}`}>
        <div className="min-w-0 flex-1">
          <h2 id={`${prefix}-heading`} className="wrap-anywhere text-xl font-bold text-text">{replacement ? `Replace ${attackerName}’s move ${replacement.slotIndex + 1} — ${currentMoveId ? runtime.movesById.get(currentMoveId)?.name ?? currentMoveId : "Choose move"}` : "Choose a move"}</h2>
          <p className="mt-1 wrap-anywhere text-sm text-muted">{attackerName} ({sourcePosition}) → {defenderName} ({sourcePosition === "left" ? "right" : "left"}){defenderHP !== null && ` (${defenderHP} current HP)`}. {runtime.profile.label} rules.</p>
          <p className="mt-1 text-xs text-muted">{replacement ? "Replace changes only this slot and selects the new move to calculate. Keep choosing replacements, or use Done or Escape to close editing and keep the selected move. Already assigned moves are hidden." : "Select a move to preview HP above without changing your four quick moves."}</p>
        </div>
        {replacement && <Button size="sm" variant="secondary" aria-label="Done replacing move" onClick={replacement.onDone}>Done</Button>}
      </div>
      {blocked && <p className="text-sm text-muted">Calculations are paused. You can still choose moves and edit hit counts. Damage sorting and result filters resume when calculations are available.</p>}
      {showMoveContext && selectedMove && <div className="space-y-2 rounded-lg border border-line bg-panel p-3" aria-label="Selected attack context">
        <p className="wrap-anywhere text-sm font-semibold text-text">{selectedResult?.effectiveName ?? selectedMove.name} · {runtime.profile.label}</p>
        {runtime.profile.zMoves && <>
          <label htmlFor={`${prefix}-use-z`} className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input id={`${prefix}-use-z`} type="checkbox" checked={selectedContext?.useZ === true}
              disabled={selectedMove.category === "Status" && selectedContext?.useZ !== true}
              aria-describedby={`${prefix}-z-help`} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
              onChange={(event) => onContextChange(selectedMove.id, { ...selectedContext, useZ: event.target.checked })} />
            Use Z-Move for {selectedMove.name}
          </label>
          <p id={`${prefix}-z-help`} className="text-xs text-muted">{selectedMove.category === "Status" ? "Status Z-Move bonuses are not simulated; no ordinary damage is substituted." : `Requires an eligible Z-Crystal and base move. Held item: ${runtime.itemsById.get(itemId)?.name ?? "None"}. Assumes the team’s Z-Move use is still available; consumption is not tracked.`}</p>
        </>}
        {stellarActive && selectedMove.category !== "Status" && <Field id={`${prefix}-stellar-first-use`} label="Stellar: first use of this move’s type?" help="Choose explicitly. Stellar’s once-per-type boost and past attacks are not inferred or tracked.">
          <Select value={selectedContext?.stellarFirstUse === undefined ? "" : selectedContext.stellarFirstUse ? "yes" : "no"} onChange={(event) => onContextChange(selectedMove.id, { ...selectedContext, stellarFirstUse: event.target.value === "" ? undefined : event.target.value === "yes" })}>
            <option value="">Choose first-use context</option><option value="yes">Yes — boost still available</option><option value="no">No — this type already used</option>
          </Select>
        </Field>}
        {selectedResult?.reason && <p className="wrap-anywhere text-sm text-muted">{selectedResult.reason}</p>}
      </div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field id={`${prefix}-search`} label="Find a move" className="col-span-2 sm:col-span-1">
          <Input type="search" placeholder="Move name" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
        </Field>
        <Field id={`${prefix}-filter`} label="Show">
          <Select value={effectiveFilter} onChange={(event) => { setFilter(event.target.value as MoveFilter); setLimit(PAGE_SIZE); }}>
            <option value="all">All moves</option>
            <option value="damaging">Damaging moves</option>
            <option value="status">Status moves</option>
            <option value="needs-context" disabled={blocked}>Needs context</option>
            <option value="unsupported" disabled={blocked}>Unsupported</option>
          </Select>
        </Field>
        <Field id={`${prefix}-sort`} label="Sort by">
          <Select value={effectiveSort} onChange={(event) => setSort(event.target.value as DamageSort)}>
            <option value="minimum" disabled={blocked}>Minimum damage (high to low)</option>
            <option value="maximum" disabled={blocked}>Maximum damage (high to low)</option>
            <option value="name">Move name (A–Z)</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p role="status">Showing {visible.length} of {filtered.length} matching moves. Uncalculated moves stay unranked.</p>
        {!replacement && selectedHidden && selectedMoveId && <Button size="sm" variant="secondary" onClick={() => showMove(selectedMoveId)}>Show selected move</Button>}
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No matching moves" description={replacement ? "Already assigned moves are hidden. Try another name or show all available moves." : "Try another name or show all moves, including status and unsupported moves."} action={<Button variant="secondary" onClick={resetFilter}>Clear filters</Button>} />
      ) : wide ? (
        <TableWrap>
          <table className={tableClassName} aria-label="Move damage results">
            <thead className={theadClassName}>
              <tr>
                <th scope="col" className={thClassName} aria-sort={effectiveSort === "name" ? "ascending" : undefined}>Move</th>
                <th scope="col" className={thClassName} aria-sort={effectiveSort !== "name" ? "descending" : undefined}>Damage</th>
                <th scope="col" className={thClassName}>One-use KO</th>
                <th scope="col" className={thClassName}><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((candidate) => {
                const { move, row } = candidate;
                return (
                  <Fragment key={move.id}>
                    <tr className={`${trClassName} ${selectedMoveId === move.id ? "bg-accent-soft" : ""}`}>
                      <th scope="row" className={`${tdClassName} font-normal`}>
                        {selection(candidate)}
                        <div className="mt-1 flex flex-wrap items-center gap-2"><TypeBadge type={row?.effectiveType ?? move.type} /><span className="text-xs text-muted">{row?.effectiveCategory ?? move.category}</span></div>
                      </th>
                      <td id={`${prefix}-${move.id}-damage`} className={tdClassName}><Damage row={row} /></td>
                      <td className={`${tdClassName} tabular-nums text-text`}>{row ? koChance(row) : "Not estimated"}</td>
                      <td className={tdClassName}>{toggle(candidate)}</td>
                    </tr>
                    {expanded === move.id && <tr className="border-t border-line bg-panel-hover"><td colSpan={4} className="p-4">{details(candidate)}</td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <ul aria-label="Move damage results" className="space-y-3">
          {visible.map((candidate) => {
            const { move, row } = candidate;
            return (
              <li key={move.id} className={`min-w-0 space-y-3 rounded-xl border p-4 ${selectedMoveId === move.id ? "border-accent-border bg-accent-soft" : "border-line bg-panel"}`}>
                <div>
                  {selection(candidate)}
                  <div className="mt-1 flex flex-wrap items-center gap-2"><TypeBadge type={row?.effectiveType ?? move.type} /><span className="text-xs text-muted">{row?.effectiveCategory ?? move.category}</span></div>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div id={`${prefix}-${move.id}-damage`} className="text-sm"><Damage row={row} /><p className="mt-1 text-xs tabular-nums text-muted">One-use KO: {row ? koChance(row) : "Not estimated"}</p></div>
                  {toggle(candidate)}
                </div>
                {expanded === move.id && <div className="border-t border-line pt-3">{details(candidate)}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {visible.length < filtered.length && (
        <div className="flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={() => setLimit((current) => current + PAGE_SIZE)}>Show more moves</Button>
          <p className="text-xs text-muted">Search by name to find any move without expanding the list.</p>
        </div>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Move coverage and calculation notes</summary>
        <div className="mt-1 space-y-2">
          <p>{blocked ? `${candidates.length} source-listed moves available; calculations paused.` : `${resultRows.length} of ${moveIds.length} source-listed moves accounted for: ${counts("calculated")} calculated, ${counts("status")} status, ${counts("needs-context")} need context, ${counts("unsupported")} unsupported.`}</p>
          <p>Damage percentages use maximum HP. One-use KO chances use current HP and are conditional on the move hitting, not accuracy-adjusted. No end-of-turn damage or later-turn KO prediction.</p>
        </div>
      </details>
    </section>
  );
}
