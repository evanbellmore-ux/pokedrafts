// Addendum A1.2: Training suggested sets for league-roster members, from the Reg M-B Doubles usage (A1.1) with the Protect rule;
// the calculator keeps its own suggestions. Legality comes from the worker's SetLegality (the bundled Showdown validator).
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { StatPoints } from "../model/sheet";
import type { SetLegality, SpeciesUsage, SuggestedSet, SuggestMember, SuggestTrainingSets, UsageDeps } from "../model/usage";
import { speciesUsage } from "./species-usage";

/** Items that lock the holder into its first move (isChoice: PS/data/items.ts:979, 1002, 1026); Choice Scarf is the legal one. */
export const CHOICE_ITEMS: ReadonlySet<string> = new Set(["choiceband", "choicescarf", "choicespecs"]);
/** Assault Vest disables every Status move (PS/data/items.ts:313, onDisableMove); not a Reg M-C item. */
const ASSAULT_VEST = "assaultvest";
/** No Protect is added with these (A1.2). */
export const PROTECT_RULE_EXCLUDED_ITEMS: ReadonlySet<string> = new Set([...CHOICE_ITEMS, ASSAULT_VEST]);
/**
 * Protect and the moves that protect only their user the same way (stallingMove, one counter: PS/data/moves.ts protect 13962,
 * detect 3527, kingsshield 9906, spikyshield 17533, banefulbunker 985, silktrap 16406, burningbulwark 2020, obstruct 12874,
 * maxguard 11157). A set with one of them already has its Protect.
 */
export const PROTECT_MOVES: ReadonlySet<string> = new Set([
  "protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard",
]);
const ZERO_POINTS: StatPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const MAX_MOVES = 4;

type SetFields = { speciesId: string; itemId: string; abilityId: string; nature: string; points: StatPoints };
type WeightedMove = { id: string; weight: number };

/** A form that only exists holding its item (a Mega Stone: catalog requiredItem, as createBuild gives it). */
function requiredItem(speciesId: string, runtime: BattleRuntime): string | null {
  const species = runtime.speciesById.get(speciesId);
  return species?.requiredItem ?? species?.requiredItems?.[0] ?? null;
}

/** The Pool Builder row's ability when the form has it, else the first of `ranked` the form has, else the calculator's usual one. */
function chooseAbility(member: SuggestMember, ranked: readonly string[], runtime: BattleRuntime): string {
  const abilities = runtime.speciesById.get(member.speciesId)?.abilities ?? [];
  if (member.abilityId && abilities.includes(member.abilityId)) return member.abilityId;
  return ranked.find((id) => abilities.includes(id)) ?? usualAbility(member.speciesId, "Doubles", runtime) ?? abilities[0] ?? "";
}

/**
 * Moves in `ranked` order, each kept only when the validator finds no new problem with it beside the ones already kept
 * (legal together, no duplicate), up to four.
 */
function legalTogether(fields: SetFields, ranked: readonly WeightedMove[], legality: SetLegality, kept: WeightedMove[] = []): WeightedMove[] {
  const legal = new Set(legality.legalMoves(fields.speciesId));
  let baseline = legality.problems({ ...fields, moves: kept.map((move) => move.id) });
  for (const move of ranked) {
    if (kept.length === MAX_MOVES) break;
    if (!legal.has(move.id) || kept.some((each) => each.id === move.id)) continue;
    const problems = legality.problems({ ...fields, moves: [...kept, move].map((each) => each.id) });
    if (problems.some((problem) => !baseline.includes(problem))) continue;
    kept = [...kept, move];
    baseline = problems;
  }
  return kept;
}

/**
 * The Protect rule: the species learns Protect, the set has no move of its family and its item is not a Choice item or Assault
 * Vest. Protect then fills an empty slot, else takes the place of the lowest-weight move (the latest on equal weight), the next
 * lowest when the validator rejects that combination. Null when the rule does not apply or no place is legal.
 */
function withProtect(fields: SetFields, moves: readonly WeightedMove[], legality: SetLegality): WeightedMove[] | null {
  if (PROTECT_RULE_EXCLUDED_ITEMS.has(fields.itemId) || moves.some((move) => PROTECT_MOVES.has(move.id))
    || !legality.legalMoves(fields.speciesId).includes("protect")) return null;
  const protect = { id: "protect", weight: 0 };
  const before = legality.problems({ ...fields, moves: moves.map((move) => move.id) });
  const accepted = (next: readonly WeightedMove[]) =>
    !legality.problems({ ...fields, moves: next.map((move) => move.id) }).some((problem) => !before.includes(problem));
  if (moves.length < MAX_MOVES) return accepted([...moves, protect]) ? [...moves, protect] : null;
  const order = moves.map((move, index) => ({ move, index })).sort((a, b) => a.move.weight - b.move.weight || b.index - a.index);
  for (const { index } of order) {
    const next = moves.map((move, at) => (at === index ? protect : move));
    if (accepted(next)) return next;
  }
  return null;
}

/**
 * Usage moves first; the calculator's suggestion (damaging moves) fills a row with fewer than four legal together. Usage weights
 * are per move, not per item: a Choice item drops the Protect family and Assault Vest every Status move it would disable.
 */
function usageMoves(fields: SetFields, row: SpeciesUsage, deps: UsageDeps): WeightedMove[] {
  const usable = row.moves.filter((move) => !(CHOICE_ITEMS.has(fields.itemId) && PROTECT_MOVES.has(move.id))
    && !(fields.itemId === ASSAULT_VEST && deps.runtime.movesById.get(move.id)?.category === "Status"));
  const ranked = legalTogether(fields, usable, deps.legality);
  if (ranked.length === MAX_MOVES) return ranked;
  return legalTogether(fields, calculatorMoves(fields.speciesId, deps.runtime), deps.legality, ranked);
}

/** createMoveSlots' Doubles moves in slot order, with no usage weight (the Protect rule then replaces the last one first). */
function calculatorMoves(speciesId: string, runtime: BattleRuntime): WeightedMove[] {
  return createMoveSlots(speciesId, "Doubles", runtime).flatMap((slot) => (slot.moveId ? [{ id: slot.moveId, weight: 0 }] : []));
}

/** The set for these fields: its moves, then the Protect rule. */
function finish(member: SuggestMember, fields: SetFields, moves: readonly WeightedMove[], row: SpeciesUsage | null, legality: SetLegality): SuggestedSet {
  const protect = withProtect(fields, moves, legality);
  return {
    key: member.key, speciesId: member.speciesId, source: row ? "usage" : "no-usage",
    moves: (protect ?? moves).map((move) => move.id),
    itemId: fields.itemId, abilityId: fields.abilityId, nature: fields.nature, points: { ...fields.points },
    protectAdded: protect !== null,
  };
}

function suggestOne(member: SuggestMember, deps: UsageDeps, taken: ReadonlySet<string>): SuggestedSet {
  const { runtime, legality } = deps;
  const row = speciesUsage(deps.usage, member.speciesId, runtime);
  const required = member.itemId ?? requiredItem(member.speciesId, runtime);
  if (!row) {
    // No usage row: the calculator's suggested build (createBuild + withRosterAbility), Hardy with 0 Stat Points (SPEC C15).
    const fields = { speciesId: member.speciesId, itemId: required ?? "", abilityId: chooseAbility(member, [], runtime), nature: "Hardy", points: ZERO_POINTS };
    return finish(member, fields, legalTogether(fields, calculatorMoves(member.speciesId, runtime), legality), null, legality);
  }
  const spread = row.spreads.find((entry) => !(entry.nature === "Serious" && Object.values(entry.points).every((value) => value === 0)));
  const base = {
    speciesId: member.speciesId, abilityId: chooseAbility(member, row.abilities.map((entry) => entry.id), runtime),
    nature: spread?.nature ?? "Hardy", points: spread ? { ...spread.points } : ZERO_POINTS,
  };
  // Item Clause (PS/data/rulesets.ts:838-868; no item is never counted, :857): the highest-weight Reg M-C item no earlier member
  // holds, then the next when the validator rejects the set with it, then no item. A form's required item (Mega Stone) always.
  const items = required ? [required]
    : [...new Set([...row.items.map((entry) => entry.id).filter((id) => !id || (runtime.itemsById.has(id) && !taken.has(id))), ""])];
  let first: SuggestedSet | null = null;
  for (const itemId of items) {
    const fields = { ...base, itemId };
    const set = finish(member, fields, usageMoves(fields, row, deps), row, legality);
    if (!legality.problems(set).length) return set;
    first ??= set;
  }
  return first!;
}

/**
 * One set per member, in the members' order. Required items (Mega Stones) are held first; every other item is taken in member
 * order, so no two members share one (Item Clause).
 */
export const suggestTrainingSets: SuggestTrainingSets = (members, deps) => {
  const taken = new Set(members.flatMap((member) => member.itemId ?? requiredItem(member.speciesId, deps.runtime) ?? []));
  return members.map((member) => {
    const set = suggestOne(member, deps, taken);
    if (set.itemId) taken.add(set.itemId);
    return set;
  });
};
