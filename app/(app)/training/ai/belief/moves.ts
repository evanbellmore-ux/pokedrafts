// SPEC 10.1.1 Moves (addendum A1.4): a point belief of a member's four moves, not sampled.
import { createMoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SheetMember } from "../../model/sheet";
import { usageMoveWeights, type UsageSource } from "./usage";

/** Moves never kept as a believed move: Struggle is no move of a set (PS/data/moves.ts struggle: noPPBoosts, callable only). */
const NOT_SET_MOVES: ReadonlySet<string> = new Set(["struggle"]);

/**
 * Open moves: the sheet's. Closed: the moves seen used (first four, in the order seen), then its usage moves of any category
 * by weight (A1.4) that its proven learnset has, then Protect when it learns it and the calculator's Doubles fill
 * (createMoveSlots: the usage four of move-usage.json, then the aggregate rank), until four. A newly seen move so replaces
 * the lowest-ranked filler.
 */
export function believedMoves(member: SheetMember, seen: readonly string[], source: UsageSource, runtime: BattleRuntime): string[] {
  if (member.moves) return [...member.moves];
  const species = runtime.speciesById.get(member.speciesId);
  const learns = (id: string) => !!species?.moves.includes(id) && runtime.movesById.has(id);
  const out: string[] = [];
  const add = (id: string | null | undefined, check = true) => {
    if (!id || out.length >= 4 || out.includes(id) || NOT_SET_MOVES.has(id) || (check && !learns(id))) return;
    out.push(id);
  };
  for (const id of seen) add(id, false);
  for (const { id } of usageMoveWeights(source)) add(id);
  add("protect");
  for (const slot of createMoveSlots(member.speciesId, "Doubles", runtime)) add(slot.moveId);
  return out;
}
