"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, EmptyState, Field, Input, Select, TableWrap, tableClassName, tdClassName, thClassName, theadClassName, trClassName } from "@/app/components/ui";
import { movesById } from "@/app/lib/battle/catalog";
import { parseIntegerInput, rankResults, type DamageSort } from "@/app/lib/battle/model";
import type { ChampionsMove, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";
import { useMinWidthMd } from "../leagues/[leagueId]/useMinWidthMd";

const PAGE_SIZE = 30;
const kindLabels: Record<MoveDamageResult["kind"], string> = {
  calculated: "Calculated",
  status: "Status move",
  "needs-context": "Needs context",
  unsupported: "Unsupported",
};
const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
type MoveFilter = "all" | "damaging" | "status" | "needs-context" | "unsupported";

export function filterMoveResults(rows: MoveDamageResult[], query: string, filter: MoveFilter) {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    const move = movesById.get(row.moveId);
    const matchesFilter = filter === "all"
      || (filter === "status" ? move?.category === "Status"
        : filter === "damaging" ? move?.category !== "Status" : row.kind === filter);
    return matchesFilter && (move?.name ?? row.moveId).toLowerCase().includes(normalizedQuery);
  });
}

function range(min: number | null, max: number | null) {
  return min === null || max === null ? "—" : min === max ? String(min) : `${min}–${max}`;
}

function damagePercent(row: MoveDamageResult) {
  return row.minPercent === null || row.maxPercent === null ? "—"
    : `${percent.format(row.minPercent)}–${percent.format(row.maxPercent)}% of max HP`;
}

function koChance(row: MoveDamageResult) {
  if (row.kind !== "calculated" || row.ohkoChance === null) return "Not estimated";
  const value = row.ohkoChance * 100;
  if (value > 0 && value < 0.01) return "<0.01%";
  if (value > 99.99 && value < 100) return ">99.99%";
  return `${percent.format(value)}%`;
}

function basePower(move: ChampionsMove | undefined) {
  return !move ? "—" : move.power === 0 ? "Variable / special" : String(move.power);
}

function Damage({ row }: { row: MoveDamageResult }) {
  if (row.kind !== "calculated") {
    return (
      <div className="text-sm text-muted">
        <p>Unranked · {kindLabels[row.kind]}</p>
        {row.reason && <p className="mt-1 wrap-anywhere text-xs">{row.reason}</p>}
      </div>
    );
  }
  return (
    <div className="tabular-nums">
      <p className="font-semibold text-text">{range(row.min, row.max)} HP</p>
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

function MoveDetails({ row, id, context, abilityId, itemId, onContextChange }: {
  row: MoveDamageResult;
  id: string;
  context: MoveContext | undefined;
  abilityId: string;
  itemId: string;
  onContextChange: (context: MoveContext) => void;
}) {
  const move = movesById.get(row.moveId);
  const hitRange = Array.isArray(move?.multihit) ? move.multihit : null;
  const minimumHits = hitRange && itemId === "loadeddice" && hitRange[0] === 2 && hitRange[1] === 5 ? 4 : hitRange?.[0] ?? 1;
  return (
    <div id={id} className="space-y-3 wrap-anywhere text-sm text-text">
      {move?.description && <p className="text-muted">{move.description}</p>}
      {row.reason && <p className="font-medium">{row.reason}</p>}
      {hitRange && (abilityId === "skilllink" ? (
        <p>Skill Link fixes this move at {hitRange[1]} hits; no manual hit count is needed.</p>
      ) : (
        <Field id={`${id}-hits`} label={`${move?.name ?? row.moveId}: hits this use`} help={`Choose the number of hits for this one use. No hidden hit count or future-turn sequence is assumed.${minimumHits !== hitRange[0] ? " Loaded Dice limits this choice to 4–5 hits." : ""}`} className="max-w-sm">
          <Select value={context?.hits ?? ""} onChange={(event) => onContextChange({ hits: parseIntegerInput(event.target.value) ?? undefined })}>
            <option value="">Choose hit count</option>
            {context?.hits !== undefined && context.hits < minimumHits && <option value={context.hits} disabled>{context.hits} hits — choose again</option>}
            {Array.from({ length: hitRange[1] - minimumHits + 1 }, (_, index) => minimumHits + index).map((hits) => <option key={hits} value={hits}>{hits} hits</option>)}
          </Select>
        </Field>
      ))}
      {row.description && <p>{row.description}</p>}
      <p className="text-xs text-muted">
        Target: {move?.target ?? "—"} · Priority: {move?.priority ?? "—"}
        {row.hits !== null && ` · Hits: ${row.hits}`}
      </p>
      {row.assumptions.length > 0 && (
        <div>
          <p className="font-semibold">Assumptions for this result</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{row.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
        </div>
      )}
      <Rolls rolls={row.rolls} />
    </div>
  );
}

type Props = {
  rows: MoveDamageResult[];
  contexts: Record<string, MoveContext>;
  onContextChange: (moveId: string, context: MoveContext) => void;
  sourceMoveCount: number;
  abilityId: string;
  itemId: string;
  attackerName: string;
  defenderName: string;
  defenderHP: number | null;
  feedback?: ReactNode;
};

export default function MoveResults({ rows, contexts, onContextChange, sourceMoveCount, abilityId, itemId, attackerName, defenderName, defenderHP, feedback }: Props) {
  const prefix = useId();
  const wide = useMinWidthMd();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MoveFilter>("all");
  const [sort, setSort] = useState<DamageSort>("minimum");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = filterMoveResults(rankResults(rows, sort), query, filter);
  // Keep an open editor mounted if its hit count changes the damage ranking.
  const visible = filtered.filter((row, index) => index < limit || row.moveId === expanded);
  const counts = (kind: MoveDamageResult["kind"]) => rows.filter((row) => row.kind === kind).length;

  function resetFilter() {
    setQuery("");
    setFilter("all");
    setLimit(PAGE_SIZE);
  }

  function toggle(row: MoveDamageResult) {
    return (
      <Button size="sm" variant="secondary" aria-expanded={expanded === row.moveId} aria-controls={expanded === row.moveId ? `${prefix}-${row.moveId}-details` : undefined} onClick={() => setExpanded(expanded === row.moveId ? null : row.moveId)}>
        {expanded === row.moveId ? "Hide details" : row.kind === "needs-context" && Array.isArray(movesById.get(row.moveId)?.multihit) && abilityId !== "skilllink" ? "Set hits" : "Details"}
        <span className="sr-only"> for {movesById.get(row.moveId)?.name ?? row.moveId}</span>
      </Button>
    );
  }

  function details(row: MoveDamageResult) {
    return <MoveDetails row={row} id={`${prefix}-${row.moveId}-details`} context={contexts[row.moveId]} abilityId={abilityId} itemId={itemId} onContextChange={(context) => onContextChange(row.moveId, context)} />;
  }

  return (
    <section aria-labelledby={`${prefix}-heading`} className="min-w-0 space-y-4">
      <div>
        <h2 id={`${prefix}-heading`} className="text-xl font-bold text-text">Move damage</h2>
        <p className="mt-1 wrap-anywhere text-sm text-muted">{attackerName} → {defenderName}{defenderHP !== null && ` (${defenderHP} current HP)`}</p>
        <p className="mt-2 text-xs text-muted">Damage percentages use maximum HP. One-use KO chances use current HP and are conditional on the move hitting, not accuracy-adjusted. No end-of-turn damage or later-turn KO prediction.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${prefix}-search`} label="Find a move">
          <Input type="search" placeholder="Move name" value={query} disabled={!!feedback} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
        </Field>
        <Field id={`${prefix}-filter`} label="Show">
          <Select value={filter} disabled={!!feedback} onChange={(event) => { setFilter(event.target.value as typeof filter); setLimit(PAGE_SIZE); }}>
            <option value="all">All moves</option>
            <option value="damaging">Damaging moves</option>
            <option value="status">Status moves</option>
            <option value="needs-context">Needs context</option>
            <option value="unsupported">Unsupported</option>
          </Select>
        </Field>
        <Field id={`${prefix}-sort`} label="Sort by">
          <Select value={sort} disabled={!!feedback} onChange={(event) => setSort(event.target.value as DamageSort)}>
            <option value="minimum">Minimum damage (high to low)</option>
            <option value="maximum">Maximum damage (high to low)</option>
            <option value="name">Move name (A–Z)</option>
          </Select>
        </Field>
      </div>

      {feedback || (
        <>
          <div className="space-y-1 text-xs text-muted">
            <p>{rows.length} of {sourceMoveCount} source-listed moves accounted for: {counts("calculated")} calculated, {counts("status")} status, {counts("needs-context")} need context, {counts("unsupported")} unsupported.</p>
            <p role="status">Showing {visible.length} of {filtered.length} matching moves. Uncalculated moves stay unranked.</p>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No matching moves" description="Try another name or show all moves, including status and unsupported moves." action={<Button variant="secondary" onClick={resetFilter}>Clear filters</Button>} />
          ) : wide ? (
            <TableWrap>
              <table className={tableClassName} aria-label="Move damage results">
                <thead className={theadClassName}>
                  <tr>
                    <th scope="col" className={thClassName} aria-sort={sort === "name" ? "ascending" : undefined}>Move</th>
                    <th scope="col" className={thClassName}>Base power</th>
                    <th scope="col" className={thClassName}>Accuracy</th>
                    <th scope="col" className={thClassName} aria-sort={sort !== "name" ? "descending" : undefined}>Damage</th>
                    <th scope="col" className={thClassName}>One-use KO</th>
                    <th scope="col" className={thClassName}><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const move = movesById.get(row.moveId);
                    return (
                      <Fragment key={row.moveId}>
                        <tr className={trClassName}>
                          <th scope="row" className={`${tdClassName} font-normal`}>
                            <p className="font-semibold text-text">{move?.name ?? row.moveId}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">{move && <TypeBadge type={move.type} />}<span className="text-xs text-muted">{move?.category}</span></div>
                          </th>
                          <td className={`${tdClassName} tabular-nums text-muted`}>{basePower(move)}</td>
                          <td className={`${tdClassName} tabular-nums text-muted`}>{move?.accuracy != null ? `${move.accuracy}%` : "—"}</td>
                          <td className={tdClassName}><Damage row={row} /></td>
                          <td className={`${tdClassName} tabular-nums text-text`}>{koChance(row)}</td>
                          <td className={tdClassName}>{toggle(row)}</td>
                        </tr>
                        {expanded === row.moveId && <tr className="border-t border-line bg-panel-hover"><td colSpan={6} className="p-4">{details(row)}</td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <ul aria-label="Move damage results" className="space-y-3">
              {visible.map((row) => {
                const move = movesById.get(row.moveId);
                return (
                  <li key={row.moveId} className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-4">
                    <div>
                      <h3 className="wrap-anywhere font-semibold text-text">{move?.name ?? row.moveId}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">{move && <TypeBadge type={move.type} />}<span className="text-xs text-muted">{move?.category}</span></div>
                      <p className="mt-2 text-xs text-muted">Base power: {basePower(move)} · Accuracy: {move?.accuracy != null ? `${move.accuracy}%` : "—"}</p>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="mb-1 text-xs text-muted">Damage</dt><dd><Damage row={row} /></dd></div>
                      <div><dt className="mb-1 text-xs text-muted">One-use KO</dt><dd className="tabular-nums text-text">{koChance(row)}</dd></div>
                    </dl>
                    {toggle(row)}
                    {expanded === row.moveId && <div className="border-t border-line pt-3">{details(row)}</div>}
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
          <p className="text-xs text-muted">Type, base power and accuracy are catalog values; effective changes appear in details. A dash is not a normal accuracy percentage. Details also show limitations and engine roll structure.</p>
        </>
      )}
    </section>
  );
}
