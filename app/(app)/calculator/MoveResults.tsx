"use client";

import { Fragment, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button, EmptyState, Field, Input, Select, TableWrap, tableClassName, tdClassName, thClassName, theadClassName, trClassName } from "@/app/components/ui";
import { EVENT_DOUBLING_MOVES } from "@/app/lib/battle/event-moves";
import { turnOrderQuestion } from "@/app/lib/battle/turn-order";
import { hitCountRule, type HitCountBattle } from "@/app/lib/battle/hit-count";
import { MAX_BEAT_UP_ALLIES, MAX_FAINTED_ALLIES, MAX_TIMES_HIT } from "@/app/lib/battle/count-moves";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { normalizeSearchText } from "@/app/lib/battle/species-search";
import { stellarBoostUsedUp } from "@/app/lib/battle/mechanics";
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

/**
 * Whether a move matches a search, ignoring case, punctuation and spacing like the Pokémon
 * chooser: every word of the query must appear in the name, so "uturn", "u turn" and "U-turn"
 * all find U-turn, and "double edge" finds Double-Edge. Each name (base and Z/Max) is
 * normalised on its own, so a word cannot match across two names; a query with no letters or
 * digits (only punctuation, or a non-Latin script) matches nothing.
 */
export function moveMatchesQuery(names: readonly string[], query: string): boolean {
  const words = query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean);
  if (!words.length) return !query.trim();
  const texts = [...new Set(names.map(normalizeSearchText).filter(Boolean))];
  return words.every((word) => texts.some((text) => text.includes(word)));
}

export function filterMoveResults(rows: MoveDamageResult[], query: string, filter: MoveFilter, runtime: BattleRuntime = championsRuntime) {
  return rows.filter((row) => {
    const move = runtime.movesById.get(row.moveId);
    const category = row.effectiveCategory ?? move?.category;
    const matchesFilter = filter === "all"
      || (filter === "status" ? category === "Status"
        : filter === "damaging" ? category !== "Status" : row.kind === filter);
    return matchesFilter && moveMatchesQuery([move?.name ?? row.moveId, row.effectiveName ?? ""], query);
  });
}

function isConverted(move: ChampionsMove | undefined, row?: MoveDamageResult, context?: MoveContext, sourceBuild?: BattleBuild) {
  return context?.useZ === true || sourceBuild?.mechanic === "dynamax" || sourceBuild?.mechanic === "gigantamax"
    || !!(row?.effectiveName && move && row.effectiveName !== move.name && row.hits === 1);
}

function basePower(move: ChampionsMove | undefined) {
  return !move ? "—" : move.power === 0 ? "Variable / special" : String(move.power);
}

/**
 * Where Show move lands: the unset move-settings choice (Beat Up's party, Stellar first use) that
 * the selected move waits for, else its hit count, else its details.
 */
function focusTarget(prefix: string, moveId: string) {
  const settings = document.getElementById(`${prefix}-settings`);
  const waiting = settings?.dataset.moveId === moveId && settings.dataset.needsContext !== undefined
    ? [...settings.querySelectorAll("select")].find((select) => select.value === "" && !select.disabled) : undefined;
  return waiting ?? document.getElementById(`${prefix}-${moveId}-details-hits`) ?? document.getElementById(`${prefix}-${moveId}-details`);
}

function Damage({ row }: { row: MoveDamageResult | undefined }) {
  if (!row) return <p className="text-sm text-muted">Not calculated</p>;
  if (row.kind !== "calculated") return <p className="text-sm text-muted">Unranked · {kindLabels[row.kind]}</p>;
  return (
    <div className="tabular-nums">
      <p className="font-semibold text-text">{formatRange(row.min, row.max)} HP</p>
      <p className="mt-0.5 text-xs text-muted">{damagePercent(row)}</p>
      {row.alternate && <p className="mt-0.5 text-xs text-muted">{Math.round(row.alternate.chance * 100)}% chance of {row.alternate.label}: {formatRange(row.alternate.min, row.alternate.max)} HP ({damagePercent(row.alternate)})</p>}
    </div>
  );
}

function Rolls({ rolls, alternate }: { rolls: MoveDamageResult["rolls"]; alternate?: MoveDamageResult["alternate"] }) {
  if (rolls === null) return <p className="text-muted">No damage rolls available.</p>;
  if (typeof rolls === "number") return <p className="tabular-nums">Fixed damage: {rolls} HP.</p>;
  if (!rolls.some(Array.isArray)) {
    return alternate ? (
      <>
        <p className="wrap-anywhere tabular-nums">Damage rolls ({alternate.usualLabel}): {rolls.join(", ")}</p>
        <p className="wrap-anywhere tabular-nums">Damage rolls with {alternate.label} ({Math.round(alternate.chance * 100)}% chance): {alternate.rolls.join(", ")}</p>
      </>
    ) : <p className="wrap-anywhere tabular-nums">Damage rolls: {rolls.join(", ")}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-muted">Separate roll groups are preserved, not flattened into a probability distribution.</p>
      <ol className="space-y-1">
        {rolls.map((group, index) => <li key={index} className="wrap-anywhere tabular-nums">Group {index + 1}: {Array.isArray(group) ? `[${group.join(", ")}]` : group}</li>)}
      </ol>
    </div>
  );
}

export function MoveDetails({ moveId, row, id, context, abilityId, itemId, onContextChange, sourceBuild, runtime = championsRuntime, hitBattle }: {
  moveId: string;
  row?: MoveDamageResult;
  id: string;
  context: MoveContext | undefined;
  abilityId: string;
  itemId: string;
  onContextChange: (context: MoveContext) => void;
  sourceBuild?: BattleBuild;
  runtime?: BattleRuntime;
  /** Magic Room and the receiving Pokémon's ability, which can switch Loaded Dice or Skill Link off. */
  hitBattle?: HitCountBattle;
}) {
  const move = runtime.movesById.get(moveId);
  const name = row?.effectiveName ?? move?.name ?? moveId;
  const converted = isConverted(move, row, context, sourceBuild);
  const hitRule = !converted && move ? hitCountRule(move, { abilityId, itemId, speciesId: sourceBuild?.speciesId }, runtime, hitBattle) : null;
  const choice = hitRule?.kind === "choose" ? hitRule : null;
  const staleHits = choice && context?.hits !== undefined && (context.hits < choice.min || context.hits > choice.max) ? context.hits : null;
  const hitLabel = (hits: number) => `${hits} ${hits === 1 ? "hit" : "hits"}`;
  return (
    <div id={id} tabIndex={-1} aria-label={`${name} details`} className="space-y-3 rounded wrap-anywhere text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      {row?.reason && <p className="font-medium">{row.reason}</p>}
      {hitRule?.kind === "fixed" && hitRule.reason && <p>{hitRule.reason} No manual hit count is needed.</p>}
      {choice && (
        <Field id={`${id}-hits`} label={`${move?.name ?? moveId}: hits this use`} help={choice.perHitAccuracy
          ? `After the first hit, each hit checks accuracy again and the move stops at the first miss. All ${choice.max} hits landing is assumed unless you choose fewer.`
          : `Choose the number of hits for this one use. No hidden hit count or future-turn sequence is assumed.${choice.loadedDice ? ` Loaded Dice limits this choice to ${choice.min}–${choice.max} hits.` : ""}`} className="max-w-sm">
          <Select value={context?.hits ?? (choice.defaultHits ?? "")} onChange={(event) => {
            // Picking the default keeps it implicit, so a later rule change (e.g. Loaded Dice) asks again.
            const hits = parseIntegerInput(event.target.value) ?? undefined;
            onContextChange({ ...context, hits: hits === choice.defaultHits ? undefined : hits });
          }}>
            {choice.defaultHits === null && <option value="">Choose hit count</option>}
            {staleHits !== null && <option value={staleHits} disabled>{hitLabel(staleHits)} — choose again</option>}
            {Array.from({ length: choice.max - choice.min + 1 }, (_, index) => choice.min + index).map((hits) => <option key={hits} value={hits}>{hitLabel(hits)}{hits === choice.defaultHits ? " (all)" : ""}</option>)}
          </Select>
        </Field>
      )}
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
      {row ? <Rolls rolls={row.rolls} alternate={row.alternate} /> : <p className="text-muted">Damage is not available yet. Move information and hit-count editing remain available.</p>}
      <p className="text-xs text-muted">Base power, accuracy and category here are catalog values{row?.effectiveName ? row.kind === "calculated" ? "; the bold line with the move's name shows the power and type used for this result" : "; the bold line with the move's name shows catalog values until it can be calculated" : ""}. Accuracy is never adjusted: No Guard, Compound Eyes, Gravity and weather accuracy are not simulated. A dash means the move skips the accuracy check.</p>
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
  /** Magic Room and the receiving Pokémon's ability, which can switch Loaded Dice or Skill Link off. */
  hitBattle?: HitCountBattle;
  /** The attacker's team, offered first as Beat Up party members. */
  partyOptions?: readonly { speciesId: string; name: string }[];
  /** Doubles cannot work out Analytic's turn order, so it always asks. */
  gameType?: "Singles" | "Doubles";
};

export default function MoveResults({ rows, moveIds, ownerId, selectedMoveId, onSelectMove, contexts, onContextChange, replacement, abilityId, itemId, attackerName, defenderName, sourcePosition, defenderHP, blocked = false, id, ref, onReveal, sourceBuild, runtime = championsRuntime, hitBattle, partyOptions = [], gameType = "Doubles" }: Props) {
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
  const filtered = candidates.filter(({ move, row }) => {
    const category = row?.effectiveCategory ?? move.category;
    const matchesFilter = effectiveFilter === "all" || (effectiveFilter === "status" ? category === "Status"
      : effectiveFilter === "damaging" ? category !== "Status" : row?.kind === effectiveFilter);
    return matchesFilter && moveMatchesQuery([move.name, row?.effectiveName ?? ""], query);
  });
  // Keep an open editor mounted if its hit count changes the damage ranking.
  const visible = filtered.filter(({ move }, index) => index < limit || move.id === expanded);
  const counts = (kind: MoveDamageResult["kind"]) => resultRows.filter((row) => row.kind === kind).length;
  const selectedHidden = candidates.some(({ move }) => move.id === selectedMoveId) && !visible.some(({ move }) => move.id === selectedMoveId);
  const currentMoveId = replacement?.moves[replacement.slotIndex].moveId;
  const selectedMove = selectedMoveId && moveIds.includes(selectedMoveId) ? runtime.movesById.get(selectedMoveId) : undefined;
  const selectedContext = selectedMoveId ? contexts[selectedMoveId] : undefined;
  const selectedResult = selectedMoveId ? results.get(selectedMoveId)?.row : undefined;
  const stellarActive = runtime.profile.tera && sourceBuild?.mechanic === "tera" && sourceBuild.configuration?.teraType === "Stellar" && stellarBoostUsedUp(sourceBuild, runtime);
  // Z-Moves and Max Moves have fixed power, so the doubling event does not apply to them.
  const eventRule = selectedMove && !isConverted(selectedMove, selectedResult, selectedContext, sourceBuild)
    ? EVENT_DOUBLING_MOVES[selectedMove.id] : undefined;
  // Last Respects, Rage Fist and Beat Up take counts the battle history would give (count-moves.ts).
  const countMove = selectedMove && !isConverted(selectedMove, selectedResult, selectedContext, sourceBuild)
    && ["lastrespects", "ragefist", "beatup"].includes(selectedMove.id) ? selectedMove.id : null;
  // Analytic's boost or Bolt Beak's doubling depends on the turn order (turn-order.ts).
  const turnQuestion = selectedMove && sourceBuild ? turnOrderQuestion(selectedMove, sourceBuild, isConverted(selectedMove, selectedResult, selectedContext, sourceBuild), { ...hitBattle, gameType }) : null;
  const showMoveContext = !!selectedMove && (runtime.profile.zMoves || stellarActive || !!eventRule || !!countMove || !!turnQuestion);
  const party = selectedContext?.party;
  const setParty = (next: readonly string[] | undefined) => selectedMove && onContextChange(selectedMove.id, { ...selectedContext, party: next });
  const allPartySpecies = runtime.catalog.species.filter((species) => !species.battleForm)
    .map((species) => ({ speciesId: species.id, name: species.name })).sort((a, b) => a.name.localeCompare(b.name, "en"));

  function resetFilter() {
    setQuery("");
    setFilter("all");
    setLimit(PAGE_SIZE);
  }

  function focusDetails(moveId: string) {
    const element = focusTarget(prefix, moveId);
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
    const element = focusTarget(prefix, pending.moveId);
    if (element && !element.closest("[hidden]")) {
      if (onReveal) onReveal(element);
      else {
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "center" });
      }
    }
  }, [detailTarget, query, filter, limit, prefix, ownerId, onReveal, selectedMoveId]);

  function needsHits({ move, row }: Candidate) {
    // Moves with a default count never wait for hits, even when their row needs other context.
    const rule = hitCountRule(move, { abilityId, itemId, speciesId: sourceBuild?.speciesId }, runtime, hitBattle);
    return !isConverted(move, row, contexts[move.id], sourceBuild) && rule.kind === "choose" && rule.defaultHits === null
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
    } else if (candidate.row?.kind === "needs-context" && (candidate.move.id === "beatup" && !isConverted(candidate.move, candidate.row, contexts[candidate.move.id], sourceBuild)
      || (sourceBuild && turnOrderQuestion(candidate.move, sourceBuild, isConverted(candidate.move, candidate.row, contexts[candidate.move.id], sourceBuild), { ...hitBattle, gameType }) && /turn order/.test(candidate.row.reason ?? "")))) {
      // Beat Up waits for its party and a turn-order move for its order, chosen in the move settings above the list.
      pendingFocus.current = { ownerId, moveId: candidate.move.id };
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
    return <MoveDetails moveId={move.id} row={row} id={`${prefix}-${move.id}-details`} context={contexts[move.id]} abilityId={abilityId} itemId={itemId} onContextChange={(context) => onContextChange(move.id, context)} sourceBuild={sourceBuild} runtime={runtime} hitBattle={hitBattle} />;
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
      {showMoveContext && selectedMove && <div id={`${prefix}-settings`} data-move-id={selectedMove.id} data-needs-context={selectedResult?.kind === "needs-context" ? "" : undefined} className="space-y-2 rounded-lg border border-line bg-panel p-3" aria-label="Selected attack context">
        <p className="wrap-anywhere text-sm font-semibold text-text">Move settings: {selectedResult?.effectiveName ?? selectedMove.name} · {runtime.profile.label}</p>
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
        {eventRule && <>
          <label htmlFor={`${prefix}-event-doubled`} className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input id={`${prefix}-event-doubled`} type="checkbox" checked={selectedContext?.doubled === true}
              aria-describedby={`${prefix}-event-doubled-help`} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
              onChange={(event) => onContextChange(selectedMove.id, { ...selectedContext, doubled: event.target.checked })} />
            {eventRule.label}
          </label>
          <p id={`${prefix}-event-doubled-help`} className="text-xs text-muted">{`${selectedMove.name} doubles its power when this happened. Unticked, it uses normal power (${selectedMove.power}); the battle history is not tracked.`}</p>
        </>}
        {turnQuestion && <Field id={`${prefix}-turn-order`} label={turnQuestion === "analytic" ? "Turn order for Analytic" : `Turn order for ${selectedMove.name}`}
          help={turnQuestion === "analytic"
            ? `Analytic raises power by 30% when no other Pokémon still has to move this turn. ${gameType === "Doubles" ? "In Doubles the other two Pokémon's order is unknown, so choose it." : "Worked out, it uses priority (the target is assumed to use a priority-0 move), items such as Lagging Tail, Speed and Trick Room; a Speed tie needs a choice."}`
            : `${selectedMove.name} doubles its power when it moves before the target, or the target switched in this turn. Worked out, it uses priority (the target is assumed to use a priority-0 move), items such as Lagging Tail, Speed and Trick Room; a Speed tie needs a choice.`}>
          <Select value={selectedContext?.turnOrder ?? ""} onChange={(event) => onContextChange(selectedMove.id, { ...selectedContext, turnOrder: event.target.value === "first" || event.target.value === "last" ? event.target.value : undefined })}>
            <option value="">{turnQuestion === "analytic" && gameType === "Doubles" ? "Choose the turn order" : "Work it out from priority and Speed"}</option>
            {turnQuestion === "analytic" ? <>
              <option value="last">It moves last this turn: Analytic boosts</option>
              <option value="first">Another Pokémon moves after it: no boost</option>
            </> : <>
              <option value="first">Before the target, or the target switched in: power doubles</option>
              <option value="last">After the target: usual power</option>
            </>}
          </Select>
        </Field>}
        {countMove === "lastrespects" && <Field id={`${prefix}-fainted`} label="Party members that have fainted" help="Last Respects gains 50 power for each fainted party member. The battle history is not tracked.">
          <Select value={selectedContext?.fainted ?? 0} onChange={(event) => onContextChange(countMove, { ...selectedContext, fainted: parseIntegerInput(event.target.value) ?? 0 })}>
            {Array.from({ length: MAX_FAINTED_ALLIES + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
          </Select>
        </Field>}
        {countMove === "ragefist" && <Field id={`${prefix}-times-hit`}
          label={runtime.profile.id === "champions" ? "Times hit since it last switched in" : "Times hit this battle"}
          help={`Rage Fist gains 50 power for each hit the user has taken, up to 350.${runtime.profile.id === "champions" ? " In Champions the count resets when the user switches out." : " The count stays when the user switches out."} The battle history is not tracked.`}>
          <Select value={selectedContext?.timesHit ?? 0} onChange={(event) => onContextChange(countMove, { ...selectedContext, timesHit: parseIntegerInput(event.target.value) ?? 0 })}>
            {Array.from({ length: MAX_TIMES_HIT + 1 }, (_, count) => <option key={count} value={count}>{count === MAX_TIMES_HIT ? `${count} or more` : count}</option>)}
          </Select>
        </Field>}
        {countMove === "beatup" && <>
          <Field id={`${prefix}-party-size`} label="Other party members that can attack" help="Count the party members that are not fainted and have no status. The user always attacks. Each hit's power comes from that Pokémon's base Attack.">
            <Select value={party ? party.length : ""} onChange={(event) => {
              const size = parseIntegerInput(event.target.value);
              setParty(size === null ? undefined : Array.from({ length: size }, (_, index) => party?.[index] ?? ""));
            }}>
              <option value="">Choose how many</option>
              {Array.from({ length: MAX_BEAT_UP_ALLIES + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
            </Select>
          </Field>
          {party?.map((speciesId, index) => (
            <Field key={index} id={`${prefix}-party-${index}`} label={`Party member ${index + 2}`}>
              <Select value={speciesId} onChange={(event) => setParty(party.map((id, slot) => slot === index ? event.target.value : id))}>
                <option value="">Choose a Pokémon</option>
                {partyOptions.length > 0 && <optgroup label="This team">{partyOptions.map((option) => <option key={`team-${option.speciesId}`} value={option.speciesId}>{option.name}</option>)}</optgroup>}
                <optgroup label="All Pokémon">{allPartySpecies.map((option) => <option key={option.speciesId} value={option.speciesId}>{option.name}</option>)}</optgroup>
              </Select>
            </Field>
          ))}
        </>}
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
